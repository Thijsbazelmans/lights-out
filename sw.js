// Offline support. Network first, so a new version you push to GitHub shows up
// the next time the game is opened online; the cached copy is the fallback
// when there's no connection.

const CACHE = 'lights-out-v2';
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
  'js/hud.js',
  'js/ui.js',
  'js/data/tracks.js',
  'js/data/turtle.js',
  'js/data/drivers.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(CORE))
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
        const res = await fetchWithTimeout(req, 4000);
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

function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then(
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
