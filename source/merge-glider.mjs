// Merges the 8 separate Gliding_Prop*.glb (each = the same glider model + one
// animation) into a single Glider.glb (one model + all 8 clips), so the scene
// can switch open/idle/forward/turn/close via an Animator with no model reload.
// All prop glbs share an identical 17-node skeleton, so animation channels are
// retargeted to the base model's nodes by name. Run from project root:
//   node source/merge-glider.mjs
import { NodeIO } from '@gltf-transform/core';

const io = new NodeIO();
const dir = 'assets/animations';

const base = await io.read(`${dir}/Gliding_PropForward.glb`); // model + Glider_Forward
const root = base.getRoot();
const buffer = root.listBuffers()[0];
const nodesByName = new Map(root.listNodes().map((n) => [n.getName(), n]));

const sources = [
  'Gliding_PropIdle', 'Gliding_PropOpen', 'Gliding_PropClose',
  'Gliding_PropLeft', 'Gliding_PropRight', 'Gliding_PropStart', 'Gliding_PropEnd',
];

function clipDuration(anim) {
  let m = 0;
  for (const s of anim.listSamplers()) {
    const inp = s.getInput();
    if (inp) for (const t of inp.getArray()) m = Math.max(m, t);
  }
  return m;
}

for (const f of sources) {
  const srcDoc = await io.read(`${dir}/${f}.glb`);
  const srcAnim = srcDoc.getRoot().listAnimations()[0];
  if (!srcAnim) { console.log('no anim:', f); continue; }
  const anim = base.createAnimation(srcAnim.getName());
  for (const ch of srcAnim.listChannels()) {
    const tn = ch.getTargetNode();
    const baseNode = tn && nodesByName.get(tn.getName());
    if (!baseNode) continue;
    const s = ch.getSampler();
    const inAcc = base.createAccessor().setType(s.getInput().getType()).setArray(s.getInput().getArray().slice()).setBuffer(buffer);
    const outAcc = base.createAccessor().setType(s.getOutput().getType()).setArray(s.getOutput().getArray().slice()).setBuffer(buffer);
    const samp = base.createAnimationSampler().setInput(inAcc).setOutput(outAcc).setInterpolation(s.getInterpolation());
    const chan = base.createAnimationChannel().setTargetNode(baseNode).setTargetPath(ch.getTargetPath()).setSampler(samp);
    anim.addSampler(samp);
    anim.addChannel(chan);
  }
}

await io.write(`${dir}/Glider.glb`, base);
console.log('Glider.glb clips + durations:');
for (const a of root.listAnimations()) console.log('  ', a.getName().padEnd(16), clipDuration(a).toFixed(3) + 's');
