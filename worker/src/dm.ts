/**
 * L19 实时交流（REALTIME SOCIAL）：一对一私信、消息请求、隐私开关、拉黑 / 举报联动、历史游标分页、未读数、离线同步、
 * 已读回执（可关闭）、仅自己删除 / 限时撤回、限流与防骚扰、在线状态、活动聊天室。
 *  - D1 是唯一事实来源：先写 D1，再把事件推给 Durable Object（DmHub）里的 WebSocket 连接（尽力而为，失败不影响写入）。
 *  - WebSocket 只推送：浏览器用 POST /dm/ticket 换一张 60 秒的 HMAC 票据，再连 /dm/ws?ticket=…（浏览器 WebSocket 不能带 Authorization 头）。
 *  - 没有 DM_HUB 绑定或连接失败：浏览器轮询 /dm/sync?since=<seq>，同一份变更日志（dm_changes）。
 * 接口形状与 web/src/demo/mock-dm.ts 一致；规则在 dm-core.ts（两边共用）。
 */
import type { Env } from './env';
import { HttpError, json } from './http';
import { getMember, rateLimit, requireMember, type Member } from './community';
import { card, relation, setRelation } from './social';
import { requirePoster, standing } from './ugc';
import { b64urlDecode, b64urlEncode, timingSafeEqual, toHex } from './crypto';
import {
  announceText,
  canRecall,
  canSeePresence,
  canSend,
  checkBody,
  checkClientId,
  checkPolicy,
  checkRoomConfig,
  clampPage,
  decideStart,
  decodeConvCursor,
  DECLINE_COOLDOWN_DAYS,
  DM_SETTINGS_DEFAULT,
  encodeConvCursor,
  excerpt,
  limitsFor,
  parseId,
  receiptsVisible,
  ROOM_MAX_BODY,
  roomMessageVisible,
  TICKET_TTL,
  type ConvStatus,
  type DmConversation,
  type DmEvent,
  type DmMessage,
  type DmSettings,
  type DmUser,
  type RoomRetention,
} from './dm-core';

void announceText;
const NO_STORE = { 'cache-control': 'no-store' };
const nowIso = () => new Date().toISOString();
const bad = (path: string, message: string) => new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path, message }]);
const notFound = (msg = '会话不存在') => new HttpError(404, 'not_found', msg);
const REPORT_REASONS = ['spam', 'abuse', 'nsfw', 'copyright', 'privacy', 'other'];
const PRESENCE_WINDOW = 45;

interface ConvRow {
  id: number;
  kind: 'dm' | 'room';
  a_id: number | null;
  b_id: number | null;
  event_id: number | null;
  title: string;
  status: ConvStatus;
  requested_by: number | null;
  retention: RoomRetention;
  ttl_hours: number;
  closed: number;
  created_at: string;
  last_message_id: number | null;
  last_at: string;
}
interface MemberRow { conversation_id: number; member_id: number; role: 'member' | 'moderator'; last_read_id: number; cleared_before_id: number; hidden: number; muted: number }
interface MsgRow { id: number; conversation_id: number; sender_id: number | null; body: string; client_id: string | null; created_at: string; recalled_at: string | null; removed_by: number | null }

// ============================================================ 小工具
const cardCache = new WeakMap<Env, Map<number, DmUser | null>>();
async function userOf(env: Env, id: number | null): Promise<DmUser | null> {
  if (id == null) return null;
  let m = cardCache.get(env);
  if (!m) cardCache.set(env, (m = new Map()));
  if (m.has(id)) return m.get(id)!;
  const c = await card(env, id).catch(() => null);
  const u = c ? { username: c.username, nickname: c.nickname, avatarUrl: c.avatarUrl } : null;
  m.set(id, u);
  return u;
}

export async function settingsOf(env: Env, id: number): Promise<DmSettings> {
  const r = await env.DB.prepare('SELECT policy, read_receipts, show_presence FROM dm_settings WHERE member_id = ?').bind(id).first<{ policy: DmSettings['policy']; read_receipts: number; show_presence: number }>();
  return r ? { policy: r.policy, readReceipts: !!r.read_receipts, showPresence: !!r.show_presence } : { ...DM_SETTINGS_DEFAULT };
}

function peerOf(c: ConvRow, me: number): number | null {
  if (c.kind !== 'dm') return null;
  return c.a_id === me ? c.b_id : c.a_id;
}

async function blockedEither(env: Env, a: number, b: number): Promise<{ blocked: boolean; blockedBy: boolean }> {
  const r = await relation(env, a, b);
  return { blocked: r.blocked, blockedBy: r.blockedBy };
}

/** 读取会话 + 我的成员行；不是成员、或对方拉黑了我（私信）→ 404（不泄露会话存在）。 */
async function loadConv(env: Env, id: number, me: number): Promise<{ c: ConvRow; mine: MemberRow; peer: number | null }> {
  const c = await env.DB.prepare("SELECT * FROM conversations WHERE id = ? AND kind = 'dm'").bind(id).first<ConvRow>();
  if (!c) throw notFound();
  const mine = await env.DB.prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND member_id = ?').bind(id, me).first<MemberRow>();
  if (!mine) throw notFound();
  const peer = peerOf(c, me);
  if (peer != null && (await blockedEither(env, me, peer)).blockedBy) throw notFound();
  return { c, mine, peer };
}

function toMessage(r: MsgRow, me: number, sender: DmUser | null): DmMessage {
  const gone = !!r.recalled_at || r.removed_by != null;
  return {
    id: r.id,
    conversationId: r.conversation_id,
    sender,
    mine: r.sender_id === me,
    body: gone ? '' : r.body,
    clientId: r.sender_id === me ? r.client_id : null,
    createdAt: r.created_at,
    recalled: !!r.recalled_at,
    removed: r.removed_by != null,
  };
}

