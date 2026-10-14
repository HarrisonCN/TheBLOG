/**
 * L27 阅读与书影音 2.0（纯函数；web/src/reading-core.ts 与 worker/src/reading-core.ts 必须完全一致，worker 测试会比对）。
 *
 * - 书摘：文章里的 `:::quote 来源 | 链接` 块 + 书影音条目的 quote 字段 → 书摘卡片；
 *   锚点 quoteAnchor 只由摘录正文（空白归一后）决定，所以重新渲染、前后加内容、改标题都不会变。
 * - 年度书影音：按条目的标记时间（date，YYYY 或 YYYY-MM）分年统计。
 * - 稍后读：只存在访客自己的浏览器里（localStorage blog-later），合并阅读进度，可导出 Markdown。
 */
import { parseQuoteSource } from './essay-core';

// ---------------------------------------------------------------- 书摘
export interface QuoteCard {
  /** 锚点（q-xxxxxxx），文章页里同一段摘录的 figure 用同一个 id */
  id: string;
  text: string;
  source: string;
  link: string;
  from: 'post' | 'shelf';
  /** from = post 时：文章 slug 与标题 */
  slug?: string;
  postTitle?: string;
  /** from = shelf 时：条目类型 */
  kind?: string;
  date?: string | null;
}
export const MAX_QUOTE = 400;

/** 摘录正文归一：去掉 Markdown 记号、合并空白。 */
export function quoteText(md: string): string {
  return (md ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~>#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** FNV-1a 32 位 → base36，稳定且足够短。 */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0');
}
export function quoteAnchor(md: string): string {
  return `q-${fnv(quoteText(md))}`;
}

/** 从文章 Markdown 里找出顶层与嵌套的 :::quote 块（跳过代码块）。 */
export function extractQuotes(md: string, post: { slug: string; title: string; publishedAt?: string | null }): QuoteCard[] {
  const lines = (md ?? '').split('\n');
  const out: QuoteCard[] = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const m = /^:::quote(?:[ \t]+(.*))?[ \t]*$/.exec(line);
    if (!m) continue;
    let depth = 1;
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const t = lines[j]!;
      if (/^:::[a-z]+/.test(t)) depth++;
      else if (/^:::\s*$/.test(t)) depth--;
      if (depth === 0) break;
      body.push(t);
    }
    if (depth !== 0) break; // 没有结束标记：渲染器也按普通文字处理
    const raw = body.join('\n');
    const text = quoteText(raw).slice(0, MAX_QUOTE);
    if (text) {
      const q = parseQuoteSource((m[1] ?? '').trim());
      out.push({ id: quoteAnchor(raw), text, source: q.source, link: q.link, from: 'post', slug: post.slug, postTitle: post.title, date: post.publishedAt ?? null });
    }
    i = j;
  }
  return out;
}

export interface ShelfLike {
  kind: string;
  title: string;
  creator: string;
  quote?: string;
  date?: string;
  url?: string;
}
export function shelfQuotes(shelf: ShelfLike[]): QuoteCard[] {
  return shelf
    .filter((s) => quoteText(s.quote ?? ''))
    .map((s) => ({ id: quoteAnchor(s.quote!), text: quoteText(s.quote!).slice(0, MAX_QUOTE), source: `《${s.title}》${s.creator ? ` ${s.creator}` : ''}`, link: s.url ?? '', from: 'shelf' as const, kind: s.kind, date: s.date ?? null }));
}

