// Pit stops. One stop is required in every race (with tyres and damage on).
// A car turns into the pit lane at the entry before the line; from there it
// drives itself: down to the speed limit, into its team's box, and out again
// once the crew is done, back onto the track after the exit. While you're
// in the box you play the stop: four wheel guns in rhythm (tap as the
// marker crosses the green) and the release (go when the light turns
// green). The race clock keeps running, so the stop takes as long as you
// take: a clean one is quick, mistakes cost time. A stop puts on fresh tyres
// and repairs the car; a damaged car also needs a new front wing, which
// takes longer the worse the damage.

import { TEAMS } from './data/teams.js';
import { clamp, rand, wrapAngle } from './util.js';

// Driving in the pit lane (px/s, px/s²): the speed limit, how hard cars
// brake down to it and into the box, how quickly they pull away (`out`:
// after the limit line), the closest two cars follow each other, and how
// long (px) the swing into and out of a box is.
export const PIT_DRIVE = { limit: 230, brake: 950, stop: 520, pull: 420, out: 560, gap: 62, swing: 60 };

// The rule. A stop counts once `after` of a lap is done and with more than
// `before` of a lap still to go; finishing without one adds `penalty` s.
export const PIT_RULE = { penalty: 20, after: 0.5, before: 0.6 };

// The stop you play, in rhythm; the race keeps running, so the time it
// takes is your stop time. For each wheel the marker crosses the bar once,
// in `sweep` s, and the green zone is always in the same place (`zone`,
// share of the bar from the left), so the wheels come on a steady beat:
// tap on the green and the wheel's on in `good` s and the next one starts;
// just outside it (`ok` more either side) takes `slow` s; tap anywhere else,
// or not at all, and the gun jams: `jam` s while the crew sorts it. Waiting
// never helps: the marker crosses once. The car goes up on the jacks in
// `jackUp` s and down in `jackDown` s; the release light turns green `hold`
// s later (and only with the lane clear), going on red holds you `early` s
// more, and the car goes by itself `autoGo` s after green. A front wing
// change (damage over `wingFrom`) takes `wing` + `wingPer` × damage s,
// alongside the wheels.
export const PIT_GAME = {
  sweep: 0.55,
  zone: 0.7,
  green: 0.2,
  ok: 0.1,
  good: 0.05,
  slow: 0.35,
  jam: 0.9,
  jackUp: 0.1,
  jackDown: 0.15,
  hold: [0.15, 0.4],
  early: 0.5,
  wingFrom: 0.05,
  wing: 0.9,
  wingPer: 3.5,
  autoGo: 2.5,
};

// Computer stops by difficulty: time standing in the box (s), and now and
// then a slow one. Yours, measured with `node tools/sim-stops.mjs`: four
// greens 2.4–3.0 s, a sharp player about 3.1 s, a good one on a phone 3.6 s,
// a typical one 3.9 s, a casual one 4.4 s. So on normal a good stop of
// yours matches the computer crews, a sharp one gains, a messy one loses
// (hard: a sharp one matches; easy: a casual one). Your stop (not counting
// time held for traffic or waiting for a front wing) shows GREAT STOP when
// it beats the middle of the range, SLOW STOP when it's over the top by
// `slowOver` s.
export const AI_STOP = { easy: [3.9, 4.9], normal: [3.0, 4.0], hard: [2.7, 3.5], slowChance: 0.06, slow: [1.5, 3.5], slowOver: 0.3 };

// Garage colours and names, in box order (the same as the team list).
export const PIT_TEAMS = TEAMS.map((t) => ({ id: t.id, color: t.livery.color, color2: t.livery.color2, short: t.code }));

export const WHEELS = ['FRONT LEFT', 'FRONT RIGHT', 'REAR LEFT', 'REAR RIGHT'];

const smooth = (u) => {
  const v = clamp(u, 0, 1);
  return v * v * (3 - 2 * v);
};

