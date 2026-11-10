// Boot, game loop and screen flow.

import { ALL_REAL, TRACKS } from './data/tracks.js';
import { allDrivers, playerFor, rivalsFor } from './data/teams.js';
import { Track } from './track.js';
import { Race } from './race.js';
import { Camera } from './camera.js';
import { PHYS } from './car.js';
import { drawHUD } from './hud.js';
import { createUI } from './ui.js';
import { save } from './storage.js';
import * as audio from './audio.js';
import { bindTouchControls, initInput, isTouchDevice, onFirstTouch, readInput, setGameActive, touchSnapshot } from './input.js';
import { clamp, formatTime } from './util.js';
import { POINTS, ROUNDS, abandonSeason, currentSeason, isComplete, nextTrack, playerStanding, recordRound, standings, startSeason, teamStanding } from './season.js';

// Bump together with --build in css/style.css and CACHE in sw.js.
const BUILD = '17';

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

// Building a circuit takes a moment and some memory, so keep the last few.
function getTrack(id) {
  if (!trackCache.has(id)) {
    const def = TRACKS.find((t) => t.id === id) || TRACKS[0];
    trackCache.set(def.id === id ? id : def.id, new Track(def));
    if (trackCache.size > 4) trackCache.delete(trackCache.keys().next().value);
  }
  const t = trackCache.get(id) || trackCache.get(TRACKS[0].id);
  trackCache.delete(t.id);
  trackCache.set(t.id, t); // most recently used last
  return t;
}

