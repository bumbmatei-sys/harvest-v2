/* Only these public files are ever stored. Navigation and API responses are never cached. */
const CACHE = "harvest-offline-v2";
const STATIC = ["/offline.html", "/offline.css", "/icons/icon-192.png", "/icons/icon-512.png"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("harvest-offline-") && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await caches.open(CACHE)).match("/offline.html")));
  } else if (STATIC.includes(new URL(request.url).pathname) && !new URL(request.url).search) {
    event.respondWith(caches.open(CACHE).then(async (cache) => (await cache.match(request)) || fetch(request)));
  }
});
