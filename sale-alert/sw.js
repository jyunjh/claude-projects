/* ネットワーク優先・オフライン時だけキャッシュ。
   キャッシュ優先にすると更新直後に古い app.js と新しい match.js が混ざることがあるため、本体もデータも同じ扱いにする。 */
var CACHE = 'sale-alert-v2';
var SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'match.js', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Apps Script 等は素通し
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(function (r) {
    if (r.ok) {
      var copy = r.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
    }
    return r;
  }).catch(function () {
    return caches.match(e.request, { ignoreSearch: true });
  }));
});
