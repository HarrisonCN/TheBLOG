/**
 * L21 生产稳定性与运维：健康检查 / 版本 / 公开状态、错误捕获（环形缓冲区 + 可选 Sentry 兼容转发）、客户端错误上报、
 * 定时任务运行记录、后台详细状态与错误列表。纯逻辑在 ops-core.ts。
 */
import type { Env } from './env';
import { HttpError, json, readJson } from './http';
import { checkOrigin } from './auth';
import { ipKey, rateLimit } from './community';
import { APP_VERSION, EXPECTED_MIGRATION } from './version';
import {
  OPS_LIMITS,
  buildEnvelope,
  cleanError,
  cronState,
  dailyBars,
  envelopeUrl,
  migrationNumber,
  overallState,
  parseDsn,
  parseSampleRate,
  sentryAuthHeader,
  shouldRecord,
  uptimeOf,
  type CleanError,
  type ComponentState,
  type ErrorInput,
  type HealthRow,
} from './ops-core';

const NO_STORE = { 'cache-control': 'no-store' };
const STATUS_CACHE = { 'cache-control': 'public, max-age=30, s-maxage=30' };
type WaitCtx = { waitUntil(p: Promise<unknown>): void } | undefined;

// ============================================================ 版本 / 迁移级别
export function versionOf(env: Env): { version: string; commit: string; environment: string } {
  return { version: env.APP_VERSION || APP_VERSION, commit: env.GIT_SHA || 'dev', environment: env.OPS_ENV || 'production' };
}

export async function migrationLevel(env: Env): Promise<{ latest: string | null; count: number; expected: string; ok: boolean }> {
  let latest: string | null = null;
  let count = 0;
  try {
    const r = await env.DB.prepare('SELECT name, (SELECT COUNT(*) FROM d1_migrations) AS n FROM d1_migrations ORDER BY id DESC LIMIT 1').first<{ name: string; n: number }>();
    latest = r?.name?.replace(/\.sql$/, '') ?? null;
    count = r?.n ?? 0;
  } catch {
    /* 没有 d1_migrations 表（手动建库）→ 未知 */
  }
  return { latest, count, expected: EXPECTED_MIGRATION, ok: migrationNumber(latest) >= migrationNumber(EXPECTED_MIGRATION) };
}

// ============================================================ 组件检查
export interface CheckResult { ok: boolean; ms: number; state: ComponentState; error?: string }
export interface Checks { d1: CheckResult; r2: CheckResult; do: CheckResult }

async function timed(fn: () => Promise<unknown>, timeoutMs = 5000): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))]);
    return { ok: true, ms: Date.now() - t0, state: 'ok' };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, state: 'down', error: e instanceof Error ? e.message.slice(0, 120) : 'error' };
  }
}
const UNCONFIGURED: CheckResult = { ok: true, ms: 0, state: 'unconfigured' };

export async function runChecks(env: Env): Promise<Checks> {
  const [d1, r2, dobj] = await Promise.all([
    timed(() => env.DB.prepare('SELECT 1 AS one').first()),
    env.IMAGES ? timed(() => env.IMAGES.head('ops/health-probe')) : Promise.resolve(UNCONFIGURED),
    env.DM_HUB
      ? timed(async () => {
          const stub = env.DM_HUB!.get(env.DM_HUB!.idFromName('ops:health'));
          const r = await stub.fetch('https://hub/ping');
          if (r.status >= 500) throw new Error(`status ${r.status}`);
        })
      : Promise.resolve(UNCONFIGURED),
  ]);
  return { d1, r2, do: dobj };
}

