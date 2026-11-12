import * as THREE from 'three';
import { addCinematics } from './cinematic.js';
import { addRuins } from './ruins.js';
import { createCourt, loadStoneTextures, loadEnvironment, loadIdol, updateCourt, addLighting } from './court.js';
import { loadCharacterModel, loadSkins, loadAnimations, spawnRoster, animateCharacter, createCharacter, pruneClips } from './characters.js';
import { ROSTER, DEFAULT_LOOK, lookById, savedLook, saveLook } from './roster.js';
import { loadFighters, playMove, reviveFighter } from './fighters.js';
import { DuelFx, NAWAL } from './duelfx.js';
import { addAtmosphere } from './atmosphere.js';
import { createRenderer, createComposer, createBall, updateBallVisual, Particles, PowerupVisuals, CameraRig, detectQuality, QUALITY } from './render.js';
import { setupInput, readInput, resetInput, isTouch } from './input.js';
import { World, EMPTY_INPUT } from './world.js';
import { Match } from './match.js';
import { NetSession } from './net.js';
import { mayaNumeralSVG, CALLOUTS, pick } from './maya.js';
import { TEAMS, POWERUPS, MODES, COURT_LENGTH, HIT_RANGE, DUEL } from './config.js';
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
// Very light haze only — the HDRI supplies the sky and the distance cue.
scene.fog = new THREE.FogExp2(0xe6c79c, .0085);  // matches the sky dome's horizon
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, .1, 420);
camera.position.set(0, 7, -16);
let composer = createComposer(renderer, scene, camera, quality);
const touch = isTouch();

// iOS often reports the old size when 'resize' fires mid-rotation, so the
// same handler also runs from visualViewport and a frame after an
// orientation change, and only does work when the size really changed.
let lastSize = '';
function onResize() {
  const w = innerWidth, h = innerHeight, ratio = Math.min(devicePixelRatio, QUALITY[quality].pixelRatio);
  const key = `${w}x${h}@${ratio}`;
  if (key === lastSize) return;
  lastSize = key;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setPixelRatio(ratio);
  renderer.setSize(w, h);
  composer?.setPixelRatio?.(ratio);
  composer?.setSize(w, h);
  if (composer?.userData.grade) composer.userData.grade.uniforms.aspect.value = w / h;
}
addEventListener('resize', onResize);
visualViewport?.addEventListener('resize', onResize);
addEventListener('orientationchange', () => { requestAnimationFrame(onResize); setTimeout(onResize, 300); });

const lights = addLighting(scene);
lights.sun.shadow.mapSize.setScalar(QUALITY[quality].shadowSize);
const ballMesh = createBall(scene);
const particles = new Particles(scene, QUALITY[quality].particles);
const powerupVisuals = new PowerupVisuals(scene);
const duelFx = new DuelFx(scene, particles);
const cameraRig = new CameraRig(camera);
const audio = new Audio();

const manager = new THREE.LoadingManager();
manager.onProgress = (_url, loaded, total) => { $('loadbar').style.width = `${Math.round(loaded / total * 100)}%`; };

