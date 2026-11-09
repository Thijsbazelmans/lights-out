// Build a circuit from driving instructions instead of raw coordinates:
//   ['S', length]            straight
//   ['A', length]            straight whose length is adjusted to close the loop
//   ['R', degrees, radius]   right-hand corner
//   ['L', degrees, radius]   left-hand corner
// Units are pixels (the car is 44 long). Exactly two 'A' straights pointing in
// different directions let the solver close the loop. Turns must add up to
// +360 (clockwise) or -360 (anticlockwise). The start line is the first point.

const RAD = Math.PI / 180;

function run(cmds, lens, step) {
  let x = 0;
  let y = 0;
  let h = 0;
  let ai = 0;
  const pts = [[0, 0]];
  const dirs = [];
  for (const c of cmds) {
    if (c[0] === 'S' || c[0] === 'A') {
      const L = c[0] === 'A' ? lens[ai++] : c[1];
      if (c[0] === 'A') dirs.push([Math.cos(h), Math.sin(h)]);
      const n = Math.max(1, Math.round(L / step));
      for (let k = 1; k <= n; k++) pts.push([x + (Math.cos(h) * L * k) / n, y + (Math.sin(h) * L * k) / n]);
      x += Math.cos(h) * L;
      y += Math.sin(h) * L;
    } else {
      const dir = c[0] === 'R' ? 1 : -1;
      const ang = c[1] * RAD;
      const r = c[2];
      const cx = x + Math.cos(h + (dir * Math.PI) / 2) * r;
      const cy = y + Math.sin(h + (dir * Math.PI) / 2) * r;
      const a0 = h - (dir * Math.PI) / 2;
      const n = Math.max(2, Math.round((ang * r) / step));
      for (let k = 1; k <= n; k++) {
        const a = a0 + (dir * ang * k) / n;
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      x = cx + Math.cos(a0 + dir * ang) * r;
      y = cy + Math.sin(a0 + dir * ang) * r;
      h += dir * ang;
    }
  }
  return { pts, x, y, h, dirs };
}

export function turtle(cmds, step = 64) {
  const lens0 = cmds.filter((c) => c[0] === 'A').map((c) => c[1]);
  const first = run(cmds, lens0, step);
  let lens = lens0;
  if (lens0.length === 2) {
    // Solve d1*a + d2*b = -end for the two adjustable lengths.
    const [d1, d2] = first.dirs;
    const det = d1[0] * d2[1] - d1[1] * d2[0];
    const ex = -first.x;
    const ey = -first.y;
    const a = (ex * d2[1] - ey * d2[0]) / det;
    const b = (d1[0] * ey - d1[1] * ex) / det;
    lens = [lens0[0] + a, lens0[1] + b];
  }
  const res = run(cmds, lens, step);
  const turn = Math.round(res.h / RAD);
  if (Math.abs(Math.abs(turn) - 360) > 0.5) console.warn(`turtle: turns add up to ${turn}°, not ±360°`);
  if (lens.some((l) => l < 60)) console.warn('turtle: an adjustable straight came out too short', lens);
  const pts = res.pts;
  pts.pop(); // last point is back on the first
  return pts;
}
