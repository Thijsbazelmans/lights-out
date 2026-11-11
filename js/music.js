// Music: an original hip-hop beat behind the menus and once you've crossed
// the line, made in the browser like the sound effects (no files to load).
// Hard drums with a lazy swing, a distorted 808 bass, a dusty electric-piano
// loop on jazzy minor chords and a bell hook, in D minor at 94 beats a minute.
//
// Every sound is recorded once into a short clip when the music first
// starts (an OfflineAudioContext, so the work happens off the game's
// thread): the kick, snare, hats, rim, crash, the 808, the bell and the
// four-bar piano loop. The beat then only plays those clips back, with a
// little swing and a touch of randomness in timing and loudness so it
// doesn't sound like a machine. Playing a clip is about the cheapest thing
// Web Audio does, so this is light on a phone.
//
// The arrangement loops intro → A → B → break → A → B → break …; the menus
// start at the intro (the piano loop alone, filtered, opening up), the
// finish goes straight into B (the hook). Clips are scheduled a moment
// ahead from the game loop (musicTick), so with the game hidden the music
// simply stops, and picks up when it's back.

import { soundGraph } from './audio.js';

const BPM = 94;
const BEAT = 60 / BPM;
const STEP = BEAT / 4; // a 16th note
const BAR = BEAT * 4;
const SWING = STEP * 0.16; // the off 16ths come a little late
const AHEAD = 0.3; // seconds of notes scheduled in advance
const VOLUME = 0.5;

// Clip levels in the mix (each clip is recorded at full scale).
const LEVEL = { kick: 0.64, snare: 0.6, hat: 0.22, open: 0.16, rim: 0.2, crash: 0.2, rev: 0.26, bass: 0.38, keys: 0.6, bell: 0.28, crackle: 0.08 };

// The piano loop: four chords, a bar each, played the same in every section
// (the sections differ in what plays over it). `keys`: the piano's notes
// (MIDI, the root left to the 808), `root`: the 808's note.
const LOOP = [
  { root: 38, keys: [53, 57, 60, 64] }, // Dm9
  { root: 34, keys: [53, 57, 60, 62] }, // Bbmaj9
  { root: 31, keys: [55, 58, 62, 65] }, // Gm7
  { root: 33, keys: [55, 58, 61, 64] }, // A7(b9)
];
// When the piano plays in each bar: [16th, how hard, 16th it lets go].
const COMP = [
  [[0, 1, 7], [7, 0.5, 10], [10, 0.72, 16]],
  [[0, 0.92, 10], [10, 0.6, 14], [14, 0.45, 16]],
  [[0, 1, 7], [7, 0.5, 10], [10, 0.72, 16]],
  [[0, 0.95, 6], [6, 0.6, 12], [12, 0.7, 16]],
];
// The hook, on the bell: per bar, [16th, MIDI note].
const HOOK = [
  [[0, 74], [3, 81], [6, 77], [8, 76], [11, 74], [14, 72]],
  [[0, 74], [3, 81], [6, 77], [8, 74], [11, 77]],
  [[0, 74], [3, 82], [6, 79], [8, 77], [11, 74], [14, 77]],
  [[0, 76], [3, 81], [6, 79], [8, 77], [11, 76], [14, 73]],
];
const HOOK_END = [[0, 76], [3, 81], [6, 79], [8, 82], [10, 81], [12, 79], [14, 76]];
const BELL_NOTE = 74; // the bell is recorded at D5 and played faster or slower
const BASS_NOTE = 38; // the 808 at D2

// Drum patterns, two bars each.
const KICK_A = ['x......x..x.....', 'x.....x...x..x..'];
const KICK_B = ['x......x..x...x.', 'x.....x...x..x..'];

const LEN = { intro: 4, A: 8, B: 8, break: 4 };
const NEXT = { intro: 'A', A: 'B', B: 'break', break: 'A' };

const st = {
  on: true, // the Music setting
  want: false, // music wanted here (menus, after the finish)
  from: 'intro',
  playing: false,
  sect: 'intro',
  bar: 0,
  step: 0,
  t: 0, // when the next 16th sounds (on the beat, before swing)
  stopAt: 0,
  band: null, // the live mix, while playing
};

