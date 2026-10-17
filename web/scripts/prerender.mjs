#!/usr/bin/env node
/**
 * 构建期预渲染（SSR-safe 回退）：
 * - 从 BLOG_API_URL（例如 https://blog.example.com 或 http://127.0.0.1:8787）拉取数据；
 * - 为首页、关于、标签、每个标签、每篇已发布文章生成带内容的静态 HTML + JSON 快照；
 * - 文章按游标逐页拉取（没有篇数上限），每篇文章页、分页列表页（/page/2/ …）、sitemap、RSS 都包含全部文章。
 * - 严格模式（NODE_ENV=production、PRERENDER_STRICT=1 或 --strict；CI / Pages / 正式部署都开着）：
 *   API 不可达、任何页面失败、或预渲染的文章页数 ≠ API 的 total，都让构建失败（退出码 1）。
 * - 宽松模式（只给本地开发）：API 不可用时保留空壳并大声警告（浏览器端会在运行时拉取）。
 * - 生成 Cloudflare Pages 的 _headers（CSP 等）。
 * - `--demo`：GitHub Pages 演示版。数据来自浏览器内 mock API 的种子数据（不访问任何服务器），
 *   页面链接带上子路径前缀（BLOG_BASE，默认 /TheBLOG/），并生成 404.html（SPA 回退）、admin/index.html、.nojekyll。
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { createHash } from 'node:crypto';
import { fetchAllPosts, isStrict, verifyCounts } from './prerender-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = process.env.PRERENDER_DIST ? process.env.PRERENDER_DIST : join(root, 'dist');
const ssrOut = process.env.PRERENDER_SSR_OUT ? process.env.PRERENDER_SSR_OUT : join(root, '.ssr');
const DEMO = process.argv.includes('--demo');
const STRICT = isStrict(process.argv, process.env);
/** 测试 / E2E：演示数据后追加 n 篇夹具文章（正式演示站为 0） */
const FIXTURE_POSTS = Number(process.env.DEMO_FIXTURE_POSTS ?? 0) || 0;
const fail = (msg) => {
  console.error(`\n[prerender] ✖ 严格模式失败：${msg}\n`);
  if (existsSync(ssrOut)) rmSync(ssrOut, { recursive: true, force: true });
  process.exit(1);
};
const loud = (msg) => console.warn(`\n${'!'.repeat(72)}\n[prerender] ⚠ ${msg}\n[prerender] ⚠ 宽松模式（仅本地开发）：生成空壳 / 跳过失败页，构建不会失败。\n[prerender] ⚠ 正式构建请设置 PRERENDER_STRICT=1（或 NODE_ENV=production / --strict）。\n${'!'.repeat(72)}\n`);
console.log(`[prerender] 模式：${STRICT ? '严格（任何失败都会让构建失败）' : '宽松（本地开发）'}${DEMO ? '，演示版' : ''}${FIXTURE_POSTS ? `，夹具文章 ${FIXTURE_POSTS} 篇` : ''}`);
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
const backend = DEMO ? new (await import(join(ssrOut, 'mock.js'))).DemoBackend({ base: BASE, fixturePosts: FIXTURE_POSTS }) : null;

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
/** L20：每个创作者 / 话题 / 项目的订阅源地址（演示版 = 构建时生成的静态文件；正式站 = Worker 动态源） */
const feedHref = (scope, fmt) => R.feedPath(scope, fmt, { apiBase: DEMO ? null : API_BASE, base: BASE });
const FEED_MIME = { rss: 'application/rss+xml', atom: 'application/atom+xml', json: 'application/feed+json' };
const FEED_NAME = { rss: 'RSS', atom: 'Atom', json: 'JSON Feed' };
function headMeta(p, data, share) {
  const s = data.settings;
  const post = p.route.name === 'post' ? data.extra?.post : null;
  const urlPath = R.url(R.routePath(p.route));
  const canonical = absUrl(urlPath);
  const image = absUrl(post?.coverUrl || share?.image || s.heroImage || '');
  const title = post ? post.title : (share?.title ?? p.title);
  const desc = share?.description || p.description;
  const tags = [
    canonical && `<link rel="canonical" href="${esc(canonical)}" />`,
    `<meta property="og:site_name" content="${esc(s.siteTitle)}" />`,
    `<meta property="og:type" content="${post || share?.type === 'article' ? 'article' : share?.type === 'profile' ? 'profile' : 'website'}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    canonical && `<meta property="og:url" content="${esc(canonical)}" />`,
    image && `<meta property="og:image" content="${esc(image)}" />`,
    image && share?.imageAlt ? `<meta property="og:image:alt" content="${esc(share.imageAlt)}" />` : '',
    `<meta property="og:locale" content="zh_CN" />`,
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(desc)}" />`,
    image && `<meta name="twitter:image" content="${esc(image)}" />`,
  ];
  // L20 订阅源自动发现：创作者 / 话题 / 项目页带上各自的源
  const scope = p.route.name === 'user' ? { kind: 'user', ref: p.route.username } : p.route.name === 'topic' ? { kind: 'topic', ref: p.route.slug } : p.route.name === 'project' ? { kind: 'project', ref: p.route.slug } : null;
  if (scope && (!DEMO || feedScopes?.[`${scope.kind}s`]?.includes(scope.ref))) for (const f of ['rss', 'atom', 'json']) tags.push(`<link rel="alternate" type="${FEED_MIME[f]}" title="${esc(`${share?.title ?? scope.ref}（${FEED_NAME[f]}）`)}" href="${esc(feedHref(scope, f))}" />`);
  // 正式站：Webmention 端点（演示站在 GitHub Pages 上没有服务器，不声明端点）
  if (!DEMO && HAS_SITE_URL) tags.push(`<link rel="webmention" href="${esc(API_BASE ? `${API_BASE}/api/webmention` : absUrl('/api/webmention'))}" />`);
  // L24：个人页面与站长预览不进搜索引擎
  if (R.noindexRoute(p.route.name)) tags.push('<meta name="robots" content="noindex" />');
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
  if (HAS_SITE_URL) tags.push(`<link rel="alternate" type="application/rss+xml" title="${esc(s.siteTitle)}" href="${BASE}rss.xml" />`, `<link rel="alternate" type="application/atom+xml" title="${esc(s.siteTitle)}（Atom）" href="${BASE}atom.xml" />`, `<link rel="alternate" type="application/feed+json" title="${esc(s.siteTitle)}（JSON Feed）" href="${BASE}feed.json" />`);
  return tags.filter(Boolean).join('\n    ');
}

