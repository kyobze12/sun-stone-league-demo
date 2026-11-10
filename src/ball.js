import * as THREE from 'three';
import { COURT_WIDTH, COURT_LENGTH, RING_RADIUS, RING_TUBE, RING_HEIGHT, RING_INSET, BALL_RADIUS, GRAVITY, RESTITUTION, BACKLINE_MAX_HEIGHT } from './config.js';

export { BALL_RADIUS, GRAVITY };

// The two rings. Each ring's hole axis is the court's z axis, so a ball scores
// by flying through the ring along z. `side` is the sign of the end line the
// ring sits in front of; `defender` is the team that guards it.
export const RINGS = Object.freeze([
  { id: 'north', side: 1, defender: 'kuk', center: new THREE.Vector3(0, RING_HEIGHT, COURT_LENGTH / 2 - RING_INSET) },
  { id: 'south', side: -1, defender: 'balam', center: new THREE.Vector3(0, RING_HEIGHT, -(COURT_LENGTH / 2 - RING_INSET)) },
]);
export function ringFor(side) { return RINGS[side > 0 ? 0 : 1]; }

export class BallState {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.gravityScale = 1;
    this.reset();
  }

  reset(serveSide = 0) {
    this.pos.set(0, BALL_RADIUS + 2.4, serveSide * 2.5);
    this.vel.set(0, 0, 0);
    this.heldCooldown = 0;
    this.pendingPass = { north: 0, south: 0 };
    this.scored = false;
    this.lastTouch = null;      // team id of the last striker
    this.lastToucher = null;    // player id
    this.struck = false;        // has anyone struck since the serve
    this.bounces = 0;           // floor bounces since last strike
    this.bounceSide = 0;        // which half the last bounce was on
    this.justBounced = false;
    this.wallHits = 0;
    this.shields = { balam: 0, kuk: 0 }; // time left on each team's back line shield
  }

  /**
   * Advances the ball. Returns a list of events:
   *  {type:'ring', side}  - ball passed through the ring on `side`
   *  {type:'backline', side} - ball touched the end wall on `side`
   *  {type:'doubleBounce', side} - second floor bounce on `side` half
   *  {type:'bounce'} / {type:'wall'} / {type:'rim'} - for effects
   */
  update(dt) {
    const events = [];
    if (this.scored) return events;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let i = 0; i < steps; i += 1) {
      this.step(dt / steps, events);
      if (this.scored) break;
    }
    return events;
  }

  step(dt, events) {
    const previous = this.pos.clone();
    const g = GRAVITY * this.gravityScale;
    this.justBounced = false;
    this.pos.addScaledVector(this.vel, dt);
    this.pos.y += .5 * g * dt * dt;
    this.vel.y += g * dt;
    this.vel.multiplyScalar(Math.exp(-.1 * dt)); // light air drag
    this.heldCooldown = Math.max(0, this.heldCooldown - dt);
    for (const team of ['balam', 'kuk']) this.shields[team] = Math.max(0, this.shields[team] - dt);

    // Floor
    if (this.pos.y < BALL_RADIUS) {
      this.pos.y = BALL_RADIUS;
      if (this.vel.y < 0) {
        const hard = this.vel.y < -2.2;
        this.vel.y = Math.abs(this.vel.y) > .8 ? -this.vel.y * RESTITUTION : 0;
        if (hard) {
          this.justBounced = true;
          events.push({ type: 'bounce', speed: -this.vel.y / RESTITUTION });
          if (this.struck) {
            const side = Math.sign(this.pos.z) || this.bounceSide || 1;
            if (this.bounces >= 1 && side === this.bounceSide) {
              this.bounces = 0;
              events.push({ type: 'doubleBounce', side });
            } else {
              this.bounces = side === this.bounceSide ? this.bounces + 1 : 1;
              this.bounceSide = side;
            }
          }
        }
      }
      const drag = Math.exp(-3 * dt);
      this.vel.x *= drag; this.vel.z *= drag;
    }

    // Rings (torus collision + pass detection)
    for (const ring of RINGS) {
      const c = ring.center;
      const radial = new THREE.Vector3(this.pos.x - c.x, this.pos.y - c.y, 0);
      const radius = radial.length();
      const closest = radius < 1e-8
        ? new THREE.Vector3(0, RING_RADIUS, 0).add(c)
        : radial.multiplyScalar(RING_RADIUS / radius).add(c);
      const normal = this.pos.clone().sub(closest);
      const separation = normal.length();
      if (separation < BALL_RADIUS + RING_TUBE) {
        if (separation < 1e-8) normal.set(0, 0, Math.sign(previous.z - c.z) || -1);
        else normal.multiplyScalar(1 / separation);
        this.pos.copy(closest).addScaledVector(normal, BALL_RADIUS + RING_TUBE + .001);
        const speed = this.vel.dot(normal);
        if (speed < 0) { this.vel.addScaledVector(normal, -(1 + RESTITUTION) * speed); events.push({ type: 'rim', pos: this.pos.clone() }); }
        this.pendingPass[ring.id] = 0;
      } else {
        const dz = this.pos.z - previous.z;
        if (dz && (previous.z - c.z) * (this.pos.z - c.z) <= 0) {
          const t = (c.z - previous.z) / dz;
          const x = THREE.MathUtils.lerp(previous.x, this.pos.x, t), y = THREE.MathUtils.lerp(previous.y, this.pos.y, t);
          if (Math.hypot(x - c.x, y - c.y) < RING_RADIUS - RING_TUBE - BALL_RADIUS * .55) this.pendingPass[ring.id] = Math.sign(dz);
        }
        const pending = this.pendingPass[ring.id];
        if (pending && (this.pos.z - c.z) * pending > BALL_RADIUS + RING_TUBE) {
          this.scored = true;
          events.push({ type: 'ring', side: ring.side, ring });
          return;
        }
        if (pending && this.vel.z * pending <= 0) this.pendingPass[ring.id] = 0;
      }
    }

    // Side walls
    const halfW = COURT_WIDTH / 2 - BALL_RADIUS;
    if (Math.abs(this.pos.x) > halfW) {
      this.pos.x = Math.sign(this.pos.x) * halfW;
      this.vel.x *= -RESTITUTION;
      this.wallHits += 1;
      events.push({ type: 'wall', pos: this.pos.clone() });
    }
    // End lines
    const halfL = COURT_LENGTH / 2 - BALL_RADIUS;
    if (Math.abs(this.pos.z) > halfL) {
      const side = Math.sign(this.pos.z);
      this.pos.z = side * halfL;
      const defender = ringFor(side).defender;
      if (this.shields[defender] > 0) {
        this.vel.z = -Math.abs(this.vel.z) * side * 1.15 - side * 4;
        this.vel.y = Math.max(this.vel.y, 3);
        events.push({ type: 'shield', side, pos: this.pos.clone() });
      } else if (this.pos.y <= BACKLINE_MAX_HEIGHT) {
        this.vel.z *= -RESTITUTION;
        this.scored = true;
        events.push({ type: 'backline', side });
        return;
      } else {
        // High balls just rebound off the end wall; only low, "playable" balls count.
        this.vel.z *= -RESTITUTION;
        this.wallHits += 1;
        events.push({ type: 'wall', pos: this.pos.clone() });
      }
    }
    if (this.pos.y > 14) { this.pos.y = 14; this.vel.y = Math.min(this.vel.y, 0); }
  }
}
