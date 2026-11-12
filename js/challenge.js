// Ghost challenges: your best time-trial lap on a circuit, packed into a link
// you send to someone (Messages, WhatsApp...). They open it and race your lap
// as a ghost, and can send theirs back. No server: the whole lap travels in
// the link (about 2,000 to 3,000 characters).
//
// The link is the game's address with `#c=` and the lap: a format byte, a
// little JSON (circuit, its layout version, the build, your name and team,
// the lap time and timing-point splits), then every ghost frame (x, y and
// angle, as small steps from the one before), compressed and written in
// URL-safe base64.

import { ALL_REAL } from './data/tracks.js';

// Where links point: the live game. (Played from this computer or the live
// site itself, links point back to the same place, so they can be tried out.)
export const SITE = 'https://thijsbazelmans.github.io/lights-out/';
const FORMAT = 1;
const NAME_MAX = 16;

export function linkBase() {
  const { protocol, hostname, pathname } = location;
  const own = hostname.endsWith('github.io') || hostname === 'localhost' || hostname === '127.0.0.1';
  return own && protocol.startsWith('http') ? `${location.origin}${pathname}` : SITE;
}

export function cleanName(s) {
  return String(s || '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

// The challenge for your record on a circuit (null if there's no lap to send).
export function challengeFrom(trackId, rec, { name, team, build }) {
  const def = ALL_REAL.find((d) => d.id === trackId);
  if (!def || !rec || rec.bestLap == null || !rec.ghost || rec.ghost.frames.length < 90) return null;
  return {
    track: trackId,
    layout: def.layout,
    build: String(build || ''),
    name: cleanName(name) || 'A friend',
    team: team || null,
    time: rec.bestLap,
    splits: rec.splits || [],
    ghost: rec.ghost,
  };
}

// ---------- packing ----------

function writer() {
  const bytes = [];
  return {
    bytes,
    u(v) {
      // unsigned varint
      let n = Math.max(0, Math.floor(v));
      while (n >= 0x80) {
        bytes.push((n % 0x80) | 0x80);
        n = Math.floor(n / 0x80);
      }
      bytes.push(n);
    },
    s(v) {
      // signed (zigzag) varint
      const n = Math.round(v);
      this.u(n >= 0 ? n * 2 : -n * 2 - 1);
    },
  };
}

function reader(bytes) {
  let i = 0;
  return {
    get i() {
      return i;
    },
    u() {
      let n = 0;
      let mul = 1;
      for (;;) {
        if (i >= bytes.length) throw new Error('short');
        const b = bytes[i++];
        n += (b & 0x7f) * mul;
        if (b < 0x80) return n;
        mul *= 0x80;
        if (mul > 2 ** 49) throw new Error('bad number');
      }
    },
    s() {
      const n = this.u();
      return n % 2 ? -(n + 1) / 2 : n / 2;
    },
    take(len) {
      if (i + len > bytes.length) throw new Error('short');
      const out = bytes.subarray(i, i + len);
      i += len;
      return out;
    },
  };
}

async function squeeze(bytes, how) {
  const Stream = how === 'deflate-raw' ? globalThis.CompressionStream : globalThis.DecompressionStream;
  const piped = new Blob([bytes]).stream().pipeThrough(new Stream('deflate-raw'));
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

function toBase64Url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const b = text.replace(/-/g, '+').replace(/_/g, '/');
  const s = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function encodeChallenge(c) {
  const w = writer();
  w.u(FORMAT);
  const meta = new TextEncoder().encode(
    JSON.stringify({
      t: c.track,
      l: c.layout,
      b: c.build,
      n: c.name,
      m: c.team,
      s: Math.round(c.time * 1000),
      p: (c.splits || []).map((v) => (v == null ? -1 : Math.round(v * 1000))),
      d: Math.round(c.ghost.dt * 1000),
    })
  );
  w.u(meta.length);
  for (const b of meta) w.bytes.push(b);
  const F = c.ghost.frames;
  const n = Math.floor(F.length / 3);
  w.u(n);
  let x = 0;
  let y = 0;
  let a = 0;
  for (let k = 0; k < n * 3; k += 3) {
    const nx = Math.round(F[k]);
    const ny = Math.round(F[k + 1]);
    const na = Math.round(F[k + 2] * 100); // angles are kept to 0.01 rad
    w.s(nx - x);
    w.s(ny - y);
    w.s(na - a);
    x = nx;
    y = ny;
    a = na;
  }
  const raw = new Uint8Array(w.bytes);
  // Compressed where the browser can (all current ones); plain otherwise.
  if (globalThis.CompressionStream) {
    try {
      const z = await squeeze(raw, 'deflate-raw');
      return toBase64Url(new Uint8Array([1, ...z]));
    } catch (e) {
      /* fall through to plain */
    }
  }
  return toBase64Url(new Uint8Array([0, ...raw]));
}

// What's after `c=` in a link, or the code itself if that's all there is.
export function codeFrom(text) {
  const s = String(text || '').trim();
  const m = s.match(/[#?&]c=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{40,}$/.test(s) ? s : null;
}

// A challenge from a link or code. Throws an Error whose message can be
// shown as it is.
export async function decodeChallenge(text) {
  const code = codeFrom(text);
  if (!code) throw new Error("That doesn't look like a challenge link.");
  let bytes;
  try {
    bytes = fromBase64Url(code);
  } catch (e) {
    throw new Error("This link is broken: some of it may be missing. Ask them to send it again.");
  }
  if (bytes[0] === 1) {
    if (!globalThis.DecompressionStream) throw new Error('This browser is too old to open challenges. Update it, or try another browser.');
    try {
      bytes = await squeeze(bytes.subarray(1), 'inflate');
    } catch (e) {
      throw new Error("This link is broken: some of it may be missing. Ask them to send it again.");
    }
  } else if (bytes[0] === 0) bytes = bytes.subarray(1);
  else throw new Error("That doesn't look like a challenge link.");
  try {
    const r = reader(bytes);
    const format = r.u();
    if (format > FORMAT) throw new Error('newer');
    const meta = JSON.parse(new TextDecoder().decode(r.take(r.u())));
    const n = r.u();
    if (n < 90 || n > 40000) throw new Error('frames');
    const frames = new Array(n * 3);
    let x = 0;
    let y = 0;
    let a = 0;
    for (let k = 0; k < n * 3; k += 3) {
      x += r.s();
      y += r.s();
      a += r.s();
      frames[k] = x;
      frames[k + 1] = y;
      frames[k + 2] = a / 100;
    }
    const def = ALL_REAL.find((d) => d.id === meta.t);
    if (!def) throw new Error('track');
    const time = meta.s / 1000;
    if (!(time > 5 && time < 600)) throw new Error('time');
    return {
      track: def.id,
      layout: Number(meta.l) || 1,
      build: String(meta.b || ''),
      name: cleanName(meta.n) || 'A friend',
      team: typeof meta.m === 'string' ? meta.m : null,
      time,
      splits: Array.isArray(meta.p) ? meta.p.map((v) => (typeof v === 'number' && v >= 0 ? v / 1000 : null)) : [],
      ghost: { dt: (Number(meta.d) || 50) / 1000, frames },
      received: Date.now(),
    };
  } catch (e) {
    if (e.message === 'newer') throw new Error('This challenge was made with a newer version of the game. Open the game online to update it, then try again.');
    if (e.message === 'track') throw new Error("This challenge is on a circuit this version of the game doesn't have. Open the game online to update it.");
    throw new Error("This link is broken: some of it may be missing. Ask them to send it again.");
  }
}

// Can this challenge be raced here? (null if so, else why not)
export function challengeProblem(c) {
  const def = ALL_REAL.find((d) => d.id === c.track);
  if (!def) return "This challenge is on a circuit this version of the game doesn't have.";
  if ((def.layout ?? 1) !== c.layout) return `This lap was set on an older layout of ${def.name}, so it can't be raced any more. Ask for a new one.`;
  return null;
}

export function challengeLink(code) {
  return `${linkBase()}#c=${code}`;
}
