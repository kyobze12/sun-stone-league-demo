// Prepares dist/ for a static host that serves only a fixed set of extensions
// (the Artifact host serves no .glb and no .hdr).
//
// Models are renamed to .wasm rather than inlined as base64 data URIs: .wasm is
// the one binary-safe extension on the allow list, GLTFLoader sniffs the glTF
// magic bytes rather than trusting the extension, and this avoids both the 33%
// base64 overhead and mobile Safari's unreliability with multi-megabyte data
// URIs — which is what left phones showing the procedural stand-in fighters.
import fs from 'node:fs';

const dist = new URL('../dist/assets/', import.meta.url).pathname;
const renames = [
  ['characters/player.glb', 'characters/player.wasm'],
  ['characters/locomotion.glb', 'characters/locomotion.wasm'],
];

for (const [from, to] of renames) {
  if (!fs.existsSync(dist + from)) { console.log('skip (absent):', from); continue; }
  fs.renameSync(dist + from, dist + to);
  console.log(`${from} -> ${to}  ${(fs.statSync(dist + to).size / 1048576).toFixed(2)}MB`);
}

// The WebP sky fallback covers hosts that will not serve .hdr.
const hdr = dist + 'env/spruit_sunrise_1k.hdr';
if (fs.existsSync(hdr)) { fs.rmSync(hdr); console.log('removed the .hdr; the WebP sky takes over'); }

const bundle = fs.readdirSync(dist).find((f) => /^index-.*\.js$/.test(f));
let code = fs.readFileSync(dist + bundle, 'utf8');
for (const [from, to] of renames) code = code.split('./assets/' + from).join('./assets/' + to);
fs.writeFileSync(dist + bundle, code);
console.log('patched', bundle);
