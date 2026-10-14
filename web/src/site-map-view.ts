/**
 * L23「栏目整理」视图：顶部导航下拉、手机菜单、新栏目落地页、全部栏目 /sections/、影集 /essays/、系列 /series/、
 * 首页「逛逛别的栏目」与 /me/ 快捷入口 —— 全部从栏目注册表 site-map.ts 生成。纯函数，浏览器和预渲染共用。
 *
 * 只给登录用户 / 站长看的条目输出 data-aud + hidden，浏览器端 audience.ts 按身份显示（预渲染 HTML 默认不露出）。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, kicker, pageHead, postCard, postPath, shell, tile, url, type Page, type Route } from './render';
import { entryVisible, listedEntries, SITE_SECTIONS, type Audience, type SiteEntry, type SiteSection } from './site-map';
import type { PostSummary, SiteData } from './types';

/** data-entry / data-aud / hidden 属性：只有 all 的条目默认可见；guest 条目预渲染时可见（访客是默认身份） */
function audAttrs(en: SiteEntry): string {
  const a = en.audience ?? 'all';
  if (a === 'all') return ` data-entry="${e(en.id)}"`;
  return ` data-entry="${e(en.id)}" data-aud="${a}"${a === 'guest' ? '' : ' hidden'}`;
}
/** 一个条目的链接或动作按钮（innerHtml 自定） */
function entryEl(en: SiteEntry, cls: string, inner: string, extra = ''): string {
  if (en.action) return `<button type="button" class="${cls} js-ia-action" data-action="${en.action}"${audAttrs(en)}${extra}>${inner}</button>`;
  return `<a class="${cls}" href="${url(en.href!)}"${audAttrs(en)}${extra}>${inner}</a>`;
}

// ---------------------------------------------------------------- 顶部导航 / 手机菜单
/** 顶部导航的栏目（下划线表示当前栏目） */
export function navMenus(activeIdx: number): string {
  return SITE_SECTIONS.map((s, i) => {
    const cur = i === activeIdx ? ' aria-current="page"' : '';
    const items = listedEntries(s);
    if (!items.length) return `<div class="menu"${cur}><a class="menu__link" href="${url(s.href)}">${s.label}</a></div>`;
    const head = s.isNew ? `<a role="menuitem" class="menu__all" href="${url(s.href)}">${icon(s.icon)}<span>${e(s.title)}首页</span></a>` : '';
    return `<div class="menu menu--group"${cur}><a class="menu__link" href="${url(s.href)}" aria-haspopup="true">${s.label}</a>
  <div class="menu__drop" role="menu" aria-label="${e(s.title)}">${head}${items.map((en) => entryEl(en, 'menu__item', `${icon(en.icon)}<span>${e(en.label)}</span>`, ' role="menuitem"')).join('')}</div></div>`;
  }).join('');
}

/** 手机菜单：每个栏目一组，组名链接到栏目入口，下面是条目 */
export function drawerGroups(): string {
  return SITE_SECTIONS.map((s) => {
    const items = listedEntries(s);
    return `<div class="drawer__group" data-section="${s.id}"><a class="drawer__link" href="${url(s.href)}">${icon(s.icon)}<span>${e(s.label)}</span></a>${
      items.length ? `<div class="drawer__subs">${items.map((en) => entryEl(en, 'drawer__sub', e(en.label))).join('')}</div>` : ''
    }</div>`;
  }).join('');
}

// ---------------------------------------------------------------- 卡片
/** 条目卡片：图标 + 名称 + 一句话说明 */
function card(en: SiteEntry): string {
  const inner = `<span class="ia-card__ic">${icon(en.icon)}</span><span class="ia-card__txt"><b>${e(en.label)}</b><small>${e(en.desc)}</small></span>${en.action ? '' : `<span class="ia-card__go">${icon('arrowRight')}</span>`}`;
  const a = en.audience ?? 'all';
  const li = a === 'all' ? '' : ` data-aud="${a}"${a === 'guest' ? '' : ' hidden'}`;
  return `<li class="ia-item"${li}>${entryEl(en, 'ia-card', inner)}</li>`;
}
function cards(list: SiteEntry[]): string {
  return `<ul class="ia-grid" role="list">${list.map(card).join('')}</ul>`;
}

const NOTES: Record<string, string> = {
  community: '好朋友们发布的作品、话题和活动都在这里。登录后可以发布作品、关注、参加活动投票。',
  tools: '这些工具在全站随时可用：⌘K 打开命令面板，音乐播放器在左下角，阅读设置和分享在文章页里。',
  account: '登录、通知、私信、个人数据和隐私安全集中在这里。只有你自己能看到这些页面的内容。',
};

/** 新栏目落地页：/community/、/tools/、/account/ */
export function sectionLanding(site: SiteData, route: Extract<Route, { name: 'community' | 'tools' | 'account' }>): Page {
  const s = SITE_SECTIONS.find((x) => x.id === route.name)!;
  const list = listedEntries(s);
  const guestHint =
    s.id === 'account'
      ? `<p class="ia-note" data-aud="guest">${icon('lock')}<span>登录后这里会出现：${list
          .filter((x) => x.audience === 'member')
          .map((x) => e(x.label))
          .join('、')}。<a href="${url('/join/')}">去登录</a></span></p>`
      : '';
  return shell(site, route, {
    title: s.title,
    description: s.desc,
    top: pageHead(s.title, s.desc),
    main: bento(tile('full', `${kicker(s.icon, `${e(s.title)} · ${list.length} 项`)}<p class="ia-lead">${e(NOTES[s.id] ?? s.desc)}</p>${guestHint}${cards(list)}`, { cls: 'ia-tile', attrs: `data-section="${s.id}"` })),
    kind: 'page--ia',
  });
}

