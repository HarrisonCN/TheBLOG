/**
 * 演示模式的 L21 运维接口：与 worker/src/ops.ts 相同的路径、状态码与返回结构（共用 ops-core.ts）。
 * 演示站没有服务器，所以：
 *  - 健康检查历史是按时间生成的**虚构数据**（每 2 小时一条，30 天里有 3 次虚构的失败），页面上标明「演示数据」；
 *  - 「立即检查」只检查浏览器里的 mock（总是正常），记录会保存在 localStorage；
 *  - 前端错误上报会真的走清洗 / 去重 / 限流逻辑，存进 localStorage，后台「运行状态」可以看到。
 */
import {
  OPS_LIMITS,
  cleanError,
  cronState,
  dailyBars,
  overallState,
  shouldRecord,
  uptimeOf,
  type ComponentState,
  type HealthRow,
} from '../ops-core';
import { SocialError, type MockSocial } from './mock-social';

export interface DemoErrorEvent { id: number; source: 'worker' | 'client'; level: string; kind: string; message: string; stack: string; route: string; release: string; status: number; fingerprint: string; count: number; first_seen: string; last_seen: string; forwarded: number }
export interface OpsState { errors: DemoErrorEvent[]; manual: (HealthRow & { id: number; source: string; version: string; detail: string })[]; nextId: number }
export const opsSeed = (): OpsState => ({ errors: [], manual: [], nextId: 1 });

interface Host {
  state: () => OpsState;
  commit: (mutate: (s: OpsState) => void) => void;
  social: MockSocial;
  isAdmin: () => boolean;
  now: () => Date;
  version: string;
}

const STEP = 2 * 3600_000;
/** 虚构失败：距离现在第 k 个 2 小时格子（固定，刷新页面不会变） */
const FAKE_FAIL = new Set([37, 140, 141]);
type R = { status: number; body: unknown };

export class MockOps {
  constructor(private h: Host) {}

  /** 生成的虚构历史 + 本地手动检查，按时间排序 */
  private rows(nowMs: number): (HealthRow & { source: string; detail: string })[] {
    const grid = Math.floor(nowMs / STEP) * STEP;
    const gen: (HealthRow & { source: string; detail: string })[] = [];
    for (let k = 359; k >= 0; k--) {
      const fail = FAKE_FAIL.has(k);
      gen.push({ at: new Date(grid - k * STEP).toISOString(), ok: fail ? 0 : 1, d1_ok: fail ? 0 : 1, r2_ok: 1, do_ok: 1, d1_ms: 3 + ((k * 7) % 9), total_ms: 12 + ((k * 13) % 20), source: 'cron', detail: fail ? 'd1: timeout（演示数据）' : '' });
    }
    return [...gen, ...this.h.state().manual].sort((a, b) => a.at.localeCompare(b.at));
  }

  private runs(nowMs: number) {
    const last = new Date(Math.floor(nowMs / (15 * 60_000)) * 15 * 60_000).toISOString();
    return ['cron', 'health', 'open'].map((job) => ({ job, last_run: last, last_ok: 1, last_ms: job === 'cron' ? 0 : 40, runs: 2880, failures: job === 'health' ? 3 : 0, detail: '' }));
  }

  private status() {
    const now = this.h.now().getTime();
    const rows = this.rows(now);
    const runs = this.runs(now);
    const cron = runs.find((r) => r.job === 'cron')!;
    const comps: { key: string; label: string; state: ComponentState; ms?: number }[] = [
      { key: 'api', label: 'API（Worker）', state: 'ok' },
      { key: 'd1', label: '数据库（D1）', state: 'ok', ms: 4 },
      { key: 'r2', label: '图片存储（R2）', state: 'ok' },
      { key: 'do', label: '私信实时（Durable Object）', state: 'ok' },
      { key: 'cron', label: '定时任务（Cron）', state: cronState(cron.last_run, true, now) },
    ];
    const last = rows.at(-1)!;
    return {
      overall: overallState(comps.map((c) => c.state)),
      components: comps,
      version: this.h.version,
      commit: 'demo',
      migration: { latest: '0018_ops', ok: true },
      uptime: { '24h': uptimeOf(rows, now, 86400_000), '7d': uptimeOf(rows, now, 7 * 86400_000), '30d': uptimeOf(rows, now, 30 * 86400_000) },
      days: dailyBars(rows, now, 30),
      lastCheck: { at: last.at, ok: !!last.ok },
      cron: runs.map((r) => ({ job: r.job, lastRun: r.last_run, ok: !!r.last_ok })),
      generatedAt: new Date(now).toISOString(),
      demo: true,
    };
  }

