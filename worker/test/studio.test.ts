import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import { testOutbox } from '../src/community';
import type { Env } from '../src/env';
import {
  checkExifQuery,
  checkFeature,
  checkLog,
  checkProject,
  deviceKind,
  exifFacets,
  fillSeries,
  matchesExif,
  mediaRemoval,
  normalizeExif,
  parseAperture,
  parseFocal,
  parseIso,
  referrerDomain,
  snapshotDiff,
  workCan,
} from '../src/studio-core';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({ EMAIL_PROVIDER: 'memory' });
  admin = await login(env, '10.18.0.1');
});
afterAll(async () => {
  // 测试共用一个持久化 D1：恢复默认审核规则，避免影响其他测试文件
  await adm('/api/admin/ugc/rules', { reviewFirstN: 2 }, 'PUT');
  await disposeEnv();
});

const ip = (n: number) => ({ 'cf-connecting-ip': `10.18.1.${n}` });
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
const put = (path: string, token: string, body: unknown) => call(env, path, { method: 'PUT', token, body });
const patch = (path: string, token: string, body: unknown) => call(env, path, { method: 'PATCH', token, body });
const del = (path: string, token: string) => call(env, path, { method: 'DELETE', token });
const adm = (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => call(env, path, { method, cookie: admin.cookie, csrf: admin.csrf, body });
const IMG = (n: number) => ({ url: `https://upload.wikimedia.org/demo/${n}.jpg`, alt: `示例照片 ${n}`, width: 1600, height: 1067 });
const photo = (o: Record<string, unknown> = {}) => ({ type: 'photo', title: '江边', caption: '傍晚', notes: '手持', params: { camera: 'OPPO Find X8 Pro', focal: '24mm', aperture: 'f/1.8', iso: '100' }, media: [IMG(1)], visibility: 'public', ...o });

describe('studio-core 纯函数', () => {
  it('EXIF 归一化：手机 / 相机识别、等效焦距、光圈、ISO', () => {
    expect(deviceKind('iPhone 15 Pro')).toBe('phone');
    expect(deviceKind('OnePlus 12')).toBe('phone');
    expect(deviceKind('OPPO Find X8 Pro')).toBe('phone');
    expect(deviceKind('Sony ILCE-7M4')).toBe('camera');
    expect(deviceKind('FUJIFILM X-T5')).toBe('camera');
    expect(deviceKind('')).toBe('other');
    expect(parseFocal('6.86 mm (24mm 等效)')).toBe(24);
    expect(parseFocal('等效 70mm')).toBe(70);
    expect(parseFocal('35mm')).toBe(35);
    expect(parseAperture('f/1.8')).toBe(1.8);
    expect(parseAperture('ƒ/4')).toBe(4);
    expect(parseIso('ISO 3200')).toBe(3200);
    expect(parseIso('abc')).toBeNull();
    const x = normalizeExif({ camera: 'iPhone 15 Pro', focal: '24mm', aperture: 'f/1.8', iso: '800' });
    expect(x).toMatchObject({ device: 'phone', focalMm: 24, aperture: 1.8, iso: 800 });
  });
  it('EXIF 查询与筛选项', () => {
    expect(checkExifQuery(new URLSearchParams('device=phone&focal=wide')).ok).toBe(true);
    expect(checkExifQuery(new URLSearchParams('device=drone')).ok).toBe(false);
    expect(checkExifQuery(new URLSearchParams('focal=xx')).ok).toBe(false);
    const q = checkExifQuery(new URLSearchParams('device=phone&aperture=fast'));
    const a = normalizeExif({ camera: 'Pixel 9', aperture: 'f/1.7' });
    const b = normalizeExif({ camera: 'Nikon Z6', aperture: 'f/8' });
    expect(q.ok && matchesExif(a, q.value)).toBe(true);
    expect(q.ok && matchesExif(b, q.value)).toBe(false);
    const f = exifFacets([a, b, normalizeExif({ camera: 'Pixel 9', focal: '24mm' })]);
    expect(f.device).toEqual([{ key: 'phone', n: 2 }, { key: 'camera', n: 1 }]);
    expect(f.camera[0]).toEqual({ key: 'Pixel 9', n: 2 });
    expect(f.focal).toEqual([{ key: 'wide', n: 1 }]);
  });
  it('协作权限、媒体删除影响、修订差异', () => {
    expect(workCan('owner', null, 'delete')).toBe(true);
    expect(workCan('editor', 'accepted', 'edit')).toBe(true);
    expect(workCan('editor', 'accepted', 'visibility')).toBe(false);
    expect(workCan('editor', 'invited', 'edit')).toBe(false);
    expect(workCan('editor', 'removed', 'edit')).toBe(false);
    expect(workCan('contributor', 'accepted', 'edit')).toBe(false);
    const cur = [
      { url: 'a', alt: 'a', width: 1, height: 1, uploadedBy: null },
      { url: 'b', alt: 'b', width: 1, height: 1, uploadedBy: 7 },
    ];
    expect(mediaRemoval(cur, [{ url: 'a' }], 7, 1).needsConfirm.length).toBe(0); // 编辑者删自己的图
    expect(mediaRemoval(cur, [{ url: 'b' }], 7, 1).blocked.map((m) => m.url)).toEqual(['a']); // 编辑者删所有者的图
    expect(mediaRemoval(cur, [{ url: 'a' }], 1, 1).needsConfirm.map((m) => m.url)).toEqual(['b']); // 所有者删别人的图需确认
    const s = { title: 'x', body: '', caption: '', notes: '', params: {}, media: [], visibility: 'public' };
    expect(snapshotDiff(null, s)).toEqual(['创建']);
    expect(snapshotDiff(s, { ...s, title: 'y', params: { iso: '100' } })).toEqual(['标题', '拍摄参数']);
  });
  it('项目 / 日志 / 专题校验；来源只保留域名；序列补零', () => {
    expect(checkProject({ slug: 'lumen', title: 'Lumen', repoUrl: 'https://github.com/HarrisonCN/TheBLOG' }).ok).toBe(true);
    expect(checkProject({ slug: 'lumen', title: 'Lumen', repoUrl: 'https://gitlab.com/a/b' }).ok).toBe(false);
    expect(checkProject({ slug: 'A B', title: 'x' }).ok).toBe(false);
    expect(checkLog({ kind: 'release', title: 'v1', version: '1.2.0' }).ok).toBe(true);
    expect(checkLog({ kind: 'release', title: 'v1' }).ok).toBe(false);
    expect(checkFeature({ slug: 'river', title: '江', blocks: [{ t: 'work', id: 1 }, { t: 'text', text: '段落' }] }).ok).toBe(true);
    expect(checkFeature({ slug: 'river', title: '江', blocks: [{ t: 'video' }] }).ok).toBe(false);
    expect(referrerDomain('https://www.Example.com/a?b=1')).toBe('example.com');
    expect(referrerDomain('https://blog.test/x', 'blog.test')).toBeNull();
    expect(referrerDomain('http://10.0.0.1/x')).toBeNull();
    expect(referrerDomain('javascript:alert(1)')).toBeNull();
    const s = fillSeries([{ day: '2026-10-10', n: 3 }], 3, Date.parse('2026-10-11T12:00:00Z'));
    expect(s).toEqual([{ day: '2026-10-09', n: 0 }, { day: '2026-10-10', n: 3 }, { day: '2026-10-11', n: 0 }]);
  });
});

let A: U, B: U, C: U;
let wA = 0, wCam = 0;
describe('L18 EXIF 筛选', () => {
  it('会员 + 关闭新会员审核', async () => {
    A = await join('a-l18@example.com', 'Ada', 'ada_l18', 1);
    B = await join('b-l18@example.com', 'Ben', 'ben_l18', 2);
    C = await join('c-l18@example.com', 'Cat', 'cat_l18', 3);
    expect((await adm('/api/admin/ugc/rules', { reviewFirstN: 0 }, 'PUT')).status).toBe(200);
  });
  it('发布时建立 EXIF 索引；按手机 / 相机 / 焦段 / 光圈 / ISO 筛选动态流', async () => {
    wA = (await J(await post('/api/social/works', A.token, photo({ topics: ['hardware'] })))).work.id;
    wCam = (await J(await post('/api/social/works', B.token, photo({ title: '山', params: { camera: 'Sony ILCE-7M4', lens: 'FE 70-200mm F2.8 GM', focal: '135mm', aperture: 'f/4', iso: '3200' }, media: [IMG(2)], topics: ['hardware'] })))).work.id;
    const ids = async (q: string) => ((await J(await get(`/api/social/works?tab=latest&${q}`))).works as any[]).map((w) => w.id);
    expect(await ids('device=phone')).toContain(wA);
    expect(await ids('device=phone')).not.toContain(wCam);
    expect(await ids('device=camera')).toEqual([wCam]);
    expect(await ids('focal=tele')).toEqual([wCam]);
    expect(await ids('aperture=fast')).toEqual([wA]);
    expect(await ids('iso=high&topic=hardware')).toEqual([wCam]);
    expect(await ids('camera=sony%20ilce-7m4')).toEqual([wCam]);
    expect((await get('/api/social/works?tab=latest&focal=bogus')).status).toBe(400);
  });
  it('筛选项统计（话题 / 作者范围）只算公开作品', async () => {
    await post('/api/social/works', A.token, photo({ title: '私密', visibility: 'private', params: { camera: 'Leica M11' }, media: [IMG(3)] }));
    const f = await J(await get('/api/social/works/exif-facets?topic=hardware'));
    expect(f.facets.device).toEqual([{ key: 'phone', n: 1 }, { key: 'camera', n: 1 }]);
    expect(f.facets.camera.map((x: any) => x.key)).not.toContain('Leica M11');
    const g = await J(await get('/api/social/works/exif-facets?author=ben_l18'));
    expect(g.total).toBe(1);
  });
  it('后台重建 EXIF 索引', async () => {
    const r = await adm('/api/admin/studio/reindex-exif', {});
    expect(r.status).toBe(200);
    expect((await J(r)).indexed).toBeGreaterThanOrEqual(3);
  });
});

let wCo = 0;
describe('L18 共同作者 / 修订 / 媒体删除', () => {
  it('所有者邀请；被邀请人收到通知、可预览草稿，接受前不能编辑', async () => {
    wCo = (await J(await post('/api/social/works', A.token, { type: 'album', title: '双城', caption: '两个人的影集', params: { camera: 'iPhone 15 Pro' }, media: [IMG(10), IMG(11)], visibility: 'private', draft: true }))).work.id;
    expect((await get(`/api/social/works/${wCo}`, B.token)).status).toBe(404);
    expect((await post(`/api/social/works/${wCo}/coauthors`, B.token, { username: 'cat_l18' })).status).toBe(404);
    expect((await post(`/api/social/works/${wCo}/coauthors`, A.token, { username: 'ada_l18' })).status).toBe(400);
    const r = await post(`/api/social/works/${wCo}/coauthors`, A.token, { username: 'ben_l18', role: 'editor' });
    expect(r.status).toBe(201);
    expect((await J(r)).coauthors).toMatchObject([{ user: { username: 'ben_l18' }, status: 'invited' }]);
    expect((await post(`/api/social/works/${wCo}/coauthors`, A.token, { username: 'ben_l18' })).status).toBe(409);
    const n = await J(await get('/api/social/notifications?filter=collab', B.token));
    expect(n.notifications[0].type).toBe('collab');
    const inv = await J(await get('/api/social/me/invitations', B.token));
    expect(inv.invitations).toMatchObject([{ kind: 'work', id: wCo, role: 'editor', from: { username: 'ada_l18' } }]);
    expect((await get(`/api/social/works/${wCo}`, B.token)).status).toBe(200); // 预览
    expect((await put(`/api/social/works/${wCo}`, B.token, { type: 'album', title: '改', media: [IMG(10), IMG(11)] })).status).toBe(403);
  });
  it('接受后：可编辑内容和图片，不能改可见范围 / 删除 / 发布 / 管理成员', async () => {
    expect((await post(`/api/social/invitations/work/${wCo}/accept`, B.token)).status).toBe(200);
    expect((await post(`/api/social/invitations/work/${wCo}/accept`, B.token)).status).toBe(404);
    const r = await put(`/api/social/works/${wCo}`, B.token, { type: 'album', title: '双城记', caption: '两个人的影集', params: { camera: 'iPhone 15 Pro' }, media: [IMG(10), IMG(11), IMG(12)], visibility: 'public' });
    expect(r.status).toBe(200);
    const w = (await J(r)).work;
    expect(w.title).toBe('双城记');
    expect(w.visibility).toBe('private'); // 编辑者改不了可见范围
    expect(w.mine).toMatchObject({ canEdit: true, role: 'editor', can: { edit: true, delete: false, visibility: false } });
    expect(w.coauthors).toMatchObject([{ user: { username: 'ben_l18' }, role: 'editor', status: 'accepted' }]);
    expect((await del(`/api/social/works/${wCo}`, B.token)).status).toBe(403);
    expect((await post(`/api/social/works/${wCo}/publish`, B.token)).status).toBe(403);
    expect((await post(`/api/social/works/${wCo}/coauthors`, B.token, { username: 'cat_l18' })).status).toBe(403);
  });
  it('编辑者不能删除所有者上传的图片；所有者删除编辑者的图片需确认并看到影响', async () => {
    const r1 = await put(`/api/social/works/${wCo}`, B.token, { type: 'album', title: '双城记', media: [IMG(11), IMG(12)] });
    expect(r1.status).toBe(403);
    expect((await J(r1)).error.code).toBe('media_not_yours');
    const body = { type: 'album', title: '双城记', caption: '两个人的影集', params: { camera: 'iPhone 15 Pro' }, media: [IMG(10), IMG(11)], visibility: 'private' };
    const r2 = await put(`/api/social/works/${wCo}`, A.token, body);
    expect(r2.status).toBe(409);
    const e = (await J(r2)).error;
    expect(e.code).toBe('media_impact');
    expect(e.details.items).toMatchObject([{ url: IMG(12).url, uploadedBy: 'ben_l18' }]);
    expect((await put(`/api/social/works/${wCo}`, A.token, { ...body, confirmMediaRemoval: true })).status).toBe(200);
  });
  it('修订历史：列表 / 单个版本 / 恢复（编辑者恢复保留可见范围）；外人看不到', async () => {
    const list = await J(await get(`/api/social/works/${wCo}/revisions`, B.token));
    expect(list.revisions.length).toBe(3);
    expect(list.revisions.at(-1).changes).toEqual(['创建']);
    expect(list.revisions[1].changes).toEqual(expect.arrayContaining(['标题', '图片']));
    expect(list.revisions[1].editor.username).toBe('ben_l18');
    expect((await get(`/api/social/works/${wCo}/revisions`, C.token)).status).toBe(404);
    expect((await get(`/api/social/works/${wCo}/revisions/1`, A.token)).status).toBe(200);
    // 恢复到第 1 版（标题「双城」）
    const r = await post(`/api/social/works/${wCo}/revisions/1/restore`, B.token);
    expect(r.status).toBe(200);
    expect((await J(r)).work.title).toBe('双城');
    const after = await J(await get(`/api/social/works/${wCo}/revisions`, A.token));
    expect(after.revisions[0].note).toBe('恢复到第 1 版');
    expect(after.current).toBe(4);
  });
  it('恢复旧版本不能绕过审核：未建立信誉的作者恢复已发布作品 → 重新进入待审核', async () => {
    const wR = (await J(await post('/api/social/works', C.token, photo({ title: '第一版' })))).work.id;
    expect((await put(`/api/social/works/${wR}`, C.token, photo({ title: '第二版' }))).status).toBe(200);
    expect((await adm('/api/admin/ugc/rules', { reviewFirstN: 50 }, 'PUT')).status).toBe(200);
    const r = await post(`/api/social/works/${wR}/revisions/1/restore`, C.token);
    expect(r.status).toBe(200);
    const w = (await J(r)).work;
    expect(w.title).toBe('第一版');
    expect(w.status).toBe('pending');
    expect((await get(`/api/social/works/${wR}`)).status).toBe(404);
    expect((await adm('/api/admin/ugc/rules', { reviewFirstN: 0 }, 'PUT')).status).toBe(200);
  });
  it('移除共同作者保留署名（曾参与）且失去编辑权；所有者发布后公开署名', async () => {
    expect((await call(env, `/api/social/works/${wCo}`, { method: 'PUT', token: A.token, body: { type: 'album', title: '双城', caption: '两个人的影集', params: { camera: 'iPhone 15 Pro' }, media: [IMG(10), IMG(11)], visibility: 'public' } })).status).toBe(200);
    expect((await post(`/api/social/works/${wCo}/publish`, A.token)).status).toBe(200);
    const r = await del(`/api/social/works/${wCo}/coauthors/ben_l18`, A.token);
    expect(r.status).toBe(200);
    expect((await J(r)).coauthors).toMatchObject([{ user: { username: 'ben_l18' }, status: 'removed' }]);
    const pub = (await J(await get(`/api/social/works/${wCo}`))).work;
    expect(pub.coauthors).toMatchObject([{ user: { username: 'ben_l18' }, status: 'removed' }]);
    expect((await put(`/api/social/works/${wCo}`, B.token, { type: 'album', title: 'x', media: [IMG(10), IMG(11)] })).status).toBe(403);
    // 婉拒
    await post(`/api/social/works/${wCo}/coauthors`, A.token, { username: 'cat_l18', role: 'contributor' });
    expect((await post(`/api/social/invitations/work/${wCo}/decline`, C.token)).status).toBe(200);
    expect((await J(await get(`/api/social/works/${wCo}`))).work.coauthors.map((c: any) => c.user.username)).toEqual(['ben_l18']);
  });
});

describe('L18 项目页', () => {
  it('创建 / 读取 / 校验 / 地址唯一；私密项目对外 404', async () => {
    expect((await post('/api/social/projects', A.token, { slug: 'lumen', title: 'Lumen', repoUrl: 'https://example.com/x' })).status).toBe(400);
    const r = await post('/api/social/projects', A.token, { slug: 'lumen', title: 'Lumen 相机', tagline: '手机上的胶片模拟', description: '一个 Android 相机应用', repoUrl: 'https://github.com/HarrisonCN/Lumen' });
    expect(r.status).toBe(201);
    const p = (await J(r)).project;
    expect(p.repo).toEqual({ url: 'https://github.com/HarrisonCN/Lumen', owner: 'HarrisonCN', name: 'Lumen' });
    expect((await post('/api/social/projects', B.token, { slug: 'lumen', title: 'x' })).status).toBe(409);
    await post('/api/social/projects', A.token, { slug: 'secret-x', title: '秘密', visibility: 'private' });
    expect((await get('/api/social/projects/secret-x', B.token)).status).toBe(404);
    expect((await get('/api/social/projects')).status).toBe(200);
    expect((await J(await get('/api/social/projects'))).projects.map((x: any) => x.slug)).toEqual(['lumen']);
  });
  it('开发日志 / 版本发布 / 关联作品与文章；不可见作品不显示', async () => {
    expect((await post('/api/social/projects/lumen/logs', A.token, { kind: 'release', title: '首个版本' })).status).toBe(400);
    await post('/api/social/projects/lumen/logs', A.token, { kind: 'log', title: '对焦算法', body: '改成了相位对焦' });
    const r = await post('/api/social/projects/lumen/logs', A.token, { kind: 'release', title: '首个版本', version: '0.1.0', body: '- 胶片模拟' });
    expect(r.status).toBe(201);
    const p = (await J(r)).project;
    expect(p.latestRelease.version).toBe('0.1.0');
    expect(p.logs.map((l: any) => l.kind)).toEqual(['release', 'log']);
    const post0 = await env.DB.prepare("SELECT slug FROM posts WHERE status = 'published' LIMIT 1").first<{ slug: string }>();
    const lr = await put('/api/social/projects/lumen/links', A.token, { links: [{ kind: 'work', ref: String(wA) }, { kind: 'post', ref: post0!.slug }] });
    expect(lr.status).toBe(200);
    expect((await J(lr)).project.links.map((l: any) => l.kind)).toEqual(['work', 'post']);
    expect((await put('/api/social/projects/lumen/links', A.token, { links: [{ kind: 'post', ref: 'no-such-post' }] })).status).toBe(400);
    await del(`/api/social/works/${wA}`, A.token);
    expect((await J(await get('/api/social/projects/lumen'))).project.links.map((l: any) => l.kind)).toEqual(['post']);
  });
  it('成员：邀请 → 接受 → 可编辑可写日志，不能改可见范围或删除；移除后保留署名', async () => {
    const r = await post('/api/social/projects/lumen/members', A.token, { username: 'ben_l18', role: 'editor', label: '算法' });
    expect(r.status).toBe(201);
    expect((await patch('/api/social/projects/lumen', B.token, { tagline: 'x' })).status).toBe(403);
    expect((await J(await get('/api/social/me/invitations', B.token))).invitations[0]).toMatchObject({ kind: 'project', title: 'Lumen 相机' });
    const pid = (await J(await get('/api/social/me/invitations', B.token))).invitations[0].id;
    expect((await post(`/api/social/invitations/project/${pid}/accept`, B.token)).status).toBe(200);
    const u = await patch('/api/social/projects/lumen', B.token, { tagline: '胶片感手机相机', visibility: 'private' });
    expect(u.status).toBe(200);
    expect((await J(u)).project).toMatchObject({ tagline: '胶片感手机相机', visibility: 'public' });
    expect((await post('/api/social/projects/lumen/logs', B.token, { title: 'Ben 的日志' })).status).toBe(201);
    expect((await del('/api/social/projects/lumen', B.token)).status).toBe(403);
    expect((await J(await get('/api/social/users/ben_l18/projects'))).projects.map((x: any) => x.slug)).toEqual(['lumen']);
    const rm = await del('/api/social/projects/lumen/members/ben_l18', A.token);
    expect((await J(rm)).project.members).toMatchObject([{ user: { username: 'ben_l18' }, status: 'removed', label: '算法' }]);
    expect((await patch('/api/social/projects/lumen', B.token, { tagline: 'y' })).status).toBe(403);
  });
});

describe('L18 摄影专题', () => {
  let w1 = 0;
  it('只能用自己公开的摄影作品；草稿对外 404；发布后公开；作品隐藏后自动不显示', async () => {
    w1 = (await J(await post('/api/social/works', A.token, photo({ title: '晨雾', media: [IMG(20)] })))).work.id;
    expect((await post('/api/social/features', A.token, { slug: 'river', title: '江边', blocks: [{ t: 'work', id: wCam }] })).status).toBe(400);
    const r = await post('/api/social/features', A.token, { slug: 'river', title: '江边一年', dek: '同一个机位的四季', blocks: [{ t: 'text', text: '开篇' }, { t: 'work', id: w1, caption: '一月' }, { t: 'work', id: wCo, caption: '合作' }] });
    expect(r.status).toBe(201);
    expect((await get('/api/social/features/river')).status).toBe(404);
    expect((await post('/api/social/features/river/publish', A.token)).status).toBe(200);
    const f = (await J(await get('/api/social/features/river'))).feature;
    expect(f.blocks.map((b: any) => b.t)).toEqual(['text', 'work', 'work']);
    expect(f.cover.url).toBe(IMG(20).url);
    expect((await J(await get('/api/social/features'))).features.map((x: any) => x.slug)).toEqual(['river']);
    expect((await patch('/api/social/features/river', B.token, { title: 'x' })).status).toBe(403);
    await call(env, `/api/social/works/${w1}`, { method: 'PUT', token: A.token, body: photo({ title: '晨雾', media: [IMG(20)], visibility: 'private' }) });
    expect((await J(await get('/api/social/features/river'))).feature.blocks.length).toBe(2);
    expect((await J(await get('/api/social/features/river', A.token))).feature.blocks.length).toBe(3); // 所有者仍看得到自己的私密作品
    await del(`/api/social/works/${w1}`, A.token);
    expect((await J(await get('/api/social/features/river', A.token))).feature.hidden).toBe(1);
  });
});

describe('L18 数据中心', () => {
  it('浏览量按天汇总：作者本人不计、私密内容不计、来源只留域名；只有本人能看', async () => {
    const v = (body: unknown, token?: string) => call(env, '/api/social/views', { method: 'POST', token, body });
    expect((await J(await v({ kind: 'work', ref: String(wCam), referrer: 'https://www.xiaohongshu.com/explore/123?x=1' }))).counted).toBe(true);
    expect((await J(await v({ kind: 'work', ref: String(wCam), referrer: '' }))).counted).toBe(true);
    expect((await J(await v({ kind: 'work', ref: String(wCam) }, B.token))).counted).toBe(false); // 本人
    expect((await J(await v({ kind: 'feature', ref: 'river' }))).counted).toBe(true);
    expect((await J(await v({ kind: 'project', ref: 'secret-x' }))).counted).toBe(false);
    expect((await v({ kind: 'nope', ref: 'x' })).status).toBe(400);
    // 互动
    await post(`/api/social/works/${wCam}/reactions`, A.token, { kind: 'like' });
    await post(`/api/social/works/${wCam}/bookmark`, A.token);
    await post(`/api/social/works/${wCam}/comments`, C.token, { body: '漂亮' });
    await post('/api/social/users/ben_l18/follow', A.token);
    const s = await J(await get('/api/social/me/stats?days=7', B.token));
    expect(s.private.views.total).toBe(2);
    expect(s.private.views.series.length).toBe(7);
    expect(s.private.referrers).toEqual([{ domain: 'xiaohongshu.com', n: 1 }, { domain: '', n: 1 }]);
    expect(s.private.top[0]).toMatchObject({ kind: 'work', ref: String(wCam), views: 2 });
    expect(s.trends.reactions.total).toBe(1);
    expect(s.trends.bookmarks.total).toBe(1);
    expect(s.trends.comments.total).toBe(1);
    expect(s.trends.followers.gained).toBeGreaterThanOrEqual(0);
    expect(s.privacy).toMatch(/不保存 IP/);
    expect((await get('/api/social/me/stats?days=5', B.token)).status).toBe(400);
    expect((await get('/api/social/me/stats')).status).toBe(401);
    // 公开作品接口不包含浏览量
    expect(JSON.stringify(await J(await get(`/api/social/works/${wCam}`)))).not.toMatch(/views/);
    const raw = await env.DB.prepare('SELECT * FROM stats_daily').all();
    expect(Object.keys(raw.results[0] as object).sort()).toEqual(['day', 'kind', 'owner_id', 'ref', 'views']);
  });
  it('导出包含 L18 数据；注销清除', async () => {
    const ex = await J(await get('/api/social/me/export', A.token));
    expect(ex.projects.map((p: any) => p.slug)).toContain('lumen');
    expect(ex.photoFeatures.map((p: any) => p.slug)).toEqual(['river']);
    expect((await post('/api/social/me/delete', A.token, { confirm: 'ada_l18' })).status).toBe(200);
    expect((await get('/api/social/projects/lumen')).status).toBe(404);
    expect((await get('/api/social/features/river')).status).toBe(404);
  });
});
