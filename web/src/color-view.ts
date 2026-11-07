/**
 * L43 / v1.43.0 色彩研究页面（纯函数，浏览器和预渲染共用；不需要 JS 也完整可读）：
 * - /colors/：配色卡片（照片 + 色条，色条旁有颜色数的文字）；
 * - /colors/:slug/：照片、色卡（每个颜色都写出名字、HEX、HSL 和用途，文字颜色按对比度自动选黑或白）、
 *   WCAG 对比度矩阵表格（数值 + 等级文字）、笔记。「复制色值」按钮由 color-client 按需打开。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, pageHead, shell, tile, url, type Page, type Route } from './render';
import { hslText, inkFor, matrix, wcagLevel, type Item, type Summary } from './color-core';
import type { SiteData } from './types';

export function detailPage(site: SiteData, route: Extract<Route, { name: 'colorstudy' }>, c: Item): Page {
  const hexes = c.swatches.map((s) => s.hex);
  const mx = matrix(hexes);
  const cards = c.swatches
    .map(
      (s) =>
        `<li class="co-sw"><span class="co-sw__chip" aria-hidden="true" style="background:${s.hex};color:${inkFor(s.hex)}">${e(s.name)}</span><span class="co-sw__name">${e(s.name)}</span><code class="co-sw__hex">${s.hex}</code><span class="co-sw__hsl small muted">${hslText(s.hex)}</span>${s.role ? `<span class="co-sw__role small">${e(s.role)}</span>` : ''}<button type="button" class="btn btn--sm co-sw__copy" data-co-copy="${s.hex}" hidden aria-label="复制 ${e(s.name)} 的色值 ${s.hex}">${icon('copy')}复制</button></li>`,
    )
    .join('');
  const head = `<tr><td></td>${c.swatches.map((s) => `<th scope="col">${e(s.name)}</th>`).join('')}</tr>`;
  const rows = c.swatches
    .map((s, i) => `<tr><th scope="row">${e(s.name)}</th>${mx[i]!.map((r, j) => (i === j ? '<td class="co-mx__self">—</td>' : `<td data-co-ratio="${r}"><span class="co-mx__r">${r.toFixed(2)}</span><span class="co-mx__lv small">${wcagLevel(r)}</span></td>`)).join('')}</tr>`)
    .join('');
  const body = `<div class="co" data-colors="${e(c.slug)}">
<figure class="co-fig"><img src="${e(c.image.src)}" alt="${e(c.image.alt)}" width="${c.image.w}" height="${c.image.h}" decoding="async"><figcaption class="small muted">${e(c.summary)}</figcaption></figure>
<section aria-labelledby="co-sw-h"><h2 id="co-sw-h" class="co-h">色卡（${c.swatches.length} 色）</h2><ul class="co-sws" role="list">${cards}</ul><p class="co-status small" data-co-status role="status" aria-live="polite"></p></section>
<section aria-labelledby="co-mx-h"><h2 id="co-mx-h" class="co-h">对比度</h2><p class="small muted">按 WCAG 2：正文需要 4.5（AA）或 7（AAA），18pt 以上的大字需要 3。</p><div class="co-mx-wrap" tabindex="0" role="region" aria-label="两两对比度表（可横向滚动）"><table class="co-mx"><caption>两两对比度</caption><thead>${head}</thead><tbody>${rows}</tbody></table></div></section>
${c.notes.length ? `<section aria-labelledby="co-n-h"><h2 id="co-n-h" class="co-h">笔记</h2>${c.notes.map((n) => `<p>${e(n)}</p>`).join('')}</section>` : ''}
<p class="co-back"><a class="btn btn--sm" href="${url('/colors/')}">${icon('image')}全部色彩研究</a></p>
</div>`;
  return shell(site, route, {
    title: `${c.title} · 色彩研究`,
    description: c.summary.slice(0, 120),
    top: pageHead(c.title, `色彩研究 · ${c.swatches.length} 色`),
    main: bento(tile('full', body, { cls: 'ia-tile co-tile' })),
    kind: 'page--ia page--colors',
  });
}

function card(s: Summary): string {
  return `<li class="co-card"><a class="co-card__a" href="${url(`/colors/${s.slug}/`)}"><span class="co-card__cover"><img src="${e(s.cover.src)}" alt="${e(s.cover.alt)}" width="${s.cover.w}" height="${s.cover.h}" loading="lazy" decoding="async"></span><span class="co-card__bar" aria-hidden="true">${s.hexes.map((h) => `<span style="background:${h}"></span>`).join('')}</span><span class="co-card__title">${e(s.title)}</span><span class="co-card__meta small muted">${s.hexes.length} 色 · ${s.hexes.join(' ')}</span></a></li>`;
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return shell(site, route, {
    title: '色彩研究',
    description: '从照片里取出的配色：色值、用途和对比度',
    top: pageHead('色彩研究', '从照片里取出的配色：色值、用途和对比度'),
    main: bento(tile('full', list.length ? `<ul class="co-cards" role="list">${list.map(card).join('')}</ul>` : '<p class="muted">还没有色彩研究。</p>', { cls: 'ia-tile co-tile' })),
    kind: 'page--ia page--colors',
  });
}
