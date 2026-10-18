/**
 * L47 / v1.47.0 构图辅助线（web = worker 逐字相同，纯函数）：
 * 构图分析校验（照片宽高与替代文字、适用的辅助线 1–3 种、兴趣点 0–6 个且坐标在 0–1 之间、说明文字 1–8 段）、
 * 辅助线几何（三分线 / 黄金分割线 / 对角线，按照片像素坐标）、交点、兴趣点离最近交点的距离与方位文字、摘要与排序。
 */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
export const GUIDES = ['thirds', 'golden', 'diagonal'] as const;
export type Guide = (typeof GUIDES)[number];
export const GUIDE_LABEL: Record<Guide, string> = { thirds: '三分线', golden: '黄金分割线', diagonal: '对角线' };
/** 黄金分割：0.382 / 0.618 */
export const PHI = (Math.sqrt(5) - 1) / 2;
export const MAX_POINTS = 6;

export interface Img {
  src: string;
  alt: string;
  w: number;
  h: number;
}
export interface Point {
  x: number;
  y: number;
  label: string;
}
export interface Item {
  slug: string;
  title: string;
  summary: string;
  photo: Img;
  guides: Guide[];
  points: Point[];
  notes: string[];
  date: string;
  status: 'published' | 'draft';
}
export interface Summary {
  slug: string;
  title: string;
  summary: string;
  guides: Guide[];
  points: number;
  date: string;
  status: Item['status'];
  cover: Img;
}
export interface Issue {
  path: string;
  message: string;
}
export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);
const SAFE_SRC = /^(https:\/\/|\/(?!\/))[^\s"'<>]+$/;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** 比例位置（0–1）：三分 1/3、2/3；黄金 0.382、0.618 */
export function fractions(g: Exclude<Guide, 'diagonal'>): [number, number] {
  return g === 'thirds' ? [1 / 3, 2 / 3] : [1 - PHI, PHI];
}
/** 辅助线（照片像素坐标，保留两位小数） */
export function guideLines(g: Guide, w: number, h: number): Line[] {
  if (g === 'diagonal') return [{ x1: 0, y1: 0, x2: w, y2: h }, { x1: w, y1: 0, x2: 0, y2: h }];
  const [a, b] = fractions(g);
  return [
    { x1: r2(w * a), y1: 0, x2: r2(w * a), y2: h },
    { x1: r2(w * b), y1: 0, x2: r2(w * b), y2: h },
    { x1: 0, y1: r2(h * a), x2: w, y2: r2(h * a) },
    { x1: 0, y1: r2(h * b), x2: w, y2: r2(h * b) },
  ];
}
/** 交点（比例坐标）：三分 / 黄金各 4 个；对角线 1 个（中心） */
export function intersections(g: Guide): { x: number; y: number }[] {
  if (g === 'diagonal') return [{ x: 0.5, y: 0.5 }];
  const [a, b] = fractions(g);
  return [
    { x: a, y: a },
    { x: b, y: a },
    { x: a, y: b },
    { x: b, y: b },
  ];
}
/** 方位：「左上」「右下」「中上」「正中」…（三等分画面） */
export function zone(p: { x: number; y: number }): string {
  const col = p.x < 1 / 3 ? '左' : p.x > 2 / 3 ? '右' : '中';
  const row = p.y < 1 / 3 ? '上' : p.y > 2 / 3 ? '下' : '中';
  return col === '中' && row === '中' ? '正中' : `${col}${row}`;
}
/** 离最近交点的距离（按画面对角线归一化的百分比，整数） */
export function nearest(p: { x: number; y: number }, g: Guide, w: number, h: number): { at: { x: number; y: number }; pct: number } {
  const diag = Math.hypot(w, h);
  let best = { at: { x: 0, y: 0 }, pct: Infinity };
  for (const q of intersections(g)) {
    const d = Math.round((Math.hypot((p.x - q.x) * w, (p.y - q.y) * h) / diag) * 100);
    if (d < best.pct) best = { at: q, pct: d };
  }
  return best;
}
/** 兴趣点的文字说明（无 JS / 读屏的基线）：「主体（左上）离最近的三分交点约 2%」 */
export function pointText(p: Point, g: Guide, w: number, h: number): string {
  const n = nearest(p, g, w, h);
  const what = g === 'diagonal' ? '对角线交点（画面中心）' : `最近的${GUIDE_LABEL[g].replace('线', '')}交点`;
  return `${p.label}（${zone(p)}）离${what}约 ${n.pct}%`;
}

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: Issue[] } {
  const issues: Issue[] = [];
  const bad = (path: string, message: string) => issues.push({ path, message });
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const slug = typeof o.slug === 'string' && SLUG_RE.test(o.slug) ? o.slug : (bad('slug', '地址只能用小写字母、数字和连字符'), '');
  const title = str(o.title, 60) ?? (bad('title', '标题必填（≤ 60 字）'), '');
  const summary = str(o.summary, 200) ?? (bad('summary', '简介必填（≤ 200 字）'), '');
  const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : (bad('date', '日期格式 YYYY-MM-DD'), '');
  const status = o.status === 'draft' ? 'draft' : o.status === 'published' ? 'published' : (bad('status', '状态只能是 published / draft'), 'draft');
  const m = (o.photo && typeof o.photo === 'object' ? o.photo : {}) as Record<string, unknown>;
  const src = typeof m.src === 'string' && SAFE_SRC.test(m.src) ? m.src : null;
  const alt = str(m.alt, 200);
  const w = Number.isInteger(m.w) && (m.w as number) > 0 && (m.w as number) <= 10000 ? (m.w as number) : 0;
  const h = Number.isInteger(m.h) && (m.h as number) > 0 && (m.h as number) <= 10000 ? (m.h as number) : 0;
  let photo: Img = { src: '', alt: '', w: 0, h: 0 };
  if (!src) bad('photo.src', '照片地址必须是 https:// 或站内路径');
  else if (!alt) bad('photo.alt', '照片必须有替代文字');
  else if (!w || !h) bad('photo.w', '照片宽高必须是 1–10000 的整数（辅助线按它计算）');
  else photo = { src, alt, w, h };
  const guides: Guide[] = [];
  if (!Array.isArray(o.guides) || o.guides.length < 1 || o.guides.length > 3) bad('guides', '适用的辅助线 1–3 种');
  else
    o.guides.forEach((g, i) => {
      if (!(GUIDES as readonly unknown[]).includes(g)) return void bad(`guides.${i}`, '辅助线只能是 thirds / golden / diagonal');
      if (guides.includes(g as Guide)) return void bad(`guides.${i}`, `辅助线「${g}」重复`);
      guides.push(g as Guide);
    });
  const points: Point[] = [];
  if (o.points !== undefined) {
    if (!Array.isArray(o.points) || o.points.length > MAX_POINTS) bad('points', `兴趣点最多 ${MAX_POINTS} 个`);
    else
      o.points.forEach((x0, i) => {
        const x = (x0 && typeof x0 === 'object' ? x0 : {}) as Record<string, unknown>;
        const okc = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
        if (!okc(x.x) || !okc(x.y)) return void bad(`points.${i}`, '兴趣点坐标是 0–1 的比例');
        const label = str(x.label, 20);
        if (!label) return void bad(`points.${i}.label`, '兴趣点名称必填（≤ 20 字）');
        points.push({ x: x.x as number, y: x.y as number, label });
      });
  }
  const notes: string[] = [];
  if (!Array.isArray(o.notes) || o.notes.length < 1 || o.notes.length > 8) bad('notes', '构图说明 1–8 段（这是没有辅助线时的基线）');
  else
    o.notes.forEach((t, i) => {
      const s = str(t, 600);
      if (!s) return void bad(`notes.${i}`, '每段 1–600 字');
      notes.push(s);
    });
  if (issues.length) return { issues };
  return { item: { slug, title, summary, photo, guides, points, notes, date, status: status as Item['status'] }, issues };
}

export function summarize(it: Item): Summary {
  return { slug: it.slug, title: it.title, summary: it.summary, guides: it.guides, points: it.points.length, date: it.date, status: it.status, cover: it.photo };
}
export function sortItems<T extends { date: string; slug: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}