// The stone maps and the sky have to be in hand before the arena is built,
// so the materials carry their textures from the first frame.
let arena = null, goals = [], crowd = [], idolMixers = [];
let cinematics = null;
let atmosphere = null;
const strikeBtn = document.getElementById('strike-btn');
let characterSource = null;
(async () => {
  try { await loadStoneTextures(manager); } catch { $('loading-note').textContent = 'Stone textures unavailable — using flat stone'; }
  try { await loadEnvironment(renderer, scene, manager); } catch { scene.background = new THREE.Color(0x24405e); }
  try { await loadIdol(manager); } catch { /* the temples simply stand bare */ }
  ({ arena, goals, crowd, idolMixers } = createCourt(scene, { animate: quality !== 'low', shadows: quality === 'high' }));
  if (!QUALITY[quality].crowd) for (const mesh of crowd) mesh.visible = false;
  try { addRuins(scene, quality); } catch (error) { console.warn('[sun-stone-league] ruins skipped:', error); }
  cinematics = await addCinematics(scene, lights, quality, manager).catch(() => null);
  try { atmosphere = addAtmosphere(scene, arena, lights.sun.position, quality); } catch (error) { console.warn('[sun-stone-league] atmosphere skipped:', error); }
  const missing = [];
  // The KayKit fighters are the cast; the older single mesh is only a fallback.
  const fighters = await loadFighters(manager).catch(() => false);
  if (!fighters) {
    try { await loadSkins(manager); } catch { missing.push('skins'); }
    try { await loadAnimations(manager); } catch { missing.push('animations'); }
    characterSource = await loadCharacterModel(manager, './assets/characters/player.glb').catch(() => null);
    if (!characterSource) missing.push('fighter model');
    pruneClips(characterSource);
  }
  // Don't fail silently: the fallbacks still produce a playable game, but the
  // blocky stand-in fighters look like a bug rather than a degraded asset load.
  if (missing.length) {
    G.assetWarning = `Running with stand-ins — could not load: ${missing.join(', ')}. Check your connection and reload.`;
    console.warn('[sun-stone-league]', G.assetWarning);
  }
  G.world = new World({ mode: 'match', humans: [] });
  rebuildFighters();
  $('loading').classList.add('depart');
  setTimeout(() => { $('loading').style.display = 'none'; }, 450);
  showMenu();
})();

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
  mode: null, world: null, match: null, fighters: new Map(), humans: [], localIds: [], look: savedLook(),
  net: null, role: 'local', paused: false, timeScale: 1, slowmo: 0, excitement: 0,
  guest: { snapshots: [], lastInput: null }, tutorial: null, elapsed: 0,
};
const clock = new THREE.Clock();

function controlledId() { return G.localIds[0]; }
function controlled() { return G.world?.byId(controlledId()); }
// In Ring Hunt the lit ring alternates ends, so "forward" follows it; every
// other mode faces the ring your team attacks.
function facingOf(id) {
  if (G.mode === 'ringhunt' && G.world) return G.world.litRing === 'north' ? 1 : -1;
  const p = G.world?.byId(id); return p ? TEAMS[p.team].attacks : 1;
}

// ------------------------------------------------------------ UI helpers
function show(id, on = true) { $(id).style.display = on ? 'flex' : 'none'; }
function callout(text, kind = '') {
  const element = $('callout'); element.textContent = text; element.className = kind;
  element.classList.remove('show'); requestAnimationFrame(() => element.classList.add('show'));
  clearTimeout(callout.timer); callout.timer = setTimeout(() => element.classList.remove('show'), kind === 'score' || text.length > 22 ? 1900 : 1100);
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
  if (G.assetWarning) $('records').textContent = G.assetWarning;
  closeNet();
  if (!G.world) { G.world = new World({ mode: 'match', humans: [] }); G.match = null; rebuildFighters(); }
}

// ------------------------------------------------------------ fighters (render side)
/**
 * Who wears what. Your pick goes on your fighter; everyone else wears their
 * team's regalia — unless your pick matches the rivals' look, in which case
 * they change into another fighter so you never face your own costume.
 */
function looksFor(players) {
  const looks = {};
  const mine = G.mode ? G.world.players.filter((p) => G.localIds.includes(p.id)) : [];
  const myTeam = mine[0]?.team;
  const used = new Set(mine.map(() => G.look));
  const spare = ROSTER.map((r) => r.id).filter((id) => !used.has(id) && !Object.values(DEFAULT_LOOK).includes(id));
  for (const p of players) {
    if (mine.length && p.id === mine[0].id) { looks[p.id] = G.look; continue; }
    let look = DEFAULT_LOOK[p.team];
    if (myTeam && p.team !== myTeam && look === G.look) look = spare[0] || look;
    looks[p.id] = look;
  }
  return looks;
}

/**
 * Free a fighter's GPU resources. Skinned meshes share geometry with the
 * source model and their maps are the shared costume skins, so only their
 * cloned materials go; labels, markers and headdresses are per-fighter.
 */
function disposeCharacter(root) {
  root.traverse((object) => {
    if (!object.isMesh && !object.isSprite) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      if (object.isSprite && material.map) material.map.dispose();
      material.dispose();
    }
    if (!object.isSkinnedMesh && !object.isSprite) object.geometry?.dispose();
  });
}
function rebuildFighters() {
  for (const fighter of G.fighters.values()) { scene.remove(fighter.character); disposeCharacter(fighter.character); }
  G.fighters.clear();
  const looks = looksFor(G.world.players);
  const { fighters } = spawnRoster(scene, characterSource, G.world.players, looks);
  for (const f of fighters) f.nawal = lookById(looks[f.id]).nawal;
  duelFx.clear();
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
  sprite.scale.set(1.3, .32, 1);
  return sprite;
}

