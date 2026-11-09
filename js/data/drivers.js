// Phase 1 grid: placeholder rivals. Phase 2 swaps these for the real teams
// and drivers, so everything else reads drivers through this one list.

export const PLAYER = {
  name: 'You',
  code: 'YOU',
  livery: { color: '#e8002d', color2: '#f4f4f4', helmet: '#ffd23f' },
};

export const RIVALS = [
  { name: 'Axel Grip', code: 'GRP', skill: 1.0, livery: { color: '#00c2b2', color2: '#16181d', helmet: '#e6e6e6' } },
  { name: 'Lola Apex', code: 'APX', skill: 0.98, livery: { color: '#ff8000', color2: '#1d4ed8', helmet: '#ffffff' } },
  { name: 'Rex Revington', code: 'REV', skill: 0.99, livery: { color: '#1e2a78', color2: '#e11d48', helmet: '#facc15' } },
  { name: 'Dash Kerbside', code: 'KRB', skill: 0.96, livery: { color: '#0f7a4b', color2: '#f4f4f4', helmet: '#16a34a' } },
  { name: 'Penny Pitlane', code: 'PIT', skill: 0.95, livery: { color: '#ffd400', color2: '#18181b', helmet: '#18181b' } },
  { name: 'Max Downforce', code: 'DWN', skill: 0.97, livery: { color: '#7c3aed', color2: '#f4f4f4', helmet: '#f472b6' } },
  { name: 'Gus Slipstream', code: 'SLP', skill: 0.94, livery: { color: '#f2f2f2', color2: '#0284c7', helmet: '#0284c7' } },
];
