// Keyboard, phone buttons and game controllers all end up as one
// { gas, brake, steer } reading per frame.

import { clamp } from './util.js';

const keys = new Set();
const touch = { steer: 0, steering: false, gas: 0, brake: 0 };
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

export function touchSnapshot() {
  return { ...touch };
}

// Phone buttons: ‹ › under one thumb, GAS above BRAKE under the other
// (steering is on the left unless the sides are swapped in Settings). Each
// half of the screen belongs to one pair, and the line between the two
// buttons decides which one a thumb is on, with a small gap in the middle
// that presses neither. So a thumb can rock from one to the other, and it
// doesn't need to land exactly.
export function bindTouchControls(root) {
  const steerBtns = root.querySelector('.steer-btns');
  const pedalBtns = root.querySelector('.pedal-btns');
  if (!steerBtns || !pedalBtns) return; // stale page from an older version; main.js reloads it
  const btn = {
    left: steerBtns.querySelector('.left'),
    right: steerBtns.querySelector('.right'),
    brake: pedalBtns.querySelector('.brake'),
    gas: pedalBtns.querySelector('.gas'),
  };
  const held = new Map(); // pointer id -> { group: 'steer' | 'pedal', on: button name or null }

  function buttonAt(group, x, y) {
    if (group === 'steer') {
      const split = (btn.left.getBoundingClientRect().right + btn.right.getBoundingClientRect().left) / 2;
      return x < split - 5 ? 'left' : x > split + 5 ? 'right' : null;
    }
    const split = (btn.gas.getBoundingClientRect().bottom + btn.brake.getBoundingClientRect().top) / 2;
    return y < split - 4 ? 'gas' : y > split + 4 ? 'brake' : null;
  }

  function syncButtons() {
    const on = new Set([...held.values()].map((h) => h.on));
    const gas = on.has('gas') ? 1 : 0;
    const brake = on.has('brake') ? 1 : 0;
    if ((gas && !touch.gas) || (brake && !touch.brake)) navigator.vibrate?.(8);
    touch.gas = gas;
    touch.brake = brake;
    touch.steer = (on.has('right') ? 1 : 0) - (on.has('left') ? 1 : 0);
    touch.steering = on.has('left') || on.has('right');
    for (const k of Object.keys(btn)) btn[k].classList.toggle('on', on.has(k));
  }

  // Keep the phone's own long-press and double-tap gestures (text magnifier,
  // callouts, zoom) off the controls; the pointer events below still arrive.
  const block = (e) => {
    if (e.cancelable) e.preventDefault();
  };
  for (const t of ['touchstart', 'touchmove', 'touchend', 'gesturestart']) root.addEventListener(t, block, { passive: false });
  document.addEventListener('selectstart', (e) => {
    if (!e.target.closest?.('input, textarea')) e.preventDefault();
  });

  root.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      root.setPointerCapture(e.pointerId);
    } catch (err) {
      /* not supported */
    }
    const pr = pedalBtns.getBoundingClientRect();
    const pedalRight = pr.left + pr.width / 2 > window.innerWidth / 2;
    const group = (e.clientX > window.innerWidth / 2) === pedalRight ? 'pedal' : 'steer';
    held.set(e.pointerId, { group, on: buttonAt(group, e.clientX, e.clientY) });
    syncButtons();
  });
  root.addEventListener('pointermove', (e) => {
    const h = held.get(e.pointerId);
    if (!h) return;
    const on = buttonAt(h.group, e.clientX, e.clientY);
    if (on !== h.on) {
      h.on = on;
      syncButtons();
    }
  });
  const end = (e) => {
    if (held.delete(e.pointerId)) syncButtons();
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('lostpointercapture', end);
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  clearTouch = () => {
    held.clear();
    syncButtons();
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
  if (touch.steering) steer += touch.steer; // on/off, so the car eases it in like the arrow keys

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
