/**
 * L63 / v1.63.0 互助交换（web = worker 逐字相同，纯函数）：互助帖的字段表（提供 / 需要、类别、方式：交换 / 免费 / 借用、发布人、大致地区、想换的东西、说明 1–4 段、进行中 / 已完成；交换时必须写想换什么，已完成必须写结果）、类别 / 方式文字、筛选、摘要。
 * 校验用 content-kit 的字段表；演示站只收录虚构内容（fictional 必须为 true）。
 */
import { baseSummary, validateWith, type BaseSummary, type Schema } from './content-kit';

export { SLUG_RE, sortItems } from './content-kit';
export type { Issue } from './content-kit';

export interface Item extends BaseSummary {
  fictional: true;
  kind: 'offer' | 'request';
  cat: Cat;
  method: 'swap' | 'free' | 'borrow';
  owner: string;
  area: string;
  wants?: string;
  body: string[];
  open: boolean;
  result?: string;
  interested: number;
}
export interface Summary extends BaseSummary {
  kind: 'offer' | 'request';
  cat: Cat;
  method: 'swap' | 'free' | 'borrow';
  owner: string;
  area: string;
  open: boolean;
}
export const SCHEMA: Schema = {
  kind: { k: 'e', label: '类型', vals: ['offer', 'request'] },
  cat: { k: 'e', label: '类别', vals: ['book', 'tool', 'skill', 'stuff', 'other'] },
  method: { k: 'e', label: '方式', vals: ['swap', 'free', 'borrow'] },
  owner: { k: 's', label: '发布人', max: 20 },
  area: { k: 's', label: '大致地区', max: 20 },
  wants: { k: 's', label: '想换的东西', max: 60, opt: true },
  body: { k: 'p', label: '说明', min: 1, max: 4, len: 400 },
  open: { k: 'b', label: '进行中' },
  result: { k: 's', label: '结果', max: 120, opt: true },
  interested: { k: 'i', label: '感兴趣人数', lo: 0, hi: 100000 },
};
export type Cat = 'book' | 'tool' | 'skill' | 'stuff' | 'other';
export const KINDS = { offer: '我能提供', request: '我需要' } as const;
export const CATS: Record<Cat, string> = { book: '书籍', tool: '工具', skill: '技能', stuff: '闲置物品', other: '其他' };
export const METHODS = { swap: '交换', free: '免费送', borrow: '借用' } as const;
/** 本机记住「我感兴趣」的帖子 */
export const INTEREST_KEY = 'ck:swap:interested';
export interface Filter {
  kind: 'all' | 'offer' | 'request';
  cat: 'all' | Cat;
  openOnly: boolean;
}
export const matches = (s: Pick<Summary, 'kind' | 'cat' | 'open'>, f: Filter) => (f.kind === 'all' || s.kind === f.kind) && (f.cat === 'all' || s.cat === f.cat) && (!f.openOnly || s.open);
export const headline = (s: Pick<Summary, 'kind' | 'cat' | 'method'>) => `${KINDS[s.kind]} · ${CATS[s.cat]} · ${METHODS[s.method]}`;

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: import('./content-kit').Issue[] } {
  return validateWith<Item>(SCHEMA, input, (it, bad, raw) => {
    if (it.method === 'swap' && !it.wants) bad('wants', '交换要写想换什么');
    if (!it.open && !it.result) bad('result', '已完成的帖子要写结果');
    if (it.open && it.result) bad('result', '进行中的帖子还没有结果');
    void raw;
  });
}
export function summarize(it: Item): Summary {
  return { ...baseSummary(it), kind: it.kind, cat: it.cat, method: it.method, owner: it.owner, area: it.area, open: it.open };
}
