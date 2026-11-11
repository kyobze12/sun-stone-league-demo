# Asset tools

One-off scripts that produced the baked character assets. They are not part of
the build — run them by hand only when regenerating an asset.

Order matters: **bake the skins before optimising the mesh.** The optimiser
quantises positions to normalised shorts, which the baker cannot read body
coordinates from. The two outputs are independent, and simplification leaves
the UV islands in place, so a texture baked from the source fits the optimised
mesh.

```bash
node tools/uvmap.mjs          # writes uv_regions.png: how the mesh's UV islands map to bones
node tools/bake-costume.mjs [source.glb]   # writes skin_balam.png / skin_kuk.png
node tools/strip-anims.mjs <Soldier.glb>   # writes public/assets/characters/locomotion.glb
node tools/optimize-character.mjs <src.glb> <out.glb> 0.3   # simplify + quantise a fighter
node tools/optimize-idol.mjs <src.glb> <out.glb>            # 4K textures -> 1K, unlit -> lit
node tools/artifact-prep.mjs                                # retarget dist/ for a restricted static host
```

`bake-costume.mjs` paints the jaguar-warrior skins. The mesh's UVs are hundreds
of scattered auto-unwrap islands, so a costume cannot be hand-painted in texture
space; instead every triangle is rasterised into UV space while its 3D position
is interpolated, and the colour is chosen from where that point sits on the body.
The mesh is in bind pose — a T-pose — so arms are placed by how far out along X
they sit, not by height.

After running the bake, convert to WebP before committing:

```bash
for t in balam kuk; do
  convert tools/skin_$t.png -quality 88 -define webp:method=6 public/assets/characters/skin_$t.webp
done
```
