/**
 * 影集 / 拍摄手记 / 正文嵌入块的共享规则（web 与 worker/src/essay-core.ts 是同一份文件，改动时两边一起改）。
 * - 影集（posts.kind = 'essay'）：版式 + 照片序列，每张照片有图注、EXIF 条和可选的拍摄手记。
 * - 拍摄手记：地点只写粗略地名（不接受坐标），光线 / 器材 / 参数 / 想法。
 * - 正文 :::map 只保存 0.1°（约 11 km）精度的坐标；:::audio 只接受 https 或本站上传的音频路径。
 * 校验是严格的：多余字段、超长、控制字符、尖括号、不安全的链接都会报错（路径形如 photos.2.exif.iso）。
 */

export type EssayLayout = 'grid' | 'single' | 'diptych';
export const ESSAY_LAYOUTS: readonly EssayLayout[] = ['grid', 'single', 'diptych'];
export const ESSAY_LAYOUT_LABEL: Record<EssayLayout, string> = { grid: '网格', single: '单列', diptych: '双联' };
export const POST_KINDS = ['post', 'essay'] as const;
export type PostKind = (typeof POST_KINDS)[number];
export const MAX_ESSAY_PHOTOS = 40;

export interface ShotNote {
  /** 粗略地名，例如「桂林 · 阳朔」；不写坐标 */
  place: string;
  light: string;
  gear: string;
  settings: string;
  thought: string;
}
export const SHOT_NOTE_KEYS: readonly (keyof ShotNote)[] = ['place', 'light', 'gear', 'settings', 'thought'];
export const SHOT_NOTE_LABEL: Record<keyof ShotNote, string> = { place: '地点', light: '光线', gear: '器材', settings: '参数', thought: '想法' };
const SHOT_NOTE_MAX: Record<keyof ShotNote, number> = { place: 40, light: 60, gear: 60, settings: 80, thought: 300 };
/** :::notes 块里允许的中文键名 */
const NOTE_ALIASES: Record<string, keyof ShotNote> = { 地点: 'place', 光线: 'light', 器材: 'gear', 参数: 'settings', 想法: 'thought' };

export interface EssayExif {
  camera: string;
  lens: string;
  focal: string;
  aperture: string;
  shutter: string;
  iso: string;
  date: string;
}
export const EXIF_KEYS: readonly (keyof EssayExif)[] = ['camera', 'lens', 'focal', 'aperture', 'shutter', 'iso', 'date'];
const TEXT_OK = /^[^\u0000-\u001f\u007f<>]*$/;
export const EXIF_RULES: Record<keyof EssayExif, readonly [RegExp, string, number]> = {
  camera: [TEXT_OK, '机身不能包含控制字符或尖括号', 40],
  lens: [TEXT_OK, '镜头不能包含控制字符或尖括号', 60],
  focal: [/^\d{1,4}(\.\d{1,2})? ?mm$/, '焦距格式：24mm', 20],
  aperture: [/^[fF]\/\d{1,2}(\.\d{1,2})?$/, '光圈格式：f/1.8', 20],
  shutter: [/^(1\/\d{1,5}|\d{1,4}(\.\d{1,2})?)s?$/, '快门格式：1/120s 或 2s', 20],
  iso: [/^\d{1,6}$/, 'ISO 只能是数字', 10],
  date: [/^\d{4}(-\d{2}(-\d{2}( \d{2}:\d{2})?)?)?$/, '拍摄时间格式：2026-09-12 或 2026-09-12 18:42', 20],
};

export interface EssayPhoto {
  src: string;
  alt: string;
  caption: string;
  /** 他人照片的署名（自己的照片留空） */
  credit: string;
  width: number;
  height: number;
  exif: EssayExif;
  notes: ShotNote | null;
  /** L25：从这张照片开始新的一章（章节标题，≤ 40 字；没有就不输出这个字段） */
  chapter?: string;
}
export interface Essay {
  layout: EssayLayout;
  photos: EssayPhoto[];
}

export interface Issue {
  path: string;
  message: string;
}

