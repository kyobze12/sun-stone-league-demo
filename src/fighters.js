// KayKit fighters (CC0, Kay Lousberg): properly rigged bodies driven by real
// animation clips — locomotion, strafes, punches, kicks, blocks, hits,
// dodges, spellcasts, a death — instead of bones posed in code.
//
// Every fighter shares one skeleton, so one move library (moves.glb) drives
// them all. tools/import-kaykit.mjs prepares the files.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROSTER } from './roster.js';

export const FIGHTER_HEIGHT = 2.15;

/**
 * Soften the faceted low-poly shading: normals are averaged across edges
 * flatter than ~60°, so rounded forms shade smoothly while real creases (the
 * edge of a helmet, a belt) stay crisp. Done once per model, shared by clones.
 */
function smoothen(root) {
  root.traverse((o) => {
    if (!o.isMesh || o.geometry.userData.smoothed) return;
    try { o.geometry = toCreasedNormals(o.geometry, THREE.MathUtils.degToRad(60)); o.geometry.userData.smoothed = true; } catch { /* keep as is */ }
  });
  return root;
}
const MODELS = {};
let MOVES = null;
// Fighters that bring their own animation set instead of the KayKit library.
// Muflus (Curse of Mirra, CC BY-SA 4.0) maps his clips onto the same roles.
const OWN = {};
const OWN_MAP = {
  muflus: {
    loop: { idle: 'GR1_Idle', guardIdle: 'GR1_Idle', walk: 'GR2_Running', back: 'GR2_Running', run: 'GR2_Running', left: 'GR2_Running', right: 'GR2_Running', block: 'GR1_Idle' },
    move: { punchA: 'GR5_Crush', punchB: 'GR5_Crush', kick: 'GR5_Crush', spin: 'GR5_Crush', lob: 'GR5_Crush', blockHit: null, hitA: null, hitB: null,
      death: 'GR7_Defeat', dash: 'GR4_LeapIn', blast: 'GR3_Rage', transform: 'GR3_Rage', raise: 'GR3_Rage', cheer: 'GR6_Victory', taunt: 'GR3_Rage', standUp: null },
  },
};

/** Loads every roster body plus the move library. Resolves to true if usable. */
export async function loadFighters(manager, ext = 'glb') {
  const loader = new GLTFLoader(manager);
  const moves = loader.loadAsync(`./assets/fighters/moves.${ext}`).then((gltf) => {
    MOVES = {};
    for (const clip of gltf.animations) MOVES[clip.name] = clip;
  });
  const bodies = ROSTER.map(({ id }) => loader.loadAsync(`./assets/fighters/${id}.${ext}`)
    .then((gltf) => { MODELS[id] = smoothen(gltf.scene); })
    .catch(() => {}));
  const beasts = Object.keys(OWN_MAP).map((id) => loader.loadAsync(`./assets/beasts/${id}.${ext}`)
    .then((gltf) => { MODELS[id] = gltf.scene; OWN[id] = Object.fromEntries(gltf.animations.map((c) => [c.name, c])); })
    .catch(() => {}));
  await Promise.all([moves, ...bodies, ...beasts]);
  return !!MOVES && Object.keys(MODELS).length > 0;
}
export const hasFighter = (id) => !!MODELS[id] && (!!MOVES || !!OWN[id]);

// Which clip plays for what.
const LOOP = { idle: 'Unarmed_Idle', guardIdle: 'Idle_Combat', walk: 'Walking_A', back: 'Walking_Backwards', run: 'Running_A', left: 'Running_Strafe_Left', right: 'Running_Strafe_Right', block: 'Blocking' };
export const MOVE = {
  punchA: 'Unarmed_Melee_Attack_Punch_A', punchB: 'Unarmed_Melee_Attack_Punch_B', kick: 'Unarmed_Melee_Attack_Kick',
  spin: '2H_Melee_Attack_Spin', blockHit: 'Block_Hit', hitA: 'Hit_A', hitB: 'Hit_B', death: 'Death_A',
  dash: 'Dodge_Forward', blast: 'Spellcast_Shoot', transform: 'Spellcast_Summon', raise: 'Spellcast_Raise',
  cheer: 'Cheer', taunt: 'Taunt', lob: 'Throw', standUp: 'Lie_StandUp',
};

