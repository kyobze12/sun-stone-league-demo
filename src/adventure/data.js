// Sun-Stone League: The Lost Courts — data for the open world.
//
// The story is an original fantasy inspired by the Mesoamerican ballgame
// (pok-ta-pok / pitz) and the K'iche' Popol Vuh. The league of courts, the
// Sun-Stones and these villagers are invented for the game; they are not
// presented as documented history.

export const ITEMS = {
  wood:   { name: 'Wood', icon: '🪵' },
  stone:  { name: 'Stone', icon: '🪨' },
  fiber:  { name: 'Fiber', icon: '🌿' },
  clay:   { name: 'Clay', icon: '🏺' },
  rubber: { name: 'Rubber', icon: '⚫' },
  jade:   { name: 'Jade', icon: '💎' },
  maize:  { name: 'Maize', icon: '🌽' },
  cacao:  { name: 'Cacao', icon: '🫘' },
  beans:  { name: 'Beans', icon: '🫛' },
  fish:   { name: 'Fish', icon: '🐟' },
  seed_maize: { name: 'Maize seed', icon: '🌱' },
  seed_cacao: { name: 'Cacao seed', icon: '🌱' },
  seed_beans: { name: 'Bean seed', icon: '🌱' },
  // crafted
  axe:    { name: 'Stone Axe', icon: '🪓', tool: true },
  pick:   { name: 'Stone Pick', icon: '⛏️', tool: true },
  ball:   { name: 'Rubber Ball', icon: '🏐', gear: true },
  yoke:   { name: 'Hip Yoke', icon: '🛡️', gear: true },
  charm:  { name: 'Jade Charm', icon: '📿', gear: true },
  tamale: { name: 'Tamales', icon: '🫔' },
  cacao_drink: { name: 'Cacao Drink', icon: '🍵' },
  // building pieces
  wall:   { name: 'Wood Wall', icon: '🟫', build: true },
  block:  { name: 'Stone Block', icon: '⬜', build: true },
  thatch: { name: 'Thatch Roof', icon: '🛖', build: true },
  fence:  { name: 'Fence', icon: '🚧', build: true },
  pot:    { name: 'Clay Pot', icon: '🏺', build: true },
  torch:  { name: 'Torch', icon: '🔥', build: true },
};

export const RECIPES = [
  { id: 'axe', needs: { wood: 2, stone: 2, fiber: 1 }, note: 'Fell trees in half the blows.' },
  { id: 'pick', needs: { wood: 2, stone: 3, fiber: 1 }, note: 'Break rock in half the blows.' },
  { id: 'ball', needs: { rubber: 3, fiber: 1 }, note: 'A true court ball. Harder strikes in every match.' },
  { id: 'yoke', needs: { stone: 4, wood: 2, fiber: 2 }, note: 'Court armour. More health in duels.' },
  { id: 'charm', needs: { jade: 2, fiber: 1 }, note: 'Start duels with your spirit bar part-filled.' },
  { id: 'tamale', needs: { maize: 3 }, note: 'Eaten before a match: extra health. Used up.' },
  { id: 'cacao_drink', needs: { cacao: 2, clay: 1 }, note: 'Drunk before a match: move faster. Used up.' },
  { id: 'wall', needs: { wood: 2 }, makes: 2, note: 'Building piece.' },
  { id: 'block', needs: { stone: 2 }, makes: 2, note: 'Building piece. Stacks.' },
  { id: 'thatch', needs: { fiber: 2, wood: 1 }, makes: 2, note: 'Roof piece.' },
  { id: 'fence', needs: { wood: 1 }, makes: 2, note: 'Building piece.' },
  { id: 'pot', needs: { clay: 2 }, note: 'Decoration.' },
  { id: 'torch', needs: { wood: 1, rubber: 1 }, note: 'Lights your settlement at night.' },
];

// Seconds from planting to ripe, and the harvest.
export const CROPS = {
  maize: { seed: 'seed_maize', time: 40, gives: 3, color: 0xe8c33a },
  beans: { seed: 'seed_beans', time: 55, gives: 3, color: 0x6fae3c },
  cacao: { seed: 'seed_cacao', time: 75, gives: 2, color: 0x8a4a22 },
};

