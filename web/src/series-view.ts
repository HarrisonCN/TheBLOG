/**
 * L25 / v1.25.0 系列与影集 2.0 的页面（纯函数，浏览器和预渲染共用）：
 * - /series/:name/ 系列详情：封面、简介、完结 / 连载中、按顺序的篇目、读者进度（浏览器端 series-client 用本机阅读记录填充）；
 * - /monthly/ 月度合集目录、/monthly/YYYY-MM/ 某月的文章 / 影集 / 作品 + 上一月 / 下一月。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, formatDate, img, kicker, pageHead, postCard, postPath, shell, tile, url, type Page, type Route } from './render';
import { findSeries, monthLabel, monthlyGroups, monthNav, type MonthGroup, type Series } from './series-core';
import type { Work } from './sections';
import type { SiteData } from './types';

export const seriesHref = (name: string) => url(`/series/${encodeURIComponent(name)}/`);
export const monthHref = (ym: string) => url(`/monthly/${ym}/`);
const statusChip = (s: Series) => (s.status === 'finished' ? '<span class="chip series-chip series-chip--done">已完结</span>' : '<span class="chip chip--accent series-chip">连载中</span>');

export function seriesDetailPage(site: SiteData, route: Extract<Route, { name: 'seriesdetail' }>): Page | null {
  const s = findSeries(site.posts, route.series);
  if (!s) return null;
  const parts = s.parts
    .map(
      (p, i) =>
        `<li class="series-part" data-slug="${e(p.slug)}"><span class="series-part__n" aria-hidden="true">${i + 1}</span><a class="series-part__a" href="${postPath(p.slug)}"><b>${e(p.title)}</b><small>${e(formatDate(p.publishedAt ?? p.createdAt))}${p.summary ? ` · ${e(p.summary)}` : ''}</small></a><span class="series-part__st" data-state hidden></span></li>`,
    )
    .join('');
  const first = s.parts[0]!;
  const progress = `<div class="series-progress" data-series-progress data-slugs="${e(s.parts.map((p) => p.slug).join(','))}" aria-live="polite">
  <div class="series-progress__bar" role="progressbar" aria-label="我的阅读进度" aria-valuemin="0" aria-valuemax="${s.parts.length}" aria-valuenow="0" aria-valuetext="已读 0 篇，共 ${s.parts.length} 篇"><span style="width:0%"></span></div>
  <p class="series-progress__txt"><span data-progress-text>已读 0 / ${s.parts.length} 篇</span> · <span class="muted small">进度只记在这台设备的浏览器里</span></p>
  <a class="btn series-progress__go" data-progress-go href="${postPath(first.slug)}">${icon('arrowRight')}<span>从第一篇读起</span></a>
</div>`;
  return shell(site, route, {
    title: `${s.name} · 系列连载`,
    description: s.intro || `系列「${s.name}」共 ${s.parts.length} 篇`,
    top: pageHead(s.name, `系列连载 · ${s.parts.length} 篇 · ${s.status === 'finished' ? '已完结' : '连载中'} · 更新于 ${formatDate(s.updatedAt)}`, s.cover),
    main: bento(
      tile('full', `${kicker('list', `系列 · ${s.parts.length} 篇`)}<div class="series-head">${statusChip(s)}<p class="series-intro">${e(s.intro)}</p></div>${progress}`, { cls: 'series-tile', attrs: 'data-series' }) +
        tile('full', `<h2 class="ia-h">${icon('book')}<span>篇目</span></h2><ol class="series-parts">${parts}</ol><p class="muted small series-print"><button type="button" class="btn btn--soft js-series-print">${icon('download')}打印 / 存为 PDF</button> <a href="${url('/series/')}">全部系列</a></p>`, { cls: 'series-tile' }),
    ),
    kind: 'page--ia page--series',
  });
}

function monthCard(g: MonthGroup): string {
  const cover = g.essays[0]?.coverUrl ?? g.posts.find((p) => p.coverUrl)?.coverUrl ?? g.works[0]?.url ?? null;
  const bits = [g.posts.length ? `${g.posts.length} 篇文章` : '', g.essays.length ? `${g.essays.length} 组影集` : '', g.works.length ? `${g.works.length} 张作品` : ''].filter(Boolean).join(' · ');
  return `<li class="month-card"><a class="month-card__a" href="${monthHref(g.ym)}">${cover ? img(cover, '', 'month-card__img', { sizes: '(max-width: 700px) 100vw, 360px' }) : ''}<span class="month-card__txt"><b>${monthLabel(g.ym)}</b><small>${bits}</small></span></a></li>`;
}

export function monthlyPage(site: SiteData, route: Route, works: Work[]): Page {
  const groups = monthlyGroups(site.posts, works);
  return shell(site, route, {
    title: '月度合集',
    description: '每个月写的文章、拍的影集和作品，自动整理成一页',
    top: pageHead('月度合集', `${groups.length} 个月 · 按上海时间分月 · 自动生成`),
    main: groups.length ? bento(tile('full', `${kicker('calendar', '按月份')}<ul class="month-grid" role="list">${groups.map(monthCard).join('')}</ul>`, { cls: 'ia-tile' })) : bento(tile('full', '<p class="empty">还没有内容。</p>')),
    kind: 'page--ia page--monthly',
  });
}

export function monthPage(site: SiteData, route: Extract<Route, { name: 'month' }>, works: Work[]): Page | null {
  const groups = monthlyGroups(site.posts, works);
  const g = groups.find((x) => x.ym === route.ym);
  if (!g) return null;
  const nav = monthNav(
    groups.map((x) => x.ym),
    g.ym,
  );
  const pn = `<nav class="month-nav" aria-label="切换月份">${nav.prev ? `<a class="month-nav__a" href="${monthHref(nav.prev)}" rel="prev">${icon('arrowLeft')}<span><small>上一月</small>${monthLabel(nav.prev)}</span></a>` : '<span></span>'}<a class="month-nav__all" href="${url('/monthly/')}">全部月份</a>${nav.next ? `<a class="month-nav__a month-nav__a--next" href="${monthHref(nav.next)}" rel="next"><span><small>下一月</small>${monthLabel(nav.next)}</span>${icon('arrowRight')}</a>` : '<span></span>'}</nav>`;
  const blocks: string[] = [];
  if (g.essays.length) blocks.push(tile('full', `<h2 class="ia-h">${icon('image')}<span>影集 · ${g.essays.length}</span></h2>`, { cls: 'ia-tile month-h' }), ...g.essays.map((p, i) => postCard(p, i, 'third')));
  if (g.posts.length) blocks.push(tile('full', `<h2 class="ia-h">${icon('book')}<span>文章 · ${g.posts.length}</span></h2>`, { cls: 'ia-tile month-h' }), ...g.posts.map((p, i) => postCard(p, i, 'third')));
  if (g.works.length)
    blocks.push(
      tile(
        'full',
        `<h2 class="ia-h">${icon('aperture')}<span>作品 · ${g.works.length}</span></h2><ul class="month-works" role="list">${g.works
          .map((w) => `<li><a href="${url('/works/')}">${img(w.url, w.title, 'month-works__img', { sizes: '(max-width: 700px) 50vw, 240px' })}<span>${e(w.title)}</span></a></li>`)
          .join('')}</ul>`,
        { cls: 'ia-tile' },
      ),
    );
  return shell(site, route, {
    title: `${monthLabel(g.ym)} · 月度合集`,
    description: `${monthLabel(g.ym)}：${g.count} 项内容`,
    top: pageHead(`${monthLabel(g.ym)}合集`, `${g.count} 项 · 文章 ${g.posts.length} · 影集 ${g.essays.length} · 作品 ${g.works.length}`, g.essays[0]?.coverUrl ?? g.posts.find((p) => p.coverUrl)?.coverUrl ?? null),
    main: bento(tile('full', pn, { cls: 'ia-tile' })) + bento(blocks.join(''), 'bento--posts'),
    kind: 'page--ia page--monthly',
  });
}
