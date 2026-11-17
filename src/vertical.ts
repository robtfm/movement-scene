import { ColliderLayer, engine, Entity, InputAction, inputSystem, RaycastQueryType, RaycastShape, raycastSystem, RaycastSystemCallback, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math';
import { groundDistance, grounded, GROUNDED_ANGLE_Y_LEN, lastGroundTime, prevGrounded, probesAllowSnap, setGrounded } from './ground';
import { JUMP_DECEL_TIME, GRAVITY, GROUND_SNAP_HEIGHT, JUMP_COYOTE_TIME, JUMP_SPEED, MAX_STEP_HEIGHT, MAX_UNREQUESTED_LIFT, MIN_STEP_HEIGHT, PLAYER_COLLIDER_RADIUS, POSITION_CORRECTION_TIME, JUMP_SPEED_SPRINT, STEP_CLEARANCE_EXCESS, VEC3_ZERO, DOUBLE_JUMP_HANG_TIME, DOUBLE_JUMP_SPEED, GLIDE_DAMP_TIME, VERTICAL_DAMP_TIME } from './constants';
import { engineDriven, playerPosition, prevPlayerPosition, prevActualVelocity, prevExternalVelocity, prevRequestedVelocity, prevStepTime, stepTime, tickTime, time, velocity } from '.';
import { movementAxis } from './horizontal';
import { doubleJumpHeight, glideEnabled, glidingFallingSpeed, jogSpeed, jumpHeight, maxAirJumps, maxGroundJumps, sprintJumpHeight, sprintSpeed } from './parameters';

const JUMP_DECEL = JUMP_SPEED / JUMP_DECEL_TIME;

const GRAVITY_DIR = Vector3.normalize(GRAVITY);

export function updateVerticalVelocity() {
  if (engineDriven) {
    // Hold the grounded state while the engine drives us (see engineDriven): a lerp lifting
    // us off the ground must not read as a fall, nor arrive as a landing. A jump press still
    // goes through so the player can cancel the move.
    // ... unless an upward push launches us off it
    updateLaunched();
    setGrounded(launched ? false : prevGrounded);
    unrequestedLift = 0;
    applyJump();
    return;
  }
  stepUp();
  applyGravity();
  applyJump();
  snapToGround();
}

var tmp = Vector3.Zero();
function applyGravity() {
  if (!stepping) {
    if (grounded || isGliding) {
      overDropTime = 0;
      Vector3.scaleToRef(GRAVITY, tickTime, tmp);
      Vector3.addToRef(velocity, tmp, velocity);
    } else {
      // Exact over the tick for dv/dt = g - v/tau: the speed decays toward the terminal g*tau.
      // Only the ballistic speed is damped; the jump's lift sits on top of it.
      const decay = Math.exp(-tickTime / VERTICAL_DAMP_TIME);
      const ballistic = velocity.y - jumpLift;
      let next = ballistic * decay + GRAVITY.y * VERTICAL_DAMP_TIME * (1 - decay);
      if (jumpCurveSpeed !== undefined) {
        overDropTime += tickTime;
      } else if (overDropTime > 0 && ballistic < 0) {
        next = Math.min(next, overDropSpeed(ballistic, tickTime));
        overDropTime -= tickTime;
      }
      velocity.y = next + jumpLift;
    }
    if (grounded) {
      Vector3.scaleToRef(GRAVITY_DIR, Math.min(0.0, -Vector3.dot(velocity, GRAVITY_DIR)), tmp);
      Vector3.addToRef(velocity, tmp, velocity);
    }
  }
}

export var jumpStartHeight: number | undefined = undefined;
// The jump height applicable to the current (or next) jump — for a first
// jump, blended between walk-jump and sprint-jump based on horizontal speed;
// for an in-air jump, the fixed DOUBLE_JUMP_HEIGHT. Exported so the animation
// selector can size the jump clip's playback speed to match the ascent
// duration.
export var currentJumpHeight = 0;
var jumpWasPressed = false;
var jumpReleased = false;
// Slots consumed since the last grounded frame. Reset to 0 on landing.
// Tracked separately so an unused ground slot doesn't carry over: once past
// coyote a press goes to the air-jump branch (or glide) regardless of whether
// a ground jump was ever fired.
var groundJumpsUsed = 0;
var airJumpsUsed = 0;
// True while the current (or next) jump is fired from the air — adds the
// extra height, drives the air-jump animation. Cleared on landing or when
// gliding ends mid-air.
export var isDoubleJump = false;
// Absolute time at which the hang phase ends. While set and in the future,
// vertical velocity is pinned to zero; on elapse, the in-air jump launches.
var doubleJumpHangEnd: number | undefined = undefined;
// True while the player is gliding — damps vertical velocity toward
// -gliding_falling_speed and (via horizontal.ts) drives horizontal speed to
// gliding_speed. Triggered by a fresh jump press once the air-jump
// slot has been consumed; ends on release or landing; re-triggerable mid-air.
export var isGliding = false;
// The jump only ever lifts. While a jump is active the published vertical speed is the higher of
// the jump curve and the ballistic speed (gravity plus external impulses and forces), so the
// jump's own shaping can never cancel an external push. jumpLift is the part of velocity.y the
// jump added on top of ballistic.
var jumpCurveSpeed: number | undefined = undefined;
var jumpLift = 0;
// Over-drop: after a jump, the fall isn't slowed by the drag for as long as the jump curves ran
// (ground and air jumps added together), so jumps come down about as they would without drag.
var overDropTime = 0;

// Speed after falling for `dt` from `ballistic` without drag, but no faster than the terminal
// speed, so the drag never has to slow the fall back down afterwards.
function overDropSpeed(ballistic: number, dt: number): number {
  return Math.max(ballistic + GRAVITY.y * dt, GRAVITY.y * VERTICAL_DAMP_TIME);
}

export function applyJumpLift() {
  const ballistic = velocity.y - jumpLift;
  jumpLift = jumpCurveSpeed === undefined || stepping ? 0 : Math.max(0, jumpCurveSpeed - ballistic);
  velocity.y = ballistic + jumpLift;
}

// Vertical change from the speed at the start of the coming step to the mean over it, under gravity
// and the vertical drag, while flying freely. External pushes are taken as applied up front. The
// jump curve is a target speed, so it isn't stepped.
export function verticalHalfStep(step: number): number {
  if (grounded || stepping || engineDriven || isGliding || snapSpeed !== 0) return 0;
  const f = step > 1e-6 ? VERTICAL_DAMP_TIME * (1 - Math.exp(-step / VERTICAL_DAMP_TIME)) / step : 1;
  const ballistic = velocity.y - jumpLift;
  let ballisticMean = ballistic + (GRAVITY.y * VERTICAL_DAMP_TIME - ballistic) * (1 - f);
  if (jumpCurveSpeed === undefined && overDropTime > 0 && ballistic < 0) {
    ballisticMean = Math.min(ballisticMean, overDropSpeed(ballistic, step / 2));
  }
  if (jumpCurveSpeed === undefined) return ballisticMean - ballistic;
  return Math.max(jumpCurveSpeed, ballisticMean) - Math.max(jumpCurveSpeed, ballistic);
}

// Jump over: whatever lift remains becomes ballistic speed, so the motion stays continuous.
function endJumpCurve() {
  jumpCurveSpeed = undefined;
  jumpLift = 0;
}

function applyJump() {
  const jumpIsPressed = inputSystem.isPressed(InputAction.IA_JUMP);

  // Track release so a re-press mid-jump doesn't re-engage the continuing-jump
  // branch with stale state — that branch sets velocity.y = min(requiredSpeed,
  // jumpSpeedCap), and jumpSpeedCap derives from the decayed prev velocity so
  // it collapses to a negative, driving velocity.y deeply negative while
  // jumpStartHeight stays defined (keeping the avatar in jump animation).
  if (!jumpIsPressed && jumpStartHeight !== undefined) {
    jumpReleased = true;
  }

  if (grounded) {
    groundJumpsUsed = 0;
    airJumpsUsed = 0;
    isDoubleJump = false;
    isGliding = false;
  }

  if (isGliding && !jumpIsPressed) {
    isGliding = false;
    // Drop the air-jump flag and any lingering jump start so the post-glide
    // fall routes through the passive-fall (apex-frozen) animation branch
    // instead of snapping back to the jump or DoubleJump clip.
    isDoubleJump = false;
    jumpStartHeight = undefined;
  }

  // Use the more conservative of prev requested vs prev actual so external
  // forces (impulses, moving platforms) don't inflate sprint jump height/speed.
  const prevReqHorizLen = Math.sqrt(prevRequestedVelocity.x * prevRequestedVelocity.x + prevRequestedVelocity.z * prevRequestedVelocity.z);
  const prevActHorizLen = Math.sqrt(prevActualVelocity.x * prevActualVelocity.x + prevActualVelocity.z * prevActualVelocity.z);
  const naturalHorizSpeed = Math.min(prevReqHorizLen, prevActHorizLen);
  // When walk/jog/run are all disabled, parameters.ts collapses jogSpeed and
  // sprintSpeed to 0; without this guard the ratio is NaN and propagates into
  // currentJumpHeight / currentJumpSpeed, killing the jump entirely.
  const sprintRatio = sprintSpeed > jogSpeed
    ? Math.min(1, Math.max(0, (naturalHorizSpeed - jogSpeed) / (sprintSpeed - jogSpeed)))
    : 0;
  const baseJumpHeight = jumpHeight + (sprintJumpHeight - jumpHeight) * sprintRatio;
  currentJumpHeight = isDoubleJump ? doubleJumpHeight : baseJumpHeight;
  const currentJumpSpeed = isDoubleJump ? DOUBLE_JUMP_SPEED : JUMP_SPEED + (JUMP_SPEED_SPRINT - JUMP_SPEED) * sprintRatio;

  // Same rationale for the vertical cap: don't let external vertical forces
  // boost the jump.
  var jumpSpeedCap = Math.min(prevRequestedVelocity.y, prevActualVelocity.y);

  if (doubleJumpHangEnd !== undefined) {
    if (time < doubleJumpHangEnd) {
      jumpCurveSpeed = 0;
      jumpWasPressed = jumpIsPressed;
      return;
    }
    // Hang complete: launch the in-air jump from the current position. Seeding
    // the curve ensures a minimum jump even if the player released during hang.
    doubleJumpHangEnd = undefined;
    jumpStartHeight = playerPosition.y;
    jumpSpeedCap = currentJumpSpeed;
    jumpReleased = !jumpIsPressed;
    jumpCurveSpeed = currentJumpSpeed;
  } else if (jumpStartHeight === undefined
    && jumpIsPressed
    && !jumpWasPressed
    && (grounded || lastGroundTime > time - JUMP_COYOTE_TIME)
    && groundJumpsUsed < maxGroundJumps)
  {
    // ground jump (or coyote). Only fires while grounded or in coyote, and
    // only if a ground slot is still available.
    jumpStartHeight = playerPosition.y;
    jumpSpeedCap = currentJumpSpeed;
    jumpReleased = false;
    groundJumpsUsed += 1;
    isDoubleJump = false;
  } else if (jumpIsPressed
    && !jumpWasPressed
    && !grounded
    && airJumpsUsed < maxAirJumps)
  {
    // air jump: hold vertical velocity at zero (or above, if pushed) and hang
    // briefly; the launch runs when the hang elapses. Cancels any first-jump
    // ascent still in progress.
    // Counted separately from ground slots so an unused ground slot doesn't
    // bleed into the air-jump count.
    airJumpsUsed += 1;
    isDoubleJump = true;
    jumpStartHeight = undefined;
    jumpReleased = false;
    velocity.y -= jumpLift;
    jumpLift = 0;
    jumpCurveSpeed = 0;
    doubleJumpHangEnd = time + DOUBLE_JUMP_HANG_TIME;
    jumpWasPressed = jumpIsPressed;
    return;
  } else if (jumpIsPressed
    && !jumpWasPressed
    && !grounded
    && airJumpsUsed >= maxAirJumps
    && !isGliding
    && glideEnabled)
  {
    // No air slot remaining (which may be zero with disableDoubleJump): a
    // fresh airborne press starts a glide. Independent of any unused ground
    // slot — once past coyote that slot is forfeit, so the press transitions
    // straight to glide.
    isGliding = true;
    jumpStartHeight = undefined;
    jumpReleased = false;
    endJumpCurve();
  }

  if (isGliding) {
    const alpha = 1 - Math.exp(-tickTime / GLIDE_DAMP_TIME);
    velocity.y += (-glidingFallingSpeed - velocity.y) * alpha;
    jumpWasPressed = jumpIsPressed;
    return;
  }

  if (jumpStartHeight !== undefined) {
    if (jumpIsPressed && !jumpReleased && playerPosition.y + 1e-3 < jumpStartHeight + currentJumpHeight && jumpSpeedCap > 0) {
      // continuing jump
      const jumpHeightRemaining = (jumpStartHeight + currentJumpHeight - playerPosition.y);
      const requiredJumpTime = Math.sqrt(jumpHeightRemaining * 2 / JUMP_DECEL);
      const requiredSpeed = requiredJumpTime * JUMP_DECEL * Math.min(1, requiredJumpTime / tickTime);
      jumpCurveSpeed = Math.min(requiredSpeed, jumpSpeedCap);
    } else if (jumpCurveSpeed !== undefined && jumpCurveSpeed > 0) {
      // still moving up, jump not pressed -> slow down, on top of gravity
      jumpCurveSpeed -= Math.min(jumpCurveSpeed, tickTime * (currentJumpSpeed / JUMP_DECEL_TIME - GRAVITY.y));
    } else {
      // end jump
      jumpStartHeight = undefined;
      endJumpCurve();
    }
  }

  jumpWasPressed = jumpIsPressed;
}

// An upward push stronger than gravity is meant to lift the avatar, so like a jump it leaves
// the ground rather than being snapped back down. A weaker one (externalVelocity is summed
// over the tick, so a force shows up as force * tickTime) stays on the ground.
function isLaunched(): boolean {
  return prevExternalVelocity.y > -GRAVITY.y * tickTime;
}

// Set by a launch and held until the avatar is back on the ground and no longer rising, so
// a launch too small to clear the grounded height in one tick isn't snapped back down.
var launched = false;
function updateLaunched() {
  if (isLaunched()) {
    launched = true;
  } else if (launched && grounded && velocity.y <= 0) {
    launched = false;
  }
}

export var snapSpeed = 0;
// Net height gained beyond what we asked for. The engine's collide-and-slide deflects
// horizontal speed upward off step edges and bumps, and by the next tick that can carry the
// avatar past GROUND_SNAP_HEIGHT; it widens the snap range so the avatar is pulled back down.
var unrequestedLift = 0;
function snapToGround() {
  if (velocity.y <= -snapSpeed) {
    velocity.y += snapSpeed;
  }

  if (groundDistance < 1e-3 || jumpStartHeight !== undefined) {
    unrequestedLift = 0;
  } else {
    const rise = playerPosition.y - prevPlayerPosition.y;
    const requestedRise = Math.max(0, prevRequestedVelocity.y) * tickTime;
    unrequestedLift = Math.min(MAX_UNREQUESTED_LIFT, Math.max(0, unrequestedLift + rise - requestedRise));
  }

  updateLaunched();

  if (
    jumpStartHeight === undefined // not jumping
    && !launched // not pushed upward
    && !stepping // not stepping
    && prevGrounded // was grounded last frame
    && (groundDistance < GROUND_SNAP_HEIGHT + unrequestedLift || probesAllowSnap(GROUND_SNAP_HEIGHT + unrequestedLift)) // close enough
  ) {
    snapSpeed = Math.max(0, groundDistance / stepTime);
    velocity.y -= snapSpeed;
    setGrounded(true); // maintain prevGrounded for next frame
  } else {
    snapSpeed = 0;
    // no longer grounded for the next tick's snap either, or it would undo a small launch
    if (launched) setGrounded(false);
  }
}

var fwdCast: Entity;
var upCast: Entity;
var upFwdCast: Entity;
var landingCast: Entity;

// The landing probe starts above MAX_STEP_HEIGHT so a tread at exactly max
// step height is still hit, and just beyond the collider surface so it lands
// on the prospective tread rather than the riser face.
const LANDING_CAST_HEIGHT = MAX_STEP_HEIGHT + 0.1;
const LANDING_CAST_FORWARD = PLAYER_COLLIDER_RADIUS + 0.05;

// cast fwd
var fwdDistance: number = Infinity;
var fwdWalkable: boolean = true;
var fwdNormal: Vector3 = Vector3.Zero();
// cast up
var upDistance: number = Infinity;
// cast up at +step height
var upFwdDistance: number = Infinity;
// cast down onto the prospective landing
var landingHeight: number = -Infinity;
var landingWalkable: boolean = false;

export function initStepCasts() {
  function initCast(position: Vector3, local: boolean, opts: { direction: Vector3, maxDistance: number, shape: RaycastShape, queryType?: RaycastQueryType }, cb: RaycastSystemCallback): Entity {
    const e = engine.addEntity();
    Transform.create(e, { parent: engine.PlayerEntity, position });

    const raycastData = {
      entity: e,
      opts: {
        queryType: RaycastQueryType.RQT_HIT_FIRST,
        ...opts,
        continuous: true,
        collisionMask: ColliderLayer.CL_PHYSICS,
        includeWorld: true,
      }
    };
    // local directions follow avatar yaw (the cast entity is parented to the
    // player with identity rotation)
    if (local) {
      raycastSystem.registerLocalDirectionRaycast(raycastData, cb);
    } else {
      raycastSystem.registerGlobalDirectionRaycast(raycastData, cb);
    }
    return e;
  }

  fwdCast = initCast({ x: 0, y: 0, z: 0 }, true, { direction: Vector3.Forward(), maxDistance: PLAYER_COLLIDER_RADIUS, shape: RaycastShape.RS_AVATAR }, (hits) => {
    fwdDistance = Infinity;
    fwdWalkable = true;

    for (const hit of hits.hits) {
      fwdDistance = Math.min(fwdDistance, hit.length);
      fwdWalkable = (hit.normalHit?.y ?? 0) > GROUNDED_ANGLE_Y_LEN;
      Vector3.copyFrom(hit.normalHit ?? VEC3_ZERO, fwdNormal);
    }
  })

  // query-all so a wall/corner graze (filtered below) can't mask a real
  // ceiling on another collider behind it
  upCast = initCast({ x: 0, y: 0, z: 0 }, false, { direction: Vector3.Up(), maxDistance: MAX_STEP_HEIGHT, shape: RaycastShape.RS_AVATAR, queryType: RaycastQueryType.RQT_QUERY_ALL }, (hits) => {
    upDistance = Infinity;
    for (const hit of hits.hits) {
      // only count ceiling-like hits (normal facing down): the swept capsule
      // grazing a wall/step-corner beside us reports a ~horizontal normal at
      // ~zero distance, which would collapse the raised fwd probe to feet level
      if ((hit.normalHit?.y ?? 0) < -0.5) {
        upDistance = Math.min(upDistance, hit.length);
      }
    }
  })

  upFwdCast = initCast({ x: 0, y: MAX_STEP_HEIGHT, z: 0 }, true, { direction: Vector3.Forward(), maxDistance: PLAYER_COLLIDER_RADIUS + STEP_CLEARANCE_EXCESS, shape: RaycastShape.RS_AVATAR }, (hits) => {
    upFwdDistance = Infinity;
    for (const hit of hits.hits) {
      upFwdDistance = Math.min(upFwdDistance, hit.length);
    }
  })

  landingCast = initCast({ x: 0, y: LANDING_CAST_HEIGHT, z: LANDING_CAST_FORWARD }, false, { direction: Vector3.Down(), maxDistance: LANDING_CAST_HEIGHT, shape: RaycastShape.RS_RAY }, (hits) => {
    landingHeight = -Infinity;
    landingWalkable = false;
    for (const hit of hits.hits) {
      landingHeight = LANDING_CAST_HEIGHT - hit.length;
      landingWalkable = (hit.normalHit?.y ?? 0) >= GROUNDED_ANGLE_Y_LEN;
    }
  })
}

var stepping = false;
// feet height the current step episode is ascending to, from the landing probe
var stepTargetY = 0;
// climb speed for the current step episode, held until the landing is reached
var stepSpeed = 0;
var prevSteppingY = 0;

function stepUp() {
  // adjust fwdUp to start from ceiling (if any)
  Transform.getMutable(upFwdCast).position.y = Math.min(MAX_STEP_HEIGHT, upDistance);

  if (stepping) {
    if (
      Vector3.length(movementAxis) === 0 // input released
      || playerPosition.y >= stepTargetY - 1e-3 // reached the landing
      || playerPosition.y <= prevSteppingY + 1e-4 // blocked, making no progress
    ) {
      stepping = false;
      velocity.y = Math.min(0, velocity.y);
    } else {
      prevSteppingY = playerPosition.y;
      velocity.y = Math.min(stepSpeed, (stepTargetY - playerPosition.y) / tickTime);
    }
    // a step-up is ground locomotion: hold the grounded state through the
    // episode (and its final frame) so the animation doesn't see an
    // airborne flicker and play a landing bob on every stair step
    setGrounded(true);
    return;
  }

  if (
    !fwdWalkable && // angle doesn't allow normal walk/climb
    fwdDistance < PLAYER_COLLIDER_RADIUS * 0.25 && // can't move fwd
    upFwdDistance > fwdDistance + STEP_CLEARANCE_EXCESS && // can if we move up (excess rules out the recession of a steep planar slope)
    Vector3.dot(fwdNormal, movementAxis) < -0.85 && // ~facing the step
    landingWalkable && // a walkable landing exists ...
    landingHeight > MIN_STEP_HEIGHT && landingHeight <= MAX_STEP_HEIGHT && // ... above current ground, within step height
    (grounded || lastGroundTime > time - JUMP_COYOTE_TIME) // step from (near-)ground only: one step per landing
  ) {
    stepping = true;
    stepTargetY = playerPosition.y + landingHeight;
    prevSteppingY = -Infinity;
    stepSpeed = landingHeight / Math.max(POSITION_CORRECTION_TIME, tickTime);
    velocity.y = stepSpeed;
    setGrounded(true);
  }
}