// What each ballcourt looks like. The rules that make them play differently
// (pillars, wind, pool) live in the simulation — see ARENAS in config.js and
// World.arenaTick; this file draws them and dresses the surroundings.
import * as THREE from 'three';
import { stoneMaterial } from './court.js';
import { prop } from './props.js';

function waterMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float time; varying vec2 vUv;
      void main(){
        vec2 p = vUv - .5; float r = length(p) * 2.0;
        float ripple = sin(r * 26.0 - time * 2.4) * .5 + .5;
        float swirl = sin(atan(p.y, p.x) * 5.0 + time * .6 + r * 6.0) * .5 + .5;
        vec3 deep = vec3(.02, .22, .30), light = vec3(.25, .78, .80);
        vec3 c = mix(deep, light, ripple * .25 + swirl * .15 + (1.0 - r) * .15);
        float rim = smoothstep(.86, 1.0, r);
        gl_FragColor = vec4(c + rim * .35, (1.0 - smoothstep(.97, 1.0, r)) * .88);
      }`,
  });
}

export function buildArena(scene, arena) {
  const group = new THREE.Group(); group.name = 'arena-dressing';
  const updaters = [];
  if (!arena || arena.id === 'city') { scene.add(group); return { group, update() {}, dispose() { scene.remove(group); } }; }
  const stone = stoneMaterial({ repeat: [.5, 1.2], color: 0x9aa884, bumpScale: .06 });

  // ---- pillars: broken column shafts with a mossy collar
  for (const o of arena.obstacles || []) {
    const h = 2.6 + Math.random() * 1.4;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(o.r * .92, o.r, h, 14), stone);
    shaft.position.set(o.x, h / 2, o.z); shaft.castShadow = true; shaft.receiveShadow = true; group.add(shaft);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(o.r * .7, o.r * .95, .35, 9), stone);
    cap.position.set(o.x + .08, h + .12, o.z); cap.rotation.z = .18; cap.castShadow = true; group.add(cap);
    const moss = new THREE.Mesh(new THREE.TorusGeometry(o.r * 1.02, .09, 6, 16), new THREE.MeshStandardMaterial({ color: 0x4d6a2c, roughness: 1 }));
    moss.rotation.x = Math.PI / 2; moss.position.set(o.x, .12, o.z); group.add(moss);
  }

  // ---- the sacred pool
  if (arena.pool) {
    const mat = waterMaterial();
    const water = new THREE.Mesh(new THREE.CircleGeometry(arena.pool.r, 40), mat);
    water.rotation.x = -Math.PI / 2; water.position.set(arena.pool.x, .035, arena.pool.z); water.renderOrder = 2; group.add(water);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(arena.pool.r, .16, 8, 40), stoneMaterial({ repeat: [6, .4], color: 0x8fa0a0 }));
    rim.rotation.x = Math.PI / 2; rim.position.set(arena.pool.x, .06, arena.pool.z); group.add(rim);
    updaters.push((dt, t) => { mat.uniforms.time.value = t; });
    // Glowing crystals in the cave dark
    const crystal = new THREE.MeshStandardMaterial({ color: 0x7ff0ff, emissive: 0x3fd0ff, emissiveIntensity: 1.6, roughness: .2 });
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 16;
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(.5 + Math.random() * .8, 0), crystal);
      c.position.set(Math.cos(a) * r, 5.6 + Math.random() * 4, Math.sin(a) * r * 1.5); c.scale.y = 1.8 + Math.random(); c.rotation.set(Math.random(), Math.random(), Math.random() * .6);
      group.add(c);
    }
  }

  // ---- wind: streaks that show which way it is blowing right now
  if (arena.wind) {
    const count = 70, pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { pos[i * 3] = (Math.random() - .5) * 16; pos[i * 3 + 1] = 1.5 + Math.random() * 7; pos[i * 3 + 2] = (Math.random() - .5) * 34; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const streaks = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: .14, transparent: true, opacity: .55, depthWrite: false }));
    streaks.frustumCulled = false; group.add(streaks);
    updaters.push((dt, t, world) => {
      const w = world?.windNow ?? 0;
      for (let i = 0; i < count; i++) {
        pos[i * 3] += w * 1.6 * dt;
        if (pos[i * 3] > 8) pos[i * 3] = -8; else if (pos[i * 3] < -8) pos[i * 3] = 8;
      }
      geo.attributes.position.needsUpdate = true;
      streaks.material.opacity = .15 + Math.min(.6, Math.abs(w) / 8);
    });
  }

  // ---- surroundings
  const scatter = (name, count, rMin, rMax, sMin, sMax, y = 0) => {
    for (let i = 0; i < count; i++) {
      const p = prop(name); if (!p) return;
      const a = Math.random() * Math.PI * 2, r = rMin + Math.random() * (rMax - rMin);
      const x = Math.cos(a) * r, z = Math.sin(a) * r * 1.4;
      if (Math.abs(x) < 15 && Math.abs(z) < 32) continue;   // never inside the court complex
      p.position.set(x, y, z); p.rotation.y = Math.random() * 6; p.scale.setScalar(sMin + Math.random() * (sMax - sMin));
      group.add(p);
    }
  };
  if (arena.env === 'jungle') { scatter('tree_single_A', 46, 16, 44, 4.5, 8); scatter('tree_single_B', 34, 16, 44, 4.5, 8); scatter('rock_single_C', 14, 15, 34, 3, 6); }
  if (arena.env === 'highland') { scatter('mountain_A_grass', 14, 46, 78, 9, 16); scatter('rock_single_A', 20, 16, 40, 4, 9); scatter('cloud_big', 9, 30, 70, 5, 9, 16); }
  if (arena.env === 'cenote') { scatter('rock_single_E', 30, 15, 36, 5, 11); scatter('waterplant_A', 12, 15, 26, 3, 5); }

  scene.add(group);
  return {
    group,
    update(dt, t, world) { for (const u of updaters) u(dt, t, world); },
    dispose() { scene.remove(group); group.traverse((o) => { if (o.isMesh || o.isPoints) o.geometry?.dispose(); }); },
  };
}
