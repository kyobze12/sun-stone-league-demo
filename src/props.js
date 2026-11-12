// Set dressing from the KayKit Dungeon and Halloween packs (CC0, Kay Lousberg),
// packed by tools/import-props.mjs: team banners on the walls, a tzompantli
// (skull rack) and bone offerings on the Xibalba end, candle shrines at the
// stelae, gold and cacao-coin offerings at the temple stairs, dead ceibas
// at the underworld's edge. Everything stays outside the play volume.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const PROPS = {};
export async function loadProps(manager) {
  const gltf = await new GLTFLoader(manager).loadAsync('./assets/props/kaykit-props.glb');
  for (const node of gltf.scene.children) PROPS[node.name] = node;
  return Object.keys(PROPS).length;
}
export const prop = (name) => {
  const p = PROPS[name]; if (!p) return null;
  const c = p.clone(true);
  c.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return c;
};

function place(group, name, [x, y, z], { rot = 0, scale = 1 } = {}) {
  const p = prop(name); if (!p) return null;
  p.position.set(x, y, z); p.rotation.y = rot; p.scale.setScalar(scale);
  group.add(p);
  return p;
}

export function addProps(scene, { wallHeight = 5.4 } = {}) {
  const group = new THREE.Group(); group.name = 'props';
  // Team banners along the terrace tops, facing into the court.
  for (const z of [-11, -4, 4, 11]) {
    const name = z < 0 ? 'banner_patternA_yellow' : 'banner_green';
    place(group, name, [-10.2, wallHeight, z], { rot: Math.PI / 2, scale: 1.4 });
    place(group, name, [10.2, wallHeight, z], { rot: -Math.PI / 2, scale: 1.4 });
  }
  // Tzompantli: a rack of skull posts at the north (Xibalba-facing) corners.
  for (const side of [-1, 1]) for (let i = 0; i < 4; i++) place(group, 'post_skull', [side * (15.5 + i * 1.3), 0, 21 + (i % 2) * .6], { rot: Math.PI, scale: 1.3 });
  for (let i = 0; i < 8; i++) place(group, 'skull', [(Math.random() - .5) * 26, 0, 22 + Math.random() * 8], { rot: Math.random() * 6, scale: 1.2 });
  place(group, 'ribcage', [-14, 0, 24], { rot: .6, scale: 1.4 });
  place(group, 'bone_A', [13, 0, 25], { rot: 1.3, scale: 1.4 });
  // Candle shrines and gold offerings.
  for (const [x, z] of [[-14.5, -24], [14.5, -24], [-14.5, 24], [14.5, 24]]) place(group, 'shrine_candles', [x, 0, z], { rot: x < 0 ? Math.PI / 2 : -Math.PI / 2, scale: 1.3 });
  for (const z of [-7, 7]) for (const s of [-1, 1]) place(group, 'candle_triple', [s * 9.6, 2.6, z], { scale: 1.2 });
  for (const sign of [-1, 1]) {
    place(group, 'chest_gold', [-2.6, 0, sign * 17.6], { rot: sign > 0 ? Math.PI : 0, scale: 1.2 });
    place(group, 'coin_stack_large', [2.4, 0, sign * 17.4], { scale: 1.4 });
  }
  // Dead ceibas where the city gives way to the underworld road.
  for (const [x, z] of [[-20, 30], [21, 33], [-27, 18]]) place(group, 'tree_dead_large', [x, 0, z], { rot: Math.random() * 6, scale: 2.4 });
  scene.add(group);
  return group;
}
