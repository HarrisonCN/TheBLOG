/**
 * L25 / v1.25.0 系列与影集 2.0 —— 纯函数（浏览器和预渲染共用，不碰 DOM）：
 * - 系列：按系列名分组、按发布时间排出第 1…N 篇；最后一篇带「完结」标签 = 已完结；
 * - 读者进度：只用访客本机的阅读记录（reading.ts 的 blog-reading），不上传；
 * - 月度合集：按 Asia/Shanghai 的月份把文章 / 影集 / 作品分组；上一月 / 下一月；
 * - 章节：锚点唯一；影集照片的可选 chapter 字段切出章节。
 */
import type { PostSummary } from './types';
import type { Work } from './sections';

/** 最后一篇带这个标签 = 系列已完结 */
export const SERIES_FINISHED_TAG = '完结';
/** 月度合集按这个时区切月份（站长在国内） */
export const MONTH_TZ = 'Asia/Shanghai';

export type SeriesStatus = 'finished' | 'ongoing';
export interface Series {
  name: string;
  parts: PostSummary[];
  status: SeriesStatus;
  intro: string;
  cover: string | null;
  /** 最后一篇的发布时间 */
  updatedAt: string;
}

const pub = (p: PostSummary) => p.publishedAt ?? p.createdAt;
const ms = (s: string) => Date.parse(s) || 0;
const byPub = (a: PostSummary, b: PostSummary) => ms(pub(a)) - ms(pub(b)) || a.id - b.id;
/** 能做详情页网址的系列名（和标签页同一条规则：不含路径分隔符、不以 . 开头） */
export const seriesNameOk = (n: string) => !!n && n.length <= 60 && !/[\/\\]|^\./.test(n);

/** 全部系列：最近更新的在前 */
export function buildSeries(posts: PostSummary[]): Series[] {
  const map = new Map<string, PostSummary[]>();
  for (const p of posts) {
    if (p.status === 'draft') continue;
    const n = (p.series ?? '').trim();
    if (seriesNameOk(n)) map.set(n, [...(map.get(n) ?? []), p]);
  }
  return [...map]
    .map(([name, list]) => {
      const parts = [...list].sort(byPub);
      const last = parts[parts.length - 1]!;
      return {
        name,
        parts,
        status: (last.tags ?? []).includes(SERIES_FINISHED_TAG) ? 'finished' : 'ongoing',
        intro: parts[0]!.summary,
        cover: parts.find((p) => p.coverUrl)?.coverUrl ?? null,
        updatedAt: pub(last),
      } satisfies Series;
    })
    .sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt) || a.name.localeCompare(b.name));
}
export function findSeries(posts: PostSummary[], name: string): Series | null {
  return buildSeries(posts).find((s) => s.name === name.trim()) ?? null;
}

export type PartState = 'read' | 'reading' | 'unread';
export interface SeriesProgress {
  read: number;
  total: number;
  /** 0–100 整数 */
  pct: number;
  started: boolean;
  done: boolean;
  states: PartState[];
  /** 下一篇该读的（最前面一篇没读完的）；index 从 1 开始 */
  next: { index: number; slug: string; title: string } | null;
}
/** 读到 ≥ 95% 算读完（和「继续阅读」同一个阈值） */
export const READ_DONE = 0.95;
export function seriesProgress(s: Pick<Series, 'parts'>, history: { slug: string; pct: number }[]): SeriesProgress {
  const pctOf = new Map(history.map((h) => [h.slug, h.pct]));
  const states: PartState[] = s.parts.map((p) => {
    const v = pctOf.get(p.slug);
    return v === undefined ? 'unread' : v >= READ_DONE ? 'read' : 'reading';
  });
  const read = states.filter((x) => x === 'read').length;
  const total = s.parts.length;
  const i = states.findIndex((x) => x !== 'read');
  const nx = i >= 0 ? s.parts[i]! : null;
  return {
    read,
    total,
    pct: total ? Math.round((read / total) * 100) : 0,
    started: states.some((x) => x !== 'unread'),
    done: total > 0 && read === total,
    states,
    next: nx ? { index: i + 1, slug: nx.slug, title: nx.title } : null,
  };
}

