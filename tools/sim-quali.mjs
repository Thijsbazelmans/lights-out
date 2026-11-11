// Headless qualifying for tuning: the whole session (garage, pit lane,
// out-lap, flying lap) with your car driven by a computer driver at a few
// paces, against the computer drivers' simulated laps.
//
//   node tools/sim-quali.mjs monza,spa            (circuits)
//   node tools/sim-quali.mjs all hard 0.9,0.95    (every circuit, difficulty, bot paces)
//   node tools/sim-quali.mjs monza normal 1 race  (then a 2-lap race from that grid)
//
// Per circuit: pole, P10 and last time of the computer drivers, how long
// their laps took to simulate, and for each bot pace its lap and where it
// qualified (and with `race`, where it started and finished).
import { Track } from '../js/track.js';
import { ALL_REAL } from '../js/data/tracks.js';
import { Race, rollForm } from '../js/race.js';
import { AIDriver } from '../js/ai.js';
import { playerFor, rivalsFor } from '../js/data/teams.js';
import { formatTime } from '../js/util.js';

const [idsArg = 'all', difficulty = 'normal', pacesArg = '0.88,0.92,0.96,1', then = ''] = process.argv.slice(2);
const ids = idsArg === 'all' ? ALL_REAL.map((d) => d.id) : idsArg.split(',');
const paces = pacesArg.split(',').map(Number);
const dt = 1 / 60;
const player = playerFor('ferrari', 1);
const rivals = rivalsFor('ferrari', 1);

function session(t, pace, form, field) {
  const r = new Race({ track: t, mode: 'quali', difficulty, player, rivals, form, field });
  const bot = new AIDriver(r.player, t, { pace });
  let T = 0;
  let simMs = 0;
  let outLap = null;
  while (!r.results && T < 600) {
    T += dt;
    let input = { gas: 0, brake: 0, steer: 0, analog: true };
    if (r.phase === 'race' && !r.player.pit && !r.player.finished) input = bot.control(dt, r.cars, 1, r.time);
    const t0 = performance.now();
    r.update(dt, input);
    simMs += performance.now() - t0;
    if (outLap == null && r.quali.stage === 'flying') outLap = r.time;
    if (r.phase === 'finished') r.skipFinish = true;
  }
  return { r, simMs, outLap };
}

for (const id of ids) {
  const def = ALL_REAL.find((d) => d.id === id);
  if (!def) {
    console.log(`${id}: no such circuit`);
    continue;
  }
  const t = new Track(def);
  const form = Object.fromEntries(rivals.map((d) => [d.driverId, rollForm()]));
  let field = null;
  const bits = [];
  let head = '';
  for (const pace of paces) {
    const { r, simMs, outLap } = session(t, pace, form, field);
    if (!r.results) {
      bits.push(`${pace}: no lap`);
      continue;
    }
    if (!field) {
      field = r.quali.results;
      const ai = field.map((f) => f.time).filter((v) => v != null).sort((a, b) => a - b);
      head = `pole ${formatTime(ai[0])} P10 ${formatTime(ai[9])} last ${formatTime(ai[ai.length - 1])} (${21 - ai.length} no time)  session ${simMs.toFixed(0)} ms cpu, out-lap ${outLap.toFixed(0)} s`;
    }
    bits.push(`bot ${pace}: ${formatTime(r.results.playerTime)} P${r.results.playerPos}`);
    if (then === 'race') {
      const race = new Race({ track: t, mode: 'race', laps: 2, difficulty, player, rivals, grid: r.results.grid, form, autoPit: true });
      const rb = new AIDriver(race.player, t, { pace });
      let T = 0;
      while (!race.player.finished && T < 400) {
        T += dt;
        const input = race.phase === 'race' && !race.player.pit ? rb.control(dt, race.cars, 1, race.time) : { gas: 0, brake: 0, steer: 0, analog: true };
        race.update(dt, input);
      }
      bits[bits.length - 1] += ` → race from P${race.player.gridPos}: P${race.player.shownPos || race.player.finishPos || '-'}`;
    }
  }
  console.log(`${id.padEnd(11)} ${head}\n            ${bits.join('   ')}`);
}
