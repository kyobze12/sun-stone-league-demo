import * as THREE from 'three';
import {
  COURT_WIDTH, COURT_LENGTH, PLAYER_SPEED, PLAYER_RADIUS, HIT_RANGE, HIT_MAX_HEIGHT, CHARGE_TIME,
  STRIKE_COOLDOWN, TACKLE_COOLDOWN, TACKLE_DURATION, TACKLE_DISTANCE, TACKLE_HIT_RADIUS, STUN_TIME,
  TEAMS, OTHER_TEAM, ROSTER, DIFFICULTY, POWERUPS, POWERUP_SPAWN_INTERVAL, POWERUP_LIFETIME, BALL_RADIUS,
} from './config.js';
import { BallState, RINGS, ringFor } from './ball.js';
import { strikeVelocity } from './shot.js';
import { AIController } from './ai.js';

export const EMPTY_INPUT = Object.freeze({ mx: 0, mz: 0, aim: null, strike: false, lob: false, tackle: false });

// Deterministic PRNG so tests and host/client agree on random choices.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Player {
  constructor({ id, team, slot, control, index }) {
    this.id = id; this.team = team; this.slot = slot; this.control = control; this.index = index;
    this.pos = new THREE.Vector3();
    this.facing = 0;
    this.aim = 0;
    this.speed = 0;            // measured movement speed for animation
    this.stun = 0;
    this.charge = -1;          // -1 = not charging
    this.chargeKind = 'smash';
    this.hitCooldown = 0;
    this.tackleCooldown = 0;
    this.dash = 0;             // time left in a tackle dash
    this.dashDir = new THREE.Vector3();
    this.swingTimer = 0;
    this.wind = 0;             // Kukulkan's Wind time left
    this.jaguar = false;       // Jaguar Heart armed
    this.prevInput = { ...EMPTY_INPUT };
    this.ai = null;
    this.spawn = new THREE.Vector3();
  }
  get attacks() { return TEAMS[this.team].attacks; }
  get ring() { return ringFor(this.attacks).center; }
  get moveSpeed() { return PLAYER_SPEED * (this.wind > 0 ? 1.45 : 1) * (this.ai ? this.ai.profile.speed : 1); }
  get busy() { return this.stun > 0 || this.dash > 0; }
}

/**
 * The whole simulation: ball, players, power-ups and rule events. No rendering.
 * step(dt, inputs) returns an array of events for the presentation layer.
 */
export class World {
  constructor({ mode = 'match', difficulty = 'normal', seed = 1, humans = ['balam-striker'], serveSide = 0 } = {}) {
    this.mode = mode;
    this.difficulty = difficulty;
    this.random = mulberry32(seed);
    this.ball = new BallState();
    this.players = [];
    this.powerups = [];
    this.powerupTimer = POWERUP_SPAWN_INTERVAL * .55;
    this.moonTime = 0;
    this.time = 0;
    this.frozen = false;
    this.ringHunt = mode === 'ringhunt';
    this.litRing = 'north';
    this.nextPowerupId = 1;
    const teams = mode === 'ringhunt' || mode === 'practice' ? ['balam'] : ['balam', 'kuk'];
    let index = 0;
    for (const team of teams) {
      const roster = mode === 'practice' || mode === 'ringhunt' ? [ROSTER[0]] : ROSTER;
      for (const spec of roster) {
        const id = `${team}-${spec.slot}`;
        const player = new Player({ id, team, slot: spec.slot, control: humans.includes(id) ? 'human' : 'ai', index: index++ });
        const sign = TEAMS[team].attacks;
        player.spawn.set(spec.offset[0] * sign, 0, spec.offset[2] * sign);
        if (player.control === 'ai') {
          const profile = team === 'kuk' || mode === 'ringhunt' ? DIFFICULTY[difficulty] : DIFFICULTY.normal;
          player.ai = new AIController(player, profile, this.random);
        }
        this.players.push(player);
      }
    }
    this.resetPositions(serveSide);
  }

  byId(id) { return this.players.find((p) => p.id === id); }
  teammates(player) { return this.players.filter((p) => p.team === player.team && p !== player); }
  opponents(player) { return this.players.filter((p) => p.team !== player.team); }

