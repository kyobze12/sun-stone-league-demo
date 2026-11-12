// Muflus, from the Curse of Mirra assets (LambdaClass, CC BY-SA 4.0).
// The FBX in that repo references textures on the artist's own disk; the
// textures are packed inside the .blend instead (a Git LFS file). This takes
// the FBX converted by FBX2glTF, attaches the five texture maps carved from the
// .blend (reduced to 1024 px), and writes public/assets/beasts/muflus.glb.
//   node tools/import-muflus.mjs <dir with Muflus.glb, base.png, emis.png, norm.png, mr.png>
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';

const SRC = process.argv[2] || '/tmp/claude-0/com-dl';
const io = new NodeIO();
const doc = await io.read(path.join(SRC, 'Muflus.glb'));
const read = (f) => fs.readFileSync(path.join(SRC, f));
const tex = (name, file) => doc.createTexture(name).setImage(read(file)).setMimeType('image/png');
const base = tex('base', 'base.png'), emis = tex('emissive', 'emis.png'), norm = tex('normal', 'norm.png'), mr = tex('metalRough', 'mr.png');
for (const m of doc.getRoot().listMaterials()) {
  m.setBaseColorTexture(base).setBaseColorFactor([1, 1, 1, 1])
    .setEmissiveTexture(emis).setEmissiveFactor([1, 1, 1])
    .setNormalTexture(norm)
    .setMetallicRoughnessTexture(mr).setMetallicFactor(1).setRoughnessFactor(1);
}
for (const t of doc.getRoot().listTextures()) if (![base, emis, norm, mr].includes(t)) t.dispose();
await doc.transform(dedup(), prune({ propertyTypes: ['Texture', 'Accessor', 'Material'] }), textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 82 }));
const out = new URL('../public/assets/beasts/muflus.glb', import.meta.url).pathname;
fs.mkdirSync(path.dirname(out), { recursive: true });
await io.write(out, doc);
console.log('wrote', out, (fs.statSync(out).size / 1024).toFixed(0) + ' KB');
