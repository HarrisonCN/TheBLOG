import type { Env } from './env';
import { HttpError } from './http';
import { checkAudioUpload, MAX_AUDIO_BYTES } from './music-core';

/** 站长上传的整首音频（站长歌单用）：只收音频，按文件头确认类型，≤ 20 MB，放在公开桶的 audio/ 前缀下。 */
export interface AudioUploadResult {
  key: string;
  url: string;
  contentType: string;
  size: number;
}

const KEY_RE = /^audio\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp3|m4a|ogg|flac|wav|webm)$/;

export async function storeAudio(env: Env, bytes: Uint8Array, declaredType: string): Promise<AudioUploadResult> {
  const c = checkAudioUpload(bytes, declaredType);
  if (!c.ok) throw new HttpError(c.status, c.code, c.message);
  const d = new Date();
  const key = `audio/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${c.ext}`;
  await env.IMAGES.put(key, bytes, { httpMetadata: { contentType: c.type, cacheControl: 'public, max-age=31536000, immutable' } });
  return { key, url: `/api/${key}`, contentType: c.type, size: bytes.byteLength };
}

export async function uploadAudioFromRequest(env: Env, req: Request): Promise<AudioUploadResult> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > MAX_AUDIO_BYTES + 64 * 1024) throw new HttpError(413, 'payload_too_large', '音频不能超过 20 MB');
  const ct = req.headers.get('content-type') ?? '';
  if (ct.startsWith('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') throw new HttpError(400, 'missing_file', '缺少 file 字段');
    if (file.size > MAX_AUDIO_BYTES) throw new HttpError(413, 'payload_too_large', '音频不能超过 20 MB');
    return storeAudio(env, new Uint8Array(await file.arrayBuffer()), file.type);
  }
  const buf = new Uint8Array(await req.arrayBuffer());
  return storeAudio(env, buf, ct);
}

/** 解析单段 Range：bytes=a-b / bytes=a- / bytes=-n。不合法返回 null（按整段返回），越界返回 'invalid'。 */
export function parseRange(h: string | null, size: number): { offset: number; length: number } | null | 'invalid' {
  if (!h) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0) return 'invalid';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return { offset: start, length: end - start + 1 };
}

/** 公开播放：支持 Range（206），这样 <audio> 才能拖动进度。 */
export async function serveAudio(env: Env, key: string, req: Request): Promise<Response> {
  if (!KEY_RE.test(key)) throw new HttpError(404, 'not_found', '音频不存在');
  const head = await env.IMAGES.head(key);
  if (!head) throw new HttpError(404, 'not_found', '音频不存在');
  const size = head.size;
  const range = parseRange(req.headers.get('range'), size);
  const headers = new Headers();
  head.writeHttpMetadata(headers);
  headers.set('etag', head.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  if (range === 'invalid') {
    headers.set('content-range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  if (req.method === 'HEAD') {
    headers.set('content-length', String(size));
    return new Response(null, { status: 200, headers });
  }
  const obj = await env.IMAGES.get(key, range ? { range } : undefined);
  if (!obj) throw new HttpError(404, 'not_found', '音频不存在');
  if (range) {
    headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`);
    headers.set('content-length', String(range.length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('content-length', String(size));
  return new Response(obj.body, { status: 200, headers });
}
