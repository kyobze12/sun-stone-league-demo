import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { BallState, BALL_RADIUS } from '../src/ball.js';
import { shotVelocity } from '../src/shot.js';
import { spawnPair, spawnRoster, animateCharacter, TARGET_HEIGHT } from '../src/characters.js';
import { TEAM_ROSTER, getAITarget, scoringTeam, shouldAIAttemptHit } from '../src/teams.js';
import { alignArena, ARENA_LAYOUT } from '../src/arena-layout.js';
import { RING_HEIGHT, COURT_WIDTH } from '../src/court.js';
const ring=new THREE.Vector3(COURT_WIDTH/2-1.25,RING_HEIGHT,0);

test('resting-ball ring shots score exactly once across frame rates',()=>{
  for(const fps of [20,30,60,120]) for(const x of [-4,0,3]){
    const b=new BallState();b.pos.set(x,BALL_RADIUS,0);
    b.vel.copy(shotVelocity(b.pos,Math.PI/2,ring));
    let count=0;
    for(let i=0;i<fps*3;i++)count+=Number(b.update(1/fps,ring));
    assert.equal(count,1,'fps='+fps+', x='+x);
  }
});
test('rim overlap is rejected and reset clears all scoring state',()=>{
  const b=new BallState();b.pos.set(ring.x-.8,ring.y,.7);b.vel.set(10,0,0);
  let scored=false;for(let i=0;i<30;i++)scored=b.update(1/120,ring)||scored;
  assert.equal(scored,false);
  b.scored=true;b.heldCooldown=.3;b.pendingPass=1;b.reset();
  assert.equal(b.scored,false);assert.equal(b.heldCooldown,0);assert.equal(b.pendingPass,0);
});
test('2v2 roster has one human and three independent AI fighters split evenly by team',async()=>{
  const {fighters}=spawnRoster(new THREE.Scene(),await characterSource());
  assert.equal(fighters.length,4);
  assert.deepEqual(fighters.filter((fighter)=>fighter.team==='sun').map((fighter)=>fighter.id),['player','sun-support']);
  assert.deepEqual(fighters.filter((fighter)=>fighter.team==='rival').map((fighter)=>fighter.id),['rival-striker','rival-support']);
  assert.equal(fighters.filter((fighter)=>fighter.control==='human').length,1);
  assert.equal(fighters.filter((fighter)=>fighter.control==='ai').length,3);
  const firstBone=fighters[0].rig.rest.LeftArm.bone;
  for(const fighter of fighters.slice(1))assert.notEqual(fighter.rig.rest.LeftArm.bone,firstBone);
  assert.equal(TEAM_ROSTER.length,4);
});
test('AI support target stays reachable and scores follow the last striking team',()=>{
  const ball=new THREE.Vector3(0,0,0);
  const player=new THREE.Vector3(0,0,-6);
  const sunTarget=getAITarget(TEAM_ROSTER[1],ball,player);
  const rivalTarget=getAITarget(TEAM_ROSTER[3],ball,player);
  const rivalStrikerTarget=getAITarget(TEAM_ROSTER[2],ball,player);
  assert.ok(sunTarget.distanceTo(ball)<2.05);
  assert.ok(rivalTarget.distanceTo(ball)<2.05);
  assert.equal(rivalStrikerTarget.distanceTo(ball),0,'striker pursues the ball directly');
  for(const opponent of TEAM_ROSTER.filter((fighter)=>fighter.team==='rival'&&fighter.control==='ai')) {
    assert.equal(shouldAIAttemptHit(.9,0,0,2.05),true,opponent.id+' can strike when in range');
    assert.equal(shouldAIAttemptHit(.9,.2,0,2.05),false,opponent.id+' respects its hit cooldown');
  }
  assert.equal(scoringTeam('versus','sun'),'sun');
  assert.equal(scoringTeam('versus','rival'),'rival');
  assert.equal(scoringTeam('solo','rival'),'sun');
});
test('supplied arena inner court aligns with game coordinates',async()=>{
  const model=new OBJLoader().parse(await readFile('public/assets/arena/arena.obj','utf8'));
  alignArena(model);
  const {centerX,centerZ,floorY,scale}=ARENA_LAYOUT;
  assert.ok(new THREE.Vector3(centerX,floorY,centerZ).applyMatrix4(model.matrixWorld).length()<1e-6);
  const side=new THREE.Vector3(centerX,floorY,centerZ+7/scale).applyMatrix4(model.matrixWorld);
  assert.ok(Math.abs(side.x-7)<1e-6);
});
async function characterSource(){
  // Use the real mesh/skeleton; omit image decoding only for the Node test.
  const bytes=await readFile('public/assets/characters/player.glb');
  const length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length).toString());
  delete json.materials;delete json.textures;delete json.images;
  for(const mesh of json.meshes)for(const primitive of mesh.primitives)delete primitive.material;
  const offset=20+length,size=bytes.readUInt32LE(offset);
  json.buffers[0].uri='data:application/octet-stream;base64,'+bytes.subarray(offset+8,offset+8+size).toString('base64');
  globalThis.ProgressEvent ||= class ProgressEvent {constructor(type,init={}){Object.assign(this,{type},init);}};
  return (await new GLTFLoader().parseAsync(JSON.stringify(json),'')).scene;
}
test('real characters are equally scaled, animate independently, stay grounded and recover from strikes',async()=>{
  const pair=spawnPair(new THREE.Scene(),await characterSource());
  assert.equal(pair.playerBones.procedural,false);assert.equal(pair.aiBones.procedural,false);
  const heights=[];
  for(const root of [pair.playerChar,pair.aiChar]){
    root.position.set(0,0,0);root.updateMatrixWorld(true);
    const height=new THREE.Box3().setFromObject(root,true).getSize(new THREE.Vector3()).y;
    assert.ok(Math.abs(height-TARGET_HEIGHT)<.12,'height '+height);heights.push(height);
  }
  assert.ok(Math.abs(heights[0]-heights[1])<1e-5);
  const rig=pair.playerBones,rival=pair.aiBones.rest.LeftUpLeg.bone.quaternion.clone();
  animateCharacter(rig,7.2,0,1/60,1);
  assert.ok(rig.rest.LeftUpLeg.bone.quaternion.angleTo(rig.rest.LeftUpLeg.quaternion)>.001);
  assert.ok(pair.aiBones.rest.LeftUpLeg.bone.quaternion.angleTo(rival)<1e-6);
  for(let i=0;i<120;i++)animateCharacter(rig,7.2,0,1/60,i/60);
  rig.root.updateMatrixWorld(true);
  const low=Math.min(...rig.feet.map(b=>b.getWorldPosition(new THREE.Vector3()).y));
  assert.ok(Math.abs(low-rig.footHeight)<.01);
  animateCharacter(rig,0,.225,1/60,2);
  assert.ok(rig.rest.Hips.bone.quaternion.angleTo(rig.rest.Hips.quaternion)>.2);
  for(let i=0;i<120;i++)animateCharacter(rig,0,0,1/60,2+i/60);
  assert.ok(rig.rest.Hips.bone.quaternion.angleTo(rig.rest.Hips.quaternion)<.01);
});
