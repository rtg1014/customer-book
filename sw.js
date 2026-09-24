// 오프라인 동작용 서비스 워커.
// 인터넷이 되면 항상 서버의 최신 파일을 먼저 받고(받으면서 저장해 둠),
// 인터넷이 안 되면 저장해 둔 파일로 엽니다.
// 앱 파일을 고쳐서 다시 올릴 때는 아래 VERSION 숫자도 올려 주세요.
const VERSION = 'v1.3.3';
const CACHE = 'customer-book-' + VERSION;
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './xlsx-lite.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' → 브라우저에 남아 있는 옛 파일이 아니라 서버의 최신 파일을 받아 저장
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('customer-book-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const key = req.mode === 'navigate' ? './index.html' : req;
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(key, copy));
        }
        return res;
      })
      .catch(() => caches.match(key, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
