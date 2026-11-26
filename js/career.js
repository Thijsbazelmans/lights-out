// A career (build 41, roadmap step 5). You start as a newcomer with offers
// from the back of the grid and take the weaker driver's seat, so your
// teammate is the yardstick. Every race the team sets a target: a finishing
// position for where its car stands, and beating your teammate. How you do
// builds (or costs) your reputation, and at the end of each year the teams
// make offers that match it: the top teams want a strong record, and your
// own team keeps you if you met enough of its targets. Every year is a full
// season with its own car development (season.js); the cars carry half of
// last year's development into the winter. Kept in `save.career`, apart from
// a championship season.

import { TEAMS, carScore, teamById } from './data/teams.js';
import { isComplete, newSeason, playerStanding, teamStanding } from './season.js';
import { save } from './storage.js';

const VERSION = 1;

// Reputation runs 0 to 100 and starts at `start`. Each race: `pos` for
// meeting the position target and `mate` for beating your teammate (missing
// either costs `miss`), plus `podium` or `win`. A team's seat by how good
// its car is (rank of 11): the `top` best want `topRep`, the next `mid` want
// `midRep`, the rest take anyone. Your team keeps you if you met `keep` of
// its position targets. Up to `offers` teams make an offer.
export const CAREER = { start: 20, pos: 1, mate: 1, miss: 1, podium: 1, win: 2, top: 3, topRep: 75, mid: 4, midRep: 45, keep: 0.5, offers: 3 };

export function currentCareer() {
  const c = save.career;
  return c && c.version === VERSION ? c : null;
}

export function retireCareer() {
  save.career = null;
  save.write();
}

const carsOf = (s) => (s && s.dev ? Object.fromEntries(Object.entries(s.dev.teams).map(([id, d]) => [id, d.car])) : null);

// Teams by how good their car is (1 = best); cars: by team id, or teams.js.
function carRanks(cars) {
  const rows = TEAMS.map((t) => ({ id: t.id, v: carScore({ car: (cars && cars[t.id]) || t.car }) })).sort((a, b) => b.v - a.v);
  return Object.fromEntries(rows.map((r, i) => [r.id, i + 1]));
}

// The seat you'd take at a team: the weaker of its two drivers.
function seatAt(team) {
  return team.drivers[0].skill <= team.drivers[1].skill ? 0 : 1;
}

// The finish a team expects from a car ranked `rank` of 11.
function expected(rank) {
  return Math.min(18, Math.max(3, rank * 2));
}

function offer(teamId, ranks, keep = false) {
  const team = teamById(teamId);
  const seat = seatAt(team);
  return { teamId, seat, mate: team.drivers[1 - seat].name, rank: ranks[teamId], expect: expected(ranks[teamId]), keep };
}

// Who wants you, by your reputation and their car: the best seat you can
// get, a couple more, and your own team if it keeps you.
function makeOffers(rep, ranks, keepTeam) {
  const C = CAREER;
  const want = (rank) => (rank <= C.top ? C.topRep : rank <= C.top + C.mid ? C.midRep : 0);
  const able = TEAMS.map((t) => t.id).filter((id) => rep >= want(ranks[id]) && id !== keepTeam).sort((a, b) => ranks[a] - ranks[b]);
  const picks = able.length ? [able[0]] : [];
  const rest = able.slice(1);
  while (picks.length < C.offers - (keepTeam ? 1 : 0) && rest.length) picks.push(rest.splice(Math.floor(Math.random() * rest.length), 1)[0]);
  const out = picks.map((id) => offer(id, ranks));
  if (keepTeam) out.unshift(offer(keepTeam, ranks, true));
  return out.sort((a, b) => a.rank - b.rank);
}

export function startCareer({ laps, difficulty, arcade = true }) {
  const ranks = carRanks(null);
  // Year 1: offers from three of the five slowest cars.
  const back = TEAMS.map((t) => t.id).filter((id) => ranks[id] > TEAMS.length - 5);
  const picks = [];
  while (picks.length < 3 && back.length) picks.push(back.splice(Math.floor(Math.random() * back.length), 1)[0]);
  save.career = {
    version: VERSION,
    laps,
    difficulty,
    arcade: arcade !== false,
    year: 1,
    rep: CAREER.start,
    team: null,
    seat: 1,
    season: null, // this year's season (season.js newSeason)
    offers: picks.map((id) => offer(id, ranks)).sort((a, b) => a.rank - b.rank),
    kept: null, // after a year: did your team want to keep you?
    targets: [], // this year, per race: { pos, target, metPos, beatMate }
    history: [], // per year: { year, team, pos, points, wins, podiums, teamPos, met, races, rep }
    startedAt: Date.now(),
  };
  save.write();
  return save.career;
}

// Sign for a team you have an offer from: the year starts.
export function signFor(c, teamId) {
  const o = c.offers.find((x) => x.teamId === teamId);
  if (!o) return false;
  const prevCars = carsOf(c.season);
  if (c.season) c.year += 1;
  c.team = teamId;
  c.seat = o.seat;
  c.offers = [];
  c.kept = null;
  c.targets = [];
  c.season = newSeason({ laps: c.laps, difficulty: c.difficulty, arcade: c.arcade, team: teamId, seat: o.seat, prevCars });
  c.season.career = true;
  save.write();
  return true;
}

// This race's target, from where your team's car stands now.
export function raceTarget(c) {
  const rank = carRanks(carsOf(c.season))[c.team];
  const team = teamById(c.team);
  return { pos: expected(rank), mate: team.drivers[1 - c.seat], rank };
}

// After a race (rows: the results, fastest first, as Race.buildResults):
// how you did against the target, and what it did to your reputation.
export function afterRace(c, rows, target) {
  const C = CAREER;
  const me = rows.findIndex((r) => r.isPlayer);
  const mateAt = rows.findIndex((r) => r.driver === target.mate.id);
  const pos = me + 1;
  const dnf = !!rows[me].dnf;
  const metPos = !dnf && pos <= target.pos;
  const beatMate = !dnf && (mateAt < 0 || me < mateAt);
  let d = (metPos ? C.pos : -C.miss) + (beatMate ? C.mate : -C.miss);
  if (!dnf && pos === 1) d += C.win;
  else if (!dnf && pos <= 3) d += C.podium;
  const before = c.rep;
  c.rep = Math.max(0, Math.min(100, c.rep + d));
  c.targets.push({ pos, target: target.pos, metPos, beatMate });
  save.write();
  return { pos, target: target.pos, metPos, beatMate, mate: target.mate, rep: c.rep, change: c.rep - before };
}

// The year's over: into the history, and next year's offers.
export function endOfYear(c) {
  const s = c.season;
  if (!s || !isComplete(s) || c.offers.length) return;
  const me = playerStanding(s);
  const mine = teamStanding(s);
  const met = c.targets.filter((t) => t.metPos).length;
  c.history.push({ year: c.year, team: c.team, pos: me.pos, points: me.points, wins: me.wins, podiums: me.podiums, teamPos: mine.pos, met, races: c.targets.length, rep: c.rep });
  const keep = c.targets.length && met >= CAREER.keep * c.targets.length ? c.team : null;
  c.kept = !!keep;
  c.offers = makeOffers(c.rep, carRanks(carsOf(s)), keep);
  save.write();
}
