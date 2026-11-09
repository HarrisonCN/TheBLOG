/**
 * L60 / v1.60.0 社区周刊页面（纯函数，浏览器和预渲染共用；没有 JS 也完整）：/weekly/ 周刊卡片（周号、日期范围、动态数、成员数）；/weekly/:slug/ 导语、按类型分栏的动态（成员链接到动态页），JS 加载后标出并可筛选「你关注的人」（读 1.54 关注列表，只在本机）。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { url, type Page, type Route } from './render';
import { chips, ckDetail, ckList } from './ck-view';
import { isoWeek, SECTION_TITLES, weekRange, type Item, type Summary } from './weekly-core';
import type { SiteData } from './types';
void icon; void url; void chips; void e;

const sub = (it: Item) => `社区周刊 · ${isoWeek(it.from)} · ${weekRange(it.from)} · 编辑 ${it.editor}`;
const attrs = (it: Item) => `data-weekly="${e(it.slug)}"`;
const meta = (s: Summary) => `${s.week} · ${weekRange(s.from)} · ${s.count} 条动态 · ${s.members} 位成员`;
function body(it: Item): string {
  const n = it.sections.reduce((a, s) => a + s.items.length, 0);
  return `<section class="wk-intro" aria-labelledby="wk-in-h"><h2 id="wk-in-h">本周导语</h2>${it.intro.map((p) => `<p>${e(p)}</p>`).join('')}<p class="small muted">本期从 ${n} 条成员动态里自动整理，按类型分栏。</p></section>
<p class="wk-follow" data-wk-follow-wrap hidden><label><input type="checkbox" data-wk-follow> 只看我关注的人</label> <span class="small muted" data-wk-status role="status"></span></p>
${it.sections
  .map(
    (s) =>
      `<section class="wk-sec" aria-labelledby="wk-${s.verb}-h"><h2 id="wk-${s.verb}-h">${SECTION_TITLES[s.verb]}（${s.items.length}）</h2><ul class="wk-items" role="list">${s.items
        .map((x) => `<li class="wk-item" data-member="${e(x.slug)}"><a href="${url(`/activity/${x.slug}/`)}">${e(x.member)}</a> <span class="small muted"><time datetime="${x.at}">${x.at.replace('T', ' ')}</time></span><span class="wk-text">${e(x.text)}</span></li>`)
        .join('')}</ul></section>`,
  )
  .join('')}`;
}
const top = (_l: Summary[]) => '';
const bottom = (_l: Summary[]) => '';
const listAttrs = (_l: Summary[]) => '';

export function detailPage(site: SiteData, route: Extract<Route, { name: 'weeklyissue' }>, it: Item): Page {
  return ckDetail(site, route, { label: '社区周刊', base: '/weekly/', cls: 'wk', title: it.title, summary: it.summary, sub: sub(it), note: '示例周刊：由示例成员动态（同样是虚构的）按周自动整理而成。', body: body(it), attrs: attrs(it) });
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return ckList(site, route, { label: '社区周刊', desc: '每周一期，从社区动态里自动整理：谁发了帖、回答了什么、读完了哪本书', base: '/weekly/', cls: 'wk', cards: list.map((s) => ({ slug: s.slug, title: s.title, summary: s.summary, meta: meta(s) })), empty: '还没有周刊。', top: top(list), bottom: bottom(list), attrs: listAttrs(list) });
}
