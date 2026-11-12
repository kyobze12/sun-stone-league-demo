import * as THREE from 'three';
import { ROSTER, DEFAULT_LOOK, lookById, buildHeadgear } from './roster.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { TEAMS } from './config.js';
import { hasFighter, createFighter, animateFighter } from './fighters.js';

export const TARGET_HEIGHT = 2.2;

function material(color, emissive = 0x000000) {
  return new THREE.MeshStandardMaterial({ color, roughness: .68, metalness: .08, emissive, emissiveIntensity: .25 });
}

function mesh(geometry, mat, position, parent) {
  const part = new THREE.Mesh(geometry, mat);
  part.position.set(...position);
  part.castShadow = true;
  part.receiveShadow = true;
  parent.add(part);
  return part;
}

function proceduralWarrior(team) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const skin = material(0x9b5735);
  const onSunTeam = team === 'balam';
  const primary = material(onSunTeam ? 0xd98a2a : 0x138f7a, onSunTeam ? 0x4a2a08 : 0x063d38);
  const gold = material(0xe0a23e, 0x4a2400);
  const dark = material(0x241b1a);

  mesh(new THREE.CapsuleGeometry(.34, .76, 5, 8), primary, [0, 1.42, 0], body);
  mesh(new THREE.SphereGeometry(.25, 14, 10), skin, [0, 2.23, 0], body);
  mesh(new THREE.CylinderGeometry(.44, .38, .18, 12), gold, [0, 2.05, 0], body);
  mesh(new THREE.BoxGeometry(.78, .16, .35), gold, [0, 1.76, 0], body);
  mesh(new THREE.CylinderGeometry(.36, .42, .34, 10), dark, [0, .9, 0], body);

  const leftArm = new THREE.Group(); leftArm.position.set(-.43, 1.72, 0); body.add(leftArm);
  const rightArm = new THREE.Group(); rightArm.position.set(.43, 1.72, 0); body.add(rightArm);
  mesh(new THREE.CapsuleGeometry(.11, .58, 4, 7), skin, [0, -.31, 0], leftArm);
  mesh(new THREE.CapsuleGeometry(.11, .58, 4, 7), skin, [0, -.31, 0], rightArm);
  const leftLeg = new THREE.Group(); leftLeg.position.set(-.2, .86, 0); body.add(leftLeg);
  const rightLeg = new THREE.Group(); rightLeg.position.set(.2, .86, 0); body.add(rightLeg);
  mesh(new THREE.CapsuleGeometry(.14, .66, 4, 7), skin, [0, -.38, 0], leftLeg);
  mesh(new THREE.CapsuleGeometry(.14, .66, 4, 7), skin, [0, -.38, 0], rightLeg);
  mesh(new THREE.BoxGeometry(.25, .14, .48), dark, [0, -.77, .08], leftLeg);
  mesh(new THREE.BoxGeometry(.25, .14, .48), dark, [0, -.77, .08], rightLeg);

  const featherColors = onSunTeam ? [0xf2a93b, 0x2a1a0e, 0xe2e0c8] : [0x1fb89a, 0xc8323c, 0x1a5c8c];
  for (let i = 0; i < 7; i += 1) {
    const feather = mesh(new THREE.ConeGeometry(.12, .84, 6), material(featherColors[i % 3]), [(i - 3) * .12, 2.72 + Math.abs(i - 3) * .05, .04], body);
    feather.rotation.z = -(i - 3) * .1;
  }
  root.userData.rig = { root, body, leftArm, rightArm, leftLeg, rightLeg, procedural: true, baseY: 0 };
  return root;
}

function collectBones(root) {
  const bones = {};
  root.traverse((object) => { if (object.isBone) bones[object.name.replace(/^mixamorig[:_]?/, '')] = object; });
  return bones;
}

export function normalizeModel(model) {
  model.rotation.y += Math.PI;
  model.updateMatrixWorld(true);
  let bounds = new THREE.Box3().setFromObject(model,true);
  const height=bounds.max.y-bounds.min.y;
  if (!Number.isFinite(height) || height<.001) throw new Error('Invalid model bounds');
  model.scale.multiplyScalar(TARGET_HEIGHT/height);
  model.updateMatrixWorld(true);
  bounds=new THREE.Box3().setFromObject(model,true);
  const center=bounds.getCenter(new THREE.Vector3());
  model.position.sub(new THREE.Vector3(center.x,bounds.min.y,center.z));
  model.updateMatrixWorld(true);
}

