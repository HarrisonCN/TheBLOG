/**
 * L50 / v1.50.0 毕业作品集（web = worker 逐字相同，纯函数）：
 * 作品集校验（作者必须标明虚构、年份、创作自述 1–6 段、策展序列 3–24 件且编号从 1 起连续、每件作品的照片替代文字与尺寸/媒介）、
 * 序列文字（「3 / 12」）、作品说明行、L36–L49 内容入口清单、摘要与排序。
 */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
export const MIN_WORKS = 3;
export const MAX_WORKS = 24;

export interface Img {
  src: string;
  alt: string;
  w: number;
  h: number;
}
export interface Work {
  n: number;
  title: string;
  year: number;
  medium: string;
  size?: string;
  photo: Img;
  note?: string;
}
export interface Item {
  slug: string;
  title: string;
  author: string;
  /** 作者是否虚构：演示站只允许 true */
  fictional: true;
  year: number;
  statement: string[];
  works: Work[];
  date: string;
  status: 'published' | 'draft';
}
export interface Summary {
  slug: string;
  title: string;
  author: string;
  year: number;
  works: number;
  date: string;
  status: Item['status'];
  cover: Img;
}
export interface Issue {
  path: string;
  message: string;
}

/** L36–L49 新增的内容栏目（作品集页的「更多内容」入口；顺序即版本顺序） */
export const HUB: { v: string; label: string; href: string }[] = [
  { v: '1.36', label: '摄影术语表', href: '/glossary/' },
  { v: '1.37', label: '修图前后对比', href: '/retouch/' },
  { v: '1.38', label: '拍摄清单', href: '/checklists/' },
  { v: '1.39', label: '照片日历', href: '/calendar/' },
  { v: '1.40', label: '课程笔记', href: '/courses/' },
  { v: '1.41', label: '作品点评', href: '/critique/' },
  { v: '1.42', label: '扫街路线', href: '/walks/' },
  { v: '1.43', label: '色彩研究', href: '/colors/' },
  { v: '1.44', label: '摄影人访谈', href: '/interviews/' },
  { v: '1.45', label: '52 周挑战', href: '/challenges/' },
  { v: '1.46', label: '胶片记录', href: '/film/' },
  { v: '1.47', label: '构图辅助线', href: '/composition/' },
  { v: '1.48', label: '投稿与展览征集', href: '/calls/' },
  { v: '1.49', label: '作品幕后', href: '/behind/' },
];

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);
const SAFE_SRC = /^(https:\/\/|\/(?!\/))[^\s"'<>]+$/;
const yr = (v: unknown) => (Number.isInteger(v) && (v as number) >= 1990 && (v as number) <= 2100 ? (v as number) : null);

/** 「3 / 12」 */
export const seqText = (n: number, total: number) => `${n} / ${total}`;
/** 作品说明行：「2026 · 微喷 · 40 × 60 cm」 */
export const workLine = (w: Pick<Work, 'year' | 'medium' | 'size'>) => [String(w.year), w.medium, w.size].filter(Boolean).join(' · ');

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: Issue[] } {
  const issues: Issue[] = [];
  const bad = (path: string, message: string) => issues.push({ path, message });
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const slug = typeof o.slug === 'string' && SLUG_RE.test(o.slug) ? o.slug : (bad('slug', '地址只能用小写字母、数字和连字符'), '');
  const title = str(o.title, 60) ?? (bad('title', '标题必填（≤ 60 字）'), '');
  const author = str(o.author, 30) ?? (bad('author', '作者必填（≤ 30 字）'), '');
  if (o.fictional !== true) bad('fictional', '演示站只收录虚构作者：fictional 必须为 true');
  const year = yr(o.year) ?? (bad('year', '年份 1990–2100'), 0);
  const statement: string[] = [];
  if (!Array.isArray(o.statement) || o.statement.length < 1 || o.statement.length > 6) bad('statement', '创作自述 1–6 段');
  else
    o.statement.forEach((t, i) => {
      const s = str(t, 800);
      if (!s) return void bad(`statement.${i}`, '每段 1–800 字');
      statement.push(s);
    });
  const works: Work[] = [];
  if (!Array.isArray(o.works) || o.works.length < MIN_WORKS || o.works.length > MAX_WORKS) bad('works', `策展序列 ${MIN_WORKS}–${MAX_WORKS} 件`);
  else
    o.works.forEach((x0, i) => {
      const x = (x0 && typeof x0 === 'object' ? x0 : {}) as Record<string, unknown>;
      const p = `works.${i}`;
      if (x.n !== i + 1) return void bad(`${p}.n`, `序号必须从 1 起连续（这里应为 ${i + 1}）`);
      const t = str(x.title, 40);
      if (!t) return void bad(`${p}.title`, '作品名必填（≤ 40 字）');
      const y = yr(x.year);
      if (!y) return void bad(`${p}.year`, '年份 1990–2100');
      const medium = str(x.medium, 30);
      if (!medium) return void bad(`${p}.medium`, '媒介必填（≤ 30 字）');
      const m = (x.photo && typeof x.photo === 'object' ? x.photo : {}) as Record<string, unknown>;
      const src = typeof m.src === 'string' && SAFE_SRC.test(m.src) ? m.src : null;
      const alt = str(m.alt, 200);
      const w = Number.isInteger(m.w) && (m.w as number) > 0 ? (m.w as number) : 0;
      const h = Number.isInteger(m.h) && (m.h as number) > 0 ? (m.h as number) : 0;
      if (!src) return void bad(`${p}.photo.src`, '照片地址必须是 https:// 或站内路径');
      if (!alt) return void bad(`${p}.photo.alt`, '照片必须有替代文字');
      if (!w || !h) return void bad(`${p}.photo.w`, '照片宽高必须是正整数');
      const wk: Work = { n: i + 1, title: t, year: y, medium, photo: { src, alt, w, h } };
      if (x.size !== undefined) {
        const sz = str(x.size, 30);
        if (!sz) return void bad(`${p}.size`, '尺寸 1–30 字');
        wk.size = sz;
      }
      if (x.note !== undefined) {
        const nt = str(x.note, 300);
        if (!nt) return void bad(`${p}.note`, '说明 1–300 字');
        wk.note = nt;
      }
      works.push(wk);
    });
  const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : (bad('date', '日期格式 YYYY-MM-DD'), '');
  const status = o.status === 'draft' ? 'draft' : o.status === 'published' ? 'published' : (bad('status', '状态只能是 published / draft'), 'draft');
  if (issues.length) return { issues };
  return { item: { slug, title, author, fictional: true, year, statement, works, date, status: status as Item['status'] }, issues };
}

export function summarize(it: Item): Summary {
  return { slug: it.slug, title: it.title, author: it.author, year: it.year, works: it.works.length, date: it.date, status: it.status, cover: it.works[0]!.photo };
}
export function sortItems<T extends { date: string; slug: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}
