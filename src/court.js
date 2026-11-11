import * as THREE from 'three';
import { generateStoneMaps } from './stonegen.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { WALL_HEIGHT, COURT_LENGTH, COURT_WIDTH, RING_HEIGHT, RING_RADIUS, RING_TUBE, RING_INSET, BACK_ZONE, TEAMS } from './config.js';

export { WALL_HEIGHT, COURT_LENGTH, COURT_WIDTH, RING_HEIGHT, RING_RADIUS, RING_TUBE };

// Cross-section of one side of the ballcourt, in metres from the centre line.
// A Maya court is a flat alley flanked by a sloping bench (talud), a vertical
// upper wall, and a terrace walk above that — this profile is extruded along
// the court so the whole flank is one piece of stone.
const BENCH_TOP = 2.6;
const BENCH_OUT = 9.3;
const WALL_OUT = 9.9;
const TERRACE_OUT = 13.6;

const palette = {
  stone: 0xa7906b,
  stoneWarm: 0x8f7752,
  stoneDark: 0x8d7a5c,
  jade: 0x16614f,
  gold: 0xf0a62c,
  red: 0xb23a2e,
};

// ---------------------------------------------------------------- materials
let MAPS = null;

/**
 * Builds the masonry maps procedurally (see src/stonegen.js). Kept async and
 * named as before so callers do not change; nothing is downloaded.
 */
export async function loadStoneTextures() {
  MAPS = generateStoneMaps(1024);
  return MAPS;
}

/** A stone material with its own tiling. Falls back to flat colour if the maps are unavailable. */
export function stoneMaterial({ repeat = [1, 1], color = palette.stone, bumpScale = .055, roughness = .95 } = {}) {
  if (!MAPS) return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
  const clone = (texture) => { const t = texture.clone(); t.needsUpdate = true; t.repeat.set(repeat[0], repeat[1]); return t; };
  return new THREE.MeshStandardMaterial({
    // The baked albedo already carries the limestone colour, so the tint is
    // pulled toward white — it only nudges warm/cool between surfaces.
    color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), .55),
    map: clone(MAPS.albedo),
    bumpMap: clone(MAPS.bump),
    bumpScale,
    roughnessMap: clone(MAPS.roughness),
    roughness,
    metalness: 0,
  });
}

function plain(color, roughness = .9) { return new THREE.MeshStandardMaterial({ color, roughness, metalness: .02 }); }

