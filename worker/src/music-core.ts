/**
 * 音乐小部件的共享规则（web 与 worker/src/music-core.ts 是同一份文件，改动时两边一起改）。
 * - 站长歌单（site_content key "playlist"）的严格校验：只允许 https 链接或本站上传的音频路径，字段有长度上限，不接受多余字段。
 * - 音频上传：按文件头确认类型（只收音频），大小上限 20 MB。
 * - 访客队列（localStorage）读回时的清洗：来源不明 / 链接不安全的条目直接丢掉。
 */

export type TrackSource = 'site' | 'openverse' | 'archive' | 'itunes';
export const TRACK_SOURCES: readonly TrackSource[] = ['site', 'openverse', 'archive', 'itunes'];

/** 播放器里的一首歌（搜索结果、站长歌单、访客队列都用这个形状）。 */
export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  /** 音频地址：https 链接，或本站上传的 /api/audio/… */
  src: string;
  cover: string;
  /** 秒；0 = 未知 */
  duration: number;
  source: TrackSource;
  /** true = 只有 30 秒试听（iTunes） */
  preview: boolean;
  /** 许可证标签，例如 "CC BY 4.0" */
  license: string;
  licenseUrl: string;
  /** 来源页面（署名 / 出处链接） */
  link: string;
  /** 平台名，例如 Jamendo、Internet Archive、Apple Music */
  provider: string;
}

/** 站长歌单条目（存进 site_content.playlist）。 */
export interface PlaylistItem {
  id: string;
  title: string;
  artist: string;
  album: string;
  src: string;
  cover: string;
  duration: number;
  license: string;
  licenseUrl: string;
  link: string;
}

export interface MusicIssue {
  path: string;
  message: string;
}

export const PLAYLIST_MAX = 100;
export const QUEUE_MAX = 200;
export const URL_MAX = 500;
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const CTRL = /[\u0000-\u001f\u007f]/;
const PLAIN_BAD = /[\u0000-\u001f\u007f<>]/;
/** 本站上传的音频（Worker 返回的路径）。 */
export const UPLOADED_AUDIO = /^\/api\/audio\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(mp3|m4a|ogg|flac|wav|webm)$/;
/** 本站上传的图片（封面）。 */
const UPLOADED_IMAGE = /^\/api\/images\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(png|jpg|webp|gif|avif)$/;

