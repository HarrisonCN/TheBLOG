#!/usr/bin/env node
/**
 * 构建期预渲染（SSR-safe 回退）：
 * - 从 BLOG_API_URL（例如 https://blog.example.com 或 http://127.0.0.1:8787）拉取数据；
 * - 为首页、关于、标签、每个标签、每篇已发布文章生成带内容的静态 HTML + JSON 快照；
 * - API 不可用时不让构建失败：保留空壳（浏览器端会显示加载状态并在运行时拉取）。
 * - 生成 Cloudflare Pages 的 _headers（CSP 等）。
 * - `--demo`：GitHub Pages 演示版。数据来自浏览器内 mock API 的种子数据（不访问任何服务器），
 *   页面链接带上子路径前缀（BLOG_BASE，默认 /TheBLOG/），并生成 404.html（SPA 回退）、admin/index.html、.nojekyll。
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(root, 'dist');
const ssrOut = join(root, '.ssr');
const DEMO = process.argv.includes('--demo');
const BASE = DEMO ? (process.env.BLOG_BASE ?? '/TheBLOG/') : '/';
const API = (process.env.BLOG_API_URL ?? '').replace(/\/+$/, '');
const API_BASE = (process.env.VITE_API_BASE ?? '').replace(/\/+$/, '');

// 1) 把纯函数视图（以及演示模式的 mock API）编译成 Node 可用的模块
await build({
  root,
  logLevel: 'warn',
  configFile: false,
  build: {
    ssr: true,
    outDir: ssrOut,
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: { input: { render: join(root, 'src/render.ts'), ...(DEMO ? { mock: join(root, 'src/demo/mock-api.ts') } : {}) } },
  },
});
const R = await import(join(ssrOut, 'render.js'));
R.setBasePath(BASE);
const backend = DEMO ? new (await import(join(ssrOut, 'mock.js'))).DemoBackend({ base: BASE }) : null;

async function get(path) {
  if (backend) {
    const res = await backend.handle('GET', path);
    if (res.status !== 200) throw new Error(`${path} → ${res.status}`);
    return res.body;
  }
  const res = await fetch(API + path, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

const template = readFileSync(join(dist, 'index.html'), 'utf8');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// JSON 放在 <script type="application/json"> 中：转义 < 防止 </script> 截断
const jsonForHtml = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// 站点的绝对地址（canonical / Open Graph / sitemap / RSS 需要）：演示版固定为 GitHub Pages，正式站点读 BLOG_SITE_URL
const SITE_URL = (DEMO ? (process.env.BLOG_SITE_URL ?? `https://harrisoncn.github.io${BASE}`) : (process.env.BLOG_SITE_URL ?? '')).replace(/\/?$/, '/');
const HAS_SITE_URL = SITE_URL !== '/';
/** 站内路径（已带部署前缀）→ 绝对地址 */
function absUrl(path) {
  if (!HAS_SITE_URL || !path) return '';
  if (/^https?:\/\//.test(path)) return path;
  const origin = new URL(SITE_URL).origin;
  return origin + (path.startsWith('/') ? path : `/${path}`);
}

/** 每页的 SEO 头：canonical、Open Graph、Twitter 卡片；文章页加 article:* 与 JSON-LD（BlogPosting）。 */
function headMeta(p, data) {
  const s = data.settings;
  const post = p.route.name === 'post' ? data.extra?.post : null;
  const urlPath = R.url(R.routePath(p.route));
  const canonical = absUrl(urlPath);
  const image = absUrl(post?.coverUrl || s.heroImage || '');
  const tags = [
    canonical && `<link rel="canonical" href="${esc(canonical)}" />`,
    `<meta property="og:site_name" content="${esc(s.siteTitle)}" />`,
    `<meta property="og:type" content="${post ? 'article' : 'website'}" />`,
    `<meta property="og:title" content="${esc(post ? post.title : p.title)}" />`,
    `<meta property="og:description" content="${esc(p.description)}" />`,
    canonical && `<meta property="og:url" content="${esc(canonical)}" />`,
    image && `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:locale" content="zh_CN" />`,
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${esc(post ? post.title : p.title)}" />`,
    `<meta name="twitter:description" content="${esc(p.description)}" />`,
    image && `<meta name="twitter:image" content="${esc(image)}" />`,
  ];
  if (post) {
    const pub = post.publishedAt ?? post.createdAt;
    tags.push(`<meta property="article:published_time" content="${esc(pub)}" />`, `<meta property="article:modified_time" content="${esc(post.updatedAt ?? pub)}" />`);
    if (post.category) tags.push(`<meta property="article:section" content="${esc(post.category)}" />`);
    for (const t of post.tags ?? []) tags.push(`<meta property="article:tag" content="${esc(t)}" />`);
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description: p.description,
      datePublished: pub,
      dateModified: post.updatedAt ?? pub,
      author: { '@type': 'Person', name: data.profile?.name ?? s.siteTitle },
      ...(image ? { image } : {}),
      ...(canonical ? { mainEntityOfPage: canonical, url: canonical } : {}),
      keywords: (post.tags ?? []).join(', '),
      inLanguage: 'zh-CN',
    };
    tags.push(`<script type="application/ld+json">${jsonForHtml(ld)}</script>`);
  }
  tags.push(`<link rel="manifest" href="${BASE}manifest.webmanifest" />`, `<meta name="theme-color" content="#2563eb" media="(prefers-color-scheme: light)" />`, `<meta name="theme-color" content="#0b111c" media="(prefers-color-scheme: dark)" />`, `<link rel="apple-touch-icon" href="${BASE}icons/icon-192.png" />`);
  if (HAS_SITE_URL) tags.push(`<link rel="alternate" type="application/rss+xml" title="${esc(s.siteTitle)}" href="${BASE}rss.xml" />`);
  return tags.filter(Boolean).join('\n    ');
}

