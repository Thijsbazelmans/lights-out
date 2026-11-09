// Keyboard, on-screen controls, tilting the phone and game controllers all
// end up as one { gas, brake, steer } reading per frame.

import { clamp } from './util.js';

const keys = new Set();
const touch = { steer: 0, steering: false, gas: 0, brake: 0 };
let steerMode = 'float'; // 'float': centre is where the thumb lands; 'fixed': centre of the strip
let controlMode = 'tilt'; // phone layout: 'tilt' (turn the phone, two pedals) or 'slider'
let touchRoot = null;

// Tilt steering. The phone's gravity reading, smoothed, gives how far the
// screen is turned from level, like a steering wheel. Straight ahead is set
// from how you hold the phone before the start (and when you resume).
const D2R = Math.PI / 180;
const tilt = {
  state: 'off', // off | asking | waiting | ok | denied | unavailable
  gx: 0, // gravity along the device's x and y axes, smoothed
  gy: 0,
  have: false,
  since: 0, // when we started listening
  screen: 0, // screen rotation (radians) steering is measured against
  zero: 0, // degrees of turn that count as straight ahead
  following: false, // before the start: keep straight ahead = however it's held
  range: 25, // degrees of turn for full lock
};
let pauseCb = null;
let padPausePrev = false;
let gameActive = false;
let touchSeen = false;
const touchListeners = [];
let clearTouch = () => {};

const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export function initInput({ onPause }) {
  pauseCb = onPause;
  window.addEventListener(
    'keydown',
    (e) => {
      if (gameActive && GAME_KEYS.has(e.code)) e.preventDefault();
      if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) pauseCb?.();
      keys.add(e.code);
    },
    { passive: false }
  );
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear();
    clearTouch();
  });
  window.addEventListener(
    'touchstart',
    () => {
      if (touchSeen) return;
      touchSeen = true;
      touchListeners.forEach((f) => f());
    },
    { passive: true }
  );
}

export function setGameActive(on) {
  gameActive = on;
  if (!on) clearTouch();
}

export function isTouchDevice() {
  return touchSeen || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
}

export function onFirstTouch(cb) {
  touchListeners.push(cb);
}

export function setSteerMode(mode) {
  steerMode = mode === 'fixed' ? 'fixed' : 'float';
}

// ---------- tilt ----------

function screenAngle() {
  const a = screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle : Number(window.orientation) || 0;
  return a * D2R;
}

function onOrientation(e) {
  if (e.beta == null || e.gamma == null) return;
  const b = e.beta * D2R;
  const g = e.gamma * D2R;
  // Which way is down, in the phone's own axes (x right, y up the screen).
  const gx = Math.cos(b) * Math.sin(g);
  const gy = -Math.sin(b);
  if (!tilt.have) {
    tilt.gx = gx;
    tilt.gy = gy;
  }
  tilt.gx += (gx - tilt.gx) * 0.5;
  tilt.gy += (gy - tilt.gy) * 0.5;
  tilt.have = true;
  if (tilt.state !== 'ok') setTiltState('ok'); // readings arriving is what counts
}

// Degrees the screen is turned from level (clockwise positive).
function tiltDegrees() {
  const a = tilt.screen;
  const sx = Math.cos(a) * tilt.gx - Math.sin(a) * tilt.gy;
  return Math.asin(clamp(sx, -1, 1)) / D2R;
}

function setTiltState(st) {
  tilt.state = st;
  applyLayout();
}

let listening = false;

function waitForReadings() {
  if (!listening) {
    window.addEventListener('deviceorientation', onOrientation);
    listening = true;
  }
  tilt.since = performance.now();
  if (tilt.state !== 'ok') setTiltState('waiting');
}

// Start tilt steering. On iPhone this has to run inside a tap (it may show
// the motion-access prompt).
export function enableTilt() {
  if (tilt.state === 'ok' || tilt.state === 'waiting' || tilt.state === 'asking') return;
  if (typeof window.DeviceOrientationEvent === 'undefined') {
    setTiltState('unavailable');
    return;
  }
  const ask = window.DeviceOrientationEvent.requestPermission;
  if (typeof ask !== 'function') {
    waitForReadings();
    return;
  }
  setTiltState('asking');
  tilt.since = performance.now();
  const refused = () => {
    if (tilt.state !== 'ok') setTiltState('denied');
  };
  try {
    ask
      .call(window.DeviceOrientationEvent)
      .then((r) => (r === 'granted' ? waitForReadings() : refused()))
      .catch(refused);
  } catch (e) {
    refused();
  }
  // Some browsers answer "no" but send readings anyway: listen regardless.
  if (!listening) {
    window.addEventListener('deviceorientation', onOrientation);
    listening = true;
  }
}

