import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BallState, RINGS, ringFor, BALL_RADIUS } from '../src/ball.js';
import { strikeVelocity, ringSolution } from '../src/shot.js';
import { spawnRoster, animateCharacter, TARGET_HEIGHT } from '../src/characters.js';
import { World, mulberry32 } from '../src/world.js';
import { Match } from '../src/match.js';
import { mayaNumeralSVG } from '../src/maya.js';
import { DIFFICULTY, COURT_LENGTH, COURT_WIDTH, BACKLINE_MAX_HEIGHT, TEAMS, OTHER_TEAM } from '../src/config.js';

const northRing = RINGS[0].center;

// ---------------------------------------------------------------- ball & rules
test('a ring shot scores exactly once at every frame rate', () => {
  for (const fps of [20, 30, 60, 120]) for (const x of [-3, 0, 2.5]) {
    const ball = new BallState();
    ball.pos.set(x, BALL_RADIUS, 0);
    ball.struck = true;
    ball.vel.copy(ringSolution(ball.pos, northRing));
    let rings = 0;
    for (let i = 0; i < fps * 4; i += 1) rings += ball.update(1 / fps).filter((e) => e.type === 'ring').length;
    assert.equal(rings, 1, `fps=${fps}, x=${x}`);
  }
});

test('a ball that clips the rim bounces off instead of scoring', () => {
  const ball = new BallState();
  // Level with the top of the stone rather than the opening: it must bounce off.
  ball.pos.set(northRing.x, northRing.y + 1.05, northRing.z - 2);
  ball.struck = true;
  ball.vel.set(0, 0, 9);
  const seen = [];
  for (let i = 0; i < 240; i += 1) seen.push(...ball.update(1 / 120));
  assert.equal(seen.some((e) => e.type === 'ring'), false, 'no score through solid stone');
  assert.equal(seen.some((e) => e.type === 'rim'), true, 'the rim was struck');
});

test('reset clears every scoring latch', () => {
  const ball = new BallState();
  ball.scored = true; ball.heldCooldown = .3; ball.pendingPass.north = 1; ball.bounces = 2; ball.struck = true;
  ball.reset();
  assert.equal(ball.scored, false);
  assert.equal(ball.heldCooldown, 0);
  assert.equal(ball.pendingPass.north, 0);
  assert.equal(ball.bounces, 0);
  assert.equal(ball.struck, false);
});

test('only low balls score on the back line; high ones rebound into play', () => {
  for (const [height, shouldScore] of [[BACKLINE_MAX_HEIGHT - .5, true], [BACKLINE_MAX_HEIGHT + 1.5, false]]) {
    const ball = new BallState();
    ball.pos.set(0, height, COURT_LENGTH / 2 - 2);
    ball.vel.set(0, 0, 12);
    ball.struck = true;
    const events = [];
    for (let i = 0; i < 60; i += 1) events.push(...ball.update(1 / 120));
    assert.equal(events.some((e) => e.type === 'backline'), shouldScore, `height ${height}`);
  }
});

test('a shield repels the back line instead of conceding', () => {
  const ball = new BallState();
  ball.pos.set(0, 1, COURT_LENGTH / 2 - 2);
  ball.vel.set(0, 0, 12);
  ball.struck = true;
  ball.shields[ringFor(1).defender] = 5;
  const events = [];
  for (let i = 0; i < 60; i += 1) events.push(...ball.update(1 / 120));
  assert.equal(events.some((e) => e.type === 'backline'), false);
  assert.equal(events.some((e) => e.type === 'shield'), true);
  assert.ok(ball.vel.z < 0, 'ball is pushed back down court');
});

test('a second bounce on the same half is a fault, alternating halves is not', () => {
  const ball = new BallState();
  ball.struck = true;
  const bounceAt = (z) => {
    ball.pos.set(0, BALL_RADIUS + .05, z);
    ball.vel.set(0, -6, 0);
    const events = [];
    for (let i = 0; i < 20; i += 1) events.push(...ball.update(1 / 120));
    return events;
  };
  assert.equal(bounceAt(5).some((e) => e.type === 'doubleBounce'), false, 'first bounce is fine');
  assert.equal(bounceAt(-5).some((e) => e.type === 'doubleBounce'), false, 'other half resets the count');
  assert.equal(bounceAt(-6).some((e) => e.type === 'doubleBounce'), true, 'twice on one half is a fault');
});

