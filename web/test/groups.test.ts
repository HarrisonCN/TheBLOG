/**
 * L28 / v1.28.0 兴趣社群（小组）：
 * - 角色权限矩阵（表驱动）、对成员操作的高低规则、加入流程（开放 / 审核）、屏蔽关系；
 * - 动态可见性（屏蔽 / 静音的人看不到、同一作品只出现一次）；
 * - 演示 mock 与 Worker 同形状：创建、两人加入 / 审核、分享作品、公告、移出、举报走现有审核队列；
 * - 新路由 /groups/（社区 › 小组）与 /groups/:slug/。
 */
import { describe, expect, it } from 'vitest';
import { can, canActOn, canRemoveShare, checkGroup, checkGroupPatch, checkMemberAction, joinBlocked, joinResult, memberActionError, visibleShares, type Action, type Standing } from '../src/group-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_OTP, DEMO_PASSWORD } from '../src/demo/seed';

const ALL: Standing[] = ['owner', 'mod', 'member', 'pending', 'none'];
// 每个动作允许的身份（与 docs/groups.md 的表一致）
const TABLE: Record<Action, Standing[]> = {
  view: ['owner', 'mod', 'member', 'pending', 'none'],
  join: ['none'],
  leave: ['mod', 'member', 'pending'],
  post: ['owner', 'mod', 'member'],
  pin: ['owner', 'mod'],
  edit: ['owner'],
  review: ['owner', 'mod'],
  kick: ['owner', 'mod'],
  setRole: ['owner'],
  removePost: ['owner', 'mod'],
  delete: ['owner'],
};

describe('角色权限矩阵', () => {
  for (const [action, allowed] of Object.entries(TABLE) as [Action, Standing[]][])
    for (const s of ALL)
      it(`${s} ${allowed.includes(s) ? '可以' : '不能'} ${action}`, () => {
        expect(can(s, action)).toBe(allowed.includes(s));
      });
  it('只能移出 / 任免比自己低的正式成员；组长不能被移出', () => {
    expect(canActOn('owner', 'mod', 'kick')).toBe(true);
    expect(canActOn('owner', 'member', 'kick')).toBe(true);
    expect(canActOn('mod', 'member', 'kick')).toBe(true);
    expect(canActOn('mod', 'mod', 'kick')).toBe(false);
    expect(canActOn('mod', 'owner', 'kick')).toBe(false);
    expect(canActOn('member', 'member', 'kick')).toBe(false);
    expect(canActOn('owner', 'pending', 'kick')).toBe(false);
    expect(canActOn('owner', 'member', 'setRole')).toBe(true);
    expect(canActOn('mod', 'member', 'setRole')).toBe(false);
  });
  it('分享：自己的随时可删，管理员可删任何人的', () => {
    expect(canRemoveShare('member', 5, 5)).toBe(true);
    expect(canRemoveShare('member', 5, 6)).toBe(false);
    expect(canRemoveShare('mod', 5, 6)).toBe(true);
    expect(canRemoveShare('none', 5, 5)).toBe(false);
  });
  it('成员操作的合法性', () => {
    expect(memberActionError('mod', 'pending', 'approve')).toBeNull();
    expect(memberActionError('member', 'pending', 'approve')).toMatch(/审核/);
    expect(memberActionError('owner', 'member', 'approve')).toMatch(/申请中/);
    expect(memberActionError('owner', 'member', 'role')).toBeNull();
    expect(memberActionError('mod', 'member', 'role')).toMatch(/组长/);
    expect(checkMemberAction({ action: 'role', role: 'owner' }).ok).toBe(false);
    expect(checkMemberAction({ action: 'kick' })).toEqual({ ok: true, value: { action: 'kick' } });
  });
});