  resetPositions(serveSide = 0) {
    this.ball.reset(serveSide);
    this.ball.gravityScale = 1;
    this.moonTime = 0;
    for (const player of this.players) {
      player.pos.copy(player.spawn);
      player.facing = player.attacks > 0 ? 0 : Math.PI;
      player.aim = player.facing;
      player.stun = player.dash = player.hitCooldown = player.swingTimer = 0;
      player.charge = -1;
      player.speed = 0;
      player.prevInput = { ...EMPTY_INPUT };
      if (player.ai) player.ai.reset();
    }
    this.powerups.length = 0;
  }

  spawnPowerup() {
    const kinds = Object.keys(POWERUPS);
    const kind = kinds[Math.floor(this.random() * kinds.length)];
    const x = (this.random() - .5) * (COURT_WIDTH - 4);
    const z = (this.random() - .5) * (COURT_LENGTH - 10);
    this.powerups.push({ id: this.nextPowerupId++, kind, pos: new THREE.Vector3(x, 0, z), life: POWERUP_LIFETIME });
  }

  /**
   * @param {number} dt seconds
   * @param {Object<string, object>} inputs map of player id -> input for human/remote players
   */
  step(dt, inputs = {}) {
    const events = [];
    if (this.frozen || dt <= 0) return events;
    this.time += dt;
    const ball = this.ball;

    if (this.moonTime > 0) { this.moonTime -= dt; if (this.moonTime <= 0) { this.moonTime = 0; ball.gravityScale = 1; events.push({ type: 'moonEnd' }); } }

    // Power-up spawning (not in practice)
    if (this.mode !== 'practice') {
      this.powerupTimer -= dt;
      if (this.powerupTimer <= 0 && this.powerups.length < 2) { this.spawnPowerup(); this.powerupTimer = POWERUP_SPAWN_INTERVAL; events.push({ type: 'powerupSpawn', powerup: this.powerups.at(-1) }); }
      for (let i = this.powerups.length - 1; i >= 0; i -= 1) {
        this.powerups[i].life -= dt;
        if (this.powerups[i].life <= 0) { events.push({ type: 'powerupExpire', powerup: this.powerups[i] }); this.powerups.splice(i, 1); }
      }
    }

    for (const player of this.players) {
      const input = player.ai ? player.ai.decide(this, dt) : (inputs[player.id] || EMPTY_INPUT);
      this.updatePlayer(player, input, dt, events);
    }
    this.separatePlayers();
    this.nudgeBall(dt);

    for (const event of ball.update(dt)) events.push(event);
    return events;
  }

  updatePlayer(player, input, dt, events) {
    const previous = player.pos.clone();
    player.hitCooldown = Math.max(0, player.hitCooldown - dt);
    player.tackleCooldown = Math.max(0, player.tackleCooldown - dt);
    player.swingTimer = Math.max(0, player.swingTimer - dt);
    player.wind = Math.max(0, player.wind - dt);
    if (player.stun > 0) {
      player.stun = Math.max(0, player.stun - dt);
      player.charge = -1;
    } else if (player.dash > 0) {
      player.dash = Math.max(0, player.dash - dt);
      player.pos.addScaledVector(player.dashDir, (TACKLE_DISTANCE / TACKLE_DURATION) * dt);
      this.resolveTackleHits(player, events);
    } else {
      const len = Math.hypot(input.mx, input.mz);
      let mx = input.mx, mz = input.mz;
      if (len > 1) { mx /= len; mz /= len; }
      if (len > .08) {
        const chargeSlow = player.charge >= 0 ? .55 : 1;
        player.pos.x += mx * player.moveSpeed * chargeSlow * dt;
        player.pos.z += mz * player.moveSpeed * chargeSlow * dt;
        const target = Math.atan2(mx, mz);
        const turn = Math.atan2(Math.sin(target - player.facing), Math.cos(target - player.facing));
        if (player.swingTimer <= 0) player.facing += turn * (1 - Math.exp(-14 * dt));
      }
      // Aim: explicit aim (mouse) wins, otherwise face direction with a soft bias toward the ring.
      if (typeof input.aim === 'number') player.aim = input.aim;
      else player.aim = player.facing;

      // Charge / release for smash and lob
      const held = input.strike || input.lob;
      const kind = input.lob && !input.strike ? 'lob' : (input.lob && input.strike ? player.chargeKind : 'smash');
      if (held && player.charge < 0 && player.hitCooldown <= 0) { player.charge = 0; player.chargeKind = kind; }
      if (player.charge >= 0 && held) player.charge = Math.min(1, player.charge + dt / CHARGE_TIME);
      if (player.charge >= 0 && !held) {
        const power = player.charge;
        player.charge = -1;
        this.tryStrike(player, power, player.chargeKind, events);
      }
      if (input.tackle && !player.prevInput.tackle && player.tackleCooldown <= 0) {
        player.dash = TACKLE_DURATION;
        player.dashDir.set(Math.sin(player.facing), 0, Math.cos(player.facing));
        player.tackleCooldown = TACKLE_COOLDOWN;
        player.charge = -1;
        player.tackleHits = new Set();
        events.push({ type: 'tackle', player });
      }
    }
    player.pos.x = THREE.MathUtils.clamp(player.pos.x, -COURT_WIDTH / 2 + PLAYER_RADIUS, COURT_WIDTH / 2 - PLAYER_RADIUS);
    player.pos.z = THREE.MathUtils.clamp(player.pos.z, -COURT_LENGTH / 2 + .9, COURT_LENGTH / 2 - .9);
    player.speed = player.pos.distanceTo(previous) / dt;
    player.prevInput = { ...input };
    this.collectPowerups(player, events);
  }