/** 合并、按 id 去重（先到先得），新的在前（没有日期的放后面）。 */
export function mergeQuotes(...lists: QuoteCard[][]): QuoteCard[] {
  const seen = new Set<string>();
  const all: QuoteCard[] = [];
  for (const q of lists.flat()) {
    if (seen.has(q.id)) continue;
    seen.add(q.id);
    all.push(q);
  }
  return all.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

// ---------------------------------------------------------------- 年度书影音
export interface ShelfEntry extends ShelfLike {
  status: string;
  rating: number;
  note?: string;
  year?: string;
}
export function shelfYear(s: { date?: string }): string | null {
  const m = /^(\d{4})(?:-(\d{2}))?/.exec(s.date ?? '');
  return m ? m[1]! : null;
}
export function shelfYears(shelf: { date?: string }[]): string[] {
  return [...new Set(shelf.map(shelfYear).filter((y): y is string => !!y))].sort().reverse();
}
export interface YearReport<T extends ShelfEntry = ShelfEntry> {
  year: string;
  total: number;
  byKind: Record<string, number>;
  done: number;
  doing: number;
  want: number;
  rated: number;
  avgRating: number;
  /** 12 个月的条数（只统计带月份的标记时间） */
  months: number[];
  top: T[];
  items: T[];
}
export function yearReport<T extends ShelfEntry>(shelf: T[], year: string): YearReport<T> {
  const items = shelf.filter((s) => shelfYear(s) === year);
  const byKind: Record<string, number> = {};
  const months = Array<number>(12).fill(0);
  let sum = 0;
  let rated = 0;
  for (const s of items) {
    byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
    if (s.rating > 0) {
      sum += s.rating;
      rated++;
    }
    const m = /^\d{4}-(\d{2})/.exec(s.date ?? '');
    if (m) {
      const k = Number(m[1]) - 1;
      if (k >= 0 && k < 12) months[k]!++;
    }
  }
  const top = items.filter((s) => s.rating >= 4).sort((a, b) => b.rating - a.rating || (b.date ?? '').localeCompare(a.date ?? '') || a.title.localeCompare(b.title)).slice(0, 6);
  return {
    year,
    total: items.length,
    byKind,
    done: items.filter((s) => s.status === 'done').length,
    doing: items.filter((s) => s.status === 'doing').length,
    want: items.filter((s) => s.status === 'want').length,
    rated,
    avgRating: rated ? Math.round((sum / rated) * 10) / 10 : 0,
    months,
    top,
    items: [...items].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.title.localeCompare(b.title)),
  };
}

// ---------------------------------------------------------------- 稍后读
export interface LaterItem {
  slug: string;
  title: string;
  /** 加入时间（毫秒） */
  at: number;
}
export const LATER_KEY = 'blog-later';
export const LATER_MAX = 100;
const SLUG_RE = /^[a-z0-9-]{1,120}$/;

export function parseLater(raw: string | null): LaterItem[] {
  try {
    const v = JSON.parse(raw || '[]') as unknown;
    if (!Array.isArray(v)) return [];
    const seen = new Set<string>();
    const out: LaterItem[] = [];
    for (const x of v) {
      if (!x || typeof x !== 'object') continue;
      const o = x as Record<string, unknown>;
      if (typeof o.slug !== 'string' || !SLUG_RE.test(o.slug) || typeof o.title !== 'string' || seen.has(o.slug)) continue;
      seen.add(o.slug);
      out.push({ slug: o.slug, title: o.title.slice(0, 200), at: Number(o.at) || 0 });
    }
    return out.slice(0, LATER_MAX);
  } catch {
    return [];
  }
}
/** 加入（已存在则移到最前），最多 LATER_MAX 条。 */
export function addLater(list: LaterItem[], item: { slug: string; title: string }, now: number): LaterItem[] {
  if (!SLUG_RE.test(item.slug)) return list;
  return [{ slug: item.slug, title: item.title.slice(0, 200), at: now }, ...list.filter((x) => x.slug !== item.slug)].slice(0, LATER_MAX);
}
export function removeLater(list: LaterItem[], slug: string): LaterItem[] {
  return list.filter((x) => x.slug !== slug);
}
export function hasLater(list: LaterItem[], slug: string): boolean {
  return list.some((x) => x.slug === slug);
}
export interface LaterRow extends LaterItem {
  /** 0–1；没读过 = 0 */
  pct: number;
  done: boolean;
}
/** 合并本机阅读进度（≥95% 算读完）：没读完的在前，其余保持加入顺序。 */
export function laterRows(list: LaterItem[], history: { slug: string; pct: number }[]): LaterRow[] {
  const pct = new Map(history.map((h) => [h.slug, h.pct]));
  const rows = list.map((x) => {
    const p = Math.min(1, Math.max(0, pct.get(x.slug) ?? 0));
    return { ...x, pct: p, done: p >= 0.95 };
  });
  return [...rows.filter((r) => !r.done), ...rows.filter((r) => r.done)];
}
/** 导出为 Markdown 清单（站点地址由调用方给，末尾不带 /）。 */
export function laterMarkdown(rows: LaterRow[], siteUrl: string, today: string): string {
  const base = siteUrl.replace(/\/+$/, '');
  const esc = (s: string) => s.replace(/([\\[\]])/g, '\\$1');
  return [`# 稍后读（${today}）`, '', ...rows.map((r) => `- [${r.done ? 'x' : ' '}] [${esc(r.title)}](${base}/posts/${r.slug}/)${r.done ? '' : r.pct > 0 ? ` — 读到 ${Math.round(r.pct * 100)}%` : ''}`), ''].join('\n');
}
