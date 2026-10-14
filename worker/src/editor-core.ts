/**
 * L24 / v1.24.0 内容编辑器 2.0 —— 纯函数核心（Worker 与前端逐字相同：worker/src/editor-core.ts）。
 *
 *  - 模块化正文：Markdown ⇄ 块（段落 / 标题 / 引用 / 列表 / 代码 / 图片 / 提示块 / 分割线 / 原样块），往返无损；
 *  - 发布前检查：图片缺替代文字、标题跳级、空块；
 *  - 自动保存与草稿恢复：草稿修订号（rev）+ 基线修订号（baseRev）判断冲突；本机草稿比文章新时提示恢复；
 *  - 定时发布：时间校验（至少 1 分钟后、最多 365 天内，精确到分钟）；
 *  - 内容模板；
 *  - 媒体库：图片多尺寸（640 / 1280 / 1920，不放大）与 srcset；替代文字校验；
 *  - 字数与阅读时间；发布预览数据。
 * 不碰 DOM、不读时钟（时间由调用方传入），浏览器、Worker 和测试共用。
 */

// ---------------------------------------------------------------- 块
export const BLOCK_TYPES = ['paragraph', 'heading', 'quote', 'list', 'code', 'image', 'callout', 'divider', 'raw'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];
export const CALLOUT_KINDS = ['tip', 'warn', 'note'] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

export interface Block {
  type: BlockType;
  /** 段落 / 标题 / 引用 / 代码 / 提示块正文；列表每行一项；原样块是原文 */
  text: string;
  /** 标题级别 1–6 */
  level?: number;
  /** 有序列表 */
  ordered?: boolean;
  /** 代码语言 */
  lang?: string;
  /** 提示块类型与标题 */
  kind?: CalloutKind;
  title?: string;
  /** 图片 */
  alt?: string;
  src?: string;
}

export const BLOCK_LABELS: Record<BlockType, string> = {
  paragraph: '段落',
  heading: '标题',
  quote: '引用',
  list: '列表',
  code: '代码',
  image: '图片',
  callout: '提示块',
  divider: '分割线',
  raw: '原样块',
};

/** 统一换行、去掉首尾空行、块之间只留一个空行（代码围栏和 ::: 块内部原样保留） */
export function normalizeMarkdown(md: string): string {
  return splitChunks(md).join('\n\n');
}

