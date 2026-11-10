import * as THREE from 'three';
import { COURT_LENGTH, COURT_WIDTH, HIT_RANGE, HIT_MAX_HEIGHT, BACK_ZONE, GRAVITY, BALL_RADIUS, CHARGE_TIME, TACKLE_HIT_RADIUS } from './config.js';

/**
 * Role-aware AI that produces the same input shape a human produces, so the
 * simulation never cares who is in control.
 *
 * Decisions are re-evaluated every `profile.reaction` seconds (reaction time)
 * and movement is smoothed, which makes Novice AI feel sluggish and Champion
 * AI feel sharp without separate code paths.
 */
export class AIController {
  constructor(player, profile, random) {
    this.player = player;
    this.profile = profile;
    this.random = random;
    this.reset();
  }

  reset() {
    this.think = 0;
    this.target = this.player.spawn.clone();
    this.plan = 'hold';
    this.chargeTimer = 0;
    this.releaseAt = .4;
    this.intercept = { point: this.player.spawn.clone(), time: Infinity };
    this.kind = 'smash';
    this.aimError = 0;
    this.wantTackle = false;
    this.input = { mx: 0, mz: 0, aim: null, strike: false, lob: false, tackle: false };
  }

  decide(world, dt) {
    const me = this.player, ball = world.ball;
    this.intercept = this.predictIntercept(world);
    this.think -= dt;
    if (this.think <= 0) {
      this.think = this.profile.reaction * (.8 + this.random() * .4);
      this.plan = this.choosePlan(world);
      this.aimError = (this.random() - .5) * 2 * this.profile.aimError;
    }
    const input = this.input;
    input.tackle = false;

    // Movement toward the current target with a little dead zone.
    const dx = this.target.x - me.pos.x, dz = this.target.z - me.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > .25) { input.mx = dx / d; input.mz = dz / d; } else { input.mx = 0; input.mz = 0; }

    // Striking. The AI winds up while the ball is still travelling toward it and
    // lets go the moment the ball is actually in range, so its power comes from
    // reading the play early — the same skill a human is exercising. Holding to
    // a fixed charge target instead made it swing at empty air constantly.
    const free = ball.heldCooldown <= 0 && me.hitCooldown <= 0 && !me.busy;
    const reachable = world.inRange(me) && free;
    const windup = this.releaseAt * CHARGE_TIME + .08;
    const incoming = this.intercept.time <= windup;
    if (me.charge < 0) {
      input.strike = false; input.lob = false;
      if (free && (reachable || incoming)) {
        this.kind = this.chooseKind(world);
        this.releaseAt = this.profile.charge * (.55 + this.random() * .45);
        input.strike = this.kind === 'smash'; input.lob = this.kind === 'lob';
        input.aim = this.aimAngle(world);
      }
    } else {
      input.aim = this.aimAngle(world);
      // Release on contact, or bail out if the ball is no longer coming at all.
      const lost = !reachable && this.intercept.time > windup + .6;
      const hold = !reachable && !lost;
      input.strike = hold && this.kind === 'smash'; input.lob = hold && this.kind === 'lob';
    }

