# Lights Out

Top-down arcade Formula racing that runs in the browser and installs to a phone's home screen. Plain HTML, CSS and JavaScript: no build step, so it runs on GitHub Pages as-is.

## What's in it

- **The 2026 grid:** 22 drivers in 11 teams, in their 2026 colours with real driver codes (NOR, PIA, VER, LEC, HAM…). Pick a team and whose seat you take: you race as **YOU**, the other driver is your teammate, and the other 20 are rivals. On the timing tower and the phone HUD your teammate is marked in yellow.
- **25 real circuits**, built from GPS centre lines: the 2026 calendar plus Malaysia (Sepang). Street circuits have walls close to the track, Suzuka has its bridge, and each circuit has its own look (night races in Singapore, Las Vegas and Jeddah, dunes at Zandvoort, forest at Spa and Monza, water round Montréal).
- **Season:** the whole calendar as a championship with a Drivers' and a Constructors' table, F1 points for the top ten (25-18-15-12-10-8-6-4-2-1). Choose laps per race and rival difficulty; standings are kept on the device until the season ends.
- A single **race** on any circuit, or a solo **time trial** against your own ghost.
- Arcade handling: drifting, a strong slipstream, start-light launches, bumping, tyre smoke, dust off the road, skid marks, sparks and synthesised engine sounds.
- Lap records, ghosts, best finishes and race stats are saved on the device (browser `localStorage`).
- Works offline once it has been opened online.

### Controls

| | Keyboard | Phone | Controller |
|---|---|---|---|
| Gas | ↑ or W | GAS (top button) | RT or A |
| Brake | ↓, S or Space | BRAKE (bottom button) | LT, B or X |
| Steer | ← → or A D | ‹ and › | left stick or d-pad |
| Pause | Esc or P | ❚❚ in the top corner | Start |

On a phone the game is played sideways; held upright, it asks you to turn the phone (and pauses a race). An installed home-screen app on Android opens in landscape by itself. The controls are buttons, like the arrow keys on a computer: ‹ and › under one thumb, GAS above BRAKE under the other. A thumb can rock from one button to its neighbour without lifting; the gap between GAS and BRAKE, or lifting off, is coasting. Each half of the screen belongs to one pair of buttons, so a thumb doesn't need to land exactly. Settings → Phone layout puts steering under the left thumb (default) or the right.

With the phone sideways the middle of the screen stays clear for the road: position, lap times, gaps and messages sit in the column above the steering controls, the speed sits right next to GAS, the map sits next to the pause button above the pedals, and only the start lights appear in the middle.

- **Drift:** while turning at speed, press and hold brake. The car slides round the corner on a much tighter line without losing much speed (steer into it to turn tighter still), with tyre smoke and speed lines; let go of brake to grip again. A DRIFTING! tag under your car fills up the longer you hold it: white, blue, orange, purple. On a phone, rock your pedal thumb from GAS down to BRAKE and back up.
- **Launch:** wait for the five red lights to go out, then hit the gas. React within 0.3 s for a perfect start and a launch boost (within 0.5 s, a smaller one). Hold the gas too early and you spin the wheels.
- **Slipstream:** on a straight at speed, up to about eight car lengths behind another car and lined up with it, you're in its tow after a moment: extra pull and up to 18% more top speed, shown by a SLIPSTREAM! tag under your car, light-blue speed lines and air streaming past. Pull out and pass. Not in corners or chicanes.
- **Contact:** rubbing is fine. Run into someone's gearbox and you take the knock, not them; the computer cars lift off rather than push you along.
- **Corners:** long bends are flat out; quicker ones need a lift off the gas (coasting scrubs off speed); hairpins and hard corners need proper braking; chicanes need a big stop. The yellow-and-black sausage kerbs in a chicane are solid, so it can't be cut.
- **Corner calls:** a card under the timer calls the next corner you need to slow for: LEFT/RIGHT (a lift), HARD LEFT/RIGHT (brake), HAIRPIN or CHICANE, with a bar running down to where to slow; at the braking point it flashes BRAKE! with a beep.
- **Braking boards:** 3-2-1 boards on both sides of the road count down to every big stop; brake at the red **1** (that's for the speed you'd arrive with, with a little in hand). Calls and boards can be turned off in Settings → Corner hints.
- **Barriers:** a light scrape costs little; using a wall as a brake costs a lot of speed and makes the engine stutter for a moment, so it's slower than braking.
- **Leading:** once you're out in front, the cars behind chase: the further you pull away, the harder they push, and up close they use your slipstream. A lead has to be kept, not just built.

Settings: sound, camera (Chase rotates with the car; Fixed keeps north up), corner hints (calls and boards), phone layout (steer left or right), auto-gas for phones, and erasing saved records.

## Put it on GitHub Pages

1. Create a new repository, for example `lights-out`.
2. Upload or push everything in this folder to the `main` branch.
3. In the repository go to **Settings → Pages**, set *Source* to **Deploy from a branch**, pick `main` and `/ (root)`, and save.
4. After a minute it's live at `https://<your-username>.github.io/lights-out/`. If your website already uses a custom domain on GitHub Pages, it also appears at `https://<your-domain>/lights-out/`.
5. Link to it from your website: `<a href="/lights-out/">Lights Out</a>`.

### Add it to a phone's home screen

- **iPhone:** open the link in Safari → Share → **Add to Home Screen**.
- **Android:** open the link in Chrome → menu → **Add to Home screen** (or **Install app**).

