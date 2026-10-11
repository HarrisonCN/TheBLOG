import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import { testOutbox } from '../src/community';
import type { Env } from '../src/env';
import { DmHub, type HubSocket } from '../src/dm-hub';
import { signTicket, verifyTicket } from '../src/dm';
import {
  announceText,
  canRecall,
  canSeePresence,
  canSend,
  checkBody,
  checkRoomConfig,
  decideStart,
  decodeConvCursor,
  encodeConvCursor,
  limitsFor,
  receiptsVisible,
  RECALL_WINDOW_MS,
  REQUEST_PENDING_MAX,
  roomMessageVisible,
} from '../src/dm-core';

// 假的 DM_HUB 命名空间：记录 Worker 推给每个 hub 的事件
const pushed: { key: string; events: any[] }[] = [];
const onlineKeys = new Set<string>();
const fakeHub = {
  idFromName: (n: string) => n,
  get: (key: string) => ({
    fetch: async (u: string, init?: RequestInit) => {
      if (String(u).endsWith('/push')) {
        pushed.push({ key, events: (JSON.parse(String(init?.body)) as { events: any[] }).events });
        return Response.json({ delivered: 1 });
      }
      if (String(u).endsWith('/online')) return Response.json({ online: onlineKeys.has(key) });
      return new Response('no', { status: 404 });
    },
  }),
};

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({ EMAIL_PROVIDER: 'memory', DM_HUB: fakeHub as never });
  admin = await login(env, '10.19.0.1');
});
afterAll(async () => {
  await disposeEnv();
});

