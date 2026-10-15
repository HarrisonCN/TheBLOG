/**
 * L31 / v1.31.0 AI 创作台 2.0（web 与 worker 共用同一份文件，内容必须完全一致）。
 *
 * 规则：
 * - 站长默认关闭；开启后每月有调用预算（按 Asia/Shanghai 分月），用完返回 429；
 * - 只在作者点击时生成；任何建议都要作者确认后才会写进表单，AI 不会自己发布；
 * - 本地回退完全确定，只重排 / 改写作者自己写下的文字，不编造事实；
 * - 校对只给出「可以逐条采用」的修改，不自动改正文。
 */
import { draftOutline, extractiveSummary, sentencesOf, suggestTopics, AI_LABEL, AI_NOTE, type AiTopic, type Check } from './open-core';

export const AI2_KINDS = ['title', 'summary', 'alt', 'tags', 'proof', 'draft'] as const;
export type Ai2Kind = (typeof AI2_KINDS)[number];
export const AI2_KIND_LABEL: Record<Ai2Kind, string> = { title: '标题', summary: '摘要', alt: '替代文字', tags: '标签', proof: '校对', draft: '草稿提纲' };
export const AI_BUDGET_DEFAULT = 200;
export const AI_BUDGET_MAX = 100000;
export const AI2_LIMITS = { maxBody: 20000, maxTitle: 200, maxMeta: 500 };

const bad = <T>(path: string, error: string): Check<T> => ({ ok: false, path, error });

