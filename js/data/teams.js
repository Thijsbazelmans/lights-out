// The 2026 grid: 11 teams, two drivers each. Colours follow each team's 2026
// livery as seen from above (main body colour, then the accent used on the
// wings and spine); teammates differ by helmet colour.
// Each team's `car` (build 39, roadmap 4a): `engine` (top speed and pull),
// `aero` (grip in fast corners) and `reliability` (with Arcade off, how
// likely it is to let go: an engine failure), each 0 to 1 with 1 the best
// on the grid. Your car is your team's car (DIFFICULTY in race.js says how
// far apart the best and worst are). Each driver's `skill` (0 to 1) is how
// much they get out of the car: their corner pace. A rough pecking order
// for the start of 2026, easy to retune.
//
// You pick a team and take one of its two seats; you race as "YOU" and the
// other driver is your teammate. The other 21 cars are the AI.

export const TEAMS = [
  {
    id: 'mclaren',
    name: 'McLaren',
    code: 'MCL',
    car: { engine: 0.96, aero: 1.0, reliability: 0.9 },
    livery: { color: '#ff8000', color2: '#16181c', helmet: '#ff8000' },
    drivers: [
      { id: 'norris', code: 'NOR', name: 'Lando Norris', helmet: '#ffd23f', skill: 0.92 },
      { id: 'piastri', code: 'PIA', name: 'Oscar Piastri', helmet: '#1d4ed8', skill: 0.9 },
    ],
  },
  {
    id: 'mercedes',
    name: 'Mercedes',
    code: 'MER',
    car: { engine: 1.0, aero: 0.96, reliability: 0.85 },
    livery: { color: '#c3c9cf', color2: '#00b5a2', helmet: '#16181c' },
    drivers: [
      { id: 'russell', code: 'RUS', name: 'George Russell', helmet: '#1d4ed8', skill: 0.9 },
      { id: 'antonelli', code: 'ANT', name: 'Kimi Antonelli', helmet: '#f4f4f4', skill: 0.78 },
    ],
  },
  {
    id: 'ferrari',
    name: 'Ferrari',
    code: 'FER',
    car: { engine: 0.97, aero: 0.93, reliability: 0.88 },
    livery: { color: '#dc0000', color2: '#f4f4f4', helmet: '#ffd400' },
    drivers: [
      { id: 'leclerc', code: 'LEC', name: 'Charles Leclerc', helmet: '#1d1d1f', skill: 0.93 },
      { id: 'hamilton', code: 'HAM', name: 'Lewis Hamilton', helmet: '#ffd400', skill: 0.88 },
    ],
  },
  {
    id: 'redbull',
    name: 'Red Bull Racing',
    code: 'RBR',
    car: { engine: 0.92, aero: 0.97, reliability: 0.8 },
    livery: { color: '#1c2b6e', color2: '#e10600', helmet: '#ffc906' },
    drivers: [
      { id: 'verstappen', code: 'VER', name: 'Max Verstappen', helmet: '#f4f4f4', skill: 1.0 },
      { id: 'hadjar', code: 'HAD', name: 'Isack Hadjar', helmet: '#ff6b00', skill: 0.72 },
    ],
  },
  {
    id: 'williams',
    name: 'Williams',
    code: 'WIL',
    car: { engine: 0.96, aero: 0.78, reliability: 0.88 },
    livery: { color: '#1b46cc', color2: '#62c6ff', helmet: '#f4f4f4' },
    drivers: [
      { id: 'albon', code: 'ALB', name: 'Alex Albon', helmet: '#00b5e2', skill: 0.84 },
      { id: 'sainz', code: 'SAI', name: 'Carlos Sainz', helmet: '#e10600', skill: 0.85 },
    ],
  },
  {
    id: 'racingbulls',
    name: 'Racing Bulls',
    code: 'VRB',
    car: { engine: 0.92, aero: 0.75, reliability: 0.8 },
    livery: { color: '#eef0f6', color2: '#2348e0', helmet: '#e10600' },
    drivers: [
      { id: 'lawson', code: 'LAW', name: 'Liam Lawson', helmet: '#16181c', skill: 0.74 },
      { id: 'lindblad', code: 'LIN', name: 'Arvid Lindblad', helmet: '#ffd400', skill: 0.68 },
    ],
  },
  {
    id: 'alpine',
    name: 'Alpine',
    code: 'ALP',
    car: { engine: 0.96, aero: 0.7, reliability: 0.85 },
    livery: { color: '#0a6ad8', color2: '#ff87c8', helmet: '#f4f4f4' },
    drivers: [
      { id: 'gasly', code: 'GAS', name: 'Pierre Gasly', helmet: '#1d4ed8', skill: 0.84 },
      { id: 'colapinto', code: 'COL', name: 'Franco Colapinto', helmet: '#7ec8ff', skill: 0.7 },
    ],
  },
  {
    id: 'haas',
    name: 'Haas',
    code: 'HAS',
    car: { engine: 0.95, aero: 0.68, reliability: 0.86 },
    livery: { color: '#ececec', color2: '#d6001c', helmet: '#16181c' },
    drivers: [
      { id: 'ocon', code: 'OCO', name: 'Esteban Ocon', helmet: '#ff87c8', skill: 0.8 },
      { id: 'bearman', code: 'BEA', name: 'Oliver Bearman', helmet: '#1d4ed8', skill: 0.78 },
    ],
  },
  {
    id: 'audi',
    name: 'Audi',
    code: 'AUD',
    car: { engine: 0.82, aero: 0.74, reliability: 0.72 },
    livery: { color: '#8a8e95', color2: '#ff3d1f', helmet: '#16181c' },
    drivers: [
      { id: 'hulkenberg', code: 'HUL', name: 'Nico Hülkenberg', helmet: '#f4f4f4', skill: 0.82 },
      { id: 'bortoleto', code: 'BOR', name: 'Gabriel Bortoleto', helmet: '#ffd400', skill: 0.75 },
    ],
  },
  {
    id: 'astonmartin',
    name: 'Aston Martin',
    code: 'AMR',
    car: { engine: 0.85, aero: 0.72, reliability: 0.75 },
    livery: { color: '#0f6a50', color2: '#c6f000', helmet: '#c6f000' },
    drivers: [
      { id: 'alonso', code: 'ALO', name: 'Fernando Alonso', helmet: '#1d4ed8', skill: 0.9 },
      { id: 'stroll', code: 'STR', name: 'Lance Stroll', helmet: '#f4f4f4', skill: 0.68 },
    ],
  },
  {
    id: 'cadillac',
    name: 'Cadillac',
    code: 'CAD',
    car: { engine: 0.93, aero: 0.6, reliability: 0.75 },
    // Split livery: grey-white left flank, black right flank.
    livery: { color: '#e6e8eb', split: '#141416', color2: '#141416', helmet: '#c9a227' },
    drivers: [
      { id: 'perez', code: 'PER', name: 'Sergio Pérez', helmet: '#0b3d91', skill: 0.8 },
      { id: 'bottas', code: 'BOT', name: 'Valtteri Bottas', helmet: '#7ec8ff', skill: 0.8 },
    ],
  },
];