export class Pits {
  constructor(race, { auto = false } = {}) {
    this.race = race;
    this.track = race.track;
    this.auto = auto; // the player's stops are played by the computer (headless tests)
    this.game = null; // the stop you're playing
    this.prevPedal = false;
    this.tmp = {};
    const t = this.track;
    this.gate = t.pit.start * t.ds; // where the entry is, along the lap (px, negative before the line)
    for (const c of race.cars) {
      c.box = Math.max(0, TEAMS.findIndex((tm) => tm.id === c.teamId));
      c.stops = 0;
      c.stopTimes = [];
      c.laneTimes = []; // entry to exit, s
      c.pit = null;
      c.gateM = null;
    }
    // Which visits to the entry count (m: 0 for the first time round).
    this.chances = [];
    const laps = Number.isFinite(race.totalLaps) ? race.totalLaps : 0; // none outside a race
    for (let m = 0; m <= laps + 1; m++) if (this.allowed(m)) this.chances.push(m);
    // Computer cars pick when they'll come in: around halfway, give or take.
    const c = this.chances.length;
    for (const car of race.cars) {
      const k = c <= 1 ? 0 : clamp(Math.round((c - 1) / 2 + rand(-0.65, 0.65)), 0, c - 1);
      car.pitPlan = c ? this.chances[k] : null;
    }
  }

  allowed(m) {
    const L = this.track.length;
    const at = m * L + this.gate;
    return at > PIT_RULE.after * L && this.race.totalLaps * L - at > PIT_RULE.before * L;
  }

  // Which visit to the entry the car is on or coming up to.
  visit(car) {
    return Math.round((car.progress - this.gate) / this.track.length);
  }

  // The last visit that counts: after it, no more stops.
  get lastChance() {
    return this.chances.length ? this.chances[this.chances.length - 1] : null;
  }

  // Does this car still owe its stop?
  due(car) {
    return car.stops === 0;
  }

  // Before the cars move: computer cars that are coming in move over to the
  // pit side of the road for the entry.
  beforeStep() {
    const t = this.track;
    const L = t.length;
    for (const [car, ai] of this.race.ai) {
      ai.toPit = 0;
      if (car.pit || car.finished || car === this.race.player) continue;
      const m = this.visit(car);
      const to = m * L + this.gate - car.progress;
      if (to > -10 && to < 900 && this.wants(car, m)) ai.toPit = t.pit.side;
    }
  }

  // Would a computer car (or the player's car in a headless test) come in on visit m?
  wants(car, m) {
    if (!this.allowed(m)) return false;
    if (car.stops === 0) return m === car.pitPlan || car.damage > 0.35 || (this.lastChance != null && m >= this.lastChance);
    return car.damage > 0.5;
  }

  // After the cars move: anyone turning in at the entry goes into the pit lane.
  check(car) {
    if (car.pit || car.finished || this.race.phase !== 'race') return;
    const t = this.track;
    const p = t.pit;
    const k = t.signedK(car.trackIdx);
    const inWindow = k >= p.start - 6 && k <= p.start + Math.round(p.rampN * 0.6);
    if (!inWindow) {
      if (car.gateM != null && car === this.race.player) this.missed(car);
      car.gateM = null;
      return;
    }
    const m = this.visit(car);
    if (car.gateM == null) car.gateM = m;
    if (!this.allowed(m)) return;
    const robot = car !== this.race.player || this.auto;
    let go;
    if (robot) go = this.wants(car, m) && k >= p.start;
    else {
      const lat = this.latOf(car);
      go = lat > Math.max(t.half - 18, t.pitLane(k) - 26) && car.forwardSpeed > 20;
    }
    if (go) this.enter(car, k);
  }

  // You drove past the entry on your last chance without stopping.
  missed(car) {
    const m = car.gateM;
    if (this.due(car) && m === this.lastChance && !car.missedMsg) {
      car.missedMsg = true;
      this.race.msg(`NO PIT STOP · +${PIT_RULE.penalty}s`, '#ff5a4f', 2.4, 0.9);
    }
  }

  // How far the car is toward the pit side of the road (the lane's ends
  // follow the road itself, see Track.pitPoint).
  latOf(car) {
    return this.track.pitSideOffset(car.x, car.y, car.trackIdx);
  }

  enter(car, k) {
    const t = this.track;
    const lat = this.latOf(car);
    car.pit = { stage: 'in', k, lat, err: lat - t.pitLane(k), v: clamp(car.forwardSpeed, 60, 900), t: 0, swung: 0, braking: false, at: this.race.time };
    car.drifting = false;
    car.driftTier = 0;
    car.driftCharge = 0;
    car.slipstream = 0;
    car.boost = 0;
    car.gateM = null;
    if (car === this.race.player) {
      this.race.msg('BOX, BOX', '#ffd23f', 1.4, 0.9);
      this.race.out.push({ t: 'pitIn' });
    }
  }

  boxBusy(car) {
    const t = this.track;
    const boxK = t.pit.boxes[car.box];
    const sw = PIT_DRIVE.swing / t.ds;
    for (const o of this.race.cars) {
      if (o === car || !o.pit || o.box !== car.box) continue;
      const s = o.pit;
      if (s.stage === 'box') return true;
      if (s.stage === 'out' && s.k < boxK + sw) return true;
      if (s.stage === 'in' && s.k > car.pit.k) return true;
    }
    return false;
  }

