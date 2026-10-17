/**
 * L37 / v1.37.0 修图前后对比（web = worker 逐字相同，纯函数）：
 * 案例校验（原图与修图后都必须有替代文字和安全地址、两张图宽高比一致、步骤 1–12 个且类型合法、初始位置 0–100）、
 * 摘要与排序（日期倒序）、滑块位置钳制与快捷位置、读屏数值文字、步骤类型统计。
 */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
export const STEP_KINDS = ['crop', 'exposure', 'color', 'local', 'retouch', 'grade'] as const;
export type StepKind = (typeof STEP_KINDS)[number];
export const STEP_LABEL: Record<StepKind, string> = { crop: '裁切与校正', exposure: '曝光与对比', color: '白平衡与色彩', local: '局部调整', retouch: '修补', grade: '调色风格' };
export const MAX_STEPS = 12;
/** 两张图宽高比允许的相对误差 */
export const ASPECT_TOLERANCE = 0.01;

export interface Img {
  src: string;
  alt: string;
  w: number;
  h: number;
}
export interface Step {
  kind: StepKind;
  label: string;
  detail?: string;
}
export interface Item {
  slug: string;
  title: string;
  summary: string;
  before: Img;
  after: Img;
  steps: Step[];
  /** 滑块初始位置（左侧原图所占百分比，默认 50） */
  start: number;
  credit?: string;
  date: string;
  status: 'published' | 'draft';
}
export interface Summary {
  slug: string;
  title: string;
  summary: string;
  date: string;
  status: Item['status'];
  steps: number;
  kinds: StepKind[];
  cover: Img;
}
export interface Issue {
  path: string;
  message: string;
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);
const SAFE_SRC = /^(https:\/\/|\/(?!\/))[^\s"'<>]+$/;

function img(v: unknown, path: string, bad: (p: string, m: string) => void): Img | null {
  const m = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const src = typeof m.src === 'string' && SAFE_SRC.test(m.src) ? m.src : null;
  const alt = str(m.alt, 200);
  const w = Number.isInteger(m.w) && (m.w as number) > 0 ? (m.w as number) : 0;
  const h = Number.isInteger(m.h) && (m.h as number) > 0 ? (m.h as number) : 0;
  if (!src) bad(`${path}.src`, '图片地址必须是 https:// 或站内路径');
  if (!alt) bad(`${path}.alt`, '图片必须有替代文字');
  if (!w || !h) bad(`${path}.w`, '图片宽高必须是正整数');
  return src && alt && w && h ? { src, alt, w, h } : null;
}

export const aspectMatch = (a: Pick<Img, 'w' | 'h'>, b: Pick<Img, 'w' | 'h'>) => Math.abs(a.w / a.h - b.w / b.h) / (b.w / b.h) <= ASPECT_TOLERANCE;

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: Issue[] } {
  const issues: Issue[] = [];
  const bad = (path: string, message: string) => issues.push({ path, message });
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const slug = typeof o.slug === 'string' && SLUG_RE.test(o.slug) ? o.slug : (bad('slug', '地址只能用小写字母、数字和连字符'), '');
  const title = str(o.title, 60) ?? (bad('title', '标题必填（≤ 60 字）'), '');
  const summary = str(o.summary, 200) ?? (bad('summary', '简介必填（≤ 200 字）'), '');
  const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : (bad('date', '日期格式 YYYY-MM-DD'), '');
  const status = o.status === 'draft' ? 'draft' : o.status === 'published' ? 'published' : (bad('status', '状态只能是 published / draft'), 'draft');
  const before = img(o.before, 'before', bad);
  const after = img(o.after, 'after', bad);
  if (before && after && !aspectMatch(before, after)) bad('after', '原图和修图后的宽高比必须一致（先在步骤里说明裁切，再导出同样比例的两张图）');
  const steps: Step[] = [];
  if (!Array.isArray(o.steps) || o.steps.length < 1 || o.steps.length > MAX_STEPS) bad('steps', `修图步骤 1–${MAX_STEPS} 个`);
  else
    o.steps.forEach((s, i) => {
      const x = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
      const kind = STEP_KINDS.includes(x.kind as StepKind) ? (x.kind as StepKind) : null;
      const label = str(x.label, 60);
      const detail = x.detail === undefined || x.detail === '' ? undefined : str(x.detail, 300);
      if (!kind) bad(`steps.${i}.kind`, '步骤类型不正确');
      if (!label) bad(`steps.${i}.label`, '步骤名称必填（≤ 60 字）');
      if (detail === null) bad(`steps.${i}.detail`, '步骤说明 ≤ 300 字');
      if (kind && label && detail !== null) steps.push({ kind, label, ...(detail ? { detail } : {}) });
    });
  let start = 50;
  if (o.start !== undefined) {
    if (typeof o.start !== 'number' || !Number.isFinite(o.start) || o.start < 0 || o.start > 100) bad('start', '初始位置 0–100');
    else start = Math.round(o.start);
  }
  const credit = o.credit === undefined || o.credit === '' ? undefined : (str(o.credit, 200) ?? (bad('credit', '署名 ≤ 200 字'), undefined));
  if (issues.length || !before || !after) return { issues };
  return { item: { slug, title, summary, before, after, steps, start, ...(credit ? { credit } : {}), date, status: status as Item['status'] }, issues };
}

export function summarize(r: Item): Summary {
  const kinds = STEP_KINDS.filter((k) => r.steps.some((s) => s.kind === k));
  return { slug: r.slug, title: r.title, summary: r.summary, date: r.date, status: r.status, steps: r.steps.length, kinds, cover: r.after };
}

export function sortItems<T extends { date: string; slug: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** 滑块位置：钳制到 0–100 的整数；非数字回到 50 */
export function clampPos(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 50;
}

/** 快捷位置按钮：只看原图（100）/ 对半（50）/ 只看修图后（0） */
export const PRESETS = [
  { pos: 100, label: '只看原图' },
  { pos: 50, label: '对半' },
  { pos: 0, label: '只看修图后' },
] as const;

/** 读屏数值文字（aria-valuetext） */
export function valueText(pos: number): string {
  const p = clampPos(pos);
  if (p === 100) return '只显示原图';
  if (p === 0) return '只显示修图后';
  return `左边 ${p}% 是原图，右边 ${100 - p}% 是修图后`;
}

/** 修图后图层的 clip-path（只露出分界线右侧） */
export const clipFor = (pos: number) => `inset(0 0 0 ${clampPos(pos)}%)`;
