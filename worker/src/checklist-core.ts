/**
 * L38 / v1.38.0 拍摄清单（web = worker 逐字相同，纯函数）：
 * 清单校验（1–8 组、每组 1–20 项、全部最多 80 项、条目编号在整份清单里唯一）、摘要与排序、
 * 本地勾选进度（只存在浏览器 localStorage，读回时丢掉未知编号和坏数据）、进度文字。
 */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const KINDS = ['landscape', 'street', 'portrait', 'night', 'event', 'travel'] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_LABEL: Record<Kind, string> = { landscape: '风光', street: '扫街', portrait: '人像', night: '夜景', event: '活动纪实', travel: '旅行' };
export const MAX_GROUPS = 8;
export const MAX_PER_GROUP = 20;
export const MAX_ITEMS = 80;

export interface Entry {
  id: string;
  label: string;
  note?: string;
}
export interface Group {
  title: string;
  items: Entry[];
}
export interface Item {
  slug: string;
  title: string;
  summary: string;
  kind: Kind;
  groups: Group[];
  date: string;
  status: 'published' | 'draft';
}
export interface Summary {
  slug: string;
  title: string;
  summary: string;
  kind: Kind;
  date: string;
  status: Item['status'];
  groups: number;
  items: number;
}
export interface Issue {
  path: string;
  message: string;
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: Issue[] } {
  const issues: Issue[] = [];
  const bad = (path: string, message: string) => issues.push({ path, message });
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const slug = typeof o.slug === 'string' && SLUG_RE.test(o.slug) ? o.slug : (bad('slug', '地址只能用小写字母、数字和连字符'), '');
  const title = str(o.title, 60) ?? (bad('title', '标题必填（≤ 60 字）'), '');
  const summary = str(o.summary, 200) ?? (bad('summary', '简介必填（≤ 200 字）'), '');
  const kind = KINDS.includes(o.kind as Kind) ? (o.kind as Kind) : (bad('kind', '拍摄类型不正确'), 'landscape');
  const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : (bad('date', '日期格式 YYYY-MM-DD'), '');
  const status = o.status === 'draft' ? 'draft' : o.status === 'published' ? 'published' : (bad('status', '状态只能是 published / draft'), 'draft');
  const groups: Group[] = [];
  const seen = new Set<string>();
  let total = 0;
  if (!Array.isArray(o.groups) || o.groups.length < 1 || o.groups.length > MAX_GROUPS) bad('groups', `分组 1–${MAX_GROUPS} 个`);
  else
    o.groups.forEach((g, gi) => {
      const x = (g && typeof g === 'object' ? g : {}) as Record<string, unknown>;
      const gt = str(x.title, 40);
      if (!gt) bad(`groups.${gi}.title`, '分组名称必填（≤ 40 字）');
      const items: Entry[] = [];
      if (!Array.isArray(x.items) || x.items.length < 1 || x.items.length > MAX_PER_GROUP) return void bad(`groups.${gi}.items`, `每组 1–${MAX_PER_GROUP} 项`);
      x.items.forEach((it, ii) => {
        const y = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
        const p = `groups.${gi}.items.${ii}`;
        const id = typeof y.id === 'string' && ID_RE.test(y.id) ? y.id : null;
        const label = str(y.label, 80);
        const note = y.note === undefined || y.note === '' ? undefined : str(y.note, 200);
        if (!id) return void bad(`${p}.id`, '条目编号只能用小写字母、数字和连字符');
        if (seen.has(id)) return void bad(`${p}.id`, `条目编号「${id}」重复`);
        seen.add(id);
        if (!label) return void bad(`${p}.label`, '条目内容必填（≤ 80 字）');
        if (note === null) return void bad(`${p}.note`, '备注 ≤ 200 字');
        items.push({ id, label, ...(note ? { note } : {}) });
      });
      total += items.length;
      if (gt) groups.push({ title: gt, items });
    });
  if (total > MAX_ITEMS) bad('groups', `整份清单最多 ${MAX_ITEMS} 项`);
  if (issues.length) return { issues };
  return { item: { slug, title, summary, kind, groups, date, status: status as Item['status'] }, issues };
}

export const allIds = (c: Pick<Item, 'groups'>) => c.groups.flatMap((g) => g.items.map((i) => i.id));

export function summarize(c: Item): Summary {
  return { slug: c.slug, title: c.title, summary: c.summary, kind: c.kind, date: c.date, status: c.status, groups: c.groups.length, items: allIds(c).length };
}

/** 按拍摄类型的固定顺序，再按标题 */
export function sortItems<T extends { kind?: Kind; title: string; slug: string }>(list: T[]): T[] {
  const k = (x: T) => (x.kind ? KINDS.indexOf(x.kind) : 99);
  return [...list].sort((a, b) => k(a) - k(b) || (a.title < b.title ? -1 : a.title > b.title ? 1 : a.slug < b.slug ? -1 : 1));
}

export const storageKey = (slug: string) => `blog:checklist:${slug}`;

/** 读回本地勾选记录：坏数据 → 空；只保留这份清单里存在的编号；去重 */
export function parseStored(raw: string | null, valid: string[]): string[] {
  if (!raw) return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const ok = new Set(valid);
  return [...new Set(v.filter((x): x is string => typeof x === 'string' && ok.has(x)))];
}

export function progress(checked: string[], c: Pick<Item, 'groups'>): { done: number; total: number; pct: number } {
  const ids = allIds(c);
  const set = new Set(checked);
  const done = ids.filter((i) => set.has(i)).length;
  return { done, total: ids.length, pct: ids.length ? Math.round((done / ids.length) * 100) : 0 };
}

export function progressText(p: { done: number; total: number }): string {
  if (!p.total) return '清单是空的';
  if (p.done === p.total) return `全部 ${p.total} 项都准备好了`;
  return `已准备 ${p.done} / ${p.total} 项，还差 ${p.total - p.done} 项`;
}