// ---------------------------------------------------------------- scoring
test('every scoring route credits the attacking team', () => {
  const world = new World({ mode: 'match', humans: [] });
  const match = new Match('match', world);
  match.phase = 'playing';
  for (const [side, kind] of [[1, 'ring'], [-1, 'ring'], [1, 'backline'], [-1, 'backline']]) {
    match.phase = 'playing';
    const before = { ...match.score };
    const event = kind === 'ring' ? { type: 'ring', side, ring: ringFor(side) } : { type: 'backline', side };
    match.update(1 / 60, [event]);
    const expected = OTHER_TEAM[ringFor(side).defender];
    assert.ok(match.score[expected] > before[expected], `${kind} on side ${side} credits ${expected}`);
  }
});

test('a double bounce gives the point away to the other team', () => {
  const world = new World({ mode: 'match', humans: [] });
  const match = new Match('match', world);
  match.phase = 'playing';
  match.update(1 / 60, [{ type: 'doubleBounce', side: 1 }]);   // bounced twice in K'uk's half
  assert.equal(match.score.balam, 1);
  assert.equal(match.score.kuk, 0);
});

test('a tie at full time goes to sudden death and ends on the next point', () => {
  const world = new World({ mode: 'match', humans: [] });
  const match = new Match('match', world);
  match.phase = 'playing';
  match.timeLeft = 0.001;
  match.score.balam = match.score.kuk = 4;
  const events = match.update(1 / 60, []);
  assert.ok(events.some((e) => e.type === 'suddenDeath'));
  assert.equal(match.winner, null);
  match.update(1 / 60, [{ type: 'ring', side: 1, ring: ringFor(1) }]);
  assert.equal(match.winner, 'balam');
});

// ---------------------------------------------------------------- fairness
test('neither end of the court is favoured by the update order', () => {
  // Two identical players contest a ball placed exactly between them. Over many
  // seeds each side must win roughly half of the first touches.
  let balamFirst = 0;
  const trials = 200;
  for (let seed = 0; seed < trials; seed += 1) {
    const world = new World({ mode: 'match', difficulty: 'normal', seed, humans: [] });
    world.ball.pos.set(0, BALL_RADIUS + 1, 0);
    world.ball.vel.set(0, 0, 0);
    for (const player of world.players) player.pos.set(0, 0, TEAMS[player.team].attacks * -1.6);
    let toucher = null;
    for (let i = 0; i < 240 && !toucher; i += 1) {
      for (const event of world.step(1 / 60)) if (event.type === 'strike') { toucher = event.player.team; break; }
    }
    if (toucher === 'balam') balamFirst += 1;
  }
  const share = balamFirst / trials;
  assert.ok(share > .35 && share < .65, `balam took ${(share * 100).toFixed(0)}% of contested balls`);
});

test('a stronger difficulty beats a weaker one in both seats', () => {
  const play = (balamProfile, kukProfile, seed) => {
    const world = new World({ mode: 'match', difficulty: 'normal', seed, humans: [] });
    for (const player of world.players) if (player.ai) player.ai.profile = player.team === 'balam' ? balamProfile : kukProfile;
    const match = new Match('match', world);
    for (let t = 0; match.phase !== 'ended' && t < 400 * 60; t += 1) {
      match.update(1 / 60, world.step(match.phase === 'playing' ? 1 / 60 : 0));
    }
    return match.score;
  };
  let hardWins = 0;
  for (let seed = 0; seed < 4; seed += 1) {
    const a = play(DIFFICULTY.hard, DIFFICULTY.easy, seed);
    if (a.balam > a.kuk) hardWins += 1;
    const b = play(DIFFICULTY.easy, DIFFICULTY.hard, seed + 50);
    if (b.kuk > b.balam) hardWins += 1;
  }
  assert.ok(hardWins >= 7, `Champion won only ${hardWins}/8 against Novice`);
});

