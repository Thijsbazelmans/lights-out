# Lights Out

Top-down arcade Formula racing that runs in the browser and installs to a phone's home screen. Plain HTML, CSS and JavaScript: no build step, so it runs on GitHub Pages as-is.

## What's in it

- **The 2026 grid:** 22 drivers in 11 teams, in their 2026 colours with real driver codes (NOR, PIA, VER, LEC, HAM…). Pick a team and whose seat you take: you race as **YOU**, the other driver is your teammate, and the other 20 are rivals. On the timing tower and the phone HUD your teammate is marked in yellow.
- **25 real circuits**, built from GPS centre lines: the 2026 calendar plus Malaysia (Sepang). Street circuits have walls close to the track, Suzuka has its bridge, and each circuit has its own look (night races in Singapore, Las Vegas and Jeddah, dunes at Zandvoort, forest at Spa and Monza, water round Montréal).
- **Season:** the whole calendar as a championship with a Drivers' and a Constructors' table, F1 points for the top ten (25-18-15-12-10-8-6-4-2-1). Every round is a weekend: qualifying sets the grid, then the race. Choose laps per race and rival difficulty; standings are kept on the device until the season ends.
- A single **race** on any circuit, or a solo **time trial** against your own ghost.
- Arcade handling: drifting, a strong slipstream, overtake mode, start-light launches, bumping, tyre smoke, dust off the road, skid marks, sparks and synthesised engine sounds.
- Music: an original, synthesised racing theme behind the menus; when you cross the line the big part kicks in and the cars carry on quietly underneath.
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

To keep a phone cool the game draws at 1.5 pixels per point there (2 on a computer), races at an even 60 frames a second at most (every other frame on a 120 Hz screen), about 30 behind the menus and nothing new while paused. On a phone the circuit itself (ground, run-off, barriers, road, kerbs, pit lane, boards, scenery) is drawn once into tiles and reused, each car is drawn from a ready-made picture, the minimap's outline is drawn once and smoke is drawn from ready-made discs, so a frame takes a fraction of the work. Settings → Battery saver draws a little less sharp, with less smoke and dust. With sound off the audio is switched off altogether. The pause screen shows how many frames a second the game was drawing and the screen's own rate.

With the phone sideways the middle of the screen stays clear for the road: position, lap times, gaps and messages sit in the column above the steering controls, the speed sits right next to GAS, the map sits next to the pause button above the pedals, and only the start lights appear in the middle.

