// Arcade car physics and the top-down F1 car drawing.
//
// World units are pixels: the car is 44 long, 1 px/s is shown as ~0.45 km/h.
// Handling model: the engine pushes along the car's heading, steering turns the
// heading (less at high speed), and "grip" bleeds off sideways velocity.
// While turning at speed, press and hold brake to drift: the car slides round
// at speed on a tighter line; let go of brake to grip again. A great start
// off the line gives a short boost.

import { approach, clamp, damp, roundRect, wrapAngle } from './util.js';

export const PHYS = {
  TOP: 760,
  ACCEL: 720,
  BRAKE: 1150,
  COAST: 80,
  DRAG: 0.04,
  REV_TOP: 170,
  REV_ACC: 420,
  STEER_MAX: 3.6,
  STEER_VREF: 380,
  STEER_LOWV: 80,
  GRIP: 9,
  GRASS_TOP: 0.45,
  GRASS_GRIP: 0.5,
  LIFT: 0.32, // off the gas and off the brake: extra drag × speed, so a lift scrubs speed
  BOOST_TOP: 1.3,
  BOOST_ACC: 1.9,
  SLIP_TOP: 0.24, // full slipstream: this much more top speed...
  SLIP_ACC: 0.9, // ...and this much more pull
  LEN: 44,
  R: 10, // each car is two collision circles of this radius
};

// Barrier hits: a light scrape is cheap, using the wall as a brake is not.
export const WALL = {
  BOUNCE: 0.15, // share of the impact speed that bounces back
  LOSS: 0.15, // speed lost on any hit
  LOSS_HARD: 0.85, // extra loss for a hard, head-on hit
  HARD_V: 260, // impact speed counted as a full hard hit
  STUN_V: 150, // impact speed above which the engine stutters
  STUN: 0.4, // seconds of stutter at that speed...
  STUN_MAX: 1.1, // ...growing to this
  STUN_RAMP: 400,
};

// Drifting: starts above `minSpeed` px/s, ends below `endSpeed`; the path
// curves `turn` × the grip limit, plus up to `turnIn` more when you steer
// into it (less when you steer out); it bleeds `drag` px/s² of speed.
export const DRIFT = { minSpeed: 230, endSpeed: 130, turn: 1.3, turnIn: 0.4, drag: 55 };

// Tyres and damage (races). A race of normal driving uses `race` of a set of
// tyres whatever its length (so with the one required pit stop each set ends
// near 65%); drifting adds `drift`, sliding `slide` and running off the road
// at speed `off`, each counted in laps' worth of wear per second. A hit
// faster than `hitMin` px/s costs `hit` damage per px/s above that
// (car-to-car knocks count `car` as much). Worn tyres take away up to
// `tyreTop` of top speed and pull, hardly at first and more and more as they
// go (`tyreCurve`); damage takes up to `damageTop`, also growing as it
// builds up (see conditionOf).
export const WEAR = { race: 0.7, drift: 0.08, slide: 0.05, off: 0.15, hitMin: 110, hit: 0.0003, car: 0.6, tyreTop: 0.22, tyreCurve: 1.7, damageTop: 0.45 };

// Share of top speed and pull a car has left with its tyres and damage.
export function conditionOf(car) {
  return (1 - WEAR.tyreTop * Math.pow(1 - car.tyres, WEAR.tyreCurve)) * (1 - WEAR.damageTop * Math.pow(car.damage, 1.3));
}

export const BOOST_TIME = [0, 0.6, 1.0, 1.5];
export const TIER_COLORS = ['#ffffff', '#4fc3ff', '#ffb020', '#c45cff'];

export function steerRate(v) {
  const s = Math.abs(v);
  return (PHYS.STEER_MAX / (1 + s / PHYS.STEER_VREF)) * Math.min(1, s / PHYS.STEER_LOWV);
}

// Fastest speed at which the car can follow a curve of curvature k (1/radius),
// up to `top`.
export function maxCornerSpeed(k, margin = 1, top = PHYS.TOP) {
  if (k < 1e-5) return top;
  let lo = 0;
  let hi = top;
  for (let i = 0; i < 24; i++) {
    const v = (lo + hi) / 2;
    if (steerRate(v) * margin >= v * k) lo = v;
    else hi = v;
  }
  return lo;
}

