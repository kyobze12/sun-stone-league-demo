import * as THREE from 'three';

/**
 * Input layer. Produces the same {mx, mz, aim, strike, lob, tackle} shape the
 * simulation consumes for every control scheme:
 *   - 'p1'   : WASD + mouse aim, Space/click = strike (hold to charge), E = lob, Q = tackle
 *   - 'p2'   : Arrows, Enter = strike, Right Shift = lob, "/" = tackle (local 2P)
 *   - touch  : virtual joystick + three buttons; drag on the court to aim
 */
export const keys = {};
const touchMove = { x: 0, z: 0 };
const touchButtons = { strike: false, lob: false, tackle: false, guard: false, spirit: false };
let mouseAim = null;         // angle or null
let mouseStrike = false;
let touchAim = null;
let aimPlayerPos = () => null;
const raycaster = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.2);
let resetStick = () => {};
export const isTouch = () => matchMedia('(pointer: coarse)').matches;

export function resetInput() {
  for (const key of Object.keys(keys)) delete keys[key];
  touchMove.x = touchMove.z = 0; mouseAim = null; touchAim = null; mouseStrike = false;
  touchButtons.strike = touchButtons.lob = touchButtons.tackle = touchButtons.guard = touchButtons.spirit = false;
  resetStick();
}

const SCHEMES = {
  p1: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], strike: ['Space'], lob: ['KeyE', 'ShiftLeft'], tackle: ['KeyQ', 'KeyF'], guard: ['KeyR', 'KeyC'], spirit: ['KeyV'] },
  p2: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], strike: ['Enter', 'NumpadEnter'], lob: ['ShiftRight', 'Slash'], tackle: ['Period', 'ControlRight'], guard: ['Quote'], spirit: ['Backslash'] },
};
const any = (codes) => codes.some((code) => keys[code]);

/**
 * @param {'p1'|'p2'} scheme
 * @param {object} o
 * @param {number} o.facing sign of the direction this player attacks (+1 north, -1 south). Controls are court-relative,
 *   so "up" always means "toward the ring I attack".
 * @param {boolean} o.touch include touch controls
 * @param {boolean} o.arrowsAsP1 in single player, arrows also drive p1
 */
export function readInput(scheme, { facing = 1, yaw = null, touch = false, arrowsAsP1 = false } = {}) {
  const s = SCHEMES[scheme];
  let mx = 0, mz = 0;
  if (any(s.up)) mz += 1; if (any(s.down)) mz -= 1; if (any(s.left)) mx -= 1; if (any(s.right)) mx += 1;
  if (arrowsAsP1) { if (keys.ArrowUp) mz += 1; if (keys.ArrowDown) mz -= 1; if (keys.ArrowLeft) mx -= 1; if (keys.ArrowRight) mx += 1; }
  // Court-relative: up = toward the ring this player attacks. The camera sits behind the player, so
  // screen-right is court -x when attacking +z and +x when attacking -z.
  // With a lock-on camera (`yaw` = the direction the camera looks along the
  // floor), up is "toward the rival" and right is screen-right.
  const toWorld = (rx, up) => yaw === null
    ? [rx * -facing, up * facing]
    : [up * Math.sin(yaw) - rx * Math.cos(yaw), up * Math.cos(yaw) + rx * Math.sin(yaw)];
  [mx, mz] = toWorld(mx, mz);
  let strike = any(s.strike), lob = any(s.lob), tackle = any(s.tackle), guard = any(s.guard), spirit = any(s.spirit);
  let aim = null;
  if (scheme === 'p1') {
    if (mouseStrike) strike = true;
    if (mouseAim !== null) aim = mouseAim;
    if (touch) {
      const [tx, tz] = toWorld(touchMove.x, -touchMove.z);
      mx += tx; mz += tz;
      strike = strike || touchButtons.strike; lob = lob || touchButtons.lob; tackle = tackle || touchButtons.tackle;
      guard = guard || touchButtons.guard; spirit = spirit || touchButtons.spirit;
      if (touchAim !== null) aim = touchAim;
    }
  }
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  return { mx, mz, aim, strike, lob, tackle, guard, spirit };
}

