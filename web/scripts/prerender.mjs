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

function page(p, data) {
  const s = data.settings;
  const html = template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(p.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${esc(p.description)}" />`)
    .replace('data-site-theme="system"', `data-site-theme="${esc(s.theme)}"`)
    .replace('<!--blog:head-->', `<meta property="og:title" content="${esc(p.title)}" />\n    <meta property="og:description" content="${esc(p.description)}" />`)
    .replace('<!--blog:app-->', `${R.header(s, p.route)}<main id="main" class="container" tabindex="-1">${p.main}</main>${R.footer(s, data.profile)}`)
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
const shell = template.replace('<!--blog:app-->', '').replace('<!--blog:data-->', '');
if (API || DEMO) {
  try {
    const [settings, profile, list, tags] = await Promise.all([get('/api/settings'), get('/api/profile'), get('/api/posts?limit=100'), get('/api/tags')]);
    const site = { settings, profile, posts: list.posts, total: list.total, tags: tags.tags };
    write('', page(R.homePage(site), site));
    write('about', page(R.aboutPage(profile, settings), site));
    write('tags', page(R.tagsPage(site.tags, settings), site));
    count += 3;
    for (const t of site.tags) {
      // Pages 按解码后的路径查找文件；含路径分隔符或以 . 开头的标签不生成静态页（浏览器端回退渲染）
      if (/[\/\\]|^\./.test(t.tag)) continue;
      const tp = await get(`/api/posts?tag=${encodeURIComponent(t.tag)}&limit=100`);
      write(join('tags', t.tag), page(R.tagPage(t.tag, tp.posts, settings), { ...site, tagPosts: { tag: t.tag, posts: tp.posts } }));
      count++;
    }
    for (const s of list.posts) {
      const post = await get(`/api/posts/${s.slug}`);
      write(join('posts', post.slug), page(R.postPage(post, settings), { ...site, post }));
      count++;
    }
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
const connect = ["'self'", API_BASE && new URL(API_BASE).origin].filter(Boolean).join(' ');
const img = ["'self'", 'https:', 'data:'].join(' ');
writeFileSync(
  join(dist, '_headers'),
  `/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src ${img}; connect-src ${connect}; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  X-Frame-Options: DENY
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/admin*
  Cache-Control: no-store
  X-Robots-Tag: noindex, nofollow
`,
);
if (existsSync(ssrOut)) rmSync(ssrOut, { recursive: true, force: true });
console.log(`[prerender] ${ok ? `已预渲染 ${count} 个页面` : '已生成空壳'}；_headers 已写入。`);