export class Car {
  constructor({ x, y, angle, livery, name, code, isPlayer = false, power = 1 }) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.livery = livery;
    this.name = name;
    this.code = code;
    this.isPlayer = isPlayer;
    this.power = power;
    this.canDrift = isPlayer; // the AI drives on grip only

    this.vx = 0;
    this.vy = 0;
    this.steer = 0;
    this.gas = 0;
    this.brake = 0;
    this.prevBrake = false;
    this.frozen = true;

    this.drifting = false;
    this.driftDir = 0;
    this.driftCharge = 0;
    this.driftTier = 0;
    this.driftSlip = 0;
    this.boost = 0;
    this.boostLevel = 0;
    this.slipstream = 0;
    this.overtake = 0; // seconds of overtake mode left (see OVERTAKE in race.js)
    this.yawKick = 0;
    this.launchPenalty = 0;

    this.wears = false; // tyre wear and damage count (set by the race)
    this.wearLap = WEAR.race / 3; // tyre wear per lap of normal driving (set by the race)
    this.tyres = 1; // 1 = fresh
    this.damage = 0; // 0 = none, 1 = wrecked
    this.hitT = 0; // how recently it took damage (for the HUD flash)

    this.offTrack = false;
    this.onKerb = false;
    this.slide = 0;
    this.q = {};