- **Drift:** while turning at speed, press and hold brake. The car slides round the corner on a much tighter line without losing much speed (steer into it to turn tighter still), with tyre smoke and speed lines; let go of brake to grip again. A DRIFTING! tag under your car fills up the longer you hold it: white, blue, orange, purple. On a phone, rock your pedal thumb from GAS down to BRAKE and back up.
- **Your car:** on the grid and through the start a pulsing ring with a YOU tag marks your car; after that it's the one the camera follows.
- **Launch:** wait for the five red lights to go out, then hit the gas. React within 0.3 s for a perfect start and a launch boost (within 0.5 s, a smaller one). Hold the gas too early and you spin the wheels.
- **Slipstream:** on a straight at speed, up to about eight car lengths behind another car and lined up with it, you're in its tow after a moment: extra pull and up to 24% more top speed, shown by a SLIPSTREAM! tag under your car, light-blue speed lines and air streaming past. Pull out and pass. Not in corners or chicanes.
- **Tyres & damage (races):** every car starts at 100%. A race of normal driving uses about 70% of a set of tyres, whatever the number of laps (so with the one pit stop each set ends near 65%); drifting wears them faster, running off the road much faster. Hits with walls or cars (beyond a light scrape) damage the car. Both cost top speed and pull: worn tyres hardly at first, more and more below about half, and damage more and more as it builds up; a badly damaged car smokes. TYRES and CAR next to your speed show where you are (green, yellow, orange, red); CAR flashes when you take a hit, and the results show how you finished. The computer cars wear and get damaged by the same rules. Off in time trials; can be turned off in Settings.
- **Pit stop (races):** everyone has to stop once (from the end of lap 1, with at least most of a lap to go). The pit lane runs beside the start straight; a blue PIT board and a dashed line on the road mark the entry, and a PIT ENTRY card shows which side to keep to. Run your car over the dashed line at the entry and it turns in and drives itself at the speed limit to your team's box. There you play the stop, in rhythm, while the race carries on: four wheel guns, one go each (tap GAS, or press ↑, as the marker crosses the green; the green is always in the same place, so the wheels come on a steady beat: green and the next wheel starts straight away, just outside costs 0.3 s, a miss or no tap jams the gun for 0.9 s), then the release light (go on green; go on red and you're held). Waiting never helps, so four greens always make a quick stop: 2.4–3.0 s. On normal the computer crews take 3.0–4.0 s, the same as a good stop of yours on a phone (easy crews are slower, hard ones quicker). It works the same with other players on track, so it's ready for multiplayer. The stop is called GREAT when it beats a typical crew; time held for traffic or waiting for a new front wing is shown and doesn't count against that. The whole stop costs about 8 seconds, and the results show your stop next to the field's average. You leave with fresh tyres and a repaired car; a damaged car also gets a new front wing, which takes longer the worse the damage. The computer cars stop around halfway (sooner when badly damaged). The PIT readout next to your speed says DUE until you've stopped, BOX NOW on your last chance, then a tick and your time. On your last chance a big yellow BOX THIS LAP banner stays up all lap (with a double beep), and as the entry comes up a large card says which side to keep to while yellow arrows on the road lead you into the pit lane. Skip it and you get 20 seconds added at the finish. Off with tyres & damage off.
- **Qualifying (season):** every round starts with it. Your car waits in your team's garage; on green it drives itself down the pit lane, and from the exit you drive an out-lap to get up to speed, then one flying lap. The timer shows the pole time to beat, and on the flying lap your gap to pole at each timing point, with the pole lap itself driving ahead of you as a see-through ghost in its team's colours (tagged POLE · and the driver); the board on the left fills with the other drivers' times during your out-lap, with you placed where your lap would put you right now (LIVE), and the big number is that provisional place. Your lap sets your grid slot; the others' laps are simulated with the same cars and drivers as the race (alone on the road, at their pace for the weekend), pushing harder than in the race, the way they chase you when you lead: on easy a decent lap takes pole, on normal a strong one fights for it, on hard the field is within about a second and one mistake costs a lot of places. Restart in the pause menu replays the session against the same times. Once you've qualified, the season screen offers the race from your grid slot (also after quitting to the menu), Restart in the race keeps the grid, and the results show where you started and how many places you gained.
- **Contact:** rubbing is fine. Run into someone's gearbox and you take the knock, not them; the computer cars lift off rather than push you along.
- **Corners:** long bends are flat out; quicker ones need a lift off the gas (coasting scrubs off speed); hairpins and hard corners need proper braking; chicanes need a big stop. The yellow-and-black sausage kerbs in a chicane are solid, so it can't be cut.
- **Corner calls:** a card under the timer calls the next corner you need to slow for: LEFT/RIGHT (a lift), HARD LEFT/RIGHT (brake), HAIRPIN or CHICANE, with a bar running down to where to slow; at the braking point it flashes BRAKE! with a beep.
- **Braking boards:** 3-2-1 boards on both sides of the road count down to every big stop; brake at the red **1** (that's for the speed you'd arrive with, with a little in hand). Calls and boards can be turned off in Settings → Corner hints.
- **Barriers:** a light scrape costs little; using a wall as a brake costs a lot of speed and makes the engine stutter for a moment, so it's slower than braking.
- **Timing tower:** you and the cars right ahead of and behind you get big rows with the gap to you (▲ ahead, ▼ behind); the rest of the order is smaller, with gaps to the leader. On the map your car is the white arrow in a red halo.
- **Overtake mode:** like Formula 1's from 2026. Just before each of the circuit's two longest straights there's a detection point: a car within one second of the car ahead there gets 10% more engine power for six seconds, enough to close up and have a go down the straight. Pass, and the car you passed is the one within a second next time, so it's theirs. Every car gets it, you included, from lap 2. An OVERTAKE tag under your car shows yours; a green OT next to a name shows a rival's, and a message tells you when the car right behind you has it.
- **Leading:** once you're out in front, the cars behind chase: the further you pull away, the harder they push (on hard more so, and even right behind you), and up close they use your slipstream and overtake mode. A lead has to be kept, not just built.
- **Rivals:** easy, normal or hard. The computer cars can't drift, so their engines make up for it: on hard they have more power (they pull away on straights unless you're in their tow), the field is closer together and they chase harder; their laps at the front are about 3% quicker than on normal.

Settings: sound, music, camera (Chase rotates with the car; Fixed keeps north up), corner hints (calls and boards), tyres & damage, phone layout (steer left or right), battery saver, auto-gas for phones, and erasing saved records.

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
| `js/pit.js` | Pit stops: the required stop, driving the pit lane, the stop you play, computer crews |
| `js/quali.js` | Qualifying: the computer drivers' laps, simulated in the background, and its tuning |
| `js/car.js` | Car physics (grip, drift, boost, barriers) and the car drawing |
| `js/ai.js` | Computer drivers: following the racing line, braking points, overtaking, recovery |
| `js/track.js` | Circuit geometry, chicanes, racing line and corner speeds, braking boards, kerbs, pit lane and garages, scenery, minimap |
| `js/data/tracks.js` | The circuits, their looks and the season calendar |
| `js/data/circuits/` | Each real circuit as game coordinates |
| `js/season.js` | Championship: points, standings, rounds |
| `js/data/teams.js` | The 11 teams and 22 drivers: names, codes, colours, AI pace |
| `js/hud.js` | On-screen race information |
| `js/ui.js` | Menu screens |
| `js/input.js` | Keyboard, touch and controller input |
| `js/audio.js` | Synthesised engine, tyres, impacts and beeps |
| `js/music.js` | The music: an original theme, synthesised and scheduled from the game loop |
| `js/tiles.js` | Phones: the circuit drawn once into tiles and reused every frame |
| `js/storage.js` | Everything saved on the device |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home-screen app and offline support |