test('the AI connects far more often than it swings at air', () => {
  const world = new World({ mode: 'match', difficulty: 'normal', seed: 11, humans: [] });
  const match = new Match('match', world);
  let strikes = 0, whiffs = 0;
  for (let t = 0; t < 120 * 60 && match.phase !== 'ended'; t += 1) {
    const events = world.step(match.phase === 'playing' ? 1 / 60 : 0);
    for (const event of events) { if (event.type === 'strike') strikes += 1; if (event.type === 'whiff') whiffs += 1; }
    match.update(1 / 60, events);
  }
  assert.ok(strikes > 20, `only ${strikes} strikes`);
  assert.ok(whiffs < strikes, `${whiffs} whiffs vs ${strikes} strikes`);
});

// ---------------------------------------------------------------- strikes
test('charge power and strike type change the shot', () => {
  const base = { position: new THREE.Vector3(0, BALL_RADIUS, 0), angle: 0, ring: northRing, assist: 0 };
  const soft = strikeVelocity({ ...base, power: 0, kind: 'smash' });
  const hard = strikeVelocity({ ...base, power: 1, kind: 'smash' });
  assert.ok(hard.length() > soft.length() * 1.4, 'a full charge is much stronger');
  const lob = strikeVelocity({ ...base, power: .5, kind: 'lob' });
  const smash = strikeVelocity({ ...base, power: .5, kind: 'smash' });
  assert.ok(lob.y > smash.y * 1.8, 'a lob climbs far more steeply');
});

test('aim assist never fires when the striker faces away from the ring', () => {
  const position = new THREE.Vector3(0, BALL_RADIUS, 0);
  const away = strikeVelocity({ position, angle: Math.PI, power: .6, kind: 'lob', ring: northRing, assist: 1 });
  assert.ok(away.z < 0, 'the shot still travels away from the ring');
});

test('a charge released out of range is buffered, not thrown away', () => {
  const world = new World({ mode: 'practice', humans: ['balam-striker'] });
  const me = world.byId('balam-striker');
  world.ball.pos.set(me.pos.x, BALL_RADIUS, me.pos.z + 2.6);   // just out of reach
  world.ball.vel.set(0, 0, -6);                                 // travelling toward the player
  const hold = { mx: 0, mz: 0, aim: 0, strike: true, lob: false, tackle: false };
  world.step(1 / 60, { 'balam-striker': hold });
  world.step(1 / 60, { 'balam-striker': { ...hold, strike: false } });
  assert.ok(me.pendingStrike, 'the release is held as a pending strike');
  let struck = false;
  for (let i = 0; i < 30 && !struck; i += 1) {
    struck = world.step(1 / 60, { 'balam-striker': { ...hold, strike: false } }).some((e) => e.type === 'strike');
  }
  assert.equal(struck, true, 'the buffered strike connects as the ball arrives');
});

test('a tackle stuns the victim and takes the ball', () => {
  const world = new World({ mode: 'match', humans: ['balam-striker'] });
  const me = world.byId('balam-striker'), victim = world.byId('kuk-striker');
  me.pos.set(0, 0, 0); victim.pos.set(0, 0, 1.6);
  world.ball.pos.set(0, BALL_RADIUS, 1.9); world.ball.vel.set(0, 0, 0);
  me.facing = 0;
  const events = [];
  for (let i = 0; i < 20; i += 1) {
    events.push(...world.step(1 / 60, { 'balam-striker': { mx: 0, mz: 0, aim: 0, strike: false, lob: false, tackle: i === 0 } }));
  }
  assert.ok(events.some((e) => e.type === 'tackle'));
  assert.ok(victim.stun > 0, 'the victim is knocked down');
  assert.ok(events.some((e) => e.type === 'steal'), 'the ball changes hands');
});

// ---------------------------------------------------------------- misc
test('snapshots round-trip so the online guest sees the host state', () => {
  const host = new World({ mode: 'match', seed: 3, humans: [] });
  for (let i = 0; i < 120; i += 1) host.step(1 / 60);
  const guest = new World({ mode: 'match', seed: 3, humans: [] });
  guest.applySnapshot(host.snapshot());
  assert.ok(guest.ball.pos.distanceTo(host.ball.pos) < 1e-6);
  for (const player of host.players) {
    assert.ok(guest.byId(player.id).pos.distanceTo(player.pos) < 1e-6, player.id);
  }
});

