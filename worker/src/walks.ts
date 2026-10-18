/**
 * L42 / v1.42.0 扫街路线（Worker）：
 * GET /api/walks（已发布摘要）· GET /api/walks/:slug（已发布全文）·
 * GET /api/admin/walks（含草稿）· GET / PUT / DELETE /api/admin/walks/:slug（站长；PUT 整份写入，walk-core.validateItem 校验）。
 * 存储：D1 walks（迁移 0033_walks.sql）。
 */
import type { Env } from './env';
import { HttpError, json } from './http';
import { sortItems, summarize, validateItem, type Item } from './walk-core';

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
  if (path === '/api/walks') {
    const { results } = await env.DB.prepare("SELECT slug, data FROM walks WHERE status = 'published' LIMIT 1000").all<Row>();
    return json({ walks: sortItems(results.map(parse)).map(summarize) }, { headers: PUBLIC_CACHE });
  }
  const m = /^\/api\/walks\/([a-z0-9-]{1,60})$/.exec(path);
  if (m) {
    const r = await env.DB.prepare("SELECT slug, data FROM walks WHERE slug = ? AND status = 'published'").bind(m[1]!).first<Row>();
    if (!r) throw notFound();
    return json({ walk: parse(r) }, { headers: PUBLIC_CACHE });
  }
  if (path.startsWith('/api/walks/')) throw notFound();
  return null;
}

export async function routeAdmin(req: Request, env: Env, sub: string, body: () => Promise<unknown>): Promise<Response | null> {
  const m = req.method;
  const ok = (d: unknown) => json(d, { headers: NO_STORE });
  if (sub === '/walks') {
    if (m !== 'GET') return null;
    const { results } = await env.DB.prepare('SELECT slug, data FROM walks LIMIT 2000').all<Row>();
    return ok({ walks: sortItems(results.map(parse)).map(summarize) });
  }
  const mt = /^\/walks\/([a-z0-9-]{1,60})$/.exec(sub);
  if (!mt) return null;
  const slug = mt[1]!;
  if (m === 'GET') {
    const r = await env.DB.prepare('SELECT slug, data FROM walks WHERE slug = ?').bind(slug).first<Row>();
    if (!r) throw notFound();
    return ok({ walk: parse(r) });
  }
  if (m === 'PUT') {
    const { results } = await env.DB.prepare('SELECT slug FROM walks WHERE slug != ?').bind(slug).all<{ slug: string }>();
    const v = validateItem(await body(), results.map((r) => r.slug));
    if (!v.item) throw new HttpError(400, 'validation_error', '参数校验失败', {}, v.issues);
    const it = v.item;
    if (it.slug !== slug) throw new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path: 'slug', message: '地址与网址不一致' }]);
    await env.DB.prepare(
      'INSERT INTO walks (slug, title, date, status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET title = excluded.title, date = excluded.date, status = excluded.status, data = excluded.data, updated_at = excluded.updated_at',
    )
      .bind(slug, it.title, it.date, it.status, JSON.stringify(it), new Date().toISOString())
      .run();
    return ok({ walk: it });
  }
  if (m === 'DELETE') {
    const r = await env.DB.prepare('DELETE FROM walks WHERE slug = ?').bind(slug).run();
    if (!r.meta.changes) throw notFound();
    return ok({ ok: true });
  }
  return null;
}
