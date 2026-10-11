import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import { testOutbox } from '../src/community';
import type { Env } from '../src/env';
import { checkProfile, checkUsername, decodeCursor, encodeCursor, extractMentions, mergeBookmarkInputs, notificationKey, canViewProfile } from '../src/social-core';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({ EMAIL_PROVIDER: 'memory' });
  admin = await login(env, '10.9.5.1');
});
afterAll(disposeEnv);

const ip = (n: number) => ({ 'cf-connecting-ip': `10.55.0.${n}` });
const codeFor = (email: string) => /(\d{6})/.exec(testOutbox.filter((m) => m.to === email).at(-1)?.text ?? '')?.[1] ?? '';
async function join(email: string, name: string, n: number): Promise<{ token: string; id: number }> {
  const r = await call(env, '/api/members/register', { body: { name, email }, headers: ip(n) });
  expect(r.status).toBe(200);
  const v = await call(env, '/api/members/verify', { body: { email, code: codeFor(email) } });
  const b = (await v.json()) as any;
  return { token: b.token, id: b.member.id };
}
const J = async (r: Response) => (await r.json()) as any;
const put = (path: string, token: string, body: unknown, headers: Record<string, string> = {}) => call(env, path, { method: 'PUT', token, body, headers });

let A: { token: string; id: number };
let B: { token: string; id: number };
let C: { token: string; id: number };

describe('social-core 纯函数', () => {
  it('用户名规则', () => {
    expect(checkUsername('Lin_Photo').ok).toBe(true);
    expect(checkUsername('ab').ok).toBe(false);
    expect(checkUsername('_abc').ok).toBe(false);
    expect(checkUsername('a__b').ok).toBe(false);
    expect(checkUsername('admin').ok).toBe(false);
    expect(checkUsername('含中文').ok).toBe(false);
  });
  it('资料校验：只允许 https 链接、最多 5 个', () => {
    expect(checkProfile({ website: 'javascript:alert(1)' }).ok).toBe(false);
    expect(checkProfile({ links: [{ label: 'x', url: 'http://a.com' }] }).ok).toBe(false);
    expect(checkProfile({ links: new Array(6).fill({ label: 'x', url: 'https://a.com' }) }).ok).toBe(false);
    const ok = checkProfile({ links: [{ label: '', url: 'https://www.flickr.com/x' }], visibility: 'members' });
    expect(ok.ok && ok.value.links?.[0]?.label).toBe('flickr.com');
  });
  it('游标往返 / 坏游标', () => {
    const c = { t: '2026-10-11T08:00:00.000Z', id: 42 };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor('!!')).toBe('bad');
    expect(decodeCursor(null)).toBe(null);
  });
  it('通知键 / 提及 / 合并去重 / 可见性', () => {
    expect(notificationKey('follow', { actorId: 3 })).toBe('follow:3');
    expect(notificationKey('reply', { objectRef: 's', thread: 9 })).toBe('reply:s:9');
    expect(extractMentions('hi @lin_photo and @lin_photo, mail a@b.com @x')).toEqual(['lin_photo']);
    const m = mergeBookmarkInputs([{ ref: 'a' }, { ref: 'a' }, { ref: '../x' }, { kind: 'photo', ref: 'a' }]);
    expect(m.items.length).toBe(2);
    expect(m.rejected).toBe(1);
    expect(canViewProfile({ visibility: 'public', isSelf: false, viewerLoggedIn: true, blockedByTarget: true, viewerBlocked: false })).toBe('hidden');
    expect(canViewProfile({ visibility: 'members', isSelf: false, viewerLoggedIn: false, blockedByTarget: false, viewerBlocked: false })).toBe('restricted');
  });
});

