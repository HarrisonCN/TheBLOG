/**
 * 纯函数视图：浏览器与构建期预渲染（Node）共用，输出 HTML 字符串。
 * 版式参考 Hexo Butterfly 的信息结构（全屏首图、左右交替的文章卡片、右侧栏、归档时间线……），
 * 样式与代码均为本仓库原创。所有用户数据都经过 escapeHtml；正文经过安全的 Markdown 渲染器。
 *
 * <usa-*> 标签来自 Motionary：预渲染时它们只是普通元素（里面放可读的回退内容），
 * 浏览器端由 usa.ts 按需加载对应的组件定义。
 */
import { escapeHtml as e, plainText, renderMarkdown, safeHref } from './markdown';
import { festivalIcon, icon, SOCIAL_ICON, stripEmoji } from './icons';
import type { Album, CategoryCount, Favorite, Friend, GuestbookEntry, Post, PostSummary, Profile, Settings, SiteData, TagCount } from './types';
import { activeFestival, type Festival, type Project, type PublicMember, type StickyNote } from './demo/community-types';
import { REACTIONS } from './reactions-core';
import { noteTextHtml } from './note-style-view';
import { DEFAULT_NOTE_STYLE, EFFECT_LABELS, FONT_LABELS, INK_PRESETS, NOTE_EFFECTS, NOTE_FONTS, NOTE_SIZES, SIZE_LABELS } from './note-style';
import { ESSAY_LAYOUT_LABEL, type Essay } from './essay-core';
import { exifStripHtml, shotNotesHtml } from './essay-view';
import type { ChangelogEntry, GearItem, NowItem, Repo, ShelfItem, TimelineItem, Work } from './sections';
export { rssXml, jsonFeed } from './sections';
import { badgeHtml, presetGallery } from './badge-view';
import { archiveCalendar, relatedPosts, seriesOf } from './post-extras';
import { dailyWork, dotsPath, mapPoints, project } from './photo-map';
import { changelogPage, gearPage, homeSections, nowPage, opensourcePage, searchPage, shelfPage, statsPage, subscribePage, timelinePage, worksPage } from './sections-view';

let md: (s: string) => string = renderMarkdown;
export function setMarkdownRenderer(fn: (s: string) => string): void {
  md = fn;
}

/** 站点部署在子路径（如 GitHub Pages 的 /TheBLOG/）时的前缀；根路径部署时为空。 */
let BASE = '';
export function setBasePath(base: string): void {
  BASE = (base || '/').replace(/\/+$/, '');
}
export function basePath(): string {
  return BASE;
}
/** 站内绝对路径加上部署前缀。 */
export const url = (path: string) => BASE + path;
/** 把 location.pathname 去掉部署前缀，得到站内路径。 */
export function stripBase(pathname: string): string {
  if (!BASE) return pathname;
  if (pathname === BASE) return '/';
  return pathname.startsWith(BASE + '/') ? pathname.slice(BASE.length) : pathname;
}

// ---------------------------------------------------------------- 路由
export type Route =
  | { name: 'home'; page: number }
  | { name: 'post'; slug: string }
  | { name: 'archives' }
  | { name: 'tags' }
  | { name: 'tag'; tag: string }
  | { name: 'categories' }
  | { name: 'category'; category: string }
  | { name: 'gallery' }
  | { name: 'album'; slug: string }
  | { name: 'favorites' }
  | { name: 'guestbook' }
  | { name: 'links' }
  | { name: 'about' }
  | { name: 'privacy' }
  | { name: 'join' }
  | { name: 'mailbox' }
  | { name: 'now' }
  | { name: 'works' }
  | { name: 'gear' }
  | { name: 'shelf' }
  | { name: 'timeline' }
  | { name: 'changelog' }
  | { name: 'opensource' }
  | { name: 'stats' }
  | { name: 'search' }
  | { name: 'subscribe' }
  | { name: 'map' }
  | { name: 'user'; username: string }
  | { name: 'notifications' }
  | { name: 'me' }
  | { name: 'feed' }
  | { name: 'compose' }
  | { name: 'work'; id: number }
  | { name: 'discover' }
  | { name: 'topics' }
  | { name: 'topic'; slug: string }
  | { name: 'events' }
  | { name: 'event'; slug: string }
  | { name: 'collection'; id: number }
  | { name: 'projects' }
  | { name: 'project'; slug: string }
  | { name: 'features' }
  | { name: 'feature'; slug: string }
  | { name: 'mystats' }
  | { name: 'messages' }
  | { name: 'msgrequests' }
  | { name: 'msgsettings' }
  | { name: 'conversation'; id: number }
  | { name: 'notfound' };

const STATIC: Record<string, Route['name']> = {
  '/archives': 'archives',
  '/tags': 'tags',
  '/categories': 'categories',
  '/gallery': 'gallery',
  '/favorites': 'favorites',
  '/guestbook': 'guestbook',
  '/links': 'links',
  '/about': 'about',
  '/privacy': 'privacy',
  '/join': 'join',
  '/mailbox': 'mailbox',
  '/now': 'now',
  '/works': 'works',
  '/gear': 'gear',
  '/shelf': 'shelf',
  '/timeline': 'timeline',
  '/changelog': 'changelog',
  '/opensource': 'opensource',
  '/stats': 'stats',
  '/search': 'search',
  '/subscribe': 'subscribe',
  '/map': 'map',
  '/notifications': 'notifications',
  '/me': 'me',
  '/feed': 'feed',
  '/compose': 'compose',
  '/discover': 'discover',
  '/t': 'topics',
  '/events': 'events',
  '/projects': 'projects',
  '/f': 'features',
  '/me/stats': 'mystats',
  '/messages': 'messages',
  '/messages/requests': 'msgrequests',
  '/messages/settings': 'msgsettings',
};
/** 扩展栏目的静态路由（预渲染用） */
export const SECTION_ROUTES = ['now', 'works', 'gear', 'shelf', 'timeline', 'changelog', 'opensource', 'stats', 'search', 'subscribe', 'map'] as const;

function decode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

export function parseRoute(pathname: string): Route {
  const p = pathname.replace(/\/index\.html$/, '/').replace(/\/+$/, '') || '/';
  if (p === '/') return { name: 'home', page: 1 };
  const st = STATIC[p];
  if (st) return { name: st } as Route;
  let m = /^\/page\/(\d{1,4})$/.exec(p);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 ? { name: 'home', page: n } : { name: 'notfound' };
  }
  m = /^\/posts\/([a-z0-9-]+)$/.exec(p);
  if (m) return { name: 'post', slug: m[1]! };
  m = /^\/gallery\/([a-z0-9-]+)$/.exec(p);
  if (m) return { name: 'album', slug: m[1]! };
  m = /^\/w\/(\d{1,10})$/.exec(p);
  if (m) return { name: 'work', id: Number(m[1]) };
  m = /^\/messages\/c\/(\d{1,12})$/.exec(p);
  if (m) return { name: 'conversation', id: Number(m[1]) };
  m = /^\/t\/([a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?)$/.exec(p);
  if (m) return { name: 'topic', slug: m[1]! };
  m = /^\/events\/([a-z0-9][a-z0-9-]{0,38}[a-z0-9])$/.exec(p);
  if (m) return { name: 'event', slug: m[1]! };
  m = /^\/p\/([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)$/.exec(p);
  if (m) return { name: 'project', slug: m[1]! };
  m = /^\/f\/([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)$/.exec(p);
  if (m) return { name: 'feature', slug: m[1]! };
  m = /^\/c\/(\d{1,10})$/.exec(p);
  if (m) return { name: 'collection', id: Number(m[1]) };
  m = /^\/u\/([A-Za-z0-9_]{3,20})$/.exec(p);
  if (m) return { name: 'user', username: m[1]!.toLowerCase() };
  m = /^\/tags\/([^/]+)$/.exec(p);
  if (m) {
    const t = decode(m[1]!);
    return t ? { name: 'tag', tag: t } : { name: 'notfound' };
  }
  m = /^\/categories\/([^/]+)$/.exec(p);
  if (m) {
    const c = decode(m[1]!);
    return c ? { name: 'category', category: c } : { name: 'notfound' };
  }
  return { name: 'notfound' };
}

export const postPath = (slug: string) => `${BASE}/posts/${slug}/`;
export const tagPath = (tag: string) => `${BASE}/tags/${encodeURIComponent(tag)}/`;
export const categoryPath = (c: string) => `${BASE}/categories/${encodeURIComponent(c)}/`;
export const albumPath = (slug: string) => `${BASE}/gallery/${slug}/`;
export const userPath = (username: string) => `${BASE}/u/${encodeURIComponent(username)}/`;
export const pagePath = (n: number) => (n <= 1 ? `${BASE}/` : `${BASE}/page/${n}/`);

/** 路由 → 站内路径（不含前缀），用于导航高亮、预渲染输出目录。 */
export function routePath(r: Route): string {
  switch (r.name) {
    case 'home':
      return r.page > 1 ? `/page/${r.page}/` : '/';
    case 'post':
      return `/posts/${r.slug}/`;
    case 'tag':
      return `/tags/${encodeURIComponent(r.tag)}/`;
    case 'category':
      return `/categories/${encodeURIComponent(r.category)}/`;
    case 'album':
      return `/gallery/${r.slug}/`;
    case 'user':
      return `/u/${r.username}/`;
    case 'work':
      return `/w/${r.id}/`;
    case 'topics':
      return '/t/';
    case 'topic':
      return `/t/${r.slug}/`;
    case 'event':
      return `/events/${r.slug}/`;
    case 'collection':
      return `/c/${r.id}/`;
    case 'project':
      return `/p/${r.slug}/`;
    case 'features':
      return '/f/';
    case 'feature':
      return `/f/${r.slug}/`;
    case 'mystats':
      return '/me/stats/';
    case 'messages':
      return '/messages/';
    case 'msgrequests':
      return '/messages/requests/';
    case 'msgsettings':
      return '/messages/settings/';
    case 'conversation':
      return `/messages/c/${r.id}/`;
    case 'notfound':
      return '/404/';
    default:
      return `/${r.name}/`;
  }
}

// ---------------------------------------------------------------- 工具
const DATE = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' });
const DATE_LONG = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Shanghai' });
function validDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
/** 2026-10-08 */
export function formatDate(iso: string | null | undefined): string {
  const d = validDate(iso);
  return d ? DATE.format(d).replace(/\//g, '-') : '';
}
/** 2026年10月8日 */
export function formatDateLong(iso: string | null | undefined): string {
  const d = validDate(iso);
  return d ? DATE_LONG.format(d) : '';
}
function ymd(iso: string): { y: string; m: string; d: string } {
  const [y = '', m = '', d = ''] = formatDate(iso).split('-');
  return { y, m, d };
}
const pubDate = (p: PostSummary) => p.publishedAt ?? p.createdAt;
export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 300));
}
export function formatCount(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1)}万` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
export function hashHue(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return h;
}

/** 1280 宽的示例照片自动带上 640 / 1920 的 srcset。 */
export function img(src: string | null | undefined, alt: string, cls: string, opts: { sizes?: string; eager?: boolean; w?: number; h?: number } = {}): string {
  const s = safeHref(src ?? '', true);
  if (!s) return '';
  let srcset = '';
  const m = /^(.*)-(640|1280|1920)\.webp$/.exec(s);
  if (m) srcset = ` srcset="${e(m[1]!)}-640.webp 640w, ${e(m[1]!)}-1280.webp 1280w, ${e(m[1]!)}-1920.webp 1920w" sizes="${e(opts.sizes ?? '(max-width: 768px) 100vw, 50vw')}"`;
  const dims = opts.w && opts.h ? ` width="${opts.w}" height="${opts.h}"` : '';
  return `<img class="${cls}" src="${e(s)}"${srcset}${dims} alt="${e(alt)}" ${opts.eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}
function bgStyle(src: string | null | undefined): string {
  const s = safeHref(src ?? '', true);
  return s ? ` style="--bg-img:url('${e(s.replace(/'/g, '%27'))}')"` : '';
}
function avatarImg(profile: Profile, cls: string): string {
  return img(profile.avatarUrl, profile.name, cls) || `<span class="${cls} avatar--initial" aria-hidden="true">${e(profile.name.slice(0, 1))}</span>`;
}

// ---------------------------------------------------------------- 页面结构（Bento 网格）
export interface Page {
  title: string;
  description: string;
  route: Route;
  /** 页首瓷砖（标题区） */
  top: string;
  /** 主体：一个或多个 .bento 网格 */
  main: string;
  /** 兼容旧接口：附加在主体之后的区块（多数页面为空） */
  aside: string;
  /** 页面级 class（如 page--post） */
  kind: string;
}

/** 页面额外数据（按路由懒加载）。 */
export interface Extra {
  post?: Post;
  friends?: Friend[];
  gallery?: Album[];
  favorites?: Favorite[];
  projects?: Project[];
  guestbook?: GuestbookEntry[];
  notes?: StickyNote[];
  members?: PublicMember[];
  now?: NowItem[];
  works?: Work[];
  gear?: GearItem[];
  shelf?: ShelfItem[];
  timeline?: TimelineItem[];
  changelog?: ChangelogEntry[];
  repos?: Repo[];
}

/** 每个路由需要额外拉取的数据。 */
export function needs(r: Route): (keyof Extra)[] {
  switch (r.name) {
    case 'home':
      return r.page === 1 ? ['notes', 'now', 'works', 'repos', 'changelog', 'shelf'] : [];
    case 'post':
      return ['post'];
    case 'gallery':
    case 'album':
      return ['gallery'];
    case 'favorites':
      return ['favorites', 'projects'];
    case 'links':
      return ['friends', 'members'];
    case 'guestbook':
      return ['guestbook', 'notes'];
    case 'about':
      return ['members'];
    case 'map':
      return ['works'];
    case 'now':
    case 'works':
    case 'gear':
    case 'shelf':
    case 'timeline':
    case 'changelog':
      return [r.name];
    case 'opensource':
      return ['repos', 'changelog'];
    case 'stats':
      return ['changelog'];
    default:
      return [];
  }
}

