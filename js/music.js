// Music: an original racing theme, synthesised like the sound effects (no
// files to load), behind the menus and once you've crossed the line. Big
// drums, an octave bass, a running string-like ostinato, brass stabs and a
// heroic lead, in D minor at 128 beats a minute.
//
// The arrangement loops intro → A → B → break → A → B → break …; the menus
// start at the intro, the finish goes straight into B (the big part).
// Notes are scheduled a moment ahead from the game loop (musicTick), so
// with the game hidden the music simply stops, and picks up when it's back.
//
// To stay light on a phone every instrument is a fixed set of oscillators
// and filters, built when the music starts and retuned note by note (no new
// sound nodes per note), and the whole lot is switched off when it stops.

import { soundGraph } from './audio.js';

const BPM = 128;
const BEAT = 60 / BPM;
const STEP = BEAT / 4; // a 16th note
const AHEAD = 0.3; // seconds of notes scheduled in advance
const VOLUME = 0.5;

// Chords: the bass root (MIDI note) and the chord's notes (pitch classes).
const CH = {
  Dm: { root: 38, pcs: [2, 5, 9] },
  Bb: { root: 34, pcs: [10, 2, 5] },
  F: { root: 41, pcs: [5, 9, 0] },
  C: { root: 36, pcs: [0, 4, 7] },
  Gm: { root: 43, pcs: [7, 10, 2] },
  A: { root: 33, pcs: [9, 1, 4] },
};

// Melodies: per bar, [beat, length in beats, MIDI note].
const LEAD_A = [
  [[0, 1.5, 74], [1.5, 0.5, 69], [2, 1, 74], [3, 1, 76]],
  [[0, 2, 77], [2, 1, 76], [3, 1, 74]],
  [[0, 1.5, 72], [1.5, 0.5, 69], [2, 1, 72], [3, 1, 77]],
  [[0, 3, 76], [3, 0.5, 74], [3.5, 0.5, 72]],
  [[0, 1.5, 74], [1.5, 0.5, 69], [2, 1, 74], [3, 1, 77]],
  [[0, 2, 79], [2, 1, 77], [3, 1, 74]],
  [[0, 1.5, 76], [1.5, 0.5, 72], [2, 1, 76], [3, 1, 79]],
  [[0, 4, 81]],
];
const LEAD_B = [
  [[0, 1, 77], [1, 1.5, 82], [2.5, 0.5, 81], [3, 1, 79]],
  [[0, 3, 81], [3, 1, 77]],
  [[0, 1, 79], [1, 1.5, 84], [2.5, 0.5, 82], [3, 1, 81]],
  [[0, 2, 81], [2, 1, 77], [3, 1, 74]],
  [[0, 1, 77], [1, 1.5, 82], [2.5, 0.5, 81], [3, 1, 79]],
  [[0, 1.5, 81], [1.5, 0.5, 84], [2, 1, 81], [3, 1, 77]],
  [[0, 1, 79], [1, 1, 82], [2, 2, 86]],
  [[0, 2, 85], [2, 1, 88], [3, 1, 85]],
];
// The break: a horn call low in the brass.
const HORN = [[[0, 3, 62], [3, 1, 65]], [[0, 4, 65]], [[0, 3, 67], [3, 1, 70]], [[0, 2, 69], [2, 2, 73]]];

const SECTIONS = {
  intro: ['Dm', 'Bb', 'F', 'C'],
  A: ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'C', 'A'],
  B: ['Bb', 'F', 'C', 'Dm', 'Bb', 'F', 'Gm', 'A'],
  break: ['Dm', 'Bb', 'Gm', 'A'],
};
const NEXT = { intro: 'A', A: 'B', B: 'break', break: 'A' };

const st = {
  on: true, // the Music setting
  want: false, // music wanted here (menus, after the finish)
  from: 'intro',
  playing: false,
  sect: 'intro',
  bar: 0,
  step: 0,
  t: 0, // when the next 16th sounds
  stopAt: 0,
  band: null, // the instruments, while playing
};

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ---------- the band: built once per start ----------

