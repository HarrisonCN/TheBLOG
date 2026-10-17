/**
 * L44 / v1.44.0 摄影人访谈（web = worker 逐字相同，纯函数）：
 * 访谈校验（受访者必须标明虚构、问答 2–30 组、问题编号唯一、引语必须逐字出自某个回答、封面替代文字）、
 * 目录（问题锚点）、引语归位（放在出处回答之后）、阅读时长估算、摘要与排序。
 */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const MIN_QA = 2;
export const MAX_QA = 30;
export const MAX_QUOTES = 6;
/** 中文阅读速度：每分钟约 400 字 */
export const CHARS_PER_MIN = 400;

export interface Img {
  src: string;
  alt: string;
  w: number;
  h: number;
}
export interface Person {
  name: string;
  role: string;
  bio: string;
  /** 受访者是否虚构：演示站只允许 true */
  fictional: true;
}
export interface QA {
  id: string;
  q: string;
  a: string[];
}
export interface Item {
  slug: string;
  title: string;
  summary: string;
  person: Person;
  cover?: Img;
  qa: QA[];
  quotes: string[];
  date: string;
  status: 'published' | 'draft';
}
export interface Summary {
  slug: string;
  title: string;
  summary: string;
  name: string;
  role: string;
  date: string;
  status: Item['status'];
  questions: number;
  minutes: number;
  cover?: Img;
}
export interface Issue {
  path: string;
  message: string;
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);
const SAFE_SRC = /^(https:\/\/|\/(?!\/))[^\s"'<>]+$/;

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: Issue[] } {
  const issues: Issue[] = [];
  const bad = (path: string, message: string) => issues.push({ path, message });
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const slug = typeof o.slug === 'string' && SLUG_RE.test(o.slug) ? o.slug : (bad('slug', '地址只能用小写字母、数字和连字符'), '');
  const title = str(o.title, 60) ?? (bad('title', '标题必填（≤ 60 字）'), '');
  const summary = str(o.summary, 200) ?? (bad('summary', '简介必填（≤ 200 字）'), '');
  const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : (bad('date', '日期格式 YYYY-MM-DD'), '');
  const status = o.status === 'draft' ? 'draft' : o.status === 'published' ? 'published' : (bad('status', '状态只能是 published / draft'), 'draft');
  const pp = (o.person && typeof o.person === 'object' ? o.person : {}) as Record<string, unknown>;
  const name = str(pp.name, 30) ?? (bad('person.name', '受访者称呼必填（≤ 30 字）'), '');
  const role = str(pp.role, 40) ?? (bad('person.role', '身份必填（≤ 40 字）'), '');
  const bio = str(pp.bio, 300) ?? (bad('person.bio', '简介必填（≤ 300 字）'), '');
  if (pp.fictional !== true) bad('person.fictional', '演示站只收录虚构访谈：fictional 必须为 true');
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
  const qa: QA[] = [];
  if (!Array.isArray(o.qa) || o.qa.length < MIN_QA || o.qa.length > MAX_QA) bad('qa', `问答 ${MIN_QA}–${MAX_QA} 组`);
  else {
    const seen = new Set<string>();
    o.qa.forEach((x0, i) => {
      const x = (x0 && typeof x0 === 'object' ? x0 : {}) as Record<string, unknown>;
      const p = `qa.${i}`;
      const id = typeof x.id === 'string' && ID_RE.test(x.id) ? x.id : null;
      if (!id) return void bad(`${p}.id`, '问题编号只能用小写字母、数字和连字符');
      if (seen.has(id)) return void bad(`${p}.id`, `问题编号「${id}」重复`);
      seen.add(id);
      const q = str(x.q, 200);
      if (!q) return void bad(`${p}.q`, '问题必填（≤ 200 字）');
      const a = Array.isArray(x.a) ? x.a.map((t) => str(t, 2000)) : [];
      if (!a.length || a.length > 12 || a.some((t) => t === null)) return void bad(`${p}.a`, '回答 1–12 段，每段 ≤ 2000 字');
      qa.push({ id, q, a: a as string[] });
    });
  }
  const quotes: string[] = [];
  if (o.quotes !== undefined) {
    if (!Array.isArray(o.quotes) || o.quotes.length > MAX_QUOTES) bad('quotes', `引语最多 ${MAX_QUOTES} 条`);
    else
      o.quotes.forEach((t, i) => {
        const s = str(t, 120);
        if (!s) return void bad(`quotes.${i}`, '引语 1–120 字');
        if (qa.length && !qa.some((x) => x.a.some((para) => para.includes(s)))) return void bad(`quotes.${i}`, '引语必须逐字出自某个回答');
        quotes.push(s);
      });
  }
  if (issues.length) return { issues };
  return { item: { slug, title, summary, person: { name, role, bio, fictional: true }, ...(cover ? { cover } : {}), qa, quotes, date, status: status as Item['status'] }, issues };
}

/** 目录：问题锚点 q-<id> */
export const toc = (qa: Pick<QA, 'id' | 'q'>[]) => qa.map((x) => ({ href: `#q-${x.id}`, text: x.q }));
/** 每条引语放在第一个包含它的回答之后：返回 问题编号 → 引语列表 */
export function placeQuotes(qa: QA[], quotes: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const s of quotes) {
    const hit = qa.find((x) => x.a.some((p) => p.includes(s)));
    if (hit) (out[hit.id] ??= []).push(s);
  }
  return out;
}
/** 阅读时长（分钟，至少 1）：问题 + 回答的字数 / 400 */
export function readingMinutes(it: Pick<Item, 'qa'>): number {
  const n = it.qa.reduce((s, x) => s + [...x.q].length + x.a.reduce((t, p) => t + [...p].length, 0), 0);
  return Math.max(1, Math.round(n / CHARS_PER_MIN));
}
export function summarize(it: Item): Summary {
  return { slug: it.slug, title: it.title, summary: it.summary, name: it.person.name, role: it.person.role, date: it.date, status: it.status, questions: it.qa.length, minutes: readingMinutes(it), ...(it.cover ? { cover: it.cover } : {}) };
}
export function sortItems<T extends { date: string; slug: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}