function page(p, data, share) {
  const s = data.settings;
  const html = template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(p.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${esc(p.description)}" />`)
    .replace('data-site-theme="system"', `data-site-theme="${esc(s.theme)}"`)
    .replace('<!--blog:head-->', headMeta(p, data, share))
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
let postPages = 0;
let listPages = 0;
const failures = [];
const sitemap = [];
/** L23：栏目注册表给出的固定路由（render）和其中进 sitemap 的（index）；详情页里公开的照旧进 sitemap */
const SITEMAP = R.sitemapRoutes();
const INDEX = new Set(SITEMAP.index);
const DETAIL_INDEX = new Set(['tag', 'category', 'album', 'user', 'work', 'topic', 'event', 'collection', 'project', 'feature', 'seriesdetail', 'month', 'shelfyear', 'group', 'issue', 'av', 'hall', 'term', 'retouchcase', 'checklist', 'calendarmonth']);
const shell = template.replace('<!--blog:app-->', '').replace('<!--blog:data-->', '');
const soft = (p, fallback) => get(p).catch(() => fallback);
/** L20：演示版有静态订阅源的对象（公开主页 / 话题 / 公开项目） */
let feedScopes = null;
if (API || DEMO) {
  try {
    const [settings, profile, list, tags, cats] = await Promise.all([get('/api/settings'), get('/api/profile'), fetchAllPosts(get), get('/api/tags'), soft('/api/categories', { categories: [] })]);
    console.log(`[prerender] 文章：${list.posts.length} 篇（${list.pages} 页游标分页，total=${list.total}）`);
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
    // L27：书摘（已发布文章里的 :::quote 块；旧 Worker 没有该接口时为空）
    extra.quotes = (await soft('/api/quotes', { quotes: [] })).quotes ?? [];
    // L33：视觉杂志（已发布期刊摘要；旧 Worker 没有该接口时为空）
    extra.issues = (await soft('/api/magazine', { issues: [] })).issues ?? [];
    // L34：视频与声音（已发布作品摘要；旧 Worker 没有该接口时为空）
    extra.avWorks = (await soft('/api/av', { works: [] })).works ?? [];
    // L35：沉浸式展厅（已发布展厅摘要；旧 Worker 没有该接口时为空）
    extra.halls = (await soft('/api/halls', { halls: [] })).halls ?? [];
    // L36：摄影术语表
    extra.terms = (await soft('/api/glossary', { terms: [] })).terms ?? [];
    // L37：修图前后对比
    extra.retouchCases = (await soft('/api/retouch', { cases: [] })).cases ?? [];
    // L38：拍摄清单
    extra.checklists = (await soft('/api/checklists', { checklists: [] })).checklists ?? [];
    // L39：照片日历
    extra.calMonths = (await soft('/api/calendar', { months: [] })).months ?? [];
    // @content:pre-extra — L36+ 内容栏目挂载点（scaffold）
    // 每个页面只嵌入它需要的额外数据；单页失败：严格模式记下来最后让构建失败，宽松模式跳过
    const emit = async (route, loadX, loadShare) => {
      const label = R.routePath(route);
      try {
        const x = loadX ? await loadX() : {};
        const share = loadShare ? await loadShare().catch(() => null) : null;
        const want = R.needs(route);
        const ex = Object.fromEntries(Object.entries({ ...extra, ...x }).filter(([k]) => want.includes(k)));
        const p = R.renderRoute(route, site, ex);
        const rel = decodeURIComponent(label).replace(/^\/|\/$/g, '');
        write(rel, page(p, { ...site, extra: ex }, share));
        count++;
        if (route.name === 'post') postPages++;
        if (route.name === 'home') listPages++;
        if (route.name === 'home' || route.name === 'post' || INDEX.has(route.name) || DETAIL_INDEX.has(route.name)) sitemap.push({ loc: R.url(label), lastmod: route.name === 'post' ? (ex.post?.updatedAt ?? ex.post?.publishedAt ?? null) : null, prio: route.name === 'home' && route.page === 1 ? '1.0' : route.name === 'post' ? '0.8' : '0.5' });
      } catch (e) {
        failures.push(`${label}：${e.message}`);
        if (!STRICT) console.warn(`[prerender] ⚠ 跳过失败页 ${label}：${e.message}`);
      }
    };
    const per = Math.max(1, settings.postsPerPage);
    const pages = Math.max(1, Math.ceil(list.total / per));
    for (let n = 1; n <= pages; n++) await emit({ name: 'home', page: n });
    // L23：固定路由与 sitemap 都来自栏目注册表（site-map.ts）：新增栏目 / 条目自动预渲染
    for (const name of SITEMAP.render) await emit({ name });
    // 订阅源：RSS 2.0 + JSON Feed（全部文章；需要站点的绝对地址：演示版固定为 GitHub Pages，正式站点读 BLOG_SITE_URL）
    const siteUrl = HAS_SITE_URL ? SITE_URL : '';
    if (siteUrl) {
      const feed = { title: settings.siteTitle, description: settings.siteDescription, siteUrl, posts: list.posts };
      writeFileSync(join(dist, 'rss.xml'), R.rssXml(feed));
      writeFileSync(join(dist, 'feed.json'), R.jsonFeed(feed));
      // L20：Atom 1.0（全部文章，带作者与更新时间）
      const owner = { name: profile.name || settings.siteTitle, url: siteUrl };
      writeFileSync(
        join(dist, 'atom.xml'),
        R.atomFeed(
          { title: settings.siteTitle, description: settings.siteDescription, homeUrl: siteUrl, author: owner },
          list.posts.map((p) => ({ id: `${siteUrl}posts/${p.slug}/`, url: `${siteUrl}posts/${p.slug}/`, title: p.title, summary: p.summary, published: p.publishedAt ?? p.updatedAt, updated: p.updatedAt, author: owner, tags: [p.category, ...p.tags].filter(Boolean) })),
          `${siteUrl}atom.xml`,
          list.posts[0]?.updatedAt,
        ),
      );
      // L20：演示版没有服务器 → 每个公开主页 / 话题 / 公开项目的订阅源在构建时写成静态文件（正式站由 Worker /api/feeds/… 动态生成）
      if (DEMO && backend?.openFeeds) {
        const open = backend.openFeeds();
        feedScopes = open.feedScopes();
        let n = 0;
        for (const [kind, refs] of [['user', feedScopes.users], ['topic', feedScopes.topics], ['project', feedScopes.projects]]) {
          for (const ref of refs) {
            for (const fmt of ['rss', 'atom', 'json']) {
              const rel = `feeds/${kind}/${ref}/${R.FEED_FILE[fmt]}`;
              try {
                const body = open.feed(kind, ref, fmt, `${siteUrl}${rel}`, siteUrl);
                mkdirSync(join(dist, 'feeds', kind, ref), { recursive: true });
                writeFileSync(join(dist, rel), body);
                n++;
              } catch (e) {
                failures.push(`${rel}：${e.message}`);
              }
            }
          }
        }
        console.log(`[prerender] 演示版静态订阅源：${n} 个文件（主页 ${feedScopes.users.length}、话题 ${feedScopes.topics.length}、项目 ${feedScopes.projects.length}）`);
      }
    } else {
      console.warn('[prerender] 未设置 BLOG_SITE_URL（站点的绝对地址），跳过 rss.xml / feed.json。');
    }
    // Pages 按解码后的路径查找文件；含路径分隔符或以 . 开头的标签 / 分类不生成静态页（浏览器端回退渲染）
    for (const t of site.tags) if (!/[\/\\]|^\./.test(t.tag)) await emit({ name: 'tag', tag: t.tag });
    for (const c of site.categories) if (!/[\/\\]|^\./.test(c.category)) await emit({ name: 'category', category: c.category });
    for (const a of extra.gallery) await emit({ name: 'album', slug: a.slug });
    // L25：每个系列详情页 + 每个有内容的月份（月度合集）
    const seriesList = R.buildSeries(site.posts);
    for (const s of seriesList) await emit({ name: 'seriesdetail', series: s.name }, null, async () => ({ title: `${s.name} · 系列连载`, description: s.intro || `系列「${s.name}」共 ${s.parts.length} 篇`, image: s.cover || '', type: 'website' }));
    const months = R.monthlyGroups(site.posts, extra.works ?? []);
    for (const g of months) await emit({ name: 'month', ym: g.ym });
    console.log(`[prerender] L25：系列详情 ${seriesList.length} 页，月度合集 ${months.length} 个月`);
    // L27：每个有标记时间的年份一页「年度书影音」
    const shelfYears = R.shelfYears(extra.shelf ?? []);
    for (const y of shelfYears) await emit({ name: 'shelfyear', year: y });
    console.log(`[prerender] L27：书摘 ${extra.quotes.length} 段，年度书影音 ${shelfYears.length} 年`);
    // L28：小组详情的静态外壳（内容在浏览器端按身份加载）；旧 Worker 没有该接口时跳过
    const groupList = (await soft('/api/social/groups', { groups: [] })).groups ?? [];
    for (const g of groupList) if (/^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/.test(g.slug)) await emit({ name: 'group', slug: g.slug }, null, async () => ({ title: `${g.name} · 小组`, description: g.intro || `小组「${g.name}」`, image: '', type: 'website' }));
    console.log(`[prerender] L28：小组 ${groupList.length} 个`);
    // L33：每一期杂志
    let issueCount = 0;
    for (const s of extra.issues) {
      if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(s.slug)) continue;
      const d = await soft(`/api/magazine/${s.slug}`, null);
      if (!d?.issue) continue;
      const older = extra.issues.filter((x) => x.no < s.no).sort((a, b) => b.no - a.no)[0] ?? null;
      const newer = extra.issues.filter((x) => x.no > s.no).sort((a, b) => a.no - b.no)[0] ?? null;
      const pick = (v) => (v ? { slug: v.slug, no: v.no, title: v.title } : null);
      await emit({ name: 'issue', slug: s.slug }, async () => ({ issue: d.issue, issueNav: { prev: pick(older), next: pick(newer) } }), async () => ({ title: `${s.title} · 视觉杂志`, description: d.issue.editorNote || s.title, image: s.cover?.src || '', type: 'article' }));
      issueCount++;
    }
    console.log(`[prerender] L33：视觉杂志 ${issueCount} 期`);
    // L34：每一个视频 / 声音作品（播放器、章节、完整文字稿都在静态 HTML 里）
    let avCount = 0;
    for (const s of extra.avWorks) {
      if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(s.slug)) continue;
      const d = await soft(`/api/av/${s.slug}`, null);
      if (!d?.work) continue;
      await emit({ name: 'av', slug: s.slug }, async () => ({ avWork: d.work }), async () => ({ title: `${s.title} · 视频与声音`, description: s.summary || s.title, image: s.poster?.src || '', type: 'article' }));
      avCount++;
    }
    console.log(`[prerender] L34：视频与声音 ${avCount} 个`);
    // L35：每一间展厅（平面展品列表都在静态 HTML 里；3D 由浏览器端按需增强）
    let hallCount = 0;
    for (const s of extra.halls) {
      if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(s.slug)) continue;
      const d = await soft(`/api/halls/${s.slug}`, null);
      if (!d?.hall) continue;
      await emit({ name: 'hall', slug: s.slug }, async () => ({ hall: d.hall }), async () => ({ title: `${s.title} · 沉浸式展厅`, description: s.summary || s.title, image: s.cover?.src || '', type: 'article' }));
      hallCount++;
    }
    console.log(`[prerender] L35：沉浸式展厅 ${hallCount} 间`);
    // L36：摄影术语表（详情页全文都在静态 HTML 里）
    let n36 = 0;
    for (const s of extra.terms) {
      if (!/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(s.slug)) continue;
      const d = await soft(`/api/glossary/${s.slug}`, null);
      if (!d?.term) continue;
      await emit({ name: 'term', slug: s.slug }, async () => ({ term: d.term }), async () => ({ title: `${s.title} · 摄影术语表`, description: s.summary || s.title, image: s.cover?.src || '', type: 'article' }));
      n36++;
    }
    console.log(`[prerender] L36：摄影术语表 ${n36} 条`);
    // L37：修图前后对比（详情页全文都在静态 HTML 里）
    let n37 = 0;
    for (const s of extra.retouchCases) {
      if (!/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(s.slug)) continue;
      const d = await soft(`/api/retouch/${s.slug}`, null);
      if (!d?.case) continue;
      await emit({ name: 'retouchcase', slug: s.slug }, async () => ({ retouchCase: d.case }), async () => ({ title: `${s.title} · 修图前后对比`, description: s.summary || s.title, image: s.cover?.src || '', type: 'article' }));
      n37++;
    }
    console.log(`[prerender] L37：修图前后对比 ${n37} 条`);
    // L38：拍摄清单（详情页全文都在静态 HTML 里）
    let n38 = 0;
    for (const s of extra.checklists) {
      if (!/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(s.slug)) continue;
      const d = await soft(`/api/checklists/${s.slug}`, null);
      if (!d?.checklist) continue;
      await emit({ name: 'checklist', slug: s.slug }, async () => ({ checklist: d.checklist }), async () => ({ title: `${s.title} · 拍摄清单`, description: s.summary || s.title, image: s.cover?.src || '', type: 'article' }));
      n38++;
    }
    console.log(`[prerender] L38：拍摄清单 ${n38} 条`);
    // L39：照片日历（详情页全文都在静态 HTML 里）
    let n39 = 0;
    for (const s of extra.calMonths) {
      if (!/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(s.slug)) continue;
      const d = await soft(`/api/calendar/${s.slug}`, null);
      if (!d?.month) continue;
      await emit({ name: 'calendarmonth', slug: s.slug }, async () => ({ calMonth: d.month }), async () => ({ title: `${s.title} · 照片日历`, description: s.summary || s.title, image: s.cover?.src || '', type: 'article' }));
      n39++;
    }
    console.log(`[prerender] L39：照片日历 ${n39} 条`);
    // @content:pre-emit — L36+ 内容栏目挂载点（scaffold）
    // L16：公开作品 / 作者主页的静态外壳（只有标题和加载占位，内容在浏览器端按权限加载），让 /w/:id/、/u/:name/ 在 Pages 上返回 200。
    // 旧 Worker 没有 /api/social/works 时跳过（不算预渲染失败）。
    try {
      const authors = new Set();
      let cursor = null;
      for (let i = 0; i < 10; i++) {
        const r = await get(`/api/social/works?tab=latest&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        for (const w of r.works ?? []) {
          await emit({ name: 'work', id: w.id }, null, async () => {
            const t = w.title || (w.caption || w.body || '').slice(0, 40) || '作品';
            return { title: `${t} · ${w.author?.nickname ?? ''}`, description: (w.caption || w.body || t).replace(/\s+/g, ' ').slice(0, 160), image: w.media?.[0]?.url ?? '', imageAlt: w.media?.[0]?.alt ?? '', type: 'article' };
          });
          if (/^[a-z0-9_]{3,20}$/.test(w.author?.username ?? '')) authors.add(w.author.username);
        }
        cursor = r.nextCursor;
        if (!cursor) break;
      }
      for (const u of authors)
        await emit({ name: 'user', username: u }, null, async () => {
          const { profile: pr } = await get(`/api/social/users/${u}`);
          return { title: `${pr.nickname}（@${pr.username}）`, description: pr.bio || `${pr.nickname} 在 ${settings.siteTitle} 的创作者主页`, image: pr.avatarUrl || '', type: 'profile' };
        });
    } catch (e) {
      console.warn(`[prerender] 跳过社区作品外壳：${e.message}`);
    }
    // L17：话题页 / 活动页的静态外壳（内容在浏览器端加载）；旧 Worker 没有这些接口时跳过。
    try {
      const { topics } = await get('/api/social/topics');
      for (const t of topics ?? []) if (/^[a-z0-9-]{2,32}$/.test(t.slug)) await emit({ name: 'topic', slug: t.slug }, null, async () => ({ title: `#${t.name}`, description: t.intro || `话题「${t.name}」下的作品与文章`, image: '', type: 'website' }));
      const { events } = await get('/api/social/events?status=all');
      for (const ev of events ?? []) if (/^[a-z0-9-]{2,40}$/.test(ev.slug)) await emit({ name: 'event', slug: ev.slug }, null, async () => ({ title: ev.title, description: ev.intro || '摄影活动：规则、投稿与精选', image: ev.coverUrl || ev.cover?.url || '', type: 'website' }));
    } catch (e) {
      console.warn(`[prerender] 跳过话题 / 活动外壳：${e.message}`);
    }
    // L18：项目页 / 摄影专题的静态外壳（内容在浏览器端加载）；旧 Worker 没有这些接口时跳过。
    try {
      const { projects } = await get('/api/social/projects');
      for (const p of projects ?? []) if (/^[a-z0-9-]{1,40}$/.test(p.slug)) await emit({ name: 'project', slug: p.slug }, null, async () => ({ title: p.title, description: p.tagline || `项目「${p.title}」的开发日志、版本与关联作品`, image: p.coverUrl || '', type: 'website' }));
      const { features } = await get('/api/social/features');
      for (const f of features ?? []) if (/^[a-z0-9-]{1,40}$/.test(f.slug)) await emit({ name: 'feature', slug: f.slug });
    } catch (e) {
      console.warn(`[prerender] 跳过项目 / 专题外壳：${e.message}`);
    }
    // 文章页：小批量并发拉取正文
    const queue = [...list.posts];
    await Promise.all(Array.from({ length: 6 }, async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        const slug = s.slug;
        await emit({ name: 'post', slug }, async () => ({ post: await get(`/api/posts/${encodeURIComponent(slug)}`) }));
      }
    }));
    // 并发渲染后，sitemap 里的文章按站点顺序排列（输出稳定）
    const order = new Map(list.posts.map((p, i) => [R.url(R.routePath({ name: 'post', slug: p.slug })), i]));
    sitemap.sort((a, b) => (order.get(a.loc) ?? -1) - (order.get(b.loc) ?? -1));
    const problems = verifyCounts({ postPages, total: list.total, failures });
    if (listPages !== pages) problems.push(`列表页 ${listPages} ≠ 应有 ${pages}`);
    if (problems.length) {
      if (STRICT) fail(problems.join('；'));
      loud(problems.join('；'));
    }
    console.log(`[prerender] 文章页 ${postPages}/${list.total}，列表页 ${listPages}/${pages}`);
    ok = true;
  } catch (e) {
    if (DEMO || STRICT) fail(`无法从 ${DEMO ? '演示 mock API' : API} 获取数据（${e.message}）`);
    loud(`无法从 ${API} 获取数据（${e.message}），使用空壳回退。`);
  }
} else if (STRICT) {
  fail('严格模式需要 BLOG_API_URL（或 --demo）：没有数据源就不能预渲染');
} else {
  loud('未设置 BLOG_API_URL，跳过内容预渲染（页面将在浏览器中加载数据）。');
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
/build.json
  Cache-Control: no-cache
/admin*
  Cache-Control: no-store
  X-Robots-Tag: noindex, nofollow
`,
);
if (existsSync(ssrOut)) rmSync(ssrOut, { recursive: true, force: true });
console.log(`[prerender] ${ok ? `已预渲染 ${count} 个页面` : '已生成空壳'}；_headers 已写入。`);
