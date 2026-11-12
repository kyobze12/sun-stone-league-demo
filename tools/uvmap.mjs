// Rasterise the character's UV islands, coloured by which bone drives each
// triangle. That tells us where the head, torso, arms and legs live in texture
// space so a costume can be painted onto the right regions.
import fs from 'node:fs';
import { PNG } from 'pngjs';

const SRC = new URL('../public/assets/characters/player.glb', import.meta.url).pathname;
const b = fs.readFileSync(SRC);
const L = b.readUInt32LE(12);
const j = JSON.parse(b.slice(20, 20 + L).toString('utf8'));
const binOff = 20 + L + 8;
const bin = b.slice(binOff);

function accessor(index) {
  const acc = j.accessors[index];
  const bv = j.bufferViews[acc.bufferView];
  const start = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
  const n = acc.count * comps;
  let arr;
  if (acc.componentType === 5126) arr = new Float32Array(bin.buffer, bin.byteOffset + start, n);
  else if (acc.componentType === 5123) arr = new Uint16Array(bin.buffer, bin.byteOffset + start, n);
  else if (acc.componentType === 5125) arr = new Uint32Array(bin.buffer, bin.byteOffset + start, n);
  else if (acc.componentType === 5121) arr = new Uint8Array(bin.buffer, bin.byteOffset + start, n);
  else throw new Error('componentType ' + acc.componentType);
  return { arr, comps, count: acc.count };
}

const prim = j.meshes[0].primitives[0];
const uv = accessor(prim.attributes.TEXCOORD_0);
const joints = accessor(prim.attributes.JOINTS_0);
const weights = accessor(prim.attributes.WEIGHTS_0);
const idx = accessor(prim.indices);

const jointNames = j.skins[0].joints.map((n) => (j.nodes[n].name || '').replace(/^mixamorig:?/i, ''));
console.log('joints:', jointNames.join(', '));

// Group bones into body regions.
function region(name) {
  if (/Head|Neck/i.test(name)) return 'head';
  if (/Hand/i.test(name)) return 'hand';
  if (/ForeArm|Arm|Shoulder/i.test(name)) return 'arm';
  if (/Foot|Toe/i.test(name)) return 'foot';
  if (/Leg|UpLeg/i.test(name)) return 'leg';
  if (/Spine|Hips/i.test(name)) return 'torso';
  return 'other';
}
const COLOR = {
  head: [255, 70, 70], arm: [70, 160, 255], hand: [160, 220, 255],
  torso: [255, 210, 60], leg: [80, 220, 120], foot: [40, 130, 70], other: [140, 140, 140],
};

const SIZE = 1024;
const png = new PNG({ width: SIZE, height: SIZE });
png.data.fill(0);

function dominantRegion(v) {
  let best = -1, bw = -1;
  for (let k = 0; k < 4; k += 1) {
    const w = weights.arr[v * 4 + k];
    if (w > bw) { bw = w; best = joints.arr[v * 4 + k]; }
  }
  return region(jointNames[best] || '');
}

function put(x, y, c) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const o = (y * SIZE + x) * 4;
  png.data[o] = c[0]; png.data[o + 1] = c[1]; png.data[o + 2] = c[2]; png.data[o + 3] = 255;
}

// Flat-fill each UV triangle with its region colour.
for (let t = 0; t < idx.count; t += 3) {
  const a = idx.arr[t], bI = idx.arr[t + 1], cI = idx.arr[t + 2];
  const c = COLOR[dominantRegion(a)] || COLOR.other;
  const pts = [a, bI, cI].map((v) => [uv.arr[v * 2] * (SIZE - 1), (1 - uv.arr[v * 2 + 1]) * (SIZE - 1)]);
  const minX = Math.floor(Math.min(...pts.map((p) => p[0]))), maxX = Math.ceil(Math.max(...pts.map((p) => p[0])));
  const minY = Math.floor(Math.min(...pts.map((p) => p[1]))), maxY = Math.ceil(Math.max(...pts.map((p) => p[1])));
  const [p0, p1, p2] = pts;
  const d = (p1[1] - p2[1]) * (p0[0] - p2[0]) + (p2[0] - p1[0]) * (p0[1] - p2[1]);
  if (Math.abs(d) < 1e-12) continue;
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
    const l0 = ((p1[1] - p2[1]) * (x - p2[0]) + (p2[0] - p1[0]) * (y - p2[1])) / d;
    const l1 = ((p2[1] - p0[1]) * (x - p2[0]) + (p0[0] - p2[0]) * (y - p2[1])) / d;
    const l2 = 1 - l0 - l1;
    if (l0 >= -.004 && l1 >= -.004 && l2 >= -.004) put(x, y, c);
  }
}

fs.writeFileSync(new URL('./uv_regions.png', import.meta.url).pathname, PNG.sync.write(png));

// Also report each region's UV bounding box, which is what the painter needs.
const boxes = {};
for (let v = 0; v < uv.count; v += 1) {
  const r = dominantRegion(v);
  const u = uv.arr[v * 2], vv = uv.arr[v * 2 + 1];
  const box = boxes[r] || (boxes[r] = [1, 1, 0, 0]);
  box[0] = Math.min(box[0], u); box[1] = Math.min(box[1], vv);
  box[2] = Math.max(box[2], u); box[3] = Math.max(box[3], vv);
}
for (const [r, bx] of Object.entries(boxes)) {
  console.log(`${r.padEnd(6)} u ${bx[0].toFixed(3)}-${bx[2].toFixed(3)}   v ${bx[1].toFixed(3)}-${bx[3].toFixed(3)}`);
}
