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

// Racing line: how far it keeps from the road edge, from a barrier and from
// a sausage kerb, and the coarse-to-fine passes (band spacing in samples,
// iterations).
export const LINE = { edge: 24, wall: 72, kerb: 44, levels: [[8, 260], [4, 140], [2, 100]] };

// Chicanes rebuilt at game scale (see Track.shapeChicanes): how sharp each
// kind turns (degrees) and how far it steps sideways (× the road's
// half-width); the radius of its two turns (× half-width) and how much
// straight (px) either side eases the sideways step back out.
// `kerb`: how far (× half-width) the sausage kerb on the inside of each
// turn stands into the road; `span`: how long it is (samples either side).
export const CHICANE = {
  slow: { angle: 60, shift: 2.2, kerb: 0.7 },
  medium: { angle: 48, shift: 2.0, kerb: 0.55 },
  fast: { angle: 38, shift: 1.8, kerb: 0.4 },
  radius: 1.7,
  ease: 650,
  span: 14,
};

// 3-2-1 boards: braking at `brake` × full braking (a little in hand), only
// for stops that lose at least `minDrop` × top speed. The boards stand
// `gap` seconds apart at the speed you arrive with; "1" is where to brake.
export const HINTS = { brake: 0.7, minDrop: 0.2, gap: 0.2 };

// Corner calls ("HARD LEFT", "CHICANE"...): every corner that costs at least
// `lift` × top speed gets one; a stop of HINTS.minDrop or more is a braking
// corner, and a braking corner that turns `hairpin` degrees or more and is
// taken below `slow` × top speed is a hairpin.
export const CALLS = { lift: 0.06, hairpin: 135, slow: 0.5 };

// Pit lane: beside the start straight, behind the track's own barrier (the
// pit wall), on the inside of the lap unless only the outside has room.
// Offsets are past that barrier: the fast lane's middle at `lane` (`laneHalf`
// either side), the boxes where cars stop at `box`, garages from `garage`,
// `depth` deep. Ramps in and out are `ramp` px long and the `boxes` team
// boxes `gap` px apart, with `pad` px of speed-limited lane either side of
// them; about `before` of it lies before the line. A car turns in by running
// its centre `enter` px or less from the road edge at the pit entry, where a
// dashed line `guide` px in from the edge marks the way.
export const PIT = { lane: 40, laneHalf: 26, box: 90, garage: 120, depth: 54, ramp: 380, gap: 70, pad: 60, boxes: 11, before: 0.55, enter: 18, guide: 18 };

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

