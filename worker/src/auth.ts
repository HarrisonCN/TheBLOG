import type { Env } from './env';
import { HttpError, json, readJson } from './http';
import { randomToken, sha256Hex, signJwt, timingSafeEqual, verifyJwt, verifyPassword, type JwtClaims } from './crypto';

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_SECONDS = 15 * 60;

export type AuthContext = { kind: 'session'; claims: JwtClaims } | { kind: 'token' };

function secure(env: Env): boolean {
  return env.COOKIE_SECURE !== 'false';
}

export function cookieName(env: Env): string {
  // __Host- 前缀要求 Secure + Path=/ + 无 Domain，浏览器会拒绝被子域覆盖
  return secure(env) ? '__Host-blog_session' : 'blog_session';
}

function ttl(env: Env): number {
  const n = Number(env.SESSION_TTL_SECONDS ?? '3600');
  return Number.isFinite(n) && n >= 60 && n <= 86_400 ? Math.floor(n) : 3600;
}

export function getCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function sessionCookie(env: Env, value: string, maxAge: number): string {
  return [`${cookieName(env)}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAge}`, secure(env) ? 'Secure' : ''].filter(Boolean).join('; ');
}

export function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip') ?? 'unknown';
}

function requireSecrets(env: Env, ...names: (keyof Env)[]): void {
  for (const n of names) {
    if (!env[n] || String(env[n]).length < 8) throw new HttpError(503, 'not_configured', `服务端未配置 ${String(n)}`);
  }
}

async function checkRateLimit(env: Env, ip: string, now: number): Promise<void> {
  const row = await env.DB.prepare('SELECT failures, window_start FROM login_attempts WHERE ip = ?').bind(ip).first<{ failures: number; window_start: number }>();
  if (row && now - row.window_start < LOGIN_WINDOW_SECONDS && row.failures >= LOGIN_MAX_FAILURES) {
    const retry = LOGIN_WINDOW_SECONDS - (now - row.window_start);
    throw new HttpError(429, 'rate_limited', '登录尝试过多，请稍后再试', { 'retry-after': String(retry) });
  }
}

async function recordFailure(env: Env, ip: string, now: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO login_attempts (ip, failures, window_start) VALUES (?, 1, ?)
     ON CONFLICT(ip) DO UPDATE SET
       failures = CASE WHEN ? - login_attempts.window_start >= ? THEN 1 ELSE login_attempts.failures + 1 END,
       window_start = CASE WHEN ? - login_attempts.window_start >= ? THEN ? ELSE login_attempts.window_start END`,
  )
    .bind(ip, now, now, LOGIN_WINDOW_SECONDS, now, LOGIN_WINDOW_SECONDS, now)
    .run();
}

/** L22：登录钩子 —— 二次验证（开启后密码正确只换来 5 分钟的 preAuth 令牌）与安全记录。 */
export interface LoginHooks {
  secondFactor?: (env: Env) => Promise<boolean>;
  audit?: (kind: string, detail: string) => Promise<void>;
}

/** preAuth 令牌用 JWT_SECRET 派生的另一把 HMAC 密钥签名：就算被塞进 Cookie 也不会被 readSession 接受。 */
export const preAuthSecret = (env: Env) => `${env.JWT_SECRET}|admin-2fa`;
export const PRE_AUTH_TTL = 300;

export async function handleLogin(req: Request, env: Env, hooks: LoginHooks = {}): Promise<Response> {
  requireSecrets(env, 'JWT_SECRET', 'ADMIN_PASSWORD_HASH');
  const now = Math.floor(Date.now() / 1000);
  const ip = clientIp(req);
  await checkRateLimit(env, ip, now);
  const body = (await readJson(req, 4096)) as { password?: unknown };
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || password.length > 256 || !(await verifyPassword(password, env.ADMIN_PASSWORD_HASH))) {
    await recordFailure(env, ip, now);
    await hooks.audit?.('admin_login_failed', 'password');
    throw new HttpError(401, 'invalid_credentials', '密码错误');
  }
  await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
  if (await hooks.secondFactor?.(env)) {
    const pre: JwtClaims = { sub: 'admin', iat: now, exp: now + PRE_AUTH_TTL, jti: randomToken(12), csrf: '2fa' };
    return json({ ok: true, needsTotp: true, preAuth: await signJwt(pre, preAuthSecret(env)) }, { headers: { 'cache-control': 'no-store' } });
  }
  await hooks.audit?.('admin_login', 'password');
  return adminSessionResponse(env);
}

/** 签发后台会话 Cookie（密码登录或二次验证通过后）。 */
export async function adminSessionResponse(env: Env): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const maxAge = ttl(env);
  const claims: JwtClaims = { sub: 'admin', iat: now, exp: now + maxAge, jti: randomToken(12), csrf: randomToken(24) };
  const jwt = await signJwt(claims, env.JWT_SECRET);
  return json(
    { ok: true, csrfToken: claims.csrf, expiresAt: new Date(claims.exp * 1000).toISOString() },
    { headers: { 'set-cookie': sessionCookie(env, jwt, maxAge), 'cache-control': 'no-store' } },
  );
}

export function handleLogout(env: Env): Response {
  return json({ ok: true }, { headers: { 'set-cookie': sessionCookie(env, '', 0), 'cache-control': 'no-store' } });
}

export async function readSession(req: Request, env: Env): Promise<JwtClaims | null> {
  if (!env.JWT_SECRET) return null;
  const token = getCookie(req, cookieName(env));
  return token ? verifyJwt(token, env.JWT_SECRET) : null;
}

export async function verifyBearer(req: Request, env: Env): Promise<boolean> {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(\S{16,512})$/i.exec(h);
  if (!m || !env.API_TOKEN_HASH) return false;
  const digest = await sha256Hex(m[1]!);
  let ok = false;
  for (const expected of env.API_TOKEN_HASH.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if (timingSafeEqual(digest, expected)) ok = true;
  }
  return ok;
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * 后台鉴权：Bearer token（脚本 / MCP）或会话 Cookie（浏览器）。
 * Cookie 方式下，写操作必须带 X-CSRF-Token（与会话 JWT 中的 csrf 声明一致）。
 */
export async function requireAdmin(req: Request, env: Env): Promise<AuthContext> {
  if (req.headers.has('authorization')) {
    if (await verifyBearer(req, env)) return { kind: 'token' };
    throw new HttpError(401, 'unauthorized', 'token 无效', { 'www-authenticate': 'Bearer realm="blog"' });
  }
  const claims = await readSession(req, env);
  if (!claims) throw new HttpError(401, 'unauthorized', '请先登录', { 'www-authenticate': 'Bearer realm="blog"' });
  if (UNSAFE.has(req.method)) {
    const csrf = req.headers.get('x-csrf-token') ?? '';
    if (!csrf || !timingSafeEqual(csrf, claims.csrf)) throw new HttpError(403, 'csrf', 'CSRF 校验失败');
  }
  return { kind: 'session', claims };
}

export function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** 浏览器发来的跨站请求（Origin 既不是本站也不在白名单）一律拒绝。 */
export function checkOrigin(req: Request, env: Env): void {
  const origin = req.headers.get('origin');
  if (!origin) return;
  if (origin === new URL(req.url).origin || allowedOrigins(env).includes(origin)) return;
  throw new HttpError(403, 'forbidden_origin', '不允许的来源');
}
