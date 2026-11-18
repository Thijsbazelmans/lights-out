// The computer drivers' pace per circuit, the same every run (seeded), for
// tuning DIFFICULTY: their qualifying laps alone on the road (pole, P10) and
// a race with a bot in your car (AI best lap, median of the best laps, wall
// hits by the AI, hard ones).
//
//   node tools/sim-pace.mjs hard all > before.txt        (difficulty, circuits, laps)
//   node tools/sim-pace.mjs hard all 3 --vs before.txt   (% change per circuit, and on average)
//   SET=power=1.03,grip=1.15 node tools/sim-pace.mjs hard monza,suzuka
//
// SET overrides that difficulty's DIFFICULTY values for the run (also
// from/full for DOWNFORCE, push0/push1 for QUALI.push).
import { readFileSync } from 'fs';
import { Track } from '../js/track.js';
import { ALL_REAL } from '../js/data/tracks.js';
import { DIFFICULTY, Race } from '../js/race.js';
import { QUALI } from '../js/quali.js';
import { DOWNFORCE } from '../js/car.js';
import { AIDriver } from '../js/ai.js';
import { playerFor, rivalsFor } from '../js/data/teams.js';

const args = process.argv.slice(2);
const vsAt = args.indexOf('--vs');
const vs = vsAt >= 0 ? args.splice(vsAt, 2)[1] : null;
const [difficulty = 'normal', idsArg = 'all', lapsArg = '3'] = args;
const ids = idsArg === 'all' ? ALL_REAL.map((d) => d.id) : idsArg.split(',');
const laps = Number(lapsArg);
for (const kv of (process.env.SET || '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  if (k === 'from' || k === 'full') DOWNFORCE[k] = Number(v);
  else if (k === 'push0' || k === 'push1') QUALI.push[difficulty][k === 'push0' ? 0 : 1] = Number(v);
  else DIFFICULTY[difficulty][k] = Number(v);
}

function seeded(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dt = 1 / 60;
const player = playerFor('ferrari', 1);
const rivals = rivalsFor('ferrari', 1);
const rows = [];
for (const id of ids) {
  const def = ALL_REAL.find((d) => d.id === id);
  if (!def) {
    console.log(`${id}: no such circuit`);
    continue;
  }
  Math.random = seeded(12345);
  const t = new Track(def);
  // Qualifying: the field's laps, simulated alone on the road.
  Math.random = seeded(777);
  const q = new Race({ track: t, mode: 'quali', difficulty, player, rivals });
  q.quali.sim.finish();
  const qt = q.quali.sim.results().map((r) => r.time).filter((v) => v != null).sort((a, b) => a - b);
  // A race, with a bot in your car for traffic.
  Math.random = seeded(4242);
  const r = new Race({ track: t, mode: 'race', laps, difficulty, player, rivals, autoPit: true });
  const bot = new AIDriver(r.player, t, { pace: 0.95 });
  let hits = 0;
  let hard = 0;
  const push = r.events.push.bind(r.events);
  r.events.push = (e) => {
    if (e.t === 'wall' && e.car !== r.player) {
      hits++;
      if (e.power > 200) hard++;
    }
    return push(e);
  };
  let T = 0;
  while (T < 60 * laps + 90) {
    T += dt;
    let input = { gas: 0, brake: 0, steer: 0, analog: true };
    if (r.phase === 'race' && !r.player.finished && !r.player.pit) input = bot.control(dt, r.cars, 1, r.time);
    r.update(dt, input);
    if (r.cars.every((c) => c.finished)) break;
  }
  const ai = r.cars.filter((c) => c !== r.player).map((c) => c.bestLap || 999).sort((a, b) => a - b);
  rows.push({ id, pole: qt[0], p10: qt[9], noTime: 21 - qt.length, best: ai[0], med: ai[10], hits, hard, fin: r.cars.filter((c) => c.finished).length });
}

const keys = ['pole', 'p10', 'best', 'med'];
if (!vs) {
  for (const x of rows) console.log(`${x.id.padEnd(12)} pole ${x.pole?.toFixed(3)} P10 ${x.p10?.toFixed(3)}${x.noTime ? ` (${x.noTime} no time)` : ''} | race best ${x.best.toFixed(3)} median ${x.med.toFixed(3)} | wall hits ${x.hits} (hard ${x.hard})  finished ${x.fin}/22`);
  console.log('JSON ' + JSON.stringify(rows));
} else {
  const before = JSON.parse(readFileSync(vs, 'utf8').split('\n').find((l) => l.startsWith('JSON ')).slice(5));
  const sum = Object.fromEntries(keys.map((k) => [k, 0]));
  const tot = [0, 0, 0, 0];
  let n = 0;
  const pc = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`.padStart(6);
  console.log('circuit        pole    P10   best  median  (AI laps vs before; + is slower)');
  for (const y of rows) {
    const x = before.find((b) => b.id === y.id);
    if (!x) continue;
    const d = keys.map((k) => (y[k] / x[k] - 1) * 100);
    keys.forEach((k, i) => (sum[k] += d[i]));
    tot[0] += x.hits;
    tot[1] += y.hits;
    tot[2] += x.hard;
    tot[3] += y.hard;
    n++;
    console.log(`${y.id.padEnd(12)} ${d.map(pc).join(' ')}   wall hits ${x.hits}→${y.hits} (hard ${x.hard}→${y.hard})${y.fin < 22 ? `  finished ${y.fin}/22` : ''}`);
  }
  console.log(`average      ${keys.map((k) => pc(sum[k] / n)).join(' ')}   wall hits ${tot[0]}→${tot[1]} (hard ${tot[2]}→${tot[3]})`);
}