  inLane(car) {
    const s = car.pit;
    return s.stage !== 'box' && s.lat < this.track.pit.laneO + 30;
  }

  // Safe to pull out of the box at boxK: nobody coming down the lane right there.
  laneClear(car) {
    const t = this.track;
    const boxK = t.pit.boxes[car.box];
    const a = boxK - 110 / t.ds;
    const b = boxK + 20 / t.ds;
    for (const o of this.race.cars) {
      if (o === car || !o.pit || !this.inLane(o)) continue;
      if (o.pit.k > a && o.pit.k < b) return false;
    }
    return true;
  }

  // Top speed allowed by the car ahead in the lane.
  laneRoom(car) {
    if (!this.inLane(car)) return Infinity;
    const ds = this.track.ds;
    let room = Infinity;
    for (const o of this.race.cars) {
      if (o === car || !o.pit || !this.inLane(o) || o.pit.k <= car.pit.k) continue;
      const gap = (o.pit.k - car.pit.k) * ds - PIT_DRIVE.gap;
      room = Math.min(room, gap <= 0 ? 0 : o.pit.v + Math.sqrt(2 * PIT_DRIVE.stop * gap));
    }
    return room;
  }

  // One physics step for a car in the pit lane.
  drive(car, h, tap = false) {
    const t = this.track;
    const p = t.pit;
    const D = PIT_DRIVE;
    const s = car.pit;
    const ds = t.ds;
    const boxK = p.boxes[car.box];
    const sw = D.swing / ds;
    car.pitPrev = car.trackIdx; // so the race still sees the car cross the line
    s.t += h;
    let vmax = Infinity;
    let stopK = boxK;
    if (s.stage === 'in') {
      if (s.k < p.limitIn) vmax = Math.sqrt(D.limit * D.limit + 2 * D.brake * Math.max(0, (p.limitIn - s.k) * ds));
      else vmax = D.limit;
      if (this.boxBusy(car)) stopK = boxK - 54 / ds;
      const dist = (stopK - s.k) * ds;
      vmax = Math.min(vmax, Math.sqrt(2 * D.stop * Math.max(0, dist)));
      if (dist < 0.6 && s.v < 10) {
        s.v = 0;
        if (stopK === boxK) this.arrive(car);
      }
    } else if (s.stage === 'box') {
      vmax = 0;
      this.service(car, h, tap);
    } else if (s.k < p.limitOut) vmax = D.limit;
    else {
      // Out of the exit no faster than the road ahead allows.
      const n = t.n;
      for (let j = 0; j <= 60; j += 3) vmax = Math.min(vmax, t.vProfile[(((Math.round(s.k) + j) % n) + n) % n] * 0.85);
    }
    vmax = Math.min(vmax, this.laneRoom(car));
    s.braking = s.v > vmax + 1;
    if (s.v > vmax) s.v = Math.max(vmax, s.v - D.brake * 1.6 * h);
    else s.v = Math.min(vmax, s.v + (s.stage === 'out' && s.k > p.limitOut ? D.out : D.pull) * h);
    if (s.stage !== 'box') s.k += (s.v * h) / ds;

    // Sideways: along the lane, swinging into and out of the box.
    let target = t.pitLane(s.k);
    if (s.stage === 'in') {
      s.swung = Math.max(s.swung, smooth((s.k - (stopK - sw)) / sw));
      target += (p.boxO - target) * s.swung;
    } else if (s.stage === 'box') target = p.boxO;
    else target = p.boxO + (target - p.boxO) * smooth((s.k - boxK) / sw);
    s.err *= Math.exp(-6 * h);
    s.lat = target + s.err;

    const q = t.pitPoint(s.k, s.lat, this.tmp);
    const dx = q.x - car.x;
    const dy = q.y - car.y;
    if (dx * dx + dy * dy > 0.01) car.angle += wrapAngle(Math.atan2(dy, dx) - car.angle) * (1 - Math.exp(-16 * h));
    car.vx = dx / h;
    car.vy = dy / h;
    car.x = q.x;
    car.y = q.y;
    car.trackIdx = q.idx;
    car.steer *= Math.exp(-6 * h);
    car.gas = s.braking || s.stage === 'box' ? 0 : 1;
    car.brake = s.braking ? 1 : 0;
    car.slide = 0;
    car.offTrack = false;
    car.onKerb = false;
    if (s.k >= p.end) this.leave(car);
  }

