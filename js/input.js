// Keyboard, on-screen buttons and game controllers all end up as one
// { gas, brake, steer } reading per frame.

import { clamp } from './util.js';

const keys = new Set();
const touch = { left: false, right: false, gas: false, brake: false };
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

// Every finger is matched to the nearest button within reach, so a thumb can
// slide from left to right without lifting.
export function bindTouchControls(root) {
  const btns = [...root.querySelectorAll('[data-btn]')];
  const pointers = new Map();

  const update = () => {
    const next = { left: false, right: false, gas: false, brake: false };
    for (const p of pointers.values()) {
      let best = null;
      let bestD = Infinity;
      for (const b of btns) {
        const r = b.getBoundingClientRect();
        const pad = 22;
        if (p.x < r.left - pad || p.x > r.right + pad || p.y < r.top - pad || p.y > r.bottom + pad) continue;
        const cx = (r.left + r.right) / 2;
        const cy = (r.top + r.bottom) / 2;
        const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
      if (best) next[best.dataset.btn] = true;
    }
    for (const b of btns) {
      const k = b.dataset.btn;
      if (next[k] && !touch[k] && navigator.vibrate) navigator.vibrate(6);
      b.classList.toggle('on', next[k]);
    }
    Object.assign(touch, next);
  };

  root.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      root.setPointerCapture(e.pointerId);
    } catch (err) {
      /* not supported */
    }
    update();
  });
  root.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    update();
  });
  const end = (e) => {
    if (!pointers.delete(e.pointerId)) return;
    update();
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('lostpointercapture', end);
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  clearTouch = () => {
    pointers.clear();
    update();
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
  if (touch.left) steer -= 1;
  if (touch.right) steer += 1;

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
