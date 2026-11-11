// Qualifying: the first session of a season weekend. You leave your garage,
// drive an out-lap to get up to speed, then one flying lap; its time sets
// your place on the grid. The other 21 drivers do the same lap, simulated
// out of sight with the race's own car and driver code (alone on the road,
// at their race pace for the weekend), and their times come up on the
// timing board one by one while you're on your out-lap.

import { Car } from './car.js';
import { AIDriver } from './ai.js';
import { rand } from './util.js';

// Timing points per lap (gaps, the live delta, the provisional position).
export const SPLITS = 40;
// Ghost laps: a position every this many seconds (yours and, in
// qualifying, the pole lap you're chasing).
export const GHOST_DT = 0.05;

// `push`: how much harder than their race pace the computer drivers go on
// their qualifying lap, per difficulty: [corner pace, engine power], like
// the cars chasing you when you lead a race (they can't drift, and you can).
// Corner pace stops at `paceTop` (beyond that they overshoot corners). Each
// computer lap comes out a
// little better or worse (`scatter`, a share of pace), and now and then
// scrappy (chance `scrappy`, losing `scrappyCost` of pace). They start
// `runUp` of a lap before the line, standing, so they're up to speed when
// the lap starts. Their times show up spread over the first `reveal` of a
// lap from `revealFrom` s into the session. The simulation runs in the
// background, `budget` steps a frame (at most `budgetMs` ms); a car without
// a lap after `timeout` s gets no time. You leave the garage `release` s
// after the green light.
export const QUALI = {
  push: { easy: [1.06, 1.04], normal: [1.01, 1.02], hard: [1.0, 1.02] },
  paceTop: 0.97,
  scatter: 0.004,
  scrappy: 0.08,
  scrappyCost: [0.008, 0.025],
  runUp: 0.3,
  reveal: 0.6,
  revealFrom: 3,
  budget: 500,
  budgetMs: 2,
  timeout: 240,
  release: 0.35,
};

const H = 1 / 120; // the race's physics step

// The computer drivers' qualifying laps. entries: { driverId, code, name,
// teamId, livery, pace, power }.
export class QualiSim {
  constructor(track, entries, difficulty = 'normal') {
    this.track = track;
    this.push = QUALI.push[difficulty] || QUALI.push.normal;
    this.events = [];
    this.runs = entries.map((e) => this.start(e));
    this.done = !this.runs.length;
  }

  start(e) {
    const t = this.track;
    const i = (t.n - Math.round((QUALI.runUp * t.length) / t.ds) + t.n) % t.n;
    const lat = t.roff[i];
    const car = new Car({
      x: t.px[i] + t.nx[i] * lat,
      y: t.py[i] + t.ny[i] * lat,
      angle: Math.atan2(t.ty[i], t.tx[i]),
      livery: e.livery,
      name: e.name,
      code: e.code,
      power: e.power * this.push[1],
    });
    car.frozen = false;
    car.trackIdx = i;
    let pace = Math.min(QUALI.paceTop, e.pace * this.push[0]) * (1 + rand(-QUALI.scatter, QUALI.scatter));
    if (Math.random() < QUALI.scrappy) pace *= 1 - rand(...QUALI.scrappyCost);
    const ai = new AIDriver(car, t, { pace });
    return { e, car, ai, cars: [car], T: 0, start: null, armed: false, bucket: null, splits: [], time: null, over: false, frames: [], gT: 0 };
  }

  // Up to `steps` physics steps (and about `ms` ms), one car after another.
  run(steps = QUALI.budget, ms = QUALI.budgetMs) {
    const t0 = performance.now();
    let left = steps;
    for (const r of this.runs) {
      while (!r.over && left > 0) {
        this.step(r);
        left--;
        if ((left & 63) === 0 && performance.now() - t0 > ms) left = 0;
      }
      if (left <= 0) break;
    }
    this.done = this.runs.every((r) => r.over);
  }

  // Everything that's left, now.
  finish() {
    while (!this.done) this.run(1e9, 1e9);
  }

  step(r) {
    const t = this.track;
    const n = t.n;
    const c = r.car;
    r.T += H;
    c.update(H, r.ai.control(H, r.cars, 1, 99), t, this.events);
    this.events.length = 0;
    const prev = c.trackIdx;
    let idx = t.localIndex(c.x, c.y, prev);
    if (t.lastLocalD2 > (t.wallDist * 1.6) ** 2) {
      const q = t.query(c.x, c.y, c.q);
      if (q.dist !== Infinity) idx = q.idx;
    }
    c.trackIdx = idx;
    if (idx > n * 0.35 && idx < n * 0.65) r.armed = true;
    if (prev > n * 0.8 && idx < n * 0.2) {
      if (r.start == null) {
        r.start = r.T;
        r.armed = false;
      } else if (r.armed) {
        r.time = r.T - r.start;
        r.over = true;
        return;
      }
    }
    // Its path round the lap, for the pole ghost (as the race records yours).
    if (r.start != null) {
      r.gT += H;
      while (r.gT >= GHOST_DT) {
        r.gT -= GHOST_DT;
        r.frames.push(Math.round(c.x), Math.round(c.y), Math.round(c.angle * 100) / 100);
      }
    }
    // Time into the lap at each timing point, as the race measures yours.
    const b = Math.floor((idx * SPLITS) / n);
    if (b !== r.bucket) {
      if (r.start != null && r.bucket != null && (b - r.bucket + SPLITS) % SPLITS === 1) r.splits[b] = Math.round((r.T - r.start) * 1000) / 1000;
      r.bucket = b;
    }
    if (r.T > QUALI.timeout) r.over = true;
  }

  // Everyone's lap; the fastest one keeps its path, as the pole ghost.
  results() {
    const timed = this.runs.filter((r) => r.time != null);
    const best = timed.length ? timed.reduce((a, b) => (b.time < a.time ? b : a)) : null;
    return this.runs.map((r) => ({
      driverId: r.e.driverId,
      code: r.e.code,
      name: r.e.name,
      teamId: r.e.teamId,
      livery: r.e.livery,
      time: r.time == null ? null : Math.round(r.time * 1000) / 1000,
      splits: r.splits,
      ghost: r === best ? { dt: GHOST_DT, frames: r.frames } : null,
    }));
  }
}

// Fastest first; no time at the back.
export function byLapTime(a, b) {
  return (a.time ?? Infinity) - (b.time ?? Infinity);
}
