// Small math and formatting helpers shared by every module.

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

// Frame-rate independent smoothing toward a target.
export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));

export const approach = (v, target, step) =>
  v < target ? Math.min(v + step, target) : Math.max(v - step, target);

export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export const dampAngle = (a, b, rate, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-rate * dt));

export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);

// Deterministic random numbers, so decorations look the same every visit.
export function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function formatTime(t) {
  if (t == null || !isFinite(t)) return '-:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export function formatGap(t) {
  if (t == null || !isFinite(t)) return '';
  return (t >= 0 ? '+' : '-') + Math.abs(t).toFixed(3);
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Indices to show: `size` rows centred on `me`, clamped to the ends, plus any
// extra rows; -1 marks a gap between non-adjacent rows.
export function followRows(count, me, size, extra = []) {
  const start = Math.max(0, Math.min(me - Math.floor((size - 1) / 2), count - size));
  const set = new Set();
  for (let i = start; i < Math.min(count, start + size); i++) set.add(i);
  for (const e of extra) if (e >= 0 && e < count) set.add(e);
  const sorted = [...set].sort((a, b) => a - b);
  const out = [];
  sorted.forEach((i, k) => {
    if (k > 0 && i > sorted[k - 1] + 1) out.push(-1);
    out.push(i);
  });
  return out;
}