    // Tackle an opponent who is on the ball and close in front of us.
    if (me.tackleCooldown <= 0 && !me.busy && this.random() < this.profile.tackle * dt * 2.2) {
      for (const other of world.opponents(me)) {
        const toOther = other.pos.clone().sub(me.pos);
        const dist = toOther.length();
        if (dist > 1.2 && dist < 3.2 && other.stun <= 0 && world.inRange(other)) {
          const facing = new THREE.Vector3(Math.sin(me.facing), 0, Math.cos(me.facing));
          if (facing.dot(toOther.normalize()) > .8) { input.tackle = true; break; }
        }
      }
    }
    return input;
  }

  chooseKind(world) {
    const me = this.player, ring = world.targetRing(me);
    const dist = Math.hypot(ring.x - me.pos.x, ring.z - me.pos.z);
    // Lob for ring attempts in mid range, smash to push the ball down court.
    if (dist < 16 && dist > 3 && this.random() < this.profile.lob) return 'lob';
    return 'smash';
  }

  aimAngle(world) {
    const me = this.player, ring = world.targetRing(me);
    const dist = Math.hypot(ring.x - me.pos.x, ring.z - me.pos.z);
    let angle;
    if (dist < 14 || me.slot === 'striker') angle = Math.atan2(ring.x - world.ball.pos.x, ring.z - world.ball.pos.z);
    else {
      // Clear toward the far end, away from the nearest opponent.
      const lateral = (me.pos.x > 0 ? -1 : 1) * (2 + this.random() * 3);
      angle = Math.atan2(lateral, me.attacks * 12);
    }
    return angle + this.aimError;
  }

  choosePlan(world) {
    const me = this.player, ball = world.ball;
    const myEnd = -me.attacks * COURT_LENGTH / 2;
    const ballOnMySide = Math.sign(ball.pos.z) === -me.attacks || Math.abs(ball.pos.z) < 1;
    const ballComing = Math.sign(ball.vel.z) === -me.attacks && ball.vel.length() > 2;
    const landing = this.intercept.point;
    const mates = world.teammates(me);
    const myDist = me.pos.distanceTo(landing), mateDist = Math.min(Infinity, ...mates.map((m) => m.pos.distanceTo(landing)));
    const nearest = myDist <= mateDist + .5;

    if (me.slot === 'keeper') {
      // Keeper: hold a line in front of the back zone, mirror ball.x, come out for balls in the zone.
      const inZone = Math.abs(ball.pos.z - myEnd) < BACK_ZONE + 2.5 || (ballComing && Math.abs(landing.z - myEnd) < BACK_ZONE + 2);
      if (inZone || (ballOnMySide && nearest && !mates.some((m) => m.stun <= 0 && m.pos.distanceTo(landing) < 3))) { this.target.copy(landing); return 'clear'; }
      const lineZ = myEnd + me.attacks * (BACK_ZONE + 1.4);
      this.target.set(THREE.MathUtils.clamp(ball.pos.x * .75, -COURT_WIDTH / 2 + 1.2, COURT_WIDTH / 2 - 1.2), 0, lineZ);
      return 'hold';
    }
    // Striker
    if (nearest || ballOnMySide) { this.target.copy(landing); return 'attack'; }
    // Position ahead of the ball toward the opponent ring, offset to the open side.
    const ring = world.targetRing(me);
    const openX = ball.pos.x > 0 ? -2.6 : 2.6;
    this.target.set(THREE.MathUtils.clamp(ball.pos.x * .4 + openX, -COURT_WIDTH / 2 + 1, COURT_WIDTH / 2 - 1), 0, THREE.MathUtils.clamp(ball.pos.z + me.attacks * 4, -COURT_LENGTH / 2 + 2, COURT_LENGTH / 2 - 2) * .9 + ring.z * .1);
    return 'support';
  }

  // Earliest point on the ball's path this player can both reach and strike,
  // plus how many seconds away it is. Drives movement and the wind-up timing.
  predictIntercept(world) {
    const ball = world.ball, me = this.player;
    const p = ball.pos.clone(), v = ball.vel.clone();
    const g = GRAVITY * ball.gravityScale;
    const step = 1 / 30;
    const speed = me.moveSpeed * .95;
    let best = null, bestTime = Infinity, fallback = null;
    for (let i = 1; i <= 90; i += 1) {
      p.addScaledVector(v, step); v.y += g * step;
      if (Math.abs(p.x) > COURT_WIDTH / 2 - BALL_RADIUS) { p.x = Math.sign(p.x) * (COURT_WIDTH / 2 - BALL_RADIUS); v.x *= -.66; }
      if (Math.abs(p.z) > COURT_LENGTH / 2 - BALL_RADIUS) { p.z = Math.sign(p.z) * (COURT_LENGTH / 2 - BALL_RADIUS); v.z *= -.66; }
      if (p.y < BALL_RADIUS) { p.y = BALL_RADIUS; v.y = Math.abs(v.y) > .8 ? -v.y * .66 : 0; v.x *= .93; v.z *= .93; }
      if (p.y <= HIT_MAX_HEIGHT * .85) {
        const t = i * step;
        const travel = Math.max(0, Math.hypot(p.x - me.pos.x, p.z - me.pos.z) - HIT_RANGE * .7) / speed;
        if (travel <= t + .1) { best = p.clone(); bestTime = t; break; }
      }
      fallback = p.clone();
    }
    const point = best || fallback || me.pos.clone();
    point.x = THREE.MathUtils.clamp(point.x, -COURT_WIDTH / 2 + .8, COURT_WIDTH / 2 - .8);
    point.z = THREE.MathUtils.clamp(point.z, -COURT_LENGTH / 2 + 1, COURT_LENGTH / 2 - 1);
    point.y = 0;
    return { point, time: bestTime };
  }
}

export { TACKLE_HIT_RADIUS };