async function unreadOf(env: Env, convId: number, m: MemberRow, me: number): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND id > ? AND (sender_id IS NULL OR sender_id <> ?) AND recalled_at IS NULL AND removed_by IS NULL
       AND id NOT IN (SELECT message_id FROM message_hidden WHERE member_id = ?)`,
  )
    .bind(convId, Math.max(m.last_read_id, m.cleared_before_id), me, me)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

async function toConversation(env: Env, c: ConvRow, m: MemberRow, me: number): Promise<DmConversation> {
  const peer = peerOf(c, me);
  const [peerUser, unread, last, mySet, peerSet, peerMem] = await Promise.all([
    userOf(env, peer),
    unreadOf(env, c.id, m, me),
    c.last_message_id && c.last_message_id > m.cleared_before_id ? env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(c.last_message_id).first<MsgRow>() : Promise.resolve(null),
    settingsOf(env, me),
    peer != null ? settingsOf(env, peer) : Promise.resolve(DM_SETTINGS_DEFAULT),
    peer != null ? env.DB.prepare('SELECT last_read_id FROM conversation_members WHERE conversation_id = ? AND member_id = ?').bind(c.id, peer).first<{ last_read_id: number }>() : Promise.resolve(null),
  ]);
  return {
    id: c.id,
    kind: c.kind,
    status: c.status,
    peer: peerUser,
    title: c.title || peerUser?.nickname || '',
    requestedByMe: c.requested_by === me,
    unread,
    lastMessage: last ? { id: last.id, excerpt: last.recalled_at || last.removed_by != null ? '' : excerpt(last.body), createdAt: last.created_at, mine: last.sender_id === me, recalled: !!last.recalled_at } : null,
    lastAt: c.last_at,
    peerLastReadId: receiptsVisible(mySet.readReceipts, peerSet.readReceipts) ? (peerMem?.last_read_id ?? 0) : null,
    muted: !!m.muted,
  };
}

// ============================================================ 实时推送（尽力而为）
async function push(env: Env, key: string, events: DmEvent[]): Promise<void> {
  if (!env.DM_HUB || !events.length) return;
  try {
    const stub = env.DM_HUB.get(env.DM_HUB.idFromName(key));
    await stub.fetch('https://dm-hub/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events }) });
  } catch (e) {
    console.warn('dm push failed', key, (e as Error)?.message);
  }
}
async function hubOnline(env: Env, key: string): Promise<boolean> {
  if (!env.DM_HUB) return false;
  try {
    const r = await env.DM_HUB.get(env.DM_HUB.idFromName(key)).fetch('https://dm-hub/online');
    return !!((await r.json()) as { online?: boolean }).online;
  } catch {
    return false;
  }
}

async function logChange(env: Env, c: { conversationId: number; kind: 'msg' | 'recall' | 'read' | 'conv' | 'remove'; messageId?: number | null; actorId?: number | null; targetId?: number | null; data?: unknown }): Promise<number> {
  const r = await env.DB.prepare('INSERT INTO dm_changes (conversation_id, kind, message_id, actor_id, target_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING seq')
    .bind(c.conversationId, c.kind, c.messageId ?? null, c.actorId ?? null, c.targetId ?? null, JSON.stringify(c.data ?? {}), nowIso())
    .first<{ seq: number }>();
  return r!.seq;
}

// ============================================================ WebSocket 票据（HMAC，60 秒）
async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}
export async function signTicket(env: Env, memberId: number, scope: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify({ m: memberId, s: scope, e: nowSec + TICKET_TTL })));
  return `${payload}.${await hmac(env.JWT_SECRET, 'dm-ticket:' + payload)}`;
}
export async function verifyTicket(env: Env, ticket: string, scope: string, nowSec = Math.floor(Date.now() / 1000)): Promise<number | null> {
  const [payload, sig] = ticket.split('.');
  if (!payload || !sig || !/^[A-Za-z0-9_-]{8,400}$/.test(payload)) return null;
  if (!timingSafeEqual(sig, await hmac(env.JWT_SECRET, 'dm-ticket:' + payload))) return null;
  try {
    const v = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as { m: number; s: string; e: number };
    if (v.s !== scope || !Number.isSafeInteger(v.m) || v.e < nowSec) return null;
    return v.m;
  } catch {
    return null;
  }
}

// ============================================================ 会话
type Resolve = (username: string) => Promise<number>;

export async function startConversation(req: Request, env: Env, input: unknown, resolve: Resolve) {
  const me = await requirePoster(req, env);
  const username = String((input as { username?: unknown } | null)?.username ?? '').trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw bad('username', '用户名格式不正确');
  const target = await resolve(username);
  const rel = await relation(env, me.id, target);
  const [a, b] = me.id < target ? [me.id, target] : [target, me.id];
  const existing = await env.DB.prepare("SELECT * FROM conversations WHERE kind = 'dm' AND a_id = ? AND b_id = ?").bind(a, b).first<ConvRow>();
  if (rel.blockedBy) throw notFound('没有这个用户');
  if (rel.blocked) throw new HttpError(403, 'blocked', '你已拉黑对方，先解除拉黑');
  const now = Date.now();
  if (existing && existing.status !== 'declined') {
    await env.DB.prepare('UPDATE conversation_members SET hidden = 0 WHERE conversation_id = ? AND member_id = ?').bind(existing.id, me.id).run();
    const mine = (await env.DB.prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND member_id = ?').bind(existing.id, me.id).first<MemberRow>())!;
    return { conversation: await toConversation(env, existing, mine, me.id), created: false };
  }
  const policy = (await settingsOf(env, target)).policy;
  const dec = await env.DB.prepare('SELECT until_ms FROM dm_declines WHERE requester_id = ? AND target_id = ?').bind(me.id, target).first<{ until_ms: number }>();
  const d = decideStart({ self: me.id === target, rel, policy, declinedUntil: dec?.until_ms ?? null, now });
  if (!d.ok) throw new HttpError(d.status, d.code, d.message);
  const lim = limitsFor(me.joinedAt, now);
  if (d.kind === 'request') await rateLimit(env, 'dm-request', String(me.id), lim.requestsPerDay, 86400, `每天最多发起 ${lim.requestsPerDay} 个消息请求`);
  const status: ConvStatus = d.kind === 'direct' ? 'active' : 'request';
  const t = nowIso();
  let c: ConvRow;
  if (existing) {
    // 冷却期已过：被婉拒的旧会话重新变成请求
    await env.DB.prepare('UPDATE conversations SET status = ?, requested_by = ?, last_at = ? WHERE id = ?').bind(status, me.id, t, existing.id).run();
    c = { ...existing, status, requested_by: me.id, last_at: t };
  } else {
    c = (await env.DB.prepare("INSERT INTO conversations (kind, a_id, b_id, status, requested_by, created_at, last_at) VALUES ('dm', ?, ?, ?, ?, ?, ?) RETURNING *").bind(a, b, status, me.id, t, t).first<ConvRow>())!;
    await env.DB.batch([
      env.DB.prepare('INSERT INTO conversation_members (conversation_id, member_id, joined_at) VALUES (?, ?, ?)').bind(c.id, me.id, t),
      env.DB.prepare('INSERT INTO conversation_members (conversation_id, member_id, joined_at) VALUES (?, ?, ?)').bind(c.id, target, t),
    ]);
  }
  await env.DB.prepare('UPDATE conversation_members SET hidden = 0 WHERE conversation_id = ? AND member_id = ?').bind(c.id, me.id).run();
  const seq = await logChange(env, { conversationId: c.id, kind: 'conv', actorId: me.id, data: { status } });
  const mine = (await env.DB.prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND member_id = ?').bind(c.id, me.id).first<MemberRow>())!;
  await push(env, `u:${me.id}`, [{ t: 'conv', seq, conversationId: c.id, status }]);
  return { conversation: await toConversation(env, c, mine, me.id), created: true };
}

export async function listConversations(req: Request, env: Env, url: URL) {
  const me = await requireMember(req, env);
  const box = url.searchParams.get('box') === 'requests' ? 'requests' : 'inbox';
  const limit = Math.min(50, clampPage(url.searchParams.get('limit')));
  const cur = decodeConvCursor(url.searchParams.get('cursor'));
  const where =
    box === 'requests'
      ? "c.status = 'request' AND c.requested_by <> ? AND c.last_message_id IS NOT NULL"
      : "(c.status = 'active' OR c.requested_by = ?)";
  const rows = (
    await env.DB.prepare(
      `SELECT c.*, cm.role, cm.last_read_id, cm.cleared_before_id, cm.hidden, cm.muted, cm.member_id, cm.conversation_id FROM conversations c
         JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.member_id = ?
        WHERE c.kind = 'dm' AND cm.hidden = 0 AND ${where}
          AND NOT EXISTS (SELECT 1 FROM user_relations r WHERE r.kind = 'block' AND r.target_id = ? AND r.owner_id = CASE WHEN c.a_id = ? THEN c.b_id ELSE c.a_id END)
          ${cur ? 'AND (c.last_at < ? OR (c.last_at = ? AND c.id < ?))' : ''}
        ORDER BY c.last_at DESC, c.id DESC LIMIT ?`,
    )
      .bind(me.id, me.id, me.id, me.id, ...(cur ? [cur.lastAt, cur.lastAt, cur.id] : []), limit + 1)
      .all<ConvRow & MemberRow>()
  ).results;
  const page = rows.slice(0, limit);
  const items = await Promise.all(page.map((r) => toConversation(env, r, r, me.id)));
  const last = page[page.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeConvCursor(last.last_at, last.id) : null, unread: await unreadTotals(env, me.id) };
}

export async function unreadTotals(env: Env, me: number): Promise<{ total: number; requests: number }> {
  const rows = (
    await env.DB.prepare(
      `SELECT c.id, c.status, c.requested_by, cm.last_read_id, cm.cleared_before_id FROM conversations c
         JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.member_id = ?
        WHERE c.kind = 'dm' AND cm.hidden = 0 AND cm.muted = 0 AND c.last_message_id IS NOT NULL AND c.last_message_id > MAX(cm.last_read_id, cm.cleared_before_id)
          AND NOT EXISTS (SELECT 1 FROM user_relations r WHERE r.kind = 'block' AND r.target_id = ? AND r.owner_id = CASE WHEN c.a_id = ? THEN c.b_id ELSE c.a_id END)
        LIMIT 200`,
    )
      .bind(me, me, me)
      .all<{ id: number; status: ConvStatus; requested_by: number | null; last_read_id: number; cleared_before_id: number }>()
  ).results;
  let total = 0;
  let requests = 0;
  for (const r of rows) {
    const n = await unreadOf(env, r.id, { last_read_id: r.last_read_id, cleared_before_id: r.cleared_before_id } as MemberRow, me);
    if (!n) continue;
    if (r.status === 'request' && r.requested_by !== me) requests++;
    else if (r.status === 'active') total += n;
  }
  return { total, requests };
}

export async function getConversation(req: Request, env: Env, id: number) {
  const me = await requireMember(req, env);
  const { c, mine, peer } = await loadConv(env, id, me.id);
  const rel = peer != null ? await relation(env, me.id, peer) : null;
  return { conversation: await toConversation(env, c, mine, me.id), viewer: { blocked: !!rel?.blocked, canSend: canSend({ kind: 'dm', status: c.status, isRequester: c.requested_by === me.id, myCountWhilePending: c.status === 'request' ? await pendingCount(env, c.id, me.id) : 0, blockedEither: !!rel?.blocked }).ok } };
}

async function pendingCount(env: Env, convId: number, me: number): Promise<number> {
  return (await env.DB.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND sender_id = ?').bind(convId, me).first<{ n: number }>())?.n ?? 0;
}

export async function listMessages(req: Request, env: Env, id: number, url: URL) {
  const me = await requireMember(req, env);
  const { mine } = await loadConv(env, id, me.id);
  const limit = clampPage(url.searchParams.get('limit'));
  const before = parseId(url.searchParams.get('before'));
  const after = parseId(url.searchParams.get('after'));
  const rows = (
    await env.DB.prepare(
      `SELECT * FROM messages WHERE conversation_id = ? AND id > ? ${before != null ? 'AND id < ?' : ''} ${after != null ? 'AND id > ?' : ''}
         AND id NOT IN (SELECT message_id FROM message_hidden WHERE member_id = ?)
       ORDER BY id ${after != null ? 'ASC' : 'DESC'} LIMIT ?`,
    )
      .bind(id, mine.cleared_before_id, ...(before != null ? [before] : []), ...(after != null ? [after] : []), me.id, limit + 1)
      .all<MsgRow>()
  ).results;
  const page = rows.slice(0, limit);
  const items = await Promise.all(page.map(async (r) => toMessage(r, me.id, await userOf(env, r.sender_id))));
  if (after == null) items.reverse();
  const hasMore = rows.length > limit;
  return { items, hasMore, nextBefore: after == null && hasMore && items[0] ? items[0].id : null };
}

export async function sendMessage(req: Request, env: Env, id: number, input: unknown) {
  const me = await requirePoster(req, env);
  const { c, peer } = await loadConv(env, id, me.id);
  const o = (input ?? {}) as { body?: unknown; clientId?: unknown };
  const b = checkBody(o.body);
  if (!b.ok) throw bad('body', b.message);
  const clientId = o.clientId === undefined || o.clientId === null ? null : checkClientId(o.clientId);
  if (o.clientId != null && !clientId) throw bad('clientId', 'clientId 格式不正确');
  if (clientId) {
    const dup = await env.DB.prepare('SELECT * FROM messages WHERE conversation_id = ? AND sender_id = ? AND client_id = ?').bind(id, me.id, clientId).first<MsgRow>();
    if (dup) return { message: toMessage(dup, me.id, await userOf(env, me.id)), duplicate: true };
  }
  const rel = peer != null ? await relation(env, me.id, peer) : null;
  const can = canSend({ kind: 'dm', status: c.status, isRequester: c.requested_by === me.id, myCountWhilePending: c.status === 'request' ? await pendingCount(env, id, me.id) : 0, blockedEither: !!(rel?.blocked || rel?.blockedBy) });
  if (!can.ok) throw new HttpError(can.status, can.code, can.message);
  const lim = limitsFor(me.joinedAt, Date.now());
  await rateLimit(env, 'dm-msg', String(me.id), lim.msgsPerMin, 60, '发送太快了，请稍等一会儿');
  const t = nowIso();
  const row = (await env.DB.prepare('INSERT INTO messages (conversation_id, sender_id, body, client_id, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *').bind(id, me.id, b.value, clientId, t).first<MsgRow>())!;
  await env.DB.batch([
    env.DB.prepare('UPDATE conversations SET last_message_id = ?, last_at = ? WHERE id = ?').bind(row.id, t, id),
    env.DB.prepare('UPDATE conversation_members SET hidden = 0 WHERE conversation_id = ?').bind(id),
    env.DB.prepare('UPDATE conversation_members SET last_read_id = ? WHERE conversation_id = ? AND member_id = ?').bind(row.id, id, me.id),
  ]);
  const seq = await logChange(env, { conversationId: id, kind: 'msg', messageId: row.id, actorId: me.id });
  const sender = await userOf(env, me.id);
  await Promise.all([
    push(env, `u:${me.id}`, [{ t: 'msg', seq, conversationId: id, message: toMessage(row, me.id, sender) }]),
    peer != null ? push(env, `u:${peer}`, [{ t: 'msg', seq, conversationId: id, message: toMessage(row, peer, sender) }]) : Promise.resolve(),
  ]);
  return { message: toMessage(row, me.id, sender), duplicate: false };
}

export async function markConvRead(req: Request, env: Env, id: number, input: unknown) {
  const me = await requireMember(req, env);
  const { c, mine, peer } = await loadConv(env, id, me.id);
  const want = parseId(String((input as { lastReadId?: unknown } | null)?.lastReadId ?? c.last_message_id ?? 0)) ?? 0;
  const next = Math.min(Math.max(mine.last_read_id, want), c.last_message_id ?? 0);
  if (next <= mine.last_read_id) return { lastReadId: mine.last_read_id };
  await env.DB.prepare('UPDATE conversation_members SET last_read_id = ? WHERE conversation_id = ? AND member_id = ?').bind(next, id, me.id).run();
  const u = await userOf(env, me.id);
  // 自己的其他标签页 / 设备总会同步未读数；对方只在双方都开启已读回执时收到「已读」
  const selfSeq = await logChange(env, { conversationId: id, kind: 'read', actorId: me.id, targetId: me.id, data: { lastReadId: next } });
  await push(env, `u:${me.id}`, [{ t: 'read', seq: selfSeq, conversationId: id, username: u?.username ?? '', lastReadId: next }]);
  if (peer != null && receiptsVisible((await settingsOf(env, me.id)).readReceipts, (await settingsOf(env, peer)).readReceipts)) {
    const seq = await logChange(env, { conversationId: id, kind: 'read', actorId: me.id, targetId: peer, data: { lastReadId: next } });
    await push(env, `u:${peer}`, [{ t: 'read', seq, conversationId: id, username: u?.username ?? '', lastReadId: next }]);
  }
  return { lastReadId: next };
}

export async function respondRequest(req: Request, env: Env, id: number, action: 'accept' | 'decline' | 'block') {
  const me = await requireMember(req, env);
  const { c, peer } = await loadConv(env, id, me.id);
  if (c.status !== 'request' || c.requested_by === me.id || peer == null) throw new HttpError(409, 'not_a_request', '这不是等待你处理的消息请求');
  if (action === 'block') {
    const u = await userOf(env, peer);
    if (u) await setRelation(req, env, u.username, 'block', true);
  }
  const status: ConvStatus = action === 'accept' ? 'active' : 'declined';
  await env.DB.prepare('UPDATE conversations SET status = ? WHERE id = ?').bind(status, id).run();
  if (status === 'declined') {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO dm_declines (requester_id, target_id, until_ms) VALUES (?, ?, ?) ON CONFLICT(requester_id, target_id) DO UPDATE SET until_ms = excluded.until_ms').bind(peer, me.id, Date.now() + DECLINE_COOLDOWN_DAYS * 86400_000),
      env.DB.prepare('UPDATE conversation_members SET hidden = 1 WHERE conversation_id = ? AND member_id = ?').bind(id, me.id),
    ]);
  }
  const seq = await logChange(env, { conversationId: id, kind: 'conv', actorId: me.id, data: { status } });
  await Promise.all([push(env, `u:${me.id}`, [{ t: 'conv', seq, conversationId: id, status }]), action === 'block' ? Promise.resolve() : push(env, `u:${peer}`, [{ t: 'conv', seq, conversationId: id, status }])]);
  return { status };
}

export async function hideConversation(req: Request, env: Env, id: number) {
  const me = await requireMember(req, env);
  const { c } = await loadConv(env, id, me.id);
  await env.DB.prepare('UPDATE conversation_members SET hidden = 1, cleared_before_id = ?, last_read_id = MAX(last_read_id, ?) WHERE conversation_id = ? AND member_id = ?')
    .bind(c.last_message_id ?? 0, c.last_message_id ?? 0, id, me.id)
    .run();
  const seq = await logChange(env, { conversationId: id, kind: 'conv', actorId: me.id, targetId: me.id, data: { status: 'hidden' } });
  await push(env, `u:${me.id}`, [{ t: 'conv', seq, conversationId: id, status: 'hidden' }]);
  return { hidden: true };
}

async function loadMessage(env: Env, mid: number, me: number): Promise<{ m: MsgRow; c: ConvRow; peer: number | null }> {
  const m = await env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(mid).first<MsgRow>();
  if (!m) throw notFound('消息不存在');
  const c = await env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(m.conversation_id).first<ConvRow>();
  if (!c) throw notFound('消息不存在');
  if (c.kind === 'dm') {
    const { peer, mine } = await loadConv(env, c.id, me);
    if (m.id <= mine.cleared_before_id) throw notFound('消息不存在');
    return { m, c, peer };
  }
  const mem = await env.DB.prepare('SELECT 1 AS x FROM conversation_members WHERE conversation_id = ? AND member_id = ?').bind(c.id, me).first();
  if (!mem) throw notFound('消息不存在');
  return { m, c, peer: null };
}

export async function deleteForMe(req: Request, env: Env, mid: number) {
  const me = await requireMember(req, env);
  const { m } = await loadMessage(env, mid, me.id);
  await env.DB.prepare('INSERT OR IGNORE INTO message_hidden (member_id, message_id) VALUES (?, ?)').bind(me.id, mid).run();
  const seq = await logChange(env, { conversationId: m.conversation_id, kind: 'remove', messageId: mid, actorId: me.id, targetId: me.id, data: { forMe: true } });
  await push(env, `u:${me.id}`, [{ t: 'remove', seq, conversationId: m.conversation_id, messageId: mid }]);
  return { deleted: true };
}

export async function recallMessage(req: Request, env: Env, mid: number) {
  const me = await requireMember(req, env);
  const { m, c, peer } = await loadMessage(env, mid, me.id);
  const can = canRecall({ isSender: m.sender_id === me.id, createdAt: m.created_at, now: Date.now(), recalled: !!m.recalled_at });
  if (!can.ok) throw new HttpError(can.status, can.code, can.message);
  // 撤回 = 正文从库里抹掉（双方都看不到）；被举报的消息在 dm_reports 里留有快照供审核
  await env.DB.prepare("UPDATE messages SET recalled_at = ?, body = '-' WHERE id = ?").bind(nowIso(), mid).run();
  const seq = await logChange(env, { conversationId: c.id, kind: 'recall', messageId: mid, actorId: me.id });
  const ev: DmEvent = { t: 'recall', seq, conversationId: c.id, messageId: mid };
  if (c.kind === 'room') await push(env, `r:${c.id}`, [ev]);
  else await Promise.all([push(env, `u:${me.id}`, [ev]), peer != null ? push(env, `u:${peer}`, [ev]) : Promise.resolve()]);
  return { recalled: true };
}

export async function reportMessage(req: Request, env: Env, mid: number, input: unknown) {
  const me = await requireMember(req, env);
  await rateLimit(env, 'report', String(me.id), 10, 3600, '举报太频繁，请稍后再试');
  const o = (input ?? {}) as { reason?: unknown; detail?: unknown };
  const reason = typeof o.reason === 'string' && REPORT_REASONS.includes(o.reason) ? o.reason : null;
  if (!reason) throw bad('reason', `reason 只能是 ${REPORT_REASONS.join(' / ')}`);
  const detail = typeof o.detail === 'string' ? o.detail.trim().slice(0, 300) : '';
  const { m } = await loadMessage(env, mid, me.id);
  if (m.sender_id === me.id) throw new HttpError(400, 'self', '不能举报自己的消息');
  if (m.sender_id == null) throw notFound('消息不存在');
  if (m.recalled_at) throw new HttpError(409, 'already_recalled', '消息已被撤回');
  const text = `[私信 #${mid}] ${excerpt(m.body, 120)}${detail ? ` | ${detail}` : ''}`.slice(0, 500);
  const t = nowIso();
  // reports 表 UNIQUE(reporter, kind, target)：同一人再次举报同一发送者 → 重新打开并更新说明
  await env.DB.prepare(
    `INSERT INTO reports (reporter_id, target_kind, target_id, reason, detail, created_at) VALUES (?, 'user', ?, ?, ?, ?)
     ON CONFLICT(reporter_id, target_kind, target_id) DO UPDATE SET reason = excluded.reason, detail = excluded.detail, status = 'open', resolved_at = NULL`,
  )
    .bind(me.id, m.sender_id, reason, text, t)
    .run();
  const rep = (await env.DB.prepare("SELECT id FROM reports WHERE reporter_id = ? AND target_kind = 'user' AND target_id = ?").bind(me.id, m.sender_id).first<{ id: number }>())!;
  await env.DB.prepare('INSERT OR IGNORE INTO dm_reports (report_id, message_id, conversation_id, reporter_id, snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(rep.id, mid, m.conversation_id, me.id, m.body, t).run();
  return { reported: true, reportId: rep.id };
}

// ============================================================ 离线同步 / 未读 / 设置 / 在线状态
export async function sync(req: Request, env: Env, url: URL) {
  const me = await requireMember(req, env);
  const since = parseId(url.searchParams.get('since'));
  const max = (await env.DB.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM dm_changes').first<{ s: number }>())?.s ?? 0;
  if (since == null) return { events: [], seq: max, hasMore: false, unread: await unreadTotals(env, me.id) };
  const rows = (
    await env.DB.prepare(
      `SELECT ch.*, c.kind AS ckind, c.a_id, c.b_id, cm.cleared_before_id FROM dm_changes ch
         JOIN conversation_members cm ON cm.conversation_id = ch.conversation_id AND cm.member_id = ?
         JOIN conversations c ON c.id = ch.conversation_id
        WHERE ch.seq > ? AND (ch.target_id IS NULL OR ch.target_id = ?)
          AND NOT EXISTS (SELECT 1 FROM user_relations r WHERE c.kind = 'dm' AND r.kind = 'block' AND r.target_id = ? AND r.owner_id = CASE WHEN c.a_id = ? THEN c.b_id ELSE c.a_id END)
        ORDER BY ch.seq LIMIT 201`,
    )
      .bind(me.id, since, me.id, me.id, me.id)
      .all<{ seq: number; conversation_id: number; kind: string; message_id: number | null; actor_id: number | null; target_id: number | null; data: string; ckind: string; cleared_before_id: number }>()
  ).results;
  const page = rows.slice(0, 200);
  const events: DmEvent[] = [];
  for (const r of page) {
    const data = JSON.parse(r.data || '{}') as Record<string, unknown>;
    if (r.kind === 'msg' && r.message_id) {
      if (r.message_id <= r.cleared_before_id) continue;
      const m = await env.DB.prepare('SELECT * FROM messages WHERE id = ? AND id NOT IN (SELECT message_id FROM message_hidden WHERE member_id = ?)').bind(r.message_id, me.id).first<MsgRow>();
      if (m) events.push({ t: 'msg', seq: r.seq, conversationId: r.conversation_id, message: toMessage(m, me.id, await userOf(env, m.sender_id)) });
    } else if (r.kind === 'recall' && r.message_id) events.push({ t: 'recall', seq: r.seq, conversationId: r.conversation_id, messageId: r.message_id });
    else if (r.kind === 'remove' && r.message_id) events.push({ t: 'remove', seq: r.seq, conversationId: r.conversation_id, messageId: r.message_id });
    else if (r.kind === 'read') events.push({ t: 'read', seq: r.seq, conversationId: r.conversation_id, username: (await userOf(env, r.actor_id))?.username ?? '', lastReadId: Number(data.lastReadId) || 0 });
    else if (r.kind === 'conv') events.push({ t: 'conv', seq: r.seq, conversationId: r.conversation_id, status: (data.status as ConvStatus | 'hidden') ?? 'active' });
  }
  const last = page[page.length - 1];
  return { events, seq: last ? last.seq : max, hasMore: rows.length > 200, unread: await unreadTotals(env, me.id) };
}

export async function getSettings(req: Request, env: Env) {
  const me = await requireMember(req, env);
  return { settings: await settingsOf(env, me.id) };
}
export async function putSettings(req: Request, env: Env, input: unknown) {
  const me = await requireMember(req, env);
  const cur = await settingsOf(env, me.id);
  const o = (input ?? {}) as Record<string, unknown>;
  const policy = o.policy === undefined ? cur.policy : checkPolicy(o.policy);
  if (!policy) throw bad('policy', 'policy 只能是 everyone / followers / mutuals / nobody');
  const next: DmSettings = { policy, readReceipts: o.readReceipts === undefined ? cur.readReceipts : !!o.readReceipts, showPresence: o.showPresence === undefined ? cur.showPresence : !!o.showPresence };
  await env.DB.prepare(
    `INSERT INTO dm_settings (member_id, policy, read_receipts, show_presence, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(member_id) DO UPDATE SET policy = excluded.policy, read_receipts = excluded.read_receipts, show_presence = excluded.show_presence, updated_at = excluded.updated_at`,
  )
    .bind(me.id, next.policy, next.readReceipts ? 1 : 0, next.showPresence ? 1 : 0, nowIso())
    .run();
  return { settings: next };
}

export async function presenceOf(req: Request, env: Env, url: URL, resolve: Resolve) {
  const me = await requireMember(req, env);
  const names = [...new Set((url.searchParams.get('u') ?? '').split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_]{3,20}$/.test(s)))].slice(0, 20);
  const out: Record<string, boolean | null> = {};
  const now = Math.floor(Date.now() / 1000);
  for (const n of names) {
    const id = await resolve(n).catch(() => null);
    if (id == null) {
      out[n] = null;
      continue;
    }
    const rel = id === me.id ? null : await relation(env, me.id, id);
    const [a, b] = me.id < id ? [me.id, id] : [id, me.id];
    const conv = id === me.id ? null : await env.DB.prepare("SELECT status FROM conversations WHERE kind = 'dm' AND a_id = ? AND b_id = ?").bind(a, b).first<{ status: ConvStatus }>();
    const related = !!rel && ((rel.following && rel.followedBy) || conv?.status === 'active');
    const ok = canSeePresence({ self: id === me.id, showPresence: (await settingsOf(env, id)).showPresence, blockedEither: !!(rel?.blocked || rel?.blockedBy), related });
    if (!ok) {
      out[n] = null;
      continue;
    }
    const beat = await env.DB.prepare('SELECT 1 AS x FROM presence WHERE member_id = ? AND seen_at >= ? LIMIT 1').bind(id, now - PRESENCE_WINDOW).first();
    out[n] = !!beat || (await hubOnline(env, `u:${id}`));
  }
  return { presence: out };
}

