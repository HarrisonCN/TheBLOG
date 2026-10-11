/**
 * L21 生产稳定性与运维：纯函数核心（Worker 与前端演示 mock 共用同一份；web/src/ops-core.ts 必须与本文件逐字相同，测试会比较）。
 * 不依赖任何运行时 API（只用标准 JS），方便在 Worker、浏览器、Node 脚本测试里复用。
 */

// ============================================================ 常量
export const OPS_LIMITS = {
  /** error_events 环形缓冲区最多保留多少行 */
  errorRing: 500,
  /** 同一指纹在这个窗口内重复出现只累加计数 */
  dedupeWindowSec: 3600,
  /** 客户端上报：请求体上限 / 每 IP 每分钟 / 每 IP 每天 / 全站每小时 */
  clientMaxBytes: 8 * 1024,
  clientPerMinute: 10,
  clientPerDay: 100,
  clientGlobalPerHour: 300,
  /** 单条消息 / 堆栈 / 路由长度上限（截断后再存） */
  messageChars: 500,
  stackChars: 4000,
  routeChars: 200,
  /** 健康检查记录保留天数 */
  healthRetentionDays: 30,
  /** Cron 每 15 分钟一次；超过这个时间没跑就算「延迟」 */
  cronIntervalMin: 15,
  cronStaleMin: 45,
} as const;

// ============================================================ PII 清洗
const SECRET_PARAM = /([?&;](?:token|t|code|key|api_key|apikey|password|pass|secret|sig|signature|auth|session|ticket|email)=)[^&#\s"']*/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi;
const TOKENS = /\b(?:mcp|m|blog|sk|pk|ghp|gho|ghs|github_pat|xox[abpr])_[A-Za-z0-9_-]{8,}/g;
const JWT = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g;
const IPV4 = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
const IPV6 = /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/gi;
const LONG_HEX = /\b[0-9a-f]{32,}\b/gi;
const LONG_B64 = /[A-Za-z0-9+_-]{40,}={0,2}/g;
const PHONE = /(?<![\w.:/-])\+?\d(?:[\s-]?\d){8,14}(?![\w.:/-])/g;

/** 把文本里的个人信息 / 凭据替换成占位符。幂等：清洗过的文本再清洗一次结果不变。 */
export function scrubPii(input: string): string {
  if (!input) return '';
  return input
    .replace(SECRET_PARAM, '$1[redacted]')
    .replace(BEARER, '$1 [token]')
    .replace(JWT, '[jwt]')
    .replace(TOKENS, '[token]')
    .replace(EMAIL, '[email]')
    .replace(IPV6, (m) => (/[a-f]/i.test(m) || m.split(':').length > 3 ? '[ip]' : m))
    .replace(IPV4, '[ip]')
    .replace(LONG_HEX, '[hex]')
    .replace(LONG_B64, '[blob]')
    .replace(PHONE, (m) => (/^\d{4}-\d\d-\d\d/.test(m) ? m : '[phone]'));
}

/** 只保留 URL 的路径（去掉域名以外的查询参数值），再做 PII 清洗 */
export function scrubUrl(u: string): string {
  if (!u) return '';
  let s = u.slice(0, 1000);
  try {
    const x = new URL(s, 'http://x.invalid');
    const keys = [...new Set([...x.searchParams.keys()])].sort();
    s = x.pathname + (keys.length ? `?${keys.map((k) => `${k}=…`).join('&')}` : '');
  } catch {
    /* 非法 URL：按普通文本清洗 */
  }
  return scrubPii(s).slice(0, OPS_LIMITS.routeChars);
}

/** 把路由里的数字 id、长 slug 归一化，方便聚合（/w/123/ → /w/:id/） */
export function normalizeRoute(path: string): string {
  const m = /^([A-Z]{3,7}) (.*)$/.exec(path);
  if (m) return `${m[1]} ${normalizeRoute(m[2]!)}`.slice(0, OPS_LIMITS.routeChars);
  return scrubUrl(path)
    .replace(/\?.*$/, '')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=[/.]|$)/gi, '/:uuid')
    .replace(/\/\d{1,12}(?=\/|$)/g, '/:id')
    .slice(0, OPS_LIMITS.routeChars);
}

