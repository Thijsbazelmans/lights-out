// The pit stop you play, against the computer crews: how long a few kinds of
// player stand in the box (alone in the pit lane, so no waiting for traffic),
// next to the computer stop times for each difficulty (AI_STOP in pit.js).
//
//   node tools/sim-stops.mjs          (300 stops per kind of player)
//
// A player taps when they think the marker is on the green, `sigma` s off
// either way (more on a phone), and reacts to the green release light in
// `react` s. Also: how long stops with four greens take.
import { Track } from '../js/track.js';
import { ALL_REAL } from '../js/data/tracks.js';
import { Race } from '../js/race.js';
import { AI_STOP, PIT_GAME } from '../js/pit.js';
import { playerFor } from '../js/data/teams.js';

const [nArg = '300'] = process.argv.slice(2);
const N = Number(nArg);
const PLAYERS = {
  perfect: { sigma: 0, react: 0.2 },
  sharp: { sigma: 0.05, react: 0.3 },
  'good (phone)': { sigma: 0.07, react: 0.33 },
  typical: { sigma: 0.09, react: 0.36 },
  casual: { sigma: 0.12, react: 0.42 },
};

const gauss = () => {
  let u = 0;
  let v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const pct = (a, q) => a.slice().sort((x, y) => x - y)[Math.floor(q * (a.length - 1))];
const t = new Track(ALL_REAL.find((d) => d.id === 'monza'));
const dt = 1 / 60;

function stop({ sigma, react }) {
  const r = new Race({ track: t, mode: 'race', laps: 3, player: playerFor('ferrari', 1), rivals: [] });
  r.phase = 'race';
  const p = r.player;
  p.frozen = false;
  r.pits.enter(p, t.pit.start + 2);
  let err = 0;
  let wheel = -1;
  let hits = '';
  const rt = react + 0.07 * Math.abs(gauss());
  for (let k = 0; k < 60 * 40 && p.pit && p.pit.stage !== 'out'; k++) {
    const g = r.pits.game;
    const input = { gas: 0, brake: 0, steer: 0, analog: true, pedal: false };
    if (g) hits = g.hits.join(',');
    if (g && g.phase === 'wheels' && g.gun <= 0) {
      if (g.wheel !== wheel) {
        err = sigma * gauss();
        wheel = g.wheel;
      }
      const toZone = (g.zone - g.m) * PIT_GAME.sweep; // s until the marker is on the zone
      if (toZone <= -err && toZone > -err - 0.03) input.pedal = true;
    } else if (g && g.phase === 'light' && g.green && g.t - g.greenAt >= rt) input.pedal = true;
    r.update(dt, input);
  }
  return { time: p.stopTimes[0], perfect: hits === 'good,good,good,good' };
}

const fourGreens = [];
console.log('Your stop (standing in the box, s):');
for (const [name, m] of Object.entries(PLAYERS)) {
  const a = [];
  for (let i = 0; i < N; i++) {
    const s = stop(m);
    a.push(s.time);
    if (s.perfect) fourGreens.push(s.time);
  }
  console.log(`  ${name.padEnd(13)} median ${pct(a, 0.5).toFixed(2)}   quickest 10% ${pct(a, 0.1).toFixed(2)}   slowest 10% ${pct(a, 0.9).toFixed(2)}`);
}
console.log(`  four greens:  ${pct(fourGreens, 0).toFixed(2)} to ${pct(fourGreens, 1).toFixed(2)} (median ${pct(fourGreens, 0.5).toFixed(2)}, ${fourGreens.length} stops)`);
console.log('Computer crews (plus about 0.2 s waiting for a clear lane in a race):');
for (const d of ['easy', 'normal', 'hard']) {
  const a = [];
  const [lo, hi] = AI_STOP[d];
  for (let i = 0; i < 5000; i++) {
    let s = lo + Math.random() * (hi - lo);
    if (Math.random() < AI_STOP.slowChance) s += AI_STOP.slow[0] + Math.random() * (AI_STOP.slow[1] - AI_STOP.slow[0]);
    a.push(s);
  }
  console.log(`  ${d.padEnd(13)} median ${pct(a, 0.5).toFixed(2)}   quickest 10% ${pct(a, 0.1).toFixed(2)}   slowest 10% ${pct(a, 0.9).toFixed(2)}`);
}