function build(ctx, dest, noise) {
  const nodes = []; // everything with start/stop
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(dest);
  const pan = (v) => {
    if (!ctx.createStereoPanner) return out;
    const p = ctx.createStereoPanner();
    p.pan.value = v;
    p.connect(out);
    return p;
  };
  const left = pan(-0.3);
  const right = pan(0.3);
  // Echo: a dotted eighth, darker each time round.
  const wet = ctx.createGain();
  const delay = ctx.createDelay(1);
  delay.delayTime.value = STEP * 3;
  const fb = ctx.createGain();
  fb.gain.value = 0.3;
  const dark = ctx.createBiquadFilter();
  dark.type = 'lowpass';
  dark.frequency.value = 2200;
  wet.connect(delay);
  delay.connect(dark);
  dark.connect(fb);
  fb.connect(delay);
  dark.connect(pan(0.35));

  const osc = (type, to) => {
    const o = ctx.createOscillator();
    o.type = type;
    kRate(o.frequency);
    kRate(o.detune);
    o.connect(to);
    nodes.push(o);
    return o;
  };
  const gain = (to, v = 0) => {
    const g = ctx.createGain();
    g.gain.value = v;
    g.connect(to);
    return g;
  };
  // Filter and pitch changes are worked out once per 128 samples, not per
  // sample: plenty for music, and much less work (where the browser can).
  const kRate = (p) => {
    try {
      if ('automationRate' in p) p.automationRate = 'k-rate';
    } catch (e) {
      /* not here: per sample then */
    }
  };
  const filter = (type, freq, q, to) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    kRate(f.frequency);
    f.connect(to);
    return f;
  };

  // A synth: `voices` oscillators (each with its own detune, in cents),
  // optionally a square an octave down, through a low-pass into one volume.
  const synth = ({ type = 'sawtooth', detunes = [0], sub = 0, cutoff = 2000, q = 0.8, to = out, send = 0, vibrato = 0 }) => {
    const g = gain(to);
    if (send) gain(wet, send);
    if (send) g.connect(wet);
    const f = filter('lowpass', cutoff, q, g);
    const os = detunes.map((d) => {
      const o = osc(type, f);
      o.detune.value = d;
      return o;
    });
    const subO = sub ? osc('square', gain(f, sub)) : null;
    let wobble = null;
    if (vibrato) {
      wobble = ctx.createGain();
      wobble.gain.value = 0;
      osc('sine', wobble).frequency.value = 5.6;
      for (const o of os) wobble.connect(o.detune);
    }
    return { g, f, os, subO, wobble, vibrato };
  };

  // Drums: one stream of noise, filtered four ways, and three tuned drums.
  const ns = ctx.createBufferSource();
  ns.buffer = noise;
  ns.loop = true;
  nodes.push(ns);
  const noiseTo = (type, freq, q, to) => {
    const g = gain(to);
    ns.connect(filter(type, freq, q, g));
    return g;
  };
  const snareG = noiseTo('bandpass', 1900, 0.7, out);
  snareG.connect(wet);
  const drums = {
    hat: noiseTo('highpass', 7500, 0.8, right),
    crash: noiseTo('highpass', 4200, 0.5, left),
    snare: snareG,
    thud: noiseTo('lowpass', 900, 0.7, out),
    click: noiseTo('highpass', 3000, 0.7, out),
  };
  const kickG = gain(out);
  const kick = osc('sine', kickG);
  const toneG = gain(out);
  const tone = osc('triangle', toneG); // the snare's body
  const deepG = gain(out);
  const deep = osc('sine', deepG); // booms and toms

  const band = {
    ctx,
    out,
    nodes,
    drums,
    kick: { o: kick, g: kickG },
    tone: { o: tone, g: toneG },
    deep: { o: deep, g: deepG },
    bass: synth({ detunes: [-5, 5], sub: 0.5, cutoff: 700 }),
    ost: synth({ detunes: [-8, 8], cutoff: 2300, q: 2, to: pan(-0.15) }),
    brass: synth({ detunes: [-9, 7, -4, 10], cutoff: 1600, q: 1.2, send: 0.12 }),
    pad: synth({ detunes: [-12, 9, 4], cutoff: 1700, to: left }),
    lead: synth({ detunes: [-6, 6], sub: 0.35, cutoff: 3000, q: 1, send: 0.3, vibrato: 14 }),
    low: synth({ detunes: [5], cutoff: 2600, to: left, vibrato: 10 }),
  };
  for (const n of nodes) n.start();
  return band;
}

