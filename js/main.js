// Boot, game loop and screen flow.

import { TRACKS } from './data/tracks.js';
import { PLAYER, RIVALS } from './data/drivers.js';
import { Track } from './track.js';
import { Race } from './race.js';
import { Camera } from './camera.js';
import { PHYS } from './car.js';
import { drawHUD } from './hud.js';
import { createUI } from './ui.js';
import { save } from './storage.js';
import * as audio from './audio.js';
import { bindTouchControls, initInput, isTouchDevice, onFirstTouch, readInput, setGameActive } from './input.js';
import { clamp, formatTime } from './util.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
const touchEl = document.getElementById('touch');
const pauseBtn = document.getElementById('pauseBtn');
const insetProbe = document.getElementById('insets');

let W = 0;
let H = 0;
let DPR = 1;
let insets = { top: 0, right: 0, bottom: 0, left: 0 };

const cam = new Camera();
const trackCache = new Map();
const NO_INPUT = { gas: 0, brake: 0, steer: 0, analog: false };

function getTrack(id) {
  if (!trackCache.has(id)) {
    const def = TRACKS.find((t) => t.id === id) || TRACKS[0];
    trackCache.set(id, new Track(def));
  }
  return trackCache.get(id);
}

const state = {
  race: null,
  attract: null,
  attractIdx: 0,
  attractT: 0,
  focusIdx: 0,
  paused: false,
  mode: 'race',
  trackId: save.settings.lastTrack || TRACKS[0].id,
  resultsShown: false,
};

const ui = createUI(document.getElementById('ui'), {
  getTrack,
  isTouch: () => isTouchDevice(),
  click: () => {
    audio.unlockAudio();
    audio.sfxClick();
  },
  onStart: (mode, trackId) => startRace(mode, trackId),
  onResume: () => resume(),
  onRestart: () => startRace(state.mode, state.trackId),
  onQuit: () => quitToMenu('title'),
  onTracks: (mode) => {
    quitToMenu(null);
    ui.openSetup(mode);
  },
  onSetting: (key, v) => {
    if (key === 'sound') audio.setSoundEnabled(v);
  },
});

// ---------- layout ----------

function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const cs = getComputedStyle(insetProbe);
  insets = {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
}
window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);
resize();

function touchVisible() {
  return !!state.race && !state.paused && !state.resultsShown && isTouchDevice();
}

function syncChrome() {
  const racing = !!state.race && !state.resultsShown;
  touchEl.hidden = !touchVisible();
  pauseBtn.hidden = !racing || state.paused;
  setGameActive(racing && !state.paused);
}

// ---------- flow ----------

function startAttract() {
  const def = TRACKS[state.attractIdx % TRACKS.length];
  state.attractIdx++;
  const field = RIVALS.concat([{ ...PLAYER, skill: 0.97 }]);
  state.attract = new Race({ track: getTrack(def.id), mode: 'attract', rivals: field });
  state.attractT = 0;
  state.focusIdx = 0;
  cam.snap(state.attract.cars[0], W, H, 0.8);
}

function startRace(mode, trackId) {
  audio.unlockAudio();
  state.mode = mode;
  state.trackId = trackId;
  const track = getTrack(trackId);
  const rec = save.record(trackId);
  state.race = new Race({
    track,
    mode,
    laps: save.settings.laps,
    difficulty: save.settings.difficulty,
    player: PLAYER,
    rivals: RIVALS,
    record: rec,
  });
  state.paused = false;
  state.resultsShown = false;
  ui.hideAll();
  cam.mode = save.settings.camera;
  cam.snap(state.race.player, W, H, 0.45);
  syncChrome();
}

function pause() {
  if (!state.race || state.paused || state.resultsShown) return;
  state.paused = true;
  audio.silence();
  ui.show('pause');
  syncChrome();
}

function resume() {
  if (!state.race) return;
  state.paused = false;
  ui.hideAll();
  syncChrome();
}

