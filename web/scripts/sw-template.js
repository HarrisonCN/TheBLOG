/* Winston Blog service worker —— 由 scripts/prerender.mjs 生成（__VERSION__ / __BASE__ 会被替换）。
 * 范围只限站点前缀（GitHub Pages 演示版是 /TheBLOG/）；不碰 /admin、/api、/mcp 和跨域请求。
 * - 页面：网络优先（4 秒超时），成功的页面顺手缓存；离线时用缓存，没有缓存就显示 offline.html；
 * - /assets/*（带哈希）：缓存优先；
 * - 字体 / 图片 / 示例照片：先用缓存、后台更新（最多 120 条）。
 */
const VERSION = '__VERSION__';
const BASE = '__BASE__';
const PAGES = `pages-${VERSION}`;
const STATIC = `static-${VERSION}`;
const MEDIA = 'media-v1';
const PRECACHE = [`${BASE}offline.html`, `${BASE}favicon.svg`, `${BASE}manifest.webmanifest`, `${BASE}fonts/serif-core.woff2`, `${BASE}icons/icon-192.png`];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== PAGES && k !== STATIC && k !== MEDIA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function skip(url, req) {
  if (req.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return true;
  const p = url.pathname.slice(BASE.length - 1);
  return /^\/(admin|api|mcp)(\/|$)/.test(p) || /\.(xml|json)$/.test(p) || p === '/sw.js';
}

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function networkFirst(req) {
  const cache = await caches.open(PAGES);
  try {
    const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
    if (res.ok && res.type === 'basic') {
      cache.put(req, res.clone());
      trim(cache, 60);
    }
    return res;
  } catch {
    const hit = (await cache.match(req, { ignoreSearch: true })) || (await caches.match(req, { ignoreSearch: true }));
    if (hit) return hit;
    return (await caches.match(`${BASE}offline.html`)) || new Response('离线中', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(STATIC)).put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(MEDIA);
  const hit = await cache.match(req);
  const update = fetch(req)
    .then((res) => {
      if (res.ok) {
        cache.put(req, res.clone());
        trim(cache, 120);
      }
      return res;
    })
    .catch(() => hit);
  if (hit) {
    event.waitUntil(update);
    return hit;
  }
  return update;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (skip(url, req)) return;
  if (req.mode === 'navigate') return event.respondWith(networkFirst(req));
  const p = url.pathname;
  if (p.startsWith(`${BASE}assets/`)) return event.respondWith(cacheFirst(req));
  if (/\.(woff2?|png|jpe?g|webp|avif|gif|svg)$/.test(p)) return event.respondWith(staleWhileRevalidate(req, event));
});
