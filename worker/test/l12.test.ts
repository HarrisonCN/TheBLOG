import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv, tool } from './helpers';
import { testOutbox } from '../src/community';
import type { Env } from '../src/env';
import { BADGE_PRESETS, DEFAULT_BADGE_DESIGN, legacyDesign } from '../src/badge-design';
import { renderCommentHtml, validateComment } from '../src/comment-core';

let env: Env;
let admin: { cookie: string; csrf: string };
const SLUG = 'l12-comments-post';
const ip = (n: number) => ({ 'cf-connecting-ip': `10.112.0.${n}` });
const codeFor = (email: string) => /(\d{6})/.exec(testOutbox.filter((m) => m.to === email).at(-1)?.text ?? '')?.[1] ?? '';
const adm = (path: string, o: { method?: string; body?: unknown } = {}) => call(env, path, { ...o, cookie: admin.cookie, csrf: admin.csrf });

async function join(email: string, name: string, n: number): Promise<{ token: string; member: any }> {
  expect((await call(env, '/api/members/register', { body: { name, email }, headers: ip(n) })).status).toBe(200);
  const v = await call(env, '/api/members/verify', { body: { email, code: codeFor(email) } });
  expect(v.status).toBe(200);
  return (await v.json()) as { token: string; member: any };
}

beforeAll(async () => {
  env = await setupEnv({ EMAIL_PROVIDER: 'memory' });
  admin = await login(env, '10.112.9.1');
  const r = await adm('/api/admin/posts', { body: { title: '评论测试', slug: SLUG, contentMd: '正文', status: 'published', series: 'L12 系列' } });
  expect(r.status).toBe(201);
});
afterAll(disposeEnv);

describe('comment-core（Worker 份）', () => {
  it('校验与渲染', () => {
    expect(validateComment({ name: 'a', content: '你好呀', homepage: 'x' })).toMatchObject({ ok: true, spam: true });
    expect(validateComment({ name: 'a', content: '你好呀', role: 'admin' }).ok).toBe(false);
    expect(renderCommentHtml('<img src=x onerror=1> [a](javascript:1)')).not.toMatch(/<img|<a /);
  });
});

describe('文章评论接口', () => {
  let topId = 0;
  it('访客评论 → pending，公开列表看不到；站长通过后出现', async () => {
    const r = await call(env, `/api/posts/${SLUG}/comments`, { body: { name: '访客甲', content: '写得真好 **赞**' }, headers: ip(1) });
    expect(r.status).toBe(201);
    const body = (await r.json()) as any;
    expect(body.status).toBe('pending');
    expect(body.comment).toMatchObject({ name: '访客甲', parentId: null, member: false, status: 'pending' });
    topId = body.comment.id;
    let list = (await (await call(env, `/api/posts/${SLUG}/comments`)).json()) as any;
    expect(list.comments.some((c: any) => c.id === topId)).toBe(false);
    const q = (await (await adm('/api/admin/comments?status=pending')).json()) as any;
    expect(q.comments.some((c: any) => c.id === topId)).toBe(true);
    expect(q.counts.pending).toBeGreaterThanOrEqual(1);
    expect((await adm(`/api/admin/comments/${topId}`, { body: { action: 'approve' } })).status).toBe(200);
    list = (await (await call(env, `/api/posts/${SLUG}/comments`)).json()) as any;
    expect(list.comments.find((c: any) => c.id === topId)?.status).toBe('approved');
    // 公开列表不泄露 IP 哈希
    expect(JSON.stringify(list)).not.toContain('ip_hash');
  });
  it('好朋友评论直接公开（用会员昵称）；回复「回复」挂到顶层并记下被回复人', async () => {
    const { token } = await join('l12-commenter@example.com', '会员乙', 2);
    const r = await call(env, `/api/posts/${SLUG}/comments`, { body: { name: '冒名', content: '我来回复', parentId: topId }, token, headers: ip(3) });
    const reply = ((await r.json()) as any).comment;
    expect(reply).toMatchObject({ status: 'approved', member: true, name: '会员乙', parentId: topId, replyTo: '' });
    const r2 = await call(env, `/api/posts/${SLUG}/comments`, { body: { name: '访客丙', content: '回复回复', parentId: reply.id }, headers: ip(4) });
    expect(((await r2.json()) as any).comment).toMatchObject({ parentId: topId, replyTo: '会员乙', status: 'pending' });
  });
  it('蜜罐：返回 201 但不入库；校验失败 400；文章不存在 / 父评论不存在 404；未知字段 400', async () => {
    const before = ((await (await adm('/api/admin/comments')).json()) as any).comments.length;
    const hp = await call(env, `/api/posts/${SLUG}/comments`, { body: { name: 'bot', content: 'cheap pills', homepage: 'http://spam.test' }, headers: ip(5) });
    expect(hp.status).toBe(201);
    expect(((await hp.json()) as any).comment).toBeNull();
    expect(((await (await adm('/api/admin/comments')).json()) as any).comments.length).toBe(before);
    expect((await call(env, `/api/posts/${SLUG}/comments`, { body: { name: '', content: 'x' }, headers: ip(6) })).status).toBe(400);
    expect((await call(env, `/api/posts/${SLUG}/comments`, { body: { name: 'a', content: '你好呀', admin: true }, headers: ip(7) })).status).toBe(400);
    expect((await call(env, '/api/posts/no-such-post/comments', { body: { name: 'a', content: '你好呀' }, headers: ip(8) })).status).toBe(404);
    expect((await call(env, `/api/posts/${SLUG}/comments`, { body: { name: 'a', content: '你好呀', parentId: 999999 }, headers: ip(9) })).status).toBe(404);
  });
  it('限流：同一 IP 10 分钟最多 5 条', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await call(env, `/api/posts/${SLUG}/comments`, { body: { name: '刷屏', content: `第 ${i} 条评论` }, headers: ip(42) })).status);
    expect(codes.slice(0, 5).every((c) => c === 201)).toBe(true);
    expect(codes[5]).toBe(429);
  });
  it('审核：隐藏 / 删除（连同回复）/ 非法动作 / 不存在；需要登录和 CSRF', async () => {
    expect((await call(env, '/api/admin/comments')).status).toBe(401);
    expect((await call(env, `/api/admin/comments/${topId}`, { body: { action: 'hide' }, cookie: admin.cookie })).status).toBe(403);
    expect((await adm(`/api/admin/comments/${topId}`, { body: { action: 'explode' } })).status).toBe(400);
    expect((await adm('/api/admin/comments/999999', { body: { action: 'hide' } })).status).toBe(404);
    expect((await adm(`/api/admin/comments/${topId}`, { body: { action: 'hide' } })).status).toBe(200);
    let list = (await (await call(env, `/api/posts/${SLUG}/comments`)).json()) as any;
    expect(list.comments.some((c: any) => c.id === topId)).toBe(false);
    expect((await adm(`/api/admin/comments/${topId}`, { method: 'DELETE' })).status).toBe(200);
    const all = ((await (await adm('/api/admin/comments')).json()) as any).comments;
    expect(all.some((c: any) => c.id === topId || c.parentId === topId)).toBe(false);
  });
});

