import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { DemoBackend, memoryKV, type KV } from '../src/demo/mock-api';
import { DEMO_OTP, DEMO_PASSWORD } from '../src/demo/seed';
import { DEMO_RP, mediaManifest } from '../src/demo/mock-security';
import { parseRoute, routePath, SOCIAL_ROUTES } from '../src/render';
import { base32Decode, hotp } from '../src/security-core';
import { EVENT_LABEL, SEC_TABS, b64uToBytes, bytesToB64u, centerHtml, credentialJson, eventText, toCreationOptions, toRequestOptions } from '../src/security-client';
import { assertion, attest, softAuthenticator } from '../../worker/test/webauthn-helpers';

let kv: KV;
let api: DemoBackend;
let clock = Date.parse('2026-10-12T08:00:00Z');
beforeEach(() => {
  clock = Date.parse('2026-10-12T08:00:00Z');
  kv = memoryKV();
  api = new DemoBackend({ storage: kv, base: '/TheBLOG/', now: () => new Date(clock) });
});
const B = (r: { body: unknown }) => r.body as any;
async function join(email = 'sec@example.com', name = '安全测试'): Promise<Record<string, string>> {
  await api.handle('POST', '/api/members/register', { name, email });
  const r = B(await api.handle('POST', '/api/members/verify', { email, code: DEMO_OTP }));
  return { authorization: `Bearer ${r.token}` };
}
const totpNow = async (secretB32: string) => hotp(base32Decode(secretB32), Math.floor(clock / 1000 / 30));

describe('L22 路由 / 共享核心', () => {
  it('/me/security/ 交给社交外壳按需渲染', () => {
    expect(parseRoute('/me/security/')).toEqual({ name: 'security' });
    expect(routePath({ name: 'security' })).toBe('/me/security/');
    expect(SOCIAL_ROUTES).toContain('security');
  });
  it('迁移 0019 只做加法', () => {
    const sql = readFileSync(fileURLToPath(new URL('../../worker/migrations/0019_security.sql', import.meta.url)), 'utf8').replace(/--.*$/gm, '');
    expect(sql).not.toMatch(/(^|;)\s*(DROP|DELETE|UPDATE)\b/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS passkeys/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+\w+\s+(DROP|RENAME)/i);
  });
});

describe('L22 security-client 纯函数', () => {
  it('base64url 往返；创建 / 获取选项把字符串换成二进制；凭据转 JSON', () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
    expect(b64uToBytes(bytesToB64u(bytes))).toEqual(bytes);
    expect(bytesToB64u(new Uint8Array([251, 255]))).toBe('-_8');
    const c = toCreationOptions({ challenge: 'AAEC', user: { id: 'AQI', name: 'u', displayName: 'U' }, rp: { id: 'x', name: 'x' }, pubKeyCredParams: [], excludeCredentials: [{ type: 'public-key', id: 'AwQ' }] });
    expect(new Uint8Array(c.challenge as ArrayBuffer)).toEqual(new Uint8Array([0, 1, 2]));
    expect(new Uint8Array(c.user.id as ArrayBuffer)).toEqual(new Uint8Array([1, 2]));
    expect(new Uint8Array(c.excludeCredentials![0]!.id as ArrayBuffer)).toEqual(new Uint8Array([3, 4]));
    const g = toRequestOptions({ challenge: 'AAEC', rpId: 'x', allowCredentials: [] });
    expect(new Uint8Array(g.challenge as ArrayBuffer)).toEqual(new Uint8Array([0, 1, 2]));
    const fake = { id: 'abc', rawId: new Uint8Array([1]).buffer, type: 'public-key', response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer, userHandle: null } };
    expect(credentialJson(fake as never)).toEqual({ id: 'AQ', clientDataJSON: 'Ag', authenticatorData: 'Aw', signature: 'BA' });
  });
  it('5 个标签页、无障碍的 tablist；每种安全记录都有中文说明', () => {
    expect(SEC_TABS.map((t) => t.key)).toEqual(['devices', 'passkeys', 'privacy', 'data', 'log']);
    const html = centerHtml('passkeys');
    expect(html).toContain('role="tablist"');
    expect((html.match(/role="tab"/g) ?? []).length).toBe(5);
    expect((html.match(/role="tabpanel"/g) ?? []).length).toBe(5);
    expect(html).toMatch(/id="sec-tab-passkeys"[^>]*aria-selected="true"/);
    expect(html).toMatch(/id="sec-tab-devices"[^>]*tabindex="-1"/);
    for (const k of ['login', 'new_device', 'new_network', 'passkey_added', 'passkey_removed', 'passkey_counter', 'logout_device', 'logout_others', 'logout_all', 'export', 'deletion_requested', 'deletion_cancelled', 'privacy_changed', 'admin_login', 'admin_2fa_enabled']) expect(EVENT_LABEL[k], k).toBeTruthy();
    expect(eventText({ kind: 'login', detail: 'passkey' })).toContain('Passkey');
    expect(eventText({ kind: 'unknown_kind', detail: '' })).toBe('unknown_kind');
  });
});

