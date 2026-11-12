# The Lost Courts — expansion notes

An adventure layer on top of the existing arena game. Nothing was rebuilt:
the open world launches the same match, ring-hunt and duel code with an
arena and a goal, and reports the result back to the story.

## What is playable

| System | Where | Notes |
| --- | --- | --- |
| Open world (Jungle Heartland) | `src/adventure/` | Seeded layout, ~330 instanced resource nodes, village, river, road, court gate. Day/night cycle and passing rain. |
| Gathering | `state.js` `act()` | Wood, stone, fiber, clay, rubber, jade. Nodes respawn. Axe and pick halve the blows. |
| Farming | milpa plots | Till → plant → grows in real time (also while away) → harvest. Maize, beans, cacao. |
| Crafting | bench or CRAFT | 13 recipes: tools, court gear, food, building pieces. |
| Building | hotbar + USE / BREAK | Grid placement, stackable walls/blocks/roofs, saved. |
| Inventory & save | `localStorage` key `ssl-adventure` | Autosaves every 8 s and on exit. |
| Story | `data.js` `QUESTS` | 13 quests in 3 chapters, 5 NPCs with dialogue, 5 Sun-Stone fragments. |
| Mini-games | dock, training range | Fishing (react to the bite), ball-toss (timing meter). |
| Arenas | `ARENAS` in `config.js`, `World.arenaTick` | Jungle (pillars), Highland (crosswind), Cenote (pool), Lost City. Selectable from the main menu too. |
| Preparation matters | `matchBuffs()` | Rubber ball, hip yoke, jade charm, tamales and cacao change your stats on court. |

The story is original fantasy inspired by the Mesoamerican ballgame and the
Popol Vuh. The league of courts, the Sun-Stones and the villagers are invented.

## Not done yet (from the brief)

- Regions beyond the Jungle Heartland: Highlands, Coast, Cenote and Overgrown
  Ruins exist only as ballcourts, not as explorable areas.
- Terrain is flat; no caves, waterfalls or chunk streaming (the region is small
  enough not to need it yet).
- Village buildings and trees come from a medieval CC0 pack — the right scale
  and style of the fighters, but European houses and conifers rather than Maya
  thatch and ceiba. Replacing them needs Mesoamerican models.
- No trading, hunting, temple puzzles or obstacle courses.
- Audio is still synthesised tones; no ambient or positional sound.
- Online play covers the ballcourt match only.

## Research references (not used)

The brief listed Voxelcraft, Mynecraft, VoxelCraft Web and threejs-worldgen as
references. No code or assets were taken from them: their licences were not
verified, and a block-voxel terrain engine would replace this project's
architecture rather than extend it. The open world here is written for this
codebase instead.