const SAFE_URL = /^(https:\/\/[^\s<>"'`]+|\/(?!\/)[^\s<>"'`]*)$/i;
const DATA_IMG = /^data:image\/(png|jpeg|webp|gif|avif);base64,[a-z0-9+/]+=*$/i;
/** 图片：https、站内路径（/api/images/…、/demo/…），或演示模式里的位图 data URL */
export function safeImageSrc(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!t) return null;
  if (DATA_IMG.test(t) && t.length <= 3_000_000) return t;
  return SAFE_URL.test(t) && t.length <= 2048 ? t : null;
}
/** 音频：https 链接，或本站上传的 /api/audio/YYYY/MM/uuid.ext（与音乐播放器队列的规则一致）。 */
const AUDIO_UPLOAD = /^\/api\/audio\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(mp3|m4a|ogg|flac|wav|webm)$/;
export function safeAudioSrc(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!t || t.length > 500) return null;
  return /^https:\/\/[^\s<>"'`\\]+$/i.test(t) || AUDIO_UPLOAD.test(t) ? t : null;
}
/** 链接：http(s) 或站内路径 */
export function safeLink(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t && /^(https?:\/\/[^\s<>"'`]+|\/(?!\/)[^\s<>"'`]*)$/i.test(t) && t.length <= 2048 ? t : null;
}

/** 看起来像坐标（含两位以上小数的数字或度分秒）→ 拒绝；拍摄手记只写地名。 */
export const LOOKS_LIKE_COORD = /\d+\.\d{2,}|\d+\s*°|\d+\s*[′']\s*\d|[-+]?\d{1,3}\.\d+\s*[,，]\s*[-+]?\d{1,3}\.\d+/;

function text(o: Record<string, unknown>, key: string, max: number, path: string, issues: Issue[], required = false): string {
  const v = o[key];
  if (v !== undefined && v !== null && typeof v !== 'string') {
    issues.push({ path: `${path}${key}`, message: '需要文字' });
    return '';
  }
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) issues.push({ path: `${path}${key}`, message: '必填' });
  if (s.length > max) issues.push({ path: `${path}${key}`, message: `最多 ${max} 个字符` });
  else if (!TEXT_OK.test(s)) issues.push({ path: `${path}${key}`, message: '不能包含控制字符或尖括号' });
  return s.slice(0, max);
}
function noExtra(o: Record<string, unknown>, allowed: readonly string[], path: string, issues: Issue[]): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) issues.push({ path: `${path}${k}`, message: '不支持的字段' });
}
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function emptyNote(): ShotNote {
  return { place: '', light: '', gear: '', settings: '', thought: '' };
}
export const noteIsEmpty = (n: ShotNote | null | undefined): boolean => !n || SHOT_NOTE_KEYS.every((k) => !n[k]);

/** 拍摄手记；全空返回 null。 */
export function validateShotNote(v: unknown, path = '', issues: Issue[] = []): { note: ShotNote | null; issues: Issue[] } {
  if (v === null || v === undefined) return { note: null, issues };
  if (!isObj(v)) {
    issues.push({ path: path.replace(/\.$/, '') || 'notes', message: '拍摄手记必须是对象' });
    return { note: null, issues };
  }
  noExtra(v, SHOT_NOTE_KEYS, path, issues);
  const n = emptyNote();
  for (const k of SHOT_NOTE_KEYS) n[k] = text(v, k, SHOT_NOTE_MAX[k], path, issues);
  if (n.place && LOOKS_LIKE_COORD.test(n.place)) issues.push({ path: `${path}place`, message: '地点只写粗略地名，不要填坐标' });
  return { note: noteIsEmpty(n) ? null : n, issues };
}

export function emptyExif(): EssayExif {
  return { camera: '', lens: '', focal: '', aperture: '', shutter: '', iso: '', date: '' };
}
export function validateExif(v: unknown, path: string, issues: Issue[]): EssayExif {
  const out = emptyExif();
  if (v === undefined || v === null) return out;
  if (!isObj(v)) {
    issues.push({ path: path.replace(/\.$/, ''), message: 'EXIF 必须是对象' });
    return out;
  }
  noExtra(v, EXIF_KEYS, path, issues);
  for (const k of EXIF_KEYS) {
    const raw = v[k];
    const s = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';
    if (raw !== undefined && raw !== null && typeof raw !== 'string' && typeof raw !== 'number') issues.push({ path: `${path}${k}`, message: '需要文字' });
    const [re, msg, max] = EXIF_RULES[k];
    if (s.length > max) issues.push({ path: `${path}${k}`, message: `最多 ${max} 个字符` });
    else if (s && !re.test(s)) issues.push({ path: `${path}${k}`, message: msg });
    out[k] = s.slice(0, max);
  }
  return out;
}

const PHOTO_KEYS = ['src', 'alt', 'caption', 'credit', 'width', 'height', 'exif', 'notes', 'chapter'] as const;
export const MAX_CHAPTER = 40;

/** 影集 JSON 的严格校验；null / undefined 返回 null（普通文章）。 */
export function validateEssay(v: unknown): { essay: Essay | null; issues: Issue[] } {
  const issues: Issue[] = [];
  if (v === null || v === undefined) return { essay: null, issues };
  if (!isObj(v)) return { essay: null, issues: [{ path: 'essay', message: '影集必须是对象' }] };
  noExtra(v, ['layout', 'photos'], '', issues);
  const layout = (ESSAY_LAYOUTS as readonly unknown[]).includes(v.layout) ? (v.layout as EssayLayout) : 'single';
  if (v.layout !== undefined && layout !== v.layout) issues.push({ path: 'layout', message: '版式只能是 grid / single / diptych' });
  const list = Array.isArray(v.photos) ? v.photos : [];
  if (!Array.isArray(v.photos)) issues.push({ path: 'photos', message: 'photos 必须是数组' });
  if (list.length > MAX_ESSAY_PHOTOS) issues.push({ path: 'photos', message: `最多 ${MAX_ESSAY_PHOTOS} 张照片` });
  const photos: EssayPhoto[] = list.slice(0, MAX_ESSAY_PHOTOS).map((raw: unknown, i: number) => {
    const p = `photos.${i}.`;
    const o = isObj(raw) ? raw : {};
    if (!isObj(raw)) issues.push({ path: `photos.${i}`, message: '照片必须是对象' });
    noExtra(o, PHOTO_KEYS, p, issues);
    const src = safeImageSrc(o.src);
    if (!src) issues.push({ path: `${p}src`, message: '图片只允许 https 链接或本站上传的路径' });
    const alt = text(o, 'alt', 120, p, issues);
    const caption = text(o, 'caption', 200, p, issues);
    const credit = text(o, 'credit', 200, p, issues);
    const dim = (k: 'width' | 'height') => {
      const n = o[k] === undefined ? 0 : o[k];
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 20000) {
        issues.push({ path: `${p}${k}`, message: '需要 0–20000 的整数' });
        return 0;
      }
      return n;
    };
    const width = dim('width');
    const height = dim('height');
    const exif = validateExif(o.exif, `${p}exif.`, issues);
    const notes = validateShotNote(o.notes, `${p}notes.`, issues).note;
    const chapter = text(o, 'chapter', MAX_CHAPTER, p, issues);
    return { src: src ?? '', alt, caption, credit, width, height, exif, notes, ...(chapter ? { chapter } : {}) };
  });
  if (!photos.length && Array.isArray(v.photos)) issues.push({ path: 'photos', message: '影集至少需要 1 张照片' });
  return { essay: { layout, photos }, issues };
}

