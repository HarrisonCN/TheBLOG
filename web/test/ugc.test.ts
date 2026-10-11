import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { DemoBackend, memoryKV, type KV } from '../src/demo/mock-api';
import { DEMO_OTP, DEMO_PASSWORD } from '../src/demo/seed';
import { checkWork, TYPE_RULES } from '../src/ugc-core';

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
const tick = () => (clock += 1000);
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('L16 ugc-core 共享', () => {
  it('web 与 worker 的 ugc-core.ts 内容一致', () => {
    const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
    expect(read('../src/ugc-core.ts')).toBe(read('../../worker/src/ugc-core.ts'));
  });
  it('编辑器模式与类型规则一致：摄影作品正好 1 张图、影集 2–30 张、短动态无标题', () => {
    expect(TYPE_RULES.photo.media).toEqual([1, 1]);
    expect(TYPE_RULES.album.media).toEqual([2, 30]);
    expect(TYPE_RULES.short.title).toEqual([0, 0]);
    expect(checkWork({ type: 'photo', media: [{ url: '/TheBLOG/demo/photos/x-1280.webp', alt: 'a' }] }, { allowDataUrl: true }).ok).toBe(true);
    expect(checkWork({ type: 'photo', media: [{ url: '/TheBLOG/../etc/x.png', alt: 'a' }] }, { allowDataUrl: true }).ok).toBe(false);
  });
});