/** 记录一次健康检查（Cron / 后台手动），并清理 30 天前的记录 */
export async function recordHealth(env: Env, source: 'cron' | 'manual'): Promise<HealthRow & { id: number; source: string; version: string }> {
  const t0 = Date.now();
  const c = await runChecks(env);
  const ok = c.d1.ok && c.r2.ok && c.do.ok;
  const at = new Date().toISOString();
  const detail = [c.d1.error && `d1: ${c.d1.error}`, c.r2.error && `r2: ${c.r2.error}`, c.do.error && `do: ${c.do.error}`].filter(Boolean).join('; ');
  const row = await env.DB.prepare(
    'INSERT INTO health_checks (at, ok, d1_ok, r2_ok, do_ok, d1_ms, total_ms, version, source, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
  )
    .bind(at, ok ? 1 : 0, c.d1.ok ? 1 : 0, c.r2.state === 'unconfigured' ? null : c.r2.ok ? 1 : 0, c.do.state === 'unconfigured' ? null : c.do.ok ? 1 : 0, c.d1.ms, Date.now() - t0, versionOf(env).version, source, detail)
    .first<{ id: number }>();
  const cutoff = new Date(Date.now() - OPS_LIMITS.healthRetentionDays * 86400_000).toISOString();
  await env.DB.prepare('DELETE FROM health_checks WHERE at < ?').bind(cutoff).run();
  return { id: row?.id ?? 0, at, ok: ok ? 1 : 0, d1_ok: c.d1.ok ? 1 : 0, r2_ok: c.r2.state === 'unconfigured' ? null : c.r2.ok ? 1 : 0, do_ok: c.do.state === 'unconfigured' ? null : c.do.ok ? 1 : 0, d1_ms: c.d1.ms, total_ms: Date.now() - t0, source, version: versionOf(env).version };
}

/** 定时任务运行记录：包住一个任务，记录开始时间、耗时、成功与否；失败时也记录错误事件 */
export async function recordRun(env: Env, job: string, fn: () => Promise<unknown>): Promise<boolean> {
  const t0 = Date.now();
  let ok = true;
  let detail = '';
  try {
    await fn();
  } catch (e) {
    ok = false;
    detail = e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300);
    await captureError(env, { source: 'worker', kind: `cron.${job}`, message: detail || 'cron job failed', stack: e instanceof Error ? e.stack : '', route: `cron:${job}` }).catch(() => undefined);
  }
  const at = new Date(t0).toISOString();
  await env.DB.prepare(
    `INSERT INTO ops_runs (job, last_run, last_ok, last_ms, runs, failures, detail) VALUES (?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(job) DO UPDATE SET last_run = excluded.last_run, last_ok = excluded.last_ok, last_ms = excluded.last_ms,
       runs = ops_runs.runs + 1, failures = ops_runs.failures + excluded.failures, detail = excluded.detail`,
  )
    .bind(job, at, ok ? 1 : 0, Date.now() - t0, ok ? 0 : 1, detail)
    .run()
    .catch(() => undefined);
  return ok;
}

// ============================================================ 错误捕获
/** 结构化日志（Workers Logs / Logpush 里可按字段过滤）；只写清洗过的字段 */
export function logStructured(env: Env, e: CleanError, extra: Record<string, unknown> = {}): void {
  const v = versionOf(env);
  console.error(JSON.stringify({ level: e.level, event: 'error', source: e.source, kind: e.kind, message: e.message, route: e.route, status: e.status, fingerprint: e.fingerprint, version: v.version, commit: v.commit, ...extra }));
}

export interface CaptureResult { recorded: boolean; id: number | null; deduped: boolean; forwarded: boolean }