interface NavItem {
  label: string;
  icon: string;
  href?: string;
  match?: Route['name'][];
  children?: NavItem[];
}
/** 顶部导航：首页 / 文章 / 专题 / 摄影 / 技术 / 关于。每个栏目下拉里放原来的二级页面，所有栏目都能从这里到达。 */
export const NAV: NavItem[] = [
  { label: '首页', icon: 'home', href: '/', match: ['home'] },
  {
    label: '文章',
    icon: 'book',
    href: '/archives/',
    match: ['archives', 'post', 'search', 'stats', 'subscribe'],
    children: [
      { label: '归档', icon: 'archive', href: '/archives/' },
      { label: '搜索', icon: 'search', href: '/search/' },
      { label: '数据', icon: 'chart', href: '/stats/' },
      { label: 'RSS 订阅', icon: 'rss', href: '/subscribe/' },
    ],
  },
  {
    label: '专题',
    icon: 'folder',
    href: '/categories/',
    match: ['categories', 'category', 'tags', 'tag', 'shelf', 'favorites'],
    children: [
      { label: '分类专题', icon: 'folder', href: '/categories/' },
      { label: '标签', icon: 'tag', href: '/tags/' },
      { label: '书影音', icon: 'library', href: '/shelf/' },
      { label: '收藏与项目', icon: 'star', href: '/favorites/' },
    ],
  },
  {
    label: '摄影',
    icon: 'camera',
    href: '/works/',
    match: ['works', 'gallery', 'album', 'gear', 'map', 'features', 'feature'],
    children: [
      { label: '作品集', icon: 'aperture', href: '/works/' },
      { label: '摄影专题', icon: 'book', href: '/f/' },
      { label: '照片地图', icon: 'mapPin', href: '/map/' },
      { label: '画廊', icon: 'image', href: '/gallery/' },
      { label: '器材', icon: 'camera', href: '/gear/' },
    ],
  },
  {
    label: '技术',
    icon: 'code',
    href: '/opensource/',
    match: ['opensource', 'changelog', 'projects', 'project'],
    children: [
      { label: '开源项目', icon: 'code', href: '/opensource/' },
      { label: '创作者项目', icon: 'briefcase', href: '/projects/' },
      { label: '更新日志', icon: 'list', href: '/changelog/' },
      { label: '技术文章', icon: 'book', href: '/categories/%E5%89%8D%E7%AB%AF/' },
    ],
  },
  {
    label: '关于',
    icon: 'user',
    href: '/about/',
    match: ['about', 'privacy', 'now', 'timeline', 'guestbook', 'links', 'join', 'mailbox', 'feed', 'work', 'compose', 'discover', 'topics', 'topic', 'events', 'event', 'collection'],
    children: [
      { label: '关于我', icon: 'user', href: '/about/' },
      { label: '发现社区', icon: 'sparkles', href: '/discover/' },
      { label: '社区动态', icon: 'users', href: '/feed/' },
      { label: '摄影活动', icon: 'camera', href: '/events/' },
      { label: '此刻', icon: 'clock', href: '/now/' },
      { label: '时间线', icon: 'history', href: '/timeline/' },
      { label: '留言与便签', icon: 'message', href: '/guestbook/' },
      { label: '友链', icon: 'link', href: '/links/' },
      { label: '成为好朋友', icon: 'heart', href: '/join/' },
      { label: '信箱', icon: 'mail', href: '/mailbox/' },
      { label: '隐私说明', icon: 'eye', href: '/privacy/' },
    ],
  },
];

function navActive(item: NavItem, route: Route): boolean {
  return !!item.match?.includes(route.name);
}
/** 当前路由对应的顶级菜单序号（没有则 -1） */
export function navIndex(route: Route): number {
  return NAV.findIndex((it) => navActive(it, route));
}

/** 站点字标：站点名 + 一句话标语（衬线体）。 */
function brand(site: SiteData, cls = 'brand'): string {
  return `<a class="${cls}" href="${url('/')}" aria-label="${e(site.settings.siteTitle)} 首页"><span class="${cls}__name">${e(site.settings.siteTitle)}</span>${site.settings.siteDescription ? `<span class="${cls}__tag">${e(site.settings.siteDescription)}</span>` : ''}</a>`;
}

/** 顶部导航：字标、栏目（下划线表示当前）、搜索胶囊（⌘K）、深浅色、好朋友登录。 */
export function navbar(site: SiteData, route: Route): string {
  const items = NAV.map((it) => {
    const cur = navActive(it, route) ? ' aria-current="page"' : '';
    if (!it.children) return `<div class="menu"${cur}><a class="menu__link" href="${url(it.href!)}">${it.label}</a></div>`;
    return `<div class="menu menu--group"${cur}><a class="menu__link" href="${url(it.href!)}" aria-haspopup="true">${it.label}</a>
  <div class="menu__drop" role="menu">${it.children.map((c) => `<a role="menuitem" href="${url(c.href!)}">${icon(c.icon)}<span>${c.label}</span></a>`).join('')}</div></div>`;
  }).join('');
  return `<header class="nav" id="nav">
  <div class="nav__bar wrap">
    ${brand(site)}
    <nav class="nav__menus" aria-label="主导航">${items}</nav>
    <div class="nav__tools">
      <button class="nav__search js-search" type="button" aria-label="搜索（Ctrl K）">${icon('search')}<span class="nav__search-text">搜索文章、主题或关键词…</span><kbd class="nav__kbd">⌘K</kbd></button>
      <button class="nav__btn nav__btn--search js-search" type="button" aria-label="搜索">${icon('search')}</button>
      <button class="nav__btn js-theme" type="button" aria-label="切换深色 / 浅色模式" title="切换深色 / 浅色">${icon('moon', 'only-light')}${icon('sun', 'only-dark')}</button>
      <a class="nav__btn nav__bell js-notif-link" href="${url('/notifications/')}" aria-label="通知" title="通知" hidden>${icon('bell')}<span class="nav__dot js-notif-dot" hidden></span></a>
      <a class="nav__btn nav__bell nav__dm js-dm-link" href="${url('/messages/')}" aria-label="私信" title="私信" hidden>${icon('message')}<span class="nav__dot js-dm-dot" hidden></span></a>
      <a class="nav__btn nav__me js-me" href="${url('/join/')}" aria-label="好朋友登录 / 注册" title="好朋友登录 / 注册">${icon('user')}</a>
      <button class="nav__btn nav__toggle js-drawer" type="button" aria-label="打开菜单" aria-expanded="false" aria-controls="drawer"><usa-icon-morph class="js-menu-morph menu-morph" icons="menu,close" size="22" preset="stiff" aria-hidden="true">${icon('menu')}</usa-icon-morph></button>
    </div>
  </div>
</header>`;
}

/** 手机端菜单：从右侧滑出的面板。 */
export function drawer(site: SiteData): string {
  const groups = NAV.map(
    (it) => `<div class="drawer__group"><a class="drawer__link" href="${url(it.href!)}">${icon(it.icon)}<span>${it.label}</span></a>${
      it.children ? `<div class="drawer__subs">${it.children.map((c) => `<a href="${url(c.href!)}">${e(c.label)}</a>`).join('')}</div>` : ''
    }</div>`,
  ).join('');
  return `<div class="drawer" id="drawer" hidden>
  <div class="drawer__mask js-drawer-close"></div>
  <aside class="drawer__panel" aria-label="菜单">
    <div class="drawer__head">${avatarImg(site.profile, 'drawer__avatar')}<div><strong>${e(site.profile.name)}</strong>${counts(site)}</div><button class="nav__btn drawer__close js-drawer-close" type="button" aria-label="关闭菜单" aria-controls="drawer"><usa-icon-morph class="js-menu-morph menu-morph" icons="menu,close" size="22" preset="stiff" aria-hidden="true">${icon('close')}</usa-icon-morph></button></div>
    <button class="drawer__search js-search" type="button">${icon('search')}<span>搜索文章、主题或关键词…</span></button>
    <nav class="drawer__mine" aria-label="我的"><a class="drawer__link" href="${url('/notifications/')}">${icon('bell')}<span>通知</span><span class="drawer__count js-notif-count" hidden></span></a><a class="drawer__link js-me-link" href="${url('/me/')}">${icon('user')}<span>我的</span></a></nav>
    <nav class="drawer__nav">${groups}</nav>
  </aside>
</div>`;
}

function counts(site: SiteData): string {
  return `<div class="counts">
  <a href="${url('/archives/')}"><b>${site.total}</b><span>文章</span></a>
  <a href="${url('/tags/')}"><b>${site.tags.length}</b><span>标签</span></a>
  <a href="${url('/categories/')}"><b>${site.categories.length}</b><span>分类</span></a>
</div>`;
}

/** 页脚引语（站长可以改这里）。 */
export const FOOTER_QUOTE = '保持好奇，持续创作，在平凡的日子里，发现不平凡的美。';

export function footer(site: SiteData): string {
  const year = new Date().getFullYear();
  const first = site.posts.length ? ymd(pubDate(site.posts[site.posts.length - 1]!)).y : String(year);
  const col = (title: string, links: [string, string][]) => `<div class="footer__col"><h2>${title}</h2><ul>${links.map(([l, h]) => `<li><a href="${url(h)}">${l}</a></li>`).join('')}</ul></div>`;
  return `<footer class="footer">
  <div class="footer__art" aria-hidden="true"></div>
  <div class="wrap footer__inner">
    <div class="footer__about">
      ${brand(site, 'fbrand')}
      ${socialRow(site.profile, 'socials footer__social')}
      <div class="viewers js-viewers"><usa-avatar-stack max="5" size="26" class="viewers__stack"></usa-avatar-stack><span class="viewers__text">正在统计在线访客…</span></div>
      <p class="footer__copy">© ${first === String(year) ? year : `${first} – ${year}`} ${e(site.settings.siteTitle)} · 动效：<a href="https://github.com/HarrisonCN/Motionary" target="_blank" rel="noopener noreferrer">Motionary</a> · <a href="${url('/admin/')}" rel="nofollow">后台</a></p>
    </div>
    <nav class="footer__cols" aria-label="页脚导航">
      ${col('内容', [['最新文章', '/archives/'], ['热门标签', '/tags/'], ['专题合集', '/categories/'], ['作品集', '/works/'], ['搜索', '/search/']])}
      ${col('关于', [['关于我', '/about/'], ['此刻', '/now/'], ['时间线', '/timeline/'], ['留言与便签', '/guestbook/'], ['友链', '/links/']])}
      ${col('更多', [['RSS 订阅', '/subscribe/'], ['开源项目', '/opensource/'], ['更新日志', '/changelog/'], ['数据', '/stats/'], ['隐私说明', '/privacy/']])}
    </nav>
    <figure class="footer__quote"><blockquote>“${e(FOOTER_QUOTE)}”</blockquote><figcaption>—— ${e(site.profile.name)}</figcaption></figure>
  </div>
</footer>`;
}

// ---------------------------------------------------------------- 瓷砖
export type Size = 'xl' | 'l' | 'm' | 's' | 'full' | 'half' | 'third' | 'twothird' | 'quarter';
/** 一个 bento 瓷砖。size 决定在 12 列网格里的跨度；rows 决定行跨度。 */
export function tile(size: Size, body: string, o: { cls?: string; rows?: number; tag?: string; attrs?: string; label?: string; href?: string } = {}): string {
  const tag = o.href ? 'a' : (o.tag ?? 'section');
  const href = o.href ? ` href="${o.href}"` : '';
  return `<${tag} class="tile tile--${size}${o.rows ? ` tile--r${o.rows}` : ''} reveal${o.cls ? ` ${o.cls}` : ''}"${href}${o.label ? ` aria-label="${e(o.label)}"` : ''}${o.attrs ? ` ${o.attrs}` : ''}>${body}</${tag}>`;
}
export const kicker = (ic: string, text: string) => `<p class="tile__kicker">${icon(ic)}<span>${text}</span></p>`;
export const more = (href: string, text = '查看全部') => `<a class="tile__more" href="${href}">${text}${icon('arrowRight')}</a>`;
export const bento = (inner: string, cls = '', attrs = '') => `<div class="bento${cls ? ` ${cls}` : ''}"${attrs ? ` ${attrs}` : ''}>${inner}</div>`;

/** 页首瓷砖：大标题 + 副标题 + 可选背景图。 */
export function pageHead(title: string, sub = '', image?: string | null, extra = ''): string {
  return bento(
    tile('full', `${image ? `<div class="head-tile__bg"${bgStyle(image)}></div>` : ''}<div class="head-tile__body"><h1 class="head-tile__title" data-split>${e(title)}</h1>${sub ? `<p class="head-tile__sub">${sub}</p>` : ''}</div>${extra}`, {
      cls: `head-tile${image ? ' head-tile--img' : ''}`,
      tag: 'header',
    }),
    'bento--head',
  );
}

/** 站长徽章：珍珠母贝材质。 */
export function ownerBadge(): string {
  return `<usa-fx class="badge-fx" effect="pearlescent" trigger="load"><span class="badge badge--pearl" title="站长">站长</span></usa-fx>`;
}
/** 好朋友徽章：拉丝金属 / 珍珠母贝材质，刻有自定义编号（社交 ID）。 */
export function memberBadge(code: string, label: string, style: 'pearlescent' | 'brushed-metal' = 'brushed-metal', design?: unknown): string {
  // 新接口返回 design（DIY 设计，已在服务端校验；这里再宽松归一化一次）；旧接口 / 站长自己的 ID 徽章保持原来的材质
  if (design !== undefined) return badgeHtml(code, label, design, style);
  const cls = style === 'pearlescent' ? 'badge--pearl' : 'badge--metal';
  return `<usa-fx class="badge-fx" effect="${style}" trigger="load"><span class="badge ${cls}" title="${e(label)}"><span class="badge__code">${e(code)}</span></span></usa-fx>`;
}
/** 认证标记（站长） */
export const verifiedMark = () => `<span class="verified" role="img" aria-label="站长认证" title="站长认证">${icon('verified')}</span>`;

