import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { DemoBackend, memoryKV, type KV } from '../src/demo/mock-api';
import { DEMO_OTP, DEMO_PASSWORD } from '../src/demo/seed';

let kv: KV;
let api: DemoBackend;
let clock = Date.parse('2026-10-11T08:00:00Z');
const now = () => new Date(clock);
beforeEach(() => {
  kv = memoryKV();
  clock = Date.parse('2026-10-11T08:00:00Z');
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
async function openPosting() {
  const r = await api.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD });
  await api.handle('PUT', '/api/admin/ugc/rules', { reviewFirstN: 0 }, { 'x-csrf-token': (r.body as { csrfToken: string }).csrfToken });
}
const M = (n: number) => ({ url: `data:image/png;base64,iVBORw0KGgo${'A'.repeat(n)}`, alt: `图 ${n}`, width: 1, height: 1 });

describe('L18 studio-core 共享', () => {
  it('web 与 worker 的 studio-core.ts 内容一致；迁移 0015 只做加法、不存访客信息', () => {
    const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
    expect(read('../src/studio-core.ts')).toBe(read('../../worker/src/studio-core.ts'));
    const sql = read('../../worker/migrations/0015_studio.sql').replace(/--.*$/gm, '');
    expect(sql).not.toMatch(/^\s*(DROP|UPDATE|DELETE)\b|ALTER TABLE \w+ (DROP|RENAME)/im);
    expect(sql).not.toMatch(/\bip\b|user_agent|visitor/i);
  });
});