/** 记录一条错误：清洗 → 指纹去重（1 小时内只累加）→ 采样（新指纹必记）→ 环形缓冲区 → 可选转发到 Sentry 兼容端点 */
export async function captureError(env: Env, input: ErrorInput, opts: { rnd?: number; fetcher?: typeof fetch } = {}): Promise<CaptureResult> {
  const e = cleanError(input);
  if (!e) return { recorded: false, id: null, deduped: false, forwarded: false };
  const now = new Date().toISOString();
  const since = new Date(Date.now() - OPS_LIMITS.dedupeWindowSec * 1000).toISOString();
  const existing = await env.DB.prepare('SELECT id FROM error_events WHERE fingerprint = ? AND last_seen >= ? ORDER BY id DESC LIMIT 1').bind(e.fingerprint, since).first<{ id: number }>();
  const rate = parseSampleRate(e.source === 'client' ? env.CLIENT_ERROR_SAMPLE_RATE : env.ERROR_SAMPLE_RATE, 1);
  if (!shouldRecord(!existing, rate, opts.rnd ?? Math.random())) return { recorded: false, id: existing?.id ?? null, deduped: true, forwarded: false };
  let id: number;
  if (existing) {
    await env.DB.prepare('UPDATE error_events SET count = count + 1, last_seen = ?, release = CASE WHEN ? <> \'\' THEN ? ELSE release END WHERE id = ?').bind(now, e.release, e.release, existing.id).run();
    id = existing.id;
  } else {
    const r = await env.DB.prepare(
      'INSERT INTO error_events (source, level, kind, message, stack, route, release, status, fingerprint, count, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING id',
    )
      .bind(e.source, e.level, e.kind, e.message, e.stack, e.route, e.release, e.status, e.fingerprint, now, now)
      .first<{ id: number }>();
    id = r?.id ?? 0;
    // 环形缓冲区：只保留最新的 N 行
    await env.DB.prepare('DELETE FROM error_events WHERE id <= (SELECT MAX(id) FROM error_events) - ?').bind(OPS_LIMITS.errorRing).run();
  }
  let forwarded = false;
  const dsn = parseDsn(env.SENTRY_DSN);
  if (dsn) {
    try {
      const v = versionOf(env);
      const eventId = crypto.randomUUID().replace(/-/g, '');
      const body = buildEnvelope(dsn, e, { eventId, timestamp: Math.floor(Date.now() / 1000), environment: v.environment, release: v.version });
      const r = await (opts.fetcher ?? fetch)(envelopeUrl(dsn), { method: 'POST', headers: { 'content-type': 'application/x-sentry-envelope', 'x-sentry-auth': sentryAuthHeader(dsn) }, body });
      forwarded = r.ok;
      if (forwarded) await env.DB.prepare('UPDATE error_events SET forwarded = forwarded + 1 WHERE id = ?').bind(id).run();
    } catch {
      /* 转发失败不影响本地记录 */
    }
  }
  return { recorded: true, id, deduped: !!existing, forwarded };
}

/** index.ts 的兜底：未处理异常 → 结构化日志 + 记录（waitUntil，不拖慢响应） */
export function reportUnhandled(env: Env, req: Request, err: unknown, ctx: WaitCtx): void {
  const status = err instanceof HttpError ? err.status : 500;
  const input: ErrorInput = {
    source: 'worker',
    kind: err instanceof HttpError ? `http.${err.code}` : err instanceof Error ? err.name || 'Error' : 'exception',
    message: err instanceof Error ? err.message || String(err) : String(err),
    stack: err instanceof Error ? err.stack : '',
    route: `${req.method} ${new URL(req.url).pathname}`,
    status,
  };
  const ce = cleanError(input);
  if (ce) logStructured(env, ce);
  const p = captureError(env, input).catch(() => undefined);
  if (ctx) ctx.waitUntil(p);
}

// ============================================================ 状态汇总
async function healthRows(env: Env, days: number): Promise<HealthRow[]> {
  const from = new Date(Date.now() - days * 86400_000).toISOString();
  return (await env.DB.prepare('SELECT at, ok, d1_ok, r2_ok, do_ok, d1_ms, total_ms FROM health_checks WHERE at >= ? ORDER BY at ASC').bind(from).all<HealthRow>()).results;
}
interface RunRow { job: string; last_run: string; last_ok: number; last_ms: number; runs: number; failures: number; detail: string }

export async function publicStatus(env: Env) {
  const now = Date.now();
  const [checks, mig, rows, runs] = await Promise.all([runChecks(env), migrationLevel(env), healthRows(env, 30), env.DB.prepare('SELECT * FROM ops_runs ORDER BY job').all<RunRow>().then((r) => r.results)]);
  const cron = runs.find((r) => r.job === 'cron') ?? null;
  const cronSt = cronState(cron?.last_run ?? null, !!cron?.last_ok, now);
  const comps: { key: string; label: string; state: ComponentState; ms?: number }[] = [
    { key: 'api', label: 'API（Worker）', state: 'ok' },
    { key: 'd1', label: '数据库（D1）', state: checks.d1.state, ms: checks.d1.ms },
    { key: 'r2', label: '图片存储（R2）', state: checks.r2.state },
    { key: 'do', label: '私信实时（Durable Object）', state: checks.do.state },
    { key: 'cron', label: '定时任务（Cron）', state: cronSt },
  ];
  const v = versionOf(env);
  const last = rows.at(-1) ?? null;
  return {
    overall: overallState(comps.map((c) => c.state)),
    components: comps,
    version: v.version,
    commit: v.commit === 'dev' ? 'dev' : v.commit.slice(0, 7),
    migration: { latest: mig.latest, ok: mig.ok },
    uptime: { '24h': uptimeOf(rows, now, 86400_000), '7d': uptimeOf(rows, now, 7 * 86400_000), '30d': uptimeOf(rows, now, 30 * 86400_000) },
    days: dailyBars(rows, now, 30),
    lastCheck: last ? { at: last.at, ok: !!last.ok } : null,
    cron: runs.map((r) => ({ job: r.job, lastRun: r.last_run, ok: !!r.last_ok })),
    generatedAt: new Date(now).toISOString(),
  };
}

