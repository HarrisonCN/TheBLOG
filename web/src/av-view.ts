/**
 * L34 / v1.34.0 视频与声音作品页面（纯函数，浏览器和预渲染共用；不需要 JS 也完整可读）：
 * - /av/：按「视频」「声音」分组的作品卡片（封面、时长、章节数）；
 * - /av/:slug/：原生 <video> / <audio>（controls、不自动播放、preload=metadata、全部来源）+ 章节（?t= 深链）+ 完整文字稿（时间码链接）。
 * av-client（按需加载）负责：从文字稿生成字幕轨道、?t= 跳转、点击时间码跳转、当前字幕 / 章节高亮、文字稿搜索。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, pageHead, shell, tile, url, type Page, type Route } from './render';
import { AV_KIND_LABEL, formatClock, type AvSummary, type AvWork } from './media-core';
import type { SiteData } from './types';

const dateCn = (d: string) => {
  const [y, m, day] = d.split('-');
  return `${y} 年 ${Number(m)} 月 ${Number(day)} 日`;
};
/** 时间码属性值：去掉多余的小数位 */
const tv = (t: number) => String(Math.round(t * 1000) / 1000);
const seekLink = (t: number, label: string, cls: string) => `<a class="${cls}" href="?t=${tv(t)}" data-seek="${tv(t)}">${label}</a>`;

function player(w: AvWork): string {
  const sources = w.sources.map((s) => `<source src="${e(s.src)}" type="${e(s.type)}">`).join('');
  const fallback = `<p class="small">你的浏览器不能播放这段${AV_KIND_LABEL[w.kind]}，可以<a href="${e(w.sources[0]?.src ?? '')}">直接下载</a>，或阅读下面的文字稿。</p>`;
  if (w.kind === 'video') {
    const dims = w.width && w.height ? ` width="${w.width}" height="${w.height}" style="--ar:${(w.width / w.height).toFixed(4)}"` : '';
    return `<video class="av-media av-media--video" controls preload="metadata" playsinline${dims}${w.poster ? ` poster="${e(w.poster.src)}"` : ''} aria-label="${e(w.title)}${w.poster ? `：${e(w.poster.alt)}` : ''}" aria-describedby="av-transcript-h">${sources}${fallback}</video>`;
  }
  return `<div class="av-audio">${icon('music')}<audio class="av-media av-media--audio" controls preload="metadata" aria-label="${e(w.title)}" aria-describedby="av-transcript-h">${sources}${fallback}</audio></div>`;
}

function body(w: AvWork): string {
  const chapters = w.chapters.length
    ? `<nav class="av-chapters" aria-labelledby="av-chapters-h"><h2 class="av-h" id="av-chapters-h">章节</h2><ol class="av-chapters__list" role="list">${w.chapters
        .map((c, i) => `<li data-av-chapter="${i}">${seekLink(c.t, `<span class="av-time">${formatClock(c.t)}</span><span>${e(c.title)}</span>`, 'av-chapter')}</li>`)
        .join('')}</ol></nav>`
    : '';
  const cues = w.cues
    .map((c, i) => `<li class="av-cue" data-av-cue="${i}" data-start="${tv(c.start)}" data-end="${tv(c.end)}">${seekLink(c.start, formatClock(c.start), 'av-time')}<span class="av-cue__text">${e(c.text).replace(/\n/g, '<br>')}</span></li>`)
    .join('');
  const meta = `<p class="av-meta small muted"><span class="av-badge">${AV_KIND_LABEL[w.kind]}</span><span>${dateCn(w.date)}</span><span>时长 ${formatClock(w.duration)}</span>${w.credit ? `<span>${e(w.credit)}</span>` : ''}</p>`;
  return `<div class="av-work" data-av="${e(w.slug)}" data-av-kind="${w.kind}" data-duration="${tv(w.duration)}">
${player(w)}
${meta}
${w.summary ? `<p class="av-summary">${e(w.summary)}</p>` : ''}
${chapters}
<section class="av-transcript" aria-labelledby="av-transcript-h"><div class="av-transcript__head"><h2 class="av-h" id="av-transcript-h">文字稿</h2><label class="av-search" hidden><span class="visually-hidden">搜索文字稿</span><input type="search" data-av-search placeholder="搜索文字稿" autocomplete="off"></label><p class="av-search__status small muted" data-av-status aria-live="polite"></p></div>
<ol class="av-cues" role="list">${cues}</ol></section>
<p class="av-back"><a class="btn btn--sm" href="${url('/av/')}">${icon('arrowRight')}全部视频与声音</a></p>
</div>`;
}

export function avPage(site: SiteData, route: Extract<Route, { name: 'av' }>, w: AvWork): Page {
  return shell(site, route, {
    title: `${w.title} · 视频与声音`,
    description: w.summary?.slice(0, 120) || `${AV_KIND_LABEL[w.kind]}作品：${w.title}`,
    top: pageHead(w.title, `视频与声音 · ${AV_KIND_LABEL[w.kind]} · ${formatClock(w.duration)}`),
    main: bento(tile('full', body(w), { cls: 'ia-tile av-tile' })),
    kind: 'page--ia page--av',
  });
}

function card(s: AvSummary): string {
  const cover = s.poster
    ? `<span class="av-card__cover"><img src="${e(s.poster.src)}" alt="${e(s.poster.alt)}" width="${s.poster.w}" height="${s.poster.h}" loading="lazy" decoding="async"></span>`
    : `<span class="av-card__cover av-card__cover--audio" aria-hidden="true">${icon('music')}</span>`;
  return `<li class="av-card"><a class="av-card__a" href="${url(`/av/${s.slug}/`)}">${cover}<span class="av-card__title">${e(s.title)}</span><span class="av-card__meta small muted">${AV_KIND_LABEL[s.kind]} · ${formatClock(s.duration)} · ${s.chapters} 个章节 · ${dateCn(s.date)}</span>${s.summary ? `<span class="av-card__sum small">${e(s.summary)}</span>` : ''}</a></li>`;
}

export function avListPage(site: SiteData, route: Route, list: AvSummary[]): Page {
  const group = (kind: 'video' | 'audio') => {
    const items = list.filter((s) => s.kind === kind);
    return `<section class="av-group" aria-labelledby="av-g-${kind}"><h2 class="av-h" id="av-g-${kind}">${AV_KIND_LABEL[kind]}</h2>${items.length ? `<ul class="av-list" role="list">${items.map(card).join('')}</ul>` : `<p class="muted">还没有${AV_KIND_LABEL[kind]}作品。</p>`}</section>`;
  };
  return shell(site, route, {
    title: '视频与声音',
    description: '短片和声音作品，都带字幕或文字稿',
    top: pageHead('视频与声音', '短片和声音作品：每一段都有字幕或完整文字稿，可以按章节跳转'),
    main: bento(tile('full', `${group('video')}${group('audio')}`, { cls: 'ia-tile av-tile' })),
    kind: 'page--ia page--av',
  });
}
