import { INTERLAGOS } from './circuits/interlagos.js';
import { MONACO } from './circuits/monaco.js';
import { ZANDVOORT } from './circuits/zandvoort.js';
import { SUZUKA } from './circuits/suzuka.js';
import { LAS_VEGAS } from './circuits/lasvegas.js';
import { SILVERSTONE } from './circuits/silverstone.js';
import { SPA } from './circuits/spa.js';
import { BAKU } from './circuits/baku.js';
import { MONZA } from './circuits/monza.js';
import { SEPANG } from './circuits/sepang.js';
import { MARINA_BAY } from './circuits/singapore.js';
import { MIAMI } from './circuits/miami.js';
import { ALBERT_PARK } from './circuits/melbourne.js';
import { SHANGHAI } from './circuits/shanghai.js';
import { BAHRAIN } from './circuits/bahrain.js';
import { JEDDAH } from './circuits/jeddah.js';
import { MONTREAL } from './circuits/montreal.js';
import { BARCELONA } from './circuits/barcelona.js';
import { RED_BULL_RING } from './circuits/austria.js';
import { HUNGARORING } from './circuits/hungary.js';
import { COTA } from './circuits/austin.js';
import { MEXICO_CITY } from './circuits/mexico.js';
import { LUSAIL } from './circuits/qatar.js';
import { YAS_MARINA } from './circuits/abudhabi.js';
import { MADRING } from './circuits/madrid.js';

// Circuits and their looks. Real circuits come from GPS centre lines
// (tools/convert-circuit.mjs writes the files in circuits/). Street circuits
// get a narrow run-off, so the walls are close.

const BASE = {
  groundKind: 'ground',
  groundColor: '#2d4a26',
  runoffKind: 'grass',
  runoff: '#4a8639',
  runoff2: '#518f40',
  asphalt: '#3a3d45',
  asphaltEdge: '#30333a',
  edge: '#efefef',
  kerbA: '#d8262c',
  kerbB: '#f4f4f4',
  barrierA: '#f1f1f1',
  barrierB: '#d42b2b',
  dust: [150, 128, 80],
  decor: 'trees',
  tree: ['#2c6428', '#3a7a31', '#25591f', '#46853a'],
  building: ['#9a9a96', '#b7b2a6', '#c08a62', '#7d8288', '#d3cdbf', '#a2675a'],
  boatDeck: ['#c9a777', '#3a7bd5', '#e04b3c', '#2c3e50'],
  rock: ['#8a6a48', '#9b7a55', '#7a5c3e'],
  tint: 'rgba(0,0,0,0)',
  thumb: '#43a047',
  density: 1,
};
const theme = (o) => ({ ...BASE, ...o });

const NIGHT = {
  groundKind: 'night',
  groundColor: '#161b27',
  runoffKind: 'paved',
  runoff: '#2b303b',
  runoff2: '#30353f',
  asphalt: '#2a2d34',
  asphaltEdge: '#22252b',
  edge: '#f4f4f4',
  barrierA: '#e9ecf2',
  barrierB: '#2f6bff',
  dust: [90, 90, 100],
  decor: 'night',
  tree: ['#1c3320', '#22402a'],
  building: ['#1d2433', '#232b3c', '#1a1f2c', '#283044'],
  tint: 'rgba(30,40,110,0.10)',
  thumb: '#6e8bff',
};

const STREET = {
  groundKind: 'concrete',
  groundColor: '#76787c',
  runoffKind: 'paved',
  runoff: '#8b8d91',
  runoff2: '#929498',
  asphalt: '#33363c',
  asphaltEdge: '#2b2e33',
  dust: [170, 170, 170],
  decor: 'street',
  density: 1.4,
  thumb: '#9aa0a6',
};

