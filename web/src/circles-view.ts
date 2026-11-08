/**
 * L51 / v1.51.0 兴趣圈子页面（纯函数，浏览器和预渲染共用；没有 JS 也完整）：/circles/ 圈子卡片（成员数、帖子数、标签）+「只看我加入的」筛选（JS 后出现）；/circles/:slug/ 标签、圈主、守则（有序列表）、最近帖子（按日期倒序），「加入圈子」按钮 JS 加载后出现。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { url, type Page, type Route } from './render';
import { chips, ckDetail, ckList } from './ck-view';
import { latestPosts, memberText, type Item, type Summary } from './circles-core';
import type { SiteData } from './types';
void icon; void url; void chips; void e;

const sub = (it: Item) => `兴趣圈子 · ${memberText(it.members)} · ${it.posts.length} 帖`;
const attrs = (it: Item) => `data-circle="${e(it.slug)}" data-members="${it.members}"`;
const listAttrs = (_l: Summary[]) => 'data-circles';
const meta = (s: Summary) => `${memberText(s.members)} · ${s.posts} 帖${s.lastPost ? ` · 最近 ${s.lastPost}` : ''} ${chips(s.tags)}`;
const top = (_l: Summary[]) => `<p class="cc-filter" data-cc-filter-wrap hidden><label><input type="checkbox" data-cc-filter> 只看我加入的</label> <span class="small muted" data-cc-filter-status role="status"></span></p>`;
function body(it: Item): string {
  const posts = latestPosts(it.posts);
  return `${chips(it.tags)}
<p class="cc-meta small muted"><span data-cc-count>${memberText(it.members)}</span><span>圈主：${it.hosts.map((h) => `${e(h.name)}（${e(h.role)}）`).join('、')}</span></p>
<p class="cc-join" data-cc-tools hidden><button type="button" class="btn btn--sm" data-cc-join aria-pressed="false">${icon('userPlus')}<span>加入圈子</span></button> <span class="small" data-cc-status role="status"></span></p>
<section aria-labelledby="cc-rules-h"><h2 id="cc-rules-h">圈子守则</h2><ol class="cc-rules">${it.rules.map((r) => `<li>${e(r)}</li>`).join('')}</ol></section>
<section aria-labelledby="cc-posts-h"><h2 id="cc-posts-h">最近的帖子（${posts.length}）</h2>${
    posts.length
      ? `<ul class="cc-posts" role="list">${posts.map((p) => `<li class="cc-post" id="post-${e(p.id)}"><p class="cc-post__by small"><strong>${e(p.author)}</strong> <time datetime="${p.date}">${p.date}</time></p><p class="cc-post__text">${e(p.text)}</p><p class="small muted">${p.replies} 条回复</p></li>`).join('')}</ul>`
      : '<p class="muted">还没有帖子。</p>'
  }</section>`;
}
const bottom = (_l: Summary[]) => '';

export function detailPage(site: SiteData, route: Extract<Route, { name: 'circle' }>, it: Item): Page {
  return ckDetail(site, route, { label: '兴趣圈子', base: '/circles/', cls: 'cc', title: it.title, summary: it.summary, sub: sub(it), note: '示例圈子：圈子、成员和帖子都是虚构的演示内容；「加入」只记在这台设备上，不会上传。', body: body(it), attrs: attrs(it) });
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return ckList(site, route, { label: '兴趣圈子', desc: '按兴趣聚在一起：圈子守则、圈主和最近的帖子，加入状态只存在本机', base: '/circles/', cls: 'cc', cards: list.map((s) => ({ slug: s.slug, title: s.title, summary: s.summary, meta: meta(s) })), empty: '还没有圈子。', top: top(list), bottom: bottom(list), attrs: listAttrs(list) });
}
