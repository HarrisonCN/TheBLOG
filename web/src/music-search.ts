/**
 * 音乐搜索：只用合法、免 key 的公开接口（浏览器直接请求，三者都返回 Access-Control-Allow-Origin: *）。
 * - 完整曲目（主）：Openverse 音频 API（CC 授权，来自 Jamendo / Freesound / Wikimedia 等）+ Internet Archive（带 CC 许可证的网络厂牌 / 开放音频合集）。
 * - 试听（辅）：iTunes Search API，只有 30 秒预览，附 Apple Music 链接。
 * 不使用网易云 / QQ / 酷狗等非官方接口。
 */
import { isHttpsUrl, sanitizeTrack, type Track } from './music-core';

export const OPENVERSE_API = 'https://api.openverse.org/v1/audio/';
export const ARCHIVE_SEARCH = 'https://archive.org/advancedsearch.php';
export const ARCHIVE_META = 'https://archive.org/metadata/';
export const ITUNES_API = 'https://itunes.apple.com/search';

/** 完整曲目的合理时长：30 秒 – 20 分钟（排除音效片段和整张专辑 / 播客录音）。 */
export const MIN_SEC = 30;
export const MAX_SEC = 20 * 60;

export const cleanQuery = (q: string): string => q.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
/** Internet Archive 用 Lucene 语法：只留文字、数字、空格、撇号和连字符，防止查询注入。 */
const luceneSafe = (q: string): string => cleanQuery(q).replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

const PROVIDERS: Record<string, string> = { jamendo: 'Jamendo', freesound: 'Freesound', wikimedia_audio: 'Wikimedia', ccmixter: 'ccMixter', europeana: 'Europeana' };

export function licenseLabel(code: string, version = ''): string {
  const c = (code || '').toLowerCase();
  if (c === 'cc0') return 'CC0 1.0';
  if (c === 'pdm') return '公有领域 (PDM)';
  if (!c) return '';
  return `CC ${c.toUpperCase()}${version ? ` ${version}` : ''}`;
}