export async function adminStatus(env: Env) {
  const pub = await publicStatus(env);
  const [mig, recent, runs, errStats, total] = await Promise.all([
    migrationLevel(env),
    env.DB.prepare('SELECT id, at, ok, d1_ok, r2_ok, do_ok, d1_ms, total_ms, version, source, detail FROM health_checks ORDER BY id DESC LIMIT 48').all().then((r) => r.results),
    env.DB.prepare('SELECT * FROM ops_runs ORDER BY job').all<RunRow>().then((r) => r.results),
    env.DB.prepare("SELECT source, COUNT(*) AS groups, COALESCE(SUM(count), 0) AS events FROM error_events WHERE last_seen >= ? GROUP BY source").bind(new Date(Date.now() - 86400_000).toISOString()).all<{ source: string; groups: number; events: number }>().then((r) => r.results),
    env.DB.prepare('SELECT COUNT(*) AS n FROM error_events').first<{ n: number }>(),
  ]);
  const v = versionOf(env);
  return {
    ...pub,
    commit: v.commit,
    environment: v.environment,
    migration: mig,
    bindings: {
      DB: true,
      IMAGES: !!env.IMAGES,
      UPLOADS: !!env.UPLOADS,
      DM_HUB: !!env.DM_HUB,
      EMAIL: !!env.EMAIL || (env.EMAIL_PROVIDER ?? 'console') !== 'console',
      SENTRY_DSN: !!parseDsn(env.SENTRY_DSN),
    },
    sampling: { worker: parseSampleRate(env.ERROR_SAMPLE_RATE, 1), client: parseSampleRate(env.CLIENT_ERROR_SAMPLE_RATE, 1) },
    limits: { errorRing: OPS_LIMITS.errorRing, healthRetentionDays: OPS_LIMITS.healthRetentionDays, clientPerMinute: OPS_LIMITS.clientPerMinute, clientPerDay: OPS_LIMITS.clientPerDay },
    recentChecks: recent,
    runs,
    errors: { last24h: errStats, stored: total?.n ?? 0 },
  };
}

// ============================================================ 路由
/** 公开：/api/health、/api/version、/api/status、POST /api/errors */
export async function routeOps(req: Request, env: Env, path: string): Promise<Response | null> {
  const m = req.method;
  if (path === '/api/health' && (m === 'GET' || m === 'HEAD')) {
    const [checks, mig] = await Promise.all([runChecks(env), migrationLevel(env)]);
    const ok = checks.d1.ok;
    const v = versionOf(env);
    return json(
      { ok, version: v.version, commit: v.commit, migration: mig, checks: { d1: checks.d1.state, r2: checks.r2.state, do: checks.do.state }, time: new Date().toISOString() },
      { status: ok ? 200 : 503, headers: NO_STORE },
    );
  }
  if (path === '/api/version' && (m === 'GET' || m === 'HEAD')) {
    const v = versionOf(env);
    return json({ ...v, migration: await migrationLevel(env) }, { headers: NO_STORE });
  }
  if (path === '/api/status' && (m === 'GET' || m === 'HEAD')) return json(await publicStatus(env), { headers: STATUS_CACHE });
  if (path === '/api/errors') {
    if (m !== 'POST') throw new HttpError(405, 'method_not_allowed', '只支持 POST', { allow: 'POST' });
    checkOrigin(req, env);
    const ip = await ipKey(req, env);
    await rateLimit(env, 'err-ip-min', ip, OPS_LIMITS.clientPerMinute, 60, '错误上报太频繁');
    await rateLimit(env, 'err-ip-day', ip, OPS_LIMITS.clientPerDay, 86400, '错误上报太频繁');
    await rateLimit(env, 'err-global', 'all', OPS_LIMITS.clientGlobalPerHour, 3600, '错误上报太频繁');
    const b = (await readJson(req, OPS_LIMITS.clientMaxBytes)) as Record<string, unknown>;
    if (!b || typeof b !== 'object' || typeof b.message !== 'string' || !b.message.trim()) throw new HttpError(400, 'validation_error', '缺少 message');
    const r = await captureError(env, {
      source: 'client',
      level: b.level === 'warning' ? 'warning' : 'error',
      kind: typeof b.kind === 'string' ? b.kind : 'error',
      message: b.message,
      stack: typeof b.stack === 'string' ? b.stack : '',
      route: typeof b.url === 'string' ? b.url : typeof b.route === 'string' ? b.route : '',
      release: typeof b.release === 'string' ? b.release : '',
    });
    return json({ accepted: true, recorded: r.recorded }, { status: 202, headers: NO_STORE });
  }
  return null;
}

