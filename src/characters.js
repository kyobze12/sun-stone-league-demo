import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { TEAM_ROSTER } from './teams.js';

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
  const onSunTeam = team === 'sun' || team === 'player';
  const primary = material(onSunTeam ? 0x087a70 : 0xa3292f, onSunTeam ? 0x063d38 : 0x3b080a);
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

  const featherColors = onSunTeam ? [0x0ab7ae, 0x134e8c, 0xe2a437] : [0xd52e36, 0x75232d, 0xe2a437];
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

function tint(root, color) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    const source = Array.isArray(object.material) ? object.material : [object.material];
    const materials = source.map((oldMaterial) => {
      const next = oldMaterial.clone();
      if (next.color) next.color.lerp(new THREE.Color(color), .48);
      next.emissive = new THREE.Color(color).multiplyScalar(.06);
      return next;
    });
    object.material = Array.isArray(object.material) ? materials : materials[0];
  });
}

function makeContainer(model, team) {
  const container = new THREE.Group();
  normalizeModel(model);
  model.traverse((object) => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
  if (team === 'rival') tint(model, 0xb51f2f);
  else if (team === 'sun') tint(model, 0x087a70);
  container.add(model);
  const bones = collectBones(model);
  container.userData.rig = { root: container, body: model, bones, procedural: false, baseY: 0 };
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

function createCharacter(sourceModel, fighter) {
  if (sourceModel) {
    try {
      const character = makeContainer(cloneSkeleton(sourceModel), fighter.team);
      if (Object.keys(character.userData.rig.bones).length < 5) throw new Error('Static T-pose model');
      prepareImportedRig(character.userData.rig);
      return character;
    } catch {
      // A malformed or static source model should not prevent the match from starting.
    }
  }
  return proceduralWarrior(fighter.team);
}

export function spawnRoster(scene, sourceModel = null) {
  const fighters = TEAM_ROSTER.map((spec) => {
    const character = createCharacter(sourceModel, spec);
    character.position.set(...spec.position);
    character.userData.fighterId = spec.id;
    character.userData.team = spec.team;
    scene.add(character);
    return { ...spec, character, rig: character.userData.rig };
  });
  return { fighters, player: fighters[0], ai: fighters.slice(1) };
}

// Keep the original pair shape for focused character-pipeline checks and older callers.
export function spawnPair(scene, sourceModel = null) {
  const player = createCharacter(sourceModel, TEAM_ROSTER[0]);
  const ai = createCharacter(sourceModel, TEAM_ROSTER[2]);
  player.position.set(...TEAM_ROSTER[0].position);
  ai.position.set(...TEAM_ROSTER[2].position);
  scene.add(player, ai);
  return { playerChar: player, aiChar: ai, playerBones: player.userData.rig, aiBones: ai.userData.rig };
}

export function loadCharacters(scene, manager, modelUrl) {
  return new Promise((resolve) => {
    if (!modelUrl) { resolve(spawnRoster(scene)); return; }
    new GLTFLoader(manager).load(modelUrl, (gltf) => resolve(spawnRoster(scene, gltf.scene)), undefined, () => resolve(spawnRoster(scene)));
  });
}

export function animateCharacter(rig,speed,swingTimer,dt,time) {
  if(!rig?.root || dt<=0)return;
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
