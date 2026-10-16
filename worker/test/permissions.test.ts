// L32 / v1.32.0 平台质量基线 · 权限矩阵（Worker，miniflare D1）：
// 1) 后台：从源码里自动收集每个后台路由（index.ts 的 /api/admin 分支 + 所有 routeAdmin* 函数里的 sub === '/…' 字面量），
//    匿名 → 401；会员 Bearer → 401；站长 cookie 但写操作不带 CSRF → 403。新增后台路由会自动进矩阵。
// 2) 会员接口：匿名调用读写都要 401（清单 + 「新增会员路由必须登记」守卫）。
// 3) 公开接口不泄露：/api/social/* 的公开 GET 不返回邮箱字段。
import { readFileSync, readdirSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import { testOutbox } from '../src/community';
import type { Env } from '../src/env';

const SRC = pjoin(__dirname, '../src');
const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));
const read = (f: string) => readFileSync(pjoin(SRC, f), 'utf8');

/** 从 routeAdmin* / routeAiStudioAdmin 函数体与 index.ts 的后台分支里收集静态子路由 */
export function adminRoutes(): string[] {
  const out = new Set<string>();
  for (const f of files) {
    const s = read(f);
    const re = /export async function (routeAdmin\w*|routeAiStudioAdmin)\b[\s\S]*?\n}\n/g;
    for (let m = re.exec(s); m; m = re.exec(s)) for (const x of m[0].matchAll(/sub === '(\/[a-z0-9/_-]*)'/g)) out.add(x[1]!);
  }
  const idx = read('index.ts');
  const block = idx.slice(idx.indexOf("if (path.startsWith('/api/admin/'))"));
  for (const x of block.slice(0, block.indexOf('\n  }\n')).matchAll(/sub === '(\/[a-z0-9/_-]*)'/g)) out.add(x[1]!);
  return [...out].sort();
}

/** 需要登录的会员接口（方法 + 路径）。新增会员路由时请登记在这里。 */
const MEMBER_ROUTES: [string, string][] = [
  ['GET', '/api/members/me'], ['POST', '/api/members/uploads'], ['POST', '/api/members/voice'],
  ['PUT', '/api/social/me'], ['GET', '/api/social/me/works'], ['GET', '/api/social/me/stats'], ['GET', '/api/social/me/saved'],
  ['GET', '/api/social/me/blocks'], ['GET', '/api/social/me/mutes'], ['GET', '/api/social/me/export'], ['POST', '/api/social/me/delete'],
  ['POST', '/api/social/works'], ['POST', '/api/social/follows/momo'], ['POST', '/api/social/reports'],
  ['GET', '/api/social/notifications'], ['GET', '/api/social/notifications/unread'], ['POST', '/api/social/notifications/read'], ['GET', '/api/social/notifications/prefs'],
  ['GET', '/api/social/bookmarks'], ['POST', '/api/social/bookmarks/merge'],
  ['GET', '/api/social/dm/conversations'], ['POST', '/api/social/dm/conversations'], ['GET', '/api/social/dm/search?q=x'], ['GET', '/api/social/dm/unread'], ['GET', '/api/social/dm/settings'], ['GET', '/api/social/dm/sync'], ['POST', '/api/social/dm/ticket'],
  ['GET', '/api/social/subscriptions'], ['POST', '/api/social/subscriptions'], ['GET', '/api/social/mcp/tokens'], ['POST', '/api/social/mcp/tokens'], ['GET', '/api/social/mcp/audit'],
  ['POST', '/api/social/ai/suggest'], ['POST', '/api/social/groups'],
  ['GET', '/api/security/sessions'], ['POST', '/api/security/sessions/revoke-all'], ['GET', '/api/security/privacy'], ['GET', '/api/security/export'], ['GET', '/api/security/passkeys'], ['POST', '/api/security/deletion'],
];

