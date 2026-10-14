/**
 * L24 / v1.24.0 内容编辑器 2.0（Worker）：
 *  - 服务器草稿（自动保存）：/api/admin/editor/drafts[/:key]，修订号冲突 409（details.draft = 服务器版本）；
 *  - 定时发布：POST /api/admin/editor/schedule/:slug {publishAt}，GET /api/admin/editor/scheduled；定时任务 scheduledEditor 到点发布；
 *    公开 GET /api/scheduled 只给 slug / 标题 / 分类 / 时间；
 *  - 媒体库：/api/admin/editor/media[/:id]（登记、搜索、改替代文字、移出；文件本身仍在 R2，不删）；
 *  - 模板：GET /api/admin/editor/templates。
 * 校验全部来自 editor-core.ts（与前端逐字相同）。
 */
import type { Env } from './env';
import { HttpError, json } from './http';
import { invalidatePostIndex } from './service';
import {
  cleanAlt,
  isDraftKey,
  MEDIA_LIMITS,
  resolveDraftWrite,
  TEMPLATES,
  UPCOMING_MAX,
  validateDraft,
  validateMedia,
  validateSchedule,
  type DraftSnapshot,
  type MediaAsset,
  type UpcomingPost,
} from './editor-core';

const NO_STORE = { 'cache-control': 'no-store' };
const SHORT_CACHE = { 'cache-control': 'public, max-age=60' };

interface DraftRow {
  key: string;
  title: string;
  markdown: string;
  rev: number;
  saved_at: string;
}
const toDraft = (r: DraftRow): DraftSnapshot => ({ key: r.key, title: r.title, markdown: r.markdown, rev: r.rev, savedAt: r.saved_at });
interface MediaRow {
  id: number;
  url: string;
  alt: string;
  width: number;
  height: number;
  bytes: number;
  variants: string;
  created_at: string;
}
function toMedia(r: MediaRow): MediaAsset {
  let variants: MediaAsset['variants'] = [];
  try {
    variants = JSON.parse(r.variants) as MediaAsset['variants'];
  } catch {
    variants = [];
  }
  return { id: r.id, url: r.url, alt: r.alt, width: r.width, height: r.height, bytes: r.bytes, variants, createdAt: r.created_at };
}
const bad = (message: string, path: string) => new HttpError(400, 'validation_error', message, {}, [{ path, message }]);

async function upcoming(env: Env, limit: number): Promise<UpcomingPost[]> {
  const { results } = await env.DB.prepare(
    "SELECT slug, title, COALESCE(category, '') AS category, publish_at AS publishAt FROM posts WHERE status = 'draft' AND publish_at IS NOT NULL ORDER BY publish_at ASC, id ASC LIMIT ?",
  )
    .bind(limit)
    .all<UpcomingPost>();
  return results ?? [];
}

/** 公开：GET /api/scheduled */
export async function routeEditorPublic(req: Request, env: Env, path: string): Promise<Response | null> {
  if (path !== '/api/scheduled' || (req.method !== 'GET' && req.method !== 'HEAD')) return null;
  return json({ posts: await upcoming(env, UPCOMING_MAX) }, { headers: SHORT_CACHE });
}

