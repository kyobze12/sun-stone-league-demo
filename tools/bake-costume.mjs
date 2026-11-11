// Bakes a jaguar-warrior skin for the player mesh.
//
// The model's UVs are hundreds of scattered auto-unwrap islands, so a costume
// can't be hand-painted in texture space. Instead every triangle is rasterised
// into UV space while its 3D position is interpolated, and the colour is chosen
// from where that point sits on the body — helm, collar, sash, loincloth — with
// a procedural jaguar rosette pattern driven by the same 3D position so the
// spots wrap the body correctly however the islands are cut up.
import fs from 'node:fs';
import { PNG } from 'pngjs';

// Run this against the ORIGINAL, unoptimised mesh. tools/optimize-character.mjs
// quantises positions to normalised shorts, which this baker cannot read body
// coordinates from. The pipeline order is: bake skins -> optimise mesh. The two
// outputs are independent, and simplification leaves the UV islands in place,
// so a texture baked from the source still fits the optimised mesh.
const SRC = process.argv[2] || new URL('../public/assets/characters/player.glb', import.meta.url).pathname;
const SIZE = 1024;

const b = fs.readFileSync(SRC);
const L = b.readUInt32LE(12);
const j = JSON.parse(b.slice(20, 20 + L).toString('utf8'));
const bin = b.slice(20 + L + 8);

function accessor(index) {
  const acc = j.accessors[index];
  const bv = j.bufferViews[acc.bufferView];
  const start = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
  const n = acc.count * comps;
  const C = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5122: Int16Array, 5121: Uint8Array, 5120: Int8Array }[acc.componentType];
  if (!C) throw new Error('unsupported componentType ' + acc.componentType);
  if (acc.normalized) throw new Error('this model is quantised — bake from the unoptimised source mesh instead');
  return { arr: new C(bin.buffer, bin.byteOffset + start, n), count: acc.count };
}

const prim = j.meshes[0].primitives[0];
const pos = accessor(prim.attributes.POSITION);
const uv = accessor(prim.attributes.TEXCOORD_0);
const joints = accessor(prim.attributes.JOINTS_0);
const weights = accessor(prim.attributes.WEIGHTS_0);
const idx = accessor(prim.indices);
const jointNames = j.skins[0].joints.map((n) => (j.nodes[n].name || '').replace(/^mixamorig:?/i, ''));

let minY = Infinity, maxY = -Infinity, maxR = 0;
for (let v = 0; v < pos.count; v += 1) {
  const y = pos.arr[v * 3 + 1];
  minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  maxR = Math.max(maxR, Math.hypot(pos.arr[v * 3], pos.arr[v * 3 + 2]));
}
const height = maxY - minY;

function regionOf(v) {
  let best = -1, bw = -1;
  for (let k = 0; k < 4; k += 1) {
    const w = weights.arr[v * 4 + k];
    if (w > bw) { bw = w; best = joints.arr[v * 4 + k]; }
  }
  const name = jointNames[best] || '';
  if (/Head|Neck/i.test(name)) return 'head';
  if (/Hand/i.test(name)) return 'hand';
  if (/ForeArm/i.test(name)) return 'forearm';
  if (/Arm|Shoulder/i.test(name)) return 'upperarm';
  if (/Foot|Toe/i.test(name)) return 'foot';
  if (/UpLeg/i.test(name)) return 'thigh';
  if (/Leg/i.test(name)) return 'shin';
  return 'torso';
}

// ------------------------------------------------------------------ palette
// Drawn from the Master Architect idol that crowns each temple: oxidised jade
// armour, aged gold, deep bronze skin, bone ornament. The two teams read as
// the same culture in different regalia rather than as two colour swaps.
const TEAMS = {
  balam: {   // jaguar: gold pelt over jade
    pelt: [198, 142, 58], peltDark: [44, 28, 16], skin: [134, 82, 48],
    cloth: [61, 122, 106], jade: [45, 110, 96], gold: [198, 158, 82],
    feather: [226, 176, 74], paint: [34, 22, 16], bone: [214, 199, 168],
  },
  kuk: {     // quetzal: jade plumage over gold
    pelt: [46, 128, 112], peltDark: [16, 46, 44], skin: [134, 82, 48],
    cloth: [150, 68, 52], jade: [196, 156, 80], gold: [214, 180, 104],
    feather: [52, 158, 136], paint: [120, 42, 44], bone: [214, 199, 168],
  },
};

