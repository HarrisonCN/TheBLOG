/**
 * L56 / v1.56.0 活动与聚会页面（纯函数，浏览器和预渲染共用；没有 JS 也完整）：/meetups/ 活动卡片（时间、地点、名额），JS 加载后按当前时间标出「已结束」；/meetups/:slug/ 时间地点、名额、议程、「加到日历（.ics）」（data: 链接，不需要 JS）和报名单选（参加 / 可能 / 不参加，JS 后出现）。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { url, type Page, type Route } from './render';
import { chips, ckDetail, ckList } from './ck-view';
import { seatsLeft, seatsText, toIcs, whenText, type Item, type Summary } from './meetups-core';
import type { SiteData } from './types';
void icon; void url; void chips; void e;

const sub = (it: Item) => `活动与聚会 · ${it.host} 主办 · ${whenText(it.start, it.end)}`;
const attrs = (it: Item) => `data-meetup="${e(it.slug)}" data-capacity="${it.capacity}" data-going="${it.going}" data-end="${it.end}"`;
const listAttrs = (_l: Summary[]) => 'data-meetups';
const meta = (s: Summary) => `<span data-mu-end="${s.end}">${e(whenText(s.start, s.end))}</span> · ${s.online ? '线上' : e(s.place)} · ${seatsText(s.left)}`;
function body(it: Item): string {
  const ics = toIcs(it);
  return `${chips(it.tags)}
<dl class="mu-facts"><div><dt>时间</dt><dd>${e(whenText(it.start, it.end))} <span class="mu-past small" data-mu-past hidden>已结束</span></dd></div><div><dt>${it.online ? '线上' : '地点'}</dt><dd>${e(it.place)}</dd></div><div><dt>名额</dt><dd><span data-mu-left>${seatsText(seatsLeft(it.capacity, it.going))}</span>（共 ${it.capacity} 人，已报名 ${it.going} 人）</dd></div></dl>
<p class="mu-cal"><a class="btn btn--sm" download="${e(it.slug)}.ics" href="data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}">${icon('calendar')}加到日历（.ics）</a></p>
<fieldset class="mu-rsvp" data-mu-rsvp hidden><legend>报名（只记在这台设备上）</legend>${[['going', '参加'], ['maybe', '可能参加'], ['no', '不参加']].map(([v, t]) => `<label><input type="radio" name="mu-rsvp" value="${v}"> ${t}</label>`).join('')} <span class="small" data-mu-status role="status"></span></fieldset>
<section aria-labelledby="mu-ag-h"><h2 id="mu-ag-h">议程</h2><ol class="mu-agenda" role="list">${it.agenda.map((a) => `<li><span class="mu-time">${e(a.time)}</span><span>${e(a.text)}</span></li>`).join('')}</ol></section>`;
}
const top = (_l: Summary[]) => '';
const bottom = (_l: Summary[]) => '';

export function detailPage(site: SiteData, route: Extract<Route, { name: 'meetup' }>, it: Item): Page {
  return ckDetail(site, route, { label: '活动与聚会', base: '/meetups/', cls: 'mu', title: it.title, summary: it.summary, sub: sub(it), note: '示例活动：时间、地点和人数都是虚构的演示内容；「报名」只记在这台设备上，不会通知主办人。', body: body(it), attrs: attrs(it) });
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return ckList(site, route, { label: '活动与聚会', desc: '线下聚会和线上活动：时间、地点、议程和名额，可加到日历；报名状态只存在本机', base: '/meetups/', cls: 'mu', cards: list.map((s) => ({ slug: s.slug, title: s.title, summary: s.summary, meta: meta(s) })), empty: '还没有活动。', top: top(list), bottom: bottom(list), attrs: listAttrs(list) });
}
