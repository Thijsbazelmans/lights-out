// Boot, game loop and screen flow.

import { ALL_REAL, TRACKS } from './data/tracks.js';
import { allDrivers, playerFor, rivalsFor } from './data/teams.js';
import { Track } from './track.js';
import { Race, rollForm } from './race.js';
import { Camera } from './camera.js';
import { PHYS, setCarSprites } from './car.js';
import { drawHUD } from './hud.js';
import { createUI } from './ui.js';
import { save } from './storage.js';
import * as audio from './audio.js';
import { musicState, musicTick, setMusic, setMusicEnabled } from './music.js';
import { bindTouchControls, initInput, isTouchDevice, onFirstTouch, readInput, setGameActive, touchSnapshot } from './input.js';
import { clamp, formatGap, formatTime } from './util.js';
import { challengeLink, challengeProblem, codeFrom, decodeChallenge } from './challenge.js';
import { POINTS, ROUNDS, abandonSeason, currentSeason, isComplete, nextTrack, playerStanding, recordRound, standings, startSeason, teamStanding } from './season.js';

// Bump together with --build in css/style.css and CACHE in sw.js.
const BUILD = '32';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
const touchEl = document.getElementById('touch');
const pauseBtn = document.getElementById('pauseBtn');
const insetProbe = document.getElementById('insets');

let W = 0;
let H = 0;
let DPR = 1;
let insets = { top: 0, right: 0, bottom: 0, left: 0 };

// A phone or tablet (touch is its main input; a touchscreen laptop isn't).
// To keep phones cooler the game is drawn at 1.5 pixels per point rather
// than 2, races at an even 60 frames a second at most (every other frame on
// a 120 Hz screen: a phone trying for 120 heats up and slows to ~48 anyway),
// about 30 behind the menus; the circuit comes from tiles drawn once
// (tiles.js) and each car from a picture (car.js). Battery saver (Settings)
// draws at 1.25 with fewer particles.
const PHONE = !!window.matchMedia && matchMedia('(pointer: coarse)').matches;
const PHONE_DPR = 1.5;
const SAVER_DPR = 1.25;
const PHONE_PARTICLES = 450; // most smoke, dust and sparks at once (900 elsewhere)
const SAVER_PARTICLES = 260;
const shade = { canvas: document.createElement('canvas'), key: '' }; // see shadeFor()
let ctlRects; // see controlRects()
let drawnStill = false; // the paused race is on screen and nothing moves

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
  challenge: null, // the lap someone sent you, in a time trial against it
  trackId: TRACKS.some((t) => t.id === save.settings.lastTrack) ? save.settings.lastTrack : TRACKS[0].id,
  resultsShown: false,
};

const ui = createUI(document.getElementById('ui'), {
  build: BUILD,
  getTrack,
  isTouch: () => isTouchDevice(),
  click: () => {
    audio.unlockAudio();
    audio.sfxClick();
  },
  onStart: (mode, trackId, challenge) => startRace(mode, trackId, challenge),
  onResume: () => resume(),
  onRestart: () => (state.mode === 'season' || state.mode === 'quali' ? startSeasonRace() : startRace(state.mode, state.trackId, state.challenge)),
  onChallengeText: (text) => openChallenge(text, false),
  onSeasonStart: (opts) => {
    startSeason(opts);
    clearWeekend();
    ui.openSeason();
  },
  onSeasonRace: () => startSeasonRace(),
  onQualiRace: () => startSeasonRace(),
  weekend: () => {
    const s = currentSeason();
    return s && !isComplete(s) ? weekendFor(s, false) : null;
  },
  onSeasonAbandon: () => {
    abandonSeason();
    clearWeekend();
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
    if (key === 'music') setMusicEnabled(v);
    if (key === 'batterySaver') {
      resize();
      for (const r of [state.race, state.attract]) if (r && PHONE) r.particles.max = phoneParticles();
    }
    if (key === 'steerSide') applySide();
  },
});

// ---------- layout ----------

