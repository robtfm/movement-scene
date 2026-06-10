// Renders the glider prop attached to the player while gliding. The 8 separate
// Gliding_Prop*.glb were merged into one Glider.glb (all clips, one model) by
// source/merge-glider.mjs, so we switch Open/Forward/Close on a single loaded
// model via the Animator — no GltfContainer reload. The Animator is created ONCE
// with every state; switching just toggles which state is playing (replacing the
// whole Animator each switch corrupted the skeleton on replay).
import { Animator, engine, Entity, GltfContainer, Transform, VisibilityComponent } from '@dcl/sdk/ecs';
import { isGliding } from './vertical';
import { settings } from './settings';

const GLIDER_SRC = 'assets/animations/Glider.glb';
const CLIP_OPEN = 'Glider_Open';
const CLIP_FORWARD = 'Glider_Forward';
const CLIP_CLOSE = 'Glider_Close';
const OPEN_DURATION = 0.5;
const CLOSE_DURATION = 0.5;

type GliderState = 'hidden' | 'opening' | 'gliding' | 'closing';

let glider: Entity | undefined = undefined;
let state: GliderState = 'hidden';
let timer = 0;
let currentClip = '';

function setVisible(v: boolean) {
  if (glider !== undefined) VisibilityComponent.getMutable(glider).visible = v;
}

// Toggle which pre-defined state plays; restart the newly-selected clip from
// frame 0 via shouldReset. No-op if already on that clip.
function playClip(clip: string, loop: boolean, speed: number) {
  if (glider === undefined || currentClip === clip) return;
  currentClip = clip;
  const anim = Animator.getMutable(glider);
  for (const st of anim.states) {
    const on = st.clip === clip;
    st.playing = on;
    st.loop = on ? loop : st.loop;
    st.speed = on ? speed : st.speed;
    st.shouldReset = on;
  }
}

export function initGlider() {
  glider = engine.addEntity();
  Transform.create(glider, { parent: engine.PlayerEntity });
  GltfContainer.create(glider, {
    src: GLIDER_SRC,
    visibleMeshesCollisionMask: 0,
    invisibleMeshesCollisionMask: 0,
  });
  // Define every state once; none playing initially.
  Animator.create(glider, {
    states: [
      { clip: CLIP_OPEN, playing: false, loop: false, shouldReset: true },
      { clip: CLIP_FORWARD, playing: false, loop: true },
      { clip: CLIP_CLOSE, playing: false, loop: false, shouldReset: true },
    ],
  });
  VisibilityComponent.create(glider, { visible: false });

  engine.addSystem(updateGlider);
}

function updateGlider(dt: number) {
  if (glider === undefined) return;
  const deploy = Math.max(0.1, settings.gliderOpenSpeed); // clip speed multiplier
  switch (state) {
    case 'hidden':
      if (isGliding) { setVisible(true); playClip(CLIP_OPEN, false, deploy); timer = 0; state = 'opening'; }
      break;
    case 'opening':
      timer += dt;
      if (!isGliding) { playClip(CLIP_CLOSE, false, deploy); timer = 0; state = 'closing'; }
      else if (timer >= OPEN_DURATION / deploy) { playClip(CLIP_FORWARD, true, 1); state = 'gliding'; }
      break;
    case 'gliding':
      if (!isGliding) { playClip(CLIP_CLOSE, false, deploy); timer = 0; state = 'closing'; }
      break;
    case 'closing':
      timer += dt;
      if (isGliding) { playClip(CLIP_OPEN, false, deploy); timer = 0; state = 'opening'; }
      else if (timer >= CLOSE_DURATION / deploy) { setVisible(false); state = 'hidden'; }
      break;
  }
}
