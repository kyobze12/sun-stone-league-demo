# Roadmap

## Done — the game is playable end to end

- **Rules with a real decision space.** Charge-and-release striking with smash
  and lob, input buffering, shoulder charges that stun and steal, and three
  scoring routes (ring 3, back line 1, double-bounce fault 1) plus sudden death.
- **Opponents worth playing.** Role-based AI (striker and keeper) that predicts
  where it can intercept, holds a keeper line, clears the zone and chooses
  between a lob at the ring and a smash down court. Novice, Warrior and
  Champion differ in reaction time, accuracy, speed, aggression and lob
  preference.
- **Modes.** Tutorial, 2v2 match, Ring Hunt, local 2P, online 2P.
- **Identity.** Bar-and-dot scoring, k'in sun glyph court, jaguar and quetzal
  teams, four power-ups drawn from Maya cosmology, procedural audio.
- **Presentation.** Broadcast camera that keeps the ring in frame, sunset
  lighting, bloom, slow-motion ring replays, particles, crowd.
- **Mobile.** Virtual stick, hold-to-charge buttons, safe-area insets, a
  portrait camera of its own, and quality tiers.

## Next

### Phase A — depth
- Passing as a first-class move, with a reward for pass chains before a ring.
- Wall-combo bonus: rings scored after a wall rebound are worth more.
- A second AI personality per role (a poacher keeper, a defensive striker) so
  opponents are not all the same shape at a given difficulty.

### Phase B — feel
- Real animation clips for idle, run, strike, lob, tackle and knockdown,
  replacing the procedural rig blending.
- Hit-stop on heavy strikes and a dedicated replay camera for ring goals.
- Music that rises with the crowd's excitement.

### Phase C — content
- 3v3 with a dedicated support role.
- A short season or ladder with persistent records.
- Alternate courts (night, rain, highland) with their own lighting.

### Phase D — online
- Reconnect after a dropped peer rather than returning to the menu.
- Client-side prediction for the guest's own fighter, so their input is not
  one round-trip behind.
- Optional 2v2 online with two humans per side.

## Known limitations

- The guest in online 2P sees their own movement after a round trip; this is
  fine on a LAN and noticeable on a poor connection.
- The AI does not yet use power-ups deliberately — it collects them by walking
  over them.
- Champion is hard enough that a new player will lose heavily; Warrior is the
  intended first real match.