const ip = (n: number) => ({ 'cf-connecting-ip': `10.19.1.${n}` });
const codeFor = (email: string) => /(\d{6})/.exec(testOutbox.filter((m) => m.to === email).at(-1)?.text ?? '')?.[1] ?? '';
type U = { token: string; id: number; username: string };
async function join(email: string, name: string, username: string, n: number, oldAccount = true): Promise<U> {
  expect((await call(env, '/api/members/register', { body: { name, email }, headers: ip(n) })).status).toBe(200);
  const b = (await (await call(env, '/api/members/verify', { body: { email, code: codeFor(email) } })).json()) as any;
  const r = await call(env, '/api/social/me', { method: 'PUT', token: b.token, body: { username } });
  expect(r.status).toBe(200);
  // 默认把账号「注册时间」挪到 10 天前（不算新账号）；新账号限额单独测
  if (oldAccount) await env.DB.prepare('UPDATE members SET joined_at = ? WHERE id = ?').bind(new Date(Date.now() - 10 * 86400_000).toISOString(), b.member.id).run();
  return { token: b.token, id: b.member.id, username };
}
const J = async (r: Response) => (await r.json()) as any;
const get = (path: string, token?: string) => call(env, path, { token });
const post = (path: string, token: string | undefined, body?: unknown) => call(env, path, { method: 'POST', token, body: body ?? {} });
const put = (path: string, token: string, body: unknown) => call(env, path, { method: 'PUT', token, body });
const del = (path: string, token: string) => call(env, path, { method: 'DELETE', token });
const adm = (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => call(env, path, { method, cookie: admin.cookie, csrf: admin.csrf, body });
const follow = (a: U, b: U) => post(`/api/social/follows/${b.username}`, a.token);
const start = (a: U, b: U) => post('/api/social/dm/conversations', a.token, { username: b.username });
const send = (a: U, conv: number, body: string, clientId?: string) => post(`/api/social/dm/conversations/${conv}/messages`, a.token, { body, clientId });

describe('dm-core 纯函数', () => {
  const rel = (o: Partial<{ following: boolean; followedBy: boolean; blocked: boolean; blockedBy: boolean }> = {}) => ({ following: false, followedBy: false, blocked: false, blockedBy: false, ...o });
  it('发起私信：互关直接会话，其他人走请求；隐私开关；拉黑', () => {
    const now = Date.now();
    expect(decideStart({ self: false, rel: rel({ following: true, followedBy: true }), policy: 'mutuals', now })).toEqual({ ok: true, kind: 'direct' });
    expect(decideStart({ self: false, rel: rel(), policy: 'everyone', now })).toEqual({ ok: true, kind: 'request' });
    expect(decideStart({ self: false, rel: rel(), policy: 'mutuals', now })).toMatchObject({ ok: false, code: 'dm_mutuals_only' });
    expect(decideStart({ self: false, rel: rel(), policy: 'followers', now })).toMatchObject({ ok: false, code: 'dm_followers_only' });
    expect(decideStart({ self: false, rel: rel({ following: true }), policy: 'followers', now })).toEqual({ ok: true, kind: 'request' });
    expect(decideStart({ self: false, rel: rel({ following: true, followedBy: true }), policy: 'nobody', now })).toMatchObject({ ok: false, code: 'dm_closed' });
    expect(decideStart({ self: false, rel: rel({ blockedBy: true }), policy: 'everyone', now })).toMatchObject({ ok: false, status: 404 });
    expect(decideStart({ self: false, rel: rel({ blocked: true }), policy: 'everyone', now })).toMatchObject({ ok: false, code: 'blocked' });
    expect(decideStart({ self: true, rel: rel(), policy: 'everyone', now })).toMatchObject({ ok: false, code: 'self' });
    expect(decideStart({ self: false, rel: rel(), policy: 'everyone', declinedUntil: now + 1000, now })).toMatchObject({ ok: false, code: 'request_cooldown' });
  });
  it('发送 / 撤回 / 在线状态 / 已读回执 / 聊天室保留', () => {
    expect(canSend({ kind: 'dm', status: 'request', isRequester: true, myCountWhilePending: REQUEST_PENDING_MAX, blockedEither: false })).toMatchObject({ ok: false, code: 'request_pending_limit' });
    expect(canSend({ kind: 'dm', status: 'request', isRequester: false, myCountWhilePending: 0, blockedEither: false })).toMatchObject({ ok: false, code: 'request_pending' });
    expect(canSend({ kind: 'dm', status: 'active', isRequester: false, myCountWhilePending: 0, blockedEither: true })).toMatchObject({ ok: false, code: 'blocked' });
    expect(canSend({ kind: 'room', status: 'active', isRequester: false, myCountWhilePending: 0, blockedEither: false, closed: true })).toMatchObject({ ok: false, code: 'room_closed' });
    const now = Date.now();
    expect(canRecall({ isSender: true, createdAt: new Date(now - 1000).toISOString(), now, recalled: false })).toEqual({ ok: true });
    expect(canRecall({ isSender: true, createdAt: new Date(now - RECALL_WINDOW_MS - 1000).toISOString(), now, recalled: false })).toMatchObject({ code: 'recall_expired' });
    expect(canRecall({ isSender: false, createdAt: new Date(now).toISOString(), now, recalled: false })).toMatchObject({ code: 'forbidden' });
    expect(canSeePresence({ self: false, showPresence: true, blockedEither: false, related: true })).toBe(true);
    expect(canSeePresence({ self: false, showPresence: false, blockedEither: false, related: true })).toBe(false);
    expect(canSeePresence({ self: false, showPresence: true, blockedEither: true, related: true })).toBe(false);
    expect(canSeePresence({ self: false, showPresence: true, blockedEither: false, related: false })).toBe(false);
    expect(receiptsVisible(true, false)).toBe(false);
    expect(roomMessageVisible({ retention: 'ephemeral', ttlHours: 1, createdAt: new Date(now - 2 * 3600_000).toISOString(), now })).toBe(false);
    expect(roomMessageVisible({ retention: 'retained', ttlHours: 1, createdAt: new Date(now - 2 * 3600_000).toISOString(), now })).toBe(true);
    expect(checkRoomConfig({ retention: 'x' }).ok).toBe(false);
    expect(checkRoomConfig({ ttlHours: 9999 }).ok).toBe(false);
  });
  it('正文校验、限额、游标、播报文字', () => {
    expect(checkBody('  hi \r\n there ')).toEqual({ ok: true, value: 'hi \n there' });
    expect(checkBody('\u202Eabc')).toEqual({ ok: true, value: 'abc' });
    expect(checkBody('   ').ok).toBe(false);
    expect(checkBody('x'.repeat(2001)).ok).toBe(false);
    expect(limitsFor(new Date().toISOString(), Date.now()).requestsPerDay).toBe(3);
    expect(limitsFor(new Date(Date.now() - 30 * 86400_000).toISOString(), Date.now()).requestsPerDay).toBe(20);
    expect(decodeConvCursor(encodeConvCursor('2026-10-11T00:00:00.000Z', 42))).toEqual({ lastAt: '2026-10-11T00:00:00.000Z', id: 42 });
    expect(decodeConvCursor('%%%')).toBeNull();
    expect(announceText('小林', 'a'.repeat(100))).toMatch(/^小林：a{80}…$/);
  });
});

describe('DmHub（Durable Object 单元：假的 state / WebSocket）', () => {
  class FakeWs implements HubSocket {
    sent: string[] = [];
    closed: number | null = null;
    send(d: string) {
      if (this.closed != null) throw new Error('closed');
      this.sent.push(d);
    }
    close(code = 1000) {
      this.closed = code;
    }
  }
  it('push 广播给所有连接；坏连接被关闭；ping → pong；online', async () => {
    const socks: FakeWs[] = [new FakeWs(), new FakeWs()];
    const state = { acceptWebSocket: () => undefined, getWebSockets: () => socks };
    const hub = new DmHub(state);
    const r = await hub.fetch(new Request('https://dm-hub/push', { method: 'POST', body: JSON.stringify({ events: [{ t: 'msg', seq: 1 }] }) }));
    expect(((await r.json()) as any).delivered).toBe(2);
    expect(JSON.parse(socks[0]!.sent[0]!)).toEqual({ t: 'msg', seq: 1 });
    socks[1]!.closed = 1006;
    expect(hub.broadcast([{ t: 'x' }])).toBe(1);
    hub.webSocketMessage(socks[0]!, 'ping');
    expect(socks[0]!.sent.at(-1)).toBe('pong');
    hub.webSocketMessage(socks[0]!, JSON.stringify({ t: 'send', body: 'sneaky' }));
    expect(socks[0]!.sent.at(-1)).toBe('pong'); // 写操作不走 WebSocket
    expect(((await (await hub.fetch(new Request('https://dm-hub/online'))).json()) as any).online).toBe(true);
    expect((await hub.fetch(new Request('https://dm-hub/connect'))).status).toBe(426);
  });
});

describe('L19 私信接口', () => {
  let A: U, B: U, C: U, D: U, E: U;
  let convAB = 0;
  beforeAll(async () => {
    A = await join('dm-a@example.com', 'Ada', 'dm_ada', 1);
    B = await join('dm-b@example.com', 'Bo', 'dm_bo', 2);
    C = await join('dm-c@example.com', 'Cy', 'dm_cy', 3);
    D = await join('dm-d@example.com', 'Di', 'dm_di', 4);
    E = await join('dm-e@example.com', 'Ed', 'dm_ed', 5);
    await follow(A, B);
    await follow(B, A);
  });

  it('互相关注 → 直接会话；实时推送给双方 hub；clientId 去重', async () => {
    const r = await start(A, B);
    expect(r.status).toBe(201);
    const c = (await J(r)).conversation;
    expect(c.status).toBe('active');
    expect(c.peer.username).toBe('dm_bo');
    convAB = c.id;
    // 再次发起 → 同一个会话
    expect((await J(await start(B, A))).conversation.id).toBe(convAB);
    pushed.length = 0;
    const s = await send(A, convAB, '你好，Bo', 'cid-hello-1');
    expect(s.status).toBe(201);
    const msg = (await J(s)).message;
    expect(msg.mine).toBe(true);
    expect(pushed.map((p) => p.key).sort()).toEqual([`u:${A.id}`, `u:${B.id}`]);
    const toB = pushed.find((p) => p.key === `u:${B.id}`)!.events[0];
    expect(toB).toMatchObject({ t: 'msg', conversationId: convAB, message: { body: '你好，Bo', mine: false, sender: { username: 'dm_ada' } } });
    // 断线重发同一个 clientId：不产生第二条
    const dup = await send(A, convAB, '你好，Bo', 'cid-hello-1');
    expect(dup.status).toBe(200);
    expect((await J(dup)).message.id).toBe(msg.id);
  });

  it('非参与者读 / 发都被拦截（404，不泄露会话存在）；未登录 401', async () => {
    expect((await get(`/api/social/dm/conversations/${convAB}`, C.token)).status).toBe(404);
    expect((await get(`/api/social/dm/conversations/${convAB}/messages`, C.token)).status).toBe(404);
    expect((await send(C, convAB, '偷看')).status).toBe(404);
    expect((await get(`/api/social/dm/conversations/${convAB}/messages`)).status).toBe(401);
    const mid = (await J(await get(`/api/social/dm/conversations/${convAB}/messages`, A.token))).items[0].id;
    expect((await post(`/api/social/dm/messages/${mid}/recall`, C.token)).status).toBe(404);
    expect((await del(`/api/social/dm/messages/${mid}`, C.token)).status).toBe(404);
    expect((await post(`/api/social/dm/messages/${mid}/report`, C.token, { reason: 'spam' })).status).toBe(404);
  });

  it('历史游标分页 + 未读数 + 已读', async () => {
    for (let i = 1; i <= 7; i++) expect((await send(B, convAB, `第 ${i} 条`)).status).toBe(201);
    const un = await J(await get('/api/social/dm/unread', A.token));
    expect(un.total).toBe(7);
    const p1 = await J(await get(`/api/social/dm/conversations/${convAB}/messages?limit=3`, A.token));
    expect(p1.items.map((m: any) => m.body)).toEqual(['第 5 条', '第 6 条', '第 7 条']);
    expect(p1.hasMore).toBe(true);
    const p2 = await J(await get(`/api/social/dm/conversations/${convAB}/messages?limit=3&before=${p1.nextBefore}`, A.token));
    expect(p2.items.map((m: any) => m.body)).toEqual(['第 2 条', '第 3 条', '第 4 条']);
    const list = await J(await get('/api/social/dm/conversations', A.token));
    expect(list.items[0]).toMatchObject({ id: convAB, unread: 7, lastMessage: { excerpt: '第 7 条', mine: false } });
    pushed.length = 0;
    const last = p1.items[2].id;
    expect((await J(await post(`/api/social/dm/conversations/${convAB}/read`, A.token, { lastReadId: last }))).lastReadId).toBe(last);
    expect((await J(await get('/api/social/dm/unread', A.token))).total).toBe(0);
    // 双方都开着已读回执 → B 收到「已读」
    expect(pushed.find((p) => p.key === `u:${B.id}`)?.events[0]).toMatchObject({ t: 'read', username: 'dm_ada', lastReadId: last });
    expect((await J(await get(`/api/social/dm/conversations/${convAB}`, B.token))).conversation.peerLastReadId).toBe(last);
  });

  it('已读回执可关闭：关闭方不发送也看不到', async () => {
    expect((await put('/api/social/dm/settings', A.token, { readReceipts: false })).status).toBe(200);
    await send(B, convAB, '看到了吗');
    pushed.length = 0;
    await post(`/api/social/dm/conversations/${convAB}/read`, A.token, {});
    expect(pushed.find((p) => p.key === `u:${B.id}`)).toBeUndefined();
    expect(pushed.find((p) => p.key === `u:${A.id}`)?.events[0].t).toBe('read'); // 自己的其他标签页仍同步
    expect((await J(await get(`/api/social/dm/conversations/${convAB}`, B.token))).conversation.peerLastReadId).toBeNull();
    expect((await J(await get(`/api/social/dm/conversations/${convAB}`, A.token))).conversation.peerLastReadId).toBeNull();
    await put('/api/social/dm/settings', A.token, { readReceipts: true });
  });

  it('离线同步：since=seq 补齐新消息 / 撤回；不包含别人的会话', async () => {
    const boot = await J(await get('/api/social/dm/sync', B.token));
    expect(boot.events).toEqual([]);
    const since = boot.seq;
    // B「离线」期间：A 发两条、撤回一条
    const m1 = (await J(await send(A, convAB, '离线消息 1'))).message;
    await send(A, convAB, '离线消息 2');
    expect((await post(`/api/social/dm/messages/${m1.id}/recall`, A.token)).status).toBe(200);
    const s = await J(await get(`/api/social/dm/sync?since=${since}`, B.token));
    const kinds = s.events.map((e: any) => e.t);
    expect(kinds).toEqual(['msg', 'msg', 'recall']);
    expect(s.events[0].message).toMatchObject({ id: m1.id, recalled: true, body: '' }); // 已撤回：正文不再下发
    expect(s.events[1].message.body).toBe('离线消息 2');
    expect(s.seq).toBeGreaterThan(since);
    // C 的同步里看不到 A↔B 的任何事件
    expect((await J(await get(`/api/social/dm/sync?since=${since}`, C.token))).events).toEqual([]);
    // 再同步一次：没有新事件
    expect((await J(await get(`/api/social/dm/sync?since=${s.seq}`, B.token))).events).toEqual([]);
  });

  it('撤回：只能撤回自己的、限时；仅自己删除只影响自己', async () => {
    const m = (await J(await send(B, convAB, '要撤回的'))).message;
    expect((await post(`/api/social/dm/messages/${m.id}/recall`, A.token)).status).toBe(403);
    expect((await post(`/api/social/dm/messages/${m.id}/recall`, B.token)).status).toBe(200);
    expect((await post(`/api/social/dm/messages/${m.id}/recall`, B.token)).status).toBe(409);
    const row = await env.DB.prepare('SELECT body FROM messages WHERE id = ?').bind(m.id).first<{ body: string }>();
    expect(row!.body).not.toContain('要撤回的'); // 正文从库里抹掉
    const old = (await J(await send(B, convAB, '很久以前的'))).message;
    await env.DB.prepare('UPDATE messages SET created_at = ? WHERE id = ?').bind(new Date(Date.now() - 11 * 60_000).toISOString(), old.id).run();
    expect((await J(await post(`/api/social/dm/messages/${old.id}/recall`, B.token))).error.code).toBe('recall_expired');
    // 仅自己删除
    expect((await del(`/api/social/dm/messages/${old.id}`, A.token)).status).toBe(200);
    const forA = await J(await get(`/api/social/dm/conversations/${convAB}/messages?limit=100`, A.token));
    expect(forA.items.some((x: any) => x.id === old.id)).toBe(false);
    const forB = await J(await get(`/api/social/dm/conversations/${convAB}/messages?limit=100`, B.token));
    expect(forB.items.some((x: any) => x.id === old.id)).toBe(true);
  });

  it('非互关 → 消息请求：接受前最多 3 条；对方接受 / 婉拒（冷却期）', async () => {
    const r = await J(await start(C, A));
    expect(r.conversation.status).toBe('request');
    const id = r.conversation.id;
    // 还没发消息：不出现在对方的请求箱里
    expect((await J(await get('/api/social/dm/conversations?box=requests', A.token))).items).toEqual([]);
    for (let i = 0; i < 3; i++) expect((await send(C, id, `请求 ${i}`)).status).toBe(201);
    expect((await J(await send(C, id, '第四条'))).error.code).toBe('request_pending_limit');
    const reqs = await J(await get('/api/social/dm/conversations?box=requests', A.token));
    expect(reqs.items.map((x: any) => x.id)).toEqual([id]);
    expect((await J(await get('/api/social/dm/unread', A.token))).requests).toBe(1);
    // 收件人在接受前不能回复，但可以读
    expect((await J(await send(A, id, '回复'))).error.code).toBe('request_pending');
    expect((await get(`/api/social/dm/conversations/${id}/messages`, A.token)).status).toBe(200);
    // 发起人不能自己接受
    expect((await post(`/api/social/dm/conversations/${id}/accept`, C.token)).status).toBe(409);
    expect((await J(await post(`/api/social/dm/conversations/${id}/accept`, A.token))).status).toBe('active');
    expect((await send(A, id, '你好 Cy')).status).toBe(201);
    expect((await send(C, id, '谢谢')).status).toBe(201);
    // 婉拒：D → B
    const rd = (await J(await start(D, B))).conversation.id;
    await send(D, rd, '在吗');
    expect((await J(await post(`/api/social/dm/conversations/${rd}/decline`, B.token))).status).toBe('declined');
    expect((await J(await send(D, rd, '再问一次'))).error.code).toBe('request_declined');
    expect((await J(await start(D, B))).error.code).toBe('request_cooldown');
    expect((await J(await get('/api/social/dm/conversations?box=requests', B.token))).items).toEqual([]);
  });

  it('隐私开关：followers / mutuals / nobody', async () => {
    await put('/api/social/dm/settings', E.token, { policy: 'mutuals' });
    expect((await J(await start(D, E))).error.code).toBe('dm_mutuals_only');
    await put('/api/social/dm/settings', E.token, { policy: 'followers' });
    expect((await J(await start(D, E))).error.code).toBe('dm_followers_only');
    await follow(D, E);
    expect((await J(await start(D, E))).conversation.status).toBe('request');
    await put('/api/social/dm/settings', E.token, { policy: 'nobody' });
    // 已有会话不受影响；新的人不能发起
    expect((await J(await start(C, E))).error.code).toBe('dm_closed');
    expect((await put('/api/social/dm/settings', E.token, { policy: 'strangers' })).status).toBe(400);
    expect((await J(await get('/api/social/dm/settings', E.token))).settings.policy).toBe('nobody');
  });

  it('拉黑：被拉黑方看不到会话、不能读不能发；拉黑方能看历史但不能发；不能发起', async () => {
    const id = (await J(await start(C, A))).conversation.id; // 已接受的 C↔A
    expect((await post('/api/social/blocks/dm_cy', A.token)).status).toBe(200);
    expect((await get(`/api/social/dm/conversations/${id}/messages`, C.token)).status).toBe(404);
    expect((await send(C, id, '还在吗')).status).toBe(404);
    expect((await J(await get('/api/social/dm/conversations', C.token))).items.some((x: any) => x.id === id)).toBe(false);
    expect((await get(`/api/social/dm/conversations/${id}/messages`, A.token)).status).toBe(200);
    expect((await J(await send(A, id, '拉黑后'))).error.code).toBe('blocked');
    expect((await J(await start(C, A))).error.code).toBe('not_found');
    expect((await J(await start(A, C))).error.code).toBe('blocked');
    // 同步也不再给被拉黑方推这个会话的事件
    const s = await J(await get('/api/social/dm/sync?since=0', C.token));
    expect(s.events.some((e: any) => e.conversationId === id)).toBe(false);
    await del('/api/social/blocks/dm_cy', A.token);
  });

  it('请求里直接拉黑：会话被婉拒 + 拉黑', async () => {
    const F = await join('dm-f@example.com', 'Fe', 'dm_fe', 6);
    const id = (await J(await start(F, D))).conversation.id;
    await send(F, id, '买粉吗');
    expect((await J(await post(`/api/social/dm/conversations/${id}/block`, D.token))).status).toBe('declined');
    expect((await get(`/api/social/dm/conversations/${id}/messages`, F.token)).status).toBe(404);
    expect((await J(await get('/api/social/me/blocks', D.token))).users.map((x: any) => x.username)).toContain('dm_fe');
  });

  it('举报私信 → 进入已有审核队列（按发送者），审核员只看被举报消息的快照', async () => {
    const m = (await J(await send(B, convAB, '这是骚扰内容'))).message;
    expect((await post(`/api/social/dm/messages/${m.id}/report`, B.token, { reason: 'abuse' })).status).toBe(400); // 自己的
    const r = await post(`/api/social/dm/messages/${m.id}/report`, A.token, { reason: 'abuse', detail: '一直发' });
    expect(r.status).toBe(201);
    const { reportId } = await J(r);
    const q = await J(await adm('/api/admin/ugc/queue?view=reports'));
    const item = q.items.find((x: any) => x.kind === 'user' && x.id === B.id);
    expect(item).toBeTruthy();
    expect(item.reports.some((x: any) => x.detail.startsWith(`[私信 #${m.id}]`))).toBe(true);
    const snap = await J(await adm(`/api/admin/dm/reports/${reportId}`));
    expect(snap.items[0]).toMatchObject({ message_id: m.id, snapshot: '这是骚扰内容' });
    // 撤回后快照仍在
    await post(`/api/social/dm/messages/${m.id}/recall`, B.token);
    expect((await J(await adm(`/api/admin/dm/reports/${reportId}`))).items[0].snapshot).toBe('这是骚扰内容');
  });

  it('限流：新账号每分钟 10 条、每天 3 个请求；删除会话（仅自己）', async () => {
    const N = await join('dm-new@example.com', 'Nu', 'dm_new', 7, false);
    const targets: U[] = [];
    for (let i = 0; i < 4; i++) targets.push(await join(`dm-t${i}@example.com`, `T${i}`, `dm_t${i}`, 10 + i));
    for (let i = 0; i < 3; i++) expect((await start(N, targets[i]!)).status).toBe(201);
    const r4 = await start(N, targets[3]!);
    expect(r4.status).toBe(429);
    expect(r4.headers.get('retry-after')).toBeTruthy();
    // 新账号与互关好友聊天：每分钟 10 条
    await follow(N, A);
    await follow(A, N);
    const id = (await J(await start(N, A))).conversation.id;
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await send(N, id, `刷 ${i}`)).status;
    expect(last).toBe(429);
    // 删除会话（仅自己）：从我的列表消失、旧消息不再显示；对方仍保留
    expect((await del(`/api/social/dm/conversations/${id}`, A.token)).status).toBe(200);
    expect((await J(await get('/api/social/dm/conversations', A.token))).items.some((x: any) => x.id === id)).toBe(false);
    expect((await J(await get(`/api/social/dm/conversations/${id}/messages`, A.token))).items).toEqual([]);
    expect((await J(await get(`/api/social/dm/conversations/${id}/messages`, N.token))).items.length).toBeGreaterThan(5);
  });

  it('在线状态：尊重隐私开关和拉黑，只对会话对象 / 互关可见', async () => {
    await call(env, '/api/presence', { method: 'POST', token: B.token, body: { sid: 'sid-dm-bo', page: '私信' } });
    expect((await J(await get('/api/social/dm/presence?u=dm_bo,dm_cy,nobody_here', A.token))).presence).toEqual({ dm_bo: true, dm_cy: false, nobody_here: null });
    // D 与 B 没有会话也不互关：看不到
    expect((await J(await get('/api/social/dm/presence?u=dm_bo', D.token))).presence.dm_bo).toBeNull();
    // DO 在线（有 WebSocket 连接）也算在线
    onlineKeys.add(`u:${C.id}`);
    expect((await J(await get('/api/social/dm/presence?u=dm_cy', A.token))).presence.dm_cy).toBe(true);
    await put('/api/social/dm/settings', B.token, { showPresence: false });
    expect((await J(await get('/api/social/dm/presence?u=dm_bo', A.token))).presence.dm_bo).toBeNull();
    // 「谁在看」里显示为访客
    const v = await J(await call(env, '/api/presence', { method: 'POST', token: B.token, body: { sid: 'sid-dm-bo', page: '私信' } }));
    expect(v.viewers.find((x: any) => x.sid === 'sid-dm-bo')).toMatchObject({ name: '访客', member: false });
    await put('/api/social/dm/settings', B.token, { showPresence: true });
  });

  it('WebSocket：票据签发 / 校验 / 过期；没有 Upgrade 头 426；没有绑定时降级为轮询', async () => {
    const t = await J(await post('/api/social/dm/ticket', A.token));
    expect(t).toMatchObject({ realtime: true, path: '/api/social/dm/ws', ttl: 60 });
    expect(await verifyTicket(env, t.ticket, 'u')).toBe(A.id);
    expect(await verifyTicket(env, t.ticket, 'r:1')).toBeNull();
    expect(await verifyTicket(env, t.ticket.slice(0, -2) + '00', 'u')).toBeNull();
    const old = await signTicket(env, A.id, 'u', Math.floor(Date.now() / 1000) - 120);
    expect(await verifyTicket(env, old, 'u')).toBeNull();
    expect((await get(`/api/social/dm/ws?ticket=${t.ticket}`)).status).toBe(426);
    const ws = await call(env, `/api/social/dm/ws?ticket=bad.sig`, { headers: { upgrade: 'websocket' } });
    expect(ws.status).toBe(401);
    const noHub = { ...env, DM_HUB: undefined } as Env;
    const r = await call(noHub, '/api/social/dm/ticket', { method: 'POST', token: A.token, body: {} });
    expect(await J(r)).toMatchObject({ realtime: false });
    expect((await call(noHub, `/api/social/dm/ws?ticket=${t.ticket}`, { headers: { upgrade: 'websocket' } })).status).toBe(503);
  });

  it('活动聊天室：后台开启、发言实时广播、拉黑过滤、管理员移除、临时房间过期、关闭', async () => {
    const iso = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
    expect((await adm('/api/admin/discovery/events', { slug: 'dm-room-ev', kind: 'open', title: '夜景征集', intro: '拍夜景', rules: '原创', startsAt: iso(-1), endsAt: iso(48) })).status).toBe(201);
    expect((await get('/api/social/rooms/dm-room-ev', A.token)).status).toBe(404);
    expect((await adm('/api/admin/rooms/dm-room-ev', { retention: 'ephemeral', ttlHours: 2, moderators: ['dm_di'] }, 'PUT')).status).toBe(200);
    const room = await J(await get('/api/social/rooms/dm-room-ev', D.token));
    expect(room.room).toMatchObject({ retention: 'ephemeral', ttlHours: 2, closed: false, moderator: true });
    expect((await get('/api/social/rooms/dm-room-ev')).status).toBe(401);
    pushed.length = 0;
    const m1 = (await J(await post('/api/social/rooms/dm-room-ev/messages', A.token, { body: '大家好' }))).message;
    expect(pushed[0]).toMatchObject({ key: `r:${room.room.id}`, events: [{ t: 'msg', message: { body: '大家好' } }] });
    const m2 = (await J(await post('/api/social/rooms/dm-room-ev/messages', B.token, { body: '广告广告' }))).message;
    // A 拉黑 B → A 看不到 B 的发言
    await post('/api/social/blocks/dm_bo', A.token);
    expect((await J(await get('/api/social/rooms/dm-room-ev', A.token))).items.map((x: any) => x.id)).toEqual([m1.id]);
    await del('/api/social/blocks/dm_bo', A.token);
    // 普通成员不能删别人的；管理员（D）可以
    expect((await del(`/api/social/rooms/dm-room-ev/messages/${m2.id}`, C.token)).status).toBe(403);
    expect((await del(`/api/social/rooms/dm-room-ev/messages/${m2.id}`, D.token)).status).toBe(200);
    expect((await J(await get('/api/social/rooms/dm-room-ev', C.token))).items.map((x: any) => x.id)).toEqual([m1.id]);
    // 举报聊天室消息 → 同一审核队列
    expect((await post(`/api/social/dm/messages/${m1.id}/report`, B.token, { reason: 'spam' })).status).toBe(201);
    // 临时房间：超过 2 小时的消息不再显示
    await env.DB.prepare('UPDATE messages SET created_at = ? WHERE id = ?').bind(new Date(Date.now() - 3 * 3600_000).toISOString(), m1.id).run();
    expect((await J(await get('/api/social/rooms/dm-room-ev', C.token))).items).toEqual([]);
    // 关闭后不能发言
    await adm('/api/admin/rooms/dm-room-ev', { retention: 'retained', closed: true }, 'PUT');
    expect((await J(await post('/api/social/rooms/dm-room-ev/messages', A.token, { body: '还能说话吗' }))).error.code).toBe('room_closed');
    const t = await J(await post('/api/social/dm/ticket', A.token, { room: 'dm-room-ev' }));
    expect(t.path).toBe('/api/social/rooms/dm-room-ev/ws');
    expect(await verifyTicket(env, t.ticket, `r:${room.room.id}`)).toBe(A.id);
  });

  it('导出只含自己发送的消息；注销删除自己的私信数据', async () => {
    const G = await join('dm-g@example.com', 'Gi', 'dm_gi', 20);
    await follow(G, A);
    await follow(A, G);
    const id = (await J(await start(G, A))).conversation.id;
    await send(G, id, 'G 的消息');
    await send(A, id, 'A 的回复');
    const ex = await J(await get('/api/social/me/export', G.token));
    expect(ex.directMessages.map((m: any) => m.body)).toEqual(['G 的消息']);
    expect(ex.dmSettings.policy).toBe('everyone');
    expect((await post('/api/social/me/delete', G.token, { confirm: 'dm_gi' })).status).toBe(200);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').bind(id).first<{ n: number }>())!.n).toBe(0);
    expect((await J(await get('/api/social/dm/conversations', A.token))).items.some((x: any) => x.id === id)).toBe(false);
  });
});
