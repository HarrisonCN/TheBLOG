import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_PASSWORD, call, disposeEnv, login, setupEnv } from './helpers';
import { signJwt, verifyJwt, verifyPassword, sha256Hex, timingSafeEqual } from '../src/crypto';
import { LOGIN_MAX_FAILURES } from '../src/auth';
import type { Env } from '../src/env';
import { pbkdf2Sync } from 'node:crypto';

let env: Env;
beforeAll(async () => {
  env = await setupEnv();
});
afterAll(disposeEnv);

describe('crypto 工具', () => {
  it('PBKDF2 校验与 Node 生成的哈希兼容', async () => {
    const salt = Buffer.from('0123456789abcdef');
    const h = `pbkdf2$100000$${salt.toString('base64')}$${pbkdf2Sync('pw-123456789', salt, 100_000, 32, 'sha256').toString('base64')}`;
    expect(await verifyPassword('pw-123456789', h)).toBe(true);
    expect(await verifyPassword('pw-12345678', h)).toBe(false);
    expect(await verifyPassword('x', 'plain')).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2$999999999$AA==$AA==')).toBe(false);
  });

  it('JWT 签名、过期、篡改、alg 混淆', async () => {
    const now = Math.floor(Date.now() / 1000);
    const claims = { sub: 'admin', iat: now, exp: now + 60, jti: 'j', csrf: 'c' };
    const t = await signJwt(claims, 'secret-secret-secret');
    expect((await verifyJwt(t, 'secret-secret-secret'))?.csrf).toBe('c');
    expect(await verifyJwt(t, 'other-secret-other')).toBeNull();
    expect(await verifyJwt(t, 'secret-secret-secret', now + 61)).toBeNull();
    const [, p, s] = t.split('.');
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    expect(await verifyJwt(`${none}.${p}.${s}`, 'secret-secret-secret')).toBeNull();
    const tampered = Buffer.from(JSON.stringify({ ...claims, exp: now + 99999 })).toString('base64url');
    expect(await verifyJwt(`${t.split('.')[0]}.${tampered}.${s}`, 'secret-secret-secret')).toBeNull();
  });

  it('sha256 / timingSafeEqual', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(timingSafeEqual('a', 'a')).toBe(true);
    expect(timingSafeEqual('a', 'b')).toBe(false);
    expect(timingSafeEqual('a', 'ab')).toBe(false);
  });
});

describe('后台登录', () => {
  it('成功登录：httpOnly + Secure + SameSite=Strict 的短期 Cookie', async () => {
    const { setCookie, cookie, csrf } = await login(env, '10.1.1.1');
    expect(setCookie).toMatch(/^__Host-blog_session=/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Max-Age=3600');
    expect(csrf.length).toBeGreaterThan(20);
    const s = (await (await call(env, '/api/auth/session', { cookie })).json()) as any;
    expect(s.authenticated).toBe(true);
    expect(s.csrfToken).toBe(csrf);
  });

  it('错误密码 401，连续失败后 429 限流，成功前不重置', async () => {
    const ip = '10.2.2.2';
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      const r = await call(env, '/api/auth/login', { body: { password: 'nope' }, headers: { 'cf-connecting-ip': ip } });
      expect(r.status).toBe(401);
    }
    const blocked = await call(env, '/api/auth/login', { body: { password: ADMIN_PASSWORD }, headers: { 'cf-connecting-ip': ip } });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    // 其他 IP 不受影响
    expect((await call(env, '/api/auth/login', { body: { password: ADMIN_PASSWORD }, headers: { 'cf-connecting-ip': '10.3.3.3' } })).status).toBe(200);
  });

  it('跨站登录请求被拒（login CSRF）', async () => {
    const r = await call(env, '/api/auth/login', { body: { password: ADMIN_PASSWORD }, headers: { origin: 'https://evil.example', 'cf-connecting-ip': '10.4.4.4' } });
    expect(r.status).toBe(403);
  });

  it('伪造 / 过期 Cookie 无效；登出清除 Cookie', async () => {
    expect((await call(env, '/api/admin/posts', { cookie: '__Host-blog_session=abc.def.ghi' })).status).toBe(401);
    const now = Math.floor(Date.now() / 1000);
    const expired = await signJwt({ sub: 'admin', iat: now - 7200, exp: now - 3600, jti: 'x', csrf: 'y' }, env.JWT_SECRET);
    expect((await call(env, '/api/admin/posts', { cookie: `__Host-blog_session=${expired}` })).status).toBe(401);
    const out = await call(env, '/api/auth/logout', { method: 'POST' });
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('未配置密钥时返回 503 而不是放行', async () => {
    const bare = { ...env, ADMIN_PASSWORD_HASH: '' } as Env;
    const r = await call(bare, '/api/auth/login', { body: { password: 'x' }, headers: { 'cf-connecting-ip': '10.5.5.5' } });
    expect(r.status).toBe(503);
    const noTok = { ...env, API_TOKEN_HASH: '' } as Env;
    expect((await call(noTok, '/api/admin/posts', { token: 'anything-anything-anything' })).status).toBe(401);
  });

  it('本地开发（COOKIE_SECURE=false）使用无前缀 Cookie', async () => {
    const dev = { ...env, COOKIE_SECURE: 'false' } as Env;
    const r = await call(dev, '/api/auth/login', { body: { password: ADMIN_PASSWORD }, headers: { 'cf-connecting-ip': '10.6.6.6' } });
    const c = r.headers.get('set-cookie')!;
    expect(c).toMatch(/^blog_session=/);
    expect(c).not.toContain('Secure');
  });
});