// ============================================================ 错误事件
export type ErrorSource = 'worker' | 'client';
export type ErrorLevel = 'error' | 'warning';
export interface ErrorInput {
  source: ErrorSource;
  level?: ErrorLevel;
  kind?: string;
  message: string;
  stack?: string;
  route?: string;
  release?: string;
  status?: number;
}
export interface CleanError {
  source: ErrorSource;
  level: ErrorLevel;
  kind: string;
  message: string;
  stack: string;
  route: string;
  release: string;
  status: number;
  fingerprint: string;
}

/** 32 位 FNV-1a（指纹只用于分组，不需要加密强度） */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 指纹：来源 + 类型 + 去掉数字 / 引号内容的消息 + 堆栈第一帧（去掉行列号）+ 归一化路由 */
export function fingerprintOf(e: { source: string; kind: string; message: string; stack: string; route: string }): string {
  const msg = e.message.replace(/(["'`]).*?\1/g, '?').replace(/\d+/g, 'N').slice(0, 200);
  const frame = (e.stack.split('\n').find((l) => /\bat\b|@/.test(l)) ?? '').replace(/:\d+(:\d+)?\)?\s*$/, '').replace(/\?[^\s)]*/, '').trim().slice(0, 200);
  return fnv1a([e.source, e.kind, msg, frame, normalizeRoute(e.route)].join('|'));
}

const KIND = /^[a-z][a-z0-9_.-]{0,39}$/;
/** 校验 + 截断 + 清洗；返回 null 表示不是有效的错误事件 */
export function cleanError(input: ErrorInput): CleanError | null {
  if (!input || typeof input.message !== 'string' || !input.message.trim()) return null;
  const kind = typeof input.kind === 'string' && KIND.test(input.kind) ? input.kind : input.source === 'client' ? 'error' : 'exception';
  const out = {
    source: input.source === 'client' ? 'client' : 'worker',
    level: input.level === 'warning' ? 'warning' : 'error',
    kind,
    message: scrubPii(String(input.message)).slice(0, OPS_LIMITS.messageChars),
    stack: scrubPii(typeof input.stack === 'string' ? input.stack : '').slice(0, OPS_LIMITS.stackChars),
    route: normalizeRoute(typeof input.route === 'string' ? input.route : ''),
    release: typeof input.release === 'string' && /^[0-9A-Za-z.+-]{1,40}$/.test(input.release) ? input.release : '',
    status: Number.isInteger(input.status) && (input.status as number) >= 0 && (input.status as number) < 1000 ? (input.status as number) : 0,
  } as Omit<CleanError, 'fingerprint'>;
  return { ...out, fingerprint: fingerprintOf(out) };
}

/** 采样率：环境变量字符串 → [0, 1]，非法值用默认值 */
export function parseSampleRate(v: string | undefined, dflt = 1): number {
  if (v === undefined || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : dflt;
}
/** 新指纹（第一次出现）总是记录；重复的才按采样率丢弃 */
export function shouldRecord(isNew: boolean, rate: number, rnd: number): boolean {
  return isNew || rnd < rate;
}

// ============================================================ Sentry 兼容（fetch 发送 envelope，不依赖 SDK）
export interface Dsn { publicKey: string; host: string; protocol: string; projectId: string; path: string }
export function parseDsn(dsn: string | undefined): Dsn | null {
  if (!dsn) return null;
  const m = /^(https?):\/\/([^:@/]+)(?::[^@/]*)?@([^/]+)(\/.*)?\/(\d+)\/?$/.exec(dsn.trim());
  if (!m) return null;
  return { protocol: m[1]!, publicKey: m[2]!, host: m[3]!, path: m[4] ?? '', projectId: m[5]! };
}
export function envelopeUrl(d: Dsn): string {
  return `${d.protocol}://${d.host}${d.path}/api/${d.projectId}/envelope/`;
}
export function sentryAuthHeader(d: Dsn, client = 'winston-blog-ops/1'): string {
  return `Sentry sentry_version=7, sentry_key=${d.publicKey}, sentry_client=${client}`;
}
/** 一条错误 → Sentry envelope 文本（header 行 + item header 行 + event 行）；只发送已经清洗过的字段 */
export function buildEnvelope(d: Dsn, e: CleanError, opts: { eventId: string; timestamp: number; environment: string; release: string }): string {
  const event = {
    event_id: opts.eventId,
    timestamp: opts.timestamp,
    platform: e.source === 'client' ? 'javascript' : 'node',
    level: e.level,
    logger: `blog.${e.source}`,
    environment: opts.environment,
    release: e.release || opts.release,
    transaction: e.route || undefined,
    fingerprint: [e.fingerprint],
    tags: { source: e.source, kind: e.kind, status: e.status ? String(e.status) : undefined },
    exception: { values: [{ type: e.kind, value: e.message, stacktrace: e.stack ? { frames: e.stack.split('\n').slice(0, 30).reverse().map((l) => ({ function: l.trim().slice(0, 200) })) } : undefined }] },
  };
  const body = JSON.stringify(event);
  return [JSON.stringify({ event_id: opts.eventId, sent_at: new Date(opts.timestamp * 1000).toISOString(), dsn: `${d.protocol}://${d.publicKey}@${d.host}${d.path}/${d.projectId}` }), JSON.stringify({ type: 'event', length: new TextEncoder().encode(body).length }), body].join('\n');
}

// ============================================================ 健康检查 / 状态
export type ComponentState = 'ok' | 'degraded' | 'down' | 'unconfigured' | 'unknown';
export interface HealthRow { at: string; ok: number; d1_ok: number; r2_ok: number | null; do_ok: number | null; d1_ms: number; total_ms: number }
export interface Uptime { ratio: number | null; checks: number; failed: number }

/** 某个时间窗口内的可用率（只算有记录的检查；没有记录 → ratio = null） */
export function uptimeOf(rows: readonly HealthRow[], nowMs: number, windowMs: number): Uptime {
  const from = nowMs - windowMs;
  const inWin = rows.filter((r) => Date.parse(r.at) >= from && Date.parse(r.at) <= nowMs);
  const failed = inWin.filter((r) => !r.ok).length;
  return { ratio: inWin.length ? (inWin.length - failed) / inWin.length : null, checks: inWin.length, failed };
}

export interface DayBar { day: string; checks: number; failed: number; state: 'ok' | 'partial' | 'down' | 'nodata' }
/** 最近 n 天每天一根柱子（UTC 日期，最旧在前） */
export function dailyBars(rows: readonly HealthRow[], nowMs: number, days = 30): DayBar[] {
  const out: DayBar[] = [];
  const by = new Map<string, { c: number; f: number }>();
  for (const r of rows) {
    const d = r.at.slice(0, 10);
    const v = by.get(d) ?? { c: 0, f: 0 };
    v.c++;
    if (!r.ok) v.f++;
    by.set(d, v);
  }
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(nowMs - i * 86400_000).toISOString().slice(0, 10);
    const v = by.get(day);
    out.push({ day, checks: v?.c ?? 0, failed: v?.f ?? 0, state: !v ? 'nodata' : v.f === 0 ? 'ok' : v.f === v.c ? 'down' : 'partial' });
  }
  return out;
}

/** 状态页上显示的可用率文字：99.95% / — */
export function formatUptime(u: Uptime): string {
  if (u.ratio === null) return '—';
  const p = u.ratio * 100;
  return `${p === 100 ? '100' : p >= 99.99 ? p.toFixed(3) : p.toFixed(2)}%`;
}

/** Cron：最后一次运行距今多久 → ok / degraded（迟了）/ down（很久没跑）/ unknown（从没跑过） */
export function cronState(lastRunIso: string | null, lastOk: boolean, nowMs: number): ComponentState {
  if (!lastRunIso) return 'unknown';
  const ageMin = (nowMs - Date.parse(lastRunIso)) / 60000;
  if (!Number.isFinite(ageMin)) return 'unknown';
  if (ageMin > OPS_LIMITS.cronStaleMin * 4) return 'down';
  if (ageMin > OPS_LIMITS.cronStaleMin || !lastOk) return 'degraded';
  return 'ok';
}

/** 整体状态：任何 down → down；任何 degraded → degraded；否则 ok（unconfigured / unknown 不影响） */
export function overallState(states: readonly ComponentState[]): 'ok' | 'degraded' | 'down' {
  if (states.includes('down')) return 'down';
  if (states.includes('degraded')) return 'degraded';
  return 'ok';
}

export const STATE_LABEL: Record<ComponentState | 'partial' | 'nodata', string> = {
  ok: '正常',
  degraded: '部分异常',
  down: '故障',
  unconfigured: '未配置',
  unknown: '暂无数据',
  partial: '部分异常',
  nodata: '无记录',
};

// ============================================================ 发布校验 / 回滚 / 备份（Node 脚本与测试共用的纯逻辑）
/** 迁移文件名 → 编号（0018_ops.sql → 18） */
export function migrationNumber(name: string | null | undefined): number {
  const m = /^(\d{4})_/.exec(name ?? '');
  return m ? Number(m[1]) : -1;
}

export interface DeployFacts { version: string; commit: string; migration: { latest: string | null; expected: string } }
export interface SmokeExpect { version?: string; commit?: string; migration?: string }
/** 对比部署出来的 Worker 和期望值，返回问题列表（空 = 通过）。commit 允许短 sha 前缀匹配（≥7 位）。 */
export function compareDeploy(f: DeployFacts, want: SmokeExpect): string[] {
  const problems: string[] = [];
  if (want.version && f.version !== want.version) problems.push(`version: deployed ${f.version} ≠ expected ${want.version}`);
  if (want.commit) {
    const a = (f.commit || '').toLowerCase();
    const b = want.commit.toLowerCase();
    const short = Math.max(7, Math.min(a.length, b.length));
    if (!a || a === 'dev' || a.slice(0, short) !== b.slice(0, short)) problems.push(`commit: deployed ${f.commit || '(none)'} ≠ expected ${want.commit}`);
  }
  if (want.migration && migrationNumber(f.migration.latest) < migrationNumber(want.migration)) problems.push(`migration: D1 at ${f.migration.latest ?? '(none)'} < expected ${want.migration}`);
  return problems;
}

export interface PagesDeployment { id: string; created_on: string; environment: string; is_skipped?: boolean; latest_stage?: { name: string; status: string } }
/** 回滚目标：当前生产部署之前、最近一次成功的生产部署 */
export function pickPreviousDeployment(list: readonly PagesDeployment[], currentId?: string): PagesDeployment | null {
  const prod = list
    .filter((d) => d.environment === 'production' && !d.is_skipped && (!d.latest_stage || (d.latest_stage.name === 'deploy' && d.latest_stage.status === 'success')))
    .sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on));
  const cur = currentId ? prod.findIndex((d) => d.id === currentId) : 0;
  if (cur < 0) return prod[0] ?? null;
  return prod[cur + 1] ?? null;
}

export interface RetentionPolicy { daily: number; weekly: number; monthly: number }
/** 备份保留：最近 N 天每天一份、最近 N 周每周一份（周一所在周的最新一份）、最近 N 个月每月一份；返回要保留的 key 集合 */
export function selectRetained(items: readonly { key: string; at: string }[], policy: RetentionPolicy): Set<string> {
  const sorted = [...items].filter((i) => Number.isFinite(Date.parse(i.at))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const keep = new Set<string>();
  const pick = (bucketOf: (d: Date) => string, n: number) => {
    const seen = new Set<string>();
    for (const i of sorted) {
      if (seen.size >= n) break;
      const b = bucketOf(new Date(i.at));
      if (seen.has(b)) continue;
      seen.add(b);
      keep.add(i.key);
    }
  };
  pick((d) => d.toISOString().slice(0, 10), policy.daily);
  pick((d) => {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
    return t.toISOString().slice(0, 10);
  }, policy.weekly);
  pick((d) => d.toISOString().slice(0, 7), policy.monthly);
  return keep;
}