let kit = null; // the recorded clips, once made
let baking = null; // the clips being made
let failed = false; // this browser can't make them: no music

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rnd = (a) => (Math.random() * 2 - 1) * a;
const stepAt = (s) => s * STEP + (s % 2 ? SWING : 0);

// ---------- recording the clips ----------

function gainOf(c, v, to) {
  const g = c.createGain();
  g.gain.value = v;
  if (to) g.connect(to);
  return g;
}

function filterOf(c, type, freq, q = 0.7, to) {
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  if (to) f.connect(to);
  return f;
}

function oscOf(c, type, freq, to) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  if (to) o.connect(to);
  return o;
}

// Soft clipping, for weight and grit.
function drive(c, k, to) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  const w = c.createWaveShaper();
  w.curve = curve;
  w.oversample = '2x';
  if (to) w.connect(to);
  return w;
}

function noiseOf(c, secs = 1) {
  const len = Math.ceil(secs * c.sampleRate);
  const b = c.createBuffer(1, len, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource();
  s.buffer = b;
  return s;
}

// A room: decaying stereo noise, a few ms late.
function roomOf(c, secs, to) {
  const len = Math.ceil(secs * c.sampleRate);
  const pre = Math.ceil(0.012 * c.sampleRate);
  const b = c.createBuffer(2, len, c.sampleRate);
  const k = Math.pow(0.001, 1 / (len - pre)); // down 60 dB by the end
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let e = 1;
    for (let i = pre; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * e;
      e *= k;
    }
  }
  const v = c.createConvolver();
  v.buffer = b;
  const dark = filterOf(c, 'lowpass', 4500, 0.5);
  v.connect(dark);
  if (to) dark.connect(to);
  return v;
}

// A hit: straight up to `peak`, dying away with time constant `tau`.
function hitEnv(g, t, peak, tau) {
  g.gain.setValueAtTime(0, 0);
  g.gain.setValueAtTime(peak, t);
  g.gain.setTargetAtTime(0, t + 0.001, tau);
}

function drawKick(c) {
  const out = filterOf(c, 'lowpass', 9000, 0.7, c.destination);
  const sh = drive(c, 2.4, out);
  const g = gainOf(c, 0, sh);
  const o = oscOf(c, 'sine', 170, g);
  o.frequency.setValueAtTime(170, 0);
  o.frequency.exponentialRampToValueAtTime(58, 0.05);
  o.frequency.exponentialRampToValueAtTime(45, 0.4);
  g.gain.setValueAtTime(0, 0);
  g.gain.linearRampToValueAtTime(1, 0.002);
  g.gain.setTargetAtTime(0, 0.07, 0.11);
  const n = noiseOf(c, 0.05);
  const ng = gainOf(c, 0, sh);
  n.connect(filterOf(c, 'highpass', 1800, 0.7, ng));
  hitEnv(ng, 0, 0.5, 0.004);
  o.start(0);
  n.start(0);
}

function drawSnare(c) {
  const out = c.destination;
  const sum = gainOf(c, 1);
  const sh = drive(c, 1.8);
  sum.connect(sh);
  sh.connect(gainOf(c, 0.9, out));
  sh.connect(roomOf(c, 0.7, gainOf(c, 0.4, out)));
  const body = oscOf(c, 'triangle', 240);
  body.frequency.setValueAtTime(240, 0);
  body.frequency.exponentialRampToValueAtTime(175, 0.04);
  const bg = gainOf(c, 0, sum);
  body.connect(bg);
  hitEnv(bg, 0, 0.7, 0.035);
  const n1 = noiseOf(c, 0.8);
  const g1 = gainOf(c, 0, sum);
  n1.connect(filterOf(c, 'bandpass', 2600, 0.7, g1));
  hitEnv(g1, 0, 1, 0.07);
  const n2 = noiseOf(c, 0.4);
  const g2 = gainOf(c, 0, sum);
  n2.connect(filterOf(c, 'highpass', 7000, 0.7, g2));
  hitEnv(g2, 0, 0.35, 0.04);
  // A clap on top: three quick slaps and a tail.
  const n3 = noiseOf(c, 0.6);
  const g3 = gainOf(c, 0, sum);
  n3.connect(filterOf(c, 'bandpass', 1400, 1.6, g3));
  g3.gain.setValueAtTime(0, 0);
  for (const at of [0, 0.011, 0.022]) {
    g3.gain.setValueAtTime(0.8, at);
    g3.gain.setTargetAtTime(0, at + 0.001, 0.004);
  }
  g3.gain.setValueAtTime(0.6, 0.032);
  g3.gain.setTargetAtTime(0, 0.033, 0.06);
  for (const s of [body, n1, n2, n3]) s.start(0);
}

