/**
 * L54 / v1.54.0 关注与动态流（web = worker 逐字相同，纯函数）：成员动态的字段表（昵称、简介、兴趣、关注者数、动态 1–40 条且编号唯一、时间 YYYY-MM-DDTHH:MM、类型）、动态类型文字、多人动态合并成时间线、关注者文字、摘要（含最近 5 条）。
 * 校验用 content-kit 的字段表；演示站只收录虚构内容（fictional 必须为 true）。
 */
import { baseSummary, validateWith, type BaseSummary, type Schema } from './content-kit';

export { SLUG_RE, sortItems } from './content-kit';
export type { Issue } from './content-kit';

export interface Item extends BaseSummary {
  fictional: true;
  member: string;
  bio: string;
  interests: string[];
  followers: number;
  entries: Entry[];
}
export interface Summary extends BaseSummary {
  member: string;
  followers: number;
  entries: number;
  recent: Entry[];
}
export const SCHEMA: Schema = {
  member: { k: 's', label: '昵称', max: 20 },
  bio: { k: 's', label: '个人简介', max: 160 },
  interests: { k: 't', label: '兴趣', max: 6, len: 12 },
  followers: { k: 'i', label: '关注者数', lo: 0, hi: 1000000 },
  entries: {
    k: 'l',
    label: '动态',
    min: 1,
    max: 40,
    of: { id: { k: 's', label: '编号', max: 20 }, at: { k: 'dt', label: '时间' }, verb: { k: 'e', label: '类型', vals: ['post', 'join', 'answer', 'vote', 'read', 'share'] }, text: { k: 's', label: '内容', max: 200 } },
  },
};
export interface Entry {
  id: string;
  at: string;
  verb: 'post' | 'join' | 'answer' | 'vote' | 'read' | 'share';
  text: string;
}
/** 本机记住的关注列表（成员地址） */
export const FOLLOW_KEY = 'ck:activity:following';
export const VERBS: Record<Entry['verb'], string> = { post: '发帖', join: '加入圈子', answer: '回答', vote: '投票', read: '读完', share: '分享' };
export const verbText = (v: Entry['verb']) => VERBS[v];
/** 「2026-11-06 21:30」 */
export const atText = (at: string) => at.replace('T', ' ');
export const byTime = (list: Entry[]): Entry[] => [...list].sort((a, b) => (a.at !== b.at ? (a.at < b.at ? 1 : -1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
/** 多个成员的动态合并成一条时间线（时间倒序，同一时间按成员地址、编号），最多 limit 条 */
export function mergeFeed(list: { slug: string; member: string; recent: Entry[] }[], limit = 20): { slug: string; member: string; entry: Entry }[] {
  return list
    .flatMap((s) => s.recent.map((entry) => ({ slug: s.slug, member: s.member, entry })))
    .sort((a, b) => (a.entry.at !== b.entry.at ? (a.entry.at < b.entry.at ? 1 : -1) : a.slug !== b.slug ? (a.slug < b.slug ? -1 : 1) : a.entry.id < b.entry.id ? -1 : 1))
    .slice(0, limit);
}
/** 「86 位关注者」；本机已关注时 +1 */
export const followerText = (n: number, following = false) => `${n + (following ? 1 : 0)} 位关注者`;

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: import('./content-kit').Issue[] } {
  return validateWith<Item>(SCHEMA, input, (it, bad, raw) => {
    const seen = new Set<string>();
    it.entries.forEach((x, i) => {
      if (seen.has(x.id)) bad(`entries.${i}.id`, '动态编号不能重复');
      seen.add(x.id);
    });
    void raw;
  });
}
export function summarize(it: Item): Summary {
  return { ...baseSummary(it), member: it.member, followers: it.followers, entries: it.entries.length, recent: byTime(it.entries).slice(0, 5) };
}
