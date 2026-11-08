/**
 * L57 / v1.57.0 读书会页面（纯函数，浏览器和预渲染共用；没有 JS 也完整）：/book-club/ 共读卡片（作者、周数、开始日期）；/book-club/:slug/ 阅读计划（有序列表：每周日期、章节、讨论），JS 加载后每周出现「读完了」勾选、进度条与「本周」标记。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { url, type Page, type Route } from './render';
import { chips, ckDetail, ckList } from './ck-view';
import { progressText, type Item, type Summary } from './bookclub-core';
import type { SiteData } from './types';
void icon; void url; void chips; void e;

const sub = (it: Item) => `读书会 · ${it.author} 著 · ${it.host} 领读 · ${it.weeks.length} 周`;
const attrs = (it: Item) => `data-bookclub="${e(it.slug)}"`;
const meta = (s: Summary) => `${e(s.author)} 著 · ${s.weeks} 周 · ${s.starts} 开始 · ${s.posts} 条讨论`;
function body(it: Item): string {
  return `<p class="bc-meta small muted"><span>作者：${e(it.author)}</span><span>领读：${e(it.host)}</span><span>约 ${it.pages} 页</span></p>
<div class="bc-prog" data-bc-prog hidden><progress max="${it.weeks.length}" value="0" aria-labelledby="bc-prog-t"></progress><span id="bc-prog-t" data-bc-prog-t role="status">${progressText(0, it.weeks.length)}</span><span class="small" data-bc-now></span></div>
<section aria-labelledby="bc-plan-h"><h2 id="bc-plan-h">阅读计划</h2><ol class="bc-weeks" role="list">${it.weeks
    .map(
      (w) =>
        `<li class="bc-week" id="w-${w.week}" data-week="${w.week}"><h3 class="bc-week__h">第 ${w.week} 周 <span class="small muted">${w.from} 起</span></h3><p class="bc-ch">${e(w.chapters)}</p><label class="bc-done" hidden><input type="checkbox" data-bc-week="${w.week}"> 这周读完了</label>${
          w.posts.length
            ? `<ul class="bc-posts" role="list">${w.posts.map((p) => `<li id="c-${e(p.id)}"><strong>${e(p.author)}</strong>：${e(p.text)}</li>`).join('')}</ul>`
            : '<p class="small muted">这周还没有讨论。</p>'
        }</li>`,
    )
    .join('')}</ol></section>`;
}
const top = (_l: Summary[]) => '';
const bottom = (_l: Summary[]) => '';
const listAttrs = (_l: Summary[]) => '';

export function detailPage(site: SiteData, route: Extract<Route, { name: 'clubbook' }>, it: Item): Page {
  return ckDetail(site, route, { label: '读书会', base: '/book-club/', cls: 'bc', title: it.title, summary: it.summary, sub: sub(it), note: '示例读书会：书名、作者和讨论都是虚构的演示内容；你的阅读进度只记在这台设备上。', body: body(it), attrs: attrs(it) });
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return ckList(site, route, { label: '读书会', desc: '每期共读一本书：按周排好的阅读进度和每章的讨论，读到哪里只记在本机', base: '/book-club/', cls: 'bc', cards: list.map((s) => ({ slug: s.slug, title: s.title, summary: s.summary, meta: meta(s) })), empty: '还没有共读的书。', top: top(list), bottom: bottom(list), attrs: listAttrs(list) });
}