describe('系列连载字段', () => {
  it('创建 / 读取 / 清空 series', async () => {
    const p = (await (await call(env, `/api/posts/${SLUG}`)).json()) as any;
    expect(p.series).toBe('L12 系列');
    const list = (await (await call(env, '/api/posts?limit=100')).json()) as any;
    expect(list.posts.find((x: any) => x.slug === SLUG).series).toBe('L12 系列');
    const u = (await (await adm(`/api/admin/posts/${SLUG}`, { method: 'PATCH', body: { series: '' } })).json()) as any;
    expect(u.series).toBeNull();
    expect((await adm(`/api/admin/posts/${SLUG}`, { method: 'PATCH', body: { series: 'x'.repeat(41) } })).status).toBe(400);
  });
});

describe('作品坐标：保存时粗化到 0.1°，非法值 400', () => {
  it('works.lat / lng', async () => {
    const work = { title: '湖', id: 'l12-lake', url: 'https://example.com/a.webp', geo: 'on', lat: '25.27891', lng: '-110.2961' };
    const r = await adm('/api/admin/content/works', { method: 'PUT', body: { items: [work] } });
    expect(r.status).toBe(200);
    const item = ((await r.json()) as any).items[0];
    expect([item.geo, item.lat, item.lng]).toEqual(['on', '25.3', '-110.3']);
    expect((await adm('/api/admin/content/works', { method: 'PUT', body: { items: [{ ...work, lat: '91' }] } })).status).toBe(400);
    expect((await adm('/api/admin/content/works', { method: 'PUT', body: { items: [{ ...work, lng: '1e3' }] } })).status).toBe(400);
    expect((await adm('/api/admin/content/works', { method: 'PUT', body: { items: [{ ...work, geo: 'exact' }] } })).status).toBe(400);
    const def = ((await (await adm('/api/admin/content/works', { method: 'PUT', body: { items: [{ title: '无坐标', id: 'l12-x', url: 'https://example.com/b.webp' }] } })).json()) as any).items[0];
    expect([def.geo, def.lat, def.lng]).toEqual(['off', '', '']);
    // 测试共用一个 D1：恢复成空，避免影响其他测试文件
    expect((await adm('/api/admin/content/works', { method: 'PUT', body: { items: [] } })).status).toBe(200);
  });
});