// ------------------------------------------------------------ starting modes
function startMode(mode, options = {}) {
  G.mode = mode;
  const difficulty = $('difficulty').value;
  const humans = mode === 'local2p' ? ['balam-striker', 'kuk-striker'] : mode === 'online' ? ['balam-striker', 'kuk-striker'] : ['balam-striker'];
  G.localIds = mode === 'local2p' ? ['balam-striker', 'kuk-striker'] : mode === 'online' ? [options.guest ? 'kuk-striker' : 'balam-striker'] : ['balam-striker'];
  G.world = new World({ mode: mode === 'local2p' || mode === 'online' ? 'match' : mode, difficulty, seed: options.seed ?? (Date.now() & 0xffff), humans });
  G.world.humanAssistFloor = touch && mode !== 'online' ? .72 : 0;
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
  $('label-balam').textContent = mode === 'ringhunt' ? 'Score' : mode === 'practice' ? 'Rings' : G.role === 'guest' ? 'Host' : mode === 'local2p' ? 'P1' : 'You';
  $('label-kuk').textContent = mode === 'local2p' ? 'P2' : G.role === 'guest' ? 'You' : G.role === 'host' ? 'Guest' : 'Rivals';
  $('center-label').textContent = mode === 'practice' ? 'Practice' : 'Time';
  $('sub-label').textContent = mode === 'match' ? `first to ${MODES.match.target}` : mode === 'ringhunt' ? 'lit ring only' : '';
  $('combo').classList.toggle('hidden', mode !== 'ringhunt');
  $('hint').classList.toggle('hidden', mode === 'practice');
  $('tutorial').classList.toggle('hidden', mode !== 'practice');
  $('hint').textContent = touch ? 'Stick: move · hold STRIKE to power up, release when it glows · LOB for rings · TACKLE to steal' : 'WASD move · hold Space / click to charge, release near the ball · E lob for rings · Q tackle';
  // The control reminder fades once you have had time to read it.
  $('hint').classList.remove('faded');
  clearTimeout(G.hintTimer);
  G.hintTimer = setTimeout(() => $('hint').classList.add('faded'), 9000);
  if (mode === 'practice') startTutorial();
  // Duel presentation: fighting-game HUD and the duel button set.
  const duel = mode === 'duel';
  $('duel-hud').classList.toggle('hidden', !duel);
  $('hud').classList.toggle('hidden', duel);
  $('touch-controls').classList.toggle('duel', duel);
  $('lob-btn').textContent = duel ? 'FIRE' : 'LOB';
  if (duel) {
    const me = G.world.byId('balam-striker'), rival = G.world.byId('kuk-striker');
    const looks = looksFor(G.world.players);
    $('duel-name-a').textContent = lookById(looks[me.id]).name;
    $('duel-name-b').textContent = lookById(looks[rival.id]).name;
    $('hint').textContent = touch
      ? 'Tap STRIKE: chain blows · hold: heavy · FIRE: blast · GUARD: block · ball in reach: throw it at them · fill the bar: NAWAL'
      : 'Space: blows (hold = heavy) · E: fire blast · R: guard · Q: tackle · V: spirit form when the bar is full';
    G.duelFx = { lagA: 1, lagB: 1 };
  }
  G.match.countdown = 3;
  show('countdown', true); $('countdown-value').textContent = '3';
  audio.tone(480, .12);
  cameraRig.stopCinematic();
  cameraRig.snap();
  G.hitstop = 0; G.slowmo = 0; G.timeScale = 1;
  canvas.focus();
  updateHUD(true);
}

