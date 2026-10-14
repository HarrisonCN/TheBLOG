/**
 * L26 搜索与推荐 2.0（纯函数；web/src/search-core.ts 与 worker/src/search-core.ts 必须完全一致，worker 测试会比对）。
 *
 * - tokenize：NFKC + 小写；拉丁字母 / 数字按词切，连续的中日韩字符切成二元组（bigram，单字时保留单字）。
 * - buildIndex：文章 / 作品 / 影集 / 用户 / 话题统一成 SearchDoc，按 kind:id 去重（先到先得）。
 * - search：字段加权 BM25（标题 3 · 标签 2 · 摘要 1.2 · 正文 1），每个查询片段都要命中（AND；中文片段命中 ≥60% 的二元组），
 *   标题完整包含查询再加分；可按类型 / 标签 / 年份 / 栏目过滤；同一系列在前 5 名里最多 2 条（diversify）。
 * - facets：结果里各类型 / 标签 / 年份的数量（筛选器用）。
 * - suggest：没有结果时，用二元组重叠找相近的标签与标题。
 * - related：标签 Jaccard ×3 + 同分类 +1（+ 同系列 0.5，默认排除同系列）后做 MMR 多样性重排。
 * - highlightRanges：返回需要高亮的 [start, end) 区间（调用方转义后再包 <mark>）。
 */

export const SEARCH_KINDS = ['post', 'work', 'album', 'user', 'topic'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];
export const SEARCH_KIND_LABEL: Record<SearchKind, string> = { post: '文章', work: '作品', album: '影集', user: '用户', topic: '话题' };
export const MAX_QUERY = 80;
export const MAX_TERMS = 12;

export interface SearchDoc {
  /** 在同一类型里唯一（文章 slug、作品 id、用户名、话题 slug…） */
  id: string;
  kind: SearchKind;
  title: string;
  summary: string;
  text?: string;
  tags: string[];
  /** 栏目（文章的分类、作品的系列…）；可为空 */
  section?: string | null;
  series?: string | null;
  /** YYYY-MM-DD 或 ISO；用于年份筛选 */
  date?: string | null;
  href: string;
}

export interface SearchFilters {
  kind?: SearchKind | '' | null;
  tag?: string | null;
  year?: string | null;
  section?: string | null;
}

export interface SearchHit {
  doc: SearchDoc;
  score: number;
}

type Field = 'title' | 'tags' | 'summary' | 'text';
const FIELDS: Field[] = ['title', 'tags', 'summary', 'text'];
const WEIGHT: Record<Field, number> = { title: 3, tags: 2, summary: 1.2, text: 1 };
const K1 = 1.2;
const B = 0.75;

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
const isCjk = (ch: string) => CJK.test(ch);
const isWord = (ch: string) => /[\p{L}\p{N}]/u.test(ch) && !isCjk(ch);

export function normalize(s: string): string {
  return (s ?? '').normalize('NFKC').toLowerCase();
}

/** 切词：英文 / 数字按词，中文按二元组。重复的词保留（BM25 需要词频）。 */
export function tokenize(input: string): string[] {
  const s = normalize(input);
  const out: string[] = [];
  let word = '';
  let run = '';
  const flushWord = () => {
    if (word) out.push(word);
    word = '';
  };
  const flushRun = () => {
    if (run.length === 1) out.push(run);
    else for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
    run = '';
  };
  for (const ch of s) {
    if (isCjk(ch)) {
      flushWord();
      run += ch;
    } else if (isWord(ch)) {
      flushRun();
      word += ch;
    } else {
      flushWord();
      flushRun();
    }
  }
  flushWord();
  flushRun();
  return out;
}

/** 查询词（去重、限量）。 */
export function queryTerms(query: string): string[] {
  return [...new Set(tokenize((query ?? '').slice(0, MAX_QUERY)))].slice(0, MAX_TERMS);
}

interface Entry {
  doc: SearchDoc;
  tf: Record<Field, Map<string, number>>;
  len: Record<Field, number>;
}
export interface SearchIndex {
  entries: Entry[];
  df: Map<string, number>;
  avg: Record<Field, number>;
  /** 标签与标题词表（suggest 用） */
  vocab: string[];
}

const fieldText = (d: SearchDoc, f: Field): string => (f === 'tags' ? [...d.tags, d.section ?? '', d.series ?? ''].join(' ') : f === 'title' ? d.title : f === 'summary' ? d.summary : (d.text ?? ''));

export function docKey(d: Pick<SearchDoc, 'kind' | 'id'>): string {
  return `${d.kind}:${d.id}`;
}

