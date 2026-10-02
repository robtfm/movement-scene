import { ColliderLayer, engine, Entity, Material, MeshRenderer, RaycastQueryType, RaycastShape, raycastSystem, Transform, VisibilityComponent } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math';
import { playerPosition, prevActualVelocity, prevExternalVelocity, prevPlayerPosition, printvec, tick, time } from '.';
import { GROUND_PROBE_COUNT, GROUND_PROBE_INTERVAL, GROUND_SNAP_HEIGHT, GROUNDED_ANGLE, GROUNDED_HEIGHT, MAX_STEP_HEIGHT, MAX_UNREQUESTED_LIFT, PLAYER_COLLIDER_RADIUS, VEC3_NEG_INF, VEC3_UP, VEC3_ZERO } from './constants';

// updated in raycast update
export var groundNormal = Vector3.Zero();
export var groundPosition = Vector3.Zero();
export var groundDistance = 0;
// updated in recordGroundPosition @ 100000 - 2
export var grounded = false;
export var prevGrounded = false;
export var lastGroundTime = -Infinity;

export const GROUNDED_ANGLE_Y_LEN = Math.cos(GROUNDED_ANGLE / 180 * Math.PI)

var groundCaster: Entity;
var groundRayCaster: Entity;
var groundHitTick = 0;
var groundRayHitTick = 0;

export function updateGroundAdjust(h: number) {
    Transform.getMutable(groundCaster).position.y += h;
}

export function initGroundRaycast() {
    engine.addSystem(recordGroundState, 100000 - 2);

    groundCaster = engine.addEntity();
    Transform.create(groundCaster, { parent: engine.PlayerEntity, position: { x: 0, y: PLAYER_COLLIDER_RADIUS, z: 0 } });

    raycastSystem.registerGlobalDirectionRaycast({
        entity: groundCaster,
        opts: {
            // reaches as far as the probes can vouch for, so a probe-approved snap has a distance to close
            maxDistance: PLAYER_COLLIDER_RADIUS + GROUND_SNAP_HEIGHT * (GROUND_PROBE_COUNT + 1),
            queryType: RaycastQueryType.RQT_HIT_FIRST,
            continuous: true,
            collisionMask: ColliderLayer.CL_PHYSICS,
            shape: RaycastShape.RS_AVATAR,
            includeWorld: true,
            direction: Vector3.Down()
        }
    },
        (hit) => {
            Vector3.copyFrom(VEC3_ZERO, groundNormal);
            Vector3.copyFrom(VEC3_NEG_INF, groundPosition);
            groundDistance = playerPosition.y;

            if (hit.hits.some((hit) => {
                Vector3.copyFrom(hit.normalHit ?? VEC3_ZERO, groundNormal);

                let groundTest = (hit.length < PLAYER_COLLIDER_RADIUS + GROUNDED_HEIGHT) && (hit.normalHit?.y ?? 0) >= GROUNDED_ANGLE_Y_LEN;
                Vector3.copyFrom(hit.position ?? VEC3_NEG_INF, groundPosition);
                groundDistance = Math.min(hit.length - PLAYER_COLLIDER_RADIUS, playerPosition.y);

                return groundTest;

            })) {
                groundHitTick = tick;
            }
        }
    )

    // Point-ray fallback for the grounded test: the capsule cast's first hit
    // can be a graze against the corner of the step behind (its normal comes
    // from the capsule surface, so a side contact reads near-horizontal and
    // unwalkable, masking the flat tread underfoot). A center ray reports the
    // true face normal below the player and can't graze.
    groundRayCaster = engine.addEntity();
    Transform.create(groundRayCaster, { parent: engine.PlayerEntity, position: { x: 0, y: PLAYER_COLLIDER_RADIUS, z: 0 } });

    raycastSystem.registerGlobalDirectionRaycast({
        entity: groundRayCaster,
        opts: {
            maxDistance: PLAYER_COLLIDER_RADIUS + GROUNDED_HEIGHT,
            queryType: RaycastQueryType.RQT_HIT_FIRST,
            continuous: true,
            collisionMask: ColliderLayer.CL_PHYSICS,
            shape: RaycastShape.RS_RAY,
            includeWorld: true,
            direction: Vector3.Down()
        }
    },
        (hit) => {
            if (hit.hits.some((hit) =>
                (hit.length < PLAYER_COLLIDER_RADIUS + GROUNDED_HEIGHT) && (hit.normalHit?.y ?? 0) >= GROUNDED_ANGLE_Y_LEN
            )) {
                groundRayHitTick = tick;
            }
        }
    )
}