// Hats and cymbals: six square waves at clashing pitches (like an 808's),
// plus some noise, kept to the very top.
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];
function drawHat(tau, low) {
  return (c) => {
    const env = gainOf(c, 0, c.destination);
    const hp = filterOf(c, 'highpass', low, 0.7, env);
    const bp = filterOf(c, 'bandpass', 10000, 0.9, hp);
    const sum = gainOf(c, 1, bp);
    const srcs = METAL.map((f) => {
      const o = oscOf(c, 'square', f);
      o.connect(gainOf(c, 0.16, sum));
      return o;
    });
    const n = noiseOf(c, 1);
    n.connect(gainOf(c, 0.5, sum));
    srcs.push(n);
    hitEnv(env, 0, 1, tau);
    for (const s of srcs) s.start(0);
  };
}

function drawCrash(c) {
  const out = c.destination;
  const env = gainOf(c, 0);
  env.connect(gainOf(c, 0.8, out));
  env.connect(roomOf(c, 1.6, gainOf(c, 0.35, out)));
  const hp = filterOf(c, 'highpass', 4200, 0.6, env);
  const sum = gainOf(c, 1, hp);
  const srcs = METAL.map((f) => {
    const o = oscOf(c, 'square', f * 1.5);
    o.connect(gainOf(c, 0.12, sum));
    return o;
  });
  const n = noiseOf(c, 3);
  n.connect(gainOf(c, 0.7, sum));
  srcs.push(n);
  env.gain.setValueAtTime(1, 0);
  env.gain.setTargetAtTime(0, 0.01, 0.7);
  for (const s of srcs) s.start(0);
}

function drawRim(c) {
  const sh = drive(c, 2, c.destination);
  const a = oscOf(c, 'triangle', 1750);
  const ag = gainOf(c, 0, sh);
  a.connect(ag);
  hitEnv(ag, 0, 0.6, 0.008);
  const b = oscOf(c, 'triangle', 480);
  const bg = gainOf(c, 0, sh);
  b.connect(bg);
  hitEnv(bg, 0, 0.7, 0.02);
  const n = noiseOf(c, 0.1);
  const ng = gainOf(c, 0, sh);
  n.connect(filterOf(c, 'bandpass', 3500, 1, ng));
  hitEnv(ng, 0, 0.5, 0.006);
  for (const s of [a, b, n]) s.start(0);
}

// The 808: a long sine that drops into its note, driven hard so it has
// overtones a phone's speaker can play.
function drawBass(c) {
  const f = midiHz(BASS_NOTE);
  const hp = filterOf(c, 'highpass', 25, 0.7, c.destination);
  const lp = filterOf(c, 'lowpass', 2600, 0.7, hp);
  const sh = drive(c, 3, lp);
  const g = gainOf(c, 0, sh);
  const o = oscOf(c, 'sine', f, g);
  const o2 = oscOf(c, 'sine', f * 2);
  o2.connect(gainOf(c, 0.22, g));
  for (const [x, k] of [[o, 1], [o2, 2]]) {
    x.frequency.setValueAtTime(f * k * 2.2, 0);
    x.frequency.exponentialRampToValueAtTime(f * k, 0.045);
  }
  g.gain.setValueAtTime(0, 0);
  g.gain.linearRampToValueAtTime(1, 0.003);
  g.gain.setTargetAtTime(0, 0.12, 0.9);
  o.start(0);
  o2.start(0);
}

