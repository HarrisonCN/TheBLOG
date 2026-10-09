import './styles.css';
import { api, ApiError, DEMO } from './api';
import { applyMotion, effectiveLevel, prefersReducedMotion } from './motion';
import { renderSafe } from './sanitize';
import { applyTheme, currentMode, setMode } from './theme';
import { defineUsed, loadFeedback, loadFx, loadPage } from './usa';
import { icon } from './icons';
import {
  appHtml, drawer, errorMain, navIndex, festivalBanner, loadingMain, navbar, needs, pageRegion, parseRoute as parsePath, renderRoute, setBasePath, setMarkdownRenderer,
  stripBase, url, postPath, type Extra, type Page, type Route,
} from './render';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, normalizeSettings, type Post, type SearchDoc, type SiteData } from './types';
import { activeFestival, type Festival } from './demo/community-types';
import { initCommunity, bindCommunity } from './community';

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

async function loadSite(): Promise<void> {
  const [settings, profile, list, tags, cats] = await Promise.all([
    api.settings(),
    api.profile(),
    api.posts({ limit: 100 }),
    api.tags(),
    api.categories().catch(() => ({ categories: [] })),
  ]);
  site = { settings: normalizeSettings(settings), profile, posts: list.posts, total: list.total, tags: tags.tags, categories: cats.categories };
  festivals = (await api.festivals().catch(() => ({ festivals: [] }))).festivals;
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
  const rt = document.getElementById('rt') ?? app;
  void defineUsed(full ? app : rt);
  applyMotion(rt, site.settings.animation);
  bindPage(page);
  onScroll();
}

function updateNavCurrent(route: Route): void {
  const idx = navIndex(route);
  const morph = document.querySelector<HTMLElement & { setActive?: (i: number, user?: boolean) => void }>('#nav usa-nav-morph');
  const menus = document.querySelectorAll<HTMLElement>('#nav .menu');
  menus.forEach((m, i) => (i === idx ? m.setAttribute('aria-current', 'page') : m.removeAttribute('aria-current')));
  if (idx >= 0) morph?.setActive?.(idx);
  morph?.classList.toggle('nav-morph--none', idx < 0);
}

async function pageFor(route: Route): Promise<Page> {
  const x = await loadExtra(route);
  return renderRoute(route, site, x);
}

/** 站内导航：Motionary pageTransition（View Transitions / WAAPI 回退）包住内容替换。 */
async function go(href: string, opts: { pop?: boolean } = {}): Promise<void> {
  const token = ++navToken;
  const u = new URL(href, location.href);
  if (!opts.pop) history.pushState(null, '', u.pathname + u.search + u.hash);
  const route = parseRoute(u.pathname);
  const slow = setTimeout(() => {
    if (token === navToken) swapRegion({ ...(current as Page), main: loadingMain() });
  }, 250);
  let page: Page;
  try {
    page = await pageFor(route);
  } catch (e) {
    page = { ...renderRoute({ name: 'notfound' }, site), main: errorMain((e as Error).message), title: `加载失败 · ${site.settings.siteTitle}` };
  }
  clearTimeout(slow);
  if (token !== navToken) return;
  closeDrawer();
  closeSearch();
  closeContextMenu();
  const swap = () => {
    swapRegion(page);
    if (!opts.pop) {
      if (u.hash) document.getElementById(decodeURIComponent(u.hash.slice(1)))?.scrollIntoView();
      else window.scrollTo(0, 0);
    }
  };
  if (effectiveLevel(site.settings.animation) === 'off' || prefersReducedMotion()) swap();
  else {
    const { pageTransition } = await loadPage();
    await pageTransition(swap, { effect: 'fade', duration: 380 }).catch(swap);
  }
  if (!opts.pop) document.getElementById('main')?.focus({ preventScroll: true });
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
  if (t.closest('.js-drawer-close')) return void closeDrawer();
  if (t.closest('.retry')) return void boot();
  if (t.closest('.js-copy-link')) {
    void navigator.clipboard?.writeText(location.href).then(() => notify('链接已复制', 'success'));
    return;
  }
  if (t.closest('.js-share')) {
    const data = { title: document.title, url: location.href };
    if (navigator.share) void navigator.share(data).catch(() => undefined);
    else void navigator.clipboard?.writeText(location.href).then(() => notify('链接已复制，快去分享吧', 'success'));
    return;
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
  void go(u.pathname + u.search + u.hash);
});
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
  syncDarkControls();
}
function syncDarkControls(): void {
  const dark = currentMode() === 'dark';
  document.querySelectorAll<HTMLElement & { on?: boolean; checked?: boolean }>('usa-pull-cord, .js-dark-switch').forEach((el) => {
    if (el.localName === 'usa-pull-cord') {
      if (el.on !== dark) el.on = dark;
    } else if (el.checked !== dark) el.checked = dark;
  });
}

