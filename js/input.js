// Keyboard, on-screen sliders and game controllers all end up as one
// { gas, brake, steer } reading per frame.

import { clamp } from './util.js';

const keys = new Set();
const touch = { steer: 0, steering: false, gas: 0, brake: 0 };
let steerMode = 'float'; // 'float': centre is where the thumb lands; 'fixed': centre of the strip
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

export function touchSnapshot() {
  return { ...touch };
}

// Two sliders. Left thumb: a steering strip, proportional left/right.
// Right thumb: an upright pedal, gas at the top, neutral band, brake at the
// bottom. A finger belongs to whichever control it landed on until it lifts,
// so it can wander off the strip without losing control.
export function bindTouchControls(root) {
  const pad = root.querySelector('.steer-pad');
  const pedal = root.querySelector('.pedal');
  if (!pad || !pedal) return; // stale page from an older version; main.js reloads it
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

  root.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      root.setPointerCapture(e.pointerId);
    } catch (err) {
      /* not supported */
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
  };
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