export function tiltStatus() {
  // No readings a while after we started listening: no motion sensor here.
  if (tilt.state === 'waiting' && performance.now() - tilt.since > 2000) setTiltState('unavailable');
  // Never answered: carry on without (so the race doesn't wait forever).
  if (tilt.state === 'asking' && performance.now() - tilt.since > 15000) setTiltState('denied');
  return tilt.state;
}

// Straight ahead = how the phone is held right now.
export function centreTilt() {
  tilt.screen = screenAngle();
  if (tilt.have) tilt.zero = tiltDegrees();
}

// Before the start, keep re-centring so straight ahead is however you hold it.
export function followTilt(on) {
  if (on && !tilt.following) tilt.screen = screenAngle();
  tilt.following = on;
}

export function setTiltRange(level) {
  tilt.range = level === 'high' ? 17 : level === 'low' ? 35 : 25;
}

export function setControlMode(mode) {
  controlMode = mode === 'slider' ? 'slider' : 'tilt';
  applyLayout();
}

// Tilt layout only while tilt works; otherwise the sliders.
function usingTilt() {
  return controlMode === 'tilt' && (tilt.state === 'ok' || tilt.state === 'waiting' || tilt.state === 'asking');
}

function applyLayout() {
  if (!touchRoot) return;
  const on = usingTilt();
  if (touchRoot.classList.contains('tilt') !== on) {
    clearTouch();
    touchRoot.classList.toggle('tilt', on);
  }
}

export function touchSnapshot() {
  return { ...touch };
}

// Two sliders. Left thumb: a steering strip, proportional left/right.
// Right thumb: an upright pedal, gas at the top, neutral band, brake at the
// bottom. A finger belongs to whichever control it landed on until it lifts,
// so it can wander off the strip without losing control.
// In tilt mode: two big buttons side by side, brake under the left thumb and
// gas under the right. Each half of the screen counts, so you can't miss.
export function bindTouchControls(root) {
  touchRoot = root;
  const pad = root.querySelector('.steer-pad');
  const pedal = root.querySelector('.pedal');
  const gasBtn = root.querySelector('.pedal-btn.gas');
  const brakeBtn = root.querySelector('.pedal-btn.brake');
  if (!pad || !pedal || !gasBtn || !brakeBtn) return; // stale page from an older version; main.js reloads it
  const held = new Map(); // pointer id -> 'gas' | 'brake' (tilt mode)
  const knob = pad.querySelector('.steer-knob');
  const mark = pad.querySelector('.steer-center');
  const pknob = pedal.querySelector('.pedal-knob');
  const GAS_END = 0.52; // top 52% of the pedal is gas
  const BRAKE_START = 0.66; // bottom 34% is brake
  let steerPtr = null;
  let pedalPtr = null;

  const steerRange = (r) => (steerMode === 'float' ? clamp(r.width * 0.3, 60, 110) : r.width / 2 - 30);

  function steerTo(x) {
    const r = pad.getBoundingClientRect();
    const R = steerRange(r);
    const c = steerMode === 'float' ? steerPtr.x0 : r.left + r.width / 2;
    const dx = x - c;
    const dead = 4;
    const u = clamp((Math.abs(dx) - dead) / (R - dead), 0, 1);
    // Gentle near the middle, full lock at the end of the range.
    touch.steer = Math.sign(dx) * Math.pow(u, 1.25);
    touch.steering = true;
    mark.style.left = `${c - r.left}px`;
    knob.style.left = `${clamp(c + clamp(dx, -R, R), r.left + 26, r.right - 26) - r.left}px`;
  }

  function pedalTo(y) {
    const r = pedal.getBoundingClientRect();
    const f = (y - r.top) / r.height;
    const gas = f < GAS_END ? 1 : 0;
    const brake = f > BRAKE_START ? 1 : 0;
    if ((gas && !touch.gas) || (brake && !touch.brake)) navigator.vibrate?.(8);
    touch.gas = gas;
    touch.brake = brake;
    pedal.classList.toggle('gas-on', !!gas);
    pedal.classList.toggle('brake-on', !!brake);
    pknob.style.top = `${clamp(y - r.top, 28, r.height - 28)}px`;
  }

  function releaseSteer() {
    steerPtr = null;
    touch.steer = 0;
    touch.steering = false;
    pad.classList.remove('on');
    knob.style.left = '';
    mark.style.left = '';
  }

  function releasePedal() {
    pedalPtr = null;
    touch.gas = 0;
    touch.brake = 0;
    pedal.classList.remove('on', 'gas-on', 'brake-on');
    pknob.style.top = '';
  }

  function syncButtons() {
    const vals = [...held.values()];
    const gas = vals.includes('gas') ? 1 : 0;
    const brake = vals.includes('brake') ? 1 : 0;
    if ((gas && !touch.gas) || (brake && !touch.brake)) navigator.vibrate?.(8);
    touch.gas = gas;
    touch.brake = brake;
    gasBtn.classList.toggle('on', !!gas);
    brakeBtn.classList.toggle('on', !!brake);
  }

  root.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      root.setPointerCapture(e.pointerId);
    } catch (err) {
      /* not supported */
    }
    if (root.classList.contains('tilt')) {
      held.set(e.pointerId, e.clientX < window.innerWidth / 2 ? 'brake' : 'gas');
      syncButtons();
      return;
    }
    const pr = pedal.getBoundingClientRect();
    if (e.clientX >= pr.left - 28) {
      pedalPtr = e.pointerId;
      pedal.classList.add('on');
      pedalTo(e.clientY);
    } else {
      steerPtr = { id: e.pointerId, x0: e.clientX };
      pad.classList.add('on');
      steerTo(e.clientX);
    }
  });
  root.addEventListener('pointermove', (e) => {
    if (steerPtr && e.pointerId === steerPtr.id) steerTo(e.clientX);
    else if (e.pointerId === pedalPtr) pedalTo(e.clientY);
  });
  const end = (e) => {
    if (held.delete(e.pointerId)) syncButtons();
    if (steerPtr && e.pointerId === steerPtr.id) releaseSteer();
    else if (e.pointerId === pedalPtr) releasePedal();
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('lostpointercapture', end);
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  clearTouch = () => {
    releaseSteer();
    releasePedal();
    held.clear();
    syncButtons();
  };
  applyLayout();
}

