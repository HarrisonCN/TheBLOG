/**
 * L48 / v1.48.0 投稿与展览征集页面（纯函数 + 「现在」，浏览器和预渲染共用；不需要 JS）：
 * - /calls/：开放中（按截止时间升序，状态徽标 + 剩余天数）与「已截止（归档）」两组；每条都有 .ics 下载（data: 链接）；
 * - /calls/:slug/：虚构声明、截止时间（按它自己的时区）、状态、报名费、要求列表、外部链接、.ics。
 * 状态在渲染时按当时的时间计算；页面加载后 call-client 按当前时间再算一次（没有计时器）。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, pageHead, shell, tile, url, type Page, type Route } from './render';
import { deadlineState, deadlineText, icsHref, KIND_LABEL, partition, stateText, toIcs, type Item, type Summary } from './call-core';
import type { SiteData } from './types';

const badge = (deadline: string, now: Date) => {
  const s = deadlineState(deadline, now);
  return `<span class="cl-state cl-state--${s.state}" data-deadline="${e(deadline)}">${stateText(s)}</span>`;
};
const ics = (it: Pick<Item, 'slug' | 'title' | 'organizer' | 'deadline' | 'url' | 'summary'>, now: Date) =>
  `<a class="cl-ics" href="${e(icsHref(toIcs(it, now)))}" download="call-${e(it.slug)}.ics">${icon('calendar')}加到日历（.ics）</a>`;

export function detailPage(site: SiteData, route: Extract<Route, { name: 'call' }>, it: Item, now: Date = new Date()): Page {
  const body = `<div class="cl" data-calls>
<p class="cl-note small" role="note">${icon('megaphone')}<span>虚构征集：主办方与内容均为示例，不对应真实活动，请勿投稿。</span></p>
<dl class="cl-facts">
<div><dt>类型</dt><dd>${KIND_LABEL[it.kind]}</dd></div>
<div><dt>主办方</dt><dd>${e(it.organizer)}</dd></div>
<div><dt>截止</dt><dd><time datetime="${e(it.deadline)}">${deadlineText(it.deadline)}</time></dd></div>
<div><dt>状态</dt><dd>${badge(it.deadline, now)}</dd></div>
<div><dt>报名费</dt><dd>${it.fee ? `${it.fee} 元` : '免费'}</dd></div>
</dl>
<p class="cl-sum">${e(it.summary)}</p>
<section class="cl-sec" aria-labelledby="cl-rules-h"><h2 id="cl-rules-h">要求</h2><ol class="cl-rules">${it.rules.map((r) => `<li>${e(r)}</li>`).join('')}</ol></section>
<p class="cl-actions">${ics(it, now)}${it.url ? ` <a class="cl-ext" href="${e(it.url)}" rel="noopener nofollow external">${icon('external')}征集页面（示例链接）</a>` : ''}</p>
<p class="cl-back"><a class="btn btn--sm" href="${url('/calls/')}">${icon('megaphone')}全部征集</a></p>
</div>`;
  return shell(site, route, {
    title: `${it.title} · 投稿与展览征集`,
    description: it.summary.slice(0, 120),
    top: pageHead(it.title, `投稿与展览征集 · ${KIND_LABEL[it.kind]}`),
    main: bento(tile('full', body, { cls: 'ia-tile cl-tile' })),
    kind: 'page--ia page--calls',
  });
}

function card(s: Summary, now: Date): string {
  return `<li class="cl-card" data-call="${e(s.slug)}"><h3 class="cl-card__title"><a href="${url(`/calls/${s.slug}/`)}">${e(s.title)}</a></h3><p class="cl-card__meta small muted">${KIND_LABEL[s.kind]} · ${e(s.organizer)} · ${s.fee ? `${s.fee} 元` : '免费'}</p><p class="cl-card__due small">截止 <time datetime="${e(s.deadline)}">${deadlineText(s.deadline)}</time> ${badge(s.deadline, now)}</p><p class="cl-card__sum small">${e(s.summary)}</p><p class="small">${ics(s, now)}</p></li>`;
}

export function listPage(site: SiteData, route: Route, list: Summary[], now: Date = new Date()): Page {
  const { open, closed } = partition(list, now);
  const body = list.length
    ? `<div class="cl" data-calls>
<p class="cl-note small" role="note">${icon('megaphone')}<span>以下征集全部是虚构示例。截止状态按页面打开时的时间计算。</span></p>
<section class="cl-sec" aria-labelledby="cl-open-h"><h2 id="cl-open-h">开放中</h2><ul class="cl-cards" role="list" data-cl-open>${open.map((s) => card(s, now)).join('')}</ul><p class="muted small" data-cl-empty${open.length ? ' hidden' : ''}>现在没有开放中的征集。</p></section>
<section class="cl-sec" aria-labelledby="cl-closed-h"><h2 id="cl-closed-h">已截止（归档）</h2><ul class="cl-cards cl-cards--closed" role="list" data-cl-closed>${closed.map((s) => card(s, now)).join('')}</ul></section>
</div>`
    : '<p class="muted">还没有征集。</p>';
  return shell(site, route, {
    title: '投稿与展览征集',
    description: '摄影比赛、展览和投稿的截止时间与要求，可导出到日历（示例均为虚构）',
    top: pageHead('投稿与展览征集', '摄影比赛、展览和投稿的截止时间与要求，可导出到日历（示例均为虚构）'),
    main: bento(tile('full', body, { cls: 'ia-tile cl-tile' })),
    kind: 'page--ia page--calls',
  });
}