describe('加入流程与校验', () => {
  it('开放小组直接加入，审核小组进入申请中', () => {
    expect(joinResult('open')).toBe('member');
    expect(joinResult('approval')).toBe('pending');
  });
  it('被组长 / 管理员屏蔽，或屏蔽了组长的人不能加入', () => {
    expect(joinBlocked({ blockedBy: true, blocksOwner: false })).toBe(true);
    expect(joinBlocked({ blockedBy: false, blocksOwner: true })).toBe(true);
    expect(joinBlocked({ blockedBy: false, blocksOwner: false })).toBe(false);
  });
  it('小组输入校验', () => {
    expect(checkGroup({ slug: 'Film-Lab', name: ' 胶片 ' })).toEqual({ ok: true, value: { slug: 'film-lab', name: '胶片', intro: '', joinPolicy: 'open', notice: '' } });
    expect(checkGroup({ slug: 'a', name: 'x' }).ok).toBe(false);
    expect(checkGroup({ slug: 'ok-1', name: '' }).ok).toBe(false);
    expect(checkGroup({ slug: 'ok-1', name: 'x', joinPolicy: 'invite' }).ok).toBe(false);
    expect(checkGroup({ slug: 'ok-1', name: 'x', notice: '长'.repeat(301) }).ok).toBe(false);
    expect(checkGroupPatch({ slug: 'new' }).ok).toBe(false);
    expect(checkGroupPatch({}).ok).toBe(false);
    expect(checkGroupPatch({ notice: '周六扫街' })).toEqual({ ok: true, value: { notice: '周六扫街' } });
  });
});

describe('小组动态', () => {
  it('去掉屏蔽 / 静音的人，同一作品只出现一次，新的在前', () => {
    const items = [
      { sharerId: 1, authorId: 1, workId: 10, sharedAt: '2026-10-01' },
      { sharerId: 2, authorId: 2, workId: 11, sharedAt: '2026-10-03' },
      { sharerId: 3, authorId: 1, workId: 10, sharedAt: '2026-10-02' },
      { sharerId: 4, authorId: 4, workId: 12, sharedAt: '2026-10-04' },
    ];
    expect(visibleShares(items, new Set([4])).map((x) => x.workId)).toEqual([11, 10]);
    expect(visibleShares(items, new Set([1])).map((x) => x.workId)).toEqual([12, 11]);
  });
});

describe('路由与栏目', () => {
  it('/groups/ 与 /groups/:slug/', () => {
    expect(parseRoute('/groups/')).toEqual({ name: 'groups' });
    expect(parseRoute('/groups/film-lab/')).toEqual({ name: 'group', slug: 'film-lab' });
    expect(parseRoute('/groups/Bad_Slug/').name).toBe('notfound');
    expect(routePath({ name: 'group', slug: 'film-lab' })).toBe('/groups/film-lab/');
    expect(sectionOf('groups')?.id).toBe('community');
    expect(sectionOf('group')?.id).toBe('community');
  });
});

// ---------------------------------------------------------------- 演示 mock（与 Worker 同形状）
const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date('2026-10-14T12:00:00Z') });
type Api = ReturnType<typeof api>;
async function login(b: Api, email: string, username = email.split('@')[0]!.replace(/[^a-z0-9]/g, '_').slice(0, 20)): Promise<string> {
  await b.handle('POST', '/api/members/register', { name: username, email });
  const t = ((await b.handle('POST', '/api/members/verify', { email, code: DEMO_OTP })).body as { token: string }).token;
  await b.handle('PUT', '/api/social/me', { username }, { authorization: `Bearer ${t}` });
  return t;
}
async function call(b: Api, m: string, p: string, tok?: string, body?: unknown): Promise<{ status: number; body: any }> {
  const r = await b.handle(m, p, body, tok ? { authorization: `Bearer ${tok}` } : {});
  return { status: r.status, body: r.body as any };
}