describe('演示 mock：L18 摄影与创作工具（与 Worker 同规则）', () => {
  it('种子：项目页、摄影专题、共同作者署名；EXIF 筛选（手机 / 相机）与筛选项', async () => {
    const p = B(await api.handle('GET', '/api/social/projects/night-presets')).project;
    expect(p.repo).toMatchObject({ owner: 'example', name: 'night-presets' });
    expect(p.logs.map((l: any) => l.kind)).toEqual(['release', 'log']);
    expect(p.members).toMatchObject([{ user: { username: 'momo' }, status: 'accepted' }]);
    expect(p.links.length).toBe(2);
    const f = B(await api.handle('GET', '/api/social/features/river-nights')).feature;
    expect(f.blocks.filter((b: any) => b.t === 'work').length).toBe(3);
    const w3 = B(await api.handle('GET', '/api/social/works/3')).work;
    expect(w3.coauthors).toMatchObject([{ user: { username: 'xiaolin' }, role: 'editor', status: 'accepted' }]);
    const phone = B(await api.handle('GET', '/api/social/works?tab=latest&device=phone')).works;
    const cam = B(await api.handle('GET', '/api/social/works?tab=latest&device=camera')).works;
    expect(phone.length).toBeGreaterThan(0);
    expect(cam.length).toBeGreaterThan(0);
    expect(phone.every((w: any) => /手机/.test(w.params.camera))).toBe(true);
    expect((await api.handle('GET', '/api/social/works?tab=latest&iso=nope')).status).toBe(400);
    const fx = B(await api.handle('GET', '/api/social/works/exif-facets?topic=photography'));
    expect(fx.facets.device.map((d: any) => d.key)).toEqual(expect.arrayContaining(['phone', 'camera']));
  });
  it('共同作者：邀请 → 接受 → 编辑（可见范围锁定）→ 修订恢复；媒体删除需所有者确认；移除保留署名', async () => {
    await openPosting();
    const a = await join('a18@example.com', '阿一', 'ayi_18');
    const b = await join('b18@example.com', '阿二', 'aer_18');
    const w = B(await api.handle('POST', '/api/social/works', { type: 'album', title: '双城', media: [M(1), M(2)], visibility: 'private', draft: true }, as(a))).work.id;
    expect((await api.handle('GET', `/api/social/works/${w}`, undefined, as(b))).status).toBe(404);
    expect((await api.handle('POST', `/api/social/works/${w}/coauthors`, { username: 'aer_18', role: 'editor' }, as(a))).status).toBe(201);
    expect(B(await api.handle('GET', '/api/social/notifications?filter=collab', undefined, as(b))).notifications.length).toBe(1);
    expect(B(await api.handle('GET', '/api/social/me/invitations', undefined, as(b))).invitations[0]).toMatchObject({ kind: 'work', id: w });
    expect((await api.handle('GET', `/api/social/works/${w}`, undefined, as(b))).status).toBe(200);
    expect((await api.handle('PUT', `/api/social/works/${w}`, { type: 'album', title: 'x', media: [M(1), M(2)] }, as(b))).status).toBe(403);
    expect((await api.handle('POST', `/api/social/invitations/work/${w}/accept`, {}, as(b))).status).toBe(200);
    clock += 1000;
    const ed = await api.handle('PUT', `/api/social/works/${w}`, { type: 'album', title: '双城记', media: [M(1), M(2), M(3)], visibility: 'public' }, as(b));
    expect(ed.status).toBe(200);
    expect(B(ed).work).toMatchObject({ title: '双城记', visibility: 'private', mine: { role: 'editor', canEdit: true, can: { delete: false } } });
    expect((await api.handle('DELETE', `/api/social/works/${w}`, undefined, as(b))).status).toBe(403);
    const blocked = await api.handle('PUT', `/api/social/works/${w}`, { type: 'album', title: '双城记', media: [M(2), M(3)] }, as(b));
    expect(blocked.status).toBe(403);
    expect(B(blocked).error.code).toBe('media_not_yours');
    const imp = await api.handle('PUT', `/api/social/works/${w}`, { type: 'album', title: '双城记', media: [M(1), M(2)], visibility: 'private' }, as(a));
    expect(imp.status).toBe(409);
    expect(B(imp).error.details.items).toMatchObject([{ uploadedBy: 'aer_18' }]);
    expect((await api.handle('PUT', `/api/social/works/${w}`, { type: 'album', title: '双城记', media: [M(1), M(2)], visibility: 'private', confirmMediaRemoval: true }, as(a))).status).toBe(200);
    const revs = B(await api.handle('GET', `/api/social/works/${w}/revisions`, undefined, as(b)));
    expect(revs.revisions.length).toBe(3);
    expect(revs.revisions.at(-1).changes).toEqual(['创建']);
    const rs = await api.handle('POST', `/api/social/works/${w}/revisions/1/restore`, {}, as(b));
    expect(rs.status).toBe(200);
    expect(B(rs).work.title).toBe('双城');
    expect(B(await api.handle('GET', `/api/social/works/${w}/revisions`, undefined, as(a))).revisions[0].note).toBe('恢复到第 1 版');
    const rm = await api.handle('DELETE', `/api/social/works/${w}/coauthors/aer_18`, undefined, as(a));
    expect(B(rm).coauthors).toMatchObject([{ user: { username: 'aer_18' }, status: 'removed' }]);
    expect((await api.handle('PUT', `/api/social/works/${w}`, { type: 'album', title: 'y', media: [M(1), M(2)] }, as(b))).status).toBe(404); // 私密作品：移出后连看都看不到了
  });
  it('恢复旧版本不能绕过审核（与 Worker 相同）', async () => {
    const r = await api.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD });
    const csrf = { 'x-csrf-token': (r.body as { csrfToken: string }).csrfToken };
    await api.handle('PUT', '/api/admin/ugc/rules', { reviewFirstN: 0 }, csrf);
    const a = await join('r18@example.com', '阿五', 'awu_18');
    const photo = (title: string) => ({ type: 'photo', title, media: [M(7)], params: { camera: 'iPhone 15 Pro' }, visibility: 'public' });
    const w = B(await api.handle('POST', '/api/social/works', photo('第一版'), as(a))).work.id;
    expect((await api.handle('PUT', `/api/social/works/${w}`, photo('第二版'), as(a))).status).toBe(200);
    await api.handle('PUT', '/api/admin/ugc/rules', { reviewFirstN: 50 }, csrf);
    const rs = await api.handle('POST', `/api/social/works/${w}/revisions/1/restore`, {}, as(a));
    expect(rs.status).toBe(200);
    expect(B(rs).work).toMatchObject({ title: '第一版', status: 'pending' });
    expect((await api.handle('GET', `/api/social/works/${w}`)).status).toBe(404);
  });
  it('项目：创建 / 日志 / 版本 / 关联 / 成员；摄影专题只用自己的公开作品', async () => {
    await openPosting();
    const a = await join('c18@example.com', '阿三', 'asan_18');
    const b = await join('d18@example.com', '阿四', 'asi_18');
    expect((await api.handle('POST', '/api/social/projects', { slug: 'night-presets', title: 'x' }, as(a))).status).toBe(409);
    expect((await api.handle('POST', '/api/social/projects', { slug: 'cam', title: '相机', repoUrl: 'https://gitlab.com/a/b' }, as(a))).status).toBe(400);
    const p = B(await api.handle('POST', '/api/social/projects', { slug: 'cam', title: '相机', repoUrl: 'https://github.com/a/cam' }, as(a))).project;
    expect(p.repo.name).toBe('cam');
    expect((await api.handle('POST', '/api/social/projects/cam/logs', { kind: 'release', title: 'v', version: '0.1.0' }, as(a))).status).toBe(201);
    await api.handle('POST', '/api/social/projects/cam/members', { username: 'asi_18', role: 'editor' }, as(a));
    const pid = B(await api.handle('GET', '/api/social/me/invitations', undefined, as(b))).invitations[0].id;
    await api.handle('POST', `/api/social/invitations/project/${pid}/accept`, {}, as(b));
    const u = B(await api.handle('PATCH', '/api/social/projects/cam', { tagline: 'hi', visibility: 'private' }, as(b))).project;
    expect(u).toMatchObject({ tagline: 'hi', visibility: 'public' });
    expect((await api.handle('DELETE', '/api/social/projects/cam', undefined, as(b))).status).toBe(403);
    const w = B(await api.handle('POST', '/api/social/works', { type: 'photo', title: '晨', media: [M(5)], params: { camera: 'iPhone 15' }, visibility: 'public' }, as(a))).work.id;
    expect((await api.handle('POST', '/api/social/features', { slug: 'morning', title: '早晨', blocks: [{ t: 'work', id: 2 }] }, as(a))).status).toBe(400);
    expect((await api.handle('POST', '/api/social/features', { slug: 'morning', title: '早晨', blocks: [{ t: 'work', id: w, caption: '一' }] }, as(a))).status).toBe(201);
    expect((await api.handle('GET', '/api/social/features/morning')).status).toBe(404);
    expect((await api.handle('POST', '/api/social/features/morning/publish', {}, as(a))).status).toBe(200);
    expect((await api.handle('GET', '/api/social/features/morning')).status).toBe(200);
  });
  it('数据中心：浏览量按天汇总、本人不计、来源只留域名；只有本人能看', async () => {
    await openPosting();
    const a = await join('e18@example.com', '阿五', 'awu_18');
    const b = await join('f18@example.com', '阿六', 'aliu_18');
    const w = B(await api.handle('POST', '/api/social/works', { type: 'photo', title: '夜', media: [M(7)], visibility: 'public' }, as(a))).work.id;
    expect(B(await api.handle('POST', '/api/social/views', { kind: 'work', ref: String(w), referrer: 'https://www.weibo.com/x?y=1' })).counted).toBe(true);
    expect(B(await api.handle('POST', '/api/social/views', { kind: 'work', ref: String(w) }, as(b))).counted).toBe(true);
    expect(B(await api.handle('POST', '/api/social/views', { kind: 'work', ref: String(w) }, as(a))).counted).toBe(false);
    await api.handle('POST', `/api/social/works/${w}/reactions`, { kind: 'like' }, as(b));
    const s = B(await api.handle('GET', '/api/social/me/stats?days=7', undefined, as(a)));
    expect(s.private.views.total).toBe(2);
    expect(s.private.referrers).toEqual([{ domain: 'weibo.com', n: 1 }, { domain: '', n: 1 }]);
    expect(s.trends.reactions.total).toBe(1);
    expect(s.privacy).toMatch(/不保存 IP/);
    expect(B(await api.handle('GET', '/api/social/me/stats?days=7', undefined, as(b))).private.views.total).toBe(0);
    expect((await api.handle('GET', '/api/social/me/stats')).status).toBe(401);
    expect(JSON.stringify(B(await api.handle('GET', `/api/social/works/${w}`)))).not.toMatch(/views/);
  });
});
