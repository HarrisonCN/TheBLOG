import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { call, disposeEnv, login, setupEnv } from './helpers';
import worker from '../src/index';
import type { Env } from '../src/env';
import { captureError, recordHealth, scheduledOps } from '../src/ops';
import { APP_VERSION, EXPECTED_MIGRATION } from '../src/version';
import {
  OPS_LIMITS,
  buildEnvelope,
  cleanError,
  compareDeploy,
  cronState,
  dailyBars,
  envelopeUrl,
  fingerprintOf,
  formatUptime,
  normalizeRoute,
  overallState,
  parseDsn,
  parseSampleRate,
  pickPreviousDeployment,
  scrubPii,
  scrubUrl,
  selectRetained,
  shouldRecord,
  uptimeOf,
  type HealthRow,
} from '../src/ops-core';

let env: Env;
let admin: { cookie: string; csrf: string };
const ip = (n: number) => ({ 'cf-connecting-ip': `10.21.0.${n}` });
const J = async (r: Response) => (await r.json()) as any;
const clean = async () => {
  for (const t of ['error_events', 'health_checks', 'ops_runs']) await env.DB.prepare(`DELETE FROM ${t}`).run();
  await env.DB.prepare("DELETE FROM rate_limits WHERE bucket LIKE 'err-%'").run();
};

beforeAll(async () => {
  env = await setupEnv();
  admin = await login(env, '10.21.9.9');
  await clean();
});
afterAll(async () => {
  // 测试库在各测试文件之间共用：清掉本文件写入的运维数据
  await clean();
  await disposeEnv();
});

// ============================================================ 纯函数
describe('ops-core：PII 清洗', () => {
  it('邮箱、IP、令牌、JWT、敏感查询参数、长哈希、电话都被替换；日期和普通文本保留', () => {
    const s = scrubPii(
      'user alice@example.com from 203.0.113.7 / 2001:db8::1 Bearer abcdefghijklmnop mcp_ABCDEFGH12345678 m_abcdefgh12345 ' +
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlLXNpZw /x?token=secret123&page=2 ' +
        'sha 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 call +86 188 7963 0708 on 2026-10-11 12:30:45',
    );
    for (const leak of ['alice@example.com', '203.0.113.7', 'abcdefghijklmnop', 'mcp_ABCDEFGH', 'm_abcdefgh', 'eyJhbGci', 'secret123', '9f86d081', '7963']) expect(s).not.toContain(leak);
    expect(s).toContain('[email]');
    expect(s).toContain('[ip]');
    expect(s).toContain('token=[redacted]');
    expect(s).toContain('page=2');
    expect(s).toContain('2026-10-11');
    expect(s).toContain('12:30:45');
    expect(scrubPii(s)).toBe(s); // 幂等
  });
  it('正文里的 key=value 凭据（token= / password= / api_key=）被替换，普通 key=value 保留，幂等', () => {
    const s = scrubPii('fetch failed token=abcd1234secret, password = hunter2 (api_key=AKIA123) count=3 t=5 code=E42');
    for (const leak of ['abcd1234secret', 'hunter2', 'AKIA123']) expect(s).not.toContain(leak);
    expect(s).toContain('token=[redacted]');
    expect(s).toContain('count=3');
    expect(s).toContain('t=5');
    expect(s).toContain('code=E42');
    expect(scrubPii(s)).toBe(s);
  });
  it('URL 只保留路径和参数名；路由归一化数字 id', () => {
    expect(scrubUrl('https://blog.example.com/w/123/?t=abc&utm=x#frag')).toBe('/w/123/?t=[redacted]&utm=…');
    expect(normalizeRoute('/messages/c/42/')).toBe('/messages/c/:id/');
    expect(normalizeRoute('/api/images/2026/10/0123abcd-0123-4567-89ab-0123456789ab.webp')).toBe('/api/images/:id/:id/:uuid.webp');
    expect(normalizeRoute('GET /api/social/works/77')).toBe('GET /api/social/works/:id');
  });
});

