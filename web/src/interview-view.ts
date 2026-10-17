/**
 * L44 / v1.44.0 摄影人访谈页面（纯函数，浏览器和预渲染共用；不需要 JS）：
 * - /interviews/：访谈卡片（受访者、身份、问题数、阅读时长）；
 * - /interviews/:slug/：虚构声明、受访者简介、目录（问题锚点）、问答（每问 h2 + 回答段落）、引语卡（放在出处回答之后）。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, pageHead, shell, tile, url, type Page, type Route } from './render';
import { placeQuotes, readingMinutes, toc, type Item, type Summary } from './interview-core';
import type { SiteData } from './types';

export function detailPage(site: SiteData, route: Extract<Route, { name: 'interview' }>, it: Item): Page {
  const quotes = placeQuotes(it.qa, it.quotes);
  const nav = `<nav class="iv-toc" aria-label="访谈目录"><h2 class="iv-toc__h">目录</h2><ol>${toc(it.qa)
    .map((x) => `<li><a href="${x.href}">${e(x.text)}</a></li>`)
    .join('')}</ol></nav>`;
  const qa = it.qa
    .map(
      (x, i) =>
        `<section class="iv-qa" id="q-${e(x.id)}" aria-labelledby="q-${e(x.id)}-h"><h2 class="iv-q" id="q-${e(x.id)}-h"><span class="iv-q__no" aria-hidden="true">Q${i + 1}</span>${e(x.q)}</h2>${x.a
          .map((p) => `<p class="iv-a">${e(p)}</p>`)
          .join('')}${(quotes[x.id] ?? []).map((s) => `<blockquote class="iv-quote"><p>${e(s)}</p><footer class="small">— ${e(it.person.name)}</footer></blockquote>`).join('')}</section>`,
    )
    .join('');
  const cover = it.cover ? `<figure class="iv-cover"><img src="${e(it.cover.src)}" alt="${e(it.cover.alt)}" width="${it.cover.w}" height="${it.cover.h}" loading="lazy" decoding="async"><figcaption class="small muted">${e(it.cover.alt)}</figcaption></figure>` : '';
  const body = `<div class="iv" data-interview="${e(it.slug)}">
<p class="iv-note small" role="note">${icon('message')}<span>虚构访谈：受访者与内容均为示例，不对应真实人物。</span></p>
<p class="iv-meta small muted"><span>${it.qa.length} 个问题</span><span>约 ${readingMinutes(it)} 分钟读完</span></p>
<div class="iv-person"><p class="iv-person__name"><strong>${e(it.person.name)}</strong> · ${e(it.person.role)}</p><p class="iv-person__bio small">${e(it.person.bio)}</p></div>
${cover}
${nav}
<div class="iv-body">${qa}</div>
<p class="iv-back"><a class="btn btn--sm" href="${url('/interviews/')}">${icon('message')}全部访谈</a></p>
</div>`;
  return shell(site, route, {
    title: `${it.title} · 摄影人访谈`,
    description: it.summary.slice(0, 120),
    top: pageHead(it.title, `摄影人访谈 · ${it.person.name}`),
    main: bento(tile('full', body, { cls: 'ia-tile iv-tile' })),
    kind: 'page--ia page--interview',
  });
}

function card(s: Summary): string {
  const cover = s.cover ? `<span class="iv-card__cover"><img src="${e(s.cover.src)}" alt="${e(s.cover.alt)}" width="${s.cover.w}" height="${s.cover.h}" loading="lazy" decoding="async"></span>` : '';
  return `<li class="iv-card"><a class="iv-card__a" href="${url(`/interviews/${s.slug}/`)}">${cover}<span class="iv-card__title">${e(s.title)}</span><span class="iv-card__meta small muted">${e(s.name)} · ${e(s.role)} · ${s.questions} 问 · 约 ${s.minutes} 分钟</span><span class="iv-card__sum small">${e(s.summary)}</span></a></li>`;
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return shell(site, route, {
    title: '摄影人访谈',
    description: '和拍照的人聊聊：怎么开始、怎么拍、怎么坚持（受访者均为虚构）',
    top: pageHead('摄影人访谈', '和拍照的人聊聊：怎么开始、怎么拍、怎么坚持（受访者均为虚构）'),
    main: bento(tile('full', list.length ? `<ul class="iv-cards" role="list">${list.map(card).join('')}</ul>` : '<p class="muted">还没有访谈。</p>', { cls: 'ia-tile iv-tile' })),
    kind: 'page--ia page--interview',
  });
}
