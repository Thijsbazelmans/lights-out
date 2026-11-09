// A circuit is a closed spline through a handful of control points. From it we
// build: an evenly spaced centerline, a smoothed racing line with target
// speeds (for the AI), a spatial grid for fast "how far am I from the track"
// questions, kerbs, scenery, and the drawing paths.
//
// The same representation will take real circuit layouts later: they are just
// longer lists of points.

import { clamp, hashString, mulberry32, wrapAngle } from './util.js';
import { maxCornerSpeed, PHYS } from './car.js';

const DS = 8; // centerline sample spacing in px
const CHUNK = 96; // samples per drawing chunk (only visible chunks are drawn)
const KERB_CURV = 1 / 560; // corners tighter than this get kerbs

function catmull(p0, p1, p2, p3, t) {
  // Centripetal Catmull-Rom: no loops or cusps when points are unevenly spaced.
  const d01 = Math.max(1e-4, Math.sqrt(Math.hypot(p1.x - p0.x, p1.y - p0.y)));
  const d12 = Math.max(1e-4, Math.sqrt(Math.hypot(p2.x - p1.x, p2.y - p1.y)));
  const d23 = Math.max(1e-4, Math.sqrt(Math.hypot(p3.x - p2.x, p3.y - p2.y)));
  const t0 = 0;
  const t1 = d01;
  const t2 = t1 + d12;
  const t3 = t2 + d23;
  const u = t1 + (t2 - t1) * t;
  const mix = (P, Q, ta, tb) => {
    const w = (u - ta) / (tb - ta);
    return { x: P.x + (Q.x - P.x) * w, y: P.y + (Q.y - P.y) * w };
  };
  const A1 = mix(p0, p1, t0, t1);
  const A2 = mix(p1, p2, t1, t2);
  const A3 = mix(p2, p3, t2, t3);
  const B1 = mix(A1, A2, t0, t2);
  const B2 = mix(A2, A3, t1, t3);
  return mix(B1, B2, t1, t2);
}

function smoothCircular(arr, passes) {
  const n = arr.length;
  const tmp = new Float64Array(n);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) tmp[i] = (arr[(i - 1 + n) % n] + 2 * arr[i] + arr[(i + 1) % n]) / 4;
    for (let i = 0; i < n; i++) arr[i] = tmp[i];
  }
}

