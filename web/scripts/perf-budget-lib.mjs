// L32 / v1.32.0 性能预算计算器（纯函数 + 读 dist 目录）。scripts/perf-budget.mjs 与单元测试共用。
// 首屏 = index.html 里的 <script type="module" src> + <link rel="modulepreload"> (JS) 和 <link rel="stylesheet"> (CSS)；
// 其余 assets/*.js 都算懒加载块。大小一律按 gzip（zlib 默认级别 6，接近 CDN 动态压缩）计。
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const attr = (tag, name) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)?.[1] ?? null;

/** 从 index.html 找出首屏 JS / CSS，返回相对 dist 的路径（外链忽略） */
export function entryAssets(html, base = '/') {
  const js = new Set();
  const css = new Set();
  const local = (href) => {
    if (!href || /^[a-z]+:\/\//i.test(href) || href.startsWith('//')) return null;
    let p = href.split(/[?#]/)[0];
    if (base !== '/' && p.startsWith(base)) p = p.slice(base.length);
    return p.replace(/^\.?\//, '');
  };
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    if (!/type\s*=\s*["']module["']/i.test(m[0])) continue;
    const p = local(attr(m[0], 'src'));
    if (p) js.add(p);
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(m[0], 'rel') ?? '').toLowerCase();
    const p = local(attr(m[0], 'href'));
    if (!p) continue;
    if (rel === 'modulepreload') js.add(p);
    else if (rel === 'stylesheet') css.add(p);
  }
  return { js: [...js], css: [...css] };
}

const gz = (file) => gzipSync(readFileSync(file)).length;

/** 测量 dist：首屏 JS / CSS、最大懒加载块、JS 总量（gzip 字节） */
export function measure(dist, base = '/') {
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const { js, css } = entryAssets(html, base);
  const initial = new Set(js);
  const all = readdirSync(join(dist, 'assets')).filter((f) => f.endsWith('.js')).map((f) => `assets/${f}`);
  let initialJs = 0;
  for (const f of js) initialJs += gz(join(dist, f));
  let initialCss = 0;
  for (const f of css) initialCss += gz(join(dist, f));
  let totalJs = 0;
  let largestLazy = { file: '', gzip: 0 };
  for (const f of all) {
    const n = gz(join(dist, f));
    totalJs += n;
    if (!initial.has(f) && n > largestLazy.gzip) largestLazy = { file: f, gzip: n };
  }
  return { initialJs, initialCss, totalJs, largestLazy, chunks: all.length, initialFiles: [...js, ...css] };
}

const kb = (n) => Math.round((n / 1024) * 10) / 10;

/** 对照预算（KB，gzip），返回违规清单；空数组 = 通过 */
export function checkBudget(m, budget) {
  const rows = [
    ['initialJsKb', m.initialJs, '首屏 JS'],
    ['initialCssKb', m.initialCss, '首屏 CSS'],
    ['lazyChunkKb', m.largestLazy.gzip, `最大懒加载块 ${m.largestLazy.file}`],
    ['totalJsKb', m.totalJs, 'JS 总量'],
  ];
  const out = [];
  for (const [key, bytes, label] of rows) {
    const limit = budget[key];
    if (typeof limit !== 'number') continue;
    if (bytes > limit * 1024) out.push({ key, actualKb: kb(bytes), limitKb: limit, message: `${label}: ${kb(bytes)} KB gzip > 预算 ${limit} KB` });
  }
  return out;
}

export { kb };
