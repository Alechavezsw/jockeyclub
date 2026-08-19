const CACHE_NAME = 'jockey-club-sj-cache-v25';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/perfil',
  '/cuenta',
  '/reservas',
  '/favicon.svg',
  '/logo-jockey-club.png',
  '/manifest.json'
];

// Instalar el Service Worker y almacenar recursos base en caché
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activar y limpiar cachés antiguas
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Estrategia network-first: siempre intenta la red (la app se actualiza al
// instante) y usa la caché solo como fallback offline.
self.addEventListener('fetch', (e) => {
  if (!e.request.url.startsWith('http') || e.request.method !== 'GET') return;

  // Nunca interceptar APIs externas (Supabase auth/rest rompe con SW agresivo)
  try {
    const host = new URL(e.request.url).hostname;
    if (host.includes('supabase.co') || host.includes('supabase.in')) return;
  } catch {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, responseToCache));
        }
        return networkResponse;
      })
      .catch(() =>
        caches.match(e.request).then((cached) => {
          if (cached) return cached;
          // Fallback offline para navegación de página
          if (e.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        })
      )
  );
});
