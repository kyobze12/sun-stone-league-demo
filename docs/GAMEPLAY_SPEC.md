# Sun-Stone League — Gameplay Specification

> **Status.** This is the design target for the full game. The build
> currently implements a 2v2 version of it: charge-and-release striking
> (smash and lob), shoulder charges with steals, ring / back-line /
> double-bounce scoring, sudden death, role-based AI with three difficulties,
> four power-ups, and five modes. Three-a-side play, pass-chain bonuses,
> wall-run traversal and the full ability set remain on the roadmap — see
> `ROADMAP.md`. Where this document and `src/config.js` disagree, the code is
> the authority.


## Genre

3v3 arena action-sports game combining the continuous momentum and positioning of vehicular arena sports with directional ball-striking and character combat.

## Fantasy

Mythic champions use kinetic exoskeleton belts to amplify legal body strikes and channel elemental abilities inspired by Mayan cosmology. The presentation is stylized mythic fantasy, not a historical simulation.

## Core loop

**MOVE → STRIKE → DEFLECT → CHARGE → COMBAT → SCORE**

Two teams compete on an alley court with angled reflection walls. The dense rubber ball should remain in motion. Players sprint, wall-run, redirect the ball, create passing chains, disrupt opponents, and attack the back zone or central vertical ring.

## Teams and match structure

- Three players per team
- One Keeper and two Mid-Court Strikers
- Three four-minute rounds
- Standard win condition: first team to 20 points
- Sudden Death: threading the central ring is an instant win

## Legal contacts

Allowed contacts:

- hips
- thighs
- knees
- elbows
- shoulders

Illegal ball contacts:

- hands
- forearms
- calves
- feet
- head

An illegal contact causes a turnover and a free strike for the opposing team.

## Bounce rule

The ball may touch the floor once after a legal strike. A second floor bounce before another legal strike awards one point to the opposing team and resets play.

## Strike system

### Hip Smash

Standard charge-and-release attack. Propels the ball forward with power determined by charge time, player momentum, contact angle, and kinetic meter.

### Elbow Ricochet

Fast precision redirect with lower raw force and high directional control. Intended for angled wall combinations and passes.

### Knee Volley

Lifting strike that converts forward momentum into vertical velocity for teammate setups and ring attempts.

## Scoring

| Action | Points |
| --- | ---: |
| Ball reaches the opposing back zone | 1 |
| Ball contacts at least two valid surfaces before hitting the ring perimeter | 3 |
| Ball passes fully through the vertical stone ring | 10 |
| Second ground bounce before a legal strike | 1 to opposing team |

Ring threading during Sudden Death ends the match immediately.

## Kinetic system

Legal strikes and completed teammate passes charge the player's Kinetic Meter. Better timing, maintained ball speed, wall combinations, and passing chains increase charge faster.

The ball stores kinetic state:

- velocity tier
- last legal striker
- pass-chain count
- wall-contact count
- ground-bounce count
- elemental modifier
- real/decoy state

## Champion roles

### Sun Champion — Offense / Striker

**Passive: Solar Inertia**

Successive completed passes increase ball velocity and fire-trail intensity.

**Ultimate: Kinich Burst**

An explosive hip smash launches the ball at hyper-speed and breaks eligible defensive shields.

### Underworld Champion — Control / Disruption

**Passive: Gravitational Pull**

Defensive slides apply a small, readable bend to the ball trajectory.

**Ultimate: Xibalba Portal**

Creates a temporary paired wall portal. A real ball entering the first portal exits the second aimed toward the high ring.

### Hero Twin Champion — Agility / Setup

**Passive: Mirror Dash**

Enables short air dashes and wall teleports while preserving momentum.

**Ultimate: Eclipse Split**

Creates two non-colliding spectral ball decoys for five seconds. Only the real ball affects physics and scoring.

## Demo implementation order

1. Reliable court boundaries, angled-wall reflections, legal strike state, bounce rule, back-zone scoring, ring threading
2. One human plus five role-aware AI champions
3. Hip Smash, Elbow Ricochet, and Knee Volley
4. Kinetic meter, pass chains, wall-combo tracking, score matrix
5. One champion per role with passive and ultimate
6. Three-round match flow, sudden death, replay/reset
7. Wall running, combat disruption, animation, effects, sound, optimization
