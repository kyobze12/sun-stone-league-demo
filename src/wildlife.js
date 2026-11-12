// Wildlife of the Maya lowlands: scarlet macaws and jabiru storks wheeling
// over the city, and the coyote — a nawal in its own right — as a rigged,
// animated spirit beast.
//
//   Parrot.glb, Stork.glb  three.js example models (morph-target flight cycles)
//   Fox.glb                Khronos glTF sample (rig + Survey/Walk/Run clips),
//                          CC-BY 4.0 — see docs/ASSET_SOURCES.md
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

const MODELS = {};

export async function loadWildlife(manager) {
  const loader = new GLTFLoader(manager);
  await Promise.all(['Parrot', 'Stork', 'Fox'].map((name) => loader.loadAsync(`./assets/animals/${name}.glb`)
    .then((gltf) => { MODELS[name] = gltf; })
    .catch(() => {})));
  return Object.keys(MODELS).length;
}
export const hasCoyote = () => !!MODELS.Fox;

/** Birds circling the court on slow, overlapping loops. */
export function addFlocks(scene, quality = 'medium') {
  const birds = [];
  const flock = (name, count, scale, radius, height, speed) => {
    const gltf = MODELS[name]; if (!gltf) return;
    for (let i = 0; i < count; i++) {
      const bird = gltf.scene.clone();
      bird.scale.setScalar(scale);
      const mixer = new THREE.AnimationMixer(bird);
      const action = mixer.clipAction(gltf.animations[0]); action.play(); action.time = Math.random();
      action.timeScale = .8 + Math.random() * .4;
      bird.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.material = o.material.clone(); o.material.fog = true; } });
      scene.add(bird);
      birds.push({ bird, mixer, radius: radius * (.75 + Math.random() * .5), height: height + Math.random() * 6, speed: speed * (.8 + Math.random() * .4) * (Math.random() < .5 ? 1 : -1), phase: Math.random() * Math.PI * 2, center: new THREE.Vector3((Math.random() - .5) * 20, 0, (Math.random() - .5) * 30) });
    }
  };
  flock('Parrot', quality === 'low' ? 3 : 7, .028, 30, 13, .22);   // scarlet macaws
  flock('Stork', quality === 'low' ? 1 : 3, .03, 55, 22, .1);      // jabiru storks, higher and wider
  const tmp = new THREE.Vector3();
  return {
    update(dt, t) {
      for (const b of birds) {
        const a = b.phase + t * b.speed;
        b.bird.position.set(b.center.x + Math.cos(a) * b.radius, b.height + Math.sin(t * .5 + b.phase) * 1.5, b.center.z + Math.sin(a) * b.radius);
        // Face along the direction of travel.
        tmp.set(-Math.sin(a) * Math.sign(b.speed), 0, Math.cos(a) * Math.sign(b.speed));
        b.bird.rotation.y = Math.atan2(tmp.x, tmp.z);
        b.bird.rotation.z = -Math.sign(b.speed) * .25;   // bank into the turn
        b.mixer.update(dt);
      }
    },
  };
}

/** The coyote nawal: the rigged fox, recoloured and glowing. ~2.3 m long. */
export function buildCoyote(glow = 0xffb070) {
  const gltf = MODELS.Fox; if (!gltf) return null;
  const body = cloneSkeleton(gltf.scene);
  body.scale.setScalar(.017);
  body.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.material = o.material.clone();
    o.material.color = new THREE.Color(0xd8b48a);         // tawny coyote over the fox's orange
    o.material.emissive = new THREE.Color(glow); o.material.emissiveIntensity = .25;
  });
  const root = new THREE.Group(); root.add(body);
  const mixer = new THREE.AnimationMixer(body);
  const clips = Object.fromEntries(gltf.animations.map((c) => [c.name.toLowerCase(), mixer.clipAction(c)]));
  for (const action of Object.values(clips)) { action.play(); action.setEffectiveWeight(0); }
  clips.survey?.setEffectiveWeight(1);
  root.userData = { coyote: true, mixer, clips, weights: { survey: 1, walk: 0, run: 0 } };
  return root;
}

export function animateCoyote(beast, dt, speed, attack) {
  const u = beast.userData;
  const target = speed > 4 ? 'run' : speed > .6 ? 'walk' : 'survey';
  for (const [name, action] of Object.entries(u.clips)) {
    u.weights[name] = THREE.MathUtils.damp(u.weights[name] ?? 0, name === target ? 1 : 0, 10, dt);
    action.setEffectiveWeight(u.weights[name]);
  }
  if (u.clips.run) u.clips.run.timeScale = THREE.MathUtils.clamp(speed / 7, .8, 1.5);
  beast.children[0].rotation.x = -attack * .4;          // pounce
  beast.children[0].position.y = attack * .4;
  u.mixer.update(dt);
}