function teardown(band) {
  for (const n of band.nodes) {
    try {
      n.stop();
    } catch (e) {
      /* already stopped */
    }
  }
  band.out.disconnect();
}

// ---------- playing a note ----------

// A drum hit: straight to `peak`, dying away over about `decay` s.
function hit(g, t, peak, decay) {
  g.gain.setValueAtTime(peak, t);
  g.gain.setTargetAtTime(0, t + 0.003, decay / 3);
}

// A pitch drop on one of the tuned drums.
function drop(d, t, f0, f1, time, peak, decay) {
  d.o.frequency.setValueAtTime(f0, t);
  d.o.frequency.exponentialRampToValueAtTime(f1, t + time);
  hit(d.g, t, peak, decay);
}

// A synth note (or chord): rises to `peak` over `attack`, holds, then fades
// over `release`. `bright` opens the filter for the start of the note.
function note(s, t, notes, { peak, attack = 0.005, hold = 0, release = 0.1, bright = 0 }) {
  const n = notes.length;
  s.os.forEach((o, k) => o.frequency.setValueAtTime(midiHz(notes[k % n]), t)); // spare voices double the chord
  if (s.subO) s.subO.frequency.setValueAtTime(midiHz(notes[0] - 12), t);
  s.g.gain.setTargetAtTime(peak, t, attack / 3 + 0.001);
  s.g.gain.setTargetAtTime(0, t + attack + hold, release / 3);
  if (bright) {
    const f = s.f.frequency;
    f.setTargetAtTime(bright, t, 0.012);
    f.setTargetAtTime(s.cut, t + Math.max(0.04, attack), 0.08);
  }
  if (s.wobble) {
    s.wobble.gain.setValueAtTime(0, t);
    s.wobble.gain.setTargetAtTime(s.vibrato, t + 0.2, 0.1);
  }
}

// Set a synth's resting filter (and remember it for `bright` notes).
function cutoff(s, t, f) {
  s.cut = f;
  s.f.frequency.setTargetAtTime(f, t, 0.05);
}

// The chord's notes between lo and hi (MIDI), lowest first.
function voicing(ch, lo, hi, count = 4) {
  const out = [];
  for (let m = lo; m <= hi && out.length < count; m++) if (ch.pcs.includes(m % 12)) out.push(m);
  return out;
}

// ---------- the arrangement, a 16th at a time ----------

