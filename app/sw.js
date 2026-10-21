// SH STOCK 서비스워커 — 앱 화면은 캐시해 빠르게 열고, 데이터는 항상 최신본을 먼저 시도(실패 시 마지막 캐시로 오프라인 표시)
const CACHE = "sh-stock-v1";
const SHELL = ["./", "index.html", "styles.css", "engine.js", "app.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];
const DATA = /\/(data|news|verify)\.js$/;

self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const key = url.origin + url.pathname;  // 캐시 우회용 ?t= 파라미터 무시
  // 데이터·앱 코드: 네트워크 우선 → 실패 시 캐시
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
      return res;
    }).catch(() => caches.match(key).then(r => r || caches.match(url.pathname.endsWith("/") ? "index.html" : key)))
  );
});