  resolveTackleHits(tackler, events) {
    for (const other of this.opponents(tackler)) {
      if (tackler.tackleHits.has(other.id) || other.stun > 0) continue;
      if (other.pos.distanceTo(tackler.pos) < TACKLE_HIT_RADIUS) {
        tackler.tackleHits.add(other.id);
        other.stun = STUN_TIME;
        other.charge = -1;
        other.pos.addScaledVector(tackler.dashDir, 1.1);
        // Steal: if the victim was on the ball, punch it away in the tackler's direction.
        const ball = this.ball;
        if (ball.pos.distanceTo(other.pos.clone().setY(ball.pos.y)) < HIT_RANGE + .4 && ball.pos.y < HIT_MAX_HEIGHT) {
          ball.vel.set(tackler.dashDir.x * 7, 4.5, tackler.dashDir.z * 7);
          ball.lastTouch = tackler.team; ball.lastToucher = tackler.id; ball.struck = true; ball.bounces = 0;
          events.push({ type: 'steal', player: tackler, victim: other });
        } else events.push({ type: 'knockdown', player: tackler, victim: other });
      }
    }
  }

  separatePlayers() {
    for (let i = 0; i < this.players.length; i += 1) for (let j = i + 1; j < this.players.length; j += 1) {
      const a = this.players[i], b = this.players[j];
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz), min = PLAYER_RADIUS * 2;
      if (d < min && d > 1e-5) {
        const push = (min - d) / 2;
        const nx = dx / d, nz = dz / d;
        const wa = a.dash > 0 ? .1 : 1, wb = b.dash > 0 ? .1 : 1;
        a.pos.x -= nx * push * wa; a.pos.z -= nz * push * wa;
        b.pos.x += nx * push * wb; b.pos.z += nz * push * wb;
      }
    }
  }

  // A player walking into a slow, low ball nudges it along so it never sits dead.
  nudgeBall(dt) {
    const ball = this.ball;
    if (ball.pos.y > BALL_RADIUS + .6 || ball.heldCooldown > 0) return;
    for (const player of this.players) {
      const dx = ball.pos.x - player.pos.x, dz = ball.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < PLAYER_RADIUS + BALL_RADIUS && d > 1e-4 && ball.vel.length() < 4) {
        ball.vel.x = dx / d * 3.2; ball.vel.z = dz / d * 3.2; ball.vel.y = Math.max(ball.vel.y, 1.2);
        ball.pos.x = player.pos.x + dx / d * (PLAYER_RADIUS + BALL_RADIUS);
        ball.pos.z = player.pos.z + dz / d * (PLAYER_RADIUS + BALL_RADIUS);
      }
    }
  }

  canStrike(player) {
    const ball = this.ball;
    if (player.hitCooldown > 0 || ball.heldCooldown > 0 || player.busy) return false;
    return ball.pos.distanceTo(player.pos.clone().setY(ball.pos.y)) <= HIT_RANGE && ball.pos.y <= HIT_MAX_HEIGHT;
  }

  tryStrike(player, power, kind, events) {
    player.swingTimer = .45;
    const ok = this.canStrike(player);
    player.hitCooldown = ok ? STRIKE_COOLDOWN : .25;
    if (!ok) { events.push({ type: 'whiff', player }); return false; }
    const ball = this.ball;
    const profile = player.ai ? player.ai.profile : DIFFICULTY[this.difficulty];
    const assist = player.ai ? profile.assist * .9 : profile.assist;
    const angle = player.aim;
    const boost = player.jaguar ? 1.5 : 1;
    const velocity = strikeVelocity({ position: ball.pos, angle, power: .45 + .55 * power, kind, ring: this.targetRing(player), assist, boost, gravityScale: ball.gravityScale });
    ball.vel.copy(velocity);
    ball.heldCooldown = .18;
    ball.lastTouch = player.team; ball.lastToucher = player.id; ball.struck = true;
    ball.bounces = 0; ball.wallHits = 0;
    for (const ring of RINGS) ball.pendingPass[ring.id] = 0;
    player.facing = angle;
    const big = player.jaguar;
    player.jaguar = false;
    events.push({ type: 'strike', player, kind, power, big, pos: ball.pos.clone() });
    if (big) this.shockwave(player, events);
    return true;
  }

  inRange(player) {
    const ball = this.ball;
    return ball.pos.distanceTo(player.pos.clone().setY(ball.pos.y)) <= HIT_RANGE && ball.pos.y <= HIT_MAX_HEIGHT;
  }

  shockwave(player, events) {
    for (const other of this.opponents(player)) {
      if (other.pos.distanceTo(player.pos) < 4.2) { other.stun = Math.max(other.stun, .6); events.push({ type: 'knockdown', player, victim: other }); }
    }
  }

  targetRing(player) {
    if (this.ringHunt) return ringFor(this.litRing === 'north' ? 1 : -1).center;
    return player.ring;
  }

  collectPowerups(player, events) {
    for (let i = this.powerups.length - 1; i >= 0; i -= 1) {
      const p = this.powerups[i];
      if (Math.hypot(p.pos.x - player.pos.x, p.pos.z - player.pos.z) > 1.05) continue;
      this.powerups.splice(i, 1);
      this.applyPowerup(player, p.kind, events);
    }
  }

  applyPowerup(player, kind, events) {
    const def = POWERUPS[kind];
    if (kind === 'wind') player.wind = def.duration;
    else if (kind === 'jaguar') player.jaguar = true;
    else if (kind === 'shield') this.ball.shields[player.team] = def.duration;
    else if (kind === 'moon') { this.moonTime = def.duration; this.ball.gravityScale = .5; }
    events.push({ type: 'powerup', player, kind });
  }

  /** Serialisable snapshot for networking / replay. */
  snapshot() {
    const b = this.ball;
    return {
      t: this.time,
      ball: [b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.gravityScale, b.shields.balam, b.shields.kuk, b.lastTouch || ''],
      players: this.players.map((p) => [p.id, p.pos.x, p.pos.z, p.facing, p.speed, p.stun, p.charge, p.swingTimer, p.wind, p.jaguar ? 1 : 0, p.dash, p.tackleCooldown]),
      powerups: this.powerups.map((p) => [p.id, p.kind, p.pos.x, p.pos.z, p.life]),
      litRing: this.litRing,
      moon: this.moonTime,
    };
  }

  applySnapshot(s) {
    const b = this.ball;
    b.pos.set(s.ball[0], s.ball[1], s.ball[2]); b.vel.set(s.ball[3], s.ball[4], s.ball[5]);
    b.gravityScale = s.ball[6]; b.shields.balam = s.ball[7]; b.shields.kuk = s.ball[8]; b.lastTouch = s.ball[9] || null;
    for (const row of s.players) {
      const p = this.byId(row[0]); if (!p) continue;
      p.pos.set(row[1], 0, row[2]); p.facing = row[3]; p.speed = row[4]; p.stun = row[5]; p.charge = row[6]; p.swingTimer = row[7]; p.wind = row[8]; p.jaguar = !!row[9]; p.dash = row[10]; p.tackleCooldown = row[11];
    }
    this.powerups = s.powerups.map((row) => ({ id: row[0], kind: row[1], pos: new THREE.Vector3(row[2], 0, row[3]), life: row[4] }));
    this.litRing = s.litRing; this.moonTime = s.moon; this.time = s.t;
  }
}

export { OTHER_TEAM };
