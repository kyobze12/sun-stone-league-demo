import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { alignArena } from './arena-layout.js';
import { createArenaMaterial } from './stone-material.js';
import { COURT_LENGTH, COURT_WIDTH, RING_HEIGHT, RING_RADIUS, RING_TUBE, RING_INSET, BACK_ZONE, TEAMS } from './config.js';

export { COURT_LENGTH, COURT_WIDTH, RING_HEIGHT, RING_RADIUS, RING_TUBE };
export const WALL_HEIGHT = 6;

const palette = {
  sandstone: 0x9b6538,
  lightStone: 0xc58b4c,
  darkStone: 0x50301f,
  jade: 0x167566,
  turquoise: 0x20a98f,
  gold: 0xf1a532,
};

function stoneMaterial(color, roughness = 0.92) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
}

function box(parent, size, position, material, cast = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// ---------- floor texture with carved glyph bands ----------
function createFloorTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#a46e3c'); gradient.addColorStop(.5, '#c48b4d'); gradient.addColorStop(1, '#8d572f');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(60,31,18,.48)'; ctx.lineWidth = 4;
  const tile = 128;
  for (let y = 0; y <= canvas.height; y += tile) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    const offset = (y / tile) % 2 ? tile / 2 : 0;
    for (let x = offset; x <= canvas.width; x += tile) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + tile); ctx.stroke(); }
  }
  let seed = 41;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  ctx.strokeStyle = 'rgba(74,40,22,.35)'; ctx.lineWidth = 2;
  for (let i = 0; i < 46; i += 1) {
    let x = random() * canvas.width, y = random() * canvas.height;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let j = 0; j < 3; j += 1) { x += (random() - .5) * 55; y += 12 + random() * 28; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  // Carved glyph bands at each back zone
  ctx.strokeStyle = 'rgba(40,20,10,.55)'; ctx.lineWidth = 3;
  for (const yBand of [60, canvas.height - 60]) {
    for (let x = 24; x < canvas.width; x += 48) {
      ctx.strokeRect(x, yBand - 14, 28, 28);
      ctx.beginPath(); ctx.arc(x + 14, yBand, 6, 0, Math.PI * 2); ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// Maya-style glyph canvas used for the centre sun disc.
function createSunGlyphTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.translate(size / 2, size / 2);
  ctx.strokeStyle = '#f4c24a'; ctx.fillStyle = '#f4c24a'; ctx.lineWidth = 10;
  ctx.beginPath(); ctx.arc(0, 0, 200, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 150, 0, Math.PI * 2); ctx.stroke();
  // K'in (sun) glyph: four petals
  for (let i = 0; i < 4; i += 1) {
    ctx.save(); ctx.rotate(i * Math.PI / 2);
    ctx.beginPath(); ctx.moveTo(0, -40); ctx.quadraticCurveTo(45, -90, 0, -130); ctx.quadraticCurveTo(-45, -90, 0, -40); ctx.fill();
    ctx.restore();
  }
  ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.fill();
  // 20 ticks for the vigesimal count
  for (let i = 0; i < 20; i += 1) {
    ctx.save(); ctx.rotate(i / 20 * Math.PI * 2);
    ctx.fillRect(-6, -195, 12, i % 5 === 0 ? 30 : 16);
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addCourtMarkings(group) {
  const sunMat = new THREE.MeshBasicMaterial({ map: createSunGlyphTexture(), transparent: true, opacity: .8, depthWrite: false });
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), sunMat);
  sun.rotation.x = -Math.PI / 2; sun.position.y = .03; group.add(sun);
  const gold = new THREE.MeshBasicMaterial({ color: palette.gold, transparent: true, opacity: .7 });
  box(group, [COURT_WIDTH - .6, .025, .1], [0, .02, 0], gold, false);
  // Back zones, tinted per defending team
  for (const [sign, team] of [[1, 'kuk'], [-1, 'balam']]) {
    const mat = new THREE.MeshBasicMaterial({ color: TEAMS[team].color, transparent: true, opacity: .13, depthWrite: false });
    const zone = new THREE.Mesh(new THREE.PlaneGeometry(COURT_WIDTH - .4, BACK_ZONE), mat);
    zone.rotation.x = -Math.PI / 2; zone.position.set(0, .022, sign * (COURT_LENGTH / 2 - BACK_ZONE / 2)); group.add(zone);
    const line = new THREE.MeshBasicMaterial({ color: TEAMS[team].color, transparent: true, opacity: .75 });
    box(group, [COURT_WIDTH - .6, .025, .1], [0, .024, sign * (COURT_LENGTH / 2 - BACK_ZONE)], line, false);
    zone.userData.zoneTeam = team;
  }
}

function addSteppedSide(group, sign, materials) {
  const x0 = sign * (COURT_WIDTH / 2 + .55);
  const widths = [1.1, 1.35, 1.55, 1.8];
  for (let tier = 0; tier < 4; tier += 1) {
    const height = 1.05;
    const outward = sign * (tier * 1.1 + widths[tier] / 2);
    box(group, [widths[tier], height, COURT_LENGTH + 2], [x0 + outward, tier * height + height / 2, 0], materials[tier % materials.length]);
  }
  const bandX = sign * (COURT_WIDTH / 2 + .15);
  box(group, [.28, .75, COURT_LENGTH + 1], [bandX, 2.1, 0], materials[2]);
  const glyphMat = stoneMaterial(palette.jade, .72);
  for (let z = -14; z <= 14; z += 2) box(group, [.34, .32, 1.05], [bandX - sign * .18, 2.1, z], glyphMat, false);
}

function addTemple(group, x, z, scale, materials) {
  const temple = new THREE.Group();
  temple.position.set(x, 0, z);
  for (let tier = 0; tier < 6; tier += 1) {
    box(temple, [(12 - tier * 1.5) * scale, .9 * scale, (9 - tier * 1.1) * scale], [0, tier * .82 * scale, 0], materials[tier % 2]);
  }
  box(temple, [3.6 * scale, 2.5 * scale, 2.7 * scale], [0, 6 * .82 * scale + 1.1 * scale, 0], materials[1]);
  box(temple, [1.1 * scale, 1.65 * scale, .2], [0, 6 * .82 * scale + .9 * scale, (z < 0 ? 1 : -1) * 1.36 * scale], new THREE.MeshBasicMaterial({ color: 0x1a0d09 }), false);
  // Stairs down toward the court
  for (let step = 0; step < 10; step += 1) box(temple, [2.2 * scale, .3, .5 * scale], [0, step * .45, (z < 0 ? 1 : -1) * (4.3 - step * .42) * scale], materials[0], false);
  group.add(temple);
}

function addTorch(group, x, z) {
  const dark = stoneMaterial(0x382017);
  box(group, [.34, 1.4, .34], [x, .7, z], dark);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(.48, .28, .22, 12), stoneMaterial(0x332018, .65));
  bowl.position.set(x, 1.45, z); group.add(bowl);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb128, transparent: true, opacity: .92 });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(.23, .75, 10), flameMat);
  flame.position.set(x, 1.95, z); flame.userData.flame = true; group.add(flame);
  const light = new THREE.PointLight(0xff7b22, 9, 8, 2);
  light.position.set(x, 1.9, z); group.add(light);
}

