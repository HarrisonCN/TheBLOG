/**
 * L20 开放创作者网络：Webmention 收发与审核、微格式 h-entry 页面、订阅源（RSS / Atom / JSON Feed）、开放只读接口、
 * 邮件摘要订阅、GitHub 仓库元数据、MCP 分层令牌、可选 AI 辅助建议。接口形状与 web/src/demo/mock-open.ts 一致。
 *
 * 安全要点：
 *  - 只有公开内容（已发布、未隐藏、公开可见、作者主页公开、作者未被封禁）会出现在订阅源 / 开放接口 / h-entry 页面里。
 *  - Webmention 验证与外发会抓取外部地址：只允许 http(s)、默认拒绝内网 / 本机地址（SSRF）、5 秒超时、最多 512 KB、最多 3 次跳转。
 *  - MCP 令牌只返回一次，库里只存 SHA-256；作用域不超过会员的站点角色；每次工具调用都写审计并按令牌限流。
 *  - AI 建议只返回文字，从不写入任何内容；AI 不会生成评论 / 点赞等互动。
 */
import type { Env } from './env';
import { HttpError, json, readJson } from './http';
import { getMember, ipKey, rateLimit, requireMember, sendEmail, type Member } from './community';
import { card } from './social';
import { toWorks, type WorkRow, type Work } from './ugc';
import { VISIBLE_SQL } from './ugc-sql';
import { sha256Hex, randomToken } from './crypto';
import * as svc from './service';
import { parsePageQuery } from './post-page-core';
import {
  AI_LIMITS,
  buildFeed,
  checkAiInput,
  checkSubscription,
  checkTokenInput,
  checkWebmention,
  composeDigest,
  decodeOpenCursor,
  discoverEndpoint,
  encodeOpenCursor,
  extractTextLinks,
  FEED_MAX_ITEMS,
  FEED_TYPES,
  GH_TTL_MS,
  interpretMention,
  isDigestDue,
  isPrivateHost,
  localSuggest,
  looksSpammy,
  MCP_LIMITS,
  maxScopeFor,
  normalizeRepo,
  openLimit,
  OPEN_LIMITS,
  parseRepoUrl,
  scopesFor,
  shareTags,
  SUB_LIMITS,
  WM_LIMITS,
  WM_TYPES,
  type AiSuggestion,
  type AiTopic,
  type FeedFormat,
  type FeedItem,
  type FeedMeta,
  type GhRepo,
  type McpScope,
  type MemberRole,
  type OpenCursor,
  type WmTarget,
} from './open-core';

const NO_STORE = { 'cache-control': 'no-store' };
const FEED_CACHE = { 'cache-control': 'public, max-age=300, s-maxage=600' };
const OPEN_CACHE = { 'cache-control': 'public, max-age=30, s-maxage=60' };
const nowIso = () => new Date().toISOString();
const bad = (path: string, message: string) => new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path, message }]);
const notFound = (msg = '内容不存在') => new HttpError(404, 'not_found', msg);
const ID = '(\\d{1,10})';
const U = '([A-Za-z0-9_]{3,20})';
const SLUG = '([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)';
type Ctx = { waitUntil(p: Promise<unknown>): void } | undefined;

/** 公开内容的统一条件（作品表别名 p）。 */
export const PUBLIC_SQL = `${VISIBLE_SQL} AND p.visibility = 'public' AND COALESCE((SELECT visibility FROM user_profiles WHERE member_id = p.author_id), 'public') = 'public'`;

// ============================================================ 地址
/** 博客页面的绝对地址前缀（以 / 结尾）：SITE_URL，否则用 API 所在的域名（同域部署）。 */
export function siteBase(env: Env, req: Request): string {
  return (env.SITE_URL || new URL(req.url).origin).replace(/\/?$/, '/');
}
const apiOrigin = (req: Request) => new URL(req.url).origin;
const siteUrls = (env: Env, req: Request) => [...new Set([siteBase(env, req), `${apiOrigin(req)}/`])];
const pageUrl = (site: string, kind: 'post' | 'work' | 'user' | 'topic' | 'project', ref: string | number) =>
  `${site}${kind === 'post' ? 'posts' : kind === 'work' ? 'w' : kind === 'user' ? 'u' : kind === 'topic' ? 't' : 'p'}/${ref}/`;
const allowPrivate = (env: Env) => (env as Env & { WEBMENTION_ALLOW_PRIVATE?: string }).WEBMENTION_ALLOW_PRIVATE === '1';

