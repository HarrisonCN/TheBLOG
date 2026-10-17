/**
 * L46 / v1.46.0 胶片记录（web = worker 逐字相同，纯函数）：
 * 胶卷登记校验（片种、标称 ISO、实际 EI、冲洗工艺、基准显影时间、逐张记录）、推拉档数、推拉冲时间估算、
 * 互易律失效补偿（Schwarzschild：Tc = Tm^p，只对 1 秒以上的曝光）、快门/时间格式化、摘要与排序。
 * 所有数值是经验估算，冲洗请以厂商资料为准。
 */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
export const FORMATS = ['135', '120', '4x5'] as const;
export const PROCESSES = ['BW', 'C-41', 'E-6'] as const;
/** 每推一档显影时间 ×1.3，每拉一档 ×0.8（经验值） */
export const PUSH_FACTOR = 1.3;
export const PULL_FACTOR = 0.8;
/** 互易律补偿表展示的测光时间（秒） */
export const METERED = [1, 2, 4, 8, 15, 30, 60];
export const SHUTTER_RE = /^(?:1\/(\d{1,5})|(\d{1,4}(?:\.\d)?)s)$/;

export interface Img {
  src: string;
  alt: string;
  w: number;
  h: number;
}
export interface Frame {
  n: number;
  subject: string;
  shutter: string;
  aperture: number;
  note?: string;
}
export interface Stock {
  name: string;
  iso: number;
  format: (typeof FORMATS)[number];
  /** 互易律失效指数 p（1–1.6）；没有就不补偿 */
  p?: number;
}
export interface Item {
  slug: string;
  title: string;
  summary: string;
  stock: Stock;
  ei: number;
  process: (typeof PROCESSES)[number];
  developer: string;
  /** 标称 ISO 下的基准显影时间（分钟） */
  baseMinutes: number;
  frames: Frame[];
  cover?: Img;
  date: string;
  status: 'published' | 'draft';
}
export interface Summary {
  slug: string;
  title: string;
  summary: string;
  stock: string;
  format: Stock['format'];
  iso: number;
  ei: number;
  stops: number;
  process: Item['process'];
  frames: number;
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
const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

/** 推拉档数（EI 相对标称 ISO），四舍五入到 1/3 档 */
export function pushStops(iso: number, ei: number): number {
  return Math.round(Math.log2(ei / iso) * 3) / 3;
}
/** 「+2 档」「−1 档」「+2/3 档」「不推不拉」 */
export function stopsText(stops: number): string {
  if (Math.abs(stops) < 1e-9) return '不推不拉';
  const sign = stops > 0 ? '+' : '−';
  const thirds = Math.round(Math.abs(stops) * 3);
  const whole = Math.floor(thirds / 3);
  const rest = thirds % 3;
  return `${sign}${whole ? whole : ''}${whole && rest ? ' ' : ''}${rest ? `${rest}/3` : ''} 档`;
}
/** 推拉冲显影时间估算（分钟，保留到秒） */
export function devMinutes(base: number, stops: number): number {
  const f = stops >= 0 ? PUSH_FACTOR ** stops : PULL_FACTOR ** -stops;
  return Math.round(base * f * 60) / 60;
}
/** 分钟 → 「M:SS」 */
export function mmss(min: number): string {
  const s = Math.round(min * 60);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/** 快门写法 → 秒：「1/125」或「4s」「0.5s」 */
export function shutterSeconds(s: string): number | null {
  const m = SHUTTER_RE.exec(s);
  if (!m) return null;
  if (m[1]) return +m[1] > 0 ? 1 / +m[1] : null;
  const v = +m[2]!;
  return v > 0 ? v : null;
}
/** 互易律补偿：Tc = Tm^p（Tm ≤ 1 秒或没有 p → 原样） */
export function reciprocity(tm: number, p?: number): number {
  if (!p || p <= 1 || tm <= 1) return tm;
  return Math.round(tm ** p * 10) / 10;
}
/** 秒 → 人读：「1/125」「4 秒」「6.2 秒」「2 分 15 秒」 */
export function secondsText(s: number): string {
  if (s < 1) return `1/${Math.round(1 / s)}`;
  if (s < 60) return `${Number.isInteger(s) ? s : s.toFixed(1)} 秒`;
  const t = Math.round(s);
  return `${Math.floor(t / 60)} 分${t % 60 ? ` ${t % 60} 秒` : ''}`;
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
  const st = (o.stock && typeof o.stock === 'object' ? o.stock : {}) as Record<string, unknown>;
  const name = str(st.name, 40) ?? (bad('stock.name', '片种必填（≤ 40 字）'), '');
  const iso = num(st.iso, 6, 6400) ?? (bad('stock.iso', '标称 ISO 6–6400'), 0);
  const format = (FORMATS as readonly string[]).includes(st.format as string) ? (st.format as Stock['format']) : (bad('stock.format', '画幅只能是 135 / 120 / 4x5'), '135');
  let p: number | undefined;
  if (st.p !== undefined) {
    const v = num(st.p, 1, 1.6);
    if (v === null) bad('stock.p', '互易律指数 p 必须在 1–1.6 之间');
    else p = v;
  }
  const ei = num(o.ei, 3, 25600) ?? (bad('ei', '实际 EI 3–25600'), 0);
  if (iso && ei) {
    const s = Math.log2(ei / iso);
    if (s < -2 - 1e-9 || s > 3 + 1e-9) bad('ei', '推拉范围只支持 −2 到 +3 档');
  }
  const process = (PROCESSES as readonly string[]).includes(o.process as string) ? (o.process as Item['process']) : (bad('process', '冲洗工艺只能是 BW / C-41 / E-6'), 'BW');
  const developer = str(o.developer, 40) ?? (bad('developer', '显影液 / 冲洗方式必填（≤ 40 字）'), '');
  const baseMinutes = num(o.baseMinutes, 1, 60) ?? (bad('baseMinutes', '基准显影时间 1–60 分钟'), 0);
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
  const frames: Frame[] = [];
  if (!Array.isArray(o.frames) || o.frames.length < 1 || o.frames.length > 40) bad('frames', '逐张记录 1–40 条');
  else {
    let prev = 0;
    o.frames.forEach((x0, i) => {
      const x = (x0 && typeof x0 === 'object' ? x0 : {}) as Record<string, unknown>;
      const pth = `frames.${i}`;
      if (!Number.isInteger(x.n) || (x.n as number) < 1 || (x.n as number) > 40) return void bad(`${pth}.n`, '张号 1–40');
      if ((x.n as number) <= prev) return void bad(`${pth}.n`, '张号必须严格递增（不能重复）');
      prev = x.n as number;
      const subject = str(x.subject, 60);
      if (!subject) return void bad(`${pth}.subject`, '拍了什么必填（≤ 60 字）');
      const shutter = typeof x.shutter === 'string' && shutterSeconds(x.shutter) !== null ? x.shutter : null;
      if (!shutter) return void bad(`${pth}.shutter`, '快门写成 1/125 或 4s');
      const aperture = num(x.aperture, 0.95, 64);
      if (aperture === null) return void bad(`${pth}.aperture`, '光圈 f/0.95–64');
      const f: Frame = { n: x.n as number, subject, shutter, aperture };
      if (x.note !== undefined) {
        const note = str(x.note, 120);
        if (!note) return void bad(`${pth}.note`, '备注 1–120 字');
        f.note = note;
      }
      frames.push(f);
    });
  }
  if (issues.length) return { issues };
  return {
    item: { slug, title, summary, stock: { name, iso, format, ...(p ? { p } : {}) }, ei, process, developer, baseMinutes, frames, ...(cover ? { cover } : {}), date, status: status as Item['status'] },
    issues,
  };
}

export function summarize(it: Item): Summary {
  return {
    slug: it.slug,
    title: it.title,
    summary: it.summary,
    stock: it.stock.name,
    format: it.stock.format,
    iso: it.stock.iso,
    ei: it.ei,
    stops: pushStops(it.stock.iso, it.ei),
    process: it.process,
    frames: it.frames.length,
    date: it.date,
    status: it.status,
    ...(it.cover ? { cover: it.cover } : {}),
  };
}
export function sortItems<T extends { date: string; slug: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}
