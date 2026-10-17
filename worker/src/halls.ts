/**
 * L35 / v1.35.0 沉浸式展厅（Worker）：
 * GET /api/halls（已发布展厅摘要，日期倒序）· GET /api/halls/:slug（已发布展厅全文）·
 * GET /api/admin/halls（含草稿）· GET / PUT / DELETE /api/admin/halls/:slug（站长；PUT 整份写入，validateHall 校验：每件展品必须有替代文字）。
 * 存储：D1 halls（迁移 0026_halls.sql）。图片本身是 https:// 外链或站内静态路径；3D 只是前端的呈现方式，接口里没有任何 3D 专用数据。
 */
import type { Env } from './env';
import { HttpError, json } from './http';
import { hallSummary, validateHall, type Hall } from './gallery-core';

const PUBLIC_CACHE = { 'cache-control': 'public, max-age=30, s-maxage=60' };
const NO_STORE = { 'cache-control': 'no-store' };
interface Row {
  slug: string;
  data: string;
}
const parse = (r: Row): Hall => JSON.parse(r.data) as Hall;
const notFound = () => new HttpError(404, 'not_found', '展厅不存在');
const ORDER = 'ORDER BY date DESC, slug ASC';

export async function routeHallsPublic(req: Request, env: Env, path: string): Promise<Response | null> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  if (path === '/api/halls') {
    const { results } = await env.DB.prepare(`SELECT slug, data FROM halls WHERE status = 'published' ${ORDER} LIMIT 500`).all<Row>();
    return json({ halls: results.map((r) => hallSummary(parse(r))) }, { headers: PUBLIC_CACHE });
  }
  const m = /^\/api\/halls\/([a-z0-9-]{1,40})$/.exec(path);
  if (m) {
    const r = await env.DB.prepare("SELECT slug, data FROM halls WHERE slug = ? AND status = 'published'").bind(m[1]!).first<Row>();
    if (!r) throw notFound();
    return json({ hall: parse(r) }, { headers: PUBLIC_CACHE });
  }
  if (path.startsWith('/api/halls/')) throw notFound();
  return null;
}

export async function routeAdminHalls(req: Request, env: Env, sub: string, body: () => Promise<unknown>): Promise<Response | null> {
  const m = req.method;
  const ok = (d: unknown) => json(d, { headers: NO_STORE });
  if (sub === '/halls') {
    if (m !== 'GET') return null;
    const { results } = await env.DB.prepare(`SELECT slug, data FROM halls ${ORDER} LIMIT 1000`).all<Row>();
    return ok({ halls: results.map((r) => hallSummary(parse(r))) });
  }
  const mt = /^\/halls\/([a-z0-9-]{1,40})$/.exec(sub);
  if (!mt) return null;
  const slug = mt[1]!;
  if (m === 'GET') {
    const r = await env.DB.prepare('SELECT slug, data FROM halls WHERE slug = ?').bind(slug).first<Row>();
    if (!r) throw notFound();
    return ok({ hall: parse(r) });
  }
  if (m === 'PUT') {
    const v = validateHall(await body());
    if (!v.hall) throw new HttpError(400, 'validation_error', '参数校验失败', {}, v.issues);
    const h = v.hall;
    if (h.slug !== slug) throw new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path: 'slug', message: '地址与网址不一致' }]);
    await env.DB.prepare(
      'INSERT INTO halls (slug, title, date, status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET title = excluded.title, date = excluded.date, status = excluded.status, data = excluded.data, updated_at = excluded.updated_at',
    )
      .bind(slug, h.title, h.date, h.status, JSON.stringify(h), new Date().toISOString())
      .run();
    return ok({ hall: h });
  }
  if (m === 'DELETE') {
    const r = await env.DB.prepare('DELETE FROM halls WHERE slug = ?').bind(slug).run();
    if (!r.meta.changes) throw notFound();
    return ok({ ok: true });
  }
  return null;
}
