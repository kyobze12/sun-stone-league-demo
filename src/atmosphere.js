// Atmosphere: the things that make the air feel thick and old.
//
//   - ground mist: low drifting fog banks over the alley and beyond the walls
//   - sun shafts: soft beams of late light slanting across the court
//   - copal smoke: incense smoke rising from every brazier
//   - embers: sparks lifting off the flames
//   - drifting leaves: ceiba leaves and ash blowing across the court
//
// All of it is a few draw calls of additive / alpha cards and Points, scaled
// by the quality tier. Nothing here writes depth, so it never blocks play.
import * as THREE from 'three';

const NOISE = /* glsl */`
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { float v = 0.0, a = .5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= .5; } return v; }`;

/** A horizontal sheet of drifting mist. Several stacked make a fog bank. */
function mistMaterial(color, opacity, speed) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { time: { value: 0 }, color: { value: new THREE.Color(color) }, opacity: { value: opacity }, speed: { value: speed } },
    vertexShader: 'varying vec2 vUv; varying vec3 vWorld; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float time, opacity, speed; uniform vec3 color; varying vec2 vUv; varying vec3 vWorld; ${NOISE}
      void main(){
        float n = fbm(vWorld.xz * .09 + vec2(time * speed, time * speed * .6));
        n = smoothstep(.35, .85, n);
        float edge = smoothstep(0.0, .25, vUv.x) * smoothstep(1.0, .75, vUv.x) * smoothstep(0.0, .25, vUv.y) * smoothstep(1.0, .75, vUv.y);
        gl_FragColor = vec4(color, n * edge * opacity);
      }`,
  });
}

/** A soft beam: brightest along its centre line, fading out at both ends. */
function shaftMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { time: { value: 0 }, color: { value: new THREE.Color(0xffd29a) }, strength: { value: .11 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float time, strength; uniform vec3 color; varying vec2 vUv; ${NOISE}
      void main(){
        float across = 1.0 - abs(vUv.x - .5) * 2.0;
        float along = smoothstep(0.0, .3, vUv.y) * smoothstep(1.0, .55, vUv.y);
        float flicker = .75 + .25 * noise(vec2(vUv.x * 6.0, time * .3));
        gl_FragColor = vec4(color, pow(across, 2.2) * along * flicker * strength);
      }`,
  });
}

function softDot(color) {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, color); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

function leafTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#c98a3a';
  g.beginPath(); g.ellipse(16, 16, 6, 13, .6, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#7a4a1a'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(9, 26); g.lineTo(23, 6); g.stroke();
  return new THREE.CanvasTexture(c);
}

