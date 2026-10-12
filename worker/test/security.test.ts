// L22 账号安全与隐私中心：会话 / 登录提醒 / Passkey（ES256 + RS256）/ 安全记录 / 完整导出 / 注销冷静期 + 定时清除 / 隐私面板 / 管理员 TOTP。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_PASSWORD, call, disposeEnv, login, setupEnv } from './helpers';
import { testOutbox } from '../src/community';
import type { Env } from '../src/env';
import { mediaManifest, scheduledSecurity } from '../src/security';
import { base32Decode, hotp } from '../src/security-core';
import { assertion, attest, softAuthenticator, type SoftAuthenticator } from './webauthn-helpers';

let env: Env;
let admin: { cookie: string; csrf: string };
const ORIGIN = 'http://blog.test';
const RP = 'blog.test';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const J = async (r: Response) => (await r.json()) as any;
const codeFor = (email: string) => /(\d{6})/.exec(testOutbox.filter((m) => m.to === email).at(-1)?.text ?? '')?.[1] ?? '';
type U = { token: string; id: number; username: string; email: string };

async function signIn(email: string, ua: string, ip: string): Promise<string> {
  await env.DB.prepare("DELETE FROM rate_limits WHERE bucket = 'otp-email'").run();
  expect((await call(env, '/api/members/register', { body: { name: 'x', email }, headers: { 'cf-connecting-ip': ip } })).status).toBe(200);
  const r = await call(env, '/api/members/verify', { body: { email, code: codeFor(email) }, headers: { 'cf-connecting-ip': ip, 'user-agent': ua } });
  expect(r.status).toBe(200);
  return (await J(r)).token;
}
async function join(email: string, username: string, ip: string, ua = MAC): Promise<U> {
  const token = await signIn(email, ua, ip);
  const r = await call(env, '/api/social/me', { method: 'PUT', token, body: { username } });
  expect(r.status).toBe(200);
  return { token, id: (await J(r)).profile.id, username, email };
}
const get = (path: string, token?: string, headers: Record<string, string> = {}) => call(env, path, { token, headers });
const post = (path: string, token: string | undefined, body: unknown = {}, headers: Record<string, string> = {}) => call(env, path, { method: 'POST', token, body, headers });
const send = (method: string, path: string, token: string, body?: unknown) => call(env, path, { method, token, body });

beforeAll(async () => {
  env = await setupEnv({ EMAIL_PROVIDER: 'memory' });
  admin = await login(env, '10.22.9.9');
});
afterAll(async () => {
  // 测试库在各测试文件之间共用：确保二次验证关闭，别的测试文件的 login() 不受影响
  await env.DB.prepare('DELETE FROM admin_totp').run();
  await env.DB.prepare("DELETE FROM rate_limits WHERE bucket LIKE 'totp-%' OR bucket LIKE 'passkey-%'").run();
  await disposeEnv();
});