describe('L22 演示 mock：设备与会话 / 安全记录', () => {
  it('概览：本机会话 + 标明演示数据的虚构设备；退出某个 / 其它全部；记录可分页', async () => {
    const h = await join();
    const o = B(await api.handle('GET', '/api/security/overview', undefined, h));
    expect(o.sessions.filter((s: any) => s.current)).toHaveLength(1);
    const fake = o.sessions.filter((s: any) => s.demo);
    expect(fake.length).toBeGreaterThanOrEqual(2);
    expect(fake.every((s: any) => /演示/.test(s.device))).toBe(true);
    expect(o.passkeys).toEqual([]);
    expect(o.deletion).toEqual({ state: 'none' });
    expect(o.privacy).toMatchObject({ visibility: 'public', dmPolicy: 'everyone', loginAlerts: true });
    expect(o.events[0].kind).toBe('login');
    const del = await api.handle('DELETE', `/api/security/sessions/${fake[0].id}`, undefined, h);
    expect(del.status).toBe(200);
    expect((await api.handle('DELETE', '/api/security/sessions/0000000000000000', undefined, h)).status).toBe(404);
    const r = B(await api.handle('POST', '/api/security/sessions/revoke-others', {}, h));
    expect(r.revoked).toBeGreaterThanOrEqual(1);
    const s = B(await api.handle('GET', '/api/security/sessions', undefined, h)).sessions;
    expect(s).toHaveLength(1);
    expect(s[0].current).toBe(true);
    const ev = B(await api.handle('GET', '/api/security/events?limit=2', undefined, h));
    expect(ev.events.map((x: any) => x.kind)).toEqual(['logout_others', 'logout_device']);
    expect(ev.nextBefore).toBeTypeOf('number');
    const more = B(await api.handle('GET', `/api/security/events?limit=2&before=${ev.nextBefore}`, undefined, h));
    expect(more.events.map((x: any) => x.kind)).toContain('login');
    // 退出全部（包括本机）→ 令牌失效
    await api.handle('POST', '/api/security/sessions/revoke-all', {}, h);
    expect((await api.handle('GET', '/api/security/overview', undefined, h)).status).toBe(401);
  });
  it('未登录 401；其他人看不到我的会话', async () => {
    expect((await api.handle('GET', '/api/security/overview')).status).toBe(401);
    const a = await join('a@example.com', 'A');
    const b = await join('b@example.com', 'B');
    const sa = B(await api.handle('GET', '/api/security/sessions', undefined, a)).sessions.find((s: any) => s.current);
    expect((await api.handle('DELETE', `/api/security/sessions/${sa.id}`, undefined, b)).status).toBe(404);
  });
});