const state = {
  race: null,
  attract: null,
  attractIdx: 0,
  attractT: 0,
  focusIdx: 0,
  paused: false,
  mode: 'race',
  trackId: TRACKS.some((t) => t.id === save.settings.lastTrack) ? save.settings.lastTrack : TRACKS[0].id,
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
  onRestart: () => (state.mode === 'season' ? startSeasonRace() : startRace(state.mode, state.trackId)),
  onSeasonStart: (opts) => {
    startSeason(opts);
    ui.openSeason();
  },
  onSeasonRace: () => startSeasonRace(),
  onSeasonAbandon: () => {
    abandonSeason();
    ui.openSeason();
  },
  onSeasonContinue: () => {
    quitToMenu(null);
    ui.openSeason();
  },
  onQuit: () => quitToMenu('title'),
  onTracks: (mode) => {
    quitToMenu(null);
    ui.openSetup(mode);
  },
  onSetting: (key, v) => {
    if (key === 'sound') audio.setSoundEnabled(v);
    if (key === 'steerSide') applySide();
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
window.addEventListener('resize', () => {
  resize();
  if (portraitPhone?.matches) pause(); // turned upright mid-race
});
window.visualViewport?.addEventListener('resize', resize);
resize();

function crossedLine() {
  return !!state.race && state.race.phase === 'finished';
}

function touchVisible() {
  return !!state.race && !state.paused && !state.resultsShown && !crossedLine() && isTouchDevice();
}

// Which thumb steers. The pause button goes with the pedal, out of the way of
// the panels above the steering strip.
function applySide() {
  const right = save.settings.steerSide === 'right';
  touchEl.classList.toggle('swap', right);
  document.documentElement.classList.toggle('swap-controls', right && isTouchDevice());
}

// Phones play sideways. Upright, a screen asks you to turn the phone (CSS)
// and a race in progress pauses. Installed apps on Android lock to landscape.
const portraitPhone = window.matchMedia ? matchMedia('(orientation: portrait) and (max-width: 600px) and (pointer: coarse)') : null;
portraitPhone?.addEventListener?.('change', () => {
  if (portraitPhone.matches) pause();
});

function lockLandscape() {
  if (!isTouchDevice()) return;
  try {
    screen.orientation?.lock?.('landscape')?.catch?.(() => {});
  } catch (e) {
    /* not supported: the turn-your-phone screen covers it */
  }
}

// Where the steering and pedal controls are on screen, so the HUD can keep
// clear of them.
function controlRects() {
  if (touchEl.hidden) return null;
  const s = touchEl.querySelector('.steer-btns')?.getBoundingClientRect();
  const p = touchEl.querySelector('.pedal-btns')?.getBoundingClientRect();
  const g = touchEl.querySelector('.tbtn.gas')?.getBoundingClientRect();
  return s && p && s.width && p.width ? { steer: s, pedal: p, gas: g } : null;
}

function syncChrome() {
  const racing = !!state.race && !state.resultsShown && !crossedLine();
  touchEl.hidden = !touchVisible();
  pauseBtn.hidden = !racing || state.paused;
  setGameActive(racing && !state.paused);
}

// ---------- flow ----------

function startAttract() {
  const def = TRACKS[state.attractIdx % TRACKS.length];
  state.attractIdx++;
  state.attract = new Race({ track: getTrack(def.id), mode: 'attract', rivals: allDrivers() });
  state.attractT = 0;
  state.focusIdx = 0;
  cam.snap(state.attract.cars[0], W, H, 0.8);
}

function startRace(mode, trackId) {
  launch({ mode, trackId, laps: save.settings.laps, difficulty: save.settings.difficulty, team: save.settings.team, seat: save.settings.seat });
}

// The next round of the championship, with the season's own settings.
function startSeasonRace() {
  const s = currentSeason();
  if (!s || isComplete(s)) return;
  launch({ mode: 'season', trackId: nextTrack(s).id, laps: s.laps, difficulty: s.difficulty, team: s.team, seat: s.seat });
}

function launch({ mode, trackId, laps, difficulty, team, seat }) {
  audio.unlockAudio();
  lockLandscape();
  state.mode = mode;
  state.trackId = trackId;
  const track = getTrack(trackId);
  const rec = save.record(trackId);
  state.race = new Race({
    track,
    mode: mode === 'season' ? 'race' : mode,
    laps,
    difficulty,
    player: playerFor(team, seat),
    rivals: rivalsFor(team, seat),
    record: rec,
  });
  // What's being raced, for the title card, HUD, pause and results.
  const season = mode === 'season' ? currentSeason() : null;
  state.race.event = {
    gp: track.def.gp,
    name: track.def.name,
    country: track.def.country,
    accent: track.def.theme.thumb,
    mode,
    laps,
    round: season ? season.round + 1 : null,
    rounds: ROUNDS,
  };
  state.paused = false;
  state.resultsShown = false;
  ui.hideAll();
  cam.mode = save.settings.camera;
  cam.snap(state.race.player, W, H, 0.45);
  syncChrome();
}

function pause() {
  if (!state.race || state.paused || state.resultsShown || crossedLine()) return;
  state.paused = true;
  audio.silence();
  const ev = state.race.event;
  const p = state.race.player;
  if (ev) {
    const lap = ev.mode === 'trial' ? `lap ${Math.max(1, p.lap + 1)}` : `lap ${Math.min(Math.max(1, p.lap + 1), ev.laps)} of ${ev.laps}`;
    ui.setPauseInfo(`${ev.round ? `Round ${ev.round} of ${ev.rounds} · ` : ''}${ev.gp}${ev.gp.startsWith(ev.name) ? '' : ` · ${ev.name}`} · ${lap}`);
  }
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
  if (!state.race || state.resultsShown || crossedLine()) return;
  if (state.paused) resume();
  else pause();
}

// After the finish, a tap or Enter jumps straight to the results.
function skipFinish(e) {
  if (!crossedLine() || state.resultsShown) return;
  if (e.type === 'keydown' && !['Enter', 'NumpadEnter', 'Space', 'Escape'].includes(e.code)) return;
  state.race.skipFinish = true;
}
window.addEventListener('pointerdown', skipFinish);
window.addEventListener('keydown', skipFinish);

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
      case 'brakeCue':
        audio.sfxBeep(1180, 0.1, 'square', 0.08);
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
        syncChrome(); // controls away: the race is over
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
  let season = null;
  const s = currentSeason();
  if (state.mode === 'season' && s && !isComplete(s)) {
    const order = res.rows.map((row) => row.driver);
    const before = s.results.length ? playerStanding(s) : null; // no position before round 1
    recordRound(s, order);
    const after = playerStanding(s);
    const mine = teamStanding(s);
    season = {
      round: s.round,
      total: ROUNDS,
      gained: POINTS[res.playerPos - 1] || 0,
      pos: after.pos,
      posBefore: before ? before.pos : null,
      points: after.points,
      gp: r.track.def.gp,
      teamName: mine.team.name,
      teamPos: mine.pos,
      teamPoints: mine.points,
      complete: isComplete(s),
      table: standings(s),
    };
  }
  ui.showResults(res, { trackName: r.track.name, event: r.event, chips, season });
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
  const r = state.race;
  const input = forcedInput || readInput(save.settings.autoGas);
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
  r.hints = save.settings.brakeHints;
  r.draw(ctx, cam, W, H, DPR);

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = r.track.theme.tint;
  ctx.fillRect(0, 0, W, H);
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  if (racing && !state.resultsShown) {
    drawHUD(ctx, r, cam, W, H, insets, {
      touchUI: crossedLine() ? isTouchDevice() : touchVisible(),
      ctl: controlRects(),
      season: state.mode === 'season',
      dt,
    });
  }
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

save.checkLayouts(Object.fromEntries(ALL_REAL.map((d) => [d.id, d.layout])));
initInput({ onPause: onPauseKey });
bindTouchControls(touchEl);
onFirstTouch(() => {
  applySide();
  syncChrome();
  if (ui.current === 'title') ui.show('title');
});
audio.setSoundEnabled(save.settings.sound);
applySide();

if (document.fonts && document.fonts.load) {
  ['900 20px "Saira Condensed"', '700 16px "JetBrains Mono"', '700 16px "Titillium Web"'].forEach((f) =>
    document.fonts.load(f).catch(() => {})
  );
}

// Handle for poking at the game from the browser console while testing.
window.lightsOut = { state, startRace, save, getTrack, tick, resume, touchSnapshot, BUILD, versionMatches };

startAttract();
ui.show('title');
if (!save.settings.team) ui.openTeam(); // first visit: pick a team
syncChrome();
requestAnimationFrame(frame);

// Page, code and stylesheet must come from the same version. Right after an
// update a phone can hold a mix; if so, reload once to fetch a matching set.
function versionMatches() {
  const css = getComputedStyle(document.documentElement).getPropertyValue('--build').replace(/["'\s]/g, '');
  return css === BUILD && !!document.querySelector('#touch .steer-btns') && !!document.getElementById('rotate');
}

function checkVersion() {
  if (versionMatches()) return;
  let last = 0;
  try {
    last = Number(sessionStorage.getItem('lightsout.reloadedAt') || 0);
  } catch (e) {
    /* storage blocked */
  }
  if (Date.now() - last < 30000) return; // tried already: play on rather than loop
  try {
    sessionStorage.setItem('lightsout.reloadedAt', String(Date.now()));
  } catch (e) {
    /* storage blocked */
  }
  location.reload();
}

if (document.readyState === 'complete') checkVersion();
else window.addEventListener('load', checkVersion);

if ('serviceWorker' in navigator && window.isSecureContext) {
  const hadController = !!navigator.serviceWorker.controller;
  // A new version just took over: switch to it now, unless mid-race.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !state.race) location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* not available here (for example inside a sandboxed preview) */
    });
  });
}