  arrive(car) {
    const s = car.pit;
    s.stage = 'box';
    s.t = 0;
    s.wingNeed = car.damage > PIT_GAME.wingFrom ? PIT_GAME.wing + PIT_GAME.wingPer * car.damage : 0;
    s.wing = 0;
    s.done = [false, false, false, false]; // which wheels the crew has done (for drawing)
    if (car === this.race.player && !this.auto) {
      this.game = newGame(s.wingNeed);
      this.race.out.push({ t: 'pitStop' });
    } else {
      const D = this.race.difficulty;
      const [a, b] = AI_STOP[D] || AI_STOP.normal;
      let stand = rand(a, b);
      if (Math.random() < AI_STOP.slowChance) stand += rand(...AI_STOP.slow);
      s.service = Math.max(stand, s.wingNeed + 0.8);
    }
  }

  // Standing in the box.
  service(car, h, tap) {
    const s = car.pit;
    if (s.wingNeed) s.wing = Math.min(s.wingNeed, s.wing + h);
    if (car === this.race.player && this.game) {
      const g = this.game;
      updateGame(g, h, tap, s, this.laneClear(car), this.race.out);
      s.done = g.done;
      if (g.phase === 'go') {
        s.traffic = g.traffic;
        s.wingWait = g.wingWait;
        this.release(car, g.t);
      }
      return;
    }
    // Computer crews: the wheels come off one after another.
    const f = s.t / s.service;
    for (let w = 0; w < 4; w++) s.done[w] = f > 0.25 + w * 0.12;
    if (s.t >= s.service && this.laneClear(car)) this.release(car, s.t);
  }

  release(car, standing) {
    const s = car.pit;
    s.stage = 'out';
    s.err = 0;
    car.tyres = 1;
    car.damage = 0;
    car.hitT = 0;
    car.stops++;
    car.stopTimes.push(standing);
    car.missedMsg = false;
    if (car === this.race.player) {
      this.game = null;
      // Judged on your part of it: not the time held for traffic or spent
      // waiting for a new front wing (both are shown, and both count).
      const traffic = s.traffic || 0;
      const wing = s.wingWait || 0;
      car.stopWaits = car.stopWaits || [];
      car.stopWaits.push({ traffic, wing });
      const own = standing - traffic - wing;
      const [lo, hi] = AI_STOP[this.race.difficulty] || AI_STOP.normal;
      const great = own < (lo + hi) / 2;
      const slow = own > hi + AI_STOP.slowOver;
      this.race.msg(`${great ? 'GREAT STOP' : slow ? 'SLOW STOP' : 'PIT STOP'}  ${standing.toFixed(1)}s`, great ? '#31d67b' : slow ? '#ffd23f' : '#ffffff', 2.2, 0.85);
      if (traffic >= 0.2) this.race.msg(`${traffic.toFixed(1)}s HELD FOR TRAFFIC`, '#8d97ab', 2.2, 0.6);
      if (wing >= 0.2) this.race.msg(`NEW FRONT WING +${wing.toFixed(1)}s`, '#ff8a2f', 2.2, 0.6);
      this.race.out.push({ t: 'pitGo', great });
    }
  }

  // Back on the track at the end of the exit: the car's own physics take over.
  leave(car) {
    const s = car.pit;
    const v = s.v;
    car.laneTimes.push(this.race.time - s.at);
    car.pit = null;
    car.vx = Math.cos(car.angle) * v;
    car.vy = Math.sin(car.angle) * v;
    car.yawKick = 0;
    car.steer = 0;
    car.brakeLock = false;
    car.launchPenalty = 0;
    car.q = {};
    const ai = this.race.ai.get(car);
    if (ai) {
      const t = this.track;
      const i = car.trackIdx;
      const lat = (car.x - t.px[i]) * t.nx[i] + (car.y - t.py[i]) * t.ny[i];
      ai.offset = ai.offsetTarget = lat - t.roff[i];
      ai.stuck = 0;
      ai.reverseT = 0;
      ai.toPit = 0;
    }
  }

  // For the HUD: the pit entry is coming up and you still owe your stop.
  hint() {
    const r = this.race;
    const p = r.player;
    if (!p || p.pit || p.finished || r.phase !== 'race' || !this.due(p)) return null;
    const m = this.visit(p);
    if (!this.allowed(m)) return null;
    const to = m * this.track.length + this.gate - p.progress;
    const v = Math.max(200, p.forwardSpeed);
    if (to < -40 || to / v > 3.6) return null;
    return { side: this.track.pit.side, last: m === this.lastChance, to };
  }