/** 后台：/api/admin/ops/… */
export async function routeAdminOps(req: Request, env: Env, sub: string, url: URL): Promise<Response | null> {
  if (!sub.startsWith('/ops/')) return null;
  const m = req.method;
  if (sub === '/ops/status' && m === 'GET') return json(await adminStatus(env), { headers: NO_STORE });
  if (sub === '/ops/health-check' && m === 'POST') return json({ check: await recordHealth(env, 'manual') }, { status: 201, headers: NO_STORE });
  if (sub === '/ops/errors' && m === 'GET') {
    const source = url.searchParams.get('source');
    const before = Number(url.searchParams.get('before') ?? 0);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50));
    const where: string[] = [];
    const binds: unknown[] = [];
    if (source === 'worker' || source === 'client') {
      where.push('source = ?');
      binds.push(source);
    }
    if (Number.isInteger(before) && before > 0) {
      where.push('id < ?');
      binds.push(before);
    }
    const rows = (
      await env.DB.prepare(`SELECT * FROM error_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`)
        .bind(...binds, limit + 1)
        .all<Record<string, unknown> & { id: number }>()
    ).results;
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    return json({ errors: items, nextBefore: more ? items.at(-1)!.id : null }, { headers: NO_STORE });
  }
  if (sub === '/ops/errors' && m === 'DELETE') {
    const r = await env.DB.prepare('DELETE FROM error_events').run();
    return json({ deleted: r.meta.changes ?? 0 }, { headers: NO_STORE });
  }
  const dm = /^\/ops\/errors\/(\d+)$/.exec(sub);
  if (dm && m === 'DELETE') {
    const r = await env.DB.prepare('DELETE FROM error_events WHERE id = ?').bind(Number(dm[1])).run();
    if (!r.meta.changes) throw new HttpError(404, 'not_found', '没有这条错误');
    return json({ deleted: 1 }, { headers: NO_STORE });
  }
  throw new HttpError(404, 'not_found', '接口不存在');
}

/** Cron 入口（index.ts scheduled）：先做健康检查，再跑 L20 任务；每个任务单独记录 */
export async function scheduledOps(env: Env, jobs: Record<string, () => Promise<unknown>>): Promise<void> {
  const failed: string[] = [];
  if (!(await recordRun(env, 'health', () => recordHealth(env, 'cron')))) failed.push('health');
  for (const [name, fn] of Object.entries(jobs)) if (!(await recordRun(env, name, fn))) failed.push(name);
  // 「cron」= 整个定时触发器本身（状态页看它判断定时任务是否在跑）；有子任务失败时记为失败
  await env.DB.prepare(
    `INSERT INTO ops_runs (job, last_run, last_ok, last_ms, runs, failures, detail) VALUES ('cron', ?, ?, 0, 1, ?, ?)
     ON CONFLICT(job) DO UPDATE SET last_run = excluded.last_run, last_ok = excluded.last_ok, runs = ops_runs.runs + 1, failures = ops_runs.failures + excluded.failures, detail = excluded.detail`,
  )
    .bind(new Date().toISOString(), failed.length ? 0 : 1, failed.length ? 1 : 0, failed.length ? `failed: ${failed.join(', ')}` : '')
    .run()
    .catch(() => undefined);
}

