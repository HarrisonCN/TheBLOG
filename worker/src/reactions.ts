/**
 * 文章表情回应（和便利贴一样：匿名、按加盐 IP 哈希去重、D1 限流）。
 *   GET  /api/posts/:slug/reactions            → { counts: { "👍": 3, ... } }
 *   POST /api/posts/:slug/reactions {emoji,on} → { counts, mine: boolean }
 * 只接受固定的几个表情（前端 web/src/reactions.ts 的 REACTIONS 与这里保持一致）。
 */
import { z } from 'zod';
import type { Env } from './env';
import { HttpError, json } from './http';
import { clientIp } from './auth';
import { sha256Hex } from './crypto';
import { rateLimit } from './community';
import { validate } from './service';

export const REACTION_EMOJI = ['👍', '❤️', '🎉', '🤯', '🤔', '📷'] as const;
export const reactionSchema = z.object({ emoji: z.enum(REACTION_EMOJI), on: z.boolean().optional().default(true) });
const SLUG = /^[a-z0-9-]{1,120}$/;
const NO_STORE = { 'cache-control': 'no-store' };

async function voterKey(req: Request, env: Env): Promise<string> {
  return (await sha256Hex(`react|${clientIp(req)}|${env.JWT_SECRET ?? ''}`)).slice(0, 32);
}

async function requirePublished(env: Env, slug: string): Promise<void> {
  if (!SLUG.test(slug)) throw new HttpError(404, 'not_found', '文章不存在');
  const p = await env.DB.prepare("SELECT id FROM posts WHERE slug = ? AND status = 'published'").bind(slug).first();
  if (!p) throw new HttpError(404, 'not_found', '文章不存在');
}

export async function getReactions(env: Env, slug: string): Promise<{ counts: Record<string, number> }> {
  await requirePublished(env, slug);
  const { results } = await env.DB.prepare('SELECT emoji, count FROM post_reactions WHERE slug = ? AND count > 0').bind(slug).all<{ emoji: string; count: number }>();
  const counts: Record<string, number> = {};
  for (const r of results) if ((REACTION_EMOJI as readonly string[]).includes(r.emoji)) counts[r.emoji] = r.count;
  return { counts };
}

export async function react(req: Request, env: Env, slug: string, input: unknown): Promise<{ counts: Record<string, number>; mine: boolean }> {
  const v = validate(reactionSchema, input);
  await requirePublished(env, slug);
  const who = await voterKey(req, env);
  await rateLimit(env, 'react', who, 60, 600, '点得太快啦，稍后再试');
  if (v.on) {
    const ins = await env.DB.prepare('INSERT OR IGNORE INTO reaction_votes (slug, emoji, voter) VALUES (?, ?, ?)').bind(slug, v.emoji, who).run();
    if (ins.meta.changes > 0) {
      await env.DB.prepare('INSERT INTO post_reactions (slug, emoji, count) VALUES (?, ?, 1) ON CONFLICT(slug, emoji) DO UPDATE SET count = count + 1').bind(slug, v.emoji).run();
    }
  } else {
    const del = await env.DB.prepare('DELETE FROM reaction_votes WHERE slug = ? AND emoji = ? AND voter = ?').bind(slug, v.emoji, who).run();
    if (del.meta.changes > 0) {
      await env.DB.prepare('UPDATE post_reactions SET count = MAX(0, count - 1) WHERE slug = ? AND emoji = ?').bind(slug, v.emoji).run();
    }
  }
  return { ...(await getReactions(env, slug)), mine: v.on };
}

export async function routeReactions(req: Request, env: Env, path: string, body: () => Promise<unknown>): Promise<Response | null> {
  const mt = /^\/api\/posts\/([^/]+)\/reactions$/.exec(path);
  if (!mt) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(mt[1]!);
  } catch {
    throw new HttpError(404, 'not_found', '文章不存在');
  }
  if (req.method === 'GET' || req.method === 'HEAD') return json(await getReactions(env, slug), { headers: NO_STORE });
  if (req.method === 'POST') return json(await react(req, env, slug, await body()), { headers: NO_STORE });
  return null;
}
