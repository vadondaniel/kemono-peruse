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
  "./pwa-maskable-192.png",
  "./pwa-maskable-512.png",
];

const cacheable = (response) => response && (response.ok || response.type === "opaque");
const contentTypeOf = (response) => (response?.headers?.get("content-type") || "").toLowerCase();
const isJavaScriptType = (contentType) =>
  contentType.includes("javascript") || contentType.includes("ecmascript") || contentType.includes("module");

const shouldCacheResponse = (request, response) => {
  if (!cacheable(response)) return false;
  if (response.type === "opaque") return true;

  const contentType = contentTypeOf(response);

  // Prevent cache poisoning from SPA fallbacks rewriting missing JS/CSS URLs to index.html.
  if (request.mode !== "navigate" && contentType.includes("text/html")) return false;

  switch (request.destination) {
    case "script":
    case "worker":
      return isJavaScriptType(contentType);
    case "style":
      return contentType.includes("text/css");
    case "image":
      return contentType.startsWith("image/");
    case "font":
      return contentType.startsWith("font/") || contentType.includes("application/font");
    default:
      return true;
  }
};

const trimCache = async (cacheName, maxEntries) => {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((request) => cache.delete(request)));
};

const putInCache = async (cacheName, request, response, maxEntries) => {
  if (!shouldCacheResponse(request, response)) return;
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