    // Race bookkeeping (filled in by Race).
    this.trackIdx = 0;
    this.lap = -1;
    this.lapArmed = false;
    this.lapStart = 0;
    this.laps = [];
    this.bestLap = null;
    this.progress = 0;
    this.pos = 0;
    this.finished = false;
    this.fxT = 0;
    this.skidPrev = null;
  }

  get speed() {
    return Math.hypot(this.vx, this.vy);
  }

  get forwardSpeed() {
    return this.vx * Math.cos(this.angle) + this.vy * Math.sin(this.angle);
  }

  update(dt, ctl, track, events) {
    const P = PHYS;
    this.gas = ctl.gas;
    if (ctl.brake < 0.5) this.brakeLock = false;
    this.brake = this.brakeLock ? 0 : ctl.brake;

    if (this.frozen) {
      this.vx = 0;
      this.vy = 0;
      this.steer = approach(this.steer, ctl.steer, 8 * dt);
      this.prevBrake = ctl.brake > 0.5;
      return;
    }

    // Keyboard and touch are on/off, so ease the wheel in; letting go is quicker.
    const tgt = ctl.steer;
    const rate = ctl.analog ? 14 : Math.abs(tgt) < Math.abs(this.steer) || tgt * this.steer < 0 ? 11 : 6.5;
    this.steer = approach(this.steer, tgt, rate * dt);

    const ca = Math.cos(this.angle);
    const sa = Math.sin(this.angle);
    let vf = this.vx * ca + this.vy * sa;
    let vl = -this.vx * sa + this.vy * ca;

    const q = track.queryLocal(this.x, this.y, this.trackIdx, this.q);
    const kerbZone = q.dist > track.half - 10 && q.dist < track.half + 14 && track.kerbAt(q.idx);
    this.onKerb = kerbZone;
    this.offTrack = q.dist > track.half + (kerbZone ? 14 : 4);
    const off = this.offTrack;

    let top = P.TOP * this.power;
    let acc = P.ACCEL * this.power;
    if (off) top *= P.GRASS_TOP;
    if (this.boost > 0) {
      top *= P.BOOST_TOP;
      acc *= P.BOOST_ACC;
    }
    top *= 1 + P.SLIP_TOP * this.slipstream;
    acc *= 1 + P.SLIP_ACC * this.slipstream;
    if (this.wears) {
      const k = conditionOf(this);
      top *= k;
      acc *= k;
    }
    if (this.launchPenalty > 0) acc *= 0.35;

    // Drift: while turning at speed, press brake. Hold it to keep sliding;
    // let go of brake to grip again.
    const brakeEdge = this.brake > 0.5 && !this.prevBrake;
    this.prevBrake = this.brake > 0.5;
    const turning = Math.abs(ctl.steer) > 0.3 && this.steer * ctl.steer > 0 && Math.abs(this.steer) > 0.18;
    if (this.canDrift && !this.drifting && brakeEdge && turning && vf > DRIFT.minSpeed && !off) {
      this.drifting = true;
      this.driftDir = Math.sign(ctl.steer);
      this.driftCharge = 0;
      this.driftTier = 0;
      this.driftSlip = 0.1;
      events.push({ t: 'drift', car: this });
    }

    if (this.drifting) {
      this.updateDrift(dt, top, off, events);
      this.yawKick *= Math.exp(-5 * dt);
    } else {
      // Throttle, brake, reverse.
      if (this.gas > 0.05 && vf < -10) {
        vf = Math.min(0, vf + P.BRAKE * dt);
      } else if (this.gas > 0.05) {
        const k = 1 - vf / top;
        vf += acc * this.gas * Math.max(k, -0.5) * dt;
      }
      if (this.brake > 0.05) {
        if (vf > 12) vf = Math.max(0, vf - P.BRAKE * this.brake * dt);
        else if (this.gas <= 0.05) vf = Math.max(-P.REV_TOP, vf - P.REV_ACC * this.brake * dt);
      }
      if (this.gas <= 0.05 && this.brake <= 0.05) {
        const c = P.COAST * dt;
        vf = Math.abs(vf) <= c ? 0 : vf - Math.sign(vf) * c;
        vf -= vf * P.LIFT * dt;
      }
      vf -= vf * P.DRAG * dt;
      if (off) vf -= vf * 0.9 * dt;

      // Steering: turns the nose; less turning at high speed.
      let w = steerRate(vf);
      if (off) w *= 0.85;
      const dir = vf >= 0 ? 1 : -1;
      this.angle += (this.steer * w * dir + this.yawKick) * dt;
      this.yawKick *= Math.exp(-5 * dt);

      // Grip: bleed off sideways velocity.
      const sp = Math.abs(vf);
      let grip = P.GRIP * (1 - 0.28 * Math.min(1, sp / P.TOP));
      if (off) grip *= P.GRASS_GRIP;
      if (this.brake > 0.5 && sp > 250 && Math.abs(this.steer) > 0.5) grip *= 0.8;
      vl *= Math.exp(-grip * dt);
      this.slide = Math.abs(vl);

      this.vx = ca * vf - sa * vl;
      this.vy = sa * vf + ca * vl;
    }

    const ox = this.x;
    const oy = this.y;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Barriers.
    const q2 = track.queryLocal(this.x, this.y, this.trackIdx, this.q);
    if (q2.dist === Infinity) {
      this.x = ox;
      this.y = oy;
      this.vx *= -0.3;
      this.vy *= -0.3;
    } else {
      const fx = Math.cos(this.angle);
      const fy = Math.sin(this.angle);
      const along = Math.abs(fx * q2.nx + fy * q2.ny);
      const reach = along * 21 + (1 - along) * 10;
      const lim = track.wallAt(q2.idx, q2.side) - reach;
      if (q2.dist > lim) {
        this.x = q2.cx + q2.nx * lim;
        this.y = q2.cy + q2.ny * lim;
        const vn = this.vx * q2.nx + this.vy * q2.ny;
        if (vn > 0) {
          // The harder and more head-on the hit, the more speed it costs.
          const W = WALL;
          const headOn = clamp(vn / Math.max(1, this.speed), 0, 1);
          this.vx -= (1 + W.BOUNCE) * vn * q2.nx;
          this.vy -= (1 + W.BOUNCE) * vn * q2.ny;
          const keep = 1 - clamp(W.LOSS + W.LOSS_HARD * headOn * Math.min(1, vn / W.HARD_V), 0, 0.9);
          this.vx *= keep;
          this.vy *= keep;
          // Glance off: swing the nose a little toward the new direction.
          if (this.speed > 40) {
            const diff = wrapAngle(Math.atan2(this.vy, this.vx) - this.angle);
            if (Math.abs(diff) < 2) this.yawKick += clamp(diff * 1.4, -1.5, 1.5);
          }
          // A proper hit knocks the wind out of the engine for a moment.
          if (vn > W.STUN_V) this.launchPenalty = Math.max(this.launchPenalty, Math.min(W.STUN_MAX, W.STUN + (vn - W.STUN_V) / W.STUN_RAMP));
          if (this.drifting) {
            this.drifting = false;
            this.driftTier = 0;
            this.driftCharge = 0;
          }
          if (vn > 50) events.push({ t: 'wall', car: this, x: this.x + q2.nx * reach, y: this.y + q2.ny * reach, power: vn });
          if (vn > WEAR.hitMin) this.addDamage((vn - WEAR.hitMin) * WEAR.hit, events);
        }
      }
    }

    this.boost = Math.max(0, this.boost - dt);
    this.launchPenalty = Math.max(0, this.launchPenalty - dt);
    this.hitT = Math.max(0, this.hitT - dt);
    this.wear(dt, track);
  }

  // Tyres wear with every metre, faster in a drift or a slide, much faster
  // off the road.
  wear(dt, track) {
    if (!this.wears) return;
    const sp = this.speed;
    let laps = (sp * dt) / track.length;
    if (this.drifting) laps += WEAR.drift * dt;
    else if (this.slide > 90) laps += WEAR.slide * dt;
    if (this.offTrack && sp > 120) laps += WEAR.off * dt * Math.min(1, sp / 400);
    this.tyres = Math.max(0, this.tyres - laps * this.wearLap);
  }

  addDamage(d, events) {
    if (!this.wears || d <= 0) return;
    this.damage = Math.min(1, this.damage + d);
    if (d > 0.004) {
      this.hitT = 0.8;
      events.push({ t: 'damage', car: this, amount: d });
    }
  }

  // Controlled arcade drift: the car keeps its speed and its path curves at a
  // fixed rate (tighter than grip allows), nose angled into the corner.
  // Steering into the drift tightens it, steering out widens it.
  updateDrift(dt, top, off, events) {
    const rel = clamp(this.steer * this.driftDir, -1, 1);
    let sp = Math.hypot(this.vx, this.vy);
    sp -= (off ? 260 : DRIFT.drag) * dt;
    if (this.gas > 0.5 && sp < top) sp += 120 * dt;
    const w = steerRate(sp) * (DRIFT.turn + DRIFT.turnIn * rel);
    const va = Math.atan2(this.vy, this.vx) + this.driftDir * w * dt;
    this.vx = Math.cos(va) * sp;
    this.vy = Math.sin(va) * sp;
    this.driftSlip = damp(this.driftSlip, 0.45 + 0.17 * rel, 6, dt);
    const nose = va + this.driftDir * this.driftSlip;
    this.angle += wrapAngle(nose - this.angle) * (1 - Math.exp(-12 * dt));
    this.slide = sp * Math.sin(this.driftSlip);

    this.driftCharge += dt * (0.85 + 0.35 * Math.max(0, rel));
    const tier = this.driftCharge > 2.2 ? 3 : this.driftCharge > 1.3 ? 2 : this.driftCharge > 0.6 ? 1 : 0;
    if (tier > this.driftTier) {
      this.driftTier = tier;
      events.push({ t: 'driftTier', car: this, tier });
    }
    // Two wheels on the grass is fine for a moment; staying out there ends it.
    this.driftOffT = off ? (this.driftOffT || 0) + dt : 0;
    const released = this.brake < 0.5;
    if (released || sp < DRIFT.endSpeed || this.driftOffT > 0.45) {
      events.push({ t: 'driftEnd', car: this, tier: this.driftTier, clean: released && !off });
      // Drift lost while the brake is still held: ignore the brake until it's
      // released, so the car coasts instead of slamming to a stop.
      if (!released) this.brakeLock = true;
      this.drifting = false;
      this.driftTier = 0;
      this.driftCharge = 0;
    }
  }

  startBoost(level, events, why) {
    this.boost = Math.max(this.boost, BOOST_TIME[level]);
    this.boostLevel = level;
    events.push({ t: 'boost', car: this, tier: level, why });
  }

  draw(ctx, alpha = 1) {
    if (sprite.scale) {
      this.drawSprite(ctx, alpha);
      return;
    }
    // Shadow falls the same way for every car, whatever its heading.
    ctx.save();
    ctx.translate(this.x + 3, this.y + 5);
    ctx.rotate(this.angle);
    ctx.globalAlpha = alpha * 0.3;
    ctx.fillStyle = '#000';
    roundRect(ctx, -22, -10, 44, 20, 7);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.globalAlpha = alpha;
    if (this.boost > 0) drawFlame(ctx, this.boostLevel);
    drawF1(ctx, this.livery, this.steer, this.brake > 0.3 && !this.frozen);
    ctx.restore();
  }

  // The same car from its pictures (see setCarSprites): shadow, flame, car.
  drawSprite(ctx, alpha) {
    const ca = Math.cos(this.angle);
    const sa = Math.sin(this.angle);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    // The shadow's offset is in world space: turned into the car's own.
    ctx.globalAlpha = alpha * 0.3;
    const sh = shadowSprite();
    ctx.drawImage(sh, 3 * ca + 5 * sa - 23, -3 * sa + 5 * ca - 11, 46, 22);
    ctx.globalAlpha = alpha;
    if (this.boost > 0) drawFlame(ctx, this.boostLevel);
    ctx.drawImage(carSprite(this.livery, this.steer), SPRITE_BOX.x, SPRITE_BOX.y, SPRITE_BOX.w, SPRITE_BOX.h);
    if (this.brake > 0.3 && !this.frozen) {
      ctx.fillStyle = '#ff3030';
      ctx.fillRect(-23.6, -1, 1.4, 2);
    }
    ctx.restore();
  }
}