// One electric-piano note: a sine bent by two others (one for the warm
// body, a high one for the bell-like ping at the start), louder notes
// brighter.
function epNote(c, bus, wow, m, t, off, v) {
  const f = midiHz(m);
  const car = oscOf(c, 'sine', f);
  const ma = oscOf(c, 'sine', f);
  const mb = oscOf(c, 'sine', f * 14);
  const ia = gainOf(c, 0, car.frequency);
  ia.gain.setValueAtTime(f * (0.6 + 1.4 * v), t);
  ia.gain.setTargetAtTime(f * 0.18, t, 0.3);
  ma.connect(ia);
  const ib = gainOf(c, 0, car.frequency);
  ib.gain.setValueAtTime(f * 4 * v, t);
  ib.gain.setTargetAtTime(0, t, 0.01);
  mb.connect(ib);
  for (const o of [car, ma, mb]) wow.connect(o.detune);
  const g = gainOf(c, 0, bus);
  car.connect(g);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(v * 0.25, t + 0.004);
  g.gain.setTargetAtTime(0, t + 0.004, 1.1 * Math.sqrt(220 / f));
  g.gain.setTargetAtTime(0, off, 0.06); // key up
  for (const o of [car, ma, mb]) {
    o.start(t);
    o.stop(off + 0.5);
  }
}

// The four-bar piano loop, like a sample off an old record: a little grit,
// a slow wobble in pitch, a slow left-right sway, and a room.
function drawKeys(c) {
  const out = c.destination;
  const bus = gainOf(c, 1);
  const lp = filterOf(c, 'lowpass', 4200, 0.6);
  bus.connect(filterOf(c, 'highpass', 90, 0.7, drive(c, 1.5, lp)));
  let wide = lp;
  if (c.createStereoPanner) {
    const p = c.createStereoPanner();
    const lfo = oscOf(c, 'sine', 4.2);
    lfo.connect(gainOf(c, 0.35, p.pan));
    lfo.start(0);
    lp.connect(p);
    wide = p;
  }
  wide.connect(gainOf(c, 0.85, out));
  wide.connect(roomOf(c, 1.8, gainOf(c, 0.3, out)));
  const wow = gainOf(c, 7); // cents
  const lfo = oscOf(c, 'sine', 0.55, wow);
  lfo.start(0);
  for (let b = 0; b < 4; b++) {
    const ch = LOOP[b];
    for (const [s, vel, end] of COMP[b]) {
      const t = b * BAR + stepAt(s);
      const off = b * BAR + stepAt(end) - 0.02;
      // Spread a little, low to high, like fingers.
      ch.keys.forEach((m, k) => epNote(c, bus, wow, m, t + k * 0.007 + Math.random() * 0.004, off, vel * (0.85 + Math.random() * 0.15)));
      if (s === 0) epNote(c, bus, wow, ch.root + 12, t, (b + 1) * BAR - 0.02, 0.7);
    }
  }
}

// The bell: a struck metal bar (its overtones aren't in tune with the
// note, which is what makes it sound like metal), in a room.
function drawBell(c) {
  const out = c.destination;
  const f = midiHz(BELL_NOTE);
  const bus = gainOf(c, 1);
  const lp = filterOf(c, 'lowpass', 7000, 0.6, null);
  bus.connect(lp);
  lp.connect(gainOf(c, 0.8, out));
  lp.connect(roomOf(c, 1.4, gainOf(c, 0.32, out)));
  const parts = [
    [1, 1, 0.8],
    [2, 0.12, 0.5],
    [2.76, 0.35, 0.3],
    [5.4, 0.12, 0.12],
    [8.93, 0.05, 0.05],
  ];
  const srcs = parts.map(([r, a, tau]) => {
    const o = oscOf(c, 'sine', f * r);
    const g = gainOf(c, 0, bus);
    o.connect(g);
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(a, 0.002);
    g.gain.setTargetAtTime(0, 0.002, tau);
    return o;
  });
  const n = noiseOf(c, 0.05);
  const ng = gainOf(c, 0, bus);
  n.connect(filterOf(c, 'bandpass', 5000, 1, ng));
  hitEnv(ng, 0, 0.15, 0.004);
  srcs.push(n);
  for (const s of srcs) s.start(0);
}

