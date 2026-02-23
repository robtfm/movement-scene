import { ColliderLayer, engine, Entity, Material, MeshRenderer, RaycastQueryType, RaycastShape, raycastSystem, Transform, VisibilityComponent } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math';
import { playerPosition, printvec, tick, time } from '.';
import { GROUND_SNAP_HEIGHT, GROUNDED_ANGLE, GROUNDED_HEIGHT, PLAYER_COLLIDER_RADIUS, VEC3_NEG_INF, VEC3_UP, VEC3_ZERO } from './constants';

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
var groundHitTick = 0;

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
            maxDistance: PLAYER_COLLIDER_RADIUS + Math.max(GROUND_SNAP_HEIGHT, GROUNDED_HEIGHT),
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
                groundDistance = Math.max(hit.length - PLAYER_COLLIDER_RADIUS, 0);

                return groundTest;

            })) {
                groundHitTick = tick;
            }
        }
    )
}

function recordGroundState() {
    prevGrounded = grounded;
    grounded = (groundHitTick == tick) || (playerPosition.y < 0.01);
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