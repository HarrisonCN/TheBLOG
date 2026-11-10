/**
 * L58 / v1.58.0 话题广场（web = worker 逐字相同，纯函数）：讨论帖的字段表（作者、标签 1–5 个、正文 1–10 段、置顶、浏览数、回复 0–200 条且编号唯一、回复日期不早于发帖日期）、热度、三种排序（置顶优先）、标签统计、摘要。
 * 校验用 content-kit 的字段表；演示站只收录虚构内容（fictional 必须为 true）。
 */
import { baseSummary, validateWith, type BaseSummary, type Schema } from './content-kit';

export { SLUG_RE, sortItems } from './content-kit';
export type { Issue } from './content-kit';

export interface Item extends BaseSummary {
  fictional: true;
  author: string;
  tags: string[];
  body: string[];
  pinned: boolean;
  views: number;
  replies: Reply[];
}
export interface Summary extends BaseSummary {
  author: string;
  tags: string[];
  pinned: boolean;
  replies: number;
  heat: number;
}
export const SCHEMA: Schema = {
  author: { k: 's', label: '作者', max: 20 },
  tags: { k: 't', label: '标签', max: 5, len: 12 },
  body: { k: 'p', label: '正文', min: 1, max: 10, len: 800 },
  pinned: { k: 'b', label: '置顶' },
  views: { k: 'i', label: '浏览数', lo: 0, hi: 10000000 },
  replies: {
    k: 'l',
    label: '回复',
    min: 0,
    max: 200,
    of: { id: { k: 's', label: '编号', max: 20 }, author: { k: 's', label: '回复者', max: 20 }, date: { k: 'd', label: '回复日期' }, text: { k: 's', label: '回复内容', max: 600 }, likes: { k: 'i', label: '点赞数', lo: 0, hi: 99999 } },
  },
};
export interface Reply {
  id: string;
  author: string;
  date: string;
  text: string;
  likes: number;
}
export type SortMode = 'latest' | 'replies' | 'hot';
/** 热度 = 回复 × 3 + 点赞 × 2 + 浏览 / 100（向下取整） */
export const heat = (replies: Pick<Reply, 'likes'>[], views: number) => replies.length * 3 + replies.reduce((a, r) => a + r.likes, 0) * 2 + Math.floor(views / 100);
/** 排序：置顶永远在最前；latest 按日期，replies 按回复数，hot 按热度；平局按日期倒序、地址 */
export function sortThreads<T extends { slug: string; date: string; pinned: boolean; replies: number; heat: number }>(list: T[], mode: SortMode): T[] {
  const key = (t: T) => (mode === 'replies' ? t.replies : mode === 'hot' ? t.heat : 0);
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (key(a) !== key(b)) return key(b) - key(a);
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
}
/** 标签统计：按帖子数从多到少，同数按标签 */
export function tagCounts(list: { tags: string[] }[]): { tag: string; n: number }[] {
  const m = new Map<string, number>();
  for (const t of list) for (const g of t.tags) m.set(g, (m.get(g) ?? 0) + 1);
  return [...m].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
}
/** 回复按楼层：日期从早到晚，同一天按编号 */
export const floors = (r: Reply[]) => [...r].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: import('./content-kit').Issue[] } {
  return validateWith<Item>(SCHEMA, input, (it, bad, raw) => {
    if (!it.tags.length) bad('tags', '至少 1 个标签');
    const seen = new Set<string>();
    it.replies.forEach((r, i) => {
      if (seen.has(r.id)) bad(`replies.${i}.id`, '回复编号不能重复');
      seen.add(r.id);
      if (r.date < it.date) bad(`replies.${i}.date`, '回复不能早于发帖日期');
    });
    void raw;
  });
}
export function summarize(it: Item): Summary {
  return { ...baseSummary(it), author: it.author, tags: it.tags, pinned: it.pinned, replies: it.replies.length, heat: heat(it.replies, it.views) };
}