export function buildIndex(docs: SearchDoc[]): SearchIndex {
  const seen = new Set<string>();
  const entries: Entry[] = [];
  const df = new Map<string, number>();
  const sum: Record<Field, number> = { title: 0, tags: 0, summary: 0, text: 0 };
  const vocab = new Set<string>();
  for (const d of docs) {
    const k = docKey(d);
    if (seen.has(k)) continue;
    seen.add(k);
    const tf = { title: new Map(), tags: new Map(), summary: new Map(), text: new Map() } as Record<Field, Map<string, number>>;
    const len = { title: 0, tags: 0, summary: 0, text: 0 } as Record<Field, number>;
    const all = new Set<string>();
    for (const f of FIELDS) {
      const toks = tokenize(fieldText(d, f));
      len[f] = toks.length;
      sum[f] += toks.length;
      for (const t of toks) {
        tf[f].set(t, (tf[f].get(t) ?? 0) + 1);
        all.add(t);
      }
    }
    for (const t of all) df.set(t, (df.get(t) ?? 0) + 1);
    for (const t of d.tags) if (t.trim()) vocab.add(t.trim());
    if (d.title.trim()) vocab.add(d.title.trim());
    entries.push({ doc: d, tf, len });
  }
  const n = entries.length || 1;
  const avg = { title: sum.title / n || 1, tags: sum.tags / n || 1, summary: sum.summary / n || 1, text: sum.text / n || 1 };
  return { entries, df, avg, vocab: [...vocab] };
}

/** 新的在前的比较值（相同为 0）。 */
const newer = (a?: string | null, b?: string | null): number => ((a ?? '') < (b ?? '') ? 1 : (a ?? '') > (b ?? '') ? -1 : 0);

export function yearOf(date: string | null | undefined): string | null {
  const m = /^(\d{4})/.exec(date ?? '');
  return m ? m[1]! : null;
}

function passes(d: SearchDoc, f: SearchFilters): boolean {
  if (f.kind && d.kind !== f.kind) return false;
  if (f.tag && !d.tags.some((t) => normalize(t) === normalize(f.tag!))) return false;
  if (f.year && yearOf(d.date) !== f.year) return false;
  if (f.section && normalize(d.section ?? '') !== normalize(f.section)) return false;
  return true;
}

/**
 * 查询分组：按空白 / 标点切成片段，每个片段是一组词。拉丁词一组一个词（必须命中）；
 * 中文片段切成二元组，命中至少 60%（向上取整）即算这一组命中，这样「城市夜景」也能找到「城市的灯光 + #夜景」。
 */
export function queryGroups(query: string): string[][] {
  const groups: string[][] = [];
  let budget = MAX_TERMS;
  for (const seg of normalize((query ?? '').slice(0, MAX_QUERY)).split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    const toks = [...new Set(tokenize(seg))].slice(0, budget);
    if (!toks.length) continue;
    budget -= toks.length;
    // 中英混写的片段（Spring动效）拆开：每个拉丁词自成一组，中文二元组成一组
    const latin = toks.filter((t) => !isCjk([...t][0]!));
    const cjk = toks.filter((t) => isCjk([...t][0]!));
    for (const l of latin) groups.push([l]);
    if (cjk.length) groups.push(cjk);
    if (budget <= 0) break;
  }
  return groups;
}
const need = (n: number) => Math.max(1, Math.ceil(n * 0.6));

/** 排名核心（不做多样性重排）。 */
export function rank(index: SearchIndex, query: string, filters: SearchFilters = {}): SearchHit[] {
  const groups = queryGroups(query);
  if (!groups.length) return [];
  const N = index.entries.length;
  const phrase = normalize(query).trim();
  const hits: SearchHit[] = [];
  const termScore = (e: Entry, t: string): number => {
    const df = index.df.get(t) ?? 0;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    let s = 0;
    for (const f of FIELDS) {
      const tf = e.tf[f].get(t) ?? 0;
      if (!tf) continue;
      s += WEIGHT[f] * idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * e.len[f]) / index.avg[f])));
    }
    return s;
  };
  for (const e of index.entries) {
    if (!passes(e.doc, filters)) continue;
    let score = 0;
    let all = true;
    for (const g of groups) {
      let matched = 0;
      let gs = 0;
      for (const t of g) {
        const s = termScore(e, t);
        if (s > 0) {
          matched++;
          gs += s;
        }
      }
      if (matched < need(g.length)) {
        all = false;
        break;
      }
      score += gs * (matched / g.length);
    }
    if (!all || score <= 0) continue;
    if (phrase && normalize(e.doc.title).includes(phrase)) score += 2;
    if (phrase && e.doc.tags.some((t) => normalize(t) === phrase)) score += 1.5;
    hits.push({ doc: e.doc, score: Math.round(score * 1000) / 1000 });
  }
  return hits.sort((a, b) => b.score - a.score || newer(a.doc.date, b.doc.date) || docKey(a.doc).localeCompare(docKey(b.doc)));
}

