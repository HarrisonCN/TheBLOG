/**
 * L53 / v1.53.0 投票与小测验（web = worker 逐字相同，纯函数）：投票 / 测验的字段表（类型 poll / quiz、发起人、题目 1–10 道、每题 2–6 个选项、编号唯一；测验每题恰好一个正确答案，投票不能标正确答案）、计票百分比（含本机一票）、测验得分、摘要。
 * 校验用 content-kit 的字段表；演示站只收录虚构内容（fictional 必须为 true）。
 */
import { baseSummary, validateWith, type BaseSummary, type Schema } from './content-kit';
import { pct } from './content-kit';
export { SLUG_RE, sortItems } from './content-kit';
export type { Issue } from './content-kit';

export interface Item extends BaseSummary {
  fictional: true;
  kind: 'poll' | 'quiz';
  host: string;
  questions: Question[];
}
export interface Summary extends BaseSummary {
  kind: 'poll' | 'quiz';
  host: string;
  questions: number;
  votes: number;
}
export const SCHEMA: Schema = {
  kind: { k: 'e', label: '类型', vals: ['poll', 'quiz'] },
  host: { k: 's', label: '发起人', max: 20 },
  questions: {
    k: 'l',
    label: '题目',
    min: 1,
    max: 10,
    of: {
      id: { k: 's', label: '题号', max: 20 },
      text: { k: 's', label: '题目', max: 200 },
      options: { k: 'l', label: '选项', min: 2, max: 6, of: { id: { k: 's', label: '选项编号', max: 20 }, text: { k: 's', label: '选项', max: 80 }, votes: { k: 'i', label: '票数', lo: 0, hi: 999999 }, correct: { k: 'b', label: '正确答案', opt: true } } },
      explain: { k: 's', label: '解析', max: 300, opt: true },
    },
  },
};
export interface Option {
  id: string;
  text: string;
  votes: number;
  correct?: boolean;
}
export interface Question {
  id: string;
  text: string;
  options: Option[];
  explain?: string;
}
/** 本机记住的选择：{ "slug/题号": 选项编号 } */
export const ANSWER_KEY = 'ck:polls:answers';
export const kindText = (k: Item['kind']) => (k === 'quiz' ? '小测验' : '投票');
/** 计票：示例票数 + 本机一票（mine 为选项编号），百分比四舍五入 */
export function tally(options: Option[], mine?: string): { id: string; text: string; n: number; pct: number }[] {
  const ns = options.map((o) => o.votes + (o.id === mine ? 1 : 0));
  const total = ns.reduce((a, b) => a + b, 0);
  return options.map((o, i) => ({ id: o.id, text: o.text, n: ns[i]!, pct: pct(ns[i]!, total) }));
}
/** 测验得分：answers = { 题号: 选项编号 } */
export function score(qs: Question[], answers: Record<string, string>): { right: number; answered: number; total: number } {
  let right = 0;
  let answered = 0;
  for (const q of qs) {
    const a = answers[q.id];
    if (!a) continue;
    answered++;
    if (q.options.find((o) => o.id === a)?.correct) right++;
  }
  return { right, answered, total: qs.length };
}
export const scoreText = (s: { right: number; total: number }) => `答对 ${s.right} / ${s.total} 题`;

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: import('./content-kit').Issue[] } {
  return validateWith<Item>(SCHEMA, input, (it, bad, raw) => {
    const qids = new Set<string>();
    it.questions.forEach((q, i) => {
      if (qids.has(q.id)) bad(`questions.${i}.id`, '题号不能重复');
      qids.add(q.id);
      const oids = new Set<string>();
      q.options.forEach((o, j) => {
        if (oids.has(o.id)) bad(`questions.${i}.options.${j}.id`, '选项编号不能重复');
        oids.add(o.id);
      });
      const nc = q.options.filter((o) => o.correct).length;
      if (it.kind === 'quiz' && nc !== 1) bad(`questions.${i}.options`, '测验每题必须恰好有一个正确答案');
      if (it.kind === 'poll' && nc) bad(`questions.${i}.options`, '投票不能标正确答案');
    });
    void raw;
  });
}
export function summarize(it: Item): Summary {
  return { ...baseSummary(it), kind: it.kind, host: it.host, questions: it.questions.length, votes: it.questions.reduce((a, q) => a + q.options.reduce((b, o) => b + o.votes, 0), 0) };
}
