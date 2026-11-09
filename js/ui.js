// Menu screens, built as HTML over the canvas. The live race keeps running
// behind the title and circuit screens.

import { TRACKS } from './data/tracks.js';
import { save } from './storage.js';
import { formatGap, formatTime } from './util.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const HEADLINES = ['', 'Victory!', 'Podium!', 'Podium!', 'Solid race', 'Solid race'];

export function createUI(root, h) {
  let current = null;
  let setupMode = 'race';
  let selected = save.settings.lastTrack || TRACKS[0].id;
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
          <span>Race</span><small>vs 7 rivals</small>
        </button>
        <button class="btn" id="btn-trial" data-act="mode" data-mode="trial">
          <span>Time trial</span><small>race your own ghost</small>
        </button>
        <button class="btn" id="btn-settings" data-act="settings"><span>Settings</span><small></small></button>
      </nav>
      <dl class="stats" id="stats"></dl>
      <section class="howto">
        <h2>How to drive</h2>
        <div class="keys" id="keys"></div>
        <p><b>Drift:</b> while turning at speed, press and hold brake. The car slides round the corner at full speed. Hold it to fill the meter, then let go of brake for a boost: <span class="t1">blue</span>, <span class="t2">orange</span>, <span class="t3">purple</span>.</p>
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
      ? `<div><kbd>◀</kbd><kbd>▶</kbd><span>steer (left thumb)</span></div>
         <div><kbd>BRAKE</kbd><kbd>GAS</kbd><span>right thumb</span></div>`
      : `<div><kbd>↑</kbd><kbd>W</kbd><span>gas</span></div>
         <div><kbd>↓</kbd><kbd>S</kbd><kbd>Space</kbd><span>brake</span></div>
         <div><kbd>←</kbd><kbd>→</kbd><kbd>A</kbd><kbd>D</kbd><span>steer</span></div>
         <div><kbd>Esc</kbd><span>pause</span></div>`;
    const anyPB = TRACKS.map((t) => save.peek(t.id)).filter((r) => r && r.bestLap);
    $('#btn-trial small').textContent = anyPB.length ? `${anyPB.length} ghost${anyPB.length > 1 ? 's' : ''} saved` : 'race your own ghost';
  }

  function refreshSegs() {
    root.querySelectorAll('.seg[data-setting]').forEach((seg) => {
      const v = String(save.settings[seg.dataset.setting]);
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.val === v));
    });
  }

  function trackMeta(t) {
    const r = save.peek(t.id);
    const bits = [`${t.corners} corners`];
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
          <span class="blurb">${esc(def.blurb)}</span>
          <span class="meta" data-meta="${def.id}"></span>
        </span>
      </button>`
    ).join('');
    show('setup');
    // Thumbnails and stats need the built track; build them after the screen shows.
    requestAnimationFrame(() => {
      list.querySelectorAll('.track').forEach((btn) => {
        const t = getTrack(btn.dataset.track);
        t.drawThumb(btn.querySelector('canvas'));
        btn.querySelector('[data-meta]').innerHTML = trackMeta(t);
      });
    });
  }

  function selectTrack(id) {
    selected = id;
    save.settings.lastTrack = id;
    save.write();
    root.querySelectorAll('.track').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.track === id)));
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
          <td><span class="swatch" style="background:${r.livery.color}"></span>${esc(r.code)} <span class="nm">${esc(r.name)}</span></td>
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
      <div class="menu">
        <button class="btn primary" data-act="again" data-primary><span>Race again</span><small class="kbd">Enter</small></button>
        <button class="btn" data-act="tracks"><span>Change circuit</span><small></small></button>
        <button class="btn" data-act="quit"><span>Menu</span><small></small></button>
      </div>`;
    show('results');
  }

  root.addEventListener('click', (e) => {
    const trackBtn = e.target.closest('.track');
    if (trackBtn) {
      h.click();
      selectTrack(trackBtn.dataset.track);
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
    } else if (e.code === 'Escape' && (current === 'setup' || current === 'settings')) {
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
    showResults,
    get current() {
      return current;
    },
    get selected() {
      return selected;
    },
  };
}
