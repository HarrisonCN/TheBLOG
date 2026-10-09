import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv, tool } from './helpers';
import { testOutbox } from '../src/community';
import type { Env } from '../src/env';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({ EMAIL_PROVIDER: 'memory' });
  admin = await login(env, '10.9.0.1');
});
afterAll(disposeEnv);

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89]);
const ip = (n: number) => ({ 'cf-connecting-ip': `10.20.0.${n}` });
const codeFor = (email: string) => /(\d{6})/.exec(testOutbox.filter((m) => m.to === email).at(-1)?.text ?? '')?.[1] ?? '';

async function join(email: string, name = '小林', n = 1): Promise<{ token: string; member: any }> {
  const r = await call(env, '/api/members/register', { body: { name, email, bio: '路过' }, headers: ip(n) });
  expect(r.status).toBe(200);
  const v = await call(env, '/api/members/verify', { body: { email, code: codeFor(email) } });
  expect(v.status).toBe(200);
  return (await v.json()) as { token: string; member: any };
}

function form(fields: Record<string, string | Blob>, name = 'f.png'): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) typeof v === 'string' ? fd.set(k, v) : fd.set(k, v, name);
  return fd;
}

describe('好朋友：邮箱验证码', () => {
  it('发送验证码（响应里不含验证码），错误验证码被拒，正确后得到令牌', async () => {
    const r = await call(env, '/api/members/register', { body: { name: 'Momo', email: 'Momo@Example.com' }, headers: ip(2) });
    const body = (await r.json()) as any;
    expect(r.status).toBe(200);
    expect(body).toEqual({ sent: true });
    const code = codeFor('momo@example.com');
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await call(env, '/api/members/verify', { body: { email: 'momo@example.com', code: wrong } })).status).toBe(400);
    const ok = await call(env, '/api/members/verify', { body: { email: 'momo@example.com', code } });
    const out = (await ok.json()) as any;
    expect(ok.status).toBe(200);
    expect(out.token).toMatch(/^m_/);
    expect(out.member.name).toBe('Momo');
    expect(out.member.email).toBeUndefined();
    const me = await call(env, '/api/members/me', { token: out.token });
    expect(((await me.json()) as any).member.name).toBe('Momo');
    // 验证码只能用一次
    expect((await call(env, '/api/members/verify', { body: { email: 'momo@example.com', code } })).status).toBe(400);
  });

  it('验证码最多尝试 5 次', async () => {
    await call(env, '/api/members/register', { body: { name: 'A', email: 'try@example.com' }, headers: ip(3) });
    const code = codeFor('try@example.com');
    const wrong = code === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) expect((await call(env, '/api/members/verify', { body: { email: 'try@example.com', code: wrong } })).status).toBe(400);
    expect((await call(env, '/api/members/verify', { body: { email: 'try@example.com', code } })).status).toBe(429);
  });

  it('同一邮箱 10 分钟内最多 3 次验证码；邮箱格式校验', async () => {
    for (let i = 0; i < 3; i++) expect((await call(env, '/api/members/register', { body: { name: 'B', email: 'spam@example.com' }, headers: ip(10 + i) })).status).toBe(200);
    expect((await call(env, '/api/members/register', { body: { name: 'B', email: 'spam@example.com' }, headers: ip(20) })).status).toBe(429);
    expect((await call(env, '/api/members/register', { body: { name: 'B', email: 'not-an-email' }, headers: ip(21) })).status).toBe(400);
  });

  it('无效令牌 401；Google 登录未配置时 404', async () => {
    expect((await call(env, '/api/members/me', { token: 'm_' + 'x'.repeat(40) })).status).toBe(401);
    expect((await call(env, '/api/members/google/start')).status).toBe(404);
  });

  it('Google 登录配置后跳转到授权页（只要 openid email profile，带 state Cookie）', async () => {
    const g = await setupEnv({ GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REDIRECT_URI: 'https://blog.test/api/members/google/callback' });
    const r = await call(g, '/api/members/google/start');
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.get('location')!);
    expect(loc.hostname).toBe('accounts.google.com');
    expect(loc.searchParams.get('scope')).toBe('openid email profile');
    expect(r.headers.get('set-cookie')).toContain('HttpOnly');
    // state 不匹配
    expect((await call(g, '/api/members/google/callback?state=abc&code=x', { headers: { cookie: 'g_oauth_state=def' } })).status).toBe(400);
  });
});

describe('在线状态', () => {
  it('心跳后能看到自己和其他访客，不泄露别人的 sid', async () => {
    const { token } = await join('presence@example.com', '在线君', 30);
    await call(env, '/api/presence', { body: { sid: 'visitor-aaaa', page: '首页' } });
    const r = await call(env, '/api/presence', { body: { sid: 'member-bbbb', page: '画廊' }, token });
    const body = (await r.json()) as any;
    expect(r.status).toBe(200);
    expect(body.total).toBeGreaterThanOrEqual(2);
    const me = body.viewers.find((v: any) => v.sid === 'member-bbbb');
    expect(me).toMatchObject({ name: '在线君', member: true, page: '画廊' });
    expect(body.viewers.some((v: any) => v.sid === 'visitor-aaaa')).toBe(false);
    expect((await call(env, '/api/presence', { body: { sid: '<x>' } })).status).toBe(400);
  });
});

