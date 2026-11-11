// Heads-up display, drawn on the canvas in screen pixels.

import { clamp, followRows, formatGap, formatTime, roundRect } from './util.js';
import { PHYS, TIER_COLORS } from './car.js';
import { gearInfo } from './audio.js';
import { POINTS } from './season.js';
import { PIT_GAME, WHEELS } from './pit.js';
import { OVERTAKE } from './race.js';

const F_DISPLAY = '"Saira Condensed", "Arial Narrow", system-ui, sans-serif';
const F_DATA = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';
const SLIP_COL = '#7fd8ff';
const OT_COL = '#5dff9d'; // overtake mode (see OVERTAKE in race.js)
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
  // Phone held sideways with the buttons on screen: keep the middle clear.
  if (opts.touchUI && opts.ctl && h < 500 && w > h) {
    drawSideHUD(ctx, race, cam, w, h, ins, opts);
    return;
  }
  const L = ins.left + 12;
  const T = ins.top + 10;
  const R = w - ins.right - 12;
  const B = h - ins.bottom - 12;
  const narrow = w < 560;
  const isRace = race.mode === 'race';
  const qs = race.quali;
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
  } else if (qs) {
    // Out-lap, then your provisional place as the flying lap goes on.
    text(ctx, qs.stage === 'out' ? 'QUALIFYING' : 'FLYING LAP', L + 12, T + 20, `700 11px ${F_UI}`, C.muted);
    if (qs.stage !== 'out' && qs.live) {
      text(ctx, `P${qs.live}`, L + 12, T + 52, `900 italic 34px ${F_DISPLAY}`, C.text);
      ctx.font = `900 italic 34px ${F_DISPLAY}`;
      const pwid = ctx.measureText(`P${qs.live}`).width;
      text(ctx, `/${race.cars.length + qs.order.length}`, L + 15 + pwid, T + 51, `700 16px ${F_DISPLAY}`, C.muted);
    } else text(ctx, qs.stage === 'out' ? 'OUT LAP' : 'P–', L + 12, T + 50, `900 italic ${narrow ? 26 : 30}px ${F_DISPLAY}`, C.text);
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
    const cur = lapClock(race, p);
    text(ctx, formatTime(cur), cx, T + 27, `700 ${narrow ? 19 : 22}px ${F_DATA}`, qs && qs.stage === 'out' ? C.muted : C.text, 'center');
    if (qs) {
      // The time to beat, and on the flying lap how you're doing against it.
      const pole = qs.pole ? `POLE ${formatTime(qs.pole.time)}` : 'POLE -:--.---';
      const d = race.delta;
      const font = `500 ${narrow ? 10 : 11}px ${F_DATA}`;
      if (d != null && qs.stage === 'flying') {
        text(ctx, pole, cx - tw / 2 + 10, T + 45, font, C.purple);
        text(ctx, formatGap(d), cx + tw / 2 - 10, T + 45, `700 ${narrow ? 10 : 11}px ${F_DATA}`, d <= 0 ? C.green : C.red, 'right');
      } else text(ctx, qs.pole ? `${pole} ${qs.pole.code}` : pole, cx, T + 45, font, qs.pole ? C.purple : C.muted, 'center');
    } else if (isRace) {
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
  const ms = narrow || (opts.touchUI && h < 500) ? 92 : 136; // small on phones, so the pedals stay clear
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
  } else if (qs) {
    if (!narrow && h > 440) drawQualiBoard(ctx, race, L, T + 70, 168, 12);
    else drawQualiBoard(ctx, race, L, T + 70, pw, 4);
  } else if (p.laps.length) {
    drawLapList(ctx, race, L, T + 70, pw, p);
  }

  // ---- speed / gear / drift meter ----
  const sw = 150;
  const sh = 58;
  const portraitTouch = opts.touchUI && h > w;
  const shortLandscape = h < 500 && w > h;
  const sx = cx - sw / 2;
  let sy = portraitTouch ? B - 118 - sh : opts.touchUI ? B - sh : B - sh - 6;
  // Keep the road ahead clear on a phone held sideways: sit under the timer (or the lights).
  if (shortLandscape) sy = T + (race.phase === 'lights' || (race.phase === 'intro' && isRace) ? 86 : 60);
  drawSpeedPanel(ctx, p, sx, sy, sw, sh);
  if (p.wears) drawCondition(ctx, p, sx + sw + 8, sy, 104, sh, race.time);
  // ---- on a phone: how far you're steering, and gas and brake ----
  const gauges = !!opts.touchUI;
  if (race.pits) drawPitStatus(ctx, race, p, sx - (gauges ? 14 : 0) - 8 - 84, sy, 84, sh, race.time);
  const below = gauges && shortLandscape ? 18 : 0; // steering bar goes under the panel when sideways
  if (gauges) drawInputs(ctx, p, sx, sy, sw, sh, shortLandscape ? sy + sh + 6 : sy - 18);

  drawCarTags(ctx, race, cam, w, h);

  // ---- your pit stop call, then the corner call: under the timer (under
  // the speed panel when sideways) ----
  const callY = shortLandscape ? sy + sh + 8 + below : T + 62;
  const room = Math.min(cx - (L + pw) - 8, mx - 6 - cx - 8) * 2;
  const callW = Math.min(narrow ? 172 : 214, room);
  const pitH = drawPitCall(ctx, race, cx, callY, Math.min(300, room), race.time);
  if (race.call) drawCall(ctx, race.call, cx, callY + pitH, callW, race.time);
  // ---- the pit stop you play: above the speed panel (at the bottom when sideways) ----
  if (race.pits && race.pits.game) {
    const gw = Math.min(320, w - 24);
    const gh = 112;
    const gy = shortLandscape ? B - gh : sy - gh - (gauges ? 26 : 12);
    drawPitGame(ctx, race.pits.game, cx - gw / 2, gy, gw, gh, race.time, !!opts.touchUI);
  }

  // ---- which car is yours, on the grid and just after the start ----
  drawYouMarker(ctx, race, cam);
  drawGhostTag(ctx, race, cam);

  // ---- wrong way ----
  if (race.wrongWayT > 0.9 && Math.floor(race.wrongWayT * 3) % 2 === 0) {
    drawBanner(ctx, 'WRONG WAY', C.red, cx, h * 0.38, narrow ? 34 : 44);
  }

  // ---- what we're racing: title card before the start ----
  if (ev && (race.phase === 'intro' || race.phase === 'lights' || (race.phase === 'race' && race.time < 2 && !race.call))) {
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

// Steering as a bar with a centre mark (yellow: how far you're turning), and
// brake (left) and gas (right) as upright bars beside the speed panel.
function drawInputs(ctx, p, sx, sy, sw, sh, gy) {
  panel(ctx, sx, gy, sw, 12, 6);
  const mid = sx + sw / 2;
  const half = sw / 2 - 12;
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(sx + 12, gy + 5, sw - 24, 2);
  const st = clamp(p.steer, -1, 1);
  const x1 = mid + st * half;
  ctx.fillStyle = C.yellow;
  ctx.fillRect(Math.min(mid, x1), gy + 4, Math.abs(x1 - mid), 4);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(mid - 1, gy + 2, 2, 8);
  ctx.beginPath();
  ctx.arc(x1, gy + 6, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = Math.abs(st) > 0.03 ? C.yellow : 'rgba(255,255,255,0.75)';
  ctx.fill();
  const bar = (x, v, col) => {
    panel(ctx, x, sy, 10, sh, 5);
    if (v > 0.01) {
      const hh = (sh - 6) * clamp(v, 0, 1);
      ctx.fillStyle = col;
      roundRect(ctx, x + 2, sy + sh - 3 - hh, 6, hh, 3);
      ctx.fill();
    }
  };
  bar(sx - 14, p.brake, C.red);
  bar(sx + sw + 4, p.gas, C.green);
}

// Gear, speed and the drift / boost / slipstream bar.
function drawSpeedPanel(ctx, p, sx, sy, sw, sh) {
  const sp = Math.max(0, p.forwardSpeed);
  const kmh = Math.round(sp * 0.447);
  const { gear } = gearInfo(sp / PHYS.TOP);
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
  drawMeter(ctx, p, bx, by, bw);
}

// Speed as a compact tile: gear, km/h and the drift / boost / slipstream bar.
function drawSpeedTile(ctx, p, x, y, w, h) {
  const sp = Math.max(0, p.forwardSpeed);
  const kmh = Math.round(sp * 0.447);
  const { gear } = gearInfo(sp / PHYS.TOP);
  panel(ctx, x, y, w, h, 12);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, x + 8, y + 8, 24, 24, 6);
  ctx.fill();
  text(ctx, sp < 5 && p.forwardSpeed < -5 ? 'R' : String(gear), x + 20, y + 26, `900 17px ${F_DISPLAY}`, C.text, 'center');
  text(ctx, 'KM/H', x + w - 9, y + 24, `700 9px ${F_UI}`, C.muted, 'right');
  text(ctx, String(kmh), x + w - 9, y + 61, `800 32px ${F_DISPLAY}`, C.text, 'right');
  const bx = x + 8;
  const by = y + h - 13;
  const bw = w - 16;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, bx, by, bw, 5, 2.5);
  ctx.fill();
  drawMeter(ctx, p, bx, by, bw);
}

// The call for the corner ahead: an arrow (a hook for a corner, a U for a
// hairpin, a zig-zag for a chicane), its name, and a bar running down to
// where you need to slow down; then a flashing BRAKE! there.
const CALL_LOOK = {
  lift: { col: '#ffd23f', name: (d) => d },
  hard: { col: '#ff8a2f', name: (d) => `HARD ${d}` },
  hairpin: { col: '#ff5a3c', name: (d) => `HAIRPIN ${d}` },
  chicane: { col: '#ff5a3c', name: () => 'CHICANE' },
};

export function drawCall(ctx, note, cx, y, pw, time) {
  const c = note.c;
  const look = CALL_LOOK[c.kind] || CALL_LOOK.hard;
  const dir = c.dir > 0 ? 'RIGHT' : 'LEFT';
  const ph = 42;
  const x = cx - pw / 2;
  ctx.save();
  ctx.globalAlpha = clamp(note.fade, 0, 1) * clamp(note.t / 0.12, 0, 1);
  if (note.stage === 'brake' || (note.stage === 'done' && note.tt < 0.3 && c.brake)) {
    const on = Math.floor(time * 10) % 2 === 0;
    ctx.fillStyle = on ? '#e8261c' : '#9d1a13';
    roundRect(ctx, x, y, pw, ph, 10);
    ctx.fill();
    drawBanner(ctx, 'BRAKE!', '#fff', cx, y + ph / 2 + 1, 28);
    ctx.restore();
    return;
  }
  panel(ctx, x, y, pw, ph, 10);
  const urgency = 1 - clamp(note.tt / note.warnAt, 0, 1);
  const col = look.col;
  ctx.strokeStyle = col;
  ctx.lineWidth = 2;
  roundRect(ctx, x + 1, y + 1, pw - 2, ph - 2, 9);
  ctx.stroke();
  ctx.save();
  ctx.translate(x + 22, y + 20);
  ctx.scale(c.dir < 0 ? -1.15 : 1.15, 1.15);
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = 2.8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (c.kind === 'hairpin') {
    // Like the road sign: a long way in, a tight turn over the top, and a
    // short way back down to a big arrowhead, so left and right differ at a glance.
    ctx.moveTo(-8, 13);
    ctx.lineTo(-8, -4);
    ctx.arc(-2.5, -4, 5.5, Math.PI, 0);
    ctx.lineTo(3, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-3, -1);
    ctx.lineTo(9, -1);
    ctx.lineTo(3, 8);
    ctx.closePath();
  } else if (c.kind === 'chicane') {
    ctx.moveTo(-6, 11);
    ctx.lineTo(-6, 4);
    ctx.lineTo(4, -2);
    ctx.lineTo(4, -6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-1, -5);
    ctx.lineTo(4, -12);
    ctx.lineTo(9, -5);
    ctx.closePath();
  } else {
    ctx.moveTo(-6, 10);
    ctx.lineTo(-6, 0);
    ctx.quadraticCurveTo(-6, -6, 0, -6);
    ctx.lineTo(3, -6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(3, -11);
    ctx.lineTo(10, -6);
    ctx.lineTo(3, -1);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 38, y, pw - 44, ph);
  ctx.clip();
  const big = pw > 190 ? 21 : 18;
  text(ctx, look.name(dir), x + 40, y + 24, `900 italic ${big}px ${F_DISPLAY}`, C.text);
  ctx.restore();
  // Countdown to where you need to slow down.
  const bx = x + 40;
  const bw = pw - 50;
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  roundRect(ctx, bx, y + 31, bw, 4, 2);
  ctx.fill();
  ctx.fillStyle = col;
  roundRect(ctx, bx, y + 31, Math.max(4, bw * (1 - urgency)), 4, 2);
  ctx.fill();
  ctx.restore();
}

// Tyres and car condition: two rows with a percentage and a bar, green to
// red as they drop; CAR flashes red when you've just taken damage.
function conditionColor(v, tyres = false) {
  if (tyres) return v >= 0.75 ? C.green : v >= 0.55 ? C.yellow : v >= 0.35 ? '#ff8a2f' : C.red;
  return v >= 0.9 ? C.green : v >= 0.75 ? C.yellow : v >= 0.55 ? '#ff8a2f' : C.red;
}

function drawCondition(ctx, p, x, y, w, h, time, compact = false) {
  panel(ctx, x, y, w, h, compact ? 10 : 12);
  const rows = [
    ['TYRES', p.tyres, 0],
    ['CAR', 1 - p.damage, p.hitT],
  ];
  const rh = h / 2;
  rows.forEach(([label, v, flash], k) => {
    const ry = y + k * rh;
    if (flash > 0 && Math.floor(time * 12) % 2 === 0) {
      ctx.fillStyle = 'rgba(255,79,58,0.32)';
      roundRect(ctx, x + 3, ry + 3, w - 6, rh - 6, 6);
      ctx.fill();
    }
    const col = conditionColor(v, k === 0);
    const pct = `${Math.round(v * 100)}%`;
    text(ctx, label, x + 8, ry + rh * 0.48, `700 ${compact ? 9 : 10}px ${F_UI}`, C.muted);
    text(ctx, pct, x + w - 8, ry + rh * 0.52, `800 ${compact ? 13 : 16}px ${F_DISPLAY}`, col, 'right');
    const bx = x + 8;
    const bw = w - 16;
    const by = ry + rh - (compact ? 6 : 8);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    roundRect(ctx, bx, by, bw, 3, 1.5);
    ctx.fill();
    ctx.fillStyle = col;
    roundRect(ctx, bx, by, Math.max(3, bw * clamp(v, 0, 1)), 3, 1.5);
    ctx.fill();
  });
}

// ---------- pit stops ----------

// Whether you've made your stop: DUE (BOX THIS LAP on your last chance,
// flashing), or a tick and how long you stood.
function drawPitStatus(ctx, race, p, x, y, w, h, time, compact = false) {
  const done = p.stops > 0;
  const last = !done && race.pits.lastLap();
  const flash = last && Math.floor(time * 3) % 2 === 0;
  panel(ctx, x, y, w, h, compact ? 8 : 12);
  if (flash) {
    ctx.fillStyle = 'rgba(255,210,63,0.22)';
    roundRect(ctx, x + 2, y + 2, w - 4, h - 4, compact ? 6 : 10);
    ctx.fill();
  }
  const inPit = !!p.pit && p.pit.stage !== 'out';
  const col = inPit ? '#4fa3ff' : done ? C.green : last ? C.yellow : '#ffb020';
  const stood = done ? `${p.stopTimes[p.stopTimes.length - 1].toFixed(1)}s` : '';
  const word = inPit ? 'IN PIT' : last ? 'BOX NOW' : 'DUE';
  if (compact) {
    text(ctx, 'PIT', x + 8, y + h / 2 + 4, `700 9px ${F_UI}`, C.muted);
    text(ctx, done && !inPit ? `✓ ${stood}` : word, x + w - 8, y + h / 2 + 5, `800 13px ${F_DISPLAY}`, col, 'right');
    return;
  }
  text(ctx, 'PIT STOP', x + 9, y + 17, `700 10px ${F_UI}`, C.muted);
  if (done && !inPit) {
    text(ctx, '✓', x + 10, y + 44, `900 22px ${F_DISPLAY}`, col);
    text(ctx, stood, x + w - 9, y + 43, `800 16px ${F_DISPLAY}`, C.text, 'right');
  } else {
    text(ctx, word, x + 9, y + 43, `900 italic ${word === 'DUE' ? 21 : 19}px ${F_DISPLAY}`, col);
  }
}

// PIT ENTRY coming up: an arrow to the side the entry is on.
// The pit stop you still owe: close to the entry, a big card with the side
// to keep to; before that, all through your last chance, BOX THIS LAP.
// Returns the height it took.
function drawPitCall(ctx, race, cx, y, w, time) {
  const pits = race.pits;
  const p = race.player;
  if (!pits || !p || p.pit || p.finished || race.phase !== 'race') return 0;
  const hint = pits.hint();
  if (hint) return drawPitHint(ctx, hint, cx, y, w, time) + 8;
  if (!pits.lastLap()) return 0;
  const bh = 40;
  const x = cx - w / 2;
  const on = Math.floor(time * 2.5) % 2 === 0;
  ctx.fillStyle = on ? C.yellow : '#c9a224';
  roundRect(ctx, x, y, w, bh, 10);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.stroke();
  text(ctx, 'BOX THIS LAP', cx, y + 27, `900 italic 26px ${F_DISPLAY}`, '#14161b', 'center');
  return bh + 8;
}

function drawPitHint(ctx, hint, cx, y, pw, time) {
  const ph = 58;
  const x = cx - pw / 2;
  const right = hint.side > 0;
  const col = hint.last ? C.yellow : '#4fa3ff';
  const flash = hint.last && Math.floor(time * 5) % 2 === 0;
  panel(ctx, x, y, pw, ph, 12);
  if (flash) {
    ctx.fillStyle = 'rgba(255,210,63,0.25)';
    roundRect(ctx, x, y, pw, ph, 12);
    ctx.fill();
  }
  ctx.strokeStyle = col;
  ctx.lineWidth = 3;
  roundRect(ctx, x + 1.5, y + 1.5, pw - 3, ph - 3, 11);
  ctx.stroke();
  // Two arrows, nudging toward the entry.
  const nudge = Math.sin(time * 8) * 3;
  for (const off of [0, 14]) {
    const ax = right ? x + pw - 40 + off + nudge : x + 40 - off - nudge;
    ctx.save();
    ctx.translate(ax, y + ph / 2);
    ctx.scale(right ? 1 : -1, 1);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(-11, -14);
    ctx.lineTo(5, 0);
    ctx.lineTo(-11, 14);
    ctx.lineTo(-6, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  const tx = right ? x + 14 : x + 66;
  text(ctx, hint.last ? 'BOX NOW · LAST CHANCE' : 'PIT ENTRY', tx, y + 20, `800 11px ${F_UI}`, col);
  text(ctx, `KEEP ${right ? 'RIGHT' : 'LEFT'}`, tx, y + 47, `900 italic 27px ${F_DISPLAY}`, C.text);
  return ph;
}

// The stop you play: four wheel guns, then the release light.
function drawPitGame(ctx, g, x, y, w, h, time, touch) {
  const G = PIT_GAME;
  panel(ctx, x, y, w, h, 12);
  const pad = 12;
  const key = touch ? 'TAP GAS' : 'PRESS ↑';
  let title = 'JACK UP';
  if (g.phase === 'wheels') title = WHEELS[Math.min(3, g.wheel)];
  else if (g.phase === 'jackDown') title = 'JACK DOWN';
  else if (g.phase === 'light' || g.phase === 'go') title = 'RELEASE';
  text(ctx, title, x + pad, y + 20, `900 italic 17px ${F_DISPLAY}`, C.text);
  // The stop's own clock (the race waits while you play).
  text(ctx, `${g.t.toFixed(2)}s`, x + w - pad, y + 20, `700 14px ${F_DATA}`, C.muted, 'right');
  ctx.font = `700 14px ${F_DATA}`;
  const tw = ctx.measureText(`${g.t.toFixed(2)}s`).width;
  text(ctx, 'STOP', x + w - pad - tw - 6, y + 19, `700 9px ${F_UI}`, C.muted, 'right');

  // The four wheels, as a little car seen from above: front at the top.
  const cxw = x + pad + 12;
  const cyw = y + 45;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  roundRect(ctx, cxw - 4, cyw - 13, 8, 26, 3);
  ctx.fill();
  const pos = [
    [-9, -9],
    [9, -9],
    [-9, 9],
    [9, 9],
  ];
  pos.forEach(([dx, dy], i) => {
    const on = g.done[i];
    const now = g.phase === 'wheels' && g.wheel === i;
    ctx.fillStyle = on ? C.green : now ? (Math.floor(time * 6) % 2 ? C.yellow : '#7a6a2a') : '#2c313b';
    roundRect(ctx, cxw + dx - 3.5, cyw + dy - 5.5, 7, 11, 2);
    ctx.fill();
  });

  const bx = x + pad + 34;
  const bw = w - pad * 2 - 34;
  const by = y + 34;
  if (g.phase === 'wheels' || g.phase === 'jackUp') {
    // Bar with the green zone and the moving marker.
    const bh = 22;
    ctx.fillStyle = '#1a1e26';
    roundRect(ctx, bx, by, bw, bh, 6);
    ctx.fill();
    if (g.phase === 'wheels') {
      const zx = bx + bw * (g.zone - G.green / 2 - G.ok);
      ctx.fillStyle = 'rgba(255,210,63,0.35)';
      ctx.fillRect(zx, by + 2, bw * (G.green + 2 * G.ok), bh - 4);
      ctx.fillStyle = C.green;
      ctx.fillRect(bx + bw * (g.zone - G.green / 2), by + 2, bw * G.green, bh - 4);
      const locked = g.lock > 0;
      const mx = bx + bw * clamp(g.m, 0, 1);
      ctx.fillStyle = locked ? C.red : '#ffffff';
      ctx.fillRect(mx - 2, by - 3, 4, bh + 6);
      ctx.beginPath();
      ctx.moveTo(mx - 6, by - 7);
      ctx.lineTo(mx + 6, by - 7);
      ctx.lineTo(mx, by - 1);
      ctx.closePath();
      ctx.fill();
    }
    const hintText = g.phase === 'wheels' ? `${key} ON THE GREEN` : 'CAR UP ON THE JACKS';
    text(ctx, hintText, x + pad, y + h - 14, `700 11px ${F_UI}`, C.muted);
  } else {
    // Release light.
    const green = (g.green || g.phase === 'go') && !g.waiting;
    const lx = bx + 22;
    const ly = by + 22;
    ctx.fillStyle = '#0c0d10';
    ctx.beginPath();
    ctx.arc(lx, ly, 19, 0, Math.PI * 2);
    ctx.fill();
    if (g.phase !== 'jackDown') {
      ctx.fillStyle = green ? 'rgba(49,214,123,0.3)' : 'rgba(255,42,31,0.3)';
      ctx.beginPath();
      ctx.arc(lx, ly, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = green ? C.green : C.lights;
      ctx.beginPath();
      ctx.arc(lx, ly, 15, 0, Math.PI * 2);
      ctx.fill();
    }
    const wingWait = g.phase === 'jackDown' && g.pt >= PIT_GAME.jackDown && g.wingShow < 1;
    const big = wingWait ? 'WING…' : g.phase === 'jackDown' ? 'DOWN…' : g.waiting ? 'HOLD' : green ? 'GO!' : 'WAIT…';
    text(ctx, big, lx + 32, ly + 9, `900 italic 28px ${F_DISPLAY}`, green ? C.green : C.text);
    // Why the light is still red, when it isn't down to you.
    const hint = g.waiting ? 'CAR COMING DOWN THE LANE' : green ? `${key} NOW` : wingWait ? 'FITTING THE NEW FRONT WING' : `${key} ON GREEN`;
    text(ctx, hint, x + pad, y + h - 14, `700 11px ${F_UI}`, g.waiting || wingWait ? '#ff8a2f' : C.muted);
  }
  // Front wing change, alongside.
  if (g.wingNeed) {
    const s = clamp(g.wingShow ?? 0, 0, 1);
    const wx = x + w - pad - 90;
    const wy = y + h - 20;
    text(ctx, 'FRONT WING', wx, wy, `700 9px ${F_UI}`, s >= 1 ? C.green : '#ff8a2f');
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    roundRect(ctx, wx, wy + 5, 90, 4, 2);
    ctx.fill();
    ctx.fillStyle = s >= 1 ? C.green : '#ff8a2f';
    roundRect(ctx, wx, wy + 5, Math.max(4, 90 * s), 4, 2);
    ctx.fill();
  }
  // PERFECT / OK / MISSED pops up over the bar.
  if (g.flash) {
    const a = clamp(1 - g.flash.t / 0.6, 0, 1);
    ctx.globalAlpha = a;
    drawBanner(ctx, g.flash.text, g.flash.color, x + w / 2 + 17, by - 4 - g.flash.t * 18, 20);
    ctx.globalAlpha = 1;
  }
}

// What the bar under the speed shows: how long you've been drifting (its
// colour steps up white, blue, orange, purple), the launch boost, or how
// strong your slipstream is.
function meterOf(p) {
  if (p.drifting) return { fill: clamp(p.driftCharge / 2.2, 0, 1), col: p.driftTier === 0 ? '#ffffff' : TIER_COLORS[p.driftTier], ticks: true };
  if (p.boost > 0) return { fill: clamp(p.boost / 1.5, 0, 1), col: TIER_COLORS[p.boostLevel] || TIER_COLORS[2] };
  if (p.slipstream > 0.12) return { fill: clamp(p.slipstream, 0, 1), col: SLIP_COL };
  return null;
}

function drawMeter(ctx, p, bx, by, bw) {
  const m = meterOf(p);
  if (m && m.fill > 0) {
    ctx.fillStyle = m.col;
    roundRect(ctx, bx, by, Math.max(5, bw * m.fill), 5, 2.5);
    ctx.fill();
  }
  if (!m || m.ticks) {
    ctx.fillStyle = 'rgba(11,14,20,0.9)';
    for (const tick of [0.6, 1.3]) ctx.fillRect(bx + bw * (tick / 2.2) - 1, by, 2, 5);
  }
}

// DRIFTING! and SLIPSTREAM! tags just behind your car, where your eyes are,
// each with a bar: how long you've held the drift, how strong the tow is.
function drawCarTags(ctx, race, cam, w, h) {
  const p = race.player;
  if (!p || race.phase !== 'race' || p.finished) return;
  const tags = [];
  if (p.drifting) {
    tags.push({ label: 'DRIFTING!', col: p.driftTier === 0 ? '#ffffff' : TIER_COLORS[p.driftTier], fill: clamp(p.driftCharge / 2.2, 0, 1), a: 1 });
  }
  const sa = clamp((p.slipstream - 0.25) / 0.12, 0, 1);
  if (p.overtake > 0) tags.push({ label: 'OVERTAKE', col: OT_COL, fill: clamp(p.overtake / OVERTAKE.time, 0, 1), a: clamp(p.overtake / 0.4, 0, 1) });
  if (sa > 0) tags.push({ label: 'SLIPSTREAM!', col: SLIP_COL, fill: clamp(p.slipstream, 0, 1), a: sa });
  if (p.pit && p.pit.stage !== 'box') tags.push({ label: 'PIT LIMITER', col: C.yellow, fill: clamp(p.speed / 230, 0, 1), a: 1 });
  if (!tags.length) return;
  const [px, py] = cam.toScreen(p.x, p.y);
  let y = clamp(py + 40, 60, h - 70);
  const pulse = 1 + 0.04 * Math.sin(race.time * 14);
  for (const t of tags) {
    ctx.save();
    ctx.globalAlpha = t.a;
    ctx.font = `900 italic ${15 * pulse}px ${F_DISPLAY}`;
    const tw = ctx.measureText(t.label).width + 26;
    const x = clamp(px - tw / 2, 8, w - tw - 8);
    ctx.fillStyle = 'rgba(11,14,20,0.78)';
    roundRect(ctx, x, y, tw, 28, 9);
    ctx.fill();
    ctx.strokeStyle = t.col;
    ctx.lineWidth = 2;
    roundRect(ctx, x + 1, y + 1, tw - 2, 26, 8);
    ctx.stroke();
    text(ctx, t.label, x + tw / 2, y + 18, `900 italic ${15 * pulse}px ${F_DISPLAY}`, t.col, 'center');
    ctx.fillStyle = t.col;
    roundRect(ctx, x + 6, y + 22, Math.max(3, (tw - 12) * t.fill), 3, 1.5);
    ctx.fill();
    ctx.restore();
    y += 34;
  }
}

// Phone held sideways. The column above the steering controls holds
// position, lap times, gaps and messages; the speed sits right next to the
// gas, and the map in the corner above the pedals, next to the pause
// button. Only the start lights, the title card before the start and the
// corner calls use the middle.
function drawSideHUD(ctx, race, cam, w, h, ins, opts) {
  const p = race.player;
  const T = ins.top + 10;
  const L = ins.left + 12;
  const R = w - ins.right - 12;
  const cx = w / 2;
  const isRace = race.mode === 'race';
  const { steer: sr, pedal: pr, gas: gr } = opts.ctl;
  const steerLeft = sr.left + sr.width / 2 < w / 2;
  const colW = 178;
  const colX = steerLeft ? L : R - colW;
  const colBottom = sr.top - 10;
  const before = race.phase === 'intro' || race.phase === 'lights';

  drawSpeedLines(ctx, p, w, h);

  // ---- position, lap and lap time ----
  drawSideTimes(ctx, race, p, colX, T, colW);
  const y = T + 70;

  // ---- gaps to the cars around you (or recent laps in a time trial), then
  // messages (overtakes, fastest lap...) underneath ----
  const gh = isRace ? drawNearby(ctx, race, colX, y, p, colW) : race.quali ? drawQualiBoard(ctx, race, colX, y, colW, 4) : drawLapList(ctx, race, colX, y, colW, p);
  let my = y + (gh ? gh + 8 : 0) + 16;
  for (const m of race.messages.slice(-2).reverse()) {
    if (my > colBottom - 10) break;
    const appear = clamp(m.t / 0.14, 0, 1);
    const fade = clamp((m.dur - m.t) / 0.3, 0, 1);
    let size = 24 * Math.min(1, m.scale) * (1 + (1 - appear) * 0.3);
    ctx.font = `900 italic ${size}px ${F_DISPLAY}`;
    const tw = ctx.measureText(m.text).width;
    if (tw > colW - 8) size *= (colW - 8) / tw;
    ctx.globalAlpha = fade;
    drawBanner(ctx, m.text, m.color, colX + colW / 2, my, size);
    ctx.globalAlpha = 1;
    my += size + 10;
  }

  // ---- speed: a tile right next to the gas ----
  const pedalRight = pr.left + pr.width / 2 > w / 2;
  const tileW = 96;
  const tileH = 84;
  const g = gr || pr; // the gas button
  const tileX = pedalRight ? pr.left - 10 - tileW : pr.right + 10;
  const tileY = clamp(g.top + (Math.min(g.height, tileH * 1.4) - tileH) / 2, T + 130, h - tileH - 8);
  drawSpeedTile(ctx, p, tileX, tileY, tileW, tileH);
  const condY = Math.min(tileY + tileH + 6, h - 48);
  if (p.wears) drawCondition(ctx, p, tileX, condY, tileW, 42, race.time, true);
  if (race.pits) {
    // Under the tyres and car readout if there's room, else above the speed.
    const py = condY + 42 + 6 + 24 <= h - ins.bottom - 4 ? condY + 48 : tileY - 30;
    drawPitStatus(ctx, race, p, tileX, py, tileW, 24, race.time, true);
  }
  drawCarTags(ctx, race, cam, w, h);

  // ---- map, in the corner above the pedal, beside the pause button ----
  const ms = 92;
  const mx = steerLeft ? R - 44 - 12 - ms : L + 44 + 12;
  const ev = race.event;
  const tag = ev ? `${ev.round ? `R${ev.round} · ` : ''}${ev.name.toUpperCase()}` : '';
  panel(ctx, mx - 6, T - 6 + 6, ms + 12, ms + 12 + (tag ? 18 : 0), 12);
  race.track.drawMinimap(ctx, mx, T + 6, ms, race.cars, p);
  if (tag) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(mx - 4, T + 6 + ms, ms + 8, 20);
    ctx.clip();
    text(ctx, tag, mx + ms / 2, T + 6 + ms + 12, `800 10px ${F_DISPLAY}`, C.muted, 'center');
    ctx.restore();
  }

  // ---- the middle: lights and the title card before the start, corner calls ----
  const gapL = steerLeft ? colX + colW + 10 : mx + ms + 16;
  const gapR = steerLeft ? mx - 16 : colX - 10;
  const mid = clamp(cx, gapL + 60, gapR - 60);
  if (before && isRace) drawLights(ctx, mid, T, race.phase === 'lights' ? race.lit : 0, true);
  if (ev && before) {
    const fade = clamp(race.phaseT / 0.4 + (race.phase === 'lights' ? 1 : 0), 0, 1);
    const cw = Math.min(gapR - gapL, 440);
    drawEventCard(ctx, ev, (gapL + gapR) / 2, T + (isRace ? 68 : 0), cw, fade, true);
  }
  const pitH = before ? 0 : drawPitCall(ctx, race, mid, T, Math.min(280, gapR - gapL), race.time);
  if (race.call && !before) drawCall(ctx, race.call, mid, T + pitH, Math.min(214, gapR - gapL), race.time);
  if (race.pits && race.pits.game) {
    // Top middle, where the corner calls go, so the car and crew stay in view.
    const gw = Math.min(320, gapR - gapL);
    drawPitGame(ctx, race.pits.game, (gapL + gapR) / 2 - gw / 2, T, gw, 104, race.time, true);
  }
  drawYouMarker(ctx, race, cam);
  drawGhostTag(ctx, race, cam);
  if (race.wrongWayT > 0.9 && Math.floor(race.wrongWayT * 3) % 2 === 0) {
    drawBanner(ctx, 'WRONG WAY', C.red, mid, h * 0.3, 34);
  }
}

// Position, lap and lap time in one panel (race), or lap, time and personal
// best (time trial).
function drawSideTimes(ctx, race, p, x, y, w) {
  panel(ctx, x, y, w, 62);
  const isRace = race.mode === 'race';
  const qs = race.quali;
  const total = race.totalLaps;
  const cur = lapClock(race, p);
  const rx = x + w - 10;
  text(ctx, formatTime(cur), rx, y + 23, `700 14px ${F_DATA}`, qs && qs.stage === 'out' ? C.muted : C.text, 'right');
  if (qs) {
    if (qs.stage !== 'out' && qs.live) {
      text(ctx, `P${qs.live}`, x + 12, y + 40, `900 italic 32px ${F_DISPLAY}`, C.text);
      ctx.font = `900 italic 32px ${F_DISPLAY}`;
      const pwid = ctx.measureText(`P${qs.live}`).width;
      text(ctx, `/${race.cars.length + qs.order.length}`, x + 15 + pwid, y + 39, `700 14px ${F_DISPLAY}`, C.muted);
    } else text(ctx, qs.stage === 'out' ? 'OUT LAP' : 'P–', x + 12, y + 38, `900 italic 24px ${F_DISPLAY}`, C.text);
    text(ctx, qs.stage === 'out' ? 'QUALIFYING' : 'FLYING LAP', x + 12, y + 54, `700 9px ${F_UI}`, C.muted);
    text(ctx, qs.pole ? `POLE ${formatTime(qs.pole.time)}` : 'POLE -:--.---', rx, y + 39, `500 10px ${F_DATA}`, qs.pole ? C.purple : C.muted, 'right');
    if (race.delta != null && qs.stage === 'flying') text(ctx, formatGap(race.delta), rx, y + 54, `700 10px ${F_DATA}`, race.delta <= 0 ? C.green : C.red, 'right');
    else if (qs.pole) text(ctx, qs.pole.code, rx, y + 54, `700 10px ${F_DISPLAY}`, C.muted, 'right');
    return;
  }
  if (isRace) {
    text(ctx, `P${p.pos}`, x + 12, y + 42, `900 italic 36px ${F_DISPLAY}`, C.text);
    ctx.font = `900 italic 36px ${F_DISPLAY}`;
    const pwid = ctx.measureText(`P${p.pos}`).width;
    text(ctx, `/${race.cars.length}`, x + 15 + pwid, y + 41, `700 15px ${F_DISPLAY}`, C.muted);
    text(ctx, `LAP ${clamp(p.lap + 1, 1, total)}/${total}`, rx, y + 39, `700 11px ${F_UI}`, C.muted, 'right');
    const isFastest = race.fastest && race.fastest.car === p;
    text(ctx, `BEST ${formatTime(p.bestLap)}`, rx, y + 54, `500 10px ${F_DATA}`, isFastest ? C.purple : C.muted, 'right');
  } else {
    text(ctx, `LAP ${Math.max(1, p.lap + 1)}`, x + 12, y + 38, `900 italic 26px ${F_DISPLAY}`, C.text);
    text(ctx, 'TIME TRIAL', x + 12, y + 54, `700 9px ${F_UI}`, C.muted);
    const rec = race.record && race.record.bestLap;
    text(ctx, `PB ${formatTime(rec)}`, rx, y + 39, `500 10px ${F_DATA}`, rec ? C.purple : C.muted, 'right');
    if (race.delta != null) text(ctx, formatGap(race.delta), rx, y + 54, `700 10px ${F_DATA}`, race.delta <= 0 ? C.green : C.red, 'right');
  }
}

// The time on the lap clock: this lap so far (or the last one, once you've
// finished). In qualifying it only runs on the flying lap.
function lapClock(race, p) {
  const qs = race.quali;
  if (p.finished) return p.laps[p.laps.length - 1] || 0;
  if (race.phase !== 'race' && race.phase !== 'finished') return 0;
  if (qs) return qs.stage === 'flying' ? race.time - p.lapStart : 0;
  return p.lap >= 0 || race.mode === 'race' ? race.time - p.lapStart : 0;
}

// Qualifying timing board: the times set so far, fastest first, with you
// where your flying lap would put you right now (at the bottom on your
// out-lap). Up to `limit` rows, following you, plus pole and your teammate.
function drawQualiBoard(ctx, race, x, y, w, limit) {
  const qs = race.quali;
  const p = race.player;
  const rows = qs.board.slice();
  let at = rows.length;
  if (qs.stage === 'done') at = rows.filter((r) => r.time != null && r.time < qs.time).length;
  else if (qs.stage === 'flying' && qs.live) at = Math.min(rows.length, qs.live - 1);
  rows.splice(at, 0, { you: true, code: p.code, livery: p.livery, teamId: p.teamId, time: qs.time });
  const mate = rows.findIndex((r) => !r.you && r.teamId && r.teamId === p.teamId);
  const show = followRows(rows.length, at, limit, [0, mate]);
  const rowH = 20;
  const height = show.reduce((hgt, i) => hgt + (i < 0 ? 8 : rowH), 0) + 10;
  const wide = w >= 150;
  panel(ctx, x, y, w, height, 10);
  // Gaps are to the fastest time on the board (yours, once it's in and quickest).
  const best = rows.find((r) => !r.you && r.time != null);
  const ref = qs.stage === 'done' && (!best || qs.time < best.time) ? qs.time : best ? best.time : null;
  let ry = y + 5;
  for (const i of show) {
    if (i < 0) {
      ctx.fillStyle = C.line;
      ctx.fillRect(x + 12, ry + 3, w - 24, 2);
      ry += 8;
      continue;
    }
    const r = rows[i];
    if (r.you || i === mate) {
      ctx.fillStyle = r.you ? 'rgba(255,255,255,0.13)' : 'rgba(255,210,63,0.13)';
      roundRect(ctx, x + 4, ry, w - 8, rowH - 1, 5);
      ctx.fill();
    }
    text(ctx, String(i + 1), x + (wide ? 18 : 14), ry + 14, `700 ${wide ? 12 : 11}px ${F_DATA}`, C.muted, 'center');
    ctx.fillStyle = r.livery.color;
    ctx.fillRect(x + (wide ? 30 : 25), ry + 4, 3, rowH - 9);
    text(ctx, r.code, x + (wide ? 40 : 33), ry + 14, `800 ${wide ? 14 : 13}px ${F_DISPLAY}`, i === mate ? C.yellow : C.text);
    let val = '';
    let col = C.text;
    if (r.you) {
      if (qs.stage === 'out') {
        val = wide ? 'OUT LAP' : 'OUT';
        col = C.muted;
      } else if (qs.stage === 'flying') {
        // Where the lap would put you; the gap to pole so far is on the timer.
        val = 'LIVE';
        col = C.muted;
      } else if (r.time === ref) {
        val = formatTime(r.time);
        col = C.purple;
      } else val = formatGap(r.time - ref);
    } else if (r.time == null) {
      val = wide ? 'NO TIME' : '–';
      col = C.muted;
    } else if (r.time === ref) {
      val = formatTime(r.time);
      col = C.purple;
    } else val = formatGap(r.time - ref);
    text(ctx, val, x + w - (wide ? 10 : 7), ry + 14, `500 ${wide ? 11 : 10}px ${F_DATA}`, col, 'right');
    ry += rowH;
  }
  return height;
}

// Qualifying: who the ghost is (the pole lap you're chasing).
function drawGhostTag(ctx, race, cam) {
  const g = race.ghostAt;
  const who = race.ghostOf;
  if (!g || !who || !race.quali || race.quali.stage !== 'flying') return;
  const [x, y] = cam.toScreen(g.x, g.y);
  const label = `POLE · ${who.code}`;
  ctx.font = `800 11px ${F_DISPLAY}`;
  const tw = ctx.measureText(label).width + 14;
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = 'rgba(11,14,20,0.75)';
  roundRect(ctx, x - tw / 2, y - 40, tw, 17, 6);
  ctx.fill();
  ctx.strokeStyle = C.purple;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  text(ctx, label, x, y - 28, `800 11px ${F_DISPLAY}`, '#e9d6ff', 'center');
  ctx.restore();
}

// Which car is yours: a pulsing ring round it, joined to a YOU tag, on the
// grid and through the start (it fades once the field gets going).
function drawYouMarker(ctx, race, cam) {
  const p = race.player;
  if (race.mode !== 'race' || !p) return;
  let a = race.phase === 'intro' || race.phase === 'lights' ? 1 : 0;
  if (race.phase === 'race') a = clamp(1 - (race.time - 2.5) / 1.2, 0, 1);
  if (a <= 0) return;
  const [px, py] = cam.toScreen(p.x, p.y);
  const pulse = 0.5 + 0.5 * Math.sin((performance.now() / 1000) * 5);
  const r = Math.max(20, 30 * cam.zoom) + pulse * 4;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.lineWidth = 9;
  ctx.strokeStyle = 'rgba(255,42,31,0.35)';
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  // The tag, on a short stem from the top of the ring.
  const yy = py - r - 24;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(px - 1, yy + 8, 2, py - r - (yy + 8));
  ctx.fillStyle = C.lights;
  roundRect(ctx, px - 24, yy - 13, 48, 22, 7);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  text(ctx, 'YOU', px, yy + 3, `900 14px ${F_DISPLAY}`, '#fff', 'center');
  ctx.restore();
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
  const eyebrow = ev.round ? `ROUND ${ev.round} OF ${ev.rounds}${ev.mode === 'quali' ? ' · QUALIFYING' : ''}` : ev.mode === 'trial' ? 'TIME TRIAL' : 'RACE';
  text(ctx, eyebrow, x + 22, y + (narrow ? 19 : 22), `800 ${narrow ? 10 : 11}px ${F_DISPLAY}`, C.muted);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 20, y, cw - 30, ch);
  ctx.clip();
  text(ctx, ev.gp.toUpperCase(), x + 22, y + (narrow ? 41 : 48), `900 italic ${narrow ? 21 : 26}px ${F_DISPLAY}`, C.text);
  const place = ev.name === ev.country ? ev.name : `${ev.name} · ${ev.country}`;
  const sub = ev.mode === 'trial' ? place : ev.mode === 'quali' ? `${place} · out-lap, then one flying lap` : `${place} · ${ev.laps} laps`;
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

// The timing tower: a window of the order that follows you, plus the leader
// and your teammate. You and the cars right ahead of and behind you get big
// rows with the gap to you; the rest are small, with their gap to the leader.
function drawTower(ctx, race, x, y, p) {
  const w = 184;
  const order = race.order;
  const mate = teammateOf(race, p);
  const me = order.indexOf(p);
  const gaps = towerGaps(order);
  const rows = followRows(order.length, me, 9, [0, order.indexOf(mate)]);
  const big = (i) => i >= me - 1 && i <= me + 1;
  const rowH = (i) => (i < 0 ? 8 : big(i) ? 28 : 17);
  const height = rows.reduce((hgt, i) => hgt + rowH(i), 0) + 10;
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
    const h = rowH(i);
    const isBig = big(i);
    if (c === p) {
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      roundRect(ctx, x + 4, ry, w - 8, h - 2, 6);
      ctx.fill();
      ctx.fillStyle = C.lights;
      roundRect(ctx, x + 4, ry, 4, h - 2, 2);
      ctx.fill();
    } else if (isBig) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      roundRect(ctx, x + 4, ry, w - 8, h - 2, 6);
      ctx.fill();
    } else if (c === mate) {
      ctx.fillStyle = 'rgba(255,210,63,0.1)';
      roundRect(ctx, x + 4, ry, w - 8, h - 1, 5);
      ctx.fill();
    }
    const base = ry + h / 2;
    if (isBig) {
      text(ctx, String(i + 1), x + 22, base + 6, `700 15px ${F_DATA}`, c === p ? C.text : C.muted, 'center');
      ctx.fillStyle = c.livery.color;
      ctx.fillRect(x + 37, ry + 5, 4, h - 12);
      text(ctx, c.code, x + 48, base + 7, `800 19px ${F_DISPLAY}`, c === mate ? C.yellow : C.text);
      if (c !== p && c.overtake > 0) drawOT(ctx, x + 84, base - 6);
      let g;
      let col = C.text;
      if (c === p) {
        g = i === 0 ? (c.finished ? 'FINISH' : 'LEADER') : formatGap(gaps[i]);
        col = C.muted;
      } else if (i < me) {
        g = `▲ ${(gaps[me] - gaps[i]).toFixed(1)}s`; // ahead of you by
        col = C.green;
      } else {
        g = `▼ ${(gaps[i] - gaps[me]).toFixed(1)}s`; // behind you by
        col = C.red;
      }
      text(ctx, g, x + w - 10, base + 5, `700 14px ${F_DATA}`, col, 'right');
    } else {
      text(ctx, String(i + 1), x + 22, base + 4, `700 10px ${F_DATA}`, C.muted, 'center');
      ctx.fillStyle = c.livery.color;
      ctx.fillRect(x + 37, ry + 4, 3, h - 8);
      text(ctx, c.code, x + 48, base + 4, `700 12px ${F_DISPLAY}`, c === mate ? C.yellow : 'rgba(238,242,248,0.75)');
      const g = i === 0 ? (c.finished ? 'FINISH' : 'LEADER') : formatGap(gaps[i]);
      text(ctx, g, x + w - 10, base + 4, `500 10px ${F_DATA}`, C.muted, 'right');
    }
    if (race.fastest && race.fastest.car === c) {
      ctx.fillStyle = C.purple;
      ctx.beginPath();
      ctx.arc(x + (isBig ? (c !== p && c.overtake > 0 ? 110 : 96) : 84), base, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ry += h;
  }
}

// Gap to the leader for everyone in race order, built from car-to-car
// intervals (distance apart over speed), or finishing times once both are home.
function towerGaps(order) {
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
  return gaps;
}

// Phone held sideways: the car ahead of you and behind you (and your
// teammate), big, with the gap to you.
function drawNearby(ctx, race, x, y, p, w) {
  const order = race.order;
  const idx = order.indexOf(p);
  const gaps = towerGaps(order);
  const ahead = order[idx - 1];
  const behind = order[idx + 1];
  const lines = [];
  if (ahead && !ahead.finished) lines.push(['▲', ahead, gaps[idx] - gaps[idx - 1]]);
  if (behind) lines.push(['▼', behind, gaps[idx + 1] - gaps[idx]]);
  const mate = teammateOf(race, p);
  if (mate && mate !== ahead && mate !== behind) lines.push(['TM', mate, Math.abs(gaps[order.indexOf(mate)] - gaps[idx])]);
  if (!lines.length) return 0;
  const wide = w >= 150; // room for positions
  const rh = wide ? 26 : 22;
  panel(ctx, x, y, w, lines.length * rh + 8, 10);
  lines.forEach(([arrow, c, g], i) => {
    const ry = y + 4 + i * rh;
    const mid = ry + rh / 2;
    const col = arrow === '▲' ? C.green : arrow === 'TM' ? C.yellow : C.red;
    const matesAhead = arrow === 'TM' && order.indexOf(c) < idx;
    text(ctx, arrow, x + 9, mid + 5, `700 ${arrow === 'TM' ? 9 : 12}px ${F_UI}`, col);
    const cx0 = wide ? x + 45 : x + 25;
    if (wide) text(ctx, String(order.indexOf(c) + 1), x + 34, mid + 5, `700 11px ${F_DATA}`, C.muted, 'center');
    ctx.fillStyle = c.livery.color;
    ctx.fillRect(cx0, ry + 5, 3, rh - 10);
    text(ctx, c.code, cx0 + 8, mid + 6, `800 ${wide ? 17 : 14}px ${F_DISPLAY}`, arrow === 'TM' ? C.yellow : C.text);
    if (c.overtake > 0) drawOT(ctx, cx0 + (wide ? 41 : 35), mid - 6);
    text(ctx, `${arrow === 'TM' ? (matesAhead ? '▲' : '▼') : ''}${g.toFixed(1)}s`, x + w - 8, mid + 5, `700 ${wide ? 13 : 11}px ${F_DATA}`, C.text, 'right');
  });
  return lines.length * rh + 8;
}

// A car with overtake mode on: a small green OT next to its name.
function drawOT(ctx, x, y) {
  ctx.fillStyle = OT_COL;
  roundRect(ctx, x, y, 19, 12, 3);
  ctx.fill();
  text(ctx, 'OT', x + 9.5, y + 9.5, `800 9px ${F_DATA}`, '#0b0e14', 'center');
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
  return laps.length ? laps.length * 18 + 8 : 0;
}

// Lines streaking past the edges of the screen: with a boost, in a tow
// (light blue) and in a drift (stronger as the drift goes on).
function drawSpeedLines(ctx, p, w, h) {
  const slip = p.slipstream > 0.25 ? (p.slipstream - 0.25) / 0.75 : 0;
  const drift = p.drifting ? 0.45 + 0.15 * p.driftTier : 0;
  const k = p.boost > 0 ? 1 : Math.max(slip, drift);
  if (k <= 0) return;
  ctx.save();
  ctx.strokeStyle = slip > drift && p.boost <= 0 ? `rgba(160,225,255,${0.22 * k})` : `rgba(255,255,255,${0.18 * k})`;
  ctx.lineWidth = 2;
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.hypot(w, h) / 2;
  ctx.beginPath();
  for (let i = 0; i < 18 + Math.round(10 * k); i++) {
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
  const pos = p.shownPos || p.finishPos;
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
  const qs = race.quali;
  ctx.fillText(qs ? 'Q U A L I F Y I N G' : 'C H E Q U E R E D   F L A G', 0, -big * 0.62);
  ctx.font = `900 italic ${big}px ${F_DISPLAY}`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = big * 0.08;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeText(`P${pos}`, 0, -big * 0.08);
  ctx.fillStyle = POS_COLOR[pos] || '#ffffff';
  ctx.fillText(`P${pos}`, 0, -big * 0.08);
  const head = qs
    ? pos === 1
      ? 'POLE POSITION!'
      : pos === 2
        ? 'FRONT ROW!'
        : pos <= 10
          ? 'TOP TEN'
          : 'QUALIFIED'
    : pos === 1
      ? 'YOU WIN!'
      : pos <= 3
        ? 'PODIUM!'
        : pos <= 10
          ? 'IN THE POINTS'
          : 'FINISHED';
  ctx.font = `900 italic ${narrow ? 26 : 32}px ${F_DISPLAY}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(head, 0, big * 0.5);
  const bits = [formatTime(qs ? qs.time : p.finishTime + (p.penalty || 0))];
  if (qs) {
    const next = qs.board.find((r) => r.time != null && r.time >= qs.time);
    if (pos === 1 && next) bits.push(`${(next.time - qs.time).toFixed(3)}s clear of ${next.code}`);
    else if (qs.pole && pos > 1) bits.push(`${formatGap(qs.time - qs.pole.time)} to pole`);
  } else if (p.penalty) bits.push(`+${p.penalty}s no pit stop`);
  else if (p.bestLap) bits.push(`best lap ${formatTime(p.bestLap)}`);
  ctx.font = `500 ${narrow ? 12 : 14}px ${F_DATA}`;
  ctx.fillStyle = qs ? (pos === 1 ? C.purple : C.muted) : p.penalty ? C.red : race.fastest && race.fastest.car === p ? C.purple : C.muted;
  ctx.fillText(bits.join('  ·  '), 0, big * 0.5 + (narrow ? 28 : 34));
  if (opts.season && qs) {
    ctx.font = `800 ${narrow ? 15 : 17}px ${F_DISPLAY}`;
    ctx.fillStyle = pos <= 10 ? C.green : C.muted;
    ctx.fillText(`YOU START P${pos} ON THE GRID`, 0, big * 0.5 + (narrow ? 52 : 62));
  } else if (opts.season) {
    const pts = POINTS[pos - 1] || 0;
    ctx.font = `800 ${narrow ? 15 : 17}px ${F_DISPLAY}`;
    ctx.fillStyle = pts ? C.green : C.muted;
    ctx.fillText(pts ? `+${pts} CHAMPIONSHIP POINTS` : 'NO POINTS THIS TIME', 0, big * 0.5 + (narrow ? 52 : 62));
  }
  ctx.restore();

  // Confetti for a podium (or pole).
  if (qs ? pos === 1 : pos <= 3) drawConfetti(ctx, race, w, h, opts.dt || 1 / 60, pos);

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
