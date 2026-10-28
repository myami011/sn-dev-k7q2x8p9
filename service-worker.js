/* service-worker.js — 앱 화면 저장 + 오프라인 대비
 *  화면 파일(html·css·js·아이콘): 저장본 먼저 → 빠른 실행
 *  데이터(data/*.json)          : 네트워크 먼저, 실패하면 저장본 → 오프라인에서도 마지막 데이터 표시
 *  75e81d4b2517 은 업로드할 때 내용 지문으로 바뀐다 → 앱이 바뀌면 옛 저장본 자동 삭제
 */
const VERSION = '75e81d4b2517';
const SHELL_CACHE = 'shell-' + VERSION;
const DATA_CACHE = 'data';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/ui.js', 'js/data.js', 'js/app.js',
               'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  if (req.url.includes('/data/')) {               // 데이터: 네트워크 우선
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(DATA_CACHE).then((c) => c.put(req.url, copy)); }
      return res;
    }).catch(() => caches.match(req.url).then((r) => r || Response.error())));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));   // 화면: 저장본 우선
});
