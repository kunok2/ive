const CACHE_NAME = 'ive-v2';
const STATIC_ASSETS = [
  '/icon-192.svg',
  '/icon-512.svg',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // API/WebSocket은 패스
  if (
    req.url.includes('/api/') ||
    req.url.includes('ws://') ||
    req.url.includes('wss://')
  ) {
    return;
  }

  // HTML 문서(페이지 네비게이션)는 항상 네트워크. 오프라인이면 짧은 안내.
  // 캐시된 HTML이 옛 _next 청크 해시를 참조해 JS 로드 실패로 화면이 멈추는 문제 방지.
  if (req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept')?.includes('text/html'))) {
    event.respondWith(
      fetch(req).catch(() => new Response('<!doctype html><meta charset="utf-8"><title>Offline</title><p>네트워크 연결을 확인해주세요.', {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }))
    );
    return;
  }

  // 정적 자산: 네트워크 우선, 실패 시 캐시
  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      })
      .catch(() => caches.match(req).then((r) => r || new Response('', { status: 503 })))
  );
});
