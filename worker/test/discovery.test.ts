import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import { testOutbox } from '../src/community';
import type { Env } from '../src/env';
import { checkCollectionItem, checkEvent, checkTopic, checkWorkTopics, eventPhase, hotScore, talliesVisible, voteEligibility } from '../src/discovery-core';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({ EMAIL_PROVIDER: 'memory' });
  admin = await login(env, '10.17.0.1');
});
afterAll(disposeEnv);

const ip = (n: number) => ({ 'cf-connecting-ip': `10.17.1.${n}` });
const codeFor = (email: string) => /(\d{6})/.exec(testOutbox.filter((m) => m.to === email).at(-1)?.text ?? '')?.[1] ?? '';
type U = { token: string; id: number; username: string };
async function join(email: string, name: string, username: string, n: number): Promise<U> {
  expect((await call(env, '/api/members/register', { body: { name, email }, headers: ip(n) })).status).toBe(200);
  const b = (await (await call(env, '/api/members/verify', { body: { email, code: codeFor(email) } })).json()) as any;
  const r = await call(env, '/api/social/me', { method: 'PUT', token: b.token, body: { username } });
  expect(r.status).toBe(200);
  return { token: b.token, id: b.member.id, username };
}
const J = async (r: Response) => (await r.json()) as any;
const get = (path: string, token?: string) => call(env, path, { token });
const post = (path: string, token: string | undefined, body?: unknown) => call(env, path, { method: 'POST', token, body: body ?? {} });
const del = (path: string, token: string) => call(env, path, { method: 'DELETE', token });
const patch = (path: string, token: string, body: unknown) => call(env, path, { method: 'PATCH', token, body });
const adm = (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => call(env, path, { method, cookie: admin.cookie, csrf: admin.csrf, body });
const notes = async (u: U, filter = 'all') => (await J(await get(`/api/social/notifications?filter=${filter}`, u.token))).notifications as any[];
const IMG = (n: number) => ({ url: `https://upload.wikimedia.org/demo/${n}.jpg`, alt: `示例照片 ${n}`, width: 1600, height: 1067 });
const photo = (o: Record<string, unknown> = {}) => ({ type: 'photo', title: '江边', caption: '傍晚', notes: '手持', params: { camera: 'Phone', iso: '100' }, media: [IMG(1)], visibility: 'public', ...o });
const iso = (deltaH: number) => new Date(Date.now() + deltaH * 3_600_000).toISOString();

describe('discovery-core 纯函数', () => {
  it('话题 / 投稿话题校验', () => {
    expect(checkTopic({ slug: 'photography', name: '摄影' }).ok).toBe(true);
    expect(checkTopic({ slug: 'Photo Graphy', name: '摄影' }).ok).toBe(false);
    expect(checkTopic({ slug: 'x', name: '摄影' }).ok).toBe(false);
    expect(checkWorkTopics(undefined)).toEqual({ ok: true, value: undefined });
    expect(checkWorkTopics(['a1', 'a1', 'b2'])).toEqual({ ok: true, value: ['a1', 'b2'] });
    expect(checkWorkTopics(['a1', 'b2', 'c3', 'd4']).ok).toBe(false);
    expect(checkWorkTopics(['<x>']).ok).toBe(false);
  });
  it('热门分数：互动多的更高，时间越久越低', () => {
    const now = Date.parse('2026-10-11T12:00:00Z');
    const fresh = hotScore({ reactions: 2, comments: 1, bookmarks: 0, publishedAt: '2026-10-11T10:00:00Z' }, now);
    const old = hotScore({ reactions: 2, comments: 1, bookmarks: 0, publishedAt: '2026-10-01T10:00:00Z' }, now);
    const busy = hotScore({ reactions: 9, comments: 4, bookmarks: 3, publishedAt: '2026-10-11T10:00:00Z' }, now);
    expect(fresh).toBeGreaterThan(old);
    expect(busy).toBeGreaterThan(fresh);
  });
  it('活动：阶段 / 投稿期上限 / 票数可见性 / 投票资格', () => {
    const e = { startsAt: '2026-10-10T00:00:00Z', endsAt: '2026-10-12T00:00:00Z', voting: true, voteEndsAt: '2026-10-14T00:00:00Z' };
    expect(eventPhase(e, Date.parse('2026-10-09T00:00:00Z'))).toBe('upcoming');
    expect(eventPhase(e, Date.parse('2026-10-11T00:00:00Z'))).toBe('open');
    expect(eventPhase(e, Date.parse('2026-10-13T00:00:00Z'))).toBe('voting');
    expect(eventPhase(e, Date.parse('2026-10-15T00:00:00Z'))).toBe('ended');
    expect(eventPhase({ ...e, voting: false }, Date.parse('2026-10-13T00:00:00Z'))).toBe('ended');
    expect(checkEvent({ slug: 'd1', kind: 'daily', title: 'x', startsAt: e.startsAt, endsAt: '2026-10-15T00:00:00Z' }).ok).toBe(false);
    expect(checkEvent({ slug: 'w1', kind: 'weekly', title: 'x', startsAt: e.startsAt, endsAt: '2026-10-15T00:00:00Z' }).ok).toBe(true);
    expect(checkEvent({ slug: 'w1', kind: 'weekly', title: 'x', startsAt: e.startsAt, endsAt: e.startsAt }).ok).toBe(false);
    expect(talliesVisible({ voting: true, hideTallies: true }, 'open')).toBe(false);
    expect(talliesVisible({ voting: true, hideTallies: true }, 'ended')).toBe(true);
    expect(talliesVisible({ voting: true, hideTallies: false }, 'open')).toBe(true);
    expect(talliesVisible({ voting: false, hideTallies: false }, 'ended')).toBe(false);
    const base = { phase: 'open' as const, voting: true, voterId: 2, entryAuthorId: 1, joinedAt: '2026-09-01T00:00:00Z', minAccountDays: 7, banned: false, reputation: 0 };
    const now = Date.parse('2026-10-11T00:00:00Z');
    expect(voteEligibility(base, now)).toBeNull();
    expect(voteEligibility({ ...base, voterId: 1 }, now)).toMatch(/自己/);
    expect(voteEligibility({ ...base, joinedAt: '2026-10-10T00:00:00Z' }, now)).toMatch(/7 天/);
    expect(voteEligibility({ ...base, reputation: -1 }, now)).toMatch(/信誉/);
    expect(voteEligibility({ ...base, banned: true }, now)).toMatch(/限制/);
    expect(voteEligibility({ ...base, phase: 'ended' }, now)).toMatch(/结束/);
    expect(voteEligibility({ ...base, voting: false }, now)).toMatch(/没有开启/);
  });
  it('合集条目校验', () => {
    expect(checkCollectionItem({ kind: 'work', ref: 12 }).ok).toBe(true);
    expect(checkCollectionItem({ kind: 'work', ref: 'abc' }).ok).toBe(false);
    expect(checkCollectionItem({ kind: 'post', ref: 'hello-world' }).ok).toBe(true);
    expect(checkCollectionItem({ kind: 'post', ref: '../x' }).ok).toBe(false);
    expect(checkCollectionItem({ kind: 'note', ref: 'x' }).ok).toBe(false);
  });
});

let A: U, B: U, C: U;
let wPub = 0, wFol = 0, wShort = 0;
describe('L17 话题 / 订阅 / 发现', () => {
  it('三个会员；关闭新会员审核以便测试扇出', async () => {
    A = await join('a-l17@example.com', 'Ada', 'ada_l17', 1);
    B = await join('b-l17@example.com', 'Ben', 'ben_l17', 2);
    C = await join('c-l17@example.com', 'Cat', 'cat_l17', 3);
    expect((await adm('/api/admin/ugc/rules', { reviewFirstN: 0 }, 'PUT')).status).toBe(200);
  });
  it('起步话题：摄影 / 编程 / 硬件 / 建模 / 设计 / 日常（游客可见）', async () => {
    const b = await J(await get('/api/social/topics'));
    expect(b.topics.map((t: any) => t.name)).toEqual(['摄影', '编程', '硬件', '建模', '设计', '日常']);
    expect(b.topics[0].subscribed).toBe(false);
    expect((await get('/api/social/topics/nope-x')).status).toBe(404);
  });
  it('站长文章的旧标签映射进话题页（随笔 → 日常）', async () => {
    const b = await J(await get('/api/social/topics/daily'));
    expect(b.topic.slug).toBe('daily');
    expect(b.posts.length).toBeGreaterThan(0);
  });
  it('投稿选择话题：关联表；未知 / 超过 3 个 → 400', async () => {
    expect((await post('/api/social/works', A.token, photo({ topics: ['nope-x'] }))).status).toBe(400);
    expect((await post('/api/social/works', A.token, photo({ topics: ['photography', 'coding', 'design', 'daily'] }))).status).toBe(400);
    const r = await post('/api/social/works', A.token, photo({ topics: ['photography', 'daily'] }));
    expect(r.status).toBe(201);
    const b = await J(r);
    wPub = b.work.id;
    expect(b.status).toBe('published');
    expect(b.work.topics.map((t: any) => t.slug)).toEqual(['photography', 'daily']);
    wFol = (await J(await post('/api/social/works', A.token, photo({ title: '只给关注者', visibility: 'followers', topics: ['photography'] })))).work.id;
    wShort = (await J(await post('/api/social/works', A.token, { type: 'short', body: '今天的天空', topics: ['daily'] }))).work.id;
    // 编辑时修改话题
    const ed = await call(env, `/api/social/works/${wShort}`, { method: 'PUT', token: A.token, body: { type: 'short', body: '今天的天空很蓝', topics: ['daily', 'design'] } });
    expect((await J(ed)).work.topics.map((t: any) => t.slug)).toEqual(['design', 'daily']);
  });
  it('话题页：游客能看到公开作品（最新 / 热门），看不到仅关注者作品', async () => {
    const latest = await J(await get('/api/social/topics/photography/works?sort=latest'));
    expect(latest.works.map((w: any) => w.id)).toContain(wPub);
    expect(latest.works.map((w: any) => w.id)).not.toContain(wFol);
    const hot = await J(await get('/api/social/topics/photography/works?sort=hot'));
    expect(hot.works.map((w: any) => w.id)).toContain(wPub);
    expect((await get('/api/social/topics/photography/works?sort=random')).status).toBe(400);
    const t = await J(await get('/api/social/topics/photography'));
    expect(t.topic.counts.works).toBe(1);
  });
  it('精选：站长设置后出现在话题页「精选」', async () => {
    expect((await adm('/api/admin/discovery/topics/photography/featured', { workId: wShort })).status).toBe(404); // 不在这个话题
    expect((await adm('/api/admin/discovery/topics/photography/featured', { workId: wPub })).status).toBe(200);
    const t = await J(await get('/api/social/topics/photography'));
    expect(t.featured.map((w: any) => w.id)).toEqual([wPub]);
    const f = await J(await get('/api/social/topics/photography/works?sort=featured'));
    expect(f.works.map((w: any) => w.id)).toEqual([wPub]);
  });
  it('订阅话题：游客 401；B 没有关注 A 也能在「关注」流里看到话题作品', async () => {
    expect((await post('/api/social/topics/photography/subscribe', undefined)).status).toBe(401);
    const s = await J(await post('/api/social/topics/photography/subscribe', B.token));
    expect(s.subscribed).toBe(true);
    expect(s.counts.subscribers).toBe(1);
    expect((await post('/api/social/topics/photography/subscribe', B.token)).status).toBe(200); // 幂等
    expect((await J(await get('/api/social/me/topics', B.token))).topics.map((t: any) => t.slug)).toEqual(['photography']);
    const feed = await J(await get('/api/social/works?tab=following', B.token));
    const ids = feed.works.map((w: any) => w.id);
    expect(ids).toContain(wPub);
    expect(ids).not.toContain(wFol);
    expect(ids).not.toContain(wShort); // 没订阅「日常」
    const byTopic = await J(await get('/api/social/works?tab=latest&topic=daily'));
    expect(byTopic.works.map((w: any) => w.id).sort()).toEqual([wPub, wShort].sort());
  });
  it('话题新作品通知：每个话题每人每天最多一条；关掉偏好后不再收到', async () => {
    await post('/api/social/works', A.token, photo({ title: '第二张', media: [IMG(2)], topics: ['photography'] }));
    await post('/api/social/works', A.token, photo({ title: '第三张', media: [IMG(3)], topics: ['photography'] }));
    const n = await notes(B, 'topic_work');
    expect(n.length).toBe(1);
    expect(n[0].objectKind).toBe('topic');
    expect(n[0].objectRef).toBe('photography');
    // C 订阅后关掉偏好
    await post('/api/social/topics/photography/subscribe', C.token);
    expect((await call(env, '/api/social/notifications/prefs', { method: 'PUT', token: C.token, body: { topic_work: false } })).status).toBe(200);
    expect((await J(await get('/api/social/notifications/prefs', C.token))).prefs.topic_work).toBe(false);
    await post('/api/social/works', A.token, photo({ title: '第四张', media: [IMG(4)], topics: ['photography'] }));
    expect((await notes(C, 'topic_work')).length).toBe(0);
    // 取消订阅
    expect((await J(await del('/api/social/topics/photography/subscribe', C.token))).subscribed).toBe(false);
  });
  it('发现页：不需要关注任何人 —— 最新作品、活跃创作者、精选创作者（站长人工）、话题', async () => {
    let d = await J(await get('/api/social/discover'));
    expect(d.newest.length).toBeGreaterThan(0);
    expect(d.newest.every((w: any) => w.visibility === 'public')).toBe(true);
    expect(d.activeCreators.map((c: any) => c.username)).toContain(A.username);
    expect(d.topics.length).toBe(6);
    expect((await adm('/api/admin/discovery/creators', { username: A.username, note: '江边的光' })).status).toBe(200);
    expect((await adm('/api/admin/discovery/verifications', { username: A.username, label: '摄影师' })).status).toBe(200);
    d = await J(await get('/api/social/discover'));
    expect(d.featuredCreators[0]).toMatchObject({ username: A.username, note: '江边的光', verified: '摄影师' });
    expect(d.activeCreators.map((c: any) => c.username)).not.toContain(A.username); // 已在精选里
    // 不允许被发现的人不出现
    await call(env, '/api/social/me', { method: 'PUT', token: A.token, body: { discoverable: false } });
    expect((await J(await get('/api/social/discover'))).featuredCreators.length).toBe(0);
    await call(env, '/api/social/me', { method: 'PUT', token: A.token, body: { discoverable: true } });
  });
  it('后台：新建话题 + 标签映射；非管理员 401/403', async () => {
    expect((await call(env, '/api/admin/discovery/topics', { method: 'POST', token: A.token, body: {} })).status).toBeGreaterThanOrEqual(401);
    const r = await adm('/api/admin/discovery/topics', { slug: 'film', name: '胶片', intro: '胶片摄影', sort: 7, tags: ['胶片'] });
    expect(r.status).toBe(201);
    expect((await J(r)).topic.tags).toEqual(['胶片']);
    expect((await adm('/api/admin/discovery/topics', { slug: 'film', name: '胶片2' })).status).toBe(409);
  });
});

let ev = 'week-river';
let eA1 = 0;
describe('L17 摄影活动：投稿 / 管理 / 投票规则 / 结果', () => {
  it('站长创建活动（每周主题，开启投票，结束前隐藏票数，注册 0 天即可投票）', async () => {
    const r = await adm('/api/admin/discovery/events', { slug: ev, kind: 'weekly', title: '每周主题：河流', intro: '拍一条河', rules: '原创；每人最多 2 件', topic: 'photography', startsAt: iso(-1), endsAt: iso(48), voting: true, voteEndsAt: iso(72), minAccountDays: 0, maxEntries: 2 });
    expect(r.status).toBe(201);
    expect((await J(r)).event.phase).toBe('open');
    expect((await adm('/api/admin/discovery/events', { slug: 'bad-daily', kind: 'daily', title: 'x', startsAt: iso(0), endsAt: iso(100) })).status).toBe(400);
    const list = await J(await get('/api/social/events?status=current'));
    expect(list.events.map((e: any) => e.slug)).toContain(ev);
  });
  it('投稿：只接受本人已发布的公开摄影作品；重复 409；超过上限 409', async () => {
    expect((await post(`/api/social/events/${ev}/entries`, undefined, { workId: wPub })).status).toBe(401);
    expect((await post(`/api/social/events/${ev}/entries`, B.token, { workId: wPub })).status).toBe(400); // 别人的作品
    expect((await post(`/api/social/events/${ev}/entries`, A.token, { workId: wShort })).status).toBe(400); // 短动态
    expect((await post(`/api/social/events/${ev}/entries`, A.token, { workId: wFol })).status).toBe(400); // 非公开
    const r = await post(`/api/social/events/${ev}/entries`, A.token, { workId: wPub, note: '傍晚的江面', credit: '同行：小林' });
    expect(r.status).toBe(201);
    eA1 = (await J(r)).entry.id;
    expect((await post(`/api/social/events/${ev}/entries`, A.token, { workId: wPub })).status).toBe(409);
    const w2 = (await J(await post('/api/social/works', A.token, photo({ title: '第五张', media: [IMG(5)] })))).work.id;
    const w3 = (await J(await post('/api/social/works', A.token, photo({ title: '第六张', media: [IMG(6)] })))).work.id;
    expect((await post(`/api/social/events/${ev}/entries`, A.token, { workId: w2 })).status).toBe(201);
    expect((await post(`/api/social/events/${ev}/entries`, A.token, { workId: w3 })).status).toBe(409);
    const page = await J(await get(`/api/social/events/${ev}`, A.token));
    expect(page.entries.length).toBe(2);
    expect(page.entries.find((e: any) => e.id === eA1)).toMatchObject({ note: '傍晚的江面', credit: '同行：小林', mine: true });
    expect(page.entries.find((e: any) => e.id === eA1).work.params.camera).toBe('Phone'); // 参数随作品保留
    expect(page.me.canSubmit).toMatch(/最多/);
    expect(page.event.counts).toEqual({ entries: 2, participants: 1 });
  });
  it('管理投稿：修改说明；别人不能改 / 撤回；撤回后可以重新投', async () => {
    expect((await patch(`/api/social/events/entries/${eA1}`, A.token, { note: '改一下说明' })).status).toBe(200);
    expect((await patch(`/api/social/events/entries/${eA1}`, B.token, { note: 'x' })).status).toBe(403);
    expect((await del(`/api/social/events/entries/${eA1}`, B.token)).status).toBe(403);
    expect((await del(`/api/social/events/entries/${eA1}`, A.token)).status).toBe(200);
    expect((await J(await get(`/api/social/events/${ev}`))).entries.length).toBe(1);
    const again = await post(`/api/social/events/${ev}/entries`, A.token, { workId: wPub, note: '重新投稿' });
    expect(again.status).toBe(201);
    eA1 = (await J(again)).entry.id;
    const mine = await J(await get('/api/social/me/entries', A.token));
    expect(mine.entries.length).toBe(2);
  });
  it('投票：每人一票、不能投自己、改投先取消；结束前不公开票数', async () => {
    expect((await post(`/api/social/events/${ev}/votes`, A.token, { entryId: eA1 })).status).toBe(403); // 自己
    expect((await post(`/api/social/events/${ev}/votes`, undefined, { entryId: eA1 })).status).toBe(401);
    expect((await post(`/api/social/events/${ev}/votes`, B.token, { entryId: eA1 })).status).toBe(201);
    const dbl = await post(`/api/social/events/${ev}/votes`, B.token, { entryId: eA1 });
    expect(dbl.status).toBe(409);
    expect((await J(dbl)).error.code).toBe('already_voted');
    const other = (await J(await get(`/api/social/events/${ev}`))).entries.find((e: any) => e.id !== eA1).id;
    expect((await post(`/api/social/events/${ev}/votes`, B.token, { entryId: other })).status).toBe(409);
    const page = await J(await get(`/api/social/events/${ev}`, B.token));
    expect(page.me.vote).toBe(eA1);
    expect(page.entries.every((e: any) => e.votes === null)).toBe(true); // 隐藏票数
    expect((await del(`/api/social/events/${ev}/votes`, B.token)).status).toBe(200);
    expect((await post(`/api/social/events/${ev}/votes`, B.token, { entryId: other })).status).toBe(201);
    expect((await post(`/api/social/events/${ev}/votes`, C.token, { entryId: other })).status).toBe(201);
    // 撤回的投稿：票作废
    const adminView = await J(await adm(`/api/admin/discovery/events/${ev}/entries`));
    expect(adminView.entries.find((e: any) => e.id === other).votes).toBe(2);
  });
  it('投票门槛：注册不满 N 天不能投；活动未开启投票不能投', async () => {
    const r = await adm('/api/admin/discovery/events', { slug: 'old-members', kind: 'open', title: '老朋友征集', startsAt: iso(-1), endsAt: iso(24), voting: true, minAccountDays: 7 });
    expect(r.status).toBe(201);
    await post('/api/social/events/old-members/entries', A.token, { workId: wPub });
    const e = (await J(await get('/api/social/events/old-members'))).entries[0].id;
    const no = await post('/api/social/events/old-members/votes', B.token, { entryId: e });
    expect(no.status).toBe(403);
    expect((await J(no)).error.message).toMatch(/7 天/);
    await adm('/api/admin/discovery/events', { slug: 'no-vote', kind: 'open', title: '只征集', startsAt: iso(-1), endsAt: iso(24) });
    await post('/api/social/events/no-vote/entries', A.token, { workId: wPub });
    const e2 = (await J(await get('/api/social/events/no-vote'))).entries[0].id;
    expect((await post('/api/social/events/no-vote/votes', B.token, { entryId: e2 })).status).toBe(403);
  });
  it('精选 + 公布结果：结束前 409；结束后发「活动结果」通知、精选徽章；投稿期外不能撤回', async () => {
    expect((await adm(`/api/admin/discovery/events/${ev}/picks`, { entryId: eA1 })).status).toBe(200);
    expect((await adm(`/api/admin/discovery/events/${ev}/results`, {})).status).toBe(409);
    // 把活动挪到过去（投稿 + 投票都结束）
    expect((await adm(`/api/admin/discovery/events/${ev}`, { startsAt: iso(-100), endsAt: iso(-50), voteEndsAt: iso(-2) }, 'PUT')).status).toBe(200);
    const pageEnded = await J(await get(`/api/social/events/${ev}`));
    expect(pageEnded.event.phase).toBe('ended');
    expect(pageEnded.entries.some((e: any) => e.votes === 2)).toBe(true); // 结束后公开票数
    expect(pageEnded.entries.every((e: any) => e.picked === false)).toBe(true); // 结果公布前不显示精选
    expect((await del(`/api/social/events/entries/${eA1}`, A.token)).status).toBe(409);
    expect((await post(`/api/social/events/${ev}/votes`, C.token, { entryId: eA1 })).status).toBe(403);
    const res = await J(await adm(`/api/admin/discovery/events/${ev}/results`, {}));
    expect(res.notified).toBe(1);
    expect(res.event.resultsAt).toBeTruthy();
    const n = await notes(A, 'event_result');
    expect(n.length).toBe(1);
    expect(n[0].excerpt).toMatch(/精选/);
    // 再公布一次：不重复通知
    await adm(`/api/admin/discovery/events/${ev}/results`, {});
    expect((await notes(A, 'event_result')).length).toBe(1);
    const page = await J(await get(`/api/social/events/${ev}`));
    expect(page.entries[0]).toMatchObject({ id: eA1, picked: true });
  });
});

describe('L17 合集 / 社区徽章 / 有帮助的评论', () => {
  let cPriv = 0, cPub = 0;
  it('合集：私密合集只有自己能看；公开合集游客可见；同名 409；重复条目 409', async () => {
    const p = await post('/api/social/collections', B.token, { title: '私藏', visibility: 'private' });
    expect(p.status).toBe(201);
    cPriv = (await J(p)).collection.id;
    expect((await post('/api/social/collections', B.token, { title: '私藏' })).status).toBe(409);
    cPub = (await J(await post('/api/social/collections', B.token, { title: '河流', description: '喜欢的河', visibility: 'public' }))).collection.id;
    expect((await post(`/api/social/collections/${cPriv}/items`, B.token, { kind: 'work', ref: wPub })).status).toBe(201);
    expect((await post(`/api/social/collections/${cPriv}/items`, B.token, { kind: 'work', ref: wPub })).status).toBe(409);
    expect((await post(`/api/social/collections/${cPub}/items`, B.token, { kind: 'work', ref: wPub })).status).toBe(201);
    expect((await post(`/api/social/collections/${cPub}/items`, B.token, { kind: 'post', ref: 'hello-world', title: '你好' })).status).toBe(201);
    expect((await post(`/api/social/collections/${cPub}/items`, B.token, { kind: 'work', ref: wFol })).status).toBe(404); // B 看不到仅关注者作品
    // 访问控制
    expect((await get(`/api/social/collections/${cPriv}`)).status).toBe(404);
    expect((await get(`/api/social/collections/${cPriv}`, A.token)).status).toBe(404);
    expect((await get(`/api/social/collections/${cPriv}`, B.token)).status).toBe(200);
    expect((await post(`/api/social/collections/${cPub}/items`, A.token, { kind: 'work', ref: wPub })).status).toBe(404); // 别人的合集
    expect((await call(env, `/api/social/collections/${cPub}`, { method: 'DELETE', token: A.token })).status).toBe(404);
    const pub = await J(await get(`/api/social/collections/${cPub}`));
    expect(pub.items.length).toBe(2);
    expect(pub.canEdit).toBe(false);
    const list = await J(await get(`/api/social/users/${B.username}/collections`));
    expect(list.collections.map((c: any) => c.title)).toEqual(['河流']);
    const mine = await J(await get(`/api/social/me/collections?kind=work&ref=${wPub}`, B.token));
    expect(mine.collections.every((c: any) => c.contains === true)).toBe(true);
    // 改为私密后游客 404
    expect((await patch(`/api/social/collections/${cPub}`, B.token, { visibility: 'private' })).status).toBe(200);
    expect((await get(`/api/social/collections/${cPub}`)).status).toBe(404);
    expect((await del(`/api/social/collections/${cPub}/items/post/hello-world`, B.token)).status).toBe(200);
    expect((await del(`/api/social/collections/${cPub}`, B.token)).status).toBe(200);
  });
  it('有帮助的评论：只有作品作者能标记；评论作者获得「热心解答」', async () => {
    const c = await J(await post(`/api/social/works/${wPub}/comments`, C.token, { body: '试试降低半档曝光' }));
    const cid = c.comment.id;
    expect((await post(`/api/social/works/comments/${cid}/helpful`, B.token)).status).toBe(403);
    expect((await post(`/api/social/works/comments/${cid}/helpful`, A.token)).status).toBe(200);
    const list = await J(await get(`/api/social/works/${wPub}/comments`, A.token));
    expect(list.comments.find((x: any) => x.id === cid)).toMatchObject({ helpful: true, canMarkHelpful: true });
    expect((await J(await get(`/api/social/users/${C.username}/badges`))).community.map((b: any) => b.code)).toEqual(['helpful_comment']);
    expect((await del(`/api/social/works/comments/${cid}/helpful`, A.token)).status).toBe(200);
    expect((await J(await get(`/api/social/users/${C.username}/badges`))).community).toEqual([]);
  });
  it('社区徽章：第一次发布 / 活动参与 / 活动精选；认证单独显示；不按票数发放', async () => {
    const b = await J(await get(`/api/social/users/${A.username}/badges`));
    expect(b.community.map((x: any) => x.code)).toEqual(['first_work', 'event_participant', 'event_pick']);
    expect(b.community.find((x: any) => x.code === 'event_participant').count).toBe(3);
    expect(b.verified.label).toBe('摄影师');
    // B 投了票但没有投稿：没有活动徽章
    expect((await J(await get(`/api/social/users/${B.username}/badges`))).community).toEqual([]);
  });
  it('导出包含合集 / 订阅 / 投稿 / 徽章；注销后一并清除', async () => {
    const ex = await J(await get('/api/social/me/export', B.token));
    expect(ex.collections.length).toBe(1);
    expect(ex.topicSubscriptions.length).toBe(1);
    expect(ex.eventVotes.length).toBeGreaterThan(0);
    expect((await post('/api/social/me/delete', B.token, { confirm: B.username })).status).toBe(200);
    expect((await J(await get('/api/social/topics/photography'))).topic.counts.subscribers).toBe(0);
  });
});
