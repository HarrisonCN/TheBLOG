/**
 * 纯函数视图：浏览器与构建期预渲染（Node）共用，输出 HTML 字符串。
 * 版式参考 Hexo Butterfly 的信息结构（全屏首图、左右交替的文章卡片、右侧栏、归档时间线……），
 * 样式与代码均为本仓库原创。所有用户数据都经过 escapeHtml；正文经过安全的 Markdown 渲染器。
 *
 * <usa-*> 标签来自 Motionary：预渲染时它们只是普通元素（里面放可读的回退内容），
 * 浏览器端由 usa.ts 按需加载对应的组件定义。
 */
import { escapeHtml as e, plainText, renderMarkdown, safeHref } from './markdown';
import { icon, SOCIAL_ICON } from './icons';
import type { Album, CategoryCount, Favorite, Friend, GuestbookEntry, Post, PostSummary, Profile, Settings, SiteData, TagCount } from './types';
import type { Festival, Project, PublicMember, StickyNote } from './demo/community-types';

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

// ---------------------------------------------------------------- 页面结构
export interface Page {
  title: string;
  description: string;
  route: Route;
  /** 顶部：首页全屏首图或普通页的横幅 */
  top: string;
  /** 左侧主体 */
  main: string;
  /** 右侧栏；为空时主体占满 */
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
    match: ['gallery', 'album', 'favorites'],
    children: [
      { label: '画廊', icon: 'image', href: '/gallery/' },
      { label: '收藏', icon: 'star', href: '/favorites/' },
    ],
  },
  {
    label: '社交',
    icon: 'users',
    match: ['guestbook', 'links', 'join', 'mailbox'],
    children: [
      { label: '留言板', icon: 'message', href: '/guestbook/' },
      { label: '友链', icon: 'link', href: '/links/' },
      { label: '成为好朋友', icon: 'heart', href: '/join/' },
      { label: '信箱', icon: 'mail', href: '/mailbox/' },
    ],
  },
  {
    label: '个人',
    icon: 'user',
    match: ['about', 'privacy'],
    children: [
      { label: '关于', icon: 'user', href: '/about/' },
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

export function navbar(site: SiteData, route: Route): string {
  const items = NAV.map((it) => {
    const cur = navActive(it, route) ? ' aria-current="page"' : '';
    if (!it.children) return `<div class="menu"${cur}><a class="menu__link" href="${url(it.href!)}">${icon(it.icon)}<span>${it.label}</span></a></div>`;
    return `<div class="menu menu--group"${cur}><a class="menu__link" href="${url(it.children[0]!.href!)}" aria-haspopup="true">${icon(it.icon)}<span>${it.label}</span>${icon('chevronDown', 'menu__caret')}</a>
  <div class="menu__drop" role="menu">${it.children.map((c) => `<a role="menuitem" href="${url(c.href!)}">${icon(c.icon)}<span>${c.label}</span></a>`).join('')}</div></div>`;
  }).join('');
  return `<header class="nav" id="nav" data-transparent="${route.name === 'home' ? '1' : '1'}">
  <a class="nav__brand" href="${url('/')}">${e(site.settings.siteTitle)}</a>
  <nav class="nav__menus" aria-label="主导航"><usa-nav-morph indicator="underline" label="主导航">${items}</usa-nav-morph></nav>
  <div class="nav__tools">
    <button class="nav__btn js-search" type="button" aria-label="搜索" title="搜索 (Ctrl K)">${icon('search')}</button>
    <button class="nav__btn js-theme" type="button" aria-label="切换深色 / 浅色模式" title="切换深色 / 浅色">${icon('moon', 'only-light')}${icon('sun', 'only-dark')}</button>
    <button class="nav__btn nav__toggle js-drawer" type="button" aria-label="打开菜单" aria-expanded="false" aria-controls="drawer">${icon('menu')}</button>
  </div>
</header>`;
}

/** 手机端侧滑菜单：头像 + 计数 + 全部导航。 */
export function drawer(site: SiteData): string {
  const groups = NAV.map((it) =>
    it.children
      ? `<details class="drawer__group"><summary>${icon(it.icon)}<span>${it.label}</span>${icon('chevronDown', 'drawer__caret')}</summary>${it.children.map((c) => `<a href="${url(c.href!)}">${icon(c.icon)}<span>${c.label}</span></a>`).join('')}</details>`
      : `<a class="drawer__link" href="${url(it.href!)}">${icon(it.icon)}<span>${it.label}</span></a>`,
  ).join('');
  return `<div class="drawer" id="drawer" hidden>
  <div class="drawer__mask js-drawer-close"></div>
  <aside class="drawer__panel" aria-label="菜单">
    <div class="drawer__head">${avatarImg(site.profile, 'drawer__avatar')}<strong>${e(site.profile.name)}</strong>${counts(site)}</div>
    <nav class="drawer__nav">${groups}</nav>
  </aside>
</div>`;
}

function counts(site: SiteData): string {
  return `<div class="counts">
  <a href="${url('/archives/')}"><span>文章</span><b>${site.total}</b></a>
  <a href="${url('/tags/')}"><span>标签</span><b>${site.tags.length}</b></a>
  <a href="${url('/categories/')}"><span>分类</span><b>${site.categories.length}</b></a>
</div>`;
}

export function footer(site: SiteData): string {
  const year = new Date().getFullYear();
  const first = site.posts.length ? ymd(pubDate(site.posts[site.posts.length - 1]!)).y : String(year);
  return `<footer class="footer"${bgStyle(site.settings.heroImage)}>
  <div class="footer__inner">
    <p>©${first === String(year) ? year : `${first} – ${year}`} ${icon('heart', 'footer__heart')} ${e(site.profile.name)}</p>
    <p class="footer__sub">${e(site.settings.siteDescription)} · 前端与动效：<a href="https://github.com/HarrisonCN/Motionary" target="_blank" rel="noopener noreferrer">Motionary</a> · <a href="${url('/privacy/')}">隐私说明</a></p>
    <p class="footer__sub js-runtime" data-since="${e(site.posts.length ? pubDate(site.posts[site.posts.length - 1]!) : '')}"></p>
  </div>
</footer>`;
}

// ---------------------------------------------------------------- 首图 / 横幅
function hero(site: SiteData): string {
  const s = site.settings;
  const subs = (s.heroSubtitles.length ? s.heroSubtitles : [site.profile.tagline || s.siteDescription]).filter(Boolean);
  return `<section class="hero" id="hero"${bgStyle(s.heroImage)}>
  <div class="hero__shade"></div>
  <div class="hero__fx js-hero-fx" aria-hidden="true"></div>
  <div class="hero__info">
    <h1 class="hero__title">${e(s.siteTitle)}</h1>
    <p class="hero__sub"><usa-typewriter words="${e(subs.join('|'))}" loop>${e(subs[0] ?? '')}</usa-typewriter></p>
  </div>
  <a class="hero__down" href="#content" aria-label="向下滚动到文章">${icon('chevronDown')}</a>
</section>`;
}

function pageHeader(title: string, image: string | null | undefined, sub = ''): string {
  return `<header class="page-top"${bgStyle(image)}>
  <div class="hero__shade"></div>
  <div class="page-top__info"><h1 class="page-top__title">${e(title)}</h1>${sub ? `<p class="page-top__sub">${sub}</p>` : ''}</div>
</header>`;
}

// ---------------------------------------------------------------- 侧栏
function card(title: string, ic: string, body: string, cls = ''): string {
  return `<section class="card widget reveal${cls ? ` ${cls}` : ''}"><h2 class="widget__title">${icon(ic)}<span>${title}</span></h2>${body}</section>`;
}

export function profileCard(site: SiteData): string {
  const p = site.profile;
  const social = p.links
    .map((l) => {
      const href = safeHref(l.url);
      if (!href) return '';
      const ext = /^https?:/i.test(href);
      return `<a class="social" href="${e(href)}" title="${e(l.label)}" aria-label="${e(l.label)}"${ext ? ' target="_blank" rel="noopener noreferrer me"' : ''}>${icon(SOCIAL_ICON[l.icon ?? 'link'] ?? 'link')}</a>`;
    })
    .join('');
  const home = safeHref(p.homeUrl);
  return `<section class="card widget profile reveal">
  <div class="profile__avatar-wrap">${avatarImg(p, 'profile__avatar')}<span class="profile__online" title="在线"></span></div>
  <div class="profile__name">${e(p.name)} ${ownerBadge()}</div>
  ${p.tagline ? `<p class="profile__tagline">${e(p.tagline)}</p>` : ''}
  ${counts(site)}
  ${home ? `<usa-button deform="squash"><a class="btn btn--block profile__home" href="${e(home)}" target="_blank" rel="noopener noreferrer">${icon('github')}<span>Follow Me</span></a></usa-button>` : ''}
  ${social ? `<div class="profile__social">${social}</div>` : ''}
</section>`;
}

/** 站长徽章：珍珠母贝材质。 */
export function ownerBadge(): string {
  return `<usa-fx class="badge-fx" effect="pearlescent" trigger="load"><span class="badge badge--pearl" title="站长">站长</span></usa-fx>`;
}
/** 好朋友徽章：拉丝金属材质，刻有自定义编号。 */
export function memberBadge(code: string, label: string, style: 'pearlescent' | 'brushed-metal' = 'brushed-metal'): string {
  const cls = style === 'pearlescent' ? 'badge--pearl' : 'badge--metal';
  return `<usa-fx class="badge-fx" effect="${style}" trigger="load"><span class="badge ${cls}" title="${e(label)}"><span class="badge__code">${e(code)}</span></span></usa-fx>`;
}

function announcement(site: SiteData): string {
  if (!site.settings.sections.announcement || !site.settings.announcement) return '';
  return card('公告', 'megaphone', `<div class="widget__body prose prose--sm">${md(site.settings.announcement)}</div>`, 'widget--announce');
}

function latestWidget(site: SiteData, exclude?: string): string {
  if (!site.settings.sections.latest) return '';
  const list = site.posts.filter((p) => p.slug !== exclude).slice(0, 5);
  if (!list.length) return '';
  return card(
    '最新文章',
    'history',
    `<ul class="mini-list">${list
      .map(
        (p) => `<li><a class="mini-list__thumb" href="${postPath(p.slug)}" tabindex="-1" aria-hidden="true">${img(p.coverUrl, '', 'mini-list__img', { sizes: '64px' }) || `<span class="mini-list__ph">${icon('file')}</span>`}</a>
  <div><a class="mini-list__title" href="${postPath(p.slug)}">${e(p.title)}</a><time datetime="${e(pubDate(p))}">${formatDate(pubDate(p))}</time></div></li>`,
      )
      .join('')}</ul>`,
  );
}

function viewersWidget(): string {
  return card(
    '谁在看网站',
    'eye',
    `<div class="viewers js-viewers"><usa-avatar-stack max="6" size="34" class="viewers__stack"></usa-avatar-stack><p class="viewers__text">正在统计在线访客…</p>
<p class="viewers__hint">访客默认匿名显示。<a href="${url('/join/')}">成为好朋友</a>后可选择用 Google 头像（需你主动授权）。</p></div>`,
  );
}

export function tagCloud(tags: TagCount[], max = 40): string {
  if (!tags.length) return '<p class="empty">暂无标签。</p>';
  const top = Math.max(...tags.map((t) => t.count));
  return `<div class="tag-cloud">${tags
    .slice(0, max)
    .map((t) => {
      const size = 0.9 + (top > 1 ? (t.count - 1) / (top - 1) : 0) * 0.75;
      return `<a href="${tagPath(t.tag)}" style="--h:${hashHue(t.tag)};font-size:${size.toFixed(2)}em">${e(t.tag)}<sup>${t.count}</sup></a>`;
    })
    .join('')}</div>`;
}

function categoryList(cats: CategoryCount[]): string {
  if (!cats.length) return '<p class="empty">暂无分类。</p>';
  return `<ul class="cat-list">${cats.map((c) => `<li><a href="${categoryPath(c.category)}">${icon('folder')}<span>${e(c.category)}</span><b>${c.count}</b></a></li>`).join('')}</ul>`;
}

function archiveMonths(posts: PostSummary[]): string {
  const m = new Map<string, number>();
  for (const p of posts) {
    const { y, m: mo } = ymd(pubDate(p));
    const k = `${y}-${mo}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return `<ul class="cat-list">${[...m]
    .slice(0, 6)
    .map(([k, n]) => {
      const [y, mo] = k.split('-');
      return `<li><a href="${url('/archives/')}#y${y}-${mo}">${icon('calendar')}<span>${y} 年 ${Number(mo)} 月</span><b>${n}</b></a></li>`;
    })
    .join('')}</ul>`;
}

function siteInfo(site: SiteData): string {
  if (!site.settings.sections.stats) return '';
  const words = site.posts.reduce((a, p) => a + (p.wordCount || 0), 0);
  const last = site.posts.reduce((a, p) => (p.updatedAt > a ? p.updatedAt : a), '');
  const since = site.posts.length ? pubDate(site.posts[site.posts.length - 1]!) : '';
  return card(
    '网站资讯',
    'chart',
    `<dl class="info-list">
  <div><dt>文章数目</dt><dd>${site.total}</dd></div>
  <div><dt>已运行时间</dt><dd class="js-runtime-days" data-since="${e(since)}">${since ? `${Math.max(1, Math.floor((Date.now() - new Date(since).getTime()) / 864e5))} 天` : '—'}</dd></div>
  <div><dt>本站总字数</dt><dd>${formatCount(words)}</dd></div>
  <div><dt>最后更新</dt><dd>${formatDate(last) || '—'}</dd></div>
</dl>`,
  );
}

export function sidebar(site: SiteData, opts: { toc?: string; exclude?: string } = {}): string {
  const s = site.settings.sections;
  const sticky = [
    opts.toc ? card('目录', 'list', opts.toc, 'widget--toc') : '',
    latestWidget(site, opts.exclude),
    opts.toc ? '' : viewersWidget(),
    opts.toc ? '' : s.categories ? card('分类', 'folder', categoryList(site.categories)) : '',
    opts.toc ? '' : s.tags ? card('标签', 'tag', tagCloud(site.tags, 30)) : '',
    opts.toc ? '' : card('归档', 'archive', archiveMonths(site.posts)),
    opts.toc ? '' : siteInfo(site),
  ].join('');
  return `${s.about ? profileCard(site) : ''}${announcement(site)}<div class="aside__sticky">${sticky}</div>`;
}

// ---------------------------------------------------------------- 文章卡片
function postMeta(p: PostSummary, opts: { updated?: boolean } = {}): string {
  const date = pubDate(p);
  const showUpd = opts.updated !== false && p.updatedAt && formatDate(p.updatedAt) !== formatDate(date);
  return `<div class="post-meta">
  ${p.pinned ? `<span class="post-meta__pin">${icon('pin')}置顶</span>` : ''}
  <span>${icon('calendar')}发表于 <time datetime="${e(date)}">${formatDate(date)}</time></span>
  ${showUpd ? `<span class="post-meta__upd">${icon('history')}更新于 <time datetime="${e(p.updatedAt)}">${formatDate(p.updatedAt)}</time></span>` : ''}
  ${p.category ? `<span>${icon('folder')}<a href="${categoryPath(p.category)}">${e(p.category)}</a></span>` : ''}
  ${p.tags.length ? `<span class="post-meta__tags">${icon('tag')}${p.tags.map((t) => `<a href="${tagPath(t)}">${e(t)}</a>`).join('<i>•</i>')}</span>` : ''}
</div>`;
}

export function postCard(p: PostSummary, i: number): string {
  const cover = img(p.coverUrl, p.title, 'post-card__img', { sizes: '(max-width: 768px) 100vw, 420px', eager: i === 0 });
  return `<article class="card post-card reveal${i % 2 ? ' post-card--right' : ''}">
  <a class="post-card__cover" href="${postPath(p.slug)}" tabindex="-1" aria-hidden="true">${cover || `<span class="post-card__ph" style="--h:${hashHue(p.slug)}">${icon('file')}</span>`}</a>
  <div class="post-card__info">
    <h2 class="post-card__title"><a href="${postPath(p.slug)}">${e(p.title)}</a></h2>
    ${postMeta(p)}
    ${p.summary ? `<p class="post-card__excerpt">${e(p.summary)}</p>` : ''}
  </div>
</article>`;
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
    top: o.top ?? pageHeader(o.title, site.settings.heroImage),
    main: o.main ?? '',
    aside: o.aside ?? sidebar(site),
    kind: o.kind ?? `page--${route.name}`,
  };
}

export function homePage(site: SiteData, page = 1): Page {
  const per = Math.max(1, site.settings.postsPerPage);
  const pages = Math.max(1, Math.ceil(site.posts.length / per));
  const list = site.posts.slice((page - 1) * per, page * per);
  const s = site.settings;
  const featured = page === 1 && s.sections.featured ? (s.featuredSlugs.map((slug) => site.posts.find((p) => p.slug === slug)).filter(Boolean) as PostSummary[]) : [];
  const main = `${featured.length ? `<section class="featured reveal" aria-label="精选文章">${featured
    .map(
      (p) => `<a class="featured__item" href="${postPath(p.slug)}">${img(p.coverUrl, '', 'featured__img', { sizes: '(max-width: 768px) 100vw, 300px' })}<span class="featured__label">精选</span><span class="featured__title">${e(p.title)}</span></a>`,
    )
    .join('')}</section>` : ''}
${s.sections.postList ? (list.length ? `<div class="post-list">${list.map((p, i) => postCard(p, i)).join('')}</div>` : '<div class="card empty-card">还没有文章。</div>') : ''}
${pagination(page, pages)}`;
  return shell(site, { name: 'home', page }, {
    title: page > 1 ? `第 ${page} 页` : s.siteTitle,
    description: s.siteDescription,
    top: s.sections.hero ? hero(site) : pageHeader(s.siteTitle, s.heroImage, e(site.profile.tagline)),
    main,
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
  const nav = (p: PostSummary | undefined, label: string, cls: string) =>
    p
      ? `<a class="pn ${cls}" href="${postPath(p.slug)}"${bgStyle(p.coverUrl)}><span class="pn__label">${label}</span><span class="pn__title">${e(p.title)}</span></a>`
      : '';
  const top = `<header class="page-top page-top--post"${bgStyle(post.coverUrl ?? site.settings.heroImage)}>
  <div class="hero__shade"></div>
  <div class="post-top">
    <h1 class="post-top__title" data-split>${e(post.title)}</h1>
    ${postMeta(post)}
    <div class="post-meta post-meta--sub"><span>${icon('file')}字数总计：${formatCount(words)}</span><span>${icon('clock')}阅读时长：${readingMinutes(words)} 分钟</span>${post.status === 'draft' ? '<span class="post-meta__pin">草稿</span>' : ''}</div>
  </div>
</header>`;
  const main = `<usa-scroll-progress target="#post" label="阅读进度" class="read-progress"></usa-scroll-progress>
<article class="card post reveal" id="post">
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
${newer || older ? `<nav class="prev-next reveal" aria-label="上一篇 / 下一篇">${nav(newer, '上一篇', 'pn--prev')}${nav(older, '下一篇', 'pn--next')}</nav>` : ''}
${related.length ? `<section class="related reveal" aria-labelledby="h-related"><h2 class="section-h" id="h-related">${icon('heart')}相关推荐</h2><div class="related__grid">${related
    .map((p) => `<a class="related__item" href="${postPath(p.slug)}"${bgStyle(p.coverUrl)}><span class="related__date">${formatDate(pubDate(p))}</span><span class="related__title">${e(p.title)}</span></a>`)
    .join('')}</div></section>` : ''}`;
  const tocBody = toc ? `<usa-chapter-nav for="#post-body" orientation="vertical" label="文章目录" class="chapter-nav"${chapters ? '' : ' hidden'}></usa-chapter-nav>${toc}` : '<p class="empty">这篇文章没有小标题。</p>';
  return shell(site, { name: 'post', slug: post.slug }, {
    title: post.title,
    description: post.summary || plainText(post.contentMd),
    top,
    main,
    aside: sidebar(site, { toc: tocBody, exclude: post.slug }),
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
  const main = `<div class="card page-card reveal">
  <div class="archive-head"><h2>文章总览 - ${site.posts.length}</h2>
    <div class="archive-filter"><label for="archive-date">按日期跳转</label>
      <usa-date-picker id="archive-date" class="js-archive-date"${first ? ` min="${first}"` : ''}${last ? ` max="${last}" value="${last}"` : ''} first-day="1" locale="zh-CN"></usa-date-picker>
    </div>
  </div>
  <div class="timeline">${[...years]
    .map(
      ([y, list]) => `<div class="timeline__year" id="y${y}"><h3>${y}</h3></div>${list
        .map((p) => {
          const { m } = ymd(pubDate(p));
          return `<article class="timeline__item reveal" id="y${y}-${m}" data-date="${formatDate(pubDate(p))}">
  <a class="timeline__thumb" href="${postPath(p.slug)}" tabindex="-1" aria-hidden="true">${img(p.coverUrl, '', 'timeline__img', { sizes: '96px' }) || `<span class="mini-list__ph">${icon('file')}</span>`}</a>
  <div><time datetime="${e(pubDate(p))}">${icon('calendar')}${formatDate(pubDate(p))}</time><a class="timeline__title" href="${postPath(p.slug)}">${e(p.title)}</a></div>
</article>`;
        })
        .join('')}`,
    )
    .join('')}</div>
</div>`;
  return shell(site, { name: 'archives' }, { title: '归档', main, description: '全部文章的时间线' });
}

export function tagsPage(site: SiteData): Page {
  return shell(site, { name: 'tags' }, {
    title: '标签',
    description: '全部标签',
    main: `<div class="card page-card reveal"><h2 class="page-card__h">标签 - ${site.tags.length}</h2>${tagCloud(site.tags, 200)}</div>`,
  });
}

function listPage(site: SiteData, route: Route, title: string, list: PostSummary[], kindLabel: string): Page {
  return shell(site, route, {
    title,
    description: `${kindLabel}「${title}」下的文章`,
    top: pageHeader(title, list[0]?.coverUrl ?? site.settings.heroImage, `${kindLabel} · ${list.length} 篇文章`),
    main: list.length ? `<div class="post-list">${list.map((p, i) => postCard(p, i)).join('')}</div>` : `<div class="card empty-card">这个${kindLabel}下还没有文章。</div>`,
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
    main: `<div class="card page-card reveal"><h2 class="page-card__h">分类 - ${site.categories.length}</h2>
<div class="cat-grid">${site.categories.map((c) => `<a class="cat-tile reveal" href="${categoryPath(c.category)}"${bgStyle(covers(c.category))}><span class="cat-tile__name">${icon('folder')}${e(c.category)}</span><span class="cat-tile__count">${c.count} 篇</span></a>`).join('')}</div></div>`,
  });
}

export function galleryPage(site: SiteData, albums: Album[]): Page {
  return shell(site, { name: 'gallery' }, {
    title: '画廊',
    description: '照片相册',
    top: pageHeader('画廊', albums[0]?.cover ?? site.settings.heroImage, '用照片记录走过的地方'),
    main: albums.length
      ? `<div class="album-grid">${albums
          .map(
            (a) => `<a class="album reveal" href="${albumPath(a.slug)}">${img(a.cover || a.photos[0]?.url, a.title, 'album__img', { sizes: '(max-width: 768px) 100vw, 33vw' })}<span class="album__info"><span class="album__title">${e(a.title)}</span><span class="album__desc">${e(a.description)}</span><span class="album__count">${icon('image')}${a.photos.length} 张 · ${e(a.date)}</span></span></a>`,
          )
          .join('')}</div>`
      : '<div class="card empty-card">还没有相册。</div>',
    aside: '',
  });
}

export function albumPage(site: SiteData, album: Album | undefined, slug: string): Page {
  if (!album) return notFoundPage(site, { name: 'album', slug });
  return shell(site, { name: 'album', slug }, {
    title: album.title,
    description: album.description,
    top: pageHeader(album.title, album.cover || album.photos[0]?.url, `${e(album.description)} · ${album.photos.length} 张`),
    main: `<div class="masonry">${album.photos
      .map(
        (p, i) => `<figure class="photo reveal"><usa-double-tap label="双击喜欢这张照片">${img(p.url, p.caption, 'photo__img', { sizes: '(max-width: 768px) 100vw, 33vw', w: p.width ? 1280 : undefined, h: p.width && p.height ? Math.round((1280 * p.height) / p.width) : undefined })}</usa-double-tap>
  <figcaption><span>${e(p.caption || `照片 ${i + 1}`)}</span>${p.credit ? `<small>${p.creditUrl && safeHref(p.creditUrl) ? `<a href="${e(safeHref(p.creditUrl)!)}" target="_blank" rel="noopener noreferrer">${e(p.credit)}</a>` : e(p.credit)}</small>` : ''}</figcaption></figure>`,
      )
      .join('')}</div>
<p class="back-link"><a href="${url('/gallery/')}">${icon('arrowLeft')}返回画廊</a></p>`,
    aside: '',
  });
}

export function favoritesPage(site: SiteData, favs: Favorite[], projects: Project[]): Page {
  const groups = new Map<string, Favorite[]>();
  for (const f of favs) groups.set(f.group || '其他', [...(groups.get(f.group || '其他') ?? []), f]);
  const proj = projects.length
    ? `<section class="reveal"><h2 class="section-h">${icon('box')}我的项目</h2>
<div class="project-grid">${projects
        .map(
          (p) => `<usa-plugin-card name="${e(p.name)}" title="${e(p.title)}" version="${e(p.version)}" author="${e(p.author)}" engine="${e(p.engine)}" downloads="${p.downloads}" class="project">
  <p>${e(p.description)}</p>${safeHref(p.url) ? `<a href="${e(safeHref(p.url)!)}" target="_blank" rel="noopener noreferrer">${icon('github')}查看仓库</a>` : ''}
</usa-plugin-card>`,
        )
        .join('')}</div>
<div class="spatial-row"><usa-spatial-card class="spatial"><h3 data-depth="2">动效预览</h3><p data-depth="1">同一套动效在手机上的感觉：</p>
  <usa-native-preview platform="ios" name="博客卡片" rules="enter: fade-up 500ms smooth stagger 80ms; click: pop"><div class="np-row">最新文章</div><div class="np-row">画廊</div><div class="np-row">留言板</div></usa-native-preview>
</usa-spatial-card>
<div class="swipe-wrap"><h3>随手翻翻收藏</h3><p class="muted">向右滑「想看」，向左滑「跳过」</p><usa-swipe-deck threshold="110" label="收藏卡片" class="swipe">${favs
        .slice(0, 6)
        .map((f) => `<article class="swipe-card"><h4>${e(f.title)}</h4><p>${e(f.description)}</p><small>${e(f.group)}</small></article>`)
        .join('')}</usa-swipe-deck></div></div></section>`
    : '';
  return shell(site, { name: 'favorites' }, {
    title: '收藏',
    description: '常用网站与资源',
    main: `${proj}${[...groups]
      .map(
        ([g, list]) => `<section class="reveal"><h2 class="section-h">${icon('star')}${e(g)}</h2><div class="fav-grid">${list
          .map((f) => {
            const href = safeHref(f.url);
            return `<a class="card fav" ${href ? `href="${e(href)}" target="_blank" rel="noopener noreferrer"` : ''}><span class="fav__icon" style="--h:${hashHue(f.title)}">${e(f.title.slice(0, 1))}</span><span><b>${e(f.title)}</b><small>${e(f.description)}</small></span></a>`;
          })
          .join('')}</div></section>`,
      )
      .join('')}`,
    aside: '',
  });
}

export function linksPage(site: SiteData, friends: Friend[], members: PublicMember[] = []): Page {
  return shell(site, { name: 'links' }, {
    title: '友链',
    description: '朋友们的网站',
    main: `<div class="card page-card reveal"><h2 class="page-card__h">${icon('link')}友情链接</h2>
<div class="friend-grid">${friends
      .map((f) => {
        const href = safeHref(f.url);
        return `<a class="friend" ${href ? `href="${e(href)}" target="_blank" rel="noopener noreferrer"` : ''}>${img(f.avatar, f.name, 'friend__avatar') || `<span class="friend__avatar friend__avatar--txt" style="--h:${hashHue(f.name)}">${e(f.name.slice(0, 1))}</span>`}<span class="friend__info"><b>${e(f.name)}</b><small>${e(f.description)}</small></span></a>`;
      })
      .join('')}</div></div>
${members.length ? `<div class="card page-card reveal"><h2 class="page-card__h">${icon('heart')}好朋友</h2><div class="member-grid">${members
      .map((m) => `<div class="member"><usa-presence name="${e(m.name)}"${m.avatarUrl ? ` src="${e(safeHref(m.avatarUrl, true) ?? '')}"` : ''} status="offline"></usa-presence><span><b>${e(m.name)}</b> ${m.badges.map((b) => memberBadge(b.code, b.label, b.style)).join('')}<small>${e(m.bio)}</small></span></div>`)
      .join('')}</div><p class="muted">想出现在这里？<a href="${url('/join/')}">注册成为好朋友</a>。</p></div>` : ''}
<div class="card page-card reveal"><h2 class="page-card__h">${icon('plus')}申请友链</h2>
<usa-disclosure class="faq"><details><summary>友链要求</summary><p>原创内容为主、能正常访问、没有违法和广告内容。互换前请先在本站加上我的链接。</p></details>
<details><summary>本站信息</summary><p>名称：${e(site.settings.siteTitle)}<br>简介：${e(site.settings.siteDescription)}<br>地址：<span class="js-site-origin">${url('/')}</span></p></details>
<details><summary>怎么申请</summary><p>在<a href="${url('/guestbook/')}">留言板</a>留下你的网站名称、地址、头像和一句话简介，审核后会出现在上面。</p></details></usa-disclosure></div>`,
  });
}

export function guestbookPage(site: SiteData, entries: GuestbookEntry[] = [], notes: StickyNote[] = []): Page {
  const list = entries.length
    ? `<ol class="comments">${entries
        .map(
          (c) => `<li class="comment reveal"><usa-presence name="${e(c.name)}" status="offline" class="comment__avatar"></usa-presence><div class="comment__body"><div class="comment__head"><b>${c.website && safeHref(c.website) ? `<a href="${e(safeHref(c.website)!)}" target="_blank" rel="noopener noreferrer nofollow">${e(c.name)}</a>` : e(c.name)}</b><time datetime="${e(c.createdAt)}">${formatDate(c.createdAt)}</time></div><p>${e(c.content)}</p></div></li>`,
        )
        .join('')}</ol>`
    : '<p class="empty">还没有留言，来做第一个吧。</p>';
  const wall = `<section class="card page-card reveal"><h2 class="page-card__h">${icon('pin')}便利贴墙</h2>
<usa-sticky-wall label="访客便利贴" class="sticky-wall js-sticky-wall">${notes.filter((n) => !n.hidden).map((n) => `<p data-color="${e(n.color)}" data-id="${n.id}">${e(n.content)}<small>— ${e(n.name)}</small></p>`).join('')}</usa-sticky-wall>
<form class="note-form js-note-form" autocomplete="off">
  <input name="name" maxlength="20" placeholder="昵称" required aria-label="昵称">
  <input name="content" maxlength="60" placeholder="写一句话贴在墙上（60 字以内）" required aria-label="便利贴内容">
  <select name="color" aria-label="颜色"><option value="yellow">黄</option><option value="pink">粉</option><option value="blue">蓝</option><option value="green">绿</option></select>
  <usa-button deform="squash" morph="submit" class="js-submit-btn"><button class="btn" type="submit">贴上去</button></usa-button>
</form></section>`;
  return shell(site, { name: 'guestbook' }, {
    title: '留言板',
    description: '给我留言',
    main: `<section class="card page-card reveal"><h2 class="page-card__h">${icon('message')}留言板</h2>
<form class="gb-form js-gb-form" autocomplete="off">
  <div class="gb-form__row"><usa-field label="昵称" name="name" required maxlength="40"></usa-field><usa-field label="网站（可选）" name="website" type="url" maxlength="200"></usa-field></div>
  <label class="visually-hidden" for="gb-content">留言内容</label>
  <textarea id="gb-content" name="content" rows="4" maxlength="1000" required placeholder="说点什么吧……（留言需要审核后显示）"></textarea>
  <div class="gb-form__foot"><span class="muted">请文明发言 · 不收集你的邮箱与 IP</span><usa-button deform="squash" morph="submit" class="js-submit-btn"><button class="btn" type="submit">${icon('message')}发送</button></usa-button></div>
</form>
${list}</section>${wall}`,
  });
}

export function aboutPage(site: SiteData, members: PublicMember[] = []): Page {
  const p = site.profile;
  return shell(site, { name: 'about' }, {
    title: '关于',
    description: p.tagline || plainText(p.bioMd),
    main: `<section class="card page-card about reveal">
  <div class="about__head">${avatarImg(p, 'about__avatar')}<div><h2 class="about__name">${e(p.name)} ${ownerBadge()}</h2>
  ${p.tagline ? `<p class="about__tagline"><usa-shimmer-text>${e(p.tagline)}</usa-shimmer-text></p>` : ''}
  <p class="about__roles">我是 <usa-text-rotate words="摄影专业的学生|产品体验测试者|动效库作者|夜景爱好者">摄影专业的学生</usa-text-rotate></p>
  ${p.location ? `<p class="muted">${icon('mapPin')}${e(p.location)}</p>` : ''}</div></div>
  <div class="prose">${md(p.bioMd || '这个人很懒，还没有写简介。')}</div>
</section>
<usa-scroll-scene class="scene" start="top 85%" end="bottom 40%" scrub="120" stagger="120">
  <div class="scene__grid">
    <div class="card scene__item" data-scrub="y: 60 -> 0; opacity: 0 -> 1">${icon('camera')}<b>${site.posts.filter((x) => x.category === '摄影').length}</b><span>篇摄影笔记</span></div>
    <div class="card scene__item" data-scrub="y: 60 -> 0; opacity: 0 -> 1">${icon('tag')}<b>${site.tags.length}</b><span>个标签</span></div>
    <div class="card scene__item" data-scrub="y: 60 -> 0; opacity: 0 -> 1">${icon('users')}<b>${members.length}</b><span>位好朋友</span></div>
  </div>
</usa-scroll-scene>
<section class="card page-card reveal"><h2 class="page-card__h">${icon('message')}常见问题</h2>
<usa-disclosure class="faq">
  <details><summary>这个博客用什么搭的？</summary><p>静态前端 + Cloudflare Worker（D1 存文章、R2 存图片），自带 MCP 端点，AI 助手可以直接帮我写草稿。动效全部来自我自己写的 Motionary。</p></details>
  <details><summary>页面动效太多会卡吗？</summary><p>右下角「设置」里可以调动效强度、一键暂停全部动效；系统开启「减少动态效果」时会自动关闭位移动画。</p></details>
  <details><summary>你会收集我的数据吗？</summary><p>不会追踪你。详见 <a href="${url('/privacy/')}">隐私说明</a>。</p></details>
</usa-disclosure></section>`,
  });
}

export function privacyPage(site: SiteData): Page {
  return shell(site, { name: 'privacy' }, {
    title: '隐私说明',
    description: '本站如何处理你的数据',
    main: `<article class="card page-card prose reveal">
<h2 id="h-privacy-1">一句话版本</h2>
<p>本站不使用第三方统计和广告追踪，不读取你电脑上的其他声音、文件或账号信息。</p>
<h2 id="h-privacy-2">「谁在看网站」</h2>
<ul><li>默认只显示匿名头像（随机颜色 + 首字母），用一个随机会话 ID 计数，关闭页面后即失效。</li>
<li>浏览器不会把你的 Google / Edge 头像告诉网站。只有你在「成为好朋友」页<strong>主动</strong>用 Google 登录并勾选「公开头像」后，其他访客才会看到你的头像，随时可以撤销。</li></ul>
<h2 id="h-privacy-3">音乐可视化</h2>
<p>频谱和声音粒子默认只分析本站播放器自己的音乐。网页无法得知你电脑上其他程序的声音；如果你点「可视化标签页声音」，浏览器会弹出共享窗口，由你选择一个标签页并勾选「分享音频」，停止共享后立即结束。</p>
<h2 id="h-privacy-4">留言、便利贴、上传与语音</h2>
<ul><li>留言与便利贴需要审核或可被举报隐藏；只保存你填写的昵称、内容和时间。</li>
<li>「上传给我的文件」和「给我说话」只有登录的好朋友能用，有大小限制，只有站长能看到，审核后可删除。</li>
<li>邮箱只用来发送验证码，不会公开。</li></ul>
<h2 id="h-privacy-5">本地存储</h2>
<p>浏览器本地只保存：深色 / 浅色、主题、动效强度、点赞记录${site.settings.siteTitle ? '' : ''}。演示站的数据也只保存在你的浏览器里。</p>
<h2 id="h-privacy-6">图片致谢</h2>
<p>示例照片来自 Wikimedia Commons（CC0 / 公有领域 / CC BY / CC BY-SA），作者和许可写在每张照片下方和仓库 README。</p>
</article>`,
  });
}

export function joinPage(site: SiteData): Page {
  return shell(site, { name: 'join' }, {
    title: '成为好朋友',
    description: '注册成为好朋友',
    main: `<section class="card page-card join reveal"><h2 class="page-card__h">${icon('heart')}注册成为好朋友</h2>
<p class="muted">好朋友可以给我上传文件、发语音、在友链页展示自己，还可能获得一枚刻有专属编号的徽章。</p>
<ol class="steps js-join-steps"><li class="is-active">填写资料</li><li>邮箱验证</li><li>完成</li></ol>
<form class="join__form js-join-form" autocomplete="on" novalidate>
  <usa-field label="昵称" name="name" required maxlength="40"></usa-field>
  <usa-field label="邮箱" name="email" type="email" required maxlength="120" hint="只用来发送验证码，不会公开"></usa-field>
  <usa-field label="一句话介绍（可选）" name="bio" maxlength="120"></usa-field>
  <usa-button deform="squash" morph="submit" class="js-submit-btn"><button class="btn btn--block" type="submit">发送验证码</button></usa-button>
</form>
<div class="join__otp js-join-otp" hidden><p>验证码已发送到 <b class="js-join-email"></b>，请输入 6 位数字<span class="js-demo-otp"></span>。</p><usa-otp length="6" label="邮箱验证码" class="js-otp"></usa-otp><p class="js-otp-msg muted" role="status"></p></div>
<div class="join__done js-join-done" hidden><usa-check kind="success" size="64" label="注册成功"></usa-check><h3>欢迎你，<span class="js-join-name"></span>！</h3><p>现在可以去 <a href="${url('/mailbox/')}">信箱</a> 给我传文件或留语音了。</p></div>
<div class="join__google"><p class="muted">或者</p><button class="btn btn--ghost js-google" type="button">${icon('globe')}用 Google 登录（可选公开头像）</button><p class="muted small">只有你同意后才会读取 Google 头像；演示站不会真的连接 Google。</p></div>
</section>`,
  });
}

export function mailboxPage(site: SiteData): Page {
  return shell(site, { name: 'mailbox' }, {
    title: '信箱',
    description: '上传给我的文件 · 给我说话',
    main: `<section class="card page-card reveal"><h2 class="page-card__h">${icon('upload')}上传给我的文件</h2>
<p class="muted">仅限好朋友 · 单个文件 ≤ 10 MB（演示站 ≤ 2 MB）· 只有站长能看到，审核后保留。</p>
<div class="mailbox__gate js-member-gate"><p>请先 <a href="${url('/join/')}">注册成为好朋友</a>。</p></div>
<form class="upload js-upload" hidden><label class="upload__drop"><input type="file" name="file" class="js-upload-input"><span>${icon('upload')}点击或拖入文件</span></label><input name="note" maxlength="200" placeholder="附言（可选）" aria-label="附言"><div class="upload__list js-upload-list"></div></form>
</section>
<section class="card page-card reveal"><h2 class="page-card__h">${icon('message')}给我说话</h2>
<p class="muted">按住 / 点击麦克风开始录音（最长 60 秒），松开后可以试听再发送。需要你允许浏览器使用麦克风。</p>
<div class="voice js-voice"><usa-voice-button label="按下开始录音" bars="5" class="js-voice-btn"></usa-voice-button><div class="voice__panel"><p class="js-voice-status muted" role="status">准备就绪</p><audio class="js-voice-audio" controls hidden></audio>
<usa-hold duration="900" class="js-voice-send" hidden>长按发送</usa-hold></div></div>
</section>`,
  });
}

export function notFoundPage(site: SiteData, route: Route = { name: 'notfound' }): Page {
  return shell(site, route, {
    title: '页面不存在',
    description: '',
    main: `<section class="card page-card state reveal"><usa-check kind="warning" size="72" label="页面不存在"></usa-check><h2>404</h2><p>页面不存在或文章已下线。</p><a class="btn" href="${url('/')}">${icon('home')}返回首页</a></section>`,
  });
}

export function loadingMain(): string {
  return `<div class="card page-card state" role="status" aria-live="polite"><usa-spinner kind="ring" size="40" label="加载中"></usa-spinner><span class="visually-hidden">加载中…</span>
  <usa-skeleton loading lines="4" class="state__skeleton"></usa-skeleton></div>`;
}

export function errorMain(message: string): string {
  return `<section class="card page-card state" role="alert"><usa-check kind="error" size="64" label="加载失败"></usa-check><h2>加载失败</h2><p>${e(message)}</p><button class="btn retry" type="button">${icon('refresh')}重试</button></section>`;
}

/** 路由 → 页面。 */
export function renderRoute(route: Route, site: SiteData, x: Extra = {}): Page {
  switch (route.name) {
    case 'home': {
      const pages = Math.max(1, Math.ceil(site.posts.length / Math.max(1, site.settings.postsPerPage)));
      return route.page > pages ? notFoundPage(site) : homePage(site, route.page);
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

/** 页面区域（顶部 + 主体 + 侧栏），放在 <usa-route-transition> 里。 */
export function pageRegion(p: Page): string {
  return `<div class="page ${p.kind}" data-route="${e(routePath(p.route))}">${p.top}
<div class="layout${p.aside ? '' : ' layout--full'}" id="content">
  <main class="layout__main" id="main" tabindex="-1">${p.main}</main>
  ${p.aside ? `<aside class="layout__aside" aria-label="侧栏">${p.aside}</aside>` : ''}
</div></div>`;
}

/** 整个 #app 的内容（预渲染与浏览器首屏共用）。 */
export function appHtml(site: SiteData, p: Page): string {
  return `${navbar(site, p.route)}
<usa-route-transition id="rt" effect="fade" class="rt">${pageRegion(p)}</usa-route-transition>
${footer(site)}`;
}

/** 节日横幅（只在节日当天渲染）。 */
export function festivalBanner(f: Festival | null): string {
  if (!f) return '';
  return `<usa-festival-banner theme="${e(f.theme)}" label="${e(f.name)}" dismissible class="festival">${e(f.message)}</usa-festival-banner>`;
}