Developer extras:

- `tools/track-preview.html` draws every circuit with its racing line coloured by the speed the car can carry, the stops that get braking boards, and every corner numbered with its slowest speed (`?ids=monaco,spa` for just a few).
- `tools/chicanes.html` shows a close-up of every chicane as drawn in the game.
- `tools/trouble.html` shows a close-up of every crowded spot as drawn in the game: hairpins tighter than the kerbs are wide (edge lines, kerbs and barriers are drawn with their folds cut out, so the inside comes to a clean point) and stretches running side by side (they share one barrier, and there's no kerb against a barrier right at the edge). `?ids=baku,monaco`, `?kind=pin` or `?kind=side`.
- `tools/snapshot.html` sets up moments in a race (a corner call, BRAKE!, slipstream, a drift, off the road, hard braking, the pit entry, the stop, the release, the last chance to stop, and qualifying: the garage, the pit lane, the out-lap, the flying lap, the end of the lap) and draws one frame of each with the game's own code (`?w=740&h=360` for a phone held sideways, `?zoom=2` to look closer, `?only=monza,monaco` for the pit and qualifying scenes, `?calls` for every corner call card).
- `tools/sim-races.mjs` and `tools/sim-calls.mjs` run races without a browser for tuning (`node tools/sim-races.mjs all 3`: finishes, lap times, wall hits, tyres and damage, pit stops; `node tools/sim-calls.mjs monza`: when each corner call and BRAKE! comes).
- `tools/perf.html` draws race frames at phone size on the CPU (the way a phone's canvas works) and shows, per circuit, what a frame costs layer by layer and how many drawing calls it makes, the old way against the phone way (`?ids=monza,monaco`, `?w=852&h=393&dpr=1.5`).
- `tools/sim-stops.mjs` plays the pit stop as a few kinds of player (perfect, sharp, good on a phone, typical, casual) and prints their times standing in the box next to the computer crews' for each difficulty: the check for `AI_STOP`.
- `tools/sim-quali.mjs` runs qualifying without a browser (`node tools/sim-quali.mjs all normal 0.88,0.95`: pole, P10 and last time of the computer drivers, and where a bot driving your car at those paces qualifies; add `race` to race from that grid). The bot drifts, which the computer drivers don't, so it's quicker than they are at the same pace.
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

Each circuit gets a pit lane beside its start straight, on the inside of the lap where there's room (Monaco, Spa and Miami have it on the outside): the game looks for a stretch with no other part of the circuit close by and no tight bend where the lane leaves or rejoins the road, as near the line as it can. `pit: { side: 1 | -1, shift: px }` on a circuit in `js/data/tracks.js` overrides the side or moves it along.

The racing line is an elastic band pulled as straight as the road allows (it uses the inside of tight corners like a player can). The AI drives it, and the braking boards come from the speeds along it, so they match what the car can really do.

Tuning knobs live at the top of their files: `WALL`, `LIFT`, `SLIP_TOP`/`SLIP_ACC`, `DRIFT` and `WEAR` in `js/car.js` (what barrier hits cost; how much a lift off the gas slows you; what a full slipstream gives; how drifts start, turn and end; how fast tyres wear, what hits cost and how much both slow you), `LINE`, `CHICANE`, `HINTS`, `CALLS` and `PIT` in `js/track.js` (racing line clearances, chicane shapes and kerbs, braking boards, corner calls, pit lane size and entry), `PIT_DRIVE`, `PIT_RULE`, `PIT_GAME` and `AI_STOP` in `js/pit.js` (pit lane speed limit, when a stop counts and the penalty for skipping it, the stop you play, computer stop times), `PIT_GAME` also sets the beat of the wheel guns and what a sloppy or missed wheel costs; `QUALI` in `js/quali.js` (qualifying pace against race pace, how much the computer laps vary, when their times come up), `AI_KERB` in `js/ai.js`, `DIFFICULTY` (AI pace and power and how hard they chase a leader), `OVERTAKE` (overtake mode: the gap, the extra power and how long it lasts), `SLIPSTREAM` (tow range, only on straights at speed) and `REAR_END` (who takes the knock in a nose-to-tail hit) in `js/race.js`.

## Roadmap

1. ~~Arcade racer, one player, saved on the device~~
2. ~~Real teams and drivers to pick from~~
3. ~~Real circuits and a season mode~~, ~~qualifying~~
4. ~~Tyre wear and damage~~, ~~pit stops as a mini-game~~; next: tyre strategy, weather
5. Team management: driver development, junior teams, car development
6. Online: ghost races between two players, then live racing in the same room
