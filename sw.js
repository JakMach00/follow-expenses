const CACHE_NAME = 'wydatki-shell-v2';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './firebase-init.js',
  './manifest.json'
];

self.addEventListener('install', (event)=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache=> cache.addAll(SHELL))
      .then(()=> self.skipWaiting())
  );
});

self.addEventListener('activate', (event)=>{
  event.waitUntil(
    caches.keys()
      .then(keys=> Promise.all(keys.filter(k=> k!==CACHE_NAME).map(k=> caches.delete(k))))
      .then(()=> self.clients.claim())
  );
});

self.addEventListener('fetch', (event)=>{
  const req = event.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);
  // Tylko zasoby z naszej domeny. Firebase/gstatic obsługują się same.
  if(url.origin !== self.location.origin) return;

  // Nawigacje (otwarcie aplikacji) - najpierw cache, fallback do index.
  if(req.mode === 'navigate'){
    event.respondWith(
      caches.match('./index.html').then(cached=> cached || fetch(req))
    );
    return;
  }

  // Pozostałe zasoby shell - cache-first z dołożeniem do cache w tle.
  event.respondWith(
    caches.match(req).then(cached=>{
      if(cached) return cached;
      return fetch(req).then(res=>{
        if(res && res.status === 200 && res.type === 'basic'){
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c=> c.put(req, copy));
        }
        return res;
      }).catch(()=> cached);
    })
  );
});
