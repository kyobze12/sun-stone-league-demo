import * as THREE from 'three';

export const TEAM_ROSTER = Object.freeze([
  { id: 'player', team: 'sun', control: 'human', role: 'striker', position: [-2.2, 0, -7] },
  { id: 'sun-support', team: 'sun', control: 'ai', role: 'support', position: [2.2, 0, -3.4] },
  { id: 'rival-striker', team: 'rival', control: 'ai', role: 'striker', position: [2.2, 0, 7] },
  { id: 'rival-support', team: 'rival', control: 'ai', role: 'support', position: [-2.2, 0, 3.4] },
]);

export function getSupportTarget(fighter, ballPosition, playerPosition) {
  if (fighter.team === 'sun') {
    const playerToBallZ = ballPosition.z - playerPosition.z;
    return ballPosition.clone().add(new THREE.Vector3(1.1, 0, -Math.sign(playerToBallZ || 1) * 1.2));
  }
  const lane = fighter.id === 'rival-support' ? -1.1 : 1.1;
  return ballPosition.clone().add(new THREE.Vector3(lane, 0, .9));
}

export function getAITarget(fighter, ballPosition, playerPosition) {
  return fighter.role === 'support'
    ? getSupportTarget(fighter, ballPosition, playerPosition)
    : ballPosition.clone();
}

export function shouldAIAttemptHit(distance, hitCooldown, heldCooldown, hitRange) {
  return distance < hitRange && hitCooldown <= 0 && heldCooldown <= 0;
}

export function scoringTeam(mode, lastTouch) {
  return mode === 'solo' || lastTouch === 'sun' ? 'sun' : 'rival';
}