/** 预算按上海时间（UTC+8，无夏令时）分月：YYYY-MM。 */
export function aiMonth(d: Date): string {
  const s = new Date(d.getTime() + 8 * 3600_000);
  return `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface BudgetState { used: number; budget: number; left: number; exhausted: boolean }
export function budgetState(used: number, budget: number): BudgetState {
  return { used, budget, left: Math.max(0, budget - used), exhausted: used >= budget };
}

export interface AiConfigPatch { enabled?: boolean; monthlyBudget?: number }
export function checkAiConfig(input: unknown): Check<AiConfigPatch> {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const value: AiConfigPatch = {};
  if ('enabled' in o) {
    if (typeof o.enabled !== 'boolean') return bad('enabled', 'enabled 只能是 true / false');
    value.enabled = o.enabled;
  }
  if ('monthlyBudget' in o) {
    const b = o.monthlyBudget;
    if (typeof b !== 'number' || !Number.isInteger(b) || b < 0 || b > AI_BUDGET_MAX) return bad('monthlyBudget', `每月预算是 0–${AI_BUDGET_MAX} 的整数`);
    value.monthlyBudget = b;
  }
  if (!Object.keys(value).length) return bad('', '没有要修改的设置');
  return { ok: true, value };
}

export interface AltMeta { caption?: string; title?: string; place?: string; filename?: string }
export interface Ai2Input { kind: Ai2Kind; title: string; body: string; meta: AltMeta }
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export function checkAi2Input(input: unknown): Check<Ai2Input> {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (!AI2_KINDS.includes(o.kind as Ai2Kind)) return bad('kind', `kind 只能是 ${AI2_KINDS.join(' / ')}`);
  const kind = o.kind as Ai2Kind;
  const title = str(o.title, AI2_LIMITS.maxTitle);
  if (typeof o.body === 'string' && o.body.length > AI2_LIMITS.maxBody) return bad('body', '正文太长了');
  const body = typeof o.body === 'string' ? o.body : '';
  const m = (o.meta && typeof o.meta === 'object' ? o.meta : {}) as Record<string, unknown>;
  const meta: AltMeta = { caption: str(m.caption, AI2_LIMITS.maxMeta), title: str(m.title, AI2_LIMITS.maxTitle), place: str(m.place, 80), filename: str(m.filename, 200) };
  if (kind === 'alt') {
    if (!meta.caption && !meta.title && !meta.place && !meta.filename) return bad('meta', '替代文字需要图片说明、标题、地点或文件名中的至少一项');
    return { ok: true, value: { kind, title, body, meta } };
  }
  if ((title + body).replace(/\s+/g, '').length < 4) return bad('body', '先写几句内容，再请 AI 给建议');
  return { ok: true, value: { kind, title, body, meta } };
}

// ------------------------------------------------------------------ 校对
export type ProofRule = 'half-punct' | 'dup-word' | 'dup-punct';
export interface ProofIssue { id: string; start: number; end: number; found: string; replace: string; rule: ProofRule; message: string }
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
const HALF_TO_FULL: Record<string, string> = { ',': '，', '.': '。', ';': '；', ':': '：', '?': '？', '!': '！' };
/** 只检查功能词的误重复；「慢慢、看看、常常」这类叠词和「了了」「地地道道」这类成语不碰。 */
const DUP_WORDS = '的是在和与也都把被';
const RULE_MSG: Record<ProofRule, string> = {
  'half-punct': '中文句子里用了半角标点',
  'dup-word': '重复的字',
  'dup-punct': '重复的标点',
};

/** 代码（行内 / 代码块）与网址不参与校对。 */
function protectedRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const re of [/```[\s\S]*?(```|$)/g, /`[^`\n]*`/g, /https?:\/\/[^\s<>"'，。）)]+/g]) {
    for (let m = re.exec(text); m; m = re.exec(text)) {
      out.push([m.index, m.index + m[0].length]);
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return out;
}

export function proofread(text: string): ProofIssue[] {
  if (!text) return [];
  const prot = protectedRanges(text);
  const inProt = (a: number, b: number) => prot.some(([s, e]) => a < e && b > s);
  const issues: ProofIssue[] = [];
  const add = (start: number, found: string, replace: string, rule: ProofRule) => {
    const end = start + found.length;
    if (inProt(start, end)) return;
    issues.push({ id: `${rule}-${start}`, start, end, found, replace, rule, message: `${RULE_MSG[rule]}：「${found}」→「${replace}」` });
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const full = HALF_TO_FULL[c];
    if (!full) continue;
    const prev = text[i - 1] ?? '';
    const next = text[i + 1] ?? '';
    if (!CJK.test(prev)) continue;
    if (!(next === '' || next === '\n' || CJK.test(next) || /[“‘「『（]/.test(next))) continue;
    add(i, c, full, 'half-punct');
  }
  const dupWord = new RegExp(`([${DUP_WORDS}])\\1+`, 'g');
  for (let m = dupWord.exec(text); m; m = dupWord.exec(text)) add(m.index, m[0], m[1]!, 'dup-word');
  const dupPunct = /([，。、；：])\1+/g;
  for (let m = dupPunct.exec(text); m; m = dupPunct.exec(text)) add(m.index, m[0], m[1]!, 'dup-punct');
  return issues.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** 应用修改：只用 ids 里选中的（不给则全部）；越界、与原文对不上、或与前一条重叠的都跳过。 */
export function applyFixes(text: string, issues: ProofIssue[], ids?: string[]): string {
  const pick = (ids ? issues.filter((i) => ids.includes(i.id)) : issues).slice().sort((a, b) => a.start - b.start);
  let out = '';
  let pos = 0;
  for (const i of pick) {
    if (i.start < pos || i.end > text.length || i.start < 0 || text.slice(i.start, i.end) !== i.found) continue;
    out += text.slice(pos, i.start) + i.replace;
    pos = i.end;
  }
  return out + text.slice(pos);
}

// ------------------------------------------------------------------ 标题 / 替代文字
const TRAIL = /[\s，。！？、；：,.!?;:…]+$/u;
const TITLE_MAX = 28;
/** 标题候选：取作者自己的句子（去掉句末标点），最多 3 个，排除当前标题与重复；过长的截断加「…」。 */
export function suggestTitles(title: string, body: string): string[] {
  const cur = title.trim();
  const out: string[] = [];
  for (const raw of sentencesOf(body)) {
    let s = raw.replace(TRAIL, '').trim();
    if ([...s].length < 4) continue;
    if ([...s].length > TITLE_MAX) s = [...s].slice(0, TITLE_MAX - 1).join('').replace(TRAIL, '') + '…';
    if (s === cur || out.includes(s)) continue;
    out.push(s);
    if (out.length >= 3) break;
  }
  return out;
}

const CAMERA_FILE = /^(img|dsc|dscf|dscn|pxl|mvimg|gopr|dji|sam|wp|photo|image|screenshot|微信图片)[_\-\s]?\d|^[\d_\-\s]+$|^[0-9a-f]{8,}$/i;
const ALT_MAX = 200;
function firstSentence(s: string): string {
  return (s.split(/[。！？!?\n]/)[0] ?? '').replace(TRAIL, '').trim();
}
/** 替代文字只用给出的信息：说明 → 标题 → 有意义的文件名；再加地点。相机自动文件名不算信息。 */
export function suggestAlt(meta: AltMeta): string {
  let base = firstSentence(meta.caption ?? '') || firstSentence(meta.title ?? '');
  if (!base && meta.filename) {
    const stem = meta.filename.replace(/\.[a-z0-9]{2,5}$/i, '').trim();
    if (stem && !CAMERA_FILE.test(stem)) base = stem.replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const place = (meta.place ?? '').trim();
  const text = base && place ? `${base}，拍摄于${place}` : base || (place ? `拍摄于${place}` : '');
  return [...text].slice(0, ALT_MAX).join('');
}

// ------------------------------------------------------------------ 统一入口（本地确定性回退）
export interface Ai2Suggestion {
  kind: Ai2Kind; provider: string; label: string; note: string; generated: true;
  text: string; options: string[]; tags: { slug: string; name: string }[]; issues: ProofIssue[];
}
export function localSuggest2(inp: Ai2Input, topics: AiTopic[]): Ai2Suggestion {
  const base: Ai2Suggestion = { kind: inp.kind, provider: 'local', label: AI_LABEL, note: AI_NOTE, generated: true, text: '', options: [], tags: [], issues: [] };
  switch (inp.kind) {
    case 'title': {
      const options = suggestTitles(inp.title, inp.body);
      return { ...base, options, text: options[0] ?? '' };
    }
    case 'summary': return { ...base, text: extractiveSummary(inp.title, inp.body) };
    case 'alt': return { ...base, text: suggestAlt(inp.meta) };
    case 'tags': {
      const tags = suggestTopics(inp.title, inp.body, topics).map(({ slug, name }) => ({ slug, name }));
      return { ...base, tags, text: tags.map((t) => t.name).join('、') };
    }
    case 'proof': {
      const issues = proofread(inp.body);
      return { ...base, issues, text: issues.length ? `找到 ${issues.length} 处可以修改的地方` : '没有发现问题' };
    }
    default: return { ...base, text: draftOutline(inp.title, inp.body) };
  }
}
