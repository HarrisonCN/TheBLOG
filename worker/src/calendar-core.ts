/**
 * L39 / v1.39.0 照片日历（web = worker 逐字相同，纯函数）：
 * 一个月一份（地址 = YYYY-MM），每天最多一张图。校验（日期在当月范围内、闰年、同一天不能有两张、图片替代文字必填）、
 * 摘要与排序（月份倒序）、月历网格（周一开头，前后补空）、星期、相邻月份、某时区的「今天」。
 */
export const SLUG_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const;
export const TZ = 'Asia/Shanghai';

export interface Img {
  src: string;
  alt: string;
  w: number;
  h: number;
}
export interface Day {
  day: number;
  title: string;
  image: Img;
  note?: string;
}
export interface Item {
  slug: string;
  title: string;
  summary?: string;
  days: Day[];
  date: string;
  status: 'published' | 'draft';
}
export interface Summary {
  slug: string;
  title: string;
  summary?: string;
  date: string;
  status: Item['status'];
  count: number;
  cover?: Img;
}
export interface Issue {
  path: string;
  message: string;
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);
const SAFE_SRC = /^(https:\/\/|\/(?!\/))[^\s"'<>]+$/;

export const ym = (slug: string): [number, number] => [Number(slug.slice(0, 4)), Number(slug.slice(5, 7))];
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/** 0 = 周一 … 6 = 周日 */
export function weekdayOf(y: number, m: number, d: number): number {
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}
/** 月历：每行 7 格（周一开头），不属于本月的格子是 null */
export function monthGrid(y: number, m: number): (number | null)[][] {
  const lead = weekdayOf(y, m, 1);
  const n = daysInMonth(y, m);
  const cells: (number | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: n }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}
export const monthLabel = (slug: string) => {
  const [y, m] = ym(slug);
  return `${y} 年 ${m} 月`;
};

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: Issue[] } {
  const issues: Issue[] = [];
  const bad = (path: string, message: string) => issues.push({ path, message });
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const slug = typeof o.slug === 'string' && SLUG_RE.test(o.slug) ? o.slug : (bad('slug', '地址是月份 YYYY-MM'), '');
  const title = str(o.title, 60) ?? (bad('title', '标题必填（≤ 60 字）'), '');
  const summary = o.summary === undefined || o.summary === '' ? undefined : (str(o.summary, 200) ?? (bad('summary', '简介 ≤ 200 字'), undefined));
  const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : (bad('date', '日期格式 YYYY-MM-DD'), '');
  const status = o.status === 'draft' ? 'draft' : o.status === 'published' ? 'published' : (bad('status', '状态只能是 published / draft'), 'draft');
  const days: Day[] = [];
  const max = slug ? daysInMonth(...ym(slug)) : 31;
  if (!Array.isArray(o.days) || o.days.length > 31) bad('days', '每天最多一张，一个月最多 31 张');
  else {
    const seen = new Set<number>();
    o.days.forEach((d, i) => {
      const x = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
      const p = `days.${i}`;
      const day = Number.isInteger(x.day) ? (x.day as number) : 0;
      if (day < 1 || day > max) return void bad(`${p}.day`, `日期必须在 1–${max} 之间`);
      if (seen.has(day)) return void bad(`${p}.day`, `${day} 日已经有一张了`);
      seen.add(day);
      const t = str(x.title, 40);
      if (!t) return void bad(`${p}.title`, '标题必填（≤ 40 字）');
      const m = (x.image && typeof x.image === 'object' ? x.image : {}) as Record<string, unknown>;
      const src = typeof m.src === 'string' && SAFE_SRC.test(m.src) ? m.src : null;
      const alt = str(m.alt, 200);
      const w = Number.isInteger(m.w) && (m.w as number) > 0 ? (m.w as number) : 0;
      const h = Number.isInteger(m.h) && (m.h as number) > 0 ? (m.h as number) : 0;
      if (!src) return void bad(`${p}.image.src`, '图片地址必须是 https:// 或站内路径');
      if (!alt) return void bad(`${p}.image.alt`, '图片必须有替代文字');
      if (!w || !h) return void bad(`${p}.image.w`, '图片宽高必须是正整数');
      const note = x.note === undefined || x.note === '' ? undefined : str(x.note, 200);
      if (note === null) return void bad(`${p}.note`, '说明 ≤ 200 字');
      days.push({ day, title: t, image: { src, alt, w, h }, ...(note ? { note } : {}) });
    });
  }
  if (issues.length) return { issues };
  days.sort((a, b) => a.day - b.day);
  return { item: { slug, title, ...(summary ? { summary } : {}), days, date, status: status as Item['status'] }, issues };
}

export function summarize(it: Item): Summary {
  return { slug: it.slug, title: it.title, ...(it.summary ? { summary: it.summary } : {}), date: it.date, status: it.status, count: it.days.length, ...(it.days[0] ? { cover: it.days[0].image } : {}) };
}

/** 月份倒序 */
export function sortItems<T extends { slug: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.slug < b.slug ? 1 : a.slug > b.slug ? -1 : 0));
}

/** 相邻月份（只在已有的月份之间跳） */
export function adjacent<T extends { slug: string }>(list: T[], slug: string): { prev: T | null; next: T | null } {
  const s = sortItems(list);
  const i = s.findIndex((x) => x.slug === slug);
  if (i < 0) return { prev: null, next: null };
  return { prev: s[i + 1] ?? null, next: s[i - 1] ?? null };
}

/** 某时区的今天 YYYY-MM-DD */
export function todayIn(now: Date, tz = TZ): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}
