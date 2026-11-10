import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BALL_RADIUS, POWERUPS, TEAMS, COURT_LENGTH } from './config.js';

// ---------------------------------------------------------------- quality
export function detectQuality() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  const saved = localStorage.getItem('ssl-quality');
  if (saved && ['low', 'medium', 'high'].includes(saved)) return saved;
  if (!coarse && cores >= 6) return 'high';
  if (coarse && (cores <= 4 || memory <= 3)) return 'low';
  return 'medium';
}

export const QUALITY = {
  low: { pixelRatio: 1, bloom: false, shadows: false, shadowSize: 512, crowd: false, particles: .5 },
  medium: { pixelRatio: 1.4, bloom: true, bloomStrength: .55, shadows: true, shadowSize: 1024, crowd: true, particles: .8 },
  high: { pixelRatio: 2, bloom: true, bloomStrength: .7, shadows: true, shadowSize: 2048, crowd: true, particles: 1 },
};

export function createRenderer(canvas, quality) {
  const q = QUALITY[quality];
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !q.bloom, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = q.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  return renderer;
}

export function createComposer(renderer, scene, camera, quality) {
  const q = QUALITY[quality];
  if (!q.bloom) return null;
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), q.bloomStrength, .55, .78);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.userData = { bloom };
  return composer;
}

// ---------------------------------------------------------------- ball
function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,245,190,1)'); g.addColorStop(.22, 'rgba(255,174,38,.85)'); g.addColorStop(1, 'rgba(255,105,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export function createBall(scene) {
  const group = new THREE.Group();
  const coreMaterial = new THREE.MeshStandardMaterial({ color: 0x31221b, roughness: .55, metalness: .15, emissive: 0xff6500, emissiveIntensity: .08 });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(BALL_RADIUS, 3), coreMaterial);
  core.castShadow = true; group.add(core);
  const bands = new THREE.Mesh(new THREE.TorusGeometry(BALL_RADIUS * .82, .035, 7, 30), new THREE.MeshBasicMaterial({ color: 0xf6a52a }));
  bands.rotation.x = Math.PI / 2; group.add(bands);
  const bands2 = bands.clone(); bands2.rotation.set(0, 0, Math.PI / 2); group.add(bands2);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff9b20, transparent: true, opacity: .18, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.set(2.2, 2.2, 1); group.add(glow);
  const light = new THREE.PointLight(0xff7b19, 0, 8, 2); group.add(light);
  // Shadow blob so the ball's height reads on every device
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(BALL_RADIUS * 1.1, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .35, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; scene.add(shadow);

  const trailPositions = new Float32Array(30 * 3);
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  const trail = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({ color: 0xffb12e, transparent: true, opacity: .62, blending: THREE.AdditiveBlending }));
  trail.frustumCulled = false; scene.add(trail);
  group.userData = { core, glow, light, trail, trailPositions, history: [], shadow };
  scene.add(group);
  return group;
}

export function updateBallVisual(ball, pos, velocity, dt, tint = 0xff9b20) {
  ball.position.copy(pos);
  const speed = velocity.length();
  const energy = THREE.MathUtils.smoothstep(speed, 3, 16);
  const data = ball.userData;
  data.core.rotation.x += velocity.z * dt * 1.5;
  data.core.rotation.z -= velocity.x * dt * 1.5;
  data.core.material.emissiveIntensity = .08 + energy * 1.5;
  data.core.material.emissive.setHex(tint);
  data.glow.material.color.setHex(tint);
  data.glow.material.opacity = .12 + energy * .65;
  data.glow.scale.setScalar(1.5 + energy * 2.2);
  data.light.color.setHex(tint);
  data.light.intensity = energy * 24;
  data.shadow.position.set(pos.x, .03, pos.z);
  data.shadow.scale.setScalar(THREE.MathUtils.clamp(1.3 - pos.y * .08, .5, 1.3));
  data.shadow.material.opacity = THREE.MathUtils.clamp(.4 - pos.y * .03, .08, .4);
  const history = data.history;
  if (speed > 4) history.unshift(pos.clone()); else history.unshift(null);
  if (history.length > 30) history.pop();
  const points = data.trailPositions;
  let last = pos;
  for (let i = 0; i < 30; i += 1) { const point = history[i] || last; points[i * 3] = point.x; points[i * 3 + 1] = point.y; points[i * 3 + 2] = point.z; last = point; }
  data.trail.geometry.attributes.position.needsUpdate = true;
  data.trail.material.opacity = energy * .75;
  data.trail.material.color.setHex(tint);
}

// ---------------------------------------------------------------- particles
export class Particles {
  constructor(scene, scale = 1) {
    this.scene = scene; this.scale = scale; this.items = [];
    this.geometry = new THREE.SphereGeometry(.06, 5, 4);
    this.pool = [];
  }
  burst(position, color = 0xffa52b, count = 16, spread = 5, up = 4.5) {
    count = Math.round(count * this.scale);
    for (let i = 0; i < count; i += 1) {
      const particle = this.pool.pop() || new THREE.Mesh(this.geometry, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      particle.material.color.setHex(color);
      particle.position.copy(position);
      particle.userData.velocity = new THREE.Vector3((Math.random() - .5) * spread, Math.random() * up, (Math.random() - .5) * spread);
      particle.userData.life = .45 + Math.random() * .4;
      particle.scale.setScalar(.6 + Math.random() * .9);
      this.scene.add(particle); this.items.push(particle);
    }
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i -= 1) {
      const p = this.items[i];
      p.userData.life -= dt;
      p.userData.velocity.y -= 8 * dt;
      p.position.addScaledVector(p.userData.velocity, dt);
      p.material.opacity = Math.max(0, p.userData.life * 1.8);
      if (p.userData.life <= 0) { this.scene.remove(p); this.items.splice(i, 1); this.pool.push(p); }
    }
  }
}

