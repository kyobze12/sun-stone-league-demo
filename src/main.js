import * as THREE from 'three';
import { createCourt, loadArenaModel, updateCourt, addLighting } from './court.js';
import { loadCharacterModel, spawnRoster, animateCharacter } from './characters.js';
import { createRenderer, createComposer, createBall, updateBallVisual, Particles, PowerupVisuals, CameraRig, detectQuality, QUALITY } from './render.js';
import { setupInput, readInput, resetInput, isTouch } from './input.js';
import { World, EMPTY_INPUT } from './world.js';
import { Match } from './match.js';
import { NetSession } from './net.js';
import { mayaNumeralSVG, CALLOUTS, pick } from './maya.js';
import { TEAMS, POWERUPS, MODES, COURT_LENGTH, HIT_RANGE } from './config.js';
import { RINGS, GRAVITY, BALL_RADIUS } from './ball.js';
import { Audio } from './audio.js';

const $ = (id) => document.getElementById(id);
function hasWebGL() { try { const c = document.createElement('canvas'); return Boolean(window.WebGLRenderingContext && c.getContext('webgl')); } catch { return false; } }
if (!hasWebGL()) { $('webgl-error').style.display = 'flex'; throw new Error('WebGL unavailable'); }

// ------------------------------------------------------------ renderer & scene
let quality = detectQuality();
$('quality').value = quality;
const canvas = $('game-canvas');
const renderer = createRenderer(canvas, quality);
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xb8947a, .0032);
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, .1, 420);
camera.position.set(0, 7, -16);
let composer = createComposer(renderer, scene, camera, quality);
const touch = isTouch();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[quality].pixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  composer?.setSize(innerWidth, innerHeight);
});

const lights = addLighting(scene);
const { arena, fallbackDecor, goals, crowd } = createCourt(scene);
if (!QUALITY[quality].crowd) for (const mesh of crowd) mesh.visible = false;
const ballMesh = createBall(scene);
const particles = new Particles(scene, QUALITY[quality].particles);
const powerupVisuals = new PowerupVisuals(scene);
const cameraRig = new CameraRig(camera);
const audio = new Audio();

const manager = new THREE.LoadingManager();
manager.onProgress = (_url, loaded, total) => { $('loadbar').style.width = `${Math.round(loaded / total * 100)}%`; };
manager.onError = () => { $('loading-note').textContent = 'Using sculpted fallback'; };
const arenaReady = loadArenaModel(arena, fallbackDecor, manager).catch(() => { fallbackDecor.visible = true; });
let characterSource = null;
const charactersReady = loadCharacterModel(manager, './assets/characters/player.glb').then((model) => { characterSource = model; });
Promise.all([arenaReady, charactersReady]).then(() => {
  $('loading').classList.add('depart');
  setTimeout(() => { $('loading').style.display = 'none'; }, 450);
  showMenu();
});

// Aim indicator under the controlled player
const aimGroup = new THREE.Group();
const aimRing = new THREE.Mesh(new THREE.RingGeometry(.62, .72, 32), new THREE.MeshBasicMaterial({ color: 0xffd34e, transparent: true, opacity: .75, side: THREE.DoubleSide, depthWrite: false }));
aimRing.rotation.x = -Math.PI / 2;
const aimArrow = new THREE.Mesh(new THREE.ConeGeometry(.17, .6, 8), new THREE.MeshBasicMaterial({ color: 0xffd34e }));
aimArrow.rotation.x = Math.PI / 2; aimArrow.position.z = .95; aimArrow.position.y = .08;
aimGroup.add(aimRing, aimArrow); scene.add(aimGroup);
const practiceMarker = new THREE.Mesh(new THREE.RingGeometry(.8, 1.05, 32), new THREE.MeshBasicMaterial({ color: 0x7fe9ff, transparent: true, opacity: .85, side: THREE.DoubleSide, depthWrite: false }));
practiceMarker.rotation.x = -Math.PI / 2; practiceMarker.position.y = .05; practiceMarker.visible = false; scene.add(practiceMarker);

// ------------------------------------------------------------ game state
const G = {
  mode: null, world: null, match: null, fighters: new Map(), humans: [], localIds: [],
  net: null, role: 'local', paused: false, timeScale: 1, slowmo: 0, excitement: 0,
  guest: { snapshots: [], lastInput: null }, tutorial: null, elapsed: 0,
};
const clock = new THREE.Clock();

