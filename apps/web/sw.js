/* Borealos PWA Service Worker（最小可用）
   原则：API 不缓存直连网络；页面/静态资源网络优先、缓存兜底（离线可开壳） */
const CACHE = "borealos-shell-v1";
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/gateway")) return; // API/WS 不干预
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((r) => { const c = r.clone(); caches.open(CACHE).then((ca) => ca.put("/", c)); return r; })
        .catch(() => caches.match("/"))
    );
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok && url.origin === location.origin) {
          const c = r.clone();
          caches.open(CACHE).then((ca) => ca.put(e.request, c));
        }
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
