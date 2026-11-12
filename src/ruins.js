// The city around the court: broken colonnades, carved stelae, rubble, ceiba
// trees, a jungle skyline and distant pyramids in the haze.
//
// Everything is built in code from a handful of instanced meshes so the whole
// set adds about a dozen draw calls. All of it stays outside the play volume
// (|x| > 15 beside the court, behind the temples at the ends) — dressing the
// ball can pass through would read as a bug.
import * as THREE from 'three';
import { stoneMaterial } from './court.js';

function rng(seed) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

function stelaTexture(variant) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 384;
  const g = c.getContext('2d');
  g.fillStyle = '#b9a47f'; g.fillRect(0, 0, 128, 384);
  g.strokeStyle = 'rgba(60,40,24,.75)'; g.fillStyle = 'rgba(60,40,24,.55)'; g.lineWidth = 5;
  g.strokeRect(10, 10, 108, 364);
  // A glyph column: rounded cartouches with bar-and-dot numerals and simple
  // carved faces/motifs, different per stela.
  const random = rng(variant * 97 + 13);
  for (let row = 0; row < 5; row++) {
    const y = 22 + row * 70;
    g.beginPath(); if (g.roundRect) g.roundRect(20, y, 88, 60, 14); else g.rect(20, y, 88, 60); g.stroke();
    const n = 1 + Math.floor(random() * 12);
    const bars = Math.floor(n / 5), dots = n % 5;
    for (let b = 0; b < bars; b++) g.fillRect(32, y + 40 - b * 11, 64, 7);
    for (let d = 0; d < dots; d++) { g.beginPath(); g.arc(44 + d * 13, y + 16, 5, 0, Math.PI * 2); g.fill(); }
    if (random() > .5) { g.beginPath(); g.arc(64, y + 30, 9, 0, Math.PI * 2); g.stroke(); }
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Place `count` instances, letting `fill(i, dummy)` position each. */
function instanced(group, geometry, material, count, fill, { cast = false } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    dummy.position.set(0, 0, 0); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1);
    fill(i, dummy); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.castShadow = cast; mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

export function addRuins(scene, quality = 'medium') {
  const group = new THREE.Group();
  group.name = 'ruins';
  const random = rng(1234);
  const stone = stoneMaterial({ repeat: [.6, .6], color: 0xbfae8e, bumpScale: .05 });
  const near = quality !== 'low';

  // ---- colonnades: broken columns of stacked drums, and drums that fell
  const drum = new THREE.CylinderGeometry(.55, .58, .7, 10);
  const columns = [];
  for (const side of [-1, 1]) {
    for (let z = -20; z <= 20; z += 4) {
      const height = z === 12 || z === 16 ? 5 : 1 + Math.floor(random() * (Math.abs(z) < 6 ? 2 : 5));
      columns.push({ x: side * (17 + random() * .6), z: z + (random() - .5), height });
    }
  }
  const drums = [];
  for (const c of columns) {
    for (let k = 0; k < c.height; k++) drums.push({ x: c.x + (random() - .5) * .05, y: .35 + k * .7, z: c.z, ry: random() * 6, tilt: 0 });
    if (c.height > 1 && random() > .5) {  // the rest of it, lying where it fell
      const dir = random() * Math.PI * 2;
      for (let k = 0; k < 2; k++) drums.push({ x: c.x + Math.cos(dir) * (1.2 + k * .75), y: .55, z: c.z + Math.sin(dir) * (1.2 + k * .75), ry: dir, tilt: Math.PI / 2 });
    }
  }
  instanced(group, drum, stone, drums.length, (i, d) => {
    const t = drums[i]; d.position.set(t.x, t.y, t.z); d.rotation.set(t.tilt, t.ry, 0);
  }, { cast: near });
  // A lintel still spanning two of the taller columns on each side.
  const lintel = new THREE.BoxGeometry(1.1, .55, 5);
  instanced(group, lintel, stone, 2, (i, d) => { d.position.set((i ? 1 : -1) * 17.3, 3.75, 14); }, { cast: near });

  // ---- stelae with glyph columns facing the court
  const stelaGeometry = new THREE.BoxGeometry(1.1, 3.8, .55);
  const faces = [0, 1, 2, 3].map((v) => new THREE.MeshStandardMaterial({ map: stelaTexture(v), roughness: .92 }));
  const plainSide = stone;
  const spots = [[-16, -26], [16, -26], [-16, 26], [16, 26], [-19, -7], [19, 7], [-22.5, 3], [22.5, -3]];
  spots.forEach(([x, z], i) => {
    const mats = [plainSide, plainSide, plainSide, plainSide, faces[i % 4], faces[(i + 1) % 4]];
    const stela = new THREE.Mesh(stelaGeometry, mats);
    stela.position.set(x, 1.85, z);
    stela.rotation.y = Math.atan2(-x, -z) + (random() - .5) * .3;  // face the court centre
    if (i % 3 === 2) stela.rotation.z = (random() > .5 ? 1 : -1) * .14;  // leaning
    stela.castShadow = near; stela.receiveShadow = true;
    group.add(stela);
    const altar = new THREE.Mesh(new THREE.CylinderGeometry(.75, .8, .55, 12), stone);
    altar.position.set(x - Math.sin(stela.rotation.y) * 1.4, .28, z - Math.cos(stela.rotation.y) * 1.4);
    altar.receiveShadow = true; group.add(altar);
  });

  // ---- rubble at column bases and temple corners
  const rubbleSpots = [...columns.map((c) => [c.x, c.z]), [-11, -30], [11, -30], [-11, 30], [11, 30], [-14, -18], [14, 18]];
  instanced(group, new THREE.IcosahedronGeometry(.5, 0), stone, near ? 140 : 70, (i, d) => {
    const [cx, cz] = rubbleSpots[i % rubbleSpots.length];
    const r = .6 + random() * 1.6, a = random() * Math.PI * 2, s = .25 + random() * .6;
    d.position.set(cx + Math.cos(a) * r, s * .3, cz + Math.sin(a) * r);
    d.rotation.set(random() * 3, random() * 3, random() * 3); d.scale.set(s * (1 + random()), s, s * (1 + random() * .5));
  });

  // ---- ceiba trees: buttressed trunk, umbrella crown
  const bark = new THREE.MeshStandardMaterial({ color: 0x8a7a64, roughness: .95 });
  const leaves = new THREE.MeshStandardMaterial({ color: 0x3f5a2c, roughness: .9, flatShading: true });
  const trees = [[-26, -12], [26, 13], [-28, 34], [27, -36], [-34, 6]];
  instanced(group, new THREE.CylinderGeometry(.9, 1.8, 18, 9), bark, trees.length, (i, d) => {
    d.position.set(trees[i][0], 9, trees[i][1]);
  }, { cast: near });
  instanced(group, new THREE.BoxGeometry(.25, 3.2, 3.4), bark, trees.length * 4, (i, d) => {
    const [x, z] = trees[i >> 2]; const a = (i & 3) * Math.PI / 2 + .4;
    d.position.set(x + Math.cos(a) * 1.4, 1.5, z + Math.sin(a) * 1.4); d.rotation.y = -a;
  });
  instanced(group, new THREE.IcosahedronGeometry(1, 1), leaves, trees.length * 3, (i, d) => {
    const [x, z] = trees[(i / 3) | 0]; const k = i % 3;
    d.position.set(x + (k - 1) * 3.5, 17.5 + (k === 1 ? 1.6 : 0), z + (k === 1 ? 0 : (random() - .5) * 3));
    d.scale.set(6 + random() * 2, 2.2, 5.5 + random() * 2);
  }, { cast: near });

  // ---- jungle skyline: a ring of low canopy beyond the city
  const canopy = new THREE.MeshLambertMaterial({ color: 0x34452a, flatShading: true });
  instanced(group, new THREE.IcosahedronGeometry(1, 0), canopy, near ? 150 : 80, (i, d) => {
    const a = random() * Math.PI * 2, r = 62 + random() * 55;
    const s = 5 + random() * 7;
    d.position.set(Math.cos(a) * r, s * .25, Math.sin(a) * r);
    d.scale.set(s * 1.4, s * (.5 + random() * .4), s * 1.4); d.rotation.y = random() * 3;
  });

  // ---- distant pyramids, off the court axis so the near temples don't hide them
  const far = new THREE.MeshLambertMaterial({ color: 0xa48d6c });
  const pyramids = [[-62, 88, 30], [70, 96, 24], [-104, -40, 34], [98, -72, 26], [-30, -128, 22]];
  const tiers = 7;
  instanced(group, new THREE.BoxGeometry(1, 1, 1), far, pyramids.length * (tiers + 1), (i, d) => {
    const p = pyramids[(i / (tiers + 1)) | 0], k = i % (tiers + 1);
    const [x, z, h] = p; const step = h / (tiers + 2);
    if (k === tiers) { d.position.set(x, h - step * .6, z); d.scale.set(h * .18, step * 2, h * .18); return; }  // temple on top
    const w = h * 1.5 * (1 - k / (tiers + 1));
    d.position.set(x, step * (k + .5), z); d.scale.set(w, step, w);
  });

  scene.add(group);
  return group;
}