function play(B, t) {
  const sect = st.sect;
  const bar = st.bar;
  const s = st.step;
  const ch = CH[SECTIONS[sect][bar]];
  const last = bar === SECTIONS[sect].length - 1;
  const r = ch.root;
  const third = (ch.pcs[1] - ch.pcs[0] + 12) % 12;
  const D = B.drums;
  const kick = (v) => {
    drop(B.kick, t, 150, 42, 0.13, 0.95 * v, 0.3);
    hit(D.click, t, 0.12 * v, 0.02);
  };
  const snare = (v) => {
    hit(D.snare, t, 0.55 * v, 0.16);
    drop(B.tone, t, 200, 150, 0.08, 0.35 * v, 0.1);
  };
  const boom = (f, v) => {
    drop(B.deep, t, f, f * 0.62, 0.35, 0.9 * v, 0.5);
    hit(D.thud, t, 0.3 * v, 0.12);
  };

  // Each section sets its filters as it starts.
  if (bar === 0 && s === 0) {
    cutoff(B.ost, t, sect === 'break' ? 900 : sect === 'B' ? 2900 : sect === 'A' ? 2300 : 450);
    cutoff(B.lead, t, sect === 'break' ? 1300 : 3000);
    cutoff(B.bass, t, sect === 'break' ? 320 : 700);
    cutoff(B.brass, t, 1600);
    cutoff(B.pad, t, sect === 'break' ? 1200 : 1700);
    cutoff(B.low, t, 2600);
  }

  // Drums.
  if (sect === 'intro') {
    if (s === 0) boom(64, 0.8);
    if (bar >= 2 && (s === 0 || s === 8)) kick(0.8);
    if (last && s >= 8) drop(B.deep, t, 110 + (s - 8) * 14, (110 + (s - 8) * 14) * 0.7, 0.2, 0.4 + (s - 8) * 0.06, 0.22);
  } else if (sect === 'break') {
    if (s === 0 || s === 6 || s === 8) boom(s === 6 ? 82 : 66, s === 0 ? 1 : 0.75);
    if (bar === 2 && s === 12) boom(92, 0.7);
    if (last) snare(0.25 + s * 0.045);
  } else {
    const big = sect === 'B';
    if (s === 0 && (bar === 0 || (big && bar === 4))) hit(D.crash, t, 0.3, 1.7);
    if (s === 0 || s === 6 || s === 8 || (big && s === 10) || (bar % 2 === 1 && s === 14)) kick(s === 0 ? 1 : 0.85);
    if (s === 4 || s === 12) snare(1);
    else if (last && s >= 13) snare(0.5 + (s - 13) * 0.2);
    if (big) hit(D.hat, t, s % 2 ? 0.07 : 0.13, 0.04);
    else if (s % 2 === 0) hit(D.hat, t, s % 4 ? 0.09 : 0.13, s === 14 ? 0.22 : 0.04);
  }

  // Bass: pumping octaves; held notes in the break.
  if (sect === 'break') {
    if (s === 0) note(B.bass, t, [r], { peak: 0.34, attack: 0.02, hold: BEAT * 3.4, release: 0.3 });
  } else if ((sect !== 'intro' || bar >= 2) && s % 2 === 0) {
    const up = sect !== 'intro' && s % 4 === 2;
    note(B.bass, t, [up ? r + 12 : r], { peak: 0.3, hold: STEP * 0.8, release: 0.08, bright: 1500 });
  }

  // Ostinato: running 16ths on the chord, opening up through the intro.
  if (sect === 'intro') B.ost.f.frequency.setValueAtTime((B.ost.cut = 450 + 2100 * ((bar * 16 + s) / 64)), t);
  const os = [0, 12, 7, 12, 0, 12, 7, 12, 0, 12, 7, 12, 0, 12, third + 12, 12][s];
  note(B.ost, t, [r + 24 + os], { peak: s % 4 === 0 ? 0.12 : 0.085, attack: 0.003, release: 0.1 });

  // Brass: stabs in A, big held chords in B, swells at the end of the intro.
  const chord = voicing(ch, 55, 72);
  if (sect === 'A') {
    const held = bar % 4 === 3;
    if (held && s === 0) note(B.brass, t, chord, { peak: 0.11, attack: 0.03, hold: BEAT * 3.3, release: 0.25, bright: 3200 });
    else if (!held && (s === 0 || s === 6 || s === 10)) note(B.brass, t, chord, { peak: s ? 0.085 : 0.11, attack: 0.03, hold: s ? STEP * 0.6 : STEP * 1.6, release: 0.1, bright: 3200 });
  } else if (sect === 'B') {
    if (s === 0) note(B.brass, t, chord, { peak: 0.1, attack: 0.03, hold: BEAT * 2.2, release: 0.2, bright: 3200 });
    if (s === 10) note(B.brass, t, chord, { peak: 0.08, attack: 0.03, hold: STEP * 2.6, release: 0.15, bright: 3200 });
    if (s === 0) note(B.pad, t, voicing(ch, 62, 79, 3), { peak: 0.05, attack: 0.35, hold: BEAT * 3, release: 0.4 });
  } else if (sect === 'break') {
    if (s === 0) note(B.pad, t, voicing(ch, 57, 74, 3), { peak: 0.06, attack: 0.5, hold: BEAT * 2.8, release: 0.5 });
  } else if (bar >= 2 && s === 0) {
    note(B.brass, t, chord, { peak: 0.09, attack: BEAT * 2, hold: BEAT * 1.6, release: 0.2 });
  }

  // Lead (and the horn call in the break).
  const tune = sect === 'A' ? LEAD_A : sect === 'B' ? LEAD_B : sect === 'break' ? HORN : null;
  if (tune) {
    for (const [beat, len, m] of tune[bar]) {
      if (Math.round(beat * 4) !== s) continue;
      const hold = Math.max(0.02, len * BEAT - 0.09);
      if (sect === 'break') note(B.lead, t, [m], { peak: 0.12, attack: 0.03, hold, release: 0.06, bright: 2400 });
      else {
        note(B.lead, t, [m], { peak: 0.1, attack: 0.025, hold, release: 0.06, bright: 4200 });
        if (sect === 'B') note(B.low, t, [m - 12], { peak: 0.06, attack: 0.025, hold, release: 0.06 });
      }
    }
  }
}

