/**
 * Service Worker — met en cache la coquille de l'app pour un usage hors-ligne.
 * Stratégie : cache-first pour les fichiers de l'app, avec repli réseau.
 */

const CACHE_NAME = 'colorscode-v10'; // incrémenté : étalonnage en 2 temps (auto + réglage fin) + alternatives sélectionnables
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/colorMath.js',
  './js/db.js',
  './js/app.js',
  './data/guangna-240.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request)
        .then(response => {
          // Met en cache les nouvelles ressources same-origin récupérées avec succès
          if (response.ok && event.request.url.startsWith(self.location.origin)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
