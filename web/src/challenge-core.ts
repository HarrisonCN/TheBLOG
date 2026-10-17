/**
 * L45 / v1.45.0 52 周挑战（web = worker 逐字相同，纯函数）：
 * 挑战校验（年份、每周主题 4–53 条、周次 1–该年 ISO 周数且严格递增、作品链接只许站内或 https）、
 * ISO 8601 周计算（isoWeek / weeksInYear / weekRange）、「本周」（Asia/Shanghai）、本地完成进度（localStorage 读回）、摘要与排序。
 */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
export const TZ = 'Asia/Shanghai';
export const MIN_WEEKS = 4;
export const MAX_WEEKS = 53;

export interface Img {
  src: string;
  alt: string;
  w: number;
  h: number;
}
export interface Week {
  week: number;
  theme: string;
  tip?: string;
  link?: { href: string; text: string };
}
export interface Item {
  slug: string;
  title: string;
  summary: string;
  year: number;
  cover?: Img;
  weeks: Week[];
  date: string;
  status: 'published' | 'draft';
}
export interface Summary {
  slug: string;
  title: string;
  summary: string;
  year: number;
  weeks: number;
  first: number;
  last: number;
  date: string;
  status: Item['status'];
  cover?: Img;
}
export interface Issue {
  path: string;
  message: string;
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);
const SAFE_SRC = /^(https:\/\/|\/(?!\/))[^\s"'<>]+$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const utc = (d: string): Date | null => {
  const m = DATE_RE.exec(d);
  if (!m) return null;
  const t = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return t.getUTCFullYear() === +m[1]! && t.getUTCMonth() === +m[2]! - 1 && t.getUTCDate() === +m[3]! ? t : null;
};
const iso = (t: Date) => t.toISOString().slice(0, 10);

/** ISO 8601 周：周一开头，包含当年第一个星期四的那一周是第 1 周（年初几天可能属于上一年的最后一周） */
export function isoWeek(date: string): { year: number; week: number } {
  const t = utc(date);
  if (!t) throw new RangeError(`bad date ${date}`);
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day); // 本周的星期四
  const y = t.getUTCFullYear();
  const jan1 = Date.UTC(y, 0, 1);
  return { year: y, week: Math.floor((t.getTime() - jan1) / 86400000 / 7) + 1 };
}
/** 一年有 52 还是 53 个 ISO 周：12 月 28 日总在最后一周 */
export const weeksInYear = (year: number): number => isoWeek(`${String(year).padStart(4, '0')}-12-28`).week;
/** 第 week 周的周一与周日（YYYY-MM-DD） */
export function weekRange(year: number, week: number): { start: string; end: string } {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const mon1 = new Date(jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * 86400000);
  const start = new Date(mon1.getTime() + (week - 1) * 7 * 86400000);
  return { start: iso(start), end: iso(new Date(start.getTime() + 6 * 86400000)) };
}
/** 「M 月 D 日 – M 月 D 日」 */
export function rangeText(r: { start: string; end: string }): string {
  const f = (d: string) => `${+d.slice(5, 7)} 月 ${+d.slice(8, 10)} 日`;
  return `${f(r.start)} – ${f(r.end)}`;
}
export function todayIn(now: Date, tz = TZ): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}
/** 今天落在这份挑战的哪一周（不在这一年或这周没有主题 → null） */
export function currentWeek(it: Pick<Item, 'year' | 'weeks'>, today: string): number | null {
  const w = isoWeek(today);
  return w.year === it.year && it.weeks.some((x) => x.week === w.week) ? w.week : null;
}

