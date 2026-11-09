# Lights Out

Top-down arcade Formula racing that runs in the browser and installs to a phone's home screen. Plain HTML, CSS and JavaScript: no build step, so it runs on GitHub Pages as-is.

## Phase 1 (this version)

- One player against 7 computer drivers, or a solo **time trial** against your own ghost.
- Three made-up circuits: **Sunset Speedway** (fast and flowing), **Harbour Hairpins** (tight and twisty) and **Dune Drag** (long straights).
- Arcade handling: drifting with boosts, slipstream, start-light launches, bumping, skid marks, sparks and synthesised engine sounds.
- Lap records, ghosts, best finishes and race stats are saved on the device (browser `localStorage`).
- Works offline once it has been opened online.

### Controls

| | Keyboard | Phone | Controller |
|---|---|---|---|
| Gas | ↑ or W | GAS (right thumb) | RT or A |
| Brake | ↓, S or Space | BRAKE (right thumb) | LT, B or X |
| Steer | ← → or A D | ◀ ▶ (left thumb) | left stick or d-pad |
| Pause | Esc or P | ❚❚ top right | Start |

- **Drift:** while turning at speed, press and hold brake. The car slides round the corner without losing much speed. Hold it to fill the meter, then let go of brake for a boost: blue, then orange, then purple. On a phone, slide your right thumb from GAS to BRAKE and back.
- **Launch:** wait for the five red lights to go out, then hit the gas. React within 0.3 s for a perfect start. Hold the gas too early and you spin the wheels.
- **Slipstream:** tuck in behind a car on a straight for extra top speed.

Settings: sound, camera (Chase rotates with the car; Fixed keeps north up), auto-gas for phones, and erasing saved records.

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

Push to `main` and GitHub Pages redeploys. The game loads the newest files whenever it's opened online. When you add or rename files, list them in `sw.js` and bump `CACHE` (for example `lights-out-v2`) so the offline copy stays complete.

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
| `js/data/tracks.js` | The circuits and their colour themes |
| `js/data/turtle.js` | Builds a circuit from "straight / turn left / turn right" instructions |
| `js/data/drivers.js` | The grid (placeholder names until phase 2) |
| `js/hud.js` | On-screen race information |
| `js/ui.js` | Menu screens |
| `js/input.js` | Keyboard, touch and controller input |
| `js/audio.js` | Synthesised engine, tyres, impacts and beeps |
| `js/storage.js` | Everything saved on the device |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home-screen app and offline support |

Developer extras:

- `tools/track-preview.html` draws every circuit with its racing line coloured by AI target speed.
- Add `?nopause` to the URL to stop the game pausing when the tab is hidden (for automated testing).
- `window.lightsOut` in the browser console gives access to the game state.

## Roadmap

1. ~~Arcade racer, one player, saved on the device~~ (this version)
2. Real teams and drivers to pick from, with real names and colours
3. Real circuits and a season mode
4. Pit stops as a mini-game, tyre strategy, weather
5. Team management: driver development, junior teams, car development
6. Online: ghost races between two players, then live racing in the same room
