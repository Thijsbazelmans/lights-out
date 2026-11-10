// Computer drivers. Each one follows the track's racing line with its own
// small offset, brakes to the precomputed target speed for the corner ahead,
// and moves over to pass a slower car. They use exactly the same car physics
// as the player.

import { clamp, damp, rand, wrapAngle } from './util.js';

// How close (px) an AI car aims to pass a chicane's sausage kerb.
export const AI_KERB = { gap: 36 };

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
    let besideAhead = false; // the car alongside is a nose in front: we give way
    let touching = false; // our nose is on someone's gearbox: back off
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
        if (f > 6) besideAhead = true;
      }
      if (f > 6 && f < 50 && Math.abs(lat) < 24) touching = true;
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
    const edgeAt = (i) => [-t.roomAt(i, -1, edge, 40, AI_KERB.gap), t.roomAt(i, 1, edge, 40, AI_KERB.gap)];
    const [lo, hi] = edgeAt(idx);
    // Pass on the straights, or when clearly quicker; through corners, follow.
    let bend = 0;
    for (let k = 0; k <= 32; k += 4) bend = Math.max(bend, Math.abs(t.rcurv[(idx + k) % n]));
    const straight = bend < 1 / 650;
    const closing = ahead ? v - ahead.forwardSpeed : 0;
    const wantPass = ahead && (straight ? closing > 12 : closing > 70);
    let boxedIn = false;
    let following = false;
    if (ahead && !wantPass) {
      following = true;
      this.offsetTarget = damp(this.offsetTarget, myLat + aheadLat * 0.4 - t.roff[idx], 1.5, dt);
    } else if (ahead && ahead.forwardSpeed < v + 30) {
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

    // Steer toward a point ahead on our line; look less far ahead through a
    // tight bit (a chicane), so we don't cut across its kerbs.
    let tight = 0;
    for (let k = 4; k <= 24; k += 4) tight = Math.max(tight, Math.abs(t.rcurv[(idx + k) % n]));
    const look = clamp(55 + Math.abs(v) * 0.32, 60, 280) * (tight > 1 / 170 ? 0.7 : 1);
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
    if (ahead && aheadF < (boxedIn || following ? 105 : 70) && ahead.forwardSpeed < v) vt = Math.min(vt, ahead.forwardSpeed * (boxedIn ? 0.94 : 0.985));
    // Side by side into a corner: whoever is behind backs out of it.
    if (besideAhead && !straight) vt *= 0.95;

    if (v < vt - 12) out.gas = 1;
    else if (v > vt + 28) out.brake = clamp((v - vt) / 90, 0.35, 1);
    else out.gas = 0.45;
    // Never push the car in front along: lift, and dab the brake.
    if (touching && v > 40) {
      out.gas = 0;
      out.brake = Math.max(out.brake, 0.3);
    }

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