It opens full-screen with its own icon. Records stay on that phone.

### Publishing updates

Push to `main` and GitHub Pages redeploys. The game loads the newest files whenever it's opened online. For each release, bump the version in three places together: `CACHE` in `sw.js`, `BUILD` in `js/main.js` and `--build` in `css/style.css`. If a phone ever ends up with files from two versions, the game notices and reloads itself once. When you add or rename files, also list them in `sw.js` so the offline copy stays complete.

## Run it locally

The game uses JavaScript modules, so it needs a local web server (opening `index.html` directly won't work):

```bash
python3 -m http.server 8642
```

Then open http://localhost:8642.

## How the code is laid out

| File | What it does |
|---|---|
| `index.html` | Page, touch buttons, home-screen app tags |
| `css/style.css` | Menus, buttons, touch controls |
| `js/main.js` | Boot, game loop, screen flow, saving results |
| `js/race.js` | A session: start lights, laps, positions, collisions, slipstream, ghosts, results |
| `js/car.js` | Car physics (grip, drift, boost, barriers) and the car drawing |
| `js/ai.js` | Computer drivers: following the racing line, braking points, overtaking, recovery |
| `js/track.js` | Circuit geometry, chicanes, racing line and corner speeds, braking boards, kerbs, scenery, minimap |
| `js/data/tracks.js` | The circuits, their looks and the season calendar |
| `js/data/circuits/` | Each real circuit as game coordinates |
| `js/season.js` | Championship: points, standings, rounds |
| `js/data/teams.js` | The 11 teams and 22 drivers: names, codes, colours, AI pace |
| `js/hud.js` | On-screen race information |
| `js/ui.js` | Menu screens |
| `js/input.js` | Keyboard, touch and controller input |
| `js/audio.js` | Synthesised engine, tyres, impacts and beeps |
| `js/storage.js` | Everything saved on the device |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home-screen app and offline support |

Developer extras:

- `tools/track-preview.html` draws every circuit with its racing line coloured by the speed the car can carry, the stops that get braking boards, and every corner numbered with its slowest speed (`?ids=monaco,spa` for just a few).
- `tools/chicanes.html` shows a close-up of every chicane as drawn in the game.
- `tools/snapshot.html` sets up moments in a race (a corner call, BRAKE!, slipstream, a drift, off the road, hard braking) and draws one frame of each with the game's own code (`?w=740&h=360` for a phone held sideways, `?zoom=2` to look closer, `?calls` for every corner call card).
- `tools/convert-circuit.mjs` turns a GeoJSON centre line into a circuit file (see below).
- Add `?nopause` to the URL to stop the game pausing when the tab is hidden (for automated testing).
- `window.lightsOut` in the browser console gives access to the game state.

## Adding a real circuit

The circuits come from the [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) GeoJSON centre lines (MIT licence).

```bash
node tools/convert-circuit.mjs path/to/xx-1234.geojson js/data/circuits/name.js NAME '{}'
```

Options (JSON): `reverse` if the file runs the wrong way round, `startShift` (metres) to move the start line, `scale` (px per metre), `rMinPx` (tightest corner, default 144 px). The tool converts GPS to metres, puts a point every 20 m, smooths, rounds off very tight corners and scales so laps last roughly 30–40 seconds. Then add a line to `REAL` and the id to `CALENDAR` in `js/data/tracks.js`, and list the file in `sw.js`.

The game handles the rest: where two parts of a circuit run closer than the (extra-wide) road allows, it pushes them apart and puts a shared barrier halfway between them; while you drive past, the road beside yours is dimmed. Where a circuit crosses itself (Suzuka) it builds a bridge, with the later part of the lap on top.

The road is drawn about three times wider than a real one (so cars can race side by side on a phone), which flattens real chicanes into wiggles you could drive straight through. So each circuit lists its chicanes in `js/data/tracks.js` (`chicanes: [{ at: lap fraction, kind: 'slow' | 'medium' | 'fast' }]`): the game rebuilds each one as a sharp Z at game scale and puts sausage kerbs on the inside of both turns (`rebuild: false` keeps the real shape and only adds kerbs). Circuits whose chicanes were rebuilt have `layout: 2`, which clears lap records set on the old shape.

The racing line is an elastic band pulled as straight as the road allows (it uses the inside of tight corners like a player can). The AI drives it, and the braking boards come from the speeds along it, so they match what the car can really do.

Tuning knobs live at the top of their files: `WALL`, `LIFT`, `SLIP_TOP`/`SLIP_ACC` and `DRIFT` in `js/car.js` (what barrier hits cost; how much a lift off the gas slows you; what a full slipstream gives; how drifts start, turn and end), `LINE`, `CHICANE`, `HINTS` and `CALLS` in `js/track.js` (racing line clearances, chicane shapes and kerbs, braking boards, corner calls), `AI_KERB` in `js/ai.js`, `DIFFICULTY` (AI pace and how hard they chase a leader) `SLIPSTREAM` (tow range, only on straights at speed) and `REAR_END` (who takes the knock in a nose-to-tail hit) in `js/race.js`.

## Roadmap

1. ~~Arcade racer, one player, saved on the device~~
2. ~~Real teams and drivers to pick from~~
3. ~~Real circuits and a season mode~~
4. Pit stops as a mini-game, tyre strategy, weather (and a damage gauge that sends you to the pits)
5. Team management: driver development, junior teams, car development
6. Online: ghost races between two players, then live racing in the same room
