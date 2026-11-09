/**
 * L53 / v1.53.0 投票与小测验页面（纯函数，浏览器和预渲染共用；没有 JS 也完整）：/polls/ 投票与测验卡片（类型、题数、发起人）；/polls/:slug/ 每题一个表单（单选 + 提交，JS 加载后出现）与结果条（progress，预渲染为示例票数）；测验答完一题才显示对错与解析，全部答完显示得分。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { url, type Page, type Route } from './render';
import { chips, ckDetail, ckList } from './ck-view';
import { kindText, tally, type Item, type Summary } from './polls-core';
import type { SiteData } from './types';
void icon; void url; void chips; void e;

const sub = (it: Item) => `${kindText(it.kind)} · ${it.host} 发起 · ${it.questions.length} 题`;
const attrs = (it: Item) => `data-poll="${e(it.slug)}" data-kind="${it.kind}"`;
const meta = (s: Summary) => `<span class="pl-kind">${kindText(s.kind)}</span> · ${s.questions} 题 · ${e(s.host)} · 共 ${s.votes} 票`;
function bars(q: Item['questions'][number]): string {
  return `<ul class="pl-bars" role="list" data-pl-bars>${tally(q.options)
    .map((t) => `<li data-opt="${e(t.id)}"><span class="pl-bar__label"><span class="pl-bar__text">${e(t.text)}</span> <span class="pl-bar__n small muted"><span data-pl-n>${t.n}</span> 票 · <span data-pl-pct>${t.pct}</span>%</span></span><progress max="100" value="${t.pct}" aria-label="${e(t.text)} ${t.pct}%"></progress></li>`)
    .join('')}</ul>`;
}
function body(it: Item): string {
  const quiz = it.kind === 'quiz';
  return `<ol class="pl-qs" role="list">${it.questions
    .map(
      (q, i) =>
        `<li class="pl-q" id="q-${e(q.id)}" data-q="${e(q.id)}"><h2 class="pl-q__h" id="q-${e(q.id)}-h">${i + 1}. ${e(q.text)}</h2><form class="pl-form" data-pl-form hidden aria-labelledby="q-${e(q.id)}-h">${q.options
          .map((o) => `<label class="pl-opt"><input type="radio" name="q-${e(q.id)}" value="${e(o.id)}"${quiz && o.correct ? ' data-c' : ''}> ${e(o.text)}</label>`)
          .join('')}<button type="submit" class="btn btn--sm">${quiz ? '提交答案' : '投票'}</button></form>${bars(q)}${q.explain ? `<p class="pl-explain small" data-pl-explain${quiz ? ' hidden' : ''}>${e(q.explain)}</p>` : ''}<p class="small pl-st" data-pl-st role="status"></p></li>`,
    )
    .join('')}</ol>${quiz ? '<p class="pl-score" data-pl-score role="status" hidden></p>' : ''}`;
}
const top = (_l: Summary[]) => '';
const bottom = (_l: Summary[]) => '';
const listAttrs = (_l: Summary[]) => '';

export function detailPage(site: SiteData, route: Extract<Route, { name: 'poll' }>, it: Item): Page {
  return ckDetail(site, route, { label: '投票与小测验', base: '/polls/', cls: 'pl', title: it.title, summary: it.summary, sub: sub(it), note: '示例投票与测验：题目、选项和票数都是虚构的演示内容；你的选择只记在这台设备上，不会上传。', body: body(it), attrs: attrs(it) });
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return ckList(site, route, { label: '投票与小测验', desc: '社区投票看大家怎么选，小测验答完看得分；每台设备每题只能投一次', base: '/polls/', cls: 'pl', cards: list.map((s) => ({ slug: s.slug, title: s.title, summary: s.summary, meta: meta(s) })), empty: '还没有投票或测验。', top: top(list), bottom: bottom(list), attrs: listAttrs(list) });
}