function quitToMenu(screen) {
  if (state.race && state.race.recordDirty) save.write();
  state.race = null;
  state.paused = false;
  state.resultsShown = false;
  audio.silence();
  if (!state.attract) startAttract();
  if (screen) ui.show(screen);
  syncChrome();
}

function onPauseKey() {
  if (!state.race || state.resultsShown) return;
  if (state.paused) resume();
  else pause();
}

pauseBtn.addEventListener('click', () => {
  audio.sfxClick();
  pause();
});

// Leaving the app (switching tabs, locking the phone) pauses the race.
// ?nopause turns that off for automated testing.
const AUTO_PAUSE = !new URLSearchParams(location.search).has('nopause');
document.addEventListener('visibilitychange', () => {
  if (document.hidden && AUTO_PAUSE) pause();
});

['pointerdown', 'touchend', 'keydown'].forEach((ev) =>
  window.addEventListener(ev, () => audio.unlockAudio(), { passive: true })
);

// ---------- race notices ----------

function handleOut(r) {
  for (const e of r.out) {
    switch (e.t) {
      case 'light':
        if (e.n > 0) audio.sfxBeep(520, 0.16, 'square', 0.09);
        break;
      case 'lightsOut':
        audio.sfxBeep(1040, 0.3, 'square', 0.1);
        break;
      case 'impact':
        audio.sfxImpact(e.v);
        break;
      case 'boost':
        audio.sfxBoost(e.tier);
        break;
      case 'tier':
        audio.sfxBeep(560 + e.tier * 220, 0.07, 'triangle', 0.07);
        break;
      case 'lap':
        if (e.record) audio.sfxChime([660, 880, 1320], 0.09);
        else audio.sfxBeep(880, 0.1, 'triangle', 0.06);
        break;
      case 'finish':
        recordFinish(r, e.pos);
        audio.sfxChime(e.pos === 1 ? [523, 659, 784, 1047, 1319] : e.pos <= 3 ? [523, 659, 784, 1047] : [523, 659, 784], 0.12);
        break;
      case 'results':
        showResults(r);
        break;
    }
  }
  r.out.length = 0;
  if (r.recordDirty) {
    save.write();
    r.recordDirty = false;
  }
}

function recordFinish(r, pos) {
  const rec = save.record(r.track.id);
  const p = r.player;
  r.prevBestPos = rec.bestPos;
  r.prevBestRace = rec.bestRace;
  rec.races++;
  if (pos === 1) rec.wins++;
  if (rec.bestPos == null || pos < rec.bestPos) rec.bestPos = pos;
  if (r.totalLaps === 3 && (rec.bestRace == null || p.finishTime < rec.bestRace)) rec.bestRace = p.finishTime;
  const s = save.stats;
  s.races++;
  if (pos === 1) s.wins++;
  if (pos <= 3) s.podiums++;
  save.write();
  r.recordDirty = false;
}

function showResults(r) {
  state.resultsShown = true;
  const res = r.results;
  const chips = [];
  const p = r.player;
  const rec = save.record(r.track.id);
  if (res.fastest && res.fastest.isPlayer) chips.push({ kind: 'purple', text: `Fastest lap of the race: ${formatTime(res.fastest.time)}` });
  if (rec.bestLap != null && p.bestLap != null && Math.abs(rec.bestLap - p.bestLap) < 1e-6) {
    chips.push({ kind: 'purple', text: `Circuit record: ${formatTime(rec.bestLap)}` });
  }
  if (r.prevBestPos == null || res.playerPos < r.prevBestPos) chips.push({ kind: 'green', text: `Best finish here: P${res.playerPos}` });
  ui.showResults(res, { trackName: r.track.name, chips });
  syncChrome();
}

// ---------- loop ----------

let last = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tick(dt);
  requestAnimationFrame(frame);
}