/** 一行 EXIF：「iPhone 15 Pro · 26mm · f/1.8 · 1/120s · ISO 64」 */
export function exifLine(x: Partial<EssayExif> | null | undefined): string {
  if (!x) return '';
  const shutter = x.shutter ? (/s$/.test(x.shutter) ? x.shutter : `${x.shutter}s`) : '';
  return [x.camera, x.lens, x.focal, x.aperture, shutter, x.iso ? `ISO ${x.iso}` : ''].filter(Boolean).join(' · ');
}

/** :::notes 块：每行「键: 值」，键可以是 place/light/gear/settings/thought 或 地点/光线/器材/参数/想法。 */
export function parseNotesBlock(body: string): { note: ShotNote | null; issues: Issue[] } {
  const o: Record<string, string> = {};
  const issues: Issue[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z\u4e00-\u9fff]+)\s*[:：]\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = (NOTE_ALIASES[m[1]!] ?? m[1]!.toLowerCase()) as keyof ShotNote;
    if (!SHOT_NOTE_KEYS.includes(key)) {
      issues.push({ path: m[1]!, message: '不支持的手记字段' });
      continue;
    }
    o[key] = o[key] ? `${o[key]} ${m[2]!.trim()}` : m[2]!.trim();
  }
  const r = validateShotNote(o, '', issues);
  return r;
}

/** 坐标粗化到 0.1°（约 11 km）；非法返回 null。 */
export function coarsen(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const a = typeof lat === 'number' ? lat : typeof lat === 'string' && lat.trim() ? Number(lat) : NaN;
  const b = typeof lng === 'number' ? lng : typeof lng === 'string' && lng.trim() ? Number(lng) : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  const r = (n: number) => Math.round(n * 10) / 10 + 0; // +0 去掉 -0
  return { lat: r(a), lng: r(b) };
}

