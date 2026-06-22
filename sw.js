const VERSION = '__BUILD__';
const CACHE_NAME = 'wydatki-shell-' + VERSION;
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './firebase-init.js',
  './manifest.json'
];
const NET_TIMEOUT = 3500;

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

self.addEventListener('message', (event)=>{
  if(event.data === 'SKIP_WAITING') self.skipWaiting();
});

function fromNetwork(req){
  return new Promise((resolve, reject)=>{
    const timer = setTimeout(reject, NET_TIMEOUT);
    fetch(req, {cache:'no-cache'}).then(
      res=>{ clearTimeout(timer); resolve(res); },
      ()=>{ clearTimeout(timer); reject(); }
    );
  });
}

self.addEventListener('fetch', (event)=>{
  const req = event.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;

  event.respondWith((async ()=>{
    try{
      const res = await fromNetwork(req);
      if(res && res.status === 200 && res.type === 'basic'){
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c=> c.put(req, copy));
      }
      return res;
    }catch(_){
      const cached = await caches.match(req);
      if(cached) return cached;
      if(req.mode === 'navigate'){
        const idx = await caches.match('./index.html');
        if(idx) return idx;
      }
      return Response.error();
    }
  })());
});
