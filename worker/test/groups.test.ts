// L28 兴趣社群（小组）：Worker 与前端共用 group-core（逐字相同）；/api/social/groups 的角色权限、审核、分享、屏蔽、频率限制。
// D1 迁移 0021_groups.sql 在测试里由 miniflare 执行；正式库上的迁移 = SKIPPED-verifiable（Cloudflare 未部署）。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import { testOutbox } from '../src/community';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({ EMAIL_PROVIDER: 'memory' });
  admin = await login(env, '10.28.0.1');
  // 新会员的作品默认要先审核：这里关掉，便于测分享
  await call(env, '/api/admin/ugc/rules', { method: 'PUT', cookie: admin.cookie, csrf: admin.csrf, body: { reviewFirstN: 0 } });
});
afterAll(async () => {
  await call(env, '/api/admin/ugc/rules', { method: 'PUT', cookie: admin.cookie, csrf: admin.csrf, body: { reviewFirstN: 2 } });
  await disposeEnv();
});

const ip = (n: number) => ({ 'cf-connecting-ip': `10.28.1.${n}` });
const codeFor = (email: string) => /(\d{6})/.exec(testOutbox.filter((m) => m.to === email).at(-1)?.text ?? '')?.[1] ?? '';
type U = { token: string; id: number; username: string };
async function join(email: string, name: string, username: string, n: number): Promise<U> {
  expect((await call(env, '/api/members/register', { body: { name, email }, headers: ip(n) })).status).toBe(200);
  const b = (await (await call(env, '/api/members/verify', { body: { email, code: codeFor(email) } })).json()) as any;
  expect((await call(env, '/api/social/me', { method: 'PUT', token: b.token, body: { username } })).status).toBe(200);
  return { token: b.token, id: b.member.id, username };
}
const J = async (r: Response) => (await r.json()) as any;
const get = (path: string, token?: string) => call(env, path, { token });
const post = (path: string, token: string | undefined, body?: unknown) => call(env, path, { method: 'POST', token, body: body ?? {} });
const del = (path: string, token: string) => call(env, path, { method: 'DELETE', token });
const patch = (path: string, token: string, body: unknown) => call(env, path, { method: 'PATCH', token, body });

describe('group-core 共享', () => {
  it('Worker 与前端的 group-core.ts 逐字相同', () => {
    expect(readFileSync(pjoin(__dirname, '../src/group-core.ts'), 'utf8')).toBe(readFileSync(pjoin(__dirname, '../../web/src/group-core.ts'), 'utf8'));
  });
  it('迁移 0021 只做加法（CREATE TABLE / INDEX）', () => {
    const sql = readFileSync(pjoin(__dirname, '../migrations/0021_groups.sql'), 'utf8').replace(/--.*$/gm, '');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS groups/);
    expect(sql).not.toMatch(/\b(DROP|ALTER|DELETE|UPDATE)\b/i);
  });
});