describe('演示 mock：L16 用户内容发布（与 Worker 同规则）', () => {
  it('种子：示例用户的作品在「最新」流里，全部标注为演示数据；种子不冒用站长身份', async () => {
    const f = B(await api.handle('GET', '/api/social/works?tab=latest'));
    expect(f.works.length).toBeGreaterThanOrEqual(4);
    for (const w of f.works) {
      expect(['xiaolin', 'momo']).toContain(w.author.username);
      expect(`${w.title}${w.body}${w.caption}`).toContain('演示数据');
    }
    expect(JSON.stringify(f)).not.toMatch(/winston/i);
    expect(B(await api.handle('GET', '/api/social/works?tab=latest&type=album')).works.every((w: any) => w.type === 'album')).toBe(true);
    const p = B(await api.handle('GET', '/api/social/users/xiaolin'));
    expect(p.works[0].kind).toBe('work');
    expect(p.profile.counts.works).toBe(2);
  });

  it('发布闭环：上传 → 草稿 → 待审 → 后台通过（审核日志）→ 关注者动态流 + 通知 → 评论 / 回应 / 收藏 → 作者通知', async () => {
    const a = await join('a@demo.test', 'Ada', 'ada_demo');
    const b = await join('b@demo.test', 'Ben', 'ben_demo');
    await api.handle('POST', '/api/social/follows/ada_demo', undefined, as(b));
    const up = await api.handle('POST', '/api/social/uploads', { dataUrl: IMG }, as(a));
    expect(up.status).toBe(201);
    expect((await api.handle('POST', '/api/social/uploads', { dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }, as(a))).status).toBe(415);
    const body = { type: 'photo', title: '窗外', caption: '下雨天', params: { iso: '200' }, media: [{ url: B(up).url, alt: '雨滴落在窗户上', width: 1, height: 1 }], visibility: 'public' };
    expect(B(await api.handle('POST', '/api/social/works', { ...body, media: [{ ...body.media[0], alt: '' }] }, as(a))).error.details[0].path).toBe('media.0.alt');
    const d = B(await api.handle('POST', '/api/social/works', { ...body, draft: true }, as(a)));
    expect(d.status).toBe('draft');
    const id = d.work.id;
    expect((await api.handle('GET', `/api/social/works/${id}`, undefined, as(b))).status).toBe(404);
    tick();
    expect(B(await api.handle('POST', `/api/social/works/${id}/publish`, undefined, as(a))).status).toBe('pending');
    expect((await api.handle('GET', `/api/social/works/${id}`)).status).toBe(404);
    expect(B(await api.handle('GET', '/api/social/works?tab=following', undefined, as(b))).works.some((w: any) => w.id === id)).toBe(false);
    const adm = await adminHeaders();
    expect((await api.handle('GET', '/api/admin/ugc/queue?view=pending')).status).toBe(200); // mock 会话在本机 → 已登录
    const q = B(await api.handle('GET', '/api/admin/ugc/queue?view=pending', undefined, adm));
    expect(q.items.some((i: any) => i.id === id)).toBe(true);
    expect((await api.handle('POST', '/api/admin/ugc/actions', { targetKind: 'work', targetId: id, action: 'approve' })).status).toBe(403);
    expect((await api.handle('POST', '/api/admin/ugc/actions', { targetKind: 'work', targetId: id, action: 'approve' }, adm)).status).toBe(200);
    const log = B(await api.handle('GET', '/api/admin/ugc/log', undefined, adm));
    expect(log.actions.map((x: any) => x.action)).toEqual(['approve', 'auto_pending']);
    const feed = B(await api.handle('GET', '/api/social/works?tab=following', undefined, as(b)));
    expect(feed.works[0].id).toBe(id);
    const nb = B(await api.handle('GET', '/api/social/notifications?filter=new_work', undefined, as(b)));
    expect(nb.notifications[0]).toMatchObject({ type: 'new_work', objectRef: String(id), actor: { username: 'ada_demo' } });
    // 评论：新会员先审核
    const c = B(await api.handle('POST', `/api/social/works/${id}/comments`, { body: '好看' }, as(b)));
    expect(c.status).toBe('pending');
    expect(B(await api.handle('GET', `/api/social/works/${id}/comments`)).comments.length).toBe(0);
    await api.handle('POST', '/api/admin/ugc/actions', { targetKind: 'comment', targetId: c.comment.id, action: 'approve' }, adm);
    expect(B(await api.handle('GET', `/api/social/works/${id}/comments`)).comments.length).toBe(1);
    const r = B(await api.handle('POST', `/api/social/works/${id}/reactions`, { kind: 'fire' }, as(b)));
    expect(r.reactions.fire).toBe(1);
    expect(B(await api.handle('POST', `/api/social/works/${id}/reactions`, { kind: 'fire' }, as(b))).reactions.fire).toBe(1);
    await api.handle('POST', `/api/social/works/${id}/bookmark`, undefined, as(b));
    const na = B(await api.handle('GET', '/api/social/notifications', undefined, as(a))).notifications.map((n: any) => n.type);
    expect(na).toEqual(expect.arrayContaining(['moderation', 'reply', 'reaction', 'bookmark']));
  });

  it('权限：别人不能改 / 删；仅关注者与私密内容隔离；软删除 / 隐藏 / 清除区分', async () => {
    const a = await join('a@demo.test', 'Ada', 'ada_demo');
    const b = await join('b@demo.test', 'Ben', 'ben_demo');
    const c = await join('c@demo.test', 'Cat', 'cat_demo');
    await api.handle('POST', '/api/social/follows/ada_demo', undefined, as(b));
    const adm = await adminHeaders();
    expect((await api.handle('PUT', '/api/admin/ugc/rules', { reviewFirstN: 0 }, adm)).status).toBe(200);
    const f = B(await api.handle('POST', '/api/social/works', { type: 'short', body: '仅关注者 @ben_demo @cat_demo', visibility: 'followers' }, as(a)));
    expect(f.status).toBe('published');
    expect((await api.handle('GET', `/api/social/works/${f.work.id}`, undefined, as(b))).status).toBe(200);
    expect((await api.handle('GET', `/api/social/works/${f.work.id}`, undefined, as(c))).status).toBe(404);
    expect(B(await api.handle('GET', '/api/social/notifications?filter=mention', undefined, as(c))).notifications.length).toBe(0);
    expect(B(await api.handle('GET', '/api/social/notifications?filter=mention', undefined, as(b))).notifications.length).toBe(1);
    tick();
    const p = B(await api.handle('POST', '/api/social/works', { type: 'article', title: '私密', body: '只有我', visibility: 'private' }, as(a)));
    expect((await api.handle('GET', `/api/social/works/${p.work.id}`, undefined, as(b))).status).toBe(404);
    expect((await api.handle('PUT', `/api/social/works/${f.work.id}`, { type: 'short', body: 'x' }, as(b))).status).toBe(403);
    expect((await api.handle('DELETE', `/api/social/works/${p.work.id}`, undefined, as(c))).status).toBe(404);
    expect((await api.handle('POST', '/api/social/works', { type: 'short', body: 'x' })).status).toBe(401);
    // 举报 → 隐藏 → 恢复 → 作者软删除 → 清除
    tick();
    const pub = B(await api.handle('POST', '/api/social/works', { type: 'short', body: '公开的一条' }, as(a)));
    expect(B(await api.handle('POST', '/api/social/reports', { targetKind: 'work', targetId: pub.work.id, reason: 'spam' }, as(c))).duplicate).toBe(false);
    expect(B(await api.handle('POST', '/api/social/reports', { targetKind: 'work', targetId: pub.work.id, reason: 'spam' }, as(c))).duplicate).toBe(true);
    const rq = B(await api.handle('GET', '/api/admin/ugc/queue?view=reports', undefined, adm));
    expect(rq.items[0].reports.length).toBe(1);
    await api.handle('POST', '/api/admin/ugc/actions', { targetKind: 'work', targetId: pub.work.id, action: 'hide', reason: '测试' }, adm);
    expect((await api.handle('GET', `/api/social/works/${pub.work.id}`)).status).toBe(404);
    expect(B(await api.handle('GET', `/api/social/works/${pub.work.id}`, undefined, as(a))).work.modState).toBe('hidden');
    await api.handle('POST', '/api/admin/ugc/actions', { targetKind: 'work', targetId: pub.work.id, action: 'restore' }, adm);
    expect((await api.handle('GET', `/api/social/works/${pub.work.id}`)).status).toBe(200);
    expect((await api.handle('DELETE', `/api/social/works/${pub.work.id}`, undefined, as(a))).status).toBe(200);
    expect((await api.handle('GET', `/api/social/works/${pub.work.id}`, undefined, as(a))).status).toBe(404);
    await api.handle('POST', '/api/admin/ugc/actions', { targetKind: 'work', targetId: pub.work.id, action: 'purge' }, adm);
    const acts = B(await api.handle('GET', '/api/admin/ugc/log', undefined, adm)).actions.map((x: any) => x.action);
    expect(acts.slice(0, 4)).toEqual(['purge', 'restore', 'hide', 'rules']);
    // 静音隐藏作者
    await api.handle('POST', '/api/social/mutes/ada_demo', undefined, as(b));
    expect(B(await api.handle('GET', '/api/social/works?tab=latest', undefined, as(b))).works.some((w: any) => w.author.username === 'ada_demo')).toBe(false);
  });

  it('反垃圾 + 封禁 + 游标分页', async () => {
    const a = await join('a@demo.test', 'Ada', 'ada_demo');
    const adm = await adminHeaders();
    await api.handle('PUT', '/api/admin/ugc/rules', { reviewFirstN: 0 }, adm);
    expect(B(await api.handle('POST', '/api/social/works', { type: 'short', body: 'https://a.cn https://b.cn https://c.cn https://d.cn' }, as(a))).error.code).toBe('too_many_links');
    expect((await api.handle('POST', '/api/social/works', { type: 'short', body: '同一句话' }, as(a))).status).toBe(201);
    expect((await api.handle('POST', '/api/social/works', { type: 'short', body: '同一句话！' }, as(a))).status).toBe(409);
    const me = B(await api.handle('GET', '/api/social/me', undefined, as(a)));
    await api.handle('POST', '/api/admin/ugc/actions', { targetKind: 'user', targetId: me.profile.id, action: 'ban', reason: '刷屏' }, adm);
    expect(B(await api.handle('POST', '/api/social/works', { type: 'short', body: '再来' }, as(a))).error.code).toBe('banned');
    expect(B(await api.handle('GET', '/api/social/works?tab=latest')).works.some((w: any) => w.author.username === 'ada_demo')).toBe(false);
    const p1 = B(await api.handle('GET', '/api/social/works?tab=latest&limit=2'));
    const p2 = B(await api.handle('GET', `/api/social/works?tab=latest&limit=2&cursor=${p1.nextCursor}`));
    expect(p2.works[0].id).not.toBe(p1.works[1].id);
    expect(new Set([...p1.works, ...p2.works].map((w: any) => w.id)).size).toBe(4);
  });
});
