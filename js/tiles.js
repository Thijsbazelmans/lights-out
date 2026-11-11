// Phones: the circuit's still picture (ground, run-off, barriers, road, kerbs,
// pit lane, braking boards, start line, stands and scenery) is drawn once into
// square tiles and reused every frame, instead of being drawn line by line 60
// times a second. Cars, skid marks, smoke and the HUD are still drawn live on
// top. Tiles are made as they come into view (a couple per frame at most, the
// ones about to come into view first); until every tile on screen is ready
// the frame is drawn the old way, so nothing is ever missing.

const TILE = 512; // world px per tile side
const PAD = 3; // world px of overlap round each tile, so no seams show
const BUDGET = 48e6; // bytes of tiles kept at once (~0.9 MB a tile on a phone: ~50)
const PER_FRAME = 2; // most tiles made in one frame
const AHEAD = 360; // world px round the screen made in advance

const pool = new Map(); // key -> { canvas, used }
const spare = []; // canvases of evicted tiles, for reuse
let clock = 0;
let lastBase = '';
let fontsReady = false;

// Tiles drawn before the fonts came in have the stand-in font on the boards:
// draw them again once the real ones are there.
if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    fontsReady = true;
    clearTiles();
  });
}

export function clearTiles() {
  for (const t of pool.values()) keep(t.canvas);
  pool.clear();
}

// Keep a tile's canvas for the next tile, or let its memory go.
function keep(c) {
  if (spare.length < 64) spare.push(c);
  else c.width = c.height = 0;
}

function evict(max) {
  while (pool.size > max) {
    let oldKey = null;
    let oldT = Infinity;
    for (const [k, t] of pool) {
      if (t.used < oldT) {
        oldT = t.used;
        oldKey = k;
      }
    }
    if (oldKey == null) break;
    keep(pool.get(oldKey).canvas);
    pool.delete(oldKey);
  }
}

// The screen as a rotated rectangle in world space: its four corners.
function screenQuad(cam, w, h, grow) {
  const c = Math.cos(-cam.rot);
  const s = Math.sin(-cam.rot);
  const z = cam.zoom;
  const pts = [];
  for (const [sx, sy] of [
    [-grow, -grow],
    [w + grow, -grow],
    [w + grow, h + grow],
    [-grow, h + grow],
  ]) {
    const dx = (sx - cam.anchorX - cam.ox) / z;
    const dy = (sy - cam.anchorY - cam.oy) / z;
    pts.push([cam.x + dx * c - dy * s, cam.y + dx * s + dy * c]);
  }
  return pts;
}

// Tiles (as [i, j]) that touch the quad: its bounding box, then a separating
// axis test against the quad's own two directions.
function tilesUnder(q) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of q) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const axes = [
    [q[1][0] - q[0][0], q[1][1] - q[0][1]],
    [q[3][0] - q[0][0], q[3][1] - q[0][1]],
  ];
  const span = axes.map(([ax, ay]) => {
    const v = q.map(([x, y]) => x * ax + y * ay);
    return [Math.min(...v), Math.max(...v)];
  });
  const out = [];
  for (let j = Math.floor(minY / TILE); j <= Math.floor(maxY / TILE); j++) {
    for (let i = Math.floor(minX / TILE); i <= Math.floor(maxX / TILE); i++) {
      const x0 = i * TILE;
      const y0 = j * TILE;
      let hit = true;
      for (let a = 0; a < 2 && hit; a++) {
        const [ax, ay] = axes[a];
        const v0 = x0 * ax + y0 * ay;
        const vx = TILE * ax;
        const vy = TILE * ay;
        const lo = v0 + Math.min(0, vx) + Math.min(0, vy);
        const hi = v0 + Math.max(0, vx) + Math.max(0, vy);
        if (hi < span[a][0] || lo > span[a][1]) hit = false;
      }
      if (hit) out.push([i, j]);
    }
  }
  return out;
}

function makeTile(track, i, j, scale, hints) {
  const size = Math.ceil((TILE + PAD * 2) * scale);
  let c = spare.pop();
  if (!c) c = document.createElement('canvas');
  if (c.width !== size || c.height !== size) {
    c.width = size;
    c.height = size;
  }
  const g = c.getContext('2d', { alpha: false });
  const x0 = i * TILE - PAD;
  const y0 = j * TILE - PAD;
  g.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
  const view = { minX: x0, minY: y0, maxX: x0 + TILE + PAD * 2, maxY: y0 + TILE + PAD * 2 };
  track.drawGround(g, view);
  track.drawSurface(g, view, hints);
  track.drawDecor(g, view);
  return c;
}

// Draws the circuit's still picture for this camera from tiles. Returns
// false (and draws nothing) if some tile on screen isn't ready yet: the
// caller then draws the picture itself this frame.
export function drawTiles(ctx, track, cam, w, h, dpr, hints) {
  // Tiles are drawn as sharp as the closest the camera comes while racing,
  // in steps so a small change of zoom doesn't make them all again.
  const scale = Math.round(dpr * cam.baseZoom(w, h) * 20) / 20;
  const base = `${track.id}|${scale}|${hints ? 1 : 0}|${fontsReady ? 1 : 0}|`;
  // Another circuit (or sharpness, or boards on or off): start afresh.
  if (base !== lastBase) {
    clearTiles();
    lastBase = base;
  }
  clock++;
  let made = 0;
  let ready = true;
  const need = tilesUnder(screenQuad(cam, w, h, 8));
  const px = Math.ceil((TILE + PAD * 2) * scale);
  const max = Math.max(need.length + 8, Math.floor(BUDGET / (px * px * 4)));
  for (const [i, j] of need) {
    const key = base + i + ',' + j;
    let t = pool.get(key);
    if (!t && made < PER_FRAME) {
      t = { canvas: makeTile(track, i, j, scale, hints), used: clock };
      pool.set(key, t);
      made++;
    }
    if (t) t.used = clock;
    else ready = false;
  }
  if (made === 0 && pool.size < max) {
    // Nothing missing on screen and room to spare: make one of the tiles
    // about to come into view.
    for (const [i, j] of tilesUnder(screenQuad(cam, w, h, AHEAD * cam.zoom))) {
      const key = base + i + ',' + j;
      if (pool.has(key)) continue;
      pool.set(key, { canvas: makeTile(track, i, j, scale, hints), used: clock - 1 });
      break;
    }
  }
  evict(max);
  if (!ready) return false;
  const side = TILE + PAD * 2;
  for (const [i, j] of need) {
    const t = pool.get(base + i + ',' + j);
    ctx.drawImage(t.canvas, i * TILE - PAD, j * TILE - PAD, side, side);
  }
  return true;
}
