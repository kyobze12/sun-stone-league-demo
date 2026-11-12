// Shrinks the fighter mesh for mobile.
//
// The source model is 31k vertices / 50k triangles of unquantised float32 —
// 200k triangles once four fighters are on court, and a 1.9 MB download. On a
// phone that is both a rendering cost and, when the file has to be inlined as a
// data URI for a host that will not serve .glb, large enough for mobile Safari
// to give up on it entirely, which silently drops the game to its blocky
// procedural stand-ins.
//
//   node tools/optimize-character.mjs [in.glb] [out.glb] [ratio]
import { NodeIO } from '@gltf-transform/core';
import { KHRMeshQuantization } from '@gltf-transform/extensions';
import { simplify, weld, quantize, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const input = process.argv[2] || new URL('../public/assets/characters/player.glb', import.meta.url).pathname;
const output = process.argv[3] || input;
const ratio = Number(process.argv[4] || 0.3);

const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
const document = await io.read(input);
await MeshoptSimplifier.ready;

const before = document.getRoot().listMeshes()
  .flatMap((m) => m.listPrimitives())
  .reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0);

await document.transform(
  dedup(),
  weld(),
  // `error` is generous because the silhouette matters far more than surface
  // detail at the size a fighter occupies on screen.
  simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.004, lockBorder: true }),
  // No prune(): it drops the Skin, which would strip the rig and leave an
  // unanimatable statue.
  quantize({ pattern: /.*/, quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeWeight: 8 }),
);

const after = document.getRoot().listMeshes()
  .flatMap((m) => m.listPrimitives())
  .reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0);

await io.write(output, document);
console.log(`triangles ${before} -> ${after}`);
console.log('wrote', output);