describe('ops-core：错误事件', () => {
  it('cleanError 截断、清洗、给出稳定指纹（数字不同仍同一组）', () => {
    const a = cleanError({ source: 'client', message: 'Cannot read properties of undefined (reading "x") at item 12', stack: 'TypeError: x\n    at render (https://blog/assets/main-abc.js:10:20)', route: '/w/1/' })!;
    const b = cleanError({ source: 'client', message: 'Cannot read properties of undefined (reading "y") at item 99', stack: 'TypeError: x\n    at render (https://blog/assets/main-abc.js:11:5)', route: '/w/2/' })!;
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.route).toBe('/w/:id/');
    expect(cleanError({ source: 'worker', message: 'something failed '.repeat(100) })!.message).toHaveLength(OPS_LIMITS.messageChars);
    expect(cleanError({ source: 'worker', message: '   ' })).toBeNull();
    expect(cleanError({ source: 'client', message: 'a', kind: 'NOT VALID!' })!.kind).toBe('error');
    expect(cleanError({ source: 'client', message: 'a', release: '<script>' })!.release).toBe('');
    expect(fingerprintOf({ source: 'worker', kind: 'a', message: 'm', stack: '', route: '' })).not.toBe(fingerprintOf({ source: 'client', kind: 'a', message: 'm', stack: '', route: '' }));
  });
  it('采样：新指纹总是记录，重复的按比例', () => {
    expect(parseSampleRate(undefined)).toBe(1);
    expect(parseSampleRate('0.25')).toBe(0.25);
    expect(parseSampleRate('7')).toBe(1);
    expect(parseSampleRate('nope', 0.5)).toBe(0.5);
    expect(shouldRecord(true, 0, 0.99)).toBe(true);
    expect(shouldRecord(false, 0.1, 0.5)).toBe(false);
    expect(shouldRecord(false, 0.1, 0.05)).toBe(true);
  });
  it('Sentry DSN 解析与 envelope 格式（不需要 SDK）', () => {
    expect(parseDsn('nonsense')).toBeNull();
    const d = parseDsn('https://pubkey123@o1.ingest.example.com/42')!;
    expect(d).toMatchObject({ publicKey: 'pubkey123', host: 'o1.ingest.example.com', projectId: '42' });
    expect(envelopeUrl(d)).toBe('https://o1.ingest.example.com/api/42/envelope/');
    expect(envelopeUrl(parseDsn('http://k@localhost:9000/sub/7')!)).toBe('http://localhost:9000/sub/api/7/envelope/');
    const e = cleanError({ source: 'worker', message: 'boom for bob@example.com', route: 'GET /api/x' })!;
    const lines = buildEnvelope(d, e, { eventId: 'a'.repeat(32), timestamp: 1_760_000_000, environment: 'test', release: '1.21.0' }).split('\n');
    expect(lines).toHaveLength(3);
    const item = JSON.parse(lines[1]!);
    expect(item.type).toBe('event');
    expect(item.length).toBe(new TextEncoder().encode(lines[2]!).length);
    const ev = JSON.parse(lines[2]!);
    expect(ev.exception.values[0].value).toBe('boom for [email]');
    expect(ev.release).toBe('1.21.0');
    expect(ev.fingerprint).toEqual([e.fingerprint]);
  });
});