/** 把 Markdown 切成块的原文（空行分隔；``` 围栏与 ::: 容器内的空行不算分隔） */
export function splitChunks(md: string): string[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const chunks: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length) chunks.push(cur.join('\n'));
    cur = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^(```|~~~)/.exec(line);
    if (fence) {
      flush();
      // 围栏：一直读到同样的结束标记（没有结束标记就读到文末）
      cur.push(line);
      for (i++; i < lines.length; i++) {
        cur.push(lines[i]!);
        if (lines[i]!.startsWith(fence[1]!) && lines[i]!.trim() === fence[1]) break;
      }
      flush();
      continue;
    }
    if (/^:::\S/.test(line) && !cur.length) {
      // 容器块（:::tip / :::quote / :::compare …）：读到单独一行 ::: 为止，支持嵌套
      let depth = 0;
      for (; i < lines.length; i++) {
        const l = lines[i]!;
        cur.push(l);
        if (/^:::\S/.test(l)) depth++;
        else if (l.trim() === ':::') {
          depth--;
          if (depth === 0) break;
        }
      }
      flush();
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    cur.push(line);
  }
  flush();
  return chunks;
}

function classify(chunk: string): Block {
  const lines = chunk.split('\n');
  let m: RegExpExecArray | null;
  if ((m = /^```([^\n`]*)\n([\s\S]*)\n```$/.exec(chunk))) return { type: 'code', lang: m[1]!, text: m[2]! };
  if (chunk === '```' || /^```[^\n`]*\n```$/.test(chunk)) {
    const lang = /^```([^\n`]*)/.exec(chunk)![1]!;
    if (chunk === `\`\`\`${lang}\n\`\`\``) return { type: 'code', lang, text: '' };
  }
  if ((m = /^:::(tip|warn|note)(?: ([^\n]*))?\n([\s\S]*)\n:::$/.exec(chunk)) && !/\n:::/.test(m[3]!) && !/^:::/m.test(m[3]!)) {
    const title = m[2];
    const b: Block = { type: 'callout', kind: m[1] as CalloutKind, text: m[3]! };
    if (title !== undefined) b.title = title;
    if (blockToMarkdown(b) === chunk) return b;
  }
  if (lines.length === 1) {
    if ((m = /^(#{1,6}) (\S.*)$/.exec(chunk))) return { type: 'heading', level: m[1]!.length, text: m[2]! };
    if (chunk === '---') return { type: 'divider', text: '' };
    if ((m = /^!\[([^\]\n]*)\]\((\S+?)\)$/.exec(chunk))) return { type: 'image', alt: m[1]!, src: m[2]!, text: '' };
  }
  if (lines.every((l) => /^> /.test(l) || l === '>')) return { type: 'quote', text: lines.map((l) => (l === '>' ? '' : l.slice(2))).join('\n') };
  if (lines.every((l) => /^- \S/.test(l))) return { type: 'list', ordered: false, text: lines.map((l) => l.slice(2)).join('\n') };
  if (lines.every((l, i) => l.startsWith(`${i + 1}. `) && /\S/.test(l.slice(`${i + 1}. `.length, `${i + 1}. `.length + 1)))) {
    return { type: 'list', ordered: true, text: lines.map((l, i) => l.slice(`${i + 1}. `.length)).join('\n') };
  }
  // 表格、HTML、嵌套列表、其他容器块、缩进代码……原样保留
  if (/^(:::|<|\||```|~~~|#|[*+-] |\d+\. |>| {4}|\t)/.test(chunk) || chunk === '***' || /^-{3,}$/.test(chunk)) return { type: 'raw', text: chunk };
  return { type: 'paragraph', text: chunk };
}

export function parseBlocks(md: string): Block[] {
  return splitChunks(md).map(classify);
}

export function blockToMarkdown(b: Block): string {
  switch (b.type) {
    case 'heading':
      return `${'#'.repeat(Math.min(6, Math.max(1, b.level ?? 2)))} ${oneLine(b.text)}`;
    case 'quote':
      return b.text.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
    case 'list':
      return b.text.split('\n').filter((l) => l.trim()).map((l, i) => `${b.ordered ? `${i + 1}.` : '-'} ${l.replace(/^\s+/, '')}`).join('\n');
    case 'code':
      return `\`\`\`${oneLine(b.lang ?? '')}\n${b.text}${b.text ? '\n' : ''}\`\`\``;
    case 'image':
      return `![${(b.alt ?? '').replace(/[[\]\n]/g, '')}](${(b.src ?? '').replace(/\s/g, '')})`;
    case 'callout':
      return `:::${b.kind ?? 'tip'}${b.title !== undefined ? ` ${oneLine(b.title)}` : ''}\n${b.text}\n:::`;
    case 'divider':
      return '---';
    default:
      return b.text;
  }
}
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ');

export function blocksToMarkdown(blocks: Block[]): string {
  return blocks.map(blockToMarkdown).filter((s) => s.trim() !== '').join('\n\n');
}

/** 新块的默认内容 */
export function newBlock(type: BlockType): Block {
  switch (type) {
    case 'heading':
      return { type, level: 2, text: '小标题' };
    case 'list':
      return { type, ordered: false, text: '第一项\n第二项' };
    case 'code':
      return { type, lang: 'ts', text: '// 代码' };
    case 'image':
      return { type, src: 'https://', alt: '', text: '' };
    case 'callout':
      return { type, kind: 'tip', title: '提示', text: '要点写在这里。' };
    case 'divider':
      return { type, text: '' };
    case 'quote':
      return { type, text: '引用的话。' };
    default:
      return { type: type === 'raw' ? 'raw' : 'paragraph', text: '新的段落。' };
  }
}

export function moveBlock(blocks: Block[], index: number, dir: -1 | 1): Block[] {
  const to = index + dir;
  if (index < 0 || index >= blocks.length || to < 0 || to >= blocks.length) return blocks;
  const next = blocks.slice();
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}
export function insertBlock(blocks: Block[], after: number, b: Block): Block[] {
  const at = Math.min(Math.max(after + 1, 0), blocks.length);
  return [...blocks.slice(0, at), b, ...blocks.slice(at)];
}
export function removeBlock(blocks: Block[], index: number): Block[] {
  return blocks.filter((_, i) => i !== index);
}

/** 大纲里显示的一行摘要 */
export function blockSummary(b: Block, max = 36): string {
  const raw =
    b.type === 'image' ? b.alt || b.src || '' : b.type === 'divider' ? '———' : b.type === 'callout' ? `${b.title ?? ''} ${b.text}` : b.type === 'code' ? `${b.lang ? `${b.lang} · ` : ''}${b.text}` : b.text;
  const s = raw.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export interface BlockIssue {
  index: number;
  level: 'error' | 'warn';
  message: string;
}
/** 发布前检查 */
export function checkBlocks(blocks: Block[]): BlockIssue[] {
  const out: BlockIssue[] = [];
  let prevLevel = 1; // 文章标题是 h1
  blocks.forEach((b, i) => {
    if (b.type === 'image') {
      if (!(b.alt ?? '').trim()) out.push({ index: i, level: 'error', message: '图片缺少替代文字' });
      if (!/^(https:\/\/\S+|\/api\/images\/\S+|data:image\/)/.test(b.src ?? '')) out.push({ index: i, level: 'error', message: '图片地址必须是 https:// 或站内图片' });
    }
    if (b.type === 'heading') {
      const lv = b.level ?? 2;
      if (lv === 1) out.push({ index: i, level: 'warn', message: '正文里不要用一级标题（文章标题已经是一级）' });
      else if (lv > prevLevel + 1) out.push({ index: i, level: 'warn', message: `标题从 ${prevLevel} 级跳到了 ${lv} 级` });
      prevLevel = lv;
      if (!b.text.trim()) out.push({ index: i, level: 'error', message: '空标题' });
    }
    if ((b.type === 'paragraph' || b.type === 'quote' || b.type === 'list' || b.type === 'callout') && !b.text.trim()) out.push({ index: i, level: 'warn', message: `空的${BLOCK_LABELS[b.type]}` });
  });
  return out;
}

// ---------------------------------------------------------------- 字数与阅读时间
export function textStats(md: string): { chars: number; minutes: number; blocks: number } {
  const plain = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^:::.*$/gm, ' ')
    .replace(/[#>*_`~|-]/g, ' ');
  const cjk = (plain.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const words = (plain.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').match(/[A-Za-z0-9]+(?:['’][A-Za-z]+)?/g) ?? []).length;
  const chars = cjk + words;
  return { chars, minutes: chars ? Math.max(1, Math.ceil(chars / 400)) : 0, blocks: splitChunks(md).length };
}

// ---------------------------------------------------------------- 草稿 / 自动保存 / 恢复
export const DRAFT_LIMITS = { titleMax: 200, markdownMax: 200_000, keyMax: 90, autosaveMs: 1500 } as const;
export interface DraftSnapshot {
  key: string;
  title: string;
  markdown: string;
  /** 服务器上的修订号（还没同步过 = 0） */
  rev: number;
  savedAt: string;
}
/** 草稿键：已有文章用 post:<slug>，新文章用 new */
export function draftKey(slug: string | null | undefined): string {
  return slug ? `post:${slug}` : 'new';
}
export function isDraftKey(k: string): boolean {
  return k === 'new' || /^post:[a-z0-9]+(-[a-z0-9]+)*$/.test(k) && k.length <= DRAFT_LIMITS.keyMax;
}
export type DraftCheck = { ok: true; title: string; markdown: string } | { ok: false; field: string; message: string };
export function validateDraft(input: unknown): DraftCheck {
  const o = (input ?? {}) as { title?: unknown; markdown?: unknown };
  if (typeof o.title !== 'string') return { ok: false, field: 'title', message: '标题必须是字符串' };
  if (typeof o.markdown !== 'string') return { ok: false, field: 'markdown', message: '正文必须是字符串' };
  if (o.title.length > DRAFT_LIMITS.titleMax) return { ok: false, field: 'title', message: `标题最多 ${DRAFT_LIMITS.titleMax} 字` };
  if (o.markdown.length > DRAFT_LIMITS.markdownMax) return { ok: false, field: 'markdown', message: `正文最多 ${DRAFT_LIMITS.markdownMax} 字符` };
  return { ok: true, title: o.title, markdown: o.markdown.replace(/\r\n?/g, '\n') };
}
/** 服务器写草稿：baseRev 必须等于当前修订号，否则冲突（别的标签页 / 设备改过） */
export function resolveDraftWrite(serverRev: number | null, baseRev: number): { ok: true; rev: number } | { ok: false; serverRev: number } {
  const cur = serverRev ?? 0;
  return baseRev === cur ? { ok: true, rev: cur + 1 } : { ok: false, serverRev: cur };
}
/** 打开编辑器时：本机草稿和文章当前内容不同、且比文章新 → 提示恢复 */
export function shouldOfferRecovery(local: DraftSnapshot | null, current: { title: string; markdown: string; updatedAt?: string | null }): boolean {
  if (!local) return false;
  if (local.title === current.title && normalizeMarkdown(local.markdown) === normalizeMarkdown(current.markdown)) return false;
  if (!local.title.trim() && !local.markdown.trim()) return false;
  return !current.updatedAt || local.savedAt > current.updatedAt;
}
/** 两份草稿都在时用哪份：新的那份；时间一样时用服务器的 */
export function pickNewer(local: DraftSnapshot | null, server: DraftSnapshot | null): DraftSnapshot | null {
  if (!local) return server;
  if (!server) return local;
  return local.savedAt > server.savedAt ? local : server;
}

// ---------------------------------------------------------------- 定时发布
export const SCHEDULE_LIMITS = { minLeadMs: 60_000, maxDays: 365 } as const;
export type ScheduleCheck = { ok: true; at: string | null } | { ok: false; message: string };
/** null / '' = 取消定时；否则必须是带时区的 ISO 时间，精确到分钟（秒舍去） */
export function validateSchedule(input: unknown, nowMs: number): ScheduleCheck {
  if (input === null || input === '') return { ok: true, at: null };
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(input)) return { ok: false, message: '时间格式不对（需要带时区的 ISO 时间）' };
  const t = Date.parse(input);
  if (!Number.isFinite(t)) return { ok: false, message: '时间格式不对（需要带时区的 ISO 时间）' };
  const at = Math.floor(t / 60_000) * 60_000;
  if (at < nowMs + SCHEDULE_LIMITS.minLeadMs) return { ok: false, message: '定时发布的时间至少要在 1 分钟之后' };
  if (at > nowMs + SCHEDULE_LIMITS.maxDays * 86_400_000) return { ok: false, message: `最多只能定在 ${SCHEDULE_LIMITS.maxDays} 天以内` };
  return { ok: true, at: new Date(at).toISOString() };
}
/** <input type="datetime-local"> 的值 + 本地时区偏移（分钟，Date#getTimezoneOffset 的值）→ ISO */
export function fromLocalInput(value: string, tzOffsetMin: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const utc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!) + tzOffsetMin * 60_000;
  return new Date(utc).toISOString();
}
/** ISO → datetime-local 的值（本地时区） */
export function toLocalInput(iso: string, tzOffsetMin: number): string {
  const d = new Date(Date.parse(iso) - tzOffsetMin * 60_000);
  return d.toISOString().slice(0, 16);
}
/** 到点该发布的草稿 */
export function duePosts<T extends { status: string; publishAt: string | null }>(rows: T[], nowIso: string): T[] {
  return rows.filter((r) => r.status === 'draft' && !!r.publishAt && r.publishAt <= nowIso);
}

// ---------------------------------------------------------------- 内容模板
export interface ContentTemplate {
  id: string;
  label: string;
  desc: string;
  category: string;
  tags: string[];
  markdown: string;
}
export const TEMPLATES: ContentTemplate[] = [
  {
    id: 'tech-note',
    label: '技术笔记',
    desc: '背景 → 做法 → 结果，带代码块和小结',
    category: '技术',
    tags: ['笔记'],
    markdown: '## 背景\n\n遇到了什么问题，为什么要解决它。\n\n## 做法\n\n```ts\n// 关键代码\n```\n\n## 结果\n\n效果如何，还有什么没做完。\n\n:::tip 小结\n一句话总结这篇笔记。\n:::',
  },
  {
    id: 'photo-diary',
    label: '影集手记',
    desc: '一组照片 + 拍摄背景与参数',
    category: '摄影',
    tags: ['摄影'],
    markdown: '## 那天\n\n在哪里、什么天气、为什么出门。\n\n![照片说明](https://)\n\n## 拍摄参数\n\n- 机身 / 手机：\n- 焦距 / 光圈 / 快门 / ISO：\n\n> 想留住的那一刻。',
  },
  {
    id: 'shelf-review',
    label: '书影音短评',
    desc: '一句话推荐、喜欢的地方、摘抄',
    category: '书影音',
    tags: ['书影音'],
    markdown: '## 一句话推荐\n\n适合谁、什么时候看。\n\n## 喜欢的地方\n\n1. 第一点\n2. 第二点\n\n:::quote\n摘抄一句。\n:::',
  },
  {
    id: 'weekly',
    label: '周记',
    desc: '这周做了什么、读了什么、下周计划',
    category: '生活',
    tags: ['周记'],
    markdown: '## 这周做了\n\n- \n\n## 在读 / 在看\n\n- \n\n## 下周计划\n\n- [ ] ',
  },
];
export function findTemplate(id: string): ContentTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
/** 套用模板：正文为空时替换，否则追加在末尾；标签取并集；分类只在空时填入；标题不动 */
export function applyTemplate(t: ContentTemplate, cur: { title: string; markdown: string; tags: string[]; category: string }): { title: string; markdown: string; tags: string[]; category: string } {
  const md = cur.markdown.trim() ? `${normalizeMarkdown(cur.markdown)}\n\n${t.markdown}` : t.markdown;
  return { title: cur.title, markdown: md, tags: [...new Set([...cur.tags, ...t.tags])], category: cur.category.trim() ? cur.category : t.category };
}

// ---------------------------------------------------------------- 媒体库 / 多尺寸
export const VARIANT_WIDTHS = [640, 1280, 1920] as const;
export const MEDIA_LIMITS = { altMax: 200, perPage: 60 } as const;
export interface Variant {
  width: number;
  height: number;
}
/** 需要生成的尺寸：只缩小不放大；原图比最小档还小时只保留原图 */
export function planVariants(width: number, height: number): Variant[] {
  if (!(width > 0 && height > 0)) return [];
  const out = VARIANT_WIDTHS.filter((w) => w < width).map((w) => ({ width: w, height: Math.max(1, Math.round((height * w) / width)) }));
  return [...out, { width, height }];
}
export function srcsetOf(variants: { width: number; url: string }[]): string {
  return variants
    .slice()
    .sort((a, b) => a.width - b.width)
    .filter((v, i, a) => i === 0 || a[i - 1]!.width !== v.width)
    .map((v) => `${v.url} ${v.width}w`)
    .join(', ');
}
export const SIZES_ATTR = '(max-width: 768px) 100vw, 768px';
export interface MediaAsset {
  id: number;
  url: string;
  alt: string;
  width: number;
  height: number;
  bytes: number;
  variants: { width: number; url: string }[];
  createdAt: string;
}
const MEDIA_URL = /^(https:\/\/[^\s"'<>]{1,500}|\/api\/images\/[A-Za-z0-9/._-]{1,200}|data:image\/(png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/=]+)$/;
export function isMediaUrl(u: unknown): u is string {
  return typeof u === 'string' && MEDIA_URL.test(u);
}
export function cleanAlt(a: unknown): string | null {
  if (typeof a !== 'string') return null;
  const s = a.replace(/[\r\n\t]+/g, ' ').replace(/[[\]]/g, '').trim();
  return s.length <= MEDIA_LIMITS.altMax ? s : null;
}
export type MediaCheck = { ok: true; value: Omit<MediaAsset, 'id' | 'createdAt'> } | { ok: false; field: string; message: string };
export function validateMedia(input: unknown): MediaCheck {
  const o = (input ?? {}) as Record<string, unknown>;
  if (!isMediaUrl(o.url)) return { ok: false, field: 'url', message: '图片地址必须是 https:// 或站内图片' };
  const alt = cleanAlt(o.alt ?? '');
  if (alt === null) return { ok: false, field: 'alt', message: `替代文字最多 ${MEDIA_LIMITS.altMax} 字` };
  const int = (v: unknown, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : null);
  const width = int(o.width ?? 0, 20000);
  const height = int(o.height ?? 0, 20000);
  const bytes = int(o.bytes ?? 0, 50_000_000);
  if (width === null || height === null || bytes === null) return { ok: false, field: 'width', message: '尺寸必须是整数' };
  const raw = Array.isArray(o.variants) ? o.variants : [];
  if (raw.length > VARIANT_WIDTHS.length + 1) return { ok: false, field: 'variants', message: '尺寸太多' };
  const variants: { width: number; url: string }[] = [];
  for (const v of raw) {
    const vv = (v ?? {}) as { width?: unknown; url?: unknown };
    const w = int(vv.width, 20000);
    if (!w || !isMediaUrl(vv.url)) return { ok: false, field: 'variants', message: '尺寸条目不对' };
    variants.push({ width: w, url: vv.url });
  }
  return { ok: true, value: { url: o.url as string, alt, width, height, bytes, variants } };
}
/** 插入正文用的 Markdown（替代文字为空时用占位，发布前检查会提醒） */
export function mediaMarkdown(a: Pick<MediaAsset, 'url' | 'alt'>): string {
  return `![${a.alt.replace(/[[\]\n]/g, '')}](${a.url})`;
}
export function searchMedia<T extends Pick<MediaAsset, 'alt' | 'url'>>(items: T[], q: string): T[] {
  const s = q.trim().toLowerCase();
  return s ? items.filter((x) => x.alt.toLowerCase().includes(s) || x.url.toLowerCase().includes(s)) : items;
}

// ---------------------------------------------------------------- 发布预览
export const PREVIEW_KEY = 'blog-editor-preview';
export interface PreviewPayload {
  title: string;
  summary: string;
  markdown: string;
  tags: string[];
  category: string;
  coverUrl: string;
  savedAt: string;
}
export function parsePreview(raw: string | null): PreviewPayload | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<PreviewPayload>;
    if (typeof o.title !== 'string' || typeof o.markdown !== 'string' || typeof o.savedAt !== 'string') return null;
    return {
      title: o.title.slice(0, DRAFT_LIMITS.titleMax),
      summary: typeof o.summary === 'string' ? o.summary.slice(0, 500) : '',
      markdown: o.markdown.slice(0, DRAFT_LIMITS.markdownMax),
      tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === 'string').slice(0, 20) : [],
      category: typeof o.category === 'string' ? o.category.slice(0, 30) : '',
      coverUrl: typeof o.coverUrl === 'string' && isMediaUrl(o.coverUrl) ? o.coverUrl : '',
      savedAt: o.savedAt,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 公开的「即将发布」列表
export interface UpcomingPost {
  slug: string;
  title: string;
  category: string;
  publishAt: string;
}
export const UPCOMING_MAX = 20;
