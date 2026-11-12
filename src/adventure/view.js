// Draws the open world from the Adventure state. Trees, rocks and plants are
// instanced (one draw call per mesh of each model, however many there are);
// buildings and villagers are individual props.
import * as THREE from 'three';
import { prop } from '../props.js';
import { createCharacter, animateCharacter } from '../characters.js';
import { stoneMaterial } from '../court.js';
import { NPCS, PLACES, PLOTS, RIVER, BOUNDS, CROPS } from './data.js';

function grassTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#5f8a3a'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = Math.random();
    g.fillStyle = v < .4 ? 'rgba(40,80,28,.35)' : v < .8 ? 'rgba(130,170,70,.3)' : 'rgba(170,150,80,.25)';
    g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 3, 2 + Math.random() * 5);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(40, 40); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function label(text, color = '#fff3cf') {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = '700 30px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(20,8,4,.85)'; g.strokeText(text, 128, 32); g.fillStyle = color; g.fillText(text, 128, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  s.scale.set(3.2, .8, 1);
  return s;
}

/** One InstancedMesh per mesh of a prop; returns a setter for each instance. */
function instancedProp(scene, name, items, { tint = null, emissive = null } = {}) {
  const source = prop(name);
  if (!source || !items.length) return { show() {} };
  source.updateMatrixWorld(true);
  const meshes = [];
  source.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const dummy = new THREE.Object3D(), m = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const instanced = meshes.map((mesh) => {
    const material = mesh.material.clone();
    if (tint) material.color.multiply(new THREE.Color(tint));
    if (emissive) { material.emissive = new THREE.Color(emissive); material.emissiveIntensity = .5; }
    const im = new THREE.InstancedMesh(mesh.geometry, material, items.length);
    im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
    scene.add(im);
    return { im, local: mesh.matrixWorld.clone() };
  });
  const matrices = items.map((it) => {
    dummy.position.set(it.x, it.y || 0, it.z); dummy.rotation.set(0, it.rot || 0, 0); dummy.scale.setScalar(it.s || 1); dummy.updateMatrix();
    return dummy.matrix.clone();
  });
  const show = (i, visible) => {
    for (const { im, local } of instanced) { im.setMatrixAt(i, visible ? m.multiplyMatrices(matrices[i], local) : zero); im.instanceMatrix.needsUpdate = true; }
  };
  items.forEach((_, i) => show(i, true));
  return { show };
}

export class AdventureView {
  constructor(adventure, lookId) {
    this.adv = adventure;
    const scene = this.scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xa8c8a0, .012);
    scene.background = new THREE.Color(0x9fc8e8);
    this.hemi = new THREE.HemisphereLight(0xbfdcff, 0x5a6a34, .9); scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0c8, 2.4); this.sun.position.set(-20, 30, -12); scene.add(this.sun);
    this.sun.castShadow = true; this.sun.shadow.mapSize.setScalar(1024);
    Object.assign(this.sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 90 });
    scene.add(this.sun.target);

    // ---- ground, road, river
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    const dirt = new THREE.MeshStandardMaterial({ color: 0xa88458, roughness: 1 });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 44), dirt); road.rotation.x = -Math.PI / 2; road.position.set(0, .02, 20); road.receiveShadow = true; scene.add(road);
    const square = new THREE.Mesh(new THREE.CircleGeometry(11, 30), dirt); square.rotation.x = -Math.PI / 2; square.position.y = .02; square.receiveShadow = true; scene.add(square);
    this.water = new THREE.ShaderMaterial({
      transparent: true, uniforms: { time: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float time; varying vec2 vUv;
        void main(){ float f = sin(vUv.y * 90.0 + time * 1.6 + sin(vUv.x * 9.0) * 2.0) * .5 + .5;
          float shore = smoothstep(0.0, .18, vUv.x) * smoothstep(1.0, .82, vUv.x);
          vec3 c = mix(vec3(.10, .42, .50), vec3(.35, .75, .78), f * .35);
          gl_FragColor = vec4(mix(vec3(.75, .9, .85), c, shore), .9); }`,
    });
    const river = new THREE.Mesh(new THREE.PlaneGeometry(RIVER.x2 - RIVER.x1, 260), this.water);
    river.rotation.x = -Math.PI / 2; river.position.set((RIVER.x1 + RIVER.x2) / 2, .04, 0); scene.add(river);

    // ---- forest and resources (instanced)
    const nodes = adventure.world.nodes;
    const of = (type) => nodes.filter((n) => n.type === type);
    const at = (list, s, y = 0) => list.map((n) => ({ x: n.x, z: n.z, y, rot: n.rot, s: s * n.scale }));
    this.sets = {};
    const trees = of('tree'), half = Math.ceil(trees.length / 2);
    this.groups = [
      { list: trees.slice(0, half), live: instancedProp(scene, 'tree_single_A', at(trees.slice(0, half), 5.5)), dead: instancedProp(scene, 'tree_single_A_cut', at(trees.slice(0, half), 5.5)) },
      { list: trees.slice(half), live: instancedProp(scene, 'tree_single_B', at(trees.slice(half), 5.5)), dead: instancedProp(scene, 'tree_single_B_cut', at(trees.slice(half), 5.5)) },
      { list: of('rubber'), live: instancedProp(scene, 'tree_single_B', at(of('rubber'), 6), { tint: 0xd8e8c0, emissive: 0x20381a }), dead: null, keep: true },
      { list: of('rock'), live: instancedProp(scene, 'rock_single_A', at(of('rock'), 3.2)), dead: null },
      { list: of('jade'), live: instancedProp(scene, 'rock_single_C', at(of('jade'), 3.6), { tint: 0x9fe8c0, emissive: 0x1fa070 }), dead: null },
      { list: of('fiber'), live: instancedProp(scene, 'waterplant_A', at(of('fiber'), 3)), dead: null },
      { list: of('clay'), live: instancedProp(scene, 'rock_single_E', at(of('clay'), 2), { tint: 0xc07a4a }), dead: null },
    ];
    this.nodeState = new Map();
    // Far hills so the horizon is never empty.
    const ringOf = (name, count, r1, r2, s1, s2) => { const items = []; for (let i = 0; i < count; i++) { const a = i / count * Math.PI * 2 + Math.random() * .3, r = r1 + Math.random() * (r2 - r1); items.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, rot: Math.random() * 6, s: s1 + Math.random() * (s2 - s1) }); } instancedProp(scene, name, items); };
    ringOf('mountain_A_grass', 16, 84, 110, 14, 24); ringOf('hill_single_A', 22, 64, 80, 8, 14); ringOf('trees_A_large', 40, 60, 76, 5, 8);

    // ---- village
    const put = (name, x, z, { rot = 0, s = 1, y = 0 } = {}) => { const p = prop(name); if (!p) return null; p.position.set(x, y, z); p.rotation.y = rot; p.scale.setScalar(s); scene.add(p); return p; };
    put('building_home_A_yellow', -8, 6, { s: 5, rot: .5 }); put('building_home_B_yellow', 7, 9, { s: 5, rot: -.6 }); put('building_home_A_yellow', -11, -9, { s: 4.5, rot: 2.2 });
    put('building_well_yellow', 0, -1.5, { s: 4 }); put('building_market_yellow', PLACES.bench.x - 2.5, PLACES.bench.z - 1, { s: 4.5, rot: .9 });
    put('building_grain', PLOTS.x0 + 5, PLOTS.z0 + 11, { s: 4.5 }); put('wheelbarrow', PLOTS.x0 - 2, PLOTS.z0 + 3, { s: 2.5, rot: 1 }); put('sack', PLOTS.x0 - 2, PLOTS.z0 + 1, { s: 2.5 });
    put('tent', PLACES.range.x + 4, PLACES.range.z + 1, { s: 3.5, rot: -1.2 });
    this.targetProp = put('target', PLACES.range.x, PLACES.range.z - 8, { s: 4 });
    put('building_bridge_A', PLACES.dock.x - 2.2, PLACES.dock.z, { s: 3.2, rot: Math.PI / 2 }); put('bucket_water', PLACES.dock.x + 1.5, PLACES.dock.z + 1.5, { s: 2.5 });
    put('crate_A_small', -6, -6, { s: 2.6 }); put('resource_lumber', 5, -5, { s: 2.6 }); put('resource_stone', 6.5, -4, { s: 2.6 });
    for (let c = 0; c <= PLOTS.cols; c++) put('fence_wood_straight', PLOTS.x0 + c * PLOTS.size - 1 + 1, PLOTS.z0 + PLOTS.rows * PLOTS.size + .6, { s: 2 });
    // The court gate: a corbelled stone arch at the end of the road.
    const stone = stoneMaterial({ repeat: [.6, .6] });
    const gate = new THREE.Group(); gate.position.set(PLACES.gate.x, 0, PLACES.gate.z + 2);
    for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(1.6, 6, 1.8), stone); post.position.set(s * 2.6, 3, 0); post.castShadow = true; gate.add(post); }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(8.2, 1.3, 2.2), stone); lintel.position.y = 6.6; lintel.castShadow = true; gate.add(lintel);
    const crest = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.4, 1.6), stone); crest.position.y = 7.9; gate.add(crest);
    this.gateGlow = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 5.4), new THREE.MeshBasicMaterial({ color: 0xffc85a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.gateGlow.position.y = 2.9; gate.add(this.gateGlow);
    for (const s of [-1, 1]) { const wall = new THREE.Mesh(new THREE.BoxGeometry(12, 3.6, 1.6), stone); wall.position.set(s * 9.4, 1.8, 0); wall.castShadow = true; gate.add(wall); }
    scene.add(gate);

    // ---- milpa plots
    this.plots = {};
    const soil = new THREE.PlaneGeometry(PLOTS.size - .15, PLOTS.size - .15);
    for (let c = 0; c < PLOTS.cols; c++) for (let r = 0; r < PLOTS.rows; r++) {
      const tile = new THREE.Mesh(soil, new THREE.MeshStandardMaterial({ color: 0x6f9a44, roughness: 1 }));
      tile.rotation.x = -Math.PI / 2; tile.position.set(PLOTS.x0 + c * PLOTS.size + 1, .03, PLOTS.z0 + r * PLOTS.size + 1); tile.receiveShadow = true; scene.add(tile);
      const crop = new THREE.Group(); crop.position.copy(tile.position); scene.add(crop);
      for (const [dx, dz] of [[-.45, -.4], [.4, -.3], [0, .45]]) {
        const stalk = new THREE.Mesh(new THREE.ConeGeometry(.16, 1.5, 6), new THREE.MeshStandardMaterial({ color: 0x4f9a3a }));
        stalk.position.set(dx, .75, dz); stalk.castShadow = true; crop.add(stalk);
        const fruit = new THREE.Mesh(new THREE.SphereGeometry(.16, 8, 6), new THREE.MeshStandardMaterial({ color: 0xe8c33a }));
        fruit.position.set(dx + .12, .95, dz); crop.add(fruit);
      }
      this.plots[`${c},${r}`] = { tile, crop };
    }

    // ---- people
    this.player = createCharacter(null, { team: 'balam' }, lookId) || new THREE.Group();
    scene.add(this.player);
    this.npcs = NPCS.map((n) => {
      const body = createCharacter(null, { team: 'kuk' }, n.look) || new THREE.Group();
      body.position.set(n.x, 0, n.z); body.rotation.y = Math.atan2(-n.x, -n.z);
      const tag = label(n.name); tag.position.y = 3.1; body.add(tag);
      scene.add(body);
      return { def: n, body };
    });
    this.marker = label('!', '#ffd34e'); this.marker.scale.set(1.6, 1.6, 1); scene.add(this.marker);
    this.cursor = new THREE.Mesh(new THREE.RingGeometry(.7, .9, 28), new THREE.MeshBasicMaterial({ color: 0xffd34e, transparent: true, opacity: .8, depthWrite: false }));
    this.cursor.rotation.x = -Math.PI / 2; scene.add(this.cursor);
    this.float = new THREE.Mesh(new THREE.SphereGeometry(.18, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff5a3a, emissive: 0x802010 }));
    this.float.visible = false; scene.add(this.float);

    // Rain: a passing shower every few minutes.
    const drops = 500, rp = new Float32Array(drops * 3);
    for (let i = 0; i < drops; i++) { rp[i * 3] = (Math.random() - .5) * 44; rp[i * 3 + 1] = Math.random() * 18; rp[i * 3 + 2] = (Math.random() - .5) * 44; }
    this.rainGeo = new THREE.BufferGeometry(); this.rainGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.Points(this.rainGeo, new THREE.PointsMaterial({ color: 0xcfe4ff, size: .09, transparent: true, opacity: .6, depthWrite: false }));
    this.rain.frustumCulled = false; this.rain.visible = false; scene.add(this.rain);
    this.builds = new Map();
    this.time = 55;   // start in the morning
    this.camPos = new THREE.Vector3(0, 9, -16);
    this.sync(true);
  }

  buildMesh(piece) {
    const mats = {
      wood: new THREE.MeshStandardMaterial({ color: 0x8a5a30, roughness: .9 }),
      stone: new THREE.MeshStandardMaterial({ color: 0xb8ad98, roughness: .95 }),
      straw: new THREE.MeshStandardMaterial({ color: 0xc9a84a, roughness: 1 }),
      clay: new THREE.MeshStandardMaterial({ color: 0xb4633a, roughness: .8 }),
    };
    let mesh;
    if (piece.item === 'wall') { mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, .35), mats.wood); mesh.position.y = .75 + piece.y * 1.5; }
    else if (piece.item === 'block') { mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), mats.stone); mesh.position.y = .5 + piece.y * 1; }
    else if (piece.item === 'thatch') { mesh = new THREE.Mesh(new THREE.ConeGeometry(1.75, 1.3, 4), mats.straw); mesh.rotation.y = Math.PI / 4; mesh.position.y = .65 + piece.y * 1.5; }
    else if (piece.item === 'fence') { mesh = new THREE.Mesh(new THREE.BoxGeometry(2, .9, .14), mats.wood); mesh.position.y = .45; }
    else if (piece.item === 'pot') { mesh = new THREE.Mesh(new THREE.SphereGeometry(.45, 12, 10), mats.clay); mesh.scale.y = 1.2; mesh.position.y = .5; }
    else { mesh = new THREE.Mesh(new THREE.CylinderGeometry(.08, .1, 1.6, 6), mats.wood); mesh.position.y = .8;
      const flame = new THREE.Mesh(new THREE.SphereGeometry(.22, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffb040 })); flame.position.y = .95; mesh.add(flame); }
    mesh.position.x = piece.x; mesh.position.z = piece.z; mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }

  /** Bring the scene in line with the state. Cheap: only changes are applied. */
  sync(force = false) {
    const a = this.adv, s = a.s;
    for (const g of this.groups) g.list.forEach((n, i) => {
      const alive = a.alive(n);
      if (!force && this.nodeState.get(n.id) === alive) return;
      this.nodeState.set(n.id, alive);
      g.live.show(i, alive || !!g.keep); g.dead?.show(i, !alive);
    });
    for (const [key, view] of Object.entries(this.plots)) {
      const plot = s.plots[key];
      const state = !plot ? 'grass' : plot.state === 'tilled' ? 'tilled' : a.ripe(plot) ? 'ripe' : 'growing';
      view.tile.material.color.setHex(state === 'grass' ? 0x6f9a44 : 0x6a4424);
      view.crop.visible = plot?.state === 'planted';
      if (view.crop.visible) {
        const g = .25 + a.growth(plot) * .75;
        view.crop.scale.set(g, g, g);
        const ripe = state === 'ripe';
        view.crop.children.forEach((m, i) => { if (i % 2) { m.visible = ripe; m.material.color.setHex(CROPS[plot.crop].color); } });
      }
    }
    const seen = new Set();
    for (const piece of s.builds) {
      const key = `${piece.x},${piece.z},${piece.y}`; seen.add(key);
      if (!this.builds.has(key)) { const mesh = this.buildMesh(piece); this.scene.add(mesh); this.builds.set(key, mesh); }
    }
    for (const [key, mesh] of this.builds) if (!seen.has(key)) { this.scene.remove(mesh); mesh.geometry.dispose(); this.builds.delete(key); }
    this.gateGlow.material.opacity = s.fragments ? .25 + Math.min(.4, s.fragments * .1) : 0;
  }

  update(dt, camera, target) {
    const a = this.adv, s = a.s;
    this.time += dt;
    this.water.uniforms.time.value = this.time;
    // Day and night: a slow cycle from morning gold through noon to dusk and a blue night.
    const day = (this.time / 300) % 1, sunH = Math.sin(day * Math.PI * 2 - .4);
    const light = THREE.MathUtils.clamp(sunH * 1.4 + .6, .32, 1);   // nights stay bright enough to work in
    this.sun.intensity = 2.6 * light; this.hemi.intensity = .35 + .6 * light;
    const sky = new THREE.Color(0x0c1830).lerp(new THREE.Color(0x9fc8e8), light).lerp(new THREE.Color(0xf0a060), Math.max(0, .35 - Math.abs(sunH)) * 1.6);
    this.scene.background.copy(sky); this.scene.fog.color.copy(sky).lerp(new THREE.Color(0xa8c8a0), .4 * light);
    this.sun.position.set(s.x - 22 * Math.cos(day * Math.PI * 2), 30, s.z - 14); this.sun.target.position.set(s.x, 0, s.z);

    const raining = (this.time % 260) > 205;
    this.rain.visible = raining;
    if (raining) {
      const rp = this.rainGeo.attributes.position.array;
      for (let i = 0; i < rp.length; i += 3) { rp[i + 1] -= 22 * dt; if (rp[i + 1] < 0) rp[i + 1] = 18; }
      this.rainGeo.attributes.position.needsUpdate = true;
      this.rain.position.set(s.x, 0, s.z + 4);
      this.scene.fog.density = .022; this.scene.fog.color.lerp(new THREE.Color(0x7a8a90), .5); this.sun.intensity *= .55;
    } else this.scene.fog.density = .012;
    this.player.position.set(s.x, 0, s.z);
    this.player.rotation.y = s.facing;
    animateCharacter(this.player.userData.rig, a.moving * 6.2, 0, dt, this.time, { facing: s.facing });
    for (const n of this.npcs) animateCharacter(n.body.userData.rig, 0, 0, dt, this.time, { facing: n.body.rotation.y });
    const q = a.quest, who = q && this.npcs.find((n) => n.def.id === q.npc);
    this.marker.visible = !!who;
    if (who) this.marker.position.set(who.def.x, 4.2 + Math.sin(this.time * 3) * .15, who.def.z);
    this.cursor.visible = !!target && (target.kind === 'node' || target.kind === 'build' || target.kind === 'plot');
    if (this.cursor.visible) {
      const p = target.kind === 'node' ? target.node : target.kind === 'build' ? target.cell : this.plots[target.key].tile.position;
      this.cursor.position.set(p.x, .06, p.z);
    }
    this.float.visible = !!a.fishing;
    if (a.fishing) this.float.position.set(PLACES.dock.x - 3.4, a.fishing.phase === 'bite' ? -.05 + Math.sin(this.time * 30) * .06 : .12 + Math.sin(this.time * 2) * .03, PLACES.dock.z);

    // Follow camera: behind and above, looking north, lower and wider on a phone held sideways.
    const short = camera.aspect > 1.9, portrait = camera.aspect < 1;
    const want = new THREE.Vector3(s.x, portrait ? 13 : short ? 7.5 : 9, s.z - (portrait ? 13 : short ? 10 : 12));
    this.camPos.lerp(want, 1 - Math.exp(-6 * dt));
    camera.position.copy(this.camPos); camera.lookAt(s.x, 1.2, s.z + 3);
  }
}
