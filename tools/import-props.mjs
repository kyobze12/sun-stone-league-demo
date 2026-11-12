// Packs the KayKit (CC0) props the court uses into one file:
// public/assets/props/kaykit-props.glb. Each prop becomes a top-level node
// named after its source file, so the game can clone them by name.
//   node tools/import-props.mjs <dir with d/*.glb and h/*.gltf>
import path from 'node:path';
import fs from 'node:fs';
import { NodeIO, Document } from '@gltf-transform/core';
import { mergeDocuments, unpartition, dedup, prune } from '@gltf-transform/functions';

const SRC = process.argv[2] || '/tmp/claude-0/props';
const OUTNAME = process.argv[3] || 'kaykit-props.glb';
const dDir = path.join(SRC, 'd');
const files = [...(fs.existsSync(dDir) ? fs.readdirSync(dDir).map((f) => path.join(dDir, f)) : []), ...fs.readdirSync(path.join(SRC, 'h')).filter((f) => f.endsWith('.gltf')).map((f) => path.join(SRC, 'h', f))];
const io = new NodeIO();
const target = new Document();
const scene = target.createScene('props');
for (const file of files) {
  const name = path.basename(file).replace(/(\.gltf)?\.glb$|\.gltf$/, '');
  const source = await io.read(file);
  for (const anim of source.getRoot().listAnimations()) anim.dispose();
  const map = mergeDocuments(target, source);
  const group = target.createNode(name);
  for (const s of source.getRoot().listScenes()) for (const child of s.listChildren()) group.addChild(map.get(child));
  scene.addChild(group);
}
for (const s of target.getRoot().listScenes()) if (s !== scene) s.dispose();
await target.transform(unpartition(), dedup(), prune({ propertyTypes: ['Accessor', 'Mesh', 'Material', 'Texture', 'Node'] }));
const out = new URL(`../public/assets/props/${OUTNAME}`, import.meta.url).pathname;
await io.write(out, target);
console.log('wrote', out, (fs.statSync(out).size / 1024).toFixed(0) + ' KB', scene.listChildren().map((n) => n.getName()).join(', '));