describe('/api/social/groups', () => {
  let a: U, b: U, c: U;
  beforeAll(async () => {
    a = await join('g28a@example.com', '组长甲', 'g28_owner', 1);
    b = await join('g28b@example.com', '成员乙', 'g28_member', 2);
    c = await join('g28c@example.com', '路人丙', 'g28_other', 3);
  });
  it('创建：校验、唯一网址、游客 401', async () => {
    expect((await post('/api/social/groups', undefined, { slug: 'g28-film', name: '胶片' })).status).toBe(401);
    expect((await post('/api/social/groups', a.token, { slug: 'X', name: '胶片' })).status).toBe(400);
    const r = await post('/api/social/groups', a.token, { slug: 'g28-film', name: '胶片', intro: '演示', joinPolicy: 'approval' });
    expect(r.status).toBe(201);
    expect((await J(r)).group).toMatchObject({ slug: 'g28-film', myRole: 'owner', members: 1, joinPolicy: 'approval' });
    expect((await post('/api/social/groups', b.token, { slug: 'g28-film', name: '重复' })).status).toBe(409);
    const list = await J(await get('/api/social/groups'));
    expect(list.groups.some((g: any) => g.slug === 'g28-film')).toBe(true);
  });
  it('审核小组：申请 → 只有管理层看到申请 → 通过；成员不能审核', async () => {
    expect((await J(await post('/api/social/groups/g28-film/join', b.token))).state).toBe('pending');
    expect((await J(await get('/api/social/groups/g28-film/members', b.token))).pending).toEqual([]);
    const m = await J(await get('/api/social/groups/g28-film/members', a.token));
    expect(m.pending.map((x: any) => x.username)).toEqual(['g28_member']);
    expect((await J(await get('/api/social/groups/g28-film', a.token))).group.pending).toBe(1);
    expect((await post('/api/social/groups/g28-film/members/g28_member', c.token, { action: 'approve' })).status).toBe(403);
    expect((await post('/api/social/groups/g28-film/members/g28_member', a.token, { action: 'approve' })).status).toBe(200);
    expect((await J(await get('/api/social/groups/g28-film', b.token))).group.myRole).toBe('member');
    expect((await post('/api/social/groups/g28-film/members/g28_member', a.token, { action: 'approve' })).status).toBe(403);
  });
  it('分享：只能分享自己已发布的公开作品；非成员不能；重复 409；动态可见', async () => {
    const w = await J(await post('/api/social/works', b.token, { type: 'short', body: 'L28 小组分享测试', visibility: 'public' }));
    const wid = w.work.id;
    expect((await post('/api/social/groups/g28-film/feed', c.token, { workId: wid })).status).toBe(403);
    expect((await post('/api/social/groups/g28-film/feed', a.token, { workId: wid })).status).toBe(404);
    expect((await post('/api/social/groups/g28-film/feed', b.token, { workId: wid })).status).toBe(201);
    expect((await post('/api/social/groups/g28-film/feed', b.token, { workId: wid })).status).toBe(409);
    const priv = await J(await post('/api/social/works', b.token, { type: 'short', body: '私密', visibility: 'private' }));
    expect((await post('/api/social/groups/g28-film/feed', b.token, { workId: priv.work.id })).status).toBe(409);
    const f = await J(await get('/api/social/groups/g28-film/feed'));
    expect(f.items.map((x: any) => x.work.id)).toEqual([wid]);
    expect(f.items[0].sharedBy.username).toBe('g28_member');
    // 屏蔽作者的人看不到这条
    expect((await post(`/api/social/blocks/g28_member`, c.token)).status).toBe(200);
    expect((await J(await get('/api/social/groups/g28-film/feed', c.token))).items).toEqual([]);
    await del('/api/social/blocks/g28_member', c.token);
  });
  it('公告：成员不能改，组长可以；修改资料只有组长', async () => {
    expect((await patch('/api/social/groups/g28-film', b.token, { notice: 'x' })).status).toBe(403);
    expect((await J(await patch('/api/social/groups/g28-film', a.token, { notice: '周六扫街' }))).group.notice).toBe('周六扫街');
    expect((await patch('/api/social/groups/g28-film', a.token, { slug: 'new' })).status).toBe(400);
  });
  it('任免管理员：管理员可以审核但不能任免；不能动组长', async () => {
    expect((await post('/api/social/groups/g28-film/members/g28_member', a.token, { action: 'role', role: 'mod' })).status).toBe(200);
    expect((await J(await get('/api/social/groups/g28-film', b.token))).group.myRole).toBe('mod');
    expect((await post('/api/social/groups/g28-film/members/g28_owner', b.token, { action: 'kick' })).status).toBe(403);
    expect((await J(await post('/api/social/groups/g28-film/join', c.token))).state).toBe('pending');
    expect((await post('/api/social/groups/g28-film/members/g28_other', b.token, { action: 'reject' })).status).toBe(200);
    expect((await J(await get('/api/social/groups/g28-film', c.token))).group.myRole).toBe('none');
  });
  it('屏蔽：被组长屏蔽的人不能加入；组长不能退出；移出后身份为 none', async () => {
    expect((await post('/api/social/blocks/g28_other', a.token)).status).toBe(200);
    expect((await post('/api/social/groups/g28-film/join', c.token)).status).toBe(403);
    await del('/api/social/blocks/g28_other', a.token);
    expect((await del('/api/social/groups/g28-film/join', a.token)).status).toBe(409);
    expect((await post('/api/social/groups/g28-film/members/g28_member', a.token, { action: 'kick' })).status).toBe(200);
    expect((await J(await get('/api/social/groups/g28-film', b.token))).group.myRole).toBe('none');
  });
  it('解散：只有组长；之后 404', async () => {
    expect((await del('/api/social/groups/g28-film', b.token)).status).toBe(403);
    expect((await del('/api/social/groups/g28-film', a.token)).status).toBe(200);
    expect((await get('/api/social/groups/g28-film')).status).toBe(404);
  });
  it('注销账号：本人是组长的小组解散，成员关系一并清除', async () => {
    const d = await join('g28d@example.com', '组长丁', 'g28_purge', 4);
    expect((await post('/api/social/groups', d.token, { slug: 'g28-purge', name: '临时小组' })).status).toBe(201);
    expect((await J(await post('/api/social/groups/g28-purge/join', b.token))).state).toBe('member');
    const ex = await J(await get('/api/social/me/export', d.token));
    expect(ex.groups.map((g: any) => g.slug)).toEqual(['g28-purge']);
    expect((await post('/api/social/me/delete', d.token, { confirm: 'g28_purge' })).status).toBe(200);
    expect((await get('/api/social/groups/g28-purge')).status).toBe(404);
  });
});