/** 严格的 https 链接：无空白 / 控制字符 / 引号尖括号，无账号密码，主机名带点，长度 ≤ 500。 */
export function isHttpsUrl(v: unknown, max = URL_MAX): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) return false;
  if (/[\s"'<>\\`]/.test(v) || CTRL.test(v)) return false;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname;
  if (!host.includes('.') || host.startsWith('.') || host.endsWith('.')) return false;
  return v.toLowerCase().startsWith('https://');
}

export const isAudioSrc = (v: unknown): v is string => isHttpsUrl(v) || (typeof v === 'string' && UPLOADED_AUDIO.test(v));
const isCoverSrc = (v: unknown): v is string => v === '' || isHttpsUrl(v) || (typeof v === 'string' && UPLOADED_IMAGE.test(v));
const isOptUrl = (v: unknown): v is string => v === '' || isHttpsUrl(v);

const PLAYLIST_FIELDS = ['id', 'title', 'artist', 'album', 'src', 'cover', 'duration', 'license', 'licenseUrl', 'link'] as const;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

function plainField(o: Record<string, unknown>, key: string, max: number, issues: MusicIssue[], path: string, required = false): string {
  const raw = o[key];
  if (raw === undefined || raw === null) {
    if (required) issues.push({ path: `${path}.${key}`, message: '必填' });
    return '';
  }
  if (typeof raw !== 'string') {
    issues.push({ path: `${path}.${key}`, message: '必须是文字' });
    return '';
  }
  const v = raw.trim();
  if (required && !v) issues.push({ path: `${path}.${key}`, message: '必填' });
  if (v.length > max) issues.push({ path: `${path}.${key}`, message: `最多 ${max} 个字` });
  if (PLAIN_BAD.test(v)) issues.push({ path: `${path}.${key}`, message: '不能包含控制字符或尖括号' });
  return v;
}

function urlField(o: Record<string, unknown>, key: string, ok: (v: unknown) => boolean, message: string, issues: MusicIssue[], path: string, required = false): string {
  const raw = o[key];
  if (raw === undefined || raw === null || raw === '') {
    if (required) issues.push({ path: `${path}.${key}`, message: '必填' });
    return '';
  }
  if (typeof raw !== 'string') {
    issues.push({ path: `${path}.${key}`, message });
    return '';
  }
  const v = raw.trim();
  if (!ok(v)) issues.push({ path: `${path}.${key}`, message });
  return v;
}

/** 校验一条站长歌单条目。 */
export function validatePlaylistItem(input: unknown, path = 'items.0'): { item: PlaylistItem | null; issues: MusicIssue[] } {
  const issues: MusicIssue[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { item: null, issues: [{ path, message: '必须是对象' }] };
  const o = input as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(PLAYLIST_FIELDS as readonly string[]).includes(k)) issues.push({ path: `${path}.${k}`, message: '不支持的字段' });
  const id = plainField(o, 'id', 40, issues, path, true);
  if (id && !ID_RE.test(id)) issues.push({ path: `${path}.id`, message: 'id 只能是小写字母、数字和连字符（≤40）' });
  const title = plainField(o, 'title', 80, issues, path, true);
  const artist = plainField(o, 'artist', 60, issues, path);
  const album = plainField(o, 'album', 80, issues, path);
  const license = plainField(o, 'license', 60, issues, path);
  const src = urlField(o, 'src', isAudioSrc, '音频地址必须是 https:// 链接（≤500 字）或本站上传的音频', issues, path, true);
  const cover = urlField(o, 'cover', isCoverSrc, '封面必须是 https:// 链接或本站上传的图片', issues, path);
  const licenseUrl = urlField(o, 'licenseUrl', isOptUrl, '许可证链接必须是 https://', issues, path);
  const link = urlField(o, 'link', isOptUrl, '出处链接必须是 https://', issues, path);
  let duration = 0;
  if (o.duration !== undefined && o.duration !== null && o.duration !== '') {
    const d = typeof o.duration === 'string' && /^\d{1,5}$/.test(o.duration) ? Number(o.duration) : o.duration;
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 36000) issues.push({ path: `${path}.duration`, message: '时长是 0–36000 的整数秒' });
    else duration = d;
  }
  if (issues.length) return { item: null, issues };
  return { item: { id, title, artist, album, src, cover, duration, license, licenseUrl, link }, issues };
}

/** 校验整个站长歌单（≤100 首，id 不重复）。 */
export function validatePlaylist(input: unknown): { items: PlaylistItem[]; issues: MusicIssue[] } {
  if (!Array.isArray(input)) return { items: [], issues: [{ path: 'items', message: 'items 必须是数组' }] };
  const issues: MusicIssue[] = [];
  if (input.length > PLAYLIST_MAX) issues.push({ path: 'items', message: `最多 ${PLAYLIST_MAX} 首` });
  const items: PlaylistItem[] = [];
  const seen = new Set<string>();
  input.slice(0, PLAYLIST_MAX + 1).forEach((raw, i) => {
    const r = validatePlaylistItem(raw, `items.${i}`);
    issues.push(...r.issues);
    if (r.item) {
      if (seen.has(r.item.id)) issues.push({ path: `items.${i}.id`, message: 'id 不能重复' });
      seen.add(r.item.id);
      items.push(r.item);
    }
  });
  return { items: issues.length ? [] : items, issues };
}