// Record one clip: `draw` sets up the sound in an offline graph.
function record(OAC, rate, secs, chans, draw) {
  const c = new OAC(chans, Math.ceil(secs * rate), rate);
  draw(c);
  return new Promise((res, rej) => {
    c.oncomplete = (e) => res(e.renderedBuffer);
    const p = c.startRendering();
    if (p && p.then) p.then(res, rej);
  }).then((buf) => normalize(c, buf));
}

// Scale a clip to full scale, and cut off its tail once it's 50 dB down
// (a shorter clip is less to play).
function normalize(c, buf) {
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const a = d[i] < 0 ? -d[i] : d[i];
      if (a > peak) peak = a;
    }
  }
  if (!peak) return buf;
  let end = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = d.length - 1; i > end; i--) {
      if (Math.abs(d[i]) > peak * 0.003) {
        end = i;
        break;
      }
    }
  }
  const len = Math.min(buf.length, end + 64);
  const out = c.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
  const fade = Math.min(len, Math.round(buf.sampleRate * 0.02));
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    const o = out.getChannelData(ch);
    for (let i = 0; i < len; i++) o[i] = (d[i] / peak) * (i < len - fade ? 1 : (len - i) / fade);
  }
  return out;
}

// A copy played backwards (a cymbal that swells into the next bar).
function reversed(c, buf) {
  const r = c.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch);
    const d = r.getChannelData(ch);
    for (let i = 0, n = src.length; i < n; i++) d[i] = src[n - 1 - i];
  }
  return r;
}

// Record crackle: soft hiss with clicks and the odd pop, like vinyl.
function crackle(c) {
  const rate = c.sampleRate;
  const len = Math.ceil(rate * 4);
  const b = c.createBuffer(1, len, rate);
  const d = b.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    lp += 0.12 * (Math.random() * 2 - 1 - lp);
    d[i] += lp * 0.05;
    if (Math.random() < 10 / rate && i < len - 3) {
      const a = (Math.random() < 0.1 ? 0.9 : 0.3) * (0.4 + Math.random() * 0.6) * (Math.random() < 0.5 ? -1 : 1);
      d[i] += a;
      d[i + 1] -= a * 0.6;
      d[i + 2] += a * 0.25;
    }
  }
  return b;
}

function makeKit(rate) {
  const OAC = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext : typeof webkitOfflineAudioContext !== 'undefined' ? webkitOfflineAudioContext : null; // eslint-disable-line no-undef
  if (!OAC) return Promise.reject(new Error('no offline audio'));
  const jobs = {
    keys: record(OAC, rate, BAR * 4 + 3, 2, drawKeys),
    bass: record(OAC, rate, 2.6, 1, drawBass),
    kick: record(OAC, rate, 0.6, 1, drawKick),
    snare: record(OAC, rate, 0.8, 2, drawSnare),
    hat: record(OAC, rate, 0.2, 1, drawHat(0.02, 7000)),
    open: record(OAC, rate, 0.9, 1, drawHat(0.16, 6500)),
    rim: record(OAC, rate, 0.2, 1, drawRim),
    crash: record(OAC, rate, BAR, 2, drawCrash),
    bell: record(OAC, rate, 2.4, 1, drawBell),
  };
  const names = Object.keys(jobs);
  return Promise.all(names.map((k) => jobs[k])).then((bufs) => {
    const k = { rate };
    names.forEach((n, i) => (k[n] = bufs[i]));
    const tmp = new OAC(1, 1, rate);
    k.rev = reversed(tmp, k.crash);
    k.crackle = crackle(tmp);
    return k;
  });
}

// ---------- the live mix: built once per start ----------

