// Computer drivers. Each one follows the track's racing line with its own
// small offset, brakes to the precomputed target speed for the corner ahead,
// and moves over to pass a slower car. They use exactly the same car physics
// as the player.

import { clamp, damp, rand, wrapAngle } from './util.js';

export class AIDriver {
  constructor(car, track, { pace = 0.93 } = {}) {
    this.car = car;
    this.track = track;
    this.pace = pace;
    this.baseOff = rand(-14, 14);
    this.offset = this.baseOff;
    this.offsetTarget = this.baseOff;
    this.wob = rand(0, 100);
    this.stuck = 0;
    this.reverseT = 0;
    this.reaction = rand(0.17, 0.42);
    this.out = { gas: 0, brake: 0, steer: 0, analog: true };
  }

  control(dt, cars, rubber, raceTime) {
    const c = this.car;
    const t = this.track;
    const out = this.out;
    out.gas = 0;
    out.brake = 0;
    out.steer = 0;
    if (raceTime < this.reaction) return out;

    const n = t.n;
    const idx = c.trackIdx;
    const v = c.forwardSpeed;
    const fx = Math.cos(c.angle);
    const fy = Math.sin(c.angle);

    // Traffic: the closest car in front of us in our lane, and whether
    // someone is alongside on either side.
    let ahead = null;
    let aheadF = Infinity;
    let aheadLat = 0;
    let blockedL = false;
    let blockedR = false;
    for (const o of cars) {
      if (o === c) continue;
      const di = Math.abs(o.trackIdx - idx);
      if (Math.min(di, n - di) > n * 0.15) continue; // on the bridge above or below us
      const dx = o.x - c.x;
      const dy = o.y - c.y;
      const f = dx * fx + dy * fy;
      const lat = -dx * fy + dy * fx;
      if (f > -56 && f < 70 && Math.abs(lat) > 14 && Math.abs(lat) < 70) {
        if (lat < 0) blockedL = true;
        else blockedR = true;
      }
      if (f < 8 || f > 180) continue;
      if (Math.abs(lat) > 36) continue;
      if (f < aheadF) {
        aheadF = f;
        ahead = o;
        aheadLat = lat;
      }
    }

    const myLat = (c.x - t.px[idx]) * t.nx[idx] + (c.y - t.py[idx]) * t.ny[idx];
    const edge = t.half - 24;
    // Usable width on each side: less where a wall sits close to the track.
    const edgeAt = (i) => [-Math.min(edge, t.wallL[i] - 40), Math.min(edge, t.wallR[i] - 40)];
    const [lo, hi] = edgeAt(idx);
    let boxedIn = false;
    if (ahead && ahead.forwardSpeed < v + 30) {
      // Pass on whichever side is open; if both are taken, wait behind.
      const otherLat = myLat + aheadLat;
      const left = { goal: otherLat - 46, ok: !blockedL };
      const right = { goal: otherLat + 46, ok: !blockedR };
      const prefer = aheadLat >= 0 ? [left, right] : [right, left];
      const pick = prefer.find((o) => o.ok && o.goal >= lo && o.goal <= hi);
      if (pick) this.offsetTarget = clamp(pick.goal, lo, hi) - t.roff[idx];
      else boxedIn = true;
    } else if (blockedL || blockedR) {
      // Someone alongside: hold our line rather than drifting into them.
      this.offsetTarget = myLat - t.roff[idx] + (blockedL ? 6 : 0) - (blockedR ? 6 : 0);
    } else {
      this.offsetTarget = damp(this.offsetTarget, this.baseOff, 0.6, dt);
    }
    this.wob += dt;
    const desiredOff = this.offsetTarget + Math.sin(this.wob * 0.7) * 8;
    this.offset = damp(this.offset, desiredOff, 2.2, dt);

    // Steer toward a point ahead on our line.
    const look = clamp(55 + Math.abs(v) * 0.32, 60, 280);
    const ti = (idx + Math.round(look / t.ds)) % n;
    const [tlo, thi] = edgeAt(ti);
    const lat = clamp(t.roff[ti] + this.offset, tlo, thi);
    const tx = t.px[ti] + t.nx[ti] * lat;
    const ty = t.py[ti] + t.ny[ti] * lat;
    const err = wrapAngle(Math.atan2(ty - c.y, tx - c.x) - c.angle);
    out.steer = clamp(err * 2.6, -1, 1);

    // Speed: slowest target speed over the next stretch.
    let vt = Infinity;
    const win = Math.round((40 + Math.abs(v) * 0.12) / t.ds);
    for (let k = 0; k <= win; k += 2) vt = Math.min(vt, t.vProfile[(idx + k) % n]);
    vt *= this.pace * rubber;
    if (c.offTrack) vt = Math.min(vt, 320);
    if (Math.abs(err) > 0.7) vt = Math.min(vt, 240);
    if (ahead && aheadF < (boxedIn ? 110 : 70) && ahead.forwardSpeed < v) vt = Math.min(vt, ahead.forwardSpeed * (boxedIn ? 0.94 : 0.97));

    if (v < vt - 12) out.gas = 1;
    else if (v > vt + 28) out.brake = clamp((v - vt) / 90, 0.35, 1);
    else out.gas = 0.45;

    // Stuck against something: back out.
    if (Math.abs(v) < 25 && !c.frozen) this.stuck += dt;
    else this.stuck = Math.max(0, this.stuck - dt * 2);
    if (this.stuck > 1.1) {
      this.reverseT = 0.9;
      this.stuck = 0;
    }
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      out.gas = 0;
      out.brake = 1;
      out.steer = -out.steer;
    }
    return out;
  }
}