test('the seeded generator is deterministic', () => {
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 50; i += 1) assert.equal(a(), b());
});

test('Maya numerals use bars, dots and a shell for zero', () => {
  assert.match(mayaNumeralSVG(0), /ellipse/);           // shell
  const five = mayaNumeralSVG(5);
  assert.equal((five.match(/<rect/g) || []).length, 1); // one bar
  assert.equal((five.match(/<circle/g) || []).length, 0);
  const seven = mayaNumeralSVG(7);
  assert.equal((seven.match(/<rect/g) || []).length, 1);
  assert.equal((seven.match(/<circle/g) || []).length, 2);
  assert.ok(mayaNumeralSVG(20).split('<svg').length === 2);
});

test('players and rings stay inside the court', () => {
  const world = new World({ mode: 'match', seed: 5, humans: [] });
  for (let i = 0; i < 600; i += 1) world.step(1 / 60);
  for (const player of world.players) {
    assert.ok(Math.abs(player.pos.x) <= COURT_WIDTH / 2, player.id + ' x');
    assert.ok(Math.abs(player.pos.z) <= COURT_LENGTH / 2, player.id + ' z');
    assert.ok(Number.isFinite(player.pos.x) && Number.isFinite(player.pos.z));
  }
  assert.ok(Number.isFinite(world.ball.pos.x), 'ball stays numeric');
  for (const ring of RINGS) assert.ok(Math.abs(ring.center.z) < COURT_LENGTH / 2, 'ring sits inside the end line');
});

async function characterSource() {
  // Use the real mesh/skeleton; omit image decoding only for the Node test.
  const bytes = await readFile('public/assets/characters/player.glb');
  const length = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + length).toString());
  delete json.materials; delete json.textures; delete json.images;
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  const offset = 20 + length, size = bytes.readUInt32LE(offset);
  json.buffers[0].uri = 'data:application/octet-stream;base64,' + bytes.subarray(offset + 8, offset + 8 + size).toString('base64');
  globalThis.ProgressEvent ||= class ProgressEvent { constructor(type, init = {}) { Object.assign(this, { type }, init); } };
  return (await new GLTFLoader().parseAsync(JSON.stringify(json), '')).scene;
}

test('the roster offers distinct fighters and your pick goes on your fighter', async () => {
  const { ROSTER } = await import('../src/roster.js');
  assert.ok(ROSTER.length >= 6);
  assert.equal(new Set(ROSTER.map((r) => r.id)).size, ROSTER.length);
  const world = new World({ mode: 'match', humans: ['balam-striker'] });
  const { fighters } = spawnRoster(new THREE.Scene(), await characterSource(), world.players, { 'balam-striker': 'kame' });
  assert.ok(fighters[0].rig.headgear, 'picked fighter has its headdress');
});

test('every fighter is spawned, scaled alike and animates independently', async () => {
  const world = new World({ mode: 'match', humans: ['balam-striker'] });
  const { fighters } = spawnRoster(new THREE.Scene(), await characterSource(), world.players);
  assert.equal(fighters.length, 4);
  assert.deepEqual(fighters.map((f) => f.id), ['balam-striker', 'balam-keeper', 'kuk-striker', 'kuk-keeper']);
  assert.equal(fighters.filter((f) => f.control === 'human').length, 1);
  assert.equal(fighters.filter((f) => f.team === 'balam').length, 2);
  const heights = fighters.map((fighter) => {
    fighter.character.position.set(0, 0, 0); fighter.character.updateMatrixWorld(true);
    // Measure the body; headdresses rise above it by design.
    const gear = fighter.rig.headgear, parent = gear?.parent;
    parent?.remove(gear);
    const height = new THREE.Box3().setFromObject(fighter.character, true).getSize(new THREE.Vector3()).y;
    parent?.add(gear);
    return height;
  });
  for (const height of heights) assert.ok(Math.abs(height - TARGET_HEIGHT) < .12, 'height ' + height);
  assert.ok(fighters.every((f) => f.rig.headgear), 'every fighter wears a headdress');
  const rig = fighters[0].rig, other = fighters[1].rig.rest.LeftUpLeg.bone.quaternion.clone();
  animateCharacter(rig, 7.2, 0, 1 / 60, 1);
  assert.ok(rig.rest.LeftUpLeg.bone.quaternion.angleTo(rig.rest.LeftUpLeg.quaternion) > .001, 'the runner animates');
  assert.ok(fighters[1].rig.rest.LeftUpLeg.bone.quaternion.angleTo(other) < 1e-6, 'others are untouched');
  for (let i = 0; i < 120; i += 1) animateCharacter(rig, 7.2, 0, 1 / 60, i / 60);
  rig.root.updateMatrixWorld(true);
  const low = Math.min(...rig.feet.map((bone) => bone.getWorldPosition(new THREE.Vector3()).y));
  assert.ok(Math.abs(low - rig.footHeight) < .01, 'feet stay on the stone');
});