describe('L22 演示 mock：Passkey（与 Worker 相同的校验：clientData / rpIdHash / 签名 / 计数）', () => {
  it('注册 → 无用户名登录 → 计数回退拒绝 → 改名 / 删除', async () => {
    const h = await join();
    const auth = await softAuthenticator('ES256');
    const opt = B(await api.handle('POST', '/api/security/passkeys/register/options', {}, h));
    expect(opt.publicKey.rp.id).toBe(DEMO_RP.id);
    expect(opt.publicKey.authenticatorSelection.residentKey).toBe('required');
    // 错误的来源 → 拒绝
    const bad = await attest(auth, { rpId: DEMO_RP.id, origin: 'https://evil.example', challenge: opt.publicKey.challenge });
    expect((await api.handle('POST', '/api/security/passkeys/register/verify', { challengeId: opt.challengeId, ...bad }, h)).status).toBe(400);
    // challenge 一次性：同一个 challengeId 不能再用
    const good0 = await attest(auth, { rpId: DEMO_RP.id, origin: DEMO_RP.origin, challenge: opt.publicKey.challenge });
    expect((await api.handle('POST', '/api/security/passkeys/register/verify', { challengeId: opt.challengeId, ...good0 }, h)).status).toBe(400);
    const opt2 = B(await api.handle('POST', '/api/security/passkeys/register/options', {}, h));
    const good = await attest(auth, { rpId: DEMO_RP.id, origin: DEMO_RP.origin, challenge: opt2.publicKey.challenge });
    const reg = await api.handle('POST', '/api/security/passkeys/register/verify', { challengeId: opt2.challengeId, label: '我的电脑', ...good }, h);
    expect(reg.status).toBe(201);
    expect(B(reg).passkey).toMatchObject({ label: '我的电脑', alg: 'ES256' });
    // 登录（公开接口，不带令牌）
    const lo = B(await api.handle('POST', '/api/security/passkeys/login/options', {}));
    expect(lo.publicKey.rpId).toBe(DEMO_RP.id);
    const as = await assertion(auth, { rpId: DEMO_RP.id, origin: DEMO_RP.origin, challenge: lo.publicKey.challenge });
    const login = await api.handle('POST', '/api/security/passkeys/login/verify', { challengeId: lo.challengeId, ...as });
    expect(login.status).toBe(200);
    const token = B(login).token as string;
    expect(B(await api.handle('GET', '/api/members/me', undefined, { authorization: `Bearer ${token}` })).member.name).toBe('安全测试');
    const sessions = B(await api.handle('GET', '/api/security/sessions', undefined, h)).sessions;
    expect(sessions.some((s: any) => s.method === 'passkey')).toBe(true);
    // 签名被篡改 → 拒绝
    const lo2 = B(await api.handle('POST', '/api/security/passkeys/login/options', {}));
    const as2 = await assertion(auth, { rpId: DEMO_RP.id, origin: DEMO_RP.origin, challenge: lo2.publicKey.challenge });
    const sig = b64uToBytes(as2.signature);
    sig[sig.length - 1] = sig[sig.length - 1]! ^ 1;
    expect((await api.handle('POST', '/api/security/passkeys/login/verify', { challengeId: lo2.challengeId, ...as2, signature: bytesToB64u(sig) })).status).toBe(401);
    // 计数回退（克隆的凭据）→ 拒绝并记录
    const lo3 = B(await api.handle('POST', '/api/security/passkeys/login/options', {}));
    const as3 = await assertion(auth, { rpId: DEMO_RP.id, origin: DEMO_RP.origin, challenge: lo3.publicKey.challenge, signCount: 1 });
    const cnt = await api.handle('POST', '/api/security/passkeys/login/verify', { challengeId: lo3.challengeId, ...as3 });
    expect(cnt.status).toBe(401);
    expect(B(cnt).error.code).toBe('passkey_counter');
    const kinds = B(await api.handle('GET', '/api/security/events?limit=50', undefined, h)).events.map((x: any) => x.kind);
    expect(kinds).toEqual(expect.arrayContaining(['passkey_added', 'passkey_counter', 'login']));
    // 改名 / 删除
    const id = B(reg).passkey.id;
    expect(B(await api.handle('PATCH', `/api/security/passkeys/${id}`, { label: '工作电脑' }, h)).passkeys[0].label).toBe('工作电脑');
    expect(B(await api.handle('DELETE', `/api/security/passkeys/${id}`, undefined, h)).passkeys).toEqual([]);
    // 删除后不能再登录
    const lo4 = B(await api.handle('POST', '/api/security/passkeys/login/options', {}));
    const as4 = await assertion(auth, { rpId: DEMO_RP.id, origin: DEMO_RP.origin, challenge: lo4.publicKey.challenge });
    expect((await api.handle('POST', '/api/security/passkeys/login/verify', { challengeId: lo4.challengeId, ...as4 })).status).toBe(401);
  });
});

