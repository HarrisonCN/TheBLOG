/**
 * L27 / v1.27.0 阅读与书影音 2.0 的页面（纯函数，浏览器和预渲染共用）：
 * - /quotes/ 书摘：文章里的摘录卡片 + 书影音条目的摘录，按来源筛选，卡片链回文章里的那一段（#q-xxxx）；
 * - /shelf/:year/ 年度书影音：数量、类型、完成 / 在看 / 想看、平均分、月份分布、高分推荐和全部条目；
 * - /reading-list/ 稍后读：外壳（列表只存在访客自己的浏览器里，由 reading2-client 填充，不进索引）。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, kicker, pageHead, shell, tile, url, type Page, type Route } from './render';
import { mergeQuotes, shelfQuotes, shelfYears, yearReport, type QuoteCard } from './reading-core';
import { SHELF_KIND, shelfStatusLabel, type ShelfItem } from './sections';
import type { SiteData } from './types';

export const shelfYearHref = (y: string) => url(`/shelf/${y}/`);
const stars = (n: number) => `<span class="rate" role="img" aria-label="${n} / 5 分">${Array.from({ length: 5 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;

function quoteCard(q: QuoteCard): string {
  const href = q.from === 'post' && q.slug ? url(`/posts/${q.slug}/#${q.id}`) : '';
  const src = q.source ? `<cite>${e(q.source)}</cite>` : '';
  const where =
    q.from === 'post' && q.postTitle
      ? `<a class="qcard__from" href="${href}">${icon('file')}<span>摘自《${e(q.postTitle)}》</span></a>`
      : q.from === 'shelf'
        ? `<a class="qcard__from" href="${url('/shelf/')}">${icon(SHELF_KIND[q.kind as keyof typeof SHELF_KIND]?.icon ?? 'library')}<span>书影音</span></a>`
        : '';
  return `<li class="qcard" data-from="${q.from}" id="card-${e(q.id)}"><figure class="quote-card" data-quote><blockquote class="quote-card__q"><p>${e(q.text)}</p></blockquote>${src ? `<figcaption class="quote-card__src">— ${src}</figcaption>` : ''}</figure>${where}</li>`;
}

export function quotesPage(site: SiteData, route: Route, quotes: QuoteCard[], shelf: ShelfItem[]): Page {
  const all = mergeQuotes(quotes, shelfQuotes(shelf));
  const nPost = all.filter((q) => q.from === 'post').length;
  const nShelf = all.length - nPost;
  const seg = `<div class="seg js-quotes-filter" role="group" aria-label="按来源筛选"><button type="button" class="seg__b is-on" data-v="" aria-pressed="true">全部 <small>${all.length}</small></button><button type="button" class="seg__b" data-v="post" aria-pressed="false">${icon('file')}来自文章 <small>${nPost}</small></button><button type="button" class="seg__b" data-v="shelf" aria-pressed="false">${icon('library')}来自书影音 <small>${nShelf}</small></button></div>`;
  return shell(site, route, {
    title: '书摘',
    description: '文章和书影音里摘下来的句子',
    top: pageHead('书摘', `${all.length} 段摘录 · 每张卡片都可以生成分享图片`),
    main: all.length
      ? `${bento(tile('full', `${seg}<p class="muted small js-quotes-count" aria-live="polite">共 ${all.length} 段</p>`, { cls: 'quotes-head' }), 'bento--head')}${bento(tile('full', `<ul class="qgrid js-quotes" role="list">${all.map(quoteCard).join('')}</ul><p class="empty js-quotes-empty" hidden>这个来源下还没有摘录。</p>`, { cls: 'quotes-tile' }))}`
      : bento(tile('full', '<p class="empty">还没有摘录。在文章里用 <code>:::quote 来源</code> 块，或在书影音条目里填「摘录」。</p>')),
    kind: 'page--ia page--quotes',
  });
}

export function shelfYearPage(site: SiteData, route: Extract<Route, { name: 'shelfyear' }>, shelf: ShelfItem[]): Page | null {
  const years = shelfYears(shelf);
  if (!years.includes(route.year)) return null;
  const r = yearReport(shelf, route.year);
  const i = years.indexOf(route.year);
  const newer = years[i - 1];
  const older = years[i + 1];
  const kinds = Object.keys(SHELF_KIND) as (keyof typeof SHELF_KIND)[];
  const stat = (n: string | number, label: string) => `<div class="ystat" data-year-stat><b>${n}</b><span>${label}</span></div>`;
  const maxM = Math.max(1, ...r.months);
  const bars = `<ol class="ybars" aria-label="每月标记的条数">${r.months.map((n, m) => `<li title="${m + 1} 月：${n}"><i style="--v:${n / maxM}"></i><span>${m + 1}</span><span class="visually-hidden">月 ${n} 项</span></li>`).join('')}</ol>`;
  const item = (s: ShelfItem) =>
    `<li class="yitem"><span class="yitem__k">${icon(SHELF_KIND[s.kind]?.icon ?? 'book')}<span class="visually-hidden">${SHELF_KIND[s.kind]?.label ?? ''}</span></span><span class="yitem__t"><b>${e(s.title)}</b><small class="muted">${e([s.creator, s.date].filter(Boolean).join(' · '))}</small>${s.note ? `<small>${e(s.note)}</small>` : ''}</span><span class="yitem__r"><span class="chip chip--${s.status}">${shelfStatusLabel(s.kind, s.status)}</span>${s.rating ? stars(s.rating) : ''}</span></li>`;
  const nav = `<nav class="month-nav" aria-label="切换年份">${older ? `<a class="month-nav__a" href="${shelfYearHref(older)}" rel="prev">${icon('arrowLeft')}<span><small>上一年</small>${older}</span></a>` : '<span></span>'}<a class="month-nav__all" href="${url('/shelf/')}">全部书影音</a>${newer ? `<a class="month-nav__a month-nav__a--next" href="${shelfYearHref(newer)}" rel="next"><span><small>下一年</small>${newer}</span>${icon('arrowRight')}</a>` : '<span></span>'}</nav>`;
  return shell(site, route, {
    title: `${route.year} 年度书影音`,
    description: `${route.year} 年读过、看过、听过和玩过的 ${r.total} 项`,
    top: pageHead(`${route.year} 年度书影音`, kinds.filter((k) => r.byKind[k]).map((k) => `${SHELF_KIND[k].label} ${r.byKind[k]}`).join(' · ') || `${r.total} 项`),
    main: bento(
      [
        tile('full', `<div class="ystats">${stat(r.total, '总数')}${stat(r.done, '已完成')}${stat(r.doing, '进行中')}${stat(r.want, '想看')}${stat(r.rated ? r.avgRating.toFixed(1) : '—', `平均分（${r.rated} 项评过分）`)}</div>`, { cls: 'ia-tile year-tile' }),
        tile('full', `${kicker('calendar', '每月')}${bars}`, { cls: 'ia-tile' }),
        r.top.length ? tile('full', `${kicker('star', '高分推荐')}<ul class="ylist" role="list">${r.top.map(item).join('')}</ul>`, { cls: 'ia-tile' }) : '',
        tile('full', `${kicker('library', `全部 ${r.total} 项`)}<ul class="ylist" role="list">${r.items.map(item).join('')}</ul>`, { cls: 'ia-tile' }),
        tile('full', nav, { cls: 'ia-tile' }),
      ].join(''),
    ),
    kind: 'page--ia page--shelfyear',
  });
}

export function readingListPage(site: SiteData, route: Route): Page {
  return shell(site, route, {
    title: '稍后读',
    description: '在文章页点「稍后读」加入的文章（只存在这台设备上）',
    top: pageHead('稍后读', '只保存在这台设备的浏览器里，不上传任何数据'),
    main: bento(
      tile(
        'full',
        `<div class="later-bar"><p class="muted small js-later-count" aria-live="polite">正在读取…</p><div class="later-actions"><button class="btn btn--sm btn--ghost js-later-export" type="button" data-mode="copy">${icon('copy')}复制为 Markdown</button><button class="btn btn--sm btn--ghost js-later-export" type="button" data-mode="download">${icon('download')}下载 .md</button></div></div><ol class="later-list" data-later-list></ol><p class="empty js-later-empty" hidden>还没有加入任何文章。打开一篇文章，点顶部的「稍后读」。</p>`,
        { cls: 'ia-tile later-tile' },
      ),
    ),
    kind: 'page--ia page--later',
  });
}
