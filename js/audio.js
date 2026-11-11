// All sound is synthesised with Web Audio, so there are no audio files to load.
// Browsers only allow sound after the first tap or key press: unlockAudio()
// is called from those events.

import { clamp } from './util.js';

let ctx = null;
let master = null;
let enabled = true;
let noiseBuf = null;
let eng = null;
let screech = null;
let rumble = null;
let pack = null;
// Engine, tyre and road sounds go through this, so they can step back for
// the music once you've crossed the line (duckEngines).
let engBus = null;
// Engine sounds already faded out (so silence() has nothing more to do).
let quiet = false;

// Speed fraction at which each gear tops out (gear 1..8).
const GEAR_TOP = [0, 0.14, 0.26, 0.38, 0.5, 0.62, 0.75, 0.88, 1.4];

export function gearInfo(speedFrac) {
  const s = Math.max(0, speedFrac);
  let g = 1;
  while (g < 8 && s > GEAR_TOP[g]) g++;
  const lo = g === 1 ? 0 : GEAR_TOP[g - 1];
  const hi = GEAR_TOP[g];
  const p = clamp((s - lo) / (hi - lo), 0, 1);
  const rpm = g === 1 ? 0.22 + p * 0.78 : 0.56 + p * 0.44;
  return { gear: g, rpm };
}

