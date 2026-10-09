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
  type ListQuery,
  type Profile,
  type Settings,
} from './schema';
import type { z } from 'zod';

export interface PostRow {
  id: number;
  slug: string;
  title: string;
  summary: string;
  content_md: string;
  tags: string;
  cover_url: string | null;
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
  status: 'draft' | 'published';
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export type PostSummary = Omit<Post, 'contentMd'>;

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
    status: r.status,
    publishedAt: r.published_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toSummary(p: Post): PostSummary {
  const { contentMd: _omit, ...rest } = p;
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

const COLS = 'id, slug, title, summary, content_md, tags, cover_url, status, published_at, created_at, updated_at';
const SUMMARY_COLS = "id, slug, title, summary, '' AS content_md, tags, cover_url, status, published_at, created_at, updated_at";

export async function listPosts(env: Env, q: ListQuery & { includeDrafts?: boolean }): Promise<{ posts: PostSummary[]; total: number }> {
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
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = q.limit ?? 20;
  const offset = q.offset ?? 0;
  const [rows, count] = await env.DB.batch([
    env.DB.prepare(`SELECT ${SUMMARY_COLS} FROM posts ${w} ORDER BY COALESCE(published_at, created_at) DESC, id DESC LIMIT ? OFFSET ?`).bind(...binds, limit, offset),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM posts ${w}`).bind(...binds),
  ]);
  const posts = ((rows!.results ?? []) as PostRow[]).map((r) => toSummary(rowToPost(r)));
  const total = Number((count!.results?.[0] as { n: number } | undefined)?.n ?? 0);
  return { posts, total };
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
  const status = data.status ?? 'draft';
  const ts = nowIso();
  const row = await env.DB.prepare(
    `INSERT INTO posts (slug, title, summary, content_md, tags, cover_url, status, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${COLS}`,
  )
    .bind(slug, data.title, data.summary ?? '', data.contentMd ?? '', JSON.stringify(dedupe(data.tags ?? [])), data.coverUrl || null, status, status === 'published' ? ts : null, ts, ts)
    .first<PostRow>();
  return rowToPost(row!);
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
  const row = await env.DB.prepare(
    `UPDATE posts SET slug = ?, title = ?, summary = ?, content_md = ?, tags = ?, cover_url = ?, updated_at = ? WHERE id = ? RETURNING ${COLS}`,
  )
    .bind(
      data.slug ?? current.slug,
      data.title ?? current.title,
      data.summary ?? current.summary,
      data.contentMd ?? current.contentMd,
      JSON.stringify(dedupe(data.tags ?? current.tags)),
      data.coverUrl === undefined ? current.coverUrl : data.coverUrl || null,
      nowIso(),
      current.id,
    )
    .first<PostRow>();
  return rowToPost(row!);
}

export async function deletePost(env: Env, slug: string): Promise<{ deleted: true; slug: string }> {
  const current = await getPost(env, slug, { includeDrafts: true });
  await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(current.id).run();
  return { deleted: true, slug: current.slug };
}

export async function setPublished(env: Env, slug: string, published = true): Promise<Post> {
  const current = await getPost(env, slug, { includeDrafts: true });
  const ts = nowIso();
  const row = await env.DB.prepare(
    `UPDATE posts SET status = ?, published_at = ?, updated_at = ? WHERE id = ? RETURNING ${COLS}`,
  )
    .bind(published ? 'published' : 'draft', published ? (current.publishedAt ?? ts) : current.publishedAt, ts, current.id)
    .first<PostRow>();
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
