import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import { testOutbox } from '../src/community';
import { hasGps } from '../src/exif';
import type { Env } from '../src/env';
import { checkModAction, checkWork, contentFingerprint, countLinks, needsReview, workAccess } from '../src/ugc-core';

const fx = (n: string) => new Uint8Array(readFileSync(new URL(`../../web/test/fixtures/exif/${n}`, import.meta.url)));
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89]);

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({ EMAIL_PROVIDER: 'memory' });
  admin = await login(env, '10.16.0.1');
});
afterAll(disposeEnv);

const ip = (n: number) => ({ 'cf-connecting-ip': `10.16.1.${n}` });
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
const adm = (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => call(env, path, { method, cookie: admin.cookie, csrf: admin.csrf, body });
const notes = async (u: U, filter = 'all') => (await J(await get(`/api/social/notifications?filter=${filter}`, u.token))).notifications as any[];

let A: U, B: U, C: U, D: U;
let upUrl = '';
const photo = (o: Record<string, unknown> = {}) => ({ type: 'photo', title: '漓江夜色', caption: '夜里十点的江面', notes: '三脚架 + 长曝光', params: { camera: 'Fujifilm X-T5', aperture: 'f/8', shutter: '15s', iso: '160' }, media: [{ url: upUrl, alt: '夜色中的江面和山影', width: 1600, height: 1067 }], visibility: 'public', ...o });

describe('ugc-core 纯函数', () => {
  it('按类型校验：alt 必填、图片数量、标题', () => {
    const img = { url: '/api/images/2026/10/0b8c5d0e-1111-4222-8333-944445555666.jpg', alt: 'x', width: 10, height: 10 };
    expect(checkWork({ type: 'short', body: '你好' }).ok).toBe(true);
    expect(checkWork({ type: 'short', body: '' }).ok).toBe(false);
    expect(checkWork({ type: 'short', title: 'x', body: 'y' }).ok).toBe(false);
    expect(checkWork({ type: 'article', body: 'y' }).ok).toBe(false);
    const noAlt = checkWork({ type: 'photo', media: [{ ...img, alt: ' ' }] });
    expect(!noAlt.ok && noAlt.path).toBe('media.0.alt');
    expect(checkWork({ type: 'photo', media: [img, img] }).ok).toBe(false);
    expect(checkWork({ type: 'album', title: '组图', media: [img] }).ok).toBe(false);
    expect(checkWork({ type: 'album', title: '组图', media: [img, img] }).ok).toBe(true);
    expect(checkWork({ type: 'photo', media: [{ ...img, url: 'javascript:alert(1)' }] }).ok).toBe(false);
    expect(checkWork({ type: 'photo', media: [{ ...img, url: 'data:image/png;base64,AAAA' }] }).ok).toBe(false);
    expect(checkWork({ type: 'photo', media: [{ ...img, url: 'data:image/png;base64,AAAA' }] }, { allowDataUrl: true }).ok).toBe(true);
    expect(checkWork({ type: 'short', body: 'x', params: { iso: '100' } }).ok).toBe(false);
    expect(checkWork({ type: 'short', body: 'x', visibility: 'members' }).ok).toBe(false);
  });
  it('可见范围矩阵', () => {
    const base = { authorId: 1, status: 'published' as const, visibility: 'public' as const, modState: 'ok' as const, deleted: false, authorBanned: false, viewerId: 2, viewerFollowsAuthor: false, blockedEitherWay: false };
    expect(workAccess(base)).toBe('full');
    expect(workAccess({ ...base, viewerId: null })).toBe('full');
    expect(workAccess({ ...base, visibility: 'followers' })).toBe('none');
    expect(workAccess({ ...base, visibility: 'followers', viewerFollowsAuthor: true })).toBe('full');
    expect(workAccess({ ...base, visibility: 'private', viewerFollowsAuthor: true })).toBe('none');
    expect(workAccess({ ...base, status: 'pending' })).toBe('none');
    expect(workAccess({ ...base, status: 'draft', viewerId: 1 })).toBe('own');
    expect(workAccess({ ...base, modState: 'hidden' })).toBe('none');
    expect(workAccess({ ...base, modState: 'hidden', viewerId: 1 })).toBe('own');
    expect(workAccess({ ...base, deleted: true, viewerId: 1 })).toBe('none');
    expect(workAccess({ ...base, blockedEitherWay: true })).toBe('none');
    expect(workAccess({ ...base, authorBanned: true })).toBe('none');
  });
  it('反垃圾与审核规则', () => {
    expect(countLinks('看 https://a.com 和 http://b.cn/x 还有 www.c.org')).toBe(3);
    const a = contentFingerprint({ title: 'Hi', body: '你 好！', caption: '', media: [] });
    expect(contentFingerprint({ title: 'hi', body: '你好', caption: '', media: [] })).toBe(a);
    expect(needsReview({ approved: 1, reputation: 5, banned: false }, { reviewFirstN: 2, maxLinks: 3 })).toBe(true);
    expect(needsReview({ approved: 2, reputation: -1, banned: false }, { reviewFirstN: 2, maxLinks: 3 })).toBe(true);
    expect(needsReview({ approved: 2, reputation: 0, banned: false }, { reviewFirstN: 2, maxLinks: 3 })).toBe(false);
    expect(checkModAction({ targetKind: 'work', targetId: 1, action: 'ban' }).ok).toBe(false);
    expect(checkModAction({ targetKind: 'user', targetId: 1, action: 'ban' }).ok).toBe(true);
  });
});

describe('L16 发布：上传 / 草稿 / 审核 / 动态流 / 通知', () => {
  it('四个会员；B 关注 A', async () => {
    A = await join('a-l16@example.com', 'Ada', 'ada_lens', 1);
    B = await join('b-l16@example.com', 'Ben', 'ben_frames', 2);
    C = await join('c-l16@example.com', 'Cat', 'cat_walks', 3);
    D = await join('d-l16@example.com', 'Dan', 'dan_spam', 4);
    expect((await post(`/api/social/follows/${A.username}`, B.token)).status).toBe(200);
  });

  it('图片上传：复用大小 / 类型 / 文件签名校验，去掉 GPS；未登录 401', async () => {
    expect((await call(env, '/api/social/uploads', { method: 'POST', raw: PNG, headers: { 'content-type': 'image/png' } })).status).toBe(401);
    const lie = await call(env, '/api/social/uploads', { method: 'POST', token: A.token, raw: '<svg onload=alert(1)>', headers: { 'content-type': 'image/svg+xml' } });
    expect(lie.status).toBe(415);
    const src = fx('iphone-gps.jpg');
    expect(hasGps(src)).toBe(true);
    const form = new FormData();
    form.set('file', new File([src], 'p.jpg', { type: 'image/jpeg' }));
    const up = await call(env, '/api/social/uploads', { method: 'POST', token: A.token, raw: form });
    expect(up.status).toBe(201);
    upUrl = (await J(up)).url;
    expect(upUrl).toMatch(/^\/api\/images\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/);
    const got = new Uint8Array(await (await get(upUrl)).arrayBuffer());
    expect(hasGps(got)).toBe(false);
  });

  let w1 = 0;
  it('草稿：只有作者能看；发布后新会员进入待审核（不公开）', async () => {
    const noAlt = await post('/api/social/works', A.token, photo({ media: [{ url: upUrl, alt: '', width: 1, height: 1 }] }));
    expect(noAlt.status).toBe(400);
    expect((await J(noAlt)).error.details[0].path).toBe('media.0.alt');
    const r = await post('/api/social/works', A.token, { ...photo(), draft: true });
    expect(r.status).toBe(201);
    const b = await J(r);
    w1 = b.work.id;
    expect(b.status).toBe('draft');
    expect((await get(`/api/social/works/${w1}`)).status).toBe(404);
    expect((await get(`/api/social/works/${w1}`, B.token)).status).toBe(404);
    expect((await get(`/api/social/works/${w1}`, A.token)).status).toBe(200);
    const pub = await J(await post(`/api/social/works/${w1}/publish`, A.token));
    expect(pub.status).toBe('pending');
    expect((await get(`/api/social/works/${w1}`)).status).toBe(404);
    expect((await get(`/api/social/works/${w1}`, B.token)).status).toBe(404);
    const latest = await J(await get('/api/social/works?tab=latest'));
    expect(latest.works.some((w: any) => w.id === w1)).toBe(false);
    expect((await notes(B, 'new_work')).length).toBe(0);
  });

  it('后台：非管理员 401；待审队列里有它；通过 → 审核日志 + 关注者收到「新作品」+ 作者收到审核结果', async () => {
    expect((await get('/api/admin/ugc/queue?view=pending', B.token)).status).toBe(401);
    expect((await call(env, '/api/admin/ugc/queue?view=pending')).status).toBe(401);
    const q = await J(await adm('/api/admin/ugc/queue?view=pending'));
    expect(q.items.some((i: any) => i.kind === 'work' && i.id === w1)).toBe(true);
    expect(q.counts.pending).toBeGreaterThanOrEqual(1);
    const noCsrf = await call(env, '/api/admin/ugc/actions', { method: 'POST', cookie: admin.cookie, body: { targetKind: 'work', targetId: w1, action: 'approve' } });
    expect(noCsrf.status).toBe(403);
    const ok = await adm('/api/admin/ugc/actions', { targetKind: 'work', targetId: w1, action: 'approve' });
    expect(ok.status).toBe(200);
    const log = await J(await adm('/api/admin/ugc/log'));
    expect(log.actions.some((a: any) => a.action === 'approve' && a.targetId === w1 && a.actor === 'admin')).toBe(true);
    expect(log.actions.some((a: any) => a.action === 'auto_pending' && a.targetId === w1 && a.actor === 'system')).toBe(true);
    const nb = await notes(B, 'new_work');
    expect(nb.length).toBe(1);
    expect(nb[0].type).toBe('new_work');
    expect(nb[0].objectRef).toBe(String(w1));
    expect(nb[0].actor.username).toBe(A.username);
    expect((await notes(A)).some((n) => n.type === 'moderation')).toBe(true);
    // 再次通过（409）不会重复通知
    expect((await adm('/api/admin/ugc/actions', { targetKind: 'work', targetId: w1, action: 'approve' })).status).toBe(409);
    expect((await notes(B, 'new_work')).length).toBe(1);
  });

  it('关注者在「关注」流和「最新」流都能看到；游客能看公开作品；按类型筛选', async () => {
    const f = await J(await get('/api/social/works?tab=following', B.token));
    expect(f.works[0].id).toBe(w1);
    expect(f.works[0].params.camera).toBe('Fujifilm X-T5');
    expect(f.works[0].media[0].alt).toBe('夜色中的江面和山影');
    expect((await get('/api/social/works?tab=following')).status).toBe(401);
    const anon = await J(await get('/api/social/works?tab=latest&type=photo'));
    expect(anon.works.some((w: any) => w.id === w1)).toBe(true);
    const shorts = await J(await get('/api/social/works?tab=latest&type=short'));
    expect(shorts.works.some((w: any) => w.id === w1)).toBe(false);
    expect((await get('/api/social/works?tab=hot')).status).toBe(400);
    expect((await get(`/api/social/works/${w1}`)).status).toBe(200);
    // 主页作品列表 = 真正的作品
    const prof = await J(await get(`/api/social/users/${A.username}`));
    expect(prof.works[0]).toMatchObject({ kind: 'work', id: w1, type: 'photo' });
    expect(prof.profile.counts.works).toBe(1);
  });

  let c1 = 0;
  it('评论：新会员评论先审核（不沿用「好朋友评论直接公开」），通过后作者收到回复通知', async () => {
    const r = await post(`/api/social/works/${w1}/comments`, B.token, { body: '太美了 @ada_lens' });
    expect(r.status).toBe(201);
    const b = await J(r);
    c1 = b.comment.id;
    expect(b.status).toBe('pending');
    expect((await J(await get(`/api/social/works/${w1}/comments`))).comments.length).toBe(0);
    expect((await J(await get(`/api/social/works/${w1}/comments`, B.token))).comments[0].pending).toBe(true);
    expect((await notes(A, 'reply')).length).toBe(0);
    expect((await adm('/api/admin/ugc/actions', { targetKind: 'comment', targetId: c1, action: 'approve' })).status).toBe(200);
    const cs = await J(await get(`/api/social/works/${w1}/comments`));
    expect(cs.comments[0].body).toBe('太美了 @ada_lens');
    const ra = await notes(A, 'reply');
    expect(ra.length).toBe(1);
    expect(ra[0].objectKind).toBe('work');
    // 作者自己在作品下回复不需要审核，并回复给 B
    const rep = await J(await post(`/api/social/works/${w1}/comments`, A.token, { body: '谢谢！', parentId: c1 }));
    expect(rep.status).toBe('published');
    expect((await notes(B, 'reply')).length).toBe(1);
  });

  it('回应：唯一约束（重复不加计数）、聚合通知；收藏触发 L15 的收藏通知', async () => {
    let r = await J(await post(`/api/social/works/${w1}/reactions`, B.token, { kind: 'like' }));
    expect(r.reactions.like).toBe(1);
    r = await J(await post(`/api/social/works/${w1}/reactions`, B.token, { kind: 'like' }));
    expect(r.reactions.like).toBe(1);
    expect(r.mine).toEqual(['like']);
    await post(`/api/social/works/${w1}/reactions`, C.token, { kind: 'like' });
    const ns = await notes(A, 'reaction');
    expect(ns.length).toBe(1);
    expect(ns[0].count).toBe(2);
    expect((await post(`/api/social/works/${w1}/reactions`, B.token, { kind: 'poop' })).status).toBe(400);
    r = await J(await call(env, `/api/social/works/${w1}/reactions/like`, { method: 'DELETE', token: B.token }));
    expect(r.reactions.like).toBe(1);
    const bm = await J(await post(`/api/social/works/${w1}/bookmark`, B.token));
    expect(bm.bookmarked).toBe(true);
    await post(`/api/social/works/${w1}/bookmark`, B.token);
    const nb = await notes(A, 'bookmark');
    expect(nb.length).toBe(1);
    expect(nb[0].count).toBe(1);
    expect((await J(await get('/api/social/me/saved', B.token))).works[0].id).toBe(w1);
  });
});

describe('L16 权限：可见范围 / 越权编辑 / 删除', () => {
  let wf = 0;
  let wp = 0;
  it('管理员把 N 调成 1 后 A 直接发布；仅关注者 / 私密作品的读取隔离；提及只通知能看到的人', async () => {
    expect((await call(env, '/api/admin/ugc/rules', { method: 'PUT', cookie: admin.cookie, csrf: admin.csrf, body: { reviewFirstN: 50 + 1 } })).status).toBe(400);
    expect((await call(env, '/api/admin/ugc/rules', { method: 'PUT', cookie: admin.cookie, csrf: admin.csrf, body: { reviewFirstN: 1 } })).status).toBe(200);
    const r = await J(await post('/api/social/works', A.token, { type: 'short', body: '今晚出片 @ben_frames @cat_walks', visibility: 'followers' }));
    expect(r.status).toBe('published');
    wf = r.work.id;
    expect((await get(`/api/social/works/${wf}`, B.token)).status).toBe(200);
    expect((await get(`/api/social/works/${wf}`, C.token)).status).toBe(404);
    expect((await get(`/api/social/works/${wf}`)).status).toBe(404);
    expect((await J(await get('/api/social/works?tab=latest', C.token))).works.some((w: any) => w.id === wf)).toBe(false);
    expect((await J(await get('/api/social/works?tab=following', B.token))).works.some((w: any) => w.id === wf)).toBe(true);
    expect((await notes(B, 'mention')).some((n) => n.objectRef === String(wf))).toBe(true);
    expect((await notes(C, 'mention')).some((n) => n.objectRef === String(wf))).toBe(false);
    expect((await J(await get(`/api/social/users/${A.username}/works`, C.token))).works.some((w: any) => w.id === wf)).toBe(false);
    const p = await J(await post('/api/social/works', A.token, { type: 'article', title: '私密笔记', body: '只给自己', visibility: 'private' }));
    wp = p.work.id;
    expect((await get(`/api/social/works/${wp}`, B.token)).status).toBe(404);
    expect((await get(`/api/social/works/${wp}`, A.token)).status).toBe(200);
    expect((await notes(B, 'new_work')).some((n) => n.objectRef === String(wp))).toBe(false);
  });

  it('别人不能编辑 / 删除；看不到的内容返回 404 而不是 403；未登录 401', async () => {
    const w1 = (await J(await get('/api/social/works?tab=latest&type=photo'))).works[0].id;
    expect((await call(env, `/api/social/works/${w1}`, { method: 'PUT', token: B.token, body: photo() })).status).toBe(403);
    expect((await call(env, `/api/social/works/${w1}`, { method: 'DELETE', token: B.token })).status).toBe(403);
    expect((await call(env, `/api/social/works/${wp}`, { method: 'PUT', token: B.token, body: { type: 'article', title: 'x', body: 'y' } })).status).toBe(404);
    expect((await call(env, `/api/social/works/${wp}`, { method: 'DELETE', token: C.token })).status).toBe(404);
    expect((await call(env, `/api/social/works/${w1}`, { method: 'DELETE' })).status).toBe(401);
    expect((await post('/api/social/works', undefined, { type: 'short', body: 'x' })).status).toBe(401);
    expect((await post(`/api/social/works/${wf}/comments`, C.token, { body: '偷看' })).status).toBe(404);
    expect((await post(`/api/social/works/${wf}/reactions`, C.token, { kind: 'like' })).status).toBe(404);
    // 作者编辑：editedAt 记录；不能改类型
    const ed = await call(env, `/api/social/works/${wf}`, { method: 'PUT', token: A.token, body: { type: 'short', body: '今晚出片（改）', visibility: 'followers' } });
    expect(ed.status).toBe(200);
    expect((await J(ed)).work.editedAt).toBeTruthy();
    expect((await call(env, `/api/social/works/${wf}`, { method: 'PUT', token: A.token, body: { type: 'article', title: 'x', body: 'y' } })).status).toBe(400);
  });

  it('反垃圾：链接上限、重复投稿、评论链接上限', async () => {
    const spam = await post('/api/social/works', A.token, { type: 'short', body: 'https://a.cn https://b.cn https://c.cn https://d.cn' });
    expect(spam.status).toBe(400);
    expect((await J(spam)).error.code).toBe('too_many_links');
    expect((await post('/api/social/works', A.token, { type: 'short', body: '重复一下' })).status).toBe(201);
    const dup = await post('/api/social/works', A.token, { type: 'short', body: '重复 一下！' });
    expect(dup.status).toBe(409);
  });

  it('静音 / 拉黑：动态流里隐藏作者；被拉黑者读不到作品', async () => {
    await post(`/api/social/mutes/${A.username}`, B.token);
    expect((await J(await get('/api/social/works?tab=latest', B.token))).works.some((w: any) => w.author.username === A.username)).toBe(false);
    expect((await J(await get('/api/social/works?tab=following', B.token))).works.some((w: any) => w.author.username === A.username)).toBe(false);
    await call(env, `/api/social/mutes/${A.username}`, { method: 'DELETE', token: B.token });
    expect((await J(await get('/api/social/works?tab=latest', B.token))).works.some((w: any) => w.author.username === A.username)).toBe(true);
    await post(`/api/social/blocks/${D.username}`, A.token);
    const w1 = (await J(await get('/api/social/works?tab=latest&type=photo'))).works[0].id;
    expect((await get(`/api/social/works/${w1}`, D.token)).status).toBe(404);
    expect((await J(await get('/api/social/works?tab=latest', D.token))).works.some((w: any) => w.author.username === A.username)).toBe(false);
    await call(env, `/api/social/blocks/${D.username}`, { method: 'DELETE', token: A.token });
  });

  it('游标分页', async () => {
    const p1 = await J(await get('/api/social/works?tab=latest&limit=1'));
    expect(p1.works.length).toBe(1);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await J(await get(`/api/social/works?tab=latest&limit=1&cursor=${p1.nextCursor}`));
    expect(p2.works[0].id).not.toBe(p1.works[0].id);
    expect((await get('/api/social/works?cursor=@@')).status).toBe(400);
  });
});

describe('L16 举报 / 审核 / 删除 / 封禁', () => {
  let w1 = 0;
  it('举报进入队列；重复举报不重复入队；隐藏后公开 404、作者看到「已隐藏」；恢复', async () => {
    w1 = (await J(await get('/api/social/works?tab=latest&type=photo'))).works[0].id;
    const r = await post('/api/social/reports', C.token, { targetKind: 'work', targetId: w1, reason: 'copyright', detail: '这是我的照片' });
    expect(r.status).toBe(201);
    expect((await J(await post('/api/social/reports', C.token, { targetKind: 'work', targetId: w1, reason: 'copyright' }))).duplicate).toBe(true);
    expect((await post('/api/social/reports', A.token, { targetKind: 'work', targetId: w1, reason: 'spam' })).status).toBe(400);
    expect((await post('/api/social/reports', C.token, { targetKind: 'work', targetId: w1, reason: 'bad' })).status).toBe(400);
    const q = await J(await adm('/api/admin/ugc/queue?view=reports'));
    const item = q.items.find((i: any) => i.kind === 'work' && i.id === w1);
    expect(item.reports.length).toBe(1);
    expect(item.reports[0].reason).toBe('copyright');
    const h = await adm('/api/admin/ugc/actions', { targetKind: 'work', targetId: w1, action: 'hide', reason: '版权投诉', reportId: item.reports[0].id });
    expect(h.status).toBe(200);
    expect((await get(`/api/social/works/${w1}`)).status).toBe(404);
    expect((await get(`/api/social/works/${w1}`, B.token)).status).toBe(404);
    const own = await J(await get(`/api/social/works/${w1}`, A.token));
    expect(own.work.modState).toBe('hidden');
    expect(own.work.modReason).toBe('版权投诉');
    expect((await J(await adm('/api/admin/ugc/queue?view=reports'))).items.some((i: any) => i.id === w1 && i.kind === 'work')).toBe(false);
    const log = await J(await adm('/api/admin/ugc/log'));
    expect(log.actions[0]).toMatchObject({ action: 'hide', targetKind: 'work', targetId: w1, reason: '版权投诉', reportId: item.reports[0].id });
    expect((await J(await adm('/api/admin/ugc/queue?view=hidden'))).items.some((i: any) => i.id === w1)).toBe(true);
    expect((await adm('/api/admin/ugc/actions', { targetKind: 'work', targetId: w1, action: 'restore' })).status).toBe(200);
    expect((await get(`/api/social/works/${w1}`)).status).toBe(200);
  });

  it('作者删除 = 软删除（所有人 404，含作者）；管理员清除 = 硬删除；三者在日志里可区分', async () => {
    const d = await call(env, `/api/social/works/${w1}`, { method: 'DELETE', token: A.token });
    expect(d.status).toBe(200);
    expect((await get(`/api/social/works/${w1}`, A.token)).status).toBe(404);
    expect((await get(`/api/social/works/${w1}`)).status).toBe(404);
    const row = await env.DB.prepare('SELECT deleted_at FROM user_posts WHERE id = ?').bind(w1).first<{ deleted_at: string }>();
    expect(row?.deleted_at).toBeTruthy();
    expect((await adm('/api/admin/ugc/actions', { targetKind: 'work', targetId: w1, action: 'purge', reason: '清理' })).status).toBe(200);
    expect(await env.DB.prepare('SELECT id FROM user_posts WHERE id = ?').bind(w1).first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM user_post_media WHERE post_id = ?').bind(w1).first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM user_post_comments WHERE post_id = ?').bind(w1).first()).toBeNull();
    const log = await J(await adm('/api/admin/ugc/log?limit=50'));
    expect(log.actions.map((a: any) => a.action)).toEqual(expect.arrayContaining(['hide', 'restore', 'purge', 'approve', 'rules']));
  });

  it('封禁：不能发布 / 评论 / 回应；已发布内容从公开读取消失；解封后恢复', async () => {
    const r = await J(await post('/api/social/works', D.token, { type: 'short', body: '大家好，我是 Dan' }));
    expect(r.status).toBe('pending'); // N = 1，D 还没有通过审核的内容
    await adm('/api/admin/ugc/actions', { targetKind: 'work', targetId: r.work.id, action: 'approve' });
    expect((await get(`/api/social/works/${r.work.id}`)).status).toBe(200);
    const ban = await adm('/api/admin/ugc/actions', { targetKind: 'user', targetId: D.id, action: 'ban', reason: '刷屏' });
    expect(ban.status).toBe(200);
    expect((await adm('/api/admin/ugc/actions', { targetKind: 'work', targetId: r.work.id, action: 'ban' })).status).toBe(400);
    const blocked = await post('/api/social/works', D.token, { type: 'short', body: '再来一条' });
    expect(blocked.status).toBe(403);
    expect((await J(blocked)).error.code).toBe('banned');
    const w = (await J(await get('/api/social/works?tab=latest', B.token))).works[0];
    expect((await post(`/api/social/works/${w.id}/reactions`, D.token, { kind: 'like' })).status).toBe(403);
    expect((await get(`/api/social/works/${r.work.id}`)).status).toBe(404);
    expect((await J(await get('/api/social/works?tab=latest'))).works.some((x: any) => x.author.username === D.username)).toBe(false);
    expect((await J(await adm('/api/admin/ugc/queue?view=banned'))).items.some((i: any) => i.id === D.id)).toBe(true);
    await adm('/api/admin/ugc/actions', { targetKind: 'user', targetId: D.id, action: 'unban' });
    expect((await get(`/api/social/works/${r.work.id}`)).status).toBe(200);
    const log = await J(await adm('/api/admin/ugc/log'));
    expect(log.actions.slice(0, 2).map((a: any) => a.action)).toEqual(['unban', 'ban']);
  });

  it('注销账号：硬删除本人投稿；审核日志保留', async () => {
    const mine = await J(await get('/api/social/me/works', D.token));
    expect(mine.works.length).toBeGreaterThan(0);
    expect((await post('/api/social/me/delete', D.token, { confirm: D.username })).status).toBe(200);
    expect(await env.DB.prepare('SELECT 1 FROM user_posts WHERE author_id = ?').bind(D.id).first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM moderation_actions WHERE member_id = ?').bind(D.id).first()).not.toBeNull();
  });
});
