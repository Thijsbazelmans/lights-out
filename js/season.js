// A championship over the calendar: 22 drivers in 11 teams, F1 points for the
// top ten, a Drivers' and a Constructors' table. Kept on this device until the
// season ends or is abandoned.

import { CALENDAR, TRACKS } from './data/tracks.js';
import { TEAMS, carScore, seatOf, teamById } from './data/teams.js';
import { save } from './storage.js';

export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
export const ROUNDS = CALENDAR.length;
const VERSION = 3; // 1 was the 11-car format, 2 had no car development (build 40: the owner said older saves may go)

export function currentSeason() {
  const s = save.season;
  return s && s.version === VERSION ? s : null;
}

// An older season saved in a format this version can't continue.
export function hasOutdatedSeason() {
  return !!save.season && save.season.version !== VERSION;
}

// Car development through a season (build 40, roadmap 4b). At the start each
// team's car gets a plan, rolled at random, so every season plays out
// differently: a pre-season surprise in engine and aero (up to `surprise`
// off what its name suggests, now and then up to `bigSurprise`), its own
// pace of development per round (`rate`, per area), `upgrades` brought at
// random rounds (each `upgrade` in one area; a share `flop` don't work),
// sometimes a reliability problem (`reliability`: chance, size) sorted out
// at a round in `fix`, and how it reacts to results (decided by the owner:
// at random, per team and per season): when it's in the bottom five of the
// Constructors' it either fights back (`behind.fight` × its development) or
// loses its way (`behind.fade`), in the top three it either keeps pushing
// (`ahead.push`) or stalls (`ahead.stall`). Development is relative: the
// field's average engine and aero stay where they were, so the levels stay
// as hard; what changes is who's ahead. Kept in `season.dev` (every season
// from build 40 on; older ones can't continue, see VERSION).
export const DEV = {
  surprise: 0.04,
  bigSurprise: [0.2, 0.09],
  rate: [0.002, 0.007],
  upgrades: [2, 4],
  upgrade: [0.025, 0.05],
  flop: 0.2,
  reliability: [0.3, 0.12, 0.22],
  fix: [3, 10],
  relGain: 0.003,
  behind: { fight: 1.6, fade: 0.5 },
  ahead: { push: 1.25, stall: 0.5 },
};

const AREAS = ['engine', 'aero'];
const AERO_PARTS = [
  ['a new floor', 'new floor', false],
  ['a new front wing', 'new front wing', false],
  ['new sidepods', 'new sidepods', true],
  ['a new rear wing', 'new rear wing', false],
  ['a big aero package', 'big aero package', false],
];
const owns = (name) => (name.endsWith('s') ? `${name}'` : `${name}'s`);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
const round3 = (v) => Math.round(v * 1000) / 1000;

// Keeps the field's average engine and aero at `target` (relative development).
function normalise(teams, target) {
  for (const k of AREAS) {
    const shift = mean(Object.values(teams).map((d) => d.car[k])) - target[k];
    for (const d of Object.values(teams)) d.car[k] = round3(Math.max(0.45, Math.min(1.1, d.car[k] - shift)));
  }
}