/**
 * 社交图标一排。带「社交 ID」（handle）的图标点开会弹出 ID 卡片（可复制、可打开主页）；
 * 没有 JS 时就是普通链接。
 */
export function socialRow(p: Profile, cls = 'socials'): string {
  const items = p.links
    .map((l) => {
      const href = safeHref(l.url);
      if (!href) return '';
      const ext = /^https?:/i.test(href);
      const handle = (l.handle ?? '').trim();
      const ic = SOCIAL_ICON[l.icon ?? 'link'] ?? 'link';
      return `<a class="soc${handle ? ' js-soc' : ''}" href="${e(href)}" title="${e(handle ? `${l.label}：${handle}` : l.label)}" aria-label="${e(handle ? `${l.label}（社交 ID：${handle}）` : l.label)}"${handle ? ` data-handle="${e(handle)}" data-label="${e(l.label)}" data-icon="${e(ic)}" aria-haspopup="dialog"` : ''}${ext ? ' target="_blank" rel="noopener noreferrer me"' : ''}>${icon(ic)}</a>`;
    })
    .join('');
  return items ? `<div class="${cls}">${items}</div>` : '';
}

/** 个人卡片数字：「文章」自动统计，其余来自资料里的 stats（示例数字可在后台修改）。 */
function profileStats(site: SiteData): [string, string][] {
  const own = (site.profile.stats ?? []).slice(0, 2).map((s) => [s.value, s.label] as [string, string]);
  return [[String(site.total), '文章'], ...(own.length ? own : ([[String(site.tags.length), '标签'], [String(site.categories.length), '分类']] as [string, string][]))];
}

/** 个人卡片（首页侧栏 / 关于页共用）：山景封面、圆形头像、认证标记、社交 ID 徽章、身份、简介、社交图标、数字。 */
export function profileCard(site: SiteData, size: Size = 'quarter', rows?: number): string {
  const p = site.profile;
  const role = p.role || '';
  return tile(
    size,
    `<div class="pc__cover" aria-hidden="true"></div>
  <div class="pc__avatar">${avatarImg(p, 'pc__img')}</div>
  <h2 class="pc__name"><span class="pc__name-text">${e(p.name)}</span>${verifiedMark()}</h2>
  ${role ? `<p class="pc__role">${e(role)}</p>` : ''}
  ${p.tagline ? `<p class="pc__bio">${e(p.tagline)}</p>` : ''}
  <p class="pc__ids">${ownerBadge()}${memberBadge('ID·0001', '站长社交 ID', 'brushed-metal')}</p>
  ${socialRow(p, 'socials pc__social')}
  <div class="pc__stats">${profileStats(site)
    .map(([v, l]) => `<div><b>${e(v)}</b><span>${e(l)}</span></div>`)
    .join('')}</div>`,
    { cls: 'profile-card', rows, label: '个人卡片', tag: 'section' },
  );
}

export function tagCloud(tags: TagCount[], max = 40): string {
  if (!tags.length) return '<p class="empty">暂无标签。</p>';
  const top = Math.max(...tags.map((t) => t.count));
  return `<div class="tag-cloud">${tags
    .slice(0, max)
    .map((t) => {
      const w = top > 1 ? (t.count - 1) / (top - 1) : 0;
      return `<a href="${tagPath(t.tag)}" class="tag-pill" style="--h:${hashHue(t.tag)};--w:${w.toFixed(2)}">${e(t.tag)}<sup>${t.count}</sup></a>`;
    })
    .join('')}</div>`;
}

function categoryList(cats: CategoryCount[]): string {
  if (!cats.length) return '<p class="empty">暂无分类。</p>';
  return `<ul class="cat-list">${cats.map((c) => `<li><a href="${categoryPath(c.category)}"><span>${e(c.category)}</span><b>${c.count}</b></a></li>`).join('')}</ul>`;
}

function postMeta(p: PostSummary, opts: { updated?: boolean } = {}): string {
  const date = pubDate(p);
  const showUpd = opts.updated !== false && p.updatedAt && formatDate(p.updatedAt) !== formatDate(date);
  return `<div class="post-meta">
  ${p.pinned ? `<span class="post-meta__pin">${icon('pin')}置顶</span>` : ''}
  <span>${icon('calendar')}发表于 <time datetime="${e(date)}">${formatDate(date)}</time></span>
  ${showUpd ? `<span class="post-meta__upd">${icon('history')}更新于 <time datetime="${e(p.updatedAt)}">${formatDate(p.updatedAt)}</time></span>` : ''}
  ${p.category ? `<span>${icon('folder')}<a href="${categoryPath(p.category)}">${e(p.category)}</a></span>` : ''}
  ${p.tags.length ? `<span class="post-meta__tags">${icon('tag')}${p.tags.map((t) => `<a href="${tagPath(t)}">${e(t)}</a>`).join('<i>·</i>')}</span>` : ''}
</div>`;
}

/** 文章瓷砖：封面 + 标题 + 摘要。big 时为大瓷砖（封面铺满，文字压在渐变上）。 */
export function postCard(p: PostSummary, i: number, size: Size = 'third', big = false, rows?: number, featured = false): string {
  const cover = img(p.coverUrl, p.title, 'post-tile__img', { sizes: big ? '(max-width: 768px) 100vw, 640px' : '(max-width: 768px) 100vw, 400px', eager: i === 0 && big });
  const body = `<usa-spatial-card class="post-tile__spatial" max="6"><a class="post-tile__link" href="${postPath(p.slug)}">
  <span class="post-tile__cover" data-depth="1">${cover || `<span class="post-tile__ph" style="--h:${hashHue(p.slug)}">${icon('file')}</span>`}</span>
  <span class="post-tile__info" data-depth="2">
    <span class="post-tile__chips">${p.kind === 'essay' ? `<span class="chip chip--accent">${icon('aperture')}影集</span>` : ''}${featured ? `<span class="chip chip--accent">${icon('star')}精选</span>` : ''}${p.pinned ? `<span class="chip chip--accent">${icon('pin')}置顶</span>` : ''}${p.category ? `<span class="chip">${e(p.category)}</span>` : ''}<span class="chip chip--ghost">${formatDate(pubDate(p))}</span></span>
    <span class="post-tile__title">${e(p.title)}</span>
    ${p.summary ? `<span class="post-tile__excerpt">${e(p.summary)}</span>` : ''}
    <span class="post-tile__foot">${icon('clock')}${readingMinutes(p.wordCount || 0)} 分钟 · ${formatCount(p.wordCount || 0)} 字${p.tags.length ? ` · ${p.tags.slice(0, 3).map((t) => `#${e(t)}`).join(' ')}` : ''}</span>
  </span></a></usa-spatial-card>`;
  return tile(size, body, { cls: `post-tile post-card${big ? ' post-tile--big' : ''}${p.coverUrl ? '' : ' post-tile--nocover'}`, rows: big ? 2 : rows, tag: 'article' });
}

function pagination(page: number, pages: number): string {
  if (pages <= 1) return '';
  const nums: string[] = [];
  for (let n = 1; n <= pages; n++) nums.push(n === page ? `<span class="pager__num" aria-current="page">${n}</span>` : `<a class="pager__num" href="${pagePath(n)}">${n}</a>`);
  return `<nav class="pager" aria-label="分页">
  <usa-pagination total="${pages}" page="${page}" siblings="1" class="pager__usa"></usa-pagination>
  <div class="pager__fallback">${page > 1 ? `<a class="pager__num" href="${pagePath(page - 1)}" aria-label="上一页">${icon('chevronLeft')}</a>` : ''}${nums.join('')}${page < pages ? `<a class="pager__num" href="${pagePath(page + 1)}" aria-label="下一页">${icon('chevronRight')}</a>` : ''}</div>
</nav>`;
}

// ---------------------------------------------------------------- 页面
export function shell(site: SiteData, route: Route, o: Partial<Page> & { title: string }): Page {
  const t = o.title === site.settings.siteTitle ? o.title : `${o.title} | ${site.settings.siteTitle}`;
  return {
    title: t,
    description: o.description ?? site.settings.siteDescription,
    route,
    top: o.top ?? pageHead(o.title, '', site.settings.heroImage),
    main: o.main ?? '',
    aside: o.aside ?? '',
    kind: o.kind ?? `page--${route.name}`,
  };
}

// ---------------------------------------------------------------- 首页（双栏：内容 + 侧栏）
/** 分类 / 标签的颜色（固定几种常用分类，其余按名字散列）。 */
const TONES = ['blue', 'green', 'orange', 'purple', 'pink', 'teal'] as const;
const TONE_OF: Record<string, (typeof TONES)[number]> = {
  摄影: 'blue', 旅行: 'pink', 随笔: 'green', 生活: 'green', 前端: 'purple', 技术: 'purple', 动效: 'purple', 产品: 'orange', AI: 'orange', 器材: 'teal', 设计: 'green',
};
export function tone(name: string): (typeof TONES)[number] {
  return TONE_OF[name] ?? TONES[hashHue(name) % TONES.length]!;
}
/** 彩色分类小标签。inLink=true 时输出 span（外层已经是链接）。 */
export function catChip(name: string, cls = '', inLink = false): string {
  const c = `cchip cchip--${tone(name)}${cls ? ` ${cls}` : ''}`;
  return inLink ? `<span class="${c}">${e(name)}</span>` : `<a class="${c}" href="${categoryPath(name)}">${e(name)}</a>`;
}
/** 本地收藏（书签）按钮：只存在访客自己的浏览器里。 */
export function bookmarkBtn(p: PostSummary): string {
  return `<button class="bm js-bookmark" type="button" data-slug="${e(p.slug)}" aria-pressed="false" aria-label="收藏《${e(p.title)}》" title="收藏到本机">${icon('bookmark')}</button>`;
}
function metaBits(p: PostSummary): string {
  const d = pubDate(p);
  return `<time datetime="${e(d)}">${formatDate(d)}</time><span class="meta-read" title="预计阅读时长">${icon('clock')}${readingMinutes(p.wordCount || 0)} 分钟</span>`;
}
/** 区块标题：图标 + 标题 + 副标题 + 「查看更多」。 */
export function secHead(ic: string, title: string, sub: string, moreHref?: string, id?: string): string {
  return `<header class="sec-head"><h2 class="sec-head__title"${id ? ` id="${id}"` : ''}>${icon(ic, `sec-head__ic sec-head__ic--${ic}`)}<span>${title}</span></h2>${sub ? `<span class="sec-head__sub">${sub}</span>` : ''}${moreHref ? `<a class="more-pill" href="${moreHref}">查看更多${icon('arrowRight')}</a>` : ''}</header>`;
}
const pad2 = (n: number) => String(n).padStart(2, '0');

/** 首图轮播：大图、分类、衬线大标题、摘要、阅读全文；圆点、计数、左右箭头、暂停。自动播放尊重「减少动态效果」。 */
export function heroCarousel(posts: PostSummary[]): string {
  if (!posts.length) return '';
  const n = posts.length;
  const slides = posts
    .map(
      (p, i) => `<article class="slide${i === 0 ? ' is-active' : ''}" id="slide-${i}" aria-roledescription="slide" aria-label="第 ${i + 1} / ${n} 张"${i ? ' aria-hidden="true" inert' : ''}>
    ${img(p.coverUrl, p.title, 'slide__img', { sizes: '(max-width: 900px) 100vw, 860px', eager: i === 0 })}
    <div class="slide__body">
      ${p.category ? catChip(p.category, 'cchip--glass') : ''}
      <h2 class="slide__title"><a href="${postPath(p.slug)}">${e(p.title)}</a></h2>
      ${p.summary ? `<p class="slide__excerpt">${e(p.summary)}</p>` : ''}
      <a class="btn btn--white slide__cta" href="${postPath(p.slug)}" tabindex="${i ? '-1' : '0'}">阅读全文${icon('arrowRight')}</a>
    </div>
  </article>`,
    )
    .join('');
  const dots = posts.map((p, i) => `<button class="carousel__dot js-car-dot" type="button" data-i="${i}" aria-label="第 ${i + 1} 张：${e(p.title)}"${i === 0 ? ' aria-current="true"' : ''}></button>`).join('');
  return `<section class="carousel js-carousel" aria-roledescription="carousel" aria-label="头条文章" data-count="${n}">
  <div class="carousel__track" aria-live="off">${slides}</div>
  ${n > 1 ? `<div class="carousel__dots" role="group" aria-label="选择头条">${dots}</div>
  <div class="carousel__ctrl">
    <span class="carousel__count"><b class="js-car-i">01</b> / ${pad2(n)}</span>
    <button class="carousel__btn js-car-pause" type="button" aria-label="暂停自动播放" aria-pressed="false">${icon('pause', 'only-play')}${icon('play', 'only-paused')}</button>
    <button class="carousel__btn js-car-prev" type="button" aria-label="上一张">${icon('chevronLeft')}</button>
    <button class="carousel__btn js-car-next" type="button" aria-label="下一张">${icon('chevronRight')}</button>
  </div>` : ''}
</section>`;
}

/** 精选文章卡片：封面 + 彩色分类 + 标题 + 摘要 + 日期 / 阅读时长 + 收藏。 */
export function featureCard(p: PostSummary): string {
  return `<article class="fcard reveal">
  <a class="fcard__media" href="${postPath(p.slug)}" tabindex="-1" aria-hidden="true">${img(p.coverUrl, '', 'fcard__img', { sizes: '(max-width: 700px) 100vw, 300px' }) || `<span class="ph" style="--h:${hashHue(p.slug)}">${icon('file')}</span>`}</a>
  ${p.category ? catChip(p.category, 'fcard__chip') : ''}
  <h3 class="fcard__title"><a href="${postPath(p.slug)}">${e(p.title)}</a></h3>
  ${p.summary ? `<p class="fcard__excerpt">${e(p.summary)}</p>` : ''}
  <div class="fcard__meta">${metaBits(p)}${bookmarkBtn(p)}</div>
</article>`;
}

