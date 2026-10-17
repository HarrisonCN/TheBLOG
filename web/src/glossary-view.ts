/**
 * L36 / v1.36.0 摄影术语表页面（纯函数，浏览器和预渲染共用；不需要 JS 也完整可读）：
 * - /glossary/：A–Z 字母索引（普通锚点）、按首字母分组的术语列表（名称 + 英文 + 一句话定义）；
 *   搜索框默认隐藏，glossary-client（按需加载）打开它并在本页即时筛选（名称 / 英文 / 别名 / 拼音 / 拼音首字母）。
 * - /glossary/:slug/：名称、英文与读音、分类、定义、正文、配图（必须有替代文字）、相关术语、回到字母索引。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, pageHead, shell, tile, url, type Page, type Route } from './render';
import { CATEGORY_LABEL, groupByInitial, initialOf, resultText, type Item, type Summary } from './glossary-core';
import type { SiteData } from './types';

function row(t: Summary): string {
  const keys = [t.title, t.en ?? '', ...t.aliases, t.reading].join(' | ');
  return `<li class="gl-item" data-gl-item data-gl-keys="${e(keys)}" data-gl-reading="${e(t.reading)}"><a class="gl-item__a" href="${url(`/glossary/${t.slug}/`)}"><span class="gl-item__t">${e(t.title)}</span>${t.en ? `<span class="gl-item__en small muted" lang="en">${e(t.en)}</span>` : ''}</a><span class="gl-item__cat small">${CATEGORY_LABEL[t.category]}</span><p class="gl-item__sum small">${e(t.summary)}</p></li>`;
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  const groups = groupByInitial(list);
  const nav = groups.map((g) => `<li><a class="gl-letter" href="#g-${g.letter === '#' ? 'num' : g.letter}">${g.letter}</a></li>`).join('');
  const secs = groups
    .map((g) => {
      const id = `g-${g.letter === '#' ? 'num' : g.letter}`;
      return `<section class="gl-group" data-gl-group aria-labelledby="${id}"><h2 class="gl-group__h" id="${id}">${g.letter === '#' ? '# 数字与符号' : g.letter}</h2><ul class="gl-list" role="list">${g.items.map(row).join('')}</ul></section>`;
    })
    .join('');
  const body = list.length
    ? `<div class="gl" data-glossary>
<div class="gl-search" data-glossary-search hidden><label class="gl-search__l" for="gl-q">搜索术语</label><input id="gl-q" class="gl-search__q" type="search" autocomplete="off" placeholder="名称、英文、别名或拼音，例如 gq / aperture" aria-describedby="gl-count"></div>
<p class="gl-count small muted" id="gl-count" role="status" aria-live="polite">${resultText(list.length, '')}</p>
<nav class="gl-nav" aria-label="按首字母跳转"><ul role="list">${nav}</ul></nav>
${secs}
<p class="gl-empty muted" data-gl-empty hidden>没有找到匹配的术语。</p>
</div>`
    : '<p class="muted">还没有术语。</p>';
  return shell(site, route, {
    title: '摄影术语表',
    description: '曝光、光线、构图、器材、后期和胶片里的常用术语，一句话讲清楚',
    top: pageHead('摄影术语表', '常用摄影术语，一句话讲清楚；按拼音首字母排列，也可以直接搜索'),
    main: bento(tile('full', body, { cls: 'ia-tile gl-tile' })),
    kind: 'page--ia page--glossary',
  });
}

export function detailPage(site: SiteData, route: Extract<Route, { name: 'term' }>, t: Item): Page {
  const letter = initialOf(t.reading);
  const fig = t.image
    ? `<figure class="gl-fig"><img src="${e(t.image.src)}" alt="${e(t.image.alt)}" width="${t.image.w}" height="${t.image.h}" loading="lazy" decoding="async"><figcaption class="small muted">${e(t.image.alt)}</figcaption></figure>`
    : '';
  const rel = t.related.length
    ? `<section class="gl-rel" aria-labelledby="gl-rel-h"><h2 id="gl-rel-h" class="gl-rel__h">相关术语</h2><ul class="gl-rel__list" role="list">${t.related.map((r) => `<li><a class="chip" href="${url(`/glossary/${r.slug}/`)}">${e(r.title)}</a></li>`).join('')}</ul></section>`
    : '';
  const body = `<article class="gl-term" data-term="${e(t.slug)}">
<p class="gl-term__meta small muted">${t.en ? `<span lang="en">${e(t.en)}</span>` : ''}<span>读音 ${e(t.reading)}</span><span>分类 · ${CATEGORY_LABEL[t.category]}</span>${t.aliases.length ? `<span>也叫 ${t.aliases.map(e).join('、')}</span>` : ''}</p>
<p class="gl-term__def"><strong>${e(t.summary)}</strong></p>
${t.body.map((p) => `<p>${e(p)}</p>`).join('')}
${fig}
${rel}
<p class="gl-back"><a class="btn btn--sm" href="${url(`/glossary/#g-${letter === '#' ? 'num' : letter}`)}">${icon('list')}回到术语表 · ${letter}</a></p>
</article>`;
  return shell(site, route, {
    title: `${t.title} · 摄影术语表`,
    description: t.summary,
    top: pageHead(t.title, `摄影术语表 · ${CATEGORY_LABEL[t.category]}`),
    main: bento(tile('full', body, { cls: 'ia-tile gl-tile' })),
    kind: 'page--ia page--glossary',
  });
}
