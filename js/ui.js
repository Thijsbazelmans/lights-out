// Menu screens, built as HTML over the canvas. The live race keeps running
// behind the title and circuit screens.

import { TRACKS } from './data/tracks.js';
import { TEAMS, teamById } from './data/teams.js';
import { drawF1 } from './car.js';
import { drawTrackThumb } from './track.js';
import { save } from './storage.js';
import { POINTS, ROUNDS, constructorStandings, currentSeason, hasOutdatedSeason, isComplete, lastRound, nextTrack, playerStanding, standings, teamStanding } from './season.js';
import { formatGap, formatTime } from './util.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const HEADLINES = ['', 'Victory!', 'Podium!', 'Podium!', 'Solid race', 'Solid race'];

export function createUI(root, h) {
  let current = null;
  let setupMode = 'race';
  let selected = TRACKS.some((t) => t.id === save.settings.lastTrack) ? save.settings.lastTrack : TRACKS[0].id;
  let getTrack = h.getTrack;
  let resetArmed = 0;

  root.innerHTML = `
  <section class="screen rail" data-screen="title" hidden>
    <div class="sheet">
      <header class="brand">
        <div class="gantry" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
        <h1 class="logo"><span>Lights</span><span>Out</span></h1>
        <p class="tag">Top-down arcade Formula racing</p>
      </header>
      <nav class="menu">
        <button class="btn primary" id="btn-race" data-act="mode" data-mode="race" data-primary>
          <span>Race</span><small>vs 10 rivals</small>
        </button>
        <button class="btn" id="btn-season" data-act="season"><span>Season</span><small id="season-label"></small></button>
        <button class="btn" id="btn-trial" data-act="mode" data-mode="trial">
          <span>Time trial</span><small>race your own ghost</small>
        </button>
        <button class="btn" id="btn-team" data-act="team"><span>Team</span><small id="team-label"></small></button>
        <button class="btn" id="btn-settings" data-act="settings"><span>Settings</span><small></small></button>
      </nav>
      <dl class="stats" id="stats"></dl>
      <section class="howto">
        <h2>How to drive</h2>
        <div class="keys" id="keys"></div>
        <p><b>Drift:</b> while turning at speed, press and hold brake (on a phone: slide your right thumb down). The car slides round the corner at full speed. Hold it to fill the meter, then let go of brake for a boost: <span class="t1">blue</span>, <span class="t2">orange</span>, <span class="t3">purple</span>.</p>
        <p><b>Braking:</b> red on the racing line and the 3-2-1 boards at the side show where to brake.</p>
        <p><b>Launch:</b> wait for the five red lights to go out, then hit the gas. Hold it too early and you'll spin the wheels.</p>
        <p><b>Slipstream:</b> tuck in behind a car on a straight for extra speed.</p>
      </section>
    </div>
  </section>

  <section class="screen rail" data-screen="setup" hidden>
    <div class="sheet">
      <header class="sheet-head">
        <button class="back" data-act="back" aria-label="Back to menu">‹</button>
        <h2 id="setup-title">Race</h2>
      </header>
      <div class="tracks" id="tracks" role="listbox" aria-label="Circuit"></div>
      <div class="opts" id="race-opts">
        <div class="opt">
          <span class="label">Laps</span>
          <div class="seg" data-setting="laps">
            <button data-val="3">3</button><button data-val="5">5</button><button data-val="8">8</button>
          </div>
        </div>
        <div class="opt">
          <span class="label">Rivals</span>
          <div class="seg" data-setting="difficulty">
            <button data-val="easy">Easy</button><button data-val="normal">Normal</button><button data-val="hard">Hard</button>
          </div>
        </div>
      </div>
      <button class="btn primary go" id="btn-start" data-act="start" data-primary><span>Start</span><small class="kbd">Enter</small></button>
    </div>
  </section>

  <section class="screen rail" data-screen="settings" hidden>
    <div class="sheet">
      <header class="sheet-head">
        <button class="back" data-act="back" aria-label="Back to menu">‹</button>
        <h2>Settings</h2>
      </header>
      <div class="opts">
        <div class="opt">
          <span class="label">Sound</span>
          <div class="seg" data-setting="sound"><button data-val="true">On</button><button data-val="false">Off</button></div>
        </div>
        <div class="opt">
          <span class="label">Camera</span>
          <div class="seg" data-setting="camera"><button data-val="chase">Chase</button><button data-val="fixed">Fixed</button></div>
          <p class="hint">Chase turns the view with your car, so left is always left. Fixed keeps north at the top.</p>
        </div>
        <div class="opt">
          <span class="label">Braking hints</span>
          <div class="seg" data-setting="brakeHints"><button data-val="true">On</button><button data-val="false">Off</button></div>
          <p class="hint">Red braking zones on the racing line and 3-2-1 boards before the big stops.</p>
        </div>
        <div class="opt">
          <span class="label">Touch steering</span>
          <div class="seg" data-setting="touchSteer"><button data-val="float">From thumb</button><button data-val="fixed">Fixed centre</button></div>
          <p class="hint">From thumb: wherever you put your thumb down is straight ahead; slide left or right from there. Fixed centre: the middle of the strip is straight ahead.</p>
        </div>
        <div class="opt">
          <span class="label">Auto-gas</span>
          <div class="seg" data-setting="autoGas"><button data-val="false">Off</button><button data-val="true">On</button></div>
          <p class="hint">The car accelerates by itself; you only steer and brake. Handy on a phone.</p>
        </div>
        <div class="opt">
          <span class="label">Saved data</span>
          <button class="btn danger" id="btn-reset" data-act="reset"><span>Erase records</span><small>lap times, ghosts, stats</small></button>
        </div>
      </div>
      <p class="fine">Everything is saved on this device only.</p>
    </div>
  </section>

  <section class="screen rail" data-screen="team" hidden>
    <div class="sheet">
      <header class="sheet-head">
        <button class="back" data-act="back" aria-label="Back to menu">‹</button>
        <h2>Your team</h2>
      </header>
      <p class="hint">Pick a team and whose seat you take. You race as YOU in their colours, the other driver is your teammate, and the other 20 cars are your rivals.</p>
      <div class="teams" id="teams" role="listbox" aria-label="Team"></div>
      <div class="opt">
        <span class="label">Take the seat of</span>
        <div class="seg" id="seat-seg"><button data-seat="0"></button><button data-seat="1"></button></div>
        <p class="hint" id="seat-hint"></p>
      </div>
      <button class="btn primary" id="btn-team-done" data-act="team-done" data-primary><span id="team-done-label">Race for McLaren</span><small class="kbd">Enter</small></button>
    </div>
  </section>

  <section class="screen rail" data-screen="season" hidden>
    <div class="sheet">
      <header class="sheet-head">
        <button class="back" data-act="back" aria-label="Back to menu">‹</button>
        <h2>Season</h2>
      </header>
      <div class="season" id="season-body"></div>
    </div>
  </section>

  <section class="screen center" data-screen="pause" hidden>
    <div class="modal">
      <h2 class="modal-title">Paused</h2>
      <div class="menu">
        <button class="btn primary" data-act="resume" data-primary><span>Resume</span><small class="kbd">Esc</small></button>
        <button class="btn" data-act="restart"><span>Restart</span><small></small></button>
        <button class="btn" data-act="quit"><span>Quit to menu</span><small></small></button>
      </div>
    </div>
  </section>

  <section class="screen center" data-screen="results" hidden>
    <div class="modal results" id="results"></div>
  </section>`;

  const $ = (sel) => root.querySelector(sel);
  const screens = {};
  root.querySelectorAll('[data-screen]').forEach((el) => (screens[el.dataset.screen] = el));

  function show(name) {
    current = name;
    for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
    if (name === 'title') refreshTitle();
    if (name === 'settings' || name === 'setup') refreshSegs();
    const first = screens[name] && screens[name].querySelector('[data-primary]');
    if (first && !matchMedia('(pointer: coarse)').matches) first.focus({ preventScroll: true });
  }

  function hideAll() {
    current = null;
    for (const el of Object.values(screens)) el.hidden = true;
  }

  function refreshTitle() {
    const s = save.stats;
    $('#stats').innerHTML = `
      <div><dt>Races</dt><dd>${s.races}</dd></div>
      <div><dt>Wins</dt><dd>${s.wins}</dd></div>
      <div><dt>Podiums</dt><dd>${s.podiums}</dd></div>`;
    const touch = h.isTouch();
    $('#keys').innerHTML = touch
      ? `<div><kbd>‹ ›</kbd><span>left thumb: slide to steer</span></div>
         <div><kbd>GAS</kbd><kbd>BRAKE</kbd><span>right thumb: slide up for gas, down for brake</span></div>`
      : `<div><kbd>↑</kbd><kbd>W</kbd><span>gas</span></div>
         <div><kbd>↓</kbd><kbd>S</kbd><kbd>Space</kbd><span>brake</span></div>
         <div><kbd>←</kbd><kbd>→</kbd><kbd>A</kbd><kbd>D</kbd><span>steer</span></div>
         <div><kbd>Esc</kbd><span>pause</span></div>`;
    const ss = currentSeason();
    $('#season-label').textContent = !ss ? `${ROUNDS} rounds` : isComplete(ss) ? 'season complete' : `round ${ss.round + 1} of ${ROUNDS}`;
    const team = save.settings.team ? teamById(save.settings.team) : null;
    const mate = team ? team.drivers[save.settings.seat === 0 ? 1 : 0] : null;
    $('#team-label').innerHTML = team
      ? `<i class="dot" style="background:${team.livery.color}"></i>${esc(team.name)}, with ${esc(mate.name.split(' ').slice(-1)[0])}`
      : 'pick one';
    const anyPB = TRACKS.map((t) => save.peek(t.id)).filter((r) => r && r.bestLap);
    $('#btn-trial small').textContent = anyPB.length ? `${anyPB.length} ghost${anyPB.length > 1 ? 's' : ''} saved` : 'race your own ghost';
  }

  function refreshSegs() {
    root.querySelectorAll('.seg[data-setting]').forEach((seg) => {
      const v = String(save.settings[seg.dataset.setting]);
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.val === v));
    });
  }

  function trackMeta(def) {
    const r = save.peek(def.id);
    const bits = [`${def.country} · ${def.lengthKm.toFixed(2)} km`];
    if (r && r.bestLap) bits.push(`<span class="pb">PB ${formatTime(r.bestLap)}</span>`);
    if (r && r.bestPos) bits.push(`best P${r.bestPos}`);
    return bits.join(' · ');
  }

  function openSetup(mode) {
    setupMode = mode;
    $('#setup-title').textContent = mode === 'race' ? 'Race' : 'Time trial';
    $('#race-opts').hidden = mode !== 'race';
    const list = $('#tracks');
    list.innerHTML = TRACKS.map(
      (def) => `
      <button class="track" role="option" data-track="${def.id}" aria-selected="${def.id === selected}">
        <canvas class="thumb" width="120" height="84" aria-hidden="true"></canvas>
        <span class="tinfo">
          <b>${esc(def.name)}</b>
          <span class="blurb">${esc(def.gp || def.blurb || '')}</span>
          <span class="meta" data-meta="${def.id}"></span>
        </span>
      </button>`
    ).join('');
    show('setup');
    // Thumbnails and stats need the built track; build them after the screen shows.
    requestAnimationFrame(() => {
      list.querySelectorAll('.track').forEach((btn) => {
        const def = TRACKS.find((t) => t.id === btn.dataset.track);
        drawTrackThumb(btn.querySelector('canvas'), def);
        btn.querySelector('[data-meta]').innerHTML = trackMeta(def);
      });
      list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    });
  }

  // ---------- season ----------

  const seasonSetup = { laps: 3, difficulty: save.settings.difficulty };
  let abandonArmed = 0;

  let standingsTab = 'drivers';

  // Drivers' table (kind 'drivers') or Constructors' table (kind 'teams').
  function standingsTable(table, limit, kind = 'drivers') {
    const rows = [];
    table.forEach((r, i) => {
      if (limit && i >= limit && !r.isPlayer && !r.isMate) return;
      const cls = r.isPlayer ? 'me' : r.isMate ? 'mate' : '';
      const label =
        kind === 'drivers'
          ? `${r.isPlayer ? 'YOU' : r.driver.code} <span class="nm">${esc(r.isPlayer ? `You (${r.team.name})` : r.driver.name)}</span>`
          : `${r.team.code} <span class="nm">${esc(r.team.name)}</span>`;
      rows.push(`<tr class="${cls}">
        <td class="num">${i + 1}</td>
        <td><span class="swatch" style="background:${r.team.livery.color}"></span>${label}</td>
        <td class="num">${r.wins}</td>
        <td class="num pts">${r.points}</td>
      </tr>`);
    });
    return `<div class="table-wrap"><table class="res-table standings">
      <thead><tr><th>Pos</th><th>${kind === 'drivers' ? 'Driver' : 'Team'}</th><th>Wins</th><th>Pts</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table></div>`;
  }

  function standingsBlock(s) {
    return `
      <div class="seg" id="standings-tab">
        <button data-tab="drivers" class="${standingsTab === 'drivers' ? 'on' : ''}">Drivers</button>
        <button data-tab="teams" class="${standingsTab === 'teams' ? 'on' : ''}">Constructors</button>
      </div>
      <div id="standings-table">${standingsTab === 'drivers' ? standingsTable(standings(s)) : standingsTable(constructorStandings(s), 0, 'teams')}</div>`;
  }

  function openSeason() {
    const s = currentSeason();
    const body = $('#season-body');
    if (!s) {
      const team = teamById(save.settings.team);
      const mate = team.drivers[save.settings.seat === 0 ? 1 : 0];
      body.innerHTML = `
        ${hasOutdatedSeason() ? '<p class="hint"><b>Your earlier season was for 11 cars, so it can\'t continue in the new 22-car format.</b> Starting a new season replaces it.</p>' : ''}
        <p class="hint">The full calendar: ${ROUNDS} rounds from Melbourne to Abu Dhabi. 22 drivers in 11 teams, points for the top ten (${POINTS.join(', ')}), with a Drivers' and a Constructors' championship. Saved on this device.</p>
        <div class="opts">
          <div class="opt">
            <span class="label">Laps per race</span>
            <div class="seg" data-season="laps"><button data-val="2">2</button><button data-val="3">3</button><button data-val="5">5</button></div>
          </div>
          <div class="opt">
            <span class="label">Rivals</span>
            <div class="seg" data-season="difficulty"><button data-val="easy">Easy</button><button data-val="normal">Normal</button><button data-val="hard">Hard</button></div>
          </div>
          <div class="opt">
            <span class="label">Your seat</span>
            <button class="btn" data-act="team"><span><i class="dot" style="background:${team.livery.color}"></i>${esc(team.name)}</span><small>teammate ${esc(mate.name)} · change</small></button>
          </div>
        </div>
        <button class="btn primary" data-act="season-start" data-primary><span>Start season</span><small class="kbd">Enter</small></button>`;
      refreshSeasonSegs();
    } else if (isComplete(s)) {
      const me = playerStanding(s);
      const mine = teamStanding(s);
      const champ = standings(s)[0];
      const champTeam = constructorStandings(s)[0];
      body.innerHTML = `
        <div class="res-head">
          <div class="res-pos pos-${Math.min(me.pos, 4)}">P${me.pos}</div>
          <div>
            <h2>${me.pos === 1 ? 'World Champion!' : `${esc(champ.driver.name)} is World Champion`}</h2>
            <p>You finished P${me.pos} with ${me.points} points and ${me.wins} win${me.wins === 1 ? '' : 's'}. ${mine.pos === 1 ? `${esc(mine.team.name)} won the Constructors' title too.` : `Constructors' champions: ${esc(champTeam.team.name)}. ${esc(mine.team.name)} finished P${mine.pos}.`}</p>
          </div>
        </div>
        ${standingsBlock(s)}
        <button class="btn primary" data-act="season-new" data-primary><span>Start a new season</span><small class="kbd">Enter</small></button>`;
    } else {
      const next = nextTrack(s);
      const last = lastRound(s);
      const me = playerStanding(s);
      const mine = teamStanding(s);
      const team = teamById(s.team);
      const mate = s.lineup.find((d) => d.teamId === s.team && d.id !== 'you');
      body.innerHTML = `
        <div class="season-next">
          <canvas class="thumb" aria-hidden="true"></canvas>
          <div class="tinfo">
            <span class="eyebrow">Round ${s.round + 1} of ${ROUNDS}</span>
            <b>${esc(next.gp)}</b>
            <span class="meta">${esc(next.name)} · ${esc(next.country)} · ${s.laps} laps</span>
          </div>
        </div>
        <button class="btn primary" data-act="season-race" data-primary><span>Race round ${s.round + 1}</span><small class="kbd">Enter</small></button>
        ${
          last
            ? `<p class="hint">Last race: P${last.playerPos} at ${esc(last.track.name)}, won by ${last.winner.id === 'you' ? 'you' : esc(last.winner.name)}. You're P${me.pos} in the Drivers' and ${esc(team.name)} P${mine.pos} in the Constructors'.</p>`
            : `<p class="hint">Racing for ${esc(team.name)} alongside ${esc(mate.name)} · ${s.laps} laps · ${s.difficulty} rivals.</p>`
        }
        ${standingsBlock(s)}
        <button class="btn danger" id="btn-abandon" data-act="season-abandon"><span>Abandon season</span><small>can't be undone</small></button>`;
      requestAnimationFrame(() => drawTrackThumb(body.querySelector('canvas'), next));
    }
    show('season');
  }

  function refreshSeasonSegs() {
    root.querySelectorAll('.seg[data-season]').forEach((seg) => {
      const v = String(seasonSetup[seg.dataset.season]);
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.val === v));
    });
  }

  let pendingTeam = null;
  let pendingSeat = 1;

  let teamReturn = 'title';

  function openTeam() {
    teamReturn = current === 'season' ? 'season' : 'title';
    pendingTeam = save.settings.team || TEAMS[0].id;
    pendingSeat = save.settings.seat === 0 ? 0 : 1;
    const list = $('#teams');
    list.innerHTML = TEAMS.map(
      (t) => `
      <button class="team" role="option" data-team="${t.id}" aria-selected="${t.id === pendingTeam}" style="--team:${t.livery.color}">
        <canvas class="team-car" aria-hidden="true"></canvas>
        <span class="team-info"><b>${esc(t.name)}</b><span class="code" style="--c:${t.livery.color}">${t.code}</span></span>
      </button>`
    ).join('');
    updateTeamDone();
    show('team');
    requestAnimationFrame(() => {
      list.querySelectorAll('.team').forEach((btn) => drawTeamCar(btn.querySelector('canvas'), teamById(btn.dataset.team)));
    });
  }

  function updateTeamDone() {
    const team = teamById(pendingTeam);
    $('#team-done-label').textContent = `Race for ${team.name}`;
    const seg = $('#seat-seg');
    seg.querySelectorAll('button').forEach((b) => {
      const i = Number(b.dataset.seat);
      b.textContent = team.drivers[i].name.split(' ').slice(-1)[0];
      b.classList.toggle('on', i === pendingSeat);
    });
    $('#seat-hint').textContent = `Your teammate: ${team.drivers[1 - pendingSeat].name}`;
  }

  function drawTeamCar(canvas, team) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth || 30;
    const H = canvas.clientHeight || 60;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-Math.PI / 2);
    const k = Math.min(H / 48, W / 24);
    ctx.scale(k, k);
    drawF1(ctx, team.livery, 0, false);
  }

  function selectTrack(id) {
    selected = id;
    save.settings.lastTrack = id;
    save.write();
    root.querySelectorAll('.track').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.track === id)));
  }

  function seasonBlock(sb) {
    const moved = sb.posBefore == null ? 0 : sb.posBefore - sb.pos;
    const arrow = moved > 0 ? `<span class="up">▲${moved}</span>` : moved < 0 ? `<span class="down">▼${-moved}</span>` : '';
    return `<div class="season-block">
      <div class="sb-head">
        <span class="eyebrow">Championship · after round ${sb.round} of ${sb.total}</span>
        <b>Drivers P${sb.pos} ${arrow} · ${sb.points} pts <span class="gain">+${sb.gained}</span></b>
        <span class="meta">Constructors: ${esc(sb.teamName)} P${sb.teamPos} · ${sb.teamPoints} pts</span>
      </div>
      ${standingsTable(sb.table, 5)}
    </div>`;
  }

  function showResults(res, info) {
    const pos = res.playerPos;
    const head = HEADLINES[pos] || 'Tough day';
    const best = res.fastest;
    const rows = res.rows
      .map((r, i) => {
        const gap = i === 0 ? formatTime(r.time) : (r.finished ? '' : '≈ ') + formatGap(r.time - res.rows[0].time);
        const fast = best && best.code === r.code;
        return `<tr class="${r.isPlayer ? 'me' : ''}">
          <td class="num">${i + 1}</td>
          <td><span class="swatch" style="background:${r.livery.color}"></span>${esc(r.code)} <span class="nm">${esc(r.isPlayer ? 'You' : r.name)}</span></td>
          <td class="num">${gap}</td>
          <td class="num ${fast ? 'purple' : ''}">${formatTime(r.best)}</td>
        </tr>`;
      })
      .join('');
    const chips = info.chips.map((c) => `<li class="${c.kind}">${esc(c.text)}</li>`).join('');
    $('#results').innerHTML = `
      <div class="res-head">
        <div class="res-pos pos-${Math.min(pos, 4)}">P${pos}</div>
        <div>
          <h2>${head}</h2>
          <p>${esc(info.trackName)} · ${res.laps} laps · ${formatTime(res.playerTime)}</p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="res-table">
          <thead><tr><th>Pos</th><th>Driver</th><th>Time</th><th>Best lap</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${chips ? `<ul class="chips">${chips}</ul>` : ''}
      ${info.season ? seasonBlock(info.season) : ''}
      <div class="menu">
        ${
          info.season
            ? `<button class="btn primary" data-act="season-continue" data-primary><span>${info.season.complete ? 'Final standings' : 'Continue season'}</span><small class="kbd">Enter</small></button>`
            : `<button class="btn primary" data-act="again" data-primary><span>Race again</span><small class="kbd">Enter</small></button>
               <button class="btn" data-act="tracks"><span>Change circuit</span><small></small></button>`
        }
        <button class="btn" data-act="quit"><span>Menu</span><small></small></button>
      </div>`;
    show('results');
  }

  root.addEventListener('click', (e) => {
    const teamBtn = e.target.closest('.team');
    if (teamBtn) {
      h.click();
      pendingTeam = teamBtn.dataset.team;
      root.querySelectorAll('.team').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.team === pendingTeam)));
      updateTeamDone();
      return;
    }
    const trackBtn = e.target.closest('.track');
    if (trackBtn) {
      h.click();
      selectTrack(trackBtn.dataset.track);
      return;
    }
    const tabBtn = e.target.closest('#standings-tab button');
    if (tabBtn) {
      h.click();
      standingsTab = tabBtn.dataset.tab;
      const sn = currentSeason();
      if (sn) {
        root.querySelectorAll('#standings-tab button').forEach((b) => b.classList.toggle('on', b.dataset.tab === standingsTab));
        $('#standings-table').innerHTML = standingsTab === 'drivers' ? standingsTable(standings(sn)) : standingsTable(constructorStandings(sn), 0, 'teams');
      }
      return;
    }
    const seatBtn = e.target.closest('#seat-seg button');
    if (seatBtn) {
      h.click();
      pendingSeat = Number(seatBtn.dataset.seat);
      updateTeamDone();
      return;
    }
    const seasonSeg = e.target.closest('.seg[data-season] button');
    if (seasonSeg) {
      const key = seasonSeg.parentElement.dataset.season;
      const v = seasonSeg.dataset.val;
      seasonSetup[key] = /^\d+$/.test(v) ? Number(v) : v;
      refreshSeasonSegs();
      h.click();
      return;
    }
    const segBtn = e.target.closest('.seg button');
    if (segBtn) {
      const key = segBtn.parentElement.dataset.setting;
      let v = segBtn.dataset.val;
      if (v === 'true' || v === 'false') v = v === 'true';
      else if (/^\d+$/.test(v)) v = Number(v);
      save.settings[key] = v;
      save.write();
      refreshSegs();
      h.click();
      h.onSetting(key, v);
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    h.click();
    const act = btn.dataset.act;
    if (act === 'mode') openSetup(btn.dataset.mode);
    else if (act === 'settings') show('settings');
    else if (act === 'team') openTeam();
    else if (act === 'season') openSeason();
    else if (act === 'season-start') h.onSeasonStart({ laps: seasonSetup.laps, difficulty: seasonSetup.difficulty, team: save.settings.team || TEAMS[0].id, seat: save.settings.seat });
    else if (act === 'season-race') h.onSeasonRace();
    else if (act === 'season-continue') h.onSeasonContinue();
    else if (act === 'season-new') h.onSeasonAbandon();
    else if (act === 'season-abandon') {
      const b = $('#btn-abandon span');
      if (Date.now() - abandonArmed < 3000) {
        abandonArmed = 0;
        h.onSeasonAbandon();
      } else {
        abandonArmed = Date.now();
        b.textContent = 'Tap again to abandon';
        setTimeout(() => {
          if (Date.now() - abandonArmed >= 3000 && $('#btn-abandon span')) $('#btn-abandon span').textContent = 'Abandon season';
        }, 3100);
      }
    }
    else if (act === 'team-done') {
      save.settings.team = pendingTeam;
      save.settings.seat = pendingSeat;
      save.write();
      if (teamReturn === 'season') openSeason();
      else show('title');
    }
    else if (act === 'back') show('title');
    else if (act === 'start') h.onStart(setupMode, selected);
    else if (act === 'resume') h.onResume();
    else if (act === 'restart') h.onRestart();
    else if (act === 'quit') h.onQuit();
    else if (act === 'again') h.onRestart();
    else if (act === 'tracks') h.onTracks(setupMode);
    else if (act === 'reset') {
      const b = $('#btn-reset span');
      if (Date.now() - resetArmed < 3000) {
        save.resetRecords();
        b.textContent = 'Records erased';
        resetArmed = 0;
      } else {
        resetArmed = Date.now();
        b.textContent = 'Tap again to erase';
        setTimeout(() => {
          if (Date.now() - resetArmed >= 3000) b.textContent = 'Erase records';
        }, 3100);
      }
    }
  });

  window.addEventListener('keydown', (e) => {
    if (!current) return;
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      const btn = screens[current].querySelector('[data-primary]');
      if (btn && document.activeElement === document.body) {
        e.preventDefault();
        btn.click();
      }
    } else if (e.code === 'Escape' && (current === 'setup' || current === 'settings' || current === 'team' || current === 'season')) {
      show('title');
    } else if (current === 'setup' && (e.code === 'ArrowDown' || e.code === 'ArrowUp')) {
      e.preventDefault();
      const i = TRACKS.findIndex((t) => t.id === selected);
      const j = (i + (e.code === 'ArrowDown' ? 1 : -1) + TRACKS.length) % TRACKS.length;
      selectTrack(TRACKS[j].id);
      root.querySelector(`.track[data-track="${TRACKS[j].id}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  });

  return {
    show,
    hideAll,
    openSetup,
    openTeam,
    openSeason,
    showResults,
    get current() {
      return current;
    },
    get selected() {
      return selected;
    },
  };
}