describe('ops-core：可用率 / 状态 / 发布校验 / 回滚 / 备份保留', () => {
  const now = Date.parse('2026-10-11T12:00:00Z');
  const row = (minAgo: number, ok: number): HealthRow => ({ at: new Date(now - minAgo * 60000).toISOString(), ok, d1_ok: ok, r2_ok: 1, do_ok: null, d1_ms: 3, total_ms: 5 });
  it('uptime / 每日柱 / 文字', () => {
    const rows = [row(10, 1), row(25, 0), row(40, 1), row(60 * 30, 1), row(60 * 24 * 3, 0)];
    const u24 = uptimeOf(rows, now, 86400_000);
    expect(u24).toEqual({ ratio: 2 / 3, checks: 3, failed: 1 });
    expect(formatUptime(u24)).toBe('66.67%');
    expect(uptimeOf(rows, now, 7 * 86400_000)).toEqual({ ratio: 3 / 5, checks: 5, failed: 2 });
    expect(formatUptime(uptimeOf([], now, 86400_000))).toBe('—');
    expect(formatUptime({ ratio: 1, checks: 1, failed: 0 })).toBe('100%');
    const bars = dailyBars(rows, now, 30);
    expect(bars).toHaveLength(30);
    expect(bars.at(-1)).toMatchObject({ day: '2026-10-11', state: 'partial' });
    expect(bars.at(-4)).toMatchObject({ day: '2026-10-08', state: 'down' });
    expect(bars[0]!.state).toBe('nodata');
  });
  it('cron 状态与整体状态', () => {
    expect(cronState(null, true, now)).toBe('unknown');
    expect(cronState(new Date(now - 10 * 60000).toISOString(), true, now)).toBe('ok');
    expect(cronState(new Date(now - 10 * 60000).toISOString(), false, now)).toBe('degraded');
    expect(cronState(new Date(now - 60 * 60000).toISOString(), true, now)).toBe('degraded');
    expect(cronState(new Date(now - 6 * 3600_000).toISOString(), true, now)).toBe('down');
    expect(overallState(['ok', 'unconfigured', 'unknown'])).toBe('ok');
    expect(overallState(['ok', 'degraded'])).toBe('degraded');
    expect(overallState(['degraded', 'down'])).toBe('down');
  });
  it('compareDeploy：版本、commit（短 sha 前缀）、迁移级别', () => {
    const f = { version: '1.21.0', commit: 'abcdef1234567890', migration: { latest: '0018_ops', expected: '0018_ops' } };
    expect(compareDeploy(f, { version: '1.21.0', commit: 'abcdef1', migration: '0018_ops' })).toEqual([]);
    expect(compareDeploy(f, { commit: 'ABCDEF1234567890FFFF' })).toEqual([]);
    expect(compareDeploy(f, { version: '1.20.0' })[0]).toMatch(/^version/);
    expect(compareDeploy(f, { commit: '1234567' })[0]).toMatch(/^commit/);
    expect(compareDeploy({ ...f, commit: 'dev' }, { commit: 'abcdef1' })[0]).toMatch(/^commit/);
    expect(compareDeploy({ ...f, migration: { latest: '0017_open', expected: '0018_ops' } }, { migration: '0018_ops' })[0]).toMatch(/^migration/);
  });
  it('pickPreviousDeployment：跳过预览 / 失败部署', () => {
    const list = [
      { id: 'c', created_on: '2026-10-11T10:00:00Z', environment: 'production', latest_stage: { name: 'deploy', status: 'success' } },
      { id: 'p', created_on: '2026-10-11T09:30:00Z', environment: 'preview', latest_stage: { name: 'deploy', status: 'success' } },
      { id: 'f', created_on: '2026-10-11T09:00:00Z', environment: 'production', latest_stage: { name: 'build', status: 'failure' } },
      { id: 'b', created_on: '2026-10-10T10:00:00Z', environment: 'production', latest_stage: { name: 'deploy', status: 'success' } },
    ];
    expect(pickPreviousDeployment(list)?.id).toBe('b');
    expect(pickPreviousDeployment(list, 'c')?.id).toBe('b');
    expect(pickPreviousDeployment(list, 'b')).toBeNull();
  });
  it('selectRetained：每天 / 每周 / 每月', () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ key: `d1/${i}`, at: new Date(now - i * 86400_000).toISOString() }));
    const keep = selectRetained(items, { daily: 7, weekly: 4, monthly: 3 });
    for (let i = 0; i < 7; i++) expect(keep.has(`d1/${i}`)).toBe(true);
    expect(keep.has('d1/41')).toBe(true); // 第三个月（8 月）的最新一份
    expect(keep.has('d1/59')).toBe(false);
    expect(keep.size).toBeLessThan(7 + 4 + 3 + 1);
    expect(keep.has('d1/20')).toBe(false);
  });
  it('Worker 与前端的 ops-core 逐字相同；版本号来自 package.json；EXPECTED_MIGRATION = 最新迁移文件', () => {
    expect(readFileSync(join(__dirname, '../src/ops-core.ts'), 'utf8')).toBe(readFileSync(join(__dirname, '../../web/src/ops-core.ts'), 'utf8'));
    expect(APP_VERSION).toBe(JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8')).version);
    const files = readdirSync(join(__dirname, '../migrations')).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    expect(`${files.at(-1)!.replace(/\.sql$/, '')}`).toBe(EXPECTED_MIGRATION);
  });
});