describe('好朋友徽章 DIY', () => {
  let m: { token: string; member: any };
  let other: { token: string; member: any };
  beforeAll(async () => {
    m = await join('l12-badge@example.com', '徽章君', 20);
    other = await join('l12-other@example.com', '路人', 21);
    expect((await adm(`/api/admin/members/${m.member.id}/badges`, { body: { code: 'L12-0001', label: '测试徽章', style: 'pearlescent' } })).status).toBe(200);
    expect((await adm(`/api/admin/members/${other.member.id}/badges`, { body: { code: 'L12-0002', label: '别人的' } })).status).toBe(200);
  });
  it('旧徽章（没有 design）按 style 返回对应预设', async () => {
    const pub = ((await (await call(env, '/api/members')).json()) as any).members.find((x: any) => x.id === m.member.id);
    expect(pub.badges[0].design).toEqual(legacyDesign('pearlescent'));
  });
  it('颁发时可以带设计；坏设计 400；未知字段 400', async () => {
    const d = { ...BADGE_PRESETS[1]!.design, label: '镭射' };
    const r = await adm(`/api/admin/members/${m.member.id}/badges`, { body: { code: 'L12-0003', label: '带设计', design: d } });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).badges.find((b: any) => b.code === 'L12-0003').design).toEqual(d);
    expect((await adm(`/api/admin/members/${m.member.id}/badges`, { body: { code: 'L12-0004', design: { css: 'x' } } })).status).toBe(400);
    expect((await adm(`/api/admin/members/${m.member.id}/badges`, { body: { code: 'L12-0005', color: '#fff' } })).status).toBe(400);
  });
  it('站长修改任何人的设计；只接受 design 字段', async () => {
    const d = { ...BADGE_PRESETS[7]!.design, label: '亲启' };
    const r = await adm(`/api/admin/members/${other.member.id}/badges/L12-0002`, { method: 'PUT', body: { design: d } });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).badges[0].design).toEqual(d);
    expect((await adm(`/api/admin/members/${other.member.id}/badges/L12-0002`, { method: 'PUT', body: { design: d, label: '改名' } })).status).toBe(400);
    expect((await adm(`/api/admin/members/${other.member.id}/badges/L12-9999`, { method: 'PUT', body: { design: d } })).status).toBe(404);
    expect((await call(env, `/api/admin/members/${other.member.id}/badges/L12-0002`, { method: 'PUT', body: { design: d } })).status).toBe(401);
  });
  it('好朋友只能改自己名下的徽章；需要登录；坏设计 400', async () => {
    const d = { ...BADGE_PRESETS[2]!.design, label: 'GG' };
    const r = await call(env, '/api/members/me/badges/l12-0001', { method: 'PUT', body: { design: d }, token: m.token });
    expect(r.status).toBe(200);
    const me = ((await r.json()) as any).member;
    expect(me.email).toBeUndefined();
    expect(me.badges.find((b: any) => b.code === 'L12-0001').design).toEqual(d);
    expect((await call(env, '/api/members/me/badges/L12-0002', { method: 'PUT', body: { design: d }, token: m.token })).status).toBe(404);
    expect((await call(env, '/api/members/me/badges/L12-0001', { method: 'PUT', body: { design: d } })).status).toBe(401);
    for (const bad of [{ shape: 'star' }, { color: 'red' }, { label: '<script>' }, { label: '一二三四五六七八九' }, { effect: 'blink' }, 'raw-css'])
      expect((await call(env, '/api/members/me/badges/L12-0001', { method: 'PUT', body: { design: bad }, token: m.token })).status, JSON.stringify(bad)).toBe(400);
  });
  it('读库时再校验：库里被篡改的设计退回预设，绝不原样返回', async () => {
    await env.DB.prepare("UPDATE badges SET design = ? WHERE code = 'L12-0001'").bind(JSON.stringify({ ...DEFAULT_BADGE_DESIGN, color: 'red;background:url(x)' })).run();
    let pub = ((await (await call(env, '/api/members')).json()) as any).members.find((x: any) => x.id === m.member.id);
    expect(pub.badges.find((b: any) => b.code === 'L12-0001').design).toEqual(legacyDesign('pearlescent'));
    await env.DB.prepare("UPDATE badges SET design = '{not json' WHERE code = 'L12-0001'").run();
    pub = ((await (await call(env, '/api/members')).json()) as any).members.find((x: any) => x.id === m.member.id);
    expect(pub.badges.find((b: any) => b.code === 'L12-0001').design.texture).toBe('pearl');
  });
  it('MCP grant_badge 也接受 design', async () => {
    const r = await tool(env, 'grant_badge', { memberId: other.member.id, code: 'L12-0006', label: 'MCP', design: BADGE_PRESETS[0]!.design });
    expect(r.isError).toBe(false);
  });
});
