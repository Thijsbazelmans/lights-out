// Invisible walls: drives test cars off the road all round every circuit
// (both sides, a few angles) with the game's own car and barrier code, and
// reports every place a car is stopped by a barrier that isn't drawn there
// (no drawn barrier line within `TOL` px of where it hit). Chicane sausage
// kerbs and the pit entry/exit are left out (they're drawn as what they are).
//
//   node tools/walls.mjs                 (every circuit: count, worst spots)
//   node tools/walls.mjs shanghai -v     (one circuit, every spot)
import { Track, WALL_SMOOTH } from '../js/track.js';
import { ALL_REAL } from '../js/data/tracks.js';
import { Car } from '../js/car.js';

const args = process.argv.slice(2);
for (const kv of (process.env.SMOOTH || '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  WALL_SMOOTH[k] = Number(v);
}
const verbose = args.includes('-v');
const idsArg = args.find((a) => !a.startsWith('-')) || 'all';
const ids = idsArg === 'all' ? ALL_REAL.map((d) => d.id) : idsArg.split(',');
const TOL = 22; // px between where a car stops and the nearest drawn barrier
const ANGLES = [0.35, 0.8, 1.3, 1.57]; // rad off the road's direction, outward (1.57: straight out)
const STEP = 2; // every this many centre-line samples
const dt = 1 / 120;

function visibleSegments(t) {
  const { barL, barR, hideL, hideR } = t.barrierLines();
  const segs = [];
  for (const [pts, hide] of [[barL, hideL], [barR, hideR]]) {
    let prev = null;
    for (const p of pts) {
      if (p.gap || hide(p.i % t.n)) {
        prev = null;
        continue;
      }
      if (prev) segs.push([prev.x, prev.y, p.x, p.y]);
      prev = p;
    }
  }
  const C = 64;
  const grid = new Map();
  for (const sg of segs) {
    const x0 = Math.floor(Math.min(sg[0], sg[2]) / C) - 1;
    const x1 = Math.floor(Math.max(sg[0], sg[2]) / C) + 1;
    const y0 = Math.floor(Math.min(sg[1], sg[3]) / C) - 1;
    const y1 = Math.floor(Math.max(sg[1], sg[3]) / C) + 1;
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
      const k = gx * 100003 + gy;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(sg);
    }
  }
  return (x, y) => {
    const list = grid.get(Math.floor(x / C) * 100003 + Math.floor(y / C)) || [];
    let best = Infinity;
    for (const [ax, ay, bx, by] of list) {
      const ex = bx - ax;
      const ey = by - ay;
      const l2 = ex * ex + ey * ey || 1;
      const u = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / l2));
      best = Math.min(best, Math.hypot(x - ax - ex * u, y - ay - ey * u));
    }
    return best;
  };
}

function scan(def) {
  const t = new Track(def);
  const n = t.n;
  const nearDrawn = visibleSegments(t);
  const spots = [];
  const leaks = [];
  const inPit = (i, side) => {
    if (!t.pit || side !== t.pit.side) return false;
    const k = t.signedK(i);
    return k > t.pit.start - 30 && k < t.pit.end + 30;
  };
  for (let i = 0; i < n; i += STEP) {
    for (const side of [-1, 1]) {
      for (const ang of ANGLES) {
        const lat = side * (t.half - 30);
        const a = Math.atan2(t.ty[i], t.tx[i]) + side * ang;
        const car = new Car({ x: t.px[i] + t.nx[i] * lat, y: t.py[i] + t.ny[i] * lat, angle: a });
        car.frozen = false;
        car.trackIdx = i;
        car.vx = Math.cos(a) * 420;
        car.vy = Math.sin(a) * 420;
        const events = [];
        let hit = null;
        let leak = false;
        for (let s = 0; s < 120 && !hit; s++) {
          const ox = car.x;
          const oy = car.y;
          car.update(dt, { gas: 1, brake: 0, steer: 0, analog: true }, t, events);
          const q = t.queryLocal(car.x, car.y, car.trackIdx, {});
          if (q.dist !== Infinity) car.trackIdx = q.idx;
          // Out on another stretch's road without hitting anything: a way across.
          const g = t.query(car.x, car.y, {});
          if (g.dist < t.half - 10 && t.lapDistance(g.idx, car.trackIdx) > 60 && !t.nearCrossing(g.idx, car.trackIdx)) leak = true;
          for (const e of events) if (e.t === 'wall' && !hit) hit = { x: e.x, y: e.y, kind: 'wall' };
          events.length = 0;
          // Thrown back with no wall hit: off the edge of the circuit's map.
          if (!hit && car.x === ox && car.y === oy) hit = { x: ox, y: oy, kind: 'edge' };
        }
        if (leak) leaks.push({ i, side, ang });
        if (!hit) continue;
        const q = t.query(hit.x, hit.y, {});
        const j = q.dist === Infinity ? i : q.idx;
        const sideHit = q.dist === Infinity ? side : q.side;
        const kerb = sideHit > 0 ? t.kerbR[j] : t.kerbL[j];
        if (Number.isFinite(kerb) && Math.abs(q.dist - kerb) < 30) continue; // a sausage kerb
        if (inPit(j, sideHit) || inPit(i, side)) continue;
        const gap = nearDrawn(hit.x, hit.y);
        if (gap > TOL) spots.push({ i, j, side: sideHit, gap, kind: hit.kind, x: hit.x, y: hit.y, ang });
      }
    }
  }
  // Group neighbouring spots into places.
  spots.sort((a, b) => a.j - b.j);
  const places = [];
  for (const sp of spots) {
    const last = places[places.length - 1];
    if (last && last.side === sp.side && sp.j - last.to <= 12) {
      last.to = sp.j;
      last.gap = Math.max(last.gap, sp.gap);
      last.count++;
      continue;
    }
    places.push({ from: sp.j, to: sp.j, side: sp.side, gap: sp.gap, count: 1, x: sp.x, y: sp.y, kind: sp.kind });
  }
  return { id: def.id, n, places, leaks };
}

let total = 0;
let leakTotal = 0;
for (const id of ids) {
  const def = ALL_REAL.find((d) => d.id === id);
  if (!def) {
    console.log(`${id}: no such circuit`);
    continue;
  }
  const r = scan(def);
  total += r.places.length;
  leakTotal += r.leaks.length;
  const worst = r.places.slice().sort((a, b) => b.gap - a.gap);
  const fmt = (p) => `${(p.from / r.n).toFixed(3)}${p.to !== p.from ? `–${(p.to / r.n).toFixed(3)}` : ''} ${p.side > 0 ? 'R' : 'L'} ${Math.round(p.gap)}px${p.kind === 'edge' ? ' (edge)' : ''} ×${p.count}`;
  const leakNote = r.leaks.length ? `  [${r.leaks.length} way${r.leaks.length > 1 ? 's' : ''} across onto another stretch: ${r.leaks.slice(0, 3).map((l) => `${(l.i / r.n).toFixed(3)} ${l.side > 0 ? 'R' : 'L'}`).join(', ')}]` : '';
  console.log(`${id.padEnd(12)} ${r.places.length ? `${r.places.length} place${r.places.length > 1 ? 's' : ''}: ` + (verbose ? worst : worst.slice(0, 4)).map(fmt).join('  ') : 'none'}${leakNote}`);
  if (verbose) for (const p of worst) console.log(`   at ${Math.round(p.x)},${Math.round(p.y)}  ${fmt(p)}`);
}
console.log(`total: ${total} places with a barrier you can't see (more than ${TOL} px from any drawn barrier); ${leakTotal} ways across onto another stretch`);
