/**
 * L63 / v1.63.0 互助交换页面（纯函数，浏览器和预渲染共用；没有 JS 也完整）：/swap/ 帖子卡片（提供 / 需要、类别、方式、进行中 / 已完成）+ 筛选（JS 后：类型、类别、只看进行中）；/swap/:slug/ 说明、想换什么、结果，JS 后可标「我感兴趣」。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { url, type Page, type Route } from './render';
import { chips, ckDetail, ckList } from './ck-view';
import { CATS, headline, KINDS, METHODS, type Item, type Summary } from './swap-core';
import type { SiteData } from './types';
void icon; void url; void chips; void e;

const sub = (it: Item) => `互助交换 · ${headline(it)} · ${it.owner} · ${it.area}`;
const attrs = (it: Item) => `data-swapitem="${e(it.slug)}" data-interested="${it.interested}"`;
const listAttrs = (_l: Summary[]) => 'data-swap';
const meta = (s: Summary) =>
  `<span class="sw-head" data-kind="${s.kind}" data-cat="${s.cat}" data-open="${s.open ? 1 : 0}">${headline(s)}</span> · ${e(s.area)} · <span class="sw-state${s.open ? ' is-open' : ''}">${s.open ? '进行中' : '已完成'}</span>`;
const top = (_l: Summary[]) =>
  `<form class="sw-filter" data-sw-filter hidden aria-label="筛选互助帖"><fieldset><legend class="small">类型</legend>${[['all', '全部'], ['offer', KINDS.offer], ['request', KINDS.request]].map(([v, t], i) => `<label><input type="radio" name="sw-kind" value="${v}"${i ? '' : ' checked'}> ${t}</label>`).join('')}</fieldset><label>类别 <select name="cat"><option value="all">全部</option>${Object.entries(CATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label><label><input type="checkbox" name="open"> 只看进行中</label><span class="small muted" data-sw-status role="status"></span></form>`;
function body(it: Item): string {
  return `<p class="sw-headline"><span class="sw-kind">${KINDS[it.kind]}</span> ${CATS[it.cat]} · ${METHODS[it.method]} · <span class="sw-state${it.open ? ' is-open' : ''}">${it.open ? '进行中' : '已完成'}</span></p>
<section aria-labelledby="sw-b-h"><h2 id="sw-b-h">说明</h2>${it.body.map((p) => `<p>${e(p)}</p>`).join('')}${it.wants ? `<p><strong>想换：</strong>${e(it.wants)}</p>` : ''}${it.result ? `<p class="sw-result"><strong>结果：</strong>${e(it.result)}</p>` : ''}</section>
<p class="small muted">发布人：${e(it.owner)} · 地区：${e(it.area)} · <span data-sw-n>${it.interested}</span> 人感兴趣</p>
${it.open ? `<p class="sw-int" data-sw-tools hidden><button type="button" class="btn btn--sm" data-sw-int aria-pressed="false">${icon('star')}<span>我感兴趣</span></button> <span class="small" data-sw-msg role="status"></span></p>` : ''}`;
}
const bottom = (_l: Summary[]) => '';

export function detailPage(site: SiteData, route: Extract<Route, { name: 'swapitem' }>, it: Item): Page {
  return ckDetail(site, route, { label: '互助交换', base: '/swap/', cls: 'sw', title: it.title, summary: it.summary, sub: sub(it), note: '示例帖子：物品、发布人和地区都是虚构的演示内容；演示站不提供任何联系方式，「感兴趣」只记在这台设备上。', body: body(it), attrs: attrs(it) });
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return ckList(site, route, { label: '互助交换', desc: '闲置交换、免费送、借用和技能互助：我能提供什么、我需要什么', base: '/swap/', cls: 'sw', cards: list.map((s) => ({ slug: s.slug, title: s.title, summary: s.summary, meta: meta(s) })), empty: '还没有互助帖子。', top: top(list), bottom: bottom(list), attrs: listAttrs(list) });
}
