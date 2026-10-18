/**
 * L50 / v1.50.0 毕业作品集页面（纯函数，浏览器和预渲染共用；不需要 JS）：
 * - /portfolio/：作品集卡片 + 里程碑 1.50 说明 + L36–L49 内容入口；
 * - /portfolio/:slug/：创作自述、策展序列（有序列表，每件 figure + 「n / N · 作品名 · 年份 · 媒介 · 尺寸」），
 *   打印时一页一件（CSS break-before: page）；「打印作品集」按钮 JS 加载后才出现（portfolio-client）。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, pageHead, shell, tile, url, type Page, type Route } from './render';
import { HUB, seqText, workLine, type Item, type Summary } from './portfolio-core';
import type { SiteData } from './types';

export function detailPage(site: SiteData, route: Extract<Route, { name: 'portfolioset' }>, it: Item): Page {
  const n = it.works.length;
  const works = it.works
    .map(
      (w) =>
        `<li class="pf-work" id="work-${w.n}"><figure class="pf-fig"><img src="${e(w.photo.src)}" alt="${e(w.photo.alt)}" width="${w.photo.w}" height="${w.photo.h}" loading="${w.n <= 2 ? 'eager' : 'lazy'}" decoding="async"><figcaption><span class="pf-seq">${seqText(w.n, n)}</span> <strong class="pf-title">${e(w.title)}</strong><span class="pf-line small muted">${e(workLine(w))}</span>${w.note ? `<span class="pf-note small">${e(w.note)}</span>` : ''}</figcaption></figure></li>`,
    )
    .join('');
  const body = `<div class="pf" data-portfolio="${e(it.slug)}">
<p class="pf-note-fic small" role="note">${icon('star')}<span>虚构作者的示例作品集：照片来自站内开放授权示例图，作者与自述均为虚构。</span></p>
<p class="pf-meta small muted"><span>${e(it.author)}</span><span>${it.year} 年</span><span>${n} 件作品</span></p>
<section class="pf-statement" aria-labelledby="pf-st-h"><h2 id="pf-st-h">创作自述</h2>${it.statement.map((p) => `<p>${e(p)}</p>`).join('')}</section>
<p class="pf-tools" data-pf-tools hidden><button type="button" class="btn btn--sm" data-pf-print>${icon('file')}打印作品集（一页一件）</button></p>
<section aria-labelledby="pf-seq-h"><h2 id="pf-seq-h">策展序列</h2><ol class="pf-works" role="list">${works}</ol></section>
<p class="pf-back"><a class="btn btn--sm" href="${url('/portfolio/')}">${icon('aperture')}全部作品集</a></p>
</div>`;
  return shell(site, route, {
    title: `${it.title} · 毕业作品集`,
    description: (it.statement[0] ?? it.title).slice(0, 120),
    top: pageHead(it.title, `毕业作品集 · ${it.author} · ${it.year}`),
    main: bento(tile('full', body, { cls: 'ia-tile pf-tile' })),
    kind: 'page--ia page--portfolio',
  });
}

function card(s: Summary): string {
  return `<li class="pf-card"><a class="pf-card__a" href="${url(`/portfolio/${s.slug}/`)}"><span class="pf-card__cover"><img src="${e(s.cover.src)}" alt="${e(s.cover.alt)}" width="${s.cover.w}" height="${s.cover.h}" loading="lazy" decoding="async"></span><span class="pf-card__title">${e(s.title)}</span><span class="pf-card__meta small muted">${e(s.author)} · ${s.year} · ${s.works} 件</span></a></li>`;
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  const hub = `<section class="pf-hub" aria-labelledby="pf-hub-h"><h2 id="pf-hub-h">1.36–1.49 新增的内容栏目</h2><ul class="pf-hub__list" role="list">${HUB.map((h) => `<li><a href="${url(h.href)}"><span class="pf-hub__v small muted">${h.v}</span> ${e(h.label)}</a></li>`).join('')}</ul></section>`;
  const cards = list.length ? `<ul class="pf-cards" role="list">${list.map(card).join('')}</ul>` : '<p class="muted">还没有作品集。</p>';
  return shell(site, route, {
    title: '毕业作品集',
    description: '策展序列与创作自述，打印时一页一件；也是 1.50 里程碑的内容总入口',
    top: pageHead('毕业作品集', '策展序列与创作自述，打印时一页一件；也是 1.50 里程碑的内容总入口'),
    main: bento(tile('full', `<p class="pf-milestone small" role="note">${icon('flag')}<span>里程碑 1.50：从 1.36 起每个版本新增一个内容栏目，下面是全部入口。</span></p>${cards}${hub}`, { cls: 'ia-tile pf-tile' })),
    kind: 'page--ia page--portfolio',
  });
}