export const NPCS = [
  { id: 'elder', name: 'Ixmucane', role: 'Elder', look: 'kot', x: -4, z: 3 },
  { id: 'farmer', name: 'Itzel', role: 'Farmer', look: 'hunahpu', x: 12, z: 5 },
  { id: 'trainer', name: 'Yaxkin', role: 'Court trainer', look: 'balam', x: 8, z: -9 },
  { id: 'fisher', name: 'Kaan', role: 'Fisher', look: 'kuk', x: -30, z: -6 },
  { id: 'rival', name: "Zotz'", role: 'Champion of the Bat Court', look: 'sotz', x: 4, z: 37 },
];

// Fixed places in the world.
export const PLACES = {
  gate: { x: 0, z: 41, r: 3.2, label: 'Enter the court' },
  dock: { x: -33.5, z: -8, r: 2.6, label: 'Fish' },
  range: { x: 12, z: -13, r: 2.4, label: 'Ball-toss training' },
  bench: { x: -8, z: -4, r: 2.4, label: 'Crafting bench' },
};
export const PLOTS = { x0: 15, z0: -2, cols: 5, rows: 3, size: 2 };
export const RIVER = { x1: -40, x2: -35 };
export const BOUNDS = 56;

const has = (s, item, n) => (s.inv[item] || 0) >= n;

/**
 * The Lost Courts, told through quests. Each has an NPC to report to, the
 * lines they speak when it starts, a check for when it is done and a reward.
 * `arena` quests are won on a court; the gate offers that challenge.
 */
