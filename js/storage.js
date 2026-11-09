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
      phoneControls: 'tilt', // 'tilt': turn the phone to steer, two pedals; 'slider': steering strip and pedal slider
      tiltSens: 'mid', // tilt for full lock: 'low' 26°, 'mid' 18°, 'high' 12°
      tiltHelp: true, // tilt: the car lines itself up with the road on straights while the phone is near level
      touchSteer: 'float', // sliders: 'float' centre where the thumb lands, 'fixed' centre of the strip
      brakeHints: true, // red braking zones on the racing line and 3-2-1 boards
      team: null, // id of the team you race for; null until picked
      seat: 1, // which of the team's two drivers you replace (0 or 1)
    },
    records: {},
    stats: { races: 0, wins: 0, podiums: 0, championships: 0 },
    season: null, // championship in progress (see season.js)
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
    };
  } catch (e) {
    return def;
  }
}

let data = load();

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
      };
    }
    return data.records[trackId];
  },
  peek(trackId) {
    return data.records[trackId] || null;
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
