import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { DemoBackend, memoryKV, type KV } from '../src/demo/mock-api';
import { DEMO_OTP, DEMO_PASSWORD } from '../src/demo/seed';
import { STARTER_TOPICS } from '../src/discovery-core';

let kv: KV;
let api: DemoBackend;
let clock = Date.parse('2026-10-11T08:00:00.000Z');
const now = () => new Date(clock);
beforeEach(() => {
  kv = memoryKV();
  clock = Date.parse('2026-10-11T08:00:00.000Z');
  api = new DemoBackend({ storage: kv, base: '/TheBLOG/', now });
});
async function join(email: string, name: string, username: string): Promise<string> {
  expect((await api.handle('POST', '/api/members/register', { name, email })).status).toBe(200);
  const t = ((await api.handle('POST', '/api/members/verify', { email, code: DEMO_OTP })).body as { token: string }).token;
  expect((await api.handle('PUT', '/api/social/me', { username }, as(t))).status).toBe(200);
  return t;
}
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const B = (r: { body: unknown }) => r.body as any;
async function adminHeaders() {
  const r = await api.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD });
  return { 'x-csrf-token': (r.body as { csrfToken: string }).csrfToken };
}
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const photo = (o: Record<string, unknown> = {}) => ({ type: 'photo', title: '窗外', caption: '雨', media: [{ url: IMG, alt: '雨中的窗外', width: 1, height: 1 }], visibility: 'public', ...o });

describe('L17 discovery-core 共享', () => {
  it('web 与 worker 的 discovery-core.ts 内容一致；起步话题与迁移 0014 一致', () => {
    const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
    expect(read('../src/discovery-core.ts')).toBe(read('../../worker/src/discovery-core.ts'));
    const sql = read('../../worker/migrations/0014_discovery.sql');
    for (const t of STARTER_TOPICS) expect(sql).toContain(`('${t.slug}', '${t.name}'`);
  });
});

