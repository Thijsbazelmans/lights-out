// One session on one circuit: a race against the field, a solo time trial
// against your own ghost, or the "attract" race that plays behind the menus.

import { Car, PHYS, TIER_COLORS, WEAR } from './car.js';
import { AIDriver } from './ai.js';
import { Pits, PIT_RULE, PIT_TEAMS } from './pit.js';
import { Particles, Skids } from './particles.js';
import { clamp, damp, formatTime, rand, wrapAngle } from './util.js';

const STEP = 1 / 120; // physics runs at a fixed 120 Hz
const SPLITS = 40; // timing points per lap (gaps and live delta)
const GHOST_DT = 0.05;
const LIGHT_GAP = 0.8;

// Slipstream: you're in a car's tow up to `range` px behind it, within a
// narrow cone, strongest right on its gearbox (see PHYS.SLIP_TOP / SLIP_ACC).
// Only on a straight: both cars above `minSpeed` × top speed, pointing the
// same way, and the road ahead bending less than 1 / `straight` px. It takes
// a moment to build (`build`, per second) and goes quickly (`fade`).
export const SLIPSTREAM = { range: 380, cone: 0.955, minSpeed: 0.73, straight: 1100, build: 1.3, fade: 5 };

// A car hit from behind: its share of the push (the rest goes to the car
// doing the hitting) and how much of the twist it gets.
const REAR_END = { front: 0.15, twist: 0.25 };

// A corner call shows up this many seconds before you need to slow down.
const CALL_WARN = 1.4;

// AI speed per difficulty. `top` is the corner pace of the fastest cars (a
// share of the racing line's own speeds) and `spread` how much slower the
// slowest are; `power` is top-end engine power. On lap 1 everyone runs near
// the middle of that range (a proper first-lap scramble); during lap 1 each
// car moves to its own race pace, so the field strings out into smaller
// groups and one-on-one battles.
export const DIFFICULTY = {
  easy: { top: 0.82, spread: 0.13, power: 0.95, powerSpread: 0.07, chase: 0.08 },
  normal: { top: 0.88, spread: 0.13, power: 1.0, powerSpread: 0.07, chase: 0.12 },
  hard: { top: 0.915, spread: 0.12, power: 1.02, powerSpread: 0.06, chase: 0.15 },
};

const GHOST_LIVERY = { color: '#cfe8ff', color2: '#6fb7ff', helmet: '#ffffff' };

export class Race {
  constructor({ track, mode, laps = 3, difficulty = 'normal', player = null, rivals = [], record = null, wear = true, autoPit = false }) {
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
    this.playerSplits = new Map(); // when you passed each timing point
    this.finishCount = 0;
    this.finishReal = 0;
    this.skipFinish = false;
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
    // Tyres and damage count in races (not time trials, so lap records compare),
    // and with them the one pit stop everyone has to make.
    if (mode === 'race' && wear) {
      for (const c of this.cars) {
        c.wears = true;
        c.wearLap = WEAR.race / Math.max(1, laps);
      }
    }
    track.pitTeams = PIT_TEAMS;
    this.pits = mode === 'race' && wear && track.pit ? new Pits(this, { auto: autoPit }) : null;
    this.prevPedal = false;
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
    const playerSlot = player ? Math.min(total - 1, Math.floor(total * 0.55)) : -1; // start in the midfield
    let r = 0;
    this.player = null;
    for (let k = 0; k < total; k++) {
      const s = t.gridSlot(k);
      if (k === playerSlot) {
        const car = new Car({ x: s.x, y: s.y, angle: s.angle, name: player.name, code: player.code, livery: player.livery, isPlayer: true });
        car.teamId = player.teamId || (player.team ? player.team.id : null);
        car.driverId = player.id || 'you';
        car.trackIdx = s.idx;
        car.basePower = 1;
        this.cars.push(car);
        this.player = car;
      } else {
        const d = field[r++];
        const skillN = clamp((d.skill - 0.94) / 0.068, 0, 1);
        const attract = this.mode === 'attract';
        // Race pace: team and driver, plus a little form on the day.
        const q = clamp(skillN + rand(-0.1, 0.1), 0, 1);
        const pace = attract ? 0.9 + 0.04 * skillN : D.top - D.spread * (1 - q);
        const power = attract ? 0.92 + 0.05 * skillN : D.power - D.powerSpread * (1 - q);
        // Lap 1: halfway between the field average and the car's own pace.
        const startPace = attract ? pace : (D.top - D.spread * 0.5 + pace) / 2;
        const startPower = attract ? power : (D.power - D.powerSpread * 0.5 + power) / 2;
        const car = new Car({ x: s.x, y: s.y, angle: s.angle, name: d.name, code: d.code, livery: d.livery, power: startPower });
        car.teamId = d.teamId || d.id;
        car.driverId = d.driverId || d.id;
        car.trackIdx = s.idx;
        car.basePower = startPower;
        Object.assign(car, { racePace: pace, racePower: power, startPace, startPower });
        this.cars.push(car);
        this.ai.set(car, new AIDriver(car, t, { pace: startPace }));
      }
    }
  }

