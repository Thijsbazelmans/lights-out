// One session on one circuit: a race against the field, a solo time trial
// against your own ghost, or the "attract" race that plays behind the menus.

import { Car, PHYS, TIER_COLORS } from './car.js';
import { AIDriver } from './ai.js';
import { Particles, Skids } from './particles.js';
import { clamp, damp, formatTime, rand, wrapAngle } from './util.js';

const STEP = 1 / 120; // physics runs at a fixed 120 Hz
const SPLITS = 40; // timing points per lap (gaps and live delta)
const GHOST_DT = 0.05;
const LIGHT_GAP = 0.8;

export const DIFFICULTY = {
  easy: { power: 0.88, pace: 0.86 },
  normal: { power: 0.95, pace: 0.93 },
  hard: { power: 0.995, pace: 1.0 },
};

const GHOST_LIVERY = { color: '#cfe8ff', color2: '#6fb7ff', helmet: '#ffffff' };

export class Race {
  constructor({ track, mode, laps = 3, difficulty = 'normal', player = null, rivals = [], record = null }) {
    this.track = track;
    this.mode = mode; // 'race' | 'trial' | 'attract'
    this.totalLaps = mode === 'race' ? laps : Infinity;
    this.difficulty = difficulty;
    this.record = record;
    this.time = 0; // race clock: starts at lights out
    this.phase = 'intro'; // intro -> lights -> race -> finished
    this.phaseT = 0;
    this.introDur = mode === 'attract' ? 0.1 : mode === 'trial' ? 1.3 : 1.6;
    this.lit = 0;
    this.holdT = rand(0.5, 1.8);
    this.particles = new Particles();
    this.skids = new Skids();
    this.events = [];
    this.messages = [];
    this.out = []; // notices for main.js: sounds, results ready, etc.
    this.cars = [];
    this.order = [];
    this.ai = new Map();
    this.acc = 0;
    this.fastest = null;
    this.splitFirst = new Map();
    this.finishCount = 0;
    this.finishT = 0;
    this.results = null;
    this.shake = 0;
    this.delta = null;
    this.ghost = mode === 'trial' && record && record.ghost ? record.ghost : null;
    this.ghostFrames = [];
    this.ghostT = 0;
    this.ghostCar = new Car({ x: 0, y: 0, angle: 0, livery: GHOST_LIVERY, name: 'Ghost', code: 'GST' });
    this.awaitLaunch = false;
    this.lastPos = 0;
    this.posMsgT = 0;
    this.recordDirty = false;
    this.setupGrid(player, rivals);
    this.focus = this.player || this.cars[0];
    this.rank();
  }

  setupGrid(player, rivals) {
    const t = this.track;
    const D = DIFFICULTY[this.difficulty] || DIFFICULTY.normal;
    if (this.mode === 'trial') {
      const back = Math.round(240 / t.ds);
      const i = t.n - back;
      const car = new Car({
        x: t.px[i],
        y: t.py[i],
        angle: Math.atan2(t.ty[i], t.tx[i]),
        name: player.name,
        code: player.code,
        livery: player.livery,
        isPlayer: true,
      });
      car.trackIdx = i;
      car.basePower = 1;
      this.cars.push(car);
      this.player = car;
      return;
    }
    const field = rivals.slice().sort((a, b) => b.skill - a.skill);
    const total = field.length + (player ? 1 : 0);
    const playerSlot = player ? Math.min(total - 1, Math.floor(total * 0.6)) : -1; // start in the midfield
    let r = 0;
    this.player = null;
    for (let k = 0; k < total; k++) {
      const s = t.gridSlot(k);
      if (k === playerSlot) {
        const car = new Car({ x: s.x, y: s.y, angle: s.angle, name: player.name, code: player.code, livery: player.livery, isPlayer: true });
        car.trackIdx = s.idx;
        car.basePower = 1;
        this.cars.push(car);
        this.player = car;
      } else {
        const d = field[r++];
        const skillN = clamp((d.skill - 0.94) / 0.06, 0, 1);
        const attract = this.mode === 'attract';
        const power = attract ? 0.92 + 0.05 * skillN : D.power * (0.975 + 0.035 * skillN);
        const pace = attract ? 0.9 + 0.04 * skillN : D.pace * (0.97 + 0.05 * skillN);
        const car = new Car({ x: s.x, y: s.y, angle: s.angle, name: d.name, code: d.code, livery: d.livery, power });
        car.trackIdx = s.idx;
        car.basePower = power;
        this.cars.push(car);
        this.ai.set(car, new AIDriver(car, t, { pace }));
      }
    }
  }