function box(parent, size, position, material, cast = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------- environment
export async function loadEnvironment(renderer, scene, manager) {
  // Prefer the real HDR for true high-range sun and reflections. Some static
  // hosts refuse to serve .hdr at all, so fall back to a tone-mapped WebP of
  // the same sky — the lighting is slightly flatter but everything still works.
  //
  // The file is probed first rather than simply letting the load fail: handing
  // a 404 body to the HDR parser throws from inside the loader's own callback,
  // which escapes as an uncaught error that no try/catch here can see.
  const HDR = './assets/env/spruit_sunrise_1k.hdr';
  let hdrAvailable = false;
  try {
    const response = await fetch(HDR, { method: 'HEAD' });
    hdrAvailable = response.ok && !/text\/html/i.test(response.headers.get('content-type') || '');
  } catch { hdrAvailable = false; }

  let texture;
  if (hdrAvailable) {
    texture = await new RGBELoader(manager).loadAsync(HDR);
  } else {
    texture = await new THREE.TextureLoader(manager).loadAsync('./assets/env/sky_equirect.webp');
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  texture.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envMap = pmrem.fromEquirectangular(texture).texture;
  scene.environment = envMap;
  scene.environmentIntensity = .45;
  // The sky photograph is NOT used as the backdrop: it is a real field, and
  // from a high camera its electricity pylons sit on the horizon of a Maya
  // ballcourt. Its light is what we want, so it stays as the environment map
  // while a painted dusk dome provides everything the player actually sees.
  scene.background = null;
  addSkyDome(scene);
  texture.dispose();
  pmrem.dispose();
  return envMap;
}

/** Painted late-afternoon sky: a gradient dome, haze band and the sun. */
function addSkyDome(scene) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 20), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x3d6fa8) },
      horizonColor: { value: new THREE.Color(0xf0c48c) },
      groundColor: { value: new THREE.Color(0x6b5236) },
      sunDir: { value: new THREE.Vector3(-26, 20, -22).normalize() },
    },
    vertexShader: 'varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      varying vec3 vPos; uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 groundColor; uniform vec3 sunDir;
      void main(){
        vec3 d = normalize(vPos);
        // A tight horizon band: spread over the whole upper hemisphere the
        // gradient reads as one flat orange wash at eye level.
        vec3 sky = d.y > 0.0
          ? mix(horizonColor, topColor, pow(smoothstep(0.0, 0.34, d.y), 0.7))
          : mix(horizonColor, groundColor, smoothstep(0.0, -0.18, d.y));
        // Soft cloud banding, enough to keep the dome from looking painted flat.
        float band = sin(d.y * 26.0 + d.x * 2.2) * sin(d.y * 11.0 - d.z * 1.7);
        sky += vec3(1.0, 0.72, 0.45) * smoothstep(0.35, 1.0, band) * 0.10 * smoothstep(0.42, 0.04, abs(d.y));
        // Warm glow around the sun, and the disc itself just above the horizon.
        float toSun = max(dot(d, sunDir), 0.0);
        sky += vec3(1.0, 0.55, 0.18) * pow(toSun, 7.0) * 0.55;
        sky += vec3(1.0, 0.86, 0.6) * smoothstep(0.9975, 0.9992, toSun);
        gl_FragColor = vec4(sky, 1.0);
      }`,
  }));
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);
}

// ---------------------------------------------------------------- the idol
// A colossal figure of the Master Architect crowns each temple, looking down
// the alley at the players. He is a bust, so he is set into the temple's
// upper platform from the chest down — which is how such a figure would be
// mounted anyway.
let IDOL = null;

export async function loadIdol(manager, url = './assets/props/idol.glb') {
  const gltf = await new GLTFLoader(manager).loadAsync(url);
  IDOL = gltf;
  return gltf;
}

function addIdol(group, sign, { animate = true, shadows = false } = {}) {
  if (!IDOL) return null;
  const model = cloneSkinned(IDOL.scene);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = 7.2 / Math.max(size.y, .001);
  model.scale.setScalar(scale);
  // Re-measure after scaling so he sits on the platform rather than through it.
  const scaled = new THREE.Box3().setFromObject(model);
  model.position.set(0, 7.3 - scaled.min.y - 1.1, sign * (COURT_LENGTH / 2 + 4.4));
  model.rotation.y = sign > 0 ? Math.PI : 0;   // always facing down the court
  if (shadows) model.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.castShadow = true; });
  group.add(model);
  let mixer = null;
  if (animate && IDOL.animations.length) {
    mixer = new THREE.AnimationMixer(model);
    const action = mixer.clipAction(IDOL.animations[0]);
    action.timeScale = .55;                     // a slow, monumental sway
    action.time = sign > 0 ? 0 : 3.1;           // offset so the pair are not in lockstep
    action.play();
  }
  return mixer;
}

// ---------------------------------------------------------------- court markings
function createGlyphTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.translate(size / 2, size / 2);
  ctx.strokeStyle = '#f4c24a'; ctx.fillStyle = '#f4c24a'; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.arc(0, 0, 202, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 152, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 4; i += 1) {   // k'in (sun) petals
    ctx.save(); ctx.rotate(i * Math.PI / 2);
    ctx.beginPath(); ctx.moveTo(0, -40); ctx.quadraticCurveTo(45, -92, 0, -132); ctx.quadraticCurveTo(-45, -92, 0, -40); ctx.fill();
    ctx.restore();
  }
  ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 20; i += 1) {  // the vigesimal count
    ctx.save(); ctx.rotate(i / 20 * Math.PI * 2);
    ctx.fillRect(-6, -198, 12, i % 5 === 0 ? 32 : 17);
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addMarkings(group) {
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 6.4), new THREE.MeshBasicMaterial({ map: createGlyphTexture(), transparent: true, opacity: .55, depthWrite: false }));
  sun.rotation.x = -Math.PI / 2; sun.position.y = .035; group.add(sun);
  const gold = new THREE.MeshBasicMaterial({ color: palette.gold, transparent: true, opacity: .55 });
  box(group, [COURT_WIDTH - .8, .02, .12], [0, .03, 0], gold, false);
  for (const [sign, team] of [[1, 'kuk'], [-1, 'balam']]) {
    const zone = new THREE.Mesh(new THREE.PlaneGeometry(COURT_WIDTH - .5, BACK_ZONE), new THREE.MeshBasicMaterial({ color: TEAMS[team].color, transparent: true, opacity: .12, depthWrite: false }));
    zone.rotation.x = -Math.PI / 2; zone.position.set(0, .03, sign * (COURT_LENGTH / 2 - BACK_ZONE / 2)); group.add(zone);
    box(group, [COURT_WIDTH - .8, .02, .12], [0, .032, sign * (COURT_LENGTH / 2 - BACK_ZONE)], new THREE.MeshBasicMaterial({ color: TEAMS[team].color, transparent: true, opacity: .6 }), false);
  }
}

// ---------------------------------------------------------------- flanks
function flankGeometry(length) {
  const shape = new THREE.Shape();
  shape.moveTo(COURT_WIDTH / 2, 0);
  shape.lineTo(BENCH_OUT, BENCH_TOP);      // talud: the sloping bench
  shape.lineTo(WALL_OUT, BENCH_TOP);       // the bench walk
  shape.lineTo(WALL_OUT, WALL_HEIGHT);     // vertical upper wall
  shape.lineTo(TERRACE_OUT, WALL_HEIGHT);  // terrace walk
  shape.lineTo(TERRACE_OUT, 0);
  shape.lineTo(COURT_WIDTH / 2, 0);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, curveSegments: 1 });
  geometry.translate(0, 0, -length / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function addFlank(group, sign, length) {
  // ExtrudeGeometry lays UVs out in world units, so the flank needs a far
  // higher repeat than a unit-UV box to keep the blocks at human scale.
  const material = stoneMaterial({ repeat: [.31, .31], color: palette.stone, bumpScale: .07 });
  const mesh = new THREE.Mesh(flankGeometry(length), material);
  mesh.scale.x = sign;
  mesh.castShadow = true; mesh.receiveShadow = true;
  group.add(mesh);
  // A carved band where the bench meets the upper wall, plus jade glyph blocks.
  const band = stoneMaterial({ repeat: [8, .5], color: palette.stoneWarm });
  box(group, [.26, .62, length], [sign * (WALL_OUT - .13), BENCH_TOP + .45, 0], band);
  const jade = plain(palette.jade, .55);
  for (let z = -length / 2 + 3; z <= length / 2 - 3; z += 3.8) {
    const glyph = box(group, [.14, .3, .8], [sign * (WALL_OUT - .26), BENCH_TOP + 1.4, z], jade, false);
    glyph.receiveShadow = true;
  }
  return mesh;
}

// ---------------------------------------------------------------- end structures
function addTemple(group, sign, mats) {
  const temple = new THREE.Group();
  const z = sign * (COURT_LENGTH / 2 + 7.5);
  temple.position.set(0, 0, z);
  const tiers = 7;
  for (let tier = 0; tier < tiers; tier += 1) {
    const w = 20 - tier * 1.9, d = 13 - tier * 1.25, h = 1.05;
    box(temple, [w, h, d], [0, tier * h + h / 2, 0], tier % 2 ? mats.warm : mats.base);
  }
  const top = tiers * 1.05;
  box(temple, [6.4, 3.4, 5.2], [0, top + 1.7, 0], mats.base);
  box(temple, [7.2, .5, 6], [0, top + 3.6, 0], mats.warm);
  // Roof comb, the tall decorated crest of a Maya temple
  box(temple, [5.2, 2.6, .7], [0, top + 5.1, 0], mats.warm);
  for (let i = 0; i < 4; i += 1) box(temple, [.7, .7, .9], [-1.8 + i * 1.2, top + 6.1, 0], plain(palette.red, .8), false);
  // Doorway facing the court
  box(temple, [1.7, 2.4, .3], [0, top + 1.2, -sign * 2.7], new THREE.MeshBasicMaterial({ color: 0x140b07 }), false);
  // Grand staircase down toward the court
  const steps = 16;
  for (let i = 0; i < steps; i += 1) {
    box(temple, [6.6, .46, .62], [0, i * .46 + .23, -sign * (6.4 - i * .32)], mats.base, false);
  }
  group.add(temple);
  return temple;
}

function addEndWall(group, sign, mats) {
  // Low wall closing the alley, with the terraces stepping around it.
  box(group, [COURT_WIDTH + 1.4, 3.4, 1.4], [0, 1.7, sign * (COURT_LENGTH / 2 + .7)], mats.base);
  box(group, [COURT_WIDTH + 2.2, .45, 2.0], [0, 3.6, sign * (COURT_LENGTH / 2 + .7)], mats.warm);
  for (let i = 0; i < 6; i += 1) {
    box(group, [.8, .5, .3], [-4.4 + i * 1.76, 2.5, sign * (COURT_LENGTH / 2 + .02)], plain(palette.jade, .6), false);
  }
  // Side terraces wrapping the end
  for (const x of [-1, 1]) {
    box(group, [4.6, WALL_HEIGHT, 5.5], [x * 11.3, WALL_HEIGHT / 2, sign * (COURT_LENGTH / 2 + 2.6)], mats.base);
  }
}

// ---------------------------------------------------------------- props
// Stone incense braziers on the bench walk — out of the play volume, where
// they used to stand in the alley as solid-looking posts the ball passed
// through. Only some carry a real light: each point light is paid for by every
// stone pixel on screen, which is the most expensive thing in the scene.
function addTorch(group, x, y, z, withLight) {
  const stone = plain(0x6e5a40, .9);
  const plinth = box(group, [.7, .5, .7], [x, y + .25, z], stone);
  plinth.castShadow = true;
  const profile = [[0, 0], [.22, 0], [.28, .08], [.2, .22], [.36, .42], [.5, .62], [.46, .66], [0, .5]].map(([px, py]) => new THREE.Vector2(px, py));
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(profile, 14), stone);
  bowl.position.set(x, y + .5, z); bowl.castShadow = true; group.add(bowl);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(.24, .8, 10), new THREE.MeshBasicMaterial({ color: 0xffd089, transparent: true, opacity: .75, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame.position.set(x, y + 1.45, z); flame.userData.flame = true; group.add(flame);
  const ember = new THREE.Mesh(new THREE.SphereGeometry(.3, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff7a1e, transparent: true, opacity: .5, blending: THREE.AdditiveBlending, depthWrite: false }));
  ember.position.set(x, y + 1.2, z); group.add(ember);
  if (withLight) {
    const light = new THREE.PointLight(0xff7b22, 14, 10, 2);
    light.position.set(x, y + 1.6, z); group.add(light);
  }
}

// Spectators line the terrace walk above the upper wall.
function addCrowd(group) {
  const geometry = new THREE.CapsuleGeometry(.15, .46, 2, 5);
  const colors = [0x6f3023, 0xa7532f, 0x1c756c, 0xd49842, 0x2b3b7a, 0xe9e2cf];
  const perColor = 44;
  const meshes = [];
  colors.forEach((color, colorIndex) => {
    const crowd = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: .9 }), perColor);
    const dummy = new THREE.Object3D();
    const seats = [];
    for (let i = 0; i < perColor; i += 1) {
      const side = i % 2 ? 1 : -1;
      const row = (i + colorIndex) % 3;
      const z = -16 + ((i * 3.1 + colorIndex * 2.3) % 32);
      dummy.position.set(side * (WALL_OUT + .5 + row * 1.15), WALL_HEIGHT + .55, z);
      dummy.rotation.y = side * -Math.PI / 2;
      dummy.scale.setScalar(.92 + ((i * 17) % 5) * .06);
      dummy.updateMatrix(); crowd.setMatrixAt(i, dummy.matrix);
      seats.push({ x: dummy.position.x, y: dummy.position.y, z, rot: dummy.rotation.y, scale: dummy.scale.x, phase: (i * 1.7 + colorIndex) % 6.28 });
    }
    crowd.castShadow = false; crowd.userData.seats = seats;
    group.add(crowd); meshes.push(crowd);
  });
  return meshes;
}

// ---------------------------------------------------------------- goals
function addGoal(group, side, mats) {
  const goal = new THREE.Group();
  const team = side > 0 ? 'kuk' : 'balam';
  const z = side * (COURT_LENGTH / 2 - RING_INSET);
  for (const x of [-3.3, 3.3]) {
    box(goal, [1.15, 8.0, 1.15], [x, 4.0, z + side * .8], mats.base);
    box(goal, [1.55, .42, 1.55], [x, 8.2, z + side * .8], mats.warm);
  }
  box(goal, [7.8, 1.0, 1.15], [0, 7.9, z + side * .8], mats.warm);
  for (let i = 0; i < 7; i += 1) box(goal, [.62, .5, .26], [-3 + i, 7.9, z + side * .18], plain(palette.jade, .55), false);

  const ringMat = new THREE.MeshStandardMaterial({ color: palette.gold, roughness: .22, metalness: .85, emissive: 0x6d2600, emissiveIntensity: .35 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 20, 64), ringMat);
  ring.position.set(0, RING_HEIGHT, z); ring.castShadow = true; goal.add(ring);
  box(goal, [.5, 2.3, .36], [0, RING_HEIGHT + RING_RADIUS + 1.05, z + side * .5], mats.base);
  for (let i = 0; i < 12; i += 1) {
    const a = i / 12 * Math.PI * 2;
    const gem = new THREE.Mesh(new THREE.BoxGeometry(.23, .23, .17), new THREE.MeshStandardMaterial({ color: i % 2 ? palette.jade : palette.gold, roughness: .3, metalness: .5, emissive: i % 2 ? 0x06352e : 0x542000, emissiveIntensity: .35 }));
    gem.position.set(Math.cos(a) * 1.62, RING_HEIGHT + Math.sin(a) * 1.62, z + side * .08);
    goal.add(gem);
  }
  const halo = new THREE.Mesh(new THREE.RingGeometry(RING_RADIUS + .32, RING_RADIUS + .78, 48), new THREE.MeshBasicMaterial({ color: 0xffd34e, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.position.set(0, RING_HEIGHT, z - side * .05); goal.add(halo);
  const shield = new THREE.Mesh(new THREE.PlaneGeometry(COURT_WIDTH, 5.5), new THREE.MeshBasicMaterial({ color: 0xffe36b, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  shield.position.set(0, 2.75, side * (COURT_LENGTH / 2 - .3)); goal.add(shield);
  const light = new THREE.PointLight(0xffa236, 0, 11, 2);
  light.position.set(0, RING_HEIGHT, z - side * 1.5); goal.add(light);
  group.add(goal);
  return { team, side, ring, ringMat, halo, shield, light, center: new THREE.Vector3(0, RING_HEIGHT, z) };
}

// ---------------------------------------------------------------- assembly
export function createCourt(scene, idolOptions = {}) {
  const group = new THREE.Group();
  group.name = 'SunStoneArena';
  scene.add(group);

  const mats = {
    base: stoneMaterial({ repeat: [1.6, 1.6] }),
    warm: stoneMaterial({ repeat: [2.2, 2.2], color: palette.stoneWarm }),
  };

  const floor = new THREE.Mesh(new THREE.BoxGeometry(COURT_WIDTH, .5, COURT_LENGTH), stoneMaterial({ repeat: [4.4, 10], color: 0xd2c0a0, bumpScale: .035, roughness: .9 }));
  floor.position.y = -.25; floor.receiveShadow = true; group.add(floor);
  addMarkings(group);

  addFlank(group, 1, COURT_LENGTH + 10);
  addFlank(group, -1, COURT_LENGTH + 10);
  addEndWall(group, 1, mats);
  addEndWall(group, -1, mats);
  addTemple(group, 1, mats);
  addTemple(group, -1, mats);

  // Ground plane beyond the complex so the horizon is not empty.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), stoneMaterial({ repeat: [90, 90], color: 0x7d6a4c, bumpScale: .02 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.26; ground.receiveShadow = true; group.add(ground);

  // The idol is optional scenery: if the model failed to load, or placing it
  // throws, the temples simply stand bare rather than the whole court failing.
  let idolMixers = [];
  try {
    idolMixers = [addIdol(group, 1, idolOptions), addIdol(group, -1, idolOptions)].filter(Boolean);
  } catch (error) {
    console.warn('[sun-stone-league] could not place the temple idol:', error);
  }

  const crowd = addCrowd(group);
  const bench = (BENCH_OUT + WALL_OUT) / 2;
  [[-1, -8], [1, -8], [-1, 8], [1, 8], [-1, 0], [1, 0]].forEach(([side, z]) =>
    addTorch(group, side * bench, BENCH_TOP, z, idolOptions?.shadows ? z !== 0 : z === 0));
  group.userData.flames = [];
  group.traverse((object) => { if (object.userData.flame) group.userData.flames.push(object); });

  const goals = [addGoal(group, 1, mats), addGoal(group, -1, mats)];
  return { arena: group, goals, crowd, idolMixers };
}

export function updateCourt(arena, time, crowd, excitement = 0, idolMixers = null, dt = 0) {
  if (idolMixers && dt > 0) for (const mixer of idolMixers) mixer.update(dt);
  for (const object of arena.userData.flames || []) {
    const pulse = 1 + Math.sin(time * 11 + object.position.x + object.position.z) * .13;
    object.scale.set(pulse, .9 + Math.sin(time * 8 + object.position.z) * .16, pulse);
    object.rotation.y = time * 2;
  }
  if (!crowd) return;
  const dummy = new THREE.Object3D();
  for (const mesh of crowd) {
    const seats = mesh.userData.seats;
    for (let i = 0; i < seats.length; i += 1) {
      const seat = seats[i];
      const hop = Math.max(0, Math.sin(time * 6 + seat.phase)) * (.08 + excitement * .4);
      dummy.position.set(seat.x, seat.y + hop, seat.z);
      dummy.rotation.set(0, seat.rot, 0); dummy.scale.setScalar(seat.scale);
      dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
}

export function addLighting(scene) {
  // The HDRI does most of the work; these shape it and cast the shadows.
  // Key: warm late sun. Fill: a sky/earth hemisphere so shadows go cool blue
  // and the undersides pick up warm bounce — the warm/cool split the old
  // same-hue directional fill could not give.
  const sun = new THREE.DirectionalLight(0xffd29a, 2.5);
  sun.position.set(-26, 20, -22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -24; sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 110;
  sun.shadow.bias = -.0004;
  sun.shadow.normalBias = .035;
  scene.add(sun);
  const fill = new THREE.HemisphereLight(0x8fb4d8, 0x6b4a2e, .5);
  scene.add(fill);
  return { sun, fill };
}