/** 站长歌单条目 → 播放器曲目。 */
export function playlistToTrack(p: PlaylistItem): Track {
  return { id: `site-${p.id}`, title: p.title, artist: p.artist, album: p.album, src: p.src, cover: p.cover, duration: p.duration, source: 'site', preview: false, license: p.license, licenseUrl: p.licenseUrl, link: p.link, provider: '本站' };
}

const cap = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '');

/** 把任意对象清洗成可播放的曲目；不安全或缺字段时返回 null。用于读回 localStorage 和搜索结果。 */
export function sanitizeTrack(input: unknown): Track | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const source = o.source as TrackSource;
  if (!TRACK_SOURCES.includes(source)) return null;
  const src = typeof o.src === 'string' ? o.src.trim() : '';
  // 上传路径只属于本站歌单；外部来源必须是 https
  if (!(isHttpsUrl(src) || (source === 'site' && UPLOADED_AUDIO.test(src)))) return null;
  const id = cap(o.id, 120);
  const title = cap(o.title, 120);
  if (!id || !title) return null;
  const cover = typeof o.cover === 'string' && isCoverSrc(o.cover.trim()) ? o.cover.trim() : '';
  const duration = typeof o.duration === 'number' && Number.isFinite(o.duration) && o.duration >= 0 && o.duration <= 36000 ? Math.round(o.duration) : 0;
  return {
    id,
    title,
    artist: cap(o.artist, 120),
    album: cap(o.album, 120),
    src,
    cover,
    duration,
    source,
    preview: source === 'itunes' ? true : o.preview === true,
    license: cap(o.license, 60),
    licenseUrl: isOptUrl(o.licenseUrl) ? (o.licenseUrl as string) : '',
    link: isOptUrl(o.link) ? (o.link as string) : '',
    provider: cap(o.provider, 40),
  };
}

export interface QueueState {
  tracks: Track[];
  index: number;
  volume: number;
  muted: boolean;
}
export const EMPTY_QUEUE: QueueState = { tracks: [], index: -1, volume: 0.8, muted: false };
export const QUEUE_KEY = 'blog-music-queue';
export const OPEN_KEY = 'blog-music-open';

/** 读回访客队列（localStorage 里的 JSON 字符串）。坏数据 → 空队列；单条坏数据 → 跳过。 */
export function parseQueue(raw: string | null): QueueState {
  if (!raw) return { ...EMPTY_QUEUE, tracks: [] };
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return { ...EMPTY_QUEUE, tracks: [] };
  }
  if (!o || typeof o !== 'object') return { ...EMPTY_QUEUE, tracks: [] };
  const s = o as Record<string, unknown>;
  const seen = new Set<string>();
  const tracks: Track[] = [];
  for (const t of Array.isArray(s.tracks) ? s.tracks.slice(0, QUEUE_MAX * 2) : []) {
    const x = sanitizeTrack(t);
    if (x && !seen.has(x.id) && tracks.length < QUEUE_MAX) {
      seen.add(x.id);
      tracks.push(x);
    }
  }
  const idx = typeof s.index === 'number' && Number.isInteger(s.index) ? s.index : -1;
  const vol = typeof s.volume === 'number' && Number.isFinite(s.volume) ? Math.min(1, Math.max(0, s.volume)) : EMPTY_QUEUE.volume;
  return { tracks, index: tracks.length ? Math.min(Math.max(idx, 0), tracks.length - 1) : -1, volume: vol, muted: s.muted === true };
}

export const serializeQueue = (q: QueueState): string => JSON.stringify({ v: 1, tracks: q.tracks.slice(0, QUEUE_MAX), index: q.index, volume: q.volume, muted: q.muted });

/** 加入队列：已在队列里的不重复添加，返回该曲目的位置。 */
export function enqueue(q: QueueState, t: Track): { queue: QueueState; index: number } {
  const at = q.tracks.findIndex((x) => x.id === t.id);
  if (at >= 0) return { queue: q, index: at };
  const tracks = [...q.tracks, t].slice(-QUEUE_MAX);
  return { queue: { ...q, tracks, index: q.index < 0 ? 0 : Math.min(q.index, tracks.length - 1) }, index: tracks.length - 1 };
}