function updateAim(clientX, clientY, camera, canvas, playerPos) {
  if (!playerPos) return null;
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(aimPlane, hit)) return Math.atan2(hit.x - playerPos.x, hit.z - playerPos.z);
  return null;
}

export function setupInput(canvas, camera, getPlayerPos) {
  aimPlayerPos = getPlayerPos;
  window.addEventListener('keydown', (event) => {
    if (event.target.closest?.('button,input,textarea,select')) return;
    keys[event.code] = true;
    if (event.code.startsWith('Arrow') || event.code === 'Space') event.preventDefault();
  });
  window.addEventListener('keyup', (event) => { keys[event.code] = false; });
  window.addEventListener('blur', resetInput);
  document.addEventListener('visibilitychange', () => { if (document.hidden) resetInput(); });

  let aimId = null;
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') { if (event.pointerId === aimId) touchAim = updateAim(event.clientX, event.clientY, camera, canvas, getPlayerPos()); }
    else mouseAim = updateAim(event.clientX, event.clientY, camera, canvas, getPlayerPos());
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') { aimId = event.pointerId; canvas.setPointerCapture(aimId); touchAim = updateAim(event.clientX, event.clientY, camera, canvas, getPlayerPos()); }
    else { mouseAim = updateAim(event.clientX, event.clientY, camera, canvas, getPlayerPos()); if (event.button === 0) mouseStrike = true; if (event.button === 2) keys.KeyE = true; }
  });
  const releasePointer = (event) => {
    if (event.pointerType === 'touch') { if (event.pointerId === aimId) { aimId = null; touchAim = null; } }
    else { if (event.button === 0) mouseStrike = false; if (event.button === 2) keys.KeyE = false; }
  };
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);
  canvas.addEventListener('lostpointercapture', (event) => { if (event.pointerId === aimId) { aimId = null; touchAim = null; } });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  window.addEventListener('mouseup', () => { mouseStrike = false; });

  // Virtual joystick
  const joystick = document.getElementById('joystick');
  const knob = document.getElementById('joystick-knob');
  let stickId = null;
  const updateStick = (event) => {
    const rect = joystick.getBoundingClientRect();
    let dx = event.clientX - (rect.left + rect.width / 2);
    let dy = event.clientY - (rect.top + rect.height / 2);
    const max = rect.width * .34;
    const distance = Math.hypot(dx, dy);
    if (distance > max) { dx *= max / distance; dy *= max / distance; }
    touchMove.x = dx / max; touchMove.z = dy / max;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  joystick.addEventListener('pointerdown', (event) => { if (stickId !== null) return; stickId = event.pointerId; joystick.setPointerCapture(stickId); updateStick(event); });
  joystick.addEventListener('pointermove', (event) => { if (event.pointerId === stickId) updateStick(event); });
  const releaseStick = (event) => {
    if (event.pointerId !== stickId) return;
    stickId = null; touchMove.x = 0; touchMove.z = 0; knob.style.transform = 'translate(0, 0)';
  };
  resetStick = () => {
    const captured = stickId; stickId = null; aimId = null;
    if (captured !== null && joystick.hasPointerCapture(captured)) joystick.releasePointerCapture(captured);
    knob.style.transform = 'translate(0, 0)';
  };
  joystick.addEventListener('lostpointercapture', releaseStick);
  joystick.addEventListener('pointerup', releaseStick);
  joystick.addEventListener('pointercancel', releaseStick);

  // Touch buttons (hold-to-charge works because we track down/up)
  for (const [id, key] of [['strike-btn', 'strike'], ['lob-btn', 'lob'], ['tackle-btn', 'tackle'], ['guard-btn', 'guard'], ['spirit-btn', 'spirit']]) {
    const button = document.getElementById(id);
    if (!button) continue;
    // Capture the pointer so a thumb that drifts a few pixels off the button
    // while charging does not fire a half-charged strike.
    const down = (event) => {
      event.preventDefault();
      try { button.setPointerCapture(event.pointerId); } catch { /* old WebKit */ }
      touchButtons[key] = true; button.classList.add('held');
    };
    const up = () => { touchButtons[key] = false; button.classList.remove('held'); };
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('lostpointercapture', up);
  }
}
