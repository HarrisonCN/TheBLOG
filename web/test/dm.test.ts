import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoBackend, memoryKV, type KV } from '../src/demo/mock-api';
import { DEMO_OTP, DEMO_PASSWORD } from '../src/demo/seed';
import type { DmEvent } from '../src/dm-core';

let kv: KV;
let api: DemoBackend;
let clock = Date.parse('2026-10-11T08:00:00.000Z');
const now = () => new Date(clock);
let events: { to: number[]; ev: DmEvent }[] = [];
beforeEach(() => {
  kv = memoryKV();
  clock = Date.parse('2026-10-11T08:00:00.000Z');
  api = new DemoBackend({ storage: kv, base: '/TheBLOG/', now });
  events = [];
  api.onDmEvent((to, ev) => events.push({ to, ev }));
});
afterEach(() => vi.useRealTimers());
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const B = (r: { body: unknown }) => r.body as any;
type U = { token: string; id: number; username: string };
async function join(email: string, name: string, username: string): Promise<U> {
  expect((await api.handle('POST', '/api/members/register', { name, email })).status).toBe(200);
  const r = B(await api.handle('POST', '/api/members/verify', { email, code: DEMO_OTP }));
  expect((await api.handle('PUT', '/api/social/me', { username }, as(r.token))).status).toBe(200);
  return { token: r.token, id: r.member.id, username };
}
/** 演示里新注册的账号都是「新账号」：把注册时间挪到 10 天前，避免触发新账号限额 */
function age(u: U) {
  const db = JSON.parse(kv.getItem('blog-demo:db:v2')!);
  db.members.find((m: any) => m.id === u.id).joinedAt = new Date(clock - 10 * 86400_000).toISOString();
  kv.setItem('blog-demo:db:v2', JSON.stringify(db));
  api.invalidate();
}
const get = (p: string, u?: U) => api.handle('GET', p, undefined, u ? as(u.token) : {});
const post = (p: string, u: U, body: unknown = {}) => api.handle('POST', p, body, as(u.token));
const put = (p: string, u: U, body: unknown) => api.handle('PUT', p, body, as(u.token));
const del = (p: string, u: U) => api.handle('DELETE', p, undefined, as(u.token));
const follow = (a: U, b: U) => post(`/api/social/follows/${b.username}`, a);

describe('L19 dm-core 共享', () => {
  it('web 与 worker 的 dm-core.ts 内容一致；迁移 0016 只做加法', () => {
    const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
    expect(read('../src/dm-core.ts')).toBe(read('../../worker/src/dm-core.ts'));
    const sql = read('../../worker/migrations/0016_dm.sql').replace(/--.*$/gm, '');
    expect(sql).not.toMatch(/^\s*(DROP|UPDATE|DELETE)\b|ALTER TABLE \w+ (DROP|RENAME)/im);
    expect(sql).toMatch(/ALTER TABLE presence ADD COLUMN member_id INTEGER/);
  });
});