test('duel: blows chain, guards block, heavies break guard, KO ends the round', async () => {
  const { DUEL } = await import('../src/config.js');
  const world = new World({ mode: 'duel', humans: ['balam-striker', 'kuk-striker'], seed: 3 });
  const match = new Match('duel', world);
  match.phase = 'playing';
  const a = world.byId('balam-striker'), b = world.byId('kuk-striker');
  world.ball.pos.set(6, 0.43, 12); world.ball.vel.set(0, 0, 0);     // ball out of the way
  a.pos.set(0, 0, 0); b.pos.set(0, 0, 1.5); a.facing = 0; b.facing = Math.PI;
  const ev = [];
  world.melee(a, 0, ev);
  assert.equal(b.hp, DUEL.hp - DUEL.light[0], 'a light blow lands');
  world.melee(a, 0, ev);
  assert.equal(a.chain, 2, 'a quick second blow continues the chain');
  b.guard = true; b.stun = 0;
  const before = b.hp;
  world.melee(a, 0, ev);
  assert.ok(before - b.hp <= DUEL.chip, 'a guard absorbs a light blow');
  b.pos.set(0, 0, 1.5);   // blows push the target back; step in again
  world.melee(a, 1, ev);
  assert.ok(b.stun > 0 && ev.some((e) => e.kind === 'guardbreak'), 'a heavy blow breaks the guard');
  b.hp = 3; b.guard = false; b.stun = 0; a.hitCooldown = 0; b.pos.set(0, 0, 1.5);
  const events = [];
  world.melee(a, 1, events);
  assert.ok(events.some((e) => e.type === 'ko'), 'KO at zero health');
  match.update(0.016, events);
  assert.equal(match.score.balam, 1, 'the round goes to the striker');
});

test('duel: fire blast flies and hurts; a full meter unlocks the nawal', async () => {
  const { DUEL } = await import('../src/config.js');
  const world = new World({ mode: 'duel', humans: ['balam-striker', 'kuk-striker'], seed: 4 });
  const a = world.byId('balam-striker'), b = world.byId('kuk-striker');
  world.ball.pos.set(6, 0.43, 12);
  a.pos.set(0, 0, -4); b.pos.set(0, 0, 4); a.facing = 0;
  world.blast(a, 1, []);
  assert.equal(world.projectiles.length, 1);
  for (let i = 0; i < 60; i++) world.step(1 / 60, { 'balam-striker': { mx: 0, mz: 0 }, 'kuk-striker': { mx: 0, mz: 0 } });
  assert.ok(b.hp < DUEL.hp, 'the blast hit');
  a.meter = 100;
  const ev = world.step(1 / 60, { 'balam-striker': { mx: 0, mz: 0, spirit: true }, 'kuk-striker': { mx: 0, mz: 0 } });
  assert.ok(a.spirit > 0 && ev.some((e) => e.type === 'transform'), 'transformed');
  assert.equal(a.meter, 0);
});

test('duel: AI against AI finishes matches with KOs', () => {
  for (const seed of [11, 12]) {
    const world = new World({ mode: 'duel', humans: [], seed });
    const match = new Match('duel', world);
    let t = 0;
    while (match.phase !== 'ended' && t < 400) { const ev = match.phase === 'playing' ? world.step(1 / 60, {}) : []; match.update(1 / 60, ev); t += 1 / 60; }
    assert.equal(match.phase, 'ended', 'seed ' + seed);
  }
});
