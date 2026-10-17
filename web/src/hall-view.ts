/**
 * L35 / v1.35.0 3D 与沉浸式展厅页面（纯函数，浏览器和预渲染共用；不需要 JS、不需要 3D 也完整可读）：
 * - /halls/：展厅卡片（封面 = 导览第一件、件数、墙面数）；
 * - /halls/:slug/：按导览顺序（北 → 东 → 南 → 西）排列的平面展品列表（图片、替代文字、墙面、说明），
 *   以及默认隐藏的 3D 舞台容器；hall-client（按需加载）只在浏览器支持 3D 且用户没有要求减少动态效果（或手动选择立体视图）时打开它。
 * 没有自动播放、没有自动旋转。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, pageHead, shell, tile, url, type Page, type Route } from './render';
import { WALL_LABEL, tourOrder, type Hall, type HallSummary } from './gallery-core';
import type { SiteData } from './types';

const dateCn = (d: string) => {
  const [y, m, day] = d.split('-');
  return `${y} 年 ${Number(m)} 月 ${Number(day)} 日`;
};

export const HALL_HELP = '立体视图里：用方向键（← → 或 ↑ ↓）逐件观看，PageUp / PageDown 换一面墙，Home / End 到第一件 / 最后一件，Enter 近看，Esc 退出近看。展厅不会自动播放或旋转。';

function body(h: Hall): string {
  const order = tourOrder(h.exhibits);
  const items = order
    .map((i, pos) => {
      const x = h.exhibits[i]!;
      return `<li class="hall-ex" id="ex-${e(x.id)}" data-hall-item="${i}" data-wall="${x.wall}"><figure class="hall-ex__fig"><img src="${e(x.image.src)}" alt="${e(x.image.alt)}" width="${x.image.w}" height="${x.image.h}" loading="lazy" decoding="async"><figcaption class="hall-ex__cap"><span class="hall-ex__title">${e(x.title)}</span><span class="hall-ex__wall small muted">${WALL_LABEL[x.wall]} · 第 ${pos + 1} 件，共 ${order.length} 件</span>${x.caption ? `<span class="hall-ex__text">${e(x.caption)}</span>` : ''}${x.credit ? `<span class="hall-ex__credit small muted">${e(x.credit)}</span>` : ''}</figcaption></figure></li>`;
    })
    .join('');
  return `<div class="hall" data-hall="${e(h.slug)}">
<p class="hall-meta small muted"><span>${dateCn(h.date)}</span><span>${h.exhibits.length} 件展品</span><span>${new Set(h.exhibits.map((x) => x.wall)).size} 面墙</span></p>
${h.summary ? `<p class="hall-summary">${e(h.summary)}</p>` : ''}
${h.intro ? `<p class="hall-intro">${e(h.intro)}</p>` : ''}
<div class="hall-bar"><p class="hall-help small muted" id="hall-help-${e(h.slug)}">${HALL_HELP}</p><button type="button" class="btn btn--sm hall-toggle" data-hall-toggle aria-pressed="false" hidden>${icon('box')}立体视图</button></div>
<div class="hall3d" data-hall-stage hidden role="region" aria-roledescription="3D 展厅" aria-label="${e(h.title)} · 立体视图" aria-describedby="hall-help-${e(h.slug)}"></div>
<ol class="hall-flat" role="list" aria-label="${e(h.title)} · 全部展品">${items}</ol>
<p class="hall-back"><a class="btn btn--sm" href="${url('/halls/')}">${icon('arrowRight')}全部展厅</a></p>
</div>`;
}

export function hallPage(site: SiteData, route: Extract<Route, { name: 'hall' }>, h: Hall): Page {
  return shell(site, route, {
    title: `${h.title} · 沉浸式展厅`,
    description: h.summary?.slice(0, 120) || `沉浸式展厅：${h.title}`,
    top: pageHead(h.title, `沉浸式展厅 · ${h.exhibits.length} 件展品`),
    main: bento(tile('full', body(h), { cls: 'ia-tile hall-tile' })),
    kind: 'page--ia page--hall',
  });
}

function card(s: HallSummary): string {
  const cover = s.cover
    ? `<span class="hall-card__cover"><img src="${e(s.cover.src)}" alt="${e(s.cover.alt)}" width="${s.cover.w}" height="${s.cover.h}" loading="lazy" decoding="async"></span>`
    : `<span class="hall-card__cover" aria-hidden="true">${icon('box')}</span>`;
  return `<li class="hall-card"><a class="hall-card__a" href="${url(`/halls/${s.slug}/`)}">${cover}<span class="hall-card__title">${e(s.title)}</span><span class="hall-card__meta small muted">${s.exhibits} 件展品 · ${s.walls} 面墙 · ${dateCn(s.date)}</span>${s.summary ? `<span class="hall-card__sum small">${e(s.summary)}</span>` : ''}</a></li>`;
}

export function hallListPage(site: SiteData, route: Route, list: HallSummary[]): Page {
  return shell(site, route, {
    title: '沉浸式展厅',
    description: '把一组照片挂进一间可以环顾的展厅；也可以切换成平面列表',
    top: pageHead('沉浸式展厅', '把一组照片挂上四面墙：可以用键盘环顾，也可以随时切换成平面列表'),
    main: bento(tile('full', list.length ? `<ul class="hall-list" role="list">${list.map(card).join('')}</ul>` : '<p class="muted">还没有展厅。</p>', { cls: 'ia-tile hall-tile' })),
    kind: 'page--ia page--hall',
  });
}
