/**
 * L52 / v1.52.0 问答区（web = worker 逐字相同，纯函数）：问答的字段表（提问者、标签、问题正文 1–8 段、回答 0–30 条且编号唯一、采纳的回答必须存在）、回答排序（采纳优先，再按票数、时间）、状态文字、摘要。
 * 校验用 content-kit 的字段表；演示站只收录虚构内容（fictional 必须为 true）。
 */
import { baseSummary, validateWith, type BaseSummary, type Schema } from './content-kit';

export { SLUG_RE, sortItems } from './content-kit';
export type { Issue } from './content-kit';

export interface Item extends BaseSummary {
  fictional: true;
  asker: string;
  tags: string[];
  body: string[];
  answers: Answer[];
  accepted?: string;
}
export interface Summary extends BaseSummary {
  asker: string;
  tags: string[];
  answers: number;
  solved: boolean;
}
export const SCHEMA: Schema = {
  asker: { k: 's', label: '提问者', max: 20 },
  tags: { k: 't', label: '标签', max: 5, len: 12 },
  body: { k: 'p', label: '问题正文', min: 1, max: 8, len: 800 },
  answers: {
    k: 'l',
    label: '回答',
    min: 0,
    max: 30,
    of: { id: { k: 's', label: '编号', max: 20 }, author: { k: 's', label: '回答者', max: 20 }, date: { k: 'd', label: '回答日期' }, text: { k: 's', label: '回答内容', max: 1500 }, votes: { k: 'i', label: '票数', lo: -999, hi: 99999 } },
  },
  accepted: { k: 's', label: '采纳的回答', max: 20, opt: true },
};
export interface Answer {
  id: string;
  author: string;
  date: string;
  text: string;
  votes: number;
}
/** 本机记住的投票：{ "slug/answerId": 1 | -1 } */
export const VOTE_KEY = 'ck:qa:votes';
/** 采纳的回答在最前；其余按票数从高到低，同票按日期从早到晚，再按编号 */
export function rankAnswers(answers: Answer[], accepted?: string): Answer[] {
  return [...answers].sort((a, b) => {
    if ((a.id === accepted) !== (b.id === accepted)) return a.id === accepted ? -1 : 1;
    if (a.votes !== b.votes) return b.votes - a.votes;
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
/** 「已解决」/「3 个回答」/「待回答」 */
export const stateText = (answers: number, solved: boolean) => (solved ? '已解决' : answers ? `${answers} 个回答` : '待回答');
/** 本机一票（1 / -1 / 0）加到示例票数上 */
export const withMyVote = (votes: number, mine: number) => votes + (mine === 1 ? 1 : mine === -1 ? -1 : 0);
/** 再点同一个按钮 = 取消；点另一个 = 改票 */
export const nextVote = (cur: number, press: 1 | -1): number => (cur === press ? 0 : press);

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: import('./content-kit').Issue[] } {
  return validateWith<Item>(SCHEMA, input, (it, bad, raw) => {
    const seen = new Set<string>();
    it.answers.forEach((a, i) => {
      if (seen.has(a.id)) bad(`answers.${i}.id`, '回答编号不能重复');
      seen.add(a.id);
    });
    if (it.accepted !== undefined && !seen.has(it.accepted)) bad('accepted', '采纳的回答不存在');
    void raw;
  });
}
export function summarize(it: Item): Summary {
  return { ...baseSummary(it), asker: it.asker, tags: it.tags, answers: it.answers.length, solved: it.accepted !== undefined };
}