/** 同一系列在前 window 名里最多 maxPerSeries 条，多出来的顺延到后面（保持其余相对顺序）。 */
export function diversify<T extends { doc: Pick<SearchDoc, 'series'> }>(hits: T[], maxPerSeries = 2, window = 5): T[] {
  const head: T[] = [];
  const deferred: T[] = [];
  const count = new Map<string, number>();
  let i = 0;
  for (; i < hits.length && head.length < window; i++) {
    const h = hits[i]!;
    const s = (h.doc.series ?? '').trim();
    if (s && (count.get(s) ?? 0) >= maxPerSeries) {
      deferred.push(h);
      continue;
    }
    if (s) count.set(s, (count.get(s) ?? 0) + 1);
    head.push(h);
  }
  return [...head, ...deferred, ...hits.slice(i)];
}

export function search(index: SearchIndex, query: string, filters: SearchFilters = {}, limit = 50): SearchHit[] {
  return diversify(rank(index, query, filters)).slice(0, limit);
}

export interface Facets {
  kinds: { kind: SearchKind; count: number }[];
  tags: { tag: string; count: number }[];
  years: { year: string; count: number }[];
}
export function facets(hits: SearchHit[], topTags = 12): Facets {
  const k = new Map<SearchKind, number>();
  const t = new Map<string, number>();
  const y = new Map<string, number>();
  for (const { doc } of hits) {
    k.set(doc.kind, (k.get(doc.kind) ?? 0) + 1);
    for (const tag of new Set(doc.tags)) t.set(tag, (t.get(tag) ?? 0) + 1);
    const yr = yearOf(doc.date);
    if (yr) y.set(yr, (y.get(yr) ?? 0) + 1);
  }
  return {
    kinds: SEARCH_KINDS.filter((x) => k.has(x)).map((kind) => ({ kind, count: k.get(kind)! })),
    tags: [...t].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, topTags),
    years: [...y].map(([year, count]) => ({ year, count })).sort((a, b) => (a.year < b.year ? 1 : -1)),
  };
}

/** 没有结果时的建议：与查询二元组 / 词重叠最多的标签与标题（Dice 系数 ≥ 0.25）。 */
export function suggest(index: SearchIndex, query: string, n = 5): string[] {
  const q = new Set(charGrams(query));
  if (!q.size) return [];
  const qn = normalize(query).trim();
  return index.vocab
    .filter((v) => normalize(v) !== qn)
    .map((v) => {
      const g = new Set(charGrams(v));
      let shared = 0;
      for (const x of g) if (q.has(x)) shared++;
      return { v, s: (2 * shared) / (g.size + q.size || 1) };
    })
    .filter((x) => x.s >= 0.25)
    .sort((a, b) => b.s - a.s || a.v.length - b.v.length || a.v.localeCompare(b.v))
    .slice(0, n)
    .map((x) => x.v);
}
/** 字符级二元组（拉丁词也拆，用来容忍拼写差一两个字母）。 */
function charGrams(s: string): string[] {
  const out: string[] = [];
  for (const part of normalize(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    const chars = [...part];
    if (chars.length === 1) out.push(chars[0]!);
    for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i]! + chars[i + 1]!);
  }
  return out;
}

/** 需要高亮的区间（按原文下标；合并重叠）。英文按词、中文按查询里的连续中文片段整体匹配。 */
export function highlightRanges(text: string, query: string): [number, number][] {
  const src = text ?? '';
  const low = src.toLowerCase();
  const needles = [...new Set(normalize(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean))].sort((a, b) => b.length - a.length).slice(0, MAX_TERMS);
  const r: [number, number][] = [];
  for (const nd of needles) {
    let i = 0;
    while (nd && (i = low.indexOf(nd, i)) >= 0) {
      r.push([i, i + nd.length]);
      i += nd.length;
    }
  }
  r.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const x of r) {
    const last = merged[merged.length - 1];
    if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]);
    else merged.push([x[0], x[1]]);
  }
  return merged;
}

