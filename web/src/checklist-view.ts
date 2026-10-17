/**
 * L38 / v1.38.0 拍摄清单页面（纯函数，浏览器和预渲染共用）：
 * - /checklists/：按拍摄类型排列的清单卡片（分组数、条目数）；
 * - /checklists/:slug/：每组一个 fieldset，条目是真正的复选框（没有 JS 也能勾、能打印）；
 *   checklist-client（按需加载）把勾选记在本机浏览器里（不上传），显示进度，提供「清空勾选」和「打印」。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, pageHead, shell, tile, url, type Page, type Route } from './render';
import { KIND_LABEL, allIds, progressText, type Item, type Summary } from './checklist-core';
import type { SiteData } from './types';

export function detailPage(site: SiteData, route: Extract<Route, { name: 'checklist' }>, c: Item): Page {
  const total = allIds(c).length;
  const groups = c.groups
    .map(
      (g, gi) =>
        `<fieldset class="ck-group" data-ck-group="${gi}"><legend class="ck-group__h">${e(g.title)} <span class="small muted">${g.items.length} 项</span></legend><ul class="ck-list" role="list">${g.items
          .map((it) => `<li class="ck-item"><input type="checkbox" id="ck-${e(c.slug)}-${e(it.id)}" data-ck-id="${e(it.id)}"${it.note ? ` aria-describedby="ck-n-${e(it.id)}"` : ''}><label for="ck-${e(c.slug)}-${e(it.id)}">${e(it.label)}</label>${it.note ? `<span class="ck-note small muted" id="ck-n-${e(it.id)}">${e(it.note)}</span>` : ''}</li>`)
          .join('')}</ul></fieldset>`,
    )
    .join('');
  const body = `<div class="ck" data-checklist="${e(c.slug)}">
<p class="ck-meta small muted"><span>${KIND_LABEL[c.kind]}</span><span>${c.groups.length} 组 · ${total} 项</span></p>
<p class="ck-summary">${e(c.summary)}</p>
<div class="ck-bar" data-ck-bar hidden><progress class="ck-progress" max="${total}" value="0" aria-labelledby="ck-status"></progress><p class="ck-status" id="ck-status" role="status" aria-live="polite">${progressText({ done: 0, total })}</p>
<div class="ck-actions"><button type="button" class="btn btn--sm" data-ck-reset>清空勾选</button><button type="button" class="btn btn--sm" data-ck-print>${icon('file')}打印清单</button></div>
<p class="ck-privacy small muted">勾选只保存在这台设备的浏览器里，不会上传。</p></div>
<div class="ck-form">${groups}</div>
<p class="ck-back"><a class="btn btn--sm" href="${url('/checklists/')}">${icon('arrowRight')}全部清单</a></p>
</div>`;
  return shell(site, route, {
    title: `${c.title} · 拍摄清单`,
    description: c.summary.slice(0, 120),
    top: pageHead(c.title, `拍摄清单 · ${KIND_LABEL[c.kind]} · ${total} 项`),
    main: bento(tile('full', body, { cls: 'ia-tile ck-tile' })),
    kind: 'page--ia page--checklist',
  });
}

function card(s: Summary): string {
  return `<li class="ck-card"><a class="ck-card__a" href="${url(`/checklists/${s.slug}/`)}"><span class="ck-card__kind small">${KIND_LABEL[s.kind]}</span><span class="ck-card__title">${e(s.title)}</span><span class="ck-card__meta small muted">${s.groups} 组 · ${s.items} 项</span><span class="ck-card__sum small">${e(s.summary)}</span></a></li>`;
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return shell(site, route, {
    title: '拍摄清单',
    description: '出门拍摄前对一遍：器材、设置和现场流程，勾选只存在本机',
    top: pageHead('拍摄清单', '出门拍摄前对一遍：器材、设置和现场流程'),
    main: bento(tile('full', list.length ? `<ul class="ck-cards" role="list">${list.map(card).join('')}</ul>` : '<p class="muted">还没有清单。</p>', { cls: 'ia-tile ck-tile' })),
    kind: 'page--ia page--checklist',
  });
}