describe('L22 演示 mock：隐私权限 / 拉黑名单', () => {
  it('一个面板改资料可见性、私信、在线状态与登录提醒；与原有设置同一份数据', async () => {
    const h = await join();
    const p = B(await api.handle('PUT', '/api/security/privacy', { visibility: 'members', discoverable: false, dmPolicy: 'mutuals', readReceipts: false, showPresence: false, loginAlerts: false }, h));
    expect(p.privacy).toMatchObject({ visibility: 'members', discoverable: false, dmPolicy: 'mutuals', readReceipts: false, showPresence: false, loginAlerts: false });
    expect(B(await api.handle('GET', '/api/social/me', undefined, h)).settings).toMatchObject({ visibility: 'members', discoverable: false });
    expect(B(await api.handle('GET', '/api/social/dm/settings', undefined, h)).settings).toMatchObject({ policy: 'mutuals', readReceipts: false, showPresence: false });
    expect((await api.handle('PUT', '/api/security/privacy', { visibility: 'everyone' }, h)).status).toBe(400);
    expect((await api.handle('PUT', '/api/security/privacy', { nope: true }, h)).status).toBe(400);
    await api.handle('POST', '/api/social/blocks/momo', {}, h);
    const g = B(await api.handle('GET', '/api/security/privacy', undefined, h));
    expect(g.blocked.map((u: any) => u.username)).toEqual(['momo']);
    expect(B(await api.handle('GET', '/api/security/events', undefined, h)).events[0]).toMatchObject({ kind: 'privacy_changed' });
  });
});

describe('L22 演示 mock：完整导出 / 7 天冷静期注销', () => {
  it('导出含账号、安全信息与媒体清单（不含凭据 ID）', async () => {
    const h = await join();
    const x = B(await api.handle('GET', '/api/security/export', undefined, h));
    expect(x.format).toBe('theblog-export/2');
    expect(x.account.email).toBe('sec@example.com');
    expect(x.security.sessions.length).toBeGreaterThan(0);
    expect(x.security.sessions[0].id).toBeUndefined();
    expect(x.mediaManifest.count).toBe(x.mediaManifest.items.length);
    expect(mediaManifest({ a: { cover: 'https://x.example/p.jpg', t: 'hi' }, b: ['/api/images/2026/01/a.webp', 'https://x.example/p.jpg'] })).toEqual([
      { url: 'https://x.example/p.jpg', path: 'a.cover' },
      { url: '/api/images/2026/01/a.webp', path: 'b[0]' },
    ]);
    expect(B(await api.handle('GET', '/api/security/events', undefined, h)).events[0].kind).toBe('export');
  });
  it('申请注销（回填用户名）→ 冷静期 7 天 → 撤销；再申请并等满 7 天 → 账号被清除', async () => {
    const h = await join();
    const username = B(await api.handle('GET', '/api/social/me', undefined, h)).profile.username;
    expect((await api.handle('POST', '/api/security/deletion', { confirm: 'wrong' }, h)).status).toBe(400);
    const d = B(await api.handle('POST', '/api/security/deletion', { confirm: username }, h)).deletion;
    expect(d).toMatchObject({ state: 'pending', daysLeft: 7 });
    expect(d.purgeAt).toBe(Math.floor(clock / 1000) + 7 * 86400);
    // 申请时退出其它设备（虚构设备也清掉）
    expect(B(await api.handle('GET', '/api/security/sessions', undefined, h)).sessions).toHaveLength(1);
    expect(B(await api.handle('POST', '/api/security/deletion/cancel', {}, h)).deletion).toEqual({ state: 'none' });
    await api.handle('POST', '/api/security/deletion', { confirm: username }, h);
    clock += 6 * 86400_000;
    expect(B(await api.handle('GET', '/api/security/deletion', undefined, h)).deletion).toMatchObject({ state: 'pending', daysLeft: 1 });
    clock += 1 * 86400_000 + 1000;
    // 演示站没有定时任务：下一次请求时清除到期账号
    expect((await api.handle('GET', '/api/security/overview', undefined, h)).status).toBe(401);
    expect(B(await api.handle('GET', '/api/members')).members.some((m: any) => m.name === '安全测试')).toBe(false);
  });
});

