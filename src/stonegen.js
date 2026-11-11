// Procedural Maya masonry.
//
// Maya ballcourts are faced with large dressed limestone blocks laid in
// irregular courses, then skinned in lime stucco that has long since flaked.
// The photographic brick the court used to borrow read as a modern wall at the
// wrong scale. This bakes albedo, bump and roughness maps from one seeded
// layout at load time — no download, no licence question, and the blocks are
// sized for the court (one tile ≈ 3.2 m, blocks 0.4–0.85 m long).
import * as THREE from 'three';

function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Tileable value noise on a grid, sampled with wrap-around. */
function noiseField(size, cells, random) {
  const grid = Array.from({ length: cells * cells }, random);
  const at = (x, y) => grid[((y % cells + cells) % cells) * cells + ((x % cells + cells) % cells)];
  return (px, py) => {
    const fx = px / size * cells, fy = py / size * cells;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const sx = fx - x0, sy = fy - y0;
    const u = sx * sx * (3 - 2 * sx), v = sy * sy * (3 - 2 * sy);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/** Courses of blocks across a square tile; rows and the seam wrap cleanly. */
function layout(size, random) {
  const blocks = [];
  let y = 0;
  const rows = [];
  while (y < size) {
    let h = Math.round(size * (.075 + random() * .055));
    if (size - y - h < size * .06) h = size - y;          // last row absorbs the remainder
    rows.push([y, h]); y += h;
  }
  for (const [ry, rh] of rows) {
    let x = -Math.round(random() * size * .2);
    const start = x;
    while (x < start + size) {
      let w = Math.round(size * (.13 + random() * .14));
      if (start + size - (x + w) < size * .07) w = start + size - x;
      blocks.push({ x, y: ry, w, h: rh, tone: random(), chip: random() });
      x += w;
    }
  }
  return blocks;
}

export function generateStoneMaps(size = 1024, seed = 7) {
  const random = rng(seed);
  const blocks = layout(size, random);
  const grain = noiseField(size, 64, random);
  const blotch = noiseField(size, 8, random);
  const stucco = noiseField(size, 5, random);

  const albedo = new Uint8ClampedArray(size * size * 4);
  const bump = new Uint8ClampedArray(size * size * 4);
  const rough = new Uint8ClampedArray(size * size * 4);
  // Distance to the nearest joint for each pixel, from the block rectangles.
  const mortar = Math.max(2, Math.round(size / 340));
  const edge = new Float32Array(size * size).fill(99);
  const tone = new Float32Array(size * size);
  for (const b of blocks) {
    for (let py = b.y; py < b.y + b.h; py++) {
      for (let i = 0; i < b.w; i++) {
        const px = ((b.x + i) % size + size) % size;
        const d = Math.min(i, b.w - 1 - i, py - b.y, b.y + b.h - 1 - py);
        const k = py * size + px;
        edge[k] = d; tone[k] = b.tone;
      }
    }
  }

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const k = py * size + px, o = k * 4;
      const g = grain(px, py), bl = blotch(px, py), st = stucco(px, py);
      const d = edge[k];
      const joint = d < mortar;
      // Bevel: block faces fall away over a few pixels toward the joints, with
      // ragged, chipped arrises.
      const bevel = Math.min(1, (d - mortar + g * 3) / (mortar * 3));
      let r, gg, bb, h;
      if (joint) {
        r = 74; gg = 62; bb = 48; h = 30 + g * 20;
      } else {
        // Limestone with per-block tone, mottling and grime that pools low.
        const t = .86 + tone[k] * .2 + (bl - .5) * .16 + (g - .5) * .12;
        r = 201 * t; gg = 181 * t; bb = 145 * t;
        // Remnant stucco skin: paler, smoother patches.
        if (st > .62) { const s = Math.min(1, (st - .62) * 6); r += (226 - r) * s * .7; gg += (211 - gg) * s * .7; bb += (176 - bb) * s * .7; }
        const shade = .72 + .28 * Math.max(0, bevel);
        r *= shade; gg *= shade; bb *= shade;
        h = 120 + bevel * 100 + (g - .5) * 40 + (st > .62 ? 14 : 0);
      }
      albedo[o] = r; albedo[o + 1] = gg; albedo[o + 2] = bb; albedo[o + 3] = 255;
      bump[o] = bump[o + 1] = bump[o + 2] = h; bump[o + 3] = 255;
      const ro = joint ? 250 : 205 + (g - .5) * 50 - (st > .62 ? 30 : 0);
      rough[o] = rough[o + 1] = rough[o + 2] = ro; rough[o + 3] = 255;
    }
  }

  const toTexture = (data, srgb) => {
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  };
  return { albedo: toTexture(albedo, true), bump: toTexture(bump, false), roughness: toTexture(rough, false) };
}
