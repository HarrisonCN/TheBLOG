/**
 * L64 / v1.64.0 生活专栏（web = worker 逐字相同，纯函数）：生活专栏的字段表（类型：菜谱 / 游记；菜谱必须有份数、用时、食材（数量 + 单位）和步骤，游记必须有地点、天数和按天的行程且天数不超出）、用量换算、行程分组、用时文字、摘要。
 * 校验用 content-kit 的字段表；演示站只收录虚构内容（fictional 必须为 true）。
 */
import { baseSummary, validateWith, type BaseSummary, type Schema } from './content-kit';

export { SLUG_RE, sortItems } from './content-kit';
export type { Issue } from './content-kit';

export interface Item extends BaseSummary {
  fictional: true;
  kind: 'recipe' | 'travel';
  author: string;
  tags: string[];
  intro: string[];
  servings?: number;
  minutes?: number;
  ingredients?: Ingredient[];
  steps?: string[];
  place?: string;
  days?: number;
  stops?: Stop[];
}
export interface Summary extends BaseSummary {
  kind: 'recipe' | 'travel';
  author: string;
  tags: string[];
  servings: number | null;
  minutes: number | null;
  place: string | null;
  days: number | null;
}
export const SCHEMA: Schema = {
  kind: { k: 'e', label: '类型', vals: ['recipe', 'travel'] },
  author: { k: 's', label: '作者', max: 20 },
  tags: { k: 't', label: '标签', max: 5, len: 12 },
  intro: { k: 'p', label: '导语', min: 1, max: 4, len: 400 },
  servings: { k: 'i', label: '份数', lo: 1, hi: 20, opt: true },
  minutes: { k: 'i', label: '用时（分钟）', lo: 1, hi: 1440, opt: true },
  ingredients: { k: 'l', label: '食材', min: 1, max: 30, opt: true, of: { name: { k: 's', label: '食材', max: 20 }, amount: { k: 'i', label: '数量', lo: 0, hi: 100000 }, unit: { k: 's', label: '单位', max: 6 } } },
  steps: { k: 'p', label: '步骤', min: 1, max: 20, len: 300, opt: true },
  place: { k: 's', label: '地点', max: 30, opt: true },
  days: { k: 'i', label: '天数', lo: 1, hi: 30, opt: true },
  stops: { k: 'l', label: '行程', min: 1, max: 60, opt: true, of: { day: { k: 'i', label: '第几天', lo: 1, hi: 30 }, name: { k: 's', label: '地点', max: 30 }, note: { k: 's', label: '说明', max: 200 } } },
};
export interface Ingredient {
  name: string;
  amount: number;
  unit: string;
}
export interface Stop {
  day: number;
  name: string;
  note: string;
}
/** 本机记住勾过的步骤：{ slug: [步骤序号] } */
export const STEPS_KEY = 'ck:life:steps';
/** 数量为 0 表示「适量」 */
export function scaleAmount(amount: number, from: number, to: number): string {
  if (amount === 0) return '适量';
  const v = Math.round(((amount * to) / from) * 10) / 10;
  return String(v);
}
export const amountText = (i: Ingredient, from: number, to: number) => (i.amount === 0 ? `适量` : `${scaleAmount(i.amount, from, to)} ${i.unit}`);
/** 「1 小时 15 分钟」/「40 分钟」 */
export const minutesText = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分钟` : ''}` : `${m} 分钟`);
/** 行程按天分组（天数从 1 到 days，没有安排的天给空数组） */
export function byDay(stops: Stop[], days: number): { day: number; stops: Stop[] }[] {
  return Array.from({ length: days }, (_, i) => ({ day: i + 1, stops: stops.filter((s) => s.day === i + 1) }));
}

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: import('./content-kit').Issue[] } {
  return validateWith<Item>(SCHEMA, input, (it, bad, raw) => {
    if (it.kind === 'recipe') {
      for (const k of ['servings', 'minutes', 'ingredients', 'steps'] as const) if (it[k] === undefined) bad(k, '菜谱必须有份数、用时、食材和步骤');
      for (const k of ['place', 'days', 'stops'] as const) if (it[k] !== undefined) bad(k, '菜谱不能有游记字段');
    } else {
      for (const k of ['place', 'days', 'stops'] as const) if (it[k] === undefined) bad(k, '游记必须有地点、天数和行程');
      for (const k of ['servings', 'minutes', 'ingredients', 'steps'] as const) if (it[k] !== undefined) bad(k, '游记不能有菜谱字段');
      it.stops?.forEach((s, i) => {
        if (it.days !== undefined && s.day > it.days) bad(`stops.${i}.day`, '行程的天数超出了总天数');
      });
    }
    void raw;
  });
}
export function summarize(it: Item): Summary {
  return { ...baseSummary(it), kind: it.kind, author: it.author, tags: it.tags, servings: it.servings ?? null, minutes: it.minutes ?? null, place: it.place ?? null, days: it.days ?? null };
}
