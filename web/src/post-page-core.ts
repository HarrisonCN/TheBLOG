/**
 * 文章分页核心（web 与 worker 两份完全相同，测试保证）。
 *
 * 顺序：置顶优先，然后按 COALESCE(published_at, created_at) 倒序，同一时间按 id 倒序——
 * 三元组 (pinned, t, id) 全序且稳定，所以游标分页不会漏也不会重复。
 * 游标 = base64url(JSON {p, t, i})，表示「上一页最后一篇」的位置；下一页取严格排在它之后的文章。
 */
export const PAGE_LIMIT_DEFAULT = 20;
export const PAGE_LIMIT_MAX = 100;

export interface PageCursor {
  /** 是否置顶（1 / 0） */
  p: 0 | 1;
  /** 排序时间 = publishedAt ?? createdAt（ISO 字符串） */
  t: string;
  /** 文章 id */
  i: number;
}

export interface OrderKeyed {
  id: number;
  pinned: boolean;
  publishedAt: string | null;
  createdAt: string;
}

export const sortTime = (p: OrderKeyed): string => p.publishedAt ?? p.createdAt;

export const cursorOf = (p: OrderKeyed): PageCursor => ({ p: p.pinned ? 1 : 0, t: sortTime(p), i: p.id });

/** 站点统一顺序的比较函数（负数 = a 排在前面）。 */
export function compareOrder(a: OrderKeyed, b: OrderKeyed): number {
  return Number(b.pinned) - Number(a.pinned) || (sortTime(a) < sortTime(b) ? 1 : sortTime(a) > sortTime(b) ? -1 : b.id - a.id);
}

/** 文章是否严格排在游标位置之后。 */
export function isAfter(p: OrderKeyed, c: PageCursor): boolean {
  return compareOrder(p, { id: c.i, pinned: c.p === 1, publishedAt: c.t, createdAt: c.t }) > 0;
}

const b64urlEncode = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlDecode = (s: string): string => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
};

export function encodeCursor(c: PageCursor): string {
  return b64urlEncode(JSON.stringify({ p: c.p, t: c.t, i: c.i }));
}

/** 解码游标；格式不对返回 null（调用方回 400）。 */
export function decodeCursor(raw: string): PageCursor | null {
  if (!raw || raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const o = JSON.parse(b64urlDecode(raw)) as Record<string, unknown>;
    if ((o.p !== 0 && o.p !== 1) || typeof o.t !== 'string' || o.t.length < 4 || o.t.length > 40 || !Number.isSafeInteger(o.i) || (o.i as number) < 0) return null;
    return { p: o.p, t: o.t, i: o.i as number };
  } catch {
    return null;
  }
}

export type PageQueryResult = { ok: true; limit: number; cursor: PageCursor | null } | { ok: false; field: 'limit' | 'cursor'; message: string };

/** 严格校验分页参数：limit 必须是 1..PAGE_LIMIT_MAX 的整数；cursor 必须能解码。 */
export function parsePageQuery(limit: string | null | undefined, cursor: string | null | undefined): PageQueryResult {
  let n = PAGE_LIMIT_DEFAULT;
  if (limit != null && limit !== '') {
    if (!/^\d{1,4}$/.test(limit)) return { ok: false, field: 'limit', message: `limit 必须是 1–${PAGE_LIMIT_MAX} 的整数` };
    n = Number(limit);
    if (n < 1 || n > PAGE_LIMIT_MAX) return { ok: false, field: 'limit', message: `limit 必须是 1–${PAGE_LIMIT_MAX} 的整数` };
  }
  let c: PageCursor | null = null;
  if (cursor != null && cursor !== '') {
    c = decodeCursor(cursor);
    if (!c) return { ok: false, field: 'cursor', message: '分页游标无效' };
  }
  return { ok: true, limit: n, cursor: c };
}

/** 内存里对已排序列表取一页（mock API 与测试用）。 */
export function pageOf<T extends OrderKeyed>(sorted: readonly T[], limit: number, cursor: PageCursor | null): { items: T[]; nextCursor: string | null } {
  const start = cursor ? sorted.findIndex((p) => isAfter(p, cursor)) : 0;
  const from = start < 0 ? sorted.length : start;
  const items = sorted.slice(from, from + limit);
  const more = from + limit < sorted.length;
  return { items, nextCursor: more && items.length ? encodeCursor(cursorOf(items[items.length - 1]!)) : null };
}

/**
 * 依次拉取所有页（客户端回退、后台列表、预渲染共用）。
 * 防御：游标不前进、页数超过上限、或重复的 id 都会抛错，不会死循环。
 */
export async function walkPages<T extends { id: number }>(
  fetchPage: (cursor: string | null) => Promise<{ posts: T[]; total: number; nextCursor?: string | null }>,
  opts: { maxPages?: number } = {},
): Promise<{ posts: T[]; total: number; pages: number }> {
  const max = opts.maxPages ?? 1000;
  const out: T[] = [];
  const seen = new Set<number>();
  let cursor: string | null = null;
  let total = 0;
  let pages = 0;
  for (;;) {
    const r = await fetchPage(cursor);
    pages++;
    total = r.total;
    for (const p of r.posts) {
      if (seen.has(p.id)) throw new Error(`分页重复：id ${p.id}`);
      seen.add(p.id);
      out.push(p);
    }
    const next = r.nextCursor ?? null;
    if (!next || !r.posts.length) break;
    if (next === cursor) throw new Error('分页游标没有前进');
    if (pages >= max) throw new Error(`分页超过 ${max} 页`);
    cursor = next;
  }
  return { posts: out, total, pages };
}
