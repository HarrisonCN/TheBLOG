/**
 * 纯函数视图：浏览器与构建期预渲染（Node）共用，输出 HTML 字符串。
 * 所有用户数据都经过 escapeHtml；正文经过安全的 Markdown 渲染器。
 */
import { escapeHtml as e, plainText, renderMarkdown, safeHref } from './markdown';
import type { Post, PostSummary, Profile, Settings, SiteData, TagCount } from './types';

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

export type Route =
  | { name: 'home' }
  | { name: 'post'; slug: string }
  | { name: 'about' }
  | { name: 'tags' }
  | { name: 'tag'; tag: string }
  | { name: 'notfound' };

export function parseRoute(pathname: string): Route {
  const p = pathname.replace(/\/index\.html$/, '/').replace(/\/+$/, '') || '/';
  if (p === '/') return { name: 'home' };
  if (p === '/about') return { name: 'about' };
  if (p === '/tags') return { name: 'tags' };
  let m = /^\/posts\/([a-z0-9-]+)$/.exec(p);
  if (m) return { name: 'post', slug: m[1]! };
  m = /^\/tags\/([^/]+)$/.exec(p);
  if (m) {
    try {
      return { name: 'tag', tag: decodeURIComponent(m[1]!) };
    } catch {
      return { name: 'notfound' };
    }
  }
  return { name: 'notfound' };
}

export const postPath = (slug: string) => `${BASE}/posts/${slug}/`;
export const tagPath = (tag: string) => `${BASE}/tags/${encodeURIComponent(tag)}/`;

const DATE = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Shanghai' });
export function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : DATE.format(d);
}

function tagChips(tags: string[]): string {
  if (!tags.length) return '';
  return `<ul class="chips" aria-label="标签">${tags.map((t) => `<li><a class="chip" href="${tagPath(t)}">#${e(t)}</a></li>`).join('')}</ul>`;
}

function img(url: string | null | undefined, alt: string, cls: string): string {
  const src = safeHref(url ?? '', true);
  return src ? `<img class="${cls}" src="${e(src)}" alt="${e(alt)}" loading="lazy" decoding="async">` : '';
}

export function postCard(p: PostSummary, featured = false): string {
  return `<article class="card reveal${featured ? ' card--featured' : ''}">
  ${img(p.coverUrl, '', 'card__cover')}
  <div class="card__body">
    <time class="meta" datetime="${e(p.publishedAt ?? p.createdAt)}">${formatDate(p.publishedAt ?? p.createdAt)}</time>
    <h3 class="card__title"><a href="${postPath(p.slug)}">${e(p.title)}</a></h3>
    ${p.summary ? `<p class="card__summary">${e(p.summary)}</p>` : ''}
    ${tagChips(p.tags)}
  </div>
</article>`;
}

function postList(posts: PostSummary[], empty = '还没有文章。'): string {
  return posts.length ? `<div class="post-list">${posts.map((p) => postCard(p)).join('')}</div>` : `<p class="empty">${empty}</p>`;
}

function tagCloud(tags: TagCount[]): string {
  if (!tags.length) return '<p class="empty">暂无标签。</p>';
  return `<ul class="tag-cloud">${tags.map((t) => `<li class="reveal"><a class="chip chip--lg" href="${tagPath(t.tag)}">#${e(t.tag)} <span class="count">${t.count}</span></a></li>`).join('')}</ul>`;
}

function links(profile: Profile): string {
  const items = profile.links
    .map((l) => {
      const href = safeHref(l.url);
      return href ? `<li><a href="${e(href)}"${/^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer me"' : ''}>${e(l.label)}</a></li>` : '';
    })
    .join('');
  return items ? `<ul class="links">${items}</ul>` : '';
}

export interface Page {
  title: string;
  description: string;
  main: string;
  route: Route;
}

export function header(settings: Settings, route: Route): string {
  const cur = (n: string) => (route.name === n || (n === 'tags' && route.name === 'tag') ? ' aria-current="page"' : '');
  return `<header class="site-header">
  <a class="brand" href="${url('/')}">${e(settings.siteTitle)}</a>
  <nav aria-label="主导航">
    <a href="${url('/')}"${cur('home')}>首页</a>
    <a href="${url('/tags/')}"${cur('tags')}>标签</a>
    <a href="${url('/about/')}"${cur('about')}>关于</a>
    <button class="theme-toggle" type="button" aria-label="切换深色 / 浅色模式" title="切换深色 / 浅色模式"><span aria-hidden="true">◐</span></button>
  </nav>
</header>`;
}

export function footer(settings: Settings, profile: Profile): string {
  return `<footer class="site-footer"><p>© ${new Date().getFullYear()} ${e(profile.name)} · ${e(settings.siteDescription)}</p></footer>`;
}

