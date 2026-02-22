import { engine, InputAction, inputSystem, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math';
import { ACCEL_TIME_AIR, ACCEL_TIME_GROUND, DECEL_TIME_AIR, DECEL_TIME_GROUND, JOG_SPEED, SPRINT_SPEED, TURN_FULL_TIME, TURN_MAX_DEGREES_SEC, VEC3_HORIZONTAL_MASK, VEC3_UP, VEC3_ZERO, WALK_SPEED } from './constants';
import { playerRotation, printvec, velocity } from '.';
import { grounded } from './ground';

export var orientation = 0;

var movementAxis = Vector3.Zero();
export function updateHorizontalVelocity(dt: number) {
  updateMovementAxis();
  updateVelocity(dt);
  setOrientation(dt);
}

Vector3.copyFrom(VEC3_ZERO, movementAxis);

function updateMovementAxis() {
  Vector3.copyFrom(VEC3_ZERO, movementAxis);
  if (inputSystem.isPressed(InputAction.IA_LEFT)) {
    Vector3.addToRef(movementAxis, Vector3.Left(), movementAxis);
  }
  if (inputSystem.isPressed(InputAction.IA_RIGHT)) {
    Vector3.addToRef(movementAxis, Vector3.Right(), movementAxis);
  }
  if (inputSystem.isPressed(InputAction.IA_FORWARD)) {
    Vector3.addToRef(movementAxis, Vector3.Forward(), movementAxis);
  }
  if (inputSystem.isPressed(InputAction.IA_BACKWARD)) {
    Vector3.addToRef(movementAxis, Vector3.Backward(), movementAxis);
  }

  const camera = Transform.get(engine.CameraEntity);
  Vector3.rotateToRef(movementAxis, camera.rotation, movementAxis);
  Vector3.multiplyToRef(movementAxis, VEC3_HORIZONTAL_MASK, movementAxis);
  Vector3.normalizeToRef(movementAxis, movementAxis);
}

export var horizontalVelocity = Vector3.Zero();
var transition = Vector3.Zero();
function updateVelocity(dt: number) {
  Vector3.multiplyToRef(velocity, VEC3_HORIZONTAL_MASK, horizontalVelocity);
  const decelerating = Vector3.lengthSquared(movementAxis) === 0 || Vector3.dot(movementAxis, horizontalVelocity) <= -0.0001;
  const accelFactor = grounded ?
    (decelerating ? DECEL_TIME_GROUND : ACCEL_TIME_GROUND) :
    (decelerating ? DECEL_TIME_AIR : ACCEL_TIME_AIR);
  const targetSpeed = inputSystem.isPressed(InputAction.IA_MODIFIER) ? SPRINT_SPEED 
    : inputSystem.isPressed(InputAction.IA_WALK) ? WALK_SPEED 
    : JOG_SPEED;

  Vector3.scaleToRef(movementAxis, targetSpeed, transition);
  Vector3.subtractToRef(transition, horizontalVelocity, transition)
  const transitionLength = Vector3.length(transition);

  if (transitionLength * accelFactor < dt * targetSpeed) {
    Vector3.addToRef(velocity, transition, velocity);
  } else {
    Vector3.normalizeToRef(transition, transition);
    Vector3.scaleToRef(transition, Math.min(dt * targetSpeed / accelFactor, 1), transition);
    Vector3.addToRef(velocity, transition, velocity);
  }
}

var targetOrientation = 0;
function setOrientation(dt: number) {
  var currentOrientation = Quaternion.toEulerAngles(playerRotation).y;
  if (Vector3.length(movementAxis) != 0) {
    const targetFacing = Quaternion.fromLookAt(VEC3_ZERO, movementAxis, VEC3_UP);
    targetOrientation = Quaternion.toEulerAngles(targetFacing).y;
  }

  // returns equivalent angle within 180 degrees of center
  function relativeDegrees(center: number, angle: number): number {
    return center + ((angle - center + 180) % 360 + 360) % 360 - 180;
  }

  if (targetOrientation != orientation) {
    if (Math.abs(targetOrientation - orientation) < 1) {
      orientation = targetOrientation;
    } else {
      currentOrientation = relativeDegrees(targetOrientation, currentOrientation);
      let perc = Math.min(dt / TURN_FULL_TIME, 1);
      orientation = Math.max(
        currentOrientation - TURN_MAX_DEGREES_SEC * dt,
        Math.min(
          currentOrientation + TURN_MAX_DEGREES_SEC * dt,
          targetOrientation * perc + currentOrientation * (1 - perc)
        ));
      orientation = relativeDegrees(180, orientation);
    }
  }
}

