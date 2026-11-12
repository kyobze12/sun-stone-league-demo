import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createGradePass } from './cinematic.js';
import { BALL_RADIUS, POWERUPS, TEAMS, COURT_LENGTH, HIT_MAX_HEIGHT } from './config.js';

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
  renderer.toneMappingExposure = .96;
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
  const grade = createGradePass();
  composer.addPass(grade);
  composer.userData = { bloom, grade };
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
  const coreMaterial = new THREE.MeshStandardMaterial({ color: 0x2a1c16, roughness: .72, metalness: .05, emissive: 0xff6500, emissiveIntensity: .08 });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(BALL_RADIUS, 2), coreMaterial);
  core.castShadow = true; group.add(core);
  // Bands must sit on the surface: at 0.82r they were buried inside the core
  // and the ball rendered as a featureless blob.
  const bandMat = new THREE.MeshStandardMaterial({ color: 0xf0a62c, roughness: .45, metalness: .3, emissive: 0x3a1c00, emissiveIntensity: .3 });
  const bands = new THREE.Mesh(new THREE.TorusGeometry(BALL_RADIUS * .99, .055, 8, 36), bandMat);
  bands.rotation.x = Math.PI / 2; bands.castShadow = true; group.add(bands);
  const bands2 = new THREE.Mesh(new THREE.TorusGeometry(BALL_RADIUS * .99, .055, 8, 36), bandMat);
  bands2.rotation.set(0, 0, Math.PI / 2); bands2.castShadow = true; group.add(bands2);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff9b20, transparent: true, opacity: .18, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.set(1.25, 1.25, 1); group.add(glow);
  const light = new THREE.PointLight(0xff7b19, 0, 8, 2); group.add(light);
  // Shadow blob so the ball's height reads on every device
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(BALL_RADIUS * 1.1, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .35, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; scene.add(shadow);
  // Height cues: a ring around the shadow that turns mint while the ball is
  // low enough to strike, and a faint plumb line when it is high.
  const marker = new THREE.Mesh(new THREE.RingGeometry(BALL_RADIUS * 1.15, BALL_RADIUS * 1.32, 28), new THREE.MeshBasicMaterial({ color: 0xffd34e, transparent: true, opacity: .5, depthWrite: false }));
  marker.rotation.x = -Math.PI / 2; scene.add(marker);
  const drop = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, 1, 4, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: .28, depthWrite: false }));
  scene.add(drop);

  const trailPositions = new Float32Array(30 * 3);
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  const trail = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({ color: 0xffb12e, transparent: true, opacity: .62, blending: THREE.AdditiveBlending }));
  trail.frustumCulled = false; scene.add(trail);
  group.userData = { core, glow, light, trail, trailPositions, history: [], shadow, marker, drop };
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
  // The core keeps an ember glow of its own; the team tint rides on the halo
  // and trail instead. Tinting the body turned the ball into a coloured orb.
  data.core.material.emissiveIntensity = .05 + energy * .45;
  data.glow.material.color.setHex(tint);
  // Keep the halo a hint of heat, not a coloured disc swallowing the ball.
  data.glow.material.opacity = .04 + energy * .2;
  data.glow.scale.setScalar(.8 + energy * .6);
  data.light.color.setHex(tint);
  data.light.intensity = energy * 7;
  data.shadow.position.set(pos.x, .03, pos.z);
  data.shadow.scale.setScalar(THREE.MathUtils.clamp(1.3 - pos.y * .08, .5, 1.3));
  data.shadow.material.opacity = THREE.MathUtils.clamp(.45 - pos.y * .03, .2, .45);
  const strikeable = pos.y <= HIT_MAX_HEIGHT;
  data.marker.position.set(pos.x, .04, pos.z);
  data.marker.material.color.setHex(strikeable ? 0x7fffc8 : 0xffd34e);
  data.marker.material.opacity = strikeable ? .7 : .4;
  data.drop.visible = pos.y > 1.6;
  if (data.drop.visible) { data.drop.position.set(pos.x, (pos.y - BALL_RADIUS) / 2, pos.z); data.drop.scale.y = Math.max(.01, pos.y - BALL_RADIUS); }
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
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(.42, 0), new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 1.3, roughness: .3, metalness: .4, transparent: true }));
        gem.position.y = 1.0; mesh.add(gem);
        const ring = new THREE.Mesh(new THREE.RingGeometry(.55, .75, 32), new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: .55, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = .04; mesh.add(ring);
        // No point light: adding or removing one changes the scene's light
        // count, which recompiles every lit shader — a visible hitch on iPhone
        // each time a power-up spawned or was collected.
        mesh.userData = { gem, ring, kind: p.kind };
        mesh.position.copy(p.pos);
        this.scene.add(mesh); this.meshes.set(p.id, mesh);
      }
      const { gem, ring } = mesh.userData;
      gem.rotation.y = time * 2; gem.position.y = 1 + Math.sin(time * 3 + p.id) * .15;
      ring.scale.setScalar(1 + Math.sin(time * 4 + p.id) * .12);
      const fade = Math.min(1, p.life / 2);
      gem.material.opacity = fade;
    }
    for (const [id, mesh] of this.meshes) if (!seen.has(id)) { this.drop(mesh); this.meshes.delete(id); }
  }
  drop(mesh) {
    this.scene.remove(mesh);
    mesh.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  }
  clear() { for (const mesh of this.meshes.values()) this.drop(mesh); this.meshes.clear(); }
}