function resize() {
  DPR = Math.min(PHONE ? (save.settings.batterySaver ? SAVER_DPR : PHONE_DPR) : 2, window.devicePixelRatio || 1);
  shade.key = ''; // rebuild the tint and vignette for the new size
  ctlRects = undefined;
  drawnStill = false; // a resized canvas is blank: draw it again
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

function phoneParticles() {
  return save.settings.batterySaver ? SAVER_PARTICLES : PHONE_PARTICLES;
}

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
  ctlRects = undefined;
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
// Measured once, then kept until the layout changes (resize, side swap,
// buttons shown or hidden).
function controlRects() {
  if (touchEl.hidden) return null;
  if (ctlRects !== undefined) return ctlRects;
  const s = touchEl.querySelector('.steer-btns')?.getBoundingClientRect();
  const p = touchEl.querySelector('.pedal-btns')?.getBoundingClientRect();
  const g = touchEl.querySelector('.tbtn.gas')?.getBoundingClientRect();
  const rects = s && p && s.width && p.width ? { steer: s, pedal: p, gas: g } : null;
  if (rects) ctlRects = rects; // not laid out yet: measure again next frame
  return rects;
}

function syncChrome() {
  const racing = !!state.race && !state.resultsShown && !crossedLine();
  const hidden = !touchVisible();
  if (touchEl.hidden !== hidden) ctlRects = undefined;
  touchEl.hidden = hidden;
  pauseBtn.hidden = !racing || state.paused;
  setGameActive(racing && !state.paused);
}

// ---------- flow ----------

function startAttract() {
  const def = TRACKS[state.attractIdx % TRACKS.length];
  state.attractIdx++;
  state.attract = new Race({ track: getTrack(def.id), mode: 'attract', rivals: allDrivers() });
  if (PHONE) {
    state.attract.particles.max = phoneParticles();
    state.attract.particles.sprites = true;
    state.attract.tiled = true;
  }
  state.attractT = 0;
  state.focusIdx = 0;
  cam.snap(state.attract.cars[0], W, H, 0.8);
}

// challenge: a time trial against a lap someone sent you (challenge.js).
function startRace(mode, trackId, challenge = null) {
  state.challenge = mode === 'trial' ? challenge : null;
  if (state.challenge && !state.challenge.raced) {
    state.challenge.raced = true; // (the menu stops calling it new)
    save.write();
  }
  launch({ mode, trackId, laps: save.settings.laps, difficulty: save.settings.difficulty, team: save.settings.team, seat: save.settings.seat, challenge: state.challenge });
}

// A challenge link: opened with the game (#c=...) or pasted under Time
// trial. It's kept (one per circuit) and shown: who, where, the time to beat.
async function openChallenge(text, fromLink) {
  let c;
  try {
    c = await decodeChallenge(text);
  } catch (e) {
    ui.showChallenge(null, { error: e.message });
    return;
  }
  if (!challengeProblem(c)) {
    const had = save.challenge(c.track);
    if (had && had.name === c.name && Math.abs(had.time - c.time) < 1e-6) c.raced = had.raced; // the same lap again
    save.setChallenge(c);
  }
  // Opened in the browser on a phone: if the game lives on the home screen,
  // that's a separate copy with its own records, so offer to copy it across.
  const standalone = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  ui.showChallenge(c, { link: challengeLink(codeFrom(text)), inBrowser: fromLink && PHONE && !standalone });
}

// A season weekend: qualifying, then the race. What qualifying decided (and
// the other drivers' laps, so a restart replays the same session) is kept on
// this device next to the season, until the race is done.
function weekendFor(s, create = true) {
  let wk = save.weekend;
  if (wk && wk.season === s.startedAt && wk.round === s.round) return wk;
  if (!create) return null;
  const form = {};
  for (const d of s.lineup) if (d.id !== 'you') form[d.id] = Math.round(rollForm() * 1000) / 1000;
  wk = { season: s.startedAt, round: s.round, track: nextTrack(s).id, form, field: null, grid: null, pos: null, time: null };
  save.weekend = wk;
  save.write();
  return wk;
}

function clearWeekend() {
  save.weekend = null;
  save.write();
}

// The next session of the championship, with the season's own settings:
// qualifying, or the race once you've qualified.
function startSeasonRace() {
  const s = currentSeason();
  if (!s || isComplete(s)) return;
  const wk = weekendFor(s);
  const base = { trackId: nextTrack(s).id, laps: s.laps, difficulty: s.difficulty, team: s.team, seat: s.seat, form: wk.form };
  if (wk.grid) launch({ ...base, mode: 'season', grid: wk.grid });
  else launch({ ...base, mode: 'quali', field: wk.field });
}

function launch({ mode, trackId, laps, difficulty, team, seat, grid = null, form = null, field = null, challenge = null }) {
  audio.unlockAudio();
  setMusic(null); // the music fades out as the cars line up
  audio.duckEngines(1, 0.1);
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
    wear: save.settings.wear !== false,
    grid,
    form,
    field,
    challenge,
  });
  if (PHONE) {
    state.race.particles.max = phoneParticles();
    state.race.particles.sprites = true;
    state.race.tiled = true;
  }
  // What's being raced, for the title card, HUD, pause and results.
  const season = mode === 'season' || mode === 'quali' ? currentSeason() : null;
  state.race.event = {
    gp: track.def.gp,
    name: track.def.name,
    country: track.def.country,
    accent: track.def.theme.thumb,
    mode,
    laps,
    round: season ? season.round + 1 : null,
    rounds: ROUNDS,
    challenge: state.race.challenge ? { name: state.race.challenge.name, time: state.race.challenge.time } : null,
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
    const q = state.race.quali;
    const lap = q
      ? `qualifying, ${q.stage === 'out' ? 'out-lap' : 'flying lap'}`
      : ev.mode === 'trial'
        ? `lap ${Math.max(1, p.lap + 1)}`
        : `lap ${Math.min(Math.max(1, p.lap + 1), ev.laps)} of ${ev.laps}`;
    // (and how many frames a second the game was drawing, to check phones)
    const ch = state.race.challenge;
    const vs = ch ? ` · vs ${ch.name} ${formatTime(ch.time)}${state.race.challengeBest != null ? `: your best ${formatGap(state.race.challengeBest - ch.time)}` : ''}` : '';
    ui.setPauseInfo(`${ev.round ? `Round ${ev.round} of ${ev.rounds} · ` : ''}${ev.gp}${ev.gp.startsWith(ev.name) ? '' : ` · ${ev.name}`} · ${lap}${vs}${fps.now ? ` · ${fps.now} fps (screen ${Math.round(1 / screenGap)} Hz)` : ''}`);
  }
  ui.pauseSend(state.mode === 'trial' ? state.trackId : null);
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
  setMusic('intro'); // (already playing after a finish: it just carries on)
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
      case 'overtake':
        audio.sfxChime([740, 988, 1319], 0.05, 'square', 0.05);
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
        finishMusic();
        audio.sfxChime(e.pos === 1 ? [523, 659, 784, 1047, 1319] : e.pos <= 3 ? [523, 659, 784, 1047] : [523, 659, 784], 0.12);
        break;
      case 'results':
        if (r.quali) showQuali(r);
        else showResults(r);
        break;
      case 'qualiField': {
        // The other drivers' laps: kept, so a restart replays the same session.
        const wk = save.weekend;
        if (wk && !wk.field) {
          wk.field = r.quali.results;
          save.write();
        }
        break;
      }
      case 'qualiDone': {
        finishMusic();
        const wk = save.weekend;
        if (wk) {
          const res = r.qualiResults();
          wk.grid = res.grid;
          wk.pos = res.playerPos;
          wk.time = res.playerTime;
          save.write();
        }
        syncChrome();
        audio.sfxChime(e.pos === 1 ? [523, 659, 784, 1047, 1319] : e.pos <= 3 ? [523, 659, 784, 1047] : [523, 659, 784], 0.12);
        break;
      }
      case 'pitIn':
      case 'boxCall':
        audio.sfxBeep(740, 0.09, 'square', 0.07);
        setTimeout(() => audio.sfxBeep(740, 0.09, 'square', 0.07), 140);
        break;
      case 'gun':
        audio.sfxGun(!e.good);
        break;
      case 'gunMiss':
        audio.sfxBeep(150, 0.16, 'sawtooth', 0.08);
        break;
      case 'pitGreen':
        audio.sfxBeep(1040, 0.2, 'square', 0.09);
        break;
      case 'pitGo':
        if (e.great) audio.sfxChime([660, 880, 1100], 0.07);
        break;
      case 'beat':
        audio.sfxChime([523, 659, 784, 1047, 1319], 0.12);
        break;
    }
  }
  r.out.length = 0;
  if (r.recordDirty) {
    save.write();
    r.recordDirty = false;
  }
}