/** 从 creativecommons.org 链接得到许可证标签。 */
export function ccLabelFromUrl(url: string): string {
  const m = /creativecommons\.org\/(licenses|publicdomain)\/([a-z-]+)\/?([\d.]+)?/i.exec(url || '');
  if (!m) return '';
  if (m[1]!.toLowerCase() === 'publicdomain') return m[2]!.toLowerCase() === 'zero' ? 'CC0 1.0' : '公有领域';
  return licenseLabel(m[2]!, m[3] ?? '');
}
const httpsify = (u: string): string => (typeof u === 'string' ? u.replace(/^http:\/\//i, 'https://') : '');

// ---------------------------------------------------------------- Openverse
export function openverseUrl(q: string, size = 12): string {
  const p = new URLSearchParams({ q: cleanQuery(q), category: 'music', mature: 'false', page_size: String(size) });
  return `${OPENVERSE_API}?${p}`;
}

interface OvResult {
  id?: string;
  title?: string;
  url?: string;
  creator?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
  foreign_landing_url?: string;
  provider?: string;
  source?: string;
  duration?: number | null;
  mature?: boolean;
  thumbnail?: string | null;
  audio_set?: { title?: string } | null;
}

export function parseOpenverse(json: unknown): Track[] {
  const results = (json as { results?: OvResult[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: Track[] = [];
  for (const r of results) {
    if (!r || r.mature) continue;
    const sec = typeof r.duration === 'number' ? r.duration / 1000 : 0;
    if (!(sec >= MIN_SEC && sec <= MAX_SEC)) continue;
    if (!isHttpsUrl(r.url) || !r.license) continue;
    const t = sanitizeTrack({
      id: `ov-${r.id}`,
      title: r.title,
      artist: r.creator ?? '',
      album: r.audio_set?.title ?? '',
      src: r.url,
      cover: r.thumbnail && isHttpsUrl(r.thumbnail) ? r.thumbnail : '',
      duration: sec,
      source: 'openverse',
      preview: false,
      license: licenseLabel(r.license, r.license_version ?? ''),
      licenseUrl: r.license_url ?? '',
      link: r.foreign_landing_url ?? '',
      provider: PROVIDERS[r.source ?? r.provider ?? ''] ?? (r.source || r.provider || 'Openverse'),
    });
    if (t) out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------- Internet Archive
/** 只搜带许可证的网络厂牌 / 开放音频合集（不含有声书）。 */
export function archiveSearchUrl(q: string, rows = 6): string {
  const words = luceneSafe(q) || 'music';
  const query = `(${words}) AND mediatype:audio AND collection:(netlabels OR opensource_audio OR audio_music) AND licenseurl:*`;
  const p = new URLSearchParams({ q: query, rows: String(rows), output: 'json' });
  for (const f of ['identifier', 'title', 'creator', 'licenseurl']) p.append('fl[]', f);
  p.append('sort[]', 'downloads desc');
  return `${ARCHIVE_SEARCH}?${p}`;
}
export const archiveMetaUrl = (id: string): string => `${ARCHIVE_META}${encodeURIComponent(id)}`;

export interface ArchiveDoc {
  identifier: string;
  title: string;
  creator: string;
  licenseurl: string;
}
const first = (v: unknown): string => (Array.isArray(v) ? String(v[0] ?? '') : typeof v === 'string' ? v : '');

export function parseArchiveSearch(json: unknown): ArchiveDoc[] {
  const docs = (json as { response?: { docs?: unknown[] } } | null)?.response?.docs;
  if (!Array.isArray(docs)) return [];
  return docs
    .map((d) => d as Record<string, unknown>)
    .filter((d) => typeof d.identifier === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(d.identifier) && first(d.licenseurl))
    .map((d) => ({ identifier: d.identifier as string, title: first(d.title), creator: first(d.creator), licenseurl: first(d.licenseurl) }));
}

/** "240.9" / "3:20" / "1:02:03" → 秒 */
export function parseLength(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return 0;
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(v)) return v.split(':').reduce((a, x) => a * 60 + Number(x), 0);
  return 0;
}
const MP3_FORMATS = new Set(['VBR MP3', '128Kbps MP3', '64Kbps MP3', '256Kbps MP3', '320Kbps MP3', 'MP3']);

export function parseArchiveItem(meta: unknown, perItem = 3): Track[] {
  const m = meta as { metadata?: Record<string, unknown>; files?: Record<string, unknown>[] } | null;
  const md = m?.metadata;
  const id = first(md?.identifier);
  if (!md || !id || !/^[A-Za-z0-9._-]{1,100}$/.test(id) || !Array.isArray(m?.files)) return [];
  const licenseUrl = httpsify(first(md.licenseurl));
  const license = ccLabelFromUrl(licenseUrl);
  if (!license) return [];
  const album = first(md.title);
  const itemCreator = first(md.creator);
  const out: Track[] = [];
  for (const f of m!.files) {
    if (out.length >= perItem) break;
    const name = typeof f.name === 'string' ? f.name : '';
    if (!name || !MP3_FORMATS.has(String(f.format ?? '')) || !/\.mp3$/i.test(name)) continue;
    const sec = parseLength(f.length);
    if (!(sec >= MIN_SEC && sec <= MAX_SEC)) continue;
    const t = sanitizeTrack({
      id: `ia-${id}-${name}`.slice(0, 120),
      title: first(f.title) || name.split('/').pop()!.replace(/\.mp3$/i, '').replace(/[_]+/g, ' '),
      artist: first(f.creator) || first(f.artist) || itemCreator,
      album,
      src: `https://archive.org/download/${encodeURIComponent(id)}/${name.split('/').map(encodeURIComponent).join('/')}`,
      cover: `https://archive.org/services/img/${encodeURIComponent(id)}`,
      duration: sec,
      source: 'archive',
      preview: false,
      license,
      licenseUrl,
      link: `https://archive.org/details/${encodeURIComponent(id)}`,
      provider: 'Internet Archive',
    });
    if (t) out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------- iTunes（30 秒试听）
export function itunesUrl(q: string, limit = 12): string {
  const p = new URLSearchParams({ term: cleanQuery(q), entity: 'song', media: 'music', limit: String(limit) });
  return `${ITUNES_API}?${p}`;
}

export function parseItunes(json: unknown): Track[] {
  const results = (json as { results?: Record<string, unknown>[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: Track[] = [];
  for (const r of results) {
    if (r.kind !== 'song' || !isHttpsUrl(r.previewUrl)) continue;
    const art = typeof r.artworkUrl100 === 'string' ? r.artworkUrl100.replace(/\/\d+x\d+bb\./, '/300x300bb.') : '';
    const t = sanitizeTrack({
      id: `it-${r.trackId}`,
      title: r.trackName,
      artist: r.artistName ?? '',
      album: r.collectionName ?? '',
      src: r.previewUrl,
      cover: isHttpsUrl(art) ? art : '',
      duration: 30,
      source: 'itunes',
      preview: true,
      license: '30秒试听',
      licenseUrl: '',
      link: isHttpsUrl(r.trackViewUrl) ? r.trackViewUrl : '',
      provider: 'Apple Music',
    });
    if (t) out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------- 合并
const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}]+/gu, '');
/** 两个来源交替排列，按「标题 + 艺人」去重。 */
export function mergeResults(lists: Track[][], cap = 24): Track[] {
  const out: Track[] = [];
  const seen = new Set<string>();
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max && out.length < cap; i++) {
    for (const l of lists) {
      const t = l[i];
      if (!t) continue;
      const k = `${norm(t.title)}|${norm(t.artist)}`;
      if (seen.has(k) || seen.has(t.id)) continue;
      seen.add(k);
      seen.add(t.id);
      out.push(t);
      if (out.length >= cap) break;
    }
  }
  return out;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
async function getJson(f: Fetch, url: string, signal?: AbortSignal, ms = 9000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const r = await f(url, { signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export interface SearchOutcome {
  tracks: Track[];
  /** 失败的来源（例如 "Openverse"），界面上提示一行 */
  failed: string[];
}

/** 完整曲目：Openverse + Internet Archive 并行，任一失败不影响另一个。 */
export async function searchFull(q: string, f: Fetch = fetch.bind(globalThis), signal?: AbortSignal): Promise<SearchOutcome> {
  const query = cleanQuery(q);
  if (!query) return { tracks: [], failed: [] };
  const failed: string[] = [];
  const ov = getJson(f, openverseUrl(query), signal).then(parseOpenverse).catch(() => (failed.push('Openverse'), [] as Track[]));
  const ia = (async () => {
    const docs = parseArchiveSearch(await getJson(f, archiveSearchUrl(query), signal));
    const items = await Promise.all(docs.slice(0, 6).map((d) => getJson(f, archiveMetaUrl(d.identifier), signal, 8000).then((m) => parseArchiveItem(m, 2)).catch(() => [] as Track[])));
    return items.flat();
  })().catch(() => (failed.push('Internet Archive'), [] as Track[]));
  const [a, b] = await Promise.all([ov, ia]);
  return { tracks: mergeResults([a, b]), failed };
}

export async function searchPreview(q: string, f: Fetch = fetch.bind(globalThis), signal?: AbortSignal): Promise<SearchOutcome> {
  const query = cleanQuery(q);
  if (!query) return { tracks: [], failed: [] };
  try {
    return { tracks: parseItunes(await getJson(f, itunesUrl(query), signal)), failed: [] };
  } catch {
    return { tracks: [], failed: ['Apple Music'] };
  }
}
