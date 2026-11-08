/**
 * L52 / v1.52.0 问答区页面（纯函数，浏览器和预渲染共用；没有 JS 也完整）：/qa/ 问题卡片（回答数、已解决 / 待回答）+ 状态筛选（JS 后出现）；/qa/:slug/ 问题正文、回答有序列表（采纳的在最前并标「已采纳」，然后按票数），赞同 / 反对按钮 JS 加载后出现。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { url, type Page, type Route } from './render';
import { chips, ckDetail, ckList } from './ck-view';
import { rankAnswers, stateText, type Item, type Summary } from './qa-core';
import type { SiteData } from './types';
void icon; void url; void chips; void e;

const sub = (it: Item) => `问答区 · ${it.asker} 提问 · ${stateText(it.answers.length, it.accepted !== undefined)}`;
const attrs = (it: Item) => `data-question="${e(it.slug)}"`;
const listAttrs = (_l: Summary[]) => 'data-questions';
const meta = (s: Summary) => `${e(s.asker)} · <span class="qa-state${s.solved ? ' is-solved' : ''}" data-solved="${s.solved ? 1 : 0}">${stateText(s.answers, s.solved)}</span> ${chips(s.tags)}`;
const top = (_l: Summary[]) =>
  `<fieldset class="qa-filter" data-qa-filter hidden><legend class="small">按状态筛选</legend>${[['all', '全部'], ['open', '待解决'], ['solved', '已解决']].map(([v, t], i) => `<label><input type="radio" name="qa-filter" value="${v}"${i ? '' : ' checked'}> ${t}</label>`).join('')} <span class="small muted" data-qa-filter-status role="status"></span></fieldset>`;
function body(it: Item): string {
  const ans = rankAnswers(it.answers, it.accepted);
  return `${chips(it.tags)}
<section class="qa-q" aria-labelledby="qa-q-h"><h2 id="qa-q-h">问题</h2>${it.body.map((p) => `<p>${e(p)}</p>`).join('')}</section>
<section aria-labelledby="qa-a-h"><h2 id="qa-a-h">${ans.length} 个回答</h2>${
    ans.length
      ? `<ol class="qa-answers" role="list">${ans
          .map(
            (a) =>
              `<li class="qa-answer${a.id === it.accepted ? ' is-accepted' : ''}" id="answer-${e(a.id)}" data-answer="${e(a.id)}" data-votes="${a.votes}"><div class="qa-vote"><button type="button" class="qa-vbtn" data-qa-up aria-pressed="false" aria-label="赞同 ${e(a.author)} 的回答" hidden>▲</button><span class="qa-n"><span data-qa-n>${a.votes}</span> 票</span><button type="button" class="qa-vbtn" data-qa-down aria-pressed="false" aria-label="反对 ${e(a.author)} 的回答" hidden>▼</button></div><div class="qa-body"><p class="qa-by small"><strong>${e(a.author)}</strong> <time datetime="${a.date}">${a.date}</time>${a.id === it.accepted ? ' <span class="qa-accepted">✓ 已采纳</span>' : ''}</p><p class="qa-text">${e(a.text)}</p></div></li>`,
          )
          .join('')}</ol>`
      : '<p class="muted">还没有回答。</p>'
  }<p class="small" data-qa-status role="status"></p></section>`;
}
const bottom = (_l: Summary[]) => '';

export function detailPage(site: SiteData, route: Extract<Route, { name: 'question' }>, it: Item): Page {
  return ckDetail(site, route, { label: '问答区', base: '/qa/', cls: 'qa', title: it.title, summary: it.summary, sub: sub(it), note: '示例问答：提问者、回答者和票数都是虚构的演示内容；你的赞同 / 反对只记在这台设备上。', body: body(it), attrs: attrs(it) });
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return ckList(site, route, { label: '问答区', desc: '提问、回答、采纳：被采纳的回答排在最前，赞同 / 反对只记在本机', base: '/qa/', cls: 'qa', cards: list.map((s) => ({ slug: s.slug, title: s.title, summary: s.summary, meta: meta(s) })), empty: '还没有问题。', top: top(list), bottom: bottom(list), attrs: listAttrs(list) });
}