/** A pool of particles that rise from emitters and recycle. */
class Rising {
  constructor(scene, emitters, count, { texture, size, color, opacity, blending, rise, spread, life, sway }) {
    this.emitters = emitters; this.count = count; this.opts = { rise, spread, life, sway };
    this.pos = new Float32Array(count * 3);
    this.age = new Float32Array(count);
    this.origin = new Uint16Array(count);
    for (let i = 0; i < count; i++) { this.age[i] = Math.random() * life; this.origin[i] = i % emitters.length; this.respawn(i, this.age[i]); }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.material = new THREE.PointsMaterial({ map: texture, size, color, transparent: true, opacity, depthWrite: false, blending, sizeAttenuation: true });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  respawn(i, age = 0) {
    const e = this.emitters[this.origin[i]], { rise, spread } = this.opts;
    this.pos[i * 3] = e.x + (Math.random() - .5) * spread;
    this.pos[i * 3 + 1] = e.y + age * rise;
    this.pos[i * 3 + 2] = e.z + (Math.random() - .5) * spread;
  }
  update(dt, time) {
    const { rise, life, sway } = this.opts;
    for (let i = 0; i < this.count; i++) {
      this.age[i] += dt;
      if (this.age[i] > life) { this.age[i] = 0; this.respawn(i); continue; }
      this.pos[i * 3] += Math.sin(time * .8 + i) * sway * dt + .25 * dt;   // a light breeze toward +x
      this.pos[i * 3 + 1] += rise * dt;
      this.pos[i * 3 + 2] += Math.cos(time * .6 + i * 1.3) * sway * dt;
    }
    this.geometry.attributes.position.needsUpdate = true;
  }
}

/**
 * @param {THREE.Scene} scene
 * @param {THREE.Object3D} arena the court group (braziers are found by their flames)
 * @param {THREE.Vector3} sunDir direction toward the sun
 * @param {'low'|'medium'|'high'} quality
 */
export function addAtmosphere(scene, arena, sunDir, quality = 'medium') {
  const tier = quality === 'high' ? 1 : quality === 'medium' ? .6 : .3;
  const group = new THREE.Group(); group.name = 'atmosphere';
  const updaters = [];

  // ---- ground mist: banks over the alley, thicker out in the city
  const mistMats = [];
  const sheets = quality === 'low' ? [[0.35, 60, .16]] : [[0.3, 70, .2], [0.7, 70, .14], [1.3, 120, .1]];
  for (const [y, size, opacity] of sheets) {
    const mat = mistMaterial(0xf0dcc0, opacity, .03 + y * .01);
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    sheet.rotation.x = -Math.PI / 2; sheet.position.y = y; sheet.renderOrder = 4;
    group.add(sheet); mistMats.push(mat);
  }
  updaters.push((dt, t) => { for (const m of mistMats) m.uniforms.time.value = t; });

  // ---- sun shafts: tall additive cards leaning along the light direction
  if (quality !== 'low') {
    const mat = shaftMaterial();
    const dir = sunDir.clone().normalize();
    const shafts = quality === 'high' ? 7 : 4;
    for (let i = 0; i < shafts; i++) {
      const w = 2.5 + Math.random() * 3.5, h = 26;
      const card = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      const z = -14 + i * (28 / Math.max(1, shafts - 1)) + (Math.random() - .5) * 3;
      const x = (Math.random() - .5) * 8;
      // The card's long axis runs along the light; it starts on the court
      // floor and reaches up toward the sun.
      card.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      card.rotateY(Math.PI / 2 + (Math.random() - .5) * .6);   // broadside to the court's long axis
      card.position.set(x, 0, z).addScaledVector(dir, h * .5);
      card.renderOrder = 6;
      group.add(card);
    }
    updaters.push((dt, t) => { mat.uniforms.time.value = t; });
  }

  // ---- braziers: copal smoke and embers
  const emitters = [];
  arena.updateMatrixWorld(true);
  for (const flame of arena.userData.flames || []) emitters.push(flame.getWorldPosition(new THREE.Vector3()));
  if (emitters.length) {
    const smoke = new Rising(group, emitters, Math.round(140 * tier), {
      texture: softDot('rgba(220,210,200,.9)'), size: 1.6, color: 0xcfc6bc, opacity: .22, blending: THREE.NormalBlending,
      rise: .9, spread: .3, life: 5.5, sway: .5,
    });
    const embers = new Rising(group, emitters, Math.round(120 * tier), {
      texture: softDot('rgba(255,200,120,1)'), size: .12, color: 0xffa040, opacity: .9, blending: THREE.AdditiveBlending,
      rise: 1.8, spread: .25, life: 1.8, sway: 1.2,
    });
    updaters.push((dt, t) => { smoke.update(dt, t); embers.update(dt, t); });
  }

  // ---- drifting leaves and ash across the court
  if (quality !== 'low') {
    const count = Math.round(90 * tier);
    const pos = new Float32Array(count * 3), seed = new Float32Array(count);
    for (let i = 0; i < count; i++) { pos[i * 3] = (Math.random() - .5) * 30; pos[i * 3 + 1] = Math.random() * 9; pos[i * 3 + 2] = (Math.random() - .5) * 40; seed[i] = Math.random() * 10; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const leaves = new THREE.Points(geo, new THREE.PointsMaterial({ map: leafTexture(), size: .32, transparent: true, alphaTest: .4, depthWrite: true }));
    leaves.frustumCulled = false; group.add(leaves);
    updaters.push((dt, t) => {
      for (let i = 0; i < count; i++) {
        pos[i * 3] += (1.4 + Math.sin(t + seed[i]) * .8) * dt;
        pos[i * 3 + 1] -= (.45 + Math.sin(t * 2 + seed[i]) * .3) * dt;
        pos[i * 3 + 2] += Math.cos(t * .7 + seed[i]) * .6 * dt;
        if (pos[i * 3 + 1] < 0 || pos[i * 3] > 15) { pos[i * 3] = -15; pos[i * 3 + 1] = 5 + Math.random() * 5; pos[i * 3 + 2] = (Math.random() - .5) * 40; }
      }
      geo.attributes.position.needsUpdate = true;
    });
  }

  scene.add(group);
  return { group, update(dt, t) { for (const u of updaters) u(dt, t); } };
}