const hash = (x, y, z) => {
  let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
};

// Cellular jaguar rosettes: distance to the nearest jittered cell centre.
function rosette(x, y, z, scale) {
  const cx = Math.floor(x * scale), cy = Math.floor(y * scale), cz = Math.floor(z * scale);
  let best = 9;
  for (let i = -1; i <= 1; i += 1) for (let k = -1; k <= 1; k += 1) for (let m = -1; m <= 1; m += 1) {
    const gx = cx + i, gy = cy + k, gz = cz + m;
    const ox = hash(gx, gy, gz), oy = hash(gy, gz, gx), oz = hash(gz, gx, gy);
    const dx = (gx + ox) - x * scale, dy = (gy + oy) - y * scale, dz = (gz + oz) - z * scale;
    best = Math.min(best, Math.hypot(dx, dy, dz));
  }
  return best;
}

function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function shade(c, f) { return [c[0] * f, c[1] * f, c[2] * f]; }

function peltColor(P, x, y, z) {
  const d = rosette(x, y, z, 11);
  const ring = d > .19 && d < .33;        // open rosette ring
  const core = d <= .1;
  if (ring || core) return mix(P.pelt, P.peltDark, core ? .78 : .62);
  return P.pelt;
}

/**
 * Colour of the costume at a point on the body.
 *
 * Driven purely by 3D position, never by which bone owns the triangle. Bone
 * ownership flips between neighbouring triangles near every joint, which
 * painted the fighters in scattered patches; position is continuous, so the
 * garment edges come out clean.
 *
 * The mesh is in bind pose — a T-pose — so the arms lie along X at shoulder
 * height and only the head, torso and legs can be placed by height.
 */
const SHOULDER = .78;   // h at the shoulder line
const HIP = .52;        // h at the waist
const ARM_IN = .17;     // |x| where the arm leaves the torso

function costume(P, x, y, z) {
  const h = (y - minY) / height;
  const ax = Math.abs(x);
  const grain = .985 + hash(Math.round(x * 90), Math.round(y * 90), Math.round(z * 90)) * .03;

  // ---- arms (T-pose: out along X at shoulder height)
  if (ax > ARM_IN && h > HIP + .14) {
    const reach = (ax - ARM_IN) / (maxR - ARM_IN);   // 0 at the shoulder, 1 at the fingertips
    if (reach > .90) return shade(mix(P.cloth, P.peltDark, .4), grain);   // hand wrap
    if (reach > .84) return shade(P.gold, grain);                         // wrist cuff
    if (reach > .46) return shade(P.cloth, grain);                        // gauntlet
    if (reach > .34) return shade(P.jade, grain);                         // armband
    return shade(P.skin, grain);                                          // bare upper arm
  }
  // ---- head
  if (h > .885) {
    if (h > .975) return shade(P.feather, grain);                   // headdress crest
    if (h > .930) return shade(peltColor(P, x, y, z), grain);       // jaguar helm
    if (z > .012 && h > .898 && h < .928) return shade(P.paint, grain); // paint across the eyes (the model faces +z)
    return shade(P.skin, grain);
  }
  // ---- torso
  if (h > HIP) {
    if (h > SHOULDER + .035) return shade(P.jade, grain);           // jade collar
    if (h > SHOULDER) return shade(P.gold, grain);                  // collar rim
    if (h < HIP + .035) return shade(P.gold, grain);                // belt
    const sash = Math.abs(x * 1.9 + (h - .64) * 6.0) < .36;         // broad pelt sash
    if (sash) return shade(peltColor(P, x, y, z), grain);
    return shade(P.skin, grain);
  }
  // ---- legs
  if (h > .34) return shade(peltColor(P, x, y, z), grain);          // loincloth
  if (h < .055) return shade(mix(P.cloth, P.peltDark, .5), grain);  // sandal
  if (h < .105) return shade(P.bone, grain);                        // bone ankle wrap
  return shade(P.skin, grain);
}

