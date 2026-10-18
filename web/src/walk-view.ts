/**
 * L42 / v1.42.0 扫街路线页面（纯函数，浏览器和预渲染共用；不需要 JS、不加载地图瓦片）：
 * - /walks/：路线卡片（区域、站数、总距离、预计用时）；
 * - /walks/:slug/：内联 SVG 路线示意图（role="img"，文字说明写出站数、距离和用时）、按顺序的站点列表（每段距离、拍摄提示、配图）、
 *   GPX 下载（data: 链接，预渲染时生成）。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, pageHead, shell, tile, url, type Page, type Route } from './render';
import { estimateMinutes, formatDistance, formatDuration, legs, project, toGpx, totalMeters, type Item, type Summary } from './walk-core';
import type { SiteData } from './types';

const W = 640;
const H = 400;

export function detailPage(site: SiteData, route: Extract<Route, { name: 'walk' }>, w: Item): Page {
  const pts = project(w.stops, W, H);
  const lg = legs(w.stops);
  const total = totalMeters(w.stops);
  const mins = estimateMinutes(w);
  const desc = `路线示意：从「${w.stops[0]!.name}」到「${w.stops.at(-1)!.name}」，共 ${w.stops.length} 站，约 ${formatDistance(total)}，预计 ${formatDuration(mins)}（含每站停留 ${w.stopMinutes} 分钟）。`;
  const svg = `<svg class="wk-map" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="wk-desc-${e(w.slug)}" focusable="false"><polyline class="wk-map__line" points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none"/>${pts
    .map((p, i) => `<g class="wk-map__stop"><circle cx="${p.x}" cy="${p.y}" r="12"/><text x="${p.x}" y="${p.y}" dy="0.35em" text-anchor="middle">${i + 1}</text></g>`)
    .join('')}</svg>`;
  const stops = w.stops
    .map(
      (s, i) =>
        `<li class="wk-stop" id="stop-${e(s.id)}"><span class="wk-stop__no" aria-hidden="true">${i + 1}</span><div class="wk-stop__body"><h2 class="wk-stop__h">${e(s.name)}</h2>${i > 0 ? `<p class="wk-stop__leg small muted">距上一站 ${formatDistance(lg[i - 1]!)}</p>` : '<p class="wk-stop__leg small muted">起点</p>'}${s.tip ? `<p class="wk-stop__tip">${e(s.tip)}</p>` : ''}${s.image ? `<img class="wk-stop__img" src="${e(s.image.src)}" alt="${e(s.image.alt)}" width="${s.image.w}" height="${s.image.h}" loading="lazy" decoding="async">` : ''}</div></li>`,
    )
    .join('');
  const gpx = `data:application/gpx+xml;charset=utf-8,${encodeURIComponent(toGpx(w))}`;
  const body = `<div class="wk" data-walk="${e(w.slug)}">
<p class="wk-meta small muted"><span>${e(w.area)}</span><span>${w.stops.length} 站</span><span>约 ${formatDistance(total)}</span><span>预计 ${formatDuration(mins)}</span></p>
<p class="wk-summary">${e(w.summary)}</p>
<figure class="wk-fig">${svg}<figcaption class="small muted" id="wk-desc-${e(w.slug)}">${e(desc)}</figcaption></figure>
<p class="wk-actions"><a class="btn btn--sm" href="${gpx}" download="${e(w.slug)}.gpx">${icon('mapPin')}下载 GPX</a><span class="small muted">按步速 ${w.pace} 公里 / 小时估算，实际用时以现场为准。</span></p>
<ol class="wk-stops" role="list">${stops}</ol>
<p class="wk-back"><a class="btn btn--sm" href="${url('/walks/')}">${icon('compass')}全部路线</a></p>
</div>`;
  return shell(site, route, {
    title: `${w.title} · 扫街路线`,
    description: w.summary.slice(0, 120),
    top: pageHead(w.title, `扫街路线 · ${w.area}`),
    main: bento(tile('full', body, { cls: 'ia-tile wk-tile' })),
    kind: 'page--ia page--walk',
  });
}

function card(s: Summary): string {
  const cover = s.cover ? `<span class="wk-card__cover"><img src="${e(s.cover.src)}" alt="${e(s.cover.alt)}" width="${s.cover.w}" height="${s.cover.h}" loading="lazy" decoding="async"></span>` : '';
  return `<li class="wk-card"><a class="wk-card__a" href="${url(`/walks/${s.slug}/`)}">${cover}<span class="wk-card__title">${e(s.title)}</span><span class="wk-card__meta small muted">${e(s.area)} · ${s.stops} 站 · 约 ${formatDistance(s.meters)} · 预计 ${formatDuration(s.minutes)}</span><span class="wk-card__sum small">${e(s.summary)}</span></a></li>`;
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return shell(site, route, {
    title: '扫街路线',
    description: '走一圈能拍到什么：站点、拍摄提示、距离和预计用时',
    top: pageHead('扫街路线', '走一圈能拍到什么：站点、拍摄提示、距离和预计用时'),
    main: bento(tile('full', list.length ? `<ul class="wk-cards" role="list">${list.map(card).join('')}</ul>` : '<p class="muted">还没有路线。</p>', { cls: 'ia-tile wk-tile' })),
    kind: 'page--ia page--walk',
  });
}