describe('L15 社交：资料与用户名', () => {
  it('两个会员注册，默认用户名不含邮箱信息', async () => {
    A = await join('alice-l15@example.com', 'Alice', 1);
    B = await join('bob-l15@example.com', 'Bob', 2);
    C = await join('carol-l15@example.com', 'Carol', 3);
    const me = await J(await call(env, '/api/social/me', { token: A.token }));
    expect(me.profile.username).toMatch(/^friend\d{3,}$/);
    expect(JSON.stringify(me)).not.toContain('alice-l15');
  });
  it('设置唯一用户名（大小写不敏感），冲突 409', async () => {
    let r = await put('/api/social/me', A.token, { username: 'Alice_Lens', nickname: '爱丽丝', bio: '拍海', website: 'https://alice.example', links: [{ label: 'IG', url: 'https://instagram.com/alice' }] });
    expect(r.status).toBe(200);
    expect((await J(r)).profile.username).toBe('alice_lens');
    r = await put('/api/social/me', B.token, { username: 'ALICE_LENS' });
    expect(r.status).toBe(409);
    r = await put('/api/social/me', B.token, { username: 'bob_frames', nickname: 'Bob' });
    expect(r.status).toBe(200);
    r = await put('/api/social/me', C.token, { username: 'carol_c' });
    expect(r.status).toBe(200);
  });
  it('校验错误 400；未登录 401；跨站 Origin 403', async () => {
    expect((await put('/api/social/me', A.token, { website: 'http://x' })).status).toBe(400);
    expect((await call(env, '/api/social/me', { method: 'PUT', body: { bio: 'x' } })).status).toBe(401);
    expect((await put('/api/social/me', A.token, { bio: 'x' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await call(env, '/api/social/follows/bob_frames', { method: 'POST', token: A.token, headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await call(env, '/api/social/me')).status).toBe(401);
    expect((await call(env, '/api/social/notifications')).status).toBe(401);
    expect((await call(env, '/api/social/bookmarks')).status).toBe(401);
  });
  it('公开主页：不含邮箱 / provider / token，游客可读', async () => {
    const r = await call(env, '/api/social/users/alice_lens');
    expect(r.status).toBe(200);
    const b = await J(r);
    expect(b.profile.nickname).toBe('爱丽丝');
    expect(b.profile.links[0].url).toBe('https://instagram.com/alice');
    const s = JSON.stringify(b);
    expect(s).not.toMatch(/@example\.com|provider|token|ip_hash|email/i);
    expect((await call(env, '/api/social/users/nobody_here')).status).toBe(404);
  });
});

describe('L15 社交：发现 + 互相关注 + 通知', () => {
  it('按用户名 / 昵称搜索', async () => {
    let b = await J(await call(env, '/api/social/search?q=bob', { headers: ip(9) }));
    expect(b.users.map((u: any) => u.username)).toContain('bob_frames');
    b = await J(await call(env, '/api/social/search?q=' + encodeURIComponent('爱丽'), { headers: ip(9) }));
    expect(b.users[0].username).toBe('alice_lens');
    expect(JSON.stringify(b)).not.toMatch(/example\.com/);
  });
  it('A 关注 B，B 关注 A（幂等），计数正确', async () => {
    expect((await call(env, '/api/social/follows/bob_frames', { method: 'POST', token: A.token })).status).toBe(200);
    expect((await call(env, '/api/social/follows/bob_frames', { method: 'POST', token: A.token })).status).toBe(200);
    const r = await J(await call(env, '/api/social/follows/alice_lens', { method: 'POST', token: B.token }));
    expect(r.counts.followers).toBe(1);
    const p = await J(await call(env, '/api/social/users/bob_frames', { token: A.token }));
    expect(p.viewer).toMatchObject({ following: true, followedBy: true });
    expect(p.profile.counts).toMatchObject({ followers: 1, following: 1 });
    const f = await J(await call(env, '/api/social/users/bob_frames/followers'));
    expect(f.users.map((u: any) => u.username)).toEqual(['alice_lens']);
    expect((await call(env, '/api/social/follows/bob_frames', { method: 'POST', token: B.token })).status).toBe(400);
  });
  it('B 收到一条关注通知；取关再关注不会重复', async () => {
    await call(env, '/api/social/follows/bob_frames', { method: 'DELETE', token: A.token });
    await call(env, '/api/social/follows/bob_frames', { method: 'POST', token: A.token });
    const n = await J(await call(env, '/api/social/notifications', { token: B.token }));
    const follows = n.notifications.filter((x: any) => x.type === 'follow');
    expect(follows.length).toBe(1);
    expect(follows[0].actor.username).toBe('alice_lens');
    expect(n.unread).toBeGreaterThanOrEqual(1);
    expect((await J(await call(env, '/api/social/notifications/unread', { token: B.token }))).unread).toBe(n.unread);
  });
  it('只能标记自己的通知已读；全部已读', async () => {
    const n = await J(await call(env, '/api/social/notifications', { token: B.token }));
    const id = n.notifications[0].id;
    // A 试图标记 B 的通知 → 不生效
    await call(env, '/api/social/notifications/read', { token: A.token, body: { ids: [id] } });
    expect((await J(await call(env, '/api/social/notifications?filter=unread', { token: B.token }))).notifications.some((x: any) => x.id === id)).toBe(true);
    // A 读不到 B 的通知
    const an = await J(await call(env, '/api/social/notifications', { token: A.token }));
    expect(an.notifications.some((x: any) => x.id === id)).toBe(false);
    const r = await J(await call(env, '/api/social/notifications/read', { token: B.token, body: { ids: [id] } }));
    expect(r.unread).toBe(n.unread - 1);
    const all = await J(await call(env, '/api/social/notifications/read', { token: B.token, body: { all: true } }));
    expect(all.unread).toBe(0);
    expect((await call(env, '/api/social/notifications?filter=bogus', { token: B.token })).status).toBe(400);
  });
  it('评论回复 → reply 通知（同楼聚合），@提及 → mention 通知', async () => {
    const slugs = (await J(await call(env, '/api/posts?limit=1'))).posts;
    const slug = slugs[0].slug;
    const top = await J(await call(env, `/api/posts/${slug}/comments`, { token: B.token, body: { content: '拍得真好', name: 'x' }, headers: ip(21) }));
    const parentId = top.comment.id;
    await call(env, `/api/posts/${slug}/comments`, { token: A.token, body: { content: '谢谢 @bob_frames', name: 'x', parentId }, headers: ip(22) });
    await call(env, `/api/posts/${slug}/comments`, { token: C.token, body: { content: '同意', name: 'x', parentId }, headers: ip(23) });
    const n = await J(await call(env, '/api/social/notifications?filter=reply', { token: B.token }));
    expect(n.notifications.length).toBe(1);
    expect(n.notifications[0].count).toBe(2);
    expect(n.notifications[0].actor.username).toBe('carol_c');
    const men = await J(await call(env, '/api/social/notifications?filter=mention', { token: B.token }));
    expect(men.notifications.length).toBe(1);
    // L16 起主页「作品」列表是真正的用户投稿，不再是评论
    const p = await J(await call(env, '/api/social/users/bob_frames'));
    expect(p.works.length).toBe(0);
    expect(p.profile.counts.works).toBe(0);
  });
  it('通知偏好：默认邮件关；关闭 follow 后不再生成', async () => {
    const p = await J(await call(env, '/api/social/notifications/prefs', { token: C.token }));
    expect(p.prefs).toEqual({ follow: true, reply: true, mention: true, bookmark: true, reaction: true, new_work: true, email: false });
    await put('/api/social/notifications/prefs', C.token, { follow: false });
    await call(env, '/api/social/follows/carol_c', { method: 'POST', token: A.token });
    const n = await J(await call(env, '/api/social/notifications?filter=follow', { token: C.token }));
    expect(n.notifications.length).toBe(0);
    expect((await put('/api/social/notifications/prefs', C.token, { email: 'yes' })).status).toBe(400);
  });
});

describe('L15 社交：拉黑 / 静音 / 隐私', () => {
  it('C 拉黑 A：A 看不到 C、不能关注 C，原关注关系被解除，搜索里也看不到', async () => {
    expect((await call(env, '/api/social/blocks/alice_lens', { method: 'POST', token: C.token })).status).toBe(200);
    expect((await call(env, '/api/social/users/carol_c', { token: A.token })).status).toBe(404);
    expect((await call(env, '/api/social/follows/carol_c', { method: 'POST', token: A.token })).status).toBe(404);
    const s = await J(await call(env, '/api/social/search?q=carol', { token: A.token, headers: ip(10) }));
    expect(s.users.length).toBe(0);
    const mine = await J(await call(env, '/api/social/users/carol_c', { token: C.token }));
    expect(mine.profile.counts.followers).toBe(0);
    // 拉黑者看对方：受限视图 + blocked 标记
    const view = await J(await call(env, '/api/social/users/alice_lens', { token: C.token }));
    expect(view.restricted).toBe('blocked');
    expect(view.viewer.blocked).toBe(true);
    expect((await J(await call(env, '/api/social/me/blocks', { token: C.token }))).users[0].username).toBe('alice_lens');
    // 被拉黑者的回复不再通知拉黑者
    await call(env, '/api/social/blocks/alice_lens', { method: 'DELETE', token: C.token });
    expect((await call(env, '/api/social/users/carol_c', { token: A.token })).status).toBe(200);
  });
  it('静音：静音者触发的通知不出现', async () => {
    await put('/api/social/notifications/prefs', C.token, { follow: true });
    await call(env, '/api/social/mutes/bob_frames', { method: 'POST', token: C.token });
    await call(env, '/api/social/follows/carol_c', { method: 'POST', token: B.token });
    const n = await J(await call(env, '/api/social/notifications?filter=follow', { token: C.token }));
    expect(n.notifications.some((x: any) => x.actor?.username === 'bob_frames')).toBe(false);
    expect((await J(await call(env, '/api/social/me/mutes', { token: C.token }))).users.length).toBe(1);
  });
  it('隐私：private 只本人可见；members 需登录；关注列表可隐藏', async () => {
    await put('/api/social/me', B.token, { visibility: 'members', showFollows: false });
    const guest = await J(await call(env, '/api/social/users/bob_frames'));
    expect(guest.restricted).toBe('members');
    expect(guest.profile.bio).toBeUndefined();
    expect((await J(await call(env, '/api/social/users/bob_frames', { token: A.token }))).restricted).toBe(null);
    expect((await call(env, '/api/social/users/bob_frames/followers', { token: A.token })).status).toBe(403);
    expect((await call(env, '/api/social/users/bob_frames/followers', { token: B.token })).status).toBe(200);
    await put('/api/social/me', B.token, { visibility: 'private' });
    expect((await J(await call(env, '/api/social/users/bob_frames', { token: A.token }))).restricted).toBe('private');
    const s = await J(await call(env, '/api/social/search?q=bob', { headers: ip(11) }));
    expect(s.users.length).toBe(0);
    await put('/api/social/me', B.token, { visibility: 'public', showFollows: true });
  });
  it('别人改不了我的资料（只能改令牌对应的自己）', async () => {
    await put('/api/social/me', A.token, { nickname: 'hacked', username: 'bob_frames' }).then((r) => expect(r.status).toBe(409));
    expect((await J(await call(env, '/api/social/users/bob_frames'))).profile.nickname).toBe('Bob');
  });
});

describe('L15 社交：云端收藏', () => {
  it('收藏跨"设备"读取（两次独立登录 = 两个令牌）', async () => {
    expect((await call(env, '/api/social/bookmarks', { token: A.token, body: { kind: 'post', ref: 'demo-essay-seaside', title: '海边' } })).status).toBe(201);
    // 第二台设备：重新走一遍登录得到新令牌
    await call(env, '/api/members/register', { body: { name: 'Alice', email: 'alice-l15@example.com' }, headers: ip(31) });
    const v = await J(await call(env, '/api/members/verify', { body: { email: 'alice-l15@example.com', code: codeFor('alice-l15@example.com') } }));
    expect(v.token).not.toBe(A.token);
    const b = await J(await call(env, '/api/social/bookmarks', { token: v.token }));
    expect(b.bookmarks.map((x: any) => x.ref)).toContain('demo-essay-seaside');
  });
  it('合并本地收藏：去重、跳过已存在、拒绝非法', async () => {
    const r = await J(await call(env, '/api/social/bookmarks/merge', { token: A.token, body: { items: [{ ref: 'demo-essay-seaside' }, { ref: 'phone-night-photography', title: '夜拍' }, { ref: 'phone-night-photography' }, { ref: '<script>' }] } }));
    expect(r).toEqual({ added: 1, skipped: 1, rejected: 1 });
    const b = await J(await call(env, '/api/social/bookmarks?limit=1', { token: A.token }));
    expect(b.bookmarks.length).toBe(1);
    expect(b.nextCursor).toBeTruthy();
    const b2 = await J(await call(env, `/api/social/bookmarks?limit=1&cursor=${b.nextCursor}`, { token: A.token }));
    expect(b2.bookmarks[0].id).toBeLessThan(b.bookmarks[0].id);
  });
  it('别人读不到我的收藏，删收藏只删自己的', async () => {
    const bb = await J(await call(env, '/api/social/bookmarks', { token: B.token }));
    expect(bb.bookmarks.length).toBe(0);
    await call(env, '/api/social/bookmarks/post/demo-essay-seaside', { method: 'DELETE', token: B.token });
    const ab = await J(await call(env, '/api/social/bookmarks', { token: A.token }));
    expect(ab.bookmarks.map((x: any) => x.ref)).toContain('demo-essay-seaside');
    await call(env, '/api/social/bookmarks/post/demo-essay-seaside', { method: 'DELETE', token: A.token });
    expect((await J(await call(env, '/api/social/bookmarks', { token: A.token }))).bookmarks.map((x: any) => x.ref)).not.toContain('demo-essay-seaside');
  });
});

describe('L15 社交：导出 / 注销 / 限流', () => {
  it('导出只给本人，含邮箱（私有数据）', async () => {
    const r = await call(env, '/api/social/me/export', { token: A.token });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toContain('attachment');
    const d = await J(r);
    expect(d.account.email).toBe('alice-l15@example.com');
    expect(d.profile.username).toBe('alice_lens');
  });
  it('关注限流：每分钟 30 次', async () => {
    let last = 200;
    for (let i = 0; i < 34; i++) last = (await call(env, '/api/social/follows/carol_c', { method: i % 2 ? 'DELETE' : 'POST', token: B.token })).status;
    expect(last).toBe(429);
  });
  it('注销需要输入用户名确认；注销后关系与通知清除', async () => {
    expect((await call(env, '/api/social/me/delete', { token: C.token, body: { confirm: 'nope' } })).status).toBe(400);
    expect((await call(env, '/api/social/me/delete', { token: C.token, body: { confirm: 'carol_c' } })).status).toBe(200);
    expect((await call(env, '/api/social/users/carol_c')).status).toBe(404);
    expect((await call(env, '/api/social/me', { token: C.token })).status).toBe(401);
    const a = await J(await call(env, '/api/social/users/alice_lens'));
    expect(a.profile.counts.following).toBe(1);
  });
  it('后台会员接口不受影响', async () => {
    const r = await call(env, '/api/admin/members', { cookie: admin.cookie, csrf: admin.csrf });
    expect(r.status).toBe(200);
  });
});