/** 最新文章一行：缩略图 + 标题 + 摘要 + 彩色标签 + 日期 / 阅读时长 + 收藏。 */
export function postRow(p: PostSummary): string {
  const label = p.category ?? p.tags[0];
  return `<article class="lrow post-card reveal">
  <a class="lrow__thumb" href="${postPath(p.slug)}" tabindex="-1" aria-hidden="true">${img(p.coverUrl, '', 'lrow__img', { sizes: '180px' }) || `<span class="ph" style="--h:${hashHue(p.slug)}">${icon('file')}</span>`}</a>
  <div class="lrow__body">
    <h3 class="lrow__title">${p.pinned ? `<span class="pin-flag">${icon('pin')}置顶</span>` : ''}<a href="${postPath(p.slug)}">${e(p.title)}</a></h3>
    ${p.summary ? `<p class="lrow__excerpt">${e(p.summary)}</p>` : ''}
    <div class="lrow__meta">${label ? (p.category ? catChip(label) : `<a class="cchip cchip--${tone(label)}" href="${tagPath(label)}">${e(label)}</a>`) : ''}${metaBits(p)}</div>
  </div>
  ${bookmarkBtn(p)}
</article>`;
}

function featuredPanel(list: PostSummary[]): string {
  if (!list.length) return '';
  return `<section class="panel panel--featured" aria-labelledby="h-featured">${secHead('flame', '精选文章', '记录真实的生活，分享有温度的创作', url('/archives/'), 'h-featured')}
  <div class="fgrid">${list.map(featureCard).join('')}</div></section>`;
}

function latestPanel(list: PostSummary[], page: number, pages: number, total: number): string {
  return `<section class="panel panel--latest js-paged" aria-labelledby="h-latest">${secHead('clock', page > 1 ? `最新文章 · 第 ${page} 页` : '最新文章', page > 1 ? `全部 ${total} 篇` : '持续更新创作与思考', url('/archives/'), 'h-latest')}
  <div class="llist" id="latest-list">${listRows(list)}</div>
  ${pagination(page, pages)}</section>`;
}
const listRows = (list: PostSummary[]) => (list.length ? list.map(postRow).join('') : '<p class="empty">还没有文章。</p>');

/** 栏目内翻页用：只取「最新文章」这一栏需要替换的部分（标题、副标题、列表、分页条、页面标题）。 */
export function latestParts(site: SiteData, page: number): { page: number; pages: number; title: string; sub: string; rows: string; pager: string; docTitle: string } | null {
  const per = Math.max(1, site.settings.postsPerPage);
  const pages = Math.max(1, Math.ceil(site.posts.length / per));
  if (!Number.isInteger(page) || page < 1 || page > pages) return null;
  const list = site.posts.slice((page - 1) * per, page * per);
  const t = site.settings.siteTitle;
  return {
    page,
    pages,
    title: page > 1 ? `最新文章 · 第 ${page} 页` : '最新文章',
    sub: page > 1 ? `全部 ${site.total} 篇` : '持续更新创作与思考',
    rows: listRows(list),
    pager: pagination(page, pages),
    docTitle: page > 1 ? `第 ${page} 页 | ${t}` : t,
  };
}

/** 侧栏卡片外壳 */
/** 表情回应条：计数由浏览器端拉取；旧 Worker 没有接口时整条隐藏。 */
export function reactionsBar(slug: string): string {
  return `<div class="reactions js-reactions" data-slug="${e(slug)}" role="group" aria-label="表情回应"><span class="reactions__label">${icon('sparkles')}留下你的回应</span><div class="reactions__list">${REACTIONS.map(
    (r) => `<button class="react" type="button" data-emoji="${r.emoji}" aria-pressed="false" aria-label="${r.label}" title="${r.label}"><span class="react__e" aria-hidden="true">${r.emoji}</span><span class="react__n" aria-hidden="true"></span></button>`,
  ).join('')}</div></div>`;
}

/** 继续阅读：内容来自访客本机的阅读记录（localStorage），没有记录时不显示。 */
export function continueCard(): string {
  return `<section class="side-card continue-card js-continue" hidden aria-labelledby="continue-h">${secHead('history', '继续阅读', '', undefined, 'continue-h')}<ul class="continue-list"></ul><button class="link-btn js-continue-clear" type="button">清除阅读记录</button></section>`;
}

function sideCard(cls: string, body: string, label: string): string {
  return `<section class="side-card ${cls} reveal" aria-label="${e(label)}">${body}</section>`;
}

/** 订阅：邮箱 → 「成为好朋友」（邮箱验证码）；也给出 RSS / JSON Feed。纯静态，没有假的后端。 */
/** L17 首页的发现入口：静态链接（不加载社交代码），不需要关注任何人就能逛到话题、作品、创作者和摄影活动。 */
export function discoverCard(): string {
  const topics: [string, string][] = [['photography', '摄影'], ['coding', '编程'], ['hardware', '硬件'], ['modeling', '建模'], ['design', '设计'], ['daily', '日常']];
  return sideCard(
    'disc-card',
    `${secHead('sparkles', '社区发现', '', url('/discover/'))}<p class="muted small">不用先关注谁：从话题、精选创作者和摄影活动开始逛。</p><nav class="pills" aria-label="社区话题">${topics.map(([s, n]) => `<a class="pill" href="${url(`/t/${s}/`)}">${n}</a>`).join('')}<a class="pill" href="${url('/events/')}">${icon('camera')}摄影活动</a></nav>`,
    '社区发现',
  );
}
export function subscribeCard(): string {
  return sideCard(
    'sub-card',
    `<div class="sub-card__head"><span class="sub-card__ic">${icon('send')}</span><div><h2>订阅我的更新</h2><p>每周分享摄影、创作与生活思考。</p></div></div>
  <form class="sub-form js-sub-form" action="${url('/join/')}" method="get" novalidate>
    <label class="sub-form__field">${icon('mail')}<span class="visually-hidden">邮箱地址</span><input type="email" name="email" placeholder="输入你的邮箱地址" autocomplete="email" maxlength="120" required></label>
    <button class="btn btn--primary btn--block" type="submit">${icon('send')}<span>立即订阅</span></button>
  </form>
  <p class="sub-card__alt">邮箱订阅会带你去「成为好朋友」，用验证码确认邮箱；也可以用 <a href="${url('/rss.xml')}">RSS</a> 或 <a href="${url('/feed.json')}">JSON Feed</a> 订阅。</p>`,
    '订阅我的更新',
  );
}

/** 热门文章：没有阅读量统计，按站长的「精选」顺序、置顶、新旧排序。 */
export function hotPosts(site: SiteData, n = 5): PostSummary[] {
  const rank = new Map(site.settings.featuredSlugs.map((s, i) => [s, i]));
  return [...site.posts]
    .sort((a, b) => (rank.get(a.slug) ?? 99) - (rank.get(b.slug) ?? 99) || Number(b.pinned) - Number(a.pinned) || (pubDate(b) > pubDate(a) ? 1 : -1))
    .slice(0, n);
}
function hotCard(site: SiteData): string {
  const list = hotPosts(site);
  if (!list.length) return '';
  return sideCard(
    'hot-card',
    `${secHead('flame', '热门文章', '', url('/archives/'))}<ol class="hot">${list
      .map(
        (p, i) => `<li><a class="hot__item" href="${postPath(p.slug)}"><span class="hot__n hot__n--${i + 1}">${i + 1}</span><span class="hot__text"><b>${e(p.title)}</b>${p.summary ? `<span class="hot__sum">${e(p.summary)}</span>` : ''}<time datetime="${e(pubDate(p))}">${formatDate(pubDate(p))}</time></span>${img(p.coverUrl, '', 'hot__img', { sizes: '64px' })}</a></li>`,
      )
      .join('')}</ol>`,
    '热门文章',
  );
}
function tagsCard(site: SiteData): string {
  const tags = [...site.tags].sort((a, b) => b.count - a.count).slice(0, 10);
  if (!tags.length) return '';
  return sideCard(
    'tags-card',
    `${secHead('tag', '热门标签', '', url('/tags/'))}<div class="pills">${tags.map((t, i) => `<a class="pill${i === 0 ? ' pill--on' : ''}" href="${tagPath(t.tag)}">${e(t.tag)} <span>(${t.count})</span></a>`).join('')}</div>`,
    '热门标签',
  );
}
/** 访客便签：首页侧栏展示最近几张，点进留言板可以贴新的。 */
function notesCard(notes: StickyNote[]): string {
  const list = notes.filter((n) => !n.hidden).slice(-4).reverse();
  return sideCard(
    'notes-card',
    `${secHead('pin', '访客便签', '', url('/guestbook/#wall'))}${
      list.length
        ? `<ul class="notes-mini">${list.map((n, i) => `<li class="note note--${e(n.color)}" style="--r:${[-2, 1.5, -1, 2][i % 4]}deg"><p>${noteTextHtml(n.content, n.style, n.color)}</p><small>— ${e(n.name)}</small></li>`).join('')}</ul>`
        : '<p class="empty">还没有便签，来贴第一张吧。</p>'
    }<a class="btn btn--soft btn--block" href="${url('/guestbook/#wall')}">${icon('plus')}贴一张便签</a>`,
    '访客便签',
  );
}
function announceCard(site: SiteData): string {
  if (!site.settings.sections.announcement || !site.settings.announcement) return '';
  return sideCard('announce-card widget--announce', `${secHead('megaphone', '公告', '')}<div class="prose prose--sm">${md(site.settings.announcement)}</div>`, '公告');
}

/** 节日卡片：只在节日期间出现（festivals 表里配置的日期范围）。 */
export function festivalTile(list: Festival[] | undefined, now = new Date()): string {
  const f = list?.length ? activeFestival(list, now) : null;
  if (!f) return '';
  return `<section class="side-card fest-tile fest-tile--on reveal" data-festival="${e(f.id)}" aria-label="${e(f.name)}">
  ${secHead('sparkles', '今天是节日', '')}
  <usa-festival-banner theme="${e(f.theme)}" label="${e(f.name)}" class="festival festival--tile">${festivalText(f)}</usa-festival-banner>
  <div class="fest__row"><b class="fest__name">${e(f.name)}</b><span class="fest__days">快乐！</span></div>
  <usa-click effect="confetti" class="fest__click"><button class="btn btn--sm btn--soft" type="button">${icon('sparkles')}撒花庆祝</button></usa-click>
</section>`;
}

export function homePage(site: SiteData, page = 1, x: Extra = {}): Page {
  const per = Math.max(1, site.settings.postsPerPage);
  const pages = Math.max(1, Math.ceil(site.posts.length / per));
  const list = site.posts.slice((page - 1) * per, page * per);
  const s = site.settings;
  const featured = s.sections.featured ? (s.featuredSlugs.map((slug) => site.posts.find((p) => p.slug === slug)).filter(Boolean) as PostSummary[]).slice(0, 3) : [];
  const fset = new Set(featured.map((p) => p.slug));
  const slides = [...site.posts.filter((p) => p.pinned), ...site.posts.filter((p) => !p.pinned)].filter((p) => p.coverUrl && !fset.has(p.slug)).slice(0, 5);
  const side = page === 1
    ? [
        s.sections.about ? profileCard(site, 'full') : '',
        continueCard(),
        discoverCard(),
        dailyPhotoCard(x.works ?? []),
        subscribeCard(),
        festivalTile(site.festivals),
        s.sections.latest ? hotCard(site) : '',
        s.sections.tags ? tagsCard(site) : '',
        notesCard(x.notes ?? []),
        announceCard(site),
      ].join('')
    : [subscribeCard(), s.sections.tags ? tagsCard(site) : ''].join('');
  const mainCol = page === 1
    ? `${s.sections.hero ? heroCarousel(slides) : ''}${featuredPanel(featured)}${s.sections.postList ? latestPanel(list, page, pages, site.total) : ''}${homeSections(site, x)}`
    : latestPanel(list, page, pages, site.total);
  return shell(site, { name: 'home', page }, {
    title: page > 1 ? `第 ${page} 页` : s.siteTitle,
    description: s.siteDescription,
    top: '',
    main: `<h1 class="visually-hidden">${e(s.siteTitle)}${page > 1 ? ` · 第 ${page} 页` : ''}</h1><div class="home" id="content"><div class="home__main">${mainCol}</div><aside class="home__side" aria-label="侧栏">${side}</aside></div>`,
    kind: page > 1 ? 'page--home page--list' : 'page--home',
  });
}


// ---------------------------------------------------------------- 文章工具：阅读设置 / 朗读 / 系列 / 评论
/** 文章顶部工具条：阅读设置（字号、行距、字体、宽度、护眼）+ 朗读（不支持 Web Speech 时整组隐藏）。 */
export function postTools(): string {
  const seg = (name: string, label: string, opts: [string, string][]) =>
    `<fieldset class="rs__fs"><legend>${label}</legend><div class="rs__seg">${opts.map(([v, l]) => `<label class="rs__opt"><input type="radio" name="rs-${name}" value="${v}" data-rs="${name}"><span>${l}</span></label>`).join('')}</div></fieldset>`;
  return `<div class="post-tools" role="toolbar" aria-label="阅读工具">
  <button class="pt-btn js-rs-toggle" type="button" aria-expanded="false" aria-controls="rs-panel">${icon('settings')}<span>阅读设置</span></button>
  <div class="tts js-tts" hidden role="group" aria-label="朗读"><button class="pt-btn js-tts-play" type="button" aria-pressed="false">${icon('play', 'tts__ic-play')}${icon('pause', 'tts__ic-pause')}<span class="js-tts-label">朗读全文</span></button><button class="pt-btn pt-btn--icon js-tts-stop" type="button" aria-label="停止朗读" disabled>${icon('close')}</button><label class="tts__rate">语速 <select class="js-tts-rate"><option value="0.8">0.8×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><span class="tts__status js-tts-status muted small" aria-live="polite"></span></div>
  <div class="rs-panel" id="rs-panel" hidden role="group" aria-label="阅读设置">
    ${seg('size', '字号', [['s', '小'], ['m', '中'], ['l', '大'], ['xl', '特大']])}
    ${seg('lh', '行距', [['tight', '紧凑'], ['normal', '适中'], ['loose', '宽松']])}
    ${seg('font', '字体', [['sans', '黑体'], ['serif', '宋体']])}
    ${seg('width', '版心', [['narrow', '窄'], ['normal', '标准'], ['wide', '宽']])}
    ${seg('theme', '主题', [['default', '默认'], ['sepia', '护眼']])}
    <button class="link-btn js-rs-reset" type="button">恢复默认</button>
  </div>
</div>`;
}