export class Track {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.theme = def.theme;
    this.half = def.half ?? 84;
    this.runoff = def.runoff ?? 72;
    this.wallDist = this.half + this.runoff;
    const s = def.scale;
    const ctrl = def.points.map(([x, y]) => ({ x: x * s, y: y * s }));
    this.buildCenterline(ctrl);
    this.findCrossings();
    if (this.separateStretches()) {
      // Rebuild from the moved points so spacing and directions stay even.
      const pts = [];
      for (let i = 0; i < this.n; i++) pts.push({ x: this.px[i], y: this.py[i] });
      this.buildCenterline(pts);
      this.findCrossings();
    }
    this.buildWalls();
    this.findNeighbours();
    this.buildRacingLine();
    this.buildSpeedProfile();
    this.buildGrid();
    this.buildKerbs();
    this.countCorners();
    this.buildDecor();
    this.geo = null; // drawing paths, built on first draw
  }

  buildCenterline(ctrl) {
    const m = ctrl.length;
    const dense = [];
    for (let i = 0; i < m; i++) {
      const p0 = ctrl[(i - 1 + m) % m];
      const p1 = ctrl[i];
      const p2 = ctrl[(i + 1) % m];
      const p3 = ctrl[(i + 2) % m];
      const steps = Math.max(8, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 3));
      for (let k = 0; k < steps; k++) dense.push(catmull(p0, p1, p2, p3, k / steps));
    }
    const D = dense.length;
    const cum = new Float64Array(D + 1);
    for (let i = 0; i < D; i++) {
      const a = dense[i];
      const b = dense[(i + 1) % D];
      cum[i + 1] = cum[i] + Math.hypot(b.x - a.x, b.y - a.y);
    }
    const L = cum[D];
    const n = Math.round(L / DS);
    const ds = L / n;
    this.n = n;
    this.ds = ds;
    this.length = L;

    const px = new Float32Array(n);
    const py = new Float32Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const sPos = i * ds;
      while (j < D - 1 && cum[j + 1] < sPos) j++;
      const a = dense[j];
      const b = dense[(j + 1) % D];
      const seg = cum[j + 1] - cum[j] || 1;
      const t = (sPos - cum[j]) / seg;
      px[i] = a.x + (b.x - a.x) * t;
      py[i] = a.y + (b.y - a.y) * t;
    }
    this.px = px;
    this.py = py;

    const tx = new Float32Array(n);
    const ty = new Float32Array(n);
    const nx = new Float32Array(n);
    const ny = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      const dx = px[b] - px[a];
      const dy = py[b] - py[a];
      const l = Math.hypot(dx, dy) || 1;
      tx[i] = dx / l;
      ty[i] = dy / l;
      // Normal points to the driver's right (screen y grows downward).
      nx[i] = -ty[i];
      ny[i] = tx[i];
    }
    const curv = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - 3 + n) % n;
      const b = (i + 3) % n;
      curv[i] = wrapAngle(Math.atan2(ty[b], tx[b]) - Math.atan2(ty[a], tx[a])) / (6 * ds);
    }
    smoothCircular(curv, 3);
    Object.assign(this, { tx, ty, nx, ny, curv });

    let area = 0;
    for (let i = 0; i < n; i++) {
      const k = (i + 1) % n;
      area += px[i] * py[k] - px[k] * py[i];
    }
    // Clockwise on screen => the inside is on the driver's right.
    this.outsideSign = area > 0 ? -1 : 1;
  }

  buildRacingLine() {
    const n = this.n;
    const step = 4;
    const m = Math.floor(n / step);
    const Cx = new Float64Array(m);
    const Cy = new Float64Array(m);
    const Nx = new Float64Array(m);
    const Ny = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      const i = k * step;
      Cx[k] = this.px[i];
      Cy[k] = this.py[i];
      Nx[k] = this.nx[i];
      Ny[k] = this.ny[i];
    }
    const lim = this.half - 26;
    // Keep the line away from a barrier that sits close to the track.
    const limR = new Float64Array(m);
    const limL = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      limR[k] = Math.min(lim, this.wallR[k * step] - 78);
      limL[k] = Math.min(lim, this.wallL[k * step] - 78);
    }
    const off = new Float64Array(m);
    const X = (k) => Cx[k] + Nx[k] * off[k];
    const Y = (k) => Cy[k] + Ny[k] * off[k];
    // Pull the line tight (cuts corners), then smooth its curvature (wide entry, apex, wide exit).
    for (let it = 0; it < 250; it++) {
      for (let k = 0; k < m; k++) {
        const a = (k - 1 + m) % m;
        const b = (k + 1) % m;
        const gx = (X(a) + X(b)) / 2;
        const gy = (Y(a) + Y(b)) / 2;
        off[k] = clamp((gx - Cx[k]) * Nx[k] + (gy - Cy[k]) * Ny[k], -limL[k], limR[k]);
      }
    }
    for (let it = 0; it < 1500; it++) {
      for (let k = 0; k < m; k++) {
        const a1 = (k - 1 + m) % m;
        const b1 = (k + 1) % m;
        const a2 = (k - 2 + m) % m;
        const b2 = (k + 2) % m;
        const gx = (4 * (X(a1) + X(b1)) - (X(a2) + X(b2))) / 6;
        const gy = (4 * (Y(a1) + Y(b1)) - (Y(a2) + Y(b2))) / 6;
        off[k] = clamp((gx - Cx[k]) * Nx[k] + (gy - Cy[k]) * Ny[k], -limL[k], limR[k]);
      }
    }
    const roff = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const kf = i / step;
      const k0 = Math.floor(kf);
      const f = kf - k0;
      const a = off[k0 % m];
      const b = off[(k0 + 1) % m];
      roff[i] = a + (b - a) * f;
    }
    smoothCircular(roff, 4);
    this.roff = new Float32Array(n);
    this.rx = new Float32Array(n);
    this.ry = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const o = clamp(roff[i], -Math.min(lim, this.wallL[i] - 78), Math.min(lim, this.wallR[i] - 78));
      this.roff[i] = o;
      this.rx[i] = this.px[i] + this.nx[i] * o;
      this.ry[i] = this.py[i] + this.ny[i] * o;
    }
  }

  buildSpeedProfile() {
    const n = this.n;
    const rx = this.rx;
    const ry = this.ry;
    const k = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - 4 + n) % n;
      const b = (i + 4) % n;
      const x1 = rx[a];
      const y1 = ry[a];
      const x2 = rx[i];
      const y2 = ry[i];
      const x3 = rx[b];
      const y3 = ry[b];
      const cr = (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
      const d = Math.hypot(x2 - x1, y2 - y1) * Math.hypot(x3 - x2, y3 - y2) * Math.hypot(x3 - x1, y3 - y1);
      k[i] = d > 1e-6 ? (2 * cr) / d : 0;
    }
    smoothCircular(k, 4);
    this.rcurv = k;
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // Less margin for error where a barrier sits close: carry a bit less speed.
      const room = clamp((Math.min(this.wallL[i], this.wallR[i]) - this.half) / 72, 0, 1);
      v[i] = maxCornerSpeed(Math.abs(k[i]), 0.9) * (0.88 + 0.12 * room);
    }
    // Work backwards so the AI brakes before a corner, not in it.
    const B = PHYS.BRAKE * 0.72;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = n - 1; i >= 0; i--) {
        const j = (i + 1) % n;
        const d = Math.hypot(rx[j] - rx[i], ry[j] - ry[i]);
        const lim = Math.sqrt(v[j] * v[j] + 2 * B * d);
        if (lim < v[i]) v[i] = lim;
      }
    }
    this.vProfile = v;
    this.buildBrakeZones();
  }

  // Braking zones: from where a car at speed has to start braking, to the
  // slowest point of the corner. Only stops worth at least ~18% of top speed.
  buildBrakeZones() {
    const n = this.n;
    const v = this.vProfile;
    const TOP = PHYS.TOP;
    const zones = [];
    let lastMin = -99;
    for (let i = 0; i < n; i++) {
      if (v[i] > 0.85 * TOP || i - lastMin < 12) continue;
      let isMin = true;
      for (let k = 1; k <= 8 && isMin; k++) {
        if (v[(i + k) % n] < v[i] || v[(i - k + n) % n] < v[i]) isMin = false;
      }
      if (!isMin) continue;
      lastMin = i;
      let j = i;
      let steps = 0;
      while (steps < n / 2) {
        const pj = (j - 1 + n) % n;
        if (v[pj] < v[j] - 0.5) break;
        j = pj;
        steps++;
        if (v[j] >= TOP * 0.97) break;
      }
      const drop = v[j] - v[i];
      if (drop < 0.18 * TOP || steps < 6) continue;
      zones.push({ start: j, end: i, len: steps, drop, dir: Math.sign(this.rcurv[i]) || 1 });
    }
    this.brakeZones = zones;
    // Which zone's corner each sample is at (a few samples wide so a car
    // can't skip over it), for corner-exit boosts.
    this.apexAt = new Int16Array(n).fill(-1);
    zones.forEach((z, k) => {
      for (let d = 0; d < 4; d++) this.apexAt[(z.end + d) % n] = k;
    });
  }

  buildGrid() {
    const C = 128;
    const R = this.wallDist + 60;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < this.n; i++) {
      minX = Math.min(minX, this.px[i]);
      maxX = Math.max(maxX, this.px[i]);
      minY = Math.min(minY, this.py[i]);
      maxY = Math.max(maxY, this.py[i]);
    }
    this.bounds = { minX, minY, maxX, maxY };
    const x0 = minX - R - C;
    const y0 = minY - R - C;
    const gw = Math.ceil((maxX - minX + 2 * (R + C)) / C) + 1;
    const gh = Math.ceil((maxY - minY + 2 * (R + C)) / C) + 1;
    const cells = new Array(gw * gh);
    for (let i = 0; i < this.n; i++) {
      const cx0 = Math.floor((this.px[i] - R - x0) / C);
      const cx1 = Math.floor((this.px[i] + R - x0) / C);
      const cy0 = Math.floor((this.py[i] - R - y0) / C);
      const cy1 = Math.floor((this.py[i] + R - y0) / C);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const key = cy * gw + cx;
          (cells[key] || (cells[key] = [])).push(i);
        }
      }
    }
    this.grid = { x0, y0, C, gw, gh, cells };
  }

  // Figure-of-eight circuits (Suzuka) cross over themselves on a bridge. The
  // later part of the lap is the upper deck unless the circuit says otherwise.
  findCrossings() {
    const n = this.n;
    const px = this.px;
    const py = this.py;
    const o = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const found = [];
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      for (let j = i + 40; j < n; j++) {
        if (n - (j - i) < 40) continue;
        const j2 = (j + 1) % n;
        const a = o(px[i], py[i], px[i2], py[i2], px[j], py[j]) * o(px[i], py[i], px[i2], py[i2], px[j2], py[j2]);
        if (a >= 0) continue;
        const b = o(px[j], py[j], px[j2], py[j2], px[i], py[i]) * o(px[j], py[j], px[j2], py[j2], px[i2], py[i2]);
        if (b >= 0) continue;
        if (found.some((c) => Math.abs(c.a - i) < 40 && Math.abs(c.b - j) < 40)) continue;
        found.push({ a: i, b: j });
      }
    }
    this.crossings = found.map(({ a, b }) => (this.def.upperFirst ? { upper: a, lower: b } : { upper: b, lower: a }));
    this.bridgeSpan = Math.ceil((this.wallDist * 1.8) / this.ds);
  }

  // Real circuits sometimes run two stretches a few metres apart, either side
  // of one barrier. Our roads are much wider than real ones, so those would
  // overlap and merge into one blob of tarmac. Push such stretches apart
  // until there's room for a barrier between them (crossings excepted).
  separateStretches() {
    const n = this.n;
    const need = this.half * 2 + 30;
    const skip = Math.ceil((this.wallDist * 3) / this.ds);
    const C = need;
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);
    let moved = false;
    for (let iter = 0; iter < 60; iter++) {
      const cells = new Map();
      for (let i = 0; i < n; i++) {
        const k = `${Math.floor(this.px[i] / C)},${Math.floor(this.py[i] / C)}`;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(i);
      }
      dx.fill(0);
      dy.fill(0);
      let worst = 0;
      for (let i = 0; i < n; i++) {
        const x = this.px[i];
        const y = this.py[i];
        const cx = Math.floor(x / C);
        const cy = Math.floor(y / C);
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          for (let gx = cx - 1; gx <= cx + 1; gx++) {
            const list = cells.get(`${gx},${gy}`);
            if (!list) continue;
            for (const j of list) {
              const di = Math.abs(i - j);
              if (Math.min(di, n - di) < skip) continue;
              if (this.crossings.length && this.nearCrossing(i, j)) continue;
              const ex = x - this.px[j];
              const ey = y - this.py[j];
              const d = Math.hypot(ex, ey);
              if (d >= need || d < 0.01) continue;
              const push = (need - d) * 0.5;
              dx[i] += (ex / d) * push;
              dy[i] += (ey / d) * push;
              worst = Math.max(worst, need - d);
            }
          }
        }
      }
      if (worst < 2) break;
      moved = true;
      // Spread each push along the stretch so it bends gently instead of kinking.
      for (let i = 0; i < n; i++) {
        const l = Math.hypot(dx[i], dy[i]);
        const cap = Math.min(l, 12);
        if (l > 0) {
          dx[i] *= cap / l;
          dy[i] *= cap / l;
        }
      }
      smoothCircular(dx, 24);
      smoothCircular(dy, 24);
      for (let i = 0; i < n; i++) {
        this.px[i] += dx[i] * 1.6;
        this.py[i] += dy[i] * 1.6;
      }
    }
    return moved;
  }

  // Runs of the lap that pass beside a different part of the circuit (side
  // by side, not a hairpin's two legs), so the one you're not on can be
  // dimmed while you drive past.
  findNeighbours() {
    const n = this.n;
    const near = this.wallDist * 2 + 40;
    const farInLap = Math.max(150, Math.ceil((this.wallDist * 6) / this.ds));
    const partner = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i += 2) {
      let best = near;
      for (let j = 0; j < n; j += 2) {
        if (this.lapDistance(i, j) < farInLap) continue;
        const d = Math.hypot(this.px[j] - this.px[i], this.py[j] - this.py[i]);
        if (d < best) {
          best = d;
          partner[i] = j;
        }
      }
      if (i + 1 < n) partner[i + 1] = partner[i];
    }
    const runs = [];
    let cur = null;
    const close = () => {
      if (cur && cur.a1 - cur.a0 >= 6) {
        // The other run: the smallest stretch of lap holding all partners.
        const first = cur.js[0];
        let lo = 0;
        let hi = 0;
        for (const j of cur.js) {
          const o = ((j - first + n + n / 2) % n) - n / 2;
          lo = Math.min(lo, o);
          hi = Math.max(hi, o);
        }
        const a = { a0: cur.a0, a1: cur.a1, b0: (first + lo - 8 + n) % n, b1: (first + hi + 8) % n };
        const mid = (x0, x1) => (x0 + ((x1 - x0 + n) % n) / 2) % n;
        if (!(this.crossings.length && this.nearCrossing(Math.round(mid(a.a0, a.a1)), Math.round(mid(a.b0, a.b1))))) runs.push(a);
      }
      cur = null;
    };
    for (let i = 0; i < n; i++) {
      const j = partner[i];
      if (j >= 0 && cur && this.lapDistance(j, cur.js[cur.js.length - 1]) < 40) {
        cur.a1 = i;
        cur.js.push(j);
      } else {
        close();
        if (j >= 0) cur = { a0: i, a1: i, js: [j] };
      }
    }
    close();
    this.neighbours = runs;
  }

  // Indices of neighbour runs whose "our side" contains idx.
  besideRuns(idx) {
    const n = this.n;
    const out = [];
    this.neighbours.forEach((r, k) => {
      if ((idx - r.a0 + n + 10) % n <= (r.a1 - r.a0 + n) % n + 20) out.push(k);
    });
    return out;
  }

  // Darken another part of the lap's road (from b0 to b1) by `alpha`.
  dimRange(ctx, b0, b1, alpha) {
    const n = this.n;
    const len = (b1 - b0 + n) % n;
    const path = new Path2D();
    for (let k = 0; k <= len; k++) {
      const i = (b0 + k) % n;
      if (k === 0) path.moveTo(this.px[i], this.py[i]);
      else path.lineTo(this.px[i], this.py[i]);
    }
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = this.half * 2 + 10;
    ctx.strokeStyle = `rgba(4,6,10,${0.5 * alpha})`;
    ctx.stroke(path);
    ctx.restore();
  }

  nearCrossing(i, j) {
    const n = this.n;
    const span = this.bridgeSpan * 1.4;
    const d = (x, y) => Math.min(Math.abs(x - y), n - Math.abs(x - y));
    return this.crossings.some((c) => (d(i, c.upper) < span && d(j, c.lower) < span) || (d(i, c.lower) < span && d(j, c.upper) < span));
  }

  // Where two parts of a circuit run close together (common on real tracks),
  // the barrier moves in to sit halfway between them, so nobody can cut across.
  // wallL / wallR: distance from the centerline to the barrier on each side.
  buildWalls() {
    const n = this.n;
    const W = this.wallDist;
    const wl = new Float64Array(n).fill(W);
    const wr = new Float64Array(n).fill(W);
    const C = 96;
    const cells = new Map();
    const key = (cx, cy) => `${cx},${cy}`;
    for (let i = 0; i < n; i++) {
      const k = key(Math.floor(this.px[i] / C), Math.floor(this.py[i] / C));
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(i);
    }
    const skip = Math.ceil((W * 3) / this.ds); // closer than this along the lap = same stretch
    const R = 2 * W;
    const reach = Math.ceil(R / C);
    for (let i = 0; i < n; i++) {
      const x = this.px[i];
      const y = this.py[i];
      const cx = Math.floor(x / C);
      const cy = Math.floor(y / C);
      for (let gy = cy - reach; gy <= cy + reach; gy++) {
        for (let gx = cx - reach; gx <= cx + reach; gx++) {
          const list = cells.get(key(gx, gy));
          if (!list) continue;
          for (const j of list) {
            const di = Math.abs(i - j);
            if (Math.min(di, n - di) < skip) continue;
            if (this.crossings.length && this.nearCrossing(i, j)) continue; // over/under, not side by side
            const dx = this.px[j] - x;
            const dy = this.py[j] - y;
            const d = Math.hypot(dx, dy);
            if (d >= R || d < 1) continue;
            const along = (dx * this.nx[i] + dy * this.ny[i]) / d;
            if (Math.abs(along) < 0.3) continue;
            // Distance along our normal to the line halfway between the two stretches.
            const lim = Math.max(this.half + 10, d / (2 * Math.abs(along)));
            if (along > 0) wr[i] = Math.min(wr[i], lim);
            else wl[i] = Math.min(wl[i], lim);
          }
        }
      }
    }
    const smoothLimit = (a) => {
      const m = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let v = a[i];
        for (let k = -12; k <= 12; k++) v = Math.min(v, a[(i + k + n) % n]);
        m[i] = v;
      }
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let k = -8; k <= 8; k++) sum += m[(i + k + n) % n];
        out[i] = Math.min(W, sum / 17);
      }
      return out;
    };
    this.wallL = smoothLimit(wl);
    this.wallR = smoothLimit(wr);
    let pinch = W;
    for (let i = 0; i < n; i++) pinch = Math.min(pinch, this.wallL[i], this.wallR[i]);
    this.tightestWall = pinch;
  }

  // Barrier distance on the side of the centerline the point is on.
  wallAt(idx, side) {
    return side > 0 ? this.wallR[idx] : this.wallL[idx];
  }

  // Nearest point on the centerline. dist is Infinity far from the circuit.
  query(x, y, out = {}) {
    const g = this.grid;
    const cx = Math.floor((x - g.x0) / g.C);
    const cy = Math.floor((y - g.y0) / g.C);
    out.dist = Infinity;
    if (cx < 0 || cy < 0 || cx >= g.gw || cy >= g.gh) return out;
    const list = g.cells[cy * g.gw + cx];
    if (!list) return out;
    const px = this.px;
    const py = this.py;
    const n = this.n;
    let best = -1;
    let bd = Infinity;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      const dx = x - px[i];
      const dy = y - py[i];
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return this.refine(x, y, best, bd, out);
  }

  // Nearest point on the stretch of track around sample `hint` (the car's
  // own position on the lap). Used for barriers, so a car never "belongs" to
  // a different part of the circuit that happens to be close by.
  queryLocal(x, y, hint, out = {}) {
    const n = this.n;
    let best = -1;
    let bd = Infinity;
    for (let k = -20; k <= 50; k++) {
      const i = (hint + k + n) % n;
      const dx = x - this.px[i];
      const dy = y - this.py[i];
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (bd > (this.wallDist * 2) ** 2) return this.query(x, y, out);
    return this.refine(x, y, best, bd, out);
  }

  refine(x, y, best, bd, out) {
    const px = this.px;
    const py = this.py;
    const n = this.n;
    let bx = px[best];
    let by = py[best];
    const ax = bx;
    const ay = by;
    for (let s = -1; s <= 1; s += 2) {
      const j = (best + s + n) % n;
      const ex = px[j] - ax;
      const ey = py[j] - ay;
      const l2 = ex * ex + ey * ey || 1;
      const t = clamp(((x - ax) * ex + (y - ay) * ey) / l2, 0, 1);
      const qx = ax + ex * t;
      const qy = ay + ey * t;
      const d = (x - qx) * (x - qx) + (y - qy) * (y - qy);
      if (d < bd) {
        bd = d;
        bx = qx;
        by = qy;
      }
    }
    const dist = Math.sqrt(bd);
    out.dist = dist;
    out.idx = best;
    out.cx = bx;
    out.cy = by;
    if (dist > 1e-3) {
      out.nx = (x - bx) / dist;
      out.ny = (y - by) / dist;
    } else {
      out.nx = this.nx[best];
      out.ny = this.ny[best];
    }
    out.side = out.nx * this.nx[best] + out.ny * this.ny[best] >= 0 ? 1 : -1;
    return out;
  }

  // Nearest sample close to the previous one: used for lap progress, so a car
  // never "jumps" to a different part of the circuit that happens to be close.
  localIndex(x, y, hint) {
    const n = this.n;
    let best = hint;
    let bd = Infinity;
    for (let k = -14; k <= 40; k++) {
      const i = (hint + k + n) % n;
      const dx = x - this.px[i];
      const dy = y - this.py[i];
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    this.lastLocalD2 = bd;
    return best;
  }

  buildKerbs() {
    const n = this.n;
    const raw = new Uint8Array(n);
    for (let i = 0; i < n; i++) raw[i] = Math.abs(this.curv[i]) > KERB_CURV ? 1 : 0;
    const kerb = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (!raw[i]) continue;
      for (let k = -5; k <= 5; k++) kerb[(i + k + n) % n] = 1;
    }
    this.kerb = kerb;
  }

  kerbAt(i) {
    return this.kerb[i] === 1;
  }

  countCorners() {
    const n = this.n;
    let count = 0;
    let gap = 99;
    let inCorner = false;
    let dir = 0;
    for (let i = 0; i < n; i++) {
      const c = this.curv[i];
      const turning = Math.abs(c) > 1 / 1100;
      if (turning) {
        const d = Math.sign(c);
        if (!inCorner && (gap > 14 || d !== dir)) count++;
        inCorner = true;
        dir = d;
        gap = 0;
      } else {
        inCorner = false;
        gap++;
      }
    }
    this.corners = count;
  }

  // Grid slot k (0 = pole), staggered two by two behind the line.
  gridSlot(k, extraBack = 0) {
    const n = this.n;
    const back = 70 + k * 40 + extraBack;
    const i = (((-Math.round(back / this.ds)) % n) + n) % n;
    const lat = (k % 2 === 0 ? -1 : 1) * 32;
    return {
      x: this.px[i] + this.nx[i] * lat,
      y: this.py[i] + this.ny[i] * lat,
      angle: Math.atan2(this.ty[i], this.tx[i]),
      idx: i,
    };
  }

  buildDecor() {
    const rnd = mulberry32(hashString(this.id));
    const b = this.bounds;
    const pad = 900;
    const W = b.maxX - b.minX + 2 * pad;
    const H = b.maxY - b.minY + 2 * pad;
    const tries = Math.floor(((W * H) / 24000) * (this.theme.density || 1));
    const items = [];
    const q = {};
    for (let t = 0; t < tries; t++) {
      const x = b.minX - pad + rnd() * W;
      const y = b.minY - pad + rnd() * H;
      this.query(x, y, q);
      if (q.dist < this.wallDist + 36) continue;
      const near = q.dist === Infinity ? 0.2 : clamp(1 - (q.dist - this.wallDist) / 900, 0.2, 1);
      if (rnd() > near) continue;
      items.push({ x, y, r: 15 + rnd() * 22, s: rnd(), a: rnd() * Math.PI * 2 });
    }
    this.decor = items;

    // Grandstands on the outside of the start straight.
    const stands = [];
    const n = this.n;
    const side = this.outsideSign;
    const offset = this.wallDist + 44;
    for (let k = -54; k <= 24; k += 6) {
      const i = (k + n) % n;
      const x = this.px[i] + this.nx[i] * side * offset;
      const y = this.py[i] + this.ny[i] * side * offset;
      const ok = [-22, 0, 22].every((d) => {
        const r = this.query(x + this.nx[i] * side * d, y + this.ny[i] * side * d, q);
        return r.dist > this.wallDist + 16;
      });
      if (!ok) continue;
      const crowd = [];
      for (let c = 0; c < 22; c++) crowd.push([rnd() * 46 - 23, rnd() * 34 - 17, Math.floor(rnd() * 8)]);
      stands.push({ x, y, angle: Math.atan2(this.ty[i], this.tx[i]), len: this.ds * 6 + 1, crowd });
    }
    this.stands = stands;
  }

  // ---------- drawing ----------

  ensureGeo() {
    if (this.geo) return this.geo;
    const n = this.n;
    const th = this.theme;
    const chunks = [];
    for (let s = 0; s < n; s += CHUNK) {
      const e = Math.min(n, s + CHUNK);
      const path = new Path2D();
      const left = new Path2D();
      const right = new Path2D();
      const wallLeft = new Path2D();
      const wallRight = new Path2D();
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const edge = this.half - 5;
      for (let i = s - 2; i <= e + 1; i++) {
        const k = (i + n) % n;
        const x = this.px[k];
        const y = this.py[k];
        const lx = x - this.nx[k] * edge;
        const ly = y - this.ny[k] * edge;
        const rx = x + this.nx[k] * edge;
        const ry = y + this.ny[k] * edge;
        const wlx = x - this.nx[k] * (this.wallL[k] + 3);
        const wly = y - this.ny[k] * (this.wallL[k] + 3);
        const wrx = x + this.nx[k] * (this.wallR[k] + 3);
        const wry = y + this.ny[k] * (this.wallR[k] + 3);
        if (i === s - 2) {
          path.moveTo(x, y);
          left.moveTo(lx, ly);
          right.moveTo(rx, ry);
          wallLeft.moveTo(wlx, wly);
          wallRight.moveTo(wrx, wry);
        } else {
          path.lineTo(x, y);
          left.lineTo(lx, ly);
          right.lineTo(rx, ry);
          wallLeft.lineTo(wlx, wly);
          wallRight.lineTo(wrx, wry);
        }
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      const pad = this.wallDist + 20;
      chunks.push({
        s,
        path,
        left,
        right,
        wallLeft,
        wallRight,
        kerbA: new Path2D(),
        kerbB: new Path2D(),
        minX: minX - pad,
        minY: minY - pad,
        maxX: maxX + pad,
        maxY: maxY + pad,
      });
    }
    // Kerbs: alternating blocks on both edges of tight corners.
    for (let i = 0; i < n; i++) {
      if (!this.kerb[i]) continue;
      const j = (i + 1) % n;
      const ch = chunks[Math.floor(i / CHUNK)];
      const p = Math.floor(i / 2) % 2 === 0 ? ch.kerbA : ch.kerbB;
      for (const side of [-1, 1]) {
        const a = this.half - 7;
        const b = this.half + 10;
        p.moveTo(this.px[i] + this.nx[i] * side * a, this.py[i] + this.ny[i] * side * a);
        p.lineTo(this.px[i] + this.nx[i] * side * b, this.py[i] + this.ny[i] * side * b);
        p.lineTo(this.px[j] + this.nx[j] * side * b, this.py[j] + this.ny[j] * side * b);
        p.lineTo(this.px[j] + this.nx[j] * side * a, this.py[j] + this.ny[j] * side * a);
        p.closePath();
      }
    }
    const full = new Path2D();
    const rubber = new Path2D();
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      if (i === 0) {
        full.moveTo(this.px[k], this.py[k]);
        rubber.moveTo(this.rx[k], this.ry[k]);
      } else {
        full.lineTo(this.px[k], this.py[k]);
        rubber.lineTo(this.rx[k], this.ry[k]);
      }
    }
    full.closePath();
    rubber.closePath();
    // Braking zones as a strip of racing line that fades from strong red at the
    // braking point to faint at the corner.
    const brakeParts = [];
    const boards = [];
    for (const z of this.brakeZones) {
      const parts = 6;
      for (let p = 0; p < parts; p++) {
        const a = z.start + Math.floor((z.len * p) / parts);
        const b = z.start + Math.floor((z.len * (p + 1)) / parts) + 1;
        const path = new Path2D();
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let i = a; i <= b; i++) {
          const k = i % n;
          if (i === a) path.moveTo(this.rx[k], this.ry[k]);
          else path.lineTo(this.rx[k], this.ry[k]);
          minX = Math.min(minX, this.rx[k]);
          maxX = Math.max(maxX, this.rx[k]);
          minY = Math.min(minY, this.ry[k]);
          maxY = Math.max(maxY, this.ry[k]);
        }
        brakeParts.push({ path, alpha: 0.5 - (0.36 * p) / (parts - 1), minX: minX - 30, minY: minY - 30, maxX: maxX + 30, maxY: maxY + 30 });
      }
      // 3-2-1 boards on the outside of the big stops, "3" at the braking point.
      if (z.drop < 0.3 * PHYS.TOP) continue;
      const side = -z.dir;
      [3, 2, 1].forEach((num, k) => {
        const i = (z.start + Math.floor((z.len * k) / 3)) % n;
        const off = this.half + 26;
        boards.push({
          num,
          x: this.px[i] + this.nx[i] * side * off,
          y: this.py[i] + this.ny[i] * side * off,
          angle: Math.atan2(this.ty[i], this.tx[i]),
        });
      });
    }

    this.geo = {
      brakeParts,
      boards,
      chunks,
      full,
      rubber,
      groundPat: makePattern(th.groundKind || 'ground', th),
      runoffPat: makePattern(th.runoffKind || 'grass', th),
    };
    return this.geo;
  }

  visibleChunks(view) {
    const g = this.ensureGeo();
    return g.chunks.filter((c) => c.maxX >= view.minX && c.minX <= view.maxX && c.maxY >= view.minY && c.minY <= view.maxY);
  }

  drawGround(ctx, view) {
    const g = this.ensureGeo();
    ctx.fillStyle = g.groundPat || this.theme.groundColor;
    ctx.fillRect(view.minX, view.minY, view.maxX - view.minX, view.maxY - view.minY);
  }

  drawSurface(ctx, view, hints = true) {
    const g = this.ensureGeo();
    const th = this.theme;
    const vis = this.visibleChunks(view);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';

    ctx.lineWidth = this.wallDist * 2;
    ctx.strokeStyle = g.runoffPat || th.runoff;
    for (const c of vis) ctx.stroke(c.path);

    // Barriers: red/white blocks along the wall line on both sides.
    ctx.lineWidth = 8;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = th.barrierA;
    for (const c of vis) {
      ctx.stroke(c.wallLeft);
      ctx.stroke(c.wallRight);
    }
    ctx.setLineDash([26, 26]);
    ctx.strokeStyle = th.barrierB;
    for (const c of vis) {
      ctx.stroke(c.wallLeft);
      ctx.stroke(c.wallRight);
    }
    ctx.setLineDash([]);

    ctx.lineWidth = this.half * 2 + 4;
    ctx.strokeStyle = th.asphaltEdge;
    for (const c of vis) ctx.stroke(c.path);
    ctx.lineWidth = this.half * 2;
    ctx.strokeStyle = th.asphalt;
    for (const c of vis) ctx.stroke(c.path);

    // Rubbered-in racing line: a faint hint of where the fast way round is.
    ctx.lineWidth = 44;
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.stroke(g.rubber);

    if (hints) {
      ctx.lineCap = 'round';
      ctx.lineWidth = 34;
      for (const p of g.brakeParts) {
        if (p.maxX < view.minX || p.minX > view.maxX || p.maxY < view.minY || p.minY > view.maxY) continue;
        ctx.strokeStyle = `rgba(255,52,40,${p.alpha})`;
        ctx.stroke(p.path);
      }
      ctx.lineCap = 'butt';
    }

    ctx.lineWidth = 3;
    ctx.strokeStyle = th.edge;
    for (const c of vis) {
      ctx.stroke(c.left);
      ctx.stroke(c.right);
    }
    ctx.fillStyle = th.kerbA;
    for (const c of vis) ctx.fill(c.kerbA);
    ctx.fillStyle = th.kerbB;
    for (const c of vis) ctx.fill(c.kerbB);

    this.drawStartLine(ctx);
    if (hints) this.drawBoards(ctx, view);
  }

  // Stretch of the upper deck around each crossing (sample indices).
  bridgeRange(c) {
    return [c.upper - this.bridgeSpan, c.upper + this.bridgeSpan];
  }

  onBridge(idx) {
    const n = this.n;
    return this.crossings.some((c) => {
      const d = Math.min(Math.abs(idx - c.upper), n - Math.abs(idx - c.upper));
      return d <= this.bridgeSpan + 6;
    });
  }

  // Darken a stretch of the circuit (the road you're crossing over).
  dimStretch(ctx, center, span) {
    const n = this.n;
    const path = new Path2D();
    for (let i = center - span; i <= center + span; i++) {
      const k = ((i % n) + n) % n;
      if (i === center - span) path.moveTo(this.px[k], this.py[k]);
      else path.lineTo(this.px[k], this.py[k]);
    }
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = this.wallDist * 2;
    ctx.strokeStyle = 'rgba(4,6,10,0.42)';
    ctx.stroke(path);
    ctx.restore();
  }

  // One upper deck. alpha < 1 when you're driving underneath it, so your own
  // road stays readable.
  drawBridge(ctx, c, alpha = 1) {
    const n = this.n;
    const th = this.theme;
    const [a, b] = this.bridgeRange(c);
    const path = new Path2D();
    const left = new Path2D();
    const right = new Path2D();
    const shadow = new Path2D();
    for (let i = a; i <= b; i++) {
      const k = ((i % n) + n) % n;
      const x = this.px[k];
      const y = this.py[k];
      const e = this.half - 5;
      const m = i === a ? 'moveTo' : 'lineTo';
      path[m](x, y);
      shadow[m](x + 10, y + 14);
      left[m](x - this.nx[k] * e, y - this.ny[k] * e);
      right[m](x + this.nx[k] * e, y + this.ny[k] * e);
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    ctx.lineWidth = this.half * 2 + 30;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke(shadow);
    ctx.strokeStyle = '#8c9096';
    ctx.stroke(path);
    ctx.lineWidth = this.half * 2 + 18;
    ctx.strokeStyle = '#5d6168';
    ctx.stroke(path);
    ctx.lineWidth = this.half * 2;
    ctx.strokeStyle = th.asphalt;
    ctx.stroke(path);
    ctx.lineWidth = 3;
    ctx.strokeStyle = th.edge;
    ctx.stroke(left);
    ctx.stroke(right);
    ctx.restore();
  }

  // How far (in samples) idx is from a point on the lap.
  lapDistance(idx, at) {
    const d = Math.abs(idx - at);
    return Math.min(d, this.n - d);
  }

  drawBoards(ctx, view) {
    const m = 40;
    for (const b of this.geo.boards) {
      if (b.x < view.minX - m || b.x > view.maxX + m || b.y < view.minY - m || b.y > view.maxY + m) continue;
      ctx.save();
      ctx.translate(b.x, b.y);
      // Number reads upright for a driver coming toward it.
      ctx.rotate(b.angle + Math.PI / 2);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(-10, -12, 24, 28);
      ctx.fillStyle = '#f4f4f4';
      ctx.fillRect(-12, -14, 24, 28);
      ctx.strokeStyle = '#15161a';
      ctx.lineWidth = 2;
      ctx.strokeRect(-12, -14, 24, 28);
      ctx.fillStyle = '#15161a';
      ctx.font = '900 20px "Saira Condensed", "Arial Narrow", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(b.num), 0, 1);
      ctx.restore();
    }
  }

  drawStartLine(ctx) {
    const i = 0;
    const x = this.px[i];
    const y = this.py[i];
    const a = Math.atan2(this.ty[i], this.tx[i]);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    const sq = 8;
    const rows = 2;
    for (let r = 0; r < rows; r++) {
      for (let c = -Math.floor(this.half / sq); c < Math.floor(this.half / sq); c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#f4f4f4' : '#15161a';
        ctx.fillRect(r * sq - sq, c * sq, sq, sq);
      }
    }
    ctx.restore();
    // Grid boxes.
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2.5;
    for (let k = 0; k < 22; k++) {
      const s = this.gridSlot(k);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      ctx.beginPath();
      ctx.moveTo(14, -14);
      ctx.lineTo(26, -14);
      ctx.lineTo(26, 14);
      ctx.lineTo(14, 14);
      ctx.stroke();
      ctx.restore();
    }
  }

  // The start-light gantry over the line. lit = 0..5 red lights on.
  drawGantry(ctx, lit) {
    const i = 3;
    const x = this.px[i];
    const y = this.py[i];
    const a = Math.atan2(this.ty[i], this.tx[i]);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(6, -this.half - 26 + 8, 14, (this.half + 26) * 2);
    ctx.fillStyle = '#20242c';
    ctx.fillRect(-2, -this.half - 26, 14, (this.half + 26) * 2);
    ctx.fillStyle = '#3a404c';
    ctx.fillRect(-2, -this.half - 26, 14, 3);
    for (let k = 0; k < 5; k++) {
      const ly = (k - 2) * 15;
      const on = k < lit;
      if (on) {
        ctx.fillStyle = 'rgba(255,40,30,0.35)';
        ctx.beginPath();
        ctx.arc(5, ly, 11, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = on ? '#ff2a1f' : '#0c0d10';
      ctx.beginPath();
      ctx.arc(5, ly, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawDecor(ctx, view) {
    const th = this.theme;
    const kind = th.decor;
    const m = 60;
    for (const s of this.stands) {
      if (s.x < view.minX - m || s.x > view.maxX + m || s.y < view.minY - m || s.y > view.maxY + m) continue;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(-s.len / 2 + 6, -21, s.len, 50);
      ctx.fillStyle = '#2a303c';
      ctx.fillRect(-s.len / 2, -25, s.len, 50);
      ctx.fillStyle = '#394151';
      for (let r = -20; r < 25; r += 9) ctx.fillRect(-s.len / 2, r, s.len, 2);
      for (const [cx, cy, ci] of s.crowd) {
        ctx.fillStyle = CROWD[ci];
        ctx.fillRect(cx * (s.len / 46), cy, 3.2, 3.2);
      }
      ctx.restore();
    }
    for (const d of this.decor) {
      if (d.x < view.minX - m || d.x > view.maxX + m || d.y < view.minY - m || d.y > view.maxY + m) continue;
      if (kind === 'trees') drawTree(ctx, d, th);
      else if (kind === 'city') {
        if (d.s < 0.45) drawTree(ctx, d, th);
        else drawBuilding(ctx, d, th);
      } else if (kind === 'street') {
        if (d.s < 0.12) drawTree(ctx, d, th);
        else drawBuilding(ctx, d, th);
      } else if (kind === 'night') {
        if (d.s < 0.1) drawTree(ctx, d, th);
        else drawNightBuilding(ctx, d, th);
      } else if (kind === 'palms') {
        if (d.s < 0.75) drawPalm(ctx, d, th);
        else drawBuilding(ctx, d, th);
      } else if (kind === 'boats') drawBoat(ctx, d, th);
      else drawDesert(ctx, d, th);
    }
  }

  drawMinimap(ctx, x, y, size, cars, focus) {
    const g = this.ensureGeo();
    const b = this.bounds;
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const s = size / Math.max(w, h);
    const ox = x + (size - w * s) / 2 - b.minX * s;
    const oy = y + (size - h * s) / 2 - b.minY * s;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 8 / s;
    ctx.stroke(g.full);
    ctx.strokeStyle = 'rgba(238,242,248,0.9)';
    ctx.lineWidth = 3 / s;
    ctx.stroke(g.full);
    ctx.restore();
    // Start line tick.
    const sx = ox + this.px[0] * s;
    const sy = oy + this.py[0] * s;
    ctx.strokeStyle = '#ff2a1f';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(sx - this.nx[0] * 6, sy - this.ny[0] * 6);
    ctx.lineTo(sx + this.nx[0] * 6, sy + this.ny[0] * 6);
    ctx.stroke();
    for (const c of cars) {
      if (c === focus) continue;
      ctx.fillStyle = c.livery.color;
      ctx.beginPath();
      ctx.arc(ox + c.x * s, oy + c.y * s, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    if (focus) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(ox + focus.x * s, oy + focus.y * s, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = focus.livery.color;
      ctx.beginPath();
      ctx.arc(ox + focus.x * s, oy + focus.y * s, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Small preview for the circuit picker.
  drawThumb(canvas) {
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth || canvas.width;
    const H = canvas.clientHeight || canvas.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const g = this.ensureGeo();
    const b = this.bounds;
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const pad = 10;
    const s = Math.min((W - pad * 2) / w, (H - pad * 2) / h);
    ctx.save();
    ctx.translate((W - w * s) / 2 - b.minX * s, (H - h * s) / 2 - b.minY * s);
    ctx.scale(s, s);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = this.theme.thumb;
    ctx.lineWidth = 7 / s;
    ctx.stroke(g.full);
    ctx.strokeStyle = '#eef2f8';
    ctx.lineWidth = 2.6 / s;
    ctx.stroke(g.full);
    ctx.restore();
    const sx = (W - w * s) / 2 + (this.px[0] - b.minX) * s;
    const sy = (H - h * s) / 2 + (this.py[0] - b.minY) * s;
    ctx.fillStyle = '#ff2a1f';
    ctx.beginPath();
    ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Small preview for the circuit picker, drawn straight from the control
// points so the list doesn't have to build every circuit.
export function drawTrackThumb(canvas, def) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth || canvas.width;
  const H = canvas.clientHeight || canvas.height;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const pts = def.points.map(([x, y]) => [x * def.scale, y * def.scale]);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const pad = 9;
  const s = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxY - minY));
  const ox = (W - (maxX - minX) * s) / 2 - minX * s;
  const oy = (H - (maxY - minY) * s) / 2 - minY * s;
  ctx.lineJoin = 'round';
  const path = () => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(ox + x * s, oy + y * s) : ctx.moveTo(ox + x * s, oy + y * s)));
    ctx.closePath();
  };
  path();
  ctx.strokeStyle = def.theme.thumb;
  ctx.lineWidth = 6;
  ctx.stroke();
  path();
  ctx.strokeStyle = '#eef2f8';
  ctx.lineWidth = 2.4;
  ctx.stroke();
  ctx.fillStyle = '#ff2a1f';
  ctx.beginPath();
  ctx.arc(ox + pts[0][0] * s, oy + pts[0][1] * s, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

const CROWD = ['#ff5a4f', '#ffd23f', '#f4f4f4', '#3fa9ff', '#31d67b', '#ff9a3d', '#b65cff', '#ff7ab8'];

function drawTree(ctx, d, th) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.arc(d.x + d.r * 0.3, d.y + d.r * 0.4, d.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = th.tree[Math.floor(d.s * th.tree.length)];
  ctx.beginPath();
  ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  ctx.beginPath();
  ctx.arc(d.x - d.r * 0.28, d.y - d.r * 0.3, d.r * 0.55, 0, Math.PI * 2);
  ctx.fill();
}

function drawBuilding(ctx, d, th) {
  const w = d.r * 1.5;
  const h = d.r * 1.05;
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.rotate(d.a);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(-w / 2 + 6, -h / 2 + 8, w, h);
  ctx.fillStyle = th.building[Math.floor(d.s * 97) % th.building.length];
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(-w / 6, -h / 6, w / 4, h / 4);
  ctx.restore();
}

function drawNightBuilding(ctx, d, th) {
  const w = d.r * 1.6;
  const h = d.r * 1.1;
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.rotate(d.a);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(-w / 2 + 6, -h / 2 + 8, w, h);
  ctx.fillStyle = th.building[Math.floor(d.s * 97) % th.building.length];
  ctx.fillRect(-w / 2, -h / 2, w, h);
  // Lit windows on the roof edge, different on every building.
  const seed = Math.floor(d.s * 1000);
  ctx.fillStyle = th.windows || 'rgba(255,214,120,0.85)';
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 4; j++) {
      if ((i * 7 + j * 13 + seed) % 3 === 0) continue;
      ctx.fillRect(-w / 2 + 3 + (i * (w - 6)) / 6, -h / 2 + 3 + (j * (h - 6)) / 4, (w - 6) / 6 - 2, (h - 6) / 4 - 2);
    }
  }
  ctx.restore();
}

function drawPalm(ctx, d, th) {
  const r = d.r * 0.9;
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.arc(d.x + r * 0.35, d.y + r * 0.45, r * 0.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.rotate(d.a);
  const fronds = 7;
  for (let k = 0; k < fronds; k++) {
    ctx.rotate((Math.PI * 2) / fronds);
    ctx.fillStyle = th.tree[k % th.tree.length];
    ctx.beginPath();
    ctx.ellipse(r * 0.5, 0, r * 0.55, r * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#6b4f2a';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBoat(ctx, d, th) {
  if (d.s < 0.45) return; // keep the water mostly open
  const L = d.r * 1.6;
  const W = d.r * 0.55;
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.rotate(d.a);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-L * 0.6, -W * 0.5);
  ctx.lineTo(-L * 1.6, -W * 1.4);
  ctx.moveTo(-L * 0.6, W * 0.5);
  ctx.lineTo(-L * 1.6, W * 1.4);
  ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(4, 5, L * 0.62, W * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f4f6f8';
  ctx.beginPath();
  ctx.moveTo(L * 0.6, 0);
  ctx.quadraticCurveTo(L * 0.2, -W, -L * 0.55, -W * 0.7);
  ctx.lineTo(-L * 0.55, W * 0.7);
  ctx.quadraticCurveTo(L * 0.2, W, L * 0.6, 0);
  ctx.fill();
  ctx.fillStyle = th.boatDeck[Math.floor(d.s * 10) % th.boatDeck.length];
  ctx.fillRect(-L * 0.35, -W * 0.38, L * 0.45, W * 0.76);
  ctx.restore();
}

function drawDesert(ctx, d, th) {
  if (d.s < 0.55) {
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(d.x + 5, d.y + 6, d.r * 0.8, d.r * 0.55, d.a, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = th.rock[Math.floor(d.s * 10) % th.rock.length];
    ctx.beginPath();
    ctx.ellipse(d.x, d.y, d.r * 0.8, d.r * 0.55, d.a, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const r = d.r * 0.45;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.arc(d.x + 4, d.y + 6, r * 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3f7d3a';
    ctx.beginPath();
    ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
    ctx.arc(d.x + Math.cos(d.a) * r * 1.5, d.y + Math.sin(d.a) * r * 1.5, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5a9d4f';
    ctx.beginPath();
    ctx.arc(d.x - r * 0.25, d.y - r * 0.25, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
}

function makePattern(kind, th) {
  if (typeof document === 'undefined') return null;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  const rnd = mulberry32(hashString(kind + th.runoff));
  if (kind === 'grass') {
    g.fillStyle = th.runoff;
    g.fillRect(0, 0, S, S);
    g.fillStyle = th.runoff2;
    for (let k = -1; k <= 4; k++) {
      const o = k * 128;
      g.beginPath();
      g.moveTo(o, 0);
      g.lineTo(o + 64, 0);
      g.lineTo(o + 64 - S, S);
      g.lineTo(o - S, S);
      g.closePath();
      g.fill();
    }
    speckle(g, rnd, S, 260, 'rgba(0,0,0,0.06)', 2.5);
  } else if (kind === 'sand') {
    g.fillStyle = th.runoff;
    g.fillRect(0, 0, S, S);
    speckle(g, rnd, S, 420, 'rgba(90,60,20,0.12)', 2);
    speckle(g, rnd, S, 200, 'rgba(255,255,255,0.12)', 1.6);
  } else if (kind === 'water') {
    g.fillStyle = th.groundColor;
    g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 2;
    for (let k = 0; k < 26; k++) {
      const x = rnd() * S;
      const y = rnd() * S;
      g.beginPath();
      g.arc(x, y, 10 + rnd() * 10, Math.PI * 1.15, Math.PI * 1.85);
      g.stroke();
    }
  } else if (kind === 'concrete') {
    g.fillStyle = th.groundColor;
    g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(0,0,0,0.08)';
    g.lineWidth = 2;
    for (let k = 0; k <= S; k += 64) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k, S);
      g.moveTo(0, k);
      g.lineTo(S, k);
      g.stroke();
    }
    speckle(g, rnd, S, 380, 'rgba(255,255,255,0.05)', 2);
    speckle(g, rnd, S, 380, 'rgba(0,0,0,0.06)', 2);
  } else if (kind === 'paved') {
    g.fillStyle = th.runoff;
    g.fillRect(0, 0, S, S);
    speckle(g, rnd, S, 500, 'rgba(255,255,255,0.05)', 1.6);
    speckle(g, rnd, S, 500, 'rgba(0,0,0,0.07)', 1.6);
  } else if (kind === 'night') {
    g.fillStyle = th.groundColor;
    g.fillRect(0, 0, S, S);
    speckle(g, rnd, S, 260, 'rgba(255,255,255,0.03)', 2);
    for (let k = 0; k < 5; k++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const gr = g.createRadialGradient(x, y, 0, x, y, 26);
      gr.addColorStop(0, 'rgba(255,200,120,0.10)');
      gr.addColorStop(1, 'rgba(255,200,120,0)');
      g.fillStyle = gr;
      g.fillRect(x - 26, y - 26, 52, 52);
    }
  } else if (kind === 'dunes') {
    g.fillStyle = th.groundColor;
    g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(120,80,30,0.12)';
    g.lineWidth = 3;
    for (let y = 8; y < S; y += 22) {
      g.beginPath();
      for (let x = 0; x <= S; x += 8) g.lineTo(x, y + Math.sin((x / S) * Math.PI * 4) * 5);
      g.stroke();
    }
    speckle(g, rnd, S, 300, 'rgba(90,60,20,0.1)', 2);
  } else {
    g.fillStyle = th.groundColor;
    g.fillRect(0, 0, S, S);
    for (let k = 0; k < 14; k++) {
      g.fillStyle = 'rgba(0,0,0,0.06)';
      g.beginPath();
      g.arc(rnd() * S, rnd() * S, 18 + rnd() * 30, 0, Math.PI * 2);
      g.fill();
    }
    speckle(g, rnd, S, 300, 'rgba(255,255,255,0.04)', 2.5);
  }
  const p = g.createPattern(c, 'repeat');
  return p;
}

function speckle(g, rnd, S, count, color, size) {
  g.fillStyle = color;
  for (let k = 0; k < count; k++) g.fillRect(rnd() * S, rnd() * S, size, size);
}
