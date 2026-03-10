import { engine, InputAction, inputSystem, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math';
import { ACCEL_TIME_AIR, ACCEL_TIME_GROUND, DECEL_TIME_AIR, DECEL_TIME_GROUND, TURN_FULL_TIME, TURN_MAX_DEGREES_SEC, VEC3_HORIZONTAL_MASK, VEC3_UP, VEC3_ZERO } from './constants';
import { playerRotation, prevActualVelocity, velocity } from '.';
import { grounded } from './ground';
import { disableOrientation, jogSpeed, sprintSpeed, walkSpeed } from './parameters';
import { getWalkAxis } from './walk';

export var orientation = 0;
export var movementAxis = Vector3.Zero();

export function updateHorizontalVelocity(dt: number) {
  updateMovementAxis();
  updateVelocity(dt);
  setOrientation(dt);
}

var scratch: Vector3 = Vector3.Zero();
function updateMovementAxis() {
  // Auto-walk takes priority. getWalkAxis() also handles the IA_PRIMARY trigger and cancels
  // the walk (returning null) if any directional key is pressed, so we fall through to normal
  // manual input in that case.
  const walkAxis = getWalkAxis();
  if (walkAxis !== null) {
    Vector3.copyFrom(walkAxis, movementAxis);
    return;
  }

  const camera = Transform.get(engine.CameraEntity);
  var fwd = Vector3.rotate(Vector3.Forward(), camera.rotation);
  Vector3.multiplyToRef(fwd, VEC3_HORIZONTAL_MASK, fwd);
  Vector3.normalizeToRef(fwd, fwd);
  var right = Vector3.rotate(Vector3.Right(), camera.rotation);
  Vector3.multiplyToRef(right, VEC3_HORIZONTAL_MASK, right);
  Vector3.normalizeToRef(right, right);
  var back = Vector3.scale(fwd, -1);
  var left = Vector3.scale(right, -1);

  Vector3.copyFrom(VEC3_ZERO, movementAxis);
  if (inputSystem.isPressed(InputAction.IA_LEFT)) {
    Vector3.addToRef(movementAxis, left, movementAxis);
  }
  if (inputSystem.isPressed(InputAction.IA_RIGHT)) {
    Vector3.addToRef(movementAxis, right, movementAxis);
  }
  if (inputSystem.isPressed(InputAction.IA_FORWARD)) {
    Vector3.addToRef(movementAxis, fwd, movementAxis);
  }
  if (inputSystem.isPressed(InputAction.IA_BACKWARD)) {
    Vector3.addToRef(movementAxis, back, movementAxis);
  }

  Vector3.normalizeToRef(movementAxis, movementAxis);
}

export var horizontalVelocity = Vector3.Zero();
export var actualHorizontalVelocity = Vector3.Zero();
var transition = Vector3.Zero();
function updateVelocity(dt: number) {
  Vector3.multiplyToRef(velocity, VEC3_HORIZONTAL_MASK, horizontalVelocity);
  Vector3.multiplyToRef(prevActualVelocity, VEC3_HORIZONTAL_MASK, actualHorizontalVelocity);
  const decelerating = Vector3.lengthSquared(movementAxis) === 0 || Vector3.dot(movementAxis, horizontalVelocity) <= -0.0001;
  const accelFactor = grounded ?
    (decelerating ? DECEL_TIME_GROUND : ACCEL_TIME_GROUND) :
    (decelerating ? DECEL_TIME_AIR : ACCEL_TIME_AIR);
  const targetSpeed = inputSystem.isPressed(InputAction.IA_MODIFIER) ? sprintSpeed 
    : inputSystem.isPressed(InputAction.IA_WALK) ? walkSpeed 
    : jogSpeed;

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
  if (disableOrientation) {
    return;
  }

  orientation = Quaternion.toEulerAngles(playerRotation).y;
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
      orientation = relativeDegrees(targetOrientation, orientation);
      let perc = Math.min(dt / TURN_FULL_TIME, 1);
      orientation = Math.max(
        orientation - TURN_MAX_DEGREES_SEC * dt,
        Math.min(
          orientation + TURN_MAX_DEGREES_SEC * dt,
          targetOrientation * perc + orientation * (1 - perc)
        ));
      orientation = relativeDegrees(180, orientation);
    }
  }
}

