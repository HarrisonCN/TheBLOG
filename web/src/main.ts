import './styles.css';
import { api, ApiError, DEMO } from './api';
import { applyMotion } from './motion';
import { renderSafe } from './sanitize';
import { applyTheme, toggleTheme } from './theme';
import {
  aboutPage, errorMain, footer, header, homePage, loadingMain, notFoundPage, parseRoute as parsePath, postPage, setBasePath, setMarkdownRenderer, stripBase, tagPage, tagsPage, url,
  type Page, type Route,
} from './render';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type Post, type PostSummary, type SiteData } from './types';

setMarkdownRenderer(renderSafe);
setBasePath(import.meta.env.BASE_URL);
const parseRoute = (pathname: string): Route => parsePath(stripBase(pathname));

interface Snapshot extends Partial<SiteData> {
  post?: Post;
  tagPosts?: { tag: string; posts: PostSummary[] };
}

const app = document.getElementById('app')!;
// 演示模式：数据以访客本地为准，不使用构建时快照（快照只用于无 JS 时的首屏和 SEO）
const snapshot: Snapshot = DEMO ? {} : readSnapshot();
let site: SiteData = {
  settings: snapshot.settings ?? DEFAULT_SETTINGS,
  profile: snapshot.profile ?? DEFAULT_PROFILE,
  posts: snapshot.posts ?? [],
  total: snapshot.total ?? 0,
  tags: snapshot.tags ?? [],
};
let siteLoaded = false;
const postCache = new Map<string, Post>();
if (snapshot.post) postCache.set(snapshot.post.slug, snapshot.post);
let navToken = 0;

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
  const [settings, profile, list, tags] = await Promise.all([api.settings(), api.profile(), api.posts({ limit: 50 }), api.tags()]);
  site = { settings, profile, posts: list.posts, total: list.total, tags: tags.tags };
  siteLoaded = true;
}

function paint(page: Page | { title?: string; main: string; route: Route; description?: string }): void {
  if (page.title) document.title = page.title;
  if (page.description !== undefined) document.querySelector('meta[name="description"]')?.setAttribute('content', page.description);
  app.innerHTML = `${header(site.settings, page.route)}<main id="main" class="container" tabindex="-1">${page.main}</main>${footer(site.settings, site.profile)}`;
  applyMotion(app, site.settings.animation);
}

async function pageFor(route: Route): Promise<Page> {
  switch (route.name) {
    case 'home':
      return homePage(site);
    case 'about':
      return aboutPage(site.profile, site.settings);
    case 'tags':
      return tagsPage(site.tags, site.settings);
    case 'tag': {
      const posts = snapshot.tagPosts?.tag === route.tag && !siteLoaded ? snapshot.tagPosts.posts : (await api.posts({ tag: route.tag, limit: 100 })).posts;
      return tagPage(route.tag, posts, site.settings);
    }
    case 'post': {
      let post = postCache.get(route.slug);
      if (!post) {
        try {
          post = await api.post(route.slug);
          postCache.set(post.slug, post);
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) return notFoundPage(site.settings);
          throw e;
        }
      }
      return postPage(post, site.settings);
    }
    default:
      return notFoundPage(site.settings);
  }
}

async function render(opts: { scroll?: boolean; showLoading?: boolean } = {}): Promise<void> {
  const token = ++navToken;
  const route = parseRoute(location.pathname);
  const needsFetch = route.name === 'post' ? !postCache.has(route.slug) : route.name === 'tag';
  if (opts.showLoading && needsFetch) paint({ main: loadingMain(), route });
  try {
    const page = await pageFor(route);
    if (token !== navToken) return;
    paint(page);
  } catch (e) {
    if (token !== navToken) return;
    paint({ main: errorMain((e as Error).message), route, title: `加载失败 · ${site.settings.siteTitle}` });
  }
  if (opts.scroll) {
    window.scrollTo(0, 0);
    document.getElementById('main')?.focus({ preventScroll: true });
  }
}

function navigate(href: string): void {
  history.pushState(null, '', href);
  void render({ scroll: true, showLoading: true });
}

document.addEventListener('click', (ev) => {
  const t = ev.target as HTMLElement;
  if (t.closest('.theme-toggle')) {
    toggleTheme();
    return;
  }
  if (t.closest('.retry')) {
    void boot();
    return;
  }
  const a = t.closest('a');
  if (!a || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
  if (a.target === '_blank' || a.hasAttribute('download')) return;
  const url = new URL(a.href, location.href);
  const inSite = stripBase(url.pathname);
  const outsideBase = import.meta.env.BASE_URL !== '/' && inSite === url.pathname;
  if (url.origin !== location.origin || outsideBase || inSite.startsWith('/admin') || inSite.startsWith('/api/')) return;
  if (url.pathname === location.pathname && url.hash) return;
  ev.preventDefault();
  navigate(url.pathname + url.search);
});
window.addEventListener('popstate', () => void render({ showLoading: true }));

async function boot(): Promise<void> {
  if (DEMO) {
    const { mountDemoBanner } = await import('./demo/client');
    mountDemoBanner({ adminHref: url('/admin/') });
  }
  applyTheme(site.settings);
  const hasSnapshot = !!snapshot.settings;
  // 1) 有预渲染快照：立即用它渲染（并挂上动效），无快照则显示加载骨架
  if (hasSnapshot) await render();
  else paint({ main: loadingMain(), route: parseRoute(location.pathname) });
  // 2) 拉取最新数据后再渲染一次（构建后新发的文章也能看到）
  try {
    const before = JSON.stringify(site);
    await loadSite();
    applyTheme(site.settings);
    let changed = !hasSnapshot || JSON.stringify(site) !== before;
    const route = parseRoute(location.pathname);
    if (route.name === 'post' && postCache.has(route.slug)) {
      const fresh = await api.post(route.slug).catch(() => null);
      const old = postCache.get(route.slug);
      if (fresh && JSON.stringify(fresh) !== JSON.stringify(old)) {
        postCache.set(fresh.slug, fresh);
        changed = true;
      }
    }
    if (changed) await render();
  } catch (e) {
    if (!hasSnapshot) paint({ main: errorMain((e as Error).message), route: parseRoute(location.pathname) });
    else console.warn('刷新数据失败，继续使用构建时快照', e);
  }
}

void boot();
