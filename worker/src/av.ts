/**
 * L34 / v1.34.0 视频与声音作品（Worker）：
 * GET /api/av（已发布作品摘要，日期倒序）· GET /api/av/:slug（已发布作品全文）· GET /api/av/:slug/captions.vtt（WebVTT 字幕 / 文字稿）·
 * GET /api/admin/av（含草稿）· GET / PUT / DELETE /api/admin/av/:slug（站长；PUT 整份写入，validateAvWork 校验）。
 * 存储：D1 av_works（迁移 0025_media.sql）。媒体文件本身放在 https:// 外链或站内静态目录；R2 上传不在这一版范围内。
 */
import type { Env } from './env';
import { HttpError, json } from './http';
import { avSummary, toVtt, validateAvWork, type AvWork } from './media-core';

const PUBLIC_CACHE = { 'cache-control': 'public, max-age=30, s-maxage=60' };
const NO_STORE = { 'cache-control': 'no-store' };
interface Row {
  slug: string;
  data: string;
}
const parse = (r: Row): AvWork => JSON.parse(r.data) as AvWork;
const notFound = () => new HttpError(404, 'not_found', '作品不存在');
const ORDER = 'ORDER BY date DESC, slug ASC';

async function published(env: Env, slug: string): Promise<AvWork> {
  const r = await env.DB.prepare("SELECT slug, data FROM av_works WHERE slug = ? AND status = 'published'").bind(slug).first<Row>();
  if (!r) throw notFound();
  return parse(r);
}

export async function routeAvPublic(req: Request, env: Env, path: string): Promise<Response | null> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  if (path === '/api/av') {
    const { results } = await env.DB.prepare(`SELECT slug, data FROM av_works WHERE status = 'published' ${ORDER} LIMIT 500`).all<Row>();
    return json({ works: results.map((r) => avSummary(parse(r))) }, { headers: PUBLIC_CACHE });
  }
  let m = /^\/api\/av\/([a-z0-9-]{1,40})\/captions\.vtt$/.exec(path);
  if (m) {
    const w = await published(env, m[1]!);
    return new Response(req.method === 'HEAD' ? null : toVtt(w.cues), { headers: { 'content-type': 'text/vtt; charset=utf-8', ...PUBLIC_CACHE } });
  }
  m = /^\/api\/av\/([a-z0-9-]{1,40})$/.exec(path);
  if (m) return json({ work: await published(env, m[1]!) }, { headers: PUBLIC_CACHE });
  if (path.startsWith('/api/av/')) throw notFound();
  return null;
}

export async function routeAdminAv(req: Request, env: Env, sub: string, body: () => Promise<unknown>): Promise<Response | null> {
  const m = req.method;
  const ok = (d: unknown) => json(d, { headers: NO_STORE });
  if (sub === '/av') {
    if (m !== 'GET') return null;
    const { results } = await env.DB.prepare(`SELECT slug, data FROM av_works ${ORDER} LIMIT 1000`).all<Row>();
    return ok({ works: results.map((r) => avSummary(parse(r))) });
  }
  const mt = /^\/av\/([a-z0-9-]{1,40})$/.exec(sub);
  if (!mt) return null;
  const slug = mt[1]!;
  if (m === 'GET') {
    const r = await env.DB.prepare('SELECT slug, data FROM av_works WHERE slug = ?').bind(slug).first<Row>();
    if (!r) throw notFound();
    return ok({ work: parse(r) });
  }
  if (m === 'PUT') {
    const v = validateAvWork(await body());
    if (!v.work) throw new HttpError(400, 'validation_error', '参数校验失败', {}, v.issues);
    const w = v.work;
    if (w.slug !== slug) throw new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path: 'slug', message: '地址与网址不一致' }]);
    await env.DB.prepare(
      'INSERT INTO av_works (slug, kind, title, date, status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET kind = excluded.kind, title = excluded.title, date = excluded.date, status = excluded.status, data = excluded.data, updated_at = excluded.updated_at',
    )
      .bind(slug, w.kind, w.title, w.date, w.status, JSON.stringify(w), new Date().toISOString())
      .run();
    return ok({ work: w });
  }
  if (m === 'DELETE') {
    const r = await env.DB.prepare('DELETE FROM av_works WHERE slug = ?').bind(slug).run();
    if (!r.meta.changes) throw notFound();
    return ok({ ok: true });
  }
  return null;
}
