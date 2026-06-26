/* MacroMax service worker — network-first, falls back to cache when offline.
   This lets the app keep working with no connection after the first visit.
   Bump CACHE when you change the app files to force a refresh. */
const CACHE = "macromax-v1";
const ASSETS = [
  "./", "./index.html", "./styles.css", "./data.js", "./app.js",
  "./manifest.webmanifest", "./icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return resp;
      })
      .catch(() =>
        // ignoreSearch so deep links like ?do=food still match the cached page offline
        caches.match(e.request, { ignoreSearch: true }).then((c) => c || caches.match("./index.html"))
      )
  );
});
