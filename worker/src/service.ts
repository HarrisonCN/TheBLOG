import { buildIndex, MAX_QUERY, search as coreSearch, suggest, type SearchDoc } from './search-core';
import type { Env } from './env';
import { HttpError } from './http';
import {
  DEFAULT_PROFILE,
  DEFAULT_SETTINGS,
  formatZodError,
  postCreateSchema,
  postUpdateSchema,
  profilePatchSchema,
  profileSchema,
  settingsPatchSchema,
  settingsSchema,
  slugSchema,
  contentSchemas,
  guestbookCreateSchema,
  guestbookModerateSchema,
  type ContentKey,
  type ListQuery,
  type Profile,
  type Settings,
} from './schema';
import type { z } from 'zod';
import { validateEssay, validatePostMedia, validateShotNote, type Essay, type PostKind, type ShotNote } from './essay-core';
import { encodeCursor, cursorOf, type PageCursor } from './post-page-core';

export interface PostRow {
  id: number;
  slug: string;
  title: string;
  summary: string;
  content_md: string;
  tags: string;
  cover_url: string | null;
  category: string | null;
  series?: string | null;
  kind?: string | null;
  essay?: string | null;
  notes?: string | null;
  pinned: number;
  word_count: number;
  status: 'draft' | 'published';
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Post {
  id: number;
  slug: string;
  title: string;
  summary: string;
  contentMd: string;
  tags: string[];
  coverUrl: string | null;
  category: string | null;
  /** 系列连载名（null = 不属于系列） */
  series: string | null;
  /** post 普通文章 / essay 影集 */
  kind: PostKind;
  /** 影集（只有 kind = essay 时有；列表接口不带） */
  essay?: Essay | null;
  /** 文章级拍摄手记（列表接口不带） */
  notes?: ShotNote | null;
  pinned: boolean;
  /** 正文字数（近似：Markdown 去掉空白后的字符数） */
  wordCount: number;
  status: 'draft' | 'published';
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export type PostSummary = Omit<Post, 'contentMd' | 'essay' | 'notes'>;

function parseJson<T>(s: string | null | undefined, check: (v: unknown) => T | null): T | null {
  if (!s) return null;
  try {
    return check(JSON.parse(s));
  } catch {
    return null;
  }
}

function parseTags(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((t) => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export function rowToPost(r: PostRow): Post {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    contentMd: r.content_md,
    tags: parseTags(r.tags),
    coverUrl: r.cover_url,
    category: r.category || null,
    series: r.series || null,
    kind: r.kind === 'essay' ? 'essay' : 'post',
    essay: r.kind === 'essay' ? parseJson(r.essay, (v) => validateEssay(v).essay) : null,
    notes: parseJson(r.notes, (v) => validateShotNote(v).note),
    pinned: !!r.pinned,
    wordCount: Number(r.word_count ?? 0),
    status: r.status,
    publishedAt: r.published_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toSummary(p: Post): PostSummary {
  const { contentMd: _omit, essay: _e, notes: _n, ...rest } = p;
  return rest;
}

export function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new HttpError(400, 'validation_error', '参数校验失败', {}, formatZodError(r.error));
  return r.data;
}

const nowIso = () => new Date().toISOString();

export function slugify(title: string): string {
  const s = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return s || `post-${Date.now().toString(36)}`;
}

// 字数：去掉空白与常见 Markdown 符号后的字符数（中文按字计）
const WORDS = "LENGTH(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(content_md, ' ', ''), char(10), ''), char(13), ''), '#', ''), '*', ''), '`', '')) AS word_count";
const COLS = `id, slug, title, summary, content_md, tags, cover_url, category, series, kind, essay, notes, pinned, ${WORDS}, status, published_at, created_at, updated_at`;
const SUMMARY_COLS = `id, slug, title, summary, '' AS content_md, tags, cover_url, category, series, kind, NULL AS essay, NULL AS notes, pinned, ${WORDS}, status, published_at, created_at, updated_at`;
const ORDER = 'ORDER BY pinned DESC, COALESCE(published_at, created_at) DESC, id DESC';

export async function listPosts(
  env: Env,
  q: ListQuery & { includeDrafts?: boolean; cursor?: PageCursor | null },
): Promise<{ posts: PostSummary[]; total: number; nextCursor: string | null }> {
  const where: string[] = [];
  const binds: unknown[] = [];
  const status = q.includeDrafts ? (q.status ?? 'all') : 'published';
  if (status !== 'all') {
    where.push('status = ?');
    binds.push(status);
  }
  if (q.tag) {
    where.push('EXISTS (SELECT 1 FROM json_each(posts.tags) WHERE json_each.value = ?)');
    binds.push(q.tag);
  }
  if (q.category) {
    where.push('category = ?');
    binds.push(q.category);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // 游标（keyset）：严格排在上一页最后一篇之后，顺序 = ORDER 的三元组 (pinned, t, id)
  const page = [...where];
  const pageBinds = [...binds];
  if (q.cursor) {
    const c = q.cursor;
    page.push('(pinned < ? OR (pinned = ? AND (COALESCE(published_at, created_at) < ? OR (COALESCE(published_at, created_at) = ? AND id < ?))))');
    pageBinds.push(c.p, c.p, c.t, c.t, c.i);
  }
  const pw = page.length ? `WHERE ${page.join(' AND ')}` : '';
  const limit = q.limit ?? 20;
  const offset = q.cursor ? 0 : (q.offset ?? 0);
  const [rows, count] = await env.DB.batch([
    env.DB.prepare(`SELECT ${SUMMARY_COLS} FROM posts ${pw} ${ORDER} LIMIT ? OFFSET ?`).bind(...pageBinds, limit + 1, offset),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM posts ${w}`).bind(...binds),
  ]);
  const all = ((rows!.results ?? []) as PostRow[]).map((r) => toSummary(rowToPost(r)));
  const posts = all.slice(0, limit);
  const total = Number((count!.results?.[0] as { n: number } | undefined)?.n ?? 0);
  const nextCursor = all.length > limit ? encodeCursor(cursorOf(posts[posts.length - 1]!)) : null;
  return { posts, total, nextCursor };
}

// ---- 文章摘要索引：列表、归档、地图、系列、相关文章、搜索回退共用（全部已发布文章，不含正文） ----
// 版本号由数据库算出（篇数 / 最新修改时间 / id 之和 / 最大 id），任何创建、修改、删除、发布状态变化都会改变它，
// 所以多个 isolate 之间也一致；isolate 内按版本缓存序列化结果，写操作时顺手清掉。
let indexCache: { version: string; body: string } | null = null;
export function invalidatePostIndex(): void {
  indexCache = null;
}

export async function postIndexVersion(env: Env): Promise<string> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), '') AS u, COALESCE(SUM(id), 0) AS s, COALESCE(MAX(id), 0) AS m FROM posts WHERE status = 'published'").first<{ n: number; u: string; s: number; m: number }>();
  const raw = `${r?.n ?? 0}|${r?.u ?? ''}|${r?.s ?? 0}|${r?.m ?? 0}`;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)));
  return `pi-${[...digest.slice(0, 9)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** 返回序列化好的索引 JSON 与版本号（ETag 用）。 */
export async function postIndex(env: Env): Promise<{ version: string; body: string }> {
  const version = await postIndexVersion(env);
  if (indexCache?.version === version) return indexCache;
  const { results } = await env.DB.prepare(`SELECT ${SUMMARY_COLS} FROM posts WHERE status = 'published' ${ORDER}`).all<PostRow>();
  const posts = (results ?? []).map((r) => toSummary(rowToPost(r)));
  indexCache = { version, body: JSON.stringify({ posts, total: posts.length, version }) };
  return indexCache;
}

export async function getPost(env: Env, slug: string, opts: { includeDrafts?: boolean } = {}): Promise<Post> {
  const s = validate(slugSchema, slug);
  const row = await env.DB.prepare(`SELECT ${COLS} FROM posts WHERE slug = ?`).bind(s).first<PostRow>();
  if (!row || (!opts.includeDrafts && row.status !== 'published')) throw new HttpError(404, 'not_found', '文章不存在');
  return rowToPost(row);
}

export async function listTags(env: Env): Promise<{ tag: string; count: number }[]> {
  const { results } = await env.DB.prepare(
    "SELECT json_each.value AS tag, COUNT(*) AS count FROM posts, json_each(posts.tags) WHERE posts.status = 'published' GROUP BY json_each.value ORDER BY count DESC, tag ASC",
  ).all<{ tag: string; count: number }>();
  return results ?? [];
}

export async function listCategories(env: Env): Promise<{ category: string; count: number }[]> {
  const { results } = await env.DB.prepare(
    "SELECT category, COUNT(*) AS count FROM posts WHERE status = 'published' AND category IS NOT NULL AND category <> '' GROUP BY category ORDER BY count DESC, category ASC",
  ).all<{ category: string; count: number }>();
  return results ?? [];
}

/** 站内搜索索引：已发布文章的标题、摘要、标签、分类与正文纯文本（截断）。 */
export async function searchIndex(env: Env): Promise<{ slug: string; title: string; summary: string; tags: string[]; category: string | null; text: string }[]> {
  const { results } = await env.DB.prepare(`SELECT ${COLS} FROM posts WHERE status = 'published' ${ORDER}`).all<PostRow>();
  return (results ?? []).map((r) => ({ slug: r.slug, title: r.title, summary: r.summary, tags: parseTags(r.tags), category: r.category || null, text: plainText(r.content_md).slice(0, 3000) }));
}

/** L26：GET /api/search —— 与前端同一套 search-core 排名（已发布文章，内存索引；D1 FTS5 = SKIPPED-verifiable）。 */
export async function searchPosts(env: Env, q: string, filters: { tag?: string | null; year?: string | null }): Promise<{ hits: { slug: string; title: string; summary: string; tags: string[]; category: string | null; series: string | null; publishedAt: string | null; score: number }[]; total: number; suggestions: string[] }> {
  const query = (q ?? '').trim().slice(0, MAX_QUERY);
  if (!query) return { hits: [], total: 0, suggestions: [] };
  const { results } = await env.DB.prepare(`SELECT ${COLS} FROM posts WHERE status = 'published' ${ORDER}`).all<PostRow & { series: string | null }>();
  const docs: SearchDoc[] = (results ?? []).map((r) => ({ id: r.slug, kind: 'post', title: r.title, summary: r.summary, text: plainText(r.content_md).slice(0, 3000), tags: parseTags(r.tags), section: r.category || null, series: (r.series ?? '').trim() || null, date: r.published_at ?? null, href: `/posts/${r.slug}/` }));
  const index = buildIndex(docs);
  const hits = coreSearch(index, query, { tag: filters.tag ?? null, year: filters.year && /^\d{4}$/.test(filters.year) ? filters.year : null }, 50);
  return {
    hits: hits.map((h) => ({ slug: h.doc.id, title: h.doc.title, summary: h.doc.summary, tags: h.doc.tags, category: h.doc.section ?? null, series: h.doc.series ?? null, publishedAt: h.doc.date ?? null, score: h.score })),
    total: hits.length,
    suggestions: hits.length ? [] : suggest(index, query, 5),
  };
}

export function plainText(md: string): string {
  return (md ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function slugExists(env: Env, slug: string): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT 1 AS x FROM posts WHERE slug = ?').bind(slug).first());
}

export async function createPost(env: Env, input: unknown): Promise<Post> {
  const data = validate(postCreateSchema, input);
  let slug = data.slug ?? slugify(data.title);
  if (await slugExists(env, slug)) {
    if (data.slug) throw new HttpError(409, 'slug_conflict', `slug「${slug}」已存在`);
    slug = `${slug.slice(0, 70)}-${Date.now().toString(36)}`;
  }
  const media = checkMedia(data);
  const status = data.status ?? 'draft';
  const ts = nowIso();
  const row = await env.DB.prepare(
    `INSERT INTO posts (slug, title, summary, content_md, tags, cover_url, category, series, kind, essay, notes, pinned, status, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${COLS}`,
  )
    .bind(slug, data.title, data.summary ?? '', data.contentMd ?? '', JSON.stringify(dedupe(data.tags ?? [])), data.coverUrl || null, data.category || null, data.series || null, media.kind, media.essay ? JSON.stringify(media.essay) : null, media.notes ? JSON.stringify(media.notes) : null, data.pinned ? 1 : 0, status, status === 'published' ? ts : null, ts, ts)
    .first<PostRow>();
  invalidatePostIndex();
  return rowToPost(row!);
}

/** 影集 / 拍摄手记的严格校验（规则与 web 共用 essay-core.ts） */
function checkMedia(data: { kind?: unknown; essay?: unknown; notes?: unknown }, current?: Post) {
  const r = validatePostMedia(data, current ? { kind: current.kind, essay: current.essay ?? null, notes: current.notes ?? null } : undefined);
  if (r.issues.length) throw new HttpError(400, 'validation_error', '参数校验失败', {}, r.issues);
  return r;
}

function dedupe(tags: string[]): string[] {
  return [...new Set(tags)];
}

export async function updatePost(env: Env, slug: string, input: unknown): Promise<Post> {
  const current = await getPost(env, slug, { includeDrafts: true });
  const data = validate(postUpdateSchema, input);
  if (data.slug && data.slug !== current.slug && (await slugExists(env, data.slug))) {
    throw new HttpError(409, 'slug_conflict', `slug「${data.slug}」已存在`);
  }
  const media = checkMedia(data, current);
  const row = await env.DB.prepare(
    `UPDATE posts SET slug = ?, title = ?, summary = ?, content_md = ?, tags = ?, cover_url = ?, category = ?, series = ?, kind = ?, essay = ?, notes = ?, pinned = ?, updated_at = ? WHERE id = ? RETURNING ${COLS}`,
  )
    .bind(
      data.slug ?? current.slug,
      data.title ?? current.title,
      data.summary ?? current.summary,
      data.contentMd ?? current.contentMd,
      JSON.stringify(dedupe(data.tags ?? current.tags)),
      data.coverUrl === undefined ? current.coverUrl : data.coverUrl || null,
      data.category === undefined ? current.category : data.category || null,
      data.series === undefined ? current.series ?? null : data.series || null,
      media.kind,
      media.essay ? JSON.stringify(media.essay) : null,
      media.notes ? JSON.stringify(media.notes) : null,
      (data.pinned ?? current.pinned) ? 1 : 0,
      nowIso(),
      current.id,
    )
    .first<PostRow>();
  invalidatePostIndex();
  return rowToPost(row!);
}

export async function deletePost(env: Env, slug: string): Promise<{ deleted: true; slug: string }> {
  const current = await getPost(env, slug, { includeDrafts: true });
  await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(current.id).run();
  invalidatePostIndex();
  return { deleted: true, slug: current.slug };
}

export async function setPublished(env: Env, slug: string, published = true): Promise<Post> {
  const current = await getPost(env, slug, { includeDrafts: true });
  const ts = nowIso();
  const row = await env.DB.prepare(
    `UPDATE posts SET status = ?, published_at = ?, updated_at = ?, publish_at = NULL WHERE id = ? RETURNING ${COLS}`,
  )
    .bind(published ? 'published' : 'draft', published ? (current.publishedAt ?? ts) : current.publishedAt, ts, current.id)
    .first<PostRow>();
  invalidatePostIndex();
  return rowToPost(row!);
}

async function readSingleton<T>(env: Env, table: 'profile' | 'settings', fallback: T): Promise<T> {
  const row = await env.DB.prepare(`SELECT data FROM ${table} WHERE id = 1`).first<{ data: string }>();
  if (!row) return fallback;
  try {
    return { ...fallback, ...JSON.parse(row.data) };
  } catch {
    return fallback;
  }
}

async function writeSingleton(env: Env, table: 'profile' | 'settings', data: unknown): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO ${table} (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  )
    .bind(JSON.stringify(data), nowIso())
    .run();
}

export async function getProfile(env: Env): Promise<Profile> {
  return readSingleton(env, 'profile', DEFAULT_PROFILE);
}

export async function updateProfile(env: Env, input: unknown): Promise<Profile> {
  const patch = validate(profilePatchSchema, input);
  const next = validate(profileSchema, { ...(await getProfile(env)), ...patch });
  await writeSingleton(env, 'profile', next);
  return next;
}

export async function getSettings(env: Env): Promise<Settings> {
  const s = await readSingleton(env, 'settings', DEFAULT_SETTINGS);
  return { ...s, sections: { ...DEFAULT_SETTINGS.sections, ...(s.sections ?? {}) } };
}

export async function updateSettings(env: Env, input: unknown): Promise<Settings> {
  const patch = validate(settingsPatchSchema, input);
  const cur = await getSettings(env);
  const next = validate(settingsSchema, { ...cur, ...patch, sections: { ...cur.sections, ...(patch.sections ?? {}) } });
  await writeSingleton(env, 'settings', next);
  return next;
}

// ---------- 站点内容：友链 / 画廊 / 收藏 ----------
export async function getContent(env: Env, key: ContentKey): Promise<unknown[]> {
  const row = await env.DB.prepare('SELECT data FROM site_content WHERE key = ?').bind(key).first<{ data: string }>();
  if (!row) return [];
  try {
    const v = JSON.parse(row.data);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function setContent(env: Env, key: ContentKey, input: unknown): Promise<unknown[]> {
  const items = validate(contentSchemas[key] as z.ZodType<unknown[]>, input);
  await env.DB.prepare(
    'INSERT INTO site_content (key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
  )
    .bind(key, JSON.stringify(items), nowIso())
    .run();
  return items;
}

// ---------- 留言板（先审后发） ----------
export interface GuestbookEntry {
  id: number;
  name: string;
  content: string;
  website: string;
  status: 'pending' | 'approved' | 'hidden';
  createdAt: string;
}
interface GuestbookRow {
  id: number;
  name: string;
  content: string;
  website: string | null;
  status: GuestbookEntry['status'];
  created_at: string;
}
const toEntry = (r: GuestbookRow): GuestbookEntry => ({ id: r.id, name: r.name, content: r.content, website: r.website ?? '', status: r.status, createdAt: r.created_at });
export const MAX_PENDING_GUESTBOOK = 200;

export async function listGuestbook(env: Env, opts: { status?: 'pending' | 'approved' | 'hidden' | 'all'; limit?: number } = {}): Promise<{ entries: GuestbookEntry[] }> {
  const status = opts.status ?? 'approved';
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const stmt =
    status === 'all'
      ? env.DB.prepare('SELECT * FROM guestbook ORDER BY id DESC LIMIT ?').bind(limit)
      : env.DB.prepare('SELECT * FROM guestbook WHERE status = ? ORDER BY id DESC LIMIT ?').bind(status, limit);
  const { results } = await stmt.all<GuestbookRow>();
  return { entries: (results ?? []).map(toEntry) };
}

export async function createGuestbook(env: Env, input: unknown): Promise<GuestbookEntry> {
  const data = validate(guestbookCreateSchema, input);
  const pending = await env.DB.prepare("SELECT COUNT(*) AS n FROM guestbook WHERE status = 'pending'").first<{ n: number }>();
  if (Number(pending?.n ?? 0) >= MAX_PENDING_GUESTBOOK) throw new HttpError(429, 'too_many_pending', '待审核的留言太多了，请稍后再试');
  const row = await env.DB.prepare("INSERT INTO guestbook (name, content, website, status, created_at) VALUES (?, ?, ?, 'pending', ?) RETURNING *")
    .bind(data.name, data.content, data.website || null, nowIso())
    .first<GuestbookRow>();
  return toEntry(row!);
}

export async function moderateGuestbook(env: Env, input: unknown): Promise<{ id: number; action: string }> {
  const { id, action } = validate(guestbookModerateSchema, input);
  const res =
    action === 'delete'
      ? await env.DB.prepare('DELETE FROM guestbook WHERE id = ?').bind(id).run()
      : await env.DB.prepare('UPDATE guestbook SET status = ? WHERE id = ?').bind(action === 'approve' ? 'approved' : 'hidden', id).run();
  if (!res.meta?.changes) throw new HttpError(404, 'not_found', '留言不存在');
  return { id, action };
}
