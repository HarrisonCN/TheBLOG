/**
 * L41 / v1.41.0 作品点评（web = worker 逐字相同，纯函数）：
 * 一件作品 + 几位点评人的结构化点评（构图 / 光线 / 色彩 / 叙事，各 1–5 分）+ 文字意见。
 * 校验（图片替代文字、每条点评四项分数齐全、点评人不重复、1–12 条）、各维度平均分与分布、总体平均、
 * 本地「自评」与平均分的差（只在浏览器里算，不上传）。
 */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
export const DIMS = ['composition', 'light', 'color', 'story'] as const;
export type Dim = (typeof DIMS)[number];
export const DIM_LABEL: Record<Dim, string> = { composition: '构图', light: '光线', color: '色彩', story: '叙事' };
export const MAX_REVIEWS = 12;

export interface Img {
  src: string;
  alt: string;
  w: number;
  h: number;
}
export type Scores = Record<Dim, number>;
export interface Review {
  by: string;
  scores: Scores;
  comment: string;
}
export interface Item {
  slug: string;
  title: string;
  summary: string;
  image: Img;
  /** 作者想听什么意见 */
  ask?: string;
  reviews: Review[];
  date: string;
  status: 'published' | 'draft';
}
export interface Summary {
  slug: string;
  title: string;
  summary: string;
  date: string;
  status: Item['status'];
  reviews: number;
  overall: number | null;
  cover: Img;
}
export interface Issue {
  path: string;
  message: string;
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);
const SAFE_SRC = /^(https:\/\/|\/(?!\/))[^\s"'<>]+$/;
const isScore = (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5;

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: Issue[] } {
  const issues: Issue[] = [];
  const bad = (path: string, message: string) => issues.push({ path, message });
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const slug = typeof o.slug === 'string' && SLUG_RE.test(o.slug) ? o.slug : (bad('slug', '地址只能用小写字母、数字和连字符'), '');
  const title = str(o.title, 60) ?? (bad('title', '标题必填（≤ 60 字）'), '');
  const summary = str(o.summary, 200) ?? (bad('summary', '简介必填（≤ 200 字）'), '');
  const ask = o.ask === undefined || o.ask === '' ? undefined : (str(o.ask, 200) ?? (bad('ask', '想听的意见 ≤ 200 字'), undefined));
  const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : (bad('date', '日期格式 YYYY-MM-DD'), '');
  const status = o.status === 'draft' ? 'draft' : o.status === 'published' ? 'published' : (bad('status', '状态只能是 published / draft'), 'draft');
  const m = (o.image && typeof o.image === 'object' ? o.image : {}) as Record<string, unknown>;
  const src = typeof m.src === 'string' && SAFE_SRC.test(m.src) ? m.src : null;
  const alt = str(m.alt, 200);
  const w = Number.isInteger(m.w) && (m.w as number) > 0 ? (m.w as number) : 0;
  const h = Number.isInteger(m.h) && (m.h as number) > 0 ? (m.h as number) : 0;
  if (!src) bad('image.src', '图片地址必须是 https:// 或站内路径');
  if (!alt) bad('image.alt', '图片必须有替代文字');
  if (!w || !h) bad('image.w', '图片宽高必须是正整数');
  const reviews: Review[] = [];
  if (!Array.isArray(o.reviews) || o.reviews.length > MAX_REVIEWS) bad('reviews', `点评最多 ${MAX_REVIEWS} 条`);
  else {
    const who = new Set<string>();
    o.reviews.forEach((r, i) => {
      const x = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
      const p = `reviews.${i}`;
      const by = str(x.by, 30);
      if (!by) return void bad(`${p}.by`, '点评人必填（≤ 30 字）');
      if (who.has(by)) return void bad(`${p}.by`, `「${by}」已经点评过了`);
      who.add(by);
      const s = (x.scores && typeof x.scores === 'object' ? x.scores : {}) as Record<string, unknown>;
      const miss = DIMS.filter((d) => !isScore(s[d]));
      if (miss.length) return void bad(`${p}.scores`, `${miss.map((d) => DIM_LABEL[d]).join('、')}需要 1–5 的整数分`);
      const comment = str(x.comment, 600);
      if (!comment) return void bad(`${p}.comment`, '文字意见必填（≤ 600 字）');
      reviews.push({ by, scores: { composition: s.composition as number, light: s.light as number, color: s.color as number, story: s.story as number }, comment });
    });
  }
  if (issues.length || !src || !alt) return { issues };
  return { item: { slug, title, summary, image: { src, alt, w, h }, ...(ask ? { ask } : {}), reviews, date, status: status as Item['status'] }, issues };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
/** 各维度平均分（一位小数）；没有点评时为 null */
export function averages(reviews: Review[]): Record<Dim, number> | null {
  if (!reviews.length) return null;
  const out = {} as Record<Dim, number>;
  for (const d of DIMS) out[d] = r1(reviews.reduce((s, r) => s + r.scores[d], 0) / reviews.length);
  return out;
}
export function overall(reviews: Review[]): number | null {
  const a = averages(reviews);
  return a ? r1(DIMS.reduce((s, d) => s + a[d], 0) / DIMS.length) : null;
}
/** 每个维度 1–5 分各有几票 */
export function distribution(reviews: Review[], d: Dim): number[] {
  const n = [0, 0, 0, 0, 0];
  for (const r of reviews) n[r.scores[d] - 1]!++;
  return n;
}
/** 自评与平均分的差（正数 = 你打得比大家高） */
export function compareSelf(self: Partial<Scores>, reviews: Review[]): { dim: Dim; self: number; avg: number; diff: number }[] {
  const a = averages(reviews);
  if (!a) return [];
  return DIMS.filter((d) => isScore(self[d])).map((d) => ({ dim: d, self: self[d]!, avg: a[d], diff: r1(self[d]! - a[d]) }));
}
export function compareText(c: { dim: Dim; diff: number }): string {
  const l = DIM_LABEL[c.dim];
  if (Math.abs(c.diff) < 0.5) return `${l}：你的判断和大家差不多`;
  return c.diff > 0 ? `${l}：你比大家高 ${c.diff} 分` : `${l}：你比大家低 ${-c.diff} 分`;
}

export function summarize(c: Item): Summary {
  return { slug: c.slug, title: c.title, summary: c.summary, date: c.date, status: c.status, reviews: c.reviews.length, overall: overall(c.reviews), cover: c.image };
}
export function sortItems<T extends { date: string; slug: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}