  msg(text, color = '#fff', dur = 1.4, scale = 1) {
    this.messages.push({ text, color, dur, scale, t: 0 });
    if (this.messages.length > 3) this.messages.shift();
  }

  update(dt, input) {
    // After you cross the line: slow motion for a moment, then back to normal
    // speed, and the results after a few seconds (or on a tap).
    let scaled = dt;
    if (this.phase === 'finished') {
      this.finishReal += dt;
      scaled = dt * (0.3 + 0.7 * clamp((this.finishReal - 0.9) / 1.2, 0, 1));
      if (!this.results && (this.finishReal > 4.2 || (this.skipFinish && this.finishReal > 0.6))) {
        this.results = this.buildResults();
        this.out.push({ t: 'results' });
      }
    }
    this.acc += scaled;
    let steps = 0;
    while (this.acc >= STEP && steps < 10) {
      this.step(STEP, input);
      this.acc -= STEP;
      steps++;
    }
    if (steps >= 10) this.acc = 0;
    this.particles.update(scaled);
    this.updateBeside(dt);
    this.updateCall(dt);
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

    // A press of either pedal (for the pit stop you play).
    const pedal = !!input.pedal;
    const tap = pedal && !this.prevPedal;
    this.prevPedal = pedal;
    if (this.pits) this.pits.beforeStep();

    for (const car of this.cars) {
      if (car.pit) {
        this.pits.drive(car, h, car === this.player && tap);
        continue;
      }
      const ai = this.ai.get(car);
      let ctl = input;
      if (ai) {
        if (car.racePace != null && !car.finished && car !== this.player) {
          // Bunched off the line, own race pace from about mid-lap 1, plus a
          // slow rhythm of better and worse spells that breaks up trains.
          const k = clamp(car.progress / (this.track.length * 0.55), 0, 1);
          car.rhythm ??= rand(0, Math.PI * 2);
          const swing = 1 + 0.025 * k * Math.sin(this.time * 0.3 + car.rhythm);
          ai.pace = (car.startPace + (car.racePace - car.startPace) * k) * swing;
          car.basePower = car.startPower + (car.racePower - car.startPower) * k;
        }
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
    if (this.pits) {
      for (const car of this.cars) this.pits.check(car);
      this.pitNotes();
    }
    this.rank();
    this.effects(h);
    this.recordGhost(h);
    this.handleEvents();

  }

  // Your pit reminder: on the last lap you can still stop on, BOX THIS LAP.
  pitNotes() {
    const p = this.player;
    const pits = this.pits;
    if (!p || p.finished || this.boxMsg || !pits.lastLap() || this.time < 3) return;
    const to = pits.lastChance * this.track.length + pits.gate - p.progress;
    if (to < this.track.length * 0.6) {
      this.boxMsg = true;
      this.msg('BOX THIS LAP', '#ffd23f', 2.4, 1);
      this.out.push({ t: 'boxCall' });
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

  // A light touch, not a magnet: nothing on lap 1; a runaway leader far up
  // the road eases off a little so a late comeback stays possible; and when
  // you lead, the cars close behind you push a bit harder.
  rubberFor(car) {
    const p = this.player;
    if (car.finished) return 0.8;
    if (this.mode !== 'race' || !p || p.finished || p.lap < 1 || p.pit) return 1;
    const L = this.track.length;
    const d = car.progress - p.progress; // > 0: this rival is ahead of you
    if (d > 0.2 * L) return Math.max(0.96, 1 - ((d - 0.2 * L) / L) * 0.12);
    // You're at the front: the next few cars chase, harder the further you
    // get away, so a lead has to be kept rather than just built once.
    if (d < 0 && p.pos <= 3 && car.pos <= p.pos + 3 && d > -0.45 * L) {
      const chase = (DIFFICULTY[this.difficulty] || DIFFICULTY.normal).chase;
      // The car right behind pushes hardest; less so when you're not leading.
      const lead = ([1, 0.75, 0.5][car.pos - p.pos - 1] ?? 0.5) * (p.pos === 1 ? 1 : 0.4);
      return 1 + Math.min(chase, 0.03 + (-d / L) * 1.0) * lead;
    }
    return 1;
  }

  // Corner calls: a heads-up for the next corner you need to lift or brake
  // for ("HARD LEFT", "CHICANE"), timed from your actual speed, so it comes
  // sooner when you're quicker. For a braking corner it turns into BRAKE! at
  // the braking point (the red 1 board), with a beep.
  updateCall(dt) {
    const p = this.player;
    const t = this.track;
    let note = this.call;
    if (!p || this.hints === false || this.phase !== 'race' || p.finished || p.frozen || p.pit || !t.calls.length) {
      this.call = null;
      return;
    }
    const n = t.n;
    const TOP = PHYS.TOP;
    const v = Math.max(0, p.forwardSpeed);
    const ahead = (i) => (i - p.trackIdx + n) % n;
    // The next corner whose slowest point we haven't passed yet.
    let c = null;
    for (const k of t.calls) {
      const a = ahead(k.at);
      if (a < n / 2 && (!c || a < ahead(c.at))) c = k;
    }
    if (note && (note.c !== c || ahead(note.c.at) > n / 2)) {
      if (note.stage !== 'done') note.stage = 'done';
    }
    // Each corner is called once (not again after you've slowed for it).
    if (c && c !== this.calledLast && (!note || (note.c !== c && note.stage === 'done' && note.fade < 0.6))) {
      const toStart = ahead(c.start) > ahead(c.at) ? 0 : ahead(c.start) * t.ds;
      const tt = toStart / Math.max(v, 60);
      if (tt < CALL_WARN && v > c.vOut + 0.05 * TOP) {
        note = { c, stage: 'warn', t: 0, fade: 1, tt, warnAt: Math.max(0.6, tt) };
        this.calledLast = c;
      }
    }
    if (note) {
      note.t += dt;
      if (note.c === c && note.stage !== 'done') {
        const toStart = ahead(c.start) > ahead(c.at) ? 0 : ahead(c.start) * t.ds;
        note.tt = toStart / Math.max(v, 60);
        if (note.stage === 'warn' && c.brake && note.tt < 0.12 && v > c.vOut + 0.12 * TOP) {
          note.stage = 'brake';
          this.out.push({ t: 'brakeCue' });
        }
        // Slowed down enough: job done.
        if (v < c.vOut + 0.03 * TOP) note.stage = 'done';
      }
      if (note.stage === 'done') note.fade -= dt / 0.35;
      if (note.fade <= 0) note = null;
    }
    this.call = note;
  }

  // Where another part of the circuit runs right beside yours, fade it down
  // while you're there so your own road stands out.
  updateBeside(dt) {
    const t = this.track;
    const me = this.player || this.focus;
    this.besideFade ??= new Float32Array(t.neighbours.length);
    const on = me ? t.besideRuns(me.trackIdx) : [];
    const f = this.besideFade;
    for (let k = 0; k < f.length; k++) {
      const want = on.includes(k) ? 1 : 0;
      f[k] = clamp(f[k] + (want ? 3 : -3) * dt, 0, 1);
    }
  }

  collide() {
    const cs = this.cars;
    const R = PHYS.R;
    const RR = 4 * R * R;
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i];
      if (a.pit) continue; // in the pit lane, behind the wall
      const afx = Math.cos(a.angle);
      const afy = Math.sin(a.angle);
      for (let j = i + 1; j < cs.length; j++) {
        const b = cs[j];
        if (b.pit) continue;
        const dx0 = b.x - a.x;
        const dy0 = b.y - a.y;
        if (dx0 * dx0 + dy0 * dy0 > 3600) continue;
        if (!this.sameStretch(a, b)) continue; // e.g. one on the bridge, one underneath
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
            // Nose into someone's gearbox: the car behind takes the knock and
            // gives way, so the one in front isn't shoved along or pinned (a
            // front wing hooked on your rear wheel would stop you steering).
            const aRear = sa > 0 && sb < 0 && afx * nx + afy * ny > 0.4; // a runs into b's tail
            const bRear = sb > 0 && sa < 0 && -(bfx * nx + bfy * ny) > 0.4;
            const wa = aRear ? 1 - REAR_END.front : bRear ? REAR_END.front : 0.5; // a's share of the push
            const wb = 1 - wa;
            a.x -= nx * ov * wa;
            a.y -= ny * ov * wa;
            b.x += nx * ov * wb;
            b.y += ny * ov * wb;
            const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rv < 0) {
              // Rubbing, not bouncing: almost no rebound, a little scrub along
              // the contact, and only a small twist.
              const J = -(1 + 0.05) * rv;
              a.vx -= J * wa * nx;
              a.vy -= J * wa * ny;
              b.vx += J * wb * nx;
              b.vy += J * wb * ny;
              const jm = J / 2;
              const tx = -ny;
              const ty = nx;
              const rt = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
              const jt = rt * 0.08;
              a.vx += jt * tx;
              a.vy += jt * ty;
              b.vx -= jt * tx;
              b.vy -= jt * ty;
              const ta = afx * sa * (-jm * ny) - afy * sa * (-jm * nx);
              const tb = bfx * sb * (jm * ny) - bfy * sb * (jm * nx);
              a.yawKick = clamp(a.yawKick + ta * 0.0016 * (bRear ? REAR_END.twist : 1), -2.5, 2.5);
              b.yawKick = clamp(b.yawKick + tb * 0.0016 * (aRear ? REAR_END.twist : 1), -2.5, 2.5);
              // Running into the back of someone costs the one doing the ramming.
              if (-rv > 140) {
                const lose = clamp((-rv - 140) / 900, 0, 0.18);
                const aRams = afx * nx + afy * ny > 0.5; // a's nose points at b
                const bRams = -(bfx * nx + bfy * ny) > 0.5;
                if (aRams) {
                  a.vx *= 1 - lose;
                  a.vy *= 1 - lose;
                }
                if (bRams) {
                  b.vx *= 1 - lose;
                  b.vy *= 1 - lose;
                }
              }
              // A proper knock damages both, the one doing the hitting most.
              if (-rv > WEAR.hitMin) {
                const dmg = (-rv - WEAR.hitMin) * WEAR.hit * WEAR.car;
                a.addDamage(dmg * (aRear ? 1 : bRear ? 0.4 : 0.7), this.events);
                b.addDamage(dmg * (bRear ? 1 : aRear ? 0.4 : 0.7), this.events);
              }
              if (-rv > 60) this.events.push({ t: 'bump', a, b, x: (ax + bx) / 2, y: (ay + by) / 2, power: -rv });
            }
          }
        }
      }
    }
  }

  // Cars far apart along the lap can only be close on screen across a
  // bridge or a barrier; they never touch, draft or block each other.
  sameStretch(a, b) {
    const n = this.track.n;
    const d = Math.abs(a.trackIdx - b.trackIdx);
    return Math.min(d, n - d) < n * 0.15;
  }

  slip(h) {
    const t = this.track;
    const S = SLIPSTREAM;
    const vMin = S.minSpeed * PHYS.TOP;
    for (const a of this.cars) {
      let best = 0;
      const fx = Math.cos(a.angle);
      const fy = Math.sin(a.angle);
      let bend = 0;
      for (let k = 0; k <= 28; k += 4) bend = Math.max(bend, Math.abs(t.rcurv[(a.trackIdx + k) % t.n]));
      if (a.forwardSpeed > vMin && bend < 1 / S.straight && !a.pit) {
        for (const b of this.cars) {
          if (b === a || b.pit || b.forwardSpeed < vMin || !this.sameStretch(a, b)) continue;
          if (Math.cos(b.angle - a.angle) < 0.985) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy);
          if (d < 36 || d > SLIPSTREAM.range) continue;
          if ((dx * fx + dy * fy) / d < SLIPSTREAM.cone) continue;
          best = Math.max(best, Math.pow(1 - (d - 36) / (SLIPSTREAM.range - 36), 0.7));
        }
      }
      a.slipstream = damp(a.slipstream, best, best > a.slipstream ? S.build : S.fade, h);
    }
  }

  progress(car) {
    const t = this.track;
    const n = t.n;
    const prev = car.pitPrev ?? car.trackIdx;
    car.pitPrev = null;
    let idx = car.pit ? car.trackIdx : t.localIndex(car.x, car.y, prev);
    if (!car.pit && t.lastLocalD2 > (t.wallDist * 1.6) ** 2) {
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
        if (car === this.player) this.playerSplits.set(key, this.time);
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
    car.penalty = this.penaltyOf(car);
    const ai = this.ai.get(car);
    if (ai) ai.pace *= 0.8;
    if (car === this.player) {
      this.phase = 'finished';
      this.finishReal = 0;
      this.messages.length = 0; // the finish screen takes over
      this.ai.set(car, new AIDriver(car, this.track, { pace: 0.72 }));
      car.basePower = 0.85;
      // No pit stop: where the time penalty drops you to.
      if (car.penalty) {
        const mine = car.finishTime + car.penalty;
        car.shownPos = 1 + this.cars.filter((c) => c !== car && this.estimateFinish(c) < mine).length;
      }
      this.out.push({ t: 'finish', pos: car.shownPos || car.finishPos });
    } else if (car.finishPos === 1 && this.player && !this.player.finished) {
      // The winner is home: everyone else is on their last lap.
      this.msg(`CHEQUERED FLAG · ${car.name.split(' ').slice(-1)[0].toUpperCase()} WINS`, '#ffffff', 2.6, 0.75);
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

      // Tyre smoke: billowing in a drift or a slide, a light puff from the
      // locked-up front tyres under hard braking.
      if (!c.offTrack && (c.drifting || c.slide > 120 || spinning)) {
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
            life: rand(0.6, 1.1),
            size: rand(6, 9),
            grow: 32,
            drag: 2.4,
            rgb: [230, 230, 234],
            alpha: c.drifting ? 0.42 : 0.32,
          });
        }
      } else if (!c.offTrack && hardBrake) {
        for (const side of [-1, 1]) {
          if (Math.random() < 0.2) continue;
          this.particles.spawn({
            kind: 'smoke',
            x: c.x + fx * 11 + rx * 9 * side + rand(-2, 2),
            y: c.y + fy * 11 + ry * 9 * side + rand(-2, 2),
            vx: c.vx * 0.3 + rand(-20, 20),
            vy: c.vy * 0.3 + rand(-20, 20),
            life: rand(0.45, 0.75),
            size: rand(4, 6.5),
            grow: 26,
            drag: 2.6,
            rgb: [238, 238, 242],
            alpha: 0.38,
          });
        }
      }
      // Off the road: a spray of dust and bits of grass, sand or grit.
      if (c.offTrack && sp > 90) {
        const th = this.track.theme;
        const kick = Math.min(1, sp / 400);
        for (const [x, y] of [
          [wx1, wy1],
          [wx2, wy2],
        ]) {
          this.particles.spawn({
            kind: 'dust',
            x: x + rand(-4, 4),
            y: y + rand(-4, 4),
            vx: c.vx * 0.3 + rx * rand(-90, 90) * kick,
            vy: c.vy * 0.3 + ry * rand(-90, 90) * kick,
            life: rand(0.6, 1.0),
            size: rand(7, 11),
            grow: 40,
            drag: 2,
            rgb: th.dust.map((v) => Math.min(255, v + 45)), // a shade lighter than the ground, so it shows
            alpha: 0.55,
          });
          for (let k = 0; k < 2; k++) {
            const grass = th.runoffKind === 'grass' && Math.random() < 0.6;
            this.particles.spawn({
              kind: 'bit',
              x,
              y,
              vx: c.vx * 0.45 + rx * rand(-160, 160) * kick - fx * rand(20, 90),
              vy: c.vy * 0.45 + ry * rand(-160, 160) * kick - fy * rand(20, 90),
              life: rand(0.25, 0.5),
              size: rand(2, 3.5),
              drag: 3,
              color: grass ? (Math.random() < 0.5 ? th.runoff : th.runoff2) : `rgb(${th.dust.map((v) => Math.round(v * rand(0.6, 0.95))).join(',')})`,
            });
          }
        }
      }
      // A damaged car smokes: a grey wisp, thicker and darker as it gets worse.
      if (c.damage > 0.25 && Math.random() < (c.damage - 0.25) * 1.6) {
        const dark = c.damage > 0.55;
        this.particles.spawn({
          kind: 'smoke',
          x: c.x - fx * 18 + rand(-3, 3),
          y: c.y - fy * 18 + rand(-3, 3),
          vx: c.vx * 0.15 + rand(-15, 15),
          vy: c.vy * 0.15 + rand(-15, 15),
          life: rand(0.6, 1.1),
          size: rand(4, 6),
          grow: 24,
          drag: 1.6,
          rgb: dark ? [58, 58, 64] : [160, 160, 166],
          alpha: dark ? 0.45 : 0.32,
        });
      }
      // Air streaming past you in a tow or a drift.
      if (c === this.player && sp > 260 && (c.slipstream > 0.25 || c.drifting)) {
        const amount = c.drifting ? 0.8 : c.slipstream;
        const vl = Math.hypot(c.vx, c.vy) || 1;
        const dx = -c.vx / vl;
        const dy = -c.vy / vl;
        for (let k = 0; k < 2; k++) {
          if (Math.random() > amount) continue;
          const side = Math.random() < 0.5 ? -1 : 1;
          const lat = side * rand(18, 40);
          const ahead = rand(-10, 60);
          this.particles.spawn({
            kind: 'wind',
            x: c.x + fx * ahead + rx * lat,
            y: c.y + fy * ahead + ry * lat,
            vx: c.vx * 0.35,
            vy: c.vy * 0.35,
            dx,
            dy,
            len: 26 + sp * 0.05,
            life: rand(0.2, 0.32),
            size: 1.6,
            drag: 0,
            alpha: c.drifting ? 0.45 : 0.6,
          });
        }
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
      } else if (e.t === 'driftTier' && e.car === this.player) {
        this.out.push({ t: 'tier', tier: e.tier });
      } else if (e.t === 'damage' && e.car === this.player && e.amount >= 0.05) {
        this.msg(e.amount >= 0.1 ? 'HEAVY DAMAGE' : 'DAMAGE', '#ff4f3a', 1.1, 0.85);
      } else if (e.t === 'driftEnd' && e.car === this.player && e.clean && e.tier > 0) {
        this.msg(['', 'NICE DRIFT', 'GREAT DRIFT', 'MEGA DRIFT'][e.tier], TIER_COLORS[e.tier], 0.8, 0.8);
      }
    }
    this.events.length = 0;
  }

  // Seconds added to a car's race time: no pit stop when one was required.
  penaltyOf(car) {
    return this.pits && car.stops === 0 ? PIT_RULE.penalty : 0;
  }

  // A car's race time, penalty included. For a car still running once
  // you've finished: your time plus its gap to you at the last timing point
  // it passed; otherwise a guess from its average speed so far.
  estimateFinish(c) {
    if (c.finished) return c.finishTime + (c.penalty || 0);
    const p = this.player;
    const yours = p && p.finished && c.splitKey != null ? this.playerSplits.get(c.splitKey) : null;
    if (yours != null) return p.finishTime + (c.splitTime - yours) + this.penaltyOf(c);
    const total = this.totalLaps * this.track.length;
    const avg = c.progress > 0 && this.time > 0 ? c.progress / this.time : 400;
    return this.time + Math.max(0, total - c.progress) / Math.max(200, avg) + this.penaltyOf(c);
  }

  buildResults() {
    const rows = [];
    let prev = 0;
    for (const c of this.order) {
      let time = c.finished ? c.finishTime : null;
      if (time == null) {
        time = this.estimateFinish(c) - this.penaltyOf(c);
        time = Math.max(time, prev + 0.15);
      }
      prev = time;
      const penalty = c.finished ? c.penalty || 0 : this.penaltyOf(c);
      rows.push({ name: c.name, code: c.code, team: c.teamId, driver: c.driverId, livery: c.livery, isPlayer: c.isPlayer, time: time + penalty, penalty, best: c.bestLap, finished: c.finished });
    }
    // Penalties can change the order.
    rows.sort((a, b) => a.time - b.time);
    const p = this.player;
    const mine = rows.findIndex((r) => r.isPlayer);
    return {
      rows,
      fastest: this.fastest ? { time: this.fastest.time, code: this.fastest.car.code, isPlayer: this.fastest.car.isPlayer } : null,
      playerPos: p ? (mine >= 0 ? mine + 1 : p.finishPos || p.pos) : null,
      playerTime: p && p.finishTime != null ? p.finishTime + (p.penalty || 0) : null,
      playerBest: p ? p.bestLap : null,
      playerPenalty: p ? p.penalty || 0 : 0,
      playerStops: p && p.stopTimes ? p.stopTimes.slice() : [],
      laps: this.totalLaps,
    };
  }

  // Pit crews: waiting in the box as their car comes in, one at each wheel
  // (stepping back once it's done), one at each jack, and the release light
  // by the nose.
  drawCrews(ctx, view) {
    const t = this.track;
    const p = t.pit;
    for (const c of this.cars) {
      const s = c.pit;
      if (!s || s.stage === 'out') continue;
      const boxK = p.boxes[c.box];
      if (s.stage === 'in' && s.k < boxK - 70) continue;
      let x;
      let y;
      let a;
      if (s.stage === 'box') {
        x = c.x;
        y = c.y;
        a = c.angle;
      } else {
        const q = t.pitPoint(boxK, p.boxO);
        x = q.x;
        y = q.y;
        a = t.pitAngle(boxK);
      }
      if (x < view.minX - 80 || x > view.maxX + 80 || y < view.minY - 80 || y > view.maxY + 80) continue;
      const done = s.done || [false, false, false, false];
      const team = PIT_TEAMS[c.box];
      const jacked = s.stage === 'box';
      const people = [
        [13, -20 - (done[0] ? 9 : 0)],
        [13, 20 + (done[1] ? 9 : 0)],
        [-15, -20 - (done[2] ? 9 : 0)],
        [-15, 20 + (done[3] ? 9 : 0)],
        [jacked ? 31 : 40, 0],
        [jacked ? -31 : -40, 0],
      ];
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      for (const [px, py] of people) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.arc(px + 1.5, py + 2.5, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = team.color;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#16181c';
        ctx.beginPath();
        ctx.arc(px, py, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      // Release light, on the lane side of the nose.
      if (s.stage === 'box') {
        const g = c === this.player ? this.pits.game : null;
        const green = g ? g.green : s.t >= (s.service || 0);
        const ly = p.side > 0 ? -24 : 24; // toward the lane
        ctx.fillStyle = '#16181c';
        ctx.beginPath();
        ctx.arc(30, ly, 6.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = green ? '#31d67b' : '#ff2a1f';
        ctx.beginPath();
        ctx.arc(30, ly, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = green ? 'rgba(49,214,123,0.3)' : 'rgba(255,42,31,0.3)';
        ctx.beginPath();
        ctx.arc(30, ly, 10, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
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
    if (this.pits) this.drawCrews(ctx, view);
    for (const c of this.cars) {
      if (c === this.player) continue;
      if (c.x < view.minX - m || c.x > view.maxX + m || c.y < view.minY - m || c.y > view.maxY + m) continue;
      c.draw(ctx);
    }
    // The road beside yours (other cars on it included) fades down.
    if (this.besideFade) {
      t.neighbours.forEach((r, k) => {
        const a = this.besideFade[k];
        if (a > 0.01) t.dimRange(ctx, r.b0, r.b1, a);
      });
    }
    if (this.player) this.player.draw(ctx);
    // Bridges: your own road stays clear. Crossing over: the road below is
    // dimmed. Going under: the bridge turns see-through and your car stays on top.
    const me = this.player || this.focus;
    for (const c of t.crossings) {
      const span = t.bridgeSpan;
      const above = me && t.lapDistance(me.trackIdx, c.upper) < span * 1.6;
      const below = me && t.lapDistance(me.trackIdx, c.lower) < span * 1.6;
      if (above) t.dimStretch(ctx, c.lower, Math.round(span * 1.8));
      const s2 = Math.round(span * 2.4);
      if (below) t.dimRange(ctx, (c.upper - s2 + t.n) % t.n, (c.upper + s2) % t.n, 1);
      t.drawBridge(ctx, c, below ? 0.25 : 1);
      for (const car of this.cars) {
        if (t.lapDistance(car.trackIdx, c.upper) <= span + 6) car.draw(ctx, below ? 0.4 : 1);
      }
      if (above || below) me.draw(ctx);
    }
    this.particles.draw(ctx, view);
    if (this.mode === 'race') t.drawGantry(ctx, this.phase === 'lights' ? this.lit : 0);
  }
}
