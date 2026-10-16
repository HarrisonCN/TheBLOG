#!/usr/bin/env node
// L32 / v1.32.0 跨浏览器验收（CI browser 任务 + 本地）：
//   node scripts/browser-e2e.mjs [--browser chromium|firefox|webkit] [--dist web/dist] [--site https://…/TheBLOG/] [--routes a,b]
// 不给 --site 时在本机用 GitHub Pages 语义起静态服务器（/TheBLOG/ 前缀、目录→index.html、缺失→404.html），
// 逐个关键页面（含使用指南 /guide/）× 1280 / 390 宽 × 'light' / 'dark'：axe（wcag2a / wcag2aa）0 个严重以上问题、无横向溢出、无页面报错、
// 有「跳到正文」链接且指向 <main id="main">、每页恰好一个 h1。依赖 playwright + axe-core（CI 里临时安装，不进 lockfile）。
// 退出码：全部通过 0，否则 1。
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BROWSER = arg('--browser', 'chromium');
const DIST = resolve(arg('--dist', join(here, '../web/dist')));
const req = createRequire(process.env.PW_DIR ? join(process.env.PW_DIR, 'x.js') : import.meta.url);
const pw = req('playwright');
const AXE = readFileSync(req.resolve('axe-core/axe.min.js'), 'utf8');

export const ROUTES = ['', 'posts/', 'archives/', 'works/', 'community/', 'groups/', 'tools/', 'tools/exposure/', 'search/?q=摄影', 'about/', 'join/', 'privacy/', 'sections/', 'guide/', 'nope-404/'];
export const VIEWPORTS = [[1280, 'light'], [390, 'dark']];
const routes = arg('--routes', '') ? arg('--routes').split(',') : ROUTES;
// 第三方 / 沙箱网络噪音：只看本站自己的报错
const IGNORE = /api\.github\.com|ERR_CERT|ERR_TUNNEL|ERR_PROXY|net::ERR_|CORS|Failed to load resource|archive\.org|openlibrary|openverse|itunes/;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.m4a': 'audio/mp4', '.json': 'application/json', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' };
function serve(dist, base = '/TheBLOG') {
  return new Promise((ok) => {
    const srv = createServer((rq, rs) => {
      const u = new URL(rq.url, 'http://x');
      let p = decodeURIComponent(u.pathname);
      if (!p.startsWith(base + '/') && p !== base) { rs.writeHead(404); return rs.end('nope'); }
      p = p.slice(base.length) || '/';
      let f = join(dist, p);
      if (!f.startsWith(dist)) { rs.writeHead(403); return rs.end(); }
      if (existsSync(f) && statSync(f).isDirectory()) {
        if (!u.pathname.endsWith('/')) { rs.writeHead(301, { location: u.pathname + '/' }); return rs.end(); }
        f = join(f, 'index.html');
      }
      if (existsSync(f) && statSync(f).isFile()) { rs.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' }); return rs.end(readFileSync(f)); }
      rs.writeHead(404, { 'content-type': TYPES['.html'] });
      rs.end(readFileSync(join(dist, '404.html')));
    });
    srv.listen(0, '127.0.0.1', () => ok(srv));
  });
}

const srv = arg('--site') ? null : await serve(DIST);
const ROOT = (arg('--site') ?? `http://127.0.0.1:${srv.address().port}/TheBLOG/`).replace(/\/?$/, '/');
const browser = await pw[BROWSER].launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const results = [];
const ok = (c, m) => { results.push(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) console.log('FAIL', m); };

for (const [width, scheme] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, locale: 'zh-CN', colorScheme: scheme, serviceWorkers: 'block', reducedMotion: 'reduce' });
  // 诊断：引擎间日期解析差异（V8 能解析、JavaScriptCore 不能）会让 toISOString 抛 RangeError —— 记下第一次的调用栈
  await ctx.addInitScript(() => {
    const iso = Date.prototype.toISOString;
    Date.prototype.toISOString = function () { if (Number.isNaN(this.getTime()) && !window.__badDate) window.__badDate = String(new Error('invalid date').stack); return iso.call(this); };
  });
  for (const r of routes) {
    const T = `[${BROWSER} ${width} ${scheme}] /${r}`;
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push(m.text()); });
    try {
      await page.goto(ROOT + r, { waitUntil: 'load', timeout: 30000 });
      // 演示版先显示加载骨架再拉快照重绘：等到 main 里出现 h1（最多 10 秒，较慢的引擎如 webkit），再多等 300ms 让动画落定
      await page.waitForFunction(() => document.querySelectorAll('main h1').length > 0, null, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(300);
      const facts = await page.evaluate(() => ({
        mainText: (document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 200),
        badDate: window.__badDate ?? null,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        skip: document.querySelector('a.skip-link')?.getAttribute('href') ?? null,
        main: !!document.querySelector('main#main'),
        h1: document.querySelectorAll('main h1').length,
        dark: document.documentElement.dataset.theme ?? document.documentElement.className,
      }));
      ok(facts.overflow <= 1, `${T} no horizontal overflow (${facts.overflow}px)`);
      ok(facts.skip === '#main' && facts.main, `${T} skip link → <main id="main">`);
      if (facts.badDate) console.log(`DIAG ${T} invalid Date → toISOString stack:\n${facts.badDate}`);
      ok(facts.h1 === 1, `${T} exactly one h1 in main (${facts.h1})${facts.h1 === 1 ? '' : ` main text: «${facts.mainText}»`}`);
      await page.addScriptTag({ content: AXE });
      const v = await page.evaluate(async () => {
        const res = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
        return res.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical').map((x) => `${x.id}(${x.nodes.length}) ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
      });
      ok(v.length === 0, `${T} axe: ${v.length ? v.join(' ;; ') : '0 issues'}`);
      ok(errs.length === 0, `${T} no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
    } catch (e) {
      ok(false, `${T} loaded: ${String(e).split('\n')[0]}`);
    }
    await page.close();
  }
  await ctx.close();
}
await browser.close();
srv?.close();
const fails = results.filter((x) => x.startsWith('FAIL'));
console.log(results.join('\n'));
console.log(`${BROWSER}: ${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