// Each team's baked jaguar-warrior skin. The source mesh ships a 2x2 placeholder
// texture over a 0.4 grey base factor, so without this every fighter renders as
// a flat silhouette.
const SKINS = {};

// Idle/Walk/Run clips, retargeted onto our fighters by bone name.
let CLIPS = null;

export async function loadAnimations(manager, url = './assets/characters/locomotion.glb') {
  const gltf = await new GLTFLoader(manager).loadAsync(url);
  CLIPS = {};
  for (const clip of gltf.animations) {
    // Drop every Hips track. The clips carry absolute local transforms from a
    // rig whose hips rest in a different orientation, so applying them stood
    // our fighters on their heads; and root translation would fight the
    // simulation for position anyway. Children animate relative to the hips,
    // so the gait survives intact.
    clip.tracks = clip.tracks.filter((track) => !/Hips\./i.test(track.name));
    CLIPS[clip.name.toLowerCase()] = clip;
  }
  return CLIPS;
}

/** Drop clip tracks for bones the fighter mesh does not have (finger bones). */
export function pruneClips(model) {
  if (!CLIPS || !model) return;
  const names = new Set();
  model.traverse((o) => names.add(o.name));
  for (const clip of Object.values(CLIPS)) {
    const kept = clip.tracks.filter((t) => names.has(t.name.slice(0, t.name.lastIndexOf('.'))));
    // If names disagree wholesale, keep the clip untouched rather than empty it.
    if (kept.length > clip.tracks.length * .5) clip.tracks = kept;
  }
}

export async function loadSkins(manager) {
  const loader = new THREE.TextureLoader(manager);
  await Promise.all(ROSTER.map(async ({ id }) => {
    try {
      const texture = await loader.loadAsync(`./assets/characters/skin_${id}.webp`);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;            // glTF UV convention
      texture.anisotropy = 4;
      SKINS[id] = texture;
    } catch { /* that fighter falls back to team colour */ }
  }));
  if (!SKINS.balam && !SKINS.kuk) throw new Error('no fighter skins');
  return SKINS;
}

/** Fix the headdress to the head bone, sized and oriented in the rest pose. */
function addHeadgear(rig, gear, kaykit = false) {
  const head = rig.bones.Head || rig.bones.head;
  if (!head || !gear) return;
  const piece = buildHeadgear(gear);
  rig.root.updateMatrixWorld(true);
  const headPos = head.getWorldPosition(new THREE.Vector3());
  const headQ = head.getWorldQuaternion(new THREE.Quaternion());
  const headS = head.getWorldScale(new THREE.Vector3());
  const rootQ = rig.root.getWorldQuaternion(new THREE.Quaternion());
  // Built in fighter space (y up, z toward the fighter's front); the source
  // model faces -z inside its container after normalizeModel's half turn.
  const facing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), kaykit ? 0 : Math.PI);
  piece.quaternion.copy(headQ.clone().invert().multiply(rootQ).multiply(facing));
  // KayKit heads are big and stylised: scale the plumes up and lift them to
  // the crown of the head.
  const scale = kaykit ? 2.3 : TARGET_HEIGHT / 1.96;
  piece.scale.setScalar(scale / headS.x);
  const anchor = headPos.clone(); if (kaykit) anchor.y += .28;
  piece.position.copy(head.worldToLocal(anchor));
  head.add(piece);
  rig.headgear = piece;
}

function dressAs(root, look, team) {
  const skin = SKINS[look] || SKINS[team];
  root.traverse((object) => {
    if (!object.isMesh) return;
    const source = Array.isArray(object.material) ? object.material : [object.material];
    const materials = source.map((oldMaterial) => {
      const next = oldMaterial.clone();
      if (next.color) next.color.set(0xffffff);   // drop the 0.4 grey base factor
      if (skin) { next.map = skin; }
      else if (next.color) next.color.set(TEAMS[team]?.color ?? 0x999999);
      next.emissive = new THREE.Color(TEAMS[team]?.color ?? 0x888888).multiplyScalar(.05);
      next.emissiveIntensity = 1;
      next.roughness = Math.min(next.roughness ?? .9, .72);
      next.metalness = .04;
      next.needsUpdate = true;
      return next;
    });
    object.material = Array.isArray(object.material) ? materials : materials[0];
  });
}

