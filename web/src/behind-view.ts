/**
 * L49 / v1.49.0 作品幕后页面（纯函数，浏览器和预渲染共用；不需要 JS）：
 * - /behind/：幕后卡片（参数、光源数）；
 * - /behind/:slug/：作品照片、拍摄参数（dl）、俯视布光示意 SVG（role="img"，title + desc，figcaption 是同一段文字描述）、
 *   光源列表（类型、说明、功率、相对相机的角度与光位名称）、拍摄步骤、器材（链接到 /gear/）、相关术语（链接到 /glossary/:slug/）。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, pageHead, shell, tile, url, type Page, type Route } from './render';
import { angleText, exifText, KIND_LABEL, lightAngle, type Item, type Summary } from './behind-core';
import type { SiteData } from './types';

function diagram(it: Item): string {
  const { camera: c, subject: s, lights } = it.setup;
  const rays = lights.map((l) => `<line class="bh-ray" x1="${l.x}" y1="${l.y}" x2="${s.x}" y2="${s.y}"/>`).join('');
  const dots = lights
    .map((l, i) => `<g class="bh-light bh-light--${l.kind}"><circle cx="${l.x}" cy="${l.y}" r="4.5"/><text x="${l.x}" y="${l.y}" dy="0.35em" text-anchor="middle">${i + 1}</text></g>`)
    .join('');
  return `<svg class="bh-svg" viewBox="0 0 100 100" role="img" aria-labelledby="bh-svg-t bh-svg-d"><title id="bh-svg-t">布光示意图（俯视）</title><desc id="bh-svg-d">${e(it.lightingText)}</desc><rect class="bh-floor" x="0.5" y="0.5" width="99" height="99" rx="4"/>${rays}<line class="bh-axis" x1="${c.x}" y1="${c.y}" x2="${s.x}" y2="${s.y}"/><circle class="bh-subject" cx="${s.x}" cy="${s.y}" r="5"/><text class="bh-tag" x="${s.x}" y="${s.y - 8}" text-anchor="middle">主体</text><rect class="bh-camera" x="${c.x - 5}" y="${c.y - 3.5}" width="10" height="7" rx="1.5"/><text class="bh-tag" x="${c.x}" y="${c.y + 10}" text-anchor="middle">相机</text>${dots}</svg>`;
}

export function detailPage(site: SiteData, route: Extract<Route, { name: 'behindwork' }>, it: Item): Page {
  const x = it.exif;
  const lights = it.setup.lights
    .map((l, i) => `<li><strong>${i + 1}. ${KIND_LABEL[l.kind]}</strong>：${e(l.label)}${l.power ? `（${e(l.power)}）` : ''} — <span class="bh-angle">${angleText(lightAngle(it.setup.camera, it.setup.subject, l))}</span></li>`)
    .join('');
  const body = `<div class="bh" data-behind="${e(it.slug)}">
<p class="bh-sum">${e(it.summary)}</p>
<figure class="bh-photo"><img src="${e(it.photo.src)}" alt="${e(it.photo.alt)}" width="${it.photo.w}" height="${it.photo.h}" decoding="async"><figcaption class="small muted">${e(it.photo.alt)}</figcaption></figure>
<section class="bh-sec" aria-labelledby="bh-exif-h"><h2 id="bh-exif-h">拍摄参数</h2><p class="bh-exif">${e(exifText(x))}</p><dl class="bh-facts"><div><dt>相机</dt><dd>${e(x.camera)}</dd></div><div><dt>镜头</dt><dd>${e(x.lens)}</dd></div><div><dt>焦距</dt><dd>${x.focal}mm</dd></div><div><dt>光圈</dt><dd>f/${x.aperture}</dd></div><div><dt>快门</dt><dd>${e(x.shutter.endsWith('s') ? `${x.shutter.slice(0, -1)} 秒` : x.shutter)}</dd></div><div><dt>ISO</dt><dd>${x.iso}</dd></div></dl></section>
<section class="bh-sec" aria-labelledby="bh-light-h"><h2 id="bh-light-h">布光</h2><div class="bh-lighting"><figure class="bh-fig">${diagram(it)}<figcaption class="small">${e(it.lightingText)}</figcaption></figure><ol class="bh-lights" role="list">${lights}</ol></div></section>
<section class="bh-sec" aria-labelledby="bh-steps-h"><h2 id="bh-steps-h">拍摄步骤</h2><ol class="bh-steps">${it.steps.map((s) => `<li>${e(s)}</li>`).join('')}</ol></section>
${it.gear.length ? `<section class="bh-sec" aria-labelledby="bh-gear-h"><h2 id="bh-gear-h">器材</h2><ul class="bh-chips" role="list">${it.gear.map((g) => `<li><a href="${url('/gear/')}">${icon('camera')}${e(g)}</a></li>`).join('')}</ul></section>` : ''}
${it.terms.length ? `<section class="bh-sec" aria-labelledby="bh-terms-h"><h2 id="bh-terms-h">相关术语</h2><ul class="bh-chips" role="list">${it.terms.map((t) => `<li><a href="${url(`/glossary/${t.slug}/`)}">${icon('book')}${e(t.label)}</a></li>`).join('')}</ul></section>` : ''}
<p class="bh-back"><a class="btn btn--sm" href="${url('/behind/')}">${icon('aperture')}全部幕后</a></p>
</div>`;
  return shell(site, route, {
    title: `${it.title} · 作品幕后`,
    description: it.summary.slice(0, 120),
    top: pageHead(it.title, `作品幕后 · ${exifText(x)}`),
    main: bento(tile('full', body, { cls: 'ia-tile bh-tile' })),
    kind: 'page--ia page--behind',
  });
}

function card(s: Summary): string {
  return `<li class="bh-card"><a class="bh-card__a" href="${url(`/behind/${s.slug}/`)}"><span class="bh-card__cover"><img src="${e(s.cover.src)}" alt="${e(s.cover.alt)}" width="${s.cover.w}" height="${s.cover.h}" loading="lazy" decoding="async"></span><span class="bh-card__title">${e(s.title)}</span><span class="bh-card__meta small muted">${e(s.exif)} · ${s.lights} 个光源</span><span class="bh-card__sum small">${e(s.summary)}</span></a></li>`;
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return shell(site, route, {
    title: '作品幕后',
    description: '一张照片是怎么拍出来的：参数、布光示意、步骤、器材和相关术语',
    top: pageHead('作品幕后', '一张照片是怎么拍出来的：参数、布光示意、步骤、器材和相关术语'),
    main: bento(tile('full', list.length ? `<ul class="bh-cards" role="list">${list.map(card).join('')}</ul>` : '<p class="muted">还没有幕后记录。</p>', { cls: 'ia-tile bh-tile' })),
    kind: 'page--ia page--behind',
  });
}
