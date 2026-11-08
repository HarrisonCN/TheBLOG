/**
 * L51 / v1.51.0 兴趣圈子（web = worker 逐字相同，纯函数）：兴趣圈子的字段表（话题标签、成员数、守则 1–6 段、圈主 1–4 位、帖子 0–50 条且编号唯一）、成员数文字、帖子按时间倒序、摘要。
 * 校验用 content-kit 的字段表；演示站只收录虚构内容（fictional 必须为 true）。
 */
import { baseSummary, validateWith, type BaseSummary, type Schema } from './content-kit';

export { SLUG_RE, sortItems } from './content-kit';
export type { Issue } from './content-kit';

export interface Item extends BaseSummary {
  fictional: true;
  tags: string[];
  members: number;
  rules: string[];
  hosts: { name: string; role: string }[];
  posts: Post[];
}
export interface Summary extends BaseSummary {
  tags: string[];
  members: number;
  posts: number;
  lastPost: string | null;
}
export const SCHEMA: Schema = {
  tags: { k: 't', label: '话题标签', max: 6, len: 12 },
  members: { k: 'i', label: '成员数', lo: 0, hi: 100000 },
  rules: { k: 'p', label: '圈子守则', min: 1, max: 6, len: 200 },
  hosts: { k: 'l', label: '圈主', min: 1, max: 4, of: { name: { k: 's', label: '昵称', max: 20 }, role: { k: 's', label: '角色', max: 20 } } },
  posts: {
    k: 'l',
    label: '帖子',
    min: 0,
    max: 50,
    of: { id: { k: 's', label: '编号', max: 20 }, author: { k: 's', label: '作者', max: 20 }, date: { k: 'd', label: '发帖日期' }, text: { k: 's', label: '内容', max: 500 }, replies: { k: 'i', label: '回复数', lo: 0, hi: 9999 } },
  },
};
export interface Post {
  id: string;
  author: string;
  date: string;
  text: string;
  replies: number;
}
/** 本机记住「已加入」的圈子（localStorage 键） */
export const JOIN_KEY = 'ck:circles:joined';
/** 「128 位成员」；本机已加入时 +1（示例成员数不含你） */
export const memberText = (n: number, joined = false) => `${n + (joined ? 1 : 0)} 位成员`;
/** 帖子按日期倒序，同一天按编号 */
export const latestPosts = (posts: Post[]): Post[] => [...posts].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: import('./content-kit').Issue[] } {
  return validateWith<Item>(SCHEMA, input, (it, bad) => {
    const seen = new Set<string>();
    it.posts.forEach((p, i) => {
      if (seen.has(p.id)) bad(`posts.${i}.id`, '帖子编号不能重复');
      seen.add(p.id);
    });
  });
}
export function summarize(it: Item): Summary {
  return { ...baseSummary(it), tags: it.tags, members: it.members, posts: it.posts.length, lastPost: latestPosts(it.posts)[0]?.date ?? null };
}