document.querySelectorAll('.mode-btn').forEach((button) => button.addEventListener('click', () => {
  audio.unlock();
  // On a phone that allows it, starting a game also goes full screen.
  if (touch && document.fullscreenEnabled && !document.fullscreenElement) {
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  }
  const mode = button.dataset.mode;
  if (mode === 'online') { show('menu', false); show('online', true); $('online-status').textContent = ''; return; }
  startMode(mode);
}));
$('restart-btn').addEventListener('click', () => { if (G.role === 'guest') { showMenu(); return; } startMode(G.mode); if (G.role === 'host') sendStart(); });
$('menu-btn').addEventListener('click', showMenu);
$('quit-btn').addEventListener('click', showMenu);
// ------------------------------------------------------------ fighter select
// A turntable preview drawn into the stage area with a scissored viewport on
// the main renderer, so it needs no second WebGL context on the phone.
const picker = { open: false, id: G.look, scene: null, camera: null, model: null, spin: 0 };
function refreshFighterButton() {
  const look = lookById(G.look);
  $('fighter-name').textContent = look.name; $('fighter-title').textContent = look.title;
  $('fighter-swatch').style.background = `conic-gradient(${look.swatch[0]} 0 50%, ${look.swatch[1]} 0 80%, ${look.swatch[2]} 0)`;
}
function buildPickerCards() {
  $('fighter-cards').innerHTML = ROSTER.map((r) => `<button class="fighter-card" role="option" data-id="${r.id}" aria-selected="false"><span class="fighter-swatch" style="background:conic-gradient(${r.swatch[0]} 0 50%, ${r.swatch[1]} 0 80%, ${r.swatch[2]} 0)"></span>${r.name}</button>`).join('');
  $('fighter-cards').querySelectorAll('.fighter-card').forEach((card) => card.addEventListener('click', () => selectPick(card.dataset.id)));
}
function selectPick(id) {
  picker.id = id;
  const look = lookById(id);
  $('pick-name').textContent = look.name; $('pick-title').textContent = look.title; $('pick-blurb').textContent = look.blurb;
  $('fighter-cards').querySelectorAll('.fighter-card').forEach((card) => card.setAttribute('aria-selected', String(card.dataset.id === id)));
  if (!picker.scene) {
    picker.scene = new THREE.Scene();
    picker.scene.environment = scene.environment;
    picker.scene.add(new THREE.HemisphereLight(0x9fc0e0, 0x5a3c22, .9));
    const key = new THREE.DirectionalLight(0xffd29a, 2.4); key.position.set(-3, 5, 4); picker.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 1.6); rim.position.set(3, 3, -4); picker.scene.add(rim);
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, .3, 32), new THREE.MeshStandardMaterial({ color: 0x8a7556, roughness: .9 }));
    plinth.position.y = -.15; picker.scene.add(plinth);
    picker.camera = new THREE.PerspectiveCamera(30, 1, .1, 50);
  }
  if (picker.model) { picker.scene.remove(picker.model); disposeCharacter(picker.model); }
  picker.model = createCharacter(characterSource, { team: 'balam' }, id);
  picker.scene.add(picker.model);
  // Stand the fighter on the plinth whatever pose the rig rests in.
  picker.model.userData.rig?.mixer?.update(.01);
  picker.model.updateMatrixWorld(true);
  picker.model.position.y -= new THREE.Box3().setFromObject(picker.model, true).min.y;
}
function openPicker() {
  picker.open = true; show('menu', false); show('fighters', true);
  selectPick(G.look);
}
function closePicker(confirm) {
  if (confirm) { G.look = picker.id; saveLook(G.look); refreshFighterButton(); if (!G.mode && G.world) rebuildFighters(); }
  picker.open = false; show('fighters', false); show('menu', true);
}
function renderPicker(dt) {
  if (!picker.open || !picker.model) return;
  const rect = $('fighter-stage').getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) return;
  picker.spin += dt * .5;
  picker.model.rotation.y = (picker.model.userData.rig?.kind === 'clip' ? 0 : Math.PI) + Math.sin(picker.spin) * .8;  // face the viewer, then sway
  picker.model.userData.rig?.mixer?.update(dt);
  const cam = picker.camera;
  cam.aspect = rect.width / rect.height;
  const fit = cam.aspect < .8 ? 8.4 : 6.4;
  cam.position.set(0, 1.5, fit); cam.lookAt(0, 1.15, 0); cam.updateProjectionMatrix();
  const y = innerHeight - rect.bottom;
  renderer.setScissorTest(true);
  renderer.setScissor(rect.left, y, rect.width, rect.height);
  renderer.setViewport(rect.left, y, rect.width, rect.height);
  renderer.setClearColor(0x1a0e07, 1);
  renderer.clear();
  // The composer normally tone-maps in its output pass; a direct render
  // needs the renderer to do it.
  const toneMapping = renderer.toneMapping;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.render(picker.scene, cam);
  renderer.toneMapping = toneMapping;
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, innerWidth, innerHeight);
}
buildPickerCards();
refreshFighterButton();
$('fighter-btn').addEventListener('click', openPicker);
$('pick-confirm').addEventListener('click', () => closePicker(true));
$('pick-cancel').addEventListener('click', () => closePicker(false));
// ------------------------------------------------------------ full screen
// Real full screen where the browser allows it (Android, iPad, desktop), with
// the phone locked to landscape. iPhone Safari does not offer full screen to
// web pages at all, and an embedded page usually cannot ask for it either, so
// there the button explains the Home Screen route instead: installed from
// Safari, the game launches with no browser bars (see manifest.webmanifest).
const standalone = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone;
async function goFullscreen() {
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  if (request && (document.fullscreenEnabled || document.webkitFullscreenEnabled)) {
    try {
      await request.call(root, { navigationUI: 'hide' });
      try { await screen.orientation?.lock?.('landscape'); } catch { /* not every device allows a lock */ }
      setTimeout(onResize, 120);
      return;
    } catch { /* fall through to the help sheet */ }
  }
  const iPhone = /iPhone|iPod/.test(navigator.userAgent);
  $('fs-help-text').textContent = iPhone
    ? 'iPhone doesn\u2019t let web pages go full screen, and this view can\u2019t ask for it. Install the game to your Home Screen instead:'
    : 'This view can\u2019t switch to full screen. Open the game in your browser, or install it:';
  show('fs-help', true);
}
function toggleFullscreen() {
  if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else goFullscreen();
}
for (const id of ['fullscreen-btn', 'fullscreen-btn-2']) $(id).addEventListener('click', toggleFullscreen);
if (standalone) { $('fullscreen-btn').style.display = 'none'; $('fullscreen-btn-2').style.display = 'none'; }
$('fs-help-close').addEventListener('click', () => show('fs-help', false));
document.addEventListener('fullscreenchange', () => setTimeout(onResize, 60));
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
  { text: () => touch ? 'Press TACKLE to shoulder-charge. It knocks rivals down and steals the ball.' : 'Press Q to shoulder-charge. It knocks rivals down and steals the ball.', done: (t) => t.tackles >= 1 },
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
const duelHudCache = {};
function setIf(key, apply, value) { if (duelHudCache[key] !== value) { duelHudCache[key] = value; apply(value); } }
function updateDuelHUD(force) {
  const m = G.match, world = G.world;
  const a = world.byId('balam-striker'), b = world.byId('kuk-striker');
  if (force) for (const k of Object.keys(duelHudCache)) delete duelHudCache[k];
  for (const [p, side] of [[a, 'a'], [b, 'b']]) {
    const frac = Math.max(0, p.hp / DUEL.hp);
    setIf('hp' + side, (v) => { $('hp-' + side).style.transform = `scaleX(${v})`; $('hp-' + side).classList.toggle('low', v < .3); }, frac.toFixed(3));
    setIf('lag' + side, (v) => { $('hp-lag-' + side).style.transform = `scaleX(${v})`; }, frac.toFixed(2));
    setIf('meter' + side, (v) => { $('meter-' + side).style.width = v + '%'; $('meter-' + side).classList.toggle('full', v >= 100); }, Math.round(p.spirit > 0 ? p.spirit / DUEL.spiritTime * 100 : p.meter));
    setIf('pips' + side, (v) => { $('pips-' + side).innerHTML = Array.from({ length: MODES.duel.target }, (_, i) => `<i class="${i < v ? 'won' : ''}"></i>`).join(''); }, m.score[p.team]);
  }
  setIf('time', (v) => { $('duel-time').textContent = v; }, Math.ceil(m.timeLeft));
  setIf('round', (v) => { $('duel-round').textContent = `ROUND ${v}`; }, m.round);
  const me = controlled();
  if (me) setIf('spiritReady', (v) => $('spirit-btn').classList.toggle('ready', v), me.meter >= 100 && me.spirit <= 0);
}

