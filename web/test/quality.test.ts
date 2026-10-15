/**
 * L32 / v1.32.0 平台质量基线：
 * - 性能预算计算器（web/scripts/perf-budget-lib.mjs）：从 index.html 找出首屏 JS / CSS（入口 + modulepreload），
 *   按 gzip 计大小，逐项对照预算（首屏 JS、CSS、单个懒加载块、总量），超了给出可读的违规清单。
 * - 使用指南 /guide/：路由、栏目注册（关于）、预渲染内容（阅读 / 订阅 / 加入 / 发布 / AI / 隐私 / 无障碍），锚点唯一。
 * - CI 浏览器矩阵：.github/workflows/ci.yml 有 browser 任务，chromium / firefox / webkit；
 *   scripts/browser-e2e.mjs 覆盖 1280 与 390 两种宽度；docs/quality.md 写明权限矩阵、预算、浏览器矩阵与验收清单。
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — 纯 JS 的构建脚本库，没有类型声明
import { checkBudget, entryAssets, measure } from '../scripts/perf-budget-lib.mjs';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf, sitemapRoutes } from '../src/site-map';

const ROOT = new URL('../../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, ROOT), 'utf8');

function fakeDist(): string {
  const d = mkdtempSync(join(tmpdir(), 'pb-'));
  mkdirSync(join(d, 'assets'));
  writeFileSync(
    join(d, 'index.html'),
    `<!doctype html><html><head>
<script type="module" crossorigin src="/TheBLOG/assets/index-abc.js"></script>
<link rel="modulepreload" crossorigin href="/TheBLOG/assets/vendor-def.js">
<link rel="stylesheet" crossorigin href="/TheBLOG/assets/index-123.css">
<link rel="icon" href="/TheBLOG/favicon.svg">
</head><body></body></html>`,
  );
  writeFileSync(join(d, 'assets/index-abc.js'), 'console.log("entry");'.repeat(200));
  writeFileSync(join(d, 'assets/vendor-def.js'), 'export const v=1;'.repeat(100));
  writeFileSync(join(d, 'assets/index-123.css'), 'body{margin:0}'.repeat(50));
  writeFileSync(join(d, 'assets/lazy-big.js'), Array.from({ length: 4000 }, (_, i) => `const a${i}=${i * 7919};`).join(''));
  writeFileSync(join(d, 'assets/lazy-small.js'), 'export default 1;');
  return d;
}

describe('性能预算：首屏资源识别', () => {
  it('入口脚本 + modulepreload 算首屏 JS，样式表算首屏 CSS，图标不算', () => {
    const html = readFileSync(join(fakeDist(), 'index.html'), 'utf8');
    const a = entryAssets(html, '/TheBLOG/');
    expect(a.js.sort()).toEqual(['assets/index-abc.js', 'assets/vendor-def.js']);
    expect(a.css).toEqual(['assets/index-123.css']);
  });
  it('base 为 / 时也能识别；外链（https://）不计入', () => {
    const a = entryAssets('<script type="module" src="/assets/m.js"></script><link rel="stylesheet" href="https://cdn.example.org/x.css">', '/');
    expect(a.js).toEqual(['assets/m.js']);
    expect(a.css).toEqual([]);
  });
});

describe('性能预算：测量与检查', () => {
  it('measure 按 gzip 计大小，分出首屏与懒加载块', () => {
    const d = fakeDist();
    const m = measure(d, '/TheBLOG/');
    const gz = (f: string) => gzipSync(readFileSync(join(d, f))).length;
    expect(m.initialJs).toBe(gz('assets/index-abc.js') + gz('assets/vendor-def.js'));
    expect(m.initialCss).toBe(gz('assets/index-123.css'));
    expect(m.largestLazy.file).toBe('assets/lazy-big.js');
    expect(m.largestLazy.gzip).toBe(gz('assets/lazy-big.js'));
    expect(m.totalJs).toBe(['index-abc.js', 'vendor-def.js', 'lazy-big.js', 'lazy-small.js'].reduce((s, f) => s + gz(`assets/${f}`), 0));
    expect(m.chunks).toBe(4);
  });
  it('都在预算内 → 没有违规', () => {
    const m = measure(fakeDist(), '/TheBLOG/');
    expect(checkBudget(m, { initialJsKb: 500, initialCssKb: 100, lazyChunkKb: 300, totalJsKb: 2000 })).toEqual([]);
  });
  it('超预算 → 列出每一项（名字、实际、上限）', () => {
    const m = measure(fakeDist(), '/TheBLOG/');
    const v = checkBudget(m, { initialJsKb: 0.01, initialCssKb: 100, lazyChunkKb: 0.01, totalJsKb: 2000 });
    expect(v.map((x: { key: string }) => x.key)).toEqual(['initialJsKb', 'lazyChunkKb']);
    expect(v[1].message).toContain('lazy-big.js');
    expect(v[0].actualKb).toBeGreaterThan(v[0].limitKb);
  });
  it('预算文件存在且每项都是正数', () => {
    const b = JSON.parse(read('scripts/perf-budget.json'));
    for (const k of ['initialJsKb', 'initialCssKb', 'lazyChunkKb', 'totalJsKb']) expect(b[k], k).toBeGreaterThan(0);
  });
});

describe('使用指南 /guide/', () => {
  it('路由往返 + 栏目注册在「关于」+ 进 sitemap', () => {
    const r = parseRoute('/guide/');
    expect(r.name).toBe('guide');
    expect(routePath(r)).toBe('/guide/');
    expect(sectionOf('guide' as never)?.id).toBe('about');
    expect(findEntry('about', 'guide' as never)?.href).toBe('/guide/');
    expect(sitemapRoutes().index).toContain('guide');
  });
  it('预渲染内容：七个主题、锚点唯一、目录链接都能落到锚点', () => {
    const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
    const p = renderRoute({ name: 'guide' } as never, site, {});
    expect(p.title).toMatch(/^使用指南/);
    for (const h of ['阅读', '订阅', '加入', '发布', 'AI', '隐私', '无障碍']) expect(p.main, h).toContain(h);
    const ids = [...p.main.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const toc = [...p.main.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    expect(toc.length).toBeGreaterThanOrEqual(7);
    for (const t of toc) expect(ids, t).toContain(t);
  });
});

describe('浏览器矩阵与质量文档', () => {
  it('CI 有 browser 任务：chromium / firefox / webkit，跑 browser-e2e 与性能预算', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/\n  browser:\n/);
    for (const b of ['chromium', 'firefox', 'webkit']) expect(ci).toContain(b);
    expect(ci).toContain('scripts/browser-e2e.mjs');
    expect(ci).toContain('scripts/perf-budget.mjs');
  });
  it('browser-e2e 覆盖 1280 与 390、浅色与深色、axe', () => {
    const s = read('scripts/browser-e2e.mjs');
    for (const x of ['1280', '390', "'light'", "'dark'", 'axe', '/guide/']) expect(s, x).toContain(x);
  });
  it('docs/quality.md 写明权限矩阵、性能预算、浏览器矩阵、验收清单', () => {
    const d = read('docs/quality.md');
    for (const x of ['权限矩阵', '性能预算', '浏览器矩阵', '验收清单', 'SKIPPED']) expect(d, x).toContain(x);
  });
});