describe('演示 mock：L19 私信（与 Worker 同规则）', () => {
  it('首次打开收到示例消息请求（虚构 Momo）；接受后可以聊天', async () => {
    const A = await join('a@example.com', 'Ada', 'ada_demo');
    const inbox = B(await get('/api/social/dm/conversations', A));
    expect(inbox.items).toEqual([]);
    expect(inbox.unread.requests).toBe(1);
    const reqs = B(await get('/api/social/dm/conversations?box=requests', A));
    expect(reqs.items).toMatchObject([{ status: 'request', peer: { username: 'momo' }, unread: 1 }]);
    const id = reqs.items[0].id;
    expect(B(await post(`/api/social/dm/conversations/${id}/messages`, A, { body: '你好' })).error.code).toBe('request_pending');
    expect(B(await post(`/api/social/dm/conversations/${id}/accept`, A)).status).toBe('active');
    expect((await post(`/api/social/dm/conversations/${id}/messages`, A, { body: '你好 Momo' })).status).toBe(201);
  });

  it('互关直接会话；事件发给双方（演示实时）；clientId 去重；非参与者 404', async () => {
    const A = await join('a@example.com', 'Ada', 'ada_demo');
    const C = await join('c@example.com', 'Cy', 'cy_demo');
    const D = await join('d@example.com', 'Di', 'di_demo');
    await follow(A, C);
    await follow(C, A);
    const r = await post('/api/social/dm/conversations', A, { username: 'cy_demo' });
    expect(r.status).toBe(201);
    const id = B(r).conversation.id;
    expect(B(r).conversation.status).toBe('active');
    events = [];
    const s = B(await post(`/api/social/dm/conversations/${id}/messages`, A, { body: '实时？', clientId: 'cid-demo-1' }));
    const msgEvents = events.filter((e) => e.ev.t === 'msg');
    expect(msgEvents.map((e) => e.to[0]).sort()).toEqual([A.id, C.id].sort());
    expect((msgEvents.find((e) => e.to[0] === C.id)!.ev as any).message).toMatchObject({ body: '实时？', mine: false });
    const dup = await post(`/api/social/dm/conversations/${id}/messages`, A, { body: '实时？', clientId: 'cid-demo-1' });
    expect(dup.status).toBe(200);
    expect(B(dup).message.id).toBe(s.message.id);
    expect((await get(`/api/social/dm/conversations/${id}/messages`, D)).status).toBe(404);
    expect((await post(`/api/social/dm/conversations/${id}/messages`, D, { body: 'x' })).status).toBe(404);
    expect((await get(`/api/social/dm/conversations/${id}/messages`)).status).toBe(401);
  });

  it('历史分页、未读、已读回执（可关闭）、离线同步、撤回、仅自己删除', async () => {
    const A = await join('a@example.com', 'Ada', 'ada_demo');
    const C = await join('c@example.com', 'Cy', 'cy_demo');
    age(A);
    age(C);
    await follow(A, C);
    await follow(C, A);
    const id = B(await post('/api/social/dm/conversations', A, { username: 'cy_demo' })).conversation.id;
    const since = B(await get('/api/social/dm/sync', C)).seq;
    for (let i = 1; i <= 5; i++) await post(`/api/social/dm/conversations/${id}/messages`, A, { body: `第 ${i} 条` });
    expect(B(await get('/api/social/dm/unread', C)).total).toBe(5);
    const p1 = B(await get(`/api/social/dm/conversations/${id}/messages?limit=2`, C));
    expect(p1.items.map((m: any) => m.body)).toEqual(['第 4 条', '第 5 条']);
    const p2 = B(await get(`/api/social/dm/conversations/${id}/messages?limit=2&before=${p1.nextBefore}`, C));
    expect(p2.items.map((m: any) => m.body)).toEqual(['第 2 条', '第 3 条']);
    const sync = B(await get(`/api/social/dm/sync?since=${since}`, C));
    expect(sync.events.filter((e: any) => e.t === 'msg').length).toBe(5);
    events = [];
    await post(`/api/social/dm/conversations/${id}/read`, C, {});
    expect(B(await get('/api/social/dm/unread', C)).total).toBe(0);
    expect(events.some((e) => e.ev.t === 'read' && e.to[0] === A.id)).toBe(true);
    await put('/api/social/dm/settings', C, { readReceipts: false });
    expect(B(await get(`/api/social/dm/conversations/${id}`, A)).conversation.peerLastReadId).toBeNull();
    const last = p1.items[1];
    expect(B(await post(`/api/social/dm/messages/${last.id}/recall`, C)).error.code).toBe('forbidden');
    clock += 11 * 60_000;
    expect(B(await post(`/api/social/dm/messages/${last.id}/recall`, A)).error.code).toBe('recall_expired');
    const fresh = B(await post(`/api/social/dm/conversations/${id}/messages`, A, { body: '马上撤回' })).message;
    expect(B(await post(`/api/social/dm/messages/${fresh.id}/recall`, A)).recalled).toBe(true);
    const forC = B(await get(`/api/social/dm/conversations/${id}/messages?limit=50`, C));
    expect(forC.items.find((m: any) => m.id === fresh.id)).toMatchObject({ recalled: true, body: '' });
    expect((await del(`/api/social/dm/messages/${last.id}`, C)).status).toBe(200);
    expect(B(await get(`/api/social/dm/conversations/${id}/messages?limit=50`, C)).items.some((m: any) => m.id === last.id)).toBe(false);
    expect(B(await get(`/api/social/dm/conversations/${id}/messages?limit=50`, A)).items.some((m: any) => m.id === last.id)).toBe(true);
  });

  it('请求：最多 3 条、婉拒冷却、隐私开关、拉黑、举报进审核队列、新账号限额', async () => {
    const A = await join('a@example.com', 'Ada', 'ada_demo');
    const C = await join('c@example.com', 'Cy', 'cy_demo');
    const E = await join('e@example.com', 'Ed', 'ed_demo');
    age(C);
    const id = B(await post('/api/social/dm/conversations', C, { username: 'ada_demo' })).conversation.id;
    for (let i = 0; i < 3; i++) expect((await post(`/api/social/dm/conversations/${id}/messages`, C, { body: `请求 ${i}` })).status).toBe(201);
    expect(B(await post(`/api/social/dm/conversations/${id}/messages`, C, { body: '第四条' })).error.code).toBe('request_pending_limit');
    expect(B(await post(`/api/social/dm/conversations/${id}/decline`, A)).status).toBe('declined');
    expect(B(await post('/api/social/dm/conversations', C, { username: 'ada_demo' })).error.code).toBe('request_cooldown');
    await put('/api/social/dm/settings', E, { policy: 'mutuals' });
    expect(B(await post('/api/social/dm/conversations', C, { username: 'ed_demo' })).error.code).toBe('dm_mutuals_only');
    await put('/api/social/dm/settings', E, { policy: 'nobody' });
    expect(B(await post('/api/social/dm/conversations', C, { username: 'ed_demo' })).error.code).toBe('dm_closed');
    // 拉黑
    await post('/api/social/blocks/cy_demo', E);
    await put('/api/social/dm/settings', E, { policy: 'everyone' });
    expect(B(await post('/api/social/dm/conversations', C, { username: 'ed_demo' })).error.code).toBe('not_found');
    // 举报
    await post('/api/social/blocks/cy_demo', E).then(() => api.handle('DELETE', '/api/social/blocks/cy_demo', undefined, as(E.token)));
    const id2 = B(await post('/api/social/dm/conversations', C, { username: 'ed_demo' })).conversation.id;
    const mm = B(await post(`/api/social/dm/conversations/${id2}/messages`, C, { body: '垃圾广告' })).message;
    expect((await post(`/api/social/dm/messages/${mm.id}/report`, E, { reason: 'spam' })).status).toBe(201);
    const login = B(await api.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD }));
    const q = B(await api.handle('GET', '/api/admin/ugc/queue?view=reports', undefined, { 'x-csrf-token': login.csrfToken }));
    expect(q.items.some((x: any) => x.kind === 'user' && x.id === C.id && x.reports.some((r: any) => r.detail.startsWith(`[私信 #${mm.id}]`)))).toBe(true);
    // 新账号：每天 3 个请求
    const N = await join('n@example.com', 'Nu', 'nu_demo');
    const T = [await join('t1@example.com', 'T1', 't1_demo'), await join('t2@example.com', 'T2', 't2_demo'), await join('t3@example.com', 'T3', 't3_demo'), await join('t4@example.com', 'T4', 't4_demo')];
    for (let i = 0; i < 3; i++) expect((await post('/api/social/dm/conversations', N, { username: T[i]!.username })).status).toBe(201);
    expect((await post('/api/social/dm/conversations', N, { username: T[3]!.username })).status).toBe(429);
  });

  it('示例用户（虚构）自动接受并回复：演示实时到达', async () => {
    vi.useFakeTimers();
    const A = await join('a@example.com', 'Ada', 'ada_demo');
    const id = B(await post('/api/social/dm/conversations', A, { username: 'xiaolin' })).conversation.id;
    await post(`/api/social/dm/conversations/${id}/messages`, A, { body: '你好小林' });
    events = [];
    vi.advanceTimersByTime(2000);
    expect([...new Set(events.filter((e) => e.to.includes(A.id)).map((e) => e.ev.t))]).toEqual(['conv', 'read', 'msg']);
    const msgs = B(await get(`/api/social/dm/conversations/${id}/messages`, A)).items;
    expect(msgs.at(-1)).toMatchObject({ mine: false, sender: { username: 'xiaolin' } });
    expect(msgs.at(-1).body).toMatch(/^【演示】/);
    expect(B(await get('/api/social/dm/presence?u=xiaolin,momo', A)).presence).toEqual({ xiaolin: true, momo: null });
  });

  it('活动聊天室：种子房间、发言、管理员配置与移除、临时消息过期', async () => {
    const A = await join('a@example.com', 'Ada', 'ada_demo');
    age(A);
    const r = B(await get('/api/social/rooms/daily-sky', A));
    expect(r.room).toMatchObject({ retention: 'ephemeral', ttlHours: 24, closed: false });
    expect(r.items.length).toBe(2);
    const m = B(await post('/api/social/rooms/daily-sky/messages', A, { body: '我也拍到了' })).message;
    expect(B(await get('/api/social/rooms/daily-sky', A)).room.joined).toBe(true);
    const login = B(await api.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD }));
    const h = { 'x-csrf-token': login.csrfToken };
    expect((await api.handle('DELETE', `/api/admin/rooms/messages/${m.id}`, undefined, h)).status).toBe(200);
    expect(B(await get('/api/social/rooms/daily-sky', A)).items.some((x: any) => x.id === m.id)).toBe(false);
    expect((await api.handle('PUT', '/api/admin/rooms/daily-sky', { retention: 'retained', closed: true }, h)).status).toBe(200);
    expect(B(await post('/api/social/rooms/daily-sky/messages', A, { body: '还能说吗' })).error.code).toBe('room_closed');
    await api.handle('PUT', '/api/admin/rooms/daily-sky', { retention: 'ephemeral', ttlHours: 1 }, h);
    clock += 2 * 3600_000;
    expect(B(await get('/api/social/rooms/daily-sky', A)).items).toEqual([]);
    expect((await api.handle('PUT', '/api/admin/rooms/no-such-event', {}, h)).status).toBe(404);
    expect(B(await post('/api/social/dm/ticket', A)).realtime).toBe(false);
  });

  it('切换示例用户（仅演示）与导出 / 注销', async () => {
    expect(api.actAs(1).member.name).toBe('小林');
    expect(() => api.actAs(5)).toThrow();
    const A = await join('a@example.com', 'Ada', 'ada_demo');
    const C = await join('c@example.com', 'Cy', 'cy_demo');
    await follow(A, C);
    await follow(C, A);
    const id = B(await post('/api/social/dm/conversations', A, { username: 'cy_demo' })).conversation.id;
    await post(`/api/social/dm/conversations/${id}/messages`, A, { body: 'A 的话' });
    await post(`/api/social/dm/conversations/${id}/messages`, C, { body: 'C 的话' });
    expect(B(await get('/api/social/me/export', A)).directMessages.map((m: any) => m.body)).toEqual(['A 的话']);
    expect((await post('/api/social/me/delete', A, { confirm: 'ada_demo' })).status).toBe(200);
    expect(B(await get('/api/social/dm/conversations', C)).items.some((x: any) => x.id === id)).toBe(false);
  });
});
