import './styles/tokens.css';
import './styles.css';
import './sections.css';
import './features.css';
import './fixes.css';
import './motion-ui.css';
import './l12.css';
import './music-tab.css';
import './l14.css';
import './ia.css';
import './editor.css';
import './series.css';
import { api, ApiError, DEMO, request } from './api';
import { PAGE_LIMIT_MAX, walkPages } from './post-page-core';
import { applyMotion, effectiveLevel, prefersReducedMotion } from './motion';
import { renderSafe } from './sanitize';
import { applyTheme, currentMode, setMode } from './theme';
import { defineUsed, loadFeedback, loadFx, loadPage } from './usa';
import { icon } from './icons';
import { installIconMotion } from './icon-motion';
import { rememberOrigin, veilNavigate } from './route-veil';
import { pageInPlace } from './list-pager';
import { upgradeToastIcon } from './result-icon';
import {
  appHtml, backdrop, drawer, errorMain, navIndex, festivalBanner, loadingMain, navbar, needs, pageRegion, parseRoute as parsePath, renderRoute, setBasePath, setMarkdownRenderer,
  stripBase, url, postPath, tagPath, categoryPath, latestParts, SOCIAL_ROUTES, type Extra, type Page, type Route,
} from './render';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, normalizeSettings, type Post, type PostSummary, type SearchDoc, type SiteData } from './types';
import { activeFestival, type Festival } from './demo/community-types';
import { initCommunity, bindCommunity, currentMember } from './community';
import { bindSections } from './sections-client';
import { bindHomePage, installHomeClient, paintBookmarks, paintMember } from './home-client';
import { createPalette, paletteHtml, shortcutLabel } from './palette';
import { bindComments } from './comments-client';
import { bindFootnotes, bindLightbox, bindPhotoMap } from './post-media';
import { installMusicTab, musicTabHtml } from './music-tab';
import { applyReadingSettings, bindReadingSettings, bindSpeech, loadReadingSettings, stopSpeech } from './reading-tools';
import { paletteEntries } from './site-map';
import { applyAudience, audience, refreshAdmin } from './audience';
import { bindReactions, installPostDelegation, enhanceCode, enhanceHeadings, paintContinue, trackReading } from './post-client';

setMarkdownRenderer(renderSafe);
setBasePath(import.meta.env.BASE_URL);
const parseRoute = (pathname: string): Route => parsePath(stripBase(pathname));

interface Snapshot extends Partial<SiteData> {
  extra?: Extra;
}

const app = document.getElementById('app')!;
// 演示模式：数据以访客本地为准，不使用构建时快照（快照只用于无 JS 时的首屏和 SEO）
const snapshot: Snapshot = DEMO ? {} : readSnapshot();
let site: SiteData = {
  settings: normalizeSettings(snapshot.settings ?? DEFAULT_SETTINGS),
  profile: snapshot.profile ?? DEFAULT_PROFILE,
  posts: snapshot.posts ?? [],
  total: snapshot.total ?? 0,
  tags: snapshot.tags ?? [],
  categories: snapshot.categories ?? [],
};
const extra: Extra = { ...(snapshot.extra ?? {}) };
const postCache = new Map<string, Post>();
if (snapshot.extra?.post) postCache.set(snapshot.extra.post.slug, snapshot.extra.post);
let festivals: Festival[] = [];
let navToken = 0;
let current: Page | null = null;

function readSnapshot(): Snapshot {
  const el = document.getElementById('blog-data');
  if (!el?.textContent) return {};
  try {
    return JSON.parse(el.textContent) as Snapshot;
  } catch {
    return {};
  }
}

/**
 * 全部已发布文章的摘要：优先用摘要索引（一次请求、可 304），
 * 旧 Worker 没有索引接口时按游标逐页拉取（不再有 100 篇上限）。
 */
async function loadAllPosts(): Promise<{ posts: PostSummary[]; total: number }> {
  try {
    return await api.postIndex();
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 404) throw e;
  }
  return walkPages((cursor) => api.posts({ limit: PAGE_LIMIT_MAX, cursor }));
}

async function loadSite(): Promise<void> {
  const [settings, profile, list, tags, cats] = await Promise.all([
    api.settings(),
    api.profile(),
    loadAllPosts(),
    api.tags(),
    api.categories().catch(() => ({ categories: [] })),
  ]);
  site = { settings: normalizeSettings(settings), profile, posts: list.posts, total: list.total, tags: tags.tags, categories: cats.categories };
  festivals = previewFestival((await api.festivals().catch(() => ({ festivals: [] }))).festivals);
  site.festivals = festivals;
}