function controlledId() { return G.localIds[0]; }
function controlled() { return G.world?.byId(controlledId()); }
function facingOf(id) { const p = G.world?.byId(id); return p ? TEAMS[p.team].attacks : 1; }

// ------------------------------------------------------------ UI helpers
function show(id, on = true) { $(id).style.display = on ? 'flex' : 'none'; }
function callout(text, kind = '') {
  const element = $('callout'); element.textContent = text; element.className = kind;
  element.classList.remove('show'); requestAnimationFrame(() => element.classList.add('show'));
  clearTimeout(callout.timer); callout.timer = setTimeout(() => element.classList.remove('show'), kind === 'score' ? 1800 : 1100);
}
function flash() { const f = $('flash'); f.classList.add('on'); requestAnimationFrame(() => setTimeout(() => f.classList.remove('on'), 60)); }
function formatTime(seconds) { const m = Math.floor(seconds / 60), s = Math.ceil(seconds % 60); return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`; }
function records() {
  const best = Number(localStorage.getItem('ssl-best-ringhunt') || 0);
  const wins = Number(localStorage.getItem('ssl-wins') || 0);
  $('records').textContent = `Ring Hunt best: ${best}  ·  Match wins: ${wins}`;
}
function showMenu() {
  G.mode = null; G.paused = false;
  resetInput();
  for (const id of ['hud', 'status-strip', 'touch-controls', 'pause-btn', 'hint', 'tutorial']) $(id).classList.add('hidden');
  for (const id of ['endscreen', 'pause-screen', 'countdown', 'online', 'howto']) show(id, false);
  show('menu', true);
  practiceMarker.visible = false;
  $('rotate-hint').style.display = '';
  cameraRig.stopCinematic();
  records();
  closeNet();
  if (!G.world) { G.world = new World({ mode: 'match', humans: [] }); G.match = null; rebuildFighters(); }
}

// ------------------------------------------------------------ fighters (render side)
function rebuildFighters() {
  for (const fighter of G.fighters.values()) scene.remove(fighter.character);
  G.fighters.clear();
  const { fighters } = spawnRoster(scene, characterSource, G.world.players);
  for (const fighter of fighters) {
    const marker = new THREE.Mesh(new THREE.CircleGeometry(.52, 24), new THREE.MeshBasicMaterial({ color: TEAMS[fighter.team].color, transparent: true, opacity: .26, depthWrite: false }));
    marker.rotation.x = -Math.PI / 2; marker.position.y = .035; fighter.character.add(marker); fighter.marker = marker;
    const label = makeLabel(fighter.slot === 'keeper' ? 'KEEPER' : 'STRIKER', TEAMS[fighter.team].css);
    label.position.y = 3.05; fighter.character.add(label); fighter.label = label;
    G.fighters.set(fighter.id, fighter);
  }
}
function makeLabel(text, color) {
  const canvasEl = document.createElement('canvas'); canvasEl.width = 256; canvasEl.height = 64;
  const ctx = canvasEl.getContext('2d');
  ctx.font = '900 30px Nunito, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(40, 10, 176, 44);
  ctx.fillStyle = color; ctx.fillText(text, 128, 33);
  const texture = new THREE.CanvasTexture(canvasEl); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: .9 }));
  sprite.scale.set(1.6, .4, 1);
  return sprite;
}

// ------------------------------------------------------------ starting modes
function startMode(mode, options = {}) {
  G.mode = mode;
  const difficulty = $('difficulty').value;
  const humans = mode === 'local2p' ? ['balam-striker', 'kuk-striker'] : mode === 'online' ? ['balam-striker', 'kuk-striker'] : ['balam-striker'];
  G.localIds = mode === 'local2p' ? ['balam-striker', 'kuk-striker'] : mode === 'online' ? [options.guest ? 'kuk-striker' : 'balam-striker'] : ['balam-striker'];
  G.world = new World({ mode: mode === 'local2p' || mode === 'online' ? 'match' : mode, difficulty, seed: options.seed ?? (Date.now() & 0xffff), humans });
  G.match = new Match(mode === 'local2p' || mode === 'online' ? 'match' : mode, G.world);
  G.role = mode === 'online' ? (options.guest ? 'guest' : 'host') : 'local';
  G.paused = false; G.timeScale = 1; G.slowmo = 0; G.excitement = 0;
  G.guest.snapshots.length = 0;
  rebuildFighters();
  powerupVisuals.clear();
  ballMesh.userData.history.length = 0;
  for (const id of ['menu', 'endscreen', 'pause-screen', 'online', 'howto']) show(id, false);
  for (const id of ['hud', 'status-strip', 'pause-btn']) $(id).classList.remove('hidden');
  $('rotate-hint').style.display = 'none';
  if (touch) $('touch-controls').classList.remove('hidden');
  $('kuk-score').style.display = mode === 'ringhunt' || mode === 'practice' ? 'none' : '';
  $('label-balam').textContent = mode === 'ringhunt' ? 'Score' : mode === 'practice' ? 'Rings' : G.role === 'guest' ? 'Balam (host)' : mode === 'local2p' ? 'Balam · P1' : 'Balam · You';
  $('label-kuk').textContent = mode === 'local2p' ? "K'uk' · P2" : G.role === 'guest' ? "K'uk' · You" : G.role === 'host' ? "K'uk' (guest)" : "K'uk' · " + (TEAMS.kuk.glyph);
  $('center-label').textContent = mode === 'practice' ? 'Practice' : 'Time';
  $('sub-label').textContent = mode === 'match' ? `first to ${MODES.match.target}` : mode === 'ringhunt' ? 'lit ring only' : '';
  $('combo').classList.toggle('hidden', mode !== 'ringhunt');
  $('hint').classList.toggle('hidden', mode === 'practice');
  $('tutorial').classList.toggle('hidden', mode !== 'practice');
  $('hint').textContent = touch ? 'Stick: move · hold STRIKE to charge, release near the ball · LOB for rings · CHARGE to tackle' : 'WASD move · hold Space / click to charge, release near the ball · E lob for rings · Q tackle';
  if (mode === 'practice') startTutorial();
  G.match.countdown = 3;
  show('countdown', true); $('countdown-value').textContent = '3';
  audio.tone(480, .12);
  cameraRig.stopCinematic();
  canvas.focus();
  updateHUD(true);
}

document.querySelectorAll('.mode-btn').forEach((button) => button.addEventListener('click', () => {
  audio.unlock();
  const mode = button.dataset.mode;
  if (mode === 'online') { show('menu', false); show('online', true); $('online-status').textContent = ''; return; }
  startMode(mode);
}));
$('restart-btn').addEventListener('click', () => { if (G.role === 'guest') { showMenu(); return; } startMode(G.mode); if (G.role === 'host') sendStart(); });
$('menu-btn').addEventListener('click', showMenu);
$('quit-btn').addEventListener('click', showMenu);
$('howto-btn').addEventListener('click', () => { show('menu', false); show('howto', true); });
$('howto-close').addEventListener('click', () => { show('howto', false); if (!G.mode) show('menu', true); });
$('quality').addEventListener('change', (event) => { localStorage.setItem('ssl-quality', event.target.value); location.reload(); });
$('online-back').addEventListener('click', () => { closeNet(); show('online', false); show('menu', true); });

// ------------------------------------------------------------ pause
function togglePause(force) {
  if (!G.mode || G.match?.phase === 'ended') return;
  G.paused = typeof force === 'boolean' ? force : !G.paused;
  clock.getDelta();
  resetInput();
  show('pause-screen', G.paused);
  if (!G.paused) canvas.focus();
}
$('pause-btn').addEventListener('click', () => togglePause());
$('resume-btn').addEventListener('click', () => togglePause(false));
addEventListener('keydown', (event) => { if (event.code === 'Escape' || event.code === 'KeyP') togglePause(); });
addEventListener('blur', () => { if (G.role === 'local') togglePause(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && G.role === 'local') togglePause(true); });

// ------------------------------------------------------------ tutorial (practice)
function startTutorial() {
  G.tutorial = { step: 0, strikes: 0, rings: 0, tackles: 0, moved: false };
  practiceMarker.position.set(3.5, .05, -1); practiceMarker.visible = true;
  renderTutorial();
}
const TUTORIAL = [
  { text: () => touch ? 'Move with the left stick. Reach the blue marker.' : 'Move with W A S D. Reach the blue marker.', done: (t) => t.moved },
  { text: () => touch ? 'Walk into the ball to nudge it, then hold STRIKE and release near it.' : 'Walk into the ball to nudge it, then hold SPACE and release near it. Mouse aims.', done: (t) => t.strikes >= 1 },
  { text: () => touch ? 'Face the ring and hold LOB. Release at about half charge to thread it.' : 'Face the ring and hold E (lob). Release at about half charge to thread it. 3 points!', done: (t) => t.rings >= 1 },
  { text: () => touch ? 'Press CHARGE to shoulder-tackle. It knocks rivals down and steals the ball.' : 'Press Q to shoulder-charge. It knocks rivals down and steals the ball.', done: (t) => t.tackles >= 1 },
  { text: () => 'Low balls that hit the far wall score 1. Letting the ball bounce twice on your side gives a point away. Score two more rings to finish!', done: (t) => t.rings >= 3 },
];
function renderTutorial() {
  const t = G.tutorial; if (!t) return;
  const step = TUTORIAL[Math.min(t.step, TUTORIAL.length - 1)];
  $('tut-step').textContent = step.text();
  $('tut-step').classList.remove('done');
  $('tut-progress').textContent = `STEP ${Math.min(t.step + 1, TUTORIAL.length)} OF ${TUTORIAL.length}`;
}
function tutorialTick(events) {
  const t = G.tutorial; if (!t || G.match.phase !== 'playing') return;
  const me = controlled();
  if (!t.moved && me && me.pos.distanceTo(practiceMarker.position.clone().setY(0)) < 1.1) { t.moved = true; practiceMarker.visible = false; particles.burst(practiceMarker.position, 0x7fe9ff, 16, 3, 3); }
  for (const e of events) { if (e.type === 'strike') t.strikes += 1; if (e.type === 'score' && e.kind === 'ring') t.rings += 1; if (e.type === 'tackle') t.tackles += 1; }
  const step = TUTORIAL[t.step];
  if (step && step.done(t)) {
    $('tut-step').classList.add('done');
    audio.tone(660, .15, 'triangle', .06); setTimeout(() => audio.tone(880, .2, 'triangle', .06), 90);
    t.step += 1;
    if (t.step >= TUTORIAL.length) { finishGame('practice'); return; }
    setTimeout(renderTutorial, 500);
  }
}

// ------------------------------------------------------------ HUD
let lastScore = { balam: -1, kuk: -1 };
function updateHUD(force = false) {
  const m = G.match; if (!m) return;
  for (const team of ['balam', 'kuk']) {
    if (force || m.score[team] !== lastScore[team]) {
      $('score-' + team).textContent = m.score[team];
      $('maya-' + team).innerHTML = mayaNumeralSVG(m.score[team], { size: 30, color: TEAMS[team].css });
      if (!force) { $('score-' + team).classList.remove('bump'); void $('score-' + team).offsetWidth; $('score-' + team).classList.add('bump'); }
      lastScore[team] = m.score[team];
    }
  }
  if (G.mode === 'practice') $('center-value').textContent = `${m.rings}/3`;
  else $('center-value').textContent = m.suddenDeath ? 'S.D.' : formatTime(m.timeLeft);
  $('timer-block').classList.toggle('urgent', m.timed && m.timeLeft <= 15 && m.phase === 'playing');
  if (m.suddenDeath) $('sub-label').textContent = 'next point wins';
  const me = controlled();
  const charging = me && me.charge >= 0;
  $('charge-wrap').classList.toggle('active', !!charging);
  $('charge-fill').style.width = `${charging ? me.charge * 100 : 0}%`;
  $('charge-fill').classList.toggle('full', charging && me.charge >= .99);
  if (me) {
    const chips = [];
    if (me.wind > 0) chips.push(['WIND ' + Math.ceil(me.wind), POWERUPS.wind.color]);
    if (me.jaguar) chips.push(['JAGUAR', POWERUPS.jaguar.color]);
    if (G.world.ball.shields[me.team] > 0) chips.push(['SHIELD ' + Math.ceil(G.world.ball.shields[me.team]), POWERUPS.shield.color]);
    if (G.world.moonTime > 0) chips.push(['MOON ' + Math.ceil(G.world.moonTime), POWERUPS.moon.color]);
    $('effects').innerHTML = chips.map(([t, c]) => `<span class="effect-chip" style="--c:#${c.toString(16).padStart(6, '0')}">${t}</span>`).join('');
  }
  if (G.mode === 'ringhunt') $('combo').textContent = m.combo > 1 ? `COMBO ×${Math.min(m.combo, 4)}` : '';
}

// ------------------------------------------------------------ event presentation
function wire(event) {
  const out = { type: event.type };
  for (const key of ['kind', 'power', 'big', 'side', 'points', 'combo', 'text', 'winner', 'team']) if (event[key] !== undefined) out[key] = event[key];
  if (event.player) { out.player = event.player.id; out.team = event.team || event.player.team; }
  if (event.victim) out.victim = event.victim.id;
  if (event.pos) out.pos = [event.pos.x, event.pos.y, event.pos.z];
  if (event.score) out.score = event.score;
  if (event.ring) out.ringSide = event.ring.side;
  if (event.powerup) out.powerup = event.powerup.id;
  return out;
}

function present(events) {
  const ball = G.world.ball;
  for (const e of events) {
    const pos = e.pos ? new THREE.Vector3(...e.pos) : ball.pos.clone();
    const isMe = e.player && G.localIds.includes(e.player);
    switch (e.type) {
      case 'strike': {
        const color = TEAMS[e.team].color;
        particles.burst(pos, color, e.big ? 40 : 14 + Math.round(e.power * 12), e.big ? 9 : 5, 4.5);
        cameraRig.impact(e.big ? .55 : .12 + e.power * .22);
        audio.strike(e.kind, e.power, e.big);
        if (e.big) { flash(); callout(pick(CALLOUTS.bigStrike), e.team); }
        else if (e.power > .85 || e.kind === 'lob') callout(pick(e.kind === 'lob' ? CALLOUTS.lob : CALLOUTS.strike), e.team);
        const f = G.fighters.get(e.player); if (f) f.lastStrike = G.elapsed;
        break;
      }
      case 'whiff': if (isMe) { audio.tone(90, .08, 'square', .03); if (G.elapsed - (present.lastWhiff || -9) > 4 && (!G.tutorial || G.tutorial.step >= 1)) { present.lastWhiff = G.elapsed; callout('TOO FAR — GET NEXT TO THE BALL', 'muted'); } } break;
      case 'tackle': audio.tackle(); if (e.player) particles.burst(G.world.byId(e.player).pos.clone().setY(.6), 0xffffff, 8, 3, 2); break;
      case 'steal': callout('STEAL!', e.team); audio.hit(); particles.burst(pos, 0xffffff, 20, 6, 4); cameraRig.impact(.3); break;
      case 'knockdown': audio.hit(); cameraRig.impact(.2); break;
      case 'rim': audio.tone(820, .12, 'triangle', .05); particles.burst(pos, 0xffd34e, 8, 3, 3); break;
      case 'wall': audio.tone(140, .1, 'square', .04); break;
      case 'bounce': if (e.speed > 6) audio.tone(110, .07, 'sine', .05); break;
      case 'shield': callout(pick(CALLOUTS.shield), 'muted'); audio.tone(520, .25, 'sine', .07); particles.burst(pos, 0xffe36b, 24, 6, 5); break;
      case 'powerup': {
        const def = POWERUPS[e.kind];
        audio.powerup();
        particles.burst(G.world.byId(e.player).pos.clone().setY(1), def.color, 24, 5, 5);
        if (isMe || G.mode === 'local2p') callout(def.name.toUpperCase(), 'muted');
        break;
      }
      case 'powerupSpawn': audio.tone(1040, .12, 'sine', .035); break;
      case 'score': onScore(e); break;
      case 'suddenDeath': callout(pick(CALLOUTS.suddenDeath), 'muted'); audio.drum(); break;
      case 'callout': callout(e.text, e.kind || ''); break;
      case 'play': show('countdown', false); audio.tone(720, .3, 'triangle', .08); break;
      case 'resume': cameraRig.stopCinematic(); G.timeScale = 1; break;
      case 'ended': finishGame(); break;
      default: break;
    }
  }
}

function onScore(e) {
  const team = e.team;
  const big = e.kind === 'ring';
  const ringSide = e.ringSide ?? (team === 'balam' ? 1 : -1);
  const ringCenter = RINGS[ringSide > 0 ? 0 : 1].center;
  const goal = goals.find((g) => g.side === ringSide);
  if (big) {
    flash();
    particles.burst(ringCenter, 0xffd34e, 70, 9, 7);
    particles.burst(ringCenter, TEAMS[team].color, 40, 7, 6);
    cameraRig.impact(.45);
    cameraRig.startCinematic(ringCenter, ringSide);
    G.timeScale = .3; G.slowmo = 1.1;
    goal.light.intensity = 40; goal.halo.material.opacity = 1;
    audio.ring();
    audio.crowd(1);
    G.excitement = 1;
    const label = G.mode === 'ringhunt' && e.combo > 1 ? `RING! COMBO ×${Math.min(e.combo, 4)}` : pick(CALLOUTS.ring);
    callout(label, 'score');
  } else {
    audio.score(); audio.crowd(.5); G.excitement = .6;
    particles.burst(G.world.ball.pos, TEAMS[team].color, 26, 6, 5);
    cameraRig.impact(.2);
    const text = e.kind === 'doubleBounce' ? pick(CALLOUTS.doubleBounce) : pick(CALLOUTS.backline);
    callout(`${TEAMS[team].name.toUpperCase()}: ${text}`, team);
  }
  updateHUD();
}

// ------------------------------------------------------------ finishing
function finishGame(reason) {
  const m = G.match;
  resetInput();
  for (const id of ['pause-btn', 'hint', 'touch-controls', 'tutorial']) $(id).classList.add('hidden');
  m.phase = 'ended';
  show('endscreen', true);
  cameraRig.stopCinematic();
  G.timeScale = 1;
  const stats = m.stats;
  const statHTML = (items) => items.map(([label, value]) => `<div><b>${value}</b>${label}</div>`).join('');
  if (G.mode === 'ringhunt') {
    const best = Math.max(Number(localStorage.getItem('ssl-best-ringhunt') || 0), m.score.balam);
    localStorage.setItem('ssl-best-ringhunt', best);
    $('end-mode').textContent = 'RING HUNT COMPLETE'; $('end-title').textContent = `${m.score.balam} POINTS`;
    $('end-sub').textContent = m.score.balam >= best && m.score.balam > 0 ? 'New best — your name is carved into the sun-stone.' : `Best: ${best}`;
    $('end-stats').innerHTML = statHTML([['RINGS', stats.rings], ['BEST COMBO', stats.longestCombo], ['STRIKES', stats.strikes]]);
  } else if (G.mode === 'practice' || reason === 'practice') {
    $('end-mode').textContent = 'PRACTICE COMPLETE'; $('end-title').textContent = 'READY FOR THE COURT';
    $('end-sub').textContent = 'You know the moves. Take on a Ballcourt Match.';
    $('end-stats').innerHTML = statHTML([['RINGS', stats.rings], ['STRIKES', stats.strikes], ['TACKLES', stats.tackles]]);
  } else {
    const winner = m.winner || (m.score.balam > m.score.kuk ? 'balam' : 'kuk');
    const myTeam = G.world.byId(controlledId())?.team;
    const won = G.mode === 'local2p' ? null : winner === myTeam;
    if (won) localStorage.setItem('ssl-wins', Number(localStorage.getItem('ssl-wins') || 0) + 1);
    $('end-mode').textContent = 'THE MATCH IS DECIDED';
    $('end-title').textContent = G.mode === 'local2p' ? `${TEAMS[winner].name.toUpperCase()} WINS` : won ? 'VICTORY' : 'DEFEAT';
    $('end-sub').textContent = `Balam ${m.score.balam} — ${m.score.kuk} K'uk'`;
    $('end-stats').innerHTML = statHTML([['RINGS', stats.rings], ['STRIKES', stats.strikes], ['TACKLES', stats.tackles]]);
  }
  $('restart-btn').textContent = G.role === 'guest' ? 'Back to menu' : 'Play Again';
  audio.drum();
}

// ------------------------------------------------------------ networking
function closeNet() { if (G.net) { G.net.close(); G.net = null; } }
$('host-btn').addEventListener('click', async () => {
  audio.unlock(); closeNet();
  const status = $('online-status');
  status.innerHTML = 'Creating room…';
  $('host-btn').disabled = true;
  try {
    G.net = new NetSession();
    G.net.onClose = () => { if (G.mode === 'online') { callout('CONNECTION LOST', 'muted'); setTimeout(showMenu, 1500); } };
    const waiting = G.net.host();
    status.innerHTML = `Share this code with your friend:<div class="code">${G.net.code}</div>Waiting for them to join…`;
    await waiting;
    status.innerHTML = 'Friend connected! Starting…';
    G.net.onMessage = (data) => { if (data.t === 'in') G.guest.lastInput = data.i; };
    setTimeout(() => { startMode('online', { seed: Date.now() & 0xffff }); sendStart(); }, 600);
  } catch (error) { status.textContent = 'Could not create a room: ' + (error.message || error.type || 'unknown error'); closeNet(); }
  $('host-btn').disabled = false;
});
$('join-btn').addEventListener('click', async () => {
  audio.unlock(); closeNet();
  const code = $('join-code').value.trim().toUpperCase();
  const status = $('online-status');
  if (code.length < 4) { status.textContent = 'Enter the 5-letter room code.'; return; }
  status.textContent = 'Connecting…';
  $('join-btn').disabled = true;
  try {
    G.net = new NetSession();
    G.net.onClose = () => { if (G.mode === 'online') { callout('HOST LEFT', 'muted'); setTimeout(showMenu, 1500); } };
    G.net.onMessage = onGuestMessage;
    await G.net.join(code);
    status.textContent = 'Connected! Waiting for the host to start…';
  } catch (error) { status.textContent = 'Could not join: ' + (error.message || error.type || 'unknown error'); closeNet(); }
  $('join-btn').disabled = false;
});
function sendStart() { G.net?.send({ t: 'start', seed: G.world.seed, difficulty: $('difficulty').value }); }
function onGuestMessage(data) {
  if (data.t === 'start') { startMode('online', { guest: true, seed: data.seed }); G.guest.snapshots.length = 0; return; }
  if (data.t === 'st') {
    G.guest.snapshots.push({ at: performance.now(), s: data.s, m: data.m });
    if (G.guest.snapshots.length > 4) G.guest.snapshots.shift();
    if (data.ev?.length) present(data.ev);
    if (data.m.phase === 'ended' && G.match.phase !== 'ended') { G.match.applySnapshot(data.m); finishGame(); }
  }
}
let netAccumulator = 0;
function hostNetwork(dt, events) {
  if (!G.net?.conn) return;
  netAccumulator += dt;
  const important = events.filter((e) => !['bounce', 'wall'].includes(e.type));
  if (netAccumulator >= 1 / 20 || important.length) {
    netAccumulator = 0;
    G.net.send({ t: 'st', s: G.world.snapshot(), m: G.match.snapshot(), ev: important });
  }
  G.net.ping();
}
function guestNetwork() {
  if (!G.net?.conn) return;
  const input = readInput('p1', { facing: facingOf(controlledId()), touch, arrowsAsP1: true });
  G.net.send({ t: 'in', i: input });
  G.net.ping();
  const snaps = G.guest.snapshots;
  if (!snaps.length) return;
  const latest = snaps[snaps.length - 1];
  if (latest.applied !== true) { G.world.applySnapshot(latest.s); latest.applied = true; latest.ball = G.world.ball.pos.clone(); }
  // Snapshots arrive 20 times a second, so between them the guest advances the
  // ball along its last known velocity. Without this the ball visibly steps.
  const ahead = THREE.MathUtils.clamp((performance.now() - latest.at) / 1000, 0, .25);
  if (ahead > 0 && latest.ball) {
    const ball = G.world.ball;
    ball.pos.copy(latest.ball).addScaledVector(ball.vel, ahead);
    ball.pos.y += .5 * GRAVITY * ball.gravityScale * ahead * ahead;
    ball.pos.y = Math.max(ball.pos.y, BALL_RADIUS);
  }
  if (G.match.phase !== 'ended') {
    G.match.applySnapshot(latest.m);
    if (latest.m.phase === 'playing') show('countdown', false);
    else if (latest.m.phase === 'countdown') $('countdown-value').textContent = latest.m.countdown > .5 ? Math.ceil(latest.m.countdown) : 'PLAY';
  }
}

// ------------------------------------------------------------ main loop
setupInput(canvas, camera, () => controlled()?.pos);

function collectInputs() {
  const inputs = {};
  if (G.mode === 'local2p') {
    inputs['balam-striker'] = readInput('p1', { facing: 1, touch });
    inputs['kuk-striker'] = readInput('p2', { facing: -1 });
  } else if (G.role === 'host') {
    inputs['balam-striker'] = readInput('p1', { facing: 1, touch, arrowsAsP1: true });
    inputs['kuk-striker'] = G.guest.lastInput || EMPTY_INPUT;
  } else {
    inputs['balam-striker'] = readInput('p1', { facing: 1, touch, arrowsAsP1: true });
  }
  return inputs;
}

function tick() {
  requestAnimationFrame(tick);
  const rawDelta = clock.getDelta();
  const frameDt = Math.min(rawDelta, .1);
  const running = G.mode && !G.paused;
  if (G.slowmo > 0) { G.slowmo -= frameDt; if (G.slowmo <= 0) G.timeScale = 1; }
  const dt = running ? frameDt * G.timeScale : 0;
  G.elapsed += dt;
  G.excitement = Math.max(0, G.excitement - frameDt * .35);

  if (running && G.role !== 'guest') {
    const m = G.match;
    if (m.phase === 'countdown') $('countdown-value').textContent = m.countdown > .5 ? Math.ceil(m.countdown) : 'PLAY';
    const worldEvents = m.phase === 'playing' ? G.world.step(dt, collectInputs()) : [];
    const matchEvents = m.update(frameDt * (m.phase === 'goal' ? 1 : G.timeScale), worldEvents);
    const events = [...worldEvents, ...matchEvents].map(wire);
    present(events);
    if (G.mode === 'practice') tutorialTick(events);
    if (G.role === 'host') hostNetwork(frameDt, events);
    updateHUD();
  } else if (running && G.role === 'guest') {
    guestNetwork();
    updateHUD();
  } else if (!G.mode && G.world) {
    // Attract mode: AI plays itself behind the menu.
    const events = G.world.step(frameDt, {});
    for (const e of events) if (e.type === 'ring' || e.type === 'backline' || e.type === 'doubleBounce') G.world.resetPositions(0);
  }

  // ---- render sync
  const world = G.world;
  if (world) {
    updateBallVisual(ballMesh, world.ball.pos, world.ball.vel, frameDt, world.ball.lastTouch ? TEAMS[world.ball.lastTouch].color : 0xff9b20);
    powerupVisuals.sync(world.powerups, G.elapsed);
    for (const player of world.players) {
      const f = G.fighters.get(player.id); if (!f) continue;
      f.character.position.set(player.pos.x, 0, player.pos.z);
      f.character.rotation.y = player.facing;
      animateCharacter(f.rig, player.speed, player.swingTimer, frameDt, G.elapsed, { stun: player.stun, dash: player.dash, charge: player.charge });
      f.marker.material.opacity = G.localIds.includes(player.id) ? .5 : .22;
      f.marker.material.color.setHex(player.wind > 0 ? POWERUPS.wind.color : player.jaguar ? POWERUPS.jaguar.color : TEAMS[player.team].color);
      f.label.visible = !!G.mode && G.mode !== 'ringhunt' && G.mode !== 'practice';
    }
    // Goals: lit ring, shields, halo decay
    for (const goal of goals) {
      const lit = G.mode === 'ringhunt' && world.litRing === (goal.side > 0 ? 'north' : 'south');
      goal.halo.material.opacity = THREE.MathUtils.damp(goal.halo.material.opacity, lit ? .55 + Math.sin(G.elapsed * 6) * .25 : 0, lit ? 8 : 2.5, frameDt);
      goal.light.intensity = THREE.MathUtils.damp(goal.light.intensity, lit ? 10 : 0, 3, frameDt);
      goal.ringMat.emissiveIntensity = lit ? 1.4 : .5 + goal.light.intensity * .02;
      const shield = world.ball.shields[goal.team];
      goal.shield.material.opacity = THREE.MathUtils.damp(goal.shield.material.opacity, shield > 0 ? .18 + Math.sin(G.elapsed * 10) * .06 : 0, 8, frameDt);
    }
    const me = controlled();
    if (me && G.mode) {
      aimGroup.visible = true;
      aimGroup.position.set(me.pos.x, .035, me.pos.z); aimGroup.rotation.y = me.aim;
      const near = world.inRange(me);
      aimRing.material.color.setHex(near ? 0x7fffc8 : 0xffd34e); aimArrow.material.color.setHex(near ? 0x7fffc8 : 0xffd34e);
      aimRing.material.opacity = .45 + Math.sin(G.elapsed * 5) * .18 + (me.charge >= 0 ? me.charge * .3 : 0);
      aimGroup.scale.setScalar(me.charge >= 0 ? 1 + me.charge * .35 : 1);
    } else aimGroup.visible = false;
    const camPlayer = me || world.players[0];
    cameraRig.update(frameDt, { playerPos: camPlayer.pos, ballPos: world.ball.pos, facing: me ? TEAMS[me.team].attacks : 1, portrait: innerHeight > innerWidth, intro: !G.mode });
  }
  updateCourt(arena, G.elapsed || performance.now() / 1000, QUALITY[quality].crowd ? crowd : null, G.excitement);
  particles.update(frameDt);
  if (composer) composer.render(); else renderer.render(scene, camera);
}
tick();
// Debug handle for automated tests and self-hosted sessions.
if (import.meta.env?.DEV || /[?&](debug|peer)=/.test(location.search)) { window.__ssl = G; window.__scene = scene; window.__camera = camera; window.__THREE = THREE; }

// Keep the start-of-match world so the attract camera has something to look at.
G.world = new World({ mode: 'match', humans: [] });
rebuildFighters();