describe('L22 演示 mock：管理员二次验证（TOTP + 恢复码）', () => {
  async function adminLogin(): Promise<any> {
    return B(await api.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD }));
  }
  it('开启 → 密码登录需要第二步 → 验证码 / 恢复码（一次性）→ 关闭', async () => {
    let csrf = { 'x-csrf-token': (await adminLogin()).csrfToken };
    expect(B(await api.handle('GET', '/api/admin/security/2fa', undefined, csrf))).toMatchObject({ enabled: false, pending: false });
    const s = B(await api.handle('POST', '/api/admin/security/2fa/setup', {}, csrf));
    expect(s.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(s.otpauth).toMatch(/^otpauth:\/\/totp\/TheBLOG%3Aadmin\?secret=[A-Z2-7]+&issuer=TheBLOG/);
    expect((await api.handle('POST', '/api/admin/security/2fa/confirm', { code: '000000' }, csrf)).status).toBe(400);
    const c = B(await api.handle('POST', '/api/admin/security/2fa/confirm', { code: await totpNow(s.secret) }, csrf));
    expect(c.recoveryCodes).toHaveLength(10);
    await api.handle('POST', '/api/auth/logout', {}, csrf);
    // 第一步：密码正确 → 只拿到 preAuth，没有会话
    const step1 = await adminLogin();
    expect(step1).toMatchObject({ ok: true, needsTotp: true });
    expect(step1.csrfToken).toBeUndefined();
    expect((await api.handle('GET', '/api/admin/posts', undefined, {})).status).toBe(401);
    expect((await api.handle('POST', '/api/auth/2fa', { preAuth: step1.preAuth, code: '123456' })).status).toBe(401);
    // 同一个时间窗的验证码已经在开启时用过（防重放）→ 等下一个窗口
    expect((await api.handle('POST', '/api/auth/2fa', { preAuth: step1.preAuth, code: await totpNow(s.secret) })).status).toBe(401);
    clock += 30_000;
    const ok2 = B(await api.handle('POST', '/api/auth/2fa', { preAuth: step1.preAuth, code: await totpNow(s.secret) }));
    expect(ok2.csrfToken).toBeTruthy();
    // preAuth 用过就作废
    expect((await api.handle('POST', '/api/auth/2fa', { preAuth: step1.preAuth, code: c.recoveryCodes[0] })).status).toBe(401);
    // 恢复码只能用一次
    const step2 = await adminLogin();
    expect(B(await api.handle('POST', '/api/auth/2fa', { preAuth: step2.preAuth, code: c.recoveryCodes[0] })).csrfToken).toBeTruthy();
    const step3 = await adminLogin();
    expect((await api.handle('POST', '/api/auth/2fa', { preAuth: step3.preAuth, code: c.recoveryCodes[0] })).status).toBe(401);
    // preAuth 5 分钟过期
    clock += 301_000;
    expect((await api.handle('POST', '/api/auth/2fa', { preAuth: step3.preAuth, code: c.recoveryCodes[1] })).status).toBe(401);
    const step4 = await adminLogin();
    csrf = { 'x-csrf-token': B(await api.handle('POST', '/api/auth/2fa', { preAuth: step4.preAuth, code: c.recoveryCodes[1] })).csrfToken };
    const st = B(await api.handle('GET', '/api/admin/security/2fa', undefined, csrf));
    expect(st).toMatchObject({ enabled: true, recoveryRemaining: 8 });
    expect(st.events.map((x: any) => x.kind)).toEqual(expect.arrayContaining(['admin_2fa_enabled', 'admin_login', 'admin_recovery_used', 'admin_2fa_failed']));
    clock += 30_000;
    expect(B(await api.handle('POST', '/api/admin/security/2fa/disable', { code: await totpNow(s.secret) }, csrf))).toEqual({ enabled: false });
    expect((await adminLogin()).csrfToken).toBeTruthy();
  });
});
