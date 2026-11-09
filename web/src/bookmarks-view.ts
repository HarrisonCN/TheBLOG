/**
 * L61 / v1.61.0 链接分享页面（纯函数，浏览器和预渲染共用；没有 JS 也完整）：/bookmarks/ 链接卡片（域名、推荐人、点赞数、标签）+ 排序（JS 后，最多赞按含你的一票）；/bookmarks/:slug/ 外链（nofollow ugc）、推荐语、讨论，JS 加载后出现点赞按钮。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { url, type Page, type Route } from './render';
import { chips, ckDetail, ckList } from './ck-view';
import { hostOf, type Item, type Summary } from './bookmarks-core';
import type { SiteData } from './types';
void icon; void url; void chips; void e;

const sub = (it: Item) => `链接分享 · ${hostOf(it.url)} · ${it.sharer} 推荐`;
const attrs = (it: Item) => `data-bookmark="${e(it.slug)}" data-votes="${it.votes}"`;
const listAttrs = (_l: Summary[]) => 'data-bookmarks';
const meta = (s: Summary) => `<span class="bm-host">${e(s.host)}</span> · ${e(s.sharer)} · <span class="bm-votes" data-date="${s.date}" data-votes="${s.votes}"><span data-bm-n>${s.votes}</span> 赞</span> · ${s.comments} 条讨论 ${chips(s.tags)}`;
const top = (_l: Summary[]) => `<p class="bm-sort" data-bm-sort-wrap hidden><label>排序 <select data-bm-sort><option value="latest">最新</option><option value="top">最多赞</option></select></label></p>`;
function body(it: Item): string {
  return `<p class="bm-go"><a class="btn btn--sm" href="${e(it.url)}" rel="noopener nofollow ugc">${icon('external')}打开链接（${e(hostOf(it.url))}）</a> <span class="bm-up" data-bm-tools hidden><button type="button" class="btn btn--sm" data-bm-up aria-pressed="false">${icon('heart')}<span>点赞</span></button> <span class="small" data-bm-n>${it.votes}</span> <span class="small">赞</span> <span class="small" data-bm-status role="status"></span></span></p>
${chips(it.tags)}
<section class="bm-note" aria-labelledby="bm-n-h"><h2 id="bm-n-h">推荐语</h2>${it.note.map((p) => `<p>${e(p)}</p>`).join('')}</section>
<section aria-labelledby="bm-c-h"><h2 id="bm-c-h">讨论（${it.comments.length}）</h2>${
    it.comments.length ? `<ul class="bm-comments" role="list">${it.comments.map((c) => `<li id="c-${e(c.id)}"><strong>${e(c.author)}</strong>：${e(c.text)}</li>`).join('')}</ul>` : '<p class="muted">还没有讨论。</p>'
  }</section>`;
}
const bottom = (_l: Summary[]) => '';

export function detailPage(site: SiteData, route: Extract<Route, { name: 'bookmark' }>, it: Item): Page {
  return ckDetail(site, route, { label: '链接分享', base: '/bookmarks/', cls: 'bm', title: it.title, summary: it.summary, sub: sub(it), note: '示例链接：推荐人和讨论都是虚构的演示内容，链接指向保留的示例域名；你的点赞只记在这台设备上。', body: body(it), attrs: attrs(it) });
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return ckList(site, route, { label: '链接分享', desc: '大家分享的好链接：一句话推荐、标签和讨论，点赞只记在本机', base: '/bookmarks/', cls: 'bm', cards: list.map((s) => ({ slug: s.slug, title: s.title, summary: s.summary, meta: meta(s) })), empty: '还没有分享的链接。', top: top(list), bottom: bottom(list), attrs: listAttrs(list) });
}
