/**
 * L51+ 社区 / 专题栏目共用的页面骨架（纯函数，浏览器和预渲染共用；不需要 JS）：
 * 列表页 = 页首 + 说明 + 卡片列表（标题、简介、元信息），详情页 = 页首 + 虚构声明 + 简介 + 正文 + 返回链接。
 * 每个栏目只写自己的正文与卡片元信息；交互（加入、投票、关注…）由各自的按需加载脚本补上，只存在本机。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, pageHead, shell, tile, url, type Page, type Route } from './render';
import type { SiteData } from './types';

export interface CkCard {
  slug: string;
  title: string;
  summary: string;
  /** 已转义的元信息 HTML */
  meta: string;
}
export const ficNote = (text: string, ic = 'users') => `<p class="ck-note small" role="note">${icon(ic)}<span>${e(text)}</span></p>`;
export const chips = (tags: string[], cls = 'ck-chip') => (tags.length ? `<span class="ck-chips">${tags.map((t) => `<span class="${cls}">${e(t)}</span>`).join('')}</span>` : '');

export function ckList(
  site: SiteData,
  route: Route,
  o: { label: string; desc: string; base: string; cls: string; cards: CkCard[]; empty: string; top?: string; bottom?: string; attrs?: string },
): Page {
  const cards = o.cards.length
    ? `<ul class="ck-cards" role="list">${o.cards
        .map(
          (c) =>
            `<li class="ck-card" data-slug="${e(c.slug)}"><a class="ck-card__a" href="${url(`${o.base}${c.slug}/`)}"><span class="ck-card__title">${e(c.title)}</span><span class="ck-card__sum">${e(c.summary)}</span><span class="ck-card__meta small muted">${c.meta}</span></a></li>`,
        )
        .join('')}</ul>`
    : `<p class="muted">${e(o.empty)}</p>`;
  return shell(site, route, {
    title: o.label,
    description: o.desc,
    top: pageHead(o.label, e(o.desc)),
    main: bento(tile('full', `<div class="ck ${o.cls}"${o.attrs ? ` ${o.attrs}` : ''}>${o.top ?? ''}${cards}${o.bottom ?? ''}</div>`, { cls: 'ia-tile ck-tile' })),
    kind: `page--ia page--ck page--${o.cls}`,
  });
}

export function ckDetail(
  site: SiteData,
  route: Route,
  o: { label: string; base: string; cls: string; title: string; summary: string; sub: string; note: string; body: string; attrs?: string; noteIcon?: string },
): Page {
  const body = `<div class="ck ${o.cls}"${o.attrs ? ` ${o.attrs}` : ''}>${ficNote(o.note, o.noteIcon)}<p class="ck-lead">${e(o.summary)}</p>${o.body}<p class="ck-back"><a class="btn btn--sm" href="${url(o.base)}">${icon('arrowLeft')}全部${e(o.label)}</a></p></div>`;
  return shell(site, route, {
    title: `${o.title} · ${o.label}`,
    description: o.summary.slice(0, 120),
    top: pageHead(o.title, e(o.sub)),
    main: bento(tile('full', body, { cls: 'ia-tile ck-tile' })),
    kind: `page--ia page--ck page--${o.cls}`,
  });
}
