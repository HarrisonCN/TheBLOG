/**
 * L45 / v1.45.0 52 周挑战页面（纯函数，浏览器和预渲染共用；不需要 JS）：
 * - /challenges/：挑战卡片（年份、周数、起止周）；
 * - /challenges/:slug/：每周一项（第 N 周 · 主题、ISO 周的周一到周日、提示、作品链接）；
 *   本地完成勾选与进度条默认隐藏，JS 加载后才出现（challenge-client）；「本周」标记也在客户端按 Asia/Shanghai 计算。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, pageHead, shell, tile, url, type Page, type Route } from './render';
import { rangeText, weekRange, weeksInYear, type Item, type Summary } from './challenge-core';
import type { SiteData } from './types';

export function detailPage(site: SiteData, route: Extract<Route, { name: 'challenge' }>, it: Item): Page {
  const n = it.weeks.length;
  const weeks = it.weeks
    .map((w) => {
      const r = weekRange(it.year, w.week);
      const link = w.link ? `<p class="ch-week__link"><a href="${e(w.link.href.startsWith('/') ? url(w.link.href) : w.link.href)}">${icon('image')}${e(w.link.text)}</a></p>` : '';
      return `<li class="ch-week" id="w-${w.week}" data-week="${w.week}"><h2 class="ch-week__h"><span class="ch-week__no">第 ${w.week} 周</span> ${e(w.theme)}</h2><p class="ch-week__date small muted"><time datetime="${r.start}">${rangeText(r).split(' – ')[0]}</time> – <time datetime="${r.end}">${rangeText(r).split(' – ')[1]}</time></p>${w.tip ? `<p class="ch-week__tip small">${e(w.tip)}</p>` : ''}${link}<label class="ch-week__done" hidden><input type="checkbox" data-ch-week="${w.week}" id="ch-${e(it.slug)}-${w.week}"> 这周拍完了</label></li>`;
    })
    .join('');
  const cover = it.cover ? `<figure class="ch-cover"><img src="${e(it.cover.src)}" alt="${e(it.cover.alt)}" width="${it.cover.w}" height="${it.cover.h}" loading="lazy" decoding="async"><figcaption class="small muted">${e(it.cover.alt)}</figcaption></figure>` : '';
  const body = `<div class="ch" data-challenge="${e(it.slug)}" data-year="${it.year}">
<p class="ch-meta small muted"><span>${it.year} 年（共 ${weeksInYear(it.year)} 个 ISO 周）</span><span>${n} 个每周主题</span><span>周一开头，按 ISO 8601 计周</span></p>
<p class="ch-sum">${e(it.summary)}</p>
${cover}
<div class="ch-bar" data-ch-bar hidden><progress class="ch-progress" max="${n}" value="0" aria-label="完成进度"></progress><p class="ch-status small" id="ch-status" role="status" aria-live="polite"></p><p class="ch-now small" data-ch-now></p><button type="button" class="btn btn--sm" data-ch-reset>清空记录</button><p class="small muted">勾选只保存在这台设备的浏览器里，不会上传。</p></div>
<ol class="ch-weeks" role="list">${weeks}</ol>
<p class="ch-back"><a class="btn btn--sm" href="${url('/challenges/')}">${icon('flag')}全部挑战</a></p>
</div>`;
  return shell(site, route, {
    title: `${it.title} · 52 周挑战`,
    description: it.summary.slice(0, 120),
    top: pageHead(it.title, `52 周挑战 · ${it.year} 年`),
    main: bento(tile('full', body, { cls: 'ia-tile ch-tile' })),
    kind: 'page--ia page--challenge',
  });
}

function card(s: Summary): string {
  const cover = s.cover ? `<span class="ch-card__cover"><img src="${e(s.cover.src)}" alt="${e(s.cover.alt)}" width="${s.cover.w}" height="${s.cover.h}" loading="lazy" decoding="async"></span>` : '';
  return `<li class="ch-card"><a class="ch-card__a" href="${url(`/challenges/${s.slug}/`)}">${cover}<span class="ch-card__title">${e(s.title)}</span><span class="ch-card__meta small muted">${s.year} 年 · ${s.weeks} 周 · 第 ${s.first}–${s.last} 周</span><span class="ch-card__sum small">${e(s.summary)}</span></a></li>`;
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return shell(site, route, {
    title: '52 周挑战',
    description: '每周一个拍摄主题，按 ISO 周排好；完成进度只记在你自己的浏览器里',
    top: pageHead('52 周挑战', '每周一个拍摄主题，按 ISO 周排好；完成进度只记在你自己的浏览器里'),
    main: bento(tile('full', list.length ? `<ul class="ch-cards" role="list">${list.map(card).join('')}</ul>` : '<p class="muted">还没有挑战。</p>', { cls: 'ia-tile ch-tile' })),
    kind: 'page--ia page--challenge',
  });
}
