import { turtle } from './turtle.js';
import { INTERLAGOS } from './circuits/interlagos.js';

// Circuits. Real ones come from GPS centre lines (see circuits/); the made-up
// ones are built from driving instructions with turtle().
//
// Made-up layouts: Each is a list of control points (in
// "units"; scale turns them into pixels) that a smooth spline passes through,
// driven clockwise or anticlockwise in list order. The first point is the
// start/finish line, so it should sit on a straight.

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
  sunset: {
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
    tint: 'rgba(255,120,40,0.10)',
    thumb: '#e2602a',
  },
  harbour: {
    groundKind: 'water',
    groundColor: '#1d4d70',
    runoffKind: 'grass',
    runoff: '#4f8f47',
    runoff2: '#57984e',
    asphalt: '#383b43',
    asphaltEdge: '#2e3138',
    edge: '#efefef',
    kerbA: '#1f6fe0',
    kerbB: '#f4f4f4',
    barrierA: '#f1f1f1',
    barrierB: '#1f6fe0',
    dust: [120, 140, 90],
    decor: 'boats',
    boatDeck: ['#c9a777', '#3a7bd5', '#e04b3c', '#2c3e50'],
    tint: 'rgba(60,150,255,0.06)',
    thumb: '#2f8be0',
  },
  desert: {
    groundKind: 'dunes',
    groundColor: '#b88a4f',
    runoffKind: 'sand',
    runoff: '#d4ab6c',
    runoff2: '#d9b274',
    asphalt: '#45464c',
    asphaltEdge: '#3a3b40',
    edge: '#f2f2f2',
    kerbA: '#e8a317',
    kerbB: '#f4f4f4',
    barrierA: '#f1f1f1',
    barrierB: '#e8a317',
    dust: [210, 170, 110],
    decor: 'cacti',
    rock: ['#8a6a48', '#9b7a55', '#7a5c3e'],
    tint: 'rgba(255,170,60,0.08)',
    thumb: '#e8a317',
  },
};

export const TRACKS = [
  {
    id: 'interlagos',
    name: 'Interlagos',
    real: true,
    country: 'Brazil',
    blurb: 'Autódromo José Carlos Pace, São Paulo. Anticlockwise: the Senna S, Descida do Lago, Bico de Pato and the long climb to the line.',
    theme: THEMES.saopaulo,
    scale: 1,
    points: INTERLAGOS,
  },
  {
    id: 'sunset',
    name: 'Sunset Speedway',
    blurb: 'Fast and flowing. A long sweeper, quick esses and a huge stop at the end of the back straight.',
    theme: THEMES.sunset,
    scale: 1,
    points: turtle([
      ['S', 1500],
      ['R', 75, 260], // T1: hard braking from top speed
      ['S', 350],
      ['L', 30, 400], ['R', 75, 380], ['L', 40, 380], // esses
      ['S', 300],
      ['R', 100, 200],
      ['S', 400],
      ['L', 120, 170], // tight left
      ['S', 350],
      ['R', 75, 520], // long sweeper
      ['A', 700],
      ['R', 45, 600],
      ['S', 400],
      ['R', 25, 300], ['L', 50, 260], ['R', 25, 300], // kink
      ['S', 300],
      ['R', 90, 300],
      ['A', 1400], // back straight
      ['R', 90, 160], // the big stop
      ['S', 300],
      ['L', 50, 260], ['R', 50, 260], // flick onto the main straight
      ['S', 800],
    ]),
  },
  {
    id: 'harbour',
    name: 'Harbour Hairpins',
    blurb: 'Tight and twisty on the waterfront. A chicane, two hairpins and nowhere to hide.',
    theme: THEMES.harbour,
    scale: 1,
    points: turtle([
      ['S', 900],
      ['L', 25, 180], ['R', 50, 180], ['L', 25, 180], // chicane
      ['A', 400],
      ['L', 90, 150], ['S', 160], ['L', 90, 150], // hairpin 1
      ['S', 300],
      ['L', 20, 500], ['R', 20, 500],
      ['S', 250],
      ['R', 90, 200],
      ['A', 450],
      ['L', 90, 140], ['S', 160], ['L', 90, 140], // hairpin 2
      ['S', 350],
      ['R', 40, 260], ['L', 80, 260], ['R', 40, 260], // waterfront esses
      ['S', 350],
      ['R', 90, 200],
      ['S', 300],
      ['L', 30, 400], ['R', 30, 400],
      ['S', 400],
      ['L', 90, 200], ['S', 200], ['L', 90, 200], // hairpin 3
      ['S', 900],
    ]),
  },
  {
    id: 'desert',
    name: 'Dune Drag',
    blurb: 'Enormous straights, slipstream battles and one hairpin in the middle of nowhere.',
    theme: THEMES.desert,
    scale: 1,
    points: turtle([
      ['S', 1900],
      ['R', 70, 420],
      ['S', 300],
      ['R', 50, 700],
      ['A', 1800],
      ['R', 25, 200], ['L', 50, 200], ['R', 25, 200], // chicane
      ['S', 700],
      ['R', 90, 170], ['S', 100], ['R', 90, 170], // hairpin
      ['S', 1300],
      ['L', 35, 600], ['R', 35, 600], // flat-out kink
      ['S', 300],
      ['L', 60, 350],
      ['A', 600],
      ['R', 120, 380],
      ['S', 1500],
    ]),
  },
];
