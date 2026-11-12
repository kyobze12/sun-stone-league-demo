// Duel effects: K'ak' fire blasts and the nawal — the animal spirit a
// fighter transforms into. In Maya belief a person's nawal (way) is an animal
// co-essence that the powerful could take the shape of; here a full Sun meter
// lets a fighter become theirs for a few seconds.
//
// The spirit beasts are built in code: a low-poly big cat in the same chunky
// proportions as the KayKit fighters, with a coat painted on a canvas and a
// glowing aura shell, animated with a procedural gait.
import * as THREE from 'three';
import { buildCoyote, animateCoyote, hasCoyote } from './wildlife.js';

// ---------------------------------------------------------------- coats
export const NAWAL = {
  jaguar:  { name: 'Jaguar',          base: '#d9952e', spot: '#1e1208', pattern: 'rosette', glow: 0xffb040 },
  jade:    { name: 'Jade Jaguar',     base: '#2fa88a', spot: '#0b3a30', pattern: 'rosette', glow: 0x6fffd0 },
  fire:    { name: 'Sun Jaguar',      base: '#ff8a2a', spot: '#7a1a06', pattern: 'rosette', glow: 0xff6a1a },
  tiger:   { name: 'Tiger',           base: '#e8792a', spot: '#140c08', pattern: 'stripes', glow: 0xffa040 },
  panther: { name: 'Shadow Panther',  base: '#1c1622', spot: '#3a2a4a', pattern: 'none',    glow: 0xb070ff },
  coyote:  { name: 'Coyote',          base: '#c9a072', spot: '#5a3a1e', pattern: 'none',    glow: 0xffc080 },
  bone:    { name: 'Bone Jaguar',     base: '#ece2c8', spot: '#6a5a40', pattern: 'stripes', glow: 0xd8f0ff },
  shadow:  { name: 'Night Tiger',     base: '#3a1a5a', spot: '#0a0410', pattern: 'stripes', glow: 0xd040ff },
};