// ============================================================ 接口
describe('L21 /api/health · /api/version · /api/status', () => {
  it('health 带版本、commit、迁移级别和组件检查', async () => {
    const h = await J(await call(env, '/api/health'));
    expect(h).toMatchObject({ ok: true, version: APP_VERSION, commit: 'dev', migration: { latest: EXPECTED_MIGRATION, ok: true }, checks: { d1: 'ok', do: 'unconfigured' } });
    expect(h.migration.count).toBeGreaterThanOrEqual(13);
    const v = await J(await call(env, '/api/version'));
    expect(v).toMatchObject({ version: APP_VERSION, commit: 'dev', migration: { expected: EXPECTED_MIGRATION } });
    const e2 = { ...env, GIT_SHA: 'abc1234def', APP_VERSION: '9.9.9' } as Env;
    expect(await J(await worker.fetch(new Request('http://blog.test/api/version') as never, e2))).toMatchObject({ version: '9.9.9', commit: 'abc1234def' });
  });
  it('D1 挂了 → health 503', async () => {
    const broken = { ...env, DB: { prepare: () => ({ bind() { return this; }, first: () => Promise.reject(new Error('d1 down')), all: () => Promise.reject(new Error('d1 down')), run: () => Promise.reject(new Error('d1 down')) }) } } as unknown as Env;
    const r = await worker.fetch(new Request('http://blog.test/api/health') as never, broken);
    expect(r.status).toBe(503);
    expect((await J(r)).checks.d1).toBe('down');
  });
  it('status：没有记录时可用率为空；记录健康检查后 100%；不含个人信息', async () => {
    const s0 = await J(await call(env, '/api/status'));
    expect(s0.uptime['24h'].ratio).toBeNull();
    expect(s0.components.map((c: any) => c.key)).toEqual(['api', 'd1', 'r2', 'do', 'cron']);
    expect(s0.components.find((c: any) => c.key === 'cron').state).toBe('unknown');
    expect(s0.days).toHaveLength(30);
    await recordHealth(env, 'manual');
    const s1 = await J(await call(env, '/api/status'));
    expect(s1.uptime['24h']).toMatchObject({ ratio: 1, checks: 1 });
    expect(s1.lastCheck.ok).toBe(true);
    expect(s1.version).toBe(APP_VERSION);
    expect(JSON.stringify(s1)).not.toMatch(/@|cf-connecting|10\.21\./);
  });
  it('Cron：每次触发记录健康检查 + 任务运行；子任务失败 → cron 降级并记错误', async () => {
    const waits: Promise<unknown>[] = [];
    await worker.scheduled!({ cron: '*/15 * * * *', scheduledTime: Date.now(), noRetry() {} } as never, env, { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} } as never);
    await Promise.all(waits);
    const runs = (await env.DB.prepare('SELECT job, last_ok FROM ops_runs ORDER BY job').all<{ job: string; last_ok: number }>()).results;
    expect(runs).toEqual([{ job: 'cron', last_ok: 1 }, { job: 'editor', last_ok: 1 }, { job: 'health', last_ok: 1 }, { job: 'open', last_ok: 1 }, { job: 'security', last_ok: 1 }, { job: 'webhooks', last_ok: 1 }]);
    expect((await J(await call(env, '/api/status'))).components.find((c: any) => c.key === 'cron').state).toBe('ok');
    await scheduledOps(env, { broken: async () => { throw new Error('digest failed for carol@example.com'); } });
    const cron = await env.DB.prepare("SELECT last_ok, detail FROM ops_runs WHERE job = 'cron'").first<{ last_ok: number; detail: string }>();
    expect(cron).toEqual({ last_ok: 0, detail: 'failed: broken' });
    const ev = await env.DB.prepare("SELECT message, kind FROM error_events WHERE kind = 'cron.broken'").first<{ message: string; kind: string }>();
    expect(ev?.message).toBe('digest failed for [email]');
    expect((await J(await call(env, '/api/status'))).components.find((c: any) => c.key === 'cron').state).toBe('degraded');
  });
  it('健康检查记录保留 30 天', async () => {
    await env.DB.prepare("INSERT INTO health_checks (at, ok, d1_ok, d1_ms, total_ms) VALUES ('2020-01-01T00:00:00.000Z', 1, 1, 1, 1)").run();
    await recordHealth(env, 'manual');
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM health_checks WHERE at < '2021-01-01'").first<{ n: number }>())!.n).toBe(0);
  });
});

