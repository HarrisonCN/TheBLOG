import { join } from 'node:path';
import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { getPlatformProxy } from 'wrangler';
import { inject } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/env';

export const ADMIN_PASSWORD = 'correct horse battery staple';
export const API_TOKEN = 'blog_test_' + 'x'.repeat(32);
export const ORIGIN = 'http://blog.test';

function passwordHash(pw: string): string {
  const salt = randomBytes(16);
  return `pbkdf2$100000$${salt.toString('base64')}$${pbkdf2Sync(pw, salt, 100_000, 32, 'sha256').toString('base64')}`;
}

let proxy: Awaited<ReturnType<typeof getPlatformProxy<Env>>> | undefined;

export async function setupEnv(overrides: Partial<Env> = {}): Promise<Env> {
  proxy ??= await getPlatformProxy<Env>({ configPath: 'wrangler.jsonc', persist: { path: join(inject('persist' as never) as string, 'v3') } });
  return {
    ...proxy.env,
    JWT_SECRET: 'test-jwt-secret-' + 'y'.repeat(32),
    ADMIN_PASSWORD_HASH: passwordHash(ADMIN_PASSWORD),
    API_TOKEN_HASH: createHash('sha256').update(API_TOKEN).digest('hex'),
    COOKIE_SECURE: 'true',
    ALLOWED_ORIGINS: 'http://localhost:5173',
    SESSION_TTL_SECONDS: '3600',
    ...overrides,
  } as Env;
}

export async function disposeEnv() {
  await proxy?.dispose();
  proxy = undefined;
}

export interface CallOpts {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  token?: string;
  cookie?: string;
  csrf?: string;
  raw?: BodyInit;
}

export async function call(env: Env, path: string, o: CallOpts = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.body !== undefined) headers['content-type'] ??= 'application/json';
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.cookie) headers.cookie = o.cookie;
  if (o.csrf) headers['x-csrf-token'] = o.csrf;
  const req = new Request(ORIGIN + path, {
    method: o.method ?? (o.body !== undefined || o.raw ? 'POST' : 'GET'),
    headers,
    body: o.raw ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined),
  });
  return worker.fetch(req as never, env);
}

export async function login(env: Env, ip = '10.0.0.1'): Promise<{ cookie: string; csrf: string; setCookie: string }> {
  const res = await call(env, '/api/auth/login', { body: { password: ADMIN_PASSWORD }, headers: { 'cf-connecting-ip': ip } });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${await res.text()}`);
  const setCookie = res.headers.get('set-cookie')!;
  const body = (await res.json()) as { csrfToken: string };
  return { cookie: setCookie.split(';')[0]!, csrf: body.csrfToken, setCookie };
}

let rpcId = 0;
export async function mcp(env: Env, method: string, params?: unknown, token = API_TOKEN) {
  const res = await call(env, '/mcp', { body: { jsonrpc: '2.0', id: ++rpcId, method, params }, token, headers: { accept: 'application/json, text/event-stream' } });
  return { status: res.status, body: (await res.json()) as any };
}

export async function tool(env: Env, name: string, args: unknown = {}) {
  const r = await mcp(env, 'tools/call', { name, arguments: args });
  return r.body.result as { isError: boolean; structuredContent?: any; content: { type: string; text: string }[] };
}