/** 系列连载：进度条 + 全部篇目 + 系列内上一篇 / 下一篇。 */
export function seriesNav(s: { name: string; posts: PostSummary[]; index: number; prev: PostSummary | null; next: PostSummary | null }, slug: string): string {
  const n = s.posts.length;
  const pct = Math.round(((s.index + 1) / n) * 100);
  return `<nav class="series-nav" aria-label="系列连载：${e(s.name)}">
  <p class="series-nav__kicker">${icon('list')}<span>系列连载 · <b>${e(s.name)}</b></span><span class="series-nav__pos">第 ${s.index + 1} / ${n} 篇</span></p>
  <div class="series-nav__bar" role="progressbar" aria-label="系列阅读进度" aria-valuemin="1" aria-valuemax="${n}" aria-valuenow="${s.index + 1}" aria-valuetext="第 ${s.index + 1} 篇，共 ${n} 篇"><span style="width:${pct}%"></span></div>
  <ol class="series-nav__list">${s.posts.map((p, i) => (p.slug === slug ? `<li class="is-current" aria-current="page"><span class="series-nav__n">${i + 1}</span><span>${e(p.title)}</span></li>` : `<li><span class="series-nav__n">${i + 1}</span><a href="${postPath(p.slug)}">${e(p.title)}</a></li>`)).join('')}</ol>
  <div class="series-nav__pn">${s.prev ? `<a class="series-nav__a series-nav__a--prev" href="${postPath(s.prev.slug)}" rel="prev">${icon('arrowLeft')}<span><small>系列上一篇</small>${e(s.prev.title)}</span></a>` : '<span></span>'}${s.next ? `<a class="series-nav__a series-nav__a--next" href="${postPath(s.next.slug)}" rel="next"><span><small>系列下一篇</small>${e(s.next.title)}</span>${icon('arrowRight')}</a>` : '<span class="series-nav__done muted small">已经是系列最新一篇</span>'}</div>
</nav>`;
}

/** 评论区外壳：列表由浏览器端拉取（comments-client.ts）；表单带蜜罐字段。旧 Worker 没有评论接口时整块隐藏。 */
export function commentsSection(slug: string): string {
  return `<section class="tile tile--full pcomments js-comments reveal" id="comments" data-slug="${e(slug)}" aria-labelledby="h-comments">
  <h2 class="pcomments__h" id="h-comments">${icon('message')}评论 <span class="pcomments__n js-c-count"></span></h2>
  <form class="c-form js-c-form" novalidate>
    <div class="c-form__row"><label class="c-field"><span>昵称</span><input name="name" maxlength="30" required autocomplete="nickname" class="js-c-name"></label><span class="c-form__me js-c-me muted small" hidden></span></div>
    <label class="c-field"><span>说点什么</span><textarea name="content" rows="3" maxlength="1000" required class="js-c-content"></textarea></label>
    <div class="c-hp" aria-hidden="true"><label>主页<input name="homepage" tabindex="-1" autocomplete="off"></label></div>
    <div class="c-form__foot"><span class="muted small">支持 <code>**粗体**</code> <code>*斜体*</code> <code>\`代码\`</code> <code>[链接](https://…)</code> <code>&gt; 引用</code>；访客评论审核后显示。</span><button class="btn btn--primary btn--sm" type="submit">${icon('send')}发表评论</button></div>
    <p class="c-form__msg js-c-msg" role="status" aria-live="polite"></p>
  </form>
  <div class="c-list js-c-list"><p class="muted">评论加载中…</p></div>
</section>`;
}

/** 首页侧栏：每日一图（按日期轮换的作品，同一天所有人看到同一张）。 */
export function dailyPhotoCard(works: Work[], now = new Date()): string {
  const w = dailyWork(works, now);
  if (!w) return '';
  const day = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric' }).format(now);
  const exif = [w.focal, w.aperture, w.shutter, w.iso ? `ISO ${w.iso}` : ''].filter(Boolean).join(' · ');
  return sideCard(
    'daily-card js-daily',
    `${secHead('image', '每日一图', day)}<a class="daily-card__img" href="${url('/works/')}#${e(w.id)}">${img(w.url, w.title, 'daily-card__photo', { sizes: '320px', w: w.width || undefined, h: w.height || undefined })}</a>
<p class="daily-card__t"><b>${e(w.title)}</b>${w.location ? `<span class="muted small">${icon('mapPin')}${e(w.location)}</span>` : ''}</p>${exif ? `<p class="daily-card__exif small">${e(exif)}</p>` : ''}<a class="tile__more" href="${url('/map/')}">在照片地图上看${icon('arrowRight')}</a>`,
    '每日一图',
  );
}

/** 照片地图：内置点阵世界地图 + 作品点位（只有作品自己选择公开、坐标粗化到 0.1°）。 */
export function mapPage(site: SiteData, works: Work[]): Page {
  const pts = mapPoints(works);
  const hidden = works.length - pts.reduce((s, p) => s + p.works.length, 0);
  const fmt = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? pos : neg}`;
  const pins = pts
    .map((p, i) => {
      const { x, y } = project(p.lat, p.lng);
      const t = `${p.works.map((w) => w.title).join('、')} · ${p.works[0]!.location || ''}`;
      return `<a class="pmap__pin" href="#pm-${i}" data-pin="${i}" aria-label="${e(`${t}（${p.works.length} 张）`)}"><title>${e(t)}</title><circle class="pmap__halo" cx="${x}" cy="${y}" r="5"></circle><circle class="pmap__dot" cx="${x}" cy="${y}" r="2.6"></circle></a>`;
    })
    .join('');
  const svg = `<svg class="pmap__svg" viewBox="0 0 360 144" role="group" aria-label="世界地图上的作品点位（${pts.length} 处）" preserveAspectRatio="xMidYMid meet"><path class="pmap__land" d="${dotsPath()}"></path>${pins}</svg>`;
  const list = pts
    .map((p, i) => `<li class="pmap__item" id="pm-${i}" tabindex="-1">${p.works.map((w) => `<a class="pmap__card" href="${url('/works/')}#${e(w.id)}">${img(w.url, w.title, 'pmap__img', { sizes: '96px' })}<span><b>${e(w.title)}</b><small>${e(w.location || '未标注地点')}</small><small class="pmap__coord">约 ${fmt(p.lat, 'N', 'S')}，${fmt(p.lng, 'E', 'W')}</small></span></a>`).join('')}</li>`)
    .join('');
  return shell(site, { name: 'map' }, {
    title: '照片地图',
    description: '作品拍摄地点（粗略位置，作者逐张选择公开）',
    top: pageHead('照片地图', `${pts.length} 个地点 · ${pts.reduce((s, p) => s + p.works.length, 0)} 张作品。只显示作者选择公开的作品，坐标粗化到约 11 公里；底图内置，不加载第三方地图。`),
    main: bento(
      `${tile('full', `<figure class="pmap">${svg}<figcaption class="muted small">点位是粗略位置（0.1°）。${hidden > 0 ? `另有 ${hidden} 张作品没有公开位置。` : ''}底图：Natural Earth（公有领域）。</figcaption></figure>`, { cls: 'pmap-tile' })}
${tile('full', pts.length ? `<ul class="pmap__list">${list}</ul>` : '<p class="empty">还没有公开位置的作品。在后台「作品集」里给作品填上坐标，并把「照片地图」设为公开。</p>', { cls: 'pmap-list-tile', label: '地点列表' })}`,
    ),
  });
}

/** 归档日历：年 × 12 个月的篇数，点击跳到那个月。 */
export function archiveCalendarTable(posts: PostSummary[]): string {
  const years = archiveCalendar(posts);
  if (!years.length) return '';
  const max = Math.max(1, ...years.flatMap((y) => y.months));
  const lvl = (n: number) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
  return `<table class="acal"><caption>${icon('calendar')}归档日历 <span class="muted small">按年月统计，点数字跳到那个月</span></caption><thead><tr><th scope="col">年份</th>${Array.from({ length: 12 }, (_, i) => `<th scope="col"><abbr title="${i + 1} 月">${i + 1}</abbr></th>`).join('')}<th scope="col">合计</th></tr></thead><tbody>${years
    .map((y) => `<tr><th scope="row"><a href="#y${y.year}">${y.year}</a></th>${y.months
      .map((n, i) => {
        const m = String(i + 1).padStart(2, '0');
        return `<td class="acal__c acal__c--${lvl(n)}">${n ? `<a href="#y${y.year}-${m}" aria-label="${y.year} 年 ${i + 1} 月：${n} 篇">${n}</a>` : '<span aria-label="0 篇">·</span>'}</td>`;
      })
      .join('')}<td class="acal__sum">${y.total}</td></tr>`)
    .join('')}</tbody></table>`;
}

/** 把正文按二级标题切成 <section data-chapter>，并生成目录。 */
export function chapterize(html: string): { html: string; toc: string; chapters: number } {
  const parts = html.split(/(?=<h2 id=")/);
  const heads: { id: string; text: string; level: number }[] = [];
  const re = /<h([23]) id="([^"]+)">([\s\S]*?)<\/h\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) heads.push({ level: Number(m[1]), id: m[2]!, text: m[3]!.replace(/<[^>]*>/g, '') });
  let chapters = 0;
  const out = parts
    .map((p) => {
      const h = /^<h2 id="([^"]+)">([\s\S]*?)<\/h2>/.exec(p);
      if (!h) return p;
      chapters++;
      return `<section class="chapter" data-chapter="${h[2]!.replace(/<[^>]*>/g, '')}">${p}</section>`;
    })
    .join('');
  const toc = heads.length
    ? `<ol class="toc">${heads.map((h) => `<li class="toc__item toc__item--${h.level}"><a href="#${h.id}">${h.text}</a></li>`).join('')}</ol>`
    : '';
  return { html: out, toc, chapters };
}

/** 影集：版式（单列全幅 / 双联 / 网格）+ 每张照片的图注、EXIF 条、署名和可折叠的拍摄手记；点照片进入故事模式。 */
export function essaySection(essay: Essay): string {
  const n = essay.photos.length;
  const items = essay.photos
    .map((p, i) => {
      const cap = p.caption || p.alt || `第 ${i + 1} 张`;
      const pic = img(p.src, p.alt || p.caption || `影集第 ${i + 1} 张`, 'essay__img', { sizes: essay.layout === 'single' ? '(max-width: 1100px) 100vw, 1100px' : essay.layout === 'diptych' ? '(max-width: 640px) 100vw, 560px' : '(max-width: 640px) 50vw, 380px', eager: i === 0, w: p.width || undefined, h: p.height || undefined });
      return `<li class="essay__item"><figure class="essay__fig"><button type="button" class="essay__open js-essay-open" data-i="${i}" aria-label="故事模式查看第 ${i + 1} 张：${e(cap)}">${pic}</button><figcaption class="essay__cap"><span class="essay__n" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><span class="essay__txt">${p.caption ? `<span class="essay__caption">${e(p.caption)}</span>` : ''}${exifStripHtml(p.exif)}${p.credit ? `<small class="essay__credit">署名：${e(p.credit)}</small>` : ''}</span></figcaption></figure>${shotNotesHtml(p.notes, `拍摄手记 · 第 ${i + 1} 张`)}</li>`;
    })
    .join('');
  return `<section class="essay essay--${essay.layout}" aria-label="影集：${n} 张照片" data-essay>
  <div class="essay__bar"><span class="essay__meta">${icon('aperture')}影集 · ${n} 张 · ${ESSAY_LAYOUT_LABEL[essay.layout]}</span><button type="button" class="btn btn--soft essay__story js-essay-story" data-i="0">${icon('play')}故事模式</button></div>
  <ol class="essay__list">${items}</ol>
</section>`;
}

export function postPage(site: SiteData, post: Post): Page {
  const { html, toc, chapters } = chapterize(md(post.contentMd));
  const essay = post.kind === 'essay' && post.essay?.photos.length ? post.essay : null;
  const idx = site.posts.findIndex((p) => p.slug === post.slug);
  const newer = idx > 0 ? site.posts[idx - 1] : undefined;
  const older = idx >= 0 ? site.posts[idx + 1] : undefined;
  const series = seriesOf(site.posts, post);
  const related = relatedPosts(site.posts, post, 3);
  const words = post.wordCount || plainText(post.contentMd, 1e9).length;
  const link = postPath(post.slug);
  const pn = (p: PostSummary | undefined, label: string, cls: string) =>
    p ? tile('half', `<div class="pn__bg"${bgStyle(p.coverUrl)}></div><span class="pn__label">${label}</span><span class="pn__title">${e(p.title)}</span>`, { cls: `pn ${cls}`, href: postPath(p.slug) }) : '';
  const top = bento(
    tile(
      'full',
      `<div class="head-tile__bg"${bgStyle(post.coverUrl ?? site.settings.heroImage)}></div>
  <div class="head-tile__body post-top">
    <p class="post-top__chips">${essay ? `<span class="chip chip--glass">${icon('aperture')}影集</span>` : ''}${post.category ? `<a class="chip chip--glass" href="${categoryPath(post.category)}">${icon('folder')}${e(post.category)}</a>` : ''}${post.status === 'draft' ? '<span class="chip chip--accent">草稿</span>' : ''}</p>
    <h1 class="head-tile__title post-top__title" data-split>${e(post.title)}</h1>
    ${postMeta(post)}
    <div class="post-meta post-meta--sub"><span>${icon('file')}字数总计：${formatCount(words)}</span><span>${icon('clock')}阅读时长：${readingMinutes(words)} 分钟</span></div>
  </div>`,
      { cls: 'head-tile head-tile--img head-tile--post', tag: 'header' },
    ),
    'bento--head',
  );
  const tocBody = toc
    ? `<usa-chapter-nav for="#post-body" orientation="vertical" label="文章目录" class="chapter-nav"${chapters ? '' : ' hidden'}></usa-chapter-nav>${toc}`
    : '<p class="empty">这篇文章没有小标题。</p>';
  const main = `<usa-scroll-progress target="#post" label="阅读进度" class="read-progress"></usa-scroll-progress>
