import type { Env } from './env';
import { HttpError } from './http';
import { stripMetadata } from './exif';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** 只接受位图格式；SVG 可内嵌脚本，故不允许。 */
const TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

/** 通过文件头再确认一次类型，防止伪造 Content-Type。 */
export function sniffImageType(b: Uint8Array): string | null {
  const at = (i: number) => b[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return 'image/gif';
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return 'image/webp';
  if (at(4) === 0x66 && at(5) === 0x74 && at(6) === 0x79 && at(7) === 0x70) {
    const brand = String.fromCharCode(at(8), at(9), at(10), at(11));
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  return null;
}

export interface UploadResult {
  key: string;
  url: string;
  contentType: string;
  size: number;
  markdown: string;
}

export async function storeImage(env: Env, bytes: Uint8Array, declaredType: string, alt = ''): Promise<UploadResult> {
  if (bytes.byteLength === 0) throw new HttpError(400, 'empty_file', '文件为空');
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new HttpError(413, 'payload_too_large', '图片不能超过 5 MB');
  const sniffed = sniffImageType(bytes);
  const type = declaredType.split(';')[0]!.trim().toLowerCase();
  if (!sniffed || !TYPES[sniffed] || (type && type !== 'application/octet-stream' && type !== sniffed)) {
    throw new HttpError(415, 'unsupported_image', '仅支持 PNG / JPEG / WebP / GIF / AVIF 图片');
  }
  // 兜底：浏览器上传前已经去掉 EXIF / GPS；MCP upload_image 或旧客户端传来的 JPEG / PNG / WebP 在这里再无损去一次
  bytes = stripMetadata(bytes).bytes;
  const d = new Date();
  const key = `images/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${TYPES[sniffed]}`;
  await env.IMAGES.put(key, bytes, { httpMetadata: { contentType: sniffed, cacheControl: 'public, max-age=31536000, immutable' } });
  const url = `/api/${key}`;
  const safeAlt = alt.replace(/[[\]\n\r]/g, '').slice(0, 100);
  return { key, url, contentType: sniffed, size: bytes.byteLength, markdown: `![${safeAlt}](${url})` };
}

export async function uploadFromRequest(env: Env, req: Request): Promise<UploadResult> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > MAX_IMAGE_BYTES + 64 * 1024) throw new HttpError(413, 'payload_too_large', '图片不能超过 5 MB');
  const ct = req.headers.get('content-type') ?? '';
  if (ct.startsWith('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') throw new HttpError(400, 'missing_file', '缺少 file 字段');
    const alt = String(form.get('alt') ?? '');
    return storeImage(env, new Uint8Array(await file.arrayBuffer()), file.type, alt);
  }
  const buf = new Uint8Array(await req.arrayBuffer());
  return storeImage(env, buf, ct, new URL(req.url).searchParams.get('alt') ?? '');
}

export async function serveImage(env: Env, key: string): Promise<Response> {
  if (!/^images\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(png|jpg|webp|gif|avif)$/.test(key)) {
    throw new HttpError(404, 'not_found', '图片不存在');
  }
  const obj = await env.IMAGES.get(key);
  if (!obj) throw new HttpError(404, 'not_found', '图片不存在');
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  headers.set('access-control-allow-origin', '*');
  headers.set('cross-origin-resource-policy', 'cross-origin');
  return new Response(obj.body, { headers });
}
