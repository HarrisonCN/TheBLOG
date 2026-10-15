/**
 * L30 / v1.30.0 跨设备同步：阅读进度（blog-reading）+ 稍后读（blog-later）。
 * L25 / L27 时这两样只存在本机（会员同步 SKIPPED），这里补上：登录的好朋友在不同设备之间合并。
 * 纯函数，web 与 worker 共用（worker/src/sync-core.ts 是同一个文件的副本）。
 * 合并规则：同一篇文章按 at（毫秒时间戳）取新；稍后读的删除用墓碑记录，条目时间晚于墓碑才保留（删了又加回来）；
 * 合并可交换、幂等，服务端不需要锁，只用版本号告诉客户端有没有变化。
 */
export interface SyncHistory {
  slug: string;
  title: string;
  cover: string | null;
  pct: number;
  y: number;
  at: number;
}
export interface SyncLater {
  slug: string;
  title: string;
  at: number;
}
export interface SyncTomb {
  slug: string;
  at: number;
}
export interface SyncDoc {
  history: SyncHistory[];
  later: SyncLater[];
  laterRemoved: SyncTomb[];
}
export const SYNC_HISTORY_MAX = 20;
export const SYNC_LATER_MAX = 100;
export const SYNC_LATER_TOMBSTONES = 200;
/** 请求体上限（字节） */
export const SYNC_MAX_BYTES = 64 * 1024;
const SLUG_RE = /^[a-z0-9-]{1,120}$/;

export const emptySyncDoc = (): SyncDoc => ({ history: [], later: [], laterRemoved: [] });

const num = (v: unknown, lo: number, hi: number, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '');
const AT_MAX = 8_640_000_000_000;

/** 严格校验（服务端入口）：丢掉非法条目，截断到上限；不是对象则拒绝。 */
export function checkSyncDoc(raw: unknown): { ok: true; value: SyncDoc } | { ok: false; message: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: '同步数据格式不正确' };
  const o = raw as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const history: SyncHistory[] = [];
  for (const x of arr(o.history)) {
    if (!x || typeof x !== 'object') continue;
    const h = x as Record<string, unknown>;
    if (typeof h.slug !== 'string' || !SLUG_RE.test(h.slug)) continue;
    const cover = typeof h.cover === 'string' && /^(https:\/\/|\/)[^\s"'<>]{0,500}$/.test(h.cover) ? h.cover : null;
    history.push({ slug: h.slug, title: str(h.title, 200), cover, pct: num(h.pct, 0, 1), y: Math.round(num(h.y, 0, 10_000_000)), at: Math.round(num(h.at, 0, AT_MAX)) });
  }
  const later: SyncLater[] = [];
  for (const x of arr(o.later)) {
    if (!x || typeof x !== 'object') continue;
    const l = x as Record<string, unknown>;
    if (typeof l.slug !== 'string' || !SLUG_RE.test(l.slug)) continue;
    later.push({ slug: l.slug, title: str(l.title, 200), at: Math.round(num(l.at, 0, AT_MAX)) });
  }
  const laterRemoved: SyncTomb[] = [];
  for (const x of arr(o.laterRemoved)) {
    if (!x || typeof x !== 'object') continue;
    const t = x as Record<string, unknown>;
    if (typeof t.slug !== 'string' || !SLUG_RE.test(t.slug)) continue;
    laterRemoved.push({ slug: t.slug, at: Math.round(num(t.at, 0, AT_MAX)) });
  }
  return { ok: true, value: normalize({ history, later, laterRemoved }) };
}

function newest<T extends { slug: string; at: number }>(list: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const x of list) {
    const p = m.get(x.slug);
    // 时间相同的两条：按内容排序取一条，保证合并可交换
    if (!p || x.at > p.at || (x.at === p.at && JSON.stringify(x) > JSON.stringify(p))) m.set(x.slug, x);
  }
  return m;
}
const byAt = <T extends { slug: string; at: number }>(a: T, b: T) => b.at - a.at || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

function normalize(d: SyncDoc): SyncDoc {
  const tombs = [...newest(d.laterRemoved).values()].sort(byAt).slice(0, SYNC_LATER_TOMBSTONES);
  const tombAt = new Map(tombs.map((t) => [t.slug, t.at]));
  const later = [...newest(d.later).values()].filter((x) => x.at > (tombAt.get(x.slug) ?? -1)).sort(byAt).slice(0, SYNC_LATER_MAX);
  const history = [...newest(d.history).values()].sort(byAt).slice(0, SYNC_HISTORY_MAX);
  return { history, later, laterRemoved: tombs };
}

/** 两份同步文档合并（可交换、幂等）。 */
export function mergeSync(a: SyncDoc, b: SyncDoc): SyncDoc {
  return normalize({ history: [...a.history, ...b.history], later: [...a.later, ...b.later], laterRemoved: [...a.laterRemoved, ...b.laterRemoved] });
}

/** 本机删除检测：上次同步时在清单里、现在不在了 → 生成墓碑。 */
export function laterTombstones(lastSynced: string[], current: SyncLater[], now: number): SyncTomb[] {
  const cur = new Set(current.map((x) => x.slug));
  return lastSynced.filter((s) => !cur.has(s)).map((slug) => ({ slug, at: now }));
}