function updateHUD(force = false) {
  const m = G.match; if (!m) return;
  if (G.mode === 'duel') { updateDuelHUD(force); return; }
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
  for (const key of ['kind', 'power', 'big', 'side', 'points', 'combo', 'text', 'winner', 'team', 'damage', 'blocked', 'how', 'round', 'ringSide', 'id', 'melee']) if (event[key] !== undefined) out[key] = event[key];
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
        const f = G.fighters.get(e.player); if (f) { f.lastStrike = G.elapsed; playMove(f.rig, e.kind === 'lob' ? 'lob' : 'kick', { speed: 1.6 }); }
        if (isMe || e.big) G.hitstop = e.big ? .12 : .035 + e.power * .06;
        break;
      }
      case 'hit': onDuelHit(e, pos, isMe); break;
      case 'ko': {
        const victim = G.fighters.get(e.victim);
        playMove(victim?.rig, 'death', { hold: true });
        flash(); callout('K.O.!', 'score'); audio.ring(); audio.crowd(1);
        G.timeScale = .3; G.slowmo = 1.4; cameraRig.impact(.6);
        break;
      }
      case 'blast': {
        const f = G.fighters.get(e.player); playMove(f?.rig, 'blast', { speed: 1.8 });
        audio.tone(180, .25, 'sawtooth', .06); particles.burst(pos, 0xff7a1a, 14, 4, 3);
        break;
      }
      case 'blastEnd': particles.burst(pos, 0xffa040, 18, 5, 4); duelFx.drop(e.id); break;
      case 'blastBall': audio.tone(300, .12, 'square', .05); break;
      case 'transform': {
        const f = G.fighters.get(e.player);
        const spirit = NAWAL[f?.nawal] || NAWAL.jaguar;
        playMove(f?.rig, 'transform', { speed: 2 });
        const at = G.world.byId(e.player).pos.clone().setY(1.1);
        particles.burst(at, spirit.glow, 60, 8, 6); particles.burst(at, 0xffffff, 20, 5, 4);
        duelFx.shockwave(at.clone().setY(.08), spirit.glow, 6);
        flash(); cameraRig.impact(.5); audio.drum(); audio.crowd(.8);
        callout(`NAWAL — ${spirit.name.toUpperCase()}!`, e.team);
        G.hitstop = .15;
        break;
      }
      case 'spiritEnd': { const at = G.world.byId(e.player).pos.clone().setY(1); particles.burst(at, 0xd9b3ff, 24, 5, 4); break; }
      case 'sunRing': flash(); callout('SUN-STONE FINISHER!', 'score'); audio.ring(); G.timeScale = .35; G.slowmo = .8; break;
      case 'roundOver': {
        if (e.how === 'time') callout('TIME!', 'score');
        const roundText = !e.team ? 'DRAW' : controlled()?.team === e.team ? `YOU TAKE ROUND ${e.round}` : `RIVAL TAKES ROUND ${e.round}`;
        setTimeout(() => { if (G.mode === 'duel' && G.match?.phase === 'goal' && !G.match.winner) callout(roundText, e.team || 'muted'); }, 1300);
        if (e.winner) for (const f of G.fighters.values()) if (f.team === e.winner) setTimeout(() => playMove(f.rig, 'cheer'), 1200);
        break;
      }
      case 'round': {
        for (const f of G.fighters.values()) reviveFighter(f.rig);
        duelFx.clear();
        callout(`ROUND ${e.round}`, 'score'); show('countdown', true);
        break;
      }
      case 'whiff': if (isMe) { audio.tone(90, .08, 'square', .03); if (G.elapsed - (present.lastWhiff || -9) > 4 && (!G.tutorial || G.tutorial.step >= 1)) { present.lastWhiff = G.elapsed; callout('TOO FAR — GET NEXT TO THE BALL', 'muted'); } } break;
      case 'tackle': playMove(G.fighters.get(e.player)?.rig, 'dash', { speed: 1.4 }); audio.tackle(); if (e.player) particles.burst(G.world.byId(e.player).pos.clone().setY(.6), 0xffffff, 8, 3, 2); break;
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
      case 'play': if (G.mode === 'duel') callout('FIGHT!', 'score'); show('countdown', false); audio.tone(720, .3, 'triangle', .08); break;
      case 'resume': cameraRig.stopCinematic(); G.timeScale = 1; break;
      case 'ended': finishGame(); break;
      default: break;
    }
  }
}

