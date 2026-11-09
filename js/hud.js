// Heads-up display, drawn on the canvas in screen pixels.

import { clamp, followRows, formatGap, formatTime, roundRect } from './util.js';
import { PHYS, TIER_COLORS } from './car.js';
import { gearInfo } from './audio.js';
import { POINTS } from './season.js';

const F_DISPLAY = '"Saira Condensed", "Arial Narrow", system-ui, sans-serif';
const F_DATA = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';
const F_UI = '"Titillium Web", system-ui, -apple-system, sans-serif';

const C = {
  panel: 'rgba(11,14,20,0.76)',
  line: 'rgba(255,255,255,0.08)',
  text: '#eef2f8',
  muted: '#8d97ab',
  purple: '#b65cff',
  green: '#31d67b',
  red: '#ff5a4f',
  yellow: '#ffd23f',
  lights: '#ff2a1f',
};

function panel(ctx, x, y, w, h, r = 10) {
  ctx.fillStyle = C.panel;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
}

function text(ctx, s, x, y, font, color, align = 'left', base = 'alphabetic') {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  ctx.fillText(s, x, y);
}

export function drawHUD(ctx, race, cam, w, h, ins, opts) {
  const p = race.player;
  if (!p) return;
  if (race.phase === 'finished') {
    drawFinish(ctx, race, w, h, ins, opts);
    return;
  }
  const L = ins.left + 12;
  const T = ins.top + 10;
  const R = w - ins.right - 12;
  const B = h - ins.bottom - 12;
  const narrow = w < 560;
  const isRace = race.mode === 'race';
  const total = race.totalLaps;

  drawSpeedLines(ctx, p, w, h);

  // ---- position / lap ----
  const pw = narrow ? 100 : 122;
  panel(ctx, L, T, pw, 62);
  if (isRace) {
    text(ctx, `P${p.pos}`, L + 12, T + 42, `900 italic 40px ${F_DISPLAY}`, C.text);
    ctx.font = `900 italic 40px ${F_DISPLAY}`;
    const pwid = ctx.measureText(`P${p.pos}`).width;
    text(ctx, `/${race.cars.length}`, L + 15 + pwid, T + 41, `700 18px ${F_DISPLAY}`, C.muted);
    const lapN = clamp(p.lap + 1, 1, total);
    text(ctx, `LAP ${lapN}/${total}`, L + 13, T + 56, `700 11px ${F_UI}`, C.muted);
  } else {
    text(ctx, 'TIME TRIAL', L + 12, T + 20, `700 11px ${F_UI}`, C.muted);
    text(ctx, `LAP ${Math.max(1, p.lap + 1)}`, L + 12, T + 50, `900 italic 30px ${F_DISPLAY}`, C.text);
  }

  // ---- lap timer or start lights ----
  const cx = w / 2;
  if (race.phase === 'lights' || (race.phase === 'intro' && isRace)) {
    drawLights(ctx, cx, T, race.phase === 'lights' ? race.lit : 0, narrow);
  } else {
    const tw = narrow ? 150 : 184;
    panel(ctx, cx - tw / 2, T, tw, 54);
    let cur = 0;
    if (race.phase === 'race' || race.phase === 'finished') cur = p.lap >= 0 || isRace ? race.time - p.lapStart : 0;
    if (p.finished) cur = p.laps[p.laps.length - 1] || 0;
    text(ctx, formatTime(cur), cx, T + 27, `700 ${narrow ? 19 : 22}px ${F_DATA}`, C.text, 'center');
    if (isRace) {
      const best = p.bestLap;
      const isFastest = race.fastest && race.fastest.car === p;
      text(ctx, `BEST ${formatTime(best)}`, cx, T + 45, `500 ${narrow ? 10 : 11}px ${F_DATA}`, isFastest ? C.purple : C.muted, 'center');
    } else {
      const rec = race.record && race.record.bestLap;
      const d = race.delta;
      if (d != null) {
        text(ctx, `PB ${formatTime(rec)}`, cx - tw / 2 + 10, T + 45, `500 ${narrow ? 10 : 11}px ${F_DATA}`, C.muted);
        text(ctx, formatGap(d), cx + tw / 2 - 10, T + 45, `700 ${narrow ? 10 : 11}px ${F_DATA}`, d <= 0 ? C.green : C.red, 'right');
      } else {
        text(ctx, `PB ${formatTime(rec)}`, cx, T + 45, `500 ${narrow ? 10 : 11}px ${F_DATA}`, rec ? C.purple : C.muted, 'center');
      }
    }
  }

  // ---- minimap ----
  const ms = narrow ? 92 : 136;
  const mx = R - ms;
  const my = T + 54;
  const ev = race.event;
  const tag = ev ? `${ev.round ? `R${ev.round} · ` : ''}${ev.name.toUpperCase()}` : '';
  panel(ctx, mx - 6, my - 6, ms + 12, ms + 12 + (tag ? 18 : 0), 12);
  race.track.drawMinimap(ctx, mx, my, ms, race.cars, p);
  if (tag) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(mx - 4, my + ms, ms + 8, 20);
    ctx.clip();
    text(ctx, tag, mx + ms / 2, my + ms + 12, `800 ${narrow ? 10 : 11}px ${F_DISPLAY}`, C.muted, 'center');
    ctx.restore();
  }

  // ---- timing tower / nearby gaps ----
  if (isRace) {
    if (!narrow && h > 440) drawTower(ctx, race, L, T + 70, p);
    else drawNearby(ctx, race, L, T + 70, p, pw);
  } else if (p.laps.length) {
    drawLapList(ctx, race, L, T + 70, pw, p);
  }

  // ---- speed / gear / drift meter ----
  const sp = Math.max(0, p.forwardSpeed);
  const kmh = Math.round(sp * 0.447);
  const { gear } = gearInfo(sp / PHYS.TOP);
  const sw = 150;
  const sh = 58;
  const portraitTouch = opts.touchUI && h > w;
  const shortLandscape = h < 500 && w > h;
  const sx = cx - sw / 2;
  let sy = portraitTouch ? B - 118 - sh : opts.touchUI ? B - sh : B - sh - 6;
  // Keep the road ahead clear on a phone held sideways: sit under the timer (or the lights).
  if (shortLandscape) sy = T + (race.phase === 'lights' || (race.phase === 'intro' && isRace) ? 86 : 60);
  panel(ctx, sx, sy, sw, sh, 12);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, sx + 8, sy + 8, 30, 30, 7);
  ctx.fill();
  text(ctx, sp < 5 && p.forwardSpeed < -5 ? 'R' : String(gear), sx + 23, sy + 31, `900 22px ${F_DISPLAY}`, C.text, 'center');
  text(ctx, String(kmh), sx + sw - 46, sy + 36, `800 30px ${F_DISPLAY}`, C.text, 'right');
  text(ctx, 'KM/H', sx + sw - 10, sy + 35, `700 10px ${F_UI}`, C.muted, 'right');
  // Drift charge or boost.
  const bx = sx + 8;
  const by = sy + sh - 12;
  const bw = sw - 16;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, bx, by, bw, 5, 2.5);
  ctx.fill();
  let fill = 0;
  let col = '#fff';
  if (p.drifting) {
    fill = clamp(p.driftCharge / 2.2, 0, 1);
    col = TIER_COLORS[Math.max(1, p.driftTier)];
    if (p.driftTier === 0) col = 'rgba(255,255,255,0.6)';
  } else if (p.boost > 0) {
    fill = clamp(p.boost / 1.5, 0, 1);
    col = TIER_COLORS[p.boostLevel] || TIER_COLORS[2];
  }
  if (fill > 0) {
    ctx.fillStyle = col;
    roundRect(ctx, bx, by, Math.max(5, bw * fill), 5, 2.5);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(11,14,20,0.9)';
  for (const tick of [0.6, 1.3]) ctx.fillRect(bx + bw * (tick / 2.2) - 1, by, 2, 5);
  if (p.slipstream > 0.35) {
    text(ctx, 'SLIPSTREAM', cx, shortLandscape ? sy + sh + 14 : sy - 8, `800 12px ${F_DISPLAY}`, '#7fd8ff', 'center');
  }

  // ---- "YOU" marker before the start ----
  if ((race.phase === 'intro' || race.phase === 'lights') && isRace) {
    const [px, py] = cam.toScreen(p.x, p.y);
    const yy = py - 46;
    ctx.fillStyle = C.lights;
    roundRect(ctx, px - 22, yy - 12, 44, 20, 6);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(px - 6, yy + 8);
    ctx.lineTo(px + 6, yy + 8);
    ctx.lineTo(px, yy + 15);
    ctx.fill();
    text(ctx, 'YOU', px, yy + 3, `900 13px ${F_DISPLAY}`, '#fff', 'center');
  }

  // ---- wrong way ----
  if (race.wrongWayT > 0.9 && Math.floor(race.wrongWayT * 3) % 2 === 0) {
    drawBanner(ctx, 'WRONG WAY', C.red, cx, h * 0.38, narrow ? 34 : 44);
  }

  // ---- what we're racing: title card before the start ----
  if (ev && (race.phase === 'intro' || race.phase === 'lights' || (race.phase === 'race' && race.time < 2))) {
    const fade = race.phase === 'race' ? clamp(1 - race.time / 2, 0, 1) : clamp(race.phaseT / 0.4 + (race.phase === 'lights' ? 1 : 0), 0, 1);
    const lightsH = isRace ? (narrow ? 58 : 78) + 10 : 0;
    const cw = Math.min(w - 32, 440);
    let cy = T + lightsH + (isRace ? 0 : 64);
    // Where the card would run into the minimap, drop it below the top panels.
    if (cx + cw / 2 > mx - 12) cy = Math.max(cy, my + ms + (tag ? 18 : 0) + 18);
    drawEventCard(ctx, ev, cx, cy, cw, fade, narrow);
  }

  // ---- messages ----
  let my2 = shortLandscape ? T + 160 : h * (portraitTouch ? 0.24 : 0.27);
  for (const m of race.messages) {
    const appear = clamp(m.t / 0.14, 0, 1);
    const fade = clamp((m.dur - m.t) / 0.3, 0, 1);
    const s = (1 + (1 - appear) * 0.5) * m.scale;
    ctx.globalAlpha = fade;
    drawBanner(ctx, m.text, m.color, cx, my2, (narrow ? 26 : 34) * s);
    ctx.globalAlpha = 1;
    my2 += (narrow ? 34 : 44) * m.scale + 6;
  }
}