/** 全部栏目：每个栏目一块，列出全部条目 */
export function sectionsPage(site: SiteData, route: Route): Page {
  const block = (s: SiteSection) => {
    const list = listedEntries(s);
    const body = list.length ? cards(list) : `<p class="muted small">${e(s.desc)}</p>`;
    return tile('full', `<h2 class="ia-h"><a href="${url(s.href)}">${icon(s.icon)}<span>${e(s.title)}</span></a>${s.isNew ? '<span class="chip chip--accent">新栏目</span>' : ''}</h2><p class="muted small">${e(s.desc)}</p>${body}`, { cls: 'ia-tile', attrs: `data-section="${s.id}"` });
  };
  return shell(site, route, {
    title: '全部栏目',
    description: '一页看全站所有栏目与功能',
    top: pageHead('全部栏目', `${SITE_SECTIONS.length} 个栏目 · 每个功能都能在这里找到`),
    main: bento(SITE_SECTIONS.map(block).join('')),
    kind: 'page--ia',
  });
}

// ---------------------------------------------------------------- 影集 / 系列
export function essaysPage(site: SiteData, route: Route): Page {
  const list = site.posts.filter((p) => p.kind === 'essay');
  return shell(site, route, {
    title: '影集',
    description: '一组照片讲一个故事',
    top: pageHead('影集', `${list.length} 组影集 · 打开后可以用故事模式浏览`, list[0]?.coverUrl),
    main: list.length ? bento(list.map((p, i) => postCard(p, i, 'third')).join(''), 'bento--posts') : bento(tile('full', '<p class="empty">还没有影集。</p>')),
    kind: 'page--ia',
  });
}

const pub = (p: PostSummary) => p.publishedAt ?? p.createdAt;
export function seriesGroups(posts: PostSummary[]): { name: string; posts: PostSummary[] }[] {
  const map = new Map<string, PostSummary[]>();
  for (const p of posts) {
    const n = (p.series ?? '').trim();
    if (n) map.set(n, [...(map.get(n) ?? []), p]);
  }
  return [...map]
    .map(([name, list]) => ({ name, posts: list.sort((a, b) => (pub(a) < pub(b) ? -1 : pub(a) > pub(b) ? 1 : a.id - b.id)) }))
    .sort((a, b) => (pub(b.posts[b.posts.length - 1]!) < pub(a.posts[a.posts.length - 1]!) ? -1 : 1));
}
export function seriesPage(site: SiteData, route: Route): Page {
  const groups = seriesGroups(site.posts);
  const block = (g: { name: string; posts: PostSummary[] }) =>
    tile(
      'half',
      `${kicker('list', `系列 · ${g.posts.length} 篇`)}<h2 class="ia-h"><a href="${url(`/series/${encodeURIComponent(g.name)}/`)}">${e(g.name)}</a></h2><ol class="ia-series">${g.posts.map((p) => `<li><a href="${postPath(p.slug)}">${e(p.title)}</a></li>`).join('')}</ol><a class="tile__more" href="${postPath(g.posts[0]!.slug)}">从第一篇读起${icon('arrowRight')}</a>`,
      { cls: 'ia-tile' },
    );
  return shell(site, route, {
    title: '系列连载',
    description: '按系列从第一篇读起',
    top: pageHead('系列连载', `${groups.length} 个系列`),
    main: groups.length ? bento(groups.map(block).join('')) : bento(tile('full', '<p class="empty">还没有系列连载。</p>')),
    kind: 'page--ia',
  });
}

// ---------------------------------------------------------------- 首页 / 我的
/** 首页「逛逛别的栏目」：除首页外的全部栏目 + 全部栏目页 */
export function exploreTile(): string {
  const items = SITE_SECTIONS.filter((s) => s.id !== 'home').map((s) => `<a href="${url(s.href)}" data-section="${s.id}">${icon(s.icon)}<span>${e(s.label)}</span></a>`);
  items.push(`<a href="${url('/sections/')}">${icon('grid')}<span>全部栏目</span></a>`);
  return tile('third', `${kicker('sparkles', '逛逛别的栏目')}<nav class="explore" aria-label="更多栏目">${items.join('')}</nav>`, { cls: 'explore-tile' });
}

/** /me/ 快捷入口：账号栏目里当前身份可见的条目（除「我的」本身）+ 发布作品 */
export function meHub(aud: Audience): string {
  const acc = SITE_SECTIONS.find((s) => s.id === 'account')!;
  const compose = SITE_SECTIONS.flatMap((s) => s.entries).find((x) => x.id === 'compose')!;
  const list = [compose, ...listedEntries(acc).filter((x) => x.id !== 'me')].filter((x) => entryVisible(x, aud));
  return `<section class="tile tile--full ia-hub" aria-labelledby="ia-hub-h"><h2 class="soc-h" id="ia-hub-h">${icon('grid')}快捷入口</h2><ul class="ia-grid ia-grid--compact" role="list">${list
    .map((en) => `<li class="ia-item"><a class="ia-card" href="${url(en.href!)}" data-entry="${e(en.id)}"><span class="ia-card__ic">${icon(en.icon)}</span><span class="ia-card__txt"><b>${e(en.label)}</b><small>${e(en.desc)}</small></span></a></li>`)
    .join('')}</ul><p class="muted small"><a href="${url('/account/')}">账号与安全</a> · <a href="${url('/sections/')}">全部栏目</a></p></section>`;
}
