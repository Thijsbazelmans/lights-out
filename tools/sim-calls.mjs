// Drive a lap with a computer driver in your car and log every corner call
// and BRAKE! cue: where on the lap it showed up, how long before you need to
// slow down, and your speed. For tuning the corner calls.
//
//   node tools/sim-calls.mjs monza
import { Track } from '../js/track.js';
import { ALL_REAL } from '../js/data/tracks.js';
import { Race } from '../js/race.js';
import { AIDriver } from '../js/ai.js';
import { playerFor } from '../js/data/teams.js';

const id = process.argv[2] || 'monza';
const t = new Track(ALL_REAL.find((d) => d.id === id));
const r = new Race({ track: t, mode: 'trial', player: playerFor('ferrari', 1), record: {} });
const bot = new AIDriver(r.player, t, { pace: 1 });
const p = r.player;
const kmh = () => Math.round(p.forwardSpeed * 0.447);
let last = null;
let T = 0;
const log = [];
while (p.laps.length < 2 && T < 150) {
  T += 1 / 60;
  const input = r.phase === 'race' ? bot.control(1 / 60, r.cars, 1, r.time) : { gas: 0, brake: 0, steer: 0, analog: true };
  r.update(1 / 60, input);
  for (const o of r.out) if (o.t === 'brakeCue' && p.laps.length === 1) log.push(`   BRAKE! at ${(p.trackIdx / t.n).toFixed(3)}  ${kmh()} km/h`);
  r.out.length = 0;
  const c = r.call && r.call.stage !== 'done' ? r.call.c : null;
  if (c && c !== last && p.laps.length === 1) {
    const dir = c.kind === 'chicane' ? '' : c.dir > 0 ? ' right' : ' left';
    log.push(`${(p.trackIdx / t.n).toFixed(3)} ${c.kind}${dir} (corner at ${(c.at / t.n).toFixed(3)}, ${r.call.tt.toFixed(2)} s to slow)  ${kmh()} km/h`);
  }
  last = c;
}
console.log(`${id}: lap ${p.laps[1]?.toFixed(2)} s\n${log.join('\n')}`);