describe('演示 mock：L17 发现与活跃（与 Worker 同规则）', () => {
  it('游客：首页入口指向的发现页不依赖关注 —— 话题、最新作品、精选创作者、进行中的活动', async () => {
    const d = B(await api.handle('GET', '/api/social/discover'));
    expect(d.topics.map((t: any) => t.name)).toEqual(['摄影', '编程', '硬件', '建模', '设计', '日常']);
    expect(d.newest.length).toBeGreaterThanOrEqual(4);
    expect(d.newest.every((w: any) => w.visibility === 'public')).toBe(true);
    expect(d.featuredCreators[0]).toMatchObject({ username: 'xiaolin', verified: '示例创作者' });
    expect(d.events.map((e: any) => e.slug)).toEqual(expect.arrayContaining(['daily-sky', 'weekly-water']));
    const t = B(await api.handle('GET', '/api/social/topics/photography'));
    expect(t.featured.length).toBeGreaterThan(0);
    expect(t.posts.length).toBeGreaterThan(0); // 站长文章按标签映射
    for (const sort of ['latest', 'hot', 'featured']) expect(B(await api.handle('GET', `/api/social/topics/photography/works?sort=${sort}`)).works.length).toBeGreaterThan(0);
    expect((await api.handle('GET', '/api/social/topics/nope-x')).status).toBe(404);
  });
  it('订阅话题后，「关注」流出现话题作品（没关注任何人）；新作品通知每话题每天一条', async () => {
    const a = await join('a17@example.com', '阿一', 'ayi_17');
    const b = await join('b17@example.com', '阿二', 'aer_17');
    expect(B(await api.handle('GET', '/api/social/works?tab=following', undefined, as(b))).works.length).toBe(0);
    expect(B(await api.handle('POST', '/api/social/topics/photography/subscribe', {}, as(b))).subscribed).toBe(true);
    const feed = B(await api.handle('GET', '/api/social/works?tab=following', undefined, as(b)));
    expect(feed.works.length).toBeGreaterThan(0);
    expect(feed.works.every((w: any) => w.topics.some((t: any) => t.slug === 'photography'))).toBe(true);
    const ah = await adminHeaders();
    await api.handle('PUT', '/api/admin/ugc/rules', { reviewFirstN: 0 }, ah);
    expect((await api.handle('POST', '/api/social/works', photo({ topics: ['photography', 'x-none'] }), as(a))).status).toBe(400);
    const r = await api.handle('POST', '/api/social/works', photo({ topics: ['photography'] }), as(a));
    expect(r.status).toBe(201);
    expect(B(r).work.topics).toEqual([{ slug: 'photography', name: '摄影' }]);
    clock += 1000;
    await api.handle('POST', '/api/social/works', photo({ title: '窗外 2', topics: ['photography'] }), as(a));
    const n = B(await api.handle('GET', '/api/social/notifications?filter=topic_work', undefined, as(b))).notifications;
    expect(n.length).toBe(1);
    expect(n[0].objectRef).toBe('photography');
  });
  it('活动：投稿 / 修改 / 撤回；投票每人一票、不能投自己；结束前隐藏票数', async () => {
    const a = await join('c17@example.com', '阿三', 'asan_17');
    const b = await join('d17@example.com', '阿四', 'asi_17');
    const ah = await adminHeaders();
    await api.handle('PUT', '/api/admin/ugc/rules', { reviewFirstN: 0 }, ah);
    const w = B(await api.handle('POST', '/api/social/works', photo(), as(a))).work.id;
    const short = B(await api.handle('POST', '/api/social/works', { type: 'short', body: '你好' }, as(a))).work.id;
    expect((await api.handle('POST', '/api/social/events/weekly-water/entries', { workId: short }, as(a))).status).toBe(400);
    const e = await api.handle('POST', '/api/social/events/weekly-water/entries', { workId: w, note: '雨天的窗' }, as(a));
    expect(e.status).toBe(201);
    const id = B(e).entry.id;
    expect((await api.handle('POST', '/api/social/events/weekly-water/entries', { workId: w }, as(a))).status).toBe(409);
    expect((await api.handle('PATCH', `/api/social/events/entries/${id}`, { note: '改说明' }, as(a))).status).toBe(200);
    expect((await api.handle('PATCH', `/api/social/events/entries/${id}`, { note: 'x' }, as(b))).status).toBe(403);
    expect((await api.handle('POST', '/api/social/events/weekly-water/votes', { entryId: id }, as(a))).status).toBe(403);
    expect((await api.handle('POST', '/api/social/events/weekly-water/votes', { entryId: id }, as(b))).status).toBe(201);
    expect((await api.handle('POST', '/api/social/events/weekly-water/votes', { entryId: id }, as(b))).status).toBe(409);
    const page = B(await api.handle('GET', '/api/social/events/weekly-water', undefined, as(b)));
    expect(page.me.vote).toBe(id);
    expect(page.entries.every((x: any) => x.votes === null)).toBe(true);
    expect(page.entries.find((x: any) => x.id === id).note).toBe('改说明');
    expect((await api.handle('DELETE', `/api/social/events/entries/${id}`, undefined, as(a))).status).toBe(200);
    expect(B(await api.handle('GET', '/api/social/events/weekly-water', undefined, as(b))).me.vote).toBeNull(); // 撤回 → 票作废
    expect(B(await api.handle('GET', '/api/social/users/asan_17/badges')).community.map((x: any) => x.code)).toEqual(['first_work']);
    // 已结束的示例活动：精选可见；不能再投稿
    const ended = B(await api.handle('GET', '/api/social/events/autumn-call'));
    expect(ended.event.phase).toBe('ended');
    expect(ended.entries[0].picked).toBe(true);
    expect((await api.handle('POST', '/api/social/events/autumn-call/entries', { workId: w }, as(a))).status).toBe(409);
  });
  it('合集：私密只有自己能看；公开游客可见；重复条目 409；收录站长文章', async () => {
    const a = await join('e17@example.com', '阿五', 'awu_17');
    const priv = B(await api.handle('POST', '/api/social/collections', { title: '私藏' }, as(a))).collection;
    expect(priv.visibility).toBe('private');
    expect((await api.handle('POST', '/api/social/collections', { title: '私藏' }, as(a))).status).toBe(409);
    expect((await api.handle('POST', `/api/social/collections/${priv.id}/items`, { kind: 'work', ref: 2 }, as(a))).status).toBe(201);
    expect((await api.handle('POST', `/api/social/collections/${priv.id}/items`, { kind: 'work', ref: 2 }, as(a))).status).toBe(409);
    expect((await api.handle('GET', `/api/social/collections/${priv.id}`)).status).toBe(404);
    const pub = B(await api.handle('POST', '/api/social/collections', { title: '夜景', visibility: 'public' }, as(a))).collection;
    expect((await api.handle('POST', `/api/social/collections/${pub.id}/items`, { kind: 'post', ref: 'phone-night-photography' }, as(a))).status).toBe(201);
    const g = B(await api.handle('GET', `/api/social/collections/${pub.id}`));
    expect(g.items[0].title.length).toBeGreaterThan(0);
    expect(g.canEdit).toBe(false);
    expect(B(await api.handle('GET', '/api/social/users/awu_17/collections')).collections.map((c: any) => c.title)).toEqual(['夜景']);
    const ex = B(await api.handle('GET', '/api/social/me/export', undefined, as(a)));
    expect(ex.collections.length).toBe(2);
  });
  it('后台：创建活动 / 公布结果（结束后）；通知参与者', async () => {
    const ah = await adminHeaders();
    const r = await api.handle('POST', '/api/admin/discovery/events', { slug: 'night-call', kind: 'open', title: '夜景征集', startsAt: '2026-10-11T00:00:00Z', endsAt: '2026-10-20T00:00:00Z' }, ah);
    expect(r.status).toBe(201);
    expect((await api.handle('POST', '/api/admin/discovery/events/night-call/results', {}, ah)).status).toBe(409);
    expect(B(await api.handle('GET', '/api/admin/discovery/topics', undefined, ah)).topics.find((t: any) => t.slug === 'daily').tags).toContain('随笔');
  });
});