// ------------------------------------------------------------------ bake
function bake(teamKey) {
  const P = TEAMS[teamKey];
  const png = new PNG({ width: SIZE, height: SIZE });
  png.data.fill(0);
  const filled = new Uint8Array(SIZE * SIZE);

  for (let t = 0; t < idx.count; t += 3) {
    const vi = [idx.arr[t], idx.arr[t + 1], idx.arr[t + 2]];
    const p = vi.map((v) => [pos.arr[v * 3], pos.arr[v * 3 + 1], pos.arr[v * 3 + 2]]);
    // glTF puts v=0 at the TOP of the image and the loader sets flipY=false,
    // so the row is v directly - flipping it here mirrored every island.
    const q = vi.map((v) => [uv.arr[v * 2] * (SIZE - 1), uv.arr[v * 2 + 1] * (SIZE - 1)]);
    const minX = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0])) - 1);
    const maxX = Math.min(SIZE - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0])) + 1);
    const minYp = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1])) - 1);
    const maxYp = Math.min(SIZE - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1])) + 1);
    const d = (q[1][1] - q[2][1]) * (q[0][0] - q[2][0]) + (q[2][0] - q[1][0]) * (q[0][1] - q[2][1]);
    if (Math.abs(d) < 1e-12) continue;
    for (let y = minYp; y <= maxYp; y += 1) for (let x = minX; x <= maxX; x += 1) {
      let l0 = ((q[1][1] - q[2][1]) * (x - q[2][0]) + (q[2][0] - q[1][0]) * (y - q[2][1])) / d;
      let l1 = ((q[2][1] - q[0][1]) * (x - q[2][0]) + (q[0][0] - q[2][0]) * (y - q[2][1])) / d;
      let l2 = 1 - l0 - l1;
      if (l0 < -.03 || l1 < -.03 || l2 < -.03) continue;
      l0 = Math.max(0, l0); l1 = Math.max(0, l1); l2 = Math.max(0, l2);
      const s = l0 + l1 + l2;
      const wx = (p[0][0] * l0 + p[1][0] * l1 + p[2][0] * l2) / s;
      const wy = (p[0][1] * l0 + p[1][1] * l1 + p[2][1] * l2) / s;
      const wz = (p[0][2] * l0 + p[1][2] * l1 + p[2][2] * l2) / s;
      const c = costume(P, wx, wy, wz);
      const o = (y * SIZE + x) * 4;
      png.data[o] = Math.max(0, Math.min(255, c[0]));
      png.data[o + 1] = Math.max(0, Math.min(255, c[1]));
      png.data[o + 2] = Math.max(0, Math.min(255, c[2]));
      png.data[o + 3] = 255;
      filled[y * SIZE + x] = 1;
    }
  }

  // Dilate into the gutters so bilinear sampling never pulls in empty pixels.
  for (let pass = 0; pass < 5; pass += 1) {
    const prev = filled.slice();
    for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
      if (prev[y * SIZE + x]) continue;
      let r = 0, g = 0, bl = 0, n = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE || !prev[ny * SIZE + nx]) continue;
        const o = (ny * SIZE + nx) * 4;
        r += png.data[o]; g += png.data[o + 1]; bl += png.data[o + 2]; n += 1;
      }
      if (!n) continue;
      const o = (y * SIZE + x) * 4;
      png.data[o] = r / n; png.data[o + 1] = g / n; png.data[o + 2] = bl / n; png.data[o + 3] = 255;
      filled[y * SIZE + x] = 1;
    }
  }

  const out = new URL(`./skin_${teamKey}.png`, import.meta.url).pathname;
  fs.writeFileSync(out, PNG.sync.write(png));
  console.log('baked', out);
}

console.log(`body height ${height.toFixed(2)}, radius ${maxR.toFixed(2)}`);
bake('balam');
bake('kuk');