/** 后台：sub = /api/admin 之后的路径（index.ts 已校验站长登录 / CSRF / Origin） */
export async function routeAdminEditor(req: Request, env: Env, sub: string, url: URL, body: () => Promise<unknown>): Promise<Response | null> {
  if (!sub.startsWith('/editor/')) return null;
  const m = req.method;
  let mt: RegExpExecArray | null;
  if (sub === '/editor/templates' && m === 'GET') return json({ templates: TEMPLATES }, { headers: NO_STORE });

  // ---- 草稿
  if (sub === '/editor/drafts' && m === 'GET') {
    const { results } = await env.DB.prepare('SELECT key, title, rev, saved_at, length(markdown) AS chars FROM post_drafts ORDER BY saved_at DESC LIMIT 100').all<{ key: string; title: string; rev: number; saved_at: string; chars: number }>();
    return json({ drafts: (results ?? []).map((r) => ({ key: r.key, title: r.title, rev: r.rev, savedAt: r.saved_at, chars: r.chars })) }, { headers: NO_STORE });
  }
  if ((mt = /^\/editor\/drafts\/([^/]+)$/.exec(sub))) {
    let key = '';
    try {
      key = decodeURIComponent(mt[1]!);
    } catch {
      key = '';
    }
    if (!isDraftKey(key)) throw bad('草稿键不对', 'key');
    const cur = await env.DB.prepare('SELECT key, title, markdown, rev, saved_at FROM post_drafts WHERE key = ?').bind(key).first<DraftRow>();
    if (m === 'GET') {
      if (!cur) throw new HttpError(404, 'not_found', '没有这份草稿');
      return json({ draft: toDraft(cur) }, { headers: NO_STORE });
    }
    if (m === 'PUT') {
      const input = (await body()) as { baseRev?: unknown } | null;
      const v = validateDraft(input);
      if (!v.ok) throw bad(v.message, v.field);
      const baseRev = typeof input?.baseRev === 'number' && Number.isInteger(input.baseRev) && input.baseRev >= 0 ? input.baseRev : -1;
      const w = resolveDraftWrite(cur?.rev ?? null, baseRev);
      if (!w.ok) throw new HttpError(409, 'draft_conflict', '这份草稿在别处（另一个标签页或设备）改过了', {}, { draft: cur ? toDraft(cur) : null });
      const savedAt = new Date().toISOString();
      // 条件写入：并发的两次保存只有一次成功（rev 没变才更新）
      const res = cur
        ? await env.DB.prepare('UPDATE post_drafts SET title = ?, markdown = ?, rev = ?, saved_at = ? WHERE key = ? AND rev = ?').bind(v.title, v.markdown, w.rev, savedAt, key, cur.rev).run()
        : await env.DB.prepare('INSERT OR IGNORE INTO post_drafts (key, title, markdown, rev, saved_at) VALUES (?, ?, ?, ?, ?)').bind(key, v.title, v.markdown, w.rev, savedAt).run();
      if (!res.meta.changes) {
        const now = await env.DB.prepare('SELECT key, title, markdown, rev, saved_at FROM post_drafts WHERE key = ?').bind(key).first<DraftRow>();
        throw new HttpError(409, 'draft_conflict', '这份草稿在别处（另一个标签页或设备）改过了', {}, { draft: now ? toDraft(now) : null });
      }
      return json({ draft: { key, title: v.title, markdown: v.markdown, rev: w.rev, savedAt } satisfies DraftSnapshot }, { headers: NO_STORE });
    }
    if (m === 'DELETE') {
      await env.DB.prepare('DELETE FROM post_drafts WHERE key = ?').bind(key).run();
      return json({ ok: true }, { headers: NO_STORE });
    }
  }

  // ---- 定时发布
  if (sub === '/editor/scheduled' && m === 'GET') return json({ posts: await upcoming(env, 200) }, { headers: NO_STORE });
  if ((mt = /^\/editor\/schedule\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(sub)) && m === 'POST') {
    const slug = mt[1]!;
    const post = await env.DB.prepare('SELECT id, status FROM posts WHERE slug = ?').bind(slug).first<{ id: number; status: string }>();
    if (!post) throw new HttpError(404, 'not_found', '文章不存在');
    if (post.status === 'published') throw new HttpError(409, 'already_published', '文章已经发布了，不能再定时');
    const v = validateSchedule(((await body()) as { publishAt?: unknown } | null)?.publishAt ?? null, Date.now());
    if (!v.ok) throw bad(v.message, 'publishAt');
    await env.DB.prepare('UPDATE posts SET publish_at = ? WHERE id = ?').bind(v.at, post.id).run();
    return json({ slug, publishAt: v.at }, { headers: NO_STORE });
  }

  // ---- 媒体库
  if (sub === '/editor/media' && m === 'GET') {
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 60);
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const where = q ? "WHERE alt LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\'" : '';
    const stmt = env.DB.prepare(`SELECT * FROM media_assets ${where} ORDER BY id DESC LIMIT ${MEDIA_LIMITS.perPage}`);
    const { results } = await (q ? stmt.bind(like, like) : stmt).all<MediaRow>();
    const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM media_assets ${where}`).bind(...(q ? [like, like] : [])).first<{ n: number }>();
    return json({ media: (results ?? []).map(toMedia), total: total?.n ?? 0 }, { headers: NO_STORE });
  }
  if (sub === '/editor/media' && m === 'POST') {
    const v = validateMedia(await body());
    if (!v.ok) throw bad(v.message, v.field);
    const existing = await env.DB.prepare('SELECT * FROM media_assets WHERE url = ?').bind(v.value.url).first<MediaRow>();
    if (existing) return json({ media: toMedia(existing) }, { headers: NO_STORE });
    const row = await env.DB.prepare('INSERT INTO media_assets (url, alt, width, height, bytes, variants, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *')
      .bind(v.value.url, v.value.alt, v.value.width, v.value.height, v.value.bytes, JSON.stringify(v.value.variants), new Date().toISOString())
      .first<MediaRow>();
    return json({ media: toMedia(row!) }, { status: 201, headers: NO_STORE });
  }
  if ((mt = /^\/editor\/media\/(\d{1,12})$/.exec(sub))) {
    const id = Number(mt[1]);
    const cur = await env.DB.prepare('SELECT * FROM media_assets WHERE id = ?').bind(id).first<MediaRow>();
    if (!cur) throw new HttpError(404, 'not_found', '媒体库里没有这张图');
    if (m === 'PATCH') {
      const alt = cleanAlt(((await body()) as { alt?: unknown } | null)?.alt);
      if (alt === null) throw bad(`替代文字最多 ${MEDIA_LIMITS.altMax} 字`, 'alt');
      await env.DB.prepare('UPDATE media_assets SET alt = ? WHERE id = ?').bind(alt, id).run();
      return json({ media: toMedia({ ...cur, alt }) }, { headers: NO_STORE });
    }
    if (m === 'DELETE') {
      await env.DB.prepare('DELETE FROM media_assets WHERE id = ?').bind(id).run();
      return json({ ok: true }, { headers: NO_STORE });
    }
  }
  throw new HttpError(404, 'not_found', '接口不存在');
}

/** 定时任务：把到点的定时草稿发布出去（published_at = 定时时间），清空 publish_at */
export async function scheduledEditor(env: Env, nowMs = Date.now()): Promise<{ published: number }> {
  const now = new Date(nowMs).toISOString();
  const res = await env.DB.prepare(
    "UPDATE posts SET status = 'published', published_at = publish_at, updated_at = ?, publish_at = NULL WHERE status = 'draft' AND publish_at IS NOT NULL AND publish_at <= ?",
  )
    .bind(now, now)
    .run();
  const n = res.meta.changes ?? 0;
  if (n) invalidatePostIndex();
  return { published: n };
}
