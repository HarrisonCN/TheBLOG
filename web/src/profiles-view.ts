/**
 * L59 / v1.59.0 成员主页与成就页面（纯函数，浏览器和预渲染共用；没有 JS 也完整）：/members/ 成员卡片（加入日期、成就数）+ 排序（JS 后）；/members/:slug/ 简介、参与数据、成就墙（已获得 / 未获得带进度条），JS 加载后可「只看已获得」。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { url, type Page, type Route } from './render';
import { chips, ckDetail, ckList } from './ck-view';
import { badgeProgress, BADGES, earnedCount, remainText, statsOf, type Item, type Summary } from './profiles-core';
import type { SiteData } from './types';
void icon; void url; void chips; void e;

const sub = (it: Item) => `成员主页 · ${it.name} · ${it.joined} 加入 · ${earnedCount(it)} 枚成就`;
const attrs = (it: Item) => `data-member="${e(it.slug)}"`;
const listAttrs = (_l: Summary[]) => 'data-members';
const meta = (s: Summary) => `<span class="mb-stat" data-joined="${s.joined}" data-badges="${s.badges}">${s.joined} 加入 · ${s.badges} / ${BADGES.length} 枚成就</span>`;
const top = (_l: Summary[]) => `<p class="mb-sort" data-mb-sort-wrap hidden><label>排序 <select data-mb-sort><option value="date">最近更新</option><option value="badges">成就最多</option><option value="joined">最早加入</option></select></label></p>`;
function body(it: Item): string {
  const s = statsOf(it);
  const rows: [string, number][] = [['帖子', s.posts], ['回答', s.answers], ['被采纳', s.accepted], ['参加活动', s.meetups], ['最长连续', s.streak]];
  const pg = badgeProgress(it);
  return `<p class="mb-bio">${e(it.bio)}</p><p class="small muted">${e(it.city)} · ${it.joined} 加入</p>
<dl class="mb-stats">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}${k === '最长连续' ? ' 天' : ''}</dd></div>`).join('')}</dl>
${it.links.length ? `<p class="mb-links">${it.links.map((l) => `<a href="${e(l.url)}" rel="noopener nofollow ugc">${icon('external')}${e(l.label)}</a>`).join(' ')}</p>` : ''}
<section aria-labelledby="mb-b-h"><h2 id="mb-b-h">成就（${pg.filter((x) => x.earned).length} / ${pg.length}）</h2><p data-mb-only-wrap hidden><label><input type="checkbox" data-mb-only> 只看已获得</label></p><ul class="mb-badges" role="list">${pg
    .map(
      (x) =>
        `<li class="mb-badge${x.earned ? ' is-earned' : ''}" data-earned="${x.earned ? 1 : 0}"><span class="mb-badge__icon" aria-hidden="true">${x.earned ? '★' : '☆'}</span><span class="mb-badge__label">${e(x.badge.label)}</span><span class="small">${e(x.badge.desc)}</span><progress max="${x.badge.goal}" value="${x.value}" aria-label="${e(x.badge.label)}进度 ${x.value} / ${x.badge.goal}"></progress><span class="small mb-remain">${remainText(x.badge, x.value)}</span></li>`,
    )
    .join('')}</ul></section>`;
}
const bottom = (_l: Summary[]) => '';

export function detailPage(site: SiteData, route: Extract<Route, { name: 'memberprofile' }>, it: Item): Page {
  return ckDetail(site, route, { label: '成员主页与成就', base: '/members/', cls: 'mb', title: it.title, summary: it.summary, sub: sub(it), note: '示例成员：昵称、数据和成就都是虚构的演示内容；成就由公开的规则根据数据自动计算。', body: body(it), attrs: attrs(it) });
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return ckList(site, route, { label: '成员主页与成就', desc: '社区成员的主页：简介、参与数据和按规则自动点亮的成就徽章', base: '/members/', cls: 'mb', cards: list.map((s) => ({ slug: s.slug, title: s.title, summary: s.summary, meta: meta(s) })), empty: '还没有成员主页。', top: top(list), bottom: bottom(list), attrs: listAttrs(list) });
}