// ============================================================ 公开数据
interface OpenAuthor { username: string; nickname: string; avatarUrl: string; url: string }
export interface OpenWork { id: number; type: string; url: string; title: string; excerpt: string; body: string; caption: string; media: { url: string; alt: string; width: number; height: number }[]; author: OpenAuthor; topics: { slug: string; name: string }[]; publishedAt: string | null; updatedAt: string | null; aiAssisted: boolean }
const absMedia = (u: string, req: Request) => (u.startsWith('/') ? `${apiOrigin(req)}${u}` : u);
export function toOpenWork(w: Work, site: string, req: Request): OpenWork {
  return {
    id: w.id,
    type: w.type,
    url: pageUrl(site, 'work', w.id),
    title: w.title,
    excerpt: (w.title || w.caption || w.body).replace(/[#>*_`~[\]()!]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200),
    body: w.body,
    caption: w.caption,
    media: w.media.map((m) => ({ ...m, url: absMedia(m.url, req) })),
    author: { username: w.author.username, nickname: w.author.nickname, avatarUrl: absMedia(w.author.avatarUrl, req), url: pageUrl(site, 'user', w.author.username) },
    topics: w.topics.map((t) => ({ slug: t.slug, name: t.name })),
    publishedAt: w.publishedAt,
    updatedAt: w.editedAt ?? w.publishedAt,
    aiAssisted: w.aiAssisted,
  };
}
export async function publicWorkRows(env: Env, o: { where?: string; binds?: unknown[]; limit: number; cursor: OpenCursor | null }): Promise<{ rows: WorkRow[]; next: string | null }> {
  const { results } = await env.DB.prepare(
    `SELECT p.* FROM user_posts p WHERE ${PUBLIC_SQL} ${o.where ?? ''} ${o.cursor ? 'AND (p.published_at < ? OR (p.published_at = ? AND p.id < ?))' : ''} ORDER BY p.published_at DESC, p.id DESC LIMIT ?`,
  )
    .bind(...(o.binds ?? []), ...(o.cursor ? [o.cursor.t, o.cursor.t, o.cursor.id] : []), o.limit + 1)
    .all<WorkRow>();
  const rows = results.slice(0, o.limit);
  const last = rows.at(-1);
  return { rows, next: results.length > o.limit && last ? encodeOpenCursor({ t: last.published_at ?? '', id: last.id }) : null };
}
export async function publicProfile(env: Env, username: string): Promise<{ id: number; username: string; nickname: string; avatarUrl: string; bio: string; website: string; joinedAt: string }> {
  const r = await env.DB.prepare(
    `SELECT m.id, m.name, m.avatar_url, m.bio, m.website, m.joined_at, p.username, p.visibility FROM user_profiles p JOIN members m ON m.id = p.member_id
     WHERE p.username = ? COLLATE NOCASE AND m.id NOT IN (SELECT member_id FROM member_standing WHERE banned_at IS NOT NULL)`,
  )
    .bind(username)
    .first<{ id: number; name: string; avatar_url: string; bio: string; website: string; joined_at: string; username: string; visibility: string }>();
  if (!r || r.visibility !== 'public') throw notFound('没有这个公开主页');
  return { id: r.id, username: r.username, nickname: r.name, avatarUrl: r.avatar_url, bio: r.bio, website: r.website, joinedAt: r.joined_at };
}
export async function topicBySlug(env: Env, slug: string) {
  const t = await env.DB.prepare('SELECT id, slug, name, intro FROM topics WHERE slug = ?').bind(slug).first<{ id: number; slug: string; name: string; intro: string }>();
  if (!t) throw notFound('话题不存在');
  return t;
}
async function publicProject(env: Env, slug: string) {
  const p = await env.DB.prepare("SELECT id, owner_id, slug, title, tagline, description, status, repo_url, homepage_url, cover_url, created_at, updated_at FROM projects WHERE slug = ? AND visibility = 'public'").bind(slug).first<{ id: number; owner_id: number; slug: string; title: string; tagline: string; description: string; status: string; repo_url: string; homepage_url: string; cover_url: string; created_at: string; updated_at: string }>();
  if (!p) throw notFound('项目不存在');
  return p;
}
function pageOf(url: URL): { limit: number; cursor: OpenCursor | null } {
  const limit = openLimit(url.searchParams.get('limit'));
  const cursor = decodeOpenCursor(url.searchParams.get('cursor'));
  if (limit === 'bad') throw bad('limit', `limit 必须是 1–${OPEN_LIMITS.maxLimit} 的整数`);
  if (cursor === 'bad') throw bad('cursor', 'cursor 无效');
  return { limit, cursor };
}

// ============================================================ 订阅源
async function feedFor(req: Request, env: Env, scope: string, ref: string, fmt: FeedFormat): Promise<Response> {
  const site = siteBase(env, req);
  const settings = await svc.getSettings(env);
  const profile = await svc.getProfile(env);
  const self = new URL(req.url).href.split('?')[0]!;
  const owner = { name: profile.name || settings.siteTitle, url: site };
  let meta: FeedMeta;
  let items: FeedItem[] = [];
  const workItems = async (where: string, binds: unknown[]) => {
    const { rows } = await publicWorkRows(env, { where, binds, limit: FEED_MAX_ITEMS, cursor: null });
    return (await toWorks(env, rows, null)).map((w) => {
      const o = toOpenWork(w, site, req);
      return { id: o.url, url: o.url, title: o.title || o.excerpt.slice(0, 40), summary: o.caption || o.excerpt, published: o.publishedAt ?? '', updated: o.updatedAt ?? undefined, author: { name: o.author.nickname, url: o.author.url }, tags: o.topics.map((t) => t.name), image: o.media[0]?.url } satisfies FeedItem;
    });
  };
  if (scope === 'site') {
    const list = await svc.listPosts(env, { limit: FEED_MAX_ITEMS, cursor: null } as never);
    meta = { title: settings.siteTitle, description: settings.siteDescription, homeUrl: site, author: owner };
    items = list.posts.map((p) => ({ id: pageUrl(site, 'post', p.slug), url: pageUrl(site, 'post', p.slug), title: p.title, summary: p.summary, published: p.publishedAt ?? p.updatedAt, updated: p.updatedAt, author: owner, tags: [p.category, ...p.tags].filter(Boolean) as string[], image: p.coverUrl ? absMedia(p.coverUrl, req) : undefined }));
  } else if (scope === 'users') {
    const u = await publicProfile(env, ref);
    meta = { title: `${u.nickname}（@${u.username}）· ${settings.siteTitle}`, description: u.bio || `${u.nickname} 在 ${settings.siteTitle} 发布的公开作品`, homeUrl: pageUrl(site, 'user', u.username), author: { name: u.nickname, url: pageUrl(site, 'user', u.username) } };
    items = await workItems('AND p.author_id = ?', [u.id]);
  } else if (scope === 'topics') {
    const t = await topicBySlug(env, ref);
    meta = { title: `#${t.name} · ${settings.siteTitle}`, description: t.intro || `话题「${t.name}」下的公开作品`, homeUrl: pageUrl(site, 'topic', t.slug), author: owner };
    items = await workItems('AND p.id IN (SELECT post_id FROM post_topics WHERE topic_id = ?)', [t.id]);
  } else {
    const p = await publicProject(env, ref);
    const c = await card(env, p.owner_id);
    const home = pageUrl(site, 'project', p.slug);
    meta = { title: `${p.title} · 项目动态 · ${settings.siteTitle}`, description: p.tagline || p.description.slice(0, 140) || `项目「${p.title}」的开发日志与版本`, homeUrl: home, author: { name: c?.nickname ?? owner.name, url: c ? pageUrl(site, 'user', c.username) : site } };
    const logs = (await env.DB.prepare('SELECT id, kind, title, body, version, created_at, updated_at FROM project_logs WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?').bind(p.id, FEED_MAX_ITEMS).all<{ id: number; kind: string; title: string; body: string; version: string; created_at: string; updated_at: string }>()).results;
    items = logs.map((l) => ({ id: `${home}#log-${l.id}`, url: `${home}#log-${l.id}`, title: l.kind === 'release' && l.version ? `${l.version} · ${l.title}` : l.title, summary: l.body.slice(0, 280), published: l.created_at, updated: l.updated_at, tags: [l.kind === 'release' ? '版本' : '开发日志'] }));
  }
  const body = buildFeed(fmt, meta, items, self);
  return new Response(req.method === 'HEAD' ? null : body, { headers: { 'content-type': FEED_TYPES[fmt], ...FEED_CACHE, link: `<${self}>; rel="self"` } });
}

// ============================================================ 开放只读接口 v1
async function openApi(req: Request, env: Env, sub: string, url: URL): Promise<Response | null> {
  const site = siteBase(env, req);
  const ok = (d: unknown) => json(d, { headers: OPEN_CACHE });
  let m: RegExpExecArray | null;
  if (sub === '' || sub === '/') {
    return ok({
      version: 1,
      docs: `${site}subscribe/#open-api`,
      rateLimit: `${OPEN_LIMITS.perMinute}/min/IP`,
      pagination: '游标分页：响应里的 nextCursor 原样作为 ?cursor= 传回；limit 1–50',
      endpoints: ['/api/open/v1/posts', '/api/open/v1/works?type=&topic=&author=', '/api/open/v1/works/{id}', '/api/open/v1/users/{username}', '/api/open/v1/topics', '/api/open/v1/projects', '/api/open/v1/projects/{slug}', '/api/feeds/{site|users/{u}|topics/{slug}|projects/{slug}}.{rss|atom|json}', '/api/webmentions?target='],
    });
  }
  await rateLimit(env, 'open', await ipKey(req, env), OPEN_LIMITS.perMinute, 60, '开放接口请求太频繁，请稍后再试');
  if (sub === '/posts') {
    const pq = parsePageQuery(url.searchParams.get('limit'), url.searchParams.get('cursor'));
    if (!pq.ok) throw bad(pq.field, pq.message);
    const r = await svc.listPosts(env, { limit: pq.limit, cursor: pq.cursor } as never);
    return ok({ posts: r.posts.map((p) => ({ slug: p.slug, url: pageUrl(site, 'post', p.slug), title: p.title, summary: p.summary, tags: p.tags, category: p.category, coverUrl: p.coverUrl ? absMedia(p.coverUrl, req) : null, publishedAt: p.publishedAt, updatedAt: p.updatedAt })), total: r.total, nextCursor: r.nextCursor });
  }
  if (sub === '/works') {
    const { limit, cursor } = pageOf(url);
    const where: string[] = [];
    const binds: unknown[] = [];
    const type = url.searchParams.get('type');
    if (type) {
      if (!['short', 'article', 'photo', 'album'].includes(type)) throw bad('type', 'type 只能是 short / article / photo / album');
      where.push('AND p.type = ?');
      binds.push(type);
    }
    const topic = url.searchParams.get('topic');
    if (topic) {
      const t = await topicBySlug(env, topic);
      where.push('AND p.id IN (SELECT post_id FROM post_topics WHERE topic_id = ?)');
      binds.push(t.id);
    }
    const author = url.searchParams.get('author');
    if (author) {
      const a = await publicProfile(env, author);
      where.push('AND p.author_id = ?');
      binds.push(a.id);
    }
    const { rows, next } = await publicWorkRows(env, { where: where.join(' '), binds, limit, cursor });
    return ok({ works: (await toWorks(env, rows, null)).map((w) => toOpenWork(w, site, req)), nextCursor: next });
  }
  if ((m = new RegExp(`^/works/${ID}$`).exec(sub))) {
    const { rows } = await publicWorkRows(env, { where: 'AND p.id = ?', binds: [Number(m[1])], limit: 1, cursor: null });
    if (!rows.length) throw notFound();
    return ok({ work: toOpenWork((await toWorks(env, rows, null))[0]!, site, req) });
  }
  if ((m = new RegExp(`^/users/${U}$`).exec(sub))) {
    const u = await publicProfile(env, m[1]!);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM user_posts p WHERE ${PUBLIC_SQL} AND p.author_id = ?`).bind(u.id).first<{ n: number }>();
    return ok({ user: { username: u.username, nickname: u.nickname, avatarUrl: absMedia(u.avatarUrl, req), bio: u.bio, website: u.website, url: pageUrl(site, 'user', u.username), joinedAt: u.joinedAt, publicWorks: n?.n ?? 0, feeds: feedLinks(req, 'users', u.username) } });
  }
  if (sub === '/topics') {
    const { results } = await env.DB.prepare(`SELECT t.slug, t.name, t.intro, (SELECT COUNT(*) FROM post_topics pt JOIN user_posts p ON p.id = pt.post_id WHERE pt.topic_id = t.id AND ${PUBLIC_SQL}) AS works FROM topics t ORDER BY t.sort, t.id`).all<{ slug: string; name: string; intro: string; works: number }>();
    return ok({ topics: results.map((t) => ({ ...t, url: pageUrl(site, 'topic', t.slug), feeds: feedLinks(req, 'topics', t.slug) })) });
  }
  if (sub === '/projects') {
    const { limit, cursor } = pageOf(url);
    const { results } = await env.DB.prepare(`SELECT id, owner_id, slug, title, tagline, status, repo_url, homepage_url, updated_at FROM projects WHERE visibility = 'public' ${cursor ? 'AND (updated_at < ? OR (updated_at = ? AND id < ?))' : ''} ORDER BY updated_at DESC, id DESC LIMIT ?`)
      .bind(...(cursor ? [cursor.t, cursor.t, cursor.id] : []), limit + 1)
      .all<{ id: number; owner_id: number; slug: string; title: string; tagline: string; status: string; repo_url: string; homepage_url: string; updated_at: string }>();
    const page = results.slice(0, limit);
    const last = page.at(-1);
    const out = [];
    for (const p of page) {
      const c = await card(env, p.owner_id);
      out.push({ slug: p.slug, title: p.title, tagline: p.tagline, status: p.status, repoUrl: p.repo_url, homepageUrl: p.homepage_url, url: pageUrl(site, 'project', p.slug), owner: c ? { username: c.username, nickname: c.nickname } : null, updatedAt: p.updated_at });
    }
    return ok({ projects: out, nextCursor: results.length > limit && last ? encodeOpenCursor({ t: last.updated_at, id: last.id }) : null });
  }
  if ((m = new RegExp(`^/projects/${SLUG}$`).exec(sub))) {
    const p = await publicProject(env, m[1]!);
    const c = await card(env, p.owner_id);
    const logs = (await env.DB.prepare('SELECT id, kind, title, body, version, created_at FROM project_logs WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 20').bind(p.id).all()).results;
    return ok({ project: { slug: p.slug, title: p.title, tagline: p.tagline, description: p.description, status: p.status, repoUrl: p.repo_url, homepageUrl: p.homepage_url, url: pageUrl(site, 'project', p.slug), owner: c ? { username: c.username, nickname: c.nickname } : null, createdAt: p.created_at, updatedAt: p.updated_at, logs, feeds: feedLinks(req, 'projects', p.slug) } });
  }
  return null;
}
function feedLinks(req: Request, scope: 'users' | 'topics' | 'projects', ref: string) {
  const b = `${apiOrigin(req)}/api/feeds/${scope}/${ref}`;
  return { rss: `${b}.rss`, atom: `${b}.atom`, json: `${b}.json` };
}

// ============================================================ h-entry / h-card 页面（Webmention 的 source、爬虫的分享卡片）
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** 极简 Markdown → 安全 HTML：只保留段落、换行和链接（[文字](url) 与裸 http(s) 链接），其余一律转义。 */
export function mdLite(md: string): string {
  const linkify = (s: string) => {
    const out: string[] = [];
    let last = 0;
    const re = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]{1,1000})\)|(https?:\/\/[^\s<>"'()\[\]{}]+[^\s<>"'()\[\]{}.,;:!?。，；：！？）】」])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      out.push(esc(s.slice(last, m.index)));
      const href = m[2] ?? m[3]!;
      out.push(`<a href="${esc(href)}" rel="nofollow ugc">${esc(m[1] ?? href)}</a>`);
      last = re.lastIndex;
    }
    out.push(esc(s.slice(last)));
    return out.join('');
  };
  return md
    .replace(/```[\s\S]*?```/g, (b) => b.replace(/```\w*\n?/g, ''))
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${linkify(p.replace(/^#{1,6}\s+/gm, '').replace(/^>\s?/gm, '')).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}
function hPage(req: Request, o: { title: string; description: string; canonical: string; image: string; type: 'article' | 'profile' | 'website'; siteName: string; body: string; feeds?: { rss: string; atom: string; json: string } }): Response {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description.slice(0, 200))}">
<link rel="canonical" href="${esc(o.canonical)}">
<link rel="webmention" href="${esc(apiOrigin(req))}/api/webmention">
${o.feeds ? `<link rel="alternate" type="application/rss+xml" href="${esc(o.feeds.rss)}">\n<link rel="alternate" type="application/atom+xml" href="${esc(o.feeds.atom)}">\n<link rel="alternate" type="application/feed+json" href="${esc(o.feeds.json)}">` : ''}
${shareTags({ title: o.title, description: o.description, url: o.canonical, image: o.image, type: o.type }, o.siteName).join('\n')}
<style>body{font:16px/1.7 system-ui,-apple-system,"PingFang SC",sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem;color:#1e293b}img{max-width:100%;height:auto}a{color:#1d4ed8}.meta{color:#475569;font-size:.9rem}</style>
</head>
<body>
${o.body}
<p class="meta"><a href="${esc(o.canonical)}">在 ${esc(o.siteName)} 查看完整页面 →</a></p>
</body>
</html>
`;
  return new Response(req.method === 'HEAD' ? null : html, {
    headers: { 'content-type': 'text/html; charset=utf-8', ...OPEN_CACHE, link: `<${apiOrigin(req)}/api/webmention>; rel="webmention"`, 'content-security-policy': "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'" },
  });
}
async function hEntryPage(req: Request, env: Env, kind: 'works' | 'posts' | 'users', ref: string): Promise<Response> {
  const site = siteBase(env, req);
  const settings = await svc.getSettings(env);
  if (kind === 'posts') {
    const p = await svc.getPost(env, ref);
    const profile = await svc.getProfile(env);
    const url = pageUrl(site, 'post', p.slug);
    const body = `<article class="h-entry">
<h1 class="p-name">${esc(p.title)}</h1>
<p class="meta"><a class="u-url" href="${esc(url)}">${esc(url)}</a> · <time class="dt-published" datetime="${esc(p.publishedAt ?? p.createdAt)}">${esc((p.publishedAt ?? p.createdAt).slice(0, 10))}</time> · <a class="p-author h-card" href="${esc(site)}about/">${esc(profile.name)}</a></p>
${p.summary ? `<p class="p-summary">${esc(p.summary)}</p>` : ''}
<div class="e-content">${mdLite(p.contentMd)}</div>
${p.tags.map((t) => `<a class="p-category" href="${esc(site)}tags/${encodeURIComponent(t)}/">${esc(t)}</a>`).join(' ')}
</article>`;
    return hPage(req, { title: p.title, description: p.summary || p.title, canonical: url, image: p.coverUrl ? absMedia(p.coverUrl, req) : '', type: 'article', siteName: settings.siteTitle, body });
  }
  if (kind === 'works') {
    const { rows } = await publicWorkRows(env, { where: 'AND p.id = ?', binds: [Number(ref)], limit: 1, cursor: null });
    if (!rows.length) throw notFound();
    const w = toOpenWork((await toWorks(env, rows, null))[0]!, site, req);
    const title = w.title || w.excerpt.slice(0, 40) || '作品';
    const body = `<article class="h-entry">
<h1 class="p-name">${esc(title)}</h1>
<p class="meta"><a class="u-url" href="${esc(w.url)}">${esc(w.url)}</a> · <time class="dt-published" datetime="${esc(w.publishedAt ?? '')}">${esc((w.publishedAt ?? '').slice(0, 10))}</time> ·
<span class="p-author h-card">${w.author.avatarUrl ? `<img class="u-photo" src="${esc(w.author.avatarUrl)}" alt="" width="24" height="24"> ` : ''}<a class="p-name u-url" href="${esc(w.author.url)}">${esc(w.author.nickname)}</a></span></p>
${w.media.map((m) => `<img class="u-photo" src="${esc(m.url)}" alt="${esc(m.alt)}"${m.width ? ` width="${m.width}" height="${m.height}"` : ''}>`).join('\n')}
<div class="e-content">${w.caption ? `<p>${esc(w.caption)}</p>` : ''}${mdLite(w.body)}</div>
${w.topics.map((t) => `<a class="p-category" href="${esc(pageUrl(site, 'topic', t.slug))}">${esc(t.name)}</a>`).join(' ')}
${w.aiAssisted ? '<p class="meta">作者在这篇内容里采用了 AI 辅助建议。</p>' : ''}
</article>`;
    return hPage(req, { title: `${title} · ${w.author.nickname}`, description: w.caption || w.excerpt, canonical: w.url, image: w.media[0]?.url ?? '', type: 'article', siteName: settings.siteTitle, body });
  }
  const u = await publicProfile(env, ref);
  const url = pageUrl(site, 'user', u.username);
  const { rows } = await publicWorkRows(env, { where: 'AND p.author_id = ?', binds: [u.id], limit: 20, cursor: null });
  const works = (await toWorks(env, rows, null)).map((w) => toOpenWork(w, site, req));
  const body = `<div class="h-card">
${u.avatarUrl ? `<img class="u-photo" src="${esc(absMedia(u.avatarUrl, req))}" alt="" width="96" height="96">` : ''}
<h1><a class="p-name u-url u-uid" href="${esc(url)}">${esc(u.nickname)}</a></h1>
<p class="p-nickname">@${esc(u.username)}</p>
${u.bio ? `<p class="p-note">${esc(u.bio)}</p>` : ''}
${u.website ? `<p><a class="u-url" rel="me nofollow" href="${esc(u.website)}">${esc(u.website)}</a></p>` : ''}
</div>
<section class="h-feed"><h2 class="p-name">${esc(u.nickname)} 的公开作品</h2>
${works.map((w) => `<article class="h-entry"><a class="u-url p-name" href="${esc(w.url)}">${esc(w.title || w.excerpt.slice(0, 40))}</a> <time class="dt-published" datetime="${esc(w.publishedAt ?? '')}">${esc((w.publishedAt ?? '').slice(0, 10))}</time></article>`).join('\n')}
</section>`;
  return hPage(req, { title: `${u.nickname}（@${u.username}）`, description: u.bio || `${u.nickname} 在 ${settings.siteTitle} 的创作者主页`, canonical: url, image: u.avatarUrl ? absMedia(u.avatarUrl, req) : '', type: 'profile', siteName: settings.siteTitle, body, feeds: feedLinks(req, 'users', u.username) });
}

// ============================================================ 安全抓取（Webmention 验证 / 外发、端点发现）
export interface FetchResult { ok: boolean; status: number; url: string; contentType: string; body: string; link: string | null; error?: string }
export async function safeFetch(env: Env, url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}): Promise<FetchResult> {
  let cur = url;
  for (let hop = 0; hop <= WM_LIMITS.maxRedirects; hop++) {
    let u: URL;
    try {
      u = new URL(cur);
    } catch {
      return { ok: false, status: 0, url: cur, contentType: '', body: '', link: null, error: 'bad_url' };
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, status: 0, url: cur, contentType: '', body: '', link: null, error: 'bad_scheme' };
    if (!allowPrivate(env) && isPrivateHost(u.hostname)) return { ok: false, status: 0, url: cur, contentType: '', body: '', link: null, error: 'private_host' };
    let res: Response;
    try {
      res = await fetch(u.href, {
        method: init.method ?? 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(WM_LIMITS.timeoutMs),
        headers: { 'user-agent': 'TheBLOG-Webmention/1.20 (+https://github.com/HarrisonCN/TheBLOG)', accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', ...(init.headers ?? {}) },
        ...(init.body !== undefined ? { body: init.body } : {}),
      });
    } catch (e) {
      return { ok: false, status: 0, url: cur, contentType: '', body: '', link: null, error: (e as Error).name === 'TimeoutError' ? 'timeout' : 'network' };
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location') && (init.method ?? 'GET') === 'GET') {
      cur = new URL(res.headers.get('location')!, u).href;
      await res.body?.cancel().catch(() => undefined);
      continue;
    }
    // 只读前 512 KB
    let body = '';
    if (res.body) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        body += dec.decode(value, { stream: true });
        if (size >= WM_LIMITS.maxBytes) {
          await reader.cancel().catch(() => undefined);
          break;
        }
      }
    }
    return { ok: res.ok, status: res.status, url: cur, contentType: (res.headers.get('content-type') ?? '').toLowerCase(), body, link: res.headers.get('link') };
  }
  return { ok: false, status: 0, url: cur, contentType: '', body: '', link: null, error: 'too_many_redirects' };
}

// ============================================================ Webmention：接收
/** 测试与无 ctx 的环境：跟踪后台验证任务，drainWebmentions() 等它们全部完成。 */
const pendingJobs = new Set<Promise<unknown>>();
export async function drainWebmentions(): Promise<void> {
  while (pendingJobs.size) await Promise.allSettled([...pendingJobs]);
}
function background(ctx: Ctx, p: Promise<unknown>): void {
  const job = p.catch((e) => console.error('webmention job failed', e));
  if (ctx) ctx.waitUntil(job);
  else {
    pendingJobs.add(job);
    void job.finally(() => pendingJobs.delete(job));
  }
}
async function targetExists(env: Env, to: WmTarget): Promise<boolean> {
  if (to.kind === 'post') return !!(await env.DB.prepare("SELECT 1 FROM posts WHERE slug = ? AND status = 'published'").bind(to.ref).first());
  if (to.kind === 'work') return !!(await env.DB.prepare(`SELECT 1 FROM user_posts p WHERE p.id = ? AND ${PUBLIC_SQL}`).bind(Number(to.ref)).first());
  if (to.kind === 'user') return !!(await env.DB.prepare("SELECT 1 FROM user_profiles WHERE username = ? COLLATE NOCASE AND visibility = 'public'").bind(to.ref).first());
  return !!(await env.DB.prepare("SELECT 1 FROM projects WHERE slug = ? AND visibility = 'public'").bind(to.ref).first());
}
async function readWebmentionBody(req: Request): Promise<Record<string, unknown>> {
  const ct = (req.headers.get('content-type') ?? '').toLowerCase();
  if (ct.includes('application/x-www-form-urlencoded')) {
    const text = await req.text();
    if (text.length > 8192) throw new HttpError(413, 'payload_too_large', '请求体过大');
    const p = new URLSearchParams(text);
    return { source: p.get('source') ?? '', target: p.get('target') ?? '' };
  }
  if (ct.includes('application/json')) return ((await readJson(req, 8192)) ?? {}) as Record<string, unknown>;
  throw new HttpError(415, 'unsupported_media_type', 'Webmention 请用 application/x-www-form-urlencoded（source、target）');
}
export async function receiveWebmention(req: Request, env: Env, ctx: Ctx): Promise<Response> {
  const input = await readWebmentionBody(req);
  const c = checkWebmention(input, siteUrls(env, req));
  if (!c.ok) throw bad(c.path, c.error);
  const { source, target, to } = c.value;
  const host = new URL(source).host.toLowerCase();
  const ip = await ipKey(req, env);
  await rateLimit(env, 'wm-ip', ip, WM_LIMITS.perIpPerHour, 3600, 'Webmention 太频繁，请稍后再试');
  await rateLimit(env, 'wm-host', host, WM_LIMITS.perHostPerHour, 3600, '这个来源站点的 Webmention 太频繁，请稍后再试');
  if (!(await targetExists(env, to))) throw bad('target', 'target 页面不存在或不公开');
  const row = await env.DB.prepare(
    `INSERT INTO webmentions (source, target, target_kind, target_ref, status, source_host, ip_hash, created_at) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)
     ON CONFLICT(source, target) DO UPDATE SET status = CASE WHEN webmentions.status IN ('rejected', 'spam') THEN webmentions.status ELSE 'queued' END, attempts = 0, error = '', ip_hash = excluded.ip_hash
     RETURNING id, status`,
  )
    .bind(source, target, to.kind, to.ref, host, ip, nowIso())
    .first<{ id: number; status: string }>();
  if (row!.status === 'queued') background(ctx, verifyWebmention(env, row!.id));
  const loc = `${apiOrigin(req)}/api/webmention/${row!.id}`;
  return json({ id: row!.id, status: row!.status === 'queued' ? 'queued' : row!.status, statusUrl: loc, message: '已收到，正在异步验证 source 是否链接到 target；通过后由站长审核显示。' }, { status: 202, headers: { ...NO_STORE, location: loc } });
}
interface WmRow { id: number; source: string; target: string; target_kind: string; target_ref: string; status: string; wm_type: string; author_name: string; author_url: string; author_photo: string; content: string; url: string; published: string; error: string; source_host: string; attempts: number; created_at: string; verified_at: string | null; moderated_at: string | null }
/** 验证一条排队中的 Webmention：抓取 source，确认它链接到 target，解析 h-entry / h-card。 */
export async function verifyWebmention(env: Env, id: number): Promise<string> {
  const row = await env.DB.prepare("SELECT * FROM webmentions WHERE id = ? AND status = 'queued'").bind(id).first<WmRow>();
  if (!row) return 'skipped';
  const attempts = row.attempts + 1;
  const r = await safeFetch(env, row.source);
  const fail = async (status: 'queued' | 'invalid', error: string) => {
    await env.DB.prepare('UPDATE webmentions SET status = ?, error = ?, attempts = ?, verified_at = ? WHERE id = ?').bind(status, error, attempts, nowIso(), id).run();
    return status;
  };
  if (r.error === 'private_host' || r.error === 'bad_scheme' || r.error === 'bad_url') return fail('invalid', r.error);
  if (r.status === 404 || r.status === 410) return fail('invalid', 'source_gone');
  if (!r.ok) return fail(attempts >= WM_LIMITS.maxAttempts ? 'invalid' : 'queued', r.error ?? `http_${r.status}`);
  const isHtml = r.contentType.includes('html') || r.contentType === '';
  const { linked, parsed } = isHtml ? interpretMention(r.body, r.url, row.target) : { linked: r.body.includes(row.target), parsed: { type: 'mention' as const, author: { name: new URL(row.source).host, url: '', photo: '' }, content: '', published: '', url: row.source } };
  if (!linked) return fail('invalid', 'no_link');
  let status: 'pending' | 'approved' | 'spam' = looksSpammy(r.body, parsed.content) ? 'spam' : 'pending';
  if (status === 'pending') {
    // 来源站点之前有 Webmention 被站长通过过 → 直接显示（信任来源），否则进审核队列
    const trusted = await env.DB.prepare("SELECT 1 FROM webmentions WHERE source_host = ? AND status = 'approved' AND id != ? LIMIT 1").bind(row.source_host, id).first();
    if (trusted) status = 'approved';
  }
  await env.DB.prepare(
    'UPDATE webmentions SET status = ?, wm_type = ?, author_name = ?, author_url = ?, author_photo = ?, content = ?, url = ?, published = ?, error = ?, attempts = ?, verified_at = ?, moderated_at = ? WHERE id = ?',
  )
    .bind(status, parsed.type, parsed.author.name, parsed.author.url, parsed.author.photo, parsed.content, parsed.url, parsed.published, '', attempts, nowIso(), status === 'approved' ? nowIso() : null, id)
    .run();
  return status;
}
export async function processQueued(env: Env, max = 20): Promise<number> {
  const { results } = await env.DB.prepare("SELECT id FROM webmentions WHERE status = 'queued' ORDER BY id LIMIT ?").bind(max).all<{ id: number }>();
  for (const r of results) await verifyWebmention(env, r.id);
  return results.length;
}
const publicMention = (r: WmRow) => ({ id: r.id, type: r.wm_type, source: r.source, url: r.url || r.source, author: { name: r.author_name, url: r.author_url, photo: r.author_photo }, content: r.wm_type === 'reply' || r.wm_type === 'mention' ? r.content : '', published: r.published || r.verified_at || r.created_at });
export async function listMentions(req: Request, env: Env, url: URL) {
  let kind = url.searchParams.get('kind');
  let ref = url.searchParams.get('ref');
  const target = url.searchParams.get('target');
  if (target) {
    const c = checkWebmention({ source: 'https://example.invalid/', target }, siteUrls(env, req));
    if (!c.ok) throw bad('target', c.error);
    kind = c.value.to.kind;
    ref = c.value.to.ref;
  }
  if (!kind || !['post', 'work', 'user', 'project'].includes(kind) || !ref || ref.length > 80) throw bad('kind', '需要 kind（post / work / user / project）和 ref，或 target');
  const { results } = await env.DB.prepare("SELECT * FROM webmentions WHERE target_kind = ? AND target_ref = ? AND status = 'approved' ORDER BY COALESCE(verified_at, created_at) ASC, id ASC LIMIT 200").bind(kind, kind === 'user' ? ref.toLowerCase() : ref).all<WmRow>();
  const items = results.map(publicMention);
  const by = (t: string) => items.filter((i) => i.type === t);
  return { kind, ref, total: items.length, counts: Object.fromEntries(WM_TYPES.map((t) => [t, by(t).length])), replies: by('reply'), likes: by('like'), reposts: by('repost'), bookmarks: by('bookmark'), mentions: by('mention') };
}

// ============================================================ Webmention：后台审核 / 外发
const adminMention = (r: WmRow) => ({ ...publicMention(r), target: r.target, targetKind: r.target_kind, targetRef: r.target_ref, status: r.status, error: r.error, sourceHost: r.source_host, attempts: r.attempts, createdAt: r.created_at, content: r.content });
export async function pendingMentionCount(env: Env): Promise<number> {
  return (await env.DB.prepare("SELECT COUNT(*) AS n FROM webmentions WHERE status = 'pending'").first<{ n: number }>())?.n ?? 0;
}
export async function adminMentions(env: Env, url: URL) {
  const st = url.searchParams.get('status') ?? 'pending';
  if (!['pending', 'approved', 'rejected', 'spam', 'invalid', 'queued', 'all'].includes(st)) throw bad('status', 'status 无效');
  const { results } = await env.DB.prepare(`SELECT * FROM webmentions ${st === 'all' ? '' : 'WHERE status = ?'} ORDER BY id DESC LIMIT 200`).bind(...(st === 'all' ? [] : [st])).all<WmRow>();
  const counts = Object.fromEntries((await env.DB.prepare('SELECT status, COUNT(*) AS n FROM webmentions GROUP BY status').all<{ status: string; n: number }>()).results.map((r) => [r.status, r.n]));
  return { status: st, items: results.map(adminMention), counts };
}
export async function moderateMention(env: Env, id: number, action: unknown) {
  const row = await env.DB.prepare('SELECT * FROM webmentions WHERE id = ?').bind(id).first<WmRow>();
  if (!row) throw notFound('Webmention 不存在');
  if (action === 'delete') {
    await env.DB.prepare('DELETE FROM webmentions WHERE id = ?').bind(id).run();
    return { ok: true, id, deleted: true, pending: await pendingMentionCount(env) };
  }
  const map: Record<string, string> = { approve: 'approved', reject: 'rejected', spam: 'spam', requeue: 'queued' };
  const next = typeof action === 'string' ? map[action] : undefined;
  if (!next) throw bad('action', 'action 只能是 approve / reject / spam / requeue / delete');
  if (next === 'approved' && !['pending', 'rejected', 'spam'].includes(row.status)) throw new HttpError(409, 'not_verified', '只有验证通过（待审核 / 已拒绝 / 垃圾）的 Webmention 可以通过');
  await env.DB.prepare('UPDATE webmentions SET status = ?, moderated_at = ?, attempts = CASE WHEN ? = \'queued\' THEN 0 ELSE attempts END WHERE id = ?').bind(next, nowIso(), next, id).run();
  return { ok: true, id, status: next, pending: await pendingMentionCount(env) };
}
/** 站长对已发布内容触发：找出正文里的外链 → 端点发现 → 发送 Webmention（source = 这条内容的 h-entry 页面）。 */
export async function sendMentions(req: Request, env: Env, input: unknown) {
  const o = (input ?? {}) as { kind?: unknown; ref?: unknown };
  let text = '';
  let source = '';
  const kind = o.kind;
  const ref = typeof o.ref === 'string' || typeof o.ref === 'number' ? String(o.ref) : '';
  if (kind === 'post') {
    const p = await svc.getPost(env, ref);
    text = `${p.contentMd}\n${p.summary}`;
    source = `${apiOrigin(req)}/api/open/h/posts/${p.slug}`;
  } else if (kind === 'work') {
    const { rows } = await publicWorkRows(env, { where: 'AND p.id = ?', binds: [Number(ref)], limit: 1, cursor: null });
    if (!rows.length) throw notFound('只有公开的已发布作品可以发送 Webmention');
    text = `${rows[0]!.body}\n${rows[0]!.caption}`;
    source = `${apiOrigin(req)}/api/open/h/works/${rows[0]!.id}`;
  } else throw bad('kind', 'kind 只能是 post / work');
  const targets = extractTextLinks(text).slice(0, 20);
  const results: { target: string; status: string; endpoint: string; httpStatus: number; detail: string }[] = [];
  for (const target of targets) {
    let status = 'no_endpoint';
    let endpoint = '';
    let httpStatus = 0;
    let detail = '';
    const page = await safeFetch(env, target);
    if (page.error) {
      status = page.error === 'private_host' ? 'skipped' : 'failed';
      detail = page.error;
    } else {
      endpoint = discoverEndpoint(page.link, page.contentType.includes('html') ? page.body : '', page.url) ?? '';
      if (endpoint) {
        const r = await safeFetch(env, endpoint, { method: 'POST', body: new URLSearchParams({ source, target }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
        httpStatus = r.status;
        status = r.status >= 200 && r.status < 300 ? 'sent' : 'failed';
        detail = r.error ?? (status === 'sent' ? '' : r.body.slice(0, 200));
      }
    }
    await env.DB.prepare(
      `INSERT INTO webmention_sends (source_kind, source_ref, source, target, endpoint, status, http_status, detail, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_kind, source_ref, target) DO UPDATE SET endpoint = excluded.endpoint, status = excluded.status, http_status = excluded.http_status, detail = excluded.detail, sent_at = excluded.sent_at, source = excluded.source`,
    )
      .bind(kind, ref, source, target, endpoint, status, httpStatus, detail, nowIso())
      .run();
    results.push({ target, status, endpoint, httpStatus, detail });
  }
  return { source, links: targets.length, results };
}
export async function sentMentions(env: Env, url: URL) {
  const kind = url.searchParams.get('kind');
  const ref = url.searchParams.get('ref');
  const { results } = await env.DB.prepare(`SELECT source_kind AS kind, source_ref AS ref, source, target, endpoint, status, http_status AS httpStatus, detail, sent_at AS sentAt FROM webmention_sends ${kind && ref ? 'WHERE source_kind = ? AND source_ref = ?' : ''} ORDER BY sent_at DESC LIMIT 200`).bind(...(kind && ref ? [kind, ref] : [])).all();
  return { items: results };
}

// ============================================================ GitHub 仓库元数据（公开 API，无令牌，服务端缓存）
export async function projectGithub(env: Env, slug: string) {
  const p = await publicProject(env, slug);
  const repo = parseRepoUrl(p.repo_url);
  if (!repo) throw notFound('这个项目没有关联 GitHub 仓库');
  const key = `${repo.owner}/${repo.repo}`.toLowerCase();
  const row = await env.DB.prepare('SELECT data, etag, status, fetched_at FROM github_cache WHERE repo = ?').bind(key).first<{ data: string; etag: string; status: string; fetched_at: string }>();
  const fresh = row && Date.now() - Date.parse(row.fetched_at) < GH_TTL_MS;
  const out = (data: GhRepo, fetchedAt: string, stale: boolean, cached: boolean) => ({ repo: data, fetchedAt, stale, cached, source: 'api.github.com' });
  if (row && fresh) {
    if (row.status === 'not_found') throw notFound('GitHub 上找不到这个仓库（可能是私有仓库或已删除）');
    if (row.status === 'ok') return out(JSON.parse(row.data) as GhRepo, row.fetched_at, false, true);
  }
  const base = ((env as Env & { GITHUB_API?: string }).GITHUB_API ?? 'https://api.github.com').replace(/\/+$/, '');
  const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': 'TheBLOG/1.20 (+https://github.com/HarrisonCN/TheBLOG)', 'x-github-api-version': '2022-11-28' };
  if (row?.etag && row.status === 'ok') headers['if-none-match'] = row.etag;
  const t = nowIso();
  try {
    const res = await fetch(`${base}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`, { headers, signal: AbortSignal.timeout(5000) });
    if (res.status === 304 && row) {
      await env.DB.prepare('UPDATE github_cache SET fetched_at = ? WHERE repo = ?').bind(t, key).run();
      return out(JSON.parse(row.data) as GhRepo, t, false, true);
    }
    if (res.status === 404) {
      await env.DB.prepare("INSERT INTO github_cache (repo, data, etag, status, fetched_at) VALUES (?, '{}', '', 'not_found', ?) ON CONFLICT(repo) DO UPDATE SET status = 'not_found', fetched_at = excluded.fetched_at").bind(key, t).run();
      throw notFound('GitHub 上找不到这个仓库（可能是私有仓库或已删除）');
    }
    if (!res.ok) throw new Error(`github ${res.status}`);
    const j = (await res.json()) as Record<string, unknown>;
    let rel: Record<string, unknown> | null = null;
    const rr = await fetch(`${base}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/releases/latest`, { headers: { ...headers, 'if-none-match': '' }, signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (rr?.ok) rel = (await rr.json()) as Record<string, unknown>;
    const data = normalizeRepo(j, rel);
    await env.DB.prepare("INSERT INTO github_cache (repo, data, etag, status, fetched_at) VALUES (?, ?, ?, 'ok', ?) ON CONFLICT(repo) DO UPDATE SET data = excluded.data, etag = excluded.etag, status = 'ok', fetched_at = excluded.fetched_at")
      .bind(key, JSON.stringify(data), res.headers.get('etag') ?? '', t)
      .run();
    return out(data, t, false, false);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    // 限流 / 网络错误：有旧缓存就返回旧数据（标记 stale），没有就 502
    if (row?.status === 'ok') return out(JSON.parse(row.data) as GhRepo, row.fetched_at, true, true);
    throw new HttpError(502, 'upstream_unavailable', '暂时拿不到 GitHub 仓库信息，请稍后再试');
  }
}

// ============================================================ 邮件摘要订阅
async function resolveSubTarget(env: Env, kind: 'user' | 'topic', ref: string): Promise<{ id: number; label: string; url: string; ref: string }> {
  if (kind === 'user') {
    const u = await publicProfile(env, ref);
    return { id: u.id, label: `${u.nickname}（@${u.username}）`, url: `u/${u.username}/`, ref: u.username };
  }
  const t = await topicBySlug(env, ref);
  return { id: t.id, label: `#${t.name}`, url: `t/${t.slug}/`, ref: t.slug };
}
interface SubRow { id: number; member_id: number; kind: 'user' | 'topic'; ref_id: number; frequency: 'daily' | 'weekly'; unsub_hash: string; last_sent_at: string | null; created_at: string }
async function subView(env: Env, r: SubRow, site: string) {
  let label = '';
  let ref = '';
  if (r.kind === 'user') {
    const c = await card(env, r.ref_id);
    label = c ? `${c.nickname}（@${c.username}）` : '已注销用户';
    ref = c?.username ?? '';
  } else {
    const t = await env.DB.prepare('SELECT slug, name FROM topics WHERE id = ?').bind(r.ref_id).first<{ slug: string; name: string }>();
    label = t ? `#${t.name}` : '已删除的话题';
    ref = t?.slug ?? '';
  }
  return { id: r.id, kind: r.kind, ref, label, url: ref ? pageUrl(site, r.kind === 'user' ? 'user' : 'topic', ref) : '', frequency: r.frequency, lastSentAt: r.last_sent_at, createdAt: r.created_at };
}
export async function listSubscriptions(req: Request, env: Env, url: URL) {
  const me = await requireMember(req, env);
  const site = siteBase(env, req);
  const { results } = await env.DB.prepare('SELECT * FROM digest_subscriptions WHERE member_id = ? ORDER BY id DESC').bind(me.id).all<SubRow>();
  let items = await Promise.all(results.map((r) => subView(env, r, site)));
  const kind = url.searchParams.get('kind');
  const ref = url.searchParams.get('ref');
  if (kind && ref) items = items.filter((i) => i.kind === kind && i.ref === ref.toLowerCase());
  return { subscriptions: items, limits: SUB_LIMITS, email: me.email ? me.email.replace(/^(.).*(@.*)$/, '$1***$2') : '' };
}
export async function createSubscription(req: Request, env: Env, input: unknown) {
  const me = await requireMember(req, env);
  const c = checkSubscription(input);
  if (!c.ok) throw bad(c.path, c.error);
  await rateLimit(env, 'sub-ops', String(me.id), SUB_LIMITS.opsPerHour, 3600, '订阅操作太频繁，请一小时后再试');
  const t = await resolveSubTarget(env, c.value.kind, c.value.ref);
  if (c.value.kind === 'user' && t.id === me.id) throw bad('ref', '不能订阅自己');
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM digest_subscriptions WHERE member_id = ?').bind(me.id).first<{ n: number }>())?.n ?? 0;
  const existing = await env.DB.prepare('SELECT * FROM digest_subscriptions WHERE member_id = ? AND kind = ? AND ref_id = ?').bind(me.id, c.value.kind, t.id).first<SubRow>();
  if (!existing && n >= SUB_LIMITS.max) throw new HttpError(409, 'limit_reached', `最多订阅 ${SUB_LIMITS.max} 个创作者 / 话题`);
  if (existing) {
    await env.DB.prepare('UPDATE digest_subscriptions SET frequency = ? WHERE id = ?').bind(c.value.frequency, existing.id).run();
  } else {
    await env.DB.prepare('INSERT INTO digest_subscriptions (member_id, kind, ref_id, frequency, unsub_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(me.id, c.value.kind, t.id, c.value.frequency, await sha256Hex(randomToken(24)), nowIso()).run();
  }
  const row = await env.DB.prepare('SELECT * FROM digest_subscriptions WHERE member_id = ? AND kind = ? AND ref_id = ?').bind(me.id, c.value.kind, t.id).first<SubRow>();
  return { subscription: await subView(env, row!, siteBase(env, req)) };
}
export async function deleteSubscription(req: Request, env: Env, id: number) {
  const me = await requireMember(req, env);
  const r = await env.DB.prepare('DELETE FROM digest_subscriptions WHERE id = ? AND member_id = ? RETURNING id').bind(id, me.id).first();
  if (!r) throw notFound('订阅不存在');
  return { ok: true, id };
}
/** 一键退订：令牌只在邮件里出现，库里存 SHA-256。GET 显示确认结果（邮件客户端的链接），POST 支持 RFC 8058 One-Click。 */
export async function unsubscribe(req: Request, env: Env, url: URL): Promise<Response> {
  const t = url.searchParams.get('t') ?? '';
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(t)) throw bad('t', '退订链接无效');
  await rateLimit(env, 'unsub', await ipKey(req, env), 30, 3600);
  const gone = (await env.DB.prepare('DELETE FROM digest_subscriptions WHERE unsub_hash = ? RETURNING id').bind(await sha256Hex(t)).all()).results;
  const r = gone.length > 0;
  const site = siteBase(env, req);
  if (req.method === 'POST') return json({ ok: true, removed: gone.length }, { headers: NO_STORE });
  const msg = r ? `已退订全部邮件摘要（${gone.length} 条订阅）。以后不会再收到摘要邮件。` : '已经退订过了（或链接已失效：每封新邮件都会换一个退订链接）。';
  return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>退订</title><style>body{font:16px/1.7 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#1e293b}a{color:#1d4ed8}</style></head><body><h1>退订</h1><p>${msg}</p><p><a href="${esc(site)}me/">管理全部订阅</a></p></body></html>`, {
    headers: { 'content-type': 'text/html; charset=utf-8', ...NO_STORE, 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" },
  });
}
/** 定时任务：给到期的订阅发一封汇总邮件（每人每期最多一封、最多 20 条；没有新内容就不发）。 */
export async function sendDigests(env: Env, now = new Date(), site?: string, apiBase?: string): Promise<{ members: number; emails: number }> {
  const base = (site ?? env.SITE_URL ?? '').replace(/\/?$/, '/');
  const api = (apiBase ?? env.SITE_URL ?? '').replace(/\/+$/, '');
  const settings = await svc.getSettings(env);
  const { results } = await env.DB.prepare('SELECT * FROM digest_subscriptions ORDER BY member_id, id LIMIT 5000').all<SubRow>();
  const byMember = new Map<number, SubRow[]>();
  for (const r of results) if (isDigestDue(r.last_sent_at, r.created_at, r.frequency, now)) byMember.set(r.member_id, [...(byMember.get(r.member_id) ?? []), r]);
  let emails = 0;
  for (const [memberId, subs] of byMember) {
    let m: Member;
    try {
      m = await getMember(env, memberId);
    } catch {
      continue;
    }
    const seen = new Set<number>();
    const items: { title: string; url: string; author: string; source: string }[] = [];
    for (const s of subs) {
      const since = s.last_sent_at ?? s.created_at;
      const where = s.kind === 'user' ? 'AND p.author_id = ?' : 'AND p.id IN (SELECT post_id FROM post_topics WHERE topic_id = ?)';
      const { results: rows } = await env.DB.prepare(`SELECT p.* FROM user_posts p WHERE ${PUBLIC_SQL} ${where} AND p.published_at > ? AND p.author_id != ? ORDER BY p.published_at DESC LIMIT 20`).bind(s.ref_id, since, memberId).all<WorkRow>();
      const label = (await subView(env, s, base)).label;
      for (const w of await toWorks(env, rows, null)) {
        if (seen.has(w.id)) continue;
        seen.add(w.id);
        items.push({ title: w.title || (w.caption || w.body).slice(0, 40), url: pageUrl(base, 'work', w.id), author: w.author.nickname, source: label });
      }
    }
    const t = now.toISOString();
    const stmts = subs.map((s) => env.DB.prepare('UPDATE digest_subscriptions SET last_sent_at = ? WHERE id = ?').bind(t, s.id));
    if (items.length && m.email) {
      // 退订链接要用明文令牌：每次发送前重新生成，替换这个会员全部订阅的哈希（一键退订全部；旧邮件里的链接随之失效）
      const tok = randomToken(24);
      stmts.push(env.DB.prepare('UPDATE digest_subscriptions SET unsub_hash = ? WHERE member_id = ?').bind(await sha256Hex(tok), memberId));
      const unsub = `${api}/api/open/unsubscribe?t=${tok}`;
      const d = composeDigest({ name: m.name, siteTitle: settings.siteTitle, items, manageUrl: `${base}me/#subscriptions`, unsubscribeUrl: unsub });
      try {
        await rateLimit(env, 'digest', String(memberId), 1, 20 * 3600);
        await sendEmail(env, { to: m.email, subject: d.subject, text: d.text, headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
        emails++;
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 429)) console.error('digest send failed', memberId, e);
      }
    }
    await env.DB.batch(stmts);
  }
  return { members: byMember.size, emails };
}

// ============================================================ MCP 分层令牌
export async function roleOf(env: Env, memberId: number): Promise<MemberRole> {
  const r = await env.DB.prepare('SELECT role FROM member_roles WHERE member_id = ?').bind(memberId).first<{ role: MemberRole }>();
  return r?.role ?? 'member';
}
interface TokenRow { id: number; member_id: number; name: string; scope: McpScope; token_hash: string; prefix: string; created_at: string; last_used_at: string | null; expires_at: string | null; revoked_at: string | null }
const tokenView = (t: TokenRow) => ({ id: t.id, name: t.name, scope: t.scope, prefix: t.prefix, createdAt: t.created_at, lastUsedAt: t.last_used_at, expiresAt: t.expires_at, revokedAt: t.revoked_at, active: !t.revoked_at && (!t.expires_at || Date.parse(t.expires_at) > Date.now()) });
export async function listTokens(req: Request, env: Env) {
  const me = await requireMember(req, env);
  const role = await roleOf(env, me.id);
  const { results } = await env.DB.prepare('SELECT * FROM mcp_tokens WHERE member_id = ? ORDER BY id DESC LIMIT 50').bind(me.id).all<TokenRow>();
  return { tokens: results.map(tokenView), role, scopes: scopesFor(role), maxScope: maxScopeFor(role), limits: MCP_LIMITS, endpoint: `${apiOrigin(req)}/mcp` };
}
export async function createToken(req: Request, env: Env, input: unknown) {
  const me = await requireMember(req, env);
  const role = await roleOf(env, me.id);
  const c = checkTokenInput(input, role);
  if (!c.ok) throw bad(c.path, c.error);
  const active = (await env.DB.prepare('SELECT COUNT(*) AS n FROM mcp_tokens WHERE member_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)').bind(me.id, nowIso()).first<{ n: number }>())?.n ?? 0;
  if (active >= MCP_LIMITS.active) throw new HttpError(409, 'limit_reached', `最多同时有 ${MCP_LIMITS.active} 个有效令牌，请先撤销不用的`);
  await rateLimit(env, 'mcp-create', String(me.id), MCP_LIMITS.createPerDay, 86_400, '今天创建的令牌太多了，明天再来');
  const token = `mcp_${randomToken(32)}`;
  const t = nowIso();
  const expires = c.value.ttlDays ? new Date(Date.now() + c.value.ttlDays * 86400_000).toISOString() : null;
  const row = await env.DB.prepare('INSERT INTO mcp_tokens (member_id, name, scope, token_hash, prefix, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *')
    .bind(me.id, c.value.name, c.value.scope, await sha256Hex(token), token.slice(0, 10), t, expires)
    .first<TokenRow>();
  await env.DB.prepare("INSERT INTO mcp_audit (token_id, member_id, method, tool, ok, code, created_at) VALUES (?, ?, 'token/create', ?, 1, '', ?)").bind(row!.id, me.id, c.value.scope, t).run();
  return { token, item: tokenView(row!), note: '令牌只显示这一次，请立即复制保存；库里只存它的哈希。' };
}
export async function revokeToken(req: Request, env: Env, id: number) {
  const me = await requireMember(req, env);
  const t = nowIso();
  const r = await env.DB.prepare('UPDATE mcp_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND member_id = ? RETURNING *').bind(t, id, me.id).first<TokenRow>();
  if (!r) throw notFound('令牌不存在');
  await env.DB.prepare("INSERT INTO mcp_audit (token_id, member_id, method, tool, ok, code, created_at) VALUES (?, ?, 'token/revoke', '', 1, '', ?)").bind(id, me.id, t).run();
  return { ok: true, item: tokenView(r) };
}
export async function tokenAudit(req: Request, env: Env) {
  const me = await requireMember(req, env);
  const { results } = await env.DB.prepare('SELECT a.id, a.token_id AS tokenId, t.name AS tokenName, a.method, a.tool, a.ok, a.code, a.created_at AS createdAt FROM mcp_audit a LEFT JOIN mcp_tokens t ON t.id = a.token_id WHERE a.member_id = ? ORDER BY a.id DESC LIMIT 50').bind(me.id).all();
  return { audit: results.map((r) => ({ ...r, ok: !!(r as { ok: number }).ok })) };
}
export interface McpAuth { scope: McpScope; memberId: number | null; tokenId: number | null }
/** /mcp 鉴权：会员令牌（mcp_…）→ 按作用域；环境变量里的站长令牌 → admin。返回 null = 无效。 */
export async function verifyMcpToken(req: Request, env: Env): Promise<McpAuth | null> {
  const m = /^Bearer\s+(mcp_[A-Za-z0-9_-]{32,64})$/i.exec(req.headers.get('authorization') ?? '');
  if (!m) return null;
  const row = await env.DB.prepare('SELECT * FROM mcp_tokens WHERE token_hash = ?').bind(await sha256Hex(m[1]!)).first<TokenRow>();
  if (!row || row.revoked_at || (row.expires_at && Date.parse(row.expires_at) <= Date.now())) return null;
  // 作用域不能超过当前角色（站长撤销审核员身份后，旧的审核令牌自动降级为作者权限）
  const role = await roleOf(env, row.member_id);
  const cap = maxScopeFor(role);
  const scope = scopesFor(role).includes(row.scope) ? row.scope : cap;
  const banned = await env.DB.prepare('SELECT 1 FROM member_standing WHERE member_id = ? AND banned_at IS NOT NULL').bind(row.member_id).first();
  const effective: McpScope = banned ? 'read-public' : scope;
  await env.DB.prepare('UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?').bind(nowIso(), row.id).run();
  return { scope: effective, memberId: row.member_id, tokenId: row.id };
}
export async function auditMcp(env: Env, auth: McpAuth, method: string, tool: string, ok: boolean, code: string): Promise<void> {
  if (auth.tokenId === null) return;
  await env.DB.prepare('INSERT INTO mcp_audit (token_id, member_id, method, tool, ok, code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(auth.tokenId, auth.memberId, method, tool, ok ? 1 : 0, code, nowIso()).run();
}

// ============================================================ AI 辅助（功能开关，默认关闭）
export async function aiEnabled(env: Env): Promise<boolean> {
  return (await env.DB.prepare("SELECT value FROM open_flags WHERE key = 'ai_assist'").first<{ value: string }>())?.value === 'on';
}
export async function setAiFlag(env: Env, input: unknown) {
  const on = (input as { enabled?: unknown } | null)?.enabled;
  if (typeof on !== 'boolean') throw bad('enabled', 'enabled 必须是 true / false');
  await env.DB.prepare("INSERT INTO open_flags (key, value, updated_at) VALUES ('ai_assist', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(on ? 'on' : 'off', nowIso()).run();
  return aiStatus(env);
}
const providerName = (env: Env) => {
  const e = env as Env & { AI_PROVIDER?: string; AI_API_URL?: string; AI_API_KEY?: string };
  return e.AI_PROVIDER === 'openai-compatible' && e.AI_API_URL && e.AI_API_KEY ? 'openai-compatible' : 'local';
};
export async function aiStatus(env: Env) {
  return { enabled: await aiEnabled(env), provider: providerName(env), kinds: ['summary', 'tags', 'draft'] };
}
export async function siteTopics(env: Env): Promise<AiTopic[]> {
  const ts = (await env.DB.prepare('SELECT id, slug, name FROM topics ORDER BY sort, id').all<{ id: number; slug: string; name: string }>()).results;
  const tags = (await env.DB.prepare('SELECT tag, topic_id FROM topic_tags').all<{ tag: string; topic_id: number }>()).results;
  return ts.map((t) => ({ slug: t.slug, name: t.name, tags: tags.filter((x) => x.topic_id === t.id).map((x) => x.tag) }));
}
/** 可插拔提供方：openai-compatible（AI_API_URL / AI_API_KEY / AI_MODEL）；失败或未配置 → 本地确定性回退。 */
async function remoteSuggest(env: Env, inp: { kind: string; title: string; body: string }, topics: AiTopic[]): Promise<AiSuggestion | null> {
  const e = env as Env & { AI_API_URL?: string; AI_API_KEY?: string; AI_MODEL?: string };
  if (providerName(env) !== 'openai-compatible') return null;
  const ask = inp.kind === 'summary' ? '用一两句中文概括下面的内容（不超过 120 字），只输出摘要。' : inp.kind === 'tags' ? `从这些话题里挑最多 3 个最相关的，只输出话题名，用顿号分隔：${topics.map((t) => t.name).join('、')}` : '把下面的文字整理成 Markdown 提纲（缘起 / 过程 / 收获），只重排作者自己的内容，不要编造事实。';
  try {
    const r = await fetch(e.AI_API_URL!, {
      method: 'POST',
      headers: { authorization: `Bearer ${e.AI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: e.AI_MODEL ?? 'gpt-4o-mini', temperature: 0.2, max_tokens: 600, messages: [{ role: 'system', content: '你是写作助手。你的输出只是给作者参考的建议，作者会自己决定是否采用。' }, { role: 'user', content: `${ask}\n\n标题：${inp.title}\n\n${inp.body.slice(0, 8000)}` }] }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return null;
    const text = String(((await r.json()) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? '').trim().slice(0, 4000);
    if (!text) return null;
    const base = localSuggest({ kind: inp.kind as 'summary', title: inp.title, body: inp.body }, topics);
    if (inp.kind === 'tags') {
      // 只保留站内真实存在的话题：AI 不能编造话题
      const picked = topics.filter((t) => text.includes(t.name)).slice(0, 3).map(({ slug, name }) => ({ slug, name }));
      return { ...base, provider: 'openai-compatible', text: picked.map((t) => t.name).join('、'), tags: picked };
    }
    return { ...base, provider: 'openai-compatible', text, tags: [] };
  } catch {
    return null;
  }
}
export async function aiSuggest(req: Request, env: Env, input: unknown) {
  const me = await requireMember(req, env);
  if (!(await aiEnabled(env))) throw new HttpError(403, 'ai_disabled', '站长没有开启 AI 辅助功能');
  const c = checkAiInput(input);
  if (!c.ok) throw bad(c.path, c.error);
  await rateLimit(env, 'ai', String(me.id), AI_LIMITS.perHour, 3600, 'AI 建议请求太频繁，请一小时后再试');
  const topics = await siteTopics(env);
  const s = (await remoteSuggest(env, c.value, topics)) ?? localSuggest(c.value, topics);
  return { suggestion: s };
}

// ============================================================ 路由
/** 公开接口（不需要登录）：Webmention、订阅源、开放接口、h-entry 页面、退订。 */
export async function routeOpen(req: Request, env: Env, path: string, url: URL, ctx: Ctx): Promise<Response | null> {
  const m = req.method;
  let mt: RegExpExecArray | null;
  if (path === '/api/webmention') {
    if (m === 'POST') return receiveWebmention(req, env, ctx);
    if (m === 'GET' || m === 'HEAD') return json({ endpoint: `${apiOrigin(req)}/api/webmention`, accepts: 'application/x-www-form-urlencoded: source, target', spec: 'https://www.w3.org/TR/webmention/' }, { headers: OPEN_CACHE });
  }
  if ((mt = new RegExp(`^/api/webmention/${ID}$`).exec(path)) && (m === 'GET' || m === 'HEAD')) {
    const r = await env.DB.prepare('SELECT id, status, error, wm_type, created_at, verified_at FROM webmentions WHERE id = ?').bind(Number(mt[1])).first<{ id: number; status: string; error: string; wm_type: string; created_at: string; verified_at: string | null }>();
    if (!r) throw notFound('Webmention 不存在');
    return json({ id: r.id, status: r.status, type: r.wm_type, error: r.error, createdAt: r.created_at, verifiedAt: r.verified_at }, { headers: NO_STORE });
  }
  if (path === '/api/webmentions' && (m === 'GET' || m === 'HEAD')) return json(await listMentions(req, env, url), { headers: OPEN_CACHE });
  if ((m === 'GET' || m === 'HEAD') && (mt = new RegExp(`^/api/feeds/(?:(site)|(users)/${U}|(topics)/${SLUG}|(projects)/${SLUG})\\.(rss|atom|json)$`).exec(path))) {
    const scope = mt[1] ?? mt[2] ?? mt[4] ?? mt[6]!;
    const ref = mt[3] ?? mt[5] ?? mt[7] ?? '';
    await rateLimit(env, 'open', await ipKey(req, env), OPEN_LIMITS.perMinute, 60, '请求太频繁，请稍后再试');
    return feedFor(req, env, scope, ref, mt[8] as FeedFormat);
  }
  if (path.startsWith('/api/open/v1') && (m === 'GET' || m === 'HEAD')) return openApi(req, env, path.slice('/api/open/v1'.length), url);
  if ((m === 'GET' || m === 'HEAD') && (mt = new RegExp(`^/api/open/h/(?:(works)/${ID}|(posts)/([a-z0-9-]{1,80})|(users)/${U})$`).exec(path))) {
    await rateLimit(env, 'open', await ipKey(req, env), OPEN_LIMITS.perMinute, 60, '请求太频繁，请稍后再试');
    const kind = (mt[1] ?? mt[3] ?? mt[5]) as 'works' | 'posts' | 'users';
    return hEntryPage(req, env, kind, mt[2] ?? mt[4] ?? mt[6]!);
  }
  if (path === '/api/open/unsubscribe' && (m === 'GET' || m === 'POST')) return unsubscribe(req, env, url);
  return null;
}
/** 会员接口（/api/social/…，sub 已去掉前缀）：订阅、MCP 令牌、AI 建议、项目 GitHub 卡片。 */
export async function routeOpenSocial(req: Request, env: Env, sub: string, url: URL, body: () => Promise<unknown>): Promise<Response | null> {
  const m = req.method;
  const ok = (d: unknown, status = 200) => json(d, { status, headers: NO_STORE });
  let mt: RegExpExecArray | null;
  if ((mt = new RegExp(`^/projects/${SLUG}/github$`).exec(sub)) && m === 'GET') return json(await projectGithub(env, mt[1]!), { headers: { 'cache-control': 'public, max-age=300' } });
  if (sub === '/subscriptions') {
    if (m === 'GET') return ok(await listSubscriptions(req, env, url));
    if (m === 'POST') return ok(await createSubscription(req, env, await body()), 201);
  }
  if ((mt = new RegExp(`^/subscriptions/${ID}$`).exec(sub)) && m === 'DELETE') return ok(await deleteSubscription(req, env, Number(mt[1])));
  if (sub === '/mcp/tokens') {
    if (m === 'GET') return ok(await listTokens(req, env));
    if (m === 'POST') return ok(await createToken(req, env, await body()), 201);
  }
  if ((mt = new RegExp(`^/mcp/tokens/${ID}$`).exec(sub)) && m === 'DELETE') return ok(await revokeToken(req, env, Number(mt[1])));
  if (sub === '/mcp/audit' && m === 'GET') return ok(await tokenAudit(req, env));
  if (sub === '/ai/status' && m === 'GET') return ok(await aiStatus(env));
  if (sub === '/ai/suggest' && m === 'POST') return ok(await aiSuggest(req, env, await body()));
  return null;
}
/** 后台 /api/admin/…（已通过 requireAdmin + CSRF）：Webmention 审核 / 外发、站点角色、AI 开关。 */
export async function routeAdminOpen(req: Request, env: Env, sub: string, url: URL, body: () => Promise<unknown>, ctx: Ctx): Promise<Response | null> {
  const m = req.method;
  const ok = (d: unknown) => json(d, { headers: NO_STORE });
  let mt: RegExpExecArray | null;
  if (sub === '/webmentions' && m === 'GET') return ok(await adminMentions(env, url));
  if (sub === '/webmentions/process' && m === 'POST') return ok({ processed: await processQueued(env), pending: await pendingMentionCount(env) });
  if (sub === '/webmentions/send' && m === 'POST') return ok(await sendMentions(req, env, await body()));
  if (sub === '/webmentions/sent' && m === 'GET') return ok(await sentMentions(env, url));
  if ((mt = new RegExp(`^/webmentions/${ID}$`).exec(sub)) && m === 'POST') return ok(await moderateMention(env, Number(mt[1]), ((await body()) as { action?: unknown } | null)?.action));
  if (sub === '/roles' && m === 'GET') {
    const { results } = await env.DB.prepare('SELECT r.member_id AS id, r.role, r.granted_at AS grantedAt, m.name, p.username FROM member_roles r JOIN members m ON m.id = r.member_id LEFT JOIN user_profiles p ON p.member_id = r.member_id ORDER BY r.granted_at DESC').all();
    return ok({ roles: results });
  }
  if ((mt = new RegExp(`^/members/${ID}/role$`).exec(sub)) && (m === 'PUT' || m === 'POST')) {
    const id = Number(mt[1]);
    await getMember(env, id);
    const role = ((await body()) as { role?: unknown } | null)?.role;
    if (role !== 'member' && role !== 'moderator' && role !== 'admin') throw bad('role', 'role 只能是 member / moderator / admin');
    if (role === 'member') await env.DB.prepare('DELETE FROM member_roles WHERE member_id = ?').bind(id).run();
    else await env.DB.prepare('INSERT INTO member_roles (member_id, role, granted_at) VALUES (?, ?, ?) ON CONFLICT(member_id) DO UPDATE SET role = excluded.role, granted_at = excluded.granted_at').bind(id, role, nowIso()).run();
    return ok({ ok: true, id, role });
  }
  if (sub === '/ai') {
    if (m === 'GET') return ok(await aiStatus(env));
    if (m === 'PUT' || m === 'PATCH') return ok(await setAiFlag(env, await body()));
  }
  void ctx;
  return null;
}
/** 定时任务（wrangler triggers.crons）：重试待验证的 Webmention，发送到期的邮件摘要。 */
export async function scheduledOpen(env: Env): Promise<void> {
  await processQueued(env, 50);
  if (env.SITE_URL) await sendDigests(env);
}
