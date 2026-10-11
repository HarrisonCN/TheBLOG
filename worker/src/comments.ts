/**
 * 文章评论（两级楼中楼）：访客昵称或好朋友身份、Markdown-lite（渲染在前端，见 comment-core.ts）、
 * 蜜罐 + 限流、站长审核（通过 / 隐藏 / 删除）。接口形状与前端演示 mock（web/src/demo/mock-api.ts）一致。
 */
import type { Env } from './env';
import { HttpError, json } from './http';
import { ipKey, optionalMember, rateLimit } from './community';
import { onCommentPublished } from './social';
import { isCommentAction, resolveParent, validateComment, type CommentStatus, type PostComment } from './comment-core';

const NO_STORE = { 'cache-control': 'no-store' };
interface CommentRow { id: number; slug: string; parent_id: number | null; reply_to: string; name: string; content: string; member_id: number | null; status: CommentStatus; created_at: string }
const rowToComment = (r: CommentRow): PostComment => ({ id: r.id, slug: r.slug, parentId: r.parent_id, replyTo: r.reply_to, name: r.name, content: r.content, member: r.member_id !== null, status: r.status, createdAt: r.created_at });

export const COMMENT_RATE = { limit: 5, windowSec: 600 };

export async function listComments(env: Env, slug: string): Promise<{ comments: PostComment[]; total: number }> {
  const { results } = await env.DB.prepare("SELECT * FROM comments WHERE slug = ? AND status = 'approved' ORDER BY created_at, id LIMIT 500").bind(slug).all<CommentRow>();
  const comments = results.map(rowToComment);
  return { comments, total: comments.length };
}

export async function createComment(req: Request, env: Env, slug: string, input: unknown): Promise<{ comment: PostComment | null; status: CommentStatus }> {
  const v = validateComment(input);
  if (!v.ok) throw new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path: v.path, message: v.error }]);
  const who = await ipKey(req, env);
  await rateLimit(env, 'comment', who, COMMENT_RATE.limit, COMMENT_RATE.windowSec, '评论太频繁啦，10 分钟后再来');
  // 蜜罐：假装成功（机器人看不出区别），什么也不存
  if (v.spam) return { comment: null, status: 'pending' };
  const post = await env.DB.prepare("SELECT 1 AS ok FROM posts WHERE slug = ? AND status = 'published'").bind(slug).first();
  if (!post) throw new HttpError(404, 'not_found', '文章不存在');
  let parentId: number | null = null;
  let replyTo = '';
  if (v.value.parentId !== null) {
    const target = await env.DB.prepare("SELECT id, parent_id, name FROM comments WHERE id = ? AND slug = ? AND status = 'approved'").bind(v.value.parentId, slug).first<{ id: number; parent_id: number | null; name: string }>();
    if (!target) throw new HttpError(404, 'not_found', '要回复的评论不存在');
    ({ parentId, replyTo } = resolveParent({ id: target.id, parentId: target.parent_id, name: target.name }));
  }
  const member = await optionalMember(req, env);
  const status: CommentStatus = member ? 'approved' : 'pending';
  const row = await env.DB.prepare('INSERT INTO comments (slug, parent_id, reply_to, name, content, member_id, status, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *')
    .bind(slug, parentId, replyTo, member ? member.name : v.value.name, v.value.content, member?.id ?? null, status, who, new Date().toISOString())
    .first<CommentRow>();
  if (status === 'approved') await onCommentPublished(env, { id: row!.id, slug, parentId, content: v.value.content, memberId: member?.id ?? null });
  return { comment: rowToComment(row!), status };
}

export async function adminListComments(env: Env, status: string | null): Promise<{ comments: PostComment[]; counts: Record<CommentStatus, number> }> {
  const st = status === 'pending' || status === 'approved' || status === 'hidden' ? status : null;
  const { results } = await env.DB.prepare(`SELECT * FROM comments ${st ? 'WHERE status = ?' : ''} ORDER BY id DESC LIMIT 500`).bind(...(st ? [st] : [])).all<CommentRow>();
  const { results: c } = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM comments GROUP BY status').all<{ status: CommentStatus; n: number }>();
  const counts = { pending: 0, approved: 0, hidden: 0 } as Record<CommentStatus, number>;
  for (const r of c) counts[r.status] = r.n;
  return { comments: results.map(rowToComment), counts };
}

export async function moderateComment(env: Env, id: number, action: unknown): Promise<{ id: number; action: string }> {
  if (!isCommentAction(action)) throw new HttpError(400, 'validation_error', 'action 只能是 approve / hide / delete');
  const row = await env.DB.prepare('SELECT id FROM comments WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'not_found', '评论不存在');
  if (action === 'delete') {
    // 删除顶层评论时连同它的回复一起删
    await env.DB.batch([env.DB.prepare('DELETE FROM comments WHERE parent_id = ?').bind(id), env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id)]);
  } else {
    const before = await env.DB.prepare('SELECT id, slug, parent_id, content, member_id, status FROM comments WHERE id = ?').bind(id).first<{ id: number; slug: string; parent_id: number | null; content: string; member_id: number | null; status: CommentStatus }>();
    await env.DB.prepare('UPDATE comments SET status = ? WHERE id = ?').bind(action === 'approve' ? 'approved' : 'hidden', id).run();
    // 访客评论审核通过后才通知被回复的人（幂等：同楼聚合）
    if (action === 'approve' && before && before.status !== 'approved') await onCommentPublished(env, { id: before.id, slug: before.slug, parentId: before.parent_id, content: before.content, memberId: before.member_id });
  }
  return { id, action };
}

/** 公开路由：GET / POST /api/posts/:slug/comments */
export async function routeComments(req: Request, env: Env, path: string, body: () => Promise<unknown>): Promise<Response | null> {
  const m = /^\/api\/posts\/([a-z0-9-]{1,80})\/comments$/.exec(path);
  if (!m) return null;
  const slug = m[1]!;
  if (req.method === 'GET') return json(await listComments(env, slug), { headers: NO_STORE });
  if (req.method === 'POST') {
    const r = await createComment(req, env, slug, await body());
    return json(r, { status: 201, headers: NO_STORE });
  }
  return null;
}

/** 后台路由（已通过 requireAdmin）：GET /api/admin/comments?status=、POST /api/admin/comments/:id {action}、DELETE /api/admin/comments/:id */
export async function routeAdminComments(req: Request, env: Env, sub: string, url: URL, body: () => Promise<unknown>): Promise<Response | null> {
  if (sub === '/comments' && req.method === 'GET') return json(await adminListComments(env, url.searchParams.get('status')), { headers: NO_STORE });
  const m = /^\/comments\/(\d+)$/.exec(sub);
  if (m && req.method === 'POST') return json(await moderateComment(env, Number(m[1]), ((await body()) as { action?: unknown } | null)?.action), { headers: NO_STORE });
  if (m && req.method === 'DELETE') return json(await moderateComment(env, Number(m[1]), 'delete'), { headers: NO_STORE });
  return null;
}