describe('L21 错误捕获', () => {
  it('Worker 未处理异常 → 500 + 清洗过的错误事件（waitUntil）', async () => {
    const boom = { ...env, IMAGES: { get: () => Promise.reject(new Error('R2 exploded for dave@example.com ?token=supersecret')), head: () => Promise.resolve(null) } } as unknown as Env;
    const waits: Promise<unknown>[] = [];
    const r = await worker.fetch(new Request('http://blog.test/api/images/2026/10/0123abcd-0123-4567-89ab-0123456789ab.webp') as never, boom, { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} } as never);
    expect(r.status).toBe(500);
    expect((await J(r)).error.code).toBe('internal');
    await Promise.all(waits);
    const ev = await env.DB.prepare("SELECT * FROM error_events WHERE source = 'worker' AND route LIKE 'GET /api/images/%' ORDER BY id DESC LIMIT 1").first<any>();
    expect(ev).toBeTruthy();
    expect(ev.message).toBe('R2 exploded for [email] ?token=[redacted]');
    expect(ev.status).toBe(500);
    expect(ev.route).toBe('GET /api/images/:id/:id/:uuid.webp');
    expect(ev.stack).not.toContain('dave@example.com');
  });
  it('4xx HttpError 不记录', async () => {
    const before = (await env.DB.prepare('SELECT COUNT(*) AS n FROM error_events').first<{ n: number }>())!.n;
    const waits: Promise<unknown>[] = [];
    expect((await worker.fetch(new Request('http://blog.test/api/nope') as never, env, { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} } as never)).status).toBe(404);
    await Promise.all(waits);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM error_events').first<{ n: number }>())!.n).toBe(before);
  });
  it('同一指纹去重计数；采样率 0 时重复的丢弃、新的照记', async () => {
    const a = await captureError(env, { source: 'worker', message: 'dup error 1', route: '/x/1' });
    const b = await captureError(env, { source: 'worker', message: 'dup error 2', route: '/x/2' });
    expect(a.recorded && b.recorded && b.deduped).toBe(true);
    expect(b.id).toBe(a.id);
    expect((await env.DB.prepare('SELECT count FROM error_events WHERE id = ?').bind(a.id).first<{ count: number }>())!.count).toBe(2);
    const e0 = { ...env, ERROR_SAMPLE_RATE: '0' } as Env;
    expect((await captureError(e0, { source: 'worker', message: 'dup error 3', route: '/x/3' }, { rnd: 0.5 })).recorded).toBe(false);
    expect((await captureError(e0, { source: 'worker', message: 'brand new error', route: '/y' }, { rnd: 0.5 })).recorded).toBe(true);
  });
  it('环形缓冲区最多保留 500 行', async () => {
    const now = new Date().toISOString();
    await env.DB.prepare(
      "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 520) INSERT INTO error_events (source, kind, message, fingerprint, first_seen, last_seen) SELECT 'worker', 'fill', 'fill ' || x, 'fill-' || x, ?, ? FROM n",
    ).bind(now, now).run();
    await captureError(env, { source: 'worker', message: 'after fill' });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM error_events').first<{ n: number }>())!.n).toBeLessThanOrEqual(OPS_LIMITS.errorRing);
    expect(await env.DB.prepare("SELECT id FROM error_events WHERE message = 'after fill'").first()).toBeTruthy();
    await env.DB.prepare("DELETE FROM error_events WHERE kind = 'fill'").run();
  });
  it('配置 SENTRY_DSN 时用 fetch 发送 envelope', async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const e2 = { ...env, SENTRY_DSN: 'https://k3y@sentry.example.com/9', GIT_SHA: 'abc' } as Env;
    const r = await captureError(e2, { source: 'worker', message: 'forward me erin@example.com', route: '/z' }, { fetcher: fake });
    expect(r.forwarded).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('https://sentry.example.com/api/9/envelope/');
    expect((sent[0]!.init.headers as Record<string, string>)['x-sentry-auth']).toContain('sentry_key=k3y');
    expect(String(sent[0]!.init.body)).not.toContain('erin@example.com');
    expect((await env.DB.prepare('SELECT forwarded FROM error_events WHERE id = ?').bind(r.id).first<{ forwarded: number }>())!.forwarded).toBe(1);
    // 转发失败不影响本地记录
    const bad = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
    const r2 = await captureError(e2, { source: 'worker', message: 'another forward', route: '/z2' }, { fetcher: bad });
    expect(r2).toMatchObject({ recorded: true, forwarded: false });
  });
  it('POST /api/errors：清洗、202、来源校验、大小上限、限流', async () => {
    const r = await call(env, '/api/errors', { body: { message: 'TypeError at checkout for frank@example.com', stack: 'at x (https://blog/assets/main.js:1:2)', url: 'https://blog.example.com/w/5/?t=secret', kind: 'unhandledrejection', release: '1.21.0' }, headers: ip(1) });
    expect(r.status).toBe(202);
    const ev = await env.DB.prepare("SELECT * FROM error_events WHERE source = 'client' ORDER BY id DESC LIMIT 1").first<any>();
    expect(ev).toMatchObject({ message: 'TypeError at checkout for [email]', route: '/w/:id/', kind: 'unhandledrejection', release: '1.21.0' });
    expect((await call(env, '/api/errors', { body: { message: 'x' }, headers: { ...ip(2), origin: 'https://evil.example' } })).status).toBe(403);
    expect((await call(env, '/api/errors', { body: { nope: 1 }, headers: ip(2) })).status).toBe(400);
    expect((await call(env, '/api/errors', { body: { message: 'x'.repeat(9000) }, headers: ip(2) })).status).toBe(413);
    expect((await call(env, '/api/errors', { headers: ip(2) })).status).toBe(405);
    const codes: number[] = [];
    for (let i = 0; i < OPS_LIMITS.clientPerMinute + 1; i++) codes.push((await call(env, '/api/errors', { body: { message: `burst ${i}` }, headers: ip(3) })).status);
    expect(codes.slice(0, OPS_LIMITS.clientPerMinute).every((c) => c === 202)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });
});