/** 按路由拉取额外数据（相册、友链、留言……）。旧 Worker 没有的接口返回空。 */
async function loadExtra(route: Route): Promise<Extra> {
  const want = needs(route);
  const x: Extra = {};
  await Promise.all(
    want.map(async (k) => {
      switch (k) {
        case 'post': {
          if (route.name !== 'post') return;
          let p = postCache.get(route.slug);
          if (!p) {
            try {
              p = await api.post(route.slug);
              postCache.set(p.slug, p);
            } catch (e) {
              if (e instanceof ApiError && e.status === 404) return;
              throw e;
            }
          }
          x.post = p;
          return;
        }
        case 'friends':
        case 'gallery':
        case 'favorites':
        case 'now':
        case 'works':
        case 'gear':
        case 'shelf':
        case 'timeline':
        case 'changelog':
        case 'repos':
          x[k] = (extra[k] as never) ?? ((await api.content(k).catch(() => ({ items: [] }))).items as never);
          extra[k] = x[k] as never;
          return;
        case 'projects':
          x.projects = (await api.projects().catch(() => ({ items: [] }))).items;
          return;
        case 'guestbook':
          x.guestbook = (await api.guestbook().catch(() => ({ entries: [] }))).entries;
          return;
        case 'notes':
          x.notes = (await api.notes().catch(() => ({ notes: [] }))).notes;
          return;
        case 'members':
          x.members = (await api.members().catch(() => ({ members: [] }))).members;
          return;
      }
    }),
  );
  return x;
}

/** ?festival=<id>：预览某个节日（把它的日期临时挪到今天），方便站长和自动化检查看节日瓷砖 / 横幅。只影响本次浏览。 */
function previewFestival(list: Festival[]): Festival[] {
  const id = new URLSearchParams(location.search).get('festival');
  if (!id) return list;
  const now = new Date();
  const today = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return list.map((f) => (f.id === id ? { ...f, date: today, days: Math.max(1, f.days) } : f));
}

// ---------------------------------------------------------------- 绘制
function setMeta(page: Page): void {
  document.title = page.title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', page.description);
}

function firstPaint(page: Page): void {
  app.innerHTML = appHtml(site, page);
  afterPaint(page, true);
}

function swapRegion(page: Page, html = pageRegion(page)): void {
  const rt = document.getElementById('rt');
  if (!rt) return firstPaint(page);
  rt.innerHTML = html;
  afterPaint(page, false);
}

function afterPaint(page: Page, full: boolean): void {
  current = page;
  setMeta(page);
  document.documentElement.dataset.page = page.route.name;
  updateNavCurrent(page.route);
  applyAudience();
  document.querySelectorAll('.nav__kbd').forEach((k) => (k.textContent = shortcutLabel()));
  const rt = document.getElementById('rt') ?? app;
  void defineUsed(full ? app : rt);
  applyMotion(rt, site.settings.animation);
  bindPage(page);
  onScroll();
}

function updateNavCurrent(route: Route): void {
  const idx = navIndex(route);
  document.querySelectorAll<HTMLElement>('#nav .menu').forEach((m, i) => (i === idx ? m.setAttribute('aria-current', 'page') : m.removeAttribute('aria-current')));
}

async function pageFor(route: Route): Promise<Page> {
  const x = await loadExtra(route);
  return renderRoute(route, site, x);
}

/** 新界面的标题（h1）拿到焦点：键盘 / 读屏用户导航后从新内容开始。没有 h1 时退回 <main>。 */
function focusHeading(): void {
  const h = document.querySelector<HTMLElement>('#rt h1') ?? document.getElementById('main');
  if (!h) return;
  if (!h.hasAttribute('tabindex')) h.tabIndex = -1;
  h.focus({ preventScroll: true });
}

/** 首页「最新文章」翻页：只在这一栏里转 ring，主体不动。返回 true 表示已经在原地处理。 */
async function pageListInPlace(route: Route, token: number, u: URL, pop: boolean): Promise<boolean> {
  if (route.name !== 'home' || current?.route.name !== 'home' || route.page === current.route.page) return false;
  const section = document.querySelector<HTMLElement>('#rt .js-paged');
  if (!section || !latestParts(site, route.page)) return false;
  if (!pop) history.pushState(null, '', u.pathname + u.search + u.hash);
  closeDrawer();
  closeContextMenu();
  if (palette.isOpen()) closeSearch();
  const reduced = prefersReducedMotion() || effectiveLevel(site.settings.animation) === 'off';
  void defineUsed(section);
  const parts = await pageInPlace({
    section,
    reduced,
    navOffset: document.getElementById('nav')?.getBoundingClientRect().bottom ?? 64,
    parts: async () => latestParts(site, route.page),
    alive: () => token === navToken,
    after: (sec) => {
      void defineUsed(sec);
      paintBookmarks(sec);
    },
  });
  if (parts && token === navToken && current) {
    current = { ...current, route, title: parts.docTitle };
    document.title = parts.docTitle;
  }
  return true;
}

/**
 * 站内导航：白色遮罩从点击处 / 卡片放大到全屏 → bars 加载 → 遮罩下替换界面 → 遮罩缩起（route-veil.ts）。
 * 首页翻页走 pageListInPlace（ring，只换列表）。前进 / 后退同样有转场。
 */