function tick(dt, forcedInput) {
  const input = forcedInput || readInput(save.settings.autoGas);
  const r = state.race;
  if (r && !state.paused) {
    r.update(dt, input);
    handleOut(r);
  } else if (!r && state.attract) {
    const a = state.attract;
    a.update(dt, NO_INPUT);
    a.out.length = 0;
    state.attractT += dt;
    if (state.attractT > 9) {
      state.attractT = 0;
      state.focusIdx = (state.focusIdx + 1 + Math.floor(Math.random() * 3)) % a.cars.length;
    }
    if (a.time > 75) startAttract();
  }
  render(dt, input);
}

function render(dt, input) {
  const r = state.race || state.attract;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (!r) {
    ctx.fillStyle = '#0d1016';
    ctx.fillRect(0, 0, W, H);
    return;
  }
  const racing = !!state.race;
  const focus = racing ? r.player : r.order[Math.min(state.focusIdx, r.order.length - 1)] || r.cars[0];
  r.focus = focus;
  if (!racing || !state.paused) {
    const sf = Math.max(0, focus.forwardSpeed) / PHYS.TOP;
    const menuSheetBottom = !racing && W < 641;
    const menuRail = !racing && !menuSheetBottom;
    cam.update(dt, focus, {
      w: W,
      h: H,
      mode: racing ? save.settings.camera : 'fixed',
      touchUI: racing && touchVisible(),
      speedFrac: sf,
      boost: focus.boost > 0,
      zoomMul: racing ? 1 : 0.85,
      rate: racing && r.phase === 'intro' ? 0.6 : 1,
      anchorX: menuRail ? (Math.min(400, W * 0.45) + W) / 2 : null,
      anchorY: menuSheetBottom ? H * 0.2 : null,
    });
    if (r.shake > 0) {
      cam.shake(r.shake);
      r.shake = 0;
    }
  }
  r.draw(ctx, cam, W, H, DPR);

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = r.track.theme.tint;
  ctx.fillRect(0, 0, W, H);
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  if (racing) drawHUD(ctx, r, cam, W, H, insets, { touchUI: touchVisible() });
  updateEngineSound(r, input);
}

function updateEngineSound(r, input) {
  const p = state.race && r.player;
  if (!p || state.paused) {
    audio.silence();
    return;
  }
  let near = null;
  let nd = Infinity;
  for (const c of r.cars) {
    if (c === p) continue;
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < nd) {
      nd = d;
      near = c;
    }
  }
  const speedFrac = p.frozen ? p.gas * 0.13 : Math.max(0, p.forwardSpeed) / PHYS.TOP;
  audio.engineUpdate({
    speedFrac,
    throttle: p.gas,
    boost: p.boost > 0,
    active: true,
    slide: p.offTrack ? 0 : clamp((p.slide - 60) / 200, 0, 1) + (p.drifting ? 0.3 : 0),
    offroad: p.offTrack ? clamp(p.speed / 400, 0, 1) : p.onKerb ? 0.35 : 0,
    rival: near ? { rpm: audio.gearInfo(Math.max(0, near.forwardSpeed) / PHYS.TOP).rpm, level: clamp(1 - nd / 520, 0, 1) } : null,
  });
}

// ---------- boot ----------

initInput({ onPause: onPauseKey });
bindTouchControls(touchEl);
onFirstTouch(() => {
  syncChrome();
  if (ui.current === 'title') ui.show('title');
});
audio.setSoundEnabled(save.settings.sound);

if (document.fonts && document.fonts.load) {
  ['900 20px "Saira Condensed"', '700 16px "JetBrains Mono"', '700 16px "Titillium Web"'].forEach((f) =>
    document.fonts.load(f).catch(() => {})
  );
}

// Handle for poking at the game from the browser console while testing.
window.lightsOut = { state, startRace, save, getTrack, tick, resume };

startAttract();
ui.show('title');
syncChrome();
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* not available here (for example inside a sandboxed preview) */
    });
  });
}