describe('L21 后台运行状态', () => {
  const adm = (path: string, method = 'GET') => call(env, path, { method, cookie: admin.cookie, csrf: admin.csrf });
  it('需要登录', async () => {
    expect((await call(env, '/api/admin/ops/status')).status).toBe(401);
    expect((await call(env, '/api/admin/ops/errors')).status).toBe(401);
  });
  it('详细状态：绑定、采样、迁移、最近检查、任务、错误统计', async () => {
    const s = await J(await adm('/api/admin/ops/status'));
    expect(s.bindings).toMatchObject({ DB: true, DM_HUB: false, SENTRY_DSN: false });
    expect(s.migration).toMatchObject({ latest: EXPECTED_MIGRATION, ok: true });
    expect(s.recentChecks.length).toBeGreaterThan(0);
    expect(s.runs.map((r: any) => r.job)).toContain('cron');
    expect(s.errors.stored).toBeGreaterThan(0);
    expect(s.limits.errorRing).toBe(OPS_LIMITS.errorRing);
    const hc = await adm('/api/admin/ops/health-check', 'POST');
    expect(hc.status).toBe(201);
    expect((await J(hc)).check.source).toBe('manual');
  });
  it('错误列表：按来源筛选、分页、删除一条、清空', async () => {
    const all = await J(await adm('/api/admin/ops/errors?limit=2'));
    expect(all.errors).toHaveLength(2);
    expect(all.nextBefore).toBeTypeOf('number');
    const next = await J(await adm(`/api/admin/ops/errors?limit=2&before=${all.nextBefore}`));
    expect(next.errors[0].id).toBeLessThan(all.nextBefore + 1);
    const cl = await J(await adm('/api/admin/ops/errors?source=client'));
    expect(cl.errors.every((e: any) => e.source === 'client')).toBe(true);
    const id = all.errors[0].id;
    expect((await adm(`/api/admin/ops/errors/${id}`, 'DELETE')).status).toBe(200);
    expect((await adm(`/api/admin/ops/errors/${id}`, 'DELETE')).status).toBe(404);
    expect((await J(await adm('/api/admin/ops/errors', 'DELETE'))).deleted).toBeGreaterThan(0);
    expect((await J(await adm('/api/admin/ops/errors'))).errors).toEqual([]);
  });
});