describe('sessions, devices and login alerts', () => {
  let A: U;
  let phone: string;
  it('records device label / method for each login; first login gives no alert', async () => {
    A = await join('sec-a@example.com', 'sec_alice', '10.22.1.10');
    const s = await J(await get('/api/security/sessions', A.token));
    expect(s.sessions).toHaveLength(1);
    expect(s.sessions[0]).toMatchObject({ device: 'Chrome · macOS', method: 'email', current: true });
    expect(s.sessions[0].id).toMatch(/^[0-9a-f]{16}$/);
    const n = await J(await get('/api/social/notifications', A.token));
    expect(n.notifications.filter((x: any) => x.objectKind === 'security')).toHaveLength(0);
  });
  it('a new device triggers an in-app alert; a known device on a new /24 triggers new_network; same network does not', async () => {
    phone = await signIn('sec-a@example.com', IPHONE, '10.22.1.11');
    let n = (await J(await get('/api/social/notifications', A.token))).notifications.filter((x: any) => x.objectKind === 'security');
    expect(n).toHaveLength(1);
    expect(n[0].excerpt).toContain('新设备');
    expect(n[0].excerpt).toContain('Safari · iOS');
    await signIn('sec-a@example.com', MAC, '10.22.77.5');
    n = (await J(await get('/api/social/notifications', A.token))).notifications.filter((x: any) => x.objectKind === 'security');
    expect(n).toHaveLength(2);
    expect(n[0].excerpt).toContain('新的网络');
    await signIn('sec-a@example.com', MAC, '10.22.77.99');
    n = (await J(await get('/api/social/notifications', A.token))).notifications.filter((x: any) => x.objectKind === 'security');
    expect(n).toHaveLength(2);
    const ev = await J(await get('/api/security/events', A.token));
    expect(ev.events.map((e: any) => e.kind)).toEqual(['login', 'new_network', 'new_device', 'login']);
    // 安全记录不含 IP / UA / 令牌
    expect(JSON.stringify(ev)).not.toMatch(/10\.22\.|Mozilla|m_[A-Za-z0-9_-]{20}/);
  });
  it('event pagination', async () => {
    const p1 = await J(await get('/api/security/events?limit=2', A.token));
    expect(p1.events).toHaveLength(2);
    const p2 = await J(await get(`/api/security/events?limit=2&before=${p1.nextBefore}`, A.token));
    expect(p2.events).toHaveLength(2);
    expect(p2.events[0].id).toBeLessThan(p1.events[1].id);
  });
  it('turning login alerts off stops new-device notifications (privacy panel)', async () => {
    expect((await send('PUT', '/api/security/privacy', A.token, { loginAlerts: false })).status).toBe(200);
    await signIn('sec-a@example.com', 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', '10.22.1.12');
    const n = (await J(await get('/api/social/notifications', A.token))).notifications.filter((x: any) => x.objectKind === 'security');
    expect(n).toHaveLength(2);
    expect((await send('PUT', '/api/security/privacy', A.token, { loginAlerts: true })).status).toBe(200);
  });
  it('revoke one device, then all others, then all (including this one)', async () => {
    let s = (await J(await get('/api/security/sessions', A.token))).sessions;
    expect(s.length).toBe(5);
    const phoneSess = (await J(await get('/api/security/sessions', phone))).sessions.find((x: any) => x.current);
    expect(phoneSess.device).toBe('Safari · iOS');
    expect((await send('DELETE', `/api/security/sessions/${phoneSess.id}`, A.token)).status).toBe(200);
    expect((await get('/api/security/sessions', phone)).status).toBe(401);
    expect((await send('DELETE', '/api/security/sessions/0000000000000000', A.token)).status).toBe(404);
    expect((await J(await post('/api/security/sessions/revoke-others', A.token))).revoked).toBe(3);
    s = (await J(await get('/api/security/sessions', A.token))).sessions;
    expect(s).toHaveLength(1);
    expect(s[0].current).toBe(true);
    expect((await J(await post('/api/security/sessions/revoke-all', A.token))).revoked).toBe(1);
    expect((await get('/api/security/sessions', A.token)).status).toBe(401);
  });
  it('requires a member token and an allowed Origin for writes', async () => {
    expect((await get('/api/security/overview')).status).toBe(401);
    const t = await signIn('sec-a@example.com', MAC, '10.22.1.10');
    expect((await post('/api/security/sessions/revoke-others', t, {}, { origin: 'https://evil.example' })).status).toBe(403);
  });
});

describe('passkeys (WebAuthn, ES256 + RS256)', () => {
  let B: U;
  const keys: Record<string, SoftAuthenticator> = {};
  async function register(alg: 'ES256' | 'RS256', label: string, origin = ORIGIN) {
    const o = await J(await post('/api/security/passkeys/register/options', B.token));
    expect(o.publicKey.rp.id).toBe(RP);
    expect(o.publicKey.pubKeyCredParams.map((p: any) => p.alg)).toEqual([-7, -257]);
    expect(o.publicKey.user.name).toBe(B.username);
    keys[alg] ??= await softAuthenticator(alg);
    const cred = await attest(keys[alg]!, { rpId: RP, origin, challenge: o.publicKey.challenge });
    return post('/api/security/passkeys/register/verify', B.token, { challengeId: o.challengeId, ...cred, label });
  }
  async function passkeyLogin(a: SoftAuthenticator, o: { origin?: string; signCount?: number } = {}) {
    const opt = await J(await post('/api/security/passkeys/login/options', undefined, {}, { 'cf-connecting-ip': '10.22.2.50' }));
    expect(opt.publicKey.rpId).toBe(RP);
    expect(opt.publicKey.allowCredentials).toEqual([]);
    const as = await assertion(a, { rpId: RP, origin: o.origin ?? ORIGIN, challenge: opt.publicKey.challenge, signCount: o.signCount });
    return post('/api/security/passkeys/login/verify', undefined, { challengeId: opt.challengeId, ...as }, { 'cf-connecting-ip': '10.22.2.50', 'user-agent': IPHONE });
  }
  it('registers ES256 and RS256 passkeys; rejects a wrong origin and a reused challenge', async () => {
    B = await join('sec-b@example.com', 'sec_bob', '10.22.2.10');
    const r1 = await register('ES256', '我的 iPhone');
    expect(r1.status).toBe(201);
    expect((await J(r1)).passkey).toMatchObject({ label: '我的 iPhone', alg: 'ES256' });
    const r2 = await register('RS256', 'Windows Hello');
    expect(r2.status).toBe(201);
    expect((await J(r2)).passkey.alg).toBe('RS256');
    const bad = await softAuthenticator('ES256');
    const o = await J(await post('/api/security/passkeys/register/options', B.token));
    const cred = await attest(bad, { rpId: RP, origin: 'https://evil.example', challenge: o.publicKey.challenge });
    expect((await post('/api/security/passkeys/register/verify', B.token, { challengeId: o.challengeId, ...cred })).status).toBe(400);
    // challenge 已被上一次（失败的）校验消耗
    const cred2 = await attest(bad, { rpId: RP, origin: ORIGIN, challenge: o.publicKey.challenge });
    expect((await J(await post('/api/security/passkeys/register/verify', B.token, { challengeId: o.challengeId, ...cred2 }))).error.code).toBe('challenge_invalid');
    // 已存在的凭据
    expect((await register('ES256', 'dup')).status).toBe(409);
    const list = await J(await get('/api/security/passkeys', B.token));
    expect(list.passkeys.map((k: any) => k.alg).sort()).toEqual(['ES256', 'RS256']);
    // 添加 Passkey 会有站内提醒
    const n = (await J(await get('/api/social/notifications', B.token))).notifications.filter((x: any) => x.objectKind === 'security');
    expect(n.length).toBe(2);
  });
  it('excludeCredentials lists existing keys', async () => {
    const o = await J(await post('/api/security/passkeys/register/options', B.token));
    expect(o.publicKey.excludeCredentials).toHaveLength(2);
  });
  it('usernameless login with either key returns a member token (method passkey)', async () => {
    for (const alg of ['ES256', 'RS256'] as const) {
      const r = await passkeyLogin(keys[alg]!);
      expect(r.status).toBe(200);
      const b = await J(r);
      expect(b.member.id).toBe(B.id);
      const s = (await J(await get('/api/security/sessions', b.token))).sessions.find((x: any) => x.current);
      expect(s).toMatchObject({ method: 'passkey', device: 'Safari · iOS' });
    }
  });
  it('rejects wrong origin, bad signature, unknown credential, and a sign-count regression (logged + alerted)', async () => {
    expect((await passkeyLogin(keys.ES256!, { origin: 'https://evil.example' })).status).toBe(401);
    const stranger = await softAuthenticator('ES256');
    expect((await passkeyLogin(stranger)).status).toBe(401);
    const r = await passkeyLogin(keys.ES256!, { signCount: 1 });
    expect(r.status).toBe(401);
    expect((await J(r)).error.code).toBe('passkey_counter');
    const ev = await J(await get('/api/security/events', B.token));
    expect(ev.events[0].kind).toBe('passkey_counter');
    // 之后正常递增的断言仍可登录
    expect((await passkeyLogin(keys.ES256!, { signCount: 100 })).status).toBe(200);
  });
  it('rename and delete; a deleted passkey can no longer sign in', async () => {
    const id = (await J(await get('/api/security/passkeys', B.token))).passkeys.find((k: any) => k.alg === 'RS256').id;
    const rn = await J(await send('PATCH', `/api/security/passkeys/${id}`, B.token, { label: '办公室电脑' }));
    expect(rn.passkeys.find((k: any) => k.id === id).label).toBe('办公室电脑');
    expect((await send('PATCH', `/api/security/passkeys/${id}`, B.token, { label: '' })).status).toBe(400);
    expect((await send('DELETE', `/api/security/passkeys/${id}`, B.token)).status).toBe(200);
    expect((await send('DELETE', `/api/security/passkeys/${id}`, B.token)).status).toBe(404);
    expect((await passkeyLogin(keys.RS256!)).status).toBe(401);
  });
  it("cannot touch someone else's passkey", async () => {
    const C = await join('sec-c@example.com', 'sec_carol', '10.22.3.10');
    const id = (await J(await get('/api/security/passkeys', B.token))).passkeys[0].id;
    expect((await send('DELETE', `/api/security/passkeys/${id}`, C.token)).status).toBe(404);
  });
});

describe('full data export', () => {
  it('JSON archive + media manifest + security section; no secrets; rate limited to 3 per day', async () => {
    const D = await join('sec-d@example.com', 'sec_dora', '10.22.4.10');
    await send('PUT', '/api/social/me', D.token, { avatarUrl: 'https://img.example.com/a.jpg' });
    const r = await get('/api/security/export', D.token);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toContain('sec_dora-full-export.json');
    const a = await J(r);
    expect(a.format).toBe('theblog-export/2');
    expect(a.account.email).toBe('sec-d@example.com');
    expect(a.security.sessions.length).toBeGreaterThan(0);
    expect(a.mediaManifest.items).toContainEqual({ url: 'https://img.example.com/a.jpg', path: 'account.avatarUrl' });
    const raw = JSON.stringify(a);
    expect(raw).not.toMatch(/token_hash|public_key_jwk|10\.22\./);
    expect(raw).not.toContain(D.token);
    expect((await get('/api/security/export', D.token)).status).toBe(200);
    expect((await get('/api/security/export', D.token)).status).toBe(200);
    expect((await get('/api/security/export', D.token)).status).toBe(429);
    expect((await J(await get('/api/security/events', D.token))).events.filter((e: any) => e.kind === 'export')).toHaveLength(3);
  });
  it('mediaManifest finds image / audio URLs anywhere and de-duplicates', () => {
    const m = mediaManifest({ a: { cover: '/api/images/x.webp' }, list: [{ url: 'https://cdn.example/v.m4a' }, { url: '/api/images/x.webp' }], text: 'hello https://x.example/page' });
    expect(m).toEqual([{ url: '/api/images/x.webp', path: 'a.cover' }, { url: 'https://cdn.example/v.m4a', path: 'list[0].url' }]);
  });
});

describe('account deletion with a 7-day grace period', () => {
  it('needs the username; pending signs out other devices; cancel works; due accounts are purged by cron', async () => {
    const E = await join('sec-e@example.com', 'sec_erin', '10.22.5.10');
    const other = await signIn('sec-e@example.com', IPHONE, '10.22.5.11');
    expect((await post('/api/security/deletion', E.token, { confirm: 'nope' })).status).toBe(400);
    const d = await J(await post('/api/security/deletion', E.token, { confirm: 'SEC_ERIN' }));
    expect(d.deletion).toMatchObject({ state: 'pending', daysLeft: 7 });
    expect((await get('/api/security/sessions', other)).status).toBe(401);
    expect((await J(await get('/api/security/overview', E.token))).deletion.state).toBe('pending');
    const c = await J(await post('/api/security/deletion/cancel', E.token));
    expect(c.deletion).toEqual({ state: 'none' });
    expect((await J(await get('/api/security/events', E.token))).events.slice(0, 2).map((e: any) => e.kind)).toEqual(['deletion_cancelled', 'deletion_requested']);

    // 再次申请，并留一条博客评论（清除后匿名保留）
    await post('/api/security/deletion', E.token, { confirm: 'sec_erin' });
    await env.DB.prepare("INSERT INTO comments (slug, name, content, status, member_id, created_at) VALUES ('hello-world', 'Erin', '留言', 'approved', ?, ?)").bind(E.id, new Date().toISOString()).run().catch(() => undefined);
    // 冷静期内 cron 不动它
    expect((await scheduledSecurity(env)).purged).toBe(0);
    await env.DB.prepare('UPDATE members SET deletion_requested_at = ? WHERE id = ?').bind(Math.floor(Date.now() / 1000) - 7 * 86400 - 5, E.id).run();
    expect((await scheduledSecurity(env)).purged).toBe(1);
    expect(await env.DB.prepare('SELECT 1 FROM members WHERE id = ?').bind(E.id).first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM user_profiles WHERE member_id = ?').bind(E.id).first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM security_events WHERE member_id = ?').bind(E.id).first()).toBeNull();
    const kept = await env.DB.prepare("SELECT member_id FROM comments WHERE content = '留言' AND name = 'Erin'").first<{ member_id: number | null }>();
    if (kept) expect(kept.member_id).toBeNull();
    expect((await get('/api/security/overview', E.token)).status).toBe(401);
    const adm = await J(await call(env, '/api/admin/security/2fa', { cookie: admin.cookie }));
    expect(adm.events.some((e: any) => e.kind === 'account_purged' && e.detail === `#${E.id}`)).toBe(true);
  });
  it('cron also drops expired challenges and events older than 180 days', async () => {
    await env.DB.prepare("INSERT INTO webauthn_challenges (id, kind, challenge, expires_at) VALUES ('old-challenge-1', 'login', 'x', 1)").run();
    await env.DB.prepare("INSERT INTO security_events (member_id, kind, created_at) VALUES (NULL, 'admin_login', 5)").run();
    await scheduledSecurity(env);
    expect(await env.DB.prepare("SELECT 1 FROM webauthn_challenges WHERE id = 'old-challenge-1'").first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM security_events WHERE created_at = 5').first()).toBeNull();
  });
});

describe('privacy panel', () => {
  it('reads defaults, writes profile / DM / discoverability / alerts in one place, validates input, lists blocks', async () => {
    const F = await join('sec-f@example.com', 'sec_finn', '10.22.6.10');
    const G = await join('sec-g@example.com', 'sec_gail', '10.22.6.11');
    let p = await J(await get('/api/security/privacy', F.token));
    expect(p.privacy).toEqual({ visibility: 'public', discoverable: true, showFollows: true, dmPolicy: 'everyone', readReceipts: true, showPresence: true, loginAlerts: true, emailNotifications: false });
    expect(p.blocked).toEqual([]);
    expect((await send('PUT', '/api/security/privacy', F.token, { dmPolicy: 'sometimes' })).status).toBe(400);
    expect((await send('PUT', '/api/security/privacy', F.token, { password: 'x' })).status).toBe(400);
    p = await J(await send('PUT', '/api/security/privacy', F.token, { visibility: 'private', discoverable: false, dmPolicy: 'nobody', showPresence: false }));
    expect(p.privacy).toMatchObject({ visibility: 'private', discoverable: false, dmPolicy: 'nobody', showPresence: false, readReceipts: true });
    // 与 L15 / L19 的原有设置是同一份数据
    expect((await J(await get('/api/social/me', F.token))).settings).toMatchObject({ visibility: 'private', discoverable: false });
    expect((await J(await get('/api/social/dm/settings', F.token))).settings).toMatchObject({ policy: 'nobody', showPresence: false });
    await post(`/api/social/blocks/${G.username}`, F.token);
    p = await J(await get('/api/security/privacy', F.token));
    expect(p.blocked.map((u: any) => u.username)).toEqual(['sec_gail']);
    expect((await J(await get('/api/security/events', F.token))).events[0]).toMatchObject({ kind: 'privacy_changed', detail: 'visibility,discoverable,dmPolicy,showPresence' });
  });
});

describe('admin TOTP two-factor', () => {
  const step = () => Math.floor(Date.now() / 1000 / 30);
  let secret: Uint8Array;
  let recovery: string[] = [];
  const adm = (path: string, body?: unknown, ip = '10.22.9.9') =>
    call(env, path, { method: body === undefined ? 'GET' : 'POST', cookie: admin.cookie, csrf: admin.csrf, body, headers: { 'cf-connecting-ip': ip } });
  const pw = (ip: string) => call(env, '/api/auth/login', { body: { password: ADMIN_PASSWORD }, headers: { 'cf-connecting-ip': ip } });
  it('setup → confirm returns 10 recovery codes once; secret is stored encrypted', async () => {
    expect((await J(await adm('/api/admin/security/2fa'))).enabled).toBe(false);
    const s = await J(await adm('/api/admin/security/2fa/setup', {}));
    expect(s.otpauth).toMatch(/^otpauth:\/\/totp\/TheBLOG%3Aadmin\?secret=[A-Z2-7]+&issuer=TheBLOG/);
    secret = base32Decode(s.secret);
    expect((await adm('/api/admin/security/2fa/confirm', { code: '000000' }, '10.22.9.1')).status).toBe(400);
    const c = await J(await adm('/api/admin/security/2fa/confirm', { code: await hotp(secret, step()) }, '10.22.9.1'));
    expect(c.enabled).toBe(true);
    recovery = c.recoveryCodes;
    expect(recovery).toHaveLength(10);
    const row = await env.DB.prepare('SELECT secret_enc, recovery_json FROM admin_totp WHERE id = 1').first<{ secret_enc: string; recovery_json: string }>();
    expect(row!.secret_enc).not.toContain(s.secret);
    expect(row!.recovery_json).not.toContain(recovery[0]!.replace('-', ''));
    const st = await J(await adm('/api/admin/security/2fa'));
    expect(st).toMatchObject({ enabled: true, recoveryRemaining: 10 });
    expect((await adm('/api/admin/security/2fa/setup', {})).status).toBe(409);
  });
  it('password login now needs a second step; preAuth is not a session; replayed and wrong codes fail', async () => {
    const r = await pw('10.22.9.20');
    const b = await J(r);
    expect(b).toMatchObject({ ok: true, needsTotp: true });
    expect(r.headers.get('set-cookie')).toBeNull();
    // preAuth 塞进 Cookie 不被当成会话
    expect((await call(env, '/api/admin/posts', { cookie: `__Host-blog_session=${b.preAuth}` })).status).toBe(401);
    expect((await post('/api/auth/2fa', undefined, { preAuth: b.preAuth, code: '123456' }, { 'cf-connecting-ip': '10.22.9.20' })).status).toBe(401);
    // confirm 用掉了当前时间步：同一个码重放被拒；下一步的码（±1 窗口内）可以
    expect((await post('/api/auth/2fa', undefined, { preAuth: b.preAuth, code: await hotp(secret, step()) }, { 'cf-connecting-ip': '10.22.9.20' })).status).toBe(401);
    const ok = await post('/api/auth/2fa', undefined, { preAuth: b.preAuth, code: await hotp(secret, step() + 1) }, { 'cf-connecting-ip': '10.22.9.20' });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('set-cookie')).toContain('__Host-blog_session=');
    expect((await J(ok)).csrfToken).toBeTruthy();
    // 同一个 preAuth 不能再换第二个会话
    expect((await post('/api/auth/2fa', undefined, { preAuth: b.preAuth, code: recovery[5] }, { 'cf-connecting-ip': '10.22.9.21' })).status).toBe(401);
  });
  it('a recovery code works exactly once', async () => {
    const b = await J(await pw('10.22.9.30'));
    expect((await post('/api/auth/2fa', undefined, { preAuth: b.preAuth, code: recovery[0]!.toLowerCase() }, { 'cf-connecting-ip': '10.22.9.30' })).status).toBe(200);
    const b2 = await J(await pw('10.22.9.31'));
    expect((await post('/api/auth/2fa', undefined, { preAuth: b2.preAuth, code: recovery[0] }, { 'cf-connecting-ip': '10.22.9.31' })).status).toBe(401);
    expect((await J(await adm('/api/admin/security/2fa'))).recoveryRemaining).toBe(9);
  });
  it('verify is rate limited per IP (5 per 15 min)', async () => {
    const b = await J(await pw('10.22.9.40'));
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await post('/api/auth/2fa', undefined, { preAuth: b.preAuth, code: '000000' }, { 'cf-connecting-ip': '10.22.9.40' })).status);
    expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true);
    expect(codes[5]).toBe(429);
  });
  it('expired / forged preAuth is rejected', async () => {
    expect((await post('/api/auth/2fa', undefined, { preAuth: 'a.b.c', code: '000000' }, { 'cf-connecting-ip': '10.22.9.50' })).status).toBe(401);
  });
  it('admin security log lists logins without IPs; regenerate recovery codes needs a TOTP; disable with a recovery code', async () => {
    const st = await J(await adm('/api/admin/security/2fa'));
    const kinds = st.events.map((e: any) => e.kind);
    for (const k of ['admin_2fa_enabled', 'admin_login', 'admin_recovery_used', 'admin_2fa_failed']) expect(kinds).toContain(k);
    expect(JSON.stringify(st)).not.toMatch(/10\.22\./);
    expect((await adm('/api/admin/security/2fa/recovery', { code: recovery[1] }, '10.22.9.60')).status).toBe(400);
    // 登录已用掉 step()+1：把 last_step 拨回去，模拟 30 秒以后
    await env.DB.prepare('UPDATE admin_totp SET last_step = ? WHERE id = 1').bind(step() - 2).run();
    const rg = await J(await adm('/api/admin/security/2fa/recovery', { code: await hotp(secret, step()) }, '10.22.9.60'));
    expect(rg.recoveryCodes).toHaveLength(10);
    const fresh: string[] = rg.recoveryCodes;
    expect((await J(await adm('/api/admin/security/2fa'))).recoveryRemaining).toBe(10);
    // 旧恢复码作废
    expect((await adm('/api/admin/security/2fa/disable', { code: recovery[3] }, '10.22.9.61')).status).toBe(400);
    const d = await adm('/api/admin/security/2fa/disable', { code: fresh[2] }, '10.22.9.61');
    expect(d.status).toBe(200);
    expect((await J(d)).enabled).toBe(false);
    // 关闭后密码登录直接拿到会话
    const r = await pw('10.22.9.62');
    expect(r.headers.get('set-cookie')).toContain('__Host-blog_session=');
  });
});