/** 命中词附近的一段纯文本。 */
export function snippetOf(text: string, query: string, len = 90): string {
  const src = text ?? '';
  const first = highlightRanges(src, query)[0];
  if (!first) return src.slice(0, len) + (src.length > len ? '…' : '');
  const from = Math.max(0, first[0] - Math.floor(len / 3));
  return (from > 0 ? '…' : '') + src.slice(from, from + len) + (from + len < src.length ? '…' : '');
}

export interface RelatedInput {
  id: string;
  tags: string[];
  section?: string | null;
  series?: string | null;
  date?: string | null;
}
const jaccard = (a: string[], b: string[]) => {
  const A = new Set(a);
  const B2 = new Set(b);
  let shared = 0;
  for (const x of A) if (B2.has(x)) shared++;
  const union = new Set([...A, ...B2]).size;
  return union ? shared / union : 0;
};
/** 两条推荐之间的相似度：同系列 = 1，否则标签 Jaccard（同栏目再 +0.2）。 */
export function similarity(a: RelatedInput, b: RelatedInput): number {
  const sa = (a.series ?? '').trim();
  if (sa && sa === (b.series ?? '').trim()) return 1;
  return Math.min(1, jaccard(a.tags, b.tags) + (a.section && a.section === b.section ? 0.2 : 0));
}

/** MMR：λ·相关度 − (1−λ)·与已选条目的最大相似度（相关度先归一化到 0..1）；同一系列最多 maxPerSeries 条。 */
export function mmr<T extends RelatedInput>(cands: { item: T; score: number }[], k: number, lambda = 0.7, maxPerSeries = 2): T[] {
  const max = Math.max(0, ...cands.map((c) => c.score)) || 1;
  const pool = cands.map((c) => ({ item: c.item, rel: c.score / max }));
  const picked: T[] = [];
  const perSeries = new Map<string, number>();
  while (picked.length < k && pool.length) {
    let best = -1;
    let bestVal = -Infinity;
    pool.forEach((c, i) => {
      const s = (c.item.series ?? '').trim();
      if (s && (perSeries.get(s) ?? 0) >= maxPerSeries) return;
      const sim = picked.length ? Math.max(...picked.map((p) => similarity(c.item, p))) : 0;
      const v = lambda * c.rel - (1 - lambda) * sim;
      if (v > bestVal + 1e-9) {
        bestVal = v;
        best = i;
      }
    });
    if (best < 0) break;
    const it = pool.splice(best, 1)[0]!.item;
    const s = (it.series ?? '').trim();
    if (s) perSeries.set(s, (perSeries.get(s) ?? 0) + 1);
    picked.push(it);
  }
  return picked;
}

/** 相关推荐：标签 Jaccard ×3 + 同栏目 +1 + 同系列 +0.5（默认排除同系列）；零分不推荐；再 MMR 多样性重排。 */
export function related<T extends RelatedInput>(all: T[], target: RelatedInput, k = 3, opts: { excludeSeries?: boolean; lambda?: number; maxPerSeries?: number } = {}): T[] {
  const excl = opts.excludeSeries ?? true;
  const series = (target.series ?? '').trim();
  const cands = all
    .filter((p) => p.id !== target.id && !(excl && series && (p.series ?? '').trim() === series))
    .map((p) => ({ item: p, score: jaccard(p.tags, target.tags) * 3 + (p.section && p.section === target.section ? 1 : 0) + (series && (p.series ?? '').trim() === series ? 0.5 : 0) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || newer(a.item.date, b.item.date) || a.item.id.localeCompare(b.item.id));
  return mmr(cands, k, opts.lambda ?? 0.7, opts.maxPerSeries ?? 2);
}

/** URL 参数 ⇄ 查询状态（搜索页用，非法值丢弃）。 */
export interface SearchState extends SearchFilters {
  q: string;
}
export function parseSearchParams(p: URLSearchParams): SearchState {
  const kind = p.get('type') ?? '';
  const year = p.get('year') ?? '';
  return {
    q: (p.get('q') ?? '').trim().slice(0, MAX_QUERY),
    kind: (SEARCH_KINDS as readonly string[]).includes(kind) ? (kind as SearchKind) : '',
    tag: (p.get('tag') ?? '').trim().slice(0, 40) || null,
    year: /^\d{4}$/.test(year) ? year : null,
  };
}
export function searchParamsOf(s: SearchState): string {
  const p = new URLSearchParams();
  if (s.q) p.set('q', s.q);
  if (s.kind) p.set('type', s.kind);
  if (s.tag) p.set('tag', s.tag);
  if (s.year) p.set('year', s.year);
  const str = p.toString();
  return str ? `?${str}` : '';
}
