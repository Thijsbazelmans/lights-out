// Headless races for tuning: the player's car is driven by a computer driver
// too (a quick one, pace 1, so it's usually fighting at the front).
//
//   node tools/sim-races.mjs monza,spa 3            (circuits, laps)
//   node tools/sim-races.mjs all 2 hard             (every circuit, laps, difficulty)
//
// Per circuit: where the player bot finished and its gap, whether all 22 cars
// finished, the best and median AI lap, wall hits (and how many were hard),
// "stuck" checks (a car barely moving for 2 s, not counting pit stops), tyres
// / car condition at the end for the player bot and the field, and the pit
// stops: how many each car made, time in the pit lane and standing in the box.
import { Track } from '../js/track.js';
import { ALL_REAL } from '../js/data/tracks.js';
import { Race } from '../js/race.js';
import { AIDriver } from '../js/ai.js';
import { playerFor, rivalsFor } from '../js/data/teams.js';

const [idsArg = 'all', lapsArg = '3', difficulty = 'normal'] = process.argv.slice(2);
const ids = idsArg === 'all' ? ALL_REAL.map((d) => d.id) : idsArg.split(',');
const laps = Number(lapsArg);
const pct = (v) => `${Math.round(v * 100)}%`;
const dt = 1 / 60;

for (const id of ids) {
  const def = ALL_REAL.find((d) => d.id === id);
  if (!def) {
    console.log(`${id}: no such circuit`);
    continue;
  }
  const t = new Track(def);
  const r = new Race({ track: t, mode: 'race', laps, difficulty, player: playerFor('ferrari', 1), rivals: rivalsFor('ferrari', 1), autoPit: true });
  const bot = new AIDriver(r.player, t, { pace: 1 });
  let hits = 0;
  let hard = 0;
  const push = r.events.push.bind(r.events);
  r.events.push = (e) => {
    if (e.t === 'wall') {
      hits++;
      if (e.power > 200) hard++;
    }
    return push(e);
  };
  let T = 0;
  let stuck = 0;
  const lastProg = new Map();
  while (T < 60 * laps + 60) {
    T += dt;
    let input = { gas: 0, brake: 0, steer: 0, analog: true };
    if (r.phase === 'race' && !r.player.finished) input = bot.control(dt, r.cars, 1, r.time);
    r.update(dt, input);
    if (Math.round(T * 60) % 120 === 0 && r.phase === 'race') {
      for (const c of r.cars) {
        const pr = c.lap * t.n + c.trackIdx;
        if (!c.finished && !c.pit && lastProg.has(c) && pr - lastProg.get(c) < 10) stuck++;
        lastProg.set(c, pr);
      }
    }
    if (r.cars.every((c) => c.finished)) break;
  }
  const done = r.cars.filter((c) => c.finished).sort((a, b) => a.finishTime - b.finishTime);
  const p = r.player;
  const pos = done.indexOf(p) + 1;
  const gap = pos === 1 && done[1] ? done[1].finishTime - p.finishTime : pos > 0 ? -(p.finishTime - done[0].finishTime) : NaN;
  const ai = r.cars.filter((c) => c !== p);
  const aiLaps = ai.map((c) => c.bestLap || 999).sort((a, b) => a - b);
  const fieldTyres = ai.reduce((s, c) => s + c.tyres, 0) / ai.length;
  const damaged = ai.filter((c) => c.damage > 0.05).length;
  const stops = r.cars.map((c) => c.stops || 0);
  const lane = r.cars.flatMap((c) => c.laneTimes || []);
  const stand = r.cars.flatMap((c) => c.stopTimes || []);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const pitInfo = r.pits
    ? `  stops ${stops.filter((n) => n === 0).length} none / ${stops.filter((n) => n === 1).length} one / ${stops.filter((n) => n > 1).length} more` +
      `  pit lane ${avg(lane).toFixed(1)}s (max ${Math.max(...lane).toFixed(1)})  box ${avg(stand).toFixed(1)}s`
    : '  no pits';
  console.log(
    `${id.padEnd(11)} you P${pos || '-'} ${gap >= 0 ? '+' : ''}${gap.toFixed(2)}s  finished ${done.length}/${r.cars.length}` +
      `  AI best ${aiLaps[0].toFixed(2)} median ${aiLaps[Math.floor(aiLaps.length / 2)].toFixed(2)}` +
      `  wall hits ${hits} (hard ${hard})  stuck ${stuck}` +
      `  you tyres ${pct(p.tyres)} car ${pct(1 - p.damage)}  field tyres ${pct(fieldTyres)}, ${damaged} damaged >5%` +
      pitInfo
  );
}