  /** 公开：/api/health、/api/version、/api/status、POST /api/errors */
  routePublic(m: string, path: string, body: unknown): R | null {
    const ok = (b: unknown, status = 200): R => ({ status, body: b });
    const mig = { latest: '0018_ops', count: 13, expected: '0018_ops', ok: true };
    if (path === '/api/health' && m === 'GET') return ok({ ok: true, demo: true, version: this.h.version, commit: 'demo', migration: mig, checks: { d1: 'ok', r2: 'ok', do: 'ok' }, time: this.h.now().toISOString() });
    if (path === '/api/version' && m === 'GET') return ok({ version: this.h.version, commit: 'demo', environment: 'demo', migration: mig });
    if (path === '/api/status' && m === 'GET') return ok(this.status());
    if (path === '/api/errors') {
      if (m !== 'POST') throw new SocialError(405, 'method_not_allowed', '只支持 POST');
      this.h.social.limit('err-ip-min', OPS_LIMITS.clientPerMinute, 60_000, '错误上报太频繁');
      this.h.social.limit('err-ip-day', OPS_LIMITS.clientPerDay, 86_400_000, '错误上报太频繁');
      const b = (body ?? {}) as Record<string, unknown>;
      if (JSON.stringify(b).length > OPS_LIMITS.clientMaxBytes) throw new SocialError(413, 'payload_too_large', '请求体过大');
      if (typeof b.message !== 'string' || !b.message.trim()) throw new SocialError(400, 'validation_error', '缺少 message');
      const ce = cleanError({ source: 'client', level: b.level === 'warning' ? 'warning' : 'error', kind: typeof b.kind === 'string' ? b.kind : 'error', message: b.message, stack: typeof b.stack === 'string' ? b.stack : '', route: typeof b.url === 'string' ? b.url : '', release: typeof b.release === 'string' ? b.release : '' });
      if (!ce) throw new SocialError(400, 'validation_error', '缺少 message');
      const now = this.h.now();
      let recorded = true;
      this.h.commit((s) => {
        const since = now.getTime() - OPS_LIMITS.dedupeWindowSec * 1000;
        const ex = s.errors.find((x) => x.fingerprint === ce.fingerprint && Date.parse(x.last_seen) >= since);
        if (!shouldRecord(!ex, 1, Math.random())) {
          recorded = false;
          return;
        }
        if (ex) {
          ex.count++;
          ex.last_seen = now.toISOString();
        } else {
          s.errors.push({ id: s.nextId++, ...ce, count: 1, first_seen: now.toISOString(), last_seen: now.toISOString(), forwarded: 0 });
          if (s.errors.length > OPS_LIMITS.errorRing) s.errors.splice(0, s.errors.length - OPS_LIMITS.errorRing);
        }
      });
      return ok({ accepted: true, recorded }, 202);
    }
    return null;
  }

  /** 后台：/api/admin/ops/… */
  routeAdmin(m: string, sub: string, q: URLSearchParams): R | null {
    if (!sub.startsWith('/ops/')) return null;
    const ok = (b: unknown, status = 200): R => ({ status, body: b });
    if (sub === '/ops/status' && m === 'GET') {
      const now = this.h.now().getTime();
      const st = this.h.state();
      const day = now - 86400_000;
      const by = (src: string) => st.errors.filter((x) => x.source === src && Date.parse(x.last_seen) >= day);
      return ok({
        ...this.status(),
        environment: 'demo',
        migration: { latest: '0018_ops', count: 13, expected: '0018_ops', ok: true },
        bindings: { DB: true, IMAGES: true, UPLOADS: false, DM_HUB: true, EMAIL: false, SENTRY_DSN: false },
        sampling: { worker: 1, client: 1 },
        limits: { errorRing: OPS_LIMITS.errorRing, healthRetentionDays: OPS_LIMITS.healthRetentionDays, clientPerMinute: OPS_LIMITS.clientPerMinute, clientPerDay: OPS_LIMITS.clientPerDay },
        recentChecks: this.rows(now)
          .slice(-48)
          .reverse()
          .map((r, i) => ({ id: 100000 - i, ...r, version: this.h.version })),
        runs: this.runs(now),
        errors: { last24h: ['client', 'worker'].map((s) => ({ source: s, groups: by(s).length, events: by(s).reduce((n, x) => n + x.count, 0) })).filter((x) => x.groups), stored: st.errors.length },
      });
    }
    if (sub === '/ops/health-check' && m === 'POST') {
      const now = this.h.now();
      let row!: OpsState['manual'][number];
      this.h.commit((s) => {
        row = { id: s.nextId++, at: now.toISOString(), ok: 1, d1_ok: 1, r2_ok: 1, do_ok: 1, d1_ms: 1, total_ms: 2, source: 'manual', version: this.h.version, detail: '' };
        s.manual.push(row);
        s.manual = s.manual.filter((x) => Date.parse(x.at) >= now.getTime() - OPS_LIMITS.healthRetentionDays * 86400_000).slice(-200);
      });
      return ok({ check: row }, 201);
    }
    if (sub === '/ops/errors' && m === 'GET') {
      const source = q.get('source');
      const before = Number(q.get('before') ?? 0);
      const limit = Math.min(100, Math.max(1, Number(q.get('limit') ?? 50) || 50));
      const all = [...this.h.state().errors].reverse().filter((x) => (source === 'worker' || source === 'client' ? x.source === source : true) && (before > 0 ? x.id < before : true));
      const items = all.slice(0, limit);
      return ok({ errors: items, nextBefore: all.length > limit ? items.at(-1)!.id : null });
    }
    if (sub === '/ops/errors' && m === 'DELETE') {
      let n = 0;
      this.h.commit((s) => {
        n = s.errors.length;
        s.errors = [];
      });
      return ok({ deleted: n });
    }
    const dm = /^\/ops\/errors\/(\d+)$/.exec(sub);
    if (dm && m === 'DELETE') {
      const id = Number(dm[1]);
      if (!this.h.state().errors.some((x) => x.id === id)) throw new SocialError(404, 'not_found', '没有这条错误');
      this.h.commit((s) => void (s.errors = s.errors.filter((x) => x.id !== id)));
      return ok({ deleted: 1 });
    }
    throw new SocialError(404, 'not_found', '接口不存在');
  }
}