function coatTexture(def) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = def.base; g.fillRect(0, 0, 256, 128);
  // Pale belly band
  const belly = g.createLinearGradient(0, 0, 0, 128);
  belly.addColorStop(0, 'rgba(255,240,210,0)'); belly.addColorStop(.8, 'rgba(255,240,210,0)'); belly.addColorStop(1, 'rgba(255,240,210,.45)');
  g.fillStyle = belly; g.fillRect(0, 0, 256, 128);
  g.fillStyle = def.spot; g.strokeStyle = def.spot;
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  if (def.pattern === 'rosette') {
    for (let i = 0; i < 70; i++) {
      const x = rnd() * 256, y = rnd() * 116, r = 4 + rnd() * 5;
      g.lineWidth = 2.2;
      for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2 + rnd(); g.beginPath(); g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, 1.8 + rnd() * 1.2, 0, Math.PI * 2); g.fill(); }
      if (rnd() > .5) { g.beginPath(); g.arc(x, y, 1.2, 0, Math.PI * 2); g.fill(); }
    }
  } else if (def.pattern === 'stripes') {
    for (let i = 0; i < 26; i++) {
      const x = i * 10 + rnd() * 4;
      g.lineWidth = 2.5 + rnd() * 3;
      g.beginPath(); g.moveTo(x, 0); g.quadraticCurveTo(x + 6 - rnd() * 12, 40, x + rnd() * 6, 70 + rnd() * 30); g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------- beast
/** A big cat, ~2.4 m nose to tail, shoulder ~1.1 m, facing +z. */
export function buildBeast(kind = 'jaguar') {
  const def = NAWAL[kind] || NAWAL.jaguar;
  const coat = coatTexture(def);
  const skin = new THREE.MeshStandardMaterial({ map: coat, roughness: .7, emissive: def.glow, emissiveIntensity: .22, transparent: true, opacity: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: def.spot, roughness: .6, emissive: def.glow, emissiveIntensity: .1 });
  const eye = new THREE.MeshBasicMaterial({ color: def.glow });
  const aura = new THREE.MeshBasicMaterial({ color: def.glow, transparent: true, opacity: .28, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false });
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const parts = [];
  // Smooth, high-segment ellipsoids blended by overlap read as one sculpted
  // body rather than a stack of primitives.
  const ell = (rx, ry, rz) => { const g = new THREE.SphereGeometry(1, 32, 22); g.scale(rx, ry, rz); return g; };
  const add = (geo, mat, pos, parent = body, rot = null) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(...pos); if (rot) m.rotation.set(...rot);
    m.castShadow = true; parent.add(m); parts.push(m); return m;
  };
  // Torso: deep chest, tucked waist, muscular haunches; a slight dip in the back
  add(ell(.36, .42, .5), skin, [0, 1.02, .42]);                 // chest
  add(ell(.3, .32, .5), skin, [0, 1.0, -.05]);                  // belly / waist
  add(ell(.34, .38, .42), skin, [0, 1.04, -.5]);                // haunches
  add(ell(.22, .2, .34), skin, [0, 1.3, .62], body, [-.5, 0, 0]);   // shoulders / scruff
  add(new THREE.CylinderGeometry(.17, .24, .5, 20), skin, [0, 1.28, .78], body, [-1.0, 0, 0]);   // neck
  // Head: broad skull, heavy cheeks, short muzzle
  const head = new THREE.Group(); head.position.set(0, 1.42, 1.02); body.add(head);
  add(ell(.25, .21, .25), skin, [0, 0, 0], head);               // skull
  for (const s of [-1, 1]) add(ell(.12, .11, .12), skin, [s * .13, -.07, .08], head);   // cheeks
  add(ell(.13, .1, .14), skin, [0, -.06, .2], head);            // muzzle
  add(ell(.05, .035, .04), dark, [0, -.01, .33], head);         // nose
  for (const s of [-1, 1]) {
    const ear = add(new THREE.ConeGeometry(.075, .12, 16), skin, [s * .16, .19, -.06], head, [0, 0, -s * .3]);
    ear.scale.z = .5;
    add(ell(.035, .025, .02), eye, [s * .1, .04, .2], head);    // glowing eyes
  }
  const jaw = add(ell(.1, .04, .1), dark, [0, -.15, .17], head);
  // Legs: thick upper limbs tapering to slim wrists and broad paws
  const legs = [];
  for (const [x, z, front] of [[-.2, .5, true], [.2, .5, true], [-.2, -.52, false], [.2, -.52, false]]) {
    const hip = new THREE.Group(); hip.position.set(x, 1.0, z); body.add(hip);
    add(ell(.14, .32, front ? .16 : .2), skin, [0, -.18, front ? 0 : -.03], hip);
    const knee = new THREE.Group(); knee.position.set(0, -.48, front ? 0 : -.06); hip.add(knee);
    add(new THREE.CylinderGeometry(.07, .09, .4, 16), skin, [0, -.2, 0], knee);
    add(ell(.11, .06, .14), skin, [0, -.42, .05], knee);        // paw
    legs.push({ hip, knee, front, phase: (front ? 0 : Math.PI) + (x < 0 ? 0 : Math.PI * .5) });
  }
  // Tail: a long, tapering chain that curls at the tip
  const tail = []; let parent = body; let pos = [0, 1.15, -.86];
  for (let i = 0; i < 9; i++) {
    const seg = new THREE.Group(); seg.position.set(...pos); parent.add(seg);
    const r = .075 - i * .005;
    add(new THREE.CylinderGeometry(r * .9, r, .17, 14), i >= 7 ? dark : skin, [0, 0, -.085], seg, [Math.PI / 2, 0, 0]);
    tail.push(seg); parent = seg; pos = [0, 0, -.17];
  }
  // Aura: an additive back-face shell over the torso and head
  const shell = new THREE.Mesh(new THREE.CapsuleGeometry(.6, 1.6, 8, 24), aura);
  shell.rotation.x = Math.PI / 2; shell.position.set(0, 1.05, .15); body.add(shell);
  root.userData = { body, head, jaw, legs, tail, shell, def, gait: 0, lunge: 0, materials: [skin, dark, aura, eye] };
  return root;
}

/** Procedural gait. `speed` m/s, `attack` 0..1 pounce progress. */
export function animateBeast(beast, dt, speed, attack, time) {
  const u = beast.userData;
  const m = Math.min(1, speed / 7);
  u.gait += dt * (4 + m * 9);
  for (const leg of u.legs) {
    const s = Math.sin(u.gait + leg.phase);
    leg.hip.rotation.x = s * .7 * m - (leg.front ? attack * 1.1 : -attack * .3);
    leg.knee.rotation.x = Math.max(0, -Math.cos(u.gait + leg.phase)) * .9 * m + (leg.front ? attack * .6 : 0);
  }
  u.body.position.y = Math.abs(Math.sin(u.gait)) * .06 * m + attack * .35 - .1;
  u.body.rotation.x = -attack * .45 + Math.sin(u.gait * 2) * .03 * m;
  u.head.rotation.x = attack * .5;
  u.jaw.position.y = -.18 - attack * .1;
  u.tail.forEach((seg, i) => { seg.rotation.y = Math.sin(time * 2.6 - i * .5) * .16; seg.rotation.x = (i < 3 ? .12 : -.08) + (i > 6 ? -.25 : 0); });
  u.shell.material.opacity = .2 + Math.sin(time * 6) * .08 + attack * .2;
}

// ---------------------------------------------------------------- fire blast
function glowSprite(color, size) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(.25, 'rgba(255,255,255,.8)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(size);
  return s;
}

export class DuelFx {
  constructor(scene, particles) {
    this.scene = scene; this.particles = particles;
    this.blasts = new Map();
    this.beasts = new Map();   // fighter id -> beast
    this.rings = [];
  }

  /** An expanding ring of light on the floor: heavy blows, transformations. */
  shockwave(pos, color, radius = 3.2) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(.6, .85, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.copy(pos);
    ring.userData = { age: 0, life: .45, radius };
    this.scene.add(ring); this.rings.push(ring);
  }
  updateRings(dt) {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i], u = r.userData;
      u.age += dt; const k = u.age / u.life;
      r.scale.setScalar(1 + k * u.radius); r.material.opacity = .85 * (1 - k);
      if (k >= 1) { this.scene.remove(r); r.geometry.dispose(); r.material.dispose(); this.rings.splice(i, 1); }
    }
  }

  syncBlasts(projectiles, dt) {
    const seen = new Set();
    for (const f of projectiles) {
      seen.add(f.id);
      let g = this.blasts.get(f.id);
      if (!g) {
        g = new THREE.Group();
        g.add(glowSprite(0xffd27a, .7 + f.power * .4));
        g.add(glowSprite(0xff5a12, 1.6 + f.power * .8));
        this.scene.add(g); this.blasts.set(f.id, g);
      }
      g.position.copy(f.pos);
      g.children[1].material.rotation += dt * 6;
      // Ember trail
      if (Math.random() < .7) this.particles.burst(f.pos.clone(), Math.random() < .5 ? 0xff7a1a : 0xffd27a, 2, 1.2, 1.5);
    }
    for (const [id, g] of this.blasts) if (!seen.has(id)) this.drop(id);
  }

  drop(id) {
    const g = this.blasts.get(id); if (!g) return;
    this.scene.remove(g);
    g.children.forEach((s) => { s.material.map.dispose(); s.material.dispose(); });
    this.blasts.delete(id);
  }

  /** Show or hide a fighter's spirit beast; the human body hides while it runs. */
  syncSpirit(fighter, player, dt, time) {
    const active = player.spirit > 0;
    let beast = this.beasts.get(fighter.id);
    if (!active && !beast) { if (!fighter.character.visible) fighter.character.visible = true; return; }
    if (active && !beast) {
      beast = (fighter.nawal === 'coyote' && hasCoyote()) ? buildCoyote(NAWAL.coyote.glow) : buildBeast(fighter.nawal === 'coyote' ? 'jaguar' : (fighter.nawal || 'jaguar'));
      beast.userData.def = beast.userData.def || NAWAL[fighter.nawal] || NAWAL.jaguar;
      beast.userData.appear = 0;
      this.scene.add(beast); this.beasts.set(fighter.id, beast);
    }
    if (!beast) return;
    if (!active) {
      this.scene.remove(beast);
      beast.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
      (beast.userData.materials || []).forEach((m) => { m.map?.dispose(); m.dispose(); });
      this.beasts.delete(fighter.id);
      fighter.character.visible = true;
      return;
    }
    const u = beast.userData;
    u.appear = Math.min(1, u.appear + dt * 3);
    beast.scale.setScalar(.3 + .7 * THREE.MathUtils.smootherstep(u.appear, 0, 1));
    beast.position.copy(fighter.character.position);
    beast.rotation.y = player.facing;
    fighter.character.visible = u.appear < .5;     // the warrior dissolves into the beast
    const attack = player.swingTimer > 0 ? Math.sin((1 - player.swingTimer / .35) * Math.PI) : 0;
    // Spirit fire streaming off the beast.
    if (Math.random() < .6) this.particles.burst(beast.position.clone().add(new THREE.Vector3((Math.random() - .5) * .8, 1 + Math.random() * .6, (Math.random() - .5) * 1.4)), u.def.glow, 1, .8, 1.2);
    if (u.coyote) animateCoyote(beast, dt, player.speed, Math.max(0, attack));
    else animateBeast(beast, dt, player.speed, Math.max(0, attack), time);
  }

  clear() {
    for (const id of [...this.blasts.keys()]) this.drop(id);
    for (const [id, beast] of this.beasts) { this.scene.remove(beast); this.beasts.delete(id); }
  }
}