// Spectators stand along the top of the ballcourt benches. The imported arena's
// benches top out near y=5.3 at |x| 9-12, so the rows start just above that and
// step outward — which also reads correctly against the procedural fallback.
function addCrowd(group) {
  const geometry = new THREE.CapsuleGeometry(.15, .46, 2, 5);
  const colors = [0x6f3023, 0xa7532f, 0x1c756c, 0xd49842, 0x2b3b7a, 0xe9e2cf];
  const perColor = 44;
  const meshes = [];
  colors.forEach((color, colorIndex) => {
    const material = new THREE.MeshStandardMaterial({ color, roughness: .9 });
    const crowd = new THREE.InstancedMesh(geometry, material, perColor);
    const dummy = new THREE.Object3D();
    const seats = [];
    for (let i = 0; i < perColor; i += 1) {
      const side = i % 2 ? 1 : -1;
      const row = (i + colorIndex) % 3;
      const z = -16 + ((i * 3.1 + colorIndex * 2.3) % 32);
      dummy.position.set(side * (9.8 + row * 1.45), 5.5 + row * .3, z);
      dummy.rotation.y = side * -Math.PI / 2;
      dummy.scale.setScalar(.9 + ((i * 17) % 5) * .06);
      dummy.updateMatrix(); crowd.setMatrixAt(i, dummy.matrix);
      seats.push({ x: dummy.position.x, y: dummy.position.y, z, rot: dummy.rotation.y, scale: dummy.scale.x, phase: (i * 1.7 + colorIndex) % 6.28 });
    }
    crowd.castShadow = false; crowd.userData.seats = seats; crowd.userData.crowd = true;
    group.add(crowd); meshes.push(crowd);
  });
  return meshes;
}

