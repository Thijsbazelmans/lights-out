// The pit lane when it's busy: how long cars stand in their box after the
// crew is done, waiting for a gap in the cars coming down the lane (the
// release, PIT_RELEASE in pit.js), plus time in the lane, cars standing
// still in the lane, and pit cars drawn on top of each other.
//
//   node tools/sim-pitlane.mjs all 3            (circuits, laps)
//   node tools/sim-pitlane.mjs monza,bahrain 3 4 normal same
//                                               (4 races each; `same`: the
//                                                whole field plans to stop
//                                                on the first lap it can)
import { Track } from '../js/track.js';
import { ALL_REAL } from '../js/data/tracks.js';
import { Race } from '../js/race.js';
import { AIDriver } from '../js/ai.js';
import { Pits } from '../js/pit.js';
import { playerFor, rivalsFor } from '../js/data/teams.js';

const [idsArg = 'all', lapsArg = '3', runsArg = '1', difficulty = 'normal', same = ''] = process.argv.slice(2);
const ids = idsArg === 'all' ? ALL_REAL.map((d) => d.id) : idsArg.split(',');
const laps = Number(lapsArg);
const runs = Number(runsArg);
const dt = 1 / 60;
const pct = (a, q) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(q * (a.length - 1))] : NaN);
const f = (v) => v.toFixed(2);

// Held = standing in the box after the crew finished.
let held = null;
const release = Pits.prototype.release;
Pits.prototype.release = function (car, standing) {
  if (held) held.push(standing - (car.pit.service ?? standing));
  return release.call(this, car, standing);
};

const all = [];
let overlapAll = 0;
let stillAll = 0;
for (const id of ids) {
  const def = ALL_REAL.find((d) => d.id === id);
  if (!def) {
    console.log(`${id}: no such circuit`);
    continue;
  }
  const t = new Track(def);
  held = [];
  const lane = [];
  let overlap = 0;
  let still = 0;
  for (let run = 0; run < runs; run++) {
    const r = new Race({ track: t, mode: 'race', laps, difficulty, player: playerFor('ferrari', 1), rivals: rivalsFor('ferrari', 1), autoPit: true });
    if (same && r.pits) for (const c of r.cars) c.pitPlan = r.pits.chances[0];
    const bot = new AIDriver(r.player, t, { pace: 1 });
    const stand = new Map();
    for (let T = 0; T < 70 * laps + 60; T += dt) {
      const input = r.phase === 'race' && !r.player.finished ? bot.control(dt, r.cars, 1, r.time) : { gas: 0, brake: 0, steer: 0, analog: true };
      r.update(dt, input);
      const pc = r.cars.filter((c) => c.pit);
      for (let i = 0; i < pc.length; i++) {
        for (let j = i + 1; j < pc.length; j++) if (Math.hypot(pc[i].x - pc[j].x, pc[i].y - pc[j].y) < 30) overlap += dt;
        const c = pc[i];
        const s = c.pit;
        const n = s.stage !== 'box' && s.v < 1 && r.pits.inLane(c) ? (stand.get(c) || 0) + dt : 0;
        stand.set(c, n);
        still = Math.max(still, n);
      }
      if (r.cars.every((c) => c.finished)) break;
    }
    for (const c of r.cars) lane.push(...(c.laneTimes || []));
  }
  all.push(...held);
  overlapAll += overlap;
  stillAll = Math.max(stillAll, still);
  const avg = lane.reduce((a, b) => a + b, 0) / lane.length;
  console.log(
    `${id.padEnd(11)} held: median ${f(pct(held, 0.5))}  90% ${f(pct(held, 0.9))}  max ${f(Math.max(...held))}  over 1s ${held.filter((h) => h > 1).length}/${held.length}` +
      `  lane ${avg.toFixed(1)}s (max ${Math.max(...lane).toFixed(1)})  standing in the lane ${f(still)}s  cars on top of each other ${overlap.toFixed(1)}s`,
  );
}
if (ids.length > 1) {
  console.log(
    `all         held: median ${f(pct(all, 0.5))}  90% ${f(pct(all, 0.9))}  99% ${f(pct(all, 0.99))}  max ${f(Math.max(...all))}  over 1s ${all.filter((h) => h > 1).length}/${all.length}` +
      `  standing in the lane ${f(stillAll)}s  cars on top of each other ${overlapAll.toFixed(1)}s`,
  );
}
