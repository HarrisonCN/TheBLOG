/**
 * L36 / v1.36.0 摄影术语表（web = worker 逐字相同，纯函数）：
 * 术语校验（地址、名称、读音、一句话定义必填；相关术语必须是已存在的术语、不能指向自己；配图必须有替代文字）、
 * 摘要与排序（按读音）、首字母分组（A–Z，其余归入 #）、别名 / 英文 / 拼音 / 拼音首字母搜索与排序、死链检查。
 */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
export const CATEGORIES = ['exposure', 'light', 'composition', 'gear', 'post', 'film'] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<Category, string> = { exposure: '曝光', light: '光线', composition: '构图', gear: '器材', post: '后期', film: '胶片' };
export const MAX_ALIASES = 6;
export const MAX_RELATED = 8;
export const MAX_BODY = 8;

export interface Img {
  src: string;
  alt: string;
  w: number;
  h: number;
}
export interface Item {
  slug: string;
  title: string;
  /** 英文名（可选） */
  en?: string;
  /** 读音：拼音或英文小写，空格分词，用于排序和首字母分组 */
  reading: string;
  aliases: string[];
  category: Category;
  /** 一句话定义（≤ 120 字） */
  summary: string;
  /** 正文段落 */
  body: string[];
  related: { slug: string; title: string }[];
  image?: Img;
  date: string;
  status: 'published' | 'draft';
}
export interface Summary {
  slug: string;
  title: string;
  en?: string;
  reading: string;
  aliases: string[];
  category: Category;
  summary: string;
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

export function validateItem(input: unknown, known?: string[]): { item?: Item; issues: Issue[] } {
  const issues: Issue[] = [];
  const bad = (path: string, message: string) => issues.push({ path, message });
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const slug = typeof o.slug === 'string' && SLUG_RE.test(o.slug) ? o.slug : (bad('slug', '地址只能用小写字母、数字和连字符'), '');
  const title = str(o.title, 40) ?? (bad('title', '术语名称必填（≤ 40 字）'), '');
  const en = o.en === undefined || o.en === '' ? undefined : (str(o.en, 60) ?? (bad('en', '英文名 ≤ 60 字'), undefined));
  const reading = typeof o.reading === 'string' && /^[a-z0-9][a-z0-9 ]{0,79}$/.test(o.reading.trim().toLowerCase()) ? o.reading.trim().toLowerCase().replace(/\s+/g, ' ') : (bad('reading', '读音必填：拼音或英文小写字母，空格分词'), '');
  const category = CATEGORIES.includes(o.category as Category) ? (o.category as Category) : (bad('category', '分类不正确'), 'exposure');
  const summary = str(o.summary, 120) ?? (bad('summary', '一句话定义必填（≤ 120 字）'), '');
  const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : (bad('date', '日期格式 YYYY-MM-DD'), '');
  const status = o.status === 'draft' ? 'draft' : o.status === 'published' ? 'published' : (bad('status', '状态只能是 published / draft'), 'draft');
  const aliases: string[] = [];
  if (o.aliases !== undefined) {
    if (!Array.isArray(o.aliases) || o.aliases.length > MAX_ALIASES) bad('aliases', `别名最多 ${MAX_ALIASES} 个`);
    else o.aliases.forEach((a, i) => { const s = str(a, 40); if (s === null) bad(`aliases.${i}`, '别名不能为空（≤ 40 字）'); else if (!aliases.includes(s)) aliases.push(s); });
  }
  const body: string[] = [];
  if (o.body !== undefined) {
    if (!Array.isArray(o.body) || o.body.length > MAX_BODY) bad('body', `正文最多 ${MAX_BODY} 段`);
    else o.body.forEach((p, i) => { const s = str(p, 600); if (s === null) bad(`body.${i}`, '段落不能为空（≤ 600 字）'); else body.push(s); });
  }
  const related: Item['related'] = [];
  if (o.related !== undefined) {
    if (!Array.isArray(o.related) || o.related.length > MAX_RELATED) bad('related', `相关术语最多 ${MAX_RELATED} 个`);
    else
      o.related.forEach((r, i) => {
        const x = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
        const rs = typeof x.slug === 'string' && SLUG_RE.test(x.slug) ? x.slug : null;
        const rt = str(x.title, 40);
        if (!rs || !rt) return void bad(`related.${i}`, '相关术语需要地址和名称');
        if (rs === slug) return void bad(`related.${i}`, '不能把自己列为相关术语');
        if (known && !known.includes(rs)) return void bad(`related.${i}`, `相关术语「${rt}」不存在`);
        if (!related.some((y) => y.slug === rs)) related.push({ slug: rs, title: rt });
      });
  }
  let image: Img | undefined;
  if (o.image !== undefined) {
    const m = (o.image && typeof o.image === 'object' ? o.image : {}) as Record<string, unknown>;
    const src = typeof m.src === 'string' && SAFE_SRC.test(m.src) ? m.src : null;
    const alt = str(m.alt, 200);
    const w = Number.isInteger(m.w) && (m.w as number) > 0 ? (m.w as number) : 0;
    const h = Number.isInteger(m.h) && (m.h as number) > 0 ? (m.h as number) : 0;
    if (!src) bad('image.src', '图片地址必须是 https:// 或站内路径');
    if (!alt) bad('image.alt', '配图必须有替代文字');
    if (!w || !h) bad('image.w', '图片宽高必须是正整数');
    if (src && alt && w && h) image = { src, alt, w, h };
  }
  if (issues.length) return { issues };
  return { item: { slug, title, ...(en ? { en } : {}), reading, aliases, category, summary, body, related, ...(image ? { image } : {}), date, status: status as Item['status'] }, issues };
}

export function summarize(t: Item): Summary {
  return { slug: t.slug, title: t.title, ...(t.en ? { en: t.en } : {}), reading: t.reading, aliases: t.aliases, category: t.category, summary: t.summary, date: t.date, status: t.status, ...(t.image ? { cover: t.image } : {}) };
}

/** 按读音（再按地址）排序 —— 与语言环境无关，结果稳定 */
export function sortItems<T extends { reading: string; slug: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.reading < b.reading ? -1 : a.reading > b.reading ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

export function initialOf(reading: string): string {
  const c = reading.trim().charAt(0).toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
}

/** A–Z 分组（只有出现过的字母），# 放最后 */
export function groupByInitial<T extends { reading: string; slug: string }>(list: T[]): { letter: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const t of sortItems(list)) {
    const k = initialOf(t.reading);
    map.set(k, [...(map.get(k) ?? []), t]);
  }
  return [...map.keys()].sort((a, b) => (a === '#' ? 1 : b === '#' ? -1 : a < b ? -1 : 1)).map((letter) => ({ letter, items: map.get(letter)! }));
}

export const normalize = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[\s·・\-_/]+/g, '');