<div class="post-layout${essay ? ' post-layout--essay' : ''}">
<article class="tile tile--full post reveal${essay ? ' post--essay' : ''}" id="post">
  ${postTools()}
  <usa-double-tap class="post__body" label="双击点赞">
    <div class="prose" id="post-body">${html}</div>
  </usa-double-tap>
  ${essay ? essaySection(essay) : ''}
  ${post.notes ? `<div class="post-notes">${shotNotesHtml(post.notes, essay ? '这组照片的拍摄手记' : '拍摄手记', true)}</div>` : ''}
  <div class="post__like"><usa-like class="js-like" data-slug="${e(post.slug)}" label="喜欢这篇文章"></usa-like><span class="post__like-hint">喜欢就点个赞，或在正文上双击 ❤</span></div>
  ${reactionsBar(post.slug)}
  ${series ? seriesNav(series, post.slug) : ''}
  <div class="copyright">
    <p><b>文章作者：</b><a href="${url('/about/')}">${e(site.profile.name)}</a></p>
    <p><b>文章链接：</b><a class="js-abs-link" href="${link}">${link}</a> <button class="copy-btn js-copy-link" type="button" aria-label="复制文章链接">${icon('copy')}</button></p>
    <p><b>版权声明：</b>本博客所有文章除特别声明外，均采用 <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans" target="_blank" rel="noopener noreferrer">CC BY-NC-SA 4.0</a> 许可协议。转载请注明来自 <a href="${url('/')}">${e(site.settings.siteTitle)}</a>！</p>
  </div>
  <div class="post__foot">
    <div class="post__tags">${post.tags.map((t) => `<a class="chip" href="${tagPath(t)}">${icon('tag')}${e(t)}</a>`).join('')}</div>
    <div class="post__share"><button class="icon-btn js-share" type="button" aria-label="分享">${icon('external')}</button></div>
  </div>
</article>
<aside class="post-side" aria-label="文章侧栏">
  <section class="tile tile--full toc-tile reveal">${kicker('list', '目录')}${tocBody}</section>
  <section class="tile tile--full author-tile reveal">${avatarImg(site.profile, 'author-tile__av')}<div><b>${e(site.profile.name)}</b> ${ownerBadge()}<p class="muted">${e(site.profile.tagline)}</p></div></section>
</aside>
</div>
${newer || older ? bento(`${pn(newer, '上一篇', 'pn--prev')}${pn(older, '下一篇', 'pn--next')}`, 'bento--pn') : ''}
${related.length ? `<h2 class="section-h reveal" id="h-related">${icon('heart')}相关推荐</h2>${bento(related.map((p, i) => postCard(p, i, 'third')).join(''), 'bento--posts')}` : ''}
${commentsSection(post.slug)}`;
  return shell(site, { name: 'post', slug: post.slug }, {
    title: post.title,
    description: post.summary || plainText(post.contentMd),
    top,
    main,
    kind: essay ? 'page--post page--essay' : 'page--post',
  });
}

export function archivesPage(site: SiteData): Page {
  const years = new Map<string, PostSummary[]>();
  for (const p of [...site.posts].sort((a, b) => (pubDate(a) < pubDate(b) ? 1 : -1))) {
    const { y } = ymd(pubDate(p));
    years.set(y, [...(years.get(y) ?? []), p]);
  }
  const first = site.posts.length ? formatDate(pubDate(site.posts[site.posts.length - 1]!)) : '';
  const last = site.posts.length ? formatDate(pubDate(site.posts[0]!)) : '';
  const head = bento(
    `${tile('twothird', `<div class="head-tile__body"><h1 class="head-tile__title" data-split>归档</h1><p class="head-tile__sub">全部 <b>${site.posts.length}</b> 篇文章，按时间排列。</p></div>`, { cls: 'head-tile', tag: 'header' })}
${tile('third', `${kicker('calendar', '按日期跳转')}<usa-date-picker id="archive-date" class="js-archive-date"${first ? ` min="${first}"` : ''}${last ? ` max="${last}" value="${last}"` : ''} first-day="1" locale="zh-CN" label="按日期跳转"></usa-date-picker>`, { cls: 'archive-filter' })}`,
    'bento--head',
  );
  const cal = archiveCalendarTable(site.posts);
  const seenMonth = new Set<string>();
  const main = (cal ? bento(tile('full', cal, { cls: 'acal-tile' }), 'bento--acal') : '') + bento(
    [...years]
      .map(
        ([y, list]) => tile(
          'full',
          `<div class="timeline__year" id="y${y}"><h2>${y}</h2><span class="muted">${list.length} 篇</span></div><div class="timeline">${list
            .map((p) => {
              const { m } = ymd(pubDate(p));
              const first = !seenMonth.has(`${y}-${m}`);
              seenMonth.add(`${y}-${m}`);
              return `<article class="timeline__item"${first ? ` id="y${y}-${m}"` : ''} data-date="${formatDate(pubDate(p))}">
  <a class="timeline__thumb" href="${postPath(p.slug)}" tabindex="-1" aria-hidden="true">${img(p.coverUrl, '', 'timeline__img', { sizes: '120px' }) || `<span class="mini-list__ph">${icon('file')}</span>`}</a>
  <div class="timeline__info"><time datetime="${e(pubDate(p))}">${formatDate(pubDate(p))}</time><a class="timeline__title" href="${postPath(p.slug)}">${e(p.title)}</a>${p.category ? `<span class="chip">${e(p.category)}</span>` : ''}</div>
</article>`;
            })
            .join('')}</div>`,
          { cls: 'year-tile' },
        ),
      )
      .join(''),
    'bento--archive',
  );
  return shell(site, { name: 'archives' }, { title: '归档', top: head, main, description: '全部文章的时间线' });
}

export function tagsPage(site: SiteData): Page {
  return shell(site, { name: 'tags' }, {
    title: '标签',
    description: '全部标签',
    top: pageHead('标签', `共 ${site.tags.length} 个标签`),
    main: bento(tile('full', tagCloud(site.tags, 200), { cls: 'tagcloud-tile' })),
  });
}

function listPage(site: SiteData, route: Route, title: string, list: PostSummary[], kindLabel: string): Page {
  return shell(site, route, {
    title,
    description: `${kindLabel}「${title}」下的文章`,
    top: pageHead(title, `${kindLabel} · ${list.length} 篇文章`, list[0]?.coverUrl),
    main: list.length ? bento(list.map((p, i) => postCard(p, i, 'third')).join(''), 'bento--posts') : bento(tile('full', `<p class="empty">这个${kindLabel}下还没有文章。</p>`)),
  });
}

export function tagPage(site: SiteData, tag: string): Page {
  return listPage(site, { name: 'tag', tag }, tag, site.posts.filter((p) => p.tags.includes(tag)), '标签');
}
export function categoryPage(site: SiteData, category: string): Page {
  return listPage(site, { name: 'category', category }, category, site.posts.filter((p) => p.category === category), '分类');
}

export function categoriesPage(site: SiteData): Page {
  const covers = (c: string) => site.posts.find((p) => p.category === c && p.coverUrl)?.coverUrl;
  return shell(site, { name: 'categories' }, {
    title: '分类',
    description: '全部分类',
    top: pageHead('分类', `共 ${site.categories.length} 个分类`),
    main: bento(
      site.categories
        .map((c, i) => tile(i === 0 ? 'half' : 'quarter', `<div class="cat-tile__bg"${bgStyle(covers(c.category))}></div><span class="cat-tile__name">${e(c.category)}</span><span class="cat-tile__count">${c.count} 篇</span>`, { cls: 'cat-tile', href: categoryPath(c.category) }))
        .join(''),
    ),
  });
}

export function galleryPage(site: SiteData, albums: Album[]): Page {
  const sizes: Size[] = ['twothird', 'third', 'third', 'third', 'third'];
  return shell(site, { name: 'gallery' }, {
    title: '画廊',
    description: '照片相册',
    top: pageHead('画廊', '用照片记录走过的地方', albums[0]?.cover),
    main: albums.length
      ? bento(
          albums
            .map((a, i) =>
              tile(sizes[i % sizes.length]!, `${img(a.cover || a.photos[0]?.url, a.title, 'album__img', { sizes: i === 0 ? '(max-width: 768px) 100vw, 800px' : '(max-width: 768px) 100vw, 400px' })}<span class="album__info"><span class="album__title">${e(a.title)}</span><span class="album__desc">${e(a.description)}</span><span class="album__count">${icon('image')}${a.photos.length} 张 · ${e(a.date)}</span></span>`, {
                cls: 'album',
                rows: 2,
                href: albumPath(a.slug),
              }),
            )
            .join(''),
          'bento--gallery',
        ) + galleryDeck(albums)
      : bento(tile('full', '<p class="empty">还没有相册。</p>')),
  });
}

/** 画廊页的「随手翻」瓷砖：照片做成可以左右滑走的卡片（usa-swipe-deck）。 */
function galleryDeck(albums: Album[]): string {
  const photos = albums.flatMap((a) => a.photos.map((p) => ({ ...p, album: a }))).slice(0, 8);
  if (!photos.length) return '';
  return `<h2 class="section-h reveal">${icon('shuffle')}随手翻翻</h2>${bento(
    `${tile('half', `${kicker('shuffle', '照片卡片')}<p class="muted">拖动卡片：向右「喜欢」，向左「跳过」；键盘用 ← / →。</p><usa-swipe-deck threshold="110" label="照片卡片" class="swipe swipe--photo js-photo-deck">${photos
      .map((p) => `<article class="swipe-card swipe-card--photo">${img(p.url, p.caption, 'swipe-card__img', { sizes: '(max-width: 768px) 90vw, 420px' })}<h3 class="swipe-card__t">${e(p.caption || p.album.title)}</h3><small>${e(p.album.title)}</small></article>`)
      .join('')}</usa-swipe-deck>`, { cls: 'swipe-tile', rows: 2 })}
${tile('half', `${kicker('heart', '你喜欢的照片')}<ul class="liked-list js-liked-photos"><li class="muted">右滑的照片会出现在这里。</li></ul><usa-button deform="squash" class="js-deck-undo"><button class="btn btn--ghost btn--sm" type="button">${icon('history')}撤销上一张</button></usa-button>`, { cls: 'liked-tile', rows: 2 })}`,
    'bento--deck',
  )}`;
}

export function albumPage(site: SiteData, album: Album | undefined, slug: string): Page {
  if (!album) return notFoundPage(site, { name: 'album', slug });
  return shell(site, { name: 'album', slug }, {
    title: album.title,
    description: album.description,
    top: pageHead(album.title, `${e(album.description)} · ${album.photos.length} 张`, album.cover || album.photos[0]?.url),
    main: `<div class="masonry">${album.photos
      .map(
        (p, i) => `<figure class="photo reveal"><usa-double-tap label="双击喜欢这张照片">${img(p.url, p.caption, 'photo__img', { sizes: '(max-width: 768px) 100vw, 33vw', w: p.width ? 1280 : undefined, h: p.width && p.height ? Math.round((1280 * p.height) / p.width) : undefined })}</usa-double-tap>
  <figcaption><span>${e(p.caption || `照片 ${i + 1}`)}</span>${p.credit ? `<small>${p.creditUrl && safeHref(p.creditUrl) ? `<a href="${e(safeHref(p.creditUrl)!)}" target="_blank" rel="noopener noreferrer">${e(p.credit)}</a>` : e(p.credit)}</small>` : ''}</figcaption></figure>`,
      )
      .join('')}</div>
<p class="back-link"><a class="btn btn--ghost" href="${url('/gallery/')}">${icon('arrowLeft')}返回画廊</a></p>`,
  });
}

export function favoritesPage(site: SiteData, favs: Favorite[], projects: Project[]): Page {
  const groups = new Map<string, Favorite[]>();
  for (const f of favs) groups.set(f.group || '其他', [...(groups.get(f.group || '其他') ?? []), f]);
  const proj = projects
    .map((p) =>
      tile('third', `<usa-plugin-card name="${e(p.name)}" title="${e(p.title)}" version="${e(p.version)}" author="${e(p.author)}" engine="${e(p.engine)}" downloads="${p.downloads}" class="project">
  <p>${e(p.description)}</p>${safeHref(p.url) ? `<a href="${e(safeHref(p.url)!)}" target="_blank" rel="noopener noreferrer">${icon('github')}查看仓库</a>` : ''}