export const THEMES = {
  saopaulo: {
    groundKind: 'ground',
    groundColor: '#2e4529',
    runoffKind: 'grass',
    runoff: '#3e8636',
    runoff2: '#45903d',
    asphalt: '#34373e',
    asphaltEdge: '#2b2e34',
    edge: '#efefef',
    kerbA: '#d8262c',
    kerbB: '#f4f4f4',
    barrierA: '#f6d31c',
    barrierB: '#169447',
    dust: [140, 120, 80],
    decor: 'city',
    tree: ['#2a6127', '#36762f', '#23561f', '#418537'],
    building: ['#9a9a96', '#b7b2a6', '#c08a62', '#7d8288', '#d3cdbf', '#a2675a'],
    tint: 'rgba(255,190,110,0.07)',
    thumb: '#169447',
  },
  park: theme({}),
  britain: theme({ tint: 'rgba(150,170,200,0.06)', thumb: '#2e7d32' }),
  forest: theme({
    groundColor: '#1f3a1d',
    runoff: '#3f7f35',
    runoff2: '#468a3b',
    tree: ['#1e4f1c', '#2a6125', '#1a451a', '#336d2c'],
    density: 1.9,
    thumb: '#2e7d32',
  }),
  alpine: theme({
    groundColor: '#3b6b2c',
    runoff: '#53a23f',
    runoff2: '#5aab46',
    tree: ['#23502a', '#2d6234', '#1d4524'],
    density: 1.4,
    tint: 'rgba(120,180,255,0.05)',
    thumb: '#66bb6a',
  }),
  dunes: theme({
    groundKind: 'dunes',
    groundColor: '#cdb98b',
    runoff: '#5b9a45',
    runoff2: '#62a24b',
    tree: ['#5a7f3a', '#6d8f45', '#4c7032'],
    barrierB: '#ff7a00',
    dust: [200, 180, 130],
    density: 0.7,
    thumb: '#ff7a00',
  }),
  dry: theme({
    groundColor: '#8e7a4e',
    runoff: '#7a9a3e',
    runoff2: '#84a346',
    tree: ['#55702f', '#62803a', '#4a6328'],
    dust: [190, 160, 110],
    thumb: '#c0a050',
  }),
  hungary: theme({ groundColor: '#5b6e34', runoff: '#6c9a3d', runoff2: '#74a244', barrierB: '#2e7d32', thumb: '#7cb342' }),
  tropical: theme({ groundColor: '#244a20', runoff: '#3f8f3a', runoff2: '#46983f', decor: 'palms', tree: ['#2f7d32', '#3c9440', '#27692b'], thumb: '#26a69a' }),
  miami: theme({ ...STREET, decor: 'palms', tree: ['#2f7d32', '#3c9440'], barrierB: '#00b2a9', density: 1, thumb: '#00b2a9' }),
  street: theme({ ...STREET }),
  monaco: theme({ ...STREET, building: ['#e8d9b8', '#d9b48f', '#efe6d2', '#c98f6b', '#f2efe6'], thumb: '#d42b2b' }),
  baku: theme({ ...STREET, building: ['#c9b38a', '#d8c7a2', '#b89b6c', '#e3d6b8'], barrierB: '#00b5e2', thumb: '#00b5e2' }),
  madrid: theme({ ...STREET, building: ['#e8d9b8', '#c98f6b', '#b56a4c', '#efe6d2'], barrierB: '#c60b1e', thumb: '#ffc400' }),
  night: theme({ ...NIGHT }),
  vegas: theme({ ...NIGHT, barrierB: '#ff2fa0', windows: 'rgba(255,120,220,0.85)', tint: 'rgba(90,20,120,0.10)', thumb: '#ff2fa0' }),
  jeddah: theme({ ...NIGHT, barrierB: '#1aa260', thumb: '#1aa260' }),
  island: theme({ groundKind: 'water', groundColor: '#24557a', decor: 'boats', barrierB: '#d42b2b', thumb: '#2f8be0' }),
  mexico: theme({ decor: 'city', barrierB: '#006847', thumb: '#006847' }),
  usa: theme({ barrierB: '#1f4fd8', thumb: '#1f4fd8' }),
  china: theme({ barrierB: '#d42b2b', thumb: '#e53935' }),
  bahrain: theme({ ...THEME_DESERT(), barrierB: '#d42b2b', thumb: '#e53935' }),
  qatar: theme({ ...THEME_DESERT(), barrierB: '#8a1538', thumb: '#8a1538' }),
  yas: theme({ ...THEME_DESERT(), groundColor: '#9a7a4b', tint: 'rgba(255,120,60,0.10)', barrierB: '#00843d', thumb: '#ff8a3d' }),
};

