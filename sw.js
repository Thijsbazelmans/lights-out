// Offline support. Network first, so a new version you push to GitHub shows up
// the next time the game is opened online; the cached copy is the fallback
// when there's no connection.
//
// GitHub Pages lets browsers reuse files for 10 minutes without asking. Every
// request here checks with the server instead ('no-cache'), otherwise a phone
// can end up with a mix of old and new files right after an update.
//
// Release checklist: bump CACHE here, BUILD in js/main.js and --build in
// css/style.css together.

const CACHE = 'lights-out-v25';
const CORE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/main.js',
  'js/util.js',
  'js/storage.js',
  'js/input.js',
  'js/audio.js',
  'js/car.js',
  'js/track.js',
  'js/ai.js',
  'js/particles.js',
  'js/camera.js',
  'js/race.js',
  'js/pit.js',
  'js/quali.js',
  'js/hud.js',
  'js/ui.js',
  'js/season.js',
  'js/data/tracks.js',
  'js/data/teams.js',
  'js/data/circuits/interlagos.js',
  'js/data/circuits/monaco.js',
  'js/data/circuits/zandvoort.js',
  'js/data/circuits/suzuka.js',
  'js/data/circuits/lasvegas.js',
  'js/data/circuits/silverstone.js',
  'js/data/circuits/spa.js',
  'js/data/circuits/baku.js',
  'js/data/circuits/monza.js',
  'js/data/circuits/sepang.js',
  'js/data/circuits/singapore.js',
  'js/data/circuits/miami.js',
  'js/data/circuits/melbourne.js',
  'js/data/circuits/shanghai.js',
  'js/data/circuits/bahrain.js',
  'js/data/circuits/jeddah.js',
  'js/data/circuits/montreal.js',
  'js/data/circuits/barcelona.js',
  'js/data/circuits/austria.js',
  'js/data/circuits/hungary.js',
  'js/data/circuits/austin.js',
  'js/data/circuits/mexico.js',
  'js/data/circuits/qatar.js',
  'js/data/circuits/abudhabi.js',
  'js/data/circuits/madrid.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !fonts) return;

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetchWithTimeout(sameOrigin ? fetch(req.url, { cache: 'no-cache' }) : fetch(req), 6000);
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      } catch (err) {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === 'navigate') return cache.match('index.html');
        throw err;
      }
    })()
  );
});

function fetchWithTimeout(pending, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    pending.then(
      (r) => {
        clearTimeout(t);
        resolve(r);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}