export async function ticket(req: Request, env: Env, input: unknown) {
  const me = await requireMember(req, env);
  await rateLimit(env, 'dm-ticket', String(me.id), 60, 600);
  if (!env.DM_HUB) return { realtime: false, reason: 'no_binding' as const };
  const room = (input as { room?: unknown } | null)?.room;
  if (room !== undefined) {
    const slug = String(room);
    const r = await roomOf(env, slug);
    if (!r) throw notFound('聊天室不存在');
    return { realtime: true, ticket: await signTicket(env, me.id, `r:${r.id}`), path: `/api/social/rooms/${encodeURIComponent(slug)}/ws`, ttl: TICKET_TTL };
  }
  return { realtime: true, ticket: await signTicket(env, me.id, 'u'), path: '/api/social/dm/ws', ttl: TICKET_TTL };
}

async function upgrade(req: Request, env: Env, url: URL, scope: string, hubKey: (memberId: number) => string): Promise<Response> {
  if ((req.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') throw new HttpError(426, 'upgrade_required', '需要 WebSocket');
  if (!env.DM_HUB) throw new HttpError(503, 'realtime_unavailable', '实时连接未启用，请使用轮询');
  const id = await verifyTicket(env, url.searchParams.get('ticket') ?? '', scope);
  if (id == null) throw new HttpError(401, 'unauthorized', '票据无效或已过期');
  if ((await standing(env, id)).banned) throw new HttpError(403, 'banned', '账号已被限制');
  const seq = (await env.DB.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM dm_changes').first<{ s: number }>())?.s ?? 0;
  const headers = new Headers(req.headers);
  headers.set('x-hub-member', `m:${id}`);
  headers.set('x-hub-seq', String(seq));
  return env.DM_HUB.get(env.DM_HUB.idFromName(hubKey(id))).fetch(new Request('https://dm-hub/connect', { headers }));
}

// ============================================================ 活动聊天室（L17 活动）
async function roomOf(env: Env, slug: string): Promise<(ConvRow & { ev_title: string }) | null> {
  return env.DB.prepare("SELECT c.*, e.title AS ev_title FROM conversations c JOIN events e ON e.id = c.event_id WHERE c.kind = 'room' AND e.slug = ?").bind(slug).first<ConvRow & { ev_title: string }>();
}
async function roomRole(env: Env, roomId: number, me: number): Promise<'member' | 'moderator' | null> {
  return (await env.DB.prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND member_id = ?').bind(roomId, me).first<{ role: 'member' | 'moderator' }>())?.role ?? null;
}
async function roomMessages(env: Env, r: ConvRow, me: number, after: number | null, limit = 50): Promise<DmMessage[]> {
  const rows = (
    await env.DB.prepare(
      `SELECT * FROM messages WHERE conversation_id = ? ${after != null ? 'AND id > ?' : ''} AND removed_by IS NULL
         AND (sender_id IS NULL OR sender_id NOT IN (SELECT target_id FROM user_relations WHERE owner_id = ? AND kind = 'block'))
         AND id NOT IN (SELECT message_id FROM message_hidden WHERE member_id = ?)
       ORDER BY id DESC LIMIT ?`,
    )
      .bind(r.id, ...(after != null ? [after] : []), me, me, limit)
      .all<MsgRow>()
  ).results;
  const now = Date.now();
  const vis = rows.filter((m) => roomMessageVisible({ retention: r.retention, ttlHours: r.ttl_hours, createdAt: m.created_at, now })).reverse();
  return Promise.all(vis.map(async (m) => toMessage(m, me, await userOf(env, m.sender_id))));
}

export async function getRoom(req: Request, env: Env, slug: string, url: URL) {
  const me = await requireMember(req, env);
  const r = await roomOf(env, slug);
  if (!r) throw notFound('这个活动没有开启聊天室');
  const role = await roomRole(env, r.id, me.id);
  const after = parseId(url.searchParams.get('after'));
  const count = (await env.DB.prepare('SELECT COUNT(*) AS n FROM conversation_members WHERE conversation_id = ?').bind(r.id).first<{ n: number }>())?.n ?? 0;
  return {
    room: { id: r.id, slug, title: r.title || r.ev_title, retention: r.retention, ttlHours: r.ttl_hours, closed: !!r.closed, joined: !!role, moderator: role === 'moderator', members: count },
    items: await roomMessages(env, r, me.id, after),
  };
}

export async function postRoom(req: Request, env: Env, slug: string, input: unknown) {
  const me = await requirePoster(req, env);
  const r = await roomOf(env, slug);
  if (!r) throw notFound('这个活动没有开启聊天室');
  const can = canSend({ kind: 'room', status: 'active', isRequester: false, myCountWhilePending: 0, blockedEither: false, closed: !!r.closed });
  if (!can.ok) throw new HttpError(can.status, can.code, can.message);
  const o = (input ?? {}) as { body?: unknown; clientId?: unknown };
  const b = checkBody(o.body, ROOM_MAX_BODY);
  if (!b.ok) throw bad('body', b.message);
  const clientId = o.clientId == null ? null : checkClientId(o.clientId);
  if (clientId) {
    const dup = await env.DB.prepare('SELECT * FROM messages WHERE conversation_id = ? AND sender_id = ? AND client_id = ?').bind(r.id, me.id, clientId).first<MsgRow>();
    if (dup) return { message: toMessage(dup, me.id, await userOf(env, me.id)), duplicate: true };
  }
  const lim = limitsFor(me.joinedAt, Date.now());
  await rateLimit(env, 'room-msg', String(me.id), lim.roomPerMin, 60, '发言太快了，请稍等一会儿');
  const t = nowIso();
  await env.DB.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, member_id, joined_at) VALUES (?, ?, ?)').bind(r.id, me.id, t).run();
  const row = (await env.DB.prepare('INSERT INTO messages (conversation_id, sender_id, body, client_id, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *').bind(r.id, me.id, b.value, clientId, t).first<MsgRow>())!;
  const stmts = [env.DB.prepare('UPDATE conversations SET last_message_id = ?, last_at = ? WHERE id = ?').bind(row.id, t, r.id)];
  // 临时房间：顺手清掉超过保留时长的消息（被举报的消息快照在 dm_reports 里）
  if (r.retention === 'ephemeral') stmts.push(env.DB.prepare('DELETE FROM messages WHERE conversation_id = ? AND created_at < ?').bind(r.id, new Date(Date.now() - r.ttl_hours * 3600_000).toISOString()));
  await env.DB.batch(stmts);
  const seq = await logChange(env, { conversationId: r.id, kind: 'msg', messageId: row.id, actorId: me.id });
  const sender = await userOf(env, me.id);
  // 房间广播的 mine 由浏览器按用户名判断
  await push(env, `r:${r.id}`, [{ t: 'msg', seq, conversationId: r.id, message: { ...toMessage(row, -1, sender), clientId } }]);
  return { message: toMessage(row, me.id, sender), duplicate: false };
}

async function removeRoomMessage(env: Env, mid: number, actor: number | 'admin'): Promise<{ removed: true }> {
  const m = await env.DB.prepare('SELECT m.*, c.kind FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.id = ?').bind(mid).first<MsgRow & { kind: string }>();
  if (!m || m.kind !== 'room') throw notFound('消息不存在');
  if (actor !== 'admin' && m.sender_id !== actor && (await roomRole(env, m.conversation_id, actor)) !== 'moderator') throw new HttpError(403, 'forbidden', '只有聊天室管理员可以移除别人的消息');
  await env.DB.prepare("UPDATE messages SET removed_by = ?, body = '-' WHERE id = ?").bind(actor === 'admin' ? 0 : actor, mid).run();
  if (actor === 'admin' || actor !== m.sender_id) {
    await env.DB.prepare(
      'INSERT INTO moderation_actions (actor, action, target_kind, target_id, member_id, report_id, reason, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)',
    )
      .bind(actor === 'admin' ? 'admin' : `member:${actor}`, 'hide', 'user', m.sender_id ?? 0, m.sender_id, `活动聊天室消息 #${mid} 已移除`, nowIso())
      .run()
      .catch(() => undefined);
  }
  const seq = await logChange(env, { conversationId: m.conversation_id, kind: 'remove', messageId: mid, actorId: actor === 'admin' ? null : actor });
  await push(env, `r:${m.conversation_id}`, [{ t: 'remove', seq, conversationId: m.conversation_id, messageId: mid }]);
  return { removed: true };
}

/** 后台：开启 / 配置某个活动的聊天室；指定管理员（成员用户名）。 */
export async function configureRoom(env: Env, slug: string, input: unknown) {
  const ev = await env.DB.prepare('SELECT id, title FROM events WHERE slug = ?').bind(slug).first<{ id: number; title: string }>();
  if (!ev) throw notFound('活动不存在');
  const c = checkRoomConfig(input);
  if (!c.ok) throw bad('room', c.message);
  const v = c.value;
  const ex = await env.DB.prepare("SELECT id FROM conversations WHERE kind = 'room' AND event_id = ?").bind(ev.id).first<{ id: number }>();
  if (!v.enabled) {
    if (ex) await env.DB.prepare('DELETE FROM conversations WHERE id = ?').bind(ex.id).run();
    return { room: null };
  }
  const t = nowIso();
  let id = ex?.id;
  if (id) await env.DB.prepare('UPDATE conversations SET retention = ?, ttl_hours = ?, closed = ?, title = ? WHERE id = ?').bind(v.retention, v.ttlHours, v.closed ? 1 : 0, ev.title, id).run();
  else id = (await env.DB.prepare("INSERT INTO conversations (kind, event_id, title, retention, ttl_hours, closed, created_at, last_at) VALUES ('room', ?, ?, ?, ?, ?, ?, ?) RETURNING id").bind(ev.id, ev.title, v.retention, v.ttlHours, v.closed ? 1 : 0, t, t).first<{ id: number }>())!.id;
  const mods = Array.isArray((input as { moderators?: unknown }).moderators) ? ((input as { moderators: unknown[] }).moderators.map(String).filter((s) => /^[A-Za-z0-9_]{3,20}$/.test(s)).slice(0, 10)) : null;
  if (mods) {
    await env.DB.prepare("UPDATE conversation_members SET role = 'member' WHERE conversation_id = ?").bind(id).run();
    for (const u of mods) {
      const p = await env.DB.prepare('SELECT member_id FROM user_profiles WHERE username = ? COLLATE NOCASE').bind(u).first<{ member_id: number }>();
      if (p) await env.DB.prepare("INSERT INTO conversation_members (conversation_id, member_id, role, joined_at) VALUES (?, ?, 'moderator', ?) ON CONFLICT(conversation_id, member_id) DO UPDATE SET role = 'moderator'").bind(id, p.member_id, t).run();
    }
  }
  return { room: { id, slug, retention: v.retention, ttlHours: v.ttlHours, closed: v.closed } };
}

// ============================================================ 导出 / 注销
export async function exportDm(env: Env, id: number) {
  const all = async <T>(sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results;
  return {
    dmSettings: await settingsOf(env, id),
    // 只导出自己发送的消息（对方的消息属于对方）
    directMessages: await all(
      "SELECT m.conversation_id, c.kind, p.username AS peer, m.body, m.created_at, m.recalled_at FROM messages m JOIN conversations c ON c.id = m.conversation_id LEFT JOIN user_profiles p ON p.member_id = CASE WHEN c.a_id = ? THEN c.b_id ELSE c.a_id END WHERE m.sender_id = ? AND m.recalled_at IS NULL AND m.removed_by IS NULL",
      id,
      id,
    ),
  };
}
export function purgeDm(env: Env, id: number): D1PreparedStatement[] {
  return [
    env.DB.prepare('DELETE FROM messages WHERE sender_id = ?').bind(id),
    env.DB.prepare("DELETE FROM conversations WHERE kind = 'dm' AND (a_id = ? OR b_id = ?)").bind(id, id),
    env.DB.prepare('DELETE FROM conversation_members WHERE member_id = ?').bind(id),
    env.DB.prepare('DELETE FROM message_hidden WHERE member_id = ?').bind(id),
    env.DB.prepare('DELETE FROM dm_declines WHERE requester_id = ? OR target_id = ?').bind(id, id),
    env.DB.prepare('DELETE FROM dm_settings WHERE member_id = ?').bind(id),
    env.DB.prepare('UPDATE dm_reports SET reporter_id = NULL WHERE reporter_id = ?').bind(id),
    env.DB.prepare('UPDATE presence SET member_id = NULL WHERE member_id = ?').bind(id),
  ];
}

// ============================================================ 路由
const SLUG = '([a-z0-9][a-z0-9-]{1,39})';
export async function routeDm(req: Request, env: Env, sub: string, url: URL, body: () => Promise<unknown>, resolve: Resolve): Promise<Response | null> {
  if (!sub.startsWith('/dm/') && !sub.startsWith('/rooms/')) return null;
  const m = req.method;
  const ok = (data: unknown, status = 200) => json(data, { status, headers: NO_STORE });
  let mt: RegExpExecArray | null;
  if (sub === '/dm/ws' && m === 'GET') return upgrade(req, env, url, 'u', (id) => `u:${id}`);
  if ((mt = new RegExp(`^/rooms/${SLUG}/ws$`).exec(sub)) && m === 'GET') {
    const r = await roomOf(env, mt[1]!);
    if (!r) throw notFound('聊天室不存在');
    return upgrade(req, env, url, `r:${r.id}`, () => `r:${r.id}`);
  }
  if (m === 'GET') {
    if (sub === '/dm/conversations') return ok(await listConversations(req, env, url));
    if ((mt = /^\/dm\/conversations\/(\d{1,12})$/.exec(sub))) return ok(await getConversation(req, env, Number(mt[1])));
    if ((mt = /^\/dm\/conversations\/(\d{1,12})\/messages$/.exec(sub))) return ok(await listMessages(req, env, Number(mt[1]), url));
    if (sub === '/dm/unread') {
      const me = await requireMember(req, env);
      return ok(await unreadTotals(env, me.id));
    }
    if (sub === '/dm/sync') return ok(await sync(req, env, url));
    if (sub === '/dm/settings') return ok(await getSettings(req, env));
    if (sub === '/dm/presence') return ok(await presenceOf(req, env, url, resolve));
    if ((mt = new RegExp(`^/rooms/${SLUG}$`).exec(sub))) return ok(await getRoom(req, env, mt[1]!, url));
    return null;
  }
  if (sub === '/dm/conversations' && m === 'POST') {
    const r = await startConversation(req, env, await body(), resolve);
    return ok(r, r.created ? 201 : 200);
  }
  if ((mt = /^\/dm\/conversations\/(\d{1,12})\/messages$/.exec(sub)) && m === 'POST') {
    const r = await sendMessage(req, env, Number(mt[1]), await body());
    return ok(r, r.duplicate ? 200 : 201);
  }
  if ((mt = /^\/dm\/conversations\/(\d{1,12})\/read$/.exec(sub)) && m === 'POST') return ok(await markConvRead(req, env, Number(mt[1]), await body()));
  if ((mt = /^\/dm\/conversations\/(\d{1,12})\/(accept|decline|block)$/.exec(sub)) && m === 'POST') return ok(await respondRequest(req, env, Number(mt[1]), mt[2] as 'accept' | 'decline' | 'block'));
  if ((mt = /^\/dm\/conversations\/(\d{1,12})$/.exec(sub)) && m === 'DELETE') return ok(await hideConversation(req, env, Number(mt[1])));
  if ((mt = /^\/dm\/messages\/(\d{1,12})$/.exec(sub)) && m === 'DELETE') return ok(await deleteForMe(req, env, Number(mt[1])));
  if ((mt = /^\/dm\/messages\/(\d{1,12})\/recall$/.exec(sub)) && m === 'POST') return ok(await recallMessage(req, env, Number(mt[1])));
  if ((mt = /^\/dm\/messages\/(\d{1,12})\/report$/.exec(sub)) && m === 'POST') return ok(await reportMessage(req, env, Number(mt[1]), await body()), 201);
  if (sub === '/dm/settings' && (m === 'PUT' || m === 'PATCH')) return ok(await putSettings(req, env, await body()));
  if (sub === '/dm/ticket' && m === 'POST') return ok(await ticket(req, env, await body().catch(() => ({}))));
  if ((mt = new RegExp(`^/rooms/${SLUG}/messages$`).exec(sub)) && m === 'POST') {
    const r = await postRoom(req, env, mt[1]!, await body());
    return ok(r, r.duplicate ? 200 : 201);
  }
  if ((mt = new RegExp(`^/rooms/${SLUG}/messages/(\\d{1,12})$`).exec(sub)) && m === 'DELETE') {
    const me = await requireMember(req, env);
    return ok(await removeRoomMessage(env, Number(mt[2]), me.id));
  }
  return null;
}

/** 后台 /api/admin/rooms/*、/api/admin/dm/reports/:id。 */
export async function routeAdminDm(req: Request, env: Env, sub: string, body: () => Promise<unknown>): Promise<Response | null> {
  const ok = (data: unknown) => json(data, { headers: NO_STORE });
  let mt: RegExpExecArray | null;
  if ((mt = new RegExp(`^/rooms/${SLUG}$`).exec(sub)) && (req.method === 'PUT' || req.method === 'POST')) return ok(await configureRoom(env, mt[1]!, await body()));
  if ((mt = /^\/rooms\/messages\/(\d{1,12})$/.exec(sub)) && req.method === 'DELETE') return ok(await removeRoomMessage(env, Number(mt[1]), 'admin'));
  if ((mt = /^\/dm\/reports\/(\d{1,12})$/.exec(sub)) && req.method === 'GET') {
    // 审核员只看被举报的那几条消息的快照，不能浏览整段私信
    const rows = (await env.DB.prepare('SELECT message_id, conversation_id, snapshot, created_at FROM dm_reports WHERE report_id = ? ORDER BY created_at').bind(Number(mt[1])).all()).results;
    return ok({ items: rows });
  }
  return null;
}

export type { Member };
void getMember;
