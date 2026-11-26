// The opening poster (build 42): a vintage race-poster style illustration,
// drawn as one SVG (no image files): a sunburst over a low sun, poplars and a
// grandstand on the horizon, red-and-white kerbs, and a red car with a number
// roundel tearing past with speed lines. On opening, the five start lights
// come on one by one and go out; LIGHTS OUT pops up and the car launches.
// A tap (or any key) goes on to the menu, and starts the music.

const C = {
  red: '#d8261f',
  redDark: '#9e1610',
  cream: '#fff1cf',
  navy: '#16203a',
  yellow: '#f6c445',
  orange: '#f28c28',
  teal: '#1f6b6f',
  green: '#1c4a3c',
  tyre: '#0e1322',
};

// Rays of the sunburst round (cx, cy).
function rays(cx, cy, n, r) {
  let out = '';
  for (let i = 0; i < n; i += 2) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const p = (a) => `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
    out += `<polygon points="${cx},${cy} ${p(a0)} ${p(a1)}"/>`;
  }
  return out;
}

// Monza-style poplars along the horizon.
function poplars() {
  const trees = [
    [70, 150], [118, 190], [160, 140], [205, 210], [250, 170], [300, 230], [345, 175], [392, 205], [440, 150], [486, 185], [530, 140], [575, 120],
  ];
  return trees
    .map(([x, h]) => `<rect x="${x - 3}" y="${600 - 26}" width="6" height="30" fill="${C.navy}"/><ellipse cx="${x}" cy="${600 - h / 2 - 20}" rx="${(h / 9).toFixed(1)}" ry="${(h / 2).toFixed(1)}" fill="${C.green}"/>`)
    .join('');
}

// A grandstand on the right, with its crowd as dots of colour.
function grandstand() {
  const dots = [];
  const cols = [C.cream, C.yellow, C.red, '#4fa3ff', C.cream];
  for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 26; k++) dots.push(`<circle cx="${1262 + k * 13 + (row % 2) * 6}" cy="${560 + row * 12}" r="3.4" fill="${cols[(k * 7 + row * 3) % cols.length]}"/>`);
  }
  return `<path d="M1240,600 L1240,548 L1600,536 L1600,600 Z" fill="${C.navy}"/>${dots.join('')}<path d="M1226,548 L1600,520 L1600,532 L1240,556 Z" fill="${C.redDark}"/><rect x="1236" y="518" width="8" height="84" fill="${C.navy}"/><rect x="1420" y="508" width="8" height="94" fill="${C.navy}"/>`;
}

// One wheel at (x, 0): tyre, yellow lettering band, rim with speed blur.
function wheel(x, r) {
  return `<g transform="translate(${x},0)">
    <circle r="${r}" fill="${C.tyre}"/>
    <circle r="${r - 16}" fill="none" stroke="${C.yellow}" stroke-width="4" stroke-dasharray="34 26" opacity="0.9"/>
    <circle r="${r * 0.56}" fill="#9aa3b5"/>
    <path d="M${-r * 0.45},-6 A${r * 0.46},${r * 0.46} 0 0 1 ${r * 0.2},${-r * 0.42}" fill="none" stroke="${C.cream}" stroke-width="5" stroke-linecap="round" opacity="0.8"/>
    <path d="M${r * 0.44},8 A${r * 0.46},${r * 0.46} 0 0 1 ${-r * 0.16},${r * 0.43}" fill="none" stroke="${C.navy}" stroke-width="5" stroke-linecap="round" opacity="0.6"/>
    <circle r="${r * 0.18}" fill="${C.navy}"/>
  </g>`;
}

// The car, side on, facing right: wheels' centres on y = 0, ground at y = 95.
function car() {
  return `<g class="po-car">
    <ellipse cx="520" cy="100" rx="540" ry="15" fill="rgba(20,10,30,0.35)"/>
    <path d="M60,58 L960,58 L995,72 L40,72 Z" fill="${C.navy}"/>
    <rect x="80" y="-176" width="18" height="130" fill="${C.navy}"/>
    <path d="M0,-214 L152,-204 L152,-174 L0,-182 Z" fill="${C.red}"/>
    <path d="M6,-236 L142,-224 L142,-210 L6,-218 Z" fill="${C.cream}"/>
    <rect x="16" y="-232" width="22" height="196" rx="3" fill="${C.navy}"/>
    <path d="M70,-40 C140,-72 262,-112 362,-150 L440,-180 Q470,-190 492,-172 L522,-124 L604,-110 C704,-96 832,-72 1002,-26 Q1020,-18 1012,-6 L962,12 C862,24 702,32 562,40 L300,46 L92,42 Q58,30 70,-40 Z" fill="${C.red}"/>
    <path d="M300,-70 C380,-96 520,-102 604,-92 L614,34 L300,44 Z" fill="${C.redDark}" opacity="0.55"/>
    <path d="M92,-18 C252,-72 422,-112 604,-96 C762,-82 882,-56 1002,-22 L998,-8 C872,-40 762,-62 604,-78 C432,-92 262,-54 98,-2 Z" fill="${C.cream}"/>
    <path d="M430,-172 L470,-176 L478,-150 L436,-148 Z" fill="${C.navy}"/>
    <circle cx="330" cy="-34" r="52" fill="${C.cream}" stroke="${C.navy}" stroke-width="6"/>
    <text x="330" y="-8" text-anchor="middle" font-family="'Saira Condensed', 'Arial Narrow', sans-serif" font-weight="900" font-style="italic" font-size="78" fill="${C.navy}">5</text>
    <circle cx="516" cy="-142" r="31" fill="${C.yellow}"/>
    <path d="M500,-150 L540,-150 Q548,-140 540,-130 L506,-132 Z" fill="${C.navy}"/>
    <path d="M488,-128 L540,-128" stroke="${C.red}" stroke-width="6"/>
    <path d="M456,-128 Q520,-210 594,-118" fill="none" stroke="${C.navy}" stroke-width="13" stroke-linecap="round"/>
    <path d="M578,-124 L550,-168" stroke="${C.navy}" stroke-width="11" stroke-linecap="round"/>
    <rect x="606" y="-128" width="26" height="10" rx="3" fill="${C.navy}"/>
    <path d="M720,-20 L800,0 M720,22 L800,0 M262,-10 L180,0 M262,26 L180,0" stroke="${C.navy}" stroke-width="6" stroke-linecap="round"/>
    <path d="M892,44 L1052,38 L1054,50 L894,56 Z" fill="${C.cream}"/>
    <path d="M880,60 L1062,52 L1066,72 L884,80 Z" fill="${C.navy}"/>
    <rect x="1042" y="8" width="22" height="70" rx="3" fill="${C.red}"/>
    ${wheel(180, 98)}
    ${wheel(800, 95)}
  </g>`;
}

// Speed lines streaming off the back of the car.
function speedLines() {
  const lines = [
    [-60, 556, 400, 12, C.cream], [40, 586, 320, 8, C.yellow], [-160, 614, 520, 14, C.cream], [100, 642, 260, 7, C.navy],
    [-40, 670, 380, 10, C.cream], [140, 696, 200, 6, C.yellow], [-220, 528, 480, 7, C.red], [60, 504, 300, 6, C.cream],
    [-120, 476, 420, 5, C.yellow], [180, 450, 200, 4, C.cream],
  ];
  return `<g class="po-lines">${lines.map(([x, y, w, h, c]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${c}" opacity="0.9"/>`).join('')}</g>`;
}

function gantry() {
  const xs = [568, 684, 800, 916, 1032];
  const housings = xs.map((x) => `<circle cx="${x}" cy="128" r="44" fill="#070a12"/><circle cx="${x}" cy="128" r="33" fill="#3b1210"/>`).join('');
  const lights = xs
    .map((x, i) => `<g class="po-light" style="animation-delay:${(0.35 + i * 0.55).toFixed(2)}s"><circle cx="${x}" cy="128" r="54" fill="url(#po-glow)"/><circle cx="${x}" cy="128" r="33" fill="#ff2a1f"/><circle cx="${x - 10}" cy="117" r="9" fill="#ffd2c8" opacity="0.8"/></g>`)
    .join('');
  return `<g class="po-gantry">
    <rect x="610" y="0" width="14" height="80" fill="${C.navy}"/><rect x="976" y="0" width="14" height="80" fill="${C.navy}"/>
    <rect x="506" y="78" width="588" height="100" rx="18" fill="${C.navy}"/>
    ${housings}
    <g class="po-lit">${lights}</g>
  </g>`;
}

function title() {
  const t = (fill, dx, dy) => `<text x="${800 + dx}" y="${352 + dy}" text-anchor="middle" font-family="'Saira Condensed', 'Arial Narrow', sans-serif" font-weight="900" font-style="italic" font-size="196" letter-spacing="3" fill="${fill}">LIGHTS OUT</text>`;
  return `<g class="po-title">
    ${t(C.navy, 12, 12)}${t(C.red, 6, 6)}${t(C.cream, 0, 0)}
    <rect x="530" y="384" width="540" height="50" fill="${C.navy}" transform="skewX(-12) translate(84 0)"/>
    <text x="800" y="420" text-anchor="middle" font-family="'Saira Condensed', 'Arial Narrow', sans-serif" font-weight="800" font-size="32" letter-spacing="7" fill="${C.cream}">THE ARCADE GRAND PRIX</text>
  </g>`;
}

export function posterSVG() {
  return `<svg class="poster-art" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="po-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff4d26"/><stop offset="0.45" stop-color="#ff8a2e"/><stop offset="0.66" stop-color="#ffc35c"/>
    </linearGradient>
    <radialGradient id="po-glow"><stop offset="0.45" stop-color="#ff5a3c" stop-opacity="0.9"/><stop offset="1" stop-color="#ff5a3c" stop-opacity="0"/></radialGradient>
    <radialGradient id="po-vignette" cx="0.5" cy="0.5" r="0.75"><stop offset="0.6" stop-color="#3a0d00" stop-opacity="0"/><stop offset="1" stop-color="#3a0d00" stop-opacity="0.35"/></radialGradient>
    <pattern id="po-kerb" width="90" height="34" patternUnits="userSpaceOnUse" patternTransform="skewX(-35)">
      <rect width="45" height="34" fill="${C.red}"/><rect x="45" width="45" height="34" fill="${C.cream}"/>
    </pattern>
    <filter id="po-grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7"/>
      <feColorMatrix values="0 0 0 0 0.25  0 0 0 0 0.12  0 0 0 0 0.05  0 0 0 0.55 0"/>
    </filter>
  </defs>
  <style>
    .po-rays { transform-origin: 1190px 600px; animation: po-spin 60s linear infinite; }
    .po-light { opacity: 0; animation: po-on 0.08s linear forwards; }
    .po-lit { animation: po-off 0.1s linear 3.35s forwards; }
    .po-title { opacity: 0; transform-origin: 800px 330px; animation: po-pop 0.45s cubic-bezier(.2,1.6,.4,1) 3.4s forwards; }
    .po-car { animation: po-launch 0.7s cubic-bezier(.15,.9,.25,1) 3.35s both; }
    .po-lines { transform-origin: 380px 620px; opacity: 0; animation: po-streak 0.6s ease-out 3.35s forwards; }
    @keyframes po-spin { to { transform: rotate(360deg); } }
    @keyframes po-on { to { opacity: 1; } }
    @keyframes po-off { to { opacity: 0; } }
    @keyframes po-pop { from { opacity: 0; transform: scale(0.85); } to { opacity: 1; transform: scale(1); } }
    @keyframes po-launch { from { transform: translateX(-90px); } to { transform: translateX(0); } }
    @keyframes po-streak { from { opacity: 0; transform: scaleX(0.2); } to { opacity: 1; transform: scaleX(1); } }
    @media (prefers-reduced-motion: reduce) {
      .po-rays, .po-light, .po-lit, .po-title, .po-car, .po-lines { animation: none; }
      .po-lit { opacity: 0; }
      .po-title, .po-lines { opacity: 1; transform: none; }
    }
  </style>
  <rect width="1600" height="900" fill="url(#po-sky)"/>
  <g class="po-rays" fill="#fff4dc" opacity="0.16">${rays(1190, 600, 40, 1500)}</g>
  <circle cx="1190" cy="600" r="190" fill="#ffe2a8"/>
  <circle cx="1190" cy="600" r="152" fill="#fff1cf"/>
  <path d="M-10,610 C140,560 260,585 420,548 C560,516 700,560 860,540 C1000,522 1120,566 1260,548 C1400,530 1500,560 1610,540 L1610,640 L-10,640 Z" fill="${C.teal}"/>
  ${poplars()}
  ${grandstand()}
  <rect y="598" width="1600" height="160" fill="#f2c46b"/>
  <g transform="rotate(-4 800 720)">
    <rect x="-300" y="702" width="2200" height="34" fill="url(#po-kerb)"/>
    <rect x="-300" y="736" width="2200" height="400" fill="${C.navy}"/>
    <g fill="${C.cream}" opacity="0.55">${[-200, 160, 520, 880, 1240, 1600].map((x) => `<rect x="${x}" y="850" width="200" height="12" rx="6"/>`).join('')}</g>
    ${speedLines()}
    <g transform="translate(318,658) scale(0.9)">${car()}</g>
  </g>
  ${gantry()}
  ${title()}
  <rect width="1600" height="900" fill="url(#po-vignette)"/>
  <rect width="1600" height="900" filter="url(#po-grain)" opacity="0.5" style="mix-blend-mode:multiply"/>
</svg>`;
}

// Shows the poster over the menu; a tap or key takes it away (then onGone).
export function showPoster(root = document.body, onGone = null) {
  const el = document.createElement('div');
  el.id = 'poster';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Lights Out');
  const touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  el.innerHTML = `${posterSVG()}<div class="poster-go">${touch ? 'Tap to start' : 'Click or press a key'}</div>`;
  root.appendChild(el);
  const go = (e) => {
    if (e && e.type === 'keydown') {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      // The key only takes the poster away (Enter shouldn't start a race too).
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    window.removeEventListener('keydown', go, true);
    el.removeEventListener('click', go);
    el.classList.add('gone');
    if (onGone) onGone();
    setTimeout(() => el.remove(), 450);
  };
  // On click, not pointerdown: once the poster lets taps through, a phone's
  // click after the tap would land on the menu button underneath.
  el.addEventListener('click', go);
  window.addEventListener('keydown', go, true);
  return el;
}