function makeContainer(model, team, look) {
  const container = new THREE.Group();
  normalizeModel(model);
  model.traverse((object) => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
  dressAs(model, look, team);
  container.add(model);
  const bones = collectBones(model);
  container.userData.rig = { root: container, body: model, bones, procedural: false, baseY: 0 };
  if (CLIPS) {
    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    for (const [name, clip] of Object.entries(CLIPS)) {
      const action = mixer.clipAction(clip);
      action.play(); action.setEffectiveWeight(name === 'idle' ? 1 : 0);
      actions[name] = action;
    }
    container.userData.rig.mixer = mixer;
    container.userData.rig.actions = actions;
  }
  return container;
}

const AXES=[new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1)];
const deltaQ=new THREE.Quaternion();
export function prepareImportedRig(rig) {
  const find=name=>rig.bones[name];
  rig.root.updateMatrixWorld(true);
  for (const side of ['Left','Right']) {
    const arm=find(side+'Arm'),elbow=find(side+'ForeArm');
    if (!arm || !elbow) continue;
    const from=elbow.getWorldPosition(new THREE.Vector3()).sub(arm.getWorldPosition(new THREE.Vector3())).normalize();
    const to=new THREE.Vector3((Math.sign(from.x)||1)*.2,-.97,.08).normalize();
    const parentQ=arm.parent.getWorldQuaternion(new THREE.Quaternion());
    const change=parentQ.clone().invert().multiply(new THREE.Quaternion().setFromUnitVectors(from,to)).multiply(parentQ);
    arm.quaternion.premultiply(change);
    rig.root.updateMatrixWorld(true);
  }
  rig.rest={};
  for (const [name,bone] of Object.entries(rig.bones)) {
    const inverse=bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    rig.rest[name]={bone,quaternion:bone.quaternion.clone(),axes:AXES.map(axis=>axis.clone().applyQuaternion(inverse))};
  }
  rig.basePosition=rig.body.position.clone();
  rig.feet=['LeftFoot','RightFoot','LeftToeBase','RightToeBase'].map(find).filter(Boolean);
  rig.footHeight=Math.min(...rig.feet.map(bone=>bone.getWorldPosition(new THREE.Vector3()).y));
  rig.gait=0;rig.moveBlend=0;
}
function rotateBone(rig,name,x=0,y=0,z=0) {
  const rest=rig.rest[name];if(!rest)return;
  rest.bone.quaternion.copy(rest.quaternion);
  [x,y,z].forEach((angle,i)=>{
    if(angle)rest.bone.quaternion.premultiply(deltaQ.setFromAxisAngle(rest.axes[i],angle));
  });
}

export function createCharacter(sourceModel, fighter, lookId = null) {
  const wanted = lookById(lookId || DEFAULT_LOOK[fighter.team]);
  if (hasFighter(wanted.id)) {
    const character = createFighter(wanted.id);
    if (character) { addHeadgear(character.userData.rig, wanted.gear, true); return character; }
  }
  if (sourceModel) {
    try {
      const look = lookById(lookId || DEFAULT_LOOK[fighter.team]);
      const character = makeContainer(cloneSkeleton(sourceModel), fighter.team, look.id);
      if (Object.keys(character.userData.rig.bones).length < 5) throw new Error('Static T-pose model');
      prepareImportedRig(character.userData.rig);
      addHeadgear(character.userData.rig, look.gear);
      return character;
    } catch {
      // A malformed or static source model should not prevent the match from starting.
    }
  }
  return proceduralWarrior(fighter.team);
}

export function spawnRoster(scene, sourceModel = null, players = [], looks = {}) {
  const fighters = players.map((player) => {
    const character = createCharacter(sourceModel, player, looks[player.id]);
    character.position.copy(player.pos);
    character.userData.fighterId = player.id;
    character.userData.team = player.team;
    scene.add(character);
    return { id: player.id, team: player.team, slot: player.slot, control: player.control, character, rig: character.userData.rig };
  });
  return { fighters };
}

export function loadCharacterModel(manager, modelUrl) {
  return new Promise((resolve) => {
    if (!modelUrl) { resolve(null); return; }
    new GLTFLoader(manager).load(modelUrl, (gltf) => resolve(gltf.scene), undefined, () => resolve(null));
  });
}