// ---------------------------------------------------------------- power-ups
export class PowerupVisuals {
  constructor(scene) { this.scene = scene; this.meshes = new Map(); }
  sync(powerups, time) {
    const seen = new Set();
    for (const p of powerups) {
      seen.add(p.id);
      let mesh = this.meshes.get(p.id);
      if (!mesh) {
        const def = POWERUPS[p.kind];
        mesh = new THREE.Group();
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(.42, 0), new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: .9, roughness: .3, metalness: .4 }));
        gem.position.y = 1.0; mesh.add(gem);
        const ring = new THREE.Mesh(new THREE.RingGeometry(.55, .75, 32), new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: .55, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = .04; mesh.add(ring);
        const light = new THREE.PointLight(def.color, 6, 5, 2); light.position.y = 1.2; mesh.add(light);
        mesh.userData = { gem, ring, kind: p.kind };
        mesh.position.copy(p.pos);
        this.scene.add(mesh); this.meshes.set(p.id, mesh);
      }
      const { gem, ring } = mesh.userData;
      gem.rotation.y = time * 2; gem.position.y = 1 + Math.sin(time * 3 + p.id) * .15;
      ring.scale.setScalar(1 + Math.sin(time * 4 + p.id) * .12);
      const fade = Math.min(1, p.life / 2);
      gem.material.opacity = fade; gem.material.transparent = fade < 1;
    }
    for (const [id, mesh] of this.meshes) if (!seen.has(id)) { this.scene.remove(mesh); this.meshes.delete(id); }
  }
  clear() { for (const mesh of this.meshes.values()) this.scene.remove(mesh); this.meshes.clear(); }
}

// ---------------------------------------------------------------- camera
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.desired = new THREE.Vector3(0, 7, -14);
    this.target = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.shake = 0;
    this.fovKick = 0;
    this.baseFov = 52;
    this.cinematic = null; // {center, time}
    this.facing = 1;
  }
  /**
   * Broadcast-style follow camera behind the controlled player, looking down
   * the court toward the ring they attack. Keeps the ball in frame.
   */
  update(dt, { playerPos, ballPos, facing = 1, portrait = false, intro = false, ring = null }) {
    this.facing = facing;
    if (this.cinematic) {
      this.cinematic.time += dt;
      const t = this.cinematic.time;
      const c = this.cinematic.center;
      const angle = t * .9 + this.cinematic.offset;
      this.desired.set(c.x + Math.sin(angle) * 6.5, c.y + 1.4 + Math.sin(t * 1.3) * .4, c.z + Math.cos(angle) * 6.5 * -this.cinematic.side);
      this.lookAt.lerp(c, 1 - Math.pow(.001, dt));
    } else if (intro) {
      const t = performance.now() / 1000;
      this.desired.set(Math.sin(t * .18) * 15, 9 + Math.sin(t * .11) * 2, Math.cos(t * .18) * 20);
      this.lookAt.lerp(new THREE.Vector3(0, 2.5, 0), 1 - Math.pow(.001, dt));
    } else {
      // Broadcast follow camera: sits behind the player's own end, high enough to
      // clear the stone walls, framing the player and the ball together.
      const anchor = playerPos.clone().lerp(ballPos, .35);
      const limit = COURT_LENGTH / 2 - 1.2;
      // Portrait is tall and narrow, so it takes a steeper, closer camera: a
      // landscape framing puts the player behind the on-screen thumb controls.
      const distance = portrait ? 11 : 12.5;
      const rawZ = anchor.z - facing * distance;
      const z = THREE.MathUtils.clamp(rawZ, -limit, limit);
      // When the shot would push the camera through the end wall, trade distance
      // for height. The goal frame stands 7.8 high at |z|=14.4, so the camera
      // also climbs over it as it nears an end line — otherwise it ends up
      // inside the stone lintel with a jade block filling the lens.
      const squeeze = Math.abs(rawZ - z);
      const nearEnd = THREE.MathUtils.smoothstep(Math.abs(z), 10, limit);
      const height = (portrait ? 9 : 7.0) + squeeze * .3 + nearEnd * 4.2;
      this.desired.set(THREE.MathUtils.clamp(anchor.x * .5, -5, 5), height, z);
      // Look past the anchor toward the ring being attacked, so the target is
      // always in frame — the framing a sports broadcast uses.
      const look = anchor.clone();
      look.z += facing * (portrait ? 3.5 : 4.5);
      look.y = (portrait ? 2.2 : 2.7) + squeeze * .1;
      this.lookAt.lerp(look, 1 - Math.pow(.0006, dt));
    }
    if (this.shake > 0) { this.desired.x += (Math.random() - .5) * this.shake; this.desired.y += (Math.random() - .5) * this.shake; this.shake = Math.max(0, this.shake - dt * 2.2); }
    this.camera.position.lerp(this.desired, 1 - Math.pow(this.cinematic ? .02 : .003, dt));
    this.camera.lookAt(this.lookAt);
    this.fovKick = THREE.MathUtils.damp(this.fovKick, 0, 6, dt);
    const fov = this.baseFov + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > .05) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }
  startCinematic(center, side) { this.cinematic = { center: center.clone(), time: 0, side, offset: Math.random() * 6.28 }; }
  stopCinematic() { this.cinematic = null; }
  impact(amount) { this.shake = Math.max(this.shake, amount); this.fovKick = Math.max(this.fovKick, amount * 12); }
}

export function teamCss(team) { return TEAMS[team].css; }