// Phones: each car is drawn from a picture made once per livery and wheel
// angle (9 of them), one image instead of ~20 shapes. `scale` is the
// picture's pixels per world px (a bit sharper than the camera ever gets
// close); 0 draws the shapes every frame (computers).
const SPRITE_BOX = { x: -25, y: -13, w: 48, h: 26 };
const SPRITE_STEPS = 9;
const sprite = { scale: 0, cars: new WeakMap(), shadow: null };

export function setCarSprites(scale) {
  const s = Math.round(scale * 20) / 20;
  if (s === sprite.scale) return;
  sprite.scale = s;
  sprite.cars = new WeakMap();
  sprite.shadow = null;
}

function spriteCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * sprite.scale);
  c.height = Math.ceil(h * sprite.scale);
  const g = c.getContext('2d');
  g.scale(c.width / w, c.height / h);
  return { c, g };
}

function shadowSprite() {
  if (sprite.shadow) return sprite.shadow;
  const { c, g } = spriteCanvas(46, 22);
  g.translate(23, 11);
  g.fillStyle = '#000';
  roundRect(g, -22, -10, 44, 20, 7);
  g.fill();
  sprite.shadow = c;
  return c;
}

function carSprite(livery, steer) {
  let set = sprite.cars.get(livery);
  if (!set) {
    set = [];
    sprite.cars.set(livery, set);
  }
  const k = Math.round(((clamp(steer, -1, 1) + 1) / 2) * (SPRITE_STEPS - 1));
  if (!set[k]) {
    const { c, g } = spriteCanvas(SPRITE_BOX.w, SPRITE_BOX.h);
    g.translate(-SPRITE_BOX.x, -SPRITE_BOX.y);
    drawF1(g, livery, (k / (SPRITE_STEPS - 1)) * 2 - 1, false);
    set[k] = c;
  }
  return set[k];
}