export function animateCharacter(rig,speed,swingTimer,dt,time,state={}) {
  if(!rig?.root || dt<=0)return;
  if(rig.kind==='clip') { animateFighter(rig,dt,state); return; }
  const stun=state.stun||0,dash=state.dash||0,charge=state.charge??-1;
  rig.root.rotation.x=THREE.MathUtils.damp(rig.root.rotation.x,dash>0?.42:stun>0?-.55:charge>=0?.12*charge:0,14,dt);
  rig.root.rotation.z=THREE.MathUtils.damp(rig.root.rotation.z,stun>0?.35:0,10,dt);
  const moving=typeof speed==='number'?Math.min(speed/7.2,1):Number(speed);
  if(rig.procedural) {
    const stride=Math.sin(time*10)*moving;
    rig.body.position.y=Math.abs(stride)*.04;
    rig.leftLeg.rotation.x=stride*.5;rig.rightLeg.rotation.x=-stride*.5;
    rig.leftArm.rotation.x=-stride*.3;rig.rightArm.rotation.x=stride*.3;
    const hit=swingTimer>0?Math.sin((1-swingTimer/.45)*Math.PI):0;
    rig.body.rotation.set(0,hit*.75,-hit*.16);
    return;
  }
  if(rig.mixer) {
    // Crossfade idle -> walk -> run by measured speed, then layer the strike
    // and stagger poses on top of whatever the clip produced.
    rig.moveBlend=THREE.MathUtils.damp(rig.moveBlend,moving,12,dt);
    const m=rig.moveBlend;
    const walk=THREE.MathUtils.clamp(m/.45,0,1), run=THREE.MathUtils.clamp((m-.45)/.55,0,1);
    rig.actions.idle.setEffectiveWeight(1-walk);
    rig.actions.walk.setEffectiveWeight(walk*(1-run));
    rig.actions.run.setEffectiveWeight(walk*run);
    rig.actions.run.timeScale=.85+m*.45;
    rig.actions.walk.timeScale=.9+m*.4;
    rig.mixer.update(dt*(stun>0?.15:1));
    const hit=swingTimer>0?Math.sin((1-swingTimer/.45)*Math.PI):0;
    if(hit>.001||stun>0) {
      rotateBone(rig,'Spine1',0,-hit*.55,-hit*.2);
      rotateBone(rig,'RightArm',0,0,hit*.9);
      rotateBone(rig,'LeftArm',0,0,-hit*.4);
      rotateBone(rig,'Hips',0,hit*.5,0);
    }
    rig.root.updateMatrixWorld(true);
    return;
  }
  rig.moveBlend=THREE.MathUtils.damp(rig.moveBlend,moving,12,dt);
  rig.gait+=dt*(7+moving*5);
  const blend=rig.moveBlend,stride=Math.sin(rig.gait)*blend;
  const hit=swingTimer>0?Math.sin((1-swingTimer/.45)*Math.PI):0;
  for(const rest of Object.values(rig.rest))rest.bone.quaternion.copy(rest.quaternion);
  rotateBone(rig,'LeftUpLeg',stride*.65);rotateBone(rig,'RightUpLeg',-stride*.65);
  rotateBone(rig,'LeftLeg',-Math.max(0,-stride)*.95);rotateBone(rig,'RightLeg',-Math.max(0,stride)*.95);
  rotateBone(rig,'LeftFoot',-stride*.2);rotateBone(rig,'RightFoot',stride*.2);
  rotateBone(rig,'LeftArm',-stride*.32,0,-hit*.18);rotateBone(rig,'RightArm',stride*.32,0,hit*.18);
  rotateBone(rig,'LeftForeArm',-.25-blend*.25);rotateBone(rig,'RightForeArm',-.25-blend*.25);
  rotateBone(rig,'Hips',blend*.06,hit*.72,stride*.025-hit*.13);
  rotateBone(rig,'Spine',-blend*.04,-hit*.3,Math.sin(time*2)*.01);
  rotateBone(rig,'Spine1',0,-hit*.2);
  rig.body.position.copy(rig.basePosition);rig.body.position.x+=hit*.18;
  rig.root.updateMatrixWorld(true);
  if(rig.feet.length) {
    const lowest=Math.min(...rig.feet.map(bone=>bone.getWorldPosition(new THREE.Vector3()).y));
    rig.body.position.y+=rig.footHeight-lowest;
  }
}
