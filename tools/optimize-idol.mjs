// Prepares the Master Architect bust for use as a background monument.
//
// As downloaded it is 32 MB: three 4096x4096 PNG textures on a prop that is
// never closer than the far end of the court. It is also authored with
// KHR_materials_unlit, so it ignores scene lighting entirely and would look
// pasted on rather than standing in the sunset.
//
//   node tools/optimize-idol.mjs <in.glb> <out.glb>
import { NodeIO } from '@gltf-transform/core';
import { KHRMeshQuantization, KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { simplify, weld, quantize, textureCompress, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) { console.error('usage: optimize-idol.mjs <in.glb> <out.glb>'); process.exit(1); }

const io = new NodeIO().registerExtensions([KHRMeshQuantization, KHRMaterialsUnlit]);
const document = await io.read(input);
await MeshoptSimplifier.ready;

// Drop the unlit extension so the monument takes the court's sunset light.
const unlit = document.getRoot().listExtensionsUsed().find((e) => e.extensionName === 'KHR_materials_unlit');
if (unlit) unlit.dispose();
for (const material of document.getRoot().listMaterials()) {
  material.setRoughnessFactor(0.72);
  material.setMetallicFactor(0.08);
}

await document.transform(
  dedup(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.55, error: 0.006, lockBorder: true }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 85 }),
  quantize({ pattern: /.*/, quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeWeight: 8 }),
);

await io.write(output, document);
const { statSync } = await import('node:fs');
console.log(`wrote ${output} (${(statSync(output).size / 1048576).toFixed(2)}MB)`);
