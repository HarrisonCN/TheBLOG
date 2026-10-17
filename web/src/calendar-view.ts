/**
 * L39 / v1.39.0 照片日历页面（纯函数，浏览器和预渲染共用；不需要 JS 也完整可读）：
 * - /calendar/：每个月一张卡片（封面、张数），最新的月份在前；
 * - /calendar/:YYYY-MM/：月历表格（caption + 星期列标题，周一开头；有图的日子链接到当天条目）+ 按日期排列的图片列表；
 *   calendar-client（按需加载）只做一件事：把「今天」（Asia/Shanghai）的格子标成 aria-current="date"。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, pageHead, shell, tile, url, type Page, type Route } from './render';
import { WEEKDAYS, monthGrid, monthLabel, weekdayOf, ym, type Item, type Summary } from './calendar-core';
import type { SiteData } from './types';

export function detailPage(site: SiteData, route: Extract<Route, { name: 'calendarmonth' }>, it: Item): Page {
  const [y, m] = ym(it.slug);
  const have = new Map(it.days.map((d) => [d.day, d]));
  const pad = (n: number) => String(n).padStart(2, '0');
  const rows = monthGrid(y, m)
    .map(
      (r) =>
        `<tr>${r
          .map((d) => {
            if (d === null) return '<td class="dl-cell dl-cell--pad"></td>';
            const x = have.get(d);
            const iso = `${it.slug}-${pad(d)}`;
            return x
              ? `<td class="dl-cell dl-cell--has" data-date="${iso}"><a href="#d-${d}" class="dl-cell__a"><span class="dl-cell__n">${d}</span><span class="visually-hidden">日：${e(x.title)}</span><img src="${e(x.image.src)}" alt="" width="${x.image.w}" height="${x.image.h}" loading="lazy" decoding="async"></a></td>`
              : `<td class="dl-cell" data-date="${iso}"><span class="dl-cell__n">${d}</span></td>`;
          })
          .join('')}</tr>`,
    )
    .join('');
  const list = it.days
    .map(
      (d) =>
        `<li class="dl-day" id="d-${d.day}"><figure class="dl-day__fig"><img src="${e(d.image.src)}" alt="${e(d.image.alt)}" width="${d.image.w}" height="${d.image.h}" loading="lazy" decoding="async"><figcaption><span class="dl-day__date small muted">${m} 月 ${d.day} 日 · 星期${WEEKDAYS[weekdayOf(y, m, d.day)]}</span><span class="dl-day__t">${e(d.title)}</span>${d.note ? `<span class="dl-day__note small">${e(d.note)}</span>` : ''}</figcaption></figure></li>`,
    )
    .join('');
  const body = `<div class="dl" data-daily="${e(it.slug)}">
${it.summary ? `<p class="dl-summary">${e(it.summary)}</p>` : ''}
<div class="dl-cal-wrap"><table class="dl-cal"><caption>${monthLabel(it.slug)} · ${it.days.length} 张</caption><thead><tr>${WEEKDAYS.map((w) => `<th scope="col" abbr="星期${w}">${w}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
<ol class="dl-days" role="list">${list}</ol>
<p class="dl-back"><a class="btn btn--sm" href="${url('/calendar/')}">${icon('calendar')}全部月份</a></p>
</div>`;
  return shell(site, route, {
    title: `${it.title} · 照片日历`,
    description: it.summary || `${monthLabel(it.slug)}的照片日历`,
    top: pageHead(it.title, `照片日历 · ${monthLabel(it.slug)}`),
    main: bento(tile('full', body, { cls: 'ia-tile dl-tile' })),
    kind: 'page--ia page--daily',
  });
}

function card(s: Summary): string {
  const cover = s.cover ? `<span class="dl-card__cover"><img src="${e(s.cover.src)}" alt="${e(s.cover.alt)}" width="${s.cover.w}" height="${s.cover.h}" loading="lazy" decoding="async"></span>` : '';
  return `<li class="dl-card"><a class="dl-card__a" href="${url(`/calendar/${s.slug}/`)}">${cover}<span class="dl-card__title">${e(s.title)}</span><span class="dl-card__meta small muted">${monthLabel(s.slug)} · ${s.count} 张</span></a></li>`;
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return shell(site, route, {
    title: '照片日历',
    description: '每天一张照片，按月份排成日历',
    top: pageHead('照片日历', '每天一张照片，按月份排成日历'),
    main: bento(tile('full', list.length ? `<ul class="dl-cards" role="list">${list.map(card).join('')}</ul>` : '<p class="muted">还没有照片日历。</p>', { cls: 'ia-tile dl-tile' })),
    kind: 'page--ia page--daily',
  });
}
