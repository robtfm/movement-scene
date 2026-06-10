# Movement scene — animation overhaul

> Status: **work in progress.** The movement/animation feel is dramatically
> closer to the Unity client, but several items still need polish/tuning (see
> [Known limitations](#known-limitations--todo)).

This branch reworks the portable movement scene's avatar **animation** system to
match the Decentraland **Unity client**, where the original was lacking — locomotion
phasing, per-gait jumps, landing, and gliding. Movement *physics* is largely
unchanged; this is about what the avatar (and remote avatars) actually *play*.

## Highlights

- **3-tier locomotion** — real `Walk` / `Jog` / `Run` clips selected by speed
  (previously walk + run only, so jog and sprint looked identical).
- **Phased jump state machine** — `Start → Rise → Mid → Fall → End` per take-off
  gait (idle / jog / run jumps), replacing the single-clip jump that caused the
  awkward forward-lean. Adds `Hard_Landing` (big drops) and `Long_Fall_Loop`.
- **Per-gait double jumps** — `Double_Jump_Base / Jog / Run`.
- **Jog stop** — plays `Jog_Stop` when decelerating to a halt.
- **Gliding** — directional avatar poses (forward / lean-back idle / bank
  left-right by turn rate) **plus a rendered glider prop** that deploys (opens)
  and stows (closes), attached to the avatar. Glide now faces its direction of
  travel (banks/curves) instead of snapping to face input.
- **In-scene live-tuning panel** (toggle top-right) for dialing feel without a
  rebuild — speeds, blend times, jump drop thresholds, glide tuning.
- **20×20 parcel scene** (was 1×1) for testing long-distance movement.

## New animation assets — `assets/animations/`

Mesh-free, single-clip glbs on the DCL `Avatar_*` rig (skeleton + animation only;
the embedded character meshes from the source exports were stripped — see
[Asset tooling](#asset-tooling)). Provided by the Regenesis Labs team from a
Blender source file.

- Locomotion: `Idle`, `Walk`, `Jog`, `Run`, `Jog_Stop`, `Slide`*
- Base jump (= standing/idle jump): `Jump_Start/Rise_Loop/Mid/Fall_Loop/End`,
  `Long_Fall_Loop`, `Hard_Landing`
- Jog/Run jumps: `Jog_Jump_*`, `Run_Jump_*`
- Double jumps: `DoubleJump_Base2/Jog2/Run2` (+ `_Right`*)
- Glide avatar poses: `Gliding_Avatar{Forward,Idle,Left,Right}` (+ `Start/End`*)
- Glider prop: `Glider.glb` — the 8 `Gliding_Prop*` exports merged into one model
  with all clips (Open/Close/Forward/Idle/Turn*) so it can be animated without
  reloading.
- AFK*: `AFK_Start/Loop/Action/End`

`*` = present but not yet wired (staged for upcoming polish).

## Code changes — `src/`

| File | Change |
|------|--------|
| `index.ts` | Animation selection rewritten: 3-tier locomotion, phased-jump state machine (`jumpPhaseAnimation` / `landingAnimation`), per-gait double jumps, directional glide poses, Jog_Stop, glide turn-rate tracking. Debug HUD + clip maps. |
| `glider.ts` *(new)* | Glider prop entity — parented to the player, deploy/glide/stow Animator state machine driven by glide state. |
| `settings.ts` *(new)* | Runtime-mutable tuning values + metadata that drives the panel. |
| `ui.tsx` *(new)* | The in-scene live-tuning panel (`@dcl/sdk/react-ecs`). |
| `horizontal.ts` | While gliding, face the direction of travel (momentum) instead of raw input, so the glider banks/curves and back-press leans rather than spins 180°. |
| `parameters.ts` | Speeds/jump-heights can come from the tuner (`forceLocalSpeeds`). |
| `scene.json` | Expanded to a 20×20 parcel grid. |

Removed the now-unused original clips from `assets/` root (replaced by the
`assets/animations/` set).

## Live-tuning panel

Click **TUNE** (top-right) to open. Per-row `−`/`+` steppers and a type-in field;
**RESET DEFAULTS** for A/B comparison; **LOG VALUES** dumps current numbers to the
browser console. Slimmed to the actively-tuned knobs: **SPEEDS**, **BLENDS**,
**JUMP** (drop thresholds), **GLIDE** (lean rate, forward-pose speed, glider
deploy speed). Other tuned values live in `settings.ts` and can be re-exposed on
request. The panel is debug tooling — strip it for a production build if desired.

## Asset tooling — `source/`

One-time Node scripts (require `npm i -D @gltf-transform/core @gltf-transform/functions`):

- `strip-meshes.mjs` — strips the embedded character mesh from animation glbs,
  leaving skeleton + animation (the exports rendered a stray mesh otherwise;
  19.6 MB → 4.5 MB).
- `merge-glider.mjs` — merges the 8 `Gliding_Prop*` glbs into one `Glider.glb`
  (one model, all clips) by retargeting animation channels to the shared
  skeleton by node name.

The Blender source (`*.blend`) is git-ignored (too large for git — use LFS or
external storage).

## How to test

Run `npm i` then `npm start`, and open the served scene as a portable in the Bevy
web client, e.g.:

```
https://decentraland.zone/bevy-web/?portables=http%3A%2F%2Flocalhost%3A8000
```

Then exercise: walk / jog / sprint, jump from each gait, big-drop landings, double
jumps, and gliding (bank left/right, push back to lean, deploy/stow).

## Known limitations / TODO

- Glide: sync the glider prop's own turn/idle clips to the avatar lean; wire the
  `Gliding_Start/End` avatar transition poses.
- Wire the staged-but-unused clips: `AFK_*`, `Slide`, `DoubleJump_*_Right`.
- Recalibrate footstep sound trigger timings for the new clips.
- Glide steering still rotates somewhat snappily (turn speed 200°/s) — may want
  softening for a more Unity-like bank.
- Production: strip the debug tuning panel; consider Git LFS for the `.blend`.