function page(p, data) {
  const s = data.settings;
  const html = template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(p.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${esc(p.description)}" />`)
    .replace('data-site-theme="system"', `data-site-theme="${esc(s.theme)}"`)
    .replace('<!--blog:head-->', headMeta(p, data))
    .replace('<!--blog:app-->', R.appHtml(data, p))
    // 演示版的数据以访客浏览器为准，不嵌入快照
    .replace('<!--blog:data-->', DEMO ? '' : `<script type="application/json" id="blog-data">${jsonForHtml(data)}</script>`);
  return html;
}

function write(rel, html) {
  const file = join(dist, rel, 'index.html');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

let ok = false;
let count = 0;
const sitemap = [];
const shell = template.replace('<!--blog:app-->', '').replace('<!--blog:data-->', '');
const soft = (p, fallback) => get(p).catch(() => fallback);
if (API || DEMO) {
  try {
    const [settings, profile, list, tags, cats] = await Promise.all([get('/api/settings'), get('/api/profile'), get('/api/posts?limit=100'), get('/api/tags'), soft('/api/categories', { categories: [] })]);
    const site = { settings, profile, posts: list.posts, total: list.total, tags: tags.tags, categories: cats.categories, festivals: (await soft('/api/festivals', { festivals: [] })).festivals };
    const extra = {
      gallery: (await soft('/api/content/gallery', { items: [] })).items,
      friends: (await soft('/api/content/friends', { items: [] })).items,
      favorites: (await soft('/api/content/favorites', { items: [] })).items,
      projects: (await soft('/api/projects', { items: [] })).items,
      guestbook: (await soft('/api/guestbook', { entries: [] })).entries,
      notes: (await soft('/api/notes', { notes: [] })).notes,
      members: (await soft('/api/members', { members: [] })).members,
    };
    for (const k of ['now', 'works', 'gear', 'shelf', 'timeline', 'changelog', 'repos']) extra[k] = (await soft(`/api/content/${k}`, { items: [] })).items;
    // 每个页面只嵌入它需要的额外数据
    const emit = (route, x = {}) => {
      const want = R.needs(route);
      const ex = Object.fromEntries(Object.entries({ ...extra, ...x }).filter(([k]) => want.includes(k)));
      const p = R.renderRoute(route, site, ex);
      const rel = decodeURIComponent(R.routePath(route)).replace(/^\/|\/$/g, '');
      write(rel, page(p, { ...site, extra: ex }));
      count++;
      if (route.name !== 'notfound') sitemap.push({ loc: R.url(R.routePath(route)), lastmod: route.name === 'post' ? (ex.post?.updatedAt ?? ex.post?.publishedAt ?? null) : null, prio: route.name === 'home' && route.page === 1 ? '1.0' : route.name === 'post' ? '0.8' : '0.5' });
    };
    const per = Math.max(1, settings.postsPerPage);
    const pages = Math.max(1, Math.ceil(site.posts.length / per));
    for (let n = 1; n <= pages; n++) emit({ name: 'home', page: n });
    for (const name of ['archives', 'tags', 'categories', 'gallery', 'favorites', 'guestbook', 'links', 'about', 'privacy', 'join', 'mailbox', ...R.SECTION_ROUTES]) emit({ name });
    // 订阅源：RSS 2.0 + JSON Feed（需要站点的绝对地址：演示版固定为 GitHub Pages，正式站点读 BLOG_SITE_URL）
    const siteUrl = HAS_SITE_URL ? SITE_URL : '';
    if (siteUrl) {
      const feed = { title: settings.siteTitle, description: settings.siteDescription, siteUrl, posts: list.posts };
      writeFileSync(join(dist, 'rss.xml'), R.rssXml(feed));
      writeFileSync(join(dist, 'feed.json'), R.jsonFeed(feed));
    } else {
      console.warn('[prerender] 未设置 BLOG_SITE_URL（站点的绝对地址），跳过 rss.xml / feed.json。');
    }
    // Pages 按解码后的路径查找文件；含路径分隔符或以 . 开头的标签 / 分类不生成静态页（浏览器端回退渲染）
    for (const t of site.tags) if (!/[\/\\]|^\./.test(t.tag)) emit({ name: 'tag', tag: t.tag });
    for (const c of site.categories) if (!/[\/\\]|^\./.test(c.category)) emit({ name: 'category', category: c.category });
    for (const a of extra.gallery) emit({ name: 'album', slug: a.slug });
    for (const s of list.posts) emit({ name: 'post', slug: s.slug }, { post: await get(`/api/posts/${s.slug}`) });
    ok = true;
  } catch (e) {
    if (DEMO) throw e;
    console.warn(`[prerender] 无法从 ${API} 获取数据（${e.message}），使用空壳回退。`);
  }
} else {
  console.warn('[prerender] 未设置 BLOG_API_URL，跳过内容预渲染（页面将在浏览器中加载数据）。');
}
if (!ok) {
  // 空壳：保持模板，浏览器端显示加载骨架并调用 API
  writeFileSync(join(dist, 'index.html'), shell);
}

// ---- PWA：manifest、离线页、service worker（范围 = 部署前缀） ----
{
  const s = ok ? (await get('/api/settings').catch(() => null)) : null;
  const title = s?.siteTitle ?? 'Winston Blog';
  const manifest = {
    name: title,
    short_name: title.length > 12 ? title.slice(0, 12) : title,
    description: s?.siteDescription ?? '',
    lang: 'zh-CN',
    start_url: BASE,
    scope: BASE,
    display: 'standalone',
    background_color: '#eef3fa',
    theme_color: '#2563eb',
    icons: [
      { src: `${BASE}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${BASE}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
      { src: `${BASE}icons/icon-512-maskable.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  writeFileSync(join(dist, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));
  writeFileSync(
    join(dist, 'offline.html'),
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>离线中 · ${esc(title)}</title><link rel="icon" href="${BASE}favicon.svg" type="image/svg+xml"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.7 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#eef3fa;color:#1e293b}main{max-width:26rem;margin:1rem;padding:2rem 1.6rem;border-radius:20px;background:#fff;box-shadow:0 8px 26px -14px rgb(20 40 90 / .25);text-align:center}h1{margin:.4rem 0;font-size:1.5rem}p{color:#5d6879}a{display:inline-block;margin-top:.6rem;padding:.55rem 1.1rem;border-radius:12px;background:#2563eb;color:#fff;text-decoration:none}@media (prefers-color-scheme:dark){body{background:#0b111c;color:#e2e8f0}main{background:#131b2a}p{color:#9aa6ba}a{background:#6b97ff;color:#0b111c}}</style></head><body><main><svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M2 8.8a15 15 0 0 1 20 0M5 12.6a10 10 0 0 1 14 0M8.5 16.4a5 5 0 0 1 7 0"/><path d="M3 3l18 18"/><circle cx="12" cy="20" r="1"/></svg><h1>现在没有网络</h1><p>这一页还没有缓存在本机。之前看过的页面离线也能打开；联网后再试一次吧。</p><a href="${BASE}">回到首页</a></main></body></html>`,
  );
  const version = createHash('sha256').update(readFileSync(join(dist, 'index.html'))).update(String(count)).digest('hex').slice(0, 12);
  writeFileSync(join(dist, 'sw.js'), readFileSync(join(here, 'sw-template.js'), 'utf8').replaceAll('__VERSION__', version).replaceAll('__BASE__', BASE));
}
// ---- sitemap.xml + robots.txt（需要站点绝对地址） ----
if (ok && HAS_SITE_URL) {
  const seen = new Set();
  const urls = sitemap.filter((u) => !seen.has(u.loc) && seen.add(u.loc));
  const xmlEsc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  writeFileSync(
    join(dist, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${xmlEsc(absUrl(encodeURI(decodeURI(u.loc))))}</loc>${u.lastmod ? `<lastmod>${xmlEsc(String(u.lastmod).slice(0, 10))}</lastmod>` : ''}<priority>${u.prio}</priority></url>`)
      .join('\n')}\n</urlset>\n`,
  );
  writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nAllow: ${BASE}\nDisallow: ${BASE}admin/\nSitemap: ${absUrl(`${BASE}sitemap.xml`)}\n`);
}

if (DEMO) {
  // GitHub Pages：未知路径（例如访客在本地新建的文章）由 404.html 交给前端路由渲染
  writeFileSync(join(dist, '404.html'), shell);
  // /TheBLOG/admin/ → 后台
  mkdirSync(join(dist, 'admin'), { recursive: true });
  writeFileSync(join(dist, 'admin', 'index.html'), readFileSync(join(dist, 'admin.html'), 'utf8'));
  cpSync(join(root, 'demo-assets'), join(dist, 'demo'), { recursive: true });
  writeFileSync(join(dist, '.nojekyll'), '');
  if (existsSync(ssrOut)) rmSync(ssrOut, { recursive: true, force: true });
  console.log(`[prerender] 演示版（base ${BASE}）：已预渲染 ${count} 个页面；404.html、admin/、demo/ 已写入。`);
  process.exit(0);
}

// 2) Cloudflare Pages 响应头
// api.github.com：开源项目页从 GitHub 公开 API 刷新星标数（只读、匿名）
// 书影音后台：Open Library 搜书找封面（匿名只读，允许 CORS）
// 音乐小部件的搜索：Openverse / Internet Archive（完整 CC 曲目）+ iTunes Search（30 秒试听），都是匿名只读的公开 API
const connect = ["'self'", API_BASE && new URL(API_BASE).origin, 'https://api.github.com', 'https://api.openverse.org', 'https://archive.org', 'https://itunes.apple.com', 'https://openlibrary.org'].filter(Boolean).join(' ');
// 音频来自上面这些来源的 CDN（jamendo、archive.org 镜像、Apple 预览……）或站长填的 https 链接，所以 media-src 放开 https:
const media = ["'self'", 'blob:', 'data:', 'https:'].join(' ');
const img = ["'self'", 'https:', 'data:'].join(' ');
writeFileSync(
  join(dist, '_headers'),
  `/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src ${img}; connect-src ${connect}; font-src 'self'; media-src ${media}; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(self), display-capture=(self), geolocation=()
  X-Frame-Options: DENY
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/sw.js
  Cache-Control: no-cache
/admin*
  Cache-Control: no-store
  X-Robots-Tag: noindex, nofollow
`,
);
if (existsSync(ssrOut)) rmSync(ssrOut, { recursive: true, force: true });
console.log(`[prerender] ${ok ? `已预渲染 ${count} 个页面` : '已生成空壳'}；_headers 已写入。`);