// ---------------------------------------------------------------- camera
// Exponential smoothing that behaves the same at 20 fps on a phone and 120 fps
// on a desktop: `rate` is how quickly the gap closes, per second.
function follow(current, target, rate, dt) {
  return current.lerp(target, 1 - Math.exp(-rate * dt));
}

/**
 * Third-person follow camera in the style of an action-adventure game.
 *
 * It sits low behind your fighter, slightly over the shoulder, looking down the
 * court toward the ring you attack. Every input is smoothed separately — your
 * fighter quickly, the ball slowly and only in the horizontal plane — because
 * the old rig chased the raw ball position, so every bounce jolted the frame.
 * Shake is layered on afterwards as smooth noise rather than injected into the
 * target, which is where the jitter came from.
 */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.player = new THREE.Vector3();
    this.ballBias = new THREE.Vector3();
    this.position = camera.position.clone();
    this.look = new THREE.Vector3();
    this.desired = new THREE.Vector3();
    this.lookTarget = new THREE.Vector3();
    this.shake = 0;
    this.fovKick = 0;
    this.time = 0;
    this.cinematic = null;
    this.primed = false;
    this.reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Vertical FOV that keeps roughly the same horizontal view on any screen. */
  fovFor(aspect) {
    const horizontal = THREE.MathUtils.degToRad(aspect < 1 ? 74 : aspect > 1.9 ? 90 : 82);
    const vertical = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(horizontal / 2) / aspect));
    return THREE.MathUtils.clamp(vertical, 42, 74);
  }

  update(dt, { playerPos, ballPos, facing = 1, intro = false, rivalPos = null }) {
    if (dt <= 0) return;
    this.time += dt;
    const aspect = this.camera.aspect;
    const portrait = aspect < 1;
    const short = aspect > 1.9;   // landscape phone: wide, very little height

    if (this.cinematic) {
      // Slow orbit around the ring after a goal.
      const c = this.cinematic;
      c.time += dt;
      const angle = c.offset + c.time * .55;
      this.desired.set(c.center.x + Math.sin(angle) * 6.2, c.center.y + .6 + Math.sin(c.time * .9) * .3, c.center.z - c.side * (3.2 + Math.cos(angle) * 2.4));
      this.lookTarget.copy(c.center);
      follow(this.position, this.desired, 2.2, dt);
      follow(this.look, this.lookTarget, 4, dt);
    } else if (rivalPos) {
      this.duelFrame(dt, playerPos, rivalPos, portrait, short);
    } else if (intro) {
      const t = this.time;
      this.desired.set(Math.sin(t * .12) * 13, 7.5 + Math.sin(t * .09) * 1.5, Math.cos(t * .12) * 17);
      this.lookTarget.set(0, 3, 0);
      follow(this.position, this.desired, 1.2, dt);
      follow(this.look, this.lookTarget, 2, dt);
    } else {
      if (!this.primed || this.cutNext || this.lastFacing !== facing) { this.player.copy(playerPos); this.ballBias.set(0, 0, 0); this.primed = true; }
      follow(this.player, playerPos, 9, dt);
      // Ball pull: horizontal only, capped, and slow — framing should drift
      // toward the play, never twitch with each bounce.
      const pull = ballPos.clone().sub(this.player).setY(0);
      if (pull.length() > 5) pull.setLength(5);
      follow(this.ballBias, pull, 2.4, dt);

      const distance = portrait ? 8.6 : short ? 7 : 7.4;
      const height = portrait ? 5.4 : short ? 4.1 : 3.9;
      const shoulder = portrait ? 0 : .75 * facing;     // over the right shoulder
      const anchor = this.player.clone().addScaledVector(this.ballBias, .12);

      // Keep the lens inside the alley and clear of the goal frames. Near the
      // end wall the camera climbs above the ring and the wall top instead of
      // pressing in behind your fighter — continuous, so there is no jump.
      // Depth comes from your fighter alone; the ball only shifts sideways and
      // steers the aim, otherwise a ball ahead drags the lens onto your back.
      const limit = COURT_LENGTH / 2 - 2.2;
      const rawZ = this.player.z - facing * distance;
      const over = Math.max(0, Math.abs(rawZ) - limit);
      const z = Math.sign(rawZ) * Math.min(Math.abs(rawZ), limit);
      const nearEnd = THREE.MathUtils.smoothstep(Math.abs(z), limit - 3, limit);
      this.desired.set(
        THREE.MathUtils.clamp(anchor.x * .7 - shoulder, -5.2, 5.2),
        height + nearEnd * 1.6 + over * .9,
        z,
      );

      // Look a little ahead of your fighter, toward the ring and the ball.
      this.lookTarget.copy(anchor).addScaledVector(this.ballBias, short ? .15 : .35);
      this.lookTarget.z += facing * (portrait ? 3.5 : short ? 2.5 : 5);
      // Aim lower on short screens so your fighter's feet stay above the controls.
      this.lookTarget.y = (short ? .6 : 1.5) - over * .15;
      // After a goal replay, or when Ring Hunt turns you to the other ring,
      // cut straight to the new view. Easing back while play resumed left the
      // lens pointing the wrong way for a second — and because the stick is
      // screen-relative, the controls felt reversed.
      if (this.cutNext || this.lastFacing !== facing) {
        this.position.copy(this.desired); this.look.copy(this.lookTarget);
        this.cutNext = false; this.lastFacing = facing;
      }
      follow(this.position, this.desired, 7.5, dt);
      follow(this.look, this.lookTarget, 9, dt);
    }

    this.camera.position.copy(this.position);
    // Smooth, low-frequency shake applied after smoothing, so it never feeds back.
    if (this.shake > 0 && !this.reducedMotion) {
      const t = this.time * 38;
      this.camera.position.x += (Math.sin(t) + Math.sin(t * 1.7) * .5) * this.shake * .28;
      this.camera.position.y += (Math.sin(t * 1.3 + 1) + Math.sin(t * 2.3) * .5) * this.shake * .22;
    }
    this.shake = Math.max(0, this.shake - dt * 2.4);
    this.camera.lookAt(this.look);

    this.fovKick = THREE.MathUtils.damp(this.fovKick, 0, 5, dt);
    const fov = this.fovFor(aspect) + (this.reducedMotion ? 0 : this.fovKick);
    if (Math.abs(this.camera.fov - fov) > .05) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }

  /**
   * Lock-on duel camera: behind your fighter's shoulder, looking past them at
   * the rival, pulling back as the gap opens so both stay in frame.
   */
  duelFrame(dt, playerPos, rivalPos, portrait, short) {
    if (!this.primed) { this.player.copy(playerPos); this.primed = true; this.yaw = Math.atan2(rivalPos.x - playerPos.x, rivalPos.z - playerPos.z); }
    follow(this.player, playerPos, 10, dt);
    const dx = rivalPos.x - this.player.x, dz = rivalPos.z - this.player.z;
    const gap = Math.hypot(dx, dz);
    const target = Math.atan2(dx, dz);
    // Smooth the yaw; swing faster when the rival circles quickly past.
    const turn = Math.atan2(Math.sin(target - this.yaw), Math.cos(target - this.yaw));
    this.yaw += turn * (1 - Math.exp(-(gap < 2.5 ? 3.5 : 6) * dt));
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const back = (portrait ? 6.6 : short ? 5.6 : 5.8) + Math.min(gap, 12) * .3;
    const shoulder = portrait ? .4 : 1.05;   // off the shoulder, so your fighter never hides the rival
    const height = (portrait ? 3.6 : 2.9) + Math.min(gap, 12) * .12;
    let x = this.player.x - fx * back - fz * shoulder;
    let z = this.player.z - fz * back + fx * shoulder;
    // Keep the lens over the court: past the edge, rise instead of clipping stone.
    const overX = Math.max(0, Math.abs(x) - 6.4), overZ = Math.max(0, Math.abs(z) - (COURT_LENGTH / 2 - 1.2));
    x = THREE.MathUtils.clamp(x, -6.4 - overX * .3, 6.4 + overX * .3);
    z = THREE.MathUtils.clamp(z, -(COURT_LENGTH / 2 - 1.2), COURT_LENGTH / 2 - 1.2);
    this.desired.set(x, height + (overX + overZ) * .8, z);
    const mid = this.player.clone().lerp(rivalPos, .55);
    this.lookTarget.set(mid.x, 1.25, mid.z);
    follow(this.position, this.desired, 8, dt);
    follow(this.look, this.lookTarget, 10, dt);
  }

  /** Floor direction the camera faces — controls map to it in a duel. */
  get floorYaw() { return Math.atan2(this.look.x - this.position.x, this.look.z - this.position.z); }

  startCinematic(center, side) { this.cinematic = { center: center.clone(), time: 0, side, offset: (Math.random() - .5) * 1.2 }; }
  stopCinematic() { if (this.cinematic) this.cutNext = true; this.cinematic = null; }
  /** Called when a new match starts so the camera does not sweep in from the menu orbit. */
  snap() { this.primed = false; this.cutNext = true; }
  impact(amount) { this.shake = Math.max(this.shake, amount); this.fovKick = Math.max(this.fovKick, amount * 8); }
}

export function teamCss(team) { return TEAMS[team].css; }
