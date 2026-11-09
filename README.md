# Lights Out

Top-down arcade Formula racing that runs in the browser and installs to a phone's home screen. Plain HTML, CSS and JavaScript: no build step, so it runs on GitHub Pages as-is.

## What's in it

- **The 2026 grid:** 22 drivers in 11 teams, in their 2026 colours with real driver codes (NOR, PIA, VER, LEC, HAM…). Pick a team and whose seat you take: you race as **YOU**, the other driver is your teammate, and the other 20 are rivals. On the timing tower and the phone HUD your teammate is marked in yellow.
- **25 real circuits**, built from GPS centre lines: the 2026 calendar plus Malaysia (Sepang). Street circuits have walls close to the track, Suzuka has its bridge, and each circuit has its own look (night races in Singapore, Las Vegas and Jeddah, dunes at Zandvoort, forest at Spa and Monza, water round Montréal).
- **Season:** the whole calendar as a championship with a Drivers' and a Constructors' table, F1 points for the top ten (25-18-15-12-10-8-6-4-2-1). Choose laps per race and rival difficulty; standings are kept on the device until the season ends.
- A single **race** on any circuit, or a solo **time trial** against your own ghost.
- Arcade handling: drifting with boosts, slipstream, start-light launches, bumping, skid marks, sparks and synthesised engine sounds.
- Lap records, ghosts, best finishes and race stats are saved on the device (browser `localStorage`).
- Works offline once it has been opened online.

### Controls

| | Keyboard | Phone | Controller |
|---|---|---|---|
| Gas | ↑ or W | right thumb on GAS | RT or A |
| Brake | ↓, S or Space | left thumb on BRAKE | LT, B or X |
| Steer | ← → or A D | turn the phone like a steering wheel | left stick or d-pad |
| Pause | Esc or P | ❚❚ top right | Start |

On a phone you steer by tilting: hold it in both hands and turn it like a steering wheel, upright or sideways. Straight ahead is however you hold it when the lights go out (and when you resume after a pause). Let go of both buttons to coast. The bars around the speed readout show how far you're steering (yellow, above) and how much brake (red, left) and gas (green, right) you're using. On iPhone the game asks for motion access on the first race; if it's refused, or the phone has no motion sensor, it switches to the sliders.

Settings → Phone controls → Sliders brings back the touch layout: a steering strip under the left thumb and one pedal under the right (slide up for gas, down for brake). Tilt sensitivity sets how far you turn the phone for full lock (about 26°, 18° or 12°); it reads the turn the same whether you hold the phone upright or tilted back. Straight-line help (on by default) lines the car up with the road on straights while you hold the phone close to level, so small wobbles of your hands don't make it weave; tilt a little more and it fades out, and it never acts in real corners. Tilt only ever applies on a touch device: on a computer, steering is the keyboard or a controller as before.

- **Drift:** while turning at speed, press and hold brake. The car slides round the corner without losing much speed. Hold it to fill the meter, then let go of brake for a boost: blue, then orange, then purple. On a phone, slide your right thumb from GAS down to BRAKE and back up.
- **Launch:** wait for the five red lights to go out, then hit the gas. React within 0.3 s for a perfect start. Hold the gas too early and you spin the wheels.
- **Slipstream:** tuck in behind a car on a straight for extra top speed.
- **Braking hints:** red on the racing line shows where to brake, and 3-2-1 boards stand before the big stops (board 3 is the braking point). When you're flat out towards a slow corner, a pace note under the timer warns you early ("HAIRPIN RIGHT", timed from your actual speed, so a boost brings it sooner) and turns into a flashing BRAKE! with a beep when it's time. Can be turned off in Settings.
- **Barriers:** a light scrape costs little; using a wall as a brake costs a lot of speed and makes the engine stutter for a moment, so it's slower than braking.
- **Leading:** once you're out in front, the cars behind chase: the further you pull away, the harder they push, and they fire boosts out of the corners like your drifts do. A lead has to be kept, not just built.

Settings: sound, camera (Chase rotates with the car; Fixed keeps north up), braking hints, phone controls (tilt or sliders), tilt sensitivity, slider steering, auto-gas for phones, and erasing saved records.

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
| `js/ai.js` | Computer drivers: racing line, braking points, overtaking, recovery |
| `js/track.js` | Circuit geometry, racing line, AI speed targets, kerbs, scenery, minimap |
| `js/data/tracks.js` | The circuits, their looks and the season calendar |
| `js/data/circuits/` | Each real circuit as game coordinates |
| `js/season.js` | Championship: points, standings, rounds |
| `js/data/teams.js` | The 11 teams and 22 drivers: names, codes, colours, AI pace |
| `js/hud.js` | On-screen race information |
| `js/ui.js` | Menu screens |
| `js/input.js` | Keyboard, touch, tilt and controller input |
| `js/audio.js` | Synthesised engine, tyres, impacts and beeps |
| `js/storage.js` | Everything saved on the device |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home-screen app and offline support |

Developer extras:

- `tools/track-preview.html` draws every circuit with its racing line coloured by AI target speed, plus braking zones and boards (`?ids=monaco,spa` for just a few).
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

Tuning knobs live at the top of their files: `WALL` in `js/car.js` (what barrier hits cost), `DIFFICULTY` (AI pace and how hard they chase a leader), `CHASE_BOOST`, `PACE_NOTE` and `STEER_HELP` (tilt straight-line help) in `js/race.js`.

## Roadmap

1. ~~Arcade racer, one player, saved on the device~~
2. ~~Real teams and drivers to pick from~~
3. ~~Real circuits and a season mode~~
4. Pit stops as a mini-game, tyre strategy, weather (and a damage gauge that sends you to the pits)
5. Team management: driver development, junior teams, car development
6. Online: ghost races between two players, then live racing in the same room