// ---------------------------------------------------------------- 导航栏：透明 → 实色，向下滚动时收起
let lastY = 0;
function onScroll(): void {
  const y = window.scrollY;
  const nav = document.getElementById('nav');
  if (nav) {
    nav.classList.toggle('nav--solid', y > 60);
    nav.classList.toggle('nav--hidden', y > 320 && y > lastY && !document.body.classList.contains('drawer-open'));
  }
  lastY = y;
  if (y > 60) document.documentElement.dataset.scrolled = '';
  else delete document.documentElement.dataset.scrolled;
  const max = document.documentElement.scrollHeight - innerHeight;
  const pct = max > 0 ? Math.min(100, Math.round((y / max) * 100)) : 0;
  const top = document.querySelector<HTMLElement>('.js-to-top');
  if (top) {
    top.dataset.pct = String(pct);
    top.querySelector('.rs-pct')!.textContent = pct > 0 ? `${pct}` : '';
  }
  document.getElementById('rightside')?.classList.toggle('rightside--show', y > 160);
}
addEventListener('scroll', onScroll, { passive: true });

// ---------------------------------------------------------------- 抽屉菜单
function openDrawer(): void {
  const d = document.getElementById('drawer');
  if (!d) return;
  d.hidden = false;
  requestAnimationFrame(() => d.classList.add('is-open'));
  document.body.classList.add('drawer-open');
  document.querySelector('.js-drawer')?.setAttribute('aria-expanded', 'true');
  d.querySelector<HTMLElement>('a, summary')?.focus();
}
function closeDrawer(): void {
  const d = document.getElementById('drawer');
  if (!d || d.hidden) return;
  d.classList.remove('is-open');
  document.body.classList.remove('drawer-open');
  document.querySelector('.js-drawer')?.setAttribute('aria-expanded', 'false');
  setTimeout(() => (d.hidden = true), 280);
}