// Sound off: the audio is suspended altogether, and stays that way (taps
// don't wake it) until sound is turned back on.
export function setSoundEnabled(on) {
  enabled = on;
  if (!ctx) return;
  master.gain.setTargetAtTime(on ? 0.75 : 0, ctx.currentTime, 0.05);
  if (on) ctx.resume().catch(() => {});
  else {
    setTimeout(() => {
      if (!enabled && ctx.state === 'running') ctx.suspend().catch(() => {});
    }, 300);
  }
}

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
    } catch (e) {
      return;
    }
    master = ctx.createGain();
    master.gain.value = enabled ? 0.75 : 0;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    build();
  }
  if (!enabled) {
    if (ctx.state === 'running') ctx.suspend().catch(() => {});
    return;
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

function gainNode(v) {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

function loopNoise(type, freq, q) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = gainNode(0);
  src.connect(f).connect(g).connect(engBus);
  src.start();
  return { f, g };
}

function build() {
  const len = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  engBus = gainNode(1);
  engBus.connect(master);

  // Player engine: three detuned oscillators through a resonant low-pass.
  const o1 = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  const o3 = ctx.createOscillator();
  o1.type = 'sawtooth';
  o2.type = 'sawtooth';
  o3.type = 'square';
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  lp.Q.value = 4;
  const out = gainNode(0);
  o1.connect(gainNode(0.5)).connect(lp);
  o2.connect(gainNode(0.22)).connect(lp);
  o3.connect(gainNode(0.16)).connect(lp);
  lp.connect(out).connect(engBus);
  [o1, o2, o3].forEach((o) => o.start());
  eng = { o1, o2, o3, lp, out };

  screech = loopNoise('bandpass', 2400, 5);
  rumble = loopNoise('lowpass', 260, 1.2);

  // The rest of the field, as one distant hum that swells when a rival is close.
  const po = ctx.createOscillator();
  po.type = 'sawtooth';
  const plp = ctx.createBiquadFilter();
  plp.type = 'lowpass';
  plp.frequency.value = 700;
  const pg = gainNode(0);
  po.connect(plp).connect(pg).connect(engBus);
  po.start();
  pack = { o: po, lp: plp, g: pg };
}

// Called every frame while racing; passed on to the sound about 30 times a
// second (each change glides over 25-100 ms anyway, and fewer changes is
// less work for a phone).
let lastUpdate = -1;
export function engineUpdate({ speedFrac, throttle, boost, active, slide, offroad, rival }) {
  if (!ctx || !eng) return;
  if (!enabled) return;
  const t = ctx.currentTime;
  if (!quiet && t - lastUpdate < 0.033 && t >= lastUpdate) return;
  lastUpdate = t;
  quiet = false;
  const { rpm } = gearInfo(speedFrac);
  const f = 62 + rpm * 250 * (boost ? 1.07 : 1);
  eng.o1.frequency.setTargetAtTime(f, t, 0.025);
  eng.o2.frequency.setTargetAtTime(f * 2.013, t, 0.025);
  eng.o3.frequency.setTargetAtTime(f * 0.5, t, 0.025);
  eng.lp.frequency.setTargetAtTime(500 + rpm * 2400 + throttle * 1100, t, 0.04);
  eng.out.gain.setTargetAtTime(active ? 0.045 + throttle * 0.06 + rpm * 0.03 : 0, t, 0.06);

  screech.g.gain.setTargetAtTime(active ? clamp(slide, 0, 1) * 0.11 : 0, t, 0.05);
  screech.f.frequency.setTargetAtTime(1900 + clamp(slide, 0, 1) * 900, t, 0.1);
  rumble.g.gain.setTargetAtTime(active ? clamp(offroad, 0, 1) * 0.5 : 0, t, 0.08);

  if (rival) {
    pack.o.frequency.setTargetAtTime(70 + rival.rpm * 220, t, 0.08);
    pack.g.gain.setTargetAtTime(active ? rival.level * 0.05 : 0, t, 0.1);
  } else {
    pack.g.gain.setTargetAtTime(0, t, 0.1);
  }
}

// After the finish the cars carry on quietly under the music: `level` is
// the share of their usual volume (1 = back to normal).
export function duckEngines(level, glide = 0.6) {
  if (!ctx || !engBus) return;
  engBus.gain.setTargetAtTime(level, ctx.currentTime, glide / 3);
}

// For music.js: the shared sound graph (null until the first tap or key).
export function soundGraph() {
  return ctx ? { ctx, master, noise: noiseBuf } : null;
}

export function silence() {
  if (!ctx || !eng || quiet) return;
  quiet = true;
  const t = ctx.currentTime;
  eng.out.gain.setTargetAtTime(0, t, 0.05);
  screech.g.gain.setTargetAtTime(0, t, 0.05);
  rumble.g.gain.setTargetAtTime(0, t, 0.05);
  pack.g.gain.setTargetAtTime(0, t, 0.05);
}

function envelope(g, t, attack, peak, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

export function sfxBeep(freq = 660, dur = 0.16, type = 'square', vol = 0.12) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = gainNode(0);
  o.connect(g).connect(master);
  envelope(g, t, 0.005, vol, dur);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export function sfxImpact(strength = 0.5) {
  if (!ctx) return;
  const v = clamp(strength, 0.04, 1);
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 700 + v * 1400;
  const g = gainNode(0);
  src.connect(f).connect(g).connect(master);
  envelope(g, t, 0.003, 0.45 * v, 0.16 + v * 0.12);
  src.start(t, Math.random());
  src.stop(t + 0.4);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
  const og = gainNode(0);
  o.connect(og).connect(master);
  envelope(og, t, 0.004, 0.5 * v, 0.2);
  o.start(t);
  o.stop(t + 0.3);
}

export function sfxBoost(level = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 2;
  f.frequency.setValueAtTime(350, t);
  f.frequency.exponentialRampToValueAtTime(2600 + level * 600, t + 0.35);
  const g = gainNode(0);
  src.connect(f).connect(g).connect(master);
  envelope(g, t, 0.02, 0.22 + level * 0.06, 0.45 + level * 0.12);
  src.start(t, Math.random());
  src.stop(t + 0.9);
  sfxBeep(440 * Math.pow(1.26, level), 0.12, 'triangle', 0.08);
}

export function sfxChime(notes, step = 0.11, type = 'triangle', vol = 0.1) {
  if (!ctx) return;
  notes.forEach((n, i) => {
    setTimeout(() => sfxBeep(n, 0.22, type, vol), i * step * 1000);
  });
}

export const sfxClick = () => sfxBeep(1200, 0.04, 'square', 0.04);

// Wheel gun: a quick rattle of noise (a longer one when the wheel is slow to go on).
export function sfxGun(long = false) {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const hits = long ? 7 : 4;
  for (let i = 0; i < hits; i++) {
    const t = t0 + i * 0.035;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.5;
    f.frequency.value = 2400 + Math.random() * 600;
    const g = gainNode(0);
    src.connect(f).connect(g).connect(master);
    envelope(g, t, 0.002, 0.22, 0.03);
    src.start(t, Math.random());
    src.stop(t + 0.06);
  }
}
