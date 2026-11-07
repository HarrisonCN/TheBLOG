/**
 * L43 / v1.43.0 色彩研究（web = worker 逐字相同，纯函数）：
 * 一张照片 + 从中取出的 3–8 个颜色（每个颜色都有名字和用途说明，不只靠色块）。
 * 校验（#RRGGBB、颜色名、替代文字）、HEX ↔ RGB ↔ HSL、WCAG 2 相对亮度与对比度、AA / AAA 判定、对比度矩阵、摘要与排序。
 */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
export const HEX_RE = /^#[0-9a-f]{6}$/;
export const MIN_SWATCHES = 3;
export const MAX_SWATCHES = 8;

export interface Img {
  src: string;
  alt: string;
  w: number;
  h: number;
}
export interface Swatch {
  hex: string;
  name: string;
  role?: string;
}
export interface Item {
  slug: string;
  title: string;
  summary: string;
  image: Img;
  swatches: Swatch[];
  notes: string[];
  date: string;
  status: 'published' | 'draft';
}
export interface Summary {
  slug: string;
  title: string;
  summary: string;
  date: string;
  status: Item['status'];
  hexes: string[];
  cover: Img;
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
  const m = (o.image && typeof o.image === 'object' ? o.image : {}) as Record<string, unknown>;
  const src = typeof m.src === 'string' && SAFE_SRC.test(m.src) ? m.src : null;
  const alt = str(m.alt, 200);
  const w = Number.isInteger(m.w) && (m.w as number) > 0 ? (m.w as number) : 0;
  const h = Number.isInteger(m.h) && (m.h as number) > 0 ? (m.h as number) : 0;
  if (!src) bad('image.src', '图片地址必须是 https:// 或站内路径');
  if (!alt) bad('image.alt', '图片必须有替代文字');
  if (!w || !h) bad('image.w', '图片宽高必须是正整数');
  const swatches: Swatch[] = [];
  if (!Array.isArray(o.swatches) || o.swatches.length < MIN_SWATCHES || o.swatches.length > MAX_SWATCHES) bad('swatches', `颜色 ${MIN_SWATCHES}–${MAX_SWATCHES} 个`);
  else {
    const seen = new Set<string>();
    o.swatches.forEach((s, i) => {
      const x = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
      const hex = typeof x.hex === 'string' ? x.hex.trim().toLowerCase() : '';
      if (!HEX_RE.test(hex)) return void bad(`swatches.${i}.hex`, '颜色格式 #RRGGBB');
      if (seen.has(hex)) return void bad(`swatches.${i}.hex`, `颜色 ${hex} 重复`);
      seen.add(hex);
      const name = str(x.name, 20);
      if (!name) return void bad(`swatches.${i}.name`, '颜色名必填（≤ 20 字），不能只靠色块');
      const role = x.role === undefined || x.role === '' ? undefined : str(x.role, 60);
      if (role === null) return void bad(`swatches.${i}.role`, '用途 ≤ 60 字');
      swatches.push({ hex, name, ...(role ? { role } : {}) });
    });
  }
  const notes: string[] = [];
  if (o.notes !== undefined) {
    if (!Array.isArray(o.notes) || o.notes.length > 8) bad('notes', '笔记最多 8 段');
    else o.notes.forEach((n, i) => { const t = str(n, 600); if (!t) bad(`notes.${i}`, '段落不能为空（≤ 600 字）'); else notes.push(t); });
  }
  if (issues.length || !src || !alt) return { issues };
  return { item: { slug, title, summary, image: { src, alt, w, h }, swatches, notes, date, status: status as Item['status'] }, issues };
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** HSL：色相 0–359°，饱和度 / 亮度 0–100%（取整） */
export function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, Math.round(l * 100)];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  return [h % 360, Math.round(s * 100), Math.round(l * 100)];
}
export const hslText = (hex: string) => {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  return `hsl(${h} ${s}% ${l}%)`;
};
/** WCAG 2 相对亮度 */
export function luminance(hex: string): number {
  const c = hexToRgb(hex).map((v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
/** 对比度（两位小数） */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return Math.round(((x! + 0.05) / (y! + 0.05)) * 100) / 100;
}
/** 正文文字的 WCAG 等级 */
export const wcagLevel = (ratio: number): 'AAA' | 'AA' | 'AA 大字' | '不足' => (ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA 大字' : '不足');
/** 色块上写字用黑还是白（对比度高的那个） */
export const inkFor = (hex: string) => (contrast(hex, '#000000') >= contrast(hex, '#ffffff') ? '#000000' : '#ffffff');
/** 两两对比度矩阵（对角线为 1） */
export const matrix = (hexes: string[]) => hexes.map((a) => hexes.map((b) => (a === b ? 1 : contrast(a, b))));

export function summarize(c: Item): Summary {
  return { slug: c.slug, title: c.title, summary: c.summary, date: c.date, status: c.status, hexes: c.swatches.map((s) => s.hex), cover: c.image };
}
export function sortItems<T extends { date: string; slug: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}
