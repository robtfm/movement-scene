import { ColliderLayer, engine, Entity, InputAction, inputSystem, Raycast, RaycastQueryType, RaycastShape, raycastSystem, RaycastSystemCallback, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math';
import { groundDistance, grounded, GROUNDED_ANGLE_Y_LEN, lastGroundTime, prevGrounded, setGrounded } from './ground';
import { JUMP_DECEL_TIME, GRAVITY, GROUND_SNAP_HEIGHT, JUMP_COYOTE_TIME, JUMP_SPEED, MAX_STEP_HEIGHT, PLAYER_COLLIDER_RADIUS, JUMP_SPEED_SPRINT, VEC3_ZERO, DOUBLE_JUMP_HEIGHT, DOUBLE_JUMP_HANG_TIME, DOUBLE_JUMP_SPEED, GLIDE_DAMP_TIME, GLIDE_FALL_SPEED } from './constants';
import { playerPosition, prevActualVelocity, prevRequestedVelocity, prevStepTime, stepTime, time, velocity, velocityNorm } from '.';
import { movementAxis } from './horizontal';
import { glideEnabled, jogSpeed, jumpHeight, maxAirJumps, maxGroundJumps, sprintJumpHeight, sprintSpeed } from './parameters';

const JUMP_DECEL = JUMP_SPEED / JUMP_DECEL_TIME;

const GRAVITY_DIR = Vector3.normalize(GRAVITY);

export function updateVerticalVelocity() {
  stepUp();
  applyGravity();
  applyJump();
  snapToGround();
}

var tmp = Vector3.Zero();
function applyGravity() {
  if (!stepping) {
    Vector3.scaleToRef(GRAVITY, stepTime, tmp);
    Vector3.addToRef(velocity, tmp, velocity);
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
// -GLIDE_FALL_SPEED and (via horizontal.ts) caps horizontal speed to
// GLIDE_HORIZONTAL_SPEED. Triggered by a fresh jump press once the air-jump
// slot has been consumed; ends on release or landing; re-triggerable mid-air.
export var isGliding = false;

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
  currentJumpHeight = isDoubleJump ? DOUBLE_JUMP_HEIGHT : baseJumpHeight;
  const currentJumpSpeed = isDoubleJump ? DOUBLE_JUMP_SPEED : JUMP_SPEED + (JUMP_SPEED_SPRINT - JUMP_SPEED) * sprintRatio;

  // Same rationale for the vertical cap: don't let external vertical forces
  // boost the jump.
  var jumpSpeedCap = Math.min(prevRequestedVelocity.y, prevActualVelocity.y);

  if (doubleJumpHangEnd !== undefined) {
    if (time < doubleJumpHangEnd) {
      velocity.y = 0;
      jumpWasPressed = jumpIsPressed;
      return;
    }
    // Hang complete: launch the in-air jump from the current position. Seeding
    // velocity.y ensures a minimum jump even if the player released during hang.
    doubleJumpHangEnd = undefined;
    jumpStartHeight = playerPosition.y;
    jumpSpeedCap = currentJumpSpeed;
    jumpReleased = !jumpIsPressed;
    velocity.y = currentJumpSpeed;
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
    // air jump: zero vertical velocity now and hang briefly; the launch runs
    // when the hang elapses. Cancels any first-jump ascent still in progress.
    // Counted separately from ground slots so an unused ground slot doesn't
    // bleed into the air-jump count.
    airJumpsUsed += 1;
    isDoubleJump = true;
    jumpStartHeight = undefined;
    jumpReleased = false;
    velocity.y = 0;
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
  }

  if (isGliding) {
    const alpha = 1 - Math.exp(-stepTime / GLIDE_DAMP_TIME);
    velocity.y += (-GLIDE_FALL_SPEED - velocity.y) * alpha;
    jumpWasPressed = jumpIsPressed;
    return;
  }

  if (jumpStartHeight !== undefined) {
    if (jumpIsPressed && !jumpReleased && playerPosition.y + 1e-3 < jumpStartHeight + currentJumpHeight && jumpSpeedCap > 0) {
      // continuing jump
      const jumpHeightRemaining = (jumpStartHeight + currentJumpHeight - playerPosition.y);
      const requiredJumpTime = Math.sqrt(jumpHeightRemaining * 2 / JUMP_DECEL);
      const requiredSpeed = requiredJumpTime * JUMP_DECEL * Math.min(1, requiredJumpTime / stepTime);
      velocity.y = Math.min(requiredSpeed, jumpSpeedCap);
    } else if (velocity.y > 0) {
      // still moving up, jump not pressed -> slow down
      velocity.y -= Math.min(velocity.y, stepTime * currentJumpSpeed / JUMP_DECEL_TIME);
    } else {
      // end jump
      jumpStartHeight = undefined;
    }
  }

  jumpWasPressed = jumpIsPressed;
}

var snapSpeed = 0;
function snapToGround() {
  if (velocity.y <= -snapSpeed) {
    velocity.y += snapSpeed;
  }

  if (
    jumpStartHeight === undefined // not jumping
    && !stepping // not stepping
    && prevGrounded // was grounded last frame
    && groundDistance < GROUND_SNAP_HEIGHT // close enough
  ) {
    snapSpeed = Math.max(0, groundDistance / stepTime);
    velocity.y -= snapSpeed;
    setGrounded(true); // maintain prevGrounded for next frame
  } else {
    snapSpeed = 0;
  }
}

var fwdCast: Entity;
var upCast: Entity;
var upFwdCast: Entity;

// cast fwd
var fwdDistance: number = Infinity;
var fwdWalkable: boolean = true;
var fwdNormal: Vector3 = Vector3.Zero();
// cast up
var upDistance: number = Infinity;
// cast up at +step height
var upFwdDistance: number = Infinity;

export function initStepCasts() {
  function initCast(position: Vector3, cb: RaycastSystemCallback): Entity {
    const e = engine.addEntity();
    Transform.create(e, { parent: engine.PlayerEntity, position });

    raycastSystem.registerGlobalDirectionRaycast({
      entity: e,
      opts: {
        maxDistance: PLAYER_COLLIDER_RADIUS,
        queryType: RaycastQueryType.RQT_HIT_FIRST,
        continuous: true,
        collisionMask: ColliderLayer.CL_PHYSICS,
        shape: RaycastShape.RS_AVATAR,
        includeWorld: true,
        direction: Vector3.Up()
      }
    },
      cb
    )
    return e;
  }

  fwdCast = initCast({ x: 0, y: 0, z: 0 }, (hits) => {
    fwdDistance = Infinity;
    fwdWalkable = true;

    for (const hit of hits.hits) {
      fwdDistance = Math.min(fwdDistance, hit.length);
      fwdWalkable = (hit.normalHit?.y ?? 0) > GROUNDED_ANGLE_Y_LEN;
      Vector3.copyFrom(hit.normalHit ?? VEC3_ZERO, fwdNormal);
    }
  })

  upCast = initCast({ x: 0, y: 0, z: 0 }, (hits) => {
    upDistance = Infinity;
    for (const hit of hits.hits) {
      upDistance = Math.min(upDistance, hit.length);
    }
  })

  upFwdCast = initCast({ x: 0, y: MAX_STEP_HEIGHT, z: 0 }, (hits) => {
    upFwdDistance = Infinity;
    for (const hit of hits.hits) {
      upFwdDistance = Math.min(upFwdDistance, hit.length);
    }
  })
}

var stepping = false;
function stepUp() {
  if (stepping && Vector3.length(movementAxis) === 0) {
    stepping = false;
    velocity.y = Math.min(0, velocity.y);
  }

  if (
    !fwdWalkable && // angle doesn't allow normal walk/climb
    (fwdDistance < PLAYER_COLLIDER_RADIUS * 0.25) && // can't move fwd
    upFwdDistance > PLAYER_COLLIDER_RADIUS * 0.25 && // can if we move up
    Vector3.dot(fwdNormal, movementAxis) < -0.85 // ~facing the step
  ) {
    const stepSpeed = MAX_STEP_HEIGHT / stepTime;
    velocity.y = stepSpeed;
    stepping = true;
  } else if (stepping) {
    velocity.y = Math.min(0, velocity.y);
    stepping = false;
  }

  // adjust fwdUp to start from ceiling (if any)
  Transform.getMutable(upFwdCast).position.y = Math.min(MAX_STEP_HEIGHT, upDistance);
  // adjust direction unless we are stepping already (then direction becomes up)
  if (!stepping) {
    const mutFwdCast = Raycast.getMutable(fwdCast);
    // adjust fwd and fwdUp to point in velocity direction
    if (mutFwdCast.direction?.$case === "globalDirection") {
      Vector3.copyFrom(velocityNorm, mutFwdCast.direction.globalDirection);
    }
    const mutUpFwdCast = Raycast.getMutable(upFwdCast);
    if (mutUpFwdCast.direction?.$case === "globalDirection") {
      Vector3.copyFrom(velocityNorm, mutUpFwdCast.direction.globalDirection);
    }
  }
}