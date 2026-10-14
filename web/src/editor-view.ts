/**
 * L24 / v1.24.0 内容编辑器 2.0 的公开页面外壳：
 *  - /preview/ 发布预览（站长）：外壳 + 挂载点；草稿只存在站长自己的浏览器（localStorage），由 editor-client 按需渲染；
 *  - /scheduled/ 即将发布：外壳 + 列表挂载点；列表由 editor-client 从 /api/scheduled 读取（只有标题、分类和时间）。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, catChip, kicker, pageHead, renderPostBody, shell, tile, url, type Page, type Route } from './render';
import { textStats, type PreviewPayload, type UpcomingPost } from './editor-core';
import type { SiteData } from './types';

/** 本地时区的「10月15日 09:30」 */
export function localTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function previewShell(site: SiteData, route: Route): Page {
  return shell(site, route, {
    title: '发布预览',
    description: '站长写作台里的草稿预览',
    top: pageHead('发布预览', '写作台里的草稿，按正式文章页的样子排版。只保存在这个浏览器里，不会公开。'),
    main: bento(tile('full', `<div class="ed-preview js-editor-preview" aria-live="polite">${previewEmpty()}</div>`, { cls: 'ed-preview-tile' })),
    kind: 'page--editor',
  });
}
export const previewEmpty = () =>
  `<p class="empty">还没有可预览的草稿。到 <a href="${url('/admin/#editor')}">后台 · 写文章</a> 里点「发布预览」。</p>`;

/** 预览正文：标题、分类 / 标签、摘要、字数，正文用文章页同一套渲染（含目录） */
export function previewBody(p: PreviewPayload): string {
  const { html, toc } = renderPostBody(p.markdown);
  const st = textStats(p.markdown);
  return `<div class="ed-preview__bar" role="note">${icon('eye')}<span>草稿预览 · 保存于 ${e(localTime(p.savedAt))}</span></div>
${p.coverUrl ? `<img class="ed-preview__cover" src="${e(p.coverUrl)}" alt="" width="1280" height="720">` : ''}
<p class="ed-preview__chips">${p.category ? catChip(p.category, '', true) : ''}${p.tags.map((t) => `<span class="chip">${icon('tag')}${e(t)}</span>`).join('')}</p>
<h2 class="ed-preview__title">${e(p.title || '（无标题）')}</h2>
${p.summary ? `<p class="ed-preview__sum">${e(p.summary)}</p>` : ''}
<p class="muted small ed-preview__meta">${icon('file')}${st.chars} 字 · ${icon('clock')}约 ${st.minutes || 1} 分钟</p>
${toc ? `<details class="ed-preview__toc"><summary>目录</summary>${toc}</details>` : ''}
<div class="prose ed-preview__body">${html}</div>`;
}

export function scheduledShell(site: SiteData, route: Route): Page {
  return shell(site, route, {
    title: '即将发布',
    description: '已经写好、定了发布时间的文章',
    top: pageHead('即将发布', '已经写好、定了发布时间的文章。到点自动出现在首页和归档里。'),
    main: bento(tile('full', `${kicker('clock', '发布时间表')}<div class="ed-upcoming js-scheduled" aria-live="polite"><p class="empty">正在读取…</p></div><p class="muted small">已经发布的文章在 <a href="${url('/archives/')}">归档</a>。</p>`, { cls: 'ed-upcoming-tile' })),
    kind: 'page--editor',
  });
}

/** 即将发布列表；now 用来写「还有几天」 */
export function upcomingList(list: UpcomingPost[], nowMs: number): string {
  if (!list.length) return '<p class="empty">现在没有定时发布的文章。</p>';
  const left = (iso: string) => {
    const h = Math.max(0, Math.round((Date.parse(iso) - nowMs) / 3600_000));
    return h < 24 ? `约 ${Math.max(1, h)} 小时后` : `约 ${Math.round(h / 24)} 天后`;
  };
  return `<ol class="ed-upcoming__list" role="list">${list
    .map(
      (p) =>
        `<li class="ed-upcoming__item"><time datetime="${e(p.publishAt)}">${e(localTime(p.publishAt))}</time><b>${e(p.title)}</b>${p.category ? catChip(p.category, '', true) : ''}<span class="muted small">${left(p.publishAt)}</span></li>`,
    )
    .join('')}</ol>`;
}
