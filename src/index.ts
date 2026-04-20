import { AvatarAnimationState, AvatarMovement, AvatarMovementInfo, engine, MovementAnimation, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math';
import { getExplorerConfiguration } from '~system/EnvironmentApi';
import { grounded, initGroundRaycast, updateGroundAdjust } from './ground';
import { dampVelocity, orientation, updateHorizontalVelocity } from './horizontal';
import { currentJumpHeight, initStepCasts, jumpStartHeight, updateVerticalVelocity } from './vertical';
import { initParamters as initParameters } from './parameters';
import { initWalkSystem, updateEngineWalk, consumeWalkResult } from './walk';
import { GRAVITY, MAX_SPEED } from './constants';

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
// Mirror of the engine's currently-active scene animation state. Read in
// initFrame; consulted in selectAnimation to decide when to stop the landing.
var activeAnimationState: AvatarAnimationState | undefined = undefined;

function selectAnimation(): MovementAnimation {
  const jumpingOrFalling = jumpStartHeight !== undefined || !grounded;
  const newJump = jumpStartHeight !== undefined && prevJumpStartHeight === undefined;
  prevJumpStartHeight = jumpStartHeight;

  if (jumpingOrFalling) {
    requestingLanding = true;
    // Match the jump clip's ascent timing to the physical ascent: time-to-peak
    // under gravity = sqrt(2h/g). Speed 0.5/ttp means the clip hits its apex at
    // roughly the same moment the avatar does, for any jump height.
    const gravityMag = Math.abs(GRAVITY.y);
    const timeToPeak = Math.sqrt(2 * Math.max(currentJumpHeight, 0.01) / gravityMag);
    return {
      src: 'assets/jump.glb',
      speed: 0.5 / timeToPeak,
      loop: true,
      idle: false,
      transitionSeconds: 0.1,
      playbackTime: newJump ? 0 : undefined,
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
      return {
        src: 'assets/jump.glb',
        speed: 1.5,
        loop: false,
        idle: false,
        transitionSeconds: 0.1,
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
      };
    }
    return {
      src: 'assets/run.glb',
      speed: directionalVelLen / 4.5,
      loop: true,
      idle: false,
      transitionSeconds: 0.4,
    };
  }

  return {
    src: 'assets/idle.glb',
    speed: 1.0,
    loop: true,
    idle: true,
    transitionSeconds: 0.4,
  };
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
