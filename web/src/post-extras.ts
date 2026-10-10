/**
 * 文章末尾的「系列连载」与「相关文章」、归档日历：纯函数，浏览器 / 预渲染 / 测试共用。
 */
import type { PostSummary } from './types';

const pub = (p: PostSummary) => p.publishedAt ?? p.createdAt;

export interface SeriesInfo {
  name: string;
  /** 系列里的文章，按发布时间正序（第 1 篇在前） */
  posts: PostSummary[];
  /** 当前文章在系列里的下标（0 起） */
  index: number;
  prev: PostSummary | null;
  next: PostSummary | null;
}

/** 当前文章所在的系列；不属于系列或系列只有它自己 → null。 */
export function seriesOf(all: PostSummary[], post: Pick<PostSummary, 'slug' | 'series'>): SeriesInfo | null {
  const name = (post.series ?? '').trim();
  if (!name) return null;
  const posts = all.filter((p) => (p.series ?? '').trim() === name).sort((a, b) => (pub(a) < pub(b) ? -1 : pub(a) > pub(b) ? 1 : a.id - b.id));
  const index = posts.findIndex((p) => p.slug === post.slug);
  if (index < 0 || posts.length < 2) return null;
  return { name, posts, index, prev: posts[index - 1] ?? null, next: posts[index + 1] ?? null };
}

/**
 * 相关文章：标签 Jaccard 相似度 ×3 + 同分类 +1 + 同系列 +0.5（但同系列的文章已经在系列导航里，默认排除），
 * 相同分数时更新的在前。没有任何交集的不推荐。
 */
export function relatedPosts(all: PostSummary[], post: Pick<PostSummary, 'slug' | 'tags' | 'category' | 'series'>, n = 3, opts: { excludeSeries?: boolean } = {}): PostSummary[] {
  const excludeSeries = opts.excludeSeries ?? true;
  const tags = new Set(post.tags);
  const series = (post.series ?? '').trim();
  return all
    .filter((p) => p.slug !== post.slug && !(excludeSeries && series && (p.series ?? '').trim() === series))
    .map((p) => {
      const shared = p.tags.filter((t) => tags.has(t)).length;
      const union = new Set([...p.tags, ...post.tags]).size || 1;
      const score = (shared / union) * 3 + (p.category && p.category === post.category ? 1 : 0) + (series && (p.series ?? '').trim() === series ? 0.5 : 0);
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (pub(a.p) < pub(b.p) ? 1 : -1))
    .slice(0, n)
    .map((x) => x.p);
}

export interface ArchiveYear {
  year: string;
  total: number;
  /** 12 个月的篇数（下标 0 = 1 月） */
  months: number[];
}

/** 按「年 × 月」统计篇数（Asia/Shanghai 时区），新的年份在前。 */
export function archiveCalendar(posts: PostSummary[]): ArchiveYear[] {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' });
  const map = new Map<string, number[]>();
  for (const p of posts) {
    const d = new Date(pub(p));
    if (Number.isNaN(d.getTime())) continue;
    const parts = fmt.formatToParts(d);
    const y = parts.find((x) => x.type === 'year')!.value;
    const m = Number(parts.find((x) => x.type === 'month')!.value);
    const arr = map.get(y) ?? new Array<number>(12).fill(0);
    arr[m - 1]!++;
    map.set(y, arr);
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([year, months]) => ({ year, months, total: months.reduce((s, n) => s + n, 0) }));
}
