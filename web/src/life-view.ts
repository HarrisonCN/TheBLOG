/**
 * L64 / v1.64.0 生活专栏页面（纯函数，浏览器和预渲染共用；没有 JS 也完整）：/life/ 文章卡片（菜谱：份数、用时；游记：地点、天数）+ 类型筛选（JS 后）；/life/:slug/ 菜谱：食材表与步骤（JS 后可按人数换算用量、勾选步骤）；游记：按天分组的行程。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { url, type Page, type Route } from './render';
import { chips, ckDetail, ckList } from './ck-view';
import { amountText, byDay, minutesText, type Item, type Summary } from './life-core';
import type { SiteData } from './types';
void icon; void url; void chips; void e;

const kindText = (k: Item['kind']) => (k === 'recipe' ? '菜谱' : '游记');
const sub = (it: Item) => `生活专栏 · ${kindText(it.kind)} · ${it.author}`;
const attrs = (it: Item) => `data-lifepost="${e(it.slug)}" data-kind="${it.kind}"${it.servings ? ` data-servings="${it.servings}"` : ''}`;
const listAttrs = (_l: Summary[]) => 'data-life';
const meta = (s: Summary) =>
  `<span class="lf-kind" data-kind="${s.kind}">${kindText(s.kind)}</span> · ${e(s.author)} · ${s.kind === 'recipe' ? `${s.servings} 人份 · ${minutesText(s.minutes ?? 0)}` : `${e(s.place ?? '')} · ${s.days} 天`} ${chips(s.tags)}`;
const top = (_l: Summary[]) =>
  `<fieldset class="lf-filter" data-lf-filter hidden><legend class="small">类型</legend>${[['all', '全部'], ['recipe', '菜谱'], ['travel', '游记']].map(([v, t], i) => `<label><input type="radio" name="lf-kind" value="${v}"${i ? '' : ' checked'}> ${t}</label>`).join('')} <span class="small muted" data-lf-status role="status"></span></fieldset>`;
function recipe(it: Item): string {
  const sv = it.servings ?? 1;
  return `<p class="lf-facts small muted"><span>${sv} 人份</span><span>${minutesText(it.minutes ?? 0)}</span></p>
<section aria-labelledby="lf-i-h"><h2 id="lf-i-h">食材</h2><p class="lf-scale" data-lf-scale hidden><label>换算成 <input type="number" min="1" max="20" value="${sv}" data-lf-to inputmode="numeric"> 人份</label> <span class="small muted" data-lf-scale-status role="status"></span></p><table class="lf-ing"><caption class="visually-hidden">食材与用量（${sv} 人份）</caption><thead><tr><th scope="col">食材</th><th scope="col">用量</th></tr></thead><tbody>${(it.ingredients ?? [])
    .map((i) => `<tr><td>${e(i.name)}</td><td data-amount="${i.amount}" data-unit="${e(i.unit)}">${e(amountText(i, sv, sv))}</td></tr>`)
    .join('')}</tbody></table></section>
<section aria-labelledby="lf-s-h"><h2 id="lf-s-h">步骤</h2><ol class="lf-steps">${(it.steps ?? []).map((s, n) => `<li><label class="lf-step"><input type="checkbox" data-lf-step="${n + 1}" hidden> <span>${e(s)}</span></label></li>`).join('')}</ol></section>`;
}
function travel(it: Item): string {
  return `<p class="lf-facts small muted"><span>${e(it.place ?? '')}</span><span>${it.days} 天</span></p>
<section aria-labelledby="lf-t-h"><h2 id="lf-t-h">行程</h2><ol class="lf-days" role="list">${byDay(it.stops ?? [], it.days ?? 1)
    .map((d) => `<li class="lf-day" id="day-${d.day}"><h3>第 ${d.day} 天</h3>${d.stops.length ? `<ul role="list">${d.stops.map((s) => `<li><strong>${e(s.name)}</strong>：${e(s.note)}</li>`).join('')}</ul>` : '<p class="small muted">自由活动。</p>'}</li>`)
    .join('')}</ol></section>`;
}
function body(it: Item): string {
  return `${chips(it.tags)}<section class="lf-intro">${it.intro.map((p) => `<p>${e(p)}</p>`).join('')}</section>${it.kind === 'recipe' ? recipe(it) : travel(it)}`;
}
const bottom = (_l: Summary[]) => '';

export function detailPage(site: SiteData, route: Extract<Route, { name: 'lifepost' }>, it: Item): Page {
  return ckDetail(site, route, { label: '生活专栏', base: '/life/', cls: 'lf', title: it.title, summary: it.summary, sub: sub(it), note: '示例专栏：菜谱、游记和作者都是虚构的演示内容；用量换算和步骤勾选只在这台设备上。', body: body(it), attrs: attrs(it) });
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return ckList(site, route, { label: '生活专栏', desc: '家常菜谱和旅行笔记：菜谱能按人数换算用量，游记按天排好行程', base: '/life/', cls: 'lf', cards: list.map((s) => ({ slug: s.slug, title: s.title, summary: s.summary, meta: meta(s) })), empty: '还没有专栏文章。', top: top(list), bottom: bottom(list), attrs: listAttrs(list) });
}
