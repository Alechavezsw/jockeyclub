const CACHE_NAME = 'jockey-club-sj-cache-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/Gemini_Generated_Image_n1d2h3n1d2h3n1d2.png',
  '/manifest.json'
];

// Instalar el Service Worker y almacenar recursos en caché
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

// Interceptar peticiones y servir desde caché
self.addEventListener('fetch', (e) => {
  // Solo procesar peticiones HTTP/HTTPS (ignorar extensiones chrome-extension u otros esquemas)
  if (!e.request.url.startsWith('http')) return;

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Devolver respuesta cacheada, pero intentar actualizarla en segundo plano para la próxima visita
        fetch(e.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, networkResponse));
          }
        }).catch(() => {/* Silenciar errores de red en offline */});
        
        return cachedResponse;
      }

      // Si no está en caché, intentar por red
      return fetch(e.request).then((response) => {
        // Cachear dinámicamente respuestas válidas de assets
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseToCache);
          });
        }
        return response;
      }).catch(() => {
        // Fallback offline para navegación de página
        if (e.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