// prev: the cars at the end of the season before (a career's next year):
// each starts halfway between that and its usual car, then the winter.
function newDev(prev = null) {
  const target = { engine: mean(TEAMS.map((t) => t.car.engine)), aero: mean(TEAMS.map((t) => t.car.aero)) };
  const teams = {};
  for (const t of TEAMS) {
    const was = prev && prev[t.id];
    const car = was ? { engine: (t.car.engine + was.engine) / 2, aero: (t.car.aero + was.aero) / 2, reliability: (t.car.reliability + was.reliability) / 2 } : { ...t.car };
    for (const k of AREAS) car[k] += rnd(-1, 1) * (Math.random() < DEV.bigSurprise[0] ? DEV.bigSurprise[1] : DEV.surprise);
    const plan = {
      rate: { engine: rnd(...DEV.rate), aero: rnd(...DEV.rate) },
      behind: Math.random() < 0.5 ? 'fight' : 'fade',
      ahead: Math.random() < 0.5 ? 'push' : 'stall',
      upgrades: [],
      fix: null,
    };
    if (Math.random() < DEV.reliability[0]) {
      const loss = rnd(DEV.reliability[1], DEV.reliability[2]);
      car.reliability = round3(car.reliability - loss);
      plan.fix = { round: Math.round(rnd(...DEV.fix)), gain: loss };
    }
    const n = Math.round(rnd(...DEV.upgrades));
    for (let i = 0; i < n; i++) plan.upgrades.push({ round: 2 + Math.floor(Math.random() * (ROUNDS - 4)), area: Math.random() < 0.5 ? 'engine' : 'aero', size: rnd(...DEV.upgrade), flop: Math.random() < DEV.flop });
    teams[t.id] = { car, plan, history: [] };
  }
  normalise(teams, target);
  // What the winter told us.
  const news = [];
  const surprise = TEAMS.map((t) => ({ t, d: carScore(teams[t.id]) - carScore(t) })).sort((a, b) => b.d - a.d);
  if (surprise[0].d > 0.03) news.push({ round: 1, text: `Pre-season: ${surprise[0].t.name} the surprise of the winter` });
  const worst = surprise[surprise.length - 1];
  if (worst.d < -0.03) news.push({ round: 1, text: `Pre-season: ${worst.t.name} slower than expected` });
  const avgCar = mean(TEAMS.map((o) => carScore(teams[o.id])));
  const worry = TEAMS.filter((t) => teams[t.id].plan.fix && carScore(teams[t.id]) > avgCar && t !== worst.t).slice(0, 2);
  for (const t of worry) news.push({ round: 1, text: `Pre-season: ${t.name} look quick, but reliability is a worry` });
  for (const t of TEAMS) teams[t.id].history.push(round3(carScore(teams[t.id])));
  return { target, teams, news };
}

// After a round: every team's car moves on (see DEV), with a few news lines.
function develop(s) {
  const dev = s.dev;
  const r = s.round; // rounds done
  if (r >= ROUNDS) return;
  const place = Object.fromEntries(constructorStandings(s).map((row, i) => [row.team.id, i]));
  const news = [];
  for (const t of TEAMS) {
    const d = dev.teams[t.id];
    const c = d.car;
    const p = d.plan;
    const pos = place[t.id];
    let mul = 1;
    if (pos >= TEAMS.length - 5) mul = DEV.behind[p.behind];
    else if (pos <= 2) mul = DEV.ahead[p.ahead];
    for (const k of AREAS) c[k] += p.rate[k] * mul;
    for (const u of p.upgrades) {
      if (u.round !== r) continue;
      const [with_, the, many] = u.area === 'engine' ? ['an engine upgrade', 'engine upgrade', false] : pick(AERO_PARTS);
      if (u.flop) {
        c[u.area] -= rnd(0, 0.01);
        news.push(`${owns(t.name)} ${the} ${many ? "don't" : "doesn't"} work`);
      } else {
        c[u.area] += u.size * (mul > 1 ? 1.2 : 1);
        news.push(`${t.name} bring ${with_} (+${u.area})`);
      }
    }
    if (p.fix && p.fix.round === r) {
      c.reliability = round3(c.reliability + p.fix.gain);
      news.push(`${t.name} have sorted out their reliability`);
    }
    c.reliability = round3(Math.min(0.98, c.reliability + DEV.relGain));
    if (pos >= TEAMS.length - 5 && !d.saidBehind && r >= 4) {
      d.saidBehind = true;
      news.push(p.behind === 'fight' ? `${t.name} push back with a new development plan` : `${t.name} have lost their way with the car`);
    }
    if (pos <= 2 && p.ahead === 'stall' && !d.saidAhead && r >= 6) {
      d.saidAhead = true;
      news.push(`${t.name} have stopped finding time`);
    }
  }
  normalise(dev.teams, dev.target);
  for (const t of TEAMS) dev.teams[t.id].history.push(round3(carScore(dev.teams[t.id])));
  for (const text of news.slice(0, 3)) dev.news.push({ round: r + 1, text });
}

