// The fighters you can play, drawn from Maya myth. Every fighter shares one
// rig and moveset — the choice is who you are, not a stat sheet — so a pick
// never unbalances a match. Each has a baked costume (tools/bake-costume.mjs)
// and a headdress built in code below.
import * as THREE from 'three';

export const ROSTER = [
  { id: 'balam',   name: 'Balam',     title: 'Jaguar Warrior',      blurb: 'Gold pelt and jade. The night sun in a warrior’s body.', swatch: ['#c68e3a', '#2d6e60', '#2c1c10'], gear: 'jaguar', nawal: 'jaguar' },
  { id: 'kuk',     name: "K'uk'",     title: 'Quetzal Warrior',     blurb: 'Plumes of the sacred quetzal, worth more than gold.', swatch: ['#2e8070', '#c49c50', '#963c34'], gear: 'quetzal', nawal: 'jade' },
  { id: 'hunahpu', name: 'Hunahpu',   title: 'Hero Twin',           blurb: 'Ballplayer of the Popol Vuh who beat the lords of Xibalba. His nawal: a tiger from beyond the sea.', swatch: ['#b03024', '#e8dcc4', '#18100e'], gear: 'twin', nawal: 'tiger' },
  { id: 'kot',     name: 'Kot',       title: 'Eagle Sorcerer',      blurb: 'Barred plumes and a beaked helm. His nawal is the coyote.', swatch: ['#d6c8ac', '#5c3e26', '#cea248'], gear: 'eagle', nawal: 'coyote' },
  { id: 'sotz',    name: "Kamazotz",  title: 'Death Bat',           blurb: 'The bat of the House of Bats, blood-red and silent.', swatch: ['#34303a', '#801e22', '#a48454'], gear: 'bat', nawal: 'panther' },
  { id: 'vucub',   name: 'Vucub-Kame', title: 'Seven Death',        blurb: 'Sorcerer-lord of Xibalba. His nawal is a tiger from beyond the sea.', swatch: ['#4a1e5a', '#e6dcc0', '#c2402a'], gear: 'skull', nawal: 'shadow' },
  { id: 'kame',    name: 'Hun-Kame',  title: 'Lord of Xibalba',     blurb: 'One Death, ruler of the underworld court.', swatch: ['#e2d6ba', '#141212', '#467868'], gear: 'skull', nawal: 'bone' },
];

export const DEFAULT_LOOK = { balam: 'balam', kuk: 'kuk' };
export const lookById = (id) => ROSTER.find((r) => r.id === id) || ROSTER[0];

const KEY = 'ssl-fighter';
export function savedLook() {
  try { const id = localStorage.getItem(KEY); return ROSTER.some((r) => r.id === id) ? id : 'balam'; } catch { return 'balam'; }
}
export function saveLook(id) { try { localStorage.setItem(KEY, id); } catch { /* private mode */ } }

// ------------------------------------------------------------- headdresses
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .8, metalness: 0, ...extra });
const featherMat = (color) => mat(color, { side: THREE.DoubleSide, roughness: .7 });

function feather(color, length = .55, width = .09) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(width, length * .45, 0, length);
  shape.quadraticCurveTo(-width, length * .45, 0, 0);
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape, 6), featherMat(color));
  mesh.castShadow = true;
  return mesh;
}

/** A fan of plumes rising behind the head. */
function plumeFan(group, colors, count, spread, length, tilt = -.35) {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1) - .5;
    const f = feather(colors[i % colors.length], length * (1 - Math.abs(t) * .35));
    f.position.set(0, .1, -.08);
    f.rotation.set(tilt, 0, t * spread);
    group.add(f);
  }
}

/**
 * Headdress in head-bone-relative metres (y up from the bone, z forward).
 * Returned unscaled; the caller sizes it to the fighter.
 */
export function buildHeadgear(gear) {
  const g = new THREE.Group();
  const gold = mat(0xc89a48, { metalness: .6, roughness: .4 });
  switch (gear) {
    case 'jaguar': {
      const pelt = mat(0xc68e3a);
      for (const s of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(.045, .09, 6), pelt);
        ear.position.set(s * .08, .25, -.01); g.add(ear);
      }
      const snout = new THREE.Mesh(new THREE.BoxGeometry(.14, .05, .08), pelt);
      snout.position.set(0, .2, .1); g.add(snout);
      plumeFan(g, [0xe2b04a, 0x2d6e60], 3, .9, .4);
      break;
    }
    case 'quetzal':
      plumeFan(g, [0x2e9c84, 0x1f7a68, 0x3cb89a], 7, 1.6, .75, -.5);
      { const band = new THREE.Mesh(new THREE.TorusGeometry(.105, .018, 6, 16), gold); band.rotation.x = Math.PI / 2; band.position.y = .17; g.add(band); }
      break;
    case 'twin': {
      const band = new THREE.Mesh(new THREE.TorusGeometry(.105, .022, 6, 16), mat(0xb03024));
      band.rotation.x = Math.PI / 2; band.position.y = .16; g.add(band);
      plumeFan(g, [0xf0e8d6, 0xb03024], 3, .7, .45, -.2);
      break;
    }
    case 'eagle': {
      const beak = new THREE.Mesh(new THREE.ConeGeometry(.05, .16, 8), gold);
      beak.rotation.x = Math.PI / 2 + .5; beak.position.set(0, .21, .14); g.add(beak);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(.12, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xd6c8ac));
      cap.position.y = .16; g.add(cap);
      plumeFan(g, [0xece2cc, 0x5c3e26], 5, 1.2, .5, -.6);
      break;
    }
    case 'bat':
      for (const s of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(.06, .26, 4), mat(0x2a242e));
        ear.position.set(s * .1, .3, -.02); ear.rotation.z = -s * .35; g.add(ear);
        const inner = new THREE.Mesh(new THREE.ConeGeometry(.03, .16, 4), mat(0x801e22));
        inner.position.set(s * .1, .28, .01); inner.rotation.z = -s * .35; g.add(inner);
      }
      break;
    case 'skull': {
      const bone = mat(0xe2d6ba);
      for (let i = 0; i < 7; i++) {
        const a = (i / 6 - .5) * 2.2;
        const spike = new THREE.Mesh(new THREE.CylinderGeometry(.012, .02, .16, 5), bone);
        spike.position.set(Math.sin(a) * .11, .26, Math.cos(a) * .02 - .02);
        spike.rotation.z = -a * .25; g.add(spike);
      }
      const band = new THREE.Mesh(new THREE.TorusGeometry(.108, .02, 6, 16), mat(0x467868));
      band.rotation.x = Math.PI / 2; band.position.y = .17; g.add(band);
      break;
    }
    default: break;
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