function drawBanner(ctx, s, color, x, y, size) {
  ctx.font = `900 italic ${size}px ${F_DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(4, size * 0.16);
  ctx.strokeStyle = 'rgba(8,10,14,0.85)';
  ctx.strokeText(s, x, y);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

function drawEventCard(ctx, ev, cx, y, cw, alpha, narrow) {
  if (alpha <= 0) return;
  const ch = narrow ? 64 : 74;
  const x = cx - cw / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  panel(ctx, x, y, cw, ch, 12);
  ctx.fillStyle = ev.accent || C.lights;
  roundRect(ctx, x + 8, y + 10, 4, ch - 20, 2);
  ctx.fill();
  const eyebrow = ev.round ? `ROUND ${ev.round} OF ${ev.rounds}` : ev.mode === 'trial' ? 'TIME TRIAL' : 'RACE';
  text(ctx, eyebrow, x + 22, y + (narrow ? 19 : 22), `800 ${narrow ? 10 : 11}px ${F_DISPLAY}`, C.muted);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 20, y, cw - 30, ch);
  ctx.clip();
  text(ctx, ev.gp.toUpperCase(), x + 22, y + (narrow ? 41 : 48), `900 italic ${narrow ? 21 : 26}px ${F_DISPLAY}`, C.text);
  const place = ev.name === ev.country ? ev.name : `${ev.name} · ${ev.country}`;
  const sub = ev.mode === 'trial' ? place : `${place} · ${ev.laps} laps`;
  text(ctx, sub, x + 22, y + (narrow ? 56 : 65), `600 ${narrow ? 11 : 12}px ${F_UI}`, C.muted);
  ctx.restore();
  ctx.restore();
}

function drawLights(ctx, cx, T, lit, narrow) {
  const r = narrow ? 9 : 14;
  const gap = r * 2 + (narrow ? 7 : 10);
  const w = gap * 5 + 14;
  const h = r * 2 * 2 + 22;
  const x0 = cx - w / 2;
  panel(ctx, x0, T, w, h, 12);
  for (let k = 0; k < 5; k++) {
    const x = x0 + 7 + gap / 2 + k * gap;
    for (let row = 0; row < 2; row++) {
      const y = T + 11 + r + row * (r * 2 + 2);
      const on = k < lit;
      if (on) {
        ctx.fillStyle = 'rgba(255,42,31,0.28)';
        ctx.beginPath();
        ctx.arc(x, y, r + 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = on ? C.lights : '#1a1c22';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function teammateOf(race, p) {
  return race.cars.find((c) => c !== p && c.teamId && c.teamId === p.teamId) || null;
}

function drawTower(ctx, race, x, y, p) {
  const rowH = 20;
  const w = 168;
  const order = race.order;
  const mate = teammateOf(race, p);
  // Gap to the leader for everyone, built from car-to-car intervals.
  const gaps = [0];
  for (let i = 1; i < order.length; i++) {
    const prev = order[i - 1];
    const c = order[i];
    let g;
    if (c.finished && prev.finished) g = c.finishTime - prev.finishTime;
    else {
      const v = Math.max(150, (Math.max(0, prev.forwardSpeed) + Math.max(0, c.forwardSpeed)) / 2);
      g = Math.abs(prev.progress - c.progress) / v;
    }
    gaps.push(gaps[i - 1] + g);
  }
  // A window of ten that follows you (you in the middle, unless you're near
  // the front or the back), plus the leader and your teammate if they're
  // outside it. Gaps in the order are marked.
  const rows = followRows(order.length, order.indexOf(p), 10, [0, order.indexOf(mate)]);
  const height = rows.reduce((hgt, i) => hgt + (i < 0 ? 8 : rowH), 0) + 10;
  panel(ctx, x, y, w, height, 10);
  let ry = y + 5;
  for (const i of rows) {
    if (i < 0) {
      ctx.fillStyle = C.line;
      ctx.fillRect(x + 12, ry + 3, w - 24, 2);
      ry += 8;
      continue;
    }
    const c = order[i];
    if (c === p || c === mate) {
      ctx.fillStyle = c === p ? 'rgba(255,255,255,0.13)' : 'rgba(255,210,63,0.13)';
      roundRect(ctx, x + 4, ry, w - 8, rowH - 1, 5);
      ctx.fill();
    }
    text(ctx, String(i + 1), x + 18, ry + 14, `700 12px ${F_DATA}`, C.muted, 'center');
    ctx.fillStyle = c.livery.color;
    ctx.fillRect(x + 30, ry + 4, 3, rowH - 9);
    text(ctx, c.code, x + 40, ry + 14, `800 14px ${F_DISPLAY}`, c === mate ? C.yellow : C.text);
    const g = i === 0 ? (c.finished ? 'FINISH' : 'LEADER') : formatGap(gaps[i]);
    text(ctx, g, x + w - 10, ry + 14, `500 11px ${F_DATA}`, i === 0 ? C.muted : C.text, 'right');
    if (race.fastest && race.fastest.car === c) {
      ctx.fillStyle = C.purple;
      ctx.beginPath();
      ctx.arc(x + 82, ry + 10, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ry += rowH;
  }
}

function drawNearby(ctx, race, x, y, p, w) {
  const idx = race.order.indexOf(p);
  const ahead = race.order[idx - 1];
  const behind = race.order[idx + 1];
  // Interval from the distance between the cars and how fast they're going.
  const interval = (a, b) => {
    const v = Math.max(150, (Math.max(0, a.forwardSpeed) + Math.max(0, b.forwardSpeed)) / 2);
    return `${(Math.abs(a.progress - b.progress) / v).toFixed(1)}s`;
  };
  const lines = [];
  if (ahead && !ahead.finished) lines.push(['▲', ahead, interval(ahead, p)]);
  if (behind) lines.push(['▼', behind, interval(p, behind)]);
  const mate = teammateOf(race, p);
  if (mate && mate !== ahead && mate !== behind) {
    const matesAhead = race.order.indexOf(mate) < idx;
    lines.push(['TM', mate, `${matesAhead ? '▲' : '▼'}${matesAhead ? interval(mate, p) : interval(p, mate)}`]);
  }
  if (!lines.length) return;
  panel(ctx, x, y, w, lines.length * 20 + 8, 10);
  lines.forEach(([arrow, c, g], i) => {
    const ry = y + 4 + i * 20;
    text(ctx, arrow, x + 8, ry + 15, `700 ${arrow === 'TM' ? 8 : 10}px ${F_UI}`, arrow === '▲' ? C.green : arrow === 'TM' ? C.yellow : C.red);
    ctx.fillStyle = c.livery.color;
    ctx.fillRect(x + 23, ry + 4, 3, 13);
    text(ctx, c.code, x + 31, ry + 15, `800 13px ${F_DISPLAY}`, C.text);
    text(ctx, g, x + w - 8, ry + 15, `500 10px ${F_DATA}`, C.text, 'right');
  });
}

function drawLapList(ctx, race, x, y, w, p) {
  const laps = p.laps.slice(-4);
  const offset = p.laps.length - laps.length;
  const best = p.bestLap;
  panel(ctx, x, y, w, laps.length * 18 + 8, 10);
  laps.forEach((lt, i) => {
    const ry = y + 4 + i * 18;
    text(ctx, `L${offset + i + 1}`, x + 10, ry + 13, `700 10px ${F_UI}`, C.muted);
    text(ctx, formatTime(lt), x + w - 8, ry + 13, `500 11px ${F_DATA}`, lt === best ? C.purple : C.text, 'right');
  });
}

function drawSpeedLines(ctx, p, w, h) {
  const k = p.boost > 0 ? 1 : p.slipstream > 0.4 ? (p.slipstream - 0.4) * 1.2 : 0;
  if (k <= 0) return;
  ctx.save();
  ctx.strokeStyle = `rgba(255,255,255,${0.16 * k})`;
  ctx.lineWidth = 2;
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.hypot(w, h) / 2;
  ctx.beginPath();
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2;
    const r0 = R * (0.55 + Math.random() * 0.25);
    const r1 = r0 + R * (0.12 + Math.random() * 0.2);
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
  }
  ctx.stroke();
  ctx.restore();
}

// ---------- the finish ----------

const POS_COLOR = ['', '#ffd23f', '#d9dee7', '#d58b4a'];
const confetti = new WeakMap();

function drawFinish(ctx, race, w, h, ins, opts) {
  const p = race.player;
  const pos = p.finishPos;
  const t = race.finishReal;
  const ease = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
  const backOut = (x) => {
    const c = 1.9;
    const u = clamp(x, 0, 1) - 1;
    return 1 + (c + 1) * u * u * u + c * u * u;
  };

  // Darken the race behind.
  ctx.fillStyle = `rgba(6,8,12,${0.66 * ease(t / 0.5)})`;
  ctx.fillRect(0, 0, w, h);

  const narrow = w < 560;
  const cy = h * (narrow ? 0.42 : 0.44);
  const big = narrow ? 104 : 140;

  // Chequered bands sweep across, above and below the card.
  const sq = clamp(Math.round(w / 24), 14, 28);
  const reveal = ease((t - 0.05) / 0.45);
  const gap = big * 0.95;
  // The lower band sits below the last line of text (the card pops up to ~10% larger).
  const textBottom = (big * 0.5 + (narrow ? 28 : 34) + (opts.season ? (narrow ? 24 : 28) : 0) + 14) * 1.1;
  drawChequer(ctx, w, cy - gap - sq * 2, sq, t * 70, reveal);
  drawChequer(ctx, w, cy + textBottom, sq, -t * 70, reveal);
  const ev = race.event;
  if (ev) {
    const yTop = cy - gap - sq * 2;
    ctx.globalAlpha = clamp((t - 0.2) / 0.4, 0, 1);
    text(ctx, ev.gp.toUpperCase(), w / 2, yTop - (narrow ? 14 : 18), `900 italic ${narrow ? 22 : 28}px ${F_DISPLAY}`, '#ffffff', 'center');
    if (ev.round) text(ctx, `ROUND ${ev.round} OF ${ev.rounds} · ${ev.name.toUpperCase()}`, w / 2, yTop - (narrow ? 40 : 50), `800 ${narrow ? 11 : 12}px ${F_DISPLAY}`, C.muted, 'center');
    else text(ctx, ev.name.toUpperCase(), w / 2, yTop - (narrow ? 40 : 50), `800 ${narrow ? 11 : 12}px ${F_DISPLAY}`, C.muted, 'center');
    ctx.globalAlpha = 1;
  }

  // The result.
  const appear = clamp((t - 0.12) / 0.3, 0, 1);
  const pop = 0.6 + 0.4 * backOut((t - 0.12) / 0.5);
  ctx.save();
  ctx.globalAlpha = appear;
  ctx.translate(w / 2, cy);
  ctx.scale(pop, pop);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${narrow ? 13 : 15}px ${F_DISPLAY}`;
  ctx.fillStyle = C.muted;
  ctx.fillText('C H E Q U E R E D   F L A G', 0, -big * 0.62);
  ctx.font = `900 italic ${big}px ${F_DISPLAY}`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = big * 0.08;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeText(`P${pos}`, 0, -big * 0.08);
  ctx.fillStyle = POS_COLOR[pos] || '#ffffff';
  ctx.fillText(`P${pos}`, 0, -big * 0.08);
  const head = pos === 1 ? 'YOU WIN!' : pos <= 3 ? 'PODIUM!' : pos <= 10 ? 'IN THE POINTS' : 'FINISHED';
  ctx.font = `900 italic ${narrow ? 26 : 32}px ${F_DISPLAY}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(head, 0, big * 0.5);
  const bits = [formatTime(p.finishTime)];
  if (p.bestLap) bits.push(`best lap ${formatTime(p.bestLap)}`);
  ctx.font = `500 ${narrow ? 12 : 14}px ${F_DATA}`;
  ctx.fillStyle = race.fastest && race.fastest.car === p ? C.purple : C.muted;
  ctx.fillText(bits.join('  ·  '), 0, big * 0.5 + (narrow ? 28 : 34));
  if (opts.season) {
    const pts = POINTS[pos - 1] || 0;
    ctx.font = `800 ${narrow ? 15 : 17}px ${F_DISPLAY}`;
    ctx.fillStyle = pts ? C.green : C.muted;
    ctx.fillText(pts ? `+${pts} CHAMPIONSHIP POINTS` : 'NO POINTS THIS TIME', 0, big * 0.5 + (narrow ? 52 : 62));
  }
  ctx.restore();

  // Confetti for a podium.
  if (pos <= 3) drawConfetti(ctx, race, w, h, opts.dt || 1 / 60, pos);

  if (t > 1.5 && Math.floor(t * 2) % 2 === 0) {
    text(ctx, opts.touchUI ? 'Tap to continue' : 'Press Enter or click to continue', w / 2, h - ins.bottom - 34, `600 14px ${F_UI}`, 'rgba(238,242,248,0.8)', 'center');
  }
}

function drawChequer(ctx, w, y, sq, shift, reveal) {
  if (reveal <= 0) return;
  const width = w * reveal;
  const x0 = (w - width) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y, width, sq * 2);
  ctx.clip();
  ctx.fillStyle = '#f4f4f4';
  ctx.fillRect(x0, y, width, sq * 2);
  ctx.fillStyle = '#111215';
  const off = ((shift % (sq * 2)) + sq * 2) % (sq * 2);
  for (let r = 0; r < 2; r++) {
    for (let x = -sq * 2 + off + r * sq; x < w + sq; x += sq * 2) ctx.fillRect(x, y + r * sq, sq, sq);
  }
  ctx.restore();
}

function drawConfetti(ctx, race, w, h, dt, pos) {
  let bits = confetti.get(race);
  if (!bits) {
    const palette = pos === 1 ? ['#ffd23f', '#ffb020', '#ffffff', '#ff2a1f', '#31d67b'] : ['#ffffff', '#ffd23f', '#4fc3ff', '#ff2a1f', '#c45cff'];
    bits = [];
    for (let i = 0; i < (pos === 1 ? 170 : 110); i++) {
      bits.push({
        x: Math.random() * w,
        y: -Math.random() * h * 0.8,
        vx: (Math.random() - 0.5) * 80,
        vy: 140 + Math.random() * 200,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 10,
        s: 5 + Math.random() * 6,
        c: palette[i % palette.length],
      });
    }
    confetti.set(race, bits);
  }
  for (const b of bits) {
    b.x += (b.vx + Math.sin(b.y * 0.02) * 30) * dt;
    b.y += b.vy * dt;
    b.r += b.vr * dt;
    if (b.y > h + 20) continue;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.r);
    ctx.fillStyle = b.c;
    ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
    ctx.restore();
  }
}
