// Service worker for "Wydatki" - caches the app shell (HTML + the Firebase
// SDK module files) so the page itself loads with zero connectivity.
// It deliberately does NOT touch Firebase/Google API network calls -
// those are handled by Firestore's own offline queue (IndexedDB), and
// intercepting them here would only get in the way.

const CACHE_NAME = 'wydatki-shell-v1';
const SHELL_FILES = ['./', './index.html', './manifest.json', './style.css', './app.js', './firebase-init.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

function isFirebaseBackendCall(url) {
  return url.includes('googleapis.com') ||
         url.includes('firebaseio.com') ||
         url.includes('google.com/recaptcha') ||
         url.includes('gstatic.com/recaptcha');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept writes
  if (isFirebaseBackendCall(req.url)) return; // let Firestore/Auth manage their own network calls

  event.respondWith(
    caches.match(req).then(cached => {
      const networkFetch = fetch(req).then(resp => {
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => cached);
      // Cache-first for instant offline loads; refresh the cache in the background when online.
      return cached || networkFetch;
    })
  );
});