/** :::map 地名 + 下一行「纬度, 经度」→ 粗化后的点；地名必填且不能是坐标。 */
export function parseMapBlock(title: string, body: string): { place: string; lat: number; lng: number } | null {
  const place = title.trim().slice(0, 40);
  if (!place || !TEXT_OK.test(place) || LOOKS_LIKE_COORD.test(place)) return null;
  const m = /^\s*([-+]?\d{1,3}(?:\.\d+)?)\s*[,，\s]\s*([-+]?\d{1,3}(?:\.\d+)?)\s*$/m.exec(body);
  if (!m) return null;
  const c = coarsen(m[1], m[2]);
  return c ? { place, ...c } : null;
}

export interface AudioEmbed {
  src: string;
  title: string;
  artist: string;
  credit: string;
  link: string;
}
/** :::audio 块：src / title / artist / credit / link 五个键（中英文冒号都行）。 */
export function parseAudioBlock(body: string): AudioEmbed | null {
  const o: Record<string, string> = {};
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s*(src|title|artist|credit|link)\s*[:：]\s*(.+?)\s*$/i.exec(line);
    if (m) o[m[1]!.toLowerCase()] = m[2]!;
  }
  const src = safeAudioSrc(o.src);
  if (!src) return null;
  const clean = (s: string | undefined, max: number) => ((s ?? '').trim().slice(0, max).match(TEXT_OK) ? (s ?? '').trim().slice(0, max) : '');
  return { src, title: clean(o.title, 80) || '音频', artist: clean(o.artist, 60), credit: clean(o.credit, 120), link: safeLink(o.link) ?? '' };
}

/** :::quote 来源 | 链接 → 来源文字（≤80）和可选链接 */
export function parseQuoteSource(title: string): { source: string; link: string } {
  const [s, l] = title.split('|').map((x) => x.trim());
  const source = (s ?? '').slice(0, 80);
  return { source: TEXT_OK.test(source) ? source : '', link: safeLink(l) ?? '' };
}

/** 引用卡片：把一段文字按最大宽度折行（measure 由调用方给，canvas 用 ctx.measureText，测试里用字符数）。 */
export function wrapText(s: string, maxWidth: number, measure: (t: string) => number, maxLines = 12): string[] {
  const lines: string[] = [];
  for (const para of s.split(/\n+/)) {
    let line = '';
    // CJK 逐字断行，拉丁词整词断行
    const tokens = para.match(/[\u3000-\u9fff\uff00-\uffef]|[^\s\u3000-\u9fff\uff00-\uffef]+\s*|\s+/g) ?? [];
    for (const t of tokens) {
      if (measure(line + t) > maxWidth && line) {
        lines.push(line.trimEnd());
        line = t.trimStart();
      } else line += t;
      if (lines.length >= maxLines) break;
    }
    if (line && lines.length < maxLines) lines.push(line.trimEnd());
    if (lines.length >= maxLines) break;
  }
  if (lines.length >= maxLines) lines[maxLines - 1] = lines[maxLines - 1]!.replace(/.$/, '…');
  return lines.slice(0, maxLines);
}

/**
 * 文章的「类型 / 影集 / 文章级拍摄手记」三个字段一起校验（Worker 与演示 mock 共用）。
 * - 创建时缺省 kind = 'post'；更新时缺省沿用 current。
 * - kind = 'essay' 必须带至少 1 张照片的影集；kind = 'post' 时影集被清空（不保留孤儿数据）。
 */
export function validatePostMedia(
  input: { kind?: unknown; essay?: unknown; notes?: unknown },
  current?: { kind: PostKind; essay: Essay | null; notes: ShotNote | null },
): { kind: PostKind; essay: Essay | null; notes: ShotNote | null; issues: Issue[] } {
  const issues: Issue[] = [];
  let kind: PostKind = current?.kind ?? 'post';
  if (input.kind !== undefined) {
    if ((POST_KINDS as readonly unknown[]).includes(input.kind)) kind = input.kind as PostKind;
    else issues.push({ path: 'kind', message: '类型只能是 post / essay' });
  }
  let essay = current?.essay ?? null;
  if (input.essay !== undefined) {
    const r = validateEssay(input.essay);
    for (const i of r.issues) issues.push({ path: `essay.${i.path}`.replace(/\.$/, ''), message: i.message });
    essay = r.essay;
  }
  let notes = current?.notes ?? null;
  if (input.notes !== undefined) {
    const r = validateShotNote(input.notes, 'notes.');
    issues.push(...r.issues);
    notes = r.note;
  }
  if (kind === 'essay' && !essay?.photos.length && !issues.some((i) => i.path.startsWith('essay'))) issues.push({ path: 'essay', message: '影集至少需要 1 张照片' });
  if (kind === 'post') essay = null;
  return { kind, essay, notes, issues };
}
