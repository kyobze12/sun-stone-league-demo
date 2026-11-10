// Shared tuning constants for Sun-Stone League.
// Everything that defines "how the sport plays" lives here so the sim, AI,
// renderer and tests agree on one set of numbers.

export const COURT_LENGTH = 32;   // z axis (goal to goal)
export const COURT_WIDTH = 14;    // x axis
export const WALL_HEIGHT = 6;

export const RING_HEIGHT = 4.1;
export const RING_RADIUS = 1.12;
export const RING_TUBE = 0.22;
export const RING_INSET = 1.6;    // ring sits this far in front of the end line (ball must clear it before the wall)

export const BALL_RADIUS = 0.43;
export const GRAVITY = -17;
export const RESTITUTION = 0.66;

export const PLAYER_SPEED = 7.1;
export const PLAYER_RADIUS = 0.55;
export const HIT_RANGE = 2.05;     // distance from player hip to ball centre
export const HIT_MAX_HEIGHT = 2.9; // ball must be at or below this to be struck
export const CHARGE_TIME = 0.85;   // seconds to reach full charge
export const STRIKE_COOLDOWN = 0.42;
export const STRIKE_BUFFER = 0.24;   // grace window: a release just before the ball arrives still connects
export const TACKLE_COOLDOWN = 2.1;
export const TACKLE_DURATION = 0.26;
export const TACKLE_DISTANCE = 3.6;
export const TACKLE_HIT_RADIUS = 1.25;
export const STUN_TIME = 0.95;
export const BACK_ZONE = 3.2;      // depth of each team's scoring/keeper zone
export const BACKLINE_MAX_HEIGHT = 1.7; // only genuinely low balls score on the end wall; higher ones rebound

export const POINTS = Object.freeze({ ring: 3, backline: 1, doubleBounce: 1 });

// Teams. Balam (jaguar) defends the south end (z < 0) and attacks north (+z).
// K'uk' (quetzal) defends the north end and attacks south (-z).
export const TEAMS = Object.freeze({
  balam: Object.freeze({ id: 'balam', name: 'Balam', glyph: 'Jaguar', attacks: 1, color: 0xf2a93b, accent: 0x2a1a0e, css: '#f2a93b' }),
  kuk: Object.freeze({ id: 'kuk', name: "K'uk'", glyph: 'Quetzal', attacks: -1, color: 0x1fb89a, css: '#1fb89a', accent: 0xc8323c }),
});
export const OTHER_TEAM = Object.freeze({ balam: 'kuk', kuk: 'balam' });

// Spawn roster for 2v2. Positions are relative to a team attacking +z and
// get mirrored for K'uk'.
export const ROSTER = Object.freeze([
  { slot: 'striker', offset: [-2.2, 0, -6.5] },
  { slot: 'keeper', offset: [2.0, 0, -11.5] },
]);

// `assist` is the aim help the HUMAN gets (an easier opponent helps you more).
// `aiAssist` is how cleanly the AI itself finds the ring, and rises with
// difficulty. Keeping these separate matters: sharing one number made Novice
// opponents the most accurate shooters in the game.
export const DIFFICULTY = Object.freeze({
  easy:   { label: 'Novice',   reaction: 0.50, aimError: 0.30, speed: 0.78, assist: 0.80, aiAssist: 0.08, tackle: 0.25, charge: 0.55, lob: 0.45 },
  normal: { label: 'Warrior',  reaction: 0.26, aimError: 0.15, speed: 0.92, assist: 0.58, aiAssist: 0.20, tackle: 0.55, charge: 0.80, lob: 0.65 },
  hard:   { label: 'Champion', reaction: 0.12, aimError: 0.06, speed: 1.02, assist: 0.42, aiAssist: 0.28, tackle: 0.85, charge: 1.00, lob: 0.80 },
});

export const MODES = Object.freeze({
  practice: { id: 'practice', title: 'Practice', duration: 0, target: 0 },
  match:    { id: 'match', title: 'Ballcourt Match', duration: 180, target: 15 },
  ringhunt: { id: 'ringhunt', title: 'Ring Hunt', duration: 75, target: 0 },
  local2p:  { id: 'local2p', title: 'Local 2P', duration: 180, target: 15 },
  online:   { id: 'online', title: 'Online 2P', duration: 180, target: 15 },
});

export const POWERUPS = Object.freeze({
  wind:    { id: 'wind', name: "Kukulkan's Wind", short: 'WIND', desc: 'Move 45% faster for 8 s', duration: 8, color: 0x7fe9ff },
  jaguar:  { id: 'jaguar', name: 'Jaguar Heart', short: 'JAGUAR', desc: 'Your next strike is a crushing blow', duration: 0, color: 0xffb13b },
  shield:  { id: 'shield', name: 'Sun Shield', short: 'SHIELD', desc: 'Your back line repels the ball for 8 s', duration: 8, color: 0xffe36b },
  moon:    { id: 'moon', name: 'Moon Gravity', short: 'MOON', desc: 'Low gravity for everyone, 6 s', duration: 6, color: 0xc9a7ff },
});
export const POWERUP_SPAWN_INTERVAL = 11;
export const POWERUP_LIFETIME = 14;
