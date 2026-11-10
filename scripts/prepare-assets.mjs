// The character model is committed to the repository, already simplified and
// quantised for mobile by tools/optimize-character.mjs. This check exists so a
// broken checkout fails with a clear message instead of silently dropping the
// game to its procedural stand-in fighters.
import { stat } from 'node:fs/promises';

const model = new URL('../public/assets/characters/player.glb', import.meta.url);
try {
  const { size } = await stat(model);
  if (size < 100_000) throw new Error(`suspiciously small (${size} bytes)`);
  console.log(`Character asset present (${(size / 1024).toFixed(0)}KB).`);
} catch (error) {
  console.error('Character model missing or unreadable at public/assets/characters/player.glb');
  console.error(String(error.message || error));
  console.error('Restore it with: git checkout -- public/assets/characters/player.glb');
  process.exit(1);
}