</usa-plugin-card>`, { cls: 'project-tile' }),
    )
    .join('');
  const play = projects.length
    ? `${tile('half', `${kicker('sparkles', '动效预览')}<usa-spatial-card class="spatial"><h3 data-depth="2">同一套动效在手机上的感觉</h3>
  <usa-native-preview platform="ios" name="博客卡片" rules="enter: fade-up 500ms smooth stagger 80ms; click: pop"><div class="np-row">最新文章</div><div class="np-row">画廊</div><div class="np-row">留言板</div></usa-native-preview>
</usa-spatial-card>`, { cls: 'spatial-tile', rows: 2 })}
${tile('half', `${kicker('shuffle', '随手翻翻收藏')}<p class="muted">向右滑「想看」，向左滑「跳过」</p><usa-swipe-deck threshold="110" label="收藏卡片" class="swipe">${favs
        .slice(0, 6)
        .map((f) => `<article class="swipe-card"><h3 class="swipe-card__t">${e(f.title)}</h3><p>${e(f.description)}</p><small>${e(f.group)}</small></article>`)
        .join('')}</usa-swipe-deck>`, { cls: 'swipe-tile', rows: 2 })}`
    : '';
  return shell(site, { name: 'favorites' }, {
    title: '收藏与项目',
    description: '我的项目、常用网站与资源',
    top: pageHead('收藏与项目', `${projects.length} 个项目 · ${favs.length} 个收藏`),
    main: `${projects.length ? `<h2 class="section-h reveal">${icon('box')}我的项目</h2>${bento(proj + play)}` : ''}${[...groups]
      .map(
        ([g, list]) => `<h2 class="section-h reveal">${icon('star')}${e(g)}</h2>${bento(
          list
            .map((f) => {
              const href = safeHref(f.url);
              return tile('quarter', `<span class="fav__icon" style="--h:${hashHue(f.title)}">${e(f.title.slice(0, 1))}</span><span class="fav__text"><b>${e(f.title)}</b><small>${e(f.description)}</small></span>`, { cls: 'fav', tag: 'a', attrs: href ? `href="${e(href)}" target="_blank" rel="noopener noreferrer"` : '' });
            })
            .join(''),
        )}`,
      )
      .join('')}`,
  });
}

export function linksPage(site: SiteData, friends: Friend[], members: PublicMember[] = []): Page {
  return shell(site, { name: 'links' }, {
    title: '友链',
    description: '朋友们的网站',
    top: pageHead('友链', `${friends.length} 个朋友的网站`),
    main: `${bento(
      friends
        .map((f) => {
          const href = safeHref(f.url);
          return tile('quarter', `${img(f.avatar, f.name, 'friend__avatar') || `<span class="friend__avatar friend__avatar--txt" style="--h:${hashHue(f.name)}">${e(f.name.slice(0, 1))}</span>`}<span class="friend__info"><b>${e(f.name)}</b><small>${e(f.description)}</small></span>`, { cls: 'friend', tag: 'a', attrs: href ? `href="${e(href)}" target="_blank" rel="noopener noreferrer"` : '' });
        })
        .join(''),
    )}
${members.length ? `<h2 class="section-h reveal">${icon('heart')}好朋友</h2>${bento(
      members
        .map((m) => tile('third', `<usa-presence name="${e(m.name)}"${m.avatarUrl ? ` src="${e(safeHref(m.avatarUrl, true) ?? '')}"` : ''} status="offline"></usa-presence><span><b>${e(m.name)}</b><span class="member__badges">${m.badges.map((b) => memberBadge(b.code, b.label, b.style, b.design)).join('')}</span><small>${e(m.bio)}</small></span>`, { cls: 'member' }))
        .join('') + tile('third', `<p>想出现在这里？</p><a class="btn" href="${url('/join/')}">${icon('heart')}注册成为好朋友</a>`, { cls: 'member member--cta' }),
    )}` : ''}
${bento(tile('full', `${kicker('plus', '申请友链')}
<usa-disclosure class="faq"><details><summary>友链要求</summary><p>原创内容为主、能正常访问、没有违法和广告内容。互换前请先在本站加上我的链接。</p></details>
<details><summary>本站信息</summary><p>名称：${e(site.settings.siteTitle)}<br>简介：${e(site.settings.siteDescription)}<br>地址：<span class="js-site-origin">${url('/')}</span></p></details>
<details><summary>怎么申请</summary><p>在<a href="${url('/guestbook/')}">留言板</a>留下你的网站名称、地址、头像和一句话简介，审核后会出现在上面。</p></details></usa-disclosure>`))}`,
  });
}

export function guestbookPage(site: SiteData, entries: GuestbookEntry[] = [], notes: StickyNote[] = []): Page {
  const list = entries.length
    ? `<ol class="comments">${entries
        .map(
          (c) => `<li class="comment"><usa-presence name="${e(c.name)}" status="offline" class="comment__avatar"></usa-presence><div class="comment__body"><div class="comment__head"><b>${c.website && safeHref(c.website) ? `<a href="${e(safeHref(c.website)!)}" target="_blank" rel="noopener noreferrer nofollow">${e(c.name)}</a>` : e(c.name)}</b><time datetime="${e(c.createdAt)}">${formatDate(c.createdAt)}</time></div><p>${e(c.content)}</p></div></li>`,
        )
        .join('')}</ol>`
    : '<p class="empty">还没有留言，来做第一个吧。</p>';
  const form = `${kicker('message', '写留言')}<form class="gb-form js-gb-form" autocomplete="off">
  <div class="gb-form__row"><usa-field label="昵称" name="name" required maxlength="40"></usa-field><usa-field label="网站（可选）" name="website" type="url" maxlength="200"></usa-field></div>
  <label class="visually-hidden" for="gb-content">留言内容</label>
  <textarea id="gb-content" name="content" rows="4" maxlength="1000" required placeholder="说点什么吧……（留言需要审核后显示）"></textarea>
  <div class="gb-form__foot"><span class="muted">请文明发言 · 不收集你的邮箱与 IP</span><usa-button deform="squash" morph="submit" class="js-submit-btn"><button class="btn" type="submit">${icon('message')}发送</button></usa-button></div>
</form>`;
  const wall = `${secHead('pin', '便签墙', '贴一句话给路过的人看 · 被 3 位访客举报会自动隐藏')}<usa-sticky-wall label="访客便利贴" class="sticky-wall js-sticky-wall">${notes.filter((n) => !n.hidden).map((n) => `<p data-color="${e(n.color)}" data-id="${n.id}">${noteTextHtml(n.content, n.style, n.color)}<small>— ${e(n.name)}</small></p>`).join('')}</usa-sticky-wall>
<form class="note-form js-note-form" autocomplete="off">
${noteComposer()}
</form>`;
  return shell(site, { name: 'guestbook' }, {
    title: '留言板',
    description: '给我留言',
    top: pageHead('留言与便签', `${entries.length} 条留言 · ${notes.filter((n) => !n.hidden).length} 张便签`),
    main: bento(`${tile('half', form, { cls: 'gb-tile' })}${tile('half', `${kicker('users', '大家说')}${list}`, { cls: 'comments-tile' })}${tile('full', wall, { cls: 'wall-tile', attrs: 'id="wall"' })}`),
  });
}

/** 便签编辑器：文字 + 纸张 + 文字样式 DIY（颜色 / 字体 / 字号 / 粗斜体 / 特效），右侧实时预览。 */
export function noteComposer(): string {
  const d = DEFAULT_NOTE_STYLE;
  const radios = (name: string, list: readonly string[], labels: Record<string, string>, cur: string) =>
    list.map((v) => `<label class="seg"><input type="radio" name="${name}" value="${v}"${v === cur ? ' checked' : ''}><span>${labels[v]}</span></label>`).join('');
  const swatches = INK_PRESETS.map((c) => `<label class="ink" title="${c.label}"><input type="radio" name="ink" value="${c.hex}"${c.hex === d.color ? ' checked' : ''}><span style="--sw:${c.hex}"></span><b class="visually-hidden">${c.label}</b></label>`).join('');
  return `<div class="note-compose">
  <div class="note-compose__fields">
    <div class="note-compose__row"><input name="name" maxlength="20" placeholder="昵称" required aria-label="昵称">
    <select name="color" aria-label="便签纸颜色"><option value="yellow">黄色便签</option><option value="pink">粉色便签</option><option value="blue">蓝色便签</option><option value="green">绿色便签</option></select></div>
    <input name="content" maxlength="60" placeholder="写一句话贴在墙上（60 字以内）" required aria-label="便利贴内容">
    <details class="note-diy js-note-diy">
      <summary>${icon('edit')}<span>文字样式 DIY</span><small class="muted">颜色 · 字体 · 字号 · 特效</small></summary>
      <fieldset class="diy-group"><legend>文字颜色</legend><div class="inks">${swatches}<label class="ink ink--custom" title="自定义颜色"><input type="radio" name="ink" value="custom"><span class="ink__wheel"></span><b class="visually-hidden">自定义颜色</b></label><input type="color" name="customColor" value="#155e75" aria-label="自定义文字颜色" class="ink__picker"></div>
      <p class="diy-hint js-ink-hint muted" role="status"></p></fieldset>
      <fieldset class="diy-group"><legend>字体</legend><div class="segs">${radios('font', NOTE_FONTS, FONT_LABELS, d.font)}</div></fieldset>
      <fieldset class="diy-group"><legend>字号</legend><div class="segs">${radios('size', NOTE_SIZES, SIZE_LABELS, d.size)}</div></fieldset>
      <fieldset class="diy-group"><legend>字形</legend><div class="segs"><label class="seg"><input type="checkbox" name="bold"><span><b>粗体</b></span></label><label class="seg"><input type="checkbox" name="italic"><span><i>斜体</i></span></label></div></fieldset>
      <fieldset class="diy-group"><legend>特效</legend><div class="segs">${radios('effect', NOTE_EFFECTS, EFFECT_LABELS, d.effect)}</div><p class="muted small">系统开启「减少动态效果」时，会动的特效显示为静态。</p></fieldset>
      <button class="link-btn js-diy-reset" type="button">${icon('refresh')}恢复默认样式</button>
    </details>
  </div>
  <figure class="note-preview" aria-label="便签预览">
    <div class="note-preview__paper js-note-preview" data-paper="yellow"><p class="js-note-preview-text">${noteTextHtml('写一句话贴在墙上', d)}</p><small>— <span class="js-note-preview-name">你的昵称</span></small></div>
    <figcaption class="muted small">实时预览</figcaption>
  </figure>
  <usa-button deform="squash" morph="submit" class="js-submit-btn note-compose__submit"><button class="btn btn--primary" type="submit">${icon('pin')}贴上去</button></usa-button>
</div>`;
}

export function aboutPage(site: SiteData, members: PublicMember[] = []): Page {
  const p = site.profile;
  return shell(site, { name: 'about' }, {
    title: '关于',
    description: p.tagline || plainText(p.bioMd),
    top: pageHead('关于我', p.location ? `${icon('mapPin')}${e(p.location)}` : ''),
    main: `${bento(`${profileCard(site, 'third', 2)}${tile('twothird', `${kicker('user', '简介')}<div class="prose">${md(p.bioMd || '这个人很懒，还没有写简介。')}</div>`, { cls: 'about about-bio', rows: 2 })}`)}
<usa-scroll-scene class="scene" start="top 85%" end="bottom 40%" scrub="120" stagger="120">
  ${bento(`<div class="tile tile--third scene__item" data-scrub="y: 60 -> 0; opacity: 0 -> 1">${icon('camera')}<b>${site.posts.filter((x) => x.category === '摄影').length}</b><span>篇摄影笔记</span></div>
    <div class="tile tile--third scene__item" data-scrub="y: 60 -> 0; opacity: 0 -> 1">${icon('tag')}<b>${site.tags.length}</b><span>个标签</span></div>
    <div class="tile tile--third scene__item" data-scrub="y: 60 -> 0; opacity: 0 -> 1">${icon('users')}<b>${members.length}</b><span>位好朋友</span></div>`)}
</usa-scroll-scene>
${bento(tile('full', `${kicker('message', '常见问题')}
<usa-disclosure class="faq">
  <details><summary>这个博客用什么搭的？</summary><p>静态前端 + Cloudflare Worker（D1 存文章、R2 存图片），自带 MCP 端点，AI 助手可以直接帮我写草稿。动效全部来自我自己写的 Motionary。</p></details>
  <details><summary>页面动效太多会卡吗？</summary><p>新版界面以静态为主：首页轮播可以随时暂停，系统开启「减少动态效果」时会自动停用轮播自动播放和位移动画。</p></details>
  <details><summary>你会收集我的数据吗？</summary><p>不会追踪你。详见 <a href="${url('/privacy/')}">隐私说明</a>。</p></details>
</usa-disclosure>`))}`,
  });
}

export function privacyPage(site: SiteData): Page {
  return shell(site, { name: 'privacy' }, {
    title: '隐私说明',
    description: '本站如何处理你的数据',
    top: pageHead('隐私说明', '本站如何处理你的数据'),
    main: bento(
      tile(
        'full',
        `<article class="prose">
