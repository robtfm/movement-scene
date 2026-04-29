import { DeepReadonlyObject, PBAvatarLocomotionSettings, PBInputModifier } from "@dcl/sdk/ecs";
import { JOG_SPEED, JUMP_HEIGHT, JUMP_HEIGHT_SPRINT, SPRINT_SPEED, WALK_SPEED } from "./constants";

export var sprintSpeed = 0;
export var jogSpeed = 0;
export var walkSpeed = 0;
export var jumpHeight = 0;
export var sprintJumpHeight = 0;
export var doubleJumpEnabled = false;
export var glideEnabled = false;
// Slots available between two grounded frames. applyJump() tracks usage in
// separate counters and falls through to a glide once the air slot is spent.
export var maxGroundJumps = 0; // 1 unless disableJump
export var maxAirJumps = 0;    // 1 unless disableDoubleJump
export var disableOrientation = false;

export function initParamters(
    locomotion: DeepReadonlyObject<PBAvatarLocomotionSettings> | undefined,
    modifiers: DeepReadonlyObject<PBInputModifier> | undefined
) {
    const baseSprintSpeed = locomotion?.runSpeed ?? SPRINT_SPEED;
    const baseJogSpeed = locomotion?.jogSpeed ?? JOG_SPEED;
    const baseWalkSpeed = locomotion?.walkSpeed ?? WALK_SPEED;

    const baseJumpHeight = locomotion?.jumpHeight ?? JUMP_HEIGHT;
    const baseSprintJumpHeight = locomotion?.runJumpHeight ?? JUMP_HEIGHT_SPRINT;

    const jogEnabled = !modifiers?.mode?.standard.disableJog && !modifiers?.mode?.standard.disableAll;
    const walkEnabled = !modifiers?.mode?.standard.disableWalk && !modifiers?.mode?.standard.disableAll;
    const runEnabled = !modifiers?.mode?.standard.disableRun && !modifiers?.mode?.standard.disableAll;
    const anyEnabled = jogEnabled || walkEnabled || runEnabled;

    const jumpEnabled = !modifiers?.mode?.standard.disableJump && !modifiers?.mode?.standard.disableAll;
    // Air-jump and glide are independent of the ground-jump gate so that, with
    // disableJump set, the player can still air-jump or glide after walking
    // off a cliff (the air-jump slot is replenished on every grounded frame).
    doubleJumpEnabled = !modifiers?.mode?.standard.disableDoubleJump && !modifiers?.mode?.standard.disableAll;
    glideEnabled = !modifiers?.mode?.standard.disableGliding && !modifiers?.mode?.standard.disableAll;

    jogSpeed = jogEnabled ? baseJogSpeed
        : walkEnabled ? baseWalkSpeed
        : runEnabled ? baseSprintSpeed
        : 0;

    walkSpeed = walkEnabled ? baseWalkSpeed : jogSpeed;
    sprintSpeed = runEnabled ? baseSprintSpeed : jogSpeed;

    jumpHeight = jumpEnabled ? baseJumpHeight : 0;
    sprintJumpHeight = jumpEnabled ? baseSprintJumpHeight : 0;

    maxGroundJumps = jumpEnabled ? 1 : 0;
    maxAirJumps = doubleJumpEnabled ? 1 : 0;

    disableOrientation = !anyEnabled;
}