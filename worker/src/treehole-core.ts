/**
 * L62 / v1.62.0 树洞（web = worker 逐字相同，纯函数）：树洞纸条的字段表（心情、正文 1–3 段、抱抱数、匿名回应 0–30 条且编号唯一；没有任何作者字段）、隐私审核规则（不允许手机号 / 长数字、邮箱、网址、@账号）、心情文字、摘要。
 * 校验用 content-kit 的字段表；演示站只收录虚构内容（fictional 必须为 true）。
 */
import { baseSummary, validateWith, type BaseSummary, type Schema } from './content-kit';

export { SLUG_RE, sortItems } from './content-kit';
export type { Issue } from './content-kit';

export interface Item extends BaseSummary {
  fictional: true;
  mood: Mood;
  body: string[];
  hugs: number;
  replies: { id: string; text: string }[];
}
export interface Summary extends BaseSummary {
  mood: Mood;
  hugs: number;
  replies: number;
}
export const SCHEMA: Schema = {
  mood: { k: 'e', label: '心情', vals: ['calm', 'happy', 'tired', 'worried', 'grateful'] },
  body: { k: 'p', label: '正文', min: 1, max: 3, len: 300 },
  hugs: { k: 'i', label: '抱抱数', lo: 0, hi: 1000000 },
  replies: { k: 'l', label: '匿名回应', min: 0, max: 30, of: { id: { k: 's', label: '编号', max: 20 }, text: { k: 's', label: '回应', max: 200 } } },
};
export type Mood = 'calm' | 'happy' | 'tired' | 'worried' | 'grateful';
export const MOODS: Record<Mood, string> = { calm: '平静', happy: '开心', tired: '有点累', worried: '担心', grateful: '感激' };
/** 本机保存：待审核的纸条（数组）与抱过的纸条（地址列表） */
export const MINE_KEY = 'ck:treehole:mine';
export const HUG_KEY = 'ck:treehole:hugs';
const RULES: [RegExp, string][] = [
  [/\d[\d\s-]{6,}\d/, '不要留手机号或长串数字'],
  [/[\w.+-]+@[\w-]+\.[\w.]+/, '不要留邮箱'],
  [/https?:\/\/|www\.|(^|[^@\w.])[a-z0-9-]+\.(com|cn|net|org)\b/i, '不要放网址'],
  [/(^|\s)@[\w\u4e00-\u9fa5]{2,}/, '不要 @ 任何人'],
];
/** 隐私审核：返回所有不通过的原因（去重）；空数组 = 通过 */
export function moderate(text: string): string[] {
  const out: string[] = [];
  for (const [re, why] of RULES) if (re.test(text) && !out.includes(why)) out.push(why);
  return out;
}
export const MAX_NOTE = 300;
/** 写纸条的检查：长度 + 隐私审核 */
export function checkNote(text: string): string[] {
  const t = text.trim();
  if (!t) return ['先写点什么'];
  if (t.length > MAX_NOTE) return [`最多 ${MAX_NOTE} 字（现在 ${t.length} 字）`];
  return moderate(t);
}

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: import('./content-kit').Issue[] } {
  return validateWith<Item>(SCHEMA, input, (it, bad, raw) => {
    it.body.forEach((p, i) => {
      const why = moderate(p);
      if (why.length) bad(`body.${i}`, `隐私审核不通过：${why.join('、')}`);
    });
    const seen = new Set<string>();
    it.replies.forEach((r, i) => {
      if (seen.has(r.id)) bad(`replies.${i}.id`, '回应编号不能重复');
      seen.add(r.id);
      const why = moderate(r.text);
      if (why.length) bad(`replies.${i}.text`, `隐私审核不通过：${why.join('、')}`);
    });
    if ('author' in raw) bad('author', '树洞不能有作者字段');
    void raw;
  });
}
export function summarize(it: Item): Summary {
  return { ...baseSummary(it), mood: it.mood, hugs: it.hugs, replies: it.replies.length };
}