describe('演示 mock：/api/social/groups', () => {
  it('种子小组公开可见，访客不能加入', async () => {
    const b = api();
    const list = await call(b, 'GET', '/api/social/groups');
    expect(list.status).toBe(200);
    expect(list.body.groups.length).toBeGreaterThan(0);
    expect(list.body.groups[0]).toHaveProperty('members');
    const slug = list.body.groups[0].slug;
    const g = await call(b, 'GET', `/api/social/groups/${slug}`);
    expect(g.body.group.myRole).toBe('none');
    expect((await call(b, 'POST', `/api/social/groups/${slug}/join`)).status).toBe(401);
  });
  it('两个身份：创建审核小组 → 申请 → 审核 → 分享 → 公告 → 移出', async () => {
    const b = api();
    const a = await login(b, 'owner-l28@example.com');
    const c = await login(b, 'member-l28@example.com');
    const made = await call(b, 'POST', '/api/social/groups', a, { slug: 'l28-test', name: 'L28 测试组', joinPolicy: 'approval' });
    expect(made.status).toBe(201);
    expect(made.body.group.myRole).toBe('owner');
    expect((await call(b, 'POST', '/api/social/groups', a, { slug: 'l28-test', name: '重复' })).status).toBe(409);
    const j = await call(b, 'POST', '/api/social/groups/l28-test/join', c);
    expect(j.body.state).toBe('pending');
    expect((await call(b, 'POST', '/api/social/groups/l28-test/feed', c, { workId: 1 })).status).toBe(403);
    const pend = await call(b, 'GET', '/api/social/groups/l28-test/members', a);
    const applicant = pend.body.pending[0].username;
    expect((await call(b, 'GET', '/api/social/groups/l28-test/members', c)).body.pending).toEqual([]);
    expect((await call(b, 'POST', `/api/social/groups/l28-test/members/${applicant}`, a, { action: 'approve' })).status).toBe(200);
    expect((await call(b, 'GET', '/api/social/groups/l28-test', c)).body.group.myRole).toBe('member');
    // 成员分享自己的公开作品
    const w = await call(b, 'POST', '/api/social/works', c, { type: 'short', body: 'L28 演示动态', visibility: 'public' });
    const wid = w.body.work.id;
    // 新会员前几条作品要先审核：未通过时不能分享
    expect((await call(b, 'POST', '/api/social/groups/l28-test/feed', c, { workId: wid })).status).toBe(409);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('POST', '/api/admin/ugc/actions', { targetKind: 'work', targetId: wid, action: 'approve' }, adm)).status).toBe(200);
    const s = await call(b, 'POST', '/api/social/groups/l28-test/feed', c, { workId: wid });
    expect(s.status).toBe(201);
    const feed = await call(b, 'GET', '/api/social/groups/l28-test/feed');
    expect(feed.body.items.map((x: any) => x.work.id)).toContain(wid);
    // 成员不能改公告，组长可以
    expect((await call(b, 'PATCH', '/api/social/groups/l28-test', c, { notice: 'x' })).status).toBe(403);
    expect((await call(b, 'PATCH', '/api/social/groups/l28-test', a, { notice: '周六扫街，9 点集合' })).body.group.notice).toBe('周六扫街，9 点集合');
    // 组长移出成员；被移出后动态里的分享仍在（作品是作者的），但不能再分享
    expect((await call(b, 'POST', `/api/social/groups/l28-test/members/${applicant}`, a, { action: 'kick' })).status).toBe(200);
    expect((await call(b, 'GET', '/api/social/groups/l28-test', c)).body.group.myRole).toBe('none');
    // 组长不能退出
    expect((await call(b, 'DELETE', '/api/social/groups/l28-test/join', a)).status).toBe(409);
  });
  it('被组长屏蔽的人不能加入', async () => {
    const b = api();
    const a = await login(b, 'owner2-l28@example.com');
    const c = await login(b, 'member2-l28@example.com');
    await call(b, 'POST', '/api/social/groups', a, { slug: 'l28-open', name: '开放组' });
    const uname = 'member2_l28';
    expect((await call(b, 'POST', `/api/social/blocks/${uname}`, a)).status).toBe(200);
    expect((await call(b, 'POST', '/api/social/groups/l28-open/join', c)).status).toBe(403);
  });
});

describe('页面', () => {
  it('小组列表与详情的外壳', () => {
    const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
    const l = renderRoute({ name: 'groups' }, site, {});
    expect(l.title).toContain('小组');
    expect(l.main).toContain('data-groups');
    const d = renderRoute({ name: 'group', slug: 'film-lab' }, site, {});
    expect(d.main).toContain('data-group="film-lab"');
  });
});