function addSky(scene) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(190, 24, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { topColor: { value: new THREE.Color(0x14233f) }, horizonColor: { value: new THREE.Color(0xf4914a) }, groundColor: { value: new THREE.Color(0x2b140d) } },
    vertexShader: 'varying vec3 vPos; void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec3 vPos;uniform vec3 topColor;uniform vec3 horizonColor;uniform vec3 groundColor;void main(){float h=normalize(vPos).y;vec3 c=h>0.0?mix(horizonColor,topColor,smoothstep(0.0,.62,h)):mix(horizonColor,groundColor,(1.0-smoothstep(-.42,0.0,h)));gl_FragColor=vec4(c,1.0);}',
  }));
  scene.add(sky);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd27a, transparent: true, opacity: .95, depthWrite: false }));
  sun.scale.set(10, 10, 1); sun.position.set(-38, 20, -60); scene.add(sun);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff9a3c, transparent: true, opacity: .32, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.set(34, 34, 1); halo.position.copy(sun.position); scene.add(halo);
  // Venus, the evening star — important in Maya cosmology
  const venus = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, opacity: .9, depthWrite: false }));
  venus.scale.set(1.2, 1.2, 1); venus.position.set(30, 44, -70); scene.add(venus);
}

function addGoal(group, side, mats) {
  const goal = new THREE.Group();
  const team = side > 0 ? 'kuk' : 'balam';
  const z = side * (COURT_LENGTH / 2 - RING_INSET);
  // Stone frame: two pillars and a lintel carved with a serpent band.
  const pillarMat = mats[2];
  for (const x of [-3.2, 3.2]) {
    box(goal, [1.1, 7.6, 1.1], [x, 3.8, z + side * .8], pillarMat);
    box(goal, [1.5, .4, 1.5], [x, 7.8, z + side * .8], mats[1]);
  }
  box(goal, [7.6, 1.0, 1.1], [0, 7.5, z + side * .8], mats[1]);
  for (let i = 0; i < 7; i += 1) box(goal, [.6, .5, .25], [-3 + i, 7.5, z + side * .18], stoneMaterial(palette.jade, .7), false);
  // The ring
  const ringMat = new THREE.MeshStandardMaterial({ color: palette.gold, roughness: .3, metalness: .6, emissive: 0x7d2d00, emissiveIntensity: .5 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 18, 56), ringMat);
  ring.position.set(0, RING_HEIGHT, z);
  ring.castShadow = true;
  goal.add(ring);
  const mount = box(goal, [.5, 2.2, .35], [0, RING_HEIGHT + RING_RADIUS + 1.0, z + side * .5], mats[2]);
  mount.castShadow = true;
  // Glyph gems around the ring
  for (let i = 0; i < 12; i += 1) {
    const a = i / 12 * Math.PI * 2;
    const gem = new THREE.Mesh(new THREE.BoxGeometry(.22, .22, .16), new THREE.MeshStandardMaterial({ color: i % 2 ? palette.jade : palette.gold, emissive: i % 2 ? 0x06352e : 0x542000, emissiveIntensity: .4 }));
    gem.position.set(Math.cos(a) * 1.6, RING_HEIGHT + Math.sin(a) * 1.6, z + side * .08);
    goal.add(gem);
  }
  // Lit halo (used by Ring Hunt and for score flashes)
  const halo = new THREE.Mesh(new THREE.RingGeometry(RING_RADIUS + .32, RING_RADIUS + .75, 48), new THREE.MeshBasicMaterial({ color: 0xffd34e, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.position.set(0, RING_HEIGHT, z - side * .05); goal.add(halo);
  // Back-line shield plane
  const shield = new THREE.Mesh(new THREE.PlaneGeometry(COURT_WIDTH, 5.5), new THREE.MeshBasicMaterial({ color: 0xffe36b, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  shield.position.set(0, 2.75, side * (COURT_LENGTH / 2 - .3)); goal.add(shield);
  const light = new THREE.PointLight(0xffa236, 0, 10, 2);
  light.position.set(0, RING_HEIGHT, z - side * 1.5); goal.add(light);
  group.add(goal);
  return { team, side, ring, ringMat, halo, shield, light, center: new THREE.Vector3(0, RING_HEIGHT, z) };
}

export function createCourt(scene) {
  addSky(scene);
  const group = new THREE.Group();
  group.name = 'SunStoneArena';
  scene.add(group);
  // `envDecor` is the sculpted environment Claude builds procedurally; it is
  // replaced wholesale when the imported arena model loads. `props` (torches,
  // crowd, goals) always stays, so both paths look like the same place.
  const envDecor = new THREE.Group();
  envDecor.name = 'ProceduralArenaFallback';
  const props = new THREE.Group();
  props.name = 'ArenaProps';
  group.add(envDecor, props);
  const fallbackDecor = envDecor;
  const mats = [stoneMaterial(palette.sandstone), stoneMaterial(palette.lightStone), stoneMaterial(palette.darkStone)];

  const floorMat = new THREE.MeshStandardMaterial({ map: createFloorTexture(), color: 0xffffff, roughness: .88, metalness: 0 });
  box(group, [COURT_WIDTH, .45, COURT_LENGTH], [0, -.23, 0], floorMat);
  addCourtMarkings(group);
  addSteppedSide(fallbackDecor, 1, mats);
  addSteppedSide(fallbackDecor, -1, mats);
  // Low end walls (the goals rise above them)
  box(fallbackDecor, [COURT_WIDTH + 6, 3.2, 1.3], [0, 1.6, -COURT_LENGTH / 2 - .65], mats[0]);
  box(fallbackDecor, [COURT_WIDTH + 6, 3.2, 1.3], [0, 1.6, COURT_LENGTH / 2 + .65], mats[0]);

  addTemple(fallbackDecor, 0, -34, 1.0, mats);
  addTemple(fallbackDecor, 0, 34, 1.0, mats);
  addTemple(fallbackDecor, -30, -6, .7, mats);
  addTemple(fallbackDecor, 30, 8, .6, mats);
  const crowd = addCrowd(props);
  [[-6.3, -12.5], [-6.3, 12.5], [6.3, -12.5], [6.3, 12.5], [-6.3, 0], [6.3, 0]].forEach(([x, z]) => addTorch(props, x, z));

  const goals = [addGoal(group, 1, mats), addGoal(group, -1, mats)];
  return { arena: group, fallbackDecor, goals, crowd };
}

export async function loadArenaModel(arena, fallbackDecor, manager) {
  const textureLoader = new THREE.TextureLoader(manager);
  const objLoader = new OBJLoader(manager);
  const [model, albedo, normal, roughness] = await Promise.all([
    objLoader.loadAsync('./assets/arena/arena.obj'),
    textureLoader.loadAsync('./assets/arena/arena_albedo.webp'),
    textureLoader.loadAsync('./assets/arena/arena_normal.webp'),
    textureLoader.loadAsync('./assets/arena/arena_roughness.webp'),
  ]);
  albedo.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [albedo, normal, roughness]) { texture.anisotropy = 4; texture.wrapS = THREE.ClampToEdgeWrapping; texture.wrapT = THREE.ClampToEdgeWrapping; }
  const arenaMaterial = createArenaMaterial(albedo, normal, roughness);
  model.name = 'ImportedMayanArena';
  model.rotation.y = Math.PI / 2;
  model.traverse((object) => {
    if (!object.isMesh) return;
    object.material = arenaMaterial; object.castShadow = true; object.receiveShadow = true;
    if (!object.geometry.attributes.normal) object.geometry.computeVertexNormals();
  });
  alignArena(model);
  arena.add(model);
  // The imported stone replaces the whole procedural environment; the props
  // group (goals, torches, crowd) stays on top of it.
  fallbackDecor.visible = false;
  return model;
}

export function updateCourt(arena, time, crowd, excitement = 0) {
  arena.traverse((object) => {
    if (object.userData.flame) {
      const pulse = 1 + Math.sin(time * 11 + object.position.x) * .12;
      object.scale.set(pulse, .9 + Math.sin(time * 8) * .15, pulse);
      object.rotation.y = time * 2;
    }
  });
  if (crowd) {
    const dummy = new THREE.Object3D();
    for (const mesh of crowd) {
      const seats = mesh.userData.seats;
      for (let i = 0; i < seats.length; i += 1) {
        const seat = seats[i];
        const hop = Math.max(0, Math.sin(time * 6 + seat.phase)) * (.08 + excitement * .35);
        dummy.position.set(seat.x, seat.y + hop, seat.z);
        dummy.rotation.set(0, seat.rot, 0); dummy.scale.setScalar(seat.scale);
        dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

export function addLighting(scene) {
  scene.add(new THREE.HemisphereLight(0xffe3c4, 0x6b5340, 2.0));
  // Warm fill from the camera side so players never read as black silhouettes.
  const fill = new THREE.DirectionalLight(0xffd9b0, 1.1);
  fill.position.set(6, 9, -14); scene.add(fill);
  const sun = new THREE.DirectionalLight(0xffc98a, 2.9);
  sun.position.set(-22, 18, -24);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -20; sun.shadow.camera.right = 20;
  sun.shadow.camera.top = 26; sun.shadow.camera.bottom = -26;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 90;
  sun.shadow.bias = -.0003;
  sun.shadow.normalBias = .03;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x7fb4d8, .7);
  rim.position.set(14, 10, 18); scene.add(rim);
  return { sun, rim };
}
