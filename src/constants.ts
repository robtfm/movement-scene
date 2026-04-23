import { Vector3 } from "@dcl/sdk/math";

export const GRAVITY = Vector3.scale(Vector3.Down(), 10.0);

export const WALK_SPEED = 2.5; // max walk speed
export const JOG_SPEED = 8.18; // max run speed
export const SPRINT_SPEED = 11; // max sprint speed
// Horizontal damping time constants (e-folding). All horizontal velocity
// (player input + impulses) decays toward zero with these time constants;
// input-axis acceleration counteracts the decay to maintain target speed.
// Grounded value is small for snappy stop on input release.
export const HORIZONTAL_DAMP_TIME_GROUND = 0.75;
export const HORIZONTAL_DAMP_TIME_AIR = 0.75;
// Constant horizontal deceleration — independent of current speed, so it
// dominates at walk speeds (snappy stop) and is relatively small for
// impulses (preserves push distance). Air value is usually small/zero so
// horizontal impulses can carry through air freely.
export const HORIZONTAL_STOP_DECEL_GROUND = 30;
export const HORIZONTAL_STOP_DECEL_AIR = 0;
// Constant upward-Y deceleration — stacks on top of gravity for upward
// motion only, giving impulses a more predictable (shorter) apex without
// affecting falling. Held jumps are unaffected (jump overrides velocity.y).
export const VERTICAL_STOP_DECEL = 5;
// Time to reach target horizontal speed from rest (input acceleration).
// Independent of damp τ so accel feel doesn't change when tuning impulse decay.
export const HORIZONTAL_ACCEL_TIME_GROUND = 0.25;
export const HORIZONTAL_ACCEL_TIME_AIR = 0.75;

// Hard cap on total velocity magnitude — applied after external velocity is
// added each frame, so runaway accumulation from repeated external impulses
// can't produce absurd speeds.
export const MAX_SPEED = 30;

export const JUMP_SPEED = 7; // max jump vertical velocity
export const JUMP_HEIGHT = 1.9; // max jump vertical height
export const JUMP_SPEED_SPRINT = 11; // max jump vertical velocity 
export const JUMP_HEIGHT_SPRINT = 2.95; // max jump vertical height while sprinting
export const JUMP_DECEL_TIME = 0.125; // time to lose all vertical velocity after releasing jump
export const JUMP_COYOTE_TIME = 0.125; // time after leaving ground while can still jump
export const DOUBLE_JUMP_HEIGHT = 3.15; // rise of the in-air jump from its launch point, independent of the base jump height
export const DOUBLE_JUMP_SPEED = 12; // initial vertical velocity cap for the in-air jump; higher than JUMP_SPEED to shorten ascent time
export const DOUBLE_JUMP_HANG_TIME = 0.1; // duration of the zero-vertical-velocity pause before the double jump launches
export const GLIDE_FALL_SPEED = 0.75; // downward speed target while gliding (m/s)
export const GLIDE_HORIZONTAL_SPEED = 6; // horizontal speed clamp while gliding (m/s)
export const GLIDE_DAMP_TIME = 0.1; // time constant for vertical velocity to converge toward -GLIDE_FALL_SPEED
export const GLIDE_TILT_DAMP_TIME = 0.3; // time constant for the glide tilt (animation playback time) to drift toward its target
export const GLIDE_TILT_FULL_ANGLE = 20; // orientation delta (degrees) at which the glide tilt reaches its full-left/full-right pose

export const TURN_MAX_DEGREES_SEC = 360; // max degrees to turn (set to inf for TURN_FULL_TIME to apply)
export const TURN_FULL_TIME = 0.1; // time to turn fully towards target

export const GROUNDED_HEIGHT = 0.05; // distance from surface at which player is considered "grounded"
export const GROUNDED_ANGLE = 47.5; // angle (0-90) from flat at which ground is considered ground (can jump / won't slide)
export const MAX_STEP_HEIGHT = 0.30; // highest step player can walk up (player may still walk up slightly higher steps if approached at an angle)
export const GROUND_SNAP_HEIGHT = 0.40 // height below which we snap to ground (if previously grounded)


// don't edit

export const PLAYER_COLLIDER_RADIUS = 0.3;
export const VEC3_ZERO = Vector3.Zero();
export const VEC3_UP = Vector3.Up();
export const VEC3_INF = Vector3.fromArray([Infinity, Infinity, Infinity]);
export const VEC3_NEG_INF = Vector3.fromArray([-Infinity, -Infinity, -Infinity]);
export const VEC3_HORIZONTAL_MASK = Vector3.create(1, 0, 1);