function advance() {
  st.t += STEP;
  if (++st.step < 16) return;
  st.step = 0;
  if (++st.bar < SECTIONS[st.sect].length) return;
  st.bar = 0;
  st.sect = NEXT[st.sect];
}

// ---------- control ----------

// Called every frame from the game loop.
export function musicTick() {
  const want = st.want && st.on;
  if (!want && !st.playing) return;
  const sg = soundGraph();
  if (!sg || sg.ctx.state !== 'running') return;
  const now = sg.ctx.currentTime;
  if (want && !st.playing) {
    // Start: from the top of the chosen section, fading up.
    st.band = build(sg.ctx, sg.master, sg.noise);
    st.playing = true;
    st.sect = st.from;
    st.bar = 0;
    st.step = 0;
    st.t = now + 0.08;
    st.stopAt = 0;
    const g = st.band.out.gain;
    g.setValueAtTime(0, now);
    g.linearRampToValueAtTime(VOLUME, now + (st.from === 'intro' ? 1.2 : 0.25));
  } else if (!want && st.playing && !st.stopAt) {
    st.stopAt = now + 1.3;
    const g = st.band.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + 1.2);
  } else if (want && st.stopAt) {
    // Wanted again while fading out: back up.
    st.stopAt = 0;
    const g = st.band.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(VOLUME, now + 0.4);
  }
  if (st.stopAt && now >= st.stopAt) {
    teardown(st.band);
    st.band = null;
    st.playing = false;
    st.stopAt = 0;
    return;
  }
  // Fell behind (the game was hidden): carry on from now rather than catch up.
  if (st.t < now) st.t = now + 0.05;
  while (st.t < now + AHEAD) {
    play(st.band, st.t);
    advance();
  }
}

// Music wanted from here on (`from`: 'intro' for the menus, 'B' after the
// finish), or not (null): it fades in or out from the next frame.
export function setMusic(from) {
  if (from && !st.want) st.from = from;
  st.want = !!from;
}

// The Music setting.
export function setMusicEnabled(on) {
  st.on = on;
}

// Where the music is (for the console: window.lightsOut.music()).
export function musicState() {
  return { want: st.want, on: st.on, playing: st.playing, section: st.sect, bar: st.bar + 1, fading: !!st.stopAt };
}

// For tools: the arrangement from `from`, `seconds` long, scheduled into
// another sound graph (an OfflineAudioContext), to listen to or measure.
export function renderMusic(ctx, dest, noise, seconds, from = 'intro') {
  const band = build(ctx, dest, noise);
  band.out.gain.value = VOLUME;
  const saved = { sect: st.sect, bar: st.bar, step: st.step, t: st.t };
  st.sect = from;
  st.bar = 0;
  st.step = 0;
  st.t = 0.05;
  while (st.t < seconds) {
    play(band, st.t);
    advance();
  }
  Object.assign(st, saved);
}