/** 从队列移除；当前播放位置随之调整。 */
export function dequeue(q: QueueState, i: number): QueueState {
  if (i < 0 || i >= q.tracks.length) return q;
  const tracks = q.tracks.filter((_, k) => k !== i);
  let index = q.index;
  if (!tracks.length) index = -1;
  else if (i < index) index--;
  else if (i === index) index = Math.min(index, tracks.length - 1);
  return { ...q, tracks, index };
}

/** 上一首 / 下一首（循环）。 */
export const stepIndex = (len: number, cur: number, dir: 1 | -1): number => (len ? (((cur < 0 ? 0 : cur + dir) % len) + len) % len : -1);

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

// ---------------------------------------------------------------- 音频上传
export const AUDIO_TYPES: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
};
const AUDIO_ALIASES: Record<string, string> = {
  'audio/mp3': 'audio/mpeg',
  'audio/x-mp3': 'audio/mpeg',
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/aac': 'audio/mp4',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
  'audio/x-flac': 'audio/flac',
  'application/ogg': 'audio/ogg',
  'audio/opus': 'audio/ogg',
};
export const AUDIO_ACCEPT = '.mp3,.m4a,.ogg,.oga,.opus,.flac,.wav,.webm,audio/mpeg,audio/mp4,audio/ogg,audio/flac,audio/wav,audio/webm';

export const normalizeAudioType = (t: string): string => {
  const base = (t || '').split(';')[0]!.trim().toLowerCase();
  return AUDIO_ALIASES[base] ?? base;
};

/** 按文件头判断音频类型；不是音频返回 null。 */
export function sniffAudioType(b: Uint8Array): string | null {
  const at = (i: number) => b[i] ?? -1;
  const str = (i: number, n: number) => String.fromCharCode(...Array.from({ length: n }, (_, k) => at(i + k)));
  if (b.length < 12) return null;
  if (str(0, 3) === 'ID3') return 'audio/mpeg';
  if (at(0) === 0xff && (at(1) & 0xe0) === 0xe0 && ((at(1) >> 1) & 3) !== 0) return 'audio/mpeg';
  if (str(0, 4) === 'OggS') return 'audio/ogg';
  if (str(0, 4) === 'fLaC') return 'audio/flac';
  if (str(0, 4) === 'RIFF' && str(8, 4) === 'WAVE') return 'audio/wav';
  if (at(0) === 0x1a && at(1) === 0x45 && at(2) === 0xdf && at(3) === 0xa3) return 'audio/webm';
  if (str(4, 4) === 'ftyp' && ['M4A ', 'M4B ', 'mp42', 'isom', 'iso2', 'mp41', 'dash'].includes(str(8, 4))) return 'audio/mp4';
  return null;
}

/** 上传前后的统一检查：大小、声明类型（只收 audio/*）、文件头。返回规范类型或错误。 */
export function checkAudioUpload(bytes: Uint8Array, declaredType: string): { ok: true; type: string; ext: string } | { ok: false; status: number; code: string; message: string } {
  if (bytes.byteLength === 0) return { ok: false, status: 400, code: 'empty_file', message: '文件为空' };
  if (bytes.byteLength > MAX_AUDIO_BYTES) return { ok: false, status: 413, code: 'payload_too_large', message: '音频不能超过 20 MB' };
  const declared = normalizeAudioType(declaredType);
  const sniffed = sniffAudioType(bytes);
  const declaredOk = !declared || declared === 'application/octet-stream' || declared === sniffed;
  if (!sniffed || !AUDIO_TYPES[sniffed] || !declaredOk) return { ok: false, status: 415, code: 'unsupported_audio', message: '仅支持 MP3 / M4A / OGG / FLAC / WAV / WebM 音频' };
  return { ok: true, type: sniffed, ext: AUDIO_TYPES[sniffed]! };
}
