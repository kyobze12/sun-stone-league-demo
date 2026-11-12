import * as THREE from 'three';
import {
  COURT_WIDTH, COURT_LENGTH, PLAYER_SPEED, PLAYER_RADIUS, HIT_RANGE, HIT_MAX_HEIGHT, CHARGE_TIME,
  STRIKE_COOLDOWN, STRIKE_BUFFER, TACKLE_COOLDOWN, TACKLE_DURATION, TACKLE_DISTANCE, TACKLE_HIT_RADIUS, STUN_TIME,
  TEAMS, OTHER_TEAM, ROSTER, DIFFICULTY, POWERUPS, POWERUP_SPAWN_INTERVAL, POWERUP_LIFETIME, BALL_RADIUS, DUEL,
} from './config.js';
import { BallState, RINGS, ringFor } from './ball.js';
import { strikeVelocity } from './shot.js';
import { AIController, DuelAI } from './ai.js';

export const EMPTY_INPUT = Object.freeze({ mx: 0, mz: 0, aim: null, strike: false, lob: false, tackle: false, guard: false, spirit: false });

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
    this.pendingStrike = null;
    this.wind = 0;             // Kukulkan's Wind time left
    this.jaguar = false;       // Jaguar Heart armed
    this.prevInput = { ...EMPTY_INPUT };
    this.ai = null;
    this.spawn = new THREE.Vector3();
    // Duel state
    this.hp = DUEL.hp;
    this.guard = false;
    this.meter = 0;            // fills with blows dealt and taken; full = Sun Strike
    this.chain = 0;            // position in a light chain
    this.chainTimer = 0;
    this.hurt = 0;             // brief flash after taking a hit, for presentation
    this.spirit = 0;           // seconds left in nawal (animal spirit) form
    this.blastCooldown = 0;
  }
  get attacks() { return TEAMS[this.team].attacks; }
  get ring() { return ringFor(this.attacks).center; }
  get moveSpeed() { return PLAYER_SPEED * (this.wind > 0 ? 1.45 : 1) * (this.spirit > 0 ? DUEL.spiritSpeed : 1) * (this.ai ? this.ai.profile.speed : 1); }
  get busy() { return this.stun > 0 || this.dash > 0; }
}

/**
 * The whole simulation: ball, players, power-ups and rule events. No rendering.
 * step(dt, inputs) returns an array of events for the presentation layer.
 */