// ---------------------------------------------------------------- 月度合集
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const isMonthKey = (s: string) => MONTH_RE.test(s);
export const monthLabel = (ym: string) => `${ym.slice(0, 4)} 年 ${Number(ym.slice(5, 7))} 月`;
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: MONTH_TZ, year: 'numeric', month: '2-digit' });
/** 时间戳 → 上海时区的「YYYY-MM」；只有日期的字符串（作品的 date）按字面月份 */
export function monthKey(s: string | null | undefined): string | null {
  const t = (s ?? '').trim();
  if (!t) return null;
  const d = /^(\d{4}-\d{2})(?:-\d{2})?$/.exec(t);
  if (d) return isMonthKey(d[1]!) ? d[1]! : null;
  const ms = Date.parse(t);
  if (!Number.isFinite(ms)) return null;
  const parts = fmt.formatToParts(new Date(ms));
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const k = `${y}-${m}`;
  return isMonthKey(k) ? k : null;
}
export interface MonthGroup {
  ym: string;
  posts: PostSummary[];
  essays: PostSummary[];
  works: Work[];
  count: number;
}
/** 有内容的月份（最近的在前）；月内按时间倒序；草稿不算 */
export function monthlyGroups(posts: PostSummary[], works: Work[] = []): MonthGroup[] {
  const map = new Map<string, MonthGroup>();
  const get = (ym: string) => map.get(ym) ?? (map.set(ym, { ym, posts: [], essays: [], works: [], count: 0 }), map.get(ym)!);
  for (const p of posts) {
    if (p.status === 'draft') continue;
    const ym = monthKey(pub(p));
    if (!ym) continue;
    const g = get(ym);
    (p.kind === 'essay' ? g.essays : g.posts).push(p);
    g.count++;
  }
  for (const w of works) {
    const ym = monthKey(w.date);
    if (!ym) continue;
    const g = get(ym);
    g.works.push(w);
    g.count++;
  }
  const desc = (a: PostSummary, b: PostSummary) => -byPub(a, b);
  for (const g of map.values()) {
    g.posts.sort(desc);
    g.essays.sort(desc);
    g.works.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }
  return [...map.values()].sort((a, b) => (a.ym < b.ym ? 1 : -1));
}
/** yms：最近的在前。prev = 更早一个有内容的月份，next = 更新的 */
export function monthNav(yms: string[], ym: string): { prev: string | null; next: string | null } {
  const i = yms.indexOf(ym);
  if (i < 0) return { prev: null, next: null };
  return { prev: yms[i + 1] ?? null, next: i > 0 ? yms[i - 1]! : null };
}

// ---------------------------------------------------------------- 章节
/** 章节标题 → 唯一锚点：保留中日韩文字、字母数字，其余变成 -；重名加 -2、-3；空标题用序号 */
export function chapterAnchors(titles: string[], prefix = 'ch'): string[] {
  const used = new Set<string>();
  return titles.map((t, i) => {
    const slug = t
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const base = slug ? `${prefix}-${slug}` : `${prefix}-${i + 1}`;
    let id = base;
    for (let k = 2; used.has(id); k++) id = `${base}-${k}`;
    used.add(id);
    return id;
  });
}
export interface EssayChapter {
  title: string;
  id: string;
  /** 第一张照片的下标 */
  start: number;
  count: number;
}
/** 影集章节：带 chapter 的照片开始新的一章；第一章之前的照片归入「开篇」；没有任何 chapter = 没有章节 */
export function essayChapters(photos: { chapter?: string }[]): EssayChapter[] {
  if (!photos.some((p) => (p.chapter ?? '').trim())) return [];
  const raw: { title: string; start: number; count: number }[] = [];
  photos.forEach((p, i) => {
    const t = (p.chapter ?? '').trim();
    if (t || !raw.length) raw.push({ title: t || '开篇', start: i, count: 0 });
    raw[raw.length - 1]!.count++;
  });
  const ids = chapterAnchors(raw.map((c) => c.title));
  return raw.map((c, i) => ({ ...c, id: ids[i]! }));
}
