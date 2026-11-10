import * as THREE from 'three';
import { GRAVITY, RING_RADIUS } from './config.js';

/**
 * Exact velocity that carries the ball from `position` through `ring` centre.
 * Flight time scales with distance so long shots arc higher.
 */
export function ringSolution(position, ringCenter, gravityScale = 1) {
  const toward = new THREE.Vector3(ringCenter.x - position.x, 0, ringCenter.z - position.z);
  const distance = toward.length();
  const flight = THREE.MathUtils.clamp(distance / 11, .7, 1.75);
  const g = GRAVITY * gravityScale;
  return new THREE.Vector3(toward.x / flight, (ringCenter.y - position.y) / flight - .5 * g * flight, toward.z / flight);
}

/**
 * Compute a strike velocity.
 * @param {object} o
 * @param {THREE.Vector3} o.position ball position
 * @param {number} o.angle aim angle (atan2(x, z) in court space)
 * @param {number} o.power 0..1 charge
 * @param {'smash'|'lob'} o.kind
 * @param {THREE.Vector3} o.ring the ring this striker is attacking
 * @param {number} o.assist 0..1 how strongly to snap toward the ring when roughly aimed at it
 * @param {number} [o.boost] multiplier (Jaguar Heart)
 * @param {number} [o.gravityScale]
 */
export function strikeVelocity({ position, angle, power, kind, ring, assist = 0, boost = 1, gravityScale = 1 }) {
  const aim = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
  const p = THREE.MathUtils.clamp(power, 0, 1);
  let velocity;
  if (kind === 'lob') velocity = aim.clone().multiplyScalar(6.5 + 6 * p).setY(9.4 + 4.2 * p);
  else velocity = aim.clone().multiplyScalar(9 + 8 * p).setY(3.6 + 2.2 * p);
  velocity.multiplyScalar(boost);

  // Aim assist: if the striker is roughly facing the ring and inside a sane
  // range, bend the shot toward the exact ring solution. Never a full snap on
  // competitive difficulties, so ring shots stay a skill.
  const toward = new THREE.Vector3(ring.x - position.x, 0, ring.z - position.z);
  const distance = toward.length();
  const dot = aim.dot(toward.normalize());
  // A lob is the deliberate ring attempt, so it gets a wider assist cone.
  const cone = Math.cos(THREE.MathUtils.degToRad(kind === 'lob' ? 34 : 16));
  if (assist > 0 && distance > 2.5 && distance < 19 && dot > cone) {
    const solution = ringSolution(position, ring, gravityScale);
    const closeness = THREE.MathUtils.smoothstep(dot, cone, 1);
    const powerFit = kind === 'lob' ? 1 : THREE.MathUtils.clamp(1 - Math.abs(p - .6) * 1.1, .35, 1);
    // Lobs commit harder to the ring solution than flat smashes do.
    const commit = kind === 'lob' ? 1.12 : 1;
    velocity.lerp(solution, Math.min(.97, assist * closeness * powerFit * commit));
  }
  return velocity;
}

export function ringOpening() { return RING_RADIUS; }
