import { AvatarMovement, AvatarMovementInfo, engine, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math';
import { getExplorerConfiguration } from '~system/EnvironmentApi';
import { initGroundRaycast, updateGroundAdjust } from './ground';
import { dampVelocity, orientation, updateHorizontalVelocity } from './horizontal';
import { initStepCasts, updateVerticalVelocity } from './vertical';
import { initParamters as initParameters } from './parameters';
import { initWalkSystem, updateEngineWalk, consumeWalkResult } from './walk';
import { MAX_SPEED } from './constants';

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

  // Engine-reported external velocity is added directly to velocity each
  // frame as an impulse contribution. Subsequent damping (in horizontal) and
  // gravity decay it; one-shot impulses persist as a damped tail.
}

function writeMovement() {
  AvatarMovement.createOrReplace(engine.PlayerEntity, {
    velocity,
    orientation: -orientation,
    groundDirection: Vector3.Down(),
    walkSuccess: consumeWalkResult(),
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
