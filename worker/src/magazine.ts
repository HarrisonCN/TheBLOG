/**
 * L33 / v1.33.0 视觉杂志（Worker）：
 * GET /api/magazine（已发布期刊摘要，期号倒序）· GET /api/magazine/:slug（已发布的一期）·
 * GET /api/admin/magazine（含草稿）· GET / PUT / DELETE /api/admin/magazine/:slug（站长；PUT 整期写入，validateIssue 校验）。
 * 存储：D1 magazine_issues（迁移 0024_magazine.sql）。
 */
import type { Env } from './env';
import { HttpError, json } from './http';
import { issueSummary, validateIssue, type Issue } from './magazine-core';

const PUBLIC_CACHE = { 'cache-control': 'public, max-age=30, s-maxage=60' };
const NO_STORE = { 'cache-control': 'no-store' };
interface Row {
  slug: string;
  no: number;
  status: string;
  data: string;
}
const parse = (r: Row): Issue => JSON.parse(r.data) as Issue;
const notFound = () => new HttpError(404, 'not_found', '这一期不存在');

export async function routeMagazinePublic(req: Request, env: Env, path: string): Promise<Response | null> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  if (path === '/api/magazine') {
    const { results } = await env.DB.prepare("SELECT slug, no, status, data FROM magazine_issues WHERE status = 'published' ORDER BY no DESC LIMIT 200").all<Row>();
    return json({ issues: results.map((r) => issueSummary(parse(r))) }, { headers: PUBLIC_CACHE });
  }
  const m = /^\/api\/magazine\/([a-z0-9-]{1,40})$/.exec(path);
  if (m) {
    const r = await env.DB.prepare("SELECT slug, no, status, data FROM magazine_issues WHERE slug = ? AND status = 'published'").bind(m[1]).first<Row>();
    if (!r) throw notFound();
    return json({ issue: parse(r) }, { headers: PUBLIC_CACHE });
  }
  if (path.startsWith('/api/magazine/')) throw notFound();
  return null;
}

export async function routeAdminMagazine(req: Request, env: Env, sub: string, body: () => Promise<unknown>): Promise<Response | null> {
  const m = req.method;
  const ok = (d: unknown) => json(d, { headers: NO_STORE });
  if (sub === '/magazine') {
    if (m !== 'GET') return null;
    const { results } = await env.DB.prepare('SELECT slug, no, status, data FROM magazine_issues ORDER BY no DESC LIMIT 500').all<Row>();
    return ok({ issues: results.map((r) => issueSummary(parse(r))) });
  }
  const mt = /^\/magazine\/([a-z0-9-]{1,40})$/.exec(sub);
  if (!mt) return null;
  const slug = mt[1]!;
  if (m === 'GET') {
    const r = await env.DB.prepare('SELECT slug, no, status, data FROM magazine_issues WHERE slug = ?').bind(slug).first<Row>();
    if (!r) throw notFound();
    return ok({ issue: parse(r) });
  }
  if (m === 'PUT') {
    const v = validateIssue(await body());
    if (!v.issue) throw new HttpError(400, 'validation_error', '参数校验失败', {}, v.issues);
    const issue = v.issue;
    if (issue.slug !== slug) throw new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path: 'slug', message: '地址与网址不一致' }]);
    const clash = await env.DB.prepare('SELECT slug FROM magazine_issues WHERE no = ? AND slug != ?').bind(issue.no, slug).first<{ slug: string }>();
    if (clash) throw new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path: 'no', message: `第 ${issue.no} 期已经存在` }]);
    await env.DB.prepare(
      'INSERT INTO magazine_issues (slug, no, title, status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET no = excluded.no, title = excluded.title, status = excluded.status, data = excluded.data, updated_at = excluded.updated_at',
    )
      .bind(slug, issue.no, issue.title, issue.status, JSON.stringify(issue), new Date().toISOString())
      .run();
    return ok({ issue });
  }
  if (m === 'DELETE') {
    const r = await env.DB.prepare('DELETE FROM magazine_issues WHERE slug = ?').bind(slug).run();
    if (!r.meta.changes) throw notFound();
    return ok({ ok: true });
  }
  return null;
}