// A landed (or blocked) blow in a duel: reaction animation, sparks, weight.
function onDuelHit(e, pos, isMe) {
  const attacker = G.fighters.get(e.player), victim = G.fighters.get(e.victim);
  const byMe = isMe, toMe = G.localIds.includes(e.victim);
  if (attacker && (e.kind === 'light' || e.kind === 'finisher' || e.kind === 'heavy' || e.kind === 'super' || e.kind === 'guardbreak')) {
    const p = G.world.byId(e.player);
    const move = e.kind === 'light' ? (p.chain === 2 ? 'punchB' : 'punchA') : e.kind === 'finisher' ? 'kick' : 'spin';
    playMove(attacker.rig, move, { speed: e.kind === 'light' ? 1.8 : 1.3 });
  }
  if (e.blocked) {
    playMove(victim?.rig, 'blockHit', { speed: 1.5 });
    particles.burst(pos, 0x9fd8ff, e.kind === 'guardbreak' ? 30 : 10, 4, 3);
    audio.tone(e.kind === 'guardbreak' ? 160 : 520, .1, 'square', .05);
    if (e.kind === 'guardbreak') callout('GUARD BREAK!', e.team);
    if (e.kind === 'parry') callout('TURNED ASIDE!', e.team);
    return;
  }
  const big = e.damage >= 14 || e.kind === 'super' || e.kind === 'ring';
  playMove(victim?.rig, big ? 'hitB' : 'hitA', { speed: 1.6 });
  const color = e.kind === 'blast' ? 0xff7a1a : e.kind === 'super' ? 0xd9b3ff : 0xfff1c8;
  particles.burst(pos, color, 10 + Math.min(40, e.damage * 2), big ? 7 : 4, big ? 5 : 3);
  audio.hit(); if (big) audio.drum();
  cameraRig.impact(big ? .35 : .1);
  G.hitstop = Math.max(G.hitstop || 0, big ? .1 : .045);
  if (big) duelFx.shockwave(pos.clone().setY(.08), color);
  if (e.kind === 'super') { flash(); callout('NAWAL MAUL!', e.team); }
  else if (e.kind === 'finisher' && (byMe || toMe)) callout(byMe ? 'COMBO!' : 'COMBO TAKEN', e.team);
  else if (e.kind === 'ball' && big) callout('BALL TO THE BODY!', e.team);
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
    // Say why the point was given: the rules were the main thing players
    // found hard to follow.
    const me = controlled();
    const mine = me ? me.team === team : team === 'balam';
    const who = !me && G.mode !== 'local2p' ? TEAMS[team].name.toUpperCase() : mine || G.mode === 'local2p' ? `+1 ${TEAMS[team].name.toUpperCase()}` : '+1 RIVALS';
    const why = e.kind === 'doubleBounce'
      ? (mine ? 'it bounced twice on their side' : 'it bounced twice on your side')
      : (mine ? 'it reached their back zone' : 'it reached your back zone');
    callout(G.mode === 'local2p' ? `${who} — ${e.kind === 'doubleBounce' ? 'double bounce' : 'back zone'}` : `${who} — ${why}`, `${team} explain`);
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
    G.net.onMessage = (data) => { if (data.t === 'in') { G.guest.lastInput = data.i; G.guest.inputAt = performance.now(); } };
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
// The data channel is unreliable (it carries 20 Hz snapshots), so the start
// message is repeated; the guest ignores copies for a match it already began.
function sendStart() {
  const msg = { t: 'start', seed: G.world.seed, difficulty: $('difficulty').value };
  for (const delay of [0, 250, 700, 1500]) setTimeout(() => G.net?.send(msg), delay);
}
function onGuestMessage(data) {
  if (data.t === 'start') {
    if (G.mode === 'online' && G.world?.seed === data.seed && G.match?.phase !== 'ended') return;   // a repeat
    startMode('online', { guest: true, seed: data.seed }); G.guest.snapshots.length = 0; return;
  }
  // Every start copy lost: the first snapshot is enough to join the match.
  if (data.t === 'st' && G.mode !== 'online') startMode('online', { guest: true, seed: data.s?.seed ?? 1 });
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
  const input = readInput('p1', { facing: facingOf(controlledId()), yaw: G.mode === 'duel' ? cameraRig.floorYaw : null, touch, arrowsAsP1: true });
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
    // A guest who backgrounds the app stops sending; don't keep running their
    // fighter on the last stick position.
    const fresh = performance.now() - (G.guest.inputAt || 0) < 300;
    inputs['kuk-striker'] = (fresh && G.guest.lastInput) || EMPTY_INPUT;
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
  // Everything that should freeze on pause runs on liveDt.
  const liveDt = G.paused ? 0 : frameDt;
  if (G.slowmo > 0) { G.slowmo -= liveDt; if (G.slowmo <= 0) G.timeScale = 1; }
  // Hit-stop: a few frames of frozen time on a strike sell its weight.
  const frozen = G.hitstop > 0; if (frozen) G.hitstop -= frameDt;
  const dt = running && !frozen ? frameDt * G.timeScale : 0;
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
    if (G.mode === 'duel') duelFx.syncBlasts(world.projectiles, frameDt);
    for (const player of world.players) {
      const f = G.fighters.get(player.id); if (!f) continue;
      f.character.position.set(player.pos.x, 0, player.pos.z);
      f.character.rotation.y = player.facing;
      animateCharacter(f.rig, player.speed, player.swingTimer, liveDt, G.elapsed, { stun: player.stun, dash: player.dash, charge: player.charge, facing: player.facing, guard: player.guard, combat: G.mode === 'duel' });
      f.marker.material.opacity = G.localIds.includes(player.id) ? .5 : .22;
      f.marker.material.color.setHex(player.wind > 0 ? POWERUPS.wind.color : player.jaguar ? POWERUPS.jaguar.color : TEAMS[player.team].color);
      // Role tags only on fighters out in the court: one standing by the lens
      // would fill the screen, and your own needs no tag.
      const camDist = camera.position.distanceTo(f.character.position);
      const me0 = G.world.byId(controlledId());
      if (G.mode === 'duel') duelFx.syncSpirit(f, player, liveDt, G.elapsed);
      // A teammate standing right at the lens would fill the screen.
      else f.character.visible = camDist > 2.8 || G.localIds.includes(player.id);
      f.label.visible = !!G.mode && G.mode !== 'ringhunt' && G.mode !== 'practice' && G.mode !== 'duel' && !G.localIds.includes(player.id) && camDist > 9 && !(me0 && player.team === me0.team && G.mode === 'match');
      f.label.material.opacity = Math.min(.85, (camDist - 9) / 4);
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
      strikeBtn.classList.toggle('ready', near);
      strikeBtn.style.setProperty('--charge', me.charge >= 0 ? me.charge.toFixed(2) : 0);
      aimRing.material.color.setHex(near ? 0x7fffc8 : 0xffd34e); aimArrow.material.color.setHex(near ? 0x7fffc8 : 0xffd34e);
      aimRing.material.opacity = .45 + Math.sin(G.elapsed * 5) * .18 + (me.charge >= 0 ? me.charge * .3 : 0);
      aimGroup.scale.setScalar(me.charge >= 0 ? 1 + me.charge * .35 : 1);
    } else aimGroup.visible = false;
    const camPlayer = me || world.players[0];
    cameraRig.update(liveDt, { playerPos: camPlayer.pos, ballPos: world.ball.pos, facing: me ? facingOf(me.id) : 1, intro: !G.mode, rivalPos: G.mode === 'duel' && me ? world.opponents(me)[0]?.pos : null });
  }
  if (arena) updateCourt(arena, G.elapsed || performance.now() / 1000, QUALITY[quality].crowd ? crowd : null, G.excitement, idolMixers, frameDt);
  particles.update(frameDt);
  const now = performance.now() / 1000;
  cinematics?.update(frameDt, now);
  atmosphere?.update(frameDt, now);
  duelFx.updateRings(frameDt);
  if (composer?.userData.grade) composer.userData.grade.uniforms.time.value = now % 100;
  if (composer) composer.render(); else renderer.render(scene, camera);
  renderPicker(frameDt);
}
tick();
// Debug handle for automated tests and self-hosted sessions.
if (import.meta.env?.DEV || /[?&](debug|peer)=/.test(location.search)) { window.__ssl = G; window.__scene = scene; window.__camera = camera; window.__THREE = THREE; window.__rig = cameraRig; }
