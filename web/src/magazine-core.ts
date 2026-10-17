/**
 * L33 / v1.33.0 视觉杂志系统（纯函数；web 与 worker 是同一份文件，改一处要同步另一处）。
 * 一期杂志 = 封面 + 编者按 + 若干篇目（专题 / 对页 / 画廊 / 引语 / 短讯）。
 * 校验：替代文字必填、图片地址只允许 https:// 或站内绝对路径、数量与类型规则；版式规划按照片宽高比自动选；
 * 页码表模拟纸质杂志（封面第 1 页、目录第 2 页）。
 */

export const MAG_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const PIECE_KINDS = ['feature', 'spread', 'gallery', 'quote', 'brief'] as const;
export type PieceKind = (typeof PIECE_KINDS)[number];
export const PIECE_LABEL: Record<PieceKind, string> = { feature: '专题', spread: '对页', gallery: '画廊', quote: '引语', brief: '短讯' };
export const ISSUE_STATUSES = ['draft', 'published'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export const MAX_PIECES = 24;
export const MAX_GALLERY = 12;

export interface MagImage {
  src: string;
  alt: string;
  w: number;
  h: number;
  credit?: string;
}
export interface Piece {
  kind: PieceKind;
  title?: string;
  dek?: string;
  /** 专题可以指向站内一篇文章 / 影集（slug） */
  ref?: string;
  text?: string;
  by?: string;
  images?: MagImage[];
}
export interface Issue {
  slug: string;
  no: number;
  title: string;
  /** YYYY-MM */
  date: string;
  status: IssueStatus;
  cover: MagImage;
  editorNote?: string;
  pieces: Piece[];
}
export interface IssueSummary {
  slug: string;
  no: number;
  title: string;
  date: string;
  status: IssueStatus;
  cover: MagImage;
  pieces: number;
  photos: number;
  pagesTotal: number;
}
export interface MagIssue {
  path: string;
  message: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const SAFE_SRC = /^(https:\/\/[^\s"'<>]+|\/[^\s"'<>]*)$/;
const SLUG_REF = /^[a-z0-9][a-z0-9-]{0,80}$/;

function text(v: unknown, path: string, max: number, issues: MagIssue[], required = false): string | undefined {
  const s = str(v);
  if (!s) {
    if (required) issues.push({ path, message: '不能为空' });
    return undefined;
  }
  if (s.length > max) issues.push({ path, message: `最多 ${max} 个字` });
  return s;
}

function image(v: unknown, path: string, issues: MagIssue[]): MagImage | null {
  if (!v || typeof v !== 'object') {
    issues.push({ path, message: '缺少图片' });
    return null;
  }
  const o = v as Record<string, unknown>;
  const src = str(o.src);
  if (!SAFE_SRC.test(src) || src.startsWith('//')) issues.push({ path: `${path}.src`, message: '图片地址必须是 https:// 或站内路径' });
  const alt = str(o.alt);
  if (!alt) issues.push({ path: `${path}.alt`, message: '替代文字必填' });
  else if (alt.length > 200) issues.push({ path: `${path}.alt`, message: '替代文字最多 200 个字' });
  const dim = (k: 'w' | 'h') => {
    const n = o[k];
    if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0 || n > 20000) {
      issues.push({ path: `${path}.${k}`, message: '宽高必须是正整数' });
      return 1;
    }
    return n;
  };
  const out: MagImage = { src, alt, w: dim('w'), h: dim('h') };
  const credit = text(o.credit, `${path}.credit`, 120, issues);
  if (credit) out.credit = credit;
  return out;
}

function images(v: unknown, path: string, issues: MagIssue[], min: number, max: number): MagImage[] {
  const arr = Array.isArray(v) ? v : [];
  if (arr.length < min || arr.length > max) issues.push({ path, message: min === max ? `需要 ${min} 张图片` : `需要 ${min}–${max} 张图片` });
  return arr.slice(0, max).map((x, i) => image(x, `${path}.${i}`, issues)).filter((x): x is MagImage => !!x);
}

function piece(v: unknown, path: string, issues: MagIssue[]): Piece | null {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const kind = o.kind as PieceKind;
  if (!PIECE_KINDS.includes(kind)) {
    issues.push({ path: `${path}.kind`, message: '篇目类型未知' });
    return null;
  }
  const p: Piece = { kind };
  if (kind !== 'quote') p.title = text(o.title, `${path}.title`, 60, issues, true);
  const dek = text(o.dek, `${path}.dek`, 140, issues);
  if (dek) p.dek = dek;
  if (kind === 'feature') {
    const ref = str(o.ref);
    if (ref) {
      if (!SLUG_REF.test(ref)) issues.push({ path: `${path}.ref`, message: '引用的文章地址不合法' });
      p.ref = ref;
    }
    const t = text(o.text, `${path}.text`, 2000, issues);
    if (t) p.text = t;
    p.images = images(o.images, `${path}.images`, issues, 0, 3);
    if (!p.ref && !p.text) issues.push({ path: `${path}.ref`, message: '专题需要引用一篇文章或写一段正文' });
  } else if (kind === 'spread') p.images = images(o.images, `${path}.images`, issues, 1, 3);
  else if (kind === 'gallery') p.images = images(o.images, `${path}.images`, issues, 2, MAX_GALLERY);
  else if (kind === 'quote') {
    p.text = text(o.text, `${path}.text`, 200, issues, true);
    const by = text(o.by, `${path}.by`, 40, issues);
    if (by) p.by = by;
  } else p.text = text(o.text, `${path}.text`, 300, issues, true);
  return p;
}

/** 校验一期杂志：返回规范化后的对象（只保留已知字段）或问题列表 */
export function validateIssue(v: unknown): { issue: Issue | null; issues: MagIssue[] } {
  const issues: MagIssue[] = [];
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const slug = str(o.slug);
  if (!MAG_SLUG_RE.test(slug)) issues.push({ path: 'slug', message: '地址只能用小写字母、数字和连字符（最多 40 个字符）' });
  const no = o.no;
  if (typeof no !== 'number' || !Number.isInteger(no) || no < 1 || no > 999) issues.push({ path: 'no', message: '期号是 1–999 的整数' });
  const title = text(o.title, 'title', 60, issues, true) ?? '';
  const date = str(o.date);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(date)) issues.push({ path: 'date', message: '日期格式是 YYYY-MM' });
  const status = (o.status ?? 'draft') as IssueStatus;
  if (!ISSUE_STATUSES.includes(status)) issues.push({ path: 'status', message: '状态只能是 draft 或 published' });
  const cover = image(o.cover, 'cover', issues);
  const editorNote = text(o.editorNote, 'editorNote', 600, issues);
  const raw = Array.isArray(o.pieces) ? o.pieces : [];
  if (raw.length < 1 || raw.length > MAX_PIECES) issues.push({ path: 'pieces', message: `每期 1–${MAX_PIECES} 篇` });
  const pieces = raw.slice(0, MAX_PIECES).map((x, i) => piece(x, `pieces.${i}`, issues)).filter((x): x is Piece => !!x);
  if (issues.length || !cover) return { issue: null, issues };
  const issue: Issue = { slug, no: no as number, title, date, status, cover, pieces };
  if (editorNote) issue.editorNote = editorNote;
  return { issue, issues };
}

const ar = (i: { w: number; h: number }) => i.w / i.h;

export type SpreadLayout = 'none' | 'panorama' | 'full' | 'diptych' | 'stack' | 'triptych' | 'lead';
/** 按宽高比选版式；order 是排版顺序（原数组下标） */
export function planSpread(imgs: { w: number; h: number }[]): { layout: SpreadLayout; order: number[] } {
  const idx = imgs.map((_, i) => i);
  if (imgs.length === 0) return { layout: 'none', order: [] };
  if (imgs.length === 1) return { layout: ar(imgs[0]!) >= 1.6 ? 'panorama' : 'full', order: [0] };
  if (imgs.length === 2) return { layout: imgs.every((x) => ar(x) < 1) ? 'diptych' : 'stack', order: idx };
  const ars = imgs.slice(0, 3).map(ar);
  const lo = Math.min(...ars);
  const hi = Math.max(...ars);
  if (lo / hi >= 0.8) return { layout: 'triptych', order: [0, 1, 2] };
  const widest = ars.indexOf(hi);
  return { layout: 'lead', order: [widest, ...[0, 1, 2].filter((i) => i !== widest)] };
}

/** 画廊分行：依次放进当前行，宽高比之和 ≥ target 就换行（最后一行可以不满） */
export function galleryRows(imgs: { w: number; h: number }[], target = 3): number[][] {
  const rows: number[][] = [];
  let cur: number[] = [];
  let sum = 0;
  imgs.forEach((im, i) => {
    cur.push(i);
    sum += ar(im);
    if (sum >= target) {
      rows.push(cur);
      cur = [];
      sum = 0;
    }
  });
  if (cur.length) rows.push(cur);
  return rows;
}

export const pieceAnchor = (i: number): string => `piece-${i + 1}`;

function piecePages(p: Piece): number {
  switch (p.kind) {
    case 'feature':
      return 4;
    case 'spread':
      return 2;
    case 'gallery':
      return 2 * Math.max(1, Math.ceil((p.images?.length ?? 0) / 6));
    default:
      return 1;
  }
}

/** 页码表：封面第 1 页、目录第 2 页，篇目从第 3 页起 */
export function pageMap(issue: Pick<Issue, 'pieces'>): { id: string; page: number; pages: number }[] {
  let page = 3;
  return issue.pieces.map((p, i) => {
    const pages = piecePages(p);
    const r = { id: pieceAnchor(i), page, pages };
    page += pages;
    return r;
  });
}

export function issueSummary(issue: Issue): IssueSummary {
  const pm = pageMap(issue);
  const last = pm.at(-1);
  return {
    slug: issue.slug,
    no: issue.no,
    title: issue.title,
    date: issue.date,
    status: issue.status,
    cover: issue.cover,
    pieces: issue.pieces.length,
    photos: 1 + issue.pieces.reduce((s, p) => s + (p.images?.length ?? 0), 0),
    pagesTotal: last ? last.page + last.pages - 1 : 2,
  };
}

export function sortIssues<T extends { no: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => b.no - a.no);
}

/** 上一期 = 期号更小里最大的；下一期 = 期号更大里最小的 */
export function adjacentIssues<T extends { slug: string; no: number }>(list: T[], slug: string): { prev: T | null; next: T | null } {
  const cur = list.find((x) => x.slug === slug);
  if (!cur) return { prev: null, next: null };
  const s = sortIssues(list);
  return { prev: s.find((x) => x.no < cur.no) ?? null, next: [...s].reverse().find((x) => x.no > cur.no) ?? null };
}
