// The 2026 grid: 11 teams. Colours follow each team's 2026 livery as seen
// from above (main body colour, then the accent used on the wings and spine).
// `skill` sets how quick the computer drives that car (0.94 slowest, 1.0
// fastest); it's a rough pecking order, easy to retune.
//
// The team you pick races as "YOU" in its colours; the other ten are the AI.

export const TEAMS = [
  {
    id: 'mclaren',
    name: 'McLaren',
    code: 'MCL',
    skill: 1.0,
    livery: { color: '#ff8000', color2: '#16181c', helmet: '#ff8000' },
  },
  {
    id: 'mercedes',
    name: 'Mercedes',
    code: 'MER',
    skill: 1.0,
    livery: { color: '#c3c9cf', color2: '#00b5a2', helmet: '#16181c' },
  },
  {
    id: 'ferrari',
    name: 'Ferrari',
    code: 'FER',
    skill: 0.99,
    livery: { color: '#dc0000', color2: '#f4f4f4', helmet: '#ffd400' },
  },
  {
    id: 'redbull',
    name: 'Red Bull Racing',
    code: 'RBR',
    skill: 0.99,
    livery: { color: '#1c2b6e', color2: '#e10600', helmet: '#ffc906' },
  },
  {
    id: 'williams',
    name: 'Williams',
    code: 'WIL',
    skill: 0.97,
    livery: { color: '#1b46cc', color2: '#62c6ff', helmet: '#f4f4f4' },
  },
  {
    id: 'racingbulls',
    name: 'Racing Bulls',
    code: 'VRB',
    skill: 0.965,
    livery: { color: '#eef0f6', color2: '#2348e0', helmet: '#e10600' },
  },
  {
    id: 'alpine',
    name: 'Alpine',
    code: 'ALP',
    skill: 0.96,
    livery: { color: '#0a6ad8', color2: '#ff87c8', helmet: '#f4f4f4' },
  },
  {
    id: 'haas',
    name: 'Haas',
    code: 'HAS',
    skill: 0.955,
    livery: { color: '#ececec', color2: '#d6001c', helmet: '#16181c' },
  },
  {
    id: 'audi',
    name: 'Audi',
    code: 'AUD',
    skill: 0.955,
    livery: { color: '#8a8e95', color2: '#ff3d1f', helmet: '#16181c' },
  },
  {
    id: 'astonmartin',
    name: 'Aston Martin',
    code: 'AMR',
    skill: 0.95,
    livery: { color: '#0f6a50', color2: '#c6f000', helmet: '#c6f000' },
  },
  {
    id: 'cadillac',
    name: 'Cadillac',
    code: 'CAD',
    skill: 0.94,
    // Split livery: grey-white left flank, black right flank.
    livery: { color: '#e6e8eb', split: '#141416', color2: '#141416', helmet: '#c9a227' },
  },
];

export const DEFAULT_TEAM = 'mclaren';

export function teamById(id) {
  return TEAMS.find((t) => t.id === id) || TEAMS.find((t) => t.id === DEFAULT_TEAM);
}

// The player's car: the chosen team's colours, raced under the name YOU.
export function playerFor(teamId) {
  const team = teamById(teamId);
  return { name: team.name, code: 'YOU', livery: team.livery, team };
}

// Everyone except the player's team.
export function rivalsFor(teamId) {
  const team = teamById(teamId);
  return TEAMS.filter((t) => t.id !== team.id);
}
