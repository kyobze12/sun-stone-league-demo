// Produces a small GLB containing ONLY the animation clips and the skeleton
// node hierarchy they target. The source Soldier model is 2.1 MB because of its
// mesh and textures, none of which we want — the clips retarget onto our own
// fighter because both use the standard Mixamo bone names.
import fs from 'node:fs';

const SRC = process.argv[2] || new URL('./Soldier.glb', import.meta.url).pathname;
const OUT = new URL('../public/assets/characters/locomotion.glb', import.meta.url).pathname;
const KEEP = ['Idle', 'Walk', 'Run'];

const b = fs.readFileSync(SRC);
const jsonLen = b.readUInt32LE(12);
const j = JSON.parse(b.slice(20, 20 + jsonLen).toString('utf8'));
const binOff = 20 + jsonLen + 8;
const bin = b.slice(binOff, binOff + b.readUInt32LE(20 + jsonLen));

const animations = j.animations.filter((a) => KEEP.includes(a.name));
if (animations.length !== KEEP.length) throw new Error('missing clips: ' + j.animations.map((a) => a.name));

// --- collect the accessors the kept clips reference
const usedAccessors = new Set();
for (const anim of animations) for (const s of anim.samplers) { usedAccessors.add(s.input); usedAccessors.add(s.output); }

// --- rebuild accessors/bufferViews over a fresh buffer
const accessorMap = new Map();
const newAccessors = [];
const newBufferViews = [];
const chunks = [];
let offset = 0;
for (const index of [...usedAccessors].sort((a, b) => a - b)) {
  const acc = j.accessors[index];
  const bv = j.bufferViews[acc.bufferView];
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
  const bytes = { 5126: 4, 5123: 2, 5125: 4, 5121: 1 }[acc.componentType];
  const stride = bv.byteStride || comps * bytes;
  const start = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  // Copy tightly packed, dropping any interleaving.
  const out = Buffer.alloc(acc.count * comps * bytes);
  for (let i = 0; i < acc.count; i += 1) bin.copy(out, i * comps * bytes, start + i * stride, start + i * stride + comps * bytes);
  while (offset % 4 !== 0) { chunks.push(Buffer.alloc(1)); offset += 1; }
  newBufferViews.push({ buffer: 0, byteOffset: offset, byteLength: out.length });
  chunks.push(out); offset += out.length;
  accessorMap.set(index, newAccessors.length);
  newAccessors.push({
    bufferView: newBufferViews.length - 1, componentType: acc.componentType,
    count: acc.count, type: acc.type, ...(acc.min ? { min: acc.min } : {}), ...(acc.max ? { max: acc.max } : {}),
  });
}

// --- keep every node (cheap, and animation channels target them by index), but
//     strip mesh/skin/camera references so nothing heavy is pulled in.
const nodes = j.nodes.map((n) => {
  const out = { ...n };
  delete out.mesh; delete out.skin; delete out.camera;
  return out;
});

const gltf = {
  asset: { version: '2.0', generator: 'sun-stone-league strip-anims' },
  scene: 0,
  scenes: j.scenes.map((s) => ({ nodes: s.nodes })),
  nodes,
  accessors: newAccessors,
  bufferViews: newBufferViews,
  buffers: [{ byteLength: offset }],
  animations: animations.map((a) => ({
    name: a.name,
    samplers: a.samplers.map((s) => ({ input: accessorMap.get(s.input), output: accessorMap.get(s.output), interpolation: s.interpolation || 'LINEAR' })),
    channels: a.channels.map((c) => ({ sampler: c.sampler, target: { node: c.target.node, path: c.target.path } })),
  })),
};

// --- assemble the GLB container
const jsonBuf = Buffer.from(JSON.stringify(gltf), 'utf8');
const jsonPad = Buffer.concat([jsonBuf, Buffer.alloc((4 - jsonBuf.length % 4) % 4, 0x20)]);
const binBuf = Buffer.concat(chunks);
const binPad = Buffer.concat([binBuf, Buffer.alloc((4 - binBuf.length % 4) % 4, 0)]);
const header = Buffer.alloc(12);
header.write('glTF', 0, 'ascii');
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonPad.length + 8 + binPad.length, 8);
const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(jsonPad.length, 0); jsonHeader.write('JSON', 4, 'ascii');
const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binPad.length, 0); binHeader.write('BIN\0', 4, 'ascii');
fs.writeFileSync(OUT, Buffer.concat([header, jsonHeader, jsonPad, binHeader, binPad]));
console.log('wrote', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + 'KB');
console.log('clips:', gltf.animations.map((a) => `${a.name} (${a.channels.length} channels)`).join(', '));