export const QUESTS = [
  { id: 'wake', chapter: 1, npc: 'elder', title: 'The Silent Court',
    start: ['You found the old court, child. Before the central Sun-Stone shattered, a league of courts joined every city. Its light kept the roads open.', 'Now the courts sleep and the cities have forgotten each other. But a court will wake for one who plays well.', 'First, learn to live here. Bring me 4 wood and 3 stone — walk up to a tree or a rock and press USE.'],
    goal: 'Gather 4 wood and 3 stone, then return to Ixmucane.', done: (s) => has(s, 'wood', 4) && has(s, 'stone', 3),
    reward: { seed_maize: 4, fiber: 2 }, end: ['Good hands. Take these maize seeds to Itzel at the milpa — the field east of the village.'] },
  { id: 'milpa', chapter: 1, npc: 'farmer', title: 'The Milpa',
    start: ['A ballplayer who cannot feed herself plays one season only. Stand on a plot and press USE to till it, again to plant.', 'Maize ripens fast. Harvest 3 and come back.'],
    goal: 'Till, plant and harvest 3 maize.', done: (s) => s.count.harvested >= 3,
    reward: { seed_beans: 3, seed_cacao: 2 }, end: ['There. Beans and cacao seeds — and remember, three maize make tamales at the crafting bench.'] },
  { id: 'ball', chapter: 1, npc: 'trainer', title: 'The First Ball',
    start: ['The old balls rotted long ago. Rubber trees have pale bark — press USE on one to tap it, three times.', 'Then twist the rubber with fiber at the crafting bench. Bring me a Rubber Ball.'],
    goal: 'Tap 3 rubber and craft a Rubber Ball.', done: (s) => has(s, 'ball', 1),
    reward: { fiber: 2 }, end: ['Heavy. Good. Now let me see your arm — step up to the training range beside me.'] },
  { id: 'toss', chapter: 1, npc: 'trainer', title: 'The Trainer’s Eye',
    start: ['Five throws at the target. Release when the marker crosses the gold. Hit three.'],
    goal: 'Hit 3 of 5 at the ball-toss range.', done: (s) => s.count.tossWins >= 1,
    reward: { tamale: 1 }, end: ['You have the eye. The abandoned court lies north, past the trees. Go and wake it.'] },
  { id: 'court1', chapter: 1, npc: 'elder', title: 'Waking the Jungle Court',
    start: ['The court north of here was the first on the old road. Thread its rings and its Sun-Stone will answer.'],
    goal: 'At the court gate: thread 3 rings in 80 seconds.', done: (s) => !!s.wins.court1,
    arena: { base: 'ringhunt', arena: 'jungle', duration: 80, goalRings: 3, house: 'The Jungle Court', title: 'Waking the Court', story: 'The pillars have fallen across the alley.', goal: 'Thread 3 rings in 80 seconds.' },
    reward: { fragment: 1 }, end: ['A fragment of the Sun-Stone! The court is awake — and others will have felt it. Champions will come.'] },
  { id: 'fish', chapter: 2, npc: 'fisher', title: 'The River’s Share',
    start: ['Champions eat well before they play. Stand on my dock and press USE to cast. When the float dips — pull!', 'Bring me 3 fish and I’ll show you where the clay is.'],
    goal: 'Catch 3 fish at the dock.', done: (s) => has(s, 'fish', 3),
    reward: { clay: 4 }, end: ['Clay from the bank — good for pots and cacao cups. Dig more beside the river.'] },
  { id: 'yoke', chapter: 2, npc: 'trainer', title: 'Court Armour',
    start: ['Zotz’ of the Bat Court has come to claim your fragment. You will not stand against him bare. Craft a Hip Yoke.'],
    goal: 'Craft a Hip Yoke (4 stone, 2 wood, 2 fiber).', done: (s) => has(s, 'yoke', 1),
    reward: { tamale: 1 }, end: ['Now you look like a player. He waits by the court gate.'] },
  { id: 'rival1', chapter: 2, npc: 'rival', title: 'The Champion of the Bat Court',
    start: ['So you are the one who woke it. That fragment belongs to the strong. Play me for it — first to 7.'],
    goal: 'At the court gate: beat Zotz’ to 7 points.', done: (s) => !!s.wins.rival1,
    arena: { base: 'match', arena: 'jungle', target: 7, duration: 150, rivals: ['sotz', 'kame'], house: 'The Jungle Court', title: 'Zotz’ of the Bat Court', story: 'First to seven.', goal: 'Beat Zotz’ to 7 points.' },
    reward: { fragment: 1 }, end: ['...You play like the old ones. Take it. The Highland Court is waking too — the wind there will test you.'] },
  { id: 'home', chapter: 2, npc: 'elder', title: 'A Place of Your Own',
    start: ['A league needs a home. Craft walls, blocks or thatch and raise something of your own — six pieces will do.'],
    goal: 'Place 6 building pieces.', done: (s) => s.builds.length >= 6,
    reward: { jade: 1 }, end: ['It will stand. Take this jade — and look for the green veins in the far rocks.'] },
  { id: 'highland', chapter: 2, npc: 'elder', title: 'The Highland Court',
    start: ['The mountain court has woken. Its keepers play in the wind. The gate will take you there.'],
    goal: 'At the court gate: win at the Highland Court (first to 7).', done: (s) => !!s.wins.highland,
    arena: { base: 'match', arena: 'highland', target: 7, duration: 150, rivals: ['kuk', 'kot'], house: 'The Highland Court', title: 'Keepers of the Wind', story: 'The crosswind bends every high ball.', goal: 'First to 7 in the wind.' },
    reward: { fragment: 1 }, end: ['Three fragments. Only the cenote remains before the Lost City itself.'] },
  { id: 'charm', chapter: 3, npc: 'elder', title: 'The Jade Charm',
    start: ['The guardian of the Cenote Court is no living player. Carry jade against him — craft a Jade Charm.'],
    goal: 'Craft a Jade Charm (2 jade, 1 fiber).', done: (s) => has(s, 'charm', 1),
    reward: { tamale: 1 }, end: ['Your spirit will wake faster with that at your throat.'] },
  { id: 'cenote', chapter: 3, npc: 'elder', title: 'The Guardian of the Cenote',
    start: ['Go down to the sacred water. Defeat its guardian.'],
    goal: 'At the court gate: defeat the guardian in a duel.', done: (s) => !!s.wins.cenote,
    arena: { base: 'duel', arena: 'cenote', rounds: 2, rival: 'kame', house: 'The Cenote Court', title: 'The Guardian', story: 'Bone-white, waiting in the dark water.', goal: 'Win the duel. Best of three.' },
    reward: { fragment: 1 }, end: ['Four fragments. The Lost City’s court will open now. Everything ends there.'] },
  { id: 'final', chapter: 3, npc: 'elder', title: 'The Shattered Sun',
    start: ['The lords who broke the Sun-Stone hold the great court. Beat them and the league lives again.'],
    goal: 'At the court gate: win the championship at the Lost City (first to 9).', done: (s) => !!s.wins.final,
    arena: { base: 'match', arena: 'city', target: 9, duration: 180, rivals: ['kame', 'vucub'], env: 'dusk', house: 'The Lost City', title: 'The Championship', story: 'Hun-Kame and Vucub-Kame hold the last court.', goal: 'First to 9.' },
    reward: { fragment: 1 }, end: ['The Sun-Stone is whole. Listen — drums, from every city on the old road. The league is awake. You woke it.'] },
];
