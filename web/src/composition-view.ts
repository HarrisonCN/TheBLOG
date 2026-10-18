/**
 * L47 / v1.47.0 构图辅助线页面（纯函数，浏览器和预渲染共用；不需要 JS）：
 * - /composition/：构图分析卡片（适用的辅助线、兴趣点数）；
 * - /composition/:slug/：照片 + 叠加的 SVG（三分 / 黄金分割 / 对角线三组线，默认全部隐藏；兴趣点编号圆点），
 *   切换按钮（aria-pressed，JS 加载后才出现，composition-client）；构图说明文字和兴趣点文字是基线。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, pageHead, shell, tile, url, type Page, type Route } from './render';
import { GUIDE_LABEL, GUIDES, guideLines, pointText, type Item, type Summary } from './composition-core';
import type { SiteData } from './types';

export function detailPage(site: SiteData, route: Extract<Route, { name: 'compositionstudy' }>, it: Item): Page {
  const { w, h } = it.photo;
  const sw = Math.max(2, Math.round(Math.max(w, h) / 400));
  const groups = GUIDES.map(
    (g) => `<g class="cp-g cp-g--${g}" data-guide="${g}" hidden>${guideLines(g, w, h)
      .map((l) => `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke-width="${sw}"/>`)
      .join('')}</g>`,
  ).join('');
  const r = Math.round(Math.max(w, h) / 60);
  const dots = it.points
    .map((p, i) => `<g class="cp-pt"><circle cx="${Math.round(p.x * w)}" cy="${Math.round(p.y * h)}" r="${r}" stroke-width="${sw}"/><text x="${Math.round(p.x * w)}" y="${Math.round(p.y * h)}" font-size="${Math.round(r * 1.2)}" dy="0.35em" text-anchor="middle">${i + 1}</text></g>`)
    .join('');
  const main = it.guides[0]!;
  const bar = `<div class="cp-bar" role="group" aria-label="辅助线（默认关闭）" data-cp-bar hidden>${GUIDES.map((g) => `<button type="button" class="btn btn--sm cp-toggle" aria-pressed="false" data-cp-toggle="${g}">${GUIDE_LABEL[g]}${it.guides.includes(g) ? '<span class="cp-fit">适用</span>' : ''}</button>`).join('')}</div>`;
  const pts = it.points.length
    ? `<ol class="cp-points">${it.points.map((p) => `<li>${e(pointText(p, main, w, h))}</li>`).join('')}</ol>`
    : '';
  const body = `<div class="cp" data-composition="${e(it.slug)}">
<p class="cp-meta small muted"><span>适用：${it.guides.map((g) => GUIDE_LABEL[g]).join('、')}</span><span>${it.points.length} 个兴趣点</span></p>
${bar}
<figure class="cp-fig"><div class="cp-stage"><img src="${e(it.photo.src)}" alt="${e(it.photo.alt)}" width="${w}" height="${h}" decoding="async"><svg class="cp-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true" focusable="false">${groups}${dots}</svg></div><figcaption class="small muted">${e(it.photo.alt)}</figcaption></figure>
<section class="cp-sec" aria-labelledby="cp-notes-h"><h2 id="cp-notes-h">构图说明</h2>${it.notes.map((n) => `<p>${e(n)}</p>`).join('')}</section>
${pts ? `<section class="cp-sec" aria-labelledby="cp-pts-h"><h2 id="cp-pts-h">兴趣点</h2>${pts}</section>` : ''}
<p class="cp-back"><a class="btn btn--sm" href="${url('/composition/')}">${icon('grid')}全部构图分析</a></p>
</div>`;
  return shell(site, route, {
    title: `${it.title} · 构图辅助线`,
    description: it.summary.slice(0, 120),
    top: pageHead(it.title, '构图辅助线'),
    main: bento(tile('full', body, { cls: 'ia-tile cp-tile' })),
    kind: 'page--ia page--composition',
  });
}

function card(s: Summary): string {
  return `<li class="cp-card"><a class="cp-card__a" href="${url(`/composition/${s.slug}/`)}"><span class="cp-card__cover"><img src="${e(s.cover.src)}" alt="${e(s.cover.alt)}" width="${s.cover.w}" height="${s.cover.h}" loading="lazy" decoding="async"></span><span class="cp-card__title">${e(s.title)}</span><span class="cp-card__meta small muted">${s.guides.map((g) => GUIDE_LABEL[g]).join('、')} · ${s.points} 个兴趣点</span><span class="cp-card__sum small">${e(s.summary)}</span></a></li>`;
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return shell(site, route, {
    title: '构图辅助线',
    description: '在照片上叠加三分线、黄金分割线和对角线，看主体落在哪里',
    top: pageHead('构图辅助线', '在照片上叠加三分线、黄金分割线和对角线，看主体落在哪里'),
    main: bento(tile('full', list.length ? `<ul class="cp-cards" role="list">${list.map(card).join('')}</ul>` : '<p class="muted">还没有构图分析。</p>', { cls: 'ia-tile cp-tile' })),
    kind: 'page--ia page--composition',
  });
}