/** 匹配分数：0 不匹配；3 完全相同；2 前缀；1 包含。比较名称、英文、别名、拼音（连写）和拼音首字母。 */
export function matchScore(t: Pick<Summary, 'title' | 'en' | 'aliases' | 'reading'>, query: string): number {
  const q = normalize(query);
  if (!q) return 1;
  const keys = [t.title, t.en ?? '', ...t.aliases, t.reading, t.reading.split(' ').map((w) => w[0] ?? '').join('')].map(normalize).filter(Boolean);
  let best = 0;
  for (const k of keys) best = Math.max(best, k === q ? 3 : k.startsWith(q) ? 2 : k.includes(q) ? 1 : 0);
  return best;
}

export function searchTerms<T extends Summary>(list: T[], query: string): T[] {
  if (!normalize(query)) return sortItems(list);
  return sortItems(list)
    .map((t, i) => ({ t, i, s: matchScore(t, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.t);
}

/** 指向不存在（或未发布）术语的相关链接 */
export function deadLinks(items: Pick<Item, 'slug' | 'related'>[]): { from: string; to: string }[] {
  const have = new Set(items.map((x) => x.slug));
  return items.flatMap((x) => x.related.filter((r) => !have.has(r.slug)).map((r) => ({ from: x.slug, to: r.slug })));
}

/** 读屏播报：搜索结果数 */
export function resultText(n: number, query: string): string {
  return normalize(query) ? (n ? `找到 ${n} 个术语` : '没有找到匹配的术语') : `共 ${n} 个术语`;
}
