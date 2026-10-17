/**
 * L37 / v1.37.0 修图前后对比页面（纯函数，浏览器和预渲染共用；不需要 JS 也完整可读）：
 * - /retouch/：案例卡片（封面 = 修图后、步骤数、用到的调整类型）；
 * - /retouch/:slug/：原图与修图后并排两张图（各自的替代文字）+ 有序的修图步骤；
 *   对比滑块容器默认隐藏，retouch-client（按需加载）用原生 range 滑块打开它（方向键 / Home / End，读屏数值文字）。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, pageHead, shell, tile, url, type Page, type Route } from './render';
import { PRESETS, STEP_LABEL, valueText, type Img, type Item, type Summary } from './retouch-core';
import type { SiteData } from './types';

const dateCn = (d: string) => {
  const [y, m, day] = d.split('-');
  return `${y} 年 ${Number(m)} 月 ${Number(day)} 日`;
};
const pic = (i: Img, cls: string, lazy = true) => `<img class="${cls}" src="${e(i.src)}" alt="${e(i.alt)}" width="${i.w}" height="${i.h}"${lazy ? ' loading="lazy"' : ''} decoding="async">`;

export const RETOUCH_HELP = '拖动或用方向键移动分界线：左边是原图，右边是修图后；Home / End 到两端。';

export function detailPage(site: SiteData, route: Extract<Route, { name: 'retouchcase' }>, r: Item): Page {
  const steps = r.steps
    .map((s, i) => `<li class="rt-step" data-kind="${s.kind}"><span class="rt-step__no" aria-hidden="true">${i + 1}</span><span class="rt-step__body"><span class="rt-step__label">${e(s.label)}</span><span class="rt-step__kind small muted">${STEP_LABEL[s.kind]}</span>${s.detail ? `<span class="rt-step__detail small">${e(s.detail)}</span>` : ''}</span></li>`)
    .join('');
  const ratio = `${r.after.w} / ${r.after.h}`;
  const body = `<div class="rt" data-retouch="${e(r.slug)}" data-start="${r.start}">
<p class="rt-meta small muted"><span>${dateCn(r.date)}</span><span>${r.steps.length} 个步骤</span></p>
<p class="rt-summary">${e(r.summary)}</p>
<div class="rt-cmp" data-retouch-stage hidden style="aspect-ratio: ${ratio}">
<div class="rt-cmp__frame" aria-hidden="true">${pic(r.before, 'rt-cmp__before', false)}<div class="rt-cmp__after" data-rt-after>${pic(r.after, 'rt-cmp__img', false)}</div><span class="rt-cmp__line" data-rt-line></span><span class="rt-cmp__tag rt-cmp__tag--l">原图</span><span class="rt-cmp__tag rt-cmp__tag--r">修图后</span></div>
</div>
<div class="rt-ctl" data-retouch-ctl hidden><label class="rt-ctl__l" for="rt-range-${e(r.slug)}">对比位置</label><input id="rt-range-${e(r.slug)}" class="rt-ctl__range" type="range" min="0" max="100" step="1" value="${r.start}" aria-valuetext="${e(valueText(r.start))}" aria-describedby="rt-help-${e(r.slug)}" data-rt-range>
<div class="rt-ctl__presets" role="group" aria-label="快捷位置">${PRESETS.map((p) => `<button type="button" class="btn btn--sm" data-rt-preset="${p.pos}">${p.label}</button>`).join('')}</div>
<p class="rt-help small muted" id="rt-help-${e(r.slug)}">${RETOUCH_HELP}</p></div>
<div class="rt-pair" data-retouch-pair>
<figure class="rt-pair__fig">${pic(r.before, 'rt-pair__img')}<figcaption><strong>原图</strong> · ${e(r.before.alt)}</figcaption></figure>
<figure class="rt-pair__fig">${pic(r.after, 'rt-pair__img')}<figcaption><strong>修图后</strong> · ${e(r.after.alt)}</figcaption></figure>
</div>
<section class="rt-steps" aria-labelledby="rt-steps-h"><h2 id="rt-steps-h" class="rt-steps__h">修图步骤</h2><ol class="rt-steps__list" role="list">${steps}</ol></section>
${r.credit ? `<p class="rt-credit small muted">${e(r.credit)}</p>` : ''}
<p class="rt-back"><a class="btn btn--sm" href="${url('/retouch/')}">${icon('arrowRight')}全部修图案例</a></p>
</div>`;
  return shell(site, route, {
    title: `${r.title} · 修图前后`,
    description: r.summary.slice(0, 120),
    top: pageHead(r.title, `修图前后对比 · ${r.steps.length} 个步骤`),
    main: bento(tile('full', body, { cls: 'ia-tile rt-tile' })),
    kind: 'page--ia page--retouch',
  });
}

function card(s: Summary): string {
  return `<li class="rt-card"><a class="rt-card__a" href="${url(`/retouch/${s.slug}/`)}"><span class="rt-card__cover">${pic(s.cover, 'rt-card__img')}</span><span class="rt-card__title">${e(s.title)}</span><span class="rt-card__meta small muted">${s.steps} 个步骤 · ${dateCn(s.date)}</span><span class="rt-card__kinds small">${s.kinds.map((k) => STEP_LABEL[k]).join(' · ')}</span></a></li>`;
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return shell(site, route, {
    title: '修图前后',
    description: '同一张照片修图前后的对比，以及每一步做了什么',
    top: pageHead('修图前后', '同一张照片修图前后的对比，以及每一步做了什么'),
    main: bento(tile('full', list.length ? `<ul class="rt-list" role="list">${list.map(card).join('')}</ul>` : '<p class="muted">还没有修图案例。</p>', { cls: 'ia-tile rt-tile' })),
    kind: 'page--ia page--retouch',
  });
}