// Is sample i within the lap stretch a..b (going forward, wrapping)?
function inLapRange(i, a, b, n) {
  const span = (((b - a) % n) + n) % n;
  return (((i - a) % n) + n) % n <= span;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Re-space the points of a closed polyline evenly along its length.
function resampleLoop(X, Y, m) {
  const k = X.length;
  const cum = new Float64Array(k + 1);
  for (let i = 0; i < k; i++) {
    const j = (i + 1) % k;
    cum[i + 1] = cum[i] + Math.hypot(X[j] - X[i], Y[j] - Y[i]);
  }
  const L = cum[k];
  const nx = new Float64Array(m);
  const ny = new Float64Array(m);
  let j = 0;
  for (let q = 0; q < m; q++) {
    const s = (q * L) / m;
    while (j < k - 1 && cum[j + 1] < s) j++;
    const f = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    const b = (j + 1) % k;
    nx[q] = X[j] + (X[b] - X[j]) * f;
    ny[q] = Y[j] + (Y[b] - Y[j]) * f;
  }
  return [nx, ny];
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
    if (def.chicanes?.some((c) => c.rebuild !== false)) this.shapeChicanes(def.chicanes.filter((c) => c.rebuild !== false));
    this.findCrossings();
    if (this.separateStretches()) {
      // Rebuild from the moved points so spacing and directions stay even.
      const pts = [];
      for (let i = 0; i < this.n; i++) pts.push({ x: this.px[i], y: this.py[i] });
      this.buildCenterline(pts);
      this.findCrossings();
    }
    this.buildWalls();
    this.placeSausages(def.chicanes || []);
    this.findNeighbours();
    this.buildRacingLine();
    this.buildSpeedProfile();
    this.buildGrid();
    this.buildKerbs();
    this.countCorners();
    this.buildPit();
    this.buildDecor();
    this.geo = null; // drawing paths, built on first draw
  }

  // Real chicanes are tight zig-zags on a narrow road. At our road width
  // and scale they flatten into a wiggle you can drive straight through, so
  // each listed one ({ at: lap fraction, kind, before/after: px }) is
  // rebuilt as a proper Z: two sharp turns joined by a short diagonal,
  // stepping sideways further than the road is wide, with that step eased
  // back out along the straight either side. The rest of the lap stays put.
  shapeChicanes(list) {
    const n = this.n;
    const jobs = list
      .map((c) => {
        const mid = Math.round(c.at * n);
        const a = Math.max(1, mid - Math.round((c.before ?? CHICANE.ease) / this.ds));
        const b = Math.min(n - 2, mid + Math.round((c.after ?? CHICANE.ease) / this.ds));
        // It steps the way its first sharp turn goes.
        let dir = c.dir ?? 0;
        for (let i = mid - 50; !dir && i <= mid + 50; i++) {
          const k = this.curv[(i + n) % n];
          if (Math.abs(k) > 1 / 320) dir = Math.sign(k);
        }
        return { a, b, mid, kind: CHICANE[c.kind] || CHICANE.slow, dir: dir || 1 };
      })
      .sort((p, q) => p.a - q.a);
    const out = [];
    let i = 0;
    for (const job of jobs) {
      for (; i < job.a; i++) out.push({ x: this.px[i], y: this.py[i] });
      out.push(...this.chicanePoints(job));
      i = job.b + 1;
    }
    for (; i < n; i++) out.push({ x: this.px[i], y: this.py[i] });
    this.buildCenterline(out);
  }

  // Sausage kerbs: raised blocks on the inside of each chicane turn that
  // stand out into the road. The car treats them as a barrier, so the
  // chicane can't be straight-lined. Barriers are still drawn where they were.
  placeSausages(list) {
    const n = this.n;
    // Drawn barriers: on the inside of a turn tighter than the barrier is far
    // away, the line would fold over itself, so pull it in (drawing only).
    this.fenceL = Float32Array.from(this.wallL);
    this.fenceR = Float32Array.from(this.wallR);
    this.kerbL = new Float32Array(n).fill(Infinity);
    this.kerbR = new Float32Array(n).fill(Infinity);
    this.barrierL = Float32Array.from(this.wallL);
    this.barrierR = Float32Array.from(this.wallR);
    for (let i = 0; i < n; i++) {
      const c = this.curv[i];
      if (Math.abs(c) < 1e-6) continue;
      const fit = Math.max(this.half + 12, 0.9 / Math.abs(c));
      if (c > 0) this.barrierR[i] = Math.min(this.barrierR[i], fit);
      else this.barrierL[i] = Math.min(this.barrierL[i], fit);
    }
    this.sausages = [];
    for (const c of list) {
      const kind = CHICANE[c.kind] || CHICANE.slow;
      const mid = Math.round(c.at * n);
      // The chicane's turns: the sharpest bends near `at` (two by default).
      const peaks = [];
      const W = c.window ?? 34;
      for (let i = mid - W; i <= mid + W; i++) {
        const k = this.curv[(i + n) % n];
        if (Math.abs(k) < 1 / 330) continue;
        if (Math.abs(k) < Math.abs(this.curv[(i - 1 + n) % n]) || Math.abs(k) < Math.abs(this.curv[(i + 1) % n])) continue;
        const last = peaks[peaks.length - 1];
        if (last && Math.sign(last.k) === Math.sign(k) && i - last.i < 14) {
          if (Math.abs(k) > Math.abs(last.k)) Object.assign(last, { i, k });
          continue;
        }
        peaks.push({ i, k });
      }
      const turns = peaks
        .slice()
        .sort((p, q) => Math.abs(q.k) - Math.abs(p.k))
        .slice(0, c.turns ?? 2)
        .sort((p, q) => p.i - q.i);
      for (const p of turns) {
        const side = Math.sign(p.k); // inside of the turn
        const wall = side > 0 ? this.wallR : this.wallL;
        const kerb = side > 0 ? this.kerbR : this.kerbL;
        const depth = kind.kerb * this.half;
        const S = CHICANE.span;
        for (let d = -S; d <= S; d++) {
          const j = (((p.i + d) % n) + n) % n;
          const bump = 0.5 + 0.5 * Math.cos((Math.PI * d) / (S + 1));
          const at = this.half + 4 - (depth + 4) * bump;
          kerb[j] = Math.min(kerb[j], at);
          wall[j] = Math.min(wall[j], at);
        }
        this.sausages.push({ i: (p.i + n) % n, side, depth, span: S });
      }
    }
  }

  // Room either side of the centre line at sample i (side +1 right, -1
  // left): at most `lim`, keeping `wallGap` from a barrier and `kerbGap`
  // from a sausage kerb. Can be negative where a kerb covers the middle.
  roomAt(i, side, lim, wallGap, kerbGap) {
    const fence = side > 0 ? this.fenceR[i] : this.fenceL[i];
    const kerb = side > 0 ? this.kerbR[i] : this.kerbL[i];
    return Math.min(lim, fence - wallGap, kerb - kerbGap);
  }

  chicanePoints({ a, b, mid, kind, dir }) {
    const { px, py, tx, ty } = this;
    const chord = Math.hypot(px[b] - px[a], py[b] - py[a]);
    // The stretch without its old wiggle: a smooth curve from end to end
    // that leaves and joins the track in the same direction.
    const N = Math.max(60, Math.ceil(chord / 2));
    const bx = new Float64Array(N + 1);
    const by = new Float64Array(N + 1);
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const h00 = 2 * t ** 3 - 3 * t * t + 1;
      const h10 = t ** 3 - 2 * t * t + t;
      const h01 = -2 * t ** 3 + 3 * t * t;
      const h11 = t ** 3 - t * t;
      bx[k] = h00 * px[a] + h10 * chord * tx[a] + h01 * px[b] + h11 * chord * tx[b];
      by[k] = h00 * py[a] + h10 * chord * ty[a] + h01 * py[b] + h11 * chord * ty[b];
    }
    const cum = new Float64Array(N + 1);
    for (let k = 1; k <= N; k++) cum[k] = cum[k - 1] + Math.hypot(bx[k] - bx[k - 1], by[k] - by[k - 1]);
    const Lb = cum[N];
    const xc = (Lb * (mid - a)) / (b - a);
    // The Z: turn by `angle` on radius r, a diagonal, turn back; it steps D sideways.
    const th = (kind.angle * Math.PI) / 180;
    const r = CHICANE.radius * this.half;
    const D = kind.shift * this.half;
    const S = Math.max(0, (D - 2 * r * (1 - Math.cos(th))) / Math.sin(th));
    const zx = [0];
    const zy = [0];
    let x = 0;
    let y = 0;
    const len = 2 * r * th + S;
    for (let u = 0; u < len; u += 1) {
      const head = u < r * th ? u / r : u < r * th + S ? th : th - (u - r * th - S) / r;
      x += Math.cos(head);
      y += Math.sin(head);
      zx.push(x);
      zy.push(y);
    }
    const Lx = x;
    const Dz = y;
    const x0 = xc - Lx / 2;
    let zj = 0;
    const zAt = (xx) => {
      const u = xx - x0;
      if (u <= 0) return 0;
      if (u >= Lx) return Dz;
      while (zj > 0 && zx[zj] > u) zj--;
      while (zj < zx.length - 2 && zx[zj + 1] < u) zj++;
      const f = (u - zx[zj]) / (zx[zj + 1] - zx[zj] || 1);
      return zy[zj] + (zy[zj + 1] - zy[zj]) * f;
    };
    const pts = [];
    for (let k = 0; k <= N; k++) {
      const p = Math.max(0, k - 1);
      const q = Math.min(N, k + 1);
      let nx = -(by[q] - by[p]);
      let ny = bx[q] - bx[p];
      const l = Math.hypot(nx, ny) || 1;
      nx /= l;
      ny /= l;
      const t = cum[k] / Lb;
      const ease = t * t * (3 - 2 * t);
      const lat = dir * (zAt(cum[k]) - Dz * ease);
      pts.push({ x: bx[k] + nx * lat, y: by[k] + ny * lat });
    }
    return pts;
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

  // The racing line is an elastic band laid around the lap. Its points stay
  // evenly spaced and are pushed sideways to make the line as straight as it
  // can be: wide entry, apex, wide exit, and straight through an S-bend when
  // there's room. It stays on the road the way the car physics sees it
  // (within reach of the nearest centre-line point), so like a player it can
  // cut across the inside of a tight corner. Worked coarse to fine.
  buildRacingLine() {
    const n = this.n;
    const px = this.px;
    const py = this.py;
    const lim = this.half - LINE.edge;
    const room = (i, side) => this.roomAt(i, side, lim, LINE.wall, LINE.kerb);
    // Nearest centre sample, searched around `from` in lap order, so band
    // points always move on around the lap and never jump to a stretch nearby.
    const nearest = (x, y, from, back, ahead) => {
      let best = from;
      let bd = Infinity;
      for (let k = -back; k <= ahead; k++) {
        const i = (from + k + n) % n;
        const dx = x - px[i];
        const dy = y - py[i];
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return best;
    };
    let X = null;
    let Y = null;
    let H = null;
    for (const [stride, iters] of LINE.levels) {
      const m = Math.round(n / stride);
      if (!X) {
        X = new Float64Array(m);
        Y = new Float64Array(m);
        // Start in the middle of the free road (a sausage kerb can cover the centre).
        for (let k = 0; k < m; k++) {
          const i = Math.round((k * n) / m) % n;
          const mid = (room(i, 1) - room(i, -1)) / 2;
          X[k] = px[i] + this.nx[i] * mid;
          Y[k] = py[i] + this.ny[i] * mid;
        }
      } else [X, Y] = resampleLoop(X, Y, m);
      H = new Int32Array(m);
      const track = () => {
        H[0] = nearest(X[0], Y[0], 0, 30, 30);
        for (let k = 1; k < m; k++) H[k] = nearest(X[k], Y[k], H[k - 1], 2, stride * 4 + 8);
      };
      track();
      const w = stride * 2 + 4;
      for (let it = 0; it < iters; it++) {
        for (let k = 0; k < m; k++) {
          const a1 = (k - 1 + m) % m;
          const b1 = (k + 1) % m;
          const a2 = (k - 2 + m) % m;
          const b2 = (k + 2) % m;
          // Where the neighbours would like this point (least bending)...
          const gx = (4 * (X[a1] + X[b1]) - (X[a2] + X[b2])) / 6;
          const gy = (4 * (Y[a1] + Y[b1]) - (Y[a2] + Y[b2])) / 6;
          // ...but only move sideways to the band, so spacing stays even.
          let tx = X[b1] - X[a1];
          let ty = Y[b1] - Y[a1];
          const tl = Math.hypot(tx, ty) || 1;
          tx /= tl;
          ty /= tl;
          const d = (gx - X[k]) * -ty + (gy - Y[k]) * tx;
          const onRoad = (f) => {
            const x = X[k] - ty * d * f;
            const y = Y[k] + tx * d * f;
            const i = nearest(x, y, H[k], w, w);
            const ex = x - px[i];
            const ey = y - py[i];
            // Signed distance to the side of the centre line; a sausage kerb can
            // push the allowed band past the middle (negative room).
            const lat = (ex * this.nx[i] + ey * this.ny[i] >= 0 ? 1 : -1) * Math.hypot(ex, ey);
            return lat <= room(i, 1) && lat >= -room(i, -1) ? i : -1;
          };
          // Somehow off the road (pushed by its neighbours): put it back on.
          if (onRoad(0) < 0) {
            const i = nearest(X[k], Y[k], H[k], w, w);
            const lat = (X[k] - px[i]) * this.nx[i] + (Y[k] - py[i]) * this.ny[i];
            const want = clamp(lat, -room(i, -1), room(i, 1));
            X[k] += this.nx[i] * (want - lat);
            Y[k] += this.ny[i] * (want - lat);
          }
          // If the whole step leaves the road, take as much of it as fits.
          let f = 1;
          let i = onRoad(1);
          if (i < 0) {
            let lo = 0;
            let hi = 1;
            for (let b = 0; b < 7; b++) {
              const mid = (lo + hi) / 2;
              if (onRoad(mid) >= 0) lo = mid;
              else hi = mid;
            }
            f = lo;
            i = onRoad(f);
          }
          X[k] -= ty * d * f;
          Y[k] += tx * d * f;
          if (i >= 0) H[k] = i;
        }
        if (it % 10 === 9) {
          [X, Y] = resampleLoop(X, Y, m);
          track();
        }
      }
      track();
    }
    const m = X.length;
    this.band = { x: X, y: Y, idx: H, m };

    // Where each band point sits along the lap (a fractional sample index,
    // always increasing), so per-sample values can be read off the band.
    const at = new Float64Array(m);
    let prev = -Infinity;
    for (let q = 0; q < m; q++) {
      const i = H[q];
      let s = i + clamp(((X[q] - px[i]) * this.tx[i] + (Y[q] - py[i]) * this.ty[i]) / this.ds, -0.5, 0.5);
      if (q === 0 && s > n / 2) s -= n;
      while (s < prev - n / 2) s += n;
      if (s <= prev) s = prev + 1e-3;
      at[q] = s;
      prev = s;
    }
    this.band.at = at;
    // For sample i: band point q and blend f, so value = a[q] + (a[q+1] - a[q]) * f.
    const bq = new Int32Array(n);
    const bf = new Float32Array(n);
    let q = 0;
    const first = Math.ceil(at[0]);
    for (let s = first; s < first + n; s++) {
      while (q < m - 1 && at[q + 1] <= s) q++;
      const a0 = at[q];
      const a1 = q + 1 < m ? at[q + 1] : at[0] + n;
      const i = ((s % n) + n) % n;
      bq[i] = q;
      bf[i] = clamp((s - a0) / (a1 - a0 || 1), 0, 1);
    }
    this.band.bq = bq;
    this.band.bf = bf;
    this.roff = new Float32Array(n);
    this.rx = new Float32Array(n);
    this.ry = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = this.fromBand(X, i);
      const y = this.fromBand(Y, i);
      this.rx[i] = x;
      this.ry[i] = y;
      this.roff[i] = clamp((x - px[i]) * this.nx[i] + (y - py[i]) * this.ny[i], -this.half, this.half);
    }
  }

  // A per-band-point value, read at centre-line sample i.
  fromBand(arr, i) {
    const q = this.band.bq[i];
    const a = arr[q];
    return a + (arr[(q + 1) % this.band.m] - a) * this.band.bf[i];
  }

  // Speeds along the band: how fast the curve can be taken, then braking
  // before it and the engine after it. Two versions: the AI's (a little
  // margin, gentle braking) and the one the braking boards come from (the
  // car's real limit, braking hard but not flat out).
  buildSpeedProfile() {
    const { x: X, y: Y, idx: H, m } = this.band;
    const k = new Float64Array(m);
    const d = new Float64Array(m);
    for (let q = 0; q < m; q++) {
      const a = (q - 3 + m) % m;
      const b = (q + 3) % m;
      const cr = (X[q] - X[a]) * (Y[b] - Y[a]) - (Y[q] - Y[a]) * (X[b] - X[a]);
      const dd = Math.hypot(X[q] - X[a], Y[q] - Y[a]) * Math.hypot(X[b] - X[q], Y[b] - Y[q]) * Math.hypot(X[b] - X[a], Y[b] - Y[a]);
      k[q] = dd > 1e-6 ? (2 * cr) / dd : 0;
      const j = (q + 1) % m;
      d[q] = Math.hypot(X[j] - X[q], Y[j] - Y[q]);
    }
    smoothCircular(k, 3);
    const TOP = PHYS.TOP;
    const vAI = new Float64Array(m);
    const vCar = new Float64Array(m);
    for (let q = 0; q < m; q++) {
      const i = H[q];
      // Less margin for error where a barrier sits close: carry a bit less speed.
      const roomy = clamp((Math.min(this.fenceL[i], this.fenceR[i]) - this.half) / 72, 0, 1);
      vAI[q] = maxCornerSpeed(Math.abs(k[q]), 0.9) * (0.88 + 0.12 * roomy);
      vCar[q] = maxCornerSpeed(Math.abs(k[q]), 1);
    }
    const brakeBack = (v, B) => {
      for (let pass = 0; pass < 2; pass++) {
        for (let q = m - 1; q >= 0; q--) {
          const j = (q + 1) % m;
          const lim = Math.sqrt(v[j] * v[j] + 2 * B * d[q]);
          if (lim < v[q]) v[q] = lim;
        }
      }
    };
    const engineOn = (v) => {
      for (let pass = 0; pass < 2; pass++) {
        for (let q = 0; q < m; q++) {
          const j = (q + 1) % m;
          const a = Math.max(0, PHYS.ACCEL * (1 - v[q] / TOP) - v[q] * PHYS.DRAG);
          const lim = Math.sqrt(v[q] * v[q] + 2 * a * d[q]);
          if (lim < v[j]) v[j] = lim;
        }
      }
    };
    // AI: brake before a corner, not in it.
    brakeBack(vAI, PHYS.BRAKE * 0.72);
    // Boards: the speed you'd actually arrive with, and where to brake.
    const vMax = Float64Array.from(vCar);
    engineOn(vMax);
    const vB = Float64Array.from(vMax);
    brakeBack(vB, PHYS.BRAKE * HINTS.brake);
    engineOn(vB);
    this.band.k = k;
    this.band.v = vB;

    const n = this.n;
    this.vProfile = new Float32Array(n);
    this.rcurv = new Float64Array(n);
    this.vCorner = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.vProfile[i] = this.fromBand(vAI, i);
      this.rcurv[i] = this.fromBand(k, i);
      this.vCorner[i] = this.fromBand(vB, i);
    }
    this.findBrakeZones(vB, d);
  }

  // Braking zones: where the speed on the band falls because of braking,
  // from the braking point to the slowest point of the corner. Only stops
  // worth HINTS.minDrop of top speed get 3-2-1 boards.
  findBrakeZones(v, d) {
    const { idx: H, m, k } = this.band;
    const n = this.n;
    const TOP = PHYS.TOP;
    const zones = [];
    // Start somewhere the car isn't braking, then walk the lap once.
    let q0 = 0;
    while (q0 < m && v[(q0 + 1) % m] < v[q0] - 0.5) q0++;
    let z = null;
    for (let s = 1; s <= m; s++) {
      const q = (q0 + s) % m;
      const j = (q + 1) % m;
      const falling = v[j] < v[q] - 0.5;
      if (falling && !z) z = { qs: q, len: 0 };
      if (z) {
        if (falling) z.len += d[q];
        else {
          z.qe = q;
          zones.push(z);
          z = null;
        }
      }
    }
    this.findCalls(zones, v);
    this.brakeZones = [];
    for (const z of zones) {
      const vIn = v[z.qs];
      const vOut = v[z.qe];
      if (vIn - vOut < HINTS.minDrop * TOP) continue;
      // Which way the corner turns: the tightest bend just after.
      let kk = 0;
      for (let s = 0; s < 12; s++) {
        const c = k[(z.qe + s) % m];
        if (Math.abs(c) > Math.abs(kk)) kk = c;
      }
      this.brakeZones.push({
        start: H[z.qs],
        end: H[z.qe],
        len: Math.round(z.len / this.ds),
        vIn,
        vOut,
        drop: vIn - vOut,
        dir: Math.sign(kk) || 1,
      });
    }
  }

  // One call per corner you need to lift or brake for, from the same speeds
  // as the boards: where to start slowing (`start`), the slowest point
  // (`at`), which way it turns and what kind of corner it is.
  findCalls(zones, v) {
    const { idx: H, m, k } = this.band;
    const n = this.n;
    const TOP = PHYS.TOP;
    const chicanes = (this.def.chicanes || []).map((c) => Math.round(c.at * n));
    const near = (i, j, w) => Math.min(Math.abs(i - j), n - Math.abs(i - j)) <= w;
    const calls = [];
    for (const z of zones) {
      const vIn = v[z.qs];
      const vOut = v[z.qe];
      if (vIn - vOut < CALLS.lift * TOP) continue;
      let kk = 0;
      for (let s = -4; s < 12; s++) {
        const c = k[(z.qe + s + m) % m];
        if (Math.abs(c) > Math.abs(kk)) kk = c;
      }
      const dir = Math.sign(kk) || 1;
      const at = H[z.qe];
      // How far the corner turns: the centre line's bend around its slowest point.
      let ang = 0;
      for (const step of [-1, 1]) {
        for (let s = step > 0 ? 0 : -1, gap = 0; Math.abs(s) < 90 && gap < 6; s += step) {
          const c = this.curv[(at + s + n) % n];
          if (Math.sign(c) === dir && Math.abs(c) > 1 / 1400) {
            ang += Math.abs(c) * this.ds;
            gap = 0;
          } else gap++;
        }
      }
      const deg = (ang * 180) / Math.PI;
      const chicane = chicanes.find((c) => near(at, c, 45));
      const big = vIn - vOut >= HINTS.minDrop * TOP;
      const kind = chicane != null ? 'chicane' : !big ? 'lift' : deg >= CALLS.hairpin && vOut < CALLS.slow * TOP ? 'hairpin' : 'hard';
      const last = calls[calls.length - 1];
      // Both turns of a chicane are one call.
      if (kind === 'chicane' && last && last.kind === 'chicane' && last.chicane === chicane) {
        last.at = at;
        last.vOut = Math.min(last.vOut, vOut);
        continue;
      }
      calls.push({ start: H[z.qs], at, dir, kind, vIn, vOut, brake: big, chicane });
    }
    this.calls = calls;
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
    // Nothing stands in the pit lane or the garages.
    if (this.pit) {
      this.decor = this.decor.filter((d) => !this.inPitArea(d.x, d.y, d.r + 10));
      this.stands = this.stands.filter((d) => !this.inPitArea(d.x, d.y, 34));
    }
  }

  // ---------- pit lane ----------

  // Finds a stretch beside the start straight with room for the pit lane
  // and its garages (no other part of the circuit close by, the bend gentle
  // enough), as near the preferred spot as it can, inside of the lap first.
  // Positions along it are signed sample numbers k (negative before the line).
  buildPit() {
    const n = this.n;
    const P = PIT;
    const W = this.wallDist;
    const rampN = Math.round(P.ramp / this.ds);
    const padN = Math.round(P.pad / this.ds);
    const gapN = P.gap / this.ds;
    const len = 2 * rampN + 2 * padN + Math.round(P.boxes * gapN);
    // The pit lane follows a smoothed copy of the straight, so small wiggles
    // in the road don't get magnified out at the garages.
    const M = Math.min(Math.floor(n / 2) - 2, 520);
    const F = { M, x: new Float64Array(2 * M + 1), y: new Float64Array(2 * M + 1), nx: new Float64Array(2 * M + 1), ny: new Float64Array(2 * M + 1), curv: new Float64Array(2 * M + 1) };
    for (let k = -M; k <= M; k++) {
      const i = ((k % n) + n) % n;
      F.x[k + M] = this.px[i];
      F.y[k + M] = this.py[i];
    }
    const blur = (a) => {
      const b = Float64Array.from(a);
      for (let pass = 0; pass < 3; pass++) {
        for (let q = 0; q < a.length; q++) {
          let sum = 0;
          let cnt = 0;
          for (let d = -10; d <= 10; d++) {
            const r = q + d;
            if (r < 0 || r >= a.length) continue;
            sum += b[r];
            cnt++;
          }
          a[q] = sum / cnt;
        }
        b.set(a);
      }
    };
    blur(F.x);
    blur(F.y);
    for (let q = 0; q <= 2 * M; q++) {
      const a = Math.max(0, q - 1);
      const b = Math.min(2 * M, q + 1);
      const dx = F.x[b] - F.x[a];
      const dy = F.y[b] - F.y[a];
      const l = Math.hypot(dx, dy) || 1;
      F.nx[q] = -dy / l;
      F.ny[q] = dx / l;
    }
    for (let q = 0; q <= 2 * M; q++) {
      const a = Math.max(0, q - 4);
      const b = Math.min(2 * M, q + 4);
      const ha = Math.atan2(-F.nx[a], F.ny[a]);
      const hb = Math.atan2(-F.nx[b], F.ny[b]);
      F.curv[q] = wrapAngle(hb - ha) / ((b - a) * this.ds);
    }
    this.pitFrame = F;

    const laneOuter = W + P.lane + P.laneHalf + 8;
    const far = W + P.garage + P.depth + 10;
    const clear = this.wallDist + 24;
    const g = this.grid;
    const memo = new Map();
    const room = (k, S, outer) => {
      const key = k * 4 + (S > 0 ? 0 : 1) + (outer === far ? 2 : 0);
      if (memo.has(key)) return memo.get(key);
      const q = k + M;
      const i = ((k % n) + n) % n;
      let ok = q >= 0 && q <= 2 * M && F.curv[q] * S * outer < 0.5 && !this.crossings.some((c) => this.lapDistance(i, c.upper) < this.bridgeSpan * 3 || this.lapDistance(i, c.lower) < this.bridgeSpan * 3);
      for (let o = W - 20; ok && o <= outer; o += 22) {
        const x = F.x[q] + F.nx[q] * S * o;
        const y = F.y[q] + F.ny[q] * S * o;
        const cx = Math.floor((x - g.x0) / g.C);
        const cy = Math.floor((y - g.y0) / g.C);
        if (cx < 0 || cy < 0 || cx >= g.gw || cy >= g.gh) continue;
        const list = g.cells[cy * g.gw + cx];
        if (!list) continue;
        for (const j of list) {
          if (this.lapDistance(i, j) < 100) continue;
          if ((x - this.px[j]) ** 2 + (y - this.py[j]) ** 2 < clear * clear) {
            ok = false;
            break;
          }
        }
      }
      memo.set(key, ok);
      return ok;
    };
    // Where the lane leaves and rejoins the road, the road isn't a tight bend.
    const straightAt = (k) => Math.abs(F.curv[clamp(k + M, 0, 2 * M)]) < 1 / 450;
    const fits = (start, S) => {
      const end = start + len;
      for (let k = start - 8; k <= start + 8; k++) if (!straightAt(k)) return false;
      for (let k = end - 8; k <= end + 8; k++) if (!straightAt(k)) return false;
      for (let k = start; k <= end; k++) {
        const ramp = k < start + rampN || k > end - rampN;
        if (!room(k, S, ramp ? laneOuter : far)) return false;
      }
      return true;
    };
    const want = this.def.pit || {};
    const inside = -this.outsideSign;
    const sides = want.side ? [want.side] : [inside, -inside];
    const base = Math.round(-P.before * len + (want.shift || 0) / this.ds);
    this.pit = null;
    for (const S of sides) {
      for (let d = 0; d <= 240 && !this.pit; d += 3) {
        for (const start of d ? [base + d, base - d] : [base]) {
          if (start - 4 < -M || start + len + 4 > M || !fits(start, S)) continue;
          const end = start + len;
          const limitIn = start + rampN;
          const boxes = [];
          for (let b = 0; b < P.boxes; b++) boxes.push(limitIn + padN + (b + 0.5) * gapN);
          this.pit = {
            side: S,
            start,
            end,
            rampN,
            limitIn,
            limitOut: end - rampN,
            boxes,
            laneO: W + P.lane,
            boxO: W + P.box,
            garageO: W + P.garage,
            inO: this.half + P.laneHalf - 16, // where the entry ramp starts: on the road edge
            outO: this.half - 10, // where the exit ramp ends, back on the road
            far,
          };
          break;
        }
      }
      if (this.pit) break;
    }
  }

  // Middle of the pit lane at signed sample k, as an offset toward the pit side.
  pitLane(k) {
    const p = this.pit;
    const sm = (u) => {
      const v = clamp(u, 0, 1);
      return v * v * (3 - 2 * v);
    };
    if (k < p.limitIn) return p.inO + (p.laneO - p.inO) * sm((k - p.start) / p.rampN);
    if (k > p.limitOut) return p.outO + (p.laneO - p.outO) * sm((p.end - k) / p.rampN);
    return p.laneO;
  }

  // World position at signed (fractional) sample k, `off` px toward the pit
  // side: measured from the smoothed straight out by the garages, from the
  // road itself near the ends where the lane meets it.
  pitPoint(k, off, out = {}) {
    const F = this.pitFrame;
    const p = this.pit;
    const q = clamp(k + F.M, 0, 2 * F.M - 1e-6);
    const q0 = Math.floor(q);
    const u = q - q0;
    const S = p.side * off;
    let nx = F.nx[q0] + (F.nx[q0 + 1] - F.nx[q0]) * u;
    let ny = F.ny[q0] + (F.ny[q0 + 1] - F.ny[q0]) * u;
    let x = F.x[q0] + (F.x[q0 + 1] - F.x[q0]) * u;
    let y = F.y[q0] + (F.y[q0 + 1] - F.y[q0]) * u;
    const edge = p.rampN * 0.7;
    const near = Math.max(1 - (k - p.start) / edge, 1 - (p.end - k) / edge);
    if (near > 0) {
      const w = near >= 1 ? 1 : near * near * (3 - 2 * near);
      const n = this.n;
      const kf = Math.floor(k);
      const i = ((kf % n) + n) % n;
      const j = (i + 1) % n;
      const v = k - kf;
      x += (this.px[i] + (this.px[j] - this.px[i]) * v - x) * w;
      y += (this.py[i] + (this.py[j] - this.py[i]) * v - y) * w;
      nx += (this.nx[i] + (this.nx[j] - this.nx[i]) * v - nx) * w;
      ny += (this.ny[i] + (this.ny[j] - this.ny[i]) * v - ny) * w;
    }
    out.x = x + nx * S;
    out.y = y + ny * S;
    const k0 = Math.round(k);
    out.idx = ((k0 % this.n) + this.n) % this.n;
    return out;
  }

  // Signed sample number (negative before the line) for a sample index.
  signedK(idx) {
    return idx > this.n / 2 ? idx - this.n : idx;
  }

  // How far a point sits toward the pit side of the centre line at sample idx.
  pitSideOffset(x, y, idx) {
    return ((x - this.px[idx]) * this.nx[idx] + (y - this.py[idx]) * this.ny[idx]) * this.pit.side;
  }

  // Is (x, y), give or take r, on the pit lane, its ramps or the garages?
  inPitArea(x, y, r) {
    const p = this.pit;
    const F = this.pitFrame;
    for (let k = p.start - 6; k <= p.end + 6; k++) {
      const q = k + F.M;
      const dx = x - F.x[q];
      const dy = y - F.y[q];
      if (Math.abs(dx * F.ny[q] - dy * F.nx[q]) > this.ds + r) continue;
      const lat = (dx * F.nx[q] + dy * F.ny[q]) * p.side;
      const ramp = k < p.limitIn - 4 || k > p.limitOut + 4;
      const outer = ramp ? this.pitLane(k) + PIT.laneHalf + 14 : p.far;
      if (lat > this.half && lat > this.wallDist - 30 - r && lat < outer + r) return true;
    }
    return false;
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
        const wlx = x - this.nx[k] * (this.barrierL[k] + 3);
        const wly = y - this.ny[k] * (this.barrierL[k] + 3);
        const wrx = x + this.nx[k] * (this.barrierR[k] + 3);
        const wry = y + this.ny[k] * (this.barrierR[k] + 3);
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
    // Sausage kerbs: a yellow block with black stripes and a shadow.
    const sausages = this.sausages.map((sg) => {
      const base = new Path2D();
      const stripes = new Path2D();
      const shadow = new Path2D();
      const off = (d) => this.half + 4 - (sg.depth + 4) * (0.5 + 0.5 * Math.cos((Math.PI * d) / (sg.span + 1)));
      const pt = (d, o) => {
        const j = (((sg.i + d) % n) + n) % n;
        return [this.px[j] + this.nx[j] * sg.side * o, this.py[j] + this.ny[j] * sg.side * o];
      };
      const outer = this.half + 10;
      const S = sg.span;
      for (let d = -S; d <= S; d++) base[d === -S ? 'moveTo' : 'lineTo'](...pt(d, outer));
      for (let d = S; d >= -S; d--) base.lineTo(...pt(d, off(d)));
      base.closePath();
      for (let d = -S; d <= S; d++) shadow[d === -S ? 'moveTo' : 'lineTo'](...pt(d, off(d) - 5));
      for (let d = -S; d < S; d += 4) {
        stripes.moveTo(...pt(d, outer));
        stripes.lineTo(...pt(d + 2, outer));
        stripes.lineTo(...pt(d + 2, off(d + 2)));
        stripes.lineTo(...pt(d, off(d)));
        stripes.closePath();
      }
      const [x, y] = pt(0, this.half);
      return { base, stripes, shadow, x, y, r: S * this.ds + 40 };
    });
    const full = new Path2D();
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      if (i === 0) full.moveTo(this.px[k], this.py[k]);
      else full.lineTo(this.px[k], this.py[k]);
    }
    full.closePath();
    // 3-2-1 boards before each real stop, both sides of the road: "1" stands
    // at the braking point (for the speed you'd arrive with), "2" and "3"
    // count down to it. None inside the corner before.
    const boards = [];
    const zs = this.brakeZones;
    zs.forEach((z, k) => {
      const prev = zs[(k - 1 + zs.length) % zs.length];
      const step = clamp(z.vIn * HINTS.gap, 70, 170) / this.ds;
      for (const num of [1, 2, 3]) {
        const i = (((Math.round(z.start - step * (num - 1))) % n) + n) % n;
        if (zs.length > 1 && inLapRange(i, prev.start, prev.end + 8, n)) continue;
        for (const side of [-1, 1]) {
          const wall = side > 0 ? this.fenceR[i] : this.fenceL[i];
          const off = Math.max(this.half + 16, Math.min(this.half + 34, wall - 16));
          boards.push({
            num,
            x: this.px[i] + this.nx[i] * side * off,
            y: this.py[i] + this.ny[i] * side * off,
            angle: Math.atan2(this.ty[i], this.tx[i]),
          });
        }
      }
    });

    this.geo = {
      boards,
      sausages,
      chunks,
      full,
      groundPat: makePattern(th.groundKind || 'ground', th),
      runoffPat: makePattern(th.runoffKind || 'grass', th),
      pit: this.pit ? this.buildPitGeo() : null,
    };
    return this.geo;
  }

  // Drawing paths for the pit lane: the lane and its ramps, the box area,
  // edge lines, speed-limit lines, the box outlines and the garages.
  buildPitGeo() {
    const p = this.pit;
    const P = PIT;
    const pt = (k, o) => {
      const q = this.pitPoint(k, o);
      return [q.x, q.y];
    };
    const line = (k0, k1, off, step = 1) => {
      const path = new Path2D();
      let on = false;
      for (let k = k0; k <= k1 + 1e-6; k += step) {
        const o = off(k);
        if (o == null) {
          on = false;
          continue;
        }
        path[on ? 'lineTo' : 'moveTo'](...pt(k, o));
        on = true;
      }
      return path;
    };
    const lane = line(p.start, p.end, (k) => this.pitLane(k));
    const apronO = (p.laneO + p.garageO) / 2;
    const apron = line(p.limitIn, p.limitOut, () => apronO);
    // Edge lines; the inner one only once it has left the road.
    const inner = line(p.start, p.end, (k) => {
      const o = this.pitLane(k) - P.laneHalf;
      return o > this.half + 3 ? o : null;
    });
    const outerRamps = new Path2D();
    outerRamps.addPath(line(p.start, p.limitIn, (k) => this.pitLane(k) + P.laneHalf));
    outerRamps.addPath(line(p.limitOut, p.end, (k) => this.pitLane(k) + P.laneHalf));
    const fastLane = line(p.limitIn, p.limitOut, () => p.laneO + P.laneHalf);
    // Outer wall: along the ramps, then round the back of the garages.
    const wall = new Path2D();
    const back = p.garageO + P.depth + 4;
    let first = true;
    const add = (k, o) => {
      wall[first ? 'moveTo' : 'lineTo'](...pt(k, o));
      first = false;
    };
    for (let k = p.start + 6; k <= p.limitIn; k++) add(k, this.pitLane(k) + P.laneHalf + 6);
    for (let k = p.limitIn; k <= p.limitOut; k++) add(k, back);
    for (let k = p.limitOut; k <= p.end - 6; k++) add(k, this.pitLane(k) + P.laneHalf + 6);
    // Speed-limit lines across the lane, and the timing line where it crosses the lap's line.
    const limits = new Path2D();
    for (const k of [p.limitIn, p.limitOut]) {
      limits.moveTo(...pt(k, p.laneO - P.laneHalf));
      limits.lineTo(...pt(k, p.laneO + P.laneHalf));
    }
    const timing = new Path2D();
    if (p.start < 0 && p.end > 0) {
      const o = this.pitLane(0);
      timing.moveTo(...pt(0, o - P.laneHalf));
      timing.lineTo(...pt(0, Math.max(o + P.laneHalf, 0 >= p.limitIn && 0 <= p.limitOut ? p.garageO : 0)));
    }
    // Dashed guide on the road before the entry.
    const guide = line(p.start - 44, p.start + 2, () => this.half - P.guide);
    // Boxes and garages, one per team.
    const gapN = P.gap / this.ds;
    const quad = (k0, k1, o0, o1) => {
      const path = new Path2D();
      path.moveTo(...pt(k0, o0));
      path.lineTo(...pt(k1, o0));
      path.lineTo(...pt(k1, o1));
      path.lineTo(...pt(k0, o1));
      path.closePath();
      return path;
    };
    const boxes = p.boxes.map((k) => {
      const half = 30 / this.ds;
      const c = this.pitPoint(k, p.garageO + P.depth / 2);
      return {
        k,
        box: quad(k - half, k + half, p.boxO - 18, p.boxO + 18),
        garage: quad(k - gapN / 2 + 0.25, k + gapN / 2 - 0.25, p.garageO, p.garageO + P.depth),
        front: quad(k - gapN / 2 + 0.25, k + gapN / 2 - 0.25, p.garageO, p.garageO + 6),
        x: c.x,
        y: c.y,
        angle: this.pitAngle(k),
      };
    });
    // Bounding box, for skipping it when it's off screen.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let k = p.start - 46; k <= p.end; k += 4) {
      for (const o of [0, p.far]) {
        const [x, y] = pt(k, o);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    const sign = this.pitPoint(p.start - 30, this.half + 34);
    const paint = this.pitPoint(p.start + 22, this.pitLane(p.start + 22));
    return {
      lane,
      apron,
      apronW: p.garageO - p.laneO,
      inner,
      outerRamps,
      fastLane,
      wall,
      limits,
      timing,
      guide,
      boxes,
      sign: { x: sign.x, y: sign.y, angle: this.pitAngle(p.start - 30) },
      paint: { x: paint.x, y: paint.y, angle: this.pitAngle(p.start + 22) },
      bounds: { minX, minY, maxX, maxY },
    };
  }

  // Direction of travel along the pit lane at signed sample k.
  pitAngle(k) {
    const F = this.pitFrame;
    const q = clamp(Math.round(k + F.M), 0, 2 * F.M);
    return Math.atan2(-F.nx[q], F.ny[q]);
  }

  drawPit(ctx, view) {
    const g = this.geo.pit;
    const b = g.bounds;
    if (b.maxX < view.minX || b.minX > view.maxX || b.maxY < view.minY || b.minY > view.maxY) return;
    const th = this.theme;
    const P = PIT;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    // Box area and lane.
    ctx.strokeStyle = '#4d5159';
    ctx.lineWidth = g.apronW;
    ctx.stroke(g.apron);
    ctx.strokeStyle = th.asphaltEdge;
    ctx.lineWidth = P.laneHalf * 2 + 4;
    ctx.stroke(g.lane);
    ctx.strokeStyle = th.asphalt;
    ctx.lineWidth = P.laneHalf * 2;
    ctx.stroke(g.lane);
    // Garages with the team's colour along the front.
    const teams = this.pitTeams || [];
    g.boxes.forEach((bx, i) => {
      const team = teams[i];
      ctx.fillStyle = '#262a32';
      ctx.fill(bx.garage);
      ctx.fillStyle = team ? team.color : '#5a5f69';
      ctx.fill(bx.front);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#15171c';
      ctx.stroke(bx.garage);
      // Box outline painted on the ground.
      ctx.lineWidth = 3;
      ctx.strokeStyle = team ? team.color : 'rgba(255,255,255,0.5)';
      ctx.globalAlpha = 0.85;
      ctx.stroke(bx.box);
      ctx.globalAlpha = 1;
      if (team) {
        ctx.save();
        ctx.translate(bx.x, bx.y);
        ctx.rotate(bx.angle + (this.pit.side > 0 ? Math.PI / 2 : -Math.PI / 2));
        ctx.fillStyle = 'rgba(232,236,242,0.85)';
        ctx.font = '800 13px "Saira Condensed", "Arial Narrow", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(team.short, 0, 4);
        ctx.restore();
      }
    });
    // Lines: lane edges (dashed between lane and boxes), limit lines, the guide.
    ctx.strokeStyle = th.edge;
    ctx.lineWidth = 3;
    ctx.stroke(g.inner);
    ctx.stroke(g.outerRamps);
    ctx.setLineDash([14, 12]);
    ctx.lineWidth = 2;
    ctx.stroke(g.fastLane);
    ctx.lineWidth = 3;
    ctx.setLineDash([16, 14]);
    ctx.stroke(g.guide);
    ctx.setLineDash([]);
    ctx.lineWidth = 5;
    ctx.stroke(g.limits);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#f4f4f4';
    ctx.stroke(g.timing);
    // Outer wall.
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#b9bcc2';
    ctx.stroke(g.wall);
    // "PIT" painted on the entry, and the entry board.
    ctx.save();
    ctx.translate(g.paint.x, g.paint.y);
    ctx.rotate(g.paint.angle + Math.PI / 2);
    ctx.fillStyle = 'rgba(244,244,244,0.85)';
    ctx.font = '900 22px "Saira Condensed", "Arial Narrow", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PIT', 0, 0);
    ctx.restore();
    ctx.save();
    ctx.translate(g.sign.x, g.sign.y);
    ctx.rotate(g.sign.angle + Math.PI / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    roundRectPath(ctx, -22 + 4, -16 + 5, 44, 32, 6);
    ctx.fill();
    ctx.fillStyle = '#1f6fe0';
    roundRectPath(ctx, -22, -16, 44, 32, 6);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 17px "Saira Condensed", "Arial Narrow", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PIT', 0, 1);
    ctx.restore();
    ctx.restore();
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
    for (const sg of g.sausages) {
      if (sg.x + sg.r < view.minX || sg.x - sg.r > view.maxX || sg.y + sg.r < view.minY || sg.y - sg.r > view.maxY) continue;
      ctx.lineCap = 'round';
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.stroke(sg.shadow);
      ctx.lineCap = 'butt';
      ctx.fillStyle = '#ffd21f';
      ctx.fill(sg.base);
      ctx.fillStyle = '#1b1c20';
      ctx.fill(sg.stripes);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#1b1c20';
      ctx.stroke(sg.base);
    }

    if (g.pit) this.drawPit(ctx, view);
    // The line, and the grid boxes up to ~900 px behind it.
    if (this.nearView(view, 0, 150) || this.nearView(view, (this.n - Math.round(450 / this.ds)) % this.n, 560)) this.drawStartLine(ctx);
    if (hints) this.drawBoards(ctx, view);
  }

  // Is sample i within `margin` px of the view rectangle?
  nearView(view, i, margin) {
    const x = this.px[i];
    const y = this.py[i];
    return x > view.minX - margin && x < view.maxX + margin && y > view.minY - margin && y < view.maxY + margin;
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

  // Big distance boards: white "3" and "2", red "1" where you brake.
  drawBoards(ctx, view) {
    const m = 60;
    const W = 40;
    const Hh = 48;
    for (const b of this.geo.boards) {
      if (b.x < view.minX - m || b.x > view.maxX + m || b.y < view.minY - m || b.y > view.maxY + m) continue;
      const one = b.num === 1;
      ctx.save();
      ctx.translate(b.x, b.y);
      // Number reads upright for a driver coming toward it.
      ctx.rotate(b.angle + Math.PI / 2);
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      roundRectPath(ctx, -W / 2 + 4, -Hh / 2 + 5, W, Hh, 6);
      ctx.fill();
      ctx.fillStyle = one ? '#e8241b' : '#f6f6f2';
      roundRectPath(ctx, -W / 2, -Hh / 2, W, Hh, 6);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = one ? '#fff3f0' : '#15161a';
      ctx.stroke();
      ctx.fillStyle = one ? '#ffffff' : '#15161a';
      ctx.font = '900 36px "Saira Condensed", "Arial Narrow", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(b.num), 0, 2);
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
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.arc(ox + c.x * s, oy + c.y * s, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c.livery.color;
      ctx.beginPath();
      ctx.arc(ox + c.x * s, oy + c.y * s, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    // You: a white arrow pointing the way you're going, in a pulsing red halo.
    if (focus) {
      const fx = ox + focus.x * s;
      const fy = oy + focus.y * s;
      const k = Math.max(0.8, Math.min(1.2, size / 120));
      const pulse = 0.5 + 0.5 * Math.sin((typeof performance !== 'undefined' ? performance.now() : 0) / 180);
      ctx.fillStyle = `rgba(255,42,31,${0.28 + 0.2 * pulse})`;
      ctx.beginPath();
      ctx.arc(fx, fy, (9 + 3 * pulse) * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(fx, fy);
      ctx.rotate(focus.angle);
      ctx.scale(k, k);
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(-6, -6);
      ctx.lineTo(-3, 0);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ff2a1f';
      ctx.stroke();
      ctx.restore();
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
