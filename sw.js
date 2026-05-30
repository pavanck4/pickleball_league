const CACHE_NAME = 'courtiq-v2';
const ASSETS = ['/', '/index.html', '/style.css', '/app.v3.js', '/manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  
  // Never intercept Firebase auth requests
  const url = event.request.url;
  if (url.includes('firestore') || 
      url.includes('firebase') || 
      url.includes('googleapis') ||
      url.includes('gstatic') ||
      url.includes('accounts.google') ||
      url.includes('/__/auth/')) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request).then(r => r || caches.match('/index.html')))
  );
});