export const DEFAULT_TEAM = 'mclaren';

export function teamById(id) {
  return TEAMS.find((t) => t.id === id) || TEAMS.find((t) => t.id === DEFAULT_TEAM);
}

// seat: 0 or 1, which of the team's two drivers you replace.
export function seatOf(seat) {
  return seat === 0 ? 0 : 1;
}

// The player's car: the chosen team's colours, raced under the name YOU.
export function playerFor(teamId, seat = 1) {
  const team = teamById(teamId);
  const replaced = team.drivers[seatOf(seat)];
  return {
    id: 'you',
    name: 'You',
    code: 'YOU',
    livery: team.livery,
    team,
    teamId: team.id,
    replaces: replaced,
    teammate: team.drivers[1 - seatOf(seat)],
  };
}

// How good a team's car is overall (0 to 1): engine and aero.
export function carScore(team) {
  return (team.car.engine + team.car.aero) / 2;
}

// Every AI driver as a car entry: team colours with the driver's own helmet;
// `car` the team's car, `driverSkill` the driver's own skill, `skill` the two
// together (the order cars line up in without qualifying).
export function driverEntry(team, d) {
  return {
    id: d.id,
    driverId: d.id,
    teamId: team.id,
    name: d.name,
    code: d.code,
    team,
    car: team.car,
    driverSkill: d.skill,
    skill: 0.75 * carScore(team) + 0.25 * d.skill,
    livery: { ...team.livery, helmet: d.helmet },
  };
}

// Everyone except you: 21 drivers, including your teammate.
export function rivalsFor(teamId, seat = 1) {
  const team = teamById(teamId);
  const out = [];
  for (const t of TEAMS) {
    t.drivers.forEach((d, i) => {
      if (t.id === team.id && i === seatOf(seat)) return;
      out.push(driverEntry(t, d));
    });
  }
  return out;
}

// All 22 drivers (for the menu's demo race).
export function allDrivers() {
  return TEAMS.flatMap((t) => t.drivers.map((d) => driverEntry(t, d)));
}