  msg(text, color = '#fff', dur = 1.4, scale = 1) {
    this.messages.push({ text, color, dur, scale, t: 0 });
    if (this.messages.length > 3) this.messages.shift();
  }

  update(dt, input) {
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 10) {
      this.step(STEP, input);
      this.acc -= STEP;
      steps++;
    }
    if (steps >= 10) this.acc = 0;
    this.particles.update(dt);
    for (const m of this.messages) m.t += dt;
    this.messages = this.messages.filter((m) => m.t < m.dur);
  }

  step(h, input) {
    this.phaseT += h;
    if (this.phase === 'intro' && this.phaseT >= this.introDur) {
      if (this.mode === 'race') {
        this.phase = 'lights';
        this.phaseT = 0;
      } else this.go(input);
    }
    if (this.phase === 'lights') {
      const lit = clamp(Math.floor((this.phaseT - 0.4) / LIGHT_GAP) + 1, 0, 5);
      if (lit !== this.lit) {
        this.lit = lit;
        this.out.push({ t: 'light', n: lit });
      }
      if (this.phaseT >= 0.4 + 4 * LIGHT_GAP + this.holdT) this.go(input);
    }
    const racing = this.phase === 'race' || this.phase === 'finished';
    if (racing) this.time += h;

    // Reaction time off the line.
    const p = this.player;
    if (this.awaitLaunch && (this.time > 1.5 || (p && this.ai.has(p)))) this.awaitLaunch = false;
    if (this.awaitLaunch && p && input.gas > 0.5) {
      this.awaitLaunch = false;
      const rt = this.time;
      if (rt < 0.3) {
        p.startBoost(2, this.events, 'launch');
        this.msg(`PERFECT START  ${rt.toFixed(3)}s`, '#31d67b', 1.8);
      } else if (rt < 0.5) {
        p.startBoost(1, this.events, 'launch');
        this.msg(`GOOD START  ${rt.toFixed(3)}s`, '#ffffff', 1.6);
      } else {
        this.msg(`REACTION  ${rt.toFixed(3)}s`, '#8d97ab', 1.4);
      }
    }

    for (const car of this.cars) {
      const ai = this.ai.get(car);
      let ctl = input;
      if (ai) {
        const rub = this.rubberFor(car);
        car.power = car.basePower * (1 + (rub - 1) * 0.6);
        ctl = ai.control(h, this.cars, rub, racing ? this.time : -1);
        if (car.launchBoostAt != null && racing && this.time >= car.launchBoostAt) {
          car.startBoost(1, this.events, 'launch');
          car.launchBoostAt = null;
        }
      }
      car.update(h, ctl, this.track, this.events);
    }
    this.collide();
    this.slip(h);
    for (const car of this.cars) this.progress(car);
    this.rank();
    this.effects(h);
    this.recordGhost(h);
    this.handleEvents();

    if (this.phase === 'finished') {
      this.finishT += h;
      if (this.finishT > 3.2 && !this.results) {
        this.results = this.buildResults();
        this.out.push({ t: 'results' });
      }
    }
  }

  go(input) {
    this.phase = 'race';
    this.phaseT = 0;
    this.lit = 0;
    this.time = 0;
    for (const c of this.cars) {
      c.frozen = false;
      c.lapStart = 0;
    }
    if (this.mode === 'race') {
      this.out.push({ t: 'lightsOut' });
      this.msg('LIGHTS OUT!', '#ffffff', 1.1, 1.25);
      const p = this.player;
      if (p) {
        if (input.gas > 0.5) {
          p.launchPenalty = 0.9;
          this.msg('TOO EARLY: WHEELSPIN', '#ffd23f', 1.6);
        } else this.awaitLaunch = true;
      }
      for (const [car, ai] of this.ai) if (ai.reaction < 0.25) car.launchBoostAt = ai.reaction;
    } else if (this.mode === 'trial') {
      this.msg('GO!', '#ffffff', 1, 1.25);
    }
  }

  rubberFor(car) {
    const p = this.player;
    if (this.mode !== 'race' || !p || p.finished || car.finished) return car.finished ? 0.8 : 1;
    const d = car.progress - p.progress; // > 0: this rival is ahead of the player
    if (d > 500) return Math.max(0.94, 1 - (d - 500) / 8000);
    if (d < -400) return Math.min(1.06, 1 + (-d - 400) / 6000);
    return 1;
  }

  collide() {
    const cs = this.cars;
    const R = PHYS.R;
    const RR = 4 * R * R;
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i];
      const afx = Math.cos(a.angle);
      const afy = Math.sin(a.angle);
      for (let j = i + 1; j < cs.length; j++) {
        const b = cs[j];
        const dx0 = b.x - a.x;
        const dy0 = b.y - a.y;
        if (dx0 * dx0 + dy0 * dy0 > 3600) continue;
        const bfx = Math.cos(b.angle);
        const bfy = Math.sin(b.angle);
        for (let sa = -11; sa <= 11; sa += 22) {
          for (let sb = -11; sb <= 11; sb += 22) {
            const ax = a.x + afx * sa;
            const ay = a.y + afy * sa;
            const bx = b.x + bfx * sb;
            const by = b.y + bfy * sb;
            const dx = bx - ax;
            const dy = by - ay;
            const d2 = dx * dx + dy * dy;
            if (d2 >= RR || d2 < 1e-6) continue;
            const d = Math.sqrt(d2);
            const nx = dx / d;
            const ny = dy / d;
            const ov = 2 * R - d;
            a.x -= (nx * ov) / 2;
            a.y -= (ny * ov) / 2;
            b.x += (nx * ov) / 2;
            b.y += (ny * ov) / 2;
            const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rv < 0) {
              const jm = (-(1 + 0.3) * rv) / 2;
              a.vx -= jm * nx;
              a.vy -= jm * ny;
              b.vx += jm * nx;
              b.vy += jm * ny;
              // A hit off-centre spins the car a little.
              const ta = afx * sa * (-jm * ny) - afy * sa * (-jm * nx);
              const tb = bfx * sb * (jm * ny) - bfy * sb * (jm * nx);
              a.yawKick = clamp(a.yawKick + ta * 0.0035, -4, 4);
              b.yawKick = clamp(b.yawKick + tb * 0.0035, -4, 4);
              if (-rv > 60) this.events.push({ t: 'bump', a, b, x: (ax + bx) / 2, y: (ay + by) / 2, power: -rv });
            }
          }
        }
      }
    }
  }

  slip(h) {
    for (const a of this.cars) {
      let best = 0;
      const fx = Math.cos(a.angle);
      const fy = Math.sin(a.angle);
      if (a.forwardSpeed > 250) {
        for (const b of this.cars) {
          if (b === a || b.forwardSpeed < 250) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy);
          if (d < 36 || d > 290) continue;
          if ((dx * fx + dy * fy) / d < 0.965) continue;
          best = Math.max(best, 1 - (d - 36) / 254);
        }
      }
      a.slipstream = damp(a.slipstream, best, best > a.slipstream ? 2.2 : 3.5, h);
    }
  }

  progress(car) {
    const t = this.track;
    const n = t.n;
    const prev = car.trackIdx;
    let idx = t.localIndex(car.x, car.y, prev);
    if (t.lastLocalD2 > (t.wallDist * 1.6) ** 2) {
      const q = t.query(car.x, car.y, car.q);
      if (q.dist !== Infinity) idx = q.idx;
    }
    car.trackIdx = idx;
    if (prev > n * 0.8 && idx < n * 0.2) this.crossForward(car);
    else if (prev < n * 0.2 && idx > n * 0.8 && car.lap >= 0) {
      car.lap -= 1;
      car.reversedOver = true;
    }
    if (idx > n * 0.35 && idx < n * 0.65) car.lapArmed = true;
    car.progress = car.lap * t.length + idx * t.ds;

    if (car === this.player && this.phase === 'race') {
      const facing = Math.cos(car.angle) * t.tx[idx] + Math.sin(car.angle) * t.ty[idx];
      const moving = car.vx * t.tx[idx] + car.vy * t.ty[idx];
      this.wrongWayT = facing < -0.3 && moving < -40 ? (this.wrongWayT || 0) + STEP : 0;
    }

    const bucket = Math.floor((idx * SPLITS) / n);
    if (bucket !== car.bucket) {
      const forward = car.bucket != null && (bucket - car.bucket + SPLITS) % SPLITS === 1;
      car.bucket = bucket;
      if (forward && (this.phase === 'race' || this.phase === 'finished')) {
        const key = car.lap * SPLITS + bucket;
        if (!this.splitFirst.has(key)) this.splitFirst.set(key, this.time);
        car.splitKey = key;
        car.splitTime = this.time;
        if (car.lap >= 0) {
          if (!car.curSplits) car.curSplits = [];
          car.curSplits[bucket] = this.time - car.lapStart;
          if (car === this.player && this.mode === 'trial' && bucket > 0 && this.record && this.record.splits) {
            const ref = this.record.splits[bucket];
            if (ref != null) this.delta = this.time - car.lapStart - ref;
          }
        }
      }
    }
  }

  crossForward(car) {
    if (car.reversedOver) {
      car.reversedOver = false;
      car.lap += 1;
      return;
    }
    if (car.lap >= 0 && !car.lapArmed) return;
    if (this.phase !== 'race' && this.phase !== 'finished') return;
    const now = this.time;
    if (car.lap >= 0) {
      const lt = now - car.lapStart;
      car.laps.push(lt);
      car.lastLap = lt;
      const pb = car.bestLap == null || lt < car.bestLap;
      if (pb) car.bestLap = lt;
      const fastest = !this.fastest || lt < this.fastest.time;
      if (fastest) this.fastest = { time: lt, car };
      this.onLap(car, lt, pb, fastest);
    }
    car.lap += 1;
    car.lapArmed = false;
    if (!(this.mode === 'race' && car.lap === 0)) car.lapStart = now;
    car.curSplits = [];
    if (car === this.player) {
      this.ghostFrames = [];
      this.ghostT = 0;
      this.delta = null;
    }
    if (this.mode === 'race' && car.lap >= this.totalLaps && !car.finished) this.finish(car);
    else if (car === this.player && this.mode === 'race' && this.totalLaps > 1 && car.lap === this.totalLaps - 1) {
      this.msg('FINAL LAP', '#ffffff', 1.6, 1.1);
    }
  }

  onLap(car, lt, pb, fastest) {
    if (car !== this.player) {
      if (fastest && this.mode === 'race' && car.lap >= 1) this.msg(`${car.code} FASTEST LAP ${formatTime(lt)}`, '#b65cff', 1.6, 0.7);
      return;
    }
    const flying = this.mode === 'trial' || car.lap >= 1;
    const rec = this.record;
    let label = `LAP ${formatTime(lt)}`;
    let color = '#ffffff';
    let isRecord = false;
    if (flying && rec && (rec.bestLap == null || lt < rec.bestLap)) {
      isRecord = rec.bestLap != null;
      rec.bestLap = lt;
      if (this.ghostFrames.length > 30) {
        rec.ghost = { dt: GHOST_DT, frames: this.ghostFrames.slice() };
        rec.splits = (car.curSplits || []).slice();
      }
      this.recordDirty = true;
      if (this.mode === 'trial') this.ghost = rec.ghost;
      label = `${isRecord ? 'NEW RECORD' : 'LAP RECORD SET'}  ${formatTime(lt)}`;
      color = '#b65cff';
    } else if (fastest && this.mode === 'race') {
      label = `FASTEST LAP  ${formatTime(lt)}`;
      color = '#b65cff';
    } else if (pb && car.laps.length > 1) {
      label = `PERSONAL BEST  ${formatTime(lt)}`;
      color = '#31d67b';
    }
    this.msg(label, color, 2.2);
    this.out.push({ t: 'lap', record: color === '#b65cff' });
  }

  finish(car) {
    car.finished = true;
    car.finishTime = this.time;
    car.finishPos = ++this.finishCount;
    const ai = this.ai.get(car);
    if (ai) ai.pace *= 0.8;
    if (car === this.player) {
      this.phase = 'finished';
      this.finishT = 0;
      this.ai.set(car, new AIDriver(car, this.track, { pace: 0.72 }));
      car.basePower = 0.85;
      const pos = car.finishPos;
      this.msg(pos === 1 ? 'WINNER!' : `P${pos}`, pos === 1 ? '#ffd23f' : '#ffffff', 3.2, 1.7);
      this.out.push({ t: 'finish', pos });
    }
  }

  rank() {
    const sorted = this.cars.slice().sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished) return a.finishPos - b.finishPos;
      return b.progress - a.progress;
    });
    for (let i = 0; i < sorted.length; i++) sorted[i].pos = i + 1;
    this.order = sorted;
    const p = this.player;
    if (p && this.mode === 'race' && this.phase === 'race') {
      this.posMsgT -= STEP;
      if (this.lastPos && p.pos !== this.lastPos && this.posMsgT <= 0 && this.time > 1.5) {
        const up = p.pos < this.lastPos;
        this.msg(`P${p.pos} ${up ? '▲' : '▼'}`, up ? '#31d67b' : '#ff5a4f', 0.9, 0.8);
        this.posMsgT = 0.5;
      }
      this.lastPos = p.pos;
    }
  }

  // Gap to the leader, measured at the last timing point this car passed.
  gapToLeader(car) {
    if (car.finished && this.order[0].finished) return car.finishTime - this.order[0].finishTime;
    if (car.splitKey == null) return null;
    const t0 = this.splitFirst.get(car.splitKey);
    return t0 == null ? null : car.splitTime - t0;
  }

  effects(h) {
    const f = this.focus;
    for (const c of this.cars) {
      c.fxT += h;
      if (c.fxT < 1 / 45) continue;
      c.fxT = 0;
      if (f && Math.abs(c.x - f.x) + Math.abs(c.y - f.y) > 1800) {
        c.skidOn = false;
        continue;
      }
      const sp = c.speed;
      const fx = Math.cos(c.angle);
      const fy = Math.sin(c.angle);
      const rx = -fy;
      const ry = fx;
      const wx1 = c.x - fx * 15 - rx * 8.5;
      const wy1 = c.y - fy * 15 - ry * 8.5;
      const wx2 = c.x - fx * 15 + rx * 8.5;
      const wy2 = c.y - fy * 15 + ry * 8.5;
      const hardBrake = c.brake > 0.5 && c.forwardSpeed > 300;
      const spinning = c.launchPenalty > 0 || (c.frozen && c.gas > 0.5);
      const skidding = !c.offTrack && (c.slide > 75 || c.drifting || hardBrake || spinning);
      if (skidding) {
        if (!c.skidPrev) c.skidPrev = new Float32Array(4);
        const s = c.skidPrev;
        if (c.skidOn) {
          this.skids.add(s[0], s[1], wx1, wy1);
          this.skids.add(s[2], s[3], wx2, wy2);
        }
        s[0] = wx1;
        s[1] = wy1;
        s[2] = wx2;
        s[3] = wy2;
        c.skidOn = true;
      } else c.skidOn = false;

      if (c.drifting || c.slide > 120 || spinning) {
        for (const [x, y] of [
          [wx1, wy1],
          [wx2, wy2],
        ]) {
          this.particles.spawn({
            kind: 'smoke',
            x: x + rand(-3, 3),
            y: y + rand(-3, 3),
            vx: c.vx * 0.25 + rand(-30, 30),
            vy: c.vy * 0.25 + rand(-30, 30),
            life: rand(0.5, 0.95),
            size: rand(5, 8),
            grow: 28,
            drag: 2.4,
            rgb: [228, 228, 232],
            alpha: 0.32,
          });
        }
      }
      if (c.offTrack && sp > 90) {
        this.particles.spawn({
          kind: 'dust',
          x: c.x - fx * 18 + rand(-6, 6),
          y: c.y - fy * 18 + rand(-6, 6),
          vx: c.vx * 0.2 + rand(-40, 40),
          vy: c.vy * 0.2 + rand(-40, 40),
          life: rand(0.5, 0.8),
          size: rand(6, 9),
          grow: 34,
          drag: 2,
          rgb: this.track.theme.dust,
          alpha: 0.45,
        });
      }
      if (c.drifting && c.driftTier > 0) {
        const col = TIER_COLORS[c.driftTier];
        for (const [x, y] of [
          [wx1, wy1],
          [wx2, wy2],
        ]) {
          this.particles.spawn({
            kind: 'spark',
            x,
            y,
            vx: -c.vx * 0.15 + rand(-140, 140),
            vy: -c.vy * 0.15 + rand(-140, 140),
            life: rand(0.18, 0.32),
            size: 2.2,
            drag: 3,
            color: col,
          });
        }
      }
      if (c.boost > 0) {
        this.particles.spawn({
          kind: 'flame',
          x: c.x - fx * 25,
          y: c.y - fy * 25,
          vx: -fx * 160 + c.vx * 0.5 + rand(-20, 20),
          vy: -fy * 160 + c.vy * 0.5 + rand(-20, 20),
          life: rand(0.15, 0.3),
          size: rand(4, 7),
          drag: 4,
          color: TIER_COLORS[c.boostLevel] || TIER_COLORS[2],
        });
      }
      if (c === f && c.onKerb && sp > 200) this.shake += 0.25;
    }
  }

  recordGhost(h) {
    const p = this.player;
    if (!p || p.lap < 0 || p.finished || this.phase !== 'race') return;
    this.ghostT += h;
    while (this.ghostT >= GHOST_DT) {
      this.ghostT -= GHOST_DT;
      this.ghostFrames.push(Math.round(p.x), Math.round(p.y), Math.round(p.angle * 100) / 100);
    }
  }

  ghostPose() {
    const g = this.ghost;
    const p = this.player;
    if (!g || !p || p.lap < 0) return null;
    const t = this.time - p.lapStart;
    const F = g.frames;
    const n = F.length / 3;
    const f = t / g.dt - 1;
    if (f < 0 || f >= n - 1) return null;
    const i = Math.floor(f);
    const u = f - i;
    const k = i * 3;
    return {
      x: F[k] + (F[k + 3] - F[k]) * u,
      y: F[k + 1] + (F[k + 4] - F[k + 1]) * u,
      angle: F[k + 2] + wrapAngle(F[k + 5] - F[k + 2]) * u,
    };
  }

  handleEvents() {
    const f = this.focus;
    const falloff = (x, y) => (f ? clamp(1 - Math.hypot(x - f.x, y - f.y) / 900, 0, 1) : 0);
    for (const e of this.events) {
      if (e.t === 'wall' || e.t === 'bump') {
        const n = Math.min(18, 6 + Math.floor(e.power / 45));
        for (let k = 0; k < n; k++) {
          const a = Math.random() * Math.PI * 2;
          const s = rand(80, 260) * (0.6 + e.power / 600);
          this.particles.spawn({
            kind: 'spark',
            x: e.x,
            y: e.y,
            vx: Math.cos(a) * s,
            vy: Math.sin(a) * s,
            life: rand(0.2, 0.45),
            size: 2,
            drag: 3.5,
            color: Math.random() < 0.5 ? '#ffd27a' : '#ff9a3d',
          });
        }
        const v = clamp(e.power / 650, 0, 1) * falloff(e.x, e.y);
        if (v > 0.02) this.out.push({ t: 'impact', v });
        const mine = e.t === 'wall' ? e.car === f : e.a === f || e.b === f;
        if (mine) this.shake += e.power / (e.t === 'wall' ? 55 : 75);
      } else if (e.t === 'boost' && e.car === this.player) {
        this.out.push({ t: 'boost', tier: e.tier });
        if (e.why === 'drift') this.msg(['', 'BOOST', 'SUPER BOOST', 'ULTRA BOOST'][e.tier], TIER_COLORS[e.tier], 0.9, 0.95);
      } else if (e.t === 'driftTier' && e.car === this.player) {
        this.out.push({ t: 'tier', tier: e.tier });
      }
    }
    this.events.length = 0;
  }

  buildResults() {
    const total = this.totalLaps * this.track.length;
    const rows = [];
    let prev = 0;
    for (const c of this.order) {
      let time = c.finished ? c.finishTime : null;
      if (time == null) {
        const avg = c.progress > 0 && this.time > 0 ? c.progress / this.time : 400;
        time = this.time + Math.max(0, total - c.progress) / Math.max(200, avg);
        time = Math.max(time, prev + 0.15);
      }
      prev = time;
      rows.push({ name: c.name, code: c.code, livery: c.livery, isPlayer: c.isPlayer, time, best: c.bestLap, finished: c.finished });
    }
    const p = this.player;
    return {
      rows,
      fastest: this.fastest ? { time: this.fastest.time, code: this.fastest.car.code, isPlayer: this.fastest.car.isPlayer } : null,
      playerPos: p ? p.finishPos || p.pos : null,
      playerTime: p ? p.finishTime : null,
      playerBest: p ? p.bestLap : null,
      laps: this.totalLaps,
    };
  }

  draw(ctx, cam, w, h, dpr) {
    const view = cam.viewRect(w, h);
    cam.apply(ctx, dpr);
    const t = this.track;
    t.drawGround(ctx, view);
    t.drawSurface(ctx, view, this.hints !== false);
    this.skids.draw(ctx, view);
    t.drawDecor(ctx, view);
    const gp = this.ghostPose();
    if (gp) {
      const g = this.ghostCar;
      g.x = gp.x;
      g.y = gp.y;
      g.angle = gp.angle;
      g.draw(ctx, 0.4);
    }
    const m = 60;
    for (const c of this.cars) {
      if (c === this.player) continue;
      if (c.x < view.minX - m || c.x > view.maxX + m || c.y < view.minY - m || c.y > view.maxY + m) continue;
      c.draw(ctx);
    }
    if (this.player) this.player.draw(ctx);
    this.particles.draw(ctx, view);
    if (this.mode === 'race') t.drawGantry(ctx, this.phase === 'lights' ? this.lit : 0);
  }
}
