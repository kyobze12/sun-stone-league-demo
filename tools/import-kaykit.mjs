// Imports the KayKit character packs (CC0, Kay Lousberg) as the fighters.
//
// The KayKit models are properly rigged — one shared 41-bone skeleton across
// every character — and ship ~90 hand-made animations: punches, kicks,
// blocks, hits, dodges, deaths, spellcasts, taunts. That is the move set a
// fighting game needs, and it replaces the auto-rigged mesh whose baked skins
// looked patchy.
//
// For each fighter this keeps the body (drops weapons, mugs, shields), strips
// the animations, and repaints the colour atlas into that fighter's Maya
// palette. One animation library is written separately and shared by all.
//
//   node tools/import-kaykit.mjs <dir with the KayKit .glb files>
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup } from '@gltf-transform/functions';
import { PNG } from 'pngjs';

const SRC = process.argv[2] || '/tmp/claude-0/kkdl';
const OUT = new URL('../public/assets/fighters/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const io = new NodeIO();

const PROPS = /Axe|Shield|Mug|Sword|Dagger|Knife|Throwable|Staff|Wand|Crossbow|Spellbook|Arrow|Quiver|Blade|Smokebomb|Bow/i;

// Palettes: each atlas swatch is classified (skin, blue cloth, metal, leather,
// rust, white cloth, dark) and repainted with the fighter's colour for that
// role, keeping the swatch's own light-to-dark gradient.
const FIGHTERS = {
  balam:   { src: 'Barbarian.glb',        pal: { skin: '#9a5a36', blue: '#c8902e', metal: '#d4a640', leather: '#3a2414', rust: '#2d7a66', white: '#e8d8b0', dark: '#1c120a', gold: '#e2b04a' } },
  kuk:     { src: 'Knight.glb',           pal: { skin: '#9a5a36', blue: '#1f9c84', metal: '#c9a24e', leather: '#5a2a1c', rust: '#b23a2e', white: '#e8dcc0', dark: '#123832', gold: '#e2b04a' } },
  hunahpu: { src: 'Rogue.glb',            pal: { skin: '#a8442e', blue: '#e9dcc2', metal: '#c89a48', leather: '#2a1a12', rust: '#b23024', white: '#f0e6d0', dark: '#140c0a', gold: '#e2b04a' } },
  kot:     { src: 'Mage.glb',             pal: { skin: '#8e5634', blue: '#e2d6b8', metal: '#c89a48', leather: '#5c3e26', rust: '#8a5a30', white: '#f4ecd8', dark: '#3a2616', gold: '#d8a848' } },
  sotz:    { src: 'Rogue_Hooded.glb',     pal: { skin: '#6a4a42', blue: '#2c2630', metal: '#8a6a44', leather: '#1a141c', rust: '#8e1e24', white: '#5a1a1e', dark: '#0e0a10', gold: '#a8844e' } },
  kame:    { src: 'Skeleton_Warrior.glb', pal: { skin: '#e6dcc0', blue: '#2e6e5c', metal: '#7a6a52', leather: '#1e1a18', rust: '#8a2a24', white: '#ece2c8', dark: '#121010', gold: '#b89a5a' } },
  vucub:   { src: 'Skeleton_Mage.glb',    pal: { skin: '#e6dcc0', blue: '#4a1e5a', metal: '#7a6a52', leather: '#1e1a18', rust: '#c2402a', white: '#ece2c8', dark: '#120c16', gold: '#c8a050' } },
};

// Clips the game uses, from the skeleton pack (a superset of the adventurers').
const CLIPS = [
  'Unarmed_Idle', 'Idle_Combat', 'Walking_A', 'Walking_Backwards', 'Running_A', 'Running_Strafe_Left', 'Running_Strafe_Right',
  'Unarmed_Melee_Attack_Punch_A', 'Unarmed_Melee_Attack_Punch_B', 'Unarmed_Melee_Attack_Kick', '2H_Melee_Attack_Spin',
  'Block', 'Blocking', 'Block_Hit', 'Hit_A', 'Hit_B', 'Death_A', 'Dodge_Forward', 'Dodge_Backward',
  'Spellcast_Shoot', 'Spellcast_Raise', 'Spellcast_Summon', 'Cheer', 'Taunt', 'Jump_Full_Short', 'Lie_StandUp', 'Throw', 'PickUp',
];

// Disposing an Animation leaves its keyframe accessors behind; drop them too.
// Keyframe-time accessors are shared between clips, so only drop ones that
// nothing else still uses.
function dropAnimation(anim) {
  const accessors = new Set();
  for (const sampler of anim.listSamplers()) { accessors.add(sampler.getInput()); accessors.add(sampler.getOutput()); sampler.dispose(); }
  for (const channel of anim.listChannels()) channel.dispose();
  anim.dispose();
  for (const accessor of accessors) {
    if (accessor && accessor.listParents().every((parent) => parent.propertyType === 'Root')) accessor.dispose();
  }
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function classify([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 510, s = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
  let h = 0;
  if (max !== min) { if (max === r) h = ((g - b) / (max - min)) % 6; else if (max === g) h = (b - r) / (max - min) + 2; else h = (r - g) / (max - min) + 4; h *= 60; if (h < 0) h += 360; }
  if (l < .16) return 'dark';
  if (s < .14) return l > .72 ? 'white' : 'metal';
  if (h >= 40 && h < 60 && s > .5) return 'gold';
  if (h >= 180 && h < 260) return 'blue';
  if (h < 40 && l > .62) return 'skin';
  if (h < 25 && s > .35) return 'rust';
  return 'leather';
}

function repaint(pngBuffer, pal) {
  const png = PNG.sync.read(pngBuffer);
  const { width: W, height: H } = png;
  const cells = 8, cw = W / cells, ch = H / (cells / 2);   // 8 x 4 swatches
  for (let cy = 0; cy < H / ch; cy++) for (let cx = 0; cx < cells; cx++) {
    const sample = (x, y) => { const o = (y * W + x) * 4; return [png.data[o], png.data[o + 1], png.data[o + 2]]; };
    const mid = sample(Math.floor(cx * cw + cw * .3), Math.floor(cy * ch + ch * .35));
    const role = classify(mid);
    const target = hex(pal[role] || pal.leather);
    const midL = (mid[0] + mid[1] + mid[2]) / 3 || 1;
    for (let y = cy * ch; y < (cy + 1) * ch; y++) for (let x = cx * cw; x < (cx + 1) * cw; x++) {
      const o = (y * W + x) * 4;
      const l = (png.data[o] + png.data[o + 1] + png.data[o + 2]) / 3;
      const k = Math.min(1.6, l / midL);                    // keep the swatch's gradient
      png.data[o] = Math.min(255, target[0] * k); png.data[o + 1] = Math.min(255, target[1] * k); png.data[o + 2] = Math.min(255, target[2] * k);
    }
  }
  return PNG.sync.write(png);
}

for (const [id, def] of Object.entries(FIGHTERS)) {
  const file = path.join(SRC, def.src);
  if (!fs.existsSync(file)) { console.warn('skip', id, '(missing', def.src + ')'); continue; }
  const doc = await io.read(file);
  const root = doc.getRoot();
  for (const anim of root.listAnimations()) dropAnimation(anim);
  for (const node of root.listNodes()) if (node.getMesh() && PROPS.test(node.getName())) node.dispose();
  for (const texture of root.listTextures()) {
    texture.setImage(repaint(Buffer.from(texture.getImage()), def.pal));
    texture.setMimeType('image/png');
  }
  await doc.transform(dedup(), prune({ propertyTypes: ['Accessor', 'Mesh', 'Primitive', 'Material', 'Texture'] }));
  const out = path.join(OUT, `${id}.glb`);
  await io.write(out, doc);
  console.log(id.padEnd(8), (fs.statSync(out).size / 1024).toFixed(0) + ' KB');
}

// Shared animation library: bones only.
{
  const doc = await io.read(path.join(SRC, 'Skeleton_Warrior.glb'));
  const root = doc.getRoot();
  for (const anim of root.listAnimations()) if (!CLIPS.includes(anim.getName())) dropAnimation(anim);
  for (const node of root.listNodes()) if (node.getMesh()) node.dispose();
  for (const skin of root.listSkins()) skin.dispose();
  await doc.transform(prune({ propertyTypes: ['Accessor', 'Mesh', 'Primitive', 'Material', 'Texture'] }));
  const out = path.join(OUT, 'moves.glb');
  await io.write(out, doc);
  console.log('moves   ', (fs.statSync(out).size / 1024).toFixed(0) + ' KB', root.listAnimations().length, 'clips');
}