export function homePage(d: SiteData): Page {
  const s = d.settings;
  const featured = s.sections.featured ? s.featuredSlugs.map((slug) => d.posts.find((p) => p.slug === slug)).filter(Boolean) as PostSummary[] : [];
  const parts: string[] = [];
  if (s.sections.hero) {
    parts.push(`<section class="hero">
  ${img(d.profile.avatarUrl, d.profile.name, 'avatar')}
  <h1 class="hero__title" data-split>${e(s.siteTitle)}</h1>
  <p class="hero__lead">${e(d.profile.tagline || s.siteDescription)}</p>
</section>`);
  } else {
    parts.push(`<h1 class="visually-hidden">${e(s.siteTitle)}</h1>`);
  }
  if (featured.length) {
    parts.push(`<section aria-labelledby="h-featured"><h2 id="h-featured" class="section-title">精选</h2><div class="featured">${featured.map((p) => postCard(p, true)).join('')}</div></section>`);
  }
  if (s.sections.postList) {
    parts.push(`<section aria-labelledby="h-latest"><h2 id="h-latest" class="section-title">最新文章</h2>${postList(d.posts.slice(0, s.postsPerPage))}</section>`);
  }
  if (s.sections.tags && d.tags.length) {
    parts.push(`<section aria-labelledby="h-tags"><h2 id="h-tags" class="section-title">标签</h2>${tagCloud(d.tags.slice(0, 20))}</section>`);
  }
  if (s.sections.about && (d.profile.bioMd || d.profile.tagline)) {
    parts.push(`<section class="about-teaser reveal" aria-labelledby="h-about"><h2 id="h-about" class="section-title">关于我</h2><p>${e(plainText(d.profile.bioMd, 120))}</p><a class="more" href="${url('/about/')}">了解更多 →</a></section>`);
  }
  return { title: s.siteTitle, description: s.siteDescription, main: parts.join('\n'), route: { name: 'home' } };
}

export function postPage(post: Post, settings: Settings): Page {
  const date = post.publishedAt ?? post.createdAt;
  return {
    title: `${post.title} · ${settings.siteTitle}`,
    description: post.summary || plainText(post.contentMd),
    route: { name: 'post', slug: post.slug },
    main: `<div class="progress" aria-hidden="true"><span class="progress__bar"></span></div>
<article class="post">
  <header class="post__header">
    <h1 class="post__title" data-split>${e(post.title)}</h1>
    <p class="meta"><time datetime="${e(date)}">${formatDate(date)}</time>${post.status === 'draft' ? ' · <strong>草稿</strong>' : ''}</p>
    ${tagChips(post.tags)}
  </header>
  ${img(post.coverUrl, '', 'post__cover')}
  <div class="prose">${md(post.contentMd)}</div>
  <p><a class="more" href="${url('/')}">← 返回首页</a></p>
</article>`,
  };
}

export function aboutPage(profile: Profile, settings: Settings): Page {
  return {
    title: `关于 · ${settings.siteTitle}`,
    description: profile.tagline || plainText(profile.bioMd),
    route: { name: 'about' },
    main: `<section class="about">
  ${img(profile.avatarUrl, profile.name, 'avatar avatar--lg')}
  <h1 data-split>${e(profile.name)}</h1>
  ${profile.tagline ? `<p class="hero__lead">${e(profile.tagline)}</p>` : ''}
  ${profile.location ? `<p class="meta">📍 ${e(profile.location)}</p>` : ''}
  <div class="prose reveal">${md(profile.bioMd || '这个人很懒，还没有写简介。')}</div>
  ${links(profile)}
</section>`,
  };
}

export function tagsPage(tags: TagCount[], settings: Settings): Page {
  return { title: `标签 · ${settings.siteTitle}`, description: '全部标签', route: { name: 'tags' }, main: `<h1>全部标签</h1>${tagCloud(tags)}` };
}

export function tagPage(tag: string, posts: PostSummary[], settings: Settings): Page {
  return {
    title: `#${tag} · ${settings.siteTitle}`,
    description: `标签「${tag}」下的文章`,
    route: { name: 'tag', tag },
    main: `<h1>#${e(tag)}</h1><p class="meta">${posts.length} 篇文章 · <a href="${url('/tags/')}">全部标签</a></p>${postList(posts, '这个标签下还没有文章。')}`,
  };
}

export function notFoundPage(settings: Settings): Page {
  return { title: `页面不存在 · ${settings.siteTitle}`, description: '', route: { name: 'notfound' }, main: `<section class="state"><h1>404</h1><p>页面不存在或文章已下线。</p><a class="more" href="${url('/')}">← 返回首页</a></section>` };
}

export function loadingMain(): string {
  return `<div class="state" role="status" aria-live="polite"><span class="visually-hidden">加载中…</span>
  <div class="skeleton skeleton--title"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton skeleton--short"></div></div>`;
}

export function errorMain(message: string): string {
  return `<section class="state" role="alert"><h1>加载失败</h1><p>${e(message)}</p><button class="btn retry" type="button">重试</button></section>`;
}
