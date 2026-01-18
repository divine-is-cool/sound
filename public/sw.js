const STATIC_CACHE = "soundboard-static-v1";
const PREVIEW_CACHE = "sound-previews-v1";

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js"
];

// Install: cache app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: cleanup old caches if needed
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Fetch: cache-first for previews, stale-while-revalidate-ish for static
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Preview audio caching: /api/sound/:id/preview
  if (url.pathname.startsWith("/api/sound/") && url.pathname.endsWith("/preview")) {
    event.respondWith(cacheFirst(req, PREVIEW_CACHE));
    return;
  }

  // Static assets
  if (STATIC_ASSETS.includes(url.pathname) || url.pathname === "/") {
    event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
    return;
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: false });
  if (cached) return cached;

  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (e) {
    // offline and no cache
    return new Response("Offline and not cached", { status: 503 });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: false });

  const fetchPromise = fetch(request)
    .then((fresh) => {
      if (fresh && fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    })
    .catch(() => null);

  return cached || (await fetchPromise) || new Response("Offline", { status: 503 });
}
