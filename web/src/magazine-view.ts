/**
 * L33 / v1.33.0 视觉杂志页面（纯函数，浏览器和预渲染共用；不需要 JS 也完整可读）：
 * - /magazine/：每期一张封面卡片（期号、标题、月份、篇目 / 照片 / 页数）；
 * - /magazine/:slug/：封面 + 编者按 + 目录（页码、锚点）+ 各篇（专题 / 对页 / 画廊 / 引语 / 短讯）+ 上一期 / 下一期。
 * 版式由 magazine-core 的 planSpread / galleryRows 按照片宽高比决定；打印样式一篇一页。
 * magazine-client（按需加载）只加键盘翻篇（← / →、J / K）和当前篇目高亮。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, img, pageHead, shell, tile, url, type Page, type Route } from './render';
import { PIECE_LABEL, galleryRows, pageMap, planSpread, type Issue, type IssueSummary, type MagImage, type Piece } from './magazine-core';
import type { SiteData } from './types';

type Nav = { prev: Pick<IssueSummary, 'slug' | 'no' | 'title'> | null; next: Pick<IssueSummary, 'slug' | 'no' | 'title'> | null };

const month = (ym: string) => {
  const [y, m] = ym.split('-');
  return `${y} 年 ${Number(m)} 月`;
};

function figure(im: MagImage, cls: string, sizes: string, eager = false): string {
  const ratio = (im.w / im.h).toFixed(4);
  return `<figure class="mag-fig ${cls}" style="--ar:${ratio}">${img(im.src, im.alt, 'mag-img', { sizes, eager, w: im.w, h: im.h })}${im.credit ? `<figcaption class="mag-credit small muted">${e(im.credit)}</figcaption>` : ''}</figure>`;
}

function pieceHead(p: Piece, n: number, page: number): string {
  return `<header class="mag-piece__head"><p class="mag-piece__kicker small"><span class="mag-piece__kind">${PIECE_LABEL[p.kind]}</span><span class="muted">第 ${page} 页</span></p>${p.title ? `<h2 class="mag-piece__title" id="piece-${n}-t">${e(p.title)}</h2>` : ''}${p.dek ? `<p class="mag-piece__dek">${e(p.dek)}</p>` : ''}</header>`;
}

function pieceBody(p: Piece): string {
  const ims = p.images ?? [];
  switch (p.kind) {
    case 'feature': {
      const lead = ims[0] ? figure(ims[0], 'mag-fig--lead', '(max-width: 768px) 100vw, 1100px') : '';
      const rest = ims.slice(1).map((x) => figure(x, '', '(max-width: 768px) 100vw, 50vw')).join('');
      return `${lead}${p.text ? `<p class="mag-text">${e(p.text)}</p>` : ''}${rest ? `<div class="mag-row">${rest}</div>` : ''}${p.ref ? `<p class="mag-more"><a class="btn btn--sm" href="${url(`/posts/${p.ref}/`)}">${icon('book')}阅读全文</a></p>` : ''}`;
    }
    case 'spread': {
      const plan = planSpread(ims);
      return `<div class="mag-spread mag-spread--${plan.layout}">${plan.order.map((i, k) => figure(ims[i]!, k === 0 ? 'mag-fig--first' : '', plan.layout === 'panorama' || plan.layout === 'full' ? '(max-width: 768px) 100vw, 1100px' : '(max-width: 768px) 100vw, 50vw')).join('')}</div>`;
    }
    case 'gallery':
      return `<div class="mag-gallery">${galleryRows(ims, 3)
        .map((row) => `<div class="mag-gallery__row">${row.map((i) => figure(ims[i]!, '', '(max-width: 768px) 100vw, 33vw')).join('')}</div>`)
        .join('')}</div>`;
    case 'quote':
      return `<blockquote class="mag-quote"><p>${e(p.text ?? '')}</p>${p.by ? `<footer class="small muted">— ${e(p.by)}</footer>` : ''}</blockquote>`;
    default:
      return `<p class="mag-text">${e(p.text ?? '')}</p>`;
  }
}

export function issueBody(issue: Issue, nav: Nav): string {
  const pm = pageMap(issue);
  const toc = `<nav class="mag-toc" aria-labelledby="mag-toc-h"><h2 id="mag-toc-h" class="mag-toc__h">目录 <span class="small muted">第 2 页</span></h2><ol class="mag-toc__list">${issue.pieces
    .map((p, i) => `<li><a href="#${pm[i]!.id}"><span class="mag-toc__kind small">${PIECE_LABEL[p.kind]}</span><span class="mag-toc__title">${e(p.title ?? (p.text ?? '').slice(0, 24))}</span><span class="mag-toc__page small muted">第 ${pm[i]!.page} 页</span></a></li>`)
    .join('')}</ol></nav>`;
  const pieces = issue.pieces
    .map((p, i) => {
      const lab = p.title ? ` aria-labelledby="piece-${i + 1}-t"` : ` aria-label="${PIECE_LABEL[p.kind]}"`;
      return `<section class="mag-piece mag-piece--${p.kind}" id="${pm[i]!.id}" data-mag-piece="${i}" tabindex="-1"${lab}>${pieceHead(p, i + 1, pm[i]!.page)}${pieceBody(p)}</section>`;
    })
    .join('');
  const link = (x: Nav['prev'], rel: string, label: string) => (x ? `<a class="mag-nav__a" rel="${rel}" href="${url(`/magazine/${x.slug}/`)}"><span class="small muted">${label}</span><span>No.${x.no} ${e(x.title)}</span></a>` : '<span></span>');
  const navHtml = nav.prev || nav.next ? `<nav class="mag-nav" aria-label="其它期刊">${link(nav.prev, 'prev', '上一期')}${link(nav.next, 'next', '下一期')}</nav>` : '';
  return `<div class="mag-issue" data-magazine="${e(issue.slug)}">
<div class="mag-cover">${figure(issue.cover, 'mag-fig--cover', '(max-width: 768px) 100vw, 1100px', true)}<div class="mag-cover__meta"><p class="mag-cover__no">No.${issue.no}</p><p class="small muted">${month(issue.date)} · ${issue.pieces.length} 篇 · 第 1 页</p></div></div>
${issue.editorNote ? `<aside class="mag-note" aria-label="编者按"><p class="mag-note__k small">编者按</p><p>${e(issue.editorNote)}</p></aside>` : ''}
${toc}
<p class="mag-keys small muted">键盘：<kbd>J</kbd> / <kbd>K</kbd> 或 <kbd>←</kbd> / <kbd>→</kbd> 翻到下一篇 / 上一篇。</p>
${pieces}
${navHtml}
</div>`;
}

export function issuePage(site: SiteData, route: Extract<Route, { name: 'issue' }>, issue: Issue, nav: Nav): Page {
  return shell(site, route, {
    title: `${issue.title} · 视觉杂志`,
    description: issue.editorNote?.slice(0, 120) || `视觉杂志第 ${issue.no} 期`,
    top: pageHead(issue.title, `视觉杂志 · No.${issue.no} · ${month(issue.date)}`),
    main: bento(tile('full', issueBody(issue, nav), { cls: 'ia-tile mag-tile' })),
    kind: 'page--ia page--magazine',
  });
}

export function magazinePage(site: SiteData, route: Route, issues: IssueSummary[]): Page {
  const cards = issues.length
    ? `<ul class="mag-list" role="list">${issues
        .map(
          (s) => `<li class="mag-card"><a class="mag-card__a" href="${url(`/magazine/${s.slug}/`)}">${figure(s.cover, 'mag-fig--card', '(max-width: 768px) 100vw, 33vw')}<span class="mag-card__no">No.${s.no}</span><span class="mag-card__title">${e(s.title)}</span><span class="mag-card__meta small muted">${month(s.date)} · ${s.pieces} 篇 · ${s.photos} 张照片 · ${s.pagesTotal} 页</span></a></li>`,
        )
        .join('')}</ul>`
    : '<p class="muted">还没有发布任何一期。</p>';
  return shell(site, route, {
    title: '视觉杂志',
    description: '把照片和文章排成一期期小杂志',
    top: pageHead('视觉杂志', '把照片和文章排成一期期小杂志：专题、对页、画廊、引语'),
    main: bento(tile('full', cards, { cls: 'ia-tile mag-tile' })),
    kind: 'page--ia page--magazine',
  });
}
