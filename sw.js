importScripts("version.js"); // defines self.SO_VERSION
const CACHE_NAME = "special-owner-v" + self.SO_VERSION;
const APP_SHELL = [
  "index.html",
  "resident.html",
  "admin.html",
  "worker.html",
  "style.css",
  "i18n.js",
  "version.js",
  "qrcode.min.js",
  "html5-qrcode.min.js",
  "manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first: always try to fetch the latest version from the server first.
// Only fall back to the cached copy if the network request fails (offline).
// This prevents the app from getting stuck showing an old cached version
// after new files are deployed.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // Announcement photos/videos live on Firebase Storage: let the browser handle them
  // directly (no caching of large files, and video playback uses Range requests).
  if (event.request.url.includes("firebasestorage.googleapis.com") || event.request.headers.has("range")) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
