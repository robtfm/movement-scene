import { ColliderLayer, engine, Entity, InputAction, inputSystem, Raycast, RaycastQueryType, RaycastShape, raycastSystem, RaycastSystemCallback, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math';
import { groundDistance, grounded, GROUNDED_ANGLE_Y_LEN, groundNormal, lastGroundTime, prevGrounded, setGrounded } from './ground';
import { JUMP_DECEL_TIME, GRAVITY, GROUND_SNAP_HEIGHT, GROUNDED_ANGLE, GROUNDED_HEIGHT, JOG_SPEED, JUMP_COYOTE_TIME, JUMP_HEIGHT, JUMP_HEIGHT_SPRINT, JUMP_SPEED, MAX_STEP_HEIGHT, PLAYER_COLLIDER_RADIUS, SPRINT_SPEED, JUMP_SPEED_SPRINT, VEC3_ZERO } from './constants';
import { playerPosition, prevActualVelocity, prevRequestedVelocity, printvec, tick, time, velocity, velocityLength, velocityNorm } from '.';
import { actualHorizontalVelocity, horizontalVelocity, movementAxis } from './horizontal';

const JUMP_DECEL = JUMP_SPEED / JUMP_DECEL_TIME;

const GRAVITY_DIR = Vector3.normalize(GRAVITY);

export function updateVerticalVelocity(dt: number) {
  stepUp(dt);
  applyGravity(dt);
  applyJump(dt);
  snapToGround(dt);
}

var tmp = Vector3.Zero();
function applyGravity(dt: number) {
  if (!stepping) {
    Vector3.scaleToRef(GRAVITY, dt, tmp);
    Vector3.addToRef(velocity, tmp, velocity);
    if (grounded) {
      Vector3.scaleToRef(GRAVITY_DIR, Math.min(0.0, -Vector3.dot(velocity, GRAVITY_DIR)), tmp);
      Vector3.addToRef(velocity, tmp, velocity);
    }
  }
}

export var jumpStartHeight: number | undefined = undefined;
var jumpWasPressed = false;
function applyJump(dt: number) {
  const jumpIsPressed = inputSystem.isPressed(InputAction.IA_JUMP);

  const sprintRatio = Math.min(1, Math.max(0,
    (Vector3.length(actualHorizontalVelocity) - JOG_SPEED)
    / (SPRINT_SPEED - JOG_SPEED)
  ));
  const currentJumpHeight = JUMP_HEIGHT + (JUMP_HEIGHT_SPRINT - JUMP_HEIGHT) * sprintRatio;
  const currentJumpSpeed = JUMP_SPEED + (JUMP_SPEED_SPRINT - JUMP_SPEED) * sprintRatio;

  var jumpSpeedCap = prevActualVelocity.y + GRAVITY.y * dt;

  if (jumpStartHeight === undefined
    && jumpIsPressed
    && !jumpWasPressed
    && (grounded || lastGroundTime > time - JUMP_COYOTE_TIME)) {
    // new jump
    jumpStartHeight = playerPosition.y;
    jumpSpeedCap = currentJumpSpeed;
  }

  if (jumpStartHeight !== undefined) {
    if (jumpIsPressed && playerPosition.y + 1e-3 < jumpStartHeight + currentJumpHeight) {
      // continuing jump
      const jumpHeightRemaining = (jumpStartHeight + currentJumpHeight - playerPosition.y);
      const requiredJumpTime = Math.sqrt(jumpHeightRemaining * 2 / JUMP_DECEL);
      const requiredSpeed = requiredJumpTime * JUMP_DECEL * Math.min(1, requiredJumpTime / dt);
      velocity.y = Math.min(requiredSpeed, jumpSpeedCap);
    } else if (velocity.y > 0) {
      // still moving up, jump not pressed -> slow down
      velocity.y -= Math.min(velocity.y, dt * currentJumpSpeed / JUMP_DECEL_TIME);
    } else {
      // end jump
      jumpStartHeight = undefined;
    }
  }

  jumpWasPressed = jumpIsPressed;
}

var snapSpeed = 0;
function snapToGround(dt: number) {
  if (velocity.y <= -snapSpeed) {
    velocity.y += snapSpeed;
  }

  if (
    jumpStartHeight === undefined // not jumping 
    && !stepping // not stepping 
    && prevRequestedVelocity.y <= 0  // not trying to move up
    && prevGrounded // was grounded last frame
    && groundDistance < GROUND_SNAP_HEIGHT // close enough
  ) {
    snapSpeed = (groundDistance / dt);
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
        direction: Vector3.Zero()
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
function stepUp(dt: number) {
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
    const stepSpeed = MAX_STEP_HEIGHT / dt;
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