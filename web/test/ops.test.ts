import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { DemoBackend, memoryKV, type KV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';
import { parseRoute, renderRoute, routePath, SOCIAL_ROUTES } from '../src/render';

let kv: KV;
let api: DemoBackend;
let clock = Date.parse('2026-10-11T12:07:00Z');
beforeEach(() => {
  clock = Date.parse('2026-10-11T12:07:00Z');
  kv = memoryKV();
  api = new DemoBackend({ storage: kv, base: '/TheBLOG/', now: () => new Date(clock) });
});
const B = (r: { body: unknown }) => r.body as any;
async function adminLogin(): Promise<Record<string, string>> {
  const r = B(await api.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD }));
  return { 'x-csrf-token': r.csrfToken };
}

describe('L21 ops-core 共享 / 迁移', () => {
  it('web 与 worker 的 ops-core.ts 内容一致；迁移 0018 只做加法', () => {
    const w = readFileSync(fileURLToPath(new URL('../../worker/src/ops-core.ts', import.meta.url)), 'utf8');
    expect(readFileSync(fileURLToPath(new URL('../src/ops-core.ts', import.meta.url)), 'utf8')).toBe(w);
    const sql = readFileSync(fileURLToPath(new URL('../../worker/migrations/0018_ops.sql', import.meta.url)), 'utf8').replace(/--.*$/gm, '');
    expect(sql).not.toMatch(/\b(DROP|ALTER|DELETE|UPDATE)\b/i);
  });
});

describe('L21 /status/ 路由', () => {
  it('解析、路径、社交外壳', () => {
    expect(parseRoute('/status/')).toEqual({ name: 'status' });
    expect(routePath({ name: 'status' })).toBe('/status/');
    expect(SOCIAL_ROUTES).toContain('status');
  });
});

describe('L21 演示 mock 运维接口', () => {
  it('health / version / status：版本号来自 package.json，虚构历史有 3 次失败，标明演示数据', async () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
    const h = B(await api.handle('GET', '/api/health'));
    expect(h).toMatchObject({ ok: true, demo: true, migration: { latest: '0019_security', ok: true } });
    expect(B(await api.handle('GET', '/api/version')).version).toBe(pkg.version);
    const s = B(await api.handle('GET', '/api/status'));
    expect(s.demo).toBe(true);
    expect(s.overall).toBe('ok');
    expect(s.components.map((c: any) => c.key)).toEqual(['api', 'd1', 'r2', 'do', 'cron']);
    expect(s.days).toHaveLength(30);
    expect(s.uptime['30d'].failed).toBe(3);
    expect(s.uptime['30d'].checks).toBe(360);
    expect(s.days.filter((d: any) => d.state !== 'ok').length).toBeGreaterThanOrEqual(2);
    expect(s.cron.find((c: any) => c.job === 'cron').ok).toBe(true);
  });
  it('前端错误上报：清洗、去重、限流；后台能看到、删除、清空', async () => {
    const r = await api.handle('POST', '/api/errors', { kind: 'error', message: 'boom for alice@example.com', stack: 'at x (main.js:1:2)', url: '/w/12/', release: '1.21.0' });
    expect(r.status).toBe(202);
    expect((await api.handle('POST', '/api/errors', { kind: 'error', message: 'boom for bob@example.com', stack: 'at x (main.js:9:9)', url: '/w/13/' })).status).toBe(202);
    expect((await api.handle('POST', '/api/errors', { nope: 1 })).status).toBe(400);
    expect((await api.handle('GET', '/api/errors')).status).toBe(405);
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) codes.push((await api.handle('POST', '/api/errors', { message: `burst ${i}` })).status);
    expect(codes).toContain(429);
    expect((await api.handle('GET', '/api/admin/ops/errors')).status).toBe(401);
    const h = await adminLogin();
    const list = B(await api.handle('GET', '/api/admin/ops/errors?source=client', undefined, h));
    const boom = list.errors.find((x: any) => x.message === 'boom for [email]');
    expect(boom).toMatchObject({ count: 2, route: '/w/:id/', release: '1.21.0' });
    const page = B(await api.handle('GET', '/api/admin/ops/errors?limit=1', undefined, h));
    expect(page.errors).toHaveLength(1);
    expect(page.nextBefore).toBeTypeOf('number');
    expect((await api.handle('DELETE', `/api/admin/ops/errors/${boom.id}`, undefined, h)).status).toBe(200);
    expect((await api.handle('DELETE', `/api/admin/ops/errors/${boom.id}`, undefined, h)).status).toBe(404);
    const st = B(await api.handle('GET', '/api/admin/ops/status', undefined, h));
    expect(st.bindings.DB).toBe(true);
    expect(st.errors.stored).toBeGreaterThan(0);
    expect(st.recentChecks.length).toBe(48);
    expect(B(await api.handle('DELETE', '/api/admin/ops/errors', undefined, h)).deleted).toBeGreaterThan(0);
    expect(B(await api.handle('GET', '/api/admin/ops/errors', undefined, h)).errors).toEqual([]);
  });
  it('后台「立即健康检查」写入一条手动记录，公开状态的最近检查随之更新', async () => {
    const h = await adminLogin();
    clock += 5 * 60_000;
    const r = await api.handle('POST', '/api/admin/ops/health-check', {}, h);
    expect(r.status).toBe(201);
    expect(B(r).check).toMatchObject({ ok: 1, source: 'manual' });
    const s = B(await api.handle('GET', '/api/status'));
    expect(s.lastCheck.at).toBe(new Date(clock).toISOString());
    expect(s.uptime['30d'].checks).toBe(361);
  });
});

describe('L21 隐私说明', () => {
  it('隐私页说明错误报告与「请勿追踪」', () => {
    const site = { settings: { siteTitle: 't', postsPerPage: 10 }, profile: { name: 'x' }, posts: [] } as any;
    let html = '';
    try {
      html = renderRoute({ name: 'privacy' }, site).main;
    } catch {
      html = readFileSync(fileURLToPath(new URL('../src/render.ts', import.meta.url)), 'utf8');
    }
    expect(html).toContain('出错时的错误报告');
    expect(html).toContain('请勿追踪');
  });
});