export const storageKey = (slug: string) => `blog:challenge:${slug}`;
/** 读回本地完成记录：坏数据 → 空；只保留这份挑战里存在的周次；去重并升序 */
export function parseStored(raw: string | null, valid: number[]): number[] {
  if (!raw) return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const ok = new Set(valid);
  return [...new Set(v.filter((x): x is number => Number.isInteger(x) && ok.has(x as number)))].sort((a, b) => a - b);
}
export function progressText(done: number, total: number): string {
  if (!total) return '还没有主题';
  if (done === total) return `全部 ${total} 周都完成了`;
  return `已完成 ${done} / ${total} 周，还差 ${total - done} 周`;
}

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: Issue[] } {
  const issues: Issue[] = [];
  const bad = (path: string, message: string) => issues.push({ path, message });
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const slug = typeof o.slug === 'string' && SLUG_RE.test(o.slug) ? o.slug : (bad('slug', '地址只能用小写字母、数字和连字符'), '');
  const title = str(o.title, 60) ?? (bad('title', '标题必填（≤ 60 字）'), '');
  const summary = str(o.summary, 200) ?? (bad('summary', '简介必填（≤ 200 字）'), '');
  const date = typeof o.date === 'string' && utc(o.date) ? o.date : (bad('date', '日期格式 YYYY-MM-DD'), '');
  const status = o.status === 'draft' ? 'draft' : o.status === 'published' ? 'published' : (bad('status', '状态只能是 published / draft'), 'draft');
  const year = Number.isInteger(o.year) && (o.year as number) >= 2000 && (o.year as number) <= 2100 ? (o.year as number) : (bad('year', '年份 2000–2100'), 0);
  let cover: Img | undefined;
  if (o.cover !== undefined) {
    const m = (o.cover && typeof o.cover === 'object' ? o.cover : {}) as Record<string, unknown>;
    const src = typeof m.src === 'string' && SAFE_SRC.test(m.src) ? m.src : null;
    const alt = str(m.alt, 200);
    const w = Number.isInteger(m.w) && (m.w as number) > 0 ? (m.w as number) : 0;
    const h = Number.isInteger(m.h) && (m.h as number) > 0 ? (m.h as number) : 0;
    if (!src) bad('cover.src', '图片地址必须是 https:// 或站内路径');
    else if (!alt) bad('cover.alt', '图片必须有替代文字');
    else if (!w || !h) bad('cover.w', '图片宽高必须是正整数');
    else cover = { src, alt, w, h };
  }
  const weeks: Week[] = [];
  if (!Array.isArray(o.weeks) || o.weeks.length < MIN_WEEKS || o.weeks.length > MAX_WEEKS) bad('weeks', `每周主题 ${MIN_WEEKS}–${MAX_WEEKS} 条`);
  else {
    const maxW = year ? weeksInYear(year) : MAX_WEEKS;
    let prev = 0;
    o.weeks.forEach((x0, i) => {
      const x = (x0 && typeof x0 === 'object' ? x0 : {}) as Record<string, unknown>;
      const p = `weeks.${i}`;
      const n = x.week;
      if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > maxW) return void bad(`${p}.week`, `周次必须是 1–${maxW}（${year || '该'} 年有 ${maxW} 个 ISO 周）`);
      if ((n as number) <= prev) return void bad(`${p}.week`, '周次必须严格递增（不能重复）');
      prev = n as number;
      const theme = str(x.theme, 40);
      if (!theme) return void bad(`${p}.theme`, '主题必填（≤ 40 字）');
      const w: Week = { week: n as number, theme };
      if (x.tip !== undefined) {
        const tip = str(x.tip, 200);
        if (!tip) return void bad(`${p}.tip`, '提示 1–200 字');
        w.tip = tip;
      }
      if (x.link !== undefined) {
        const l = (x.link && typeof x.link === 'object' ? x.link : {}) as Record<string, unknown>;
        const href = typeof l.href === 'string' && SAFE_SRC.test(l.href) ? l.href : null;
        const text = str(l.text, 40);
        if (!href) return void bad(`${p}.link.href`, '作品链接必须是 https:// 或站内路径');
        if (!text) return void bad(`${p}.link.text`, '链接文字必填（≤ 40 字）');
        w.link = { href, text };
      }
      weeks.push(w);
    });
  }
  if (issues.length) return { issues };
  return { item: { slug, title, summary, year, ...(cover ? { cover } : {}), weeks, date, status: status as Item['status'] }, issues };
}

export function summarize(it: Item): Summary {
  return {
    slug: it.slug,
    title: it.title,
    summary: it.summary,
    year: it.year,
    weeks: it.weeks.length,
    first: it.weeks[0]?.week ?? 0,
    last: it.weeks[it.weeks.length - 1]?.week ?? 0,
    date: it.date,
    status: it.status,
    ...(it.cover ? { cover: it.cover } : {}),
  };
}
export function sortItems<T extends { date: string; slug: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}