function build(ctx, dest, K) {
  const gain = (to, v) => {
    const g = ctx.createGain();
    g.gain.value = v;
    g.connect(to);
    return g;
  };
  const out = gain(dest, 0);
  const mix = gain(out, 1);
  // The piano loop goes through a filter (closed for the intro and the
  // break) and a gate (the silence just before the beat drops).
  const keysLevel = gain(mix, LEVEL.keys);
  const cut = gain(keysLevel, 1);
  const keysF = ctx.createBiquadFilter();
  keysF.type = 'lowpass';
  keysF.frequency.value = 12000;
  keysF.Q.value = 1.2;
  try {
    keysF.frequency.automationRate = 'k-rate'; // worked out per block, not per sample
  } catch (e) {
    /* per sample then */
  }
  keysF.connect(cut);
  // The bell's echo: a dotted eighth, darker each time round.
  const hook = gain(mix, 1);
  const delay = ctx.createDelay(1);
  delay.delayTime.value = STEP * 3;
  const fb = gain(delay, 0.3);
  const dark = ctx.createBiquadFilter();
  dark.type = 'lowpass';
  dark.frequency.value = 2400;
  delay.connect(dark);
  dark.connect(fb);
  let echoOut = mix;
  if (ctx.createStereoPanner) {
    echoOut = ctx.createStereoPanner();
    echoOut.pan.value = 0.4;
    echoOut.connect(mix);
  }
  dark.connect(gain(echoOut, 0.8));
  hook.connect(gain(delay, 0.3));
  const band = { ctx, K, out, mix, keysF, cut, hook, live: [], b808: null, open: null };
  // Vinyl crackle, all the way through.
  const cr = ctx.createBufferSource();
  cr.buffer = K.crackle;
  cr.loop = true;
  cr.connect(gain(mix, LEVEL.crackle));
  cr.start();
  band.live.push({ s: cr, end: Infinity });
  return band;
}

function teardown(B) {
  for (const x of B.live) {
    try {
      x.s.stop();
    } catch (e) {
      /* already stopped */
    }
  }
  B.out.disconnect();
}

// ---------- playing a clip ----------

// Glide a setting to `v` from `t`, and then hold it there. (A glide left
// open keeps the browser working the value out sample by sample for good.)
function ease(p, v, t, tau) {
  p.setTargetAtTime(v, t, tau);
  p.setValueAtTime(v, t + tau * 7);
}

// Stop a clip early (once it's been faded out), so it isn't played on in silence.
function stopAt(s, t) {
  try {
    s.stop(t);
  } catch (e) {
    /* already stopped */
  }
}

// Play `buf` at `t` into `to`, `vel` loud, `rate` fast (pitch).
function shot(B, buf, to, t, vel, rate = 1, offset = 0) {
  const ctx = B.ctx;
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = vel;
  s.connect(g);
  g.connect(to);
  s.onended = () => g.disconnect(); // out of the mix once done
  s.start(Math.max(t, ctx.currentTime), offset);
  B.live.push({ s, end: t + (buf.duration - offset) / rate });
  return { s, g };
}

const kick = (B, t, v) => shot(B, B.K.kick, B.mix, t + rnd(0.002), LEVEL.kick * v * (1 + rnd(0.04)));
// The snare sits a touch behind the beat.
const snare = (B, t, v) => shot(B, B.K.snare, B.mix, t + 0.008 + rnd(0.003), LEVEL.snare * v * (1 + rnd(0.05)));
const rim = (B, t, v) => shot(B, B.K.rim, B.mix, t + rnd(0.003), LEVEL.rim * v);
const crash = (B, t, v) => shot(B, B.K.crash, B.mix, t, LEVEL.crash * v);

// A closed hat also cuts off an open one still ringing.
function hat(B, t, v, rate = 1) {
  const at = t + rnd(0.003);
  if (B.open) {
    B.open.g.gain.setTargetAtTime(0, at, 0.01);
    stopAt(B.open.s, at + 0.06);
    B.open = null;
  }
  shot(B, B.K.hat, B.mix, at, LEVEL.hat * v * (1 + rnd(0.12)), rate * (1 + rnd(0.01)));
}

function openHat(B, t, v) {
  B.open = shot(B, B.K.open, B.mix, t + rnd(0.003), LEVEL.open * v);
}

// The cymbal swell that ends exactly at `end` (the next downbeat).
function swell(B, t, end) {
  const buf = B.K.rev;
  const start = end - buf.duration;
  if (start >= t) shot(B, buf, B.mix, start, LEVEL.rev);
  else shot(B, buf, B.mix, t, LEVEL.rev, 1, t - start);
}