export function readInput(autoGas) {
  let gas = 0;
  let brake = 0;
  let steer = 0;
  let analog = false;

  if (keys.has('ArrowUp') || keys.has('KeyW')) gas = 1;
  if (keys.has('ArrowDown') || keys.has('KeyS') || keys.has('Space')) brake = 1;
  if (keys.has('ArrowLeft') || keys.has('KeyA')) steer -= 1;
  if (keys.has('ArrowRight') || keys.has('KeyD')) steer += 1;

  if (touch.gas) gas = 1;
  if (touch.brake) brake = 1;
  if (touch.steering) {
    steer += touch.steer;
    analog = true;
  }
  if (usingTilt() && tilt.have) {
    if (tilt.following) {
      tilt.zero = tiltDegrees();
    } else if (gameActive) {
      const d = tiltDegrees() - tilt.zero;
      const dead = 1.5;
      const u = clamp((Math.abs(d) - dead) / (tilt.range - dead), 0, 1);
      steer += Math.sign(d) * Math.pow(u, 1.15);
      analog = true;
    }
  }

  let padPause = false;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp || !gp.connected) continue;
    const ax = gp.axes[0] || 0;
    if (Math.abs(ax) > 0.12) {
      steer += Math.sign(ax) * ((Math.abs(ax) - 0.12) / 0.88);
      analog = true;
    }
    const b = (i) => {
      const btn = gp.buttons[i];
      if (!btn) return 0;
      return btn.value || (btn.pressed ? 1 : 0);
    };
    gas = Math.max(gas, b(7), b(0));
    brake = Math.max(brake, b(6), b(1), b(2));
    if (b(14) > 0.5) steer -= 1;
    if (b(15) > 0.5) steer += 1;
    if (b(9) > 0.5) padPause = true;
  }
  if (padPause && !padPausePrev) pauseCb?.();
  padPausePrev = padPause;

  if (autoGas && brake < 0.1) gas = 1;

  return { gas: clamp(gas, 0, 1), brake: clamp(brake, 0, 1), steer: clamp(steer, -1, 1), analog };
}
