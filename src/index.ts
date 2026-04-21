import { AvatarAnimationState, AvatarMovement, AvatarMovementInfo, engine, MovementAnimation, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math';
import { getExplorerConfiguration } from '~system/EnvironmentApi';
import { grounded, initGroundRaycast, updateGroundAdjust } from './ground';
import { dampVelocity, orientation, updateHorizontalVelocity } from './horizontal';
import { currentJumpHeight, initStepCasts, jumpStartHeight, updateVerticalVelocity } from './vertical';
import { initParamters as initParameters } from './parameters';
import { initWalkSystem, updateEngineWalk, consumeWalkResult } from './walk';
import { GRAVITY, MAX_SPEED } from './constants';

// Avatar-bus audio clip pools published via MovementAnimation.sounds. Engine
// plays each listed clip once per frame on the avatar's local audio bus — the
// `sounds` field is single-frame fire-and-forget, so we only include it on the
// tick the event actually fires. Timings and variant pools mirror the native
// built-ins in `crates/collectibles/src/emotes.rs` so this scene-driven path
// behaves the same as the velocity-based fallback.
const WALK_STEP_SOUNDS = [
  'assets/sounds/avatar/avatar_footstep_walk01.wav',
  'assets/sounds/avatar/avatar_footstep_walk02.wav',
  'assets/sounds/avatar/avatar_footstep_walk03.wav',
  'assets/sounds/avatar/avatar_footstep_walk04.wav',
  'assets/sounds/avatar/avatar_footstep_walk05.wav',
  'assets/sounds/avatar/avatar_footstep_walk06.wav',
  'assets/sounds/avatar/avatar_footstep_walk07.wav',
  'assets/sounds/avatar/avatar_footstep_walk08.wav',
];
const RUN_STEP_SOUNDS = [
  'assets/sounds/avatar/avatar_footstep_run01.wav',
  'assets/sounds/avatar/avatar_footstep_run02.wav',
  'assets/sounds/avatar/avatar_footstep_run03.wav',
  'assets/sounds/avatar/avatar_footstep_run04.wav',
  'assets/sounds/avatar/avatar_footstep_run05.wav',
  'assets/sounds/avatar/avatar_footstep_run06.wav',
  'assets/sounds/avatar/avatar_footstep_run07.wav',
  'assets/sounds/avatar/avatar_footstep_run08.wav',
];
const JUMP_SOUNDS = [
  'assets/sounds/avatar/avatar_footstep_jump01.wav',
  'assets/sounds/avatar/avatar_footstep_jump02.wav',
  'assets/sounds/avatar/avatar_footstep_jump03.wav',
];
const LAND_SOUNDS = [
  'assets/sounds/avatar/avatar_footstep_land01.wav',
  'assets/sounds/avatar/avatar_footstep_land02.wav',
];

function pickRandom(pool: string[]): string {
  return pool[Math.floor(Math.random() * pool.length)];
}

// Clip-relative playback times (seconds) at which the walk/run loops trigger
// a footstep. Native config: walk.(0.41, 0.91), run.(0.21, 0.54).
const WALK_STEP_TIMES = [0.41, 0.91];
const RUN_STEP_TIMES = [0.21, 0.54];

// export all the functions required to make the scene work
export * from '@dcl/sdk'

// setup
var positionAdjust = Vector3.Zero();
export function main() {
  getExplorerConfiguration({}).then((config) => {
    positionAdjust = {
      "bevy-explorer": Vector3.Zero(),
      "": Vector3.create(0, -0.08, 0), // probably explorer alpha...
    }[config.clientUri] ?? (console.log(`unknown client ${config.clientUri}`), Vector3.Zero());
    updateGroundAdjust(positionAdjust.y);
  })

  initGroundRaycast();
  initStepCasts();
  initWalkSystem();

  engine.addSystem(initFrame, 100000 + 1);
  engine.addSystem(applyMovement, 100000 - 3);
}

export var time = 0;
export var tick = 0;
export var stepTime = 0;
export var prevStepTime = 0;
export var playerPosition: Vector3 = Vector3.Zero();
export var prevPlayerPosition: Vector3 = Vector3.Zero();
export var playerRotation: Quaternion = Quaternion.Identity();

export var velocity = Vector3.Zero();
export var velocityNorm = Vector3.Zero();
export var velocityLength = 0;
export var prevRequestedVelocity = Vector3.Zero();
export var prevActualVelocity = Vector3.Zero();
export var prevExternalVelocity = Vector3.Zero();

// What we published last frame. Compared against prevRequestedVelocity in
// initFrame to detect engine takeover (resync to prevActual when they differ).
var lastPublished = Vector3.Zero();

export function printvec(v: Vector3): string {
  return `(${v.x},${v.y},${v.z})`
}

function initFrame() {
  tick += 1;
  prevPlayerPosition = { ...playerPosition };
  const playerTransform = Transform.get(engine.PlayerEntity)
  Vector3.copyFrom(playerTransform.position, playerPosition);
  Vector3.addToRef(playerPosition, positionAdjust, playerPosition);
  playerRotation = playerTransform.rotation;

  const movementInfo = AvatarMovementInfo.getOrNull(engine.PlayerEntity);
  activeAnimationState = movementInfo?.activeAnimationState;
  if (movementInfo !== null) {
    Vector3.copyFrom(movementInfo.requestedVelocity ?? Vector3.Zero(), prevRequestedVelocity);
    Vector3.copyFrom(movementInfo.actualVelocity ?? Vector3.Zero(), prevActualVelocity);
    Vector3.copyFrom(movementInfo.externalVelocity ?? Vector3.Zero(), prevExternalVelocity);
    stepTime = movementInfo.stepTime;
    prevStepTime = movementInfo.previousStepTime;
  }
  time += stepTime;

  initParameters(movementInfo?.activeAvatarLocomotionSettings, movementInfo?.activeInputModifier);
  updateEngineWalk(movementInfo?.walkTarget, movementInfo?.walkThreshold);

  // If we are not in control (engine consumed a different velocity than we
  // published), resync velocity to prevActual. Also reset prevRequestedVelocity
  // so snap-to-ground is suppressed on this same tick.
  if (Vector3.distance(lastPublished, prevRequestedVelocity) > 0.1 || movementInfo?.requestedVelocity === undefined) {
    Vector3.copyFrom(prevActualVelocity, velocity);
    Vector3.copyFrom(prevActualVelocity, prevRequestedVelocity);
  }
}

// Tracks the last jumpStartHeight we observed so we can detect a new jump
// (undefined -> defined) and seek the jump clip back to 0 on its first frame.
var prevJumpStartHeight: number | undefined = undefined;
// True from touchdown until the engine reports the non-looped landing clip has
// played through. While true, keep re-requesting the landing so the engine
// holds it; once activeAnimationState shows it has completed, fall through.
var requestingLanding = false;
// One-shot latch so the landing sound fires exactly once per landing. Reset on
// a new jump. Without this, engine CRDT latency keeps reporting the clip as
// loop=true for several ticks after we switch to the non-looped landing,
// retriggering the sound every frame.
var landSoundFired = false;
// Mirror of the engine's currently-active scene animation state. Read in
// initFrame; consulted in selectAnimation to decide when to stop the landing.
var activeAnimationState: AvatarAnimationState | undefined = undefined;
// Last-observed playback phase of the currently-active scene animation, used to
// detect when the clip wrapped past a footstep trigger time since the previous
// frame. Keyed per src so switching clip resets tracking.
var prevSoundTrackedSrc: string | undefined = undefined;
var prevSoundTrackedTime: number = 0;

// Detects whether the clip's playback time crossed any of the given trigger
// timestamps (in seconds) while playing forward between `prev` and `cur`.
// Backward motion (negative animation speed, e.g. while turning in place
// with the walk clip's speed driven by signed directional velocity) is
// ignored so we don't fire a storm of sounds as the clip scrubs back and
// forth. A genuine loop wrap is distinguished from backward play by
// requiring the apparent reverse jump to span more than half the clip.
function stepTriggered(prev: number, cur: number, duration: number, triggers: number[]): boolean {
  if (cur === prev) return false;
  const isLoopWrap = cur < prev && duration > 0 && prev - cur > duration * 0.5;
  if (cur < prev && !isLoopWrap) return false;
  for (const t of triggers) {
    if (isLoopWrap) {
      if (t > prev || t <= cur) return true;
    } else if (t > prev && t <= cur) {
      return true;
    }
  }
  return false;
}

function selectAnimation(): MovementAnimation {
  const jumpingOrFalling = jumpStartHeight !== undefined || !grounded;
  const newJump = jumpStartHeight !== undefined && prevJumpStartHeight === undefined;
  prevJumpStartHeight = jumpStartHeight;

  if (jumpingOrFalling) {
    requestingLanding = true;
    if (newJump) {
      landSoundFired = false;
    }
    // Match the jump clip's ascent timing to the physical ascent: time-to-peak
    // under gravity = sqrt(2h/g). Speed 0.5/ttp means the clip hits its apex
    // (midpoint, t=0.5) at roughly the same moment the avatar does.
    const gravityMag = Math.abs(GRAVITY.y);
    const timeToPeak = Math.sqrt(2 * Math.max(currentJumpHeight, 0.01) / gravityMag);
    const ascentSpeed = 0.5 / timeToPeak;
    // Once the clip has played past its apex pose (midpoint), freeze it via
    // speed 0 so long falls from high places don't loop the clip back to the
    // takeoff pose. We deliberately don't re-seek every frame — the engine
    // preserves the current playback position, and an explicit seek would
    // add a visible hiccup to the pose.
    const s = activeAnimationState;
    const atApex = s !== undefined
      && s.src === 'assets/jump.glb'
      && s.playbackTime >= 0.5;
    // Jump takeoff sound fires for exactly one frame on the newJump tick.
    return {
      src: 'assets/jump.glb',
      speed: atApex ? 0 : ascentSpeed,
      loop: true,
      idle: false,
      transitionSeconds: 0.1,
      playbackTime: newJump ? 0 : undefined,
      sounds: newJump ? [pickRandom(JUMP_SOUNDS)] : [],
    };
  }

  // Landing: play the non-looped jump clip until the engine reports it has
  // finished. `loopCount >= 1` means a non-looping clip ran past its end;
  // `playbackTime >= duration` covers the tick where it first hits the end.
  if (requestingLanding) {
    const s = activeAnimationState;
    const landingClipFinished = s !== undefined
      && s.src === 'assets/jump.glb'
      && !s.loop
      && (s.loopCount >= 1 || s.playbackTime >= s.duration);
    if (landingClipFinished) {
      requestingLanding = false;
    } else {
      // Fire the landing sound once per landing (first tick this block runs).
      const fireLand = !landSoundFired;
      if (fireLand) {
        landSoundFired = true;
      }
      return {
        src: 'assets/jump.glb',
        speed: 1.5,
        loop: false,
        idle: false,
        transitionSeconds: 0.1,
        sounds: fireLand ? [pickRandom(LAND_SOUNDS)] : [],
      };
    }
  }

  // Directional (signed) forward speed — matches engine's damped_velocity projected
  // onto gt.forward(); lets the walk/run anim play reversed when moving backward.
  const forward = Vector3.rotate(Vector3.Forward(), playerRotation);
  const directionalVelLen = velocity.x * forward.x + velocity.z * forward.z;

  if (velocityLength > 0.1) {
    if (velocityLength <= 2.6) {
      return {
        src: 'assets/walk.glb',
        speed: directionalVelLen / 1.5,
        loop: true,
        idle: false,
        transitionSeconds: 0.4,
        sounds: footstepsFor('assets/walk.glb', WALK_STEP_TIMES, WALK_STEP_SOUNDS),
      };
    }
    return {
      src: 'assets/run.glb',
      speed: directionalVelLen / 4.5,
      loop: true,
      idle: false,
      transitionSeconds: 0.4,
      sounds: footstepsFor('assets/run.glb', RUN_STEP_TIMES, RUN_STEP_SOUNDS),
    };
  }

  return {
    src: 'assets/idle.glb',
    speed: 1.0,
    loop: true,
    idle: true,
    transitionSeconds: 0.4,
    sounds: [],
  };
}

// Detects a footstep trigger crossing for the currently-playing clip. Returns a
// single-frame sounds list (or empty) so remote clients see each step as an
// independent transition.
function footstepsFor(src: string, triggers: number[], pool: string[]): string[] {
  const s = activeAnimationState;
  if (s === undefined || s.src !== src) {
    prevSoundTrackedSrc = src;
    prevSoundTrackedTime = 0;
    return [];
  }
  const cur = s.playbackTime;
  const prev = prevSoundTrackedSrc === src ? prevSoundTrackedTime : cur;
  prevSoundTrackedSrc = src;
  prevSoundTrackedTime = cur;
  return stepTriggered(prev, cur, s.duration, triggers) ? [pickRandom(pool)] : [];
}

function writeMovement() {
  AvatarMovement.createOrReplace(engine.PlayerEntity, {
    velocity,
    orientation: -orientation,
    groundDirection: Vector3.Down(),
    walkSuccess: consumeWalkResult(),
    animation: selectAnimation(),
  })

  Vector3.copyFrom(velocity, lastPublished);
}

function applyMovement() {
  dampVelocity();
  updateVerticalVelocity();
  updateHorizontalVelocity();

  // External forces are added last so damping and horizontal stop-decel
  // can't zero small impulses before they have any visible effect. Damping
  // on subsequent frames still decays the persisted external contribution.
  velocity.x += prevExternalVelocity.x;
  velocity.y += prevExternalVelocity.y;
  velocity.z += prevExternalVelocity.z;

  const speed = Vector3.length(velocity);
  if (speed > MAX_SPEED) {
    Vector3.scaleToRef(velocity, MAX_SPEED / speed, velocity);
  }

  if (Vector3.length(velocity) < 0.01 || Number.isNaN(Vector3.length(velocity))) {
    velocity = Vector3.Zero();
  }
  Vector3.normalizeToRef(velocity, velocityNorm);
  velocityLength = Vector3.length(velocity);
  writeMovement();
}