<h2 id="h-privacy-1">一句话版本</h2>
<p>本站不使用第三方统计和广告追踪，不读取你电脑上的声音、文件或账号信息。</p>
<h2 id="h-privacy-2">「谁在看网站」</h2>
<ul><li>默认只显示匿名头像（随机颜色 + 首字母），用一个随机会话 ID 计数，关闭页面后即失效；服务器不保存 IP。</li>
<li>浏览器不会把你的 Google / Edge 头像告诉网站。只有你在「成为好朋友」页<strong>主动</strong>用 Google 登录并勾选「公开头像」后，其他访客才会看到你的名字和头像，随时可以撤销。我们只保存 Google 提供的名字和头像地址，不保存其他资料。</li></ul>
<h2 id="h-privacy-4">留言、便利贴、上传与语音</h2>
<ul><li>留言需要审核后显示；便利贴被 3 位访客举报后自动隐藏，等待站长复核。只保存你填写的昵称、内容和时间。</li>
<li>「上传给我的文件」和「给我说话」只有登录的好朋友能用，有大小、类型和频率限制，只有站长能看到，审核后可删除。</li>
<li>邮箱只用来发送验证码和识别你的好朋友账号，不会出现在任何公开页面或接口里。验证码和登录令牌在服务器上只存哈希，验证码 10 分钟后失效。</li>
<li>限流和防重复举报用的是加盐哈希后的 IP，不保存原始 IP；在线状态记录 2 分钟后自动删除。</li>
<li>Google 登录只在你点击后发生，授权页由 Google 显示并由你确认；本站只读取名字、头像和用于识别账号的邮箱。站长删除好朋友账号时，徽章、登录令牌和你上传的文件一并删除。</li></ul>
<h2 id="h-privacy-5">本地存储</h2>
<p>浏览器本地只保存：深色 / 浅色、点赞与「收藏」书签、好朋友登录状态。演示站的数据也只保存在你的浏览器里。首页的「订阅」框不会把邮箱发给任何第三方：它只是把你带到「成为好朋友」页，由你自己决定是否用邮箱验证码注册。</p>
<h2 id="h-privacy-6">图片致谢</h2>
<p>示例照片大多来自 Wikimedia Commons（CC0 / 公有领域 / CC BY / CC BY-SA），作者和许可写在每张照片下方和仓库 README；少数标注为「AI 生成示例图」的图片（首页山景背景、部分封面）不是真实拍摄，只用来占位，站长会换成自己的照片。</p>
</article>`,
        { cls: 'prose-tile' },
      ),
    ),
  });
}

export function joinPage(site: SiteData): Page {
  return shell(site, { name: 'join' }, {
    title: '成为好朋友',
    description: '注册成为好朋友',
    top: pageHead('好朋友登录', '用邮箱验证码注册 / 登录。登录后可以给我上传文件、发语音，还可能领到一枚刻着专属社交 ID 的徽章。'),
    main: bento(`${tile('twothird', `<div class="join"><p class="join__hint js-join-hint" hidden>${icon('send')}<span>用邮箱订阅：验证邮箱、成为好朋友后，站长就能联系到你。也可以直接用 <a href="${url('/subscribe/')}">RSS</a> 订阅。</span></p><ol class="steps js-join-steps" aria-label="注册 / 登录步骤"><li class="is-active">填写资料</li><li>邮箱验证</li><li>完成</li></ol>
<form class="join__form js-join-form" autocomplete="on" novalidate>
  <usa-field label="昵称" name="name" required maxlength="40"></usa-field>
  <usa-field label="邮箱" name="email" type="email" required maxlength="120" hint="只用来发送验证码，不会公开"></usa-field>
  <usa-field label="一句话介绍（可选）" name="bio" maxlength="120"></usa-field>
  <usa-button deform="squash" morph="submit" class="js-submit-btn"><button class="btn btn--primary btn--block" type="submit">${icon('mail')}发送验证码</button></usa-button>
</form>
<div class="join__otp js-join-otp" hidden><p>验证码已发送到 <b class="js-join-email"></b>，请输入 6 位数字<span class="js-demo-otp"></span>。</p><usa-otp length="6" label="邮箱验证码" class="js-otp"></usa-otp><p class="js-otp-msg muted" role="status"></p></div>
<div class="join__done js-join-done" hidden><usa-check kind="success" size="64" label="已登录"></usa-check><h2 class="join__done-h">欢迎你，<span class="js-join-name"></span>！</h2><p class="js-join-badges join__badges"></p><div class="join__designs js-join-designs"></div><p>现在可以去 <a href="${url('/mailbox/')}">信箱</a> 给我传文件或留语音，或者去 <a href="${url('/guestbook/#wall')}">便签墙</a> 贴一张。</p><button class="btn btn--soft btn--sm js-logout" type="button">${icon('logout')}退出登录</button></div>
<div class="join__google"><p class="muted">或者</p><button class="btn btn--ghost js-google" type="button">${icon('globe')}用 Google 登录（可选公开头像）</button><p class="muted small">只有你同意后才会读取 Google 名字和头像；演示站不会真的连接 Google。</p></div></div>`, { cls: 'join-main', rows: 2 })}
${tile('third', `${kicker('award', '专属徽章')}<p class="muted">站长会给好朋友发徽章，编号刻在徽章上。拿到徽章后可以自己搭配样式：</p>${presetGallery('FRIEND-0001')}`, { cls: 'badge-tile' })}
${tile('third', `${kicker('eye', '隐私')}<p class="muted">邮箱不会公开。访客默认匿名，头像只在你同意后显示。</p>${more(url('/privacy/'), '隐私说明')}`)}`),
  });
}

export function mailboxPage(site: SiteData): Page {
  return shell(site, { name: 'mailbox' }, {
    title: '信箱',
    description: '上传给我的文件 · 给我说话',
    top: pageHead('信箱', '上传给我的文件 · 给我说话'),
    main: bento(`${tile('half', `${kicker('upload', '上传给我的文件')}
<p class="muted">仅限好朋友 · 单个文件 ≤ 10 MB（演示站 ≤ 2 MB）· 只有站长能看到，审核后保留。</p>
<div class="mailbox__gate js-member-gate"><p>请先 <a href="${url('/join/')}">注册成为好朋友</a>。</p></div>
<form class="upload js-upload" hidden><label class="upload__drop"><input type="file" name="file" class="js-upload-input"><span>${icon('upload')}点击或拖入文件</span></label><input name="note" maxlength="200" placeholder="附言（可选）" aria-label="附言"><div class="upload__list js-upload-list"></div></form>`, { cls: 'upload-tile', rows: 2 })}
${tile('half', `${kicker('mic', '给我说话')}
<p class="muted">点击麦克风开始录音（最长 60 秒），结束后可以试听，长按发送。需要你允许浏览器使用麦克风。</p>
<div class="voice js-voice"><usa-voice-button label="按下开始录音" bars="5" class="js-voice-btn"></usa-voice-button><div class="voice__panel"><p class="js-voice-status muted" role="status">准备就绪</p><audio class="js-voice-audio" controls hidden></audio>
<usa-hold duration="900" class="js-voice-send" hidden>长按发送</usa-hold></div></div>`, { cls: 'voice-tile', rows: 2 })}`),
  });
}

export function notFoundPage(site: SiteData, route: Route = { name: 'notfound' }): Page {
  return shell(site, route, {
    title: '页面不存在',
    description: '',
    top: '',
    main: bento(tile('full', `<div class="state"><usa-check kind="warning" size="72" label="页面不存在"></usa-check><h1 class="state__code">404</h1><p>页面不存在或文章已下线。</p><a class="btn" href="${url('/')}">${icon('home')}返回首页</a></div>`, { cls: 'state-tile' })),
  });
}

export function loadingMain(): string {
  return bento(tile('full', `<div class="state" role="status" aria-live="polite"><usa-spinner kind="fluent" size="40" label="加载中"></usa-spinner><span class="visually-hidden">加载中…</span>
  <usa-skeleton loading lines="4" class="state__skeleton"></usa-skeleton></div>`, { cls: 'state-tile' }));
}

export function errorMain(message: string): string {
  return bento(tile('full', `<div class="state" role="alert"><usa-check kind="error" size="64" label="加载失败"></usa-check><h2>加载失败</h2><p>${e(message)}</p><button class="btn retry" type="button">${icon('refresh')}重试</button></div>`, { cls: 'state-tile' }));
}

/** 路由 → 页面。 */
export function renderRoute(route: Route, site: SiteData, x: Extra = {}): Page {
  switch (route.name) {
    case 'home': {
      const pages = Math.max(1, Math.ceil(site.posts.length / Math.max(1, site.settings.postsPerPage)));
      return route.page > pages ? notFoundPage(site) : homePage(site, route.page, x);
    }
    case 'post':
      return x.post ? postPage(site, x.post) : notFoundPage(site, route);
    case 'archives':
      return archivesPage(site);
    case 'tags':
      return tagsPage(site);
    case 'tag':
      return tagPage(site, route.tag);
    case 'categories':
      return categoriesPage(site);
    case 'category':
      return categoryPage(site, route.category);
    case 'gallery':
      return galleryPage(site, x.gallery ?? []);
    case 'album':
      return albumPage(site, x.gallery?.find((a) => a.slug === route.slug), route.slug);
    case 'favorites':
      return favoritesPage(site, x.favorites ?? [], x.projects ?? []);
    case 'guestbook':
      return guestbookPage(site, x.guestbook, x.notes);
    case 'links':
      return linksPage(site, x.friends ?? [], x.members);
    case 'about':
      return aboutPage(site, x.members);
    case 'privacy':
      return privacyPage(site);
    case 'join':
      return joinPage(site);
    case 'mailbox':
      return mailboxPage(site);
    case 'now':
      return nowPage(site, x.now ?? []);
    case 'works':
      return worksPage(site, x.works ?? []);
    case 'gear':
      return gearPage(site, x.gear ?? []);
    case 'shelf':
      return shelfPage(site, x.shelf ?? []);
    case 'timeline':
      return timelinePage(site, x.timeline ?? []);
    case 'changelog':
      return changelogPage(site, x.changelog ?? []);
    case 'opensource':
      return opensourcePage(site, x.repos ?? [], x.changelog ?? []);
    case 'stats':
      return statsPage(site, x.changelog ?? []);
    case 'search':
      return searchPage(site);
    case 'subscribe':
      return subscribePage(site);
    case 'map':
      return mapPage(site, x.works ?? []);
    case 'user':
    case 'notifications':
    case 'me':
    case 'feed':
    case 'compose':
    case 'work':
    case 'discover':
    case 'topics':
    case 'topic':
    case 'events':
    case 'event':
    case 'collection':
    case 'projects':
    case 'project':
    case 'features':
    case 'feature':
    case 'mystats':
    case 'messages':
    case 'msgrequests':
    case 'msgsettings':
    case 'conversation':
      return socialPage(site, route);
    default:
      return notFoundPage(site);
  }
}

export type SocialRouteName = 'user' | 'notifications' | 'me' | 'feed' | 'compose' | 'work' | 'discover' | 'topics' | 'topic' | 'events' | 'event' | 'collection' | 'projects' | 'project' | 'features' | 'feature' | 'mystats' | 'messages' | 'msgrequests' | 'msgsettings' | 'conversation';
/** 所有交给 social-client 按需渲染的路由 */
export const SOCIAL_ROUTES: readonly SocialRouteName[] = ['user', 'notifications', 'me', 'feed', 'compose', 'work', 'discover', 'topics', 'topic', 'events', 'event', 'collection', 'projects', 'project', 'features', 'feature', 'mystats', 'messages', 'msgrequests', 'msgsettings', 'conversation'];
/**
 * L15 社交页（用户主页 / 通知 / 我的）：只渲染外壳和加载占位，内容由按需加载的 social-client.ts 填充
 * （社交代码不进首屏包；需要登录态，不预渲染个人数据）。
 */
export function socialPage(site: SiteData, route: Extract<Route, { name: SocialRouteName }>): Page {
  const HEADS = {
    notifications: ['通知', '关注、回复、提及、回应与收藏'],
    me: ['我的', '个人主页、收藏与设置'],
    feed: ['社区动态', '好朋友们的照片、影集、短动态和长文'],
    compose: ['发布', '分享照片、影集、短动态或长文'],
    discover: ['发现社区', '不用先关注谁：从话题、精选创作者和摄影活动开始逛'],
    topics: ['话题', '摄影、编程、硬件、建模、设计和日常'],
    events: ['摄影活动', '每日一图、每周主题与作品征集'],
    projects: ['创作者项目', '好朋友们正在做的项目：开发日志、版本和关联作品'],
    features: ['摄影专题', '用一组照片和文字讲一个完整的故事'],
    mystats: ['我的数据', '只有你能看到：按天汇总的浏览与互动，不记录访客身份'],
    messages: ['私信', '和互相关注的好朋友一对一聊天'],
    msgrequests: ['消息请求', '还没有互相关注的人发来的消息，接受后才能回复'],
    msgsettings: ['私信设置', '谁可以给你发私信、已读回执与在线状态'],
  } as const;
  const head =
    route.name === 'user'
      ? { title: `@${route.username}`, sub: '好朋友的个人主页' }
      : route.name === 'work'
        ? { title: '作品', sub: '好朋友发布的内容' }
        : route.name === 'topic'
          ? { title: '话题', sub: '话题下的作品与文章' }
          : route.name === 'event'
            ? { title: '摄影活动', sub: '活动规则、投稿与精选' }
            : route.name === 'collection'
              ? { title: '合集', sub: '好朋友整理的作品与文章' }
              : route.name === 'project'
                ? { title: '项目', sub: '开发日志、版本与关联作品' }
                : route.name === 'feature'
                  ? { title: '摄影专题', sub: '照片与文字组成的专题' }
                  : route.name === 'conversation'
                    ? { title: '私信', sub: '一对一会话' }
                    : { title: HEADS[route.name][0], sub: HEADS[route.name][1] };
  const attr = route.name === 'user' ? ` data-username="${e(route.username)}"` : route.name === 'work' || route.name === 'collection' || route.name === 'conversation' ? ` data-id="${route.id}"` : route.name === 'topic' || route.name === 'event' || route.name === 'project' || route.name === 'feature' ? ` data-slug="${e(route.slug)}"` : '';
  const bare = route.name === 'user' || route.name === 'work' || route.name === 'topic' || route.name === 'event' || route.name === 'collection' || route.name === 'project' || route.name === 'feature' || route.name === 'conversation';
  return shell(site, route, {
    title: head.title,
    description: head.sub,
    top: bare ? '' : pageHead(head.title, head.sub),
    main: `<section class="bento social js-social" data-view="${route.name}"${attr} aria-busy="true" aria-live="polite"><div class="social__loading"><span class="social__spin" aria-hidden="true"></span><span>加载中…</span></div></section>`,
    kind: 'page--social',
  });
}

/** 页面区域，放在 <usa-route-transition> 里。 */
export function pageRegion(p: Page): string {
  return `<div class="page ${p.kind}" data-route="${e(routePath(p.route))}">
<main class="wrap page__main" id="main" tabindex="-1">${p.top}${p.main}${p.aside}</main></div>`;
}

/** 全站背景：淡蓝色天空 + 山雾（静态图，可在 public/img 里替换）。 */
export function backdrop(): string {
  return `<div class="sky" aria-hidden="true"></div>`;
}

/** 整个 #app 的内容（预渲染与浏览器首屏共用）。 */
export function appHtml(site: SiteData, p: Page): string {
  return `${backdrop()}${navbar(site, p.route)}
<usa-route-transition id="rt" effect="fade" class="rt">${pageRegion(p)}</usa-route-transition>
${footer(site)}`;
}

/** 节日横幅文字：SVG 图标 + 去掉 emoji 的祝福语。 */
export function festivalText(f: Festival): string {
  return `<span class="fest-msg">${festivalIcon(f.id, f.theme)}<span>${e(stripEmoji(f.message))}</span></span>`;
}

/** 节日横幅（全站顶部，只在节日当天渲染）。 */
export function festivalBanner(f: Festival | null): string {
  if (!f) return '';
  return `<usa-festival-banner theme="${e(f.theme)}" label="${e(f.name)}" dismissible class="festival festival--top">${festivalText(f)}</usa-festival-banner>`;
}