export class World {
  constructor({ mode = 'match', difficulty = 'normal', seed = 1, humans = ['balam-striker'], serveSide = 0, trial = null } = {}) {
    this.mode = mode;
    this.difficulty = difficulty;
    this.seed = seed;
    this.random = mulberry32(seed);
    this.ball = new BallState();
    this.players = [];
    this.powerups = [];
    this.powerupTimer = POWERUP_SPAWN_INTERVAL * .55;
    this.moonTime = 0;
    this.time = 0;
    this.frozen = false;
    this.ringHunt = mode === 'ringhunt';
    this.duel = mode === 'duel';
    this.trial = trial;
    this.ice = !!trial?.ice;
    this.hazards = [];
    this.hazardTimer = 2;
    if (trial?.hazards === 'blades') this.hazards = [-9, -3, 3, 9].map((z, i) => ({ type: 'blade', z, x: (i % 2 ? 1 : -1) * 5, dir: i % 2 ? -1 : 1, speed: 3.2 + i * .35, length: 3.4, hits: {} }));
    this.projectiles = [];
    this.nextProjectileId = 1;
    this.litRing = 'north';
    this.nextPowerupId = 1;
    const teams = mode === 'ringhunt' || mode === 'practice' ? ['balam'] : ['balam', 'kuk'];
    let index = 0;
    for (const team of teams) {
      const roster = mode === 'practice' || mode === 'ringhunt' || mode === 'duel' ? [ROSTER[0]] : ROSTER;
      for (const spec of roster) {
        const id = `${team}-${spec.slot}`;
        const player = new Player({ id, team, slot: spec.slot, control: humans.includes(id) ? 'human' : 'ai', index: index++ });
        const sign = TEAMS[team].attacks;
        if (mode === 'duel') player.spawn.set(0, 0, -DUEL.spawnZ * sign);
        else player.spawn.set(spec.offset[0] * sign, 0, spec.offset[2] * sign);
        if (player.control === 'ai') {
          const profile = team === 'kuk' && trial?.rivalLevel ? DIFFICULTY[trial.rivalLevel] : team === 'kuk' || mode === 'ringhunt' ? DIFFICULTY[difficulty] : DIFFICULTY.normal;
          // Each AI draws from its own stream. Sharing one generator made the
          // draw order (and so the team listed first) a systematic advantage.
          const rng = mulberry32(seed * 2654435761 + player.index * 40503 + 7);
          player.ai = mode === 'duel' ? new DuelAI(player, profile, rng) : new AIController(player, profile, rng);
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
      player.pendingStrike = null;
      player.speed = 0;
      player.prevInput = { ...EMPTY_INPUT };
      player.guard = false; player.chain = 0; player.chainTimer = 0; player.hurt = 0;
      if (player.ai) player.ai.reset();
    }
    this.powerups.length = 0;
  }

  spawnPowerup() {
    // The Sun Shield guards a back line, which a duel does not have.
    const kinds = Object.keys(POWERUPS).filter((k) => !(this.duel && k === 'shield'));
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

    // Decide every player's input against the same pre-step state, then apply.
    // Deciding and moving in one pass let whoever was listed first react to the
    // others' new positions — a half-frame edge that decided mirror matches.
    const decided = this.players.map((player) => (player.ai ? player.ai.decide(this, dt) : (inputs[player.id] || EMPTY_INPUT)));
    // Apply in a shuffled order too. On a 50/50 ball the player resolved first
    // takes it and the other whiffs, so a fixed order handed every contested
    // ball to the team listed first — worth ~80% of mirror matches.
    for (const i of this.shuffledOrder()) this.updatePlayer(this.players[i], decided[i], dt, events);
    this.separatePlayers();
    this.nudgeBall(dt);

    for (const event of ball.update(dt)) events.push(event);
    if (this.duel) this.duelTick(dt, events);
    if (this.trial) this.hazardTick(dt, events);
    return events;
  }

  // ------------------------------------------------------------ trial hazards
  hazardTick(dt, events) {
    // Razor House: obsidian blades sweep side to side across the alley.
    for (const h of this.hazards) {
      h.x += h.dir * h.speed * dt;
      if (Math.abs(h.x) > COURT_WIDTH / 2 - 1) { h.x = Math.sign(h.x) * (COURT_WIDTH / 2 - 1); h.dir *= -1; }
      for (const p of this.players) {
        if (p.ai && !this.duel) continue;
        if ((h.hits[p.id] || 0) > this.time) continue;
        if (Math.abs(p.pos.z - h.z) < .55 && Math.abs(p.pos.x - h.x) < h.length / 2 && p.stun <= 0) {
          h.hits[p.id] = this.time + 1.2;
          p.stun = .9; p.charge = -1; p.pendingStrike = null;
          p.pos.z += Math.sign(p.pos.z - h.z || 1) * 1.2;
          if (this.duel) this.damage(p, 10, null, events, { kind: 'blade', stun: .9 });
          events.push({ type: 'hazardHit', player: p, pos: p.pos.clone().setY(1) });
        }
      }
    }
    // Fire House: fireballs hurled from the walls at the challenger.
    if (this.trial?.hazards === 'fire' && this.duel) {
      this.hazardTimer -= dt;
      if (this.hazardTimer <= 0) {
        this.hazardTimer = 1.1 + this.random() * .8;
        const target = this.players.find((p) => !p.ai) || this.players[0];
        const side = this.random() < .5 ? -1 : 1;
        const from = new THREE.Vector3(side * (COURT_WIDTH / 2 + .3), 1.25, target.pos.z + (this.random() - .5) * 10);
        const dir = target.pos.clone().setY(1.25).sub(from).normalize();
        this.projectiles.push({ id: this.nextProjectileId++, owner: 'hazard', team: null, power: .6, damage: 6, pos: from, vel: dir.multiplyScalar(12), life: 2 });
        events.push({ type: 'hazardFire', pos: from.clone() });
      }
    }
  }

  /** Restore both fighters for a new duel round. The Sun meter carries over. */
  resetRound() {
    for (const p of this.players) { p.hp = DUEL.hp; p.stun = 0; p.spirit = 0; p.blastCooldown = 0; }
    this.projectiles.length = 0;
    for (const p of this.players) if (p.iceVel) p.iceVel.set(0, 0, 0);
    this.resetPositions(0);
  }

  // ------------------------------------------------------------- duel
  duelTick(dt, events) {
    const ball = this.ball;
    // A struck ball is a weapon: it hurts the rival it hits, not its striker.
    const speed = ball.vel.length();
    if (ball.struck && speed > DUEL.ballMinSpeed && ball.lastToucher) {
      for (const p of this.players) {
        if (p.id === ball.lastToucher || p.hp <= 0) continue;
        const dx = ball.pos.x - p.pos.x, dz = ball.pos.z - p.pos.z;
        if (Math.hypot(dx, dz) > PLAYER_RADIUS + BALL_RADIUS + .15 || ball.pos.y > 2.3) continue;
        const attacker = this.byId(ball.lastToucher);
        let damage = Math.min(DUEL.ballDamageMax, speed * DUEL.ballDamagePerSpeed);
        const blocked = this.facingBlock(p, ball.pos);
        if (blocked) damage *= .25;
        // Bounce the ball off the body so it cannot hit twice.
        const n = new THREE.Vector3(dx, 0, dz).normalize();
        ball.vel.reflect(n).multiplyScalar(.35); ball.vel.y = Math.abs(ball.vel.y) + 2;
        ball.struck = false; ball.lastToucher = null;
        this.damage(p, damage, attacker, events, { kind: 'ball', blocked, stun: damage >= DUEL.ballKnockdown && !blocked ? .9 : .25, push: n.multiplyScalar(-(blocked ? .3 : 1)) });
        break;
      }
    }
    for (const p of this.players) {
      p.hurt = Math.max(0, p.hurt - dt);
      p.chainTimer = Math.max(0, p.chainTimer - dt);
      if (p.chainTimer <= 0) p.chain = 0;
      p.blastCooldown = Math.max(0, p.blastCooldown - dt);
      if (this.trial?.rivalSpirit && p.ai) p.spirit = DUEL.spiritTime;   // Jaguar House: the beast never fades
      if (p.spirit > 0) { p.spirit = Math.max(0, p.spirit - dt); if (p.spirit === 0) events.push({ type: 'spiritEnd', player: p }); }
    }
    // Fire blasts
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const f = this.projectiles[i];
      f.life -= dt;
      f.pos.addScaledVector(f.vel, dt);
      let gone = f.life <= 0 || Math.abs(f.pos.x) > COURT_WIDTH / 2 + .5 || Math.abs(f.pos.z) > COURT_LENGTH / 2;
      if (!gone) {
        for (const p of this.players) {
          if (p.id === f.owner || p.hp <= 0) continue;
          if (Math.hypot(p.pos.x - f.pos.x, p.pos.z - f.pos.z) > DUEL.blastRadius) continue;
          const owner = this.byId(f.owner);
          const blocked = this.facingBlock(p, f.pos);
          const push = f.vel.clone().setY(0).normalize().multiplyScalar(blocked ? .25 : .9);
          this.damage(p, blocked ? 2 : f.damage, owner, events, { kind: 'blast', blocked, stun: blocked ? 0 : .35 + f.power * .3, push });
          gone = true; break;
        }
        // A blast that meets the ball knocks it on.
        if (!gone && this.ball.pos.distanceTo(f.pos) < BALL_RADIUS + .5) {
          this.ball.vel.addScaledVector(f.vel, .7).setY(Math.max(this.ball.vel.y, 5));
          this.ball.lastTouch = this.byId(f.owner)?.team; this.ball.lastToucher = f.owner; this.ball.struck = true;
          events.push({ type: 'blastBall', pos: f.pos.clone() });
          gone = true;
        }
      }
      if (gone) { events.push({ type: 'blastEnd', id: f.id, pos: f.pos.clone() }); this.projectiles.splice(i, 1); }
    }
  }

  /** K'ak': a fire blast thrown from the hands. Charged releases fly harder. */
  blast(player, power, events) {
    if (player.blastCooldown > 0) { events.push({ type: 'whiff', player }); return; }
    player.blastCooldown = DUEL.blastCooldown * (player.spirit > 0 ? .5 : 1);
    player.swingTimer = .35; player.hitCooldown = .3;
    const dir = new THREE.Vector3(Math.sin(player.facing), 0, Math.cos(player.facing));
    const damage = (DUEL.blastBase + DUEL.blastScale * power) * (player.spirit > 0 ? DUEL.spiritPower : 1);
    const f = { id: this.nextProjectileId++, owner: player.id, team: player.team, power, damage,
      pos: player.pos.clone().addScaledVector(dir, .9).setY(1.25), vel: dir.multiplyScalar(DUEL.blastSpeed * (.8 + power * .4)), life: DUEL.blastLife };
    this.projectiles.push(f);
    events.push({ type: 'blast', player, projectile: f, power });
  }

  /** Is `p` guarding and facing `from`? */
  facingBlock(p, from) {
    if (!p.guard || p.stun > 0) return false;
    const toward = Math.atan2(from.x - p.pos.x, from.z - p.pos.z);
    return Math.cos(toward - p.facing) > -.1;   // a wide front arc
  }

  damage(victim, amount, attacker, events, { kind = 'light', blocked = false, stun = 0, push = null } = {}) {
    if (victim.hp <= 0) return;
    if (attacker?.spirit > 0 && kind !== 'blast' && kind !== 'ring') amount *= DUEL.spiritPower;
    if (victim.spirit > 0) amount *= DUEL.spiritArmor;
    const dealt = Math.max(0, Math.round(amount));
    victim.hp = Math.max(0, victim.hp - dealt);
    victim.hurt = .25;
    if (stun > 0) { victim.stun = Math.max(victim.stun, stun); victim.charge = -1; victim.pendingStrike = null; victim.guard = false; }
    if (push) { victim.pos.add(push); }
    if (attacker) attacker.meter = Math.min(100, attacker.meter + dealt * DUEL.meterOnHit);
    victim.meter = Math.min(100, victim.meter + dealt * DUEL.meterOnHurt);
    events.push({ type: 'hit', player: attacker, victim, damage: dealt, kind, blocked, pos: victim.pos.clone().setY(1.3) });
    if (victim.hp <= 0) { victim.stun = 2.5; events.push({ type: 'ko', player: attacker, victim }); }
  }

  /** The nearest rival in reach and in front, for a hand-to-hand blow. */
  meleeTarget(player) {
    let best = null, bestD = DUEL.meleeRange;
    for (const other of this.opponents(player)) {
      if (other.hp <= 0) continue;
      const d = Math.hypot(other.pos.x - player.pos.x, other.pos.z - player.pos.z);
      const toward = Math.atan2(other.pos.x - player.pos.x, other.pos.z - player.pos.z);
      if (d <= bestD && Math.cos(toward - player.facing) > DUEL.meleeArc) { best = other; bestD = d; }
    }
    return best;
  }

  /** Release of STRIKE with no ball in reach: a blow. Light taps chain; a charged release is heavy. */
  melee(player, power, events) {
    player.swingTimer = .32;
    const target = this.meleeTarget(player);
    const heavy = power >= DUEL.heavyThreshold;
    if (!target) { player.hitCooldown = heavy ? .45 : .22; events.push({ type: 'whiff', player, melee: true }); return; }
    const dir = new THREE.Vector3(target.pos.x - player.pos.x, 0, target.pos.z - player.pos.z).normalize();
    const blocked = this.facingBlock(target, player.pos);
    if (!heavy) {
      const step = player.chainTimer > 0 ? Math.min(player.chain + 1, DUEL.light.length) : 1;
      player.chain = step; player.chainTimer = DUEL.chainWindow;
      player.hitCooldown = .16;
      const finisher = step === DUEL.light.length;
      if (blocked) { this.damage(target, DUEL.chip, player, events, { kind: 'light', blocked: true, push: dir.clone().multiplyScalar(.25) }); return; }
      this.damage(target, DUEL.light[step - 1], player, events, { kind: finisher ? 'finisher' : 'light', stun: finisher ? DUEL.chainFinisherStun : DUEL.lightStun, push: dir.clone().multiplyScalar(finisher ? .9 : .3) });
      if (finisher) player.chain = 0;
      return;
    }
    player.hitCooldown = .5; player.chain = 0;
    // In spirit form a full-power blow is the nawal's maul.
    const sun = player.spirit > 0 && power > .85;
    const jaguar = player.jaguar; player.jaguar = false;
    if (sun) {
      this.damage(target, DUEL.superDamage * (jaguar ? 1.3 : 1) / DUEL.spiritPower, player, events, { kind: 'super', stun: DUEL.superStun, push: dir.clone().multiplyScalar(2.6) });
      return;
    }
    const amount = (DUEL.heavyBase + DUEL.heavyScale * power) * (jaguar ? 1.5 : 1);
    if (blocked) {   // a heavy blow smashes through a guard, at half strength
      this.damage(target, amount * .5, player, events, { kind: 'guardbreak', blocked: true, stun: DUEL.guardBreakStun, push: dir.clone().multiplyScalar(.8) });
      return;
    }
    this.damage(target, amount, player, events, { kind: 'heavy', stun: DUEL.heavyStun, push: dir.clone().multiplyScalar(DUEL.heavyKnock) });
  }

  /** Fisher-Yates over player indices, driven by the world RNG so replays match. */
  shuffledOrder() {
    const order = this._order || (this._order = this.players.map((_, i) => i));
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
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
      player.pendingStrike = null;
    } else if (player.dash > 0) {
      player.dash = Math.max(0, player.dash - dt);
      player.pos.addScaledVector(player.dashDir, (TACKLE_DISTANCE / TACKLE_DURATION) * dt);
      this.resolveTackleHits(player, events);
    } else if (this.duel && player.hp <= 0) {
      // Down and out.
    } else {
      const len = Math.hypot(input.mx, input.mz);
      let mx = input.mx, mz = input.mz;
      if (len > 1) { mx /= len; mz /= len; }
      player.guard = this.duel && !!input.guard && player.charge < 0;
      if (this.ice) {
        // Cold House: the floor is ice — you build up speed and slide.
        player.iceVel = player.iceVel || new THREE.Vector3();
        const want = new THREE.Vector3(mx, 0, mz).multiplyScalar(len > .08 ? player.moveSpeed : 0);
        player.iceVel.lerp(want, 1 - Math.exp(-1.6 * dt));
        player.pos.addScaledVector(player.iceVel, dt);
      } else if (len > .08) {
        const chargeSlow = player.charge >= 0 ? .55 : player.guard ? DUEL.guardSpeed : 1;
        player.pos.x += mx * player.moveSpeed * chargeSlow * dt;
        player.pos.z += mz * player.moveSpeed * chargeSlow * dt;
        const target = Math.atan2(mx, mz);
        const turn = Math.atan2(Math.sin(target - player.facing), Math.cos(target - player.facing));
        if (player.swingTimer <= 0 && !this.duel) player.facing += turn * (1 - Math.exp(-14 * dt));
      }
      if (this.duel) {
        // Lock-on: a duellist always squares up to the rival and strafes.
        const rival = this.opponents(player)[0];
        if (rival) {
          const target = Math.atan2(rival.pos.x - player.pos.x, rival.pos.z - player.pos.z);
          const turn = Math.atan2(Math.sin(target - player.facing), Math.cos(target - player.facing));
          player.facing += turn * (1 - Math.exp(-16 * dt));
        }
      }
      // Aim: explicit aim (mouse) wins, otherwise face direction with a soft bias toward the ring.
      if (typeof input.aim === 'number') player.aim = input.aim;
      else player.aim = player.facing;

      // Charge / release for smash and lob
      const held = (input.strike || input.lob) && !player.guard;
      const kind = input.lob && !input.strike ? 'lob' : (input.lob && input.strike ? player.chargeKind : 'smash');
      if (held && player.charge < 0 && player.hitCooldown <= 0) { player.charge = 0; player.chargeKind = kind; }
      if (player.charge >= 0 && held) player.charge = Math.min(1, player.charge + dt / CHARGE_TIME);
      if (player.charge >= 0 && !held) {
        const power = player.charge;
        player.charge = -1;
        // Input buffering: a release a fraction of a second before the ball
        // arrives still connects. Without this, charge-and-release feels like
        // it is swallowing inputs rather than rewarding timing.
        if (this.canStrike(player)) this.tryStrike(player, power, player.chargeKind, events);
        else if (this.duel && player.chargeKind === 'lob') this.blast(player, power, events);
        else if (this.duel && player.chargeKind === 'smash' && (this.meleeTarget(player) || this.ballDistance(player) > HIT_RANGE * 1.3)) this.melee(player, power, events);
        else if (this.ballDistance(player) > HIT_RANGE * 2.4) player.pendingStrike = null; // nowhere near: a cancel, not a flail
        else player.pendingStrike = { power, kind: player.chargeKind, time: STRIKE_BUFFER };
      }
      if (player.pendingStrike) {
        player.pendingStrike.time -= dt;
        if (this.canStrike(player)) { const s = player.pendingStrike; player.pendingStrike = null; this.tryStrike(player, s.power, s.kind, events); }
        else if (player.pendingStrike.time <= 0) { player.pendingStrike = null; player.swingTimer = .45; player.hitCooldown = .22; events.push({ type: 'whiff', player }); }
      }
      if (this.duel && input.spirit && !player.prevInput.spirit && player.meter >= 100 && player.spirit <= 0) {
        player.meter = 0; player.spirit = DUEL.spiritTime; player.stun = 0;
        events.push({ type: 'transform', player });
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
        if (this.duel) {
          // A guard facing the charge turns it aside and leaves the charger reeling.
          if (this.facingBlock(other, tackler.pos)) {
            tackler.dash = 0; tackler.stun = .55;
            events.push({ type: 'hit', player: other, victim: tackler, damage: 0, kind: 'parry', blocked: true, pos: tackler.pos.clone().setY(1.3) });
            continue;
          }
          this.damage(other, DUEL.tackleDamage, tackler, events, { kind: 'tackle', stun: STUN_TIME, push: tackler.dashDir.clone().multiplyScalar(1.1) });
          continue;
        }
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
    for (const index of this.shuffledOrder()) {
      const player = this.players[index];
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
    player.hitCooldown = ok ? STRIKE_COOLDOWN : .22;
    if (!ok) { events.push({ type: 'whiff', player }); return false; }
    const ball = this.ball;
    const profile = player.ai ? player.ai.profile : DIFFICULTY[this.difficulty];
    // Touch players aim with the stick alone, so they get a floor of help.
    const assist = player.ai ? profile.aiAssist : Math.max(profile.assist, this.humanAssistFloor || 0);
    let angle = player.aim;
    let ringAssist = assist;
    if (this.duel && kind === 'smash') {
      // A smash in a duel is thrown at the rival when roughly facing them.
      const rival = this.opponents(player)[0];
      if (rival) {
        const toward = Math.atan2(rival.pos.x - ball.pos.x, rival.pos.z - ball.pos.z);
        if (Math.cos(toward - angle) > .6) { angle = toward; ringAssist = 0; }
      }
    }
    const boost = player.jaguar ? 1.5 : 1;
    const velocity = strikeVelocity({ position: ball.pos, angle, power: .45 + .55 * power, kind, ring: this.targetRing(player), assist: ringAssist, boost, gravityScale: ball.gravityScale });
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

  ballDistance(player) {
    const ball = this.ball;
    return ball.pos.distanceTo(player.pos.clone().setY(ball.pos.y));
  }

  inRange(player) {
    return this.ballDistance(player) <= HIT_RANGE && this.ball.pos.y <= HIT_MAX_HEIGHT;
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
      players: this.players.map((p) => [p.id, p.pos.x, p.pos.z, p.facing, p.speed, p.stun, p.charge, p.swingTimer, p.wind, p.jaguar ? 1 : 0, p.dash, p.tackleCooldown, p.hp, p.guard ? 1 : 0, p.meter, p.hurt, p.spirit]),
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
      p.pos.set(row[1], 0, row[2]); p.facing = row[3]; p.speed = row[4]; p.stun = row[5]; p.charge = row[6]; p.swingTimer = row[7]; p.wind = row[8]; p.jaguar = !!row[9]; p.dash = row[10]; p.tackleCooldown = row[11]; if (row.length > 12) { p.hp = row[12]; p.guard = !!row[13]; p.meter = row[14]; p.hurt = row[15]; p.spirit = row[16] || 0; }
    }
    this.powerups = s.powerups.map((row) => ({ id: row[0], kind: row[1], pos: new THREE.Vector3(row[2], 0, row[3]), life: row[4] }));
    this.litRing = s.litRing; this.moonTime = s.moon; this.time = s.t;
  }
}

export { OTHER_TEAM };