// The 808 plays one note at a time: a new one cuts the last.
function bass(B, t, m, v) {
  if (B.b808) bassOff(B, t);
  B.b808 = shot(B, B.K.bass, B.mix, t, LEVEL.bass * v, Math.pow(2, (m - BASS_NOTE) / 12));
}
function bassOff(B, t) {
  if (!B.b808) return;
  B.b808.g.gain.setTargetAtTime(0, t, 0.008);
  stopAt(B.b808.s, t + 0.05);
  B.b808 = null;
}
// Slide the ringing 808 to another note.
function glide(B, t, m) {
  if (B.b808) B.b808.s.playbackRate.setTargetAtTime(Math.pow(2, (m - BASS_NOTE) / 12), t, 0.04);
}

function bell(B, t, m, v) {
  shot(B, B.K.bell, B.hook, t + rnd(0.002), LEVEL.bell * v * (1 + rnd(0.08)), Math.pow(2, (m - BELL_NOTE) / 12));
}

// ---------- the arrangement, a 16th at a time ----------

function play(B, t0) {
  const sect = st.sect;
  const bar = st.bar;
  const s = st.step;
  const t = t0 + (s % 2 ? SWING : 0);
  const last = bar === LEN[sect] - 1;
  const root = LOOP[bar % 4].root;

  if (s === 0) {
    // The piano loop starts again every four bars, whatever the section.
    if (bar % 4 === 0) shot(B, B.K.keys, B.keysF, t0, 1);
    // Forget clips that have finished.
    const now = B.ctx.currentTime;
    if (B.live.length > 48) B.live = B.live.filter((x) => x.end > now);
  }
  if (s === 0 && bar === 0) {
    // Each section sets the piano's filter as it starts.
    const f = B.keysF.frequency;
    f.cancelScheduledValues(t0);
    if (sect === 'intro') {
      f.setValueAtTime(320, t0);
      f.exponentialRampToValueAtTime(9000, t0 + BAR * 4 - STEP * 2);
    } else ease(f, sect === 'break' ? 1500 : 12000, t0, sect === 'break' ? 0.25 : 0.02);
    ease(B.cut.gain, 1, t0, 0.004);
  }

  // The drop: everything stops for the last two 16ths of the intro and the
  // break, then the beat comes in.
  if (last && (sect === 'intro' || sect === 'break') && s >= 14) {
    if (s === 14) {
      ease(B.cut.gain, 0, t0, 0.015);
      bassOff(B, t0);
    }
    return;
  }

  if (sect === 'intro') {
    if ((bar === 0 || bar === 2) && s === 0) bass(B, t, root, 0.55);
    if (bar >= 2 && s % 2 === 0) hat(B, t, 0.35 + 0.25 * ((bar - 2) * 16 + s) / 32);
    if (last) {
      if (s === 0) swell(B, t0, t0 + BAR);
      if (s === 0 || s === 10) kick(B, t, 0.6);
      if (s === 12 || s === 13) snare(B, t, s === 12 ? 0.4 : 0.55);
    }
  } else if (sect === 'A' || sect === 'B') {
    const big = sect === 'B';
    if (s === 0 && (bar === 0 || (big && bar === 4))) crash(B, t, bar ? 0.6 : 1);
    if ((big ? KICK_B : KICK_A)[bar % 2][s] === 'x') {
      kick(B, t, s ? 0.82 : 1);
      const slide = big && bar % 4 === 3 && s === 10;
      bass(B, t, s === 13 || slide ? root + 12 : root, s ? 0.85 : 1);
    }
    if (big && bar % 4 === 3 && s === 12) glide(B, t, root);
    if (s === 4 || s === 12) snare(B, t, 1);
    else if (last && s >= 14) snare(B, t, s === 14 ? 0.45 : 0.65);
    else if (bar % 2 && s === 15) snare(B, t, 0.2);
    if (big && bar % 2 === 0 && s === 11) rim(B, t, 0.6);
    // Hats: eighths in A; sixteenths in B, with rolls into bar ends.
    if (!big) {
      if (s % 2 === 0) hat(B, t, s % 4 ? 0.55 : 0.8);
      else if (s === 15 && bar % 4 === 3) hat(B, t, 0.35);
    } else if (bar % 4 === 1 && s >= 12) {
      if (s === 12) for (let k = 0; k < 6; k++) hat(B, t0 + (k * BEAT) / 6, 0.4 + k * 0.08);
    } else if (bar % 4 === 3 && s >= 14) {
      if (s === 14) for (let k = 0; k < 4; k++) hat(B, t0 + (k * STEP) / 2, 0.45 + k * 0.1, 1 + k * 0.06);
    } else if (bar % 2 === 0 && s === 6) openHat(B, t, 0.8);
    else if (!(bar % 2 === 0 && s === 7)) hat(B, t, [0.8, 0.32, 0.55, 0.38][s % 4]);
    // The hook in B; in A's second half, a hint of it.
    const tune = big && bar === 7 ? HOOK_END : HOOK[bar % 4];
    for (const [at, m] of tune) {
      if (at !== s) continue;
      if (big) {
        bell(B, t, m, at === 0 ? 0.95 : 0.8);
        if (bar >= 4) bell(B, t, m - 12, 0.4);
      } else if (bar >= 4 && at < 8) bell(B, t, m, 0.45);
    }
  } else {
    // The break: the piano muffled, the 808 held, the kick alone.
    if (s === 0 && bar === 0) crash(B, t, 0.5);
    if (!last) {
      if (s === 0) bass(B, t, root, 0.85);
      if (s === 0 || s === 10) kick(B, t, s ? 0.55 : 0.85);
      if (bar === 2 && s % 4 === 2) openHat(B, t, 0.35);
    } else {
      if (s === 0) {
        kick(B, t, 0.8);
        bass(B, t, root, 0.8);
        swell(B, t0, t0 + BAR);
      }
      if (s === 8) bass(B, t, root, 0.7);
      if (s === 10) glide(B, t, root + 12);
      if (s >= 8 && s % 2 === 0) snare(B, t, 0.3 + (s - 8) * 0.07);
      if (s === 13) snare(B, t, 0.75);
      hat(B, t, 0.25 + s * 0.03);
    }
  }
}

