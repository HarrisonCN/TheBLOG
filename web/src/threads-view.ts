/**
 * L58 / v1.58.0 话题广场页面（纯函数，浏览器和预渲染共用；没有 JS 也完整）：/threads/ 讨论帖卡片（作者、回复数、热度、标签）+ 标签统计；JS 加载后出现排序（最新 / 回复最多 / 最热）和标签筛选按钮；/threads/:slug/ 正文、按楼层排列的回复，JS 后可「只看楼主」。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { url, type Page, type Route } from './render';
import { chips, ckDetail, ckList } from './ck-view';
import { floors, sortThreads, tagCounts, type Item, type Summary } from './threads-core';
import type { SiteData } from './types';
void icon; void url; void chips; void e;

const sub = (it: Item) => `话题广场 · ${it.author} · ${it.replies.length} 条回复 · ${it.views} 次浏览`;
const attrs = (it: Item) => `data-thread="${e(it.slug)}" data-op="${e(it.author)}"`;
const listAttrs = (_l: Summary[]) => 'data-threads';
/** 置顶永远在最前（没有 JS 也一样） */
const order = (l: Summary[]) => sortThreads(l, 'latest');
const meta = (s: Summary) =>
  `${s.pinned ? '<span class="th-pin">置顶</span> ' : ''}${e(s.author)} · <span class="th-stats" data-date="${s.date}" data-replies="${s.replies}" data-heat="${s.heat}" data-pinned="${s.pinned ? 1 : 0}" data-tags="${e(s.tags.join('|'))}">${s.replies} 回复 · 热度 ${s.heat}</span> ${chips(s.tags)}`;
const top = (list: Summary[]) =>
  `<div class="th-tools" data-th-tools hidden><label>排序 <select data-th-sort><option value="latest">最新</option><option value="replies">回复最多</option><option value="hot">最热</option></select></label><span class="th-tags" role="group" aria-label="按标签筛选">${tagCounts(list)
    .map((t) => `<button type="button" class="th-tag" data-th-tag="${e(t.tag)}" aria-pressed="false">${e(t.tag)} <span class="small">${t.n}</span></button>`)
    .join('')}</span><span class="small muted" data-th-status role="status"></span></div>`;
function body(it: Item): string {
  const rs = floors(it.replies);
  return `${chips(it.tags)}
<section class="th-body" aria-labelledby="th-b-h"><h2 id="th-b-h">${e(it.author)}（楼主）</h2>${it.body.map((p) => `<p>${e(p)}</p>`).join('')}</section>
<section aria-labelledby="th-r-h"><h2 id="th-r-h">${rs.length} 条回复</h2><p data-th-op-wrap hidden><label><input type="checkbox" data-th-op> 只看楼主</label> <span class="small muted" data-th-op-status role="status"></span></p>${
    rs.length
      ? `<ol class="th-replies" role="list">${rs.map((r, i) => `<li class="th-reply${r.author === it.author ? ' is-op' : ''}" id="r-${e(r.id)}" data-author="${e(r.author)}"><p class="small"><span class="th-floor">#${i + 1}</span> <strong>${e(r.author)}</strong>${r.author === it.author ? ' <span class="th-op">楼主</span>' : ''} <time datetime="${r.date}">${r.date}</time> · ${r.likes} 赞</p><p class="th-text">${e(r.text)}</p></li>`).join('')}</ol>`
      : '<p class="muted">还没有回复。</p>'
  }</section>`;
}
const bottom = (_l: Summary[]) => '';

export function detailPage(site: SiteData, route: Extract<Route, { name: 'thread' }>, it: Item): Page {
  return ckDetail(site, route, { label: '话题广场', base: '/threads/', cls: 'th', title: it.title, summary: it.summary, sub: sub(it), note: '示例讨论帖：作者、回复和数字都是虚构的演示内容。', body: body(it), attrs: attrs(it) });
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return ckList(site, route, { label: '话题广场', desc: '什么都能聊的讨论帖：按标签筛选，按最新、回复数或热度排序', base: '/threads/', cls: 'th', cards: order(list).map((s) => ({ slug: s.slug, title: s.title, summary: s.summary, meta: meta(s) })), empty: '还没有讨论帖。', top: top(list), bottom: bottom(list), attrs: listAttrs(list) });
}
