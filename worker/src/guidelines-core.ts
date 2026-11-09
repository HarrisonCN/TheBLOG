/**
 * L65 / v1.65.0 社区守则与治理（web = worker 逐字相同，纯函数）：守则的字段表（章节号 1–20、条文 1–12 条且编号唯一、处理方式 1–4 段、每月治理记录：月份 YYYY-MM 不重复，删除 + 警告 + 驳回不超过举报数）、举报检查（站内地址、理由、说明）、按月汇总的治理看板、摘要。
 * 校验用 content-kit 的字段表；演示站只收录虚构内容（fictional 必须为 true）。
 */
import { baseSummary, validateWith, type BaseSummary, type Schema } from './content-kit';
import { pct } from './content-kit';
export { SLUG_RE, sortItems } from './content-kit';
export type { Issue } from './content-kit';

export interface Item extends BaseSummary {
  fictional: true;
  chapter: number;
  rules: { id: string; text: string; example?: string }[];
  actions: string[];
  log: LogRow[];
}
export interface Summary extends BaseSummary {
  chapter: number;
  rules: number;
  log: LogRow[];
}
export const SCHEMA: Schema = {
  chapter: { k: 'i', label: '章节号', lo: 1, hi: 20 },
  rules: { k: 'l', label: '条文', min: 1, max: 12, of: { id: { k: 's', label: '编号', max: 10 }, text: { k: 's', label: '条文', max: 200 }, example: { k: 's', label: '示例', max: 200, opt: true } } },
  actions: { k: 'p', label: '处理方式', min: 1, max: 4, len: 300 },
  log: {
    k: 'l',
    label: '治理记录',
    min: 0,
    max: 36,
    of: { month: { k: 's', label: '月份', max: 7 }, reports: { k: 'i', label: '举报数', lo: 0, hi: 1000000 }, removed: { k: 'i', label: '删除', lo: 0, hi: 1000000 }, warned: { k: 'i', label: '警告', lo: 0, hi: 1000000 }, dismissed: { k: 'i', label: '驳回', lo: 0, hi: 1000000 } },
  },
};
export interface LogRow {
  month: string;
  reports: number;
  removed: number;
  warned: number;
  dismissed: number;
}
export const REASONS = { spam: '垃圾广告', harass: '骚扰或人身攻击', privacy: '泄露他人隐私', illegal: '违法违规内容', other: '其他' } as const;
export type Reason = keyof typeof REASONS;
/** 本机保存的举报回执 */
export const REPORT_KEY = 'ck:guidelines:reports';
/** 举报检查：站内地址（以 / 开头、不是 //）、理由、说明（选「其他」时必填，≤ 300 字）；返回问题列表 */
export function checkReport(r: { target: string; reason: string; details: string }): string[] {
  const out: string[] = [];
  const t = r.target.trim();
  if (!/^\/(?!\/)[^\s"'<>]{0,200}$/.test(t)) out.push('请填写站内页面地址（以 / 开头，例如 /threads/desk-setup/）');
  if (!(r.reason in REASONS)) out.push('请选择举报理由');
  const d = r.details.trim();
  if (d.length > 300) out.push(`说明最多 300 字（现在 ${d.length} 字）`);
  if (r.reason === 'other' && !d) out.push('选择「其他」时请写明原因');
  return out;
}
/** 治理看板：把各章节的月度记录按月份汇总（月份倒序），handled = 删除 + 警告 + 驳回 */
export function dashboard(list: { log: LogRow[] }[]): (LogRow & { handled: number; rate: number })[] {
  const m = new Map<string, LogRow>();
  for (const s of list)
    for (const r of s.log) {
      const a = m.get(r.month) ?? { month: r.month, reports: 0, removed: 0, warned: 0, dismissed: 0 };
      m.set(r.month, { month: r.month, reports: a.reports + r.reports, removed: a.removed + r.removed, warned: a.warned + r.warned, dismissed: a.dismissed + r.dismissed });
    }
  return [...m.values()].sort((a, b) => (a.month < b.month ? 1 : -1)).map((r) => {
    const handled = r.removed + r.warned + r.dismissed;
    return { ...r, handled, rate: pct(handled, r.reports) };
  });
}

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: import('./content-kit').Issue[] } {
  return validateWith<Item>(SCHEMA, input, (it, bad, raw) => {
    const ids = new Set<string>();
    it.rules.forEach((r, i) => {
      if (ids.has(r.id)) bad(`rules.${i}.id`, '条文编号不能重复');
      ids.add(r.id);
    });
    const months = new Set<string>();
    it.log.forEach((r, i) => {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month)) bad(`log.${i}.month`, '月份格式 YYYY-MM');
      else if (months.has(r.month)) bad(`log.${i}.month`, '同一个月只能有一条记录');
      months.add(r.month);
      if (r.removed + r.warned + r.dismissed > r.reports) bad(`log.${i}`, '处理数（删除 + 警告 + 驳回）不能超过举报数');
    });
    void raw;
  });
}
export function summarize(it: Item): Summary {
  return { ...baseSummary(it), chapter: it.chapter, rules: it.rules.length, log: it.log };
}
