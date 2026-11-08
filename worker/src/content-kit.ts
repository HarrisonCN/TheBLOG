/**
 * L51+ 内容栏目共享校验工具（web = worker 逐字相同，纯函数，没有副作用）：
 * 用一张字段表（schema）校验整份 JSON，给出中文问题列表；所有 1.51 起的社区 / 专题栏目共用，
 * 每个栏目只写自己的字段表和少量跨字段规则。演示站只收录虚构内容：fictional 必须为 true。
 */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const SAFE_URL = /^https:\/\/[^\s"'<>]+$/;

export interface Issue {
  path: string;
  message: string;
}
export type Field =
  | { k: 's'; label: string; max: number; opt?: true }
  | { k: 'p'; label: string; min: number; max: number; len: number }
  | { k: 'i'; label: string; lo: number; hi: number; opt?: true }
  | { k: 'e'; label: string; vals: readonly string[]; opt?: true }
  | { k: 'd'; label: string; opt?: true }
  | { k: 'dt'; label: string; opt?: true }
  | { k: 'u'; label: string; opt?: true }
  | { k: 'b'; label: string; opt?: true }
  | { k: 't'; label: string; max: number; len: number; opt?: true }
  | { k: 'l'; label: string; min: number; max: number; of: Schema };
export type Schema = Record<string, Field>;
type Bad = (path: string, message: string) => void;

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);

function one(f: Field, v: unknown, p: string, bad: Bad): unknown {
  switch (f.k) {
    case 's':
      return str(v, f.max) ?? bad(p, `${f.label}必填（≤ ${f.max} 字）`);
    case 'p': {
      if (!Array.isArray(v) || v.length < f.min || v.length > f.max) return bad(p, `${f.label} ${f.min}–${f.max} 段`);
      const out: string[] = [];
      v.forEach((t, i) => {
        const s = str(t, f.len);
        if (s) out.push(s);
        else bad(`${p}.${i}`, `每段 1–${f.len} 字`);
      });
      return out;
    }
    case 'i':
      return Number.isInteger(v) && (v as number) >= f.lo && (v as number) <= f.hi ? v : bad(p, `${f.label}必须是 ${f.lo}–${f.hi} 的整数`);
    case 'e':
      return typeof v === 'string' && f.vals.includes(v) ? v : bad(p, `${f.label}只能是 ${f.vals.join(' / ')}`);
    case 'd':
      return typeof v === 'string' && DATE_RE.test(v) ? v : bad(p, `${f.label}格式 YYYY-MM-DD`);
    case 'dt':
      return typeof v === 'string' && DT_RE.test(v) ? v : bad(p, `${f.label}格式 YYYY-MM-DDTHH:MM`);
    case 'u':
      return typeof v === 'string' && v.length <= 300 && SAFE_URL.test(v) ? v : bad(p, `${f.label}必须是 https:// 地址`);
    case 'b':
      return typeof v === 'boolean' ? v : bad(p, `${f.label}只能是 true / false`);
    case 't': {
      if (!Array.isArray(v) || v.length > f.max) return bad(p, `${f.label}最多 ${f.max} 个`);
      const out: string[] = [];
      for (const [i, t] of v.entries()) {
        const s = str(t, f.len);
        if (!s) return bad(`${p}.${i}`, `${f.label}每个 1–${f.len} 字`);
        if (!out.includes(s)) out.push(s);
      }
      return out;
    }
    case 'l': {
      if (!Array.isArray(v) || v.length < f.min || v.length > f.max) return bad(p, `${f.label} ${f.min}–${f.max} 项`);
      return v.map((x, i) => obj(f.of, x, `${p}.${i}`, bad));
    }
  }
}

/** 按字段表校验一个对象；可选字段缺省时不写入结果。 */
export function obj(schema: Schema, input: unknown, path: string, bad: Bad): Record<string, unknown> {
  const o = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(schema)) {
    const p = path ? `${path}.${k}` : k;
    if (o[k] === undefined && 'opt' in f && f.opt) continue;
    const v = one(f, o[k], p, bad);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** 所有栏目共有的字段：地址、标题、一句话简介、虚构声明、日期、状态（published / draft）。 */
export const BASE: Schema = {
  slug: { k: 's', label: '地址', max: 60 },
  title: { k: 's', label: '标题', max: 60 },
  summary: { k: 's', label: '简介', max: 160 },
};

export function validateWith<T>(schema: Schema, input: unknown, extra?: (item: T, bad: Bad) => void): { item?: T; issues: Issue[] } {
  const issues: Issue[] = [];
  const bad: Bad = (path, message) => void issues.push({ path, message });
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out = obj({ ...BASE, ...schema }, o, '', bad);
  if (typeof out.slug === 'string' && !SLUG_RE.test(out.slug)) bad('slug', '地址只能用小写字母、数字和连字符');
  if (o.fictional !== true) bad('fictional', '演示站只收录虚构内容：fictional 必须为 true');
  if (typeof o.date !== 'string' || !DATE_RE.test(o.date)) bad('date', '日期格式 YYYY-MM-DD');
  if (o.status !== 'published' && o.status !== 'draft') bad('status', '状态只能是 published / draft');
  if (issues.length) return { issues };
  const item = { ...out, fictional: true, date: o.date, status: o.status } as T;
  extra?.(item, bad);
  return issues.length ? { issues } : { item, issues };
}

export interface BaseSummary {
  slug: string;
  title: string;
  summary: string;
  date: string;
  status: 'published' | 'draft';
}
export const baseSummary = (it: BaseSummary): BaseSummary => ({ slug: it.slug, title: it.title, summary: it.summary, date: it.date, status: it.status });

export function sortItems<T extends { date: string; slug: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}
/** 百分比（整数，四舍五入；总数为 0 时 0） */
export const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
