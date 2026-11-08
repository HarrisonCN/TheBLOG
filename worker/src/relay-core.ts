/**
 * L55 / v1.55.0 接龙写作（web = worker 逐字相同，纯函数）：接龙故事的字段表（发起人、开头提示、段数上限 3–50、段落 1–50 段且序号从 1 起连续、同一作者不能连续两段、不超过上限）、进度文字、下一段能不能写、续写校验、摘要。
 * 校验用 content-kit 的字段表；演示站只收录虚构内容（fictional 必须为 true）。
 */
import { baseSummary, validateWith, type BaseSummary, type Schema } from './content-kit';

export { SLUG_RE, sortItems } from './content-kit';
export type { Issue } from './content-kit';

export interface Item extends BaseSummary {
  fictional: true;
  starter: string;
  prompt: string;
  maxTurns: number;
  paragraphs: Para[];
}
export interface Summary extends BaseSummary {
  starter: string;
  turns: number;
  maxTurns: number;
  done: boolean;
}
export const SCHEMA: Schema = {
  starter: { k: 's', label: '发起人', max: 20 },
  prompt: { k: 's', label: '开头提示', max: 200 },
  maxTurns: { k: 'i', label: '段数上限', lo: 3, hi: 50 },
  paragraphs: { k: 'l', label: '段落', min: 1, max: 50, of: { n: { k: 'i', label: '序号', lo: 1, hi: 50 }, author: { k: 's', label: '作者', max: 20 }, text: { k: 's', label: '段落', max: 300 } } },
};
export interface Para {
  n: number;
  author: string;
  text: string;
}
/** 本机保存的续写草稿：{ slug: { author, text } } */
export const DRAFT_KEY = 'ck:relay:drafts';
export const MAX_PARA = 300;
export const progressText = (turns: number, max: number) => `第 ${turns} / ${max} 段`;
export const isDone = (it: Pick<Item, 'paragraphs' | 'maxTurns'>) => it.paragraphs.length >= it.maxTurns;
/** 续写校验：返回问题文字，没问题返回 null */
export function checkTurn(it: Pick<Item, 'paragraphs' | 'maxTurns'>, author: string, text: string): string | null {
  if (isDone(it)) return '这个接龙已经写满了。';
  const a = author.trim();
  const t = text.trim();
  if (!a || a.length > 20) return '请填写 1–20 字的昵称。';
  if (!t) return '先写点什么再续写。';
  if (t.length > MAX_PARA) return `一段最多 ${MAX_PARA} 字（现在 ${t.length} 字）。`;
  if (it.paragraphs[it.paragraphs.length - 1]?.author === a) return '同一个人不能连续写两段，等别人接一段吧。';
  return null;
}
export const countText = (n: number) => `${n} / ${MAX_PARA} 字`;

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: import('./content-kit').Issue[] } {
  return validateWith<Item>(SCHEMA, input, (it, bad, raw) => {
    it.paragraphs.forEach((p, i) => {
      if (p.n !== i + 1) bad(`paragraphs.${i}.n`, `序号必须从 1 起连续（这里应为 ${i + 1}）`);
      else if (i > 0 && it.paragraphs[i - 1]!.author === p.author) bad(`paragraphs.${i}.author`, '同一作者不能连续写两段');
    });
    if (it.paragraphs.length > it.maxTurns) bad('paragraphs', '段落数超过了段数上限');
    void raw;
  });
}
export function summarize(it: Item): Summary {
  return { ...baseSummary(it), starter: it.starter, turns: it.paragraphs.length, maxTurns: it.maxTurns, done: isDone(it) };
}