  // For the HUD: this lap is your last chance to stop.
  lastLap() {
    const p = this.race.player;
    if (!p || p.pit || !this.due(p) || this.lastChance == null) return false;
    const to = this.lastChance * this.track.length + this.gate - p.progress;
    return to > -40 && to < this.track.length;
  }
}

// ---------- the stop you play ----------

function newGame(wingNeed) {
  const g = {
    phase: 'jackUp',
    t: 0, // time standing in the box
    pt: 0, // time in this phase / on this wheel
    wheel: 0,
    m: 0, // marker, 0..1 across the bar
    zone: 0.6,
    gun: 0,
    lock: 0,
    done: [false, false, false, false],
    hits: [],
    misses: 0,
    traffic: 0, // s the release light stayed red for cars coming down the lane
    wingWait: 0, // s the car stayed up waiting for the front wing
    wingShow: 0, // how far the front wing bar is filled (0..1)
    waiting: false, // held for traffic right now
    flash: null, // { text, color, t }
    green: false,
    greenAt: 0,
    hold: 0,
    wingNeed,
  };
  return g;
}

function nextWheel(g) {
  g.pt = 0;
  g.m = 0;
  g.zone = PIT_GAME.zone;
  g.lock = 0; // 1 while a jammed gun is being sorted (the marker shows red)
}

// One physics step of the stop you play (the race keeps running).
function updateGame(g, h, tap, s, laneClear, out) {
  const G = PIT_GAME;
  g.t += h;
  g.pt += h;
  if (g.flash) {
    g.flash.t += h;
    if (g.flash.t > 0.6) g.flash = null;
  }
  g.wingShow = s.wingNeed ? Math.min(1, s.wing / s.wingNeed) : 1;
  if (g.phase === 'jackUp') {
    if (g.pt >= G.jackUp) {
      g.phase = 'wheels';
      nextWheel(g);
    }
    return;
  }
  if (g.phase === 'wheels') {
    if (g.gun > 0) {
      g.gun -= h;
      if (g.gun <= 0) {
        g.done[g.wheel] = true;
        g.wheel++;
        if (g.wheel >= 4) {
          g.phase = 'jackDown';
          g.pt = 0;
        } else nextWheel(g);
      }
      return;
    }
    // One pass of the marker per wheel, on the beat.
    g.m = Math.min(1, g.m + h / G.sweep);
    const fit = (kind) => {
      g.hits.push(kind);
      g.gun = kind === 'good' ? G.good : G.slow;
      out.push({ t: 'gun', good: kind === 'good' });
      g.flash = { text: kind === 'good' ? 'PERFECT' : 'OK', color: kind === 'good' ? '#31d67b' : '#ffd23f', t: 0 };
    };
    const jam = (why) => {
      g.hits.push('jam');
      g.misses++;
      g.gun = G.jam;
      g.lock = 1;
      out.push({ t: 'gunMiss' });
      g.flash = { text: why, color: '#ff5a4f', t: 0 };
    };
    if (tap && g.m > 0.08) {
      // (a tap right as the marker sets off is a double tap from the last wheel: ignored)
      const d = Math.abs(g.m - g.zone);
      if (d <= G.green / 2) fit('good');
      else if (d <= G.green / 2 + G.ok) fit('slow');
      else jam('MISSED');
    } else if (g.m >= 1) jam('TOO LATE');
    return;
  }
  if (g.phase === 'jackDown') {
    if (g.pt >= G.jackDown && s.wing >= s.wingNeed) {
      g.phase = 'light';
      g.pt = 0;
      g.hold = rand(...G.hold);
    } else if (g.pt >= G.jackDown) g.wingWait += h;
    return;
  }
  if (g.phase === 'light') {
    g.waiting = false;
    if (!g.green && g.pt >= g.hold) {
      if (laneClear) {
        g.green = true;
        g.greenAt = g.t;
        out.push({ t: 'pitGreen' });
      } else {
        g.waiting = true; // a car coming down the lane
        g.traffic += h;
      }
    }
    if (tap) {
      if (g.green) g.phase = 'go';
      else {
        g.hold = Math.max(g.hold, g.pt + G.early);
        g.flash = { text: 'WAIT FOR GREEN', color: '#ff5a4f', t: 0 };
        out.push({ t: 'gunMiss' });
      }
    } else if (g.green && g.t - g.greenAt > G.autoGo) g.phase = 'go';
  }
}