async function go(href: string, opts: { pop?: boolean } = {}): Promise<void> {
  stopSpeech();
  const token = ++navToken;
  const searchWasOpen = palette.isOpen(); // 导航途中才打开的面板不要被关掉
  const u = new URL(href, location.href);
  const route = parseRoute(u.pathname);
  if (await pageListInPlace(route, token, u, !!opts.pop)) return;
  if (!opts.pop) history.pushState(null, '', u.pathname + u.search + u.hash);
  closeDrawer();
  closeContextMenu();
  const reduced = prefersReducedMotion() || effectiveLevel(site.settings.animation) === 'off';
  let swapped = false;
  await veilNavigate<Page>({
    reduced,
    timeoutMs: 8000,
    load: () => pageFor(route),
    onError: (e) => ({ ...renderRoute({ name: 'notfound' }, site), route, main: errorMain((e as Error).message), title: `加载失败 · ${site.settings.siteTitle}` }),
    alive: () => token === navToken,
    swap: (page) => {
      if (searchWasOpen) closeSearch();
      swapRegion(page);
      swapped = true;
      if (!opts.pop) {
        if (u.hash) document.getElementById(decodeURIComponent(u.hash.slice(1)))?.scrollIntoView();
        else window.scrollTo(0, 0);
      }
    },
    settle: () => defineUsed(document.getElementById('rt') ?? app),
  });
  if (swapped && token === navToken) focusHeading();
}

async function rerender(): Promise<void> {
  const route = parseRoute(location.pathname);
  const page = await pageFor(route).catch((e) => ({ ...renderRoute({ name: 'notfound' }, site), main: errorMain((e as Error).message) }));
  // 站点数据变化（标题、导航计数等）：整页重绘
  firstPaint(page);
  mountChrome(true);
}

