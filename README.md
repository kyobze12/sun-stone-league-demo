# Sun-Stone League

A mobile-first 3D ballcourt sport inspired by Pok-Ta-Pok and Maya visual motifs.
Two teams of two share one sacred ball on a stone alley court. Keep it moving,
thread it through the sun-stone ring, and knock the other side off it.

```bash
npm install
npm run dev      # play at the printed localhost address
npm test         # rules, fairness, AI and asset checks
npm run build    # production bundle in dist/
```

## How it plays

You control the Balam striker. Your keeper is an AI teammate; the other two
belong to K'uk'.

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Move | `W A S D` (or arrows) | left stick |
| Aim | mouse | drag anywhere on the court |
| **Strike** | hold `Space` / left click, release near the ball | hold `STRIKE` |
| **Lob** | hold `E` / right click | hold `LOB` |
| **Shoulder charge** | `Q` | `CHARGE` |
| Pause | `Esc` or `P` | the `Ⅱ` button |

Player 2 on one keyboard uses the arrows, `Enter`, `Right Shift` and `.`.

Striking is a charge-and-release: the longer you hold, the harder the shot.
Releasing a fraction of a second early still connects — the input is buffered —
but releasing with the ball out of reach is just a swing at air. Controls are
court-relative, so "forward" always means "toward the ring you are attacking",
whichever end you defend.

## Scoring

| | Points | How |
| --- | --- | --- |
| **Ring** | 3 | Put the ball through the opponent's sun-stone ring. A lob curves toward it when you face it, and the help you get depends on the difficulty. |
| **Back line** | 1 | A *low* ball that touches the opponent's end wall. High balls simply rebound. |
| **Double bounce** | 1 | Let the ball bounce twice on your own half and the point goes to the other team. |

First to 15, or the higher score after three minutes. A tie at full time goes to
**sudden death** — the next point wins.

## Modes

- **Learn to Play** — a five-step guided tutorial on an empty court.
- **Ballcourt Match** — 2v2 against the AI at Novice, Warrior or Champion.
- **Ring Hunt** — 75 seconds, one lit ring at a time, chained rings multiply up
  to ×4. Your best is saved locally.
- **Local 2P** — two players on one keyboard, each with an AI keeper.
- **Online 2P** — one player hosts and shares a five-letter room code.

## Power-ups

Gems rise from the court mid-match:

- **Kukulkan's Wind** — 45% faster for 8 seconds
- **Jaguar Heart** — your next strike is a crushing blow that knocks down nearby rivals
- **Sun Shield** — your back line repels the ball for 8 seconds
- **Moon Gravity** — low gravity for everyone, 6 seconds

## Online play

Online 2P is host-authoritative: the host runs the simulation and streams
snapshots 20 times a second, while the guest sends input and extrapolates the
ball between updates. Gameplay traffic is peer-to-peer over WebRTC; a signalling
server is used only to introduce the two browsers.

By default that is PeerJS' public broker. To use your own:

```bash
npx peer --host 127.0.0.1 --port 9000 --path /myapp
# then open the game with ?peer=127.0.0.1:9000/myapp
```

The setting is remembered; `?peer=` on its own clears it.

## Graphics

Quality is detected from the device and can be overridden in the menu (it
reloads, and the choice is remembered). Low turns off shadows, bloom and the
crowd; High renders at up to 2× pixel ratio with 2048px shadows.

The arena is an imported sculpted model; if it fails to load, a procedural
stone arena of the same dimensions takes its place so the game still runs.

## Layout

```
src/
  config.js    tuning constants — court, timings, difficulty, power-ups
  world.js     the simulation: players, strikes, tackles, power-ups
  ball.js      ball physics, ring/wall/bounce collision and events
  shot.js      strike velocities and ring aim assist
  ai.js        role-based AI: interception, keeper lines, difficulty
  match.js     score, clock, sudden death, ring-hunt combos
  render.js    renderer, camera rig, ball visuals, particles, power-ups
  court.js     arena geometry, goals, crowd, lighting
  characters.js fighter models and animation
  input.js     keyboard, mouse, touch → one input shape
  net.js       WebRTC session for online 2P
  maya.js      bar-and-dot numerals and callout vocabulary
  audio.js     procedural WebAudio sound
```

The simulation is deliberately free of rendering code, which is what lets the
tests play thousands of full matches headlessly to check balance and fairness.

## Credits

Arena and character assets are third-party; see `docs/ASSET_SOURCES.md`.