// This season's cars, by team id (null: the cars in teams.js).
export function seasonCars(s) {
  if (!s || !s.dev) return null;
  return Object.fromEntries(Object.entries(s.dev.teams).map(([id, d]) => [id, d.car]));
}

export function startSeason(opts) {
  save.season = newSeason(opts);
  save.write();
  return save.season;
}

// A season, not yet saved anywhere (a championship or a career's year).
// prevCars: the cars at the end of the season before (see newDev).
export function newSeason({ laps, difficulty, arcade = true, team, seat, prevCars = null }) {
  const lineup = [];
  for (const t of TEAMS) {
    t.drivers.forEach((d, i) => {
      const you = t.id === team && i === seatOf(seat);
      lineup.push(you ? { id: 'you', code: 'YOU', name: 'You', teamId: t.id } : { id: d.id, code: d.code, name: d.name, teamId: t.id });
    });
  }
  const zero = () => Object.fromEntries(lineup.map((d) => [d.id, 0]));
  return {
    version: VERSION,
    laps,
    difficulty,
    arcade: arcade !== false, // (seasons from before the Arcade switch don't have it: on)
    team,
    seat: seatOf(seat),
    lineup,
    round: 0, // index of the next race in CALENDAR
    results: [], // per round: { track, order: [driverId, ...] }
    points: zero(),
    wins: zero(),
    podiums: zero(),
    startedAt: Date.now(),
    dev: newDev(prevCars), // car development (see DEV)
  };
}

export function abandonSeason() {
  save.season = null;
  save.write();
}

export function isComplete(s) {
  return s.round >= ROUNDS;
}

export function nextTrack(s) {
  return TRACKS.find((t) => t.id === CALENDAR[s.round]) || null;
}

// order: driver ids from winner to last. dnf: the ones who retired (at the
// back of the order; no points).
export function recordRound(s, order, dnf = []) {
  order.forEach((id, i) => {
    if (!(id in s.points) || dnf.includes(id)) return;
    s.points[id] += POINTS[i] || 0;
    if (i === 0) s.wins[id] += 1;
    if (i < 3) s.podiums[id] += 1;
  });
  s.results.push({ track: CALENDAR[s.round], order, ...(dnf.length ? { dnf } : {}) });
  s.round += 1;
  if (s.dev) develop(s);
  if (isComplete(s) && standings(s)[0].driver.id === 'you') save.stats.championships = (save.stats.championships || 0) + 1;
  save.write();
}

// Drivers' championship. Ties are split by wins, then podiums.
export function standings(s) {
  const mate = s.lineup.find((d) => d.teamId === s.team && d.id !== 'you');
  return s.lineup
    .map((driver) => ({
      driver,
      team: teamById(driver.teamId),
      points: s.points[driver.id] || 0,
      wins: s.wins[driver.id] || 0,
      podiums: s.podiums[driver.id] || 0,
      isPlayer: driver.id === 'you',
      isMate: driver === mate,
    }))
    .sort((a, b) => b.points - a.points || b.wins - a.wins || b.podiums - a.podiums);
}

// Constructors' championship: both cars of a team added together.
export function constructorStandings(s) {
  return TEAMS.map((team) => {
    const ds = s.lineup.filter((d) => d.teamId === team.id);
    const sum = (k) => ds.reduce((a, d) => a + (s[k][d.id] || 0), 0);
    return { team, points: sum('points'), wins: sum('wins'), podiums: sum('podiums'), isPlayer: team.id === s.team };
  }).sort((a, b) => b.points - a.points || b.wins - a.wins || b.podiums - a.podiums);
}

export function playerStanding(s) {
  const table = standings(s);
  const i = table.findIndex((r) => r.isPlayer);
  return { pos: i + 1, ...table[i] };
}

export function teamStanding(s) {
  const table = constructorStandings(s);
  const i = table.findIndex((r) => r.isPlayer);
  return { pos: i + 1, ...table[i] };
}

export function lastRound(s) {
  const r = s.results[s.results.length - 1];
  if (!r) return null;
  const track = TRACKS.find((t) => t.id === r.track);
  const winner = s.lineup.find((d) => d.id === r.order[0]);
  return { track, playerPos: r.order.indexOf('you') + 1, winner };
}
