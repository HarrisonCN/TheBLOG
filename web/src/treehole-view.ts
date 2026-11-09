/**
 * L62 / v1.62.0 树洞页面（纯函数，浏览器和预渲染共用；没有 JS 也完整）：/treehole/ 已公开的纸条卡片（心情、抱抱数）+「写一张纸条」（JS 后出现：按审核规则检查，通过后进入「我的纸条（待审核，仅本机）」）；/treehole/:slug/ 正文与匿名回应，JS 后可「抱抱」。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { url, type Page, type Route } from './render';
import { chips, ckDetail, ckList } from './ck-view';
import { MAX_NOTE, MOODS, type Item, type Summary } from './treehole-core';
import type { SiteData } from './types';
void icon; void url; void chips; void e;

const sub = (it: Item) => `树洞 · 心情：${MOODS[it.mood]} · ${it.date}`;
const attrs = (it: Item) => `data-treenote="${e(it.slug)}" data-hugs="${it.hugs}"`;
const listAttrs = (_l: Summary[]) => 'data-treehole';
const meta = (s: Summary) => `<span class="tn-mood">${MOODS[s.mood]}</span> · ${s.hugs} 个抱抱 · ${s.replies} 条回应`;
const bottom = (_l: Summary[]) =>
  `<section class="tn-write" data-tn-write hidden aria-labelledby="tn-w-h"><h2 id="tn-w-h">写一张纸条</h2><p class="small muted">不署名，不要留手机号、邮箱、网址或 @ 任何人。演示站不会上传：纸条只保存在这台设备上，标为「待审核」。</p><form data-tn-form><label class="tn-field">心情<select name="mood">${Object.entries(MOODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label><label class="tn-field">想说的话<textarea name="text" rows="4" maxlength="${MAX_NOTE + 50}" aria-describedby="tn-hint"></textarea></label><p class="small muted" id="tn-hint">最多 ${MAX_NOTE} 字。</p><p><button type="submit" class="btn btn--sm">${icon('send')}投进树洞（本机）</button></p><p class="small" data-tn-msg role="status"></p></form><h3>我的纸条（待审核，仅本机）</h3><ul class="tn-mine" role="list" data-tn-mine></ul><p class="small muted" data-tn-none>还没有。</p></section>`;
function body(it: Item): string {
  return `<div class="tn-paper">${it.body.map((p) => `<p>${e(p)}</p>`).join('')}</div>
<p class="tn-hug"><span class="small muted"><span data-tn-n>${it.hugs}</span> 个抱抱</span> <span data-tn-tools hidden><button type="button" class="btn btn--sm" data-tn-hug aria-pressed="false">${icon('heart')}<span>抱抱</span></button> <span class="small" data-tn-status role="status"></span></span></p>
<section aria-labelledby="tn-r-h"><h2 id="tn-r-h">匿名回应（${it.replies.length}）</h2>${
    it.replies.length ? `<ul class="tn-replies" role="list">${it.replies.map((r) => `<li id="r-${e(r.id)}">${e(r.text)}</li>`).join('')}</ul>` : '<p class="muted">还没有回应。</p>'
  }</section>`;
}
const top = (_l: Summary[]) => '';

export function detailPage(site: SiteData, route: Extract<Route, { name: 'treenote' }>, it: Item): Page {
  return ckDetail(site, route, { label: '树洞', base: '/treehole/', cls: 'tn', title: it.title, summary: it.summary, sub: sub(it), note: '示例树洞纸条：内容都是虚构的演示文字；树洞不显示任何作者信息，纸条经审核才公开。', body: body(it), attrs: attrs(it) });
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return ckList(site, route, { label: '树洞', desc: '匿名说说心里话：不署名、不留联系方式，审核通过才公开', base: '/treehole/', cls: 'tn', cards: list.map((s) => ({ slug: s.slug, title: s.title, summary: s.summary, meta: meta(s) })), empty: '树洞里还没有公开的纸条。', top: top(list), bottom: bottom(list), attrs: listAttrs(list) });
}
