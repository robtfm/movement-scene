// Strips mesh/skin/material data from the avatar animation glbs, keeping only
// the armature (bone nodes) + animation tracks — the form DCL expects for
// movement/emote animation clips. Run from the project root:
//   node source/strip-meshes.mjs
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup } from '@gltf-transform/functions';
import { readdirSync, statSync, mkdirSync } from 'fs';

const io = new NodeIO();
const inDir = 'assets/animations';
const outDir = 'assets/animations/_stripped';
mkdirSync(outDir, { recursive: true });

const files = readdirSync(inDir).filter((f) => f.endsWith('.glb'));
let totalBefore = 0, totalAfter = 0;

for (const f of files) {
  const inPath = `${inDir}/${f}`;
  const doc = await io.read(inPath);
  const root = doc.getRoot();

  // Detach mesh+skin from every node, then dispose the mesh/skin datablocks.
  for (const n of root.listNodes()) { n.setMesh(null); n.setSkin(null); }
  for (const m of root.listMeshes()) m.dispose();
  for (const s of root.listSkins()) s.dispose();

  // Drop now-orphaned materials/textures/accessors; keepLeaves preserves the
  // full bone hierarchy (incl. unanimated bones) so retargeting stays intact.
  await doc.transform(prune({ keepLeaves: true }), dedup());

  const outPath = `${outDir}/${f}`;
  await io.write(outPath, doc);

  const before = statSync(inPath).size, after = statSync(outPath).size;
  totalBefore += before; totalAfter += after;
  const r = root.listAnimations().map((a) => a.getName());
  console.log(
    f.padEnd(24),
    `${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB`.padEnd(20),
    `anims=${JSON.stringify(r)} meshes=${root.listMeshes().length} nodes=${root.listNodes().length}`
  );
}
console.log(`\nTOTAL: ${(totalBefore / 1048576).toFixed(1)}MB -> ${(totalAfter / 1048576).toFixed(2)}MB`);