describe('便利贴', () => {
  it('发布、被 3 个不同来源举报后隐藏、站长恢复', async () => {
    const r = await call(env, '/api/notes', { body: { name: '小林', content: '今天也要好好拍照', color: 'pink' }, headers: ip(40) });
    expect(r.status).toBe(201);
    const note = (await r.json()) as any;
    for (const n of [41, 41, 42]) await call(env, `/api/notes/${note.id}/report`, { body: {}, headers: ip(n) });
    let list = ((await (await call(env, '/api/notes')).json()) as any).notes;
    expect(list.some((x: any) => x.id === note.id)).toBe(true); // 同一来源重复举报只算一次
    await call(env, `/api/notes/${note.id}/report`, { body: {}, headers: ip(43) });
    list = ((await (await call(env, '/api/notes')).json()) as any).notes;
    expect(list.some((x: any) => x.id === note.id)).toBe(false);
    const all = ((await (await call(env, '/api/admin/notes', { cookie: admin.cookie })).json()) as any).notes;
    expect(all.find((x: any) => x.id === note.id)).toMatchObject({ hidden: true, reports: 3 });
    // 没有 CSRF 令牌不能审核
    expect((await call(env, `/api/admin/notes/${note.id}`, { body: { action: 'show' }, cookie: admin.cookie })).status).toBe(403);
    expect((await call(env, `/api/admin/notes/${note.id}`, { body: { action: 'show' }, cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    list = ((await (await call(env, '/api/notes')).json()) as any).notes;
    expect(list.find((x: any) => x.id === note.id).reports).toBe(0);
    expect((await call(env, `/api/admin/notes/${note.id}`, { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
  });

  it('校验与限流：内容最长 60 字，同一来源 10 分钟最多 5 张', async () => {
    expect((await call(env, '/api/notes', { body: { name: 'x', content: 'a'.repeat(61) }, headers: ip(50) })).status).toBe(400);
    for (let i = 0; i < 5; i++) expect((await call(env, '/api/notes', { body: { name: 'x', content: `第${i}张` }, headers: ip(51) })).status).toBe(201);
    expect((await call(env, '/api/notes', { body: { name: 'x', content: '第6张' }, headers: ip(51) })).status).toBe(429);
  });

  it('跨站来源的写请求被拒', async () => {
    expect((await call(env, '/api/notes', { body: { name: 'x', content: 'y' }, headers: { origin: 'https://evil.example' } })).status).toBe(403);
  });
});

describe('上传与语音（R2，仅好朋友）', () => {
  it('未登录 401；图片上传进收件箱；站长通过、下载、删除', async () => {
    const fd = form({ file: new Blob([PNG], { type: 'image/png' }), note: '送你一张图' });
    expect((await call(env, '/api/members/uploads', { raw: fd })).status).toBe(401);
    const { token } = await join('uploader@example.com', '上传君', 60);
    const r = await call(env, '/api/members/uploads', { raw: form({ file: new Blob([PNG], { type: 'image/png' }), note: '送你一张图' }), token });
    expect(r.status).toBe(201);
    const { id, status } = (await r.json()) as any;
    expect(status).toBe('pending');
    const inbox = (await (await call(env, '/api/admin/inbox', { cookie: admin.cookie })).json()) as any;
    const f = inbox.files.find((x: any) => x.id === id);
    expect(f).toMatchObject({ memberName: '上传君', contentType: 'image/png', note: '送你一张图', size: PNG.byteLength });
    expect((await call(env, `/api/admin/inbox/files/${id}`, { body: { action: 'approve' }, cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    const raw = await call(env, f.url, { cookie: admin.cookie });
    expect(raw.status).toBe(200);
    expect(raw.headers.get('content-disposition')).toContain('attachment');
    expect(new Uint8Array(await raw.arrayBuffer())).toEqual(PNG);
    expect((await call(env, f.url)).status).toBe(401); // 只有站长能下载
    expect((await call(env, `/api/admin/inbox/files/${id}`, { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, f.url, { cookie: admin.cookie })).status).toBe(404);
  });

  it('伪造类型 / 不支持的类型被拒', async () => {
    const { token } = await join('faker@example.com', '伪造君', 61);
    expect((await call(env, '/api/members/uploads', { raw: form({ file: new Blob(['not a png'], { type: 'image/png' }) }), token })).status).toBe(415);
    expect((await call(env, '/api/members/uploads', { raw: form({ file: new Blob(['<html>'], { type: 'text/html' }) }, 'a.html'), token })).status).toBe(415);
  });

  it('语音留言：时长 1–60 秒，站长标记已读', async () => {
    const { token } = await join('voice@example.com', '说话君', 62);
    const audio = () => new Blob([new Uint8Array(2048)], { type: 'audio/webm;codecs=opus' });
    expect((await call(env, '/api/members/voice', { raw: form({ file: audio(), durationMs: '61000' }, 'v.webm'), token })).status).toBe(400);
    const r = await call(env, '/api/members/voice', { raw: form({ file: audio(), durationMs: '4200' }, 'v.webm'), token });
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as any;
    const inbox = (await (await call(env, '/api/admin/inbox', { cookie: admin.cookie })).json()) as any;
    expect(inbox.voice.find((v: any) => v.id === id)).toMatchObject({ name: '说话君', durationMs: 4200, read: false, contentType: 'audio/webm' });
    const raw = await call(env, `/api/admin/inbox/voice/${id}/raw`, { cookie: admin.cookie });
    expect(raw.headers.get('content-disposition')).toContain('inline');
    expect((await call(env, `/api/admin/inbox/voice/${id}`, { body: { action: 'read' }, cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, `/api/admin/inbox/voice/${id}`, { body: { action: 'approve' }, cookie: admin.cookie, csrf: admin.csrf })).status).toBe(400);
  });
});

describe('徽章与好朋友管理', () => {
  it('颁发、编号唯一、公开接口不含邮箱、收回、删除', async () => {
    const { member } = await join('badge@example.com', '徽章君', 70);
    const other = await join('badge2@example.com', '另一位', 71);
    const g = await call(env, `/api/admin/members/${member.id}/badges`, { body: { code: 'friend-0001', label: '第一位好朋友', style: 'pearlescent' }, cookie: admin.cookie, csrf: admin.csrf });
    expect(g.status).toBe(200);
    expect(((await g.json()) as any).badges[0]).toMatchObject({ code: 'FRIEND-0001', style: 'pearlescent' });
    expect((await call(env, `/api/admin/members/${other.member.id}/badges`, { body: { code: 'FRIEND-0001' }, cookie: admin.cookie, csrf: admin.csrf })).status).toBe(409);
    const pub = (await (await call(env, '/api/members')).json()) as any;
    const pm = pub.members.find((m: any) => m.id === member.id);
    expect(pm.badges[0].code).toBe('FRIEND-0001');
    expect(JSON.stringify(pub)).not.toContain('@example.com');
    const adminList = (await (await call(env, '/api/admin/members', { cookie: admin.cookie })).json()) as any;
    expect(adminList.members.find((m: any) => m.id === member.id).email).toBe('badge@example.com');
    const rv = await call(env, `/api/admin/members/${member.id}/badges/FRIEND-0001`, { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf });
    expect(((await rv.json()) as any).badges).toEqual([]);
    expect((await call(env, `/api/admin/members/${other.member.id}`, { method: 'DELETE', cookie: admin.cookie, csrf: admin.csrf })).status).toBe(200);
    expect((await call(env, '/api/members/me', { token: other.token })).status).toBe(401);
  });
});

describe('节日与项目', () => {
  it('公开读取种子节日（不含 emoji），站长整体替换并校验', async () => {
    const f = (await (await call(env, '/api/festivals')).json()) as any;
    expect(f.festivals.find((x: any) => x.id === 'national')).toMatchObject({ date: '10-01', theme: 'fireworks' });
    expect(JSON.stringify(f)).not.toMatch(/\p{Extended_Pictographic}/u);
    const bad = await call(env, '/api/admin/festivals', { method: 'PUT', body: { festivals: [{ id: 'x', name: 'x', date: '2026/10/01', theme: 'lunar' }] }, cookie: admin.cookie, csrf: admin.csrf });
    expect(bad.status).toBe(400);
    const ok = await call(env, '/api/admin/festivals', { method: 'PUT', body: { festivals: [...f.festivals, { id: 'birthday', name: '生日', date: '06-01', theme: 'fireworks', message: '生日快乐' }] }, cookie: admin.cookie, csrf: admin.csrf });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).festivals.at(-1)).toMatchObject({ id: 'birthday', days: 1 });
    const p = await call(env, '/api/admin/projects', { method: 'PUT', body: { items: [{ name: 'x', title: 'X', url: 'javascript:alert(1)' }] }, cookie: admin.cookie, csrf: admin.csrf });
    expect(p.status).toBe(400);
    expect(((await (await call(env, '/api/projects')).json()) as any).items[0].name).toBe('motionary');
  });
});

describe('社区 MCP 工具', () => {
  it('list_members / grant_badge / set_festivals / list_inbox', async () => {
    const { member } = await join('mcp@example.com', 'MCP君', 80);
    const g = await tool(env, 'grant_badge', { memberId: member.id, code: 'MCP-1', label: '工具人', style: 'brushed-metal' });
    expect(g.isError).toBe(false);
    expect(g.structuredContent.badges[0].code).toBe('MCP-1');
    const l = await tool(env, 'list_members');
    expect(l.structuredContent.members.some((m: any) => m.email === 'mcp@example.com')).toBe(true);
    expect((await tool(env, 'set_festivals', { festivals: [{ id: 'a', name: 'A', date: '13-45x', theme: 'lunar' }] })).isError).toBe(true);
    expect((await tool(env, 'list_inbox')).structuredContent).toHaveProperty('voice');
    expect((await tool(env, 'revoke_badge', { memberId: member.id, code: 'mcp-1' })).structuredContent.badges).toEqual([]);
  });
});
