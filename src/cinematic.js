// Cinematic layer: colour grade, sun flare, drifting dust and a rim light.
//
// The look being chased is the late-afternoon action-adventure palette —
// warm sunlit stone, cool teal shadows, crushed-but-not-black blacks, a soft
// vignette pulling the eye to the middle, and dust hanging in the light.
// Everything here is optional and scaled by the quality tier: a low-tier phone
// gets the rim light only.
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';

// ---------------------------------------------------------------- grade
// Runs after OutputPass, so it works on display-referred sRGB colour like a
// colourist's LUT would. Written as maths rather than a LUT file: the LUTs in
// the three.js examples carry third-party copyright notices with no licence.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    strength: { value: 1 },
    vignette: { value: .38 },
    grain: { value: .025 },
    aspect: { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float time, strength, vignette, grain, aspect;
    varying vec2 vUv;
    float luma(vec3 c) { return dot(c, vec3(.2126, .7152, .0722)); }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = src.rgb;
      float l = luma(c);
      // Split-tone: teal into the shadows, amber into the highlights.
      vec3 shadowTint = vec3(-.035, .012, .045);
      vec3 highTint = vec3(.05, .018, -.04);
      vec3 g = c + shadowTint * (1. - smoothstep(.0, .5, l)) + highTint * smoothstep(.45, 1., l);
      // Gentle S-curve for contrast, lifted toe so shadows keep detail.
      g = mix(g, g * g * (3. - 2. * g), .35);
      g = g * .96 + .018;
      // Pull saturation back a touch except in the warm mid-tones.
      float gl = luma(g);
      float warm = smoothstep(.0, .25, g.r - g.b);
      g = mix(vec3(gl), g, mix(.86, 1.06, warm));
      // Vignette, rounder on wide screens.
      vec2 d = (vUv - .5) * vec2(aspect, 1.) / max(aspect, 1.) * 1.6;
      g *= 1. - vignette * smoothstep(.35, 1.15, dot(d, d));
      // Fine animated grain hides banding in the sky and the haze.
      g += (hash(vUv * 917. + time) - .5) * grain;
      gl_FragColor = vec4(mix(c, g, strength), src.a);
    }`,
};

export function createGradePass() {
  const pass = new ShaderPass(GradeShader);
  pass.uniforms.aspect.value = innerWidth / innerHeight;
  return pass;
}

// ---------------------------------------------------------------- dust
function dustMaterial(map) {
  return new THREE.PointsMaterial({
    map, size: .09, sizeAttenuation: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, color: 0xffd7a0, opacity: .55,
  });
}

class Dust {
  constructor(scene, map, count) {
    const pos = new Float32Array(count * 3);
    this.seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - .5) * 16;
      pos[i * 3 + 1] = Math.random() * 7 + .2;
      pos[i * 3 + 2] = (Math.random() - .5) * 38;
      this.seed[i] = Math.random() * 100;
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.points = new THREE.Points(this.geometry, dustMaterial(map));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  update(dt, t) {
    const p = this.geometry.attributes.position.array;
    for (let i = 0; i < this.seed.length; i++) {
      const s = this.seed[i];
      p[i * 3] += Math.sin(t * .3 + s) * .12 * dt + .05 * dt;
      p[i * 3 + 1] += (Math.sin(t * .5 + s * 1.7) * .08 + .02) * dt;
      p[i * 3 + 2] += Math.cos(t * .25 + s) * .1 * dt;
      if (p[i * 3 + 1] > 7.5) p[i * 3 + 1] = .2;
      if (p[i * 3] > 8) p[i * 3] = -8;
    }
    this.geometry.attributes.position.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- setup
/**
 * @param {THREE.Scene} scene
 * @param {{sun: THREE.DirectionalLight}} lights from addLighting
 * @param {'low'|'medium'|'high'} quality
 */
export async function addCinematics(scene, lights, quality, manager) {
  // Cool rim light from opposite the sun: separates the fighters from the
  // stone behind them, the single biggest step toward a "hero" read.
  const rim = new THREE.DirectionalLight(0x9fc4ff, quality === 'low' ? .55 : .75);
  rim.position.copy(lights.sun.position).multiplyScalar(-1).setY(9);
  scene.add(rim);

  const result = { rim, dust: null, update() {} };
  if (quality === 'low') return result;

  const loader = new THREE.TextureLoader(manager);
  const load = (name) => loader.loadAsync(`./assets/fx/${name}`).catch(() => null);
  const [flareMain, flareGhost, spark] = await Promise.all([load('lensflare0.png'), load('lensflare3.png'), load('spark1.png')]);

  if (flareMain && flareGhost) {
    // A point light far along the sun's direction carries the flare; it adds
    // no light of its own.
    const carrier = new THREE.PointLight(0xffffff, 0, 1);
    carrier.position.copy(lights.sun.position).normalize().multiplyScalar(140);
    const flare = new Lensflare();
    const warm = new THREE.Color(0xffc98a);
    flare.addElement(new LensflareElement(flareMain, quality === 'high' ? 520 : 420, 0, warm));
    flare.addElement(new LensflareElement(flareGhost, 50, .55, new THREE.Color(0xffb070)));
    flare.addElement(new LensflareElement(flareGhost, 80, .75, new THREE.Color(0x9fd9c8)));
    flare.addElement(new LensflareElement(flareGhost, 110, .95, new THREE.Color(0xffd9a0)));
    carrier.add(flare);
    scene.add(carrier);
  }

  if (spark) {
    result.dust = new Dust(scene, spark, quality === 'high' ? 700 : 380);
  }

  result.update = (dt, t) => { result.dust?.update(dt, t); };
  return result;
}