export function createFighter(id) {
  const source = MODELS[id];
  const own = OWN[id], map = OWN_MAP[id];
  if (!source || (!MOVES && !own)) return null;
  const clipFor = (key, loop) => own ? own[(loop ? map.loop : map.move)[key]] : MOVES[(loop ? LOOP : MOVE)[key] || key];
  const body = cloneSkeleton(source);
  // Normalise height and stand on the floor.
  body.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(body, true);
  const height = box.max.y - box.min.y;
  body.scale.multiplyScalar((own ? FIGHTER_HEIGHT * 1.2 : FIGHTER_HEIGHT) / height);   // the brute stands a head taller
  body.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(body, true);
  body.position.y -= box2.min.y;
  body.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    o.material = o.material.clone();
    if (own) return;   // a full PBR model: keep its own metal and roughness maps
    o.material.roughness = Math.max(.55, o.material.roughness ?? .8);
    o.material.metalness = Math.min(.15, o.material.metalness ?? 0);
  });
  const container = new THREE.Group();
  container.add(body);
  const mixer = new THREE.AnimationMixer(body);
  const actions = {};
  const used = new Set();
  for (const key of Object.keys(LOOP)) {
    let clip = clipFor(key, true); if (!clip) continue;
    if (used.has(clip)) clip = clip.clone();   // one action per role, even when roles share a clip
    used.add(clip);
    const action = mixer.clipAction(clip); action.play(); action.setEffectiveWeight(key === 'idle' ? 1 : 0);
    actions[key] = action;
  }
  const bones = {};
  body.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  if (own) for (const [key, action] of Object.entries(actions)) if (key === 'walk' || key === 'back' || key === 'left' || key === 'right') action.timeScale = .7;
  container.userData.rig = { kind: 'clip', clipFor, root: container, body, mixer, actions, bones, oneShot: null, oneShotUntil: 0, weights: {}, last: null, dead: false, time: 0 };
  mixer.addEventListener('finished', (e) => {
    const rig = container.userData.rig;
    if (rig.oneShot === e.action && !rig.dead) { rig.oneShot.fadeOut(.15); rig.oneShot = null; }
  });
  return container;
}

/** Play a one-shot move over the locomotion (punch, hit reaction, cast...). */
export function playMove(rig, key, { speed = 1, hold = false } = {}) {
  if (rig?.kind !== 'clip') return;
  const clip = rig.clipFor(key, false); if (!clip) return;
  if (rig.dead && key !== 'standUp') return;
  const action = rig.mixer.clipAction(clip);
  if (rig.oneShot && rig.oneShot !== action) rig.oneShot.fadeOut(.08);
  action.reset(); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = hold;
  action.timeScale = speed; action.setEffectiveWeight(1); action.fadeIn(.06); action.play();
  rig.oneShot = action;
  if (key === 'death') rig.dead = true;
  if (key === 'standUp') rig.dead = false;
}

export function reviveFighter(rig) {
  if (rig?.kind !== 'clip') return;
  rig.dead = false;
  if (rig.oneShot) { rig.oneShot.stop(); rig.oneShot = null; }
}

/**
 * Locomotion blend from measured velocity relative to facing, so a duellist
 * locked on to a rival strafes and backs off instead of running sideways.
 */
export function animateFighter(rig, dt, { facing = 0, guard = false, stun = 0, combat = false } = {}) {
  if (rig?.kind !== 'clip' || dt <= 0) return;
  const pos = rig.root.position;
  if (!rig.last) rig.last = pos.clone();
  const vx = (pos.x - rig.last.x) / dt, vz = (pos.z - rig.last.z) / dt;
  rig.last.copy(pos);
  const fwd = vx * Math.sin(facing) + vz * Math.cos(facing);
  const side = vx * Math.cos(facing) - vz * Math.sin(facing);
  const speed = Math.hypot(vx, vz);
  const target = { idle: 0, guardIdle: 0, walk: 0, back: 0, run: 0, left: 0, right: 0, block: 0 };
  if (guard) target.block = 1;
  else if (speed < .5) target[combat ? 'guardIdle' : 'idle'] = 1;
  else if (Math.abs(side) > Math.abs(fwd) * 1.2) target[side > 0 ? 'left' : 'right'] = 1;
  else if (fwd < -.4) target.back = 1;
  else if (speed < 3.2) target.walk = 1;
  else target.run = 1;
  for (const [key, action] of Object.entries(rig.actions)) {
    const w = rig.weights[key] = THREE.MathUtils.damp(rig.weights[key] ?? (key === 'idle' ? 1 : 0), target[key], 12, dt);
    action.setEffectiveWeight(rig.oneShot ? w * .15 : w);
  }
  if (rig.actions.run) rig.actions.run.timeScale = THREE.MathUtils.clamp(speed / 6, .7, 1.4);
  rig.mixer.update(dt * (stun > 0 && !rig.oneShot ? .4 : 1));
}