function recordGroundState() {
    prevGrounded = grounded;
    grounded = ((groundHitTick == tick) || (groundRayHitTick == tick) || (playerPosition.y < 0.01));
    if (playerPosition.y < 0.01) {
        Vector3.copyFrom(VEC3_UP, groundNormal);
    }
    if (grounded) {
        lastGroundTime = time;
    } else {
        Vector3.copyFrom(VEC3_ZERO, groundNormal);
    }
}

export function setGrounded(g: boolean) {
    grounded = g;
}

// --- Sub-step ground probes (see GROUND_PROBE_COUNT) ---
// The casts start MAX_STEP_HEIGHT above feet level so rising ground at the probe point is
// measured rather than started inside.
const PROBE_START_HEIGHT = PLAYER_COLLIDER_RADIUS + MAX_STEP_HEIGHT;
// Long enough to reach the ground from an avatar that is itself riding above it mid-descent,
// plus the furthest drop the probe walk can approve.
const PROBE_RANGE = PROBE_START_HEIGHT + MAX_UNREQUESTED_LIFT + 2 * GROUND_SNAP_HEIGHT * (GROUND_PROBE_COUNT + 1);
type GroundProbe = { entity: Entity, hitTick: number, x: number, z: number, groundY: number };
var groundProbes: GroundProbe[] = [];
// ground height under the avatar at the end of the previous tick, if it was grounded
var prevGroundY = NaN;

export function initGroundProbes() {
    for (let i = 1; i <= GROUND_PROBE_COUNT; i++) {
        const probe: GroundProbe = { entity: engine.addEntity(), hitTick: 0, x: 0, z: 0, groundY: -Infinity };
        Transform.create(probe.entity, { position: Vector3.Zero() });
        raycastSystem.registerGlobalDirectionRaycast({
            entity: probe.entity,
            opts: {
                maxDistance: PROBE_RANGE,
                queryType: RaycastQueryType.RQT_HIT_FIRST,
                continuous: true,
                collisionMask: ColliderLayer.CL_PHYSICS,
                shape: RaycastShape.RS_AVATAR,
                includeWorld: true,
                direction: Vector3.Down()
            }
        },
            (result) => {
                const origin = result.globalOrigin;
                if (origin === undefined) return;
                probe.hitTick = tick;
                probe.x = origin.x;
                probe.z = origin.z;
                probe.groundY = -Infinity;
                for (const hit of result.hits) {
                    probe.groundY = origin.y - hit.length;
                }
            }
        )
        groundProbes.push(probe);
    }
}

// Place the probes along the velocity for the next tick to read, and note the ground height
// they start from.
export function updateGroundProbes(velocity: Vector3) {
    prevGroundY = grounded ? playerPosition.y - groundDistance : NaN;
    for (let i = 0; i < groundProbes.length; i++) {
        const t = (i + 1) * GROUND_PROBE_INTERVAL;
        const position = Transform.getMutable(groundProbes[i].entity).position;
        position.x = playerPosition.x + velocity.x * t;
        position.y = playerPosition.y + PROBE_START_HEIGHT;
        position.z = playerPosition.z + velocity.z * t;
    }
}

// True if no sub-step between the previous tick's position and this one dropped by more than
// GROUND_SNAP_HEIGHT: what a 60fps client would have snapped through one step at a time.
// The probes only vouch for the ground falling away, so the avatar itself must not have risen
// more than `maxRise` above where it stood (e.g. launched by an impulse).
export function probesAllowSnap(maxRise: number): boolean {
    if (Number.isNaN(prevGroundY)) return false;
    if (playerPosition.y - prevGroundY >= maxRise) return false;
    const travelled = Math.hypot(playerPosition.x - prevPlayerPosition.x, playerPosition.z - prevPlayerPosition.z);
    // the probes are placed in order of distance along the velocity
    let height = prevGroundY;
    let sampled = false;
    for (let i = 0; i < groundProbes.length; i++) {
        const probe = groundProbes[i];
        if (probe.hitTick !== tick) continue;
        if (Math.hypot(probe.x - prevPlayerPosition.x, probe.z - prevPlayerPosition.z) > travelled) continue;
        if (height - probe.groundY > GROUND_SNAP_HEIGHT) return false;
        height = probe.groundY;
        sampled = true;
    }
    return sampled && height - (playerPosition.y - groundDistance) <= GROUND_SNAP_HEIGHT;
}