let env: Env;
let admin: { cookie: string; csrf: string };
let member = '';
beforeAll(async () => {
  env = await setupEnv({ EMAIL_PROVIDER: 'memory' });
  admin = await login(env, '10.32.0.1');
  const email = 'perm32@example.com';
  await call(env, '/api/members/register', { body: { name: 'Pm', email }, headers: { 'cf-connecting-ip': '10.32.1.1' } });
  const code = /(\d{6})/.exec(testOutbox.filter((m) => m.to === email).at(-1)?.text ?? '')?.[1] ?? '';
  member = ((await (await call(env, '/api/members/verify', { body: { email, code } })).json()) as { token: string }).token;
});
afterAll(async () => {
  await disposeEnv();
});

describe('后台路由矩阵（自动收集）', () => {
  const routes = adminRoutes();
  it('收集到的后台路由覆盖各模块', () => {
    expect(routes.length).toBeGreaterThan(30);
    for (const r of ['/posts', '/settings', '/ugc/queue', '/webhooks', '/ai', '/webmentions', '/roles']) expect(routes).toContain(r);
  });
  it('匿名 → 401（GET / POST / PUT / DELETE）', async () => {
    const bad: string[] = [];
    for (const r of routes) for (const m of ['GET', 'POST', 'PUT', 'DELETE']) {
      const s = (await call(env, `/api/admin${r}`, { method: m, ...(m === 'GET' || m === 'DELETE' ? {} : { body: {} }) })).status;
      if (s !== 401) bad.push(`${m} ${r} → ${s}`);
    }
    expect(bad).toEqual([]);
  });
  it('会员 Bearer 不是站长 → 401', async () => {
    const bad: string[] = [];
    for (const r of routes) {
      const s = (await call(env, `/api/admin${r}`, { token: member })).status;
      if (s !== 401 && s !== 403) bad.push(`GET ${r} → ${s}`);
    }
    expect(bad).toEqual([]);
  });
  it('站长 cookie 写操作不带 CSRF → 403', async () => {
    const bad: string[] = [];
    for (const r of routes) {
      const s = (await call(env, `/api/admin${r}`, { method: 'POST', cookie: admin.cookie, body: {} })).status;
      if (s !== 403) bad.push(`POST ${r} → ${s}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('会员接口矩阵', () => {
  it('匿名 → 401', async () => {
    const bad: string[] = [];
    for (const [m, p] of MEMBER_ROUTES) {
      const s = (await call(env, p, { method: m, ...(m === 'GET' ? {} : { body: {} }) })).status;
      if (s !== 401) bad.push(`${m} ${p} → ${s}`);
    }
    expect(bad).toEqual([]);
  });
  it('伪造 / 过期的 Bearer → 401', async () => {
    for (const [m, p] of MEMBER_ROUTES.slice(0, 8)) {
      const s = (await call(env, p, { method: m, token: 'not-a-real-token', ...(m === 'GET' ? {} : { body: {} }) })).status;
      expect(s, `${m} ${p}`).toBe(401);
    }
  });
  it('登记守卫：会员路由文件里的 /me/… 子路由都在清单里', () => {
    const listed = new Set(MEMBER_ROUTES.map(([, p]) => p.split('?')[0]));
    const subs = new Set<string>();
    for (const f of ['social.ts', 'ugc.ts', 'discovery.ts', 'studio.ts', 'groups.ts']) for (const x of read(f).matchAll(/sub === '(\/me\/[a-z/-]+)'/g)) subs.add(x[1]!);
    const missing = [...subs].filter((s) => !listed.has(`/api/social${s}`) && !['/me/collections', '/me/entries', '/me/invitations', '/me/projects', '/me/topics'].includes(s));
    expect(missing).toEqual([]);
  });
});

describe('公开接口不泄露个人信息', () => {
  it('公开主页 / 作品流 / 开放接口里没有邮箱', async () => {
    for (const p of ['/api/social/users/momo', '/api/social/works', '/api/open/v1/works', '/api/social/groups']) {
      const r = await call(env, p);
      const t = await r.text();
      expect(t, p).not.toMatch(/[A-Za-z0-9._%+-]+@(example\.com|example\.org)/);
      expect(t, p).not.toMatch(/"email"\s*:/);
    }
  });
});