function advance() {
  st.t += STEP;
  if (++st.step < 16) return;
  st.step = 0;
  if (++st.bar < LEN[st.sect]) return;
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
    // The clips are made the first time (a moment, off the game's thread).
    if (!kit || kit.rate !== sg.ctx.sampleRate) {
      if (!baking && !failed) {
        baking = makeKit(sg.ctx.sampleRate)
          .then((k) => (kit = k))
          .catch(() => (failed = true))
          .then(() => (baking = null));
      }
      return;
    }
    // Start: from the top of the chosen section, fading up.
    st.band = build(sg.ctx, sg.master, kit);
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
  if (!st.playing) return;
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
  return { want: st.want, on: st.on, ready: !!kit, failed, playing: st.playing, section: st.sect, bar: st.bar + 1, fading: !!st.stopAt };
}

// For tools: `seconds` of the music from `from`, recorded offline and
// returned as an AudioBuffer (with `ms`: how long the recording took). The
// notes are scheduled as the game does, a moment ahead, so the time taken
// says how much work the music is to play. Not while the music is playing.
export async function renderMusic(seconds, from = 'intro', rate = 48000) {
  const K = await makeKit(rate);
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
  const band = build(ctx, ctx.destination, K);
  band.out.gain.value = VOLUME;
  const saved = { sect: st.sect, bar: st.bar, step: st.step, t: st.t };
  st.sect = from;
  st.bar = 0;
  st.step = 0;
  st.t = 0.05;
  const fill = (until) => {
    while (st.t < until) {
      play(band, st.t);
      advance();
    }
  };
  fill(AHEAD);
  for (let at = 0.25; at < seconds; at += 0.25) {
    ctx.suspend(at).then(() => {
      fill(at + AHEAD);
      ctx.resume();
    });
  }
  const t0 = performance.now();
  const buf = await ctx.startRendering();
  buf.ms = performance.now() - t0;
  Object.assign(st, saved);
  return buf;
}
