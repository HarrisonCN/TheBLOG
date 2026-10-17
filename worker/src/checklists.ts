/**
 * L38 / v1.38.0 拍摄清单（Worker）：
 * GET /api/checklists（已发布摘要）· GET /api/checklists/:slug（已发布全文）·
 * GET /api/admin/checklists（含草稿）· GET / PUT / DELETE /api/admin/checklists/:slug（站长；PUT 整份写入，checklist-core.validateItem 校验）。
 * 存储：D1 checklists（迁移 0029_checklists.sql）。
 */
import type { Env } from './env';
import { HttpError, json } from './http';
import { sortItems, summarize, validateItem, type Item } from './checklist-core';

const PUBLIC_CACHE = { 'cache-control': 'public, max-age=30, s-maxage=60' };
const NO_STORE = { 'cache-control': 'no-store' };
interface Row {
  slug: string;
  data: string;
}
const parse = (r: Row): Item => JSON.parse(r.data) as Item;
const notFound = () => new HttpError(404, 'not_found', '内容不存在');

export async function routePublic(req: Request, env: Env, path: string): Promise<Response | null> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  if (path === '/api/checklists') {
    const { results } = await env.DB.prepare("SELECT slug, data FROM checklists WHERE status = 'published' LIMIT 1000").all<Row>();
    return json({ checklists: sortItems(results.map(parse)).map(summarize) }, { headers: PUBLIC_CACHE });
  }
  const m = /^\/api\/checklists\/([a-z0-9-]{1,60})$/.exec(path);
  if (m) {
    const r = await env.DB.prepare("SELECT slug, data FROM checklists WHERE slug = ? AND status = 'published'").bind(m[1]!).first<Row>();
    if (!r) throw notFound();
    return json({ checklist: parse(r) }, { headers: PUBLIC_CACHE });
  }
  if (path.startsWith('/api/checklists/')) throw notFound();
  return null;
}

export async function routeAdmin(req: Request, env: Env, sub: string, body: () => Promise<unknown>): Promise<Response | null> {
  const m = req.method;
  const ok = (d: unknown) => json(d, { headers: NO_STORE });
  if (sub === '/checklists') {
    if (m !== 'GET') return null;
    const { results } = await env.DB.prepare('SELECT slug, data FROM checklists LIMIT 2000').all<Row>();
    return ok({ checklists: sortItems(results.map(parse)).map(summarize) });
  }
  const mt = /^\/checklists\/([a-z0-9-]{1,60})$/.exec(sub);
  if (!mt) return null;
  const slug = mt[1]!;
  if (m === 'GET') {
    const r = await env.DB.prepare('SELECT slug, data FROM checklists WHERE slug = ?').bind(slug).first<Row>();
    if (!r) throw notFound();
    return ok({ checklist: parse(r) });
  }
  if (m === 'PUT') {
    const { results } = await env.DB.prepare('SELECT slug FROM checklists WHERE slug != ?').bind(slug).all<{ slug: string }>();
    const v = validateItem(await body(), results.map((r) => r.slug));
    if (!v.item) throw new HttpError(400, 'validation_error', '参数校验失败', {}, v.issues);
    const it = v.item;
    if (it.slug !== slug) throw new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path: 'slug', message: '地址与网址不一致' }]);
    await env.DB.prepare(
      'INSERT INTO checklists (slug, title, date, status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET title = excluded.title, date = excluded.date, status = excluded.status, data = excluded.data, updated_at = excluded.updated_at',
    )
      .bind(slug, it.title, it.date, it.status, JSON.stringify(it), new Date().toISOString())
      .run();
    return ok({ checklist: it });
  }
  if (m === 'DELETE') {
    const r = await env.DB.prepare('DELETE FROM checklists WHERE slug = ?').bind(slug).run();
    if (!r.meta.changes) throw notFound();
    return ok({ ok: true });
  }
  return null;
}
