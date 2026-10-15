/**
 * L30 / v1.30.0 跨设备同步：阅读进度 + 稍后读（表 sync_docs，迁移 0022_realtime2.sql）。
 * GET /api/social/sync/reading → { doc, rev, updatedAt }；PUT 同一路径 → 服务端与已有文档合并（sync-core.mergeSync，可交换、幂等）后保存。
 * 只有登录的好朋友本人能读写自己的文档；未登录 401。真实 D1 上的迁移 = SKIPPED-verifiable（Cloudflare 未部署）。
 */
import type { Env } from './env';
import { HttpError, json } from './http';
import { rateLimit, requireMember } from './community';
import { checkSyncDoc, emptySyncDoc, mergeSync, SYNC_MAX_BYTES, type SyncDoc } from './sync-core';

const NO_STORE = { 'cache-control': 'no-store' };
interface Row { doc: string; rev: number; updated_at: string }
const parse = (raw: string): SyncDoc => {
  try {
    const v = checkSyncDoc(JSON.parse(raw));
    return v.ok ? v.value : emptySyncDoc();
  } catch {
    return emptySyncDoc();
  }
};

export async function getSync(req: Request, env: Env) {
  const me = await requireMember(req, env);
  const r = await env.DB.prepare('SELECT doc, rev, updated_at FROM sync_docs WHERE member_id = ?').bind(me.id).first<Row>();
  return { doc: r ? parse(r.doc) : emptySyncDoc(), rev: r?.rev ?? 0, updatedAt: r?.updated_at ?? null };
}

export async function putSync(req: Request, env: Env, raw: string) {
  const me = await requireMember(req, env);
  if (raw.length > SYNC_MAX_BYTES) throw new HttpError(413, 'too_large', '同步数据太大');
  await rateLimit(env, 'sync', String(me.id), 120, 3600, '同步太频繁，请稍后再试');
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'bad_json', '请求体不是有效的 JSON');
  }
  const v = checkSyncDoc(input);
  if (!v.ok) throw new HttpError(400, 'validation_error', v.message);
  const cur = await env.DB.prepare('SELECT doc, rev, updated_at FROM sync_docs WHERE member_id = ?').bind(me.id).first<Row>();
  const base = cur ? parse(cur.doc) : emptySyncDoc();
  const doc = mergeSync(base, v.value);
  const changed = !cur || JSON.stringify(doc) !== JSON.stringify(base);
  if (!changed) return { doc, rev: cur!.rev, updatedAt: cur!.updated_at };
  const now = new Date().toISOString();
  const rev = (cur?.rev ?? 0) + 1;
  // 并发写：rev 条件更新失败时重读再合并一次（合并可交换，结果与顺序无关）
  const res = cur
    ? await env.DB.prepare('UPDATE sync_docs SET doc = ?, rev = ?, updated_at = ? WHERE member_id = ? AND rev = ?').bind(JSON.stringify(doc), rev, now, me.id, cur.rev).run()
    : await env.DB.prepare('INSERT OR IGNORE INTO sync_docs (member_id, doc, rev, updated_at) VALUES (?, ?, ?, ?)').bind(me.id, JSON.stringify(doc), rev, now).run();
  if (!res.meta.changes) {
    const again = (await env.DB.prepare('SELECT doc, rev, updated_at FROM sync_docs WHERE member_id = ?').bind(me.id).first<Row>())!;
    const merged = mergeSync(parse(again.doc), v.value);
    await env.DB.prepare('UPDATE sync_docs SET doc = ?, rev = ?, updated_at = ? WHERE member_id = ?').bind(JSON.stringify(merged), again.rev + 1, now, me.id).run();
    return { doc: merged, rev: again.rev + 1, updatedAt: now };
  }
  return { doc, rev, updatedAt: now };
}

export async function exportSync(env: Env, id: number) {
  const r = await env.DB.prepare('SELECT doc FROM sync_docs WHERE member_id = ?').bind(id).first<{ doc: string }>();
  return { readingSync: r ? parse(r.doc) : emptySyncDoc() };
}
export const purgeSync = (env: Env, id: number): D1PreparedStatement[] => [env.DB.prepare('DELETE FROM sync_docs WHERE member_id = ?').bind(id)];

export async function routeSync(req: Request, env: Env, sub: string): Promise<Response | null> {
  if (sub !== '/sync/reading') return null;
  if (req.method === 'GET') return json(await getSync(req, env), { headers: NO_STORE });
  if (req.method === 'PUT' || req.method === 'POST') return json(await putSync(req, env, await req.text()), { headers: NO_STORE });
  return null;
}