// Over the line: straight into the big part of the theme, and the cars
// carry on quietly underneath.
function finishMusic() {
  setMusic('B');
  audio.duckEngines(0.25, 1.5);
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
  if (r.fromGrid && p.gridPos) {
    const gained = p.gridPos - res.playerPos;
    chips.push({ kind: gained > 0 ? 'green' : 'wear', text: `Started P${p.gridPos}${gained ? ` · ${gained > 0 ? 'gained' : 'lost'} ${Math.abs(gained)} place${Math.abs(gained) > 1 ? 's' : ''}` : ''}` });
  }
  if (res.playerPenalty) chips.push({ kind: 'red', text: `No pit stop: +${res.playerPenalty}s` });
  if (res.playerStops.length) {
    // Each stop, with any time it spent held for traffic or waiting for a front wing.
    const stops = res.playerStops.map((t, i) => {
      const w = res.playerStopWaits[i];
      const why = [];
      if (w && w.traffic >= 0.2) why.push(`${w.traffic.toFixed(1)}s held for traffic`);
      if (w && w.wing >= 0.2) why.push(`${w.wing.toFixed(1)}s for a new front wing`);
      return `${t.toFixed(1)}s${why.length ? ` (${why.join(', ')})` : ''}`;
    });
    const field = res.fieldStop != null ? ` · field average ${res.fieldStop.toFixed(1)}s` : '';
    chips.push({ kind: 'wear', text: `Pit stop${stops.length > 1 ? 's' : ''}: ${stops.join(', ')}${field}` });
  }
  if (p.wears) chips.push({ kind: 'wear', text: `Tyres ${Math.round(p.tyres * 100)}% · Car ${Math.round((1 - p.damage) * 100)}%` });
  let season = null;
  const s = currentSeason();
  if (state.mode === 'season' && s && !isComplete(s)) {
    const order = res.rows.map((row) => row.driver);
    const before = s.results.length ? playerStanding(s) : null; // no position before round 1
    recordRound(s, order);
    save.weekend = null; // on to the next round
    save.write();
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

// After qualifying: the classification, then on to the race.
function showQuali(r) {
  state.resultsShown = true;
  const res = r.results;
  const chips = [];
  const p = r.player;
  const rec = save.record(r.track.id);
  if (rec.bestLap != null && p.bestLap != null && Math.abs(rec.bestLap - p.bestLap) < 1e-6) {
    chips.push({ kind: 'purple', text: `Circuit record: ${formatTime(rec.bestLap)}` });
  }
  const mate = res.rows.findIndex((row) => !row.isPlayer && row.team === p.teamId);
  if (mate >= 0) chips.push({ kind: res.playerPos < mate + 1 ? 'green' : 'wear', text: `${res.playerPos < mate + 1 ? 'Ahead of' : 'Behind'} your teammate (P${mate + 1})` });
  ui.showQuali(res, { trackName: r.track.name, event: r.event, chips });
  syncChrome();
}

// ---------- loop ----------

let last = performance.now();
let owed = 0; // time not yet played out (screen frames skipped on a phone)
let screenGap = 1 / 60; // the screen's frame interval, measured as we go
let skipped = 0;
const fps = { frames: 0, time: 0, now: 0 }; // frames drawn per second (shown when paused)

// Every how many screen frames a frame is drawn: on a phone at most 60 a
// second while racing and about 30 behind the menus, results and pause
// screen (every one on a computer). Counting screen frames keeps the drawn
// ones evenly spaced.
function frameEvery() {
  if (!PHONE) return 1;
  const racing = state.race && !state.paused && !state.resultsShown;
  return Math.max(1, Math.round(1 / (racing ? 60 : 30) / screenGap));
}

function frame(now) {
  const gap = (now - last) / 1000;
  last = now;
  if (gap > 0.002 && gap < 0.1) screenGap += (gap - screenGap) * 0.05;
  owed += gap;
  if (++skipped >= frameEvery()) {
    skipped = 0;
    tick(Math.min(0.05, owed));
    owed = 0;
    fps.frames++;
  }
  musicTick();
  fps.time += gap;
  if (fps.time >= 1) {
    fps.now = Math.round(fps.frames / fps.time);
    fps.frames = 0;
    fps.time = 0;
  }
  requestAnimationFrame(frame);
}

function tick(dt, forcedInput) {
  const r = state.race;
  const input = forcedInput || readInput(save.settings.autoGas);
  // Paused: the picture doesn't change, so it's drawn once.
  if (r && state.paused) {
    if (!drawnStill) render(dt, input);
    drawnStill = true;
    return;
  }
  drawnStill = false;
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
  // Phones draw each car from a picture (car.js), a little sharper than the
  // closest the camera comes.
  if (PHONE) setCarSprites(DPR * cam.baseZoom(W, H) * 1.25);
  r.draw(ctx, cam, W, H, DPR);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (canvas.width && canvas.height) ctx.drawImage(shadeFor(r.track.theme.tint), 0, 0); // (0 × 0 while the page has no size yet)
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); // the HUD is drawn in points

  if (racing && !state.resultsShown) {
    drawHUD(ctx, r, cam, W, H, insets, {
      touchUI: crossedLine() ? isTouchDevice() : touchVisible(),
      ctl: controlRects(),
      season: state.mode === 'season' || state.mode === 'quali',
      dt,
    });
  }
  updateEngineSound(r, input);
}

// The circuit's colour tint and the dark vignette round the edges: drawn
// once into a canvas of their own (again when the size or circuit changes),
// then laid over every frame in one go.
function shadeFor(tint) {
  const key = `${tint}|${canvas.width}x${canvas.height}`;
  if (shade.key === key) return shade.canvas;
  shade.key = key;
  const c = shade.canvas;
  c.width = canvas.width;
  c.height = canvas.height;
  const g = c.getContext('2d');
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.clearRect(0, 0, W, H);
  g.fillStyle = tint;
  g.fillRect(0, 0, W, H);
  const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.38)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);
  return c;
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
    boost: p.boost > 0 || p.overtake > 0,
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
setMusicEnabled(save.settings.music !== false);
setMusic('intro'); // behind the menus, from the first tap (browsers wait for one)
applySide();

if (document.fonts && document.fonts.load) {
  ['900 20px "Saira Condensed"', '700 16px "JetBrains Mono"', '700 16px "Titillium Web"'].forEach((f) =>
    document.fonts.load(f).catch(() => {})
  );
}

// Handle for poking at the game from the browser console while testing.
window.lightsOut = { state, startRace, save, getTrack, tick, resume, touchSnapshot, BUILD, versionMatches, music: musicState };

startAttract();
ui.show('title');
if (!save.settings.team) ui.openTeam(); // first visit: pick a team
syncChrome();

// Opened from a challenge link: take the lap out of the address (so a reload
// doesn't open it again) and show it.
if (codeFrom(location.hash)) {
  const link = location.hash;
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch (e) {
    /* can't change the address here: no harm */
  }
  openChallenge(link, true);
}
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