// ---------------------------------------------------------------- 全局事件
document.addEventListener('click', (ev) => {
  const t = ev.target as HTMLElement;
  if (t.closest('.js-theme')) return void toggleDark(ev);
  if (t.closest('.js-search')) return void openSearch();
  if (t.closest('.js-drawer')) return void openDrawer();
  if (t.closest('.js-drawer-close')) return void closeDrawer(true);
  if (t.closest('.retry')) return void boot();
  if (t.closest('.js-copy-link')) {
    void navigator.clipboard?.writeText(location.href).then(() => notify('链接已复制', 'success'));
    return;
  }
  if (t.closest('.js-share')) return void openShare();
  const ia = t.closest<HTMLElement>('.js-ia-action');
  if (ia) {
    closeDrawer();
    return void runAction(ia.dataset.action ?? '');
  }
  const a = t.closest('a');
  if (!a || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
  if (a.target === '_blank' || a.hasAttribute('download')) return;
  const u = new URL(a.href, location.href);
  const inSite = stripBase(u.pathname);
  const outsideBase = import.meta.env.BASE_URL !== '/' && inSite === u.pathname;
  if (u.origin !== location.origin || outsideBase || inSite.startsWith('/admin') || inSite.startsWith('/api/') || /\.\w{2,5}$/.test(inSite)) return;
  if (u.pathname === location.pathname && u.hash) {
    ev.preventDefault();
    document.getElementById(decodeURIComponent(u.hash.slice(1)))?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    closeDrawer();
    return;
  }
  ev.preventDefault();
  rememberOrigin(ev, a);
  void go(u.pathname + u.search + u.hash);
});
// 转场遮罩的起点：捕获阶段记录（<usa-route-transition> 会先于文档级监听拦下站内链接再发 usa:navigate）
document.addEventListener('click', (ev) => {
  const a = (ev.target as HTMLElement).closest?.('a');
  if (a && ev.button === 0) rememberOrigin(ev, a);
}, true);
window.addEventListener('popstate', () => void go(location.pathname + location.search, { pop: true }));
// <usa-route-transition> 自己也会拦截站内链接：交给上面的路由（它基于浏览器内的数据渲染，演示站新建的文章也能打开）
document.addEventListener('usa:navigate', (ev) => {
  ev.preventDefault();
  const u = (ev as CustomEvent<{ url: string }>).detail?.url;
  if (u && u !== location.pathname) void go(u);
});
// <usa-pagination> 的页码按钮
document.addEventListener('usa:change', (ev) => {
  const el = ev.target as HTMLElement;
  if (el.localName === 'usa-pagination') {
    const page = (ev as CustomEvent<{ page: number }>).detail?.page;
    if (page) void go(page <= 1 ? url('/') : url(`/page/${page}/`));
  }
});

async function toggleDark(ev?: MouseEvent): Promise<void> {
  const next = currentMode() === 'dark' ? 'light' : 'dark';
  if (prefersReducedMotion() || effectiveLevel(site.settings.animation) === 'off') return setMode(next);
  const { themeTransition } = await loadPage();
  await themeTransition(() => setMode(next), ev ? { x: ev.clientX, y: ev.clientY } : {}).catch(() => setMode(next));
  if (currentMode() !== next) setMode(next); // 兜底：过渡被跳过时也要切换
}

// ---------------------------------------------------------------- 导航栏：滚动后加阴影；回到顶部按钮
function onScroll(): void {
  const y = window.scrollY;
  document.getElementById('nav')?.classList.toggle('nav--solid', y > 12);
  if (y > 60) document.documentElement.dataset.scrolled = '';
  else delete document.documentElement.dataset.scrolled;
  const top = document.querySelector<HTMLElement>('.js-to-top');
  if (top) top.hidden = y < 600;
}
addEventListener('scroll', onScroll, { passive: true });

// ---------------------------------------------------------------- 抽屉菜单
type Morph = HTMLElement & { show?: (i: number | string) => void };
/** 菜单按钮里的 Motionary <usa-icon-morph>（menu ↔ close），以及按钮的 aria-expanded / aria-label。 */
function syncMenuButtons(open: boolean): void {
  document.querySelectorAll<HTMLButtonElement>('.js-drawer').forEach((b) => {
    b.setAttribute('aria-expanded', String(open));
    b.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
  });
  document.querySelectorAll<Morph>('.js-menu-morph').forEach((m) => {
    const apply = () => m.show?.(open ? 'close' : 'menu');
    if (customElements.get('usa-icon-morph')) apply();
    else void customElements.whenDefined('usa-icon-morph').then(apply);
  });
}
function openDrawer(): void {
  const d = document.getElementById('drawer');
  if (!d) return;
  if (!d.hidden && d.classList.contains('is-open')) return closeDrawer();
  d.hidden = false;
  void defineUsed(d);
  requestAnimationFrame(() => d.classList.add('is-open'));
  document.body.classList.add('drawer-open');
  syncMenuButtons(true);
  d.querySelector<HTMLElement>('.drawer__close, a, summary')?.focus();
}
function closeDrawer(returnFocus = false): void {
  const d = document.getElementById('drawer');
  if (!d || d.hidden) return;
  d.classList.remove('is-open');
  document.body.classList.remove('drawer-open');
  syncMenuButtons(false);
  if (returnFocus) document.querySelector<HTMLElement>('.nav .js-drawer')?.focus({ preventScroll: true });
  setTimeout(() => {
    if (!d.classList.contains('is-open')) d.hidden = true;
  }, 280);
}

// ---------------------------------------------------------------- ⌘K 命令面板
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
let indexPromise: Promise<SearchDoc[]> | null = null;
const palette = createPalette({
  site: () => site,
  searchIndex: () =>
    (indexPromise ??= api
      .searchIndex()
      .then((r) => r.posts)
      .catch(() => {
        indexPromise = null;
        throw new Error('index');
      })),
  go: (h) => void go(h),
  url,
  postPath,
  tagPath,
  categoryPath,
  entries: () => paletteEntries(audience()),
  isPost: () => current?.route.name === 'post',
  run: (a) => runAction(a),
});
function openSearch(prefill = ''): void {
  palette.open(prefill);
}
function closeSearch(): void {
  palette.close(false);
}
/** 分享面板（海报 + 二维码 + 系统分享）。不在文章页时分享当前页面。 */
async function openShare(): Promise<void> {
  const r = current?.route;
  const post = r?.name === 'post' ? postCache.get(r.slug) : undefined;
  const abs = new URL(location.pathname, location.href).href;
  const info = {
    title: post?.title ?? document.title,
    url: abs,
    summary: post?.summary || document.querySelector('meta[name="description"]')?.getAttribute('content') || site.settings.siteDescription,
    cover: post?.coverUrl ? new URL(post.coverUrl, location.href).href : null,
    site: site.settings.siteTitle,
    author: site.profile.name,
    date: (post?.publishedAt ?? post?.createdAt ?? new Date().toISOString()).slice(0, 10),
    category: post?.category ?? null,
  };
  try {
    const { openShareDialog } = await import('./share');
    await openShareDialog(info, (m, t) => void notify(m, t));
  } catch {
    if (navigator.share) void navigator.share({ title: info.title, url: info.url }).catch(() => undefined);
    else void navigator.clipboard?.writeText(info.url).then(() => notify('链接已复制，快去分享吧', 'success'));
  }
}

function runAction(a: string): void {
  switch (a) {
    case 'theme':
      return void toggleDark();
    case 'copy-link':
      return void navigator.clipboard?.writeText(location.href).then(() => notify('链接已复制', 'success'));
    case 'random': {
      const p = site.posts[Math.floor(Math.random() * site.posts.length)];
      if (p) void go(postPath(p.slug));
      return;
    }
    case 'top':
      return scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    case 'rss':
      return void (location.href = url('/rss.xml'));
    case 'share':
      return void openShare();
    // L23 工具栏目
    case 'palette':
      return openSearch();
    case 'music': {
      const tab = document.querySelector<HTMLButtonElement>('.js-mtab');
      if (tab && tab.getAttribute('aria-expanded') !== 'true') tab.click();
      tab?.focus({ preventScroll: true });
      return;
    }
    case 'reading': {
      if (current?.route.name === 'post') return openReading();
      const p = site.posts[0];
      if (p) void go(postPath(p.slug)).then(openReading);
      return;
    }
  }
}
/** 打开文章页的阅读设置面板（工具栏目 →「阅读设置与朗读」） */
function openReading(): void {
  const b = document.querySelector<HTMLButtonElement>('.js-rs-toggle');
  if (!b) return;
  b.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  if (b.getAttribute('aria-expanded') !== 'true') b.click();
  b.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- 右键菜单
function openContextMenu(ev: MouseEvent): void {
  const menu = document.getElementById('ctxmenu');
  if (!menu) return;
  const link = (ev.target as HTMLElement).closest('a');
  const sel = String(getSelection() ?? '').trim();
  const img = (ev.target as HTMLElement).closest('img');
  const items: [string, string, string][] = [
    ['back', 'arrowLeft', '后退'],
    ['forward', 'arrowRight', '前进'],
    ['reload', 'refresh', '刷新'],
    ['top', 'arrowUp', '回到顶部'],
  ];
  const extraItems: [string, string, string][] = [];
  if (sel) extraItems.push(['copy', 'copy', '复制选中文字'], ['search-sel', 'search', '站内搜索选中文字']);
  if (link) extraItems.push(['open-link', 'external', '新标签页打开链接'], ['copy-link', 'link', '复制链接地址']);
  if (img) extraItems.push(['open-img', 'image', '新标签页打开图片']);
  extraItems.push(['random', 'shuffle', '随便看看'], ['search', 'search', '搜索'], ['dark', currentMode() === 'dark' ? 'sun' : 'moon', currentMode() === 'dark' ? '浅色模式' : '深色模式']);
  menu.innerHTML = `<div class="ctx__row">${items.map(([k, ic, l]) => `<button type="button" data-k="${k}" title="${l}" aria-label="${l}">${icon(ic)}</button>`).join('')}</div>
<div class="ctx__list">${extraItems.map(([k, ic, l]) => `<button type="button" data-k="${k}">${icon(ic)}<span>${l}</span></button>`).join('')}</div>
<p class="ctx__tip">按住 Ctrl 再右键可打开浏览器菜单</p>`;
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(ev.clientX, innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(ev.clientY, innerHeight - r.height - 8)}px`;
  requestAnimationFrame(() => menu.classList.add('is-open'));
  menu.onclick = (e) => {
    const k = (e.target as HTMLElement).closest<HTMLElement>('[data-k]')?.dataset.k;
    if (!k) return;
    closeContextMenu();
    switch (k) {
      case 'back':
        return history.back();
      case 'forward':
        return history.forward();
      case 'reload':
        return location.reload();
      case 'top':
        return scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      case 'copy':
        return void navigator.clipboard?.writeText(sel).then(() => notify('已复制', 'success'));
      case 'search-sel':
        return openSearch(sel.slice(0, 40));
      case 'open-link':
        return void open(link!.href, '_blank', 'noopener');
      case 'copy-link':
        return void navigator.clipboard?.writeText(link!.href).then(() => notify('链接已复制', 'success'));
      case 'open-img':
        return void open(img!.currentSrc || img!.src, '_blank', 'noopener');
      case 'random': {
        const p = site.posts[Math.floor(Math.random() * site.posts.length)];
        if (p) void go(postPath(p.slug));
        return;
      }
      case 'search':
        return openSearch();
      case 'dark':
        return void toggleDark();
    }
  };
}
function closeContextMenu(): void {
  const menu = document.getElementById('ctxmenu');
  if (!menu || menu.hidden) return;
  menu.classList.remove('is-open');
  menu.hidden = true;
}
window.addEventListener('contextmenu', (ev) => {
  const t = ev.target as HTMLElement;
  if (ev.ctrlKey || ev.shiftKey || t.closest('input, textarea, [contenteditable], .no-ctx') || matchMedia('(pointer: coarse)').matches) return;
  ev.preventDefault();
  openContextMenu(ev);
}, true);
document.addEventListener('pointerdown', (ev) => {
  if (!(ev.target as HTMLElement).closest('#ctxmenu')) closeContextMenu();
});
addEventListener('scroll', closeContextMenu, { passive: true });
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    closeSearch();
    closeDrawer(true);
    closeContextMenu();
  }
  if ((ev.key.toLowerCase() === 'k' && (ev.ctrlKey || ev.metaKey) && !ev.altKey) || (ev.key === '/' && !(ev.target as HTMLElement).closest('input, textarea, select, [contenteditable]'))) {
    ev.preventDefault();
    if (palette.isOpen() && ev.key !== '/') closeSearch();
    else openSearch();
  }
});

// ---------------------------------------------------------------- 通知（usa-toaster）
// 同一条消息 1.5 秒内只弹一次；最多同时显示 2 条（<usa-toaster max="2">），出错的多停留一会儿
const lastToast = { msg: '', at: 0 };
export async function notify(msg: string, type: 'success' | 'error' | 'info' | 'warning' = 'info'): Promise<void> {
  const now = Date.now();
  if (msg === lastToast.msg && now - lastToast.at < 1500) return;
  lastToast.msg = msg;
  lastToast.at = now;
  const { toast } = await loadFeedback();
  const h = toast(msg, { type, duration: type === 'error' || type === 'warning' ? 5000 : 2800 } as never);
  upgradeToastIcon(h?.element ?? null, type);
}

// ---------------------------------------------------------------- 持久的界面部件
let chromeMounted = false;
function mountChrome(refresh = false): void {
  // 菜单（头像、计数会随数据变化）
  document.getElementById('drawer')?.remove();
  document.body.insertAdjacentHTML('beforeend', drawer(site));
  // 节日横幅
  document.querySelector('.festival--top')?.remove();
  const fest = activeFestival(festivals, new Date());
  if (fest && sessionStorage.getItem(`festival-dismissed:${fest.id}`) !== '1') {
    document.getElementById('nav')?.insertAdjacentHTML('afterend', festivalBanner(fest));
    document.querySelector('.festival--top')?.addEventListener('usa:dismiss', () => sessionStorage.setItem(`festival-dismissed:${fest.id}`, '1'));
  }
  paintMember();
  if (chromeMounted && refresh) return void defineUsed(document.body);
  chromeMounted = true;
  document.body.insertAdjacentHTML(
    'beforeend',
    `<button class="to-top js-to-top" type="button" aria-label="回到顶部" hidden>${icon('arrowUp')}</button>
${musicTabHtml()}
${paletteHtml()}
<div class="ctxmenu" id="ctxmenu" hidden role="menu"></div>
<usa-toaster label="通知" position="bottom-right" max="2"></usa-toaster>`,
  );
  document.querySelector('.js-to-top')!.addEventListener('click', () => scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' }));
  palette.mount();
  installMusicTab();
  void defineUsed(document.body);
  installHomeClient({ notify, go: (h) => void go(h), basePath: url(''), reducedMotion: prefersReducedMotion });
}

// ---------------------------------------------------------------- 画廊「随手翻」
function bindDeck(root: HTMLElement): void {
  const deck = root.querySelector<HTMLElement & { undo?: () => void }>('.js-photo-deck');
  const list = root.querySelector<HTMLElement>('.js-liked-photos');
  if (!deck || !list) return;
  const liked: string[] = [];
  const paint = () => (list.innerHTML = liked.length ? liked.map((t) => `<li>${icon('heart')}<span>${esc(t)}</span></li>`).join('') : '<li class="muted">右滑的照片会出现在这里。</li>');
  deck.addEventListener('usa:swipe', (ev) => {
    const d = (ev as CustomEvent<{ card: HTMLElement; dir: string }>).detail;
    if (d?.dir === 'right') {
      liked.unshift(d.card.querySelector('h3, h4')?.textContent ?? '照片');
      paint();
    }
  });
  deck.addEventListener('usa:empty', () => void notify('看完啦，撤销可以再翻一次', 'info'));
  root.querySelector('.js-deck-undo')?.addEventListener('click', () => deck.undo?.());
}

/** Motionary 的 <usa-native-preview> 渲染的 tablist 里按钮缺少 role="tab"（axe: aria-required-children）：补上。 */
function patchTablists(root: ParentNode): void {
  const fix = () =>
    root.querySelectorAll<HTMLElement>('[role="tablist"]').forEach((tl) => {
      tl.querySelectorAll<HTMLElement>(':scope > button:not([role])').forEach((b) => {
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(b.getAttribute('aria-pressed') === 'true' || b.classList.contains('is-active') || b.hasAttribute('data-active')));
      });
    });
  if (!root.querySelector('usa-native-preview')) return;
  void customElements.whenDefined('usa-native-preview').then(() => requestAnimationFrame(fix));
}

// ---------------------------------------------------------------- 页面级交互
function bindPage(page: Page): void {
  const root = document.getElementById('rt') ?? app;
  // 运行时间
  root.ownerDocument.querySelectorAll<HTMLElement>('.js-runtime').forEach((el) => {
    const since = el.dataset.since ? new Date(el.dataset.since) : null;
    if (since && !Number.isNaN(since.getTime())) el.textContent = `本站已运行 ${Math.max(1, Math.floor((Date.now() - since.getTime()) / 864e5))} 天`;
  });
  // 绝对链接
  root.querySelectorAll<HTMLAnchorElement>('.js-abs-link').forEach((a) => (a.textContent = a.href));
  root.querySelectorAll<HTMLElement>('.js-site-origin').forEach((s) => (s.textContent = new URL(url('/'), location.href).href));
  // 首图向下箭头
  root.querySelector('.hero__down')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    document.getElementById('content')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  });
  // 归档：日期选择 → 跳到那个月
  root.querySelector('.js-archive-date')?.addEventListener('usa:change', (ev) => {
    const v = (ev as CustomEvent<{ value: string }>).detail?.value;
    if (!v) return;
    const items = [...root.querySelectorAll<HTMLElement>('.timeline__item')];
    const target = items.find((i) => (i.dataset.date ?? '') <= v) ?? items[items.length - 1];
    target?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
    target?.classList.add('is-flash');
    setTimeout(() => target?.classList.remove('is-flash'), 1600);
  });
  // 点赞（本地记录）
  const like = root.querySelector<HTMLElement & { liked?: boolean; count?: number | null; toggle?: (f?: boolean) => void }>('.js-like');
  if (like) {
    const key = `blog-like:${like.dataset.slug}`;
    const liked = localStorage.getItem(key) === '1';
    void customElements.whenDefined('usa-like').then(() => {
      like.liked = liked;
    });
    like.addEventListener('usa:change', () => {
      localStorage.setItem(key, like.liked ? '1' : '0');
      if (like.liked) void notify('感谢喜欢 ❤', 'success');
    });
    root.querySelector('usa-double-tap')?.addEventListener('usa:double-tap', () => {
      if (!like.liked) like.toggle?.(true);
    });
  }
  bindDeck(root);
  // 代码复制、标题锚点、表情回应、阅读记录 / 继续阅读
  const pctx = { notify: (m: string, t?: 'success' | 'error' | 'info' | 'warning') => void notify(m, t), postPath, reducedMotion: prefersReducedMotion };
  installPostDelegation(pctx);
  enhanceCode(root, pctx);
  enhanceHeadings(root, pctx);
  bindReactions(root, pctx);
  paintContinue(root, pctx);
  const rp = page.route.name === 'post' ? postCache.get(page.route.slug) : undefined;
  trackReading(root, rp ? { slug: rp.slug, title: rp.title, cover: rp.coverUrl } : null, pctx);
  patchTablists(root);
  bindCommunity(root, { notify, rerender: () => rerender() });
  bindHomePage(root, { notify, go: (h) => void go(h), basePath: url(''), reducedMotion: prefersReducedMotion });
  bindSections(root, { notify, searchIndex: () => api.searchIndex(), basePath: url('') });
  // 评论、图片 lightbox、脚注预览、阅读设置、朗读、照片地图
  bindComments(root, (m, t) => void notify(m, t));
  bindLightbox(root);
  bindFootnotes(root);
  bindReadingSettings(root);
  bindSpeech(root);
  bindPhotoMap(root);
  // l14：影集、对比滑块、音频块、地图标记、引用卡片 —— 页面上有这些块时才加载交互代码
  if (root.querySelector('[data-compare], [data-audio], [data-map], [data-quote], [data-essay]')) {
    void import('./embeds-client').then((m) =>
      m.bindEmbeds(root, { notify: (msg, t) => void notify(msg, t), reducedMotion: prefersReducedMotion, siteTitle: site.settings.siteTitle, pageUrl: () => location.href }),
    );
  }
  // L20 站外回应（Webmention）：滚动到评论附近时才下载 open-client
  const wm = root.querySelector<HTMLElement>('.js-open-wm[data-kind="post"]');
  if (wm) {
    const load = () => void import('./open-client').then((m) => m.mountMentions(wm, { notify: (msg, t) => void notify(msg, t) }));
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => {
        if (es.some((x) => x.isIntersecting)) {
          io.disconnect();
          load();
        }
      }, { rootMargin: '600px 0px' });
      io.observe(wm.previousElementSibling ?? wm);
    } else load();
  }
  // L15 社交页：内容在按需加载的 social-client 里渲染（社交代码不进首屏包）
  if ((SOCIAL_ROUTES as readonly string[]).includes(page.route.name)) {
    void import('./social-client').then((m) => m.mountSocial(root, { notify: (msg, t) => void notify(msg, t), navigate: (h) => void go(h) }));
  }
  // L24 发布预览 / 即将发布：页面上有挂载点时才加载
  if (page.route.name === 'preview' || page.route.name === 'scheduled') void import('./editor-client').then((m) => m.mountEditorPages(root));
  // L25 系列详情：本机阅读进度 + 继续读第 N 篇
  if (page.route.name === 'seriesdetail') void import('./series-client').then((m) => m.mountSeriesPage(root));
  document.dispatchEvent(new CustomEvent('blog:page', { detail: { route: page.route } }));
}

/** L15：登录态变化 → 刷新导航里的通知铃 / 未读数、询问合并本机收藏；未登录时不下载社交代码。 */
function syncSocialChrome(offer: boolean): void {
  if (!currentMember()) {
    document.querySelectorAll<HTMLElement>('.js-notif-link, .js-dm-link').forEach((l) => (l.hidden = true));
    document.querySelectorAll<HTMLAnchorElement>('.js-me').forEach((a) => (a.href = url('/join/')));
    return;
  }
  void import('./social-client').then((m) => {
    void m.refreshUnread();
    if (offer) void m.offerMerge({ notify: (msg, t) => void notify(msg, t) });
  });
}
document.addEventListener('blog:member', () => syncSocialChrome(true));
document.addEventListener('blog:bookmark', (ev) => {
  const d = (ev as CustomEvent<{ slug: string; on: boolean; title: string }>).detail;
  if (d && currentMember()) void import('./social-client').then((m) => m.syncBookmark(d.slug, d.on, d.title, { notify: (msg, t) => void notify(msg, t) }));
});

// ---------------------------------------------------------------- L21 前端错误上报
/**
 * 页面脚本出错时把错误信息发给 /api/errors（服务端再做 PII 清洗、去重、限流、采样）。只发路径不发查询参数；
 * 每页最多 3 条、同一条只发一次；只上报本站脚本的错误（浏览器扩展等外部脚本忽略）；开启「请勿追踪」或 GPC 时不发送。
 */
function installErrorReporter(): void {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (nav.doNotTrack === '1' || nav.globalPrivacyControl) return;
  let sent = 0;
  const seen = new Set<string>();
  const send = (kind: string, message: string, stack = '') => {
    if (sent >= 3 || !message || seen.has(message) || /ResizeObserver loop|Script error\.?$/.test(message)) return;
    seen.add(message);
    sent++;
    void request('/api/errors', { method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true, body: JSON.stringify({ kind, message: message.slice(0, 500), stack: stack.slice(0, 4000), url: location.pathname, release: import.meta.env.VITE_APP_VERSION }) }).catch(() => undefined);
  };
  addEventListener('error', (ev) => {
    if (!(ev instanceof ErrorEvent) || (ev.filename && !ev.filename.startsWith(location.origin))) return;
    send('error', ev.message, (ev.error as Error | undefined)?.stack);
  });
  addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason as unknown;
    if (r instanceof ApiError) return; // 接口错误已经在界面上提示过
    send('unhandledrejection', r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack : '');
  });
}

// ---------------------------------------------------------------- 启动
async function boot(): Promise<void> {
  installErrorReporter();
  if (DEMO) {
    const { mountDemoBanner } = await import('./demo/client');
    mountDemoBanner({ adminHref: url('/admin/') });
  }
  applyTheme(site.settings);
  applyReadingSettings(loadReadingSettings());
  installIconMotion();
  const surface = localStorage.getItem('blog-surface');
  if (surface) document.documentElement.dataset.usaSurface = surface;
  splash();
  const route = parseRoute(location.pathname);
  const prerendered = !!document.getElementById('rt') && !DEMO;
  if (prerendered && snapshot.settings) {
    current = renderRoute(route, site, { ...extra });
    afterPaint(current, true);
  } else if (!document.getElementById('rt')) {
    app.innerHTML = `${backdrop()}${navbar(site, route)}<usa-route-transition id="rt" class="rt">${pageRegion({ ...renderRoute({ name: 'notfound' }, site), main: loadingMain(), route })}</usa-route-transition>`;
    void defineUsed(app);
  }
  try {
    await loadSite();
    applyTheme(site.settings);
    initCommunity({ notify });
    const page = await pageFor(route);
    firstPaint(page);
    mountChrome(true);
    syncSocialChrome(false);
    void refreshAdmin();
  } catch (e) {
    if (!current) {
      firstPaint({ ...renderRoute({ name: 'notfound' }, site), route, main: errorMain((e as Error).message), title: `加载失败 · ${site.settings.siteTitle}` });
      mountChrome(true);
    } else console.warn('刷新数据失败，继续使用构建时快照', e);
  }
  if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
}

/** 启动画面：头像 + 加载圈，只在本次会话第一次打开时出现。 */
function splash(): void {
  if (sessionStorage.getItem('blog-splash') || prefersReducedMotion() || effectiveLevel(site.settings.animation) === 'off') return;
  sessionStorage.setItem('blog-splash', '1');
  document.body.insertAdjacentHTML(
    'afterbegin',
    `<usa-splash exit="circle" min="650" class="splash"><div class="splash__inner"><span class="splash__logo">${esc(site.settings.siteTitle.slice(0, 1) || 'W')}</span><usa-spinner kind="windows" size="34" label="加载中"></usa-spinner></div></usa-splash>`,
  );
  const sp = document.querySelector('usa-splash');
  void defineUsed(document.body);
  // 兜底：组件没加载成功也不能挡住页面
  setTimeout(() => sp?.remove(), 4000);
  sp?.addEventListener('usa:done', () => setTimeout(() => sp.remove(), 50));
}

// ---------------------------------------------------------------- PWA：离线缓存（service worker 只在构建产物里注册，范围 = 部署前缀）
function registerSw(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || localStorage.getItem('blog-no-sw') === '1') return;
  const scope = url('/');
  addEventListener('load', () => void navigator.serviceWorker.register(url('/sw.js'), { scope }).catch(() => undefined), { once: true });
}
function offlineBadge(): void {
  const paint = () => {
    document.querySelector('.offline-badge')?.remove();
    if (!navigator.onLine) document.body.insertAdjacentHTML('beforeend', '<div class="offline-badge" role="status">离线中 · 正在显示缓存的内容</div>');
  };
  addEventListener('online', paint);
  addEventListener('offline', paint);
  if (!navigator.onLine) paint();
}

void boot();
registerSw();
offlineBadge();
