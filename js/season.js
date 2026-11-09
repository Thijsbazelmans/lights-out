// A championship over the calendar: 22 drivers in 11 teams, F1 points for the
// top ten, a Drivers' and a Constructors' table. Kept on this device until the
// season ends or is abandoned.

import { CALENDAR, TRACKS } from './data/tracks.js';
import { TEAMS, seatOf, teamById } from './data/teams.js';
import { save } from './storage.js';

export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
export const ROUNDS = CALENDAR.length;
const VERSION = 2; // 1 was the 11-car format

export function currentSeason() {
  const s = save.season;
  return s && s.version === VERSION ? s : null;
}

// An older season saved in a format this version can't continue.
export function hasOutdatedSeason() {
  return !!save.season && save.season.version !== VERSION;
}

export function startSeason({ laps, difficulty, team, seat }) {
  const lineup = [];
  for (const t of TEAMS) {
    t.drivers.forEach((d, i) => {
      const you = t.id === team && i === seatOf(seat);
      lineup.push(you ? { id: 'you', code: 'YOU', name: 'You', teamId: t.id } : { id: d.id, code: d.code, name: d.name, teamId: t.id });
    });
  }
  const zero = () => Object.fromEntries(lineup.map((d) => [d.id, 0]));
  save.season = {
    version: VERSION,
    laps,
    difficulty,
    team,
    seat: seatOf(seat),
    lineup,
    round: 0, // index of the next race in CALENDAR
    results: [], // per round: { track, order: [driverId, ...] }
    points: zero(),
    wins: zero(),
    podiums: zero(),
    startedAt: Date.now(),
  };
  save.write();
  return save.season;
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

// order: driver ids from winner to last.
export function recordRound(s, order) {
  order.forEach((id, i) => {
    if (!(id in s.points)) return;
    s.points[id] += POINTS[i] || 0;
    if (i === 0) s.wins[id] += 1;
    if (i < 3) s.podiums[id] += 1;
  });
  s.results.push({ track: CALENDAR[s.round], order });
  s.round += 1;
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
