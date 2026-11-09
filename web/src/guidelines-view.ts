/**
 * L65 / v1.65.0 社区守则与治理页面（纯函数，浏览器和预渲染共用；没有 JS 也完整）：/guidelines/ 守则章节卡片 + 治理透明度看板（按月汇总举报与处理，表格）+ 举报表单（JS 后出现，检查通过后保存为「已提交（仅本机）」可撤回）；/guidelines/:slug/ 条文（有序列表，带示例）、处理方式、本章节的治理记录。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { url, type Page, type Route } from './render';
import { chips, ckDetail, ckList } from './ck-view';
import { dashboard, REASONS, type Item, type Summary } from './guidelines-core';
import type { SiteData } from './types';
void icon; void url; void chips; void e;

const sub = (it: Item) => `社区守则 · 第 ${it.chapter} 章 · ${it.rules.length} 条`;
const attrs = (it: Item) => `data-guideline="${e(it.slug)}"`;
const listAttrs = (_l: Summary[]) => 'data-guidelines';
const meta = (s: Summary) => `第 ${s.chapter} 章 · ${s.rules} 条`;
function table(rows: ReturnType<typeof dashboard>, cap: string): string {
  if (!rows.length) return '<p class="muted small">还没有治理记录。</p>';
  return `<div class="gl-tablewrap" tabindex="0" role="region" aria-label="${e(cap)}"><table class="gl-table"><caption>${e(cap)}</caption><thead><tr><th scope="col">月份</th><th scope="col">举报</th><th scope="col">删除</th><th scope="col">警告</th><th scope="col">驳回</th><th scope="col">处理率</th></tr></thead><tbody>${rows
    .map((r) => `<tr><th scope="row">${r.month}</th><td>${r.reports}</td><td>${r.removed}</td><td>${r.warned}</td><td>${r.dismissed}</td><td>${r.rate}%</td></tr>`)
    .join('')}</tbody></table></div>`;
}
const top = (list: Summary[]) => `<p class="small muted">守则按章节排列，每一章都写明了怎么处理。看到违反守则的内容，可以在页面底部举报。</p>`;
const bottom = (list: Summary[]) =>
  `<section class="gl-dash" aria-labelledby="gl-d-h"><h2 id="gl-d-h">治理透明度</h2>${table(dashboard(list), '按月汇总的举报与处理（示例数据）')}</section>
<section class="gl-report" data-gl-report hidden aria-labelledby="gl-r-h"><h2 id="gl-r-h">举报内容</h2><p class="small muted">演示站不会发送举报：检查通过后只保存在这台设备上，显示为「已提交（仅本机）」。</p><form data-gl-form><label class="gl-field">页面地址<input name="target" placeholder="/threads/desk-setup/" autocomplete="off"></label><label class="gl-field">理由<select name="reason"><option value="">请选择</option>${Object.entries(REASONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label><label class="gl-field">说明（选「其他」时必填）<textarea name="details" rows="3" maxlength="350"></textarea></label><p><button type="submit" class="btn btn--sm">${icon('flag')}提交举报（本机）</button></p><p class="small" data-gl-msg role="status"></p></form><h3>我的举报（仅本机）</h3><ul class="gl-mine" role="list" data-gl-mine></ul><p class="small muted" data-gl-none>还没有。</p></section>`;
function body(it: Item): string {
  return `<section aria-labelledby="gl-rules-h"><h2 id="gl-rules-h">条文</h2><ol class="gl-rules">${it.rules.map((r) => `<li id="rule-${e(r.id)}"><span class="gl-rule">${e(r.text)}</span>${r.example ? `<span class="gl-ex small">例：${e(r.example)}</span>` : ''}</li>`).join('')}</ol></section>
<section aria-labelledby="gl-act-h"><h2 id="gl-act-h">怎么处理</h2>${it.actions.map((p) => `<p>${e(p)}</p>`).join('')}</section>
<section aria-labelledby="gl-log-h"><h2 id="gl-log-h">本章治理记录</h2>${table(dashboard([it]), `第 ${it.chapter} 章的月度记录（示例数据）`)}</section>`;
}

export function detailPage(site: SiteData, route: Extract<Route, { name: 'guideline' }>, it: Item): Page {
  return ckDetail(site, route, { label: '社区守则与治理', base: '/guidelines/', cls: 'gl', title: it.title, summary: it.summary, sub: sub(it), note: '示例守则与治理数据：条文是演示用的示例，处理数字全部虚构；举报只保存在这台设备上，演示站不会发送。', body: body(it), attrs: attrs(it) });
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return ckList(site, route, { label: '社区守则与治理', desc: '社区守则逐条写清楚，怎么举报、怎么处理，以及每月的治理数据', base: '/guidelines/', cls: 'gl', cards: list.map((s) => ({ slug: s.slug, title: s.title, summary: s.summary, meta: meta(s) })), empty: '还没有守则。', top: top(list), bottom: bottom(list), attrs: listAttrs(list) });
}
