/**
 * L34 / v1.34.0 视频与声音作品（纯函数；web 与 worker 是同一份文件，改一处要同步另一处）。
 * - WebVTT 解析 / 生成（字幕与文字稿共用一份 cue 列表）；
 * - 时间格式、?t= 深链参数；
 * - 作品校验：视频必须有字幕和带替代文字的封面，声音必须有文字稿（无障碍是发布条件，不是可选项）；
 *   章节从 0 开始严格递增且在时长内；来源 MIME 按类型白名单，地址只允许 https:// 或站内绝对路径；
 * - 当前字幕 / 章节查找（二分）、文字稿搜索、列表摘要与排序。
 */

export const AV_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const AV_KINDS = ['video', 'audio'] as const;
export type AvKind = (typeof AV_KINDS)[number];
export const AV_KIND_LABEL: Record<AvKind, string> = { video: '视频', audio: '声音' };
export const AV_STATUSES = ['draft', 'published'] as const;
export type AvStatus = (typeof AV_STATUSES)[number];
export const AV_MIME: Record<AvKind, readonly string[]> = {
  video: ['video/webm', 'video/mp4'],
  audio: ['audio/mpeg', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/aac'],
};
export const MAX_CUES = 2000;
export const MAX_CHAPTERS = 100;
export const MAX_SOURCES = 4;
/** 最长 6 小时 */
export const MAX_DURATION = 6 * 3600;

export interface Cue {
  start: number;
  end: number;
  text: string;
}
export interface Chapter {
  t: number;
  title: string;
}
export interface AvSource {
  src: string;
  type: string;
}
export interface AvPoster {
  src: string;
  alt: string;
  w: number;
  h: number;
}
export interface AvWork {
  slug: string;
  kind: AvKind;
  title: string;
  summary?: string;
  /** YYYY-MM-DD */
  date: string;
  status: AvStatus;
  /** 秒 */
  duration: number;
  width?: number;
  height?: number;
  poster?: AvPoster;
  /** 署名 / 来源说明 */
  credit?: string;
  sources: AvSource[];
  chapters: Chapter[];
  cues: Cue[];
}
export interface AvSummary {
  slug: string;
  kind: AvKind;
  title: string;
  summary?: string;
  date: string;
  status: AvStatus;
  duration: number;
  poster?: AvPoster;
  chapters: number;
  cues: number;
}
export interface AvIssue {
  path: string;
  message: string;
}

// ---------------- WebVTT ----------------

const TS = /^(?:(\d{1,3}):)?(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;
function parseTs(s: string): number | null {
  const m = TS.exec(s);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const mi = Number(m[2]);
  const se = Number(m[3]);
  if (mi > 59 || se > 59) return null;
  const ms = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
  return (h * 3600000 + mi * 60000 + se * 1000 + ms) / 1000;
}
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
function fmtTs(sec: number): string {
  const total = Math.max(0, Math.round(sec * 1000));
  const ms = total % 1000;
  const s = Math.floor(total / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}.${pad(ms, 3)}`;
}
const ENT: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&nbsp;': '\u00a0', '&lrm;': '\u200e', '&rlm;': '\u200f' };
const unescapeVtt = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&(?:lt|gt|amp|nbsp|lrm|rlm);/g, (x) => ENT[x]!);
const escapeVtt = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function parseVtt(input: string): { cues: Cue[]; errors: string[] } {
  const cues: Cue[] = [];
  const errors: string[] = [];
  const text = String(input ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n{2,}/);
  const head = blocks.shift() ?? '';
  if (!/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(head)) {
    errors.push('不是 WebVTT：第一行必须是 WEBVTT');
    return { cues, errors };
  }
  blocks.forEach((b, bi) => {
    const lines = b.split('\n').map((l) => l.trim());
    while (lines.length && !lines[0]) lines.shift();
    if (!lines.length) return;
    if (/^(NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0]!)) return;
    let i = 0;
    if (!lines[0]!.includes('-->')) i = 1; // 标识行
    const timing = lines[i];
    if (!timing || !timing.includes('-->')) {
      errors.push(`第 ${bi + 1} 段没有时间行`);
      return;
    }
    const [a, rest = ''] = timing.split('-->');
    const start = parseTs(a!.trim());
    const end = parseTs(rest.trim().split(/\s+/)[0] ?? '');
    if (start === null || end === null) {
      errors.push(`第 ${bi + 1} 段时间戳格式不对：${timing}`);
      return;
    }
    if (end <= start) {
      errors.push(`第 ${bi + 1} 段结束时间不晚于开始时间`);
      return;
    }
    const body = lines
      .slice(i + 1)
      .map(unescapeVtt)
      .join('\n')
      .trim();
    if (!body) return;
    cues.push({ start, end, text: body });
  });
  return { cues, errors };
}

export function toVtt(cues: Cue[]): string {
  const parts = cues.map((c) => {
    const body = c.text
      .split('\n')
      .map((l) => escapeVtt(l.trim()))
      .filter(Boolean)
      .join('\n');
    return `${fmtTs(c.start)} --> ${fmtTs(c.end)}\n${body}`;
  });
  return `WEBVTT\n\n${parts.join('\n\n')}\n`;
}

// ---------------- 时间 ----------------

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** 深链 ?t= 参数：90 / 12.5 / 1:30 / 01:02:03 / 1h2m3s / 45s；非法返回 null，超过时长取时长 */
export function parseStart(raw: string | null | undefined, duration: number): number | null {
  const s = (raw ?? '').trim();
  if (!s || s.length > 16) return null;
  let v: number | null = null;
  let m: RegExpExecArray | null;
  if (/^\d+(?:\.\d+)?$/.test(s)) v = Number(s);
  else if ((m = /^(\d+):(\d{1,2})$/.exec(s))) v = Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
  else if ((m = /^(\d+):(\d{2}):(\d{2})$/.exec(s))) v = Number(m[2]) < 60 && Number(m[3]) < 60 ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
  else if ((m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(s)) && (m[1] || m[2] || m[3])) v = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  if (v === null || !Number.isFinite(v) || v < 0) return null;
  return Number.isFinite(duration) && duration > 0 ? Math.min(v, duration) : v;
}

/** 当前字幕：最后一条 start ≤ t 的字幕，且 t 在它结束之前；否则 -1 */
export function activeCue(cues: Cue[], t: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid]!.start <= t) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return idx >= 0 && t < cues[idx]!.end ? idx : -1;
}

/** 当前章节：最后一个 t ≤ 时间的章节；没有章节返回 -1 */
export function chapterAt(chapters: Chapter[], t: number): number {
  let lo = 0;
  let hi = chapters.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (chapters[mid]!.t <= t) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return chapters.length ? Math.max(idx, 0) : -1;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
/** 文字稿搜索：忽略大小写与空白，返回命中的字幕序号 */
export function searchCues(cues: Cue[], q: string): number[] {
  const n = norm(q ?? '');
  if (!n) return [];
  const out: number[] = [];
  cues.forEach((c, i) => {
    if (norm(c.text).includes(n)) out.push(i);
  });
  return out;
}

// ---------------- 校验 ----------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const posInt = (v: unknown, max = 20000): boolean => Number.isInteger(v) && (v as number) > 0 && (v as number) <= max;
/** 媒体地址：https:// 或站内绝对路径（不允许 //host、javascript: 等） */
export function safeMediaSrc(src: unknown): boolean {
  const s = str(src);
  if (!s || s.length > 500 || /[\s"'<>\\]/.test(s)) return false;
  return /^https:\/\/[^/]/.test(s) || (/^\/(?!\/)/.test(s));
}
function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const EPS = 0.001;

export function validateAvWork(input: unknown): { work: AvWork | null; issues: AvIssue[] } {
  const issues: AvIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  if (!isObj(input)) return { work: null, issues: [{ path: '', message: '作品必须是对象' }] };
  const w = input;
  const slug = str(w.slug);
  if (!AV_SLUG_RE.test(slug)) add('slug', '地址只能用小写字母、数字和连字符（2–40 个字符）');
  const kind = w.kind as AvKind;
  const kindOk = (AV_KINDS as readonly string[]).includes(kind as string);
  if (!kindOk) add('kind', '类型只能是视频或声音');
  const title = str(w.title);
  if (!title || title.length > 120) add('title', '标题必填，最多 120 字');
  const summary = str(w.summary);
  if (summary.length > 500) add('summary', '简介最多 500 字');
  const date = str(w.date);
  if (!validDate(date)) add('date', '日期格式是 YYYY-MM-DD');
  const status = w.status as AvStatus;
  if (!(AV_STATUSES as readonly string[]).includes(status as string)) add('status', '状态只能是草稿或已发布');
  const duration = num(w.duration);
  if (duration === null || duration <= 0 || duration > MAX_DURATION) add('duration', '时长必须是正数（秒，最长 6 小时）');
  const dur = duration ?? 0;
  const credit = str(w.credit);
  if (credit.length > 200) add('credit', '署名最多 200 字');

  let width: number | undefined;
  let height: number | undefined;
  let poster: AvPoster | undefined;
  if (kind === 'video') {
    if (w.width !== undefined || w.height !== undefined) {
      if (!posInt(w.width) || !posInt(w.height)) add('width', '视频宽高必须是正整数');
      else {
        width = w.width as number;
        height = w.height as number;
      }
    }
    if (!isObj(w.poster)) add('poster', '视频需要封面图');
    else {
      const p = w.poster;
      if (!safeMediaSrc(p.src)) add('poster.src', '封面地址只允许 https:// 或站内路径');
      const alt = str(p.alt);
      if (!alt || alt.length > 300) add('poster.alt', '封面需要替代文字（给看不见画面的读者）');
      if (!posInt(p.w) || !posInt(p.h)) add('poster.w', '封面宽高必须是正整数');
      poster = { src: str(p.src), alt, w: p.w as number, h: p.h as number };
    }
  }

  const sources: AvSource[] = [];
  if (!Array.isArray(w.sources) || !w.sources.length || w.sources.length > MAX_SOURCES) add('sources', `需要 1–${MAX_SOURCES} 个媒体来源`);
  else
    w.sources.forEach((s: unknown, i: number) => {
      if (!isObj(s)) return add(`sources.${i}`, '来源格式不对');
      const type = str(s.type);
      if (!kindOk || !AV_MIME[kind].includes(type)) add(`sources.${i}.type`, `不支持的格式：${type || '（空）'}`);
      if (!safeMediaSrc(s.src)) add(`sources.${i}.src`, '来源地址只允许 https:// 或站内路径');
      sources.push({ src: str(s.src), type });
    });

  const cues: Cue[] = [];
  if (!Array.isArray(w.cues) || !w.cues.length) add('cues', kind === 'audio' ? '声音作品需要文字稿' : '视频需要字幕');
  else if (w.cues.length > MAX_CUES) add('cues', `字幕最多 ${MAX_CUES} 条`);
  else {
    let sorted = true;
    w.cues.forEach((c: unknown, i: number) => {
      if (!isObj(c)) return add(`cues.${i}`, '字幕格式不对');
      const st = num(c.start);
      const en = num(c.end);
      const text = typeof c.text === 'string' ? c.text.trim() : '';
      if (st === null || en === null || st < 0 || en <= st) add(`cues.${i}`, '字幕时间不对：结束必须晚于开始');
      else if (duration !== null && en > dur + EPS) add(`cues.${i}`, '字幕超出作品时长');
      if (!text || text.length > 1000) add(`cues.${i}.text`, '字幕文字不能为空（最多 1000 字）');
      if (i > 0 && st !== null && cues[i - 1] && st < cues[i - 1]!.start) sorted = false;
      cues.push({ start: st ?? 0, end: en ?? 0, text });
    });
    if (!sorted) add('cues', '字幕需要按开始时间排序');
  }

  const chapters: Chapter[] = [];
  if (w.chapters !== undefined && !Array.isArray(w.chapters)) add('chapters', '章节必须是列表');
  else if (Array.isArray(w.chapters)) {
    if (w.chapters.length > MAX_CHAPTERS) add('chapters', `章节最多 ${MAX_CHAPTERS} 个`);
    w.chapters.forEach((c: unknown, i: number) => {
      if (!isObj(c)) return add(`chapters.${i}`, '章节格式不对');
      const t = num(c.t);
      const ctitle = str(c.title);
      if (t === null) add(`chapters.${i}.t`, '章节时间必须是数字');
      else if (i === 0 && t !== 0) add(`chapters.${i}.t`, '第一个章节从 0 秒开始');
      else if (i > 0 && chapters[i - 1] && t <= chapters[i - 1]!.t) add(`chapters.${i}.t`, '章节时间要严格递增');
      else if (duration !== null && t >= dur) add(`chapters.${i}.t`, '章节超出作品时长');
      if (!ctitle || ctitle.length > 80) add(`chapters.${i}.title`, '章节标题必填，最多 80 字');
      chapters.push({ t: t ?? 0, title: ctitle });
    });
  }

  if (issues.length) return { work: null, issues };
  const work: AvWork = {
    slug,
    kind,
    title,
    ...(summary ? { summary } : {}),
    date,
    status,
    duration: dur,
    ...(width && height ? { width, height } : {}),
    ...(poster ? { poster } : {}),
    ...(credit ? { credit } : {}),
    sources,
    chapters,
    cues,
  };
  return { work, issues };
}

// ---------------- 列表 ----------------

export function avSummary(w: AvWork): AvSummary {
  return {
    slug: w.slug,
    kind: w.kind,
    title: w.title,
    ...(w.summary ? { summary: w.summary } : {}),
    date: w.date,
    status: w.status,
    duration: w.duration,
    ...(w.poster ? { poster: w.poster } : {}),
    chapters: w.chapters.length,
    cues: w.cues.length,
  };
}

/** 日期倒序，同一天按 slug */
export function sortAvWorks<T extends { date: string; slug: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.date === b.date ? (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0) : a.date < b.date ? 1 : -1));
}