function drawFlame(ctx, level) {
  const len = 16 + Math.random() * 14 + level * 4;
  const col = TIER_COLORS[level] || TIER_COLORS[2];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createLinearGradient(-22, 0, -22 - len, 0);
  g.addColorStop(0, '#fff');
  g.addColorStop(0.25, col);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-21, -3.2);
  ctx.quadraticCurveTo(-22 - len * 0.6, -2, -22 - len, 0);
  ctx.quadraticCurveTo(-22 - len * 0.6, 2, -21, 3.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function bodyPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(-16.5, -3.2);
  ctx.lineTo(-12, -6.6);
  ctx.lineTo(0.5, -7);
  ctx.quadraticCurveTo(5.5, -5.8, 7.5, -2.6);
  ctx.lineTo(7.5, 2.6);
  ctx.quadraticCurveTo(5.5, 5.8, 0.5, 7);
  ctx.lineTo(-12, 6.6);
  ctx.lineTo(-16.5, 3.2);
  ctx.closePath();
  ctx.moveTo(6, -2.7);
  ctx.lineTo(19.5, -1.5);
  ctx.lineTo(19.5, 1.5);
  ctx.lineTo(6, 2.7);
  ctx.closePath();
}

// Car points along +x. Nose at +22, rear wing at -22.
export function drawF1(ctx, livery, steer = 0, braking = false) {
  const c1 = livery.color;
  const c2 = livery.color2;
  const tyre = '#141518';

  // Rear tyres.
  ctx.fillStyle = tyre;
  roundRect(ctx, -20, -11.5, 9.5, 6, 1.6);
  ctx.fill();
  roundRect(ctx, -20, 5.5, 9.5, 6, 1.6);
  ctx.fill();

  // Front tyres turn with the wheel.
  const fa = steer * 0.42;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(12.5, side * 9);
    ctx.rotate(fa);
    roundRect(ctx, -3.8, -2.4, 7.6, 4.8, 1.4);
    ctx.fill();
    ctx.restore();
  }

  // Suspension arms.
  ctx.strokeStyle = '#2a2c31';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(9, -2.5);
  ctx.lineTo(12.5, -7);
  ctx.moveTo(9, 2.5);
  ctx.lineTo(12.5, 7);
  ctx.moveTo(-13, -4);
  ctx.lineTo(-15, -6);
  ctx.moveTo(-13, 4);
  ctx.lineTo(-15, 6);
  ctx.stroke();

  // Floor.
  ctx.fillStyle = '#1b1d22';
  ctx.beginPath();
  ctx.moveTo(-17, -6.5);
  ctx.lineTo(6, -6.5);
  ctx.lineTo(8, -3);
  ctx.lineTo(8, 3);
  ctx.lineTo(6, 6.5);
  ctx.lineTo(-17, 6.5);
  ctx.closePath();
  ctx.fill();

  // Body, sidepods and nose. A split livery paints the right flank separately.
  ctx.fillStyle = c1;
  bodyPath(ctx);
  ctx.fill();
  if (livery.split) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(-30, 0, 60, 20);
    ctx.clip();
    ctx.fillStyle = livery.split;
    bodyPath(ctx);
    ctx.fill();
    ctx.restore();
  }

  // Livery stripe along the spine.
  ctx.fillStyle = c2;
  ctx.fillRect(-16.5, -1.3, 13, 2.6);
  ctx.fillRect(8, -0.8, 11, 1.6);

  // Wings.
  ctx.fillStyle = c2;
  roundRect(ctx, 17.6, -10.8, 3.6, 21.6, 1);
  ctx.fill();
  ctx.fillStyle = '#111215';
  ctx.fillRect(17.6, -11.2, 3.6, 1.6);
  ctx.fillRect(17.6, 9.6, 3.6, 1.6);
  ctx.fillStyle = c2;
  roundRect(ctx, -22.5, -9, 4.6, 18, 1);
  ctx.fill();
  ctx.fillStyle = '#111215';
  ctx.fillRect(-22.5, -9.4, 4.6, 1.6);
  ctx.fillRect(-22.5, 7.8, 4.6, 1.6);

  // Cockpit, helmet and halo.
  ctx.fillStyle = '#0b0b0d';
  ctx.beginPath();
  ctx.ellipse(0.5, 0, 4.4, 2.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = livery.helmet || '#f2f2f2';
  ctx.beginPath();
  ctx.arc(-0.2, 0, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2b2d33';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(-2.4, -2.7);
  ctx.quadraticCurveTo(5.2, -3.2, 5.2, 0);
  ctx.quadraticCurveTo(5.2, 3.2, -2.4, 2.7);
  ctx.stroke();

  // Rain light flashes red under braking.
  ctx.fillStyle = braking ? '#ff3030' : '#5a1414';
  ctx.fillRect(-23.6, -1, 1.4, 2);
}
