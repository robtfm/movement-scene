import { Vector3 } from "@dcl/sdk/math";

export const GRAVITY = Vector3.scale(Vector3.Down(), 10.0);

export const WALK_SPEED = 2.5; // max walk speed
export const JOG_SPEED = 8.18; // max run speed
export const SPRINT_SPEED = 11; // max sprint speed
export const ACCEL_TIME_GROUND = 0.25; // time to get to full speed while on the ground
export const DECEL_TIME_GROUND = 0; // time to stop on the ground
export const ACCEL_TIME_AIR = 0.75; // time to get to max speed in air
export const DECEL_TIME_AIR = 0.25; // time to stop in air

export const JUMP_SPEED = 7; // max jump vertical velocity 
export const JUMP_HEIGHT = 1.9; // max jump vertical height
export const JUMP_SPEED_SPRINT = 11; // max jump vertical velocity 
export const JUMP_HEIGHT_SPRINT = 2.95; // max jump vertical height while sprinting
export const JUMP_DECEL_TIME = 0.125; // time to lose all vertical velocity after releasing jump
export const JUMP_COYOTE_TIME = 0.125; // time after leaving ground while can still jump

export const TURN_MAX_DEGREES_SEC = 360; // max degrees to turn (set to inf for TURN_FULL_TIME to apply)
export const TURN_FULL_TIME = 0.1; // time to turn fully towards target

export const GROUNDED_HEIGHT = 0.05; // distance from surface at which player is considered "grounded"
export const GROUNDED_ANGLE = 47.5; // angle (0-90) from flat at which ground is considered ground (can jump / won't slide)
export const MAX_STEP_HEIGHT = 0.40; // highest step player can walk up (player may still walk up slightly higher steps if approached at an angle)
export const GROUND_SNAP_HEIGHT = 0.1 // height below which we snap to ground (if previously grounded)

// don't edit

export const PLAYER_COLLIDER_RADIUS = 0.3;
export const VEC3_ZERO = Vector3.Zero();
export const VEC3_UP = Vector3.Up();
export const VEC3_INF = Vector3.fromArray([Infinity, Infinity, Infinity]);
export const VEC3_NEG_INF = Vector3.fromArray([-Infinity, -Infinity, -Infinity]);
export const VEC3_HORIZONTAL_MASK = Vector3.create(1, 0, 1);