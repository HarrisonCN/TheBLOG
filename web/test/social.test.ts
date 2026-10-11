import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { DB_KEY, DemoBackend, memoryKV, type KV } from '../src/demo/mock-api';
import { DEMO_OTP } from '../src/demo/seed';

let kv: KV;
let api: DemoBackend;
let clock = Date.parse('2026-10-11T08:00:00.000Z');
const now = () => new Date(clock);

beforeEach(() => {
  kv = memoryKV();
  api = new DemoBackend({ storage: kv, base: '/TheBLOG/', now });
});

async function join(email: string, name: string): Promise<string> {
  expect((await api.handle('POST', '/api/members/register', { name, email })).status).toBe(200);
  const v = await api.handle('POST', '/api/members/verify', { email, code: DEMO_OTP });
  return (v.body as { token: string }).token;
}
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const B = (r: { body: unknown }) => r.body as any;

describe('L15 social-core 共享', () => {
  it('web 与 worker 的 social-core.ts 内容一致', () => {
    const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
    expect(read('../src/social-core.ts')).toBe(read('../../worker/src/social-core.ts'));
  });
});

describe('演示 mock：L15 社交（与 Worker 同规则）', () => {
  it('种子用户可搜索；两位新会员互相找到并关注；通知 + 已读', async () => {
    expect(B(await api.handle('GET', '/api/social/search?q=momo')).users[0].username).toBe('momo');
    const a = await join('a@demo.test', 'Alice');
    const b = await join('b@demo.test', 'Bob');
    expect((await api.handle('PUT', '/api/social/me', { username: 'alice_l15' }, as(a))).status).toBe(200);
    expect((await api.handle('PUT', '/api/social/me', { username: 'ALICE_L15' }, as(b))).status).toBe(409);
    expect((await api.handle('PUT', '/api/social/me', { username: 'bob_l15', bio: '拍楼' }, as(b))).status).toBe(200);
    expect(B(await api.handle('GET', '/api/social/search?q=bob_', {}, as(a))).users[0].username).toBe('bob_l15');
    await api.handle('POST', '/api/social/follows/bob_l15', undefined, as(a));
    await api.handle('POST', '/api/social/follows/bob_l15', undefined, as(a));
    await api.handle('POST', '/api/social/follows/alice_l15', undefined, as(b));
    const p = B(await api.handle('GET', '/api/social/users/bob_l15', undefined, as(a)));
    expect(p.viewer).toMatchObject({ following: true, followedBy: true });
    expect(p.profile.counts.followers).toBe(1);
    expect(JSON.stringify(p)).not.toContain('@demo.test');
    const n = B(await api.handle('GET', '/api/social/notifications', undefined, as(b)));
    expect(n.unread).toBe(1);
    expect(n.notifications[0]).toMatchObject({ type: 'follow', read: false, actor: { username: 'alice_l15' } });
    // A 不能标记 / 读取 B 的通知
    await api.handle('POST', '/api/social/notifications/read', { ids: [n.notifications[0].id] }, as(a));
    expect(B(await api.handle('GET', '/api/social/notifications/unread', undefined, as(b))).unread).toBe(1);
    expect(B(await api.handle('POST', '/api/social/notifications/read', { all: true }, as(b))).unread).toBe(0);
    expect((await api.handle('GET', '/api/social/notifications')).status).toBe(401);
  });

  it('拉黑：对方看不到我、不能关注；静音；隐私', async () => {
    const a = await join('a@demo.test', 'Alice');
    const c = await join('c@demo.test', 'Carol');
    await api.handle('PUT', '/api/social/me', { username: 'alice_x' }, as(a));
    await api.handle('PUT', '/api/social/me', { username: 'carol_x' }, as(c));
    await api.handle('POST', '/api/social/blocks/alice_x', undefined, as(c));
    expect((await api.handle('GET', '/api/social/users/carol_x', undefined, as(a))).status).toBe(404);
    expect((await api.handle('POST', '/api/social/follows/carol_x', undefined, as(a))).status).toBe(404);
    expect(B(await api.handle('GET', '/api/social/users/alice_x', undefined, as(c))).restricted).toBe('blocked');
    await api.handle('DELETE', '/api/social/blocks/alice_x', undefined, as(c));
    await api.handle('PUT', '/api/social/me', { visibility: 'members' }, as(c));
    expect(B(await api.handle('GET', '/api/social/users/carol_x')).restricted).toBe('members');
    expect(B(await api.handle('GET', '/api/social/users/carol_x', undefined, as(a))).restricted).toBe(null);
    await api.handle('POST', '/api/social/mutes/alice_x', undefined, as(c));
    await api.handle('POST', '/api/social/follows/carol_x', undefined, as(a));
    expect(B(await api.handle('GET', '/api/social/notifications', undefined, as(c))).notifications.length).toBe(0);
  });

  it('云端收藏：合并去重；另一台"设备"（同一服务端数据、新登录）读到', async () => {
    const a = await join('a@demo.test', 'Alice');
    expect((await api.handle('POST', '/api/social/bookmarks', { kind: 'post', ref: 'welcome', title: 'Hi' }, as(a))).status).toBe(201);
    const m = B(await api.handle('POST', '/api/social/bookmarks/merge', { items: [{ ref: 'welcome' }, { ref: 'phone-night-photography' }, { ref: 'x y' }] }, as(a)));
    expect(m).toEqual({ added: 1, skipped: 1, rejected: 1 });
    // 第二台设备：只共享"服务端"数据（DB），没有本机会话
    const kv2 = memoryKV();
    kv2.setItem(DB_KEY, kv.getItem(DB_KEY)!);
    const api2 = new DemoBackend({ storage: kv2, base: '/TheBLOG/', now });
    await api2.handle('POST', '/api/members/register', { name: 'Alice', email: 'a@demo.test' });
    const t2 = B(await api2.handle('POST', '/api/members/verify', { email: 'a@demo.test', code: DEMO_OTP })).token;
    const list = B(await api2.handle('GET', '/api/social/bookmarks', undefined, as(t2)));
    expect(list.bookmarks.map((x: any) => x.ref).sort()).toEqual(['phone-night-photography', 'welcome']);
  });

  it('评论回复 → 通知聚合；导出 / 注销', async () => {
    const a = await join('a@demo.test', 'Alice');
    const b = await join('b@demo.test', 'Bob');
    await api.handle('PUT', '/api/social/me', { username: 'alice_r' }, as(a));
    const top = B(await api.handle('POST', '/api/posts/welcome/comments', { name: 'x', content: '顶楼' }, as(a)));
    clock += 1000;
    await api.handle('POST', '/api/posts/welcome/comments', { name: 'x', content: '回复 @alice_r', parentId: top.comment.id }, as(b));
    const n = B(await api.handle('GET', '/api/social/notifications', undefined, as(a)));
    expect(n.notifications.map((x: any) => x.type).sort()).toEqual(['mention', 'reply']);
    const ex = B(await api.handle('GET', '/api/social/me/export', undefined, as(a)));
    expect(ex.account.email).toBe('a@demo.test');
    expect((await api.handle('POST', '/api/social/me/delete', { confirm: 'wrong' }, as(a))).status).toBe(400);
    expect((await api.handle('POST', '/api/social/me/delete', { confirm: 'alice_r' }, as(a))).status).toBe(200);
    expect((await api.handle('GET', '/api/social/users/alice_r')).status).toBe(404);
  });
});