function THEME_DESERT() {
  return {
    groundKind: 'dunes',
    groundColor: '#b88a4f',
    runoffKind: 'sand',
    runoff: '#d4ab6c',
    runoff2: '#d9b274',
    asphalt: '#45464c',
    asphaltEdge: '#3a3b40',
    kerbA: '#d8262c',
    decor: 'cacti',
    dust: [210, 170, 110],
  };
}

// Real circuits. lengthKm: real lap length. `layout` goes up when a circuit's
// shape changes enough that old lap records no longer compare (2: chicanes
// rebuilt at game scale, see Track.shapeChicanes).
const REAL = [
  ['interlagos', 'Interlagos', 'São Paulo Grand Prix', 'Brazil', 4.31, 'saopaulo', INTERLAGOS],
  ['monaco', 'Monaco', 'Monaco Grand Prix', 'Monaco', 3.34, 'monaco', MONACO, { runoff: 30, chicanes: [{ at: 0.343, kind: 'slow', rebuild: false }, { at: 0.539, kind: 'medium', rebuild: false }] }],
  ['zandvoort', 'Zandvoort', 'Dutch Grand Prix', 'Netherlands', 4.26, 'dunes', ZANDVOORT],
  ['suzuka', 'Suzuka', 'Japanese Grand Prix', 'Japan', 5.81, 'park', SUZUKA, { chicanes: [{ at: 0.887, kind: 'slow' }] }],
  ['lasvegas', 'Las Vegas', 'Las Vegas Grand Prix', 'United States', 6.2, 'vegas', LAS_VEGAS, { runoff: 42, chicanes: [{ at: 0.31, kind: 'medium', rebuild: false }] }],
  ['silverstone', 'Silverstone', 'British Grand Prix', 'Great Britain', 5.89, 'britain', SILVERSTONE, { chicanes: [{ at: 0.459, kind: 'slow', rebuild: false }] }],
  ['spa', 'Spa-Francorchamps', 'Belgian Grand Prix', 'Belgium', 7.0, 'forest', SPA, { chicanes: [{ at: 0.947, kind: 'slow' }] }],
  ['baku', 'Baku', 'Azerbaijan Grand Prix', 'Azerbaijan', 6.0, 'baku', BAKU, { runoff: 42, chicanes: [{ at: 0.325, kind: 'medium', rebuild: false }, { at: 0.445, kind: 'medium', rebuild: false, turns: 3 }] }],
  ['monza', 'Monza', 'Italian Grand Prix', 'Italy', 5.79, 'forest', MONZA, {
    chicanes: [{ at: 0.107, kind: 'slow' }, { at: 0.315, kind: 'slow' }, { at: 0.638, kind: 'medium' }],
  }],
  ['sepang', 'Sepang', 'Malaysian Grand Prix', 'Malaysia', 5.54, 'tropical', SEPANG],
  ['singapore', 'Marina Bay', 'Singapore Grand Prix', 'Singapore', 4.94, 'night', MARINA_BAY, { runoff: 42, chicanes: [{ at: 0.54, kind: 'medium', rebuild: false }, { at: 0.855, kind: 'medium', rebuild: false }] }],
  ['miami', 'Miami', 'Miami Grand Prix', 'United States', 5.41, 'miami', MIAMI, { runoff: 46 }],
  ['melbourne', 'Albert Park', 'Australian Grand Prix', 'Australia', 5.28, 'park', ALBERT_PARK, { runoff: 54, chicanes: [{ at: 0.064, kind: 'medium' }, { at: 0.352, kind: 'fast' }] }],
  ['shanghai', 'Shanghai', 'Chinese Grand Prix', 'China', 5.45, 'china', SHANGHAI],
  ['bahrain', 'Bahrain', 'Bahrain Grand Prix', 'Bahrain', 5.41, 'bahrain', BAHRAIN],
  ['jeddah', 'Jeddah', 'Saudi Arabian Grand Prix', 'Saudi Arabia', 6.17, 'jeddah', JEDDAH, { runoff: 42, chicanes: [{ at: 0.071, kind: 'slow' }] }],
  ['montreal', 'Montréal', 'Canadian Grand Prix', 'Canada', 4.36, 'island', MONTREAL, { runoff: 50, chicanes: [{ at: 0.225, kind: 'medium' }, { at: 0.357, kind: 'medium' }, { at: 0.542, kind: 'medium' }, { at: 0.937, kind: 'slow' }] }],
  ['barcelona', 'Barcelona', 'Barcelona-Catalunya Grand Prix', 'Spain', 4.66, 'dry', BARCELONA, { chicanes: [{ at: 0.155, kind: 'medium', rebuild: false }] }],
  ['austria', 'Red Bull Ring', 'Austrian Grand Prix', 'Austria', 4.32, 'alpine', RED_BULL_RING],
  ['hungary', 'Hungaroring', 'Hungarian Grand Prix', 'Hungary', 4.38, 'hungary', HUNGARORING, { chicanes: [{ at: 0.48, kind: 'slow' }] }],
  ['austin', 'Austin', 'United States Grand Prix', 'United States', 5.51, 'usa', COTA],
  ['mexico', 'Mexico City', 'Mexico City Grand Prix', 'Mexico', 4.3, 'mexico', MEXICO_CITY, { chicanes: [{ at: 0.288, kind: 'slow', rebuild: false, turns: 3 }, { at: 0.471, kind: 'medium', rebuild: false }] }],
  ['qatar', 'Lusail', 'Qatar Grand Prix', 'Qatar', 5.42, 'qatar', LUSAIL],
  ['abudhabi', 'Yas Marina', 'Abu Dhabi Grand Prix', 'Abu Dhabi', 5.28, 'yas', YAS_MARINA, { chicanes: [{ at: 0.478, kind: 'slow' }] }],
  ['madrid', 'Madring', 'Spanish Grand Prix', 'Spain', 5.42, 'madrid', MADRING, { runoff: 34, chicanes: [{ at: 0.036, kind: 'medium', rebuild: false }, { at: 0.308, kind: 'medium', rebuild: false }] }],
];

export const ALL_REAL = REAL.map(([id, name, gp, country, lengthKm, themeId, points, extra]) => ({
  id,
  name,
  gp,
  country,
  lengthKm,
  real: true,
  theme: THEMES[themeId],
  scale: 1,
  points,
  layout: extra?.chicanes ? 2 : 1,
  ...(extra || {}),
}));

// The 2026 calendar, plus Malaysia (Sepang), in season order.
export const CALENDAR = [
  'melbourne', 'shanghai', 'suzuka', 'bahrain', 'jeddah', 'miami', 'montreal', 'monaco', 'barcelona',
  'austria', 'silverstone', 'spa', 'hungary', 'zandvoort', 'monza', 'madrid', 'baku', 'singapore',
  'sepang', 'austin', 'mexico', 'interlagos', 'lasvegas', 'qatar', 'abudhabi',
];

export const TRACKS = CALENDAR.map((id) => ALL_REAL.find((t) => t.id === id));
