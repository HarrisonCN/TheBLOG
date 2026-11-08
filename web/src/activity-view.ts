/**
 * L54 / v1.54.0 关注与动态流页面（纯函数，浏览器和预渲染共用；没有 JS 也完整）：/activity/ 合并时间线（全部成员最近动态按时间倒序，最多 20 条）+ 成员卡片 +「只看我关注的」（JS 后出现）；/activity/:slug/ 成员简介、兴趣、关注者数、个人时间线，「关注」按钮 JS 加载后出现。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { url, type Page, type Route } from './render';
import { chips, ckDetail, ckList } from './ck-view';
import { atText, byTime, followerText, mergeFeed, verbText, type Item, type Summary } from './activity-core';
import type { SiteData } from './types';
void icon; void url; void chips; void e;

const sub = (it: Item) => `关注与动态流 · ${it.member} · ${followerText(it.followers)}`;
const attrs = (it: Item) => `data-stream="${e(it.slug)}" data-followers="${it.followers}"`;
const listAttrs = (_l: Summary[]) => 'data-streams';
const meta = (s: Summary) => `${followerText(s.followers)} · ${s.entries} 条动态${s.recent[0] ? ` · 最近 ${atText(s.recent[0].at)}` : ''}`;
const item = (x: Pick<import('./activity-core').Entry, 'at' | 'verb' | 'text'>, who = '') =>
  `<span class="af-at small muted"><time datetime="${x.at}">${atText(x.at)}</time></span><span class="af-line">${who}<span class="af-verb">${verbText(x.verb)}</span> ${e(x.text)}</span>`;
function top(list: Summary[]): string {
  const feed = mergeFeed(list);
  return `<p class="af-filter" data-af-filter-wrap hidden><label><input type="checkbox" data-af-filter> 只看我关注的</label> <span class="small muted" data-af-filter-status role="status"></span></p>
<section aria-labelledby="af-feed-h"><h2 id="af-feed-h">最新动态</h2>${
    feed.length ? `<ol class="af-feed" role="list">${feed.map((f) => `<li class="af-item" data-member="${e(f.slug)}">${item(f.entry, `<a href="${url(`/activity/${f.slug}/`)}">${e(f.member)}</a> `)}</li>`).join('')}</ol>` : '<p class="muted">还没有动态。</p>'
  }<p class="muted small" data-af-empty hidden>你关注的人最近没有动态，或者你还没有关注任何人。</p></section><h2>社区成员</h2>`;
}
function body(it: Item): string {
  return `<p class="af-bio">${e(it.bio)}</p>${chips(it.interests)}
<p class="af-follow"><span class="small muted" data-af-count>${followerText(it.followers)}</span> <span data-af-tools hidden><button type="button" class="btn btn--sm" data-af-btn aria-pressed="false">${icon('userPlus')}<span>关注</span></button> <span class="small" data-af-status role="status"></span></span></p>
<section aria-labelledby="af-tl-h"><h2 id="af-tl-h">${e(it.member)} 的动态</h2><ol class="af-feed" role="list">${byTime(it.entries).map((x) => `<li class="af-item" id="e-${e(x.id)}">${item(x)}</li>`).join('')}</ol></section>`;
}
const bottom = (_l: Summary[]) => '';

export function detailPage(site: SiteData, route: Extract<Route, { name: 'stream' }>, it: Item): Page {
  return ckDetail(site, route, { label: '关注与动态流', base: '/activity/', cls: 'af', title: it.title, summary: it.summary, sub: sub(it), note: '示例成员与动态都是虚构的演示内容；「关注」只记在这台设备上，不会通知任何人。', body: body(it), attrs: attrs(it) });
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return ckList(site, route, { label: '关注与动态流', desc: '关注社区成员，把大家的最新动态排成一条时间线；关注列表只存在本机', base: '/activity/', cls: 'af', cards: list.map((s) => ({ slug: s.slug, title: s.title, summary: s.summary, meta: meta(s) })), empty: '还没有成员动态。', top: top(list), bottom: bottom(list), attrs: listAttrs(list) });
}
