// Everything the game remembers lives in one localStorage entry on this device.
// Reads and writes are wrapped in try/catch: private browsing or blocked storage
// must never break the game, it just won't remember anything.

const KEY = 'lightsout.save.v1';

function defaults() {
  return {
    settings: {
      sound: true,
      camera: 'chase', // 'chase' rotates with the car, 'fixed' keeps north up
      difficulty: 'normal',
      laps: 3,
      autoGas: false,
      steerSide: 'left', // phone: ‹ › under the 'left' or 'right' thumb, GAS and BRAKE under the other
      brakeHints: true, // corner calls and 3-2-1 boards before the big stops
      wear: true, // tyres wear and hits damage the car in races
      team: null, // id of the team you race for; null until picked
      seat: 1, // which of the team's two drivers you replace (0 or 1)
    },
    records: {},
    stats: { races: 0, wins: 0, podiums: 0, championships: 0 },
    season: null, // championship in progress (see season.js)
    weekend: null, // this round's qualifying, until its race is done (see main.js)
  };
}

function load() {
  const def = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return def;
    const d = JSON.parse(raw);
    return {
      settings: { ...def.settings, ...(d.settings || {}) },
      records: d.records || {},
      stats: { ...def.stats, ...(d.stats || {}) },
      season: d.season || null,
      weekend: d.weekend || null,
    };
  } catch (e) {
    return def;
  }
}

let data = load();
let layouts = {};

export const save = {
  get settings() {
    return data.settings;
  },
  get stats() {
    return data.stats;
  },
  get season() {
    return data.season;
  },
  set season(v) {
    data.season = v;
  },
  get weekend() {
    return data.weekend;
  },
  set weekend(v) {
    data.weekend = v;
  },
  // Record for one circuit; created on first use.
  record(trackId) {
    if (!data.records[trackId]) {
      data.records[trackId] = {
        bestLap: null, // seconds
        ghost: null, // { dt, frames: [x, y, angle, ...] } of the best lap
        splits: null, // time into the best lap at each timing point
        bestPos: null,
        bestRace: null,
        races: 0,
        wins: 0,
        layout: layouts[trackId] ?? 1,
      };
    }
    return data.records[trackId];
  },
  peek(trackId) {
    return data.records[trackId] || null;
  },
  // A circuit whose layout changed: its lap records, ghost and best race
  // time no longer compare, so they go (wins and best finishes stay).
  checkLayouts(current) {
    layouts = current;
    let changed = false;
    for (const [id, layout] of Object.entries(current)) {
      const r = data.records[id];
      if (!r || (r.layout ?? 1) === layout) continue;
      Object.assign(r, { bestLap: null, ghost: null, splits: null, bestRace: null, layout });
      changed = true;
    }
    if (changed) this.write();
  },
  write() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      /* storage full or blocked: keep playing without saving */
    }
  },
  resetRecords() {
    data.records = {};
    data.stats = defaults().stats;
    this.write();
  },
};
