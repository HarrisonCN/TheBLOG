/**
 * L61 / v1.61.0 链接分享（web = worker 逐字相同，纯函数）：链接分享的字段表（https 地址、推荐人、标签 1–4 个、推荐语 1–4 段、点赞数、讨论 0–50 条且编号唯一）、域名、点赞计算、排序（最新 / 最多赞）、摘要。
 * 校验用 content-kit 的字段表；演示站只收录虚构内容（fictional 必须为 true）。
 */
import { baseSummary, validateWith, type BaseSummary, type Schema } from './content-kit';

export { SLUG_RE, sortItems } from './content-kit';
export type { Issue } from './content-kit';

export interface Item extends BaseSummary {
  fictional: true;
  url: string;
  sharer: string;
  tags: string[];
  note: string[];
  votes: number;
  comments: { id: string; author: string; text: string }[];
}
export interface Summary extends BaseSummary {
  url: string;
  host: string;
  sharer: string;
  tags: string[];
  votes: number;
  comments: number;
}
export const SCHEMA: Schema = {
  url: { k: 'u', label: '链接地址' },
  sharer: { k: 's', label: '推荐人', max: 20 },
  tags: { k: 't', label: '标签', max: 4, len: 12 },
  note: { k: 'p', label: '推荐语', min: 1, max: 4, len: 400 },
  votes: { k: 'i', label: '点赞数', lo: 0, hi: 1000000 },
  comments: { k: 'l', label: '讨论', min: 0, max: 50, of: { id: { k: 's', label: '编号', max: 20 }, author: { k: 's', label: '发言人', max: 20 }, text: { k: 's', label: '内容', max: 400 } } },
};
/** 本机点过赞的链接（地址列表） */
export const UP_KEY = 'ck:bookmarks:up';
/** 显示用域名：去掉 www. */
export function hostOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
export const withUp = (votes: number, up: boolean) => votes + (up ? 1 : 0);
/** 排序：latest 按日期倒序；top 按点赞（含本机一票）从多到少，同票按日期倒序；最后按地址 */
export function sortLinks<T extends { slug: string; date: string; votes: number }>(list: T[], mode: 'latest' | 'top', ups: string[] = []): T[] {
  const v = (t: T) => withUp(t.votes, ups.includes(t.slug));
  return [...list].sort((a, b) => (mode === 'top' && v(a) !== v(b) ? v(b) - v(a) : a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: import('./content-kit').Issue[] } {
  return validateWith<Item>(SCHEMA, input, (it, bad, raw) => {
    if (!it.tags.length) bad('tags', '至少 1 个标签');
    const seen = new Set<string>();
    it.comments.forEach((c, i) => {
      if (seen.has(c.id)) bad(`comments.${i}.id`, '讨论编号不能重复');
      seen.add(c.id);
    });
    void raw;
  });
}
export function summarize(it: Item): Summary {
  return { ...baseSummary(it), url: it.url, host: hostOf(it.url), sharer: it.sharer, tags: it.tags, votes: it.votes, comments: it.comments.length };
}
