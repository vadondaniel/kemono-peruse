const CACHE_VERSION = "v1";
const APP_CACHE = `kemono-peruse-app-${CACHE_VERSION}`;
const RUNTIME_CACHE = `kemono-peruse-runtime-${CACHE_VERSION}`;
const API_CACHE = `kemono-peruse-api-${CACHE_VERSION}`;
const ICON_CACHE = `kemono-peruse-icons-${CACHE_VERSION}`;
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon.png",
  "./pwa-192.png",
  "./pwa-512.png",
];

const cacheable = (response) => response && (response.ok || response.type === "opaque");

const trimCache = async (cacheName, maxEntries) => {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((request) => cache.delete(request)));
};

const putInCache = async (cacheName, request, response, maxEntries) => {
  if (!cacheable(response)) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  if (maxEntries) {
    await trimCache(cacheName, maxEntries);
  }
};

const cacheFirst = async (cacheName, request, maxEntries) => {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  await putInCache(cacheName, request, response, maxEntries);
  return response;
};

const networkFirst = async (cacheName, request, maxEntries) => {
  try {
    const response = await fetch(request);
    await putInCache(cacheName, request, response, maxEntries);
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  const expectedCaches = new Set([APP_CACHE, RUNTIME_CACHE, API_CACHE, ICON_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(cacheNames.map((cacheName) => (expectedCaches.has(cacheName) ? null : caches.delete(cacheName)))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isKemonoProxy = sameOrigin && url.pathname.startsWith("/api/proxy/kemono");
  const isKemonoMedia = isKemonoProxy && url.pathname.startsWith("/api/proxy/kemono/media");
  const isKemonoIcon = url.origin === "https://img.kemono.cr" && url.pathname.startsWith("/icons/");

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("./index.html").then((response) => response || caches.match("./"))),
    );
    return;
  }

  if (isKemonoMedia) return;

  if (isKemonoProxy) {
    event.respondWith(networkFirst(API_CACHE, request, 200));
    return;
  }

  if (isKemonoIcon) {
    event.respondWith(cacheFirst(ICON_CACHE, request, 300));
    return;
  }

  if (sameOrigin) {
    event.respondWith(cacheFirst(RUNTIME_CACHE, request, 150));
  }
});