// ---------------------------------------------------------------- 本地搜索
let searchDocs: SearchDoc[] | null = null;
function openSearch(): void {
  const m = document.getElementById('search');
  if (!m) return;
  m.hidden = false;
  requestAnimationFrame(() => m.classList.add('is-open'));
  const input = m.querySelector<HTMLInputElement>('input')!;
  input.focus();
  if (!searchDocs) {
    void api
      .searchIndex()
      .then((r) => (searchDocs = r.posts))
      .catch(() => (searchDocs = site.posts.map((p) => ({ slug: p.slug, title: p.title, summary: p.summary, tags: p.tags, category: p.category, text: p.summary }))))
      .then(() => runSearch(input.value));
  }
}
function closeSearch(): void {
  const m = document.getElementById('search');
  if (!m || m.hidden) return;
  m.classList.remove('is-open');
  setTimeout(() => (m.hidden = true), 200);
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
function hl(text: string, q: string): string {
  if (!q) return esc(text);
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(text);
  return `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
}
function runSearch(raw: string): void {
  const out = document.getElementById('search-results');
  if (!out) return;
  const q = raw.trim();
  if (!q) {
    out.innerHTML = '<p class="search__hint">输入关键词，搜索标题、正文、标签和分类。</p>';
    return;
  }
  if (!searchDocs) {
    out.innerHTML = '<p class="search__hint"><usa-spinner kind="dots" size="28" label="加载索引"></usa-spinner></p>';
    void defineUsed(out);
    return;
  }
  const ql = q.toLowerCase();
  const hits = searchDocs
    .map((d) => {
      const inTitle = d.title.toLowerCase().includes(ql);
      const inMeta = d.tags.some((t) => t.toLowerCase().includes(ql)) || (d.category ?? '').toLowerCase().includes(ql);
      const pos = d.text.toLowerCase().indexOf(ql);
      const score = (inTitle ? 10 : 0) + (inMeta ? 4 : 0) + (pos >= 0 ? 1 : 0);
      const snip = pos >= 0 ? d.text.slice(Math.max(0, pos - 30), pos + 70) : d.summary;
      return { d, score, snip };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  out.innerHTML = hits.length
    ? `<p class="search__count">找到 ${hits.length} 篇文章</p><ul class="search__list">${hits
        .map((h) => `<li><a href="${postPath(h.d.slug)}"><b>${hl(h.d.title, q)}</b><span>${hl(h.snip, q)}</span></a></li>`)
        .join('')}</ul>`
    : `<p class="search__hint">没有找到与「${esc(q)}」相关的文章。</p>`;
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
  extraItems.push(['random', 'shuffle', '随便看看'], ['search', 'search', '搜索'], ['dark', currentMode() === 'dark' ? 'sun' : 'moon', currentMode() === 'dark' ? '浅色模式' : '深色模式'], ['pause', 'clock', document.documentElement.dataset.paused ? '恢复动效' : '暂停全部动效']);
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
      case 'search-sel': {
        openSearch();
        const input = document.querySelector<HTMLInputElement>('#search input');
        if (input) {
          input.value = sel.slice(0, 40);
          runSearch(input.value);
        }
        return;
      }
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
      case 'pause':
        return void (document.querySelector('usa-pause-all') as (HTMLElement & { toggle?: () => void }) | null)?.toggle?.();
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
  if (!(ev.target as HTMLElement).closest('.rs-settings, .js-settings')) document.getElementById('settings-panel')?.classList.remove('is-open');
});
addEventListener('scroll', closeContextMenu, { passive: true });
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    closeSearch();
    closeDrawer();
    closeContextMenu();
    document.getElementById('settings-panel')?.classList.remove('is-open');
  }
  if ((ev.key === 'k' && (ev.ctrlKey || ev.metaKey)) || (ev.key === '/' && !(ev.target as HTMLElement).closest('input, textarea, [contenteditable]'))) {
    ev.preventDefault();
    openSearch();
  }
});

// ---------------------------------------------------------------- 通知（usa-toaster）
export async function notify(msg: string, type: 'success' | 'error' | 'info' | 'warning' = 'info'): Promise<void> {
  const { toast } = await loadFeedback();
  toast(msg, { type } as never);
}

// ---------------------------------------------------------------- 持久的界面部件
let chromeMounted = false;
function mountChrome(refresh = false): void {
  // 抽屉（头像、计数会随数据变化）
  document.getElementById('drawer')?.remove();
  document.body.insertAdjacentHTML('beforeend', drawer(site));
  // 节日横幅
  document.querySelector('.festival')?.remove();
  const fest = activeFestival(festivals, new Date());
  if (fest && sessionStorage.getItem(`festival-dismissed:${fest.id}`) !== '1') {
    document.getElementById('nav')?.insertAdjacentHTML('afterend', festivalBanner(fest));
    document.querySelector('.festival')?.addEventListener('usa:dismiss', () => sessionStorage.setItem(`festival-dismissed:${fest.id}`, '1'));
  }
  if (chromeMounted && refresh) return void defineUsed(document.body);
  chromeMounted = true;
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div class="rightside" id="rightside">
  <div class="rightside__panel" id="settings-panel" role="dialog" aria-label="显示设置">
    <h2>${icon('settings')}显示设置</h2>
    <div class="set-row"><span>深色模式</span><usa-switch variant="daynight" class="js-dark-switch" label="深色模式"></usa-switch></div>
    <div class="set-row set-row--col"><span>页面风格</span><usa-theme-switcher themes="light,glass,neon" label="页面风格" class="js-surface"></usa-theme-switcher></div>
    <div class="set-row set-row--col"><span>动效强度</span><usa-motion-switch class="js-motion-switch"></usa-motion-switch></div>
    <div class="set-row"><span>光标彗星拖尾</span><usa-switch variant="ios" class="js-comet-switch" label="光标彗星拖尾"></usa-switch></div>
    <div class="set-row set-row--col"><span class="muted">觉得卡可以点这里暂停动效</span><usa-pause-all label="暂停全部动效" resume-label="恢复动效" class="js-pause-all"></usa-pause-all></div>
  </div>
  <usa-dock orientation="vertical" magnify="1.35" range="90" class="rightside__dock" label="快捷按钮">
    <button class="rs-btn rs-settings js-settings" type="button" data-label="设置" aria-label="显示设置" aria-controls="settings-panel">${icon('settings')}</button>
    <button class="rs-btn js-theme" type="button" data-label="深浅色" aria-label="切换深色 / 浅色">${icon('moon', 'only-light')}${icon('sun', 'only-dark')}</button>
    <button class="rs-btn js-to-top" type="button" data-label="回到顶部" aria-label="回到顶部"><span class="rs-pct"></span>${icon('arrowUp', 'rs-up')}</button>
    <button class="rs-btn js-to-bottom" type="button" data-label="到底部" aria-label="到底部">${icon('arrowDown')}</button>
  </usa-dock>
</div>
<usa-pull-cord class="pull-cord" label="拉一下切换深色模式"></usa-pull-cord>
<div class="search" id="search" hidden role="dialog" aria-modal="true" aria-label="本地搜索">
  <div class="search__mask js-search-close"></div>
  <div class="search__panel">
    <div class="search__head">${icon('search')}<input type="search" placeholder="搜索文章…" aria-label="搜索文章" autocomplete="off"><button class="icon-btn js-search-close" type="button" aria-label="关闭搜索">${icon('close')}</button></div>
    <div class="search__results" id="search-results"></div>
  </div>
</div>
<div class="ctxmenu" id="ctxmenu" hidden role="menu"></div>
<usa-toaster label="通知" position="top-right"></usa-toaster>`,
  );
  const rs = document.getElementById('rightside')!;
  rs.querySelector('.js-settings')!.addEventListener('click', () => document.getElementById('settings-panel')!.classList.toggle('is-open'));
  rs.querySelector('.js-to-top')!.addEventListener('click', () => scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' }));
  rs.querySelector('.js-to-bottom')!.addEventListener('click', () => scrollTo({ top: document.documentElement.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' }));
  document.querySelectorAll('.js-search-close').forEach((b) => b.addEventListener('click', closeSearch));
  const input = document.querySelector<HTMLInputElement>('#search input')!;
  input.addEventListener('input', () => runSearch(input.value));
  runSearch('');
  // 拉绳 / 日夜开关 ↔ 深色模式
  document.addEventListener('usa:change', (ev) => {
    const el = ev.target as HTMLElement & { on?: boolean; checked?: boolean };
    if (el.localName === 'usa-pull-cord' || el.classList.contains('js-dark-switch')) {
      const want = el.localName === 'usa-pull-cord' ? !!el.on : !!el.checked;
      if ((currentMode() === 'dark') !== want) void toggleDark();
    } else if (el.classList.contains('js-surface')) {
      const theme = (ev as CustomEvent<{ theme: string }>).detail?.theme ?? 'light';
      localStorage.setItem('blog-surface', theme);
      document.documentElement.dataset.usaSurface = theme;
    } else if (el.classList.contains('js-comet-switch')) {
      localStorage.setItem('blog-comet', el.checked ? '1' : '0');
      void setComet(!!el.checked);
    } else if (el.classList.contains('js-motion-switch')) {
      document.documentElement.dataset.motionUser = String((ev as CustomEvent<{ level?: string }>).detail?.level ?? '');
    }
  });
  document.addEventListener('usa:pause-all', (ev) => {
    const paused = !!(ev as CustomEvent<{ paused: boolean }>).detail?.paused;
    if (paused) document.documentElement.dataset.paused = '1';
    else delete document.documentElement.dataset.paused;
    if (paused) void setComet(false);
    else if (localStorage.getItem('blog-comet') === '1') void setComet(true);
  });
  void defineUsed(document.body).then(() => {
    syncDarkControls();
    const sw = document.querySelector<HTMLElement & { checked?: boolean }>('.js-comet-switch');
    if (sw) sw.checked = localStorage.getItem('blog-comet') === '1';
    const surface = localStorage.getItem('blog-surface');
    const ts = document.querySelector<HTMLElement & { value?: string }>('.js-surface');
    if (ts && surface) ts.value = surface;
  });
  if (localStorage.getItem('blog-comet') === '1') void setComet(true);
  // 全局点击涟漪（按钮类元素）
  document.addEventListener('pointerdown', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>('.btn, .rs-btn, .nav__btn, .chip, .pager__num');
    if (!b || effectiveLevel(site.settings.animation) === 'off' || document.documentElement.dataset.paused) return;
    void loadFx().then((m) => m.playEffect(b, 'ripple', {}, ev).catch(() => undefined));
  });
  mountPlayer();
}

let cometOff: (() => void) | null = null;
async function setComet(on: boolean): Promise<void> {
  cometOff?.();
  cometOff = null;
  if (!on || prefersReducedMotion() || matchMedia('(pointer: coarse)').matches) return;
  const { bindEffect } = await loadFx();
  cometOff = bindEffect(document.body, 'comet-trail', { trigger: 'load', color: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#49b1f5' });
}

// ---------------------------------------------------------------- 音乐播放器 + 频谱 / 声音粒子
const TRACK = DEMO ? url('/demo/track.m4a') : '';
function mountPlayer(): void {
  if (!TRACK) return;
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div class="player" id="player">
  <audio id="bgm" src="${TRACK}" preload="none" loop crossorigin="anonymous"></audio>
  <button class="player__disc js-play" type="button" aria-label="播放背景音乐"><span class="player__vinyl"></span><usa-icon-morph icons="play,pause" size="18" class="player__icon"></usa-icon-morph></button>
  <div class="player__panel">
    <div class="player__meta"><b>午后散步</b><small>原创合成旋律 · 本站自带</small></div>
    <div class="player__viz js-viz" aria-hidden="true"></div>
    <button class="player__tab js-tab-audio" type="button" title="由你选择一个标签页并勾选「分享音频」">${icon('tv')}可视化标签页声音</button>
  </div>
</div>`,
  );
  const audio = document.getElementById('bgm') as HTMLAudioElement;
  const btn = document.querySelector<HTMLElement>('.js-play')!;
  let vizOff: (() => void) | null = null;
  let heroOff: (() => void) | null = null;
  let tabStream: MediaStream | null = null;
  const startViz = async (source: HTMLAudioElement | MediaStream) => {
    const fx = await loadFx();
    try {
      await fx.enableAudio(source as never);
    } catch (e) {
      console.warn('音频分析不可用', e);
    }
    vizOff?.();
    heroOff?.();
    const viz = document.querySelector<HTMLElement>('.js-viz');
    if (viz) vizOff = fx.bindEffect(viz, 'spectrum-mirror', { trigger: 'load' });
    const hero = document.querySelector<HTMLElement>('.js-hero-fx');
    if (hero) heroOff = fx.bindEffect(hero, 'sound-particles', { trigger: 'load' });
  };
  const stopViz = () => {
    vizOff?.();
    heroOff?.();
    vizOff = heroOff = null;
  };
  btn.addEventListener('click', async () => {
    const morph = btn.querySelector<HTMLElement & { show?: (i: number) => void }>('usa-icon-morph');
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        return void notify('浏览器阻止了播放，请再点一次', 'warning');
      }
      document.getElementById('player')!.classList.add('is-playing');
      btn.setAttribute('aria-label', '暂停背景音乐');
      morph?.show?.(1);
      void startViz(audio);
    } else {
      audio.pause();
      document.getElementById('player')!.classList.remove('is-playing');
      btn.setAttribute('aria-label', '播放背景音乐');
      morph?.show?.(0);
      stopViz();
    }
  });
  document.querySelector('.js-tab-audio')!.addEventListener('click', async () => {
    if (tabStream) {
      tabStream.getTracks().forEach((t) => t.stop());
      tabStream = null;
      stopViz();
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) return void notify('当前浏览器不支持共享标签页音频', 'warning');
    try {
      // 浏览器会弹出共享窗口，由访客自己选择标签页并勾选「分享音频」；网页无法静默读取其他声音
      tabStream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      if (!tabStream.getAudioTracks().length) {
        tabStream.getTracks().forEach((t) => t.stop());
        tabStream = null;
        return void notify('没有拿到音频：共享时请勾选「分享标签页音频」', 'warning');
      }
      tabStream.getVideoTracks().forEach((t) => t.stop());
      tabStream.getAudioTracks()[0]!.addEventListener('ended', () => {
        tabStream = null;
        stopViz();
      });
      void startViz(tabStream);
      notify('正在可视化你选择的标签页声音', 'success');
    } catch {
      /* 用户取消 */
    }
  });
  // 换页后：首页首图上重新挂声音粒子
  document.addEventListener('blog:page', () => {
    if (!audio.paused || tabStream) {
      heroOff?.();
      heroOff = null;
      const hero = document.querySelector<HTMLElement>('.js-hero-fx');
      if (hero) void loadFx().then((fx) => (heroOff = fx.bindEffect(hero, 'sound-particles', { trigger: 'load' })));
    }
  });
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
  bindCommunity(root, { notify, rerender: () => rerender() });
  document.dispatchEvent(new CustomEvent('blog:page', { detail: { route: page.route } }));
}

// ---------------------------------------------------------------- 启动
async function boot(): Promise<void> {
  if (DEMO) {
    const { mountDemoBanner } = await import('./demo/client');
    mountDemoBanner({ adminHref: url('/admin/') });
  }
  applyTheme(site.settings);
  const surface = localStorage.getItem('blog-surface');
  if (surface) document.documentElement.dataset.usaSurface = surface;
  splash();
  const route = parseRoute(location.pathname);
  const prerendered = !!document.getElementById('rt') && !DEMO;
  if (prerendered && snapshot.settings) {
    current = renderRoute(route, site, { ...extra });
    afterPaint(current, true);
  } else if (!document.getElementById('rt')) {
    app.innerHTML = `${navbar(site, route)}<usa-route-transition id="rt" class="rt">${pageRegion({ ...renderRoute({ name: 'notfound' }, site), main: loadingMain(), route })}</usa-route-transition>`;
    void defineUsed(app);
  }
  try {
    await loadSite();
    applyTheme(site.settings);
    initCommunity({ notify });
    const page = await pageFor(route);
    firstPaint(page);
    mountChrome(true);
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
    `<usa-splash exit="circle" min="650" class="splash"><div class="splash__inner"><span class="splash__logo">${esc(site.settings.siteTitle.slice(0, 1) || 'W')}</span><usa-spinner kind="dots" size="34" label="加载中"></usa-spinner></div></usa-splash>`,
  );
  const sp = document.querySelector('usa-splash');
  void defineUsed(document.body);
  // 兜底：组件没加载成功也不能挡住页面
  setTimeout(() => sp?.remove(), 4000);
  sp?.addEventListener('usa:done', () => setTimeout(() => sp.remove(), 50));
}

void boot();
