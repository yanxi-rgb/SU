// 离线快取：只缓存程序本身（内容与进度在 IndexedDB，加密）。改版时把 VER 加一。
const VER = 'pb-1.3.2';
const SHELL = ['./', 'index.html', 'style.css', 'js/ui.js', 'js/engine.js', 'js/vault.js', 'js/minigame.js', 'js/hypno.js',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

// 安装时绕过浏览器的 HTTP 缓存，免得把旧档装进新版
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(cs => cs.length ? cs[0].focus() : self.clients.openWindow('./')));
});
