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
};

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
function hashHue(s: string): number {
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
}

/** 每个路由需要额外拉取的数据。 */
export function needs(r: Route): (keyof Extra)[] {
  switch (r.name) {
    case 'home':
      return r.page === 1 ? ['gallery', 'notes', 'friends', 'members'] : [];
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
export const NAV: NavItem[] = [
  { label: '首页', icon: 'home', href: '/', match: ['home'] },
  {
    label: '文章',
    icon: 'book',
    href: '/archives/',
    match: ['archives', 'tags', 'tag', 'categories', 'category', 'post'],
    children: [
      { label: '归档', icon: 'archive', href: '/archives/' },
      { label: '标签', icon: 'tag', href: '/tags/' },
      { label: '分类', icon: 'folder', href: '/categories/' },
    ],
  },
  {
    label: '百宝箱',
    icon: 'box',
    href: '/gallery/',
    match: ['gallery', 'album', 'favorites'],
    children: [
      { label: '画廊', icon: 'image', href: '/gallery/' },
      { label: '收藏与项目', icon: 'star', href: '/favorites/' },
    ],
  },
  {
    label: '社交',
    icon: 'users',
    href: '/guestbook/',
    match: ['guestbook', 'links', 'join', 'mailbox'],
    children: [
      { label: '留言板', icon: 'message', href: '/guestbook/' },
      { label: '友链', icon: 'link', href: '/links/' },
      { label: '成为好朋友', icon: 'heart', href: '/join/' },
      { label: '信箱', icon: 'mail', href: '/mailbox/' },
    ],
  },
  {
    label: '关于',
    icon: 'user',
    href: '/about/',
    match: ['about', 'privacy'],
    children: [
      { label: '关于我', icon: 'user', href: '/about/' },
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

/** 顶部悬浮导航：玻璃胶囊 + <usa-nav-morph> 滑动指示器。 */
export function navbar(site: SiteData, route: Route): string {
  const items = NAV.map((it) => {
    const cur = navActive(it, route) ? ' aria-current="page"' : '';
    if (!it.children) return `<div class="menu"${cur}><a class="menu__link" href="${url(it.href!)}"><span>${it.label}</span></a></div>`;
    return `<div class="menu menu--group"${cur}><a class="menu__link" href="${url(it.href!)}" aria-haspopup="true"><span>${it.label}</span>${icon('chevronDown', 'menu__caret')}</a>
  <div class="menu__drop" role="menu">${it.children.map((c) => `<a role="menuitem" href="${url(c.href!)}">${icon(c.icon)}<span>${c.label}</span></a>`).join('')}</div></div>`;
  }).join('');
  return `<header class="nav" id="nav">
  <div class="nav__bar">
    <a class="nav__brand" href="${url('/')}" aria-label="${e(site.settings.siteTitle)} 首页"><span class="nav__logo" aria-hidden="true">${e(site.profile.name.slice(0, 1) || 'W')}</span><span class="nav__brand-text">${e(site.settings.siteTitle)}</span></a>
    <nav class="nav__menus" aria-label="主导航"><usa-nav-morph indicator="pill" label="主导航">${items}</usa-nav-morph></nav>
    <div class="nav__tools">
      <button class="nav__btn js-search" type="button" aria-label="搜索" title="搜索 (Ctrl K)">${icon('search')}</button>
      <button class="nav__btn js-theme" type="button" aria-label="切换深色 / 浅色模式" title="切换深色 / 浅色">${icon('moon', 'only-light')}${icon('sun', 'only-dark')}</button>
      <button class="nav__btn nav__toggle js-drawer" type="button" aria-label="打开菜单" aria-expanded="false" aria-controls="drawer">${icon('menu')}</button>
    </div>
  </div>
</header>`;
}

/** 手机端菜单：从顶部展开的卡片。 */
export function drawer(site: SiteData): string {
  const groups = NAV.map(
    (it) => `<div class="drawer__group"><a class="drawer__link" href="${url(it.href!)}">${icon(it.icon)}<span>${it.label}</span></a>${
      it.children ? `<div class="drawer__subs">${it.children.map((c) => `<a href="${url(c.href!)}">${e(c.label)}</a>`).join('')}</div>` : ''
    }</div>`,
  ).join('');
  return `<div class="drawer" id="drawer" hidden>
  <div class="drawer__mask js-drawer-close"></div>
  <aside class="drawer__panel" aria-label="菜单">
    <div class="drawer__head">${avatarImg(site.profile, 'drawer__avatar')}<div><strong>${e(site.profile.name)}</strong>${counts(site)}</div><button class="nav__btn js-drawer-close" type="button" aria-label="关闭菜单">${icon('close')}</button></div>
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

export function footer(site: SiteData): string {
  const year = new Date().getFullYear();
  const first = site.posts.length ? ymd(pubDate(site.posts[site.posts.length - 1]!)).y : String(year);
  return `<footer class="footer">
  <div class="wrap footer__inner">
    <div><p class="footer__brand">${e(site.settings.siteTitle)}</p><p class="muted">${e(site.settings.siteDescription)}</p></div>
    <div class="footer__links"><a href="${url('/archives/')}">归档</a><a href="${url('/gallery/')}">画廊</a><a href="${url('/guestbook/')}">留言板</a><a href="${url('/privacy/')}">隐私说明</a><a href="${url('/admin/')}" rel="nofollow">后台</a></div>
    <div class="footer__meta"><p>©${first === String(year) ? year : `${first} – ${year}`} ${e(site.profile.name)} ${icon('heart', 'footer__heart')} 动效：<a href="https://github.com/HarrisonCN/Motionary" target="_blank" rel="noopener noreferrer">Motionary</a></p>
    <p class="muted js-runtime" data-since="${e(site.posts.length ? pubDate(site.posts[site.posts.length - 1]!) : '')}"></p></div>
  </div>
</footer>`;
}

// ---------------------------------------------------------------- 瓷砖
type Size = 'xl' | 'l' | 'm' | 's' | 'full' | 'half' | 'third' | 'twothird' | 'quarter';
/** 一个 bento 瓷砖。size 决定在 12 列网格里的跨度；rows 决定行跨度。 */
function tile(size: Size, body: string, o: { cls?: string; rows?: number; tag?: string; attrs?: string; label?: string; href?: string } = {}): string {
  const tag = o.href ? 'a' : (o.tag ?? 'section');
  const href = o.href ? ` href="${o.href}"` : '';
  return `<${tag} class="tile tile--${size}${o.rows ? ` tile--r${o.rows}` : ''} reveal${o.cls ? ` ${o.cls}` : ''}"${href}${o.label ? ` aria-label="${e(o.label)}"` : ''}${o.attrs ? ` ${o.attrs}` : ''}>${body}</${tag}>`;
}
const kicker = (ic: string, text: string) => `<p class="tile__kicker">${icon(ic)}<span>${text}</span></p>`;
const more = (href: string, text = '查看全部') => `<a class="tile__more" href="${href}">${text}${icon('arrowRight')}</a>`;
const bento = (inner: string, cls = '', attrs = '') => `<div class="bento${cls ? ` ${cls}` : ''}"${attrs ? ` ${attrs}` : ''}>${inner}</div>`;

/** 页首瓷砖：大标题 + 副标题 + 可选背景图。 */
function pageHead(title: string, sub = '', image?: string | null, extra = ''): string {
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
/** 好朋友徽章：拉丝金属 / 珍珠母贝材质，刻有自定义编号。 */
export function memberBadge(code: string, label: string, style: 'pearlescent' | 'brushed-metal' = 'brushed-metal'): string {
  const cls = style === 'pearlescent' ? 'badge--pearl' : 'badge--metal';
  return `<usa-fx class="badge-fx" effect="${style}" trigger="load"><span class="badge ${cls}" title="${e(label)}"><span class="badge__code">${e(code)}</span></span></usa-fx>`;
}

function socialLinks(p: Profile): string {
  return p.links
    .map((l) => {
      const href = safeHref(l.url);
      if (!href) return '';
      const ext = /^https?:/i.test(href);
      return `<usa-click effect="burst" class="social-click"><a class="social" href="${e(href)}" title="${e(l.label)}" aria-label="${e(l.label)}"${ext ? ' target="_blank" rel="noopener noreferrer me"' : ''}>${icon(SOCIAL_ICON[l.icon ?? 'link'] ?? 'link')}</a></usa-click>`;
    })
    .join('');
}

/** 个人卡片瓷砖（首页 / 关于页共用）。 */
export function profileCard(site: SiteData, size: Size = 'quarter', rows = 2): string {
  const p = site.profile;
  const home = safeHref(p.homeUrl);
  const social = socialLinks(p);
  return tile(
    size,
    `<div class="profile__top">${avatarImg(p, 'profile__avatar')}<span class="profile__online" title="在线"></span></div>
  <h2 class="profile__name"><span class="profile__name-text">${e(p.name)}</span><span class="profile__badges">${ownerBadge()}${memberBadge('ID·0001', '站长编号', 'brushed-metal')}</span></h2>
  ${p.tagline ? `<p class="profile__tagline"><usa-shimmer-text>${e(p.tagline)}</usa-shimmer-text></p>` : ''}
  <p class="profile__roles">我是 <usa-text-rotate words="摄影专业的学生|产品体验测试者|动效库作者|夜景爱好者">摄影专业的学生</usa-text-rotate></p>
  ${counts(site)}
  <div class="profile__actions">${home ? `<usa-button deform="dent" haptic class="profile__follow"><a class="btn" href="${e(home)}" target="_blank" rel="noopener noreferrer">${icon('github')}<span>Follow</span></a></usa-button>` : ''}${social ? `<div class="profile__social">${social}</div>` : ''}</div>`,
    { cls: 'profile', rows, label: '个人卡片' },
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
    <span class="post-tile__chips">${featured ? `<span class="chip chip--accent">${icon('star')}精选</span>` : ''}${p.pinned ? `<span class="chip chip--accent">${icon('pin')}置顶</span>` : ''}${p.category ? `<span class="chip">${e(p.category)}</span>` : ''}<span class="chip chip--ghost">${formatDate(pubDate(p))}</span></span>
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
function shell(site: SiteData, route: Route, o: Partial<Page> & { title: string }): Page {
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

function heroTile(site: SiteData): string {
  const s = site.settings;
  const subs = (s.heroSubtitles.length ? s.heroSubtitles : [site.profile.tagline || s.siteDescription]).filter(Boolean);
  return tile(
    'twothird',
    `<div class="hero__bg"${bgStyle(s.heroImage)}></div>
  <usa-blobs class="hero__blobs" colors="var(--blob-1),var(--blob-2),var(--blob-3)" speed="0.7" blur="50" aria-hidden="true"></usa-blobs>
  <div class="hero__fx js-hero-fx" aria-hidden="true"></div>
  <div class="hero__info">
    <p class="hero__hello">${icon('sparkles')}你好，欢迎来到</p>
    <h1 class="hero__title"><usa-gradient-text colors="#ffffff,#cfe0ff,#ffd3e8,#ffffff" speed="0.5">${e(s.siteTitle)}</usa-gradient-text></h1>
    <p class="hero__sub"><usa-typewriter words="${e(subs.join('|'))}" loop>${e(subs[0] ?? '')}</usa-typewriter></p>
    <div class="hero__cta">
      <usa-button deform="gooey" haptic><a class="btn btn--light" href="#content">${icon('book')}<span>开始阅读</span></a></usa-button>
      <usa-button deform="wobble"><a class="btn btn--glass" href="${url('/about/')}">${icon('user')}<span>关于我</span></a></usa-button>
    </div>
  </div>
  <a class="hero__down" href="#content" aria-label="向下滚动到文章">${icon('chevronDown')}</a>`,
    { cls: 'hero', rows: 2, tag: 'section', attrs: 'id="hero"', label: '首页横幅' },
  );
}

function statsTile(site: SiteData): string {
  const words = site.posts.reduce((a, p) => a + (p.wordCount || 0), 0);
  const last = site.posts.reduce((a, p) => (p.updatedAt > a ? p.updatedAt : a), '');
  const since = site.posts.length ? pubDate(site.posts[site.posts.length - 1]!) : '';
  return tile(
    'third',
    `${kicker('chart', '网站资讯')}
  <usa-scroll-scene class="stats-scene" start="top 95%" end="top 45%" scrub="100" stagger="80">
  <dl class="stats">
    <div data-scrub="y: 18 -> 0"><dt>文章</dt><dd>${site.total}</dd></div>
    <div data-scrub="y: 18 -> 0"><dt>总字数</dt><dd>${formatCount(words)}</dd></div>
    <div data-scrub="y: 18 -> 0"><dt>已运行</dt><dd class="js-runtime-days" data-since="${e(since)}">${since ? `${Math.max(1, Math.floor((Date.now() - new Date(since).getTime()) / 864e5))} 天` : '—'}</dd></div>
    <div data-scrub="y: 18 -> 0"><dt>最后更新</dt><dd>${formatDate(last).slice(5) || '—'}</dd></div>
  </dl></usa-scroll-scene>`,
    { cls: 'stats-tile' },
  );
}

function viewersTile(size: Size = 'quarter'): string {
  return tile(
    size,
    `${kicker('eye', '谁在看网站')}<div class="viewers js-viewers"><div class="viewers__row"><usa-presence class="viewers__me js-viewer-me" name="你" status="online" title="你（匿名）"></usa-presence><usa-avatar-stack max="6" size="38" class="viewers__stack"></usa-avatar-stack></div><p class="viewers__text">正在统计在线访客…</p>
<p class="viewers__hint">访客默认匿名。<a href="${url('/join/')}">成为好朋友</a>后可选择公开头像。</p></div>`,
    { cls: 'viewers-tile' },
  );
}

/** 音乐瓷砖：播放 / 暂停（图标变形）+ 镜像频谱。真正的 <audio> 常驻页面，换页不中断。 */
function musicTile(size: Size = 'half'): string {
  return tile(
    size,
    `<div class="music__row">
    <button class="music__disc js-play" type="button" aria-label="播放背景音乐"><span class="music__vinyl"></span><usa-icon-morph icons="play,pause" size="22" class="music__icon"></usa-icon-morph></button>
    <div class="music__meta">${kicker('play', '正在播放')}<b>午后散步</b><small class="muted">原创合成旋律 · 本站自带</small></div>
  </div>
  <div class="music__viz js-viz" aria-hidden="true"><span class="music__idle">${Array.from({ length: 40 }, (_, i) => `<i style="--i:${i};--h:${Math.round(18 + 70 * Math.abs(Math.sin(i * 0.55) * Math.cos(i * 0.21)))}%"></i>`).join('')}</span></div>
  <button class="btn btn--ghost btn--sm js-tab-audio" type="button" title="由你选择一个标签页并勾选「分享音频」">${icon('tv')}可视化标签页声音</button>`,
    { cls: 'music', label: '音乐播放器' },
  );
}

function galleryTile(albums: Album[]): string {
  const photos = albums.flatMap((a) => a.photos.slice(0, 2).map((p) => ({ ...p, album: a }))).slice(0, 5);
  if (!photos.length) return '';
  return tile(
    'twothird',
    `<div class="gal-mosaic">${photos
      .map((p, i) => `<a class="gal-mosaic__item gal-mosaic__item--${i}" href="${albumPath(p.album.slug)}" aria-label="${e(p.album.title)}：${e(p.caption)}">${img(p.url, p.caption, 'gal-mosaic__img', { sizes: i === 0 ? '(max-width: 768px) 100vw, 360px' : '200px' })}</a>`)
      .join('')}</div>
  <div class="gal-tile__cap">${kicker('image', '画廊')}<b>${albums.length} 个相册 · ${albums.reduce((n, a) => n + a.photos.length, 0)} 张照片</b>${more(url('/gallery/'), '去看看')}</div>`,
    { cls: 'gal-tile', rows: 2, label: '画廊' },
  );
}

function notesTile(notes: StickyNote[]): string {
  const list = notes.filter((n) => !n.hidden).slice(-5);
  return tile(
    'third',
    `${kicker('pin', '便利贴墙')}<usa-sticky-wall label="访客便利贴" class="sticky-wall sticky-wall--mini">${list.map((n) => `<p data-color="${e(n.color)}" data-id="${n.id}">${e(n.content)}<small>— ${e(n.name)}</small></p>`).join('')}</usa-sticky-wall>${more(url('/guestbook/'), '贴一张')}`,
    { cls: 'notes-tile', rows: 2 },
  );
}

/** 节日瓷砖：只在节日期间出现（festivals 表里配置的日期范围）。 */
export function festivalTile(list: Festival[] | undefined, now = new Date()): string {
  const f = list?.length ? activeFestival(list, now) : null;
  if (!f) return '';
  return tile(
    'third',
    `${kicker('sparkles', '今天是节日')}
  <usa-festival-banner theme="${e(f.theme)}" label="${e(f.name)}" class="festival festival--tile">${festivalText(f)}</usa-festival-banner>
  <div class="fest__row"><b class="fest__name">${e(f.name)}</b><span class="fest__days">快乐！</span></div>
  <usa-click effect="confetti" class="fest__click"><button class="btn btn--sm" type="button">${icon('sparkles')}撒花庆祝</button></usa-click>`,
    { cls: 'fest-tile fest-tile--on', attrs: `data-festival="${e(f.id)}"` },
  );
}

function friendsTile(friends: Friend[], members: PublicMember[]): string {
  if (!friends.length && !members.length) return '';
  return tile(
    'third',
    `${kicker('link', '朋友们')}
  <div class="friends-mini">${friends
    .slice(0, 6)
    .map((f) => {
      const href = safeHref(f.url);
      return `<a class="friends-mini__item" ${href ? `href="${e(href)}" target="_blank" rel="noopener noreferrer"` : ''} title="${e(f.name)}">${img(f.avatar, f.name, 'friends-mini__av') || `<span class="friends-mini__av friends-mini__av--txt" style="--h:${hashHue(f.name)}">${e(f.name.slice(0, 1))}</span>`}<span>${e(f.name)}</span></a>`;
    })
    .join('')}</div>
  ${members.length ? `<div class="members-mini">${members.slice(0, 3).map((m) => `<span class="members-mini__m"><b>${e(m.name)}</b>${m.badges.slice(0, 1).map((b) => memberBadge(b.code, b.label, b.style)).join('')}</span>`).join('')}</div>` : ''}
  ${more(url('/links/'), '全部友链')}`,
    { cls: 'friends-tile' },
  );
}

function joinTile(): string {
  return tile(
    'third',
    `<usa-anim-icon name="heart" size="40" trigger="loop" class="join-tile__ic" label="好朋友"></usa-anim-icon>
  <h2 class="tile__h">注册成为好朋友</h2><p class="muted">邮箱验证码注册，就能给我传文件、发语音，还可能领到刻着专属编号的徽章。</p>
  <div class="join-tile__badges">${memberBadge('FRIEND-0001', '示例徽章', 'pearlescent')}${memberBadge('FRIEND-0002', '示例徽章', 'brushed-metal')}</div>
  <usa-button deform="squash wobble" haptic><a class="btn" href="${url('/join/')}">${icon('heart')}<span>加入</span></a></usa-button>`,
    { cls: 'join-tile' },
  );
}

function mailboxTile(): string {
  return tile(
    'third',
    `<usa-anim-icon name="bell" size="40" trigger="hover" class="join-tile__ic" label="信箱"></usa-anim-icon>
  <h2 class="tile__h">信箱</h2><p class="muted">好朋友可以给我上传文件，或者按住麦克风说几句话。只有我能看到。</p>
  <usa-button deform="gooey"><a class="btn btn--ghost" href="${url('/mailbox/')}">${icon('mail')}<span>去信箱</span></a></usa-button>`,
    { cls: 'mail-tile' },
  );
}

function tagsTile(site: SiteData): string {
  return tile(
    'third',
    `${kicker('tag', '标签与分类')}${categoryList(site.categories.slice(0, 4))}${tagCloud(site.tags, 14)}${more(url('/tags/'), '全部标签')}`,
    { cls: 'tags-tile', rows: 2 },
  );
}

function announceTile(site: SiteData): string {
  if (!site.settings.sections.announcement || !site.settings.announcement) return '';
  return tile('third', `${kicker('megaphone', '公告')}<div class="prose prose--sm">${md(site.settings.announcement)}</div>`, { cls: 'announce-tile widget--announce' });
}

/** 显示设置瓷砖：深色、页面风格、动效强度、暂停动效、光标拖尾。 */
export function settingsBody(): string {
  return `<div class="set-row"><span>深色模式</span><usa-switch variant="daynight" class="js-dark-switch" label="深色模式"></usa-switch></div>
  <div class="set-row set-row--cord"><span>或者拉一下灯绳</span><usa-pull-cord class="pull-cord--inline" label="拉灯绳切换深色模式"></usa-pull-cord></div>
  <div class="set-row set-row--col"><span>页面风格</span><usa-theme-switcher themes="light,glass,neon" label="页面风格" class="js-surface"></usa-theme-switcher></div>
  <div class="set-row set-row--col"><span>动效强度</span><usa-motion-switch class="js-motion-switch"></usa-motion-switch></div>
  <div class="set-row"><usa-checkbox class="js-comet-switch" label="光标彗星拖尾">光标彗星拖尾</usa-checkbox></div>
  <div class="set-row set-row--col"><span class="muted">觉得卡可以点这里暂停动效</span><usa-pause-all label="暂停全部动效" resume-label="恢复动效" class="js-pause-all"></usa-pause-all></div>`;
}
function settingsTile(): string {
  return tile('third', `${kicker('settings', '显示设置')}${settingsBody()}`, { cls: 'settings-tile', rows: 2 });
}

/** 互动小样：每一种点击反馈 / 加载 / 结果 / 材质效果都能点一点。 */
function labTile(): string {
  const b = (deform: string, label: string, extra = '') => `<usa-button deform="${deform}"${extra}><button class="btn btn--sm btn--soft" type="button">${label}</button></usa-button>`;
  const c = (effect: string, label: string) => `<usa-click effect="${effect}" class="lab__click"><button class="btn btn--sm btn--soft" type="button">${label}</button></usa-click>`;
  return tile(
    'full',
    `<div class="lab__head">${kicker('sparkles', '互动小样')}<h2 class="tile__h">点一点、按一按 —— 这些动效都来自 Motionary</h2></div>
  <div class="lab">
    <div class="lab__cell"><h3>点击反馈</h3><div class="lab__row">${c('ripple', '涟漪')}${c('burst', '粒子迸发')}${c('confetti', '彩纸')}${c('squish', '按压回弹')}</div></div>
    <div class="lab__cell"><h3>按钮形变</h3><div class="lab__row">${b('squash', '挤压拉伸')}${b('wobble', '弹性圆角')}${b('gooey', '液体融合')}${b('dent', '按压凹陷')}${b('squash', '震动反馈', ' haptic')}</div></div>
    <div class="lab__cell"><h3>形状变形 · 提交</h3><div class="lab__row"><usa-icon-morph icons="menu,close" labels="打开,关闭" toggle size="26" class="lab__morph"></usa-icon-morph><usa-icon-morph icons="plus,minus" labels="展开,收起" toggle size="26" class="lab__morph"></usa-icon-morph>
      <usa-button deform="squash" morph="submit" class="js-lab-submit"><button class="btn btn--sm" type="button">提交</button></usa-button></div></div>
    <div class="lab__cell"><h3>喜欢 · 长按 · 双击</h3><div class="lab__row"><usa-like count="128" class="js-lab-like" label="喜欢"></usa-like><usa-hold duration="1000" class="lab__hold js-lab-hold" label="长按确认">长按确认</usa-hold>
      <usa-double-tap class="lab__dbl" label="双击出现爱心"><span class="lab__dbl-pad">双击这里 ❤</span></usa-double-tap></div></div>
    <div class="lab__cell"><h3>勾选 · 结果</h3><div class="lab__row"><usa-checkbox checked label="动画复选框">记住我</usa-checkbox><usa-check kind="success" size="34" label="成功" trigger="view"></usa-check><usa-check kind="error" size="34" label="失败"></usa-check><usa-check kind="warning" size="34" label="提醒"></usa-check></div></div>
    <div class="lab__cell"><h3>加载</h3><div class="lab__row"><usa-spinner kind="fluent" size="30" label="Windows 进度环"></usa-spinner><usa-spinner kind="windows" size="30" label="Windows 点阵"></usa-spinner><usa-spinner kind="dots" size="30" label="加载中"></usa-spinner>
      <button class="btn btn--sm btn--soft js-lab-bar" type="button">进度条</button><button class="btn btn--sm btn--soft js-lab-toast" type="button">通知</button></div>
      <usa-skeleton loading avatar lines="2" class="lab__skel js-lab-skel"><p class="lab__skel-done">内容加载好了 ✓</p></usa-skeleton></div>
    <div class="lab__cell"><h3>材质 · 手势</h3><div class="lab__row">${memberBadge('METAL-01', '拉丝金属', 'brushed-metal')}${memberBadge('PEARL-01', '珍珠母贝', 'pearlescent')}
      <usa-gesture-fx gesture="long-press" effect="tada" class="lab__gesture"><button class="btn btn--sm btn--soft" type="button">长按我</button></usa-gesture-fx>
      <usa-gesture-fx gesture="fling" effect="jelly" class="lab__gesture"><button class="btn btn--sm btn--soft" type="button">甩一下</button></usa-gesture-fx></div></div>
  </div>`,
    { cls: 'lab-tile', label: '互动小样' },
  );
}

function latestTile(site: SiteData, skip: Set<string>): string {
  const list = site.posts.filter((p) => !skip.has(p.slug)).slice(0, 4);
  if (!list.length) return '';
  return tile(
    'third',
    `${kicker('history', '最近更新')}<ul class="mini-list">${list
      .map(
        (p) => `<li><a href="${postPath(p.slug)}"><span class="mini-list__thumb">${img(p.coverUrl, '', 'mini-list__img', { sizes: '64px' }) || `<span class="mini-list__ph">${icon('file')}</span>`}</span>
  <span><span class="mini-list__title">${e(p.title)}</span><time datetime="${e(pubDate(p))}">${formatDate(pubDate(p))}</time></span></a></li>`,
      )
      .join('')}</ul>${more(url('/archives/'))}`,
    { cls: 'latest-tile', rows: 2 },
  );
}

export function homePage(site: SiteData, page = 1, x: Extra = {}): Page {
  const per = Math.max(1, site.settings.postsPerPage);
  const pages = Math.max(1, Math.ceil(site.posts.length / per));
  const list = site.posts.slice((page - 1) * per, page * per);
  const s = site.settings;
  const featured = page === 1 && s.sections.featured ? (s.featuredSlugs.map((slug) => site.posts.find((p) => p.slug === slug)).filter(Boolean) as PostSummary[]) : [];
  const lead = page === 1 ? (featured[0] ?? list[0]) : undefined;
  const second = page === 1 ? [...featured.slice(1), ...list].filter((p) => p.slug !== lead?.slug).slice(0, 2) : [];
  const shown = new Set([lead?.slug, ...second.map((p) => p.slug)].filter(Boolean) as string[]);
  const rest = list.filter((p) => !shown.has(p.slug));
  if (page > 1) {
    return shell(site, { name: 'home', page }, {
      title: `第 ${page} 页`,
      top: pageHead(`第 ${page} 页`, `全部 ${site.total} 篇文章`),
      main: `${bento(list.map((p, i) => postCard(p, i, 'third')).join(''), 'bento--posts')}${pagination(page, pages)}`,
      kind: 'page--home page--list',
    });
  }
  const top = bento(`${s.sections.hero ? heroTile(site) : ''}${s.sections.about ? profileCard(site, 'third') : ''}${s.sections.hero || s.sections.about ? '' : ''}`, 'bento--top');
  const tiles = [
    lead ? postCard(lead, 0, 'half', true, undefined, featured.includes(lead)) : '',
    ...second.map((p, i) => postCard(p, i + 1, 'quarter', false, 2, featured.includes(p))),
    statsTile(site),
    viewersTile('third'),
    festivalTile(site.festivals) || announceTile(site),
    galleryTile(x.gallery ?? []),
    latestTile(site, shown),
    musicTile('twothird'),
    joinTile(),
    notesTile(x.notes ?? []),
    s.sections.tags || s.sections.categories ? tagsTile(site) : '',
    settingsTile(),
    friendsTile(x.friends ?? [], x.members ?? []),
    mailboxTile(),
    festivalTile(site.festivals) ? announceTile(site) : '',
    labTile(),
  ].join('');
  const more2 = s.sections.postList && rest.length ? `<h2 class="section-h reveal">${icon('book')}更多文章</h2>${bento(rest.map((p, i) => postCard(p, i, rest.length % 3 === 0 ? 'third' : 'quarter')).join(''), 'bento--posts')}${pagination(page, pages)}` : pagination(page, pages);
  return shell(site, { name: 'home', page }, {
    title: s.siteTitle,
    description: s.siteDescription,
    top,
    main: `${bento(tiles, 'bento--home', 'id="content"')}${more2}`,
    kind: 'page--home',
  });
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

export function postPage(site: SiteData, post: Post): Page {
  const { html, toc, chapters } = chapterize(md(post.contentMd));
  const idx = site.posts.findIndex((p) => p.slug === post.slug);
  const newer = idx > 0 ? site.posts[idx - 1] : undefined;
  const older = idx >= 0 ? site.posts[idx + 1] : undefined;
  const related = site.posts
    .filter((p) => p.slug !== post.slug)
    .map((p) => ({ p, score: p.tags.filter((t) => post.tags.includes(t)).length + (p.category && p.category === post.category ? 0.5 : 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.p);
  const words = post.wordCount || plainText(post.contentMd, 1e9).length;
  const link = postPath(post.slug);
  const pn = (p: PostSummary | undefined, label: string, cls: string) =>
    p ? tile('half', `<div class="pn__bg"${bgStyle(p.coverUrl)}></div><span class="pn__label">${label}</span><span class="pn__title">${e(p.title)}</span>`, { cls: `pn ${cls}`, href: postPath(p.slug) }) : '';
  const top = bento(
    tile(
      'full',
      `<div class="head-tile__bg"${bgStyle(post.coverUrl ?? site.settings.heroImage)}></div>
  <div class="head-tile__body post-top">
    <p class="post-top__chips">${post.category ? `<a class="chip chip--glass" href="${categoryPath(post.category)}">${icon('folder')}${e(post.category)}</a>` : ''}${post.status === 'draft' ? '<span class="chip chip--accent">草稿</span>' : ''}</p>
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
<div class="post-layout">
<article class="tile tile--full post reveal" id="post">
  <usa-double-tap class="post__body" label="双击点赞">
    <div class="prose" id="post-body">${html}</div>
  </usa-double-tap>
  <div class="post__like"><usa-like class="js-like" data-slug="${e(post.slug)}" label="喜欢这篇文章"></usa-like><span class="post__like-hint">喜欢就点个赞，或在正文上双击 ❤</span></div>
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
${related.length ? `<h2 class="section-h reveal" id="h-related">${icon('heart')}相关推荐</h2>${bento(related.map((p, i) => postCard(p, i, 'third')).join(''), 'bento--posts')}` : ''}`;
  return shell(site, { name: 'post', slug: post.slug }, {
    title: post.title,
    description: post.summary || plainText(post.contentMd),
    top,
    main,
    kind: 'page--post',
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
  const main = bento(
    [...years]
      .map(
        ([y, list]) => tile(
          'full',
          `<div class="timeline__year" id="y${y}"><h2>${y}</h2><span class="muted">${list.length} 篇</span></div><div class="timeline">${list
            .map((p) => {
              const { m } = ymd(pubDate(p));
              return `<article class="timeline__item" id="y${y}-${m}" data-date="${formatDate(pubDate(p))}">
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
      .map((p) => `<article class="swipe-card swipe-card--photo">${img(p.url, p.caption, 'swipe-card__img', { sizes: '(max-width: 768px) 90vw, 420px' })}<h4>${e(p.caption || p.album.title)}</h4><small>${e(p.album.title)}</small></article>`)
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
        .map((f) => `<article class="swipe-card"><h4>${e(f.title)}</h4><p>${e(f.description)}</p><small>${e(f.group)}</small></article>`)
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
        .map((m) => tile('third', `<usa-presence name="${e(m.name)}"${m.avatarUrl ? ` src="${e(safeHref(m.avatarUrl, true) ?? '')}"` : ''} status="offline"></usa-presence><span><b>${e(m.name)}</b><span class="member__badges">${m.badges.map((b) => memberBadge(b.code, b.label, b.style)).join('')}</span><small>${e(m.bio)}</small></span>`, { cls: 'member' }))
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
  const wall = `${kicker('pin', '便利贴墙')}<usa-sticky-wall label="访客便利贴" class="sticky-wall js-sticky-wall">${notes.filter((n) => !n.hidden).map((n) => `<p data-color="${e(n.color)}" data-id="${n.id}">${e(n.content)}<small>— ${e(n.name)}</small></p>`).join('')}</usa-sticky-wall>
<form class="note-form js-note-form" autocomplete="off">
  <input name="name" maxlength="20" placeholder="昵称" required aria-label="昵称">
  <input name="content" maxlength="60" placeholder="写一句话贴在墙上（60 字以内）" required aria-label="便利贴内容">
  <select name="color" aria-label="颜色"><option value="yellow">黄</option><option value="pink">粉</option><option value="blue">蓝</option><option value="green">绿</option></select>
  <usa-button deform="squash" morph="submit" class="js-submit-btn"><button class="btn" type="submit">贴上去</button></usa-button>
</form>`;
  return shell(site, { name: 'guestbook' }, {
    title: '留言板',
    description: '给我留言',
    top: pageHead('留言板', `${entries.length} 条留言 · ${notes.filter((n) => !n.hidden).length} 张便利贴`),
    main: bento(`${tile('half', form, { cls: 'gb-tile' })}${tile('half', `${kicker('users', '大家说')}${list}`, { cls: 'comments-tile' })}${tile('full', wall, { cls: 'wall-tile' })}`),
  });
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
  <details><summary>页面动效太多会卡吗？</summary><p>首页「显示设置」或底部 Dock 的设置里可以调动效强度、一键暂停全部动效；系统开启「减少动态效果」时会自动关闭位移动画。</p></details>
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
<p>本站不使用第三方统计和广告追踪，不读取你电脑上的其他声音、文件或账号信息。</p>
<h2 id="h-privacy-2">「谁在看网站」</h2>
<ul><li>默认只显示匿名头像（随机颜色 + 首字母），用一个随机会话 ID 计数，关闭页面后即失效；服务器不保存 IP。</li>
<li>浏览器不会把你的 Google / Edge 头像告诉网站。只有你在「成为好朋友」页<strong>主动</strong>用 Google 登录并勾选「公开头像」后，其他访客才会看到你的名字和头像，随时可以撤销。我们只保存 Google 提供的名字和头像地址，不保存其他资料。</li></ul>
<h2 id="h-privacy-3">音乐可视化</h2>
<p>频谱和声音粒子默认只分析本站播放器自己的音乐。网页无法得知你电脑上其他程序的声音；如果你点「可视化标签页声音」，浏览器会弹出共享窗口，由你选择一个标签页并勾选「分享音频」，停止共享后立即结束。</p>
<h2 id="h-privacy-4">留言、便利贴、上传与语音</h2>
<ul><li>留言需要审核后显示；便利贴被 3 位访客举报后自动隐藏，等待站长复核。只保存你填写的昵称、内容和时间。</li>
<li>「上传给我的文件」和「给我说话」只有登录的好朋友能用，有大小、类型和频率限制，只有站长能看到，审核后可删除。</li>
<li>邮箱只用来发送验证码和识别你的好朋友账号，不会出现在任何公开页面或接口里。</li></ul>
<h2 id="h-privacy-5">本地存储</h2>
<p>浏览器本地只保存：深色 / 浅色、页面风格、动效强度、点赞记录、好朋友登录状态。演示站的数据也只保存在你的浏览器里。</p>
<h2 id="h-privacy-6">图片致谢</h2>
<p>示例照片来自 Wikimedia Commons（CC0 / 公有领域 / CC BY / CC BY-SA），作者和许可写在每张照片下方和仓库 README。</p>
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
    top: pageHead('成为好朋友', '注册后可以给我上传文件、发语音，还可能领到一枚刻有专属编号的徽章。'),
    main: bento(`${tile('twothird', `<div class="join"><ol class="steps js-join-steps"><li class="is-active">填写资料</li><li>邮箱验证</li><li>完成</li></ol>
<form class="join__form js-join-form" autocomplete="on" novalidate>
  <usa-field label="昵称" name="name" required maxlength="40"></usa-field>
  <usa-field label="邮箱" name="email" type="email" required maxlength="120" hint="只用来发送验证码，不会公开"></usa-field>
  <usa-field label="一句话介绍（可选）" name="bio" maxlength="120"></usa-field>
  <usa-button deform="squash" morph="submit" class="js-submit-btn"><button class="btn btn--block" type="submit">发送验证码</button></usa-button>
</form>
<div class="join__otp js-join-otp" hidden><p>验证码已发送到 <b class="js-join-email"></b>，请输入 6 位数字<span class="js-demo-otp"></span>。</p><usa-otp length="6" label="邮箱验证码" class="js-otp"></usa-otp><p class="js-otp-msg muted" role="status"></p></div>
<div class="join__done js-join-done" hidden><usa-check kind="success" size="64" label="注册成功"></usa-check><h3>欢迎你，<span class="js-join-name"></span>！</h3><p>现在可以去 <a href="${url('/mailbox/')}">信箱</a> 给我传文件或留语音了。</p></div>
<div class="join__google"><p class="muted">或者</p><button class="btn btn--ghost js-google" type="button">${icon('globe')}用 Google 登录（可选公开头像）</button><p class="muted small">只有你同意后才会读取 Google 名字和头像；演示站不会真的连接 Google。</p></div></div>`, { cls: 'join-main', rows: 2 })}
${tile('third', `${kicker('award', '专属徽章')}<p class="muted">站长会给好朋友发徽章，编号刻在徽章上：</p><div class="join-tile__badges">${memberBadge('FRIEND-0001', '珍珠母贝', 'pearlescent')}${memberBadge('FRIEND-0002', '拉丝金属', 'brushed-metal')}</div>`, { cls: 'badge-tile' })}
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
    default:
      return notFoundPage(site);
  }
}

/** 页面区域，放在 <usa-route-transition> 里。 */
export function pageRegion(p: Page): string {
  return `<div class="page ${p.kind}" data-route="${e(routePath(p.route))}">
<main class="wrap page__main" id="main" tabindex="-1">${p.top}${p.main}${p.aside}</main></div>`;
}

/** 全站背景：固定的流体色块（颜色跟随深浅色 / 页面风格，见 styles.css 的 --blob-*）。 */
export function backdrop(): string {
  return `<usa-blobs class="bg-blobs" colors="var(--blob-1),var(--blob-2),var(--blob-3),var(--blob-4),var(--blob-5)" speed="0.5" blur="80" aria-hidden="true"></usa-blobs>`;
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
