/**
 * 上传照片前的处理（只在浏览器里，不发任何网络请求）：
 * 1. 读 EXIF（exif.ts）→ 预填拍摄时间、机身、镜头、焦距、光圈、快门、ISO；GPS 只留在内存里。
 * 2. 去掉文件里的元数据：JPEG / PNG / WebP 无损去除（JPEG 方向 ≠ 1 时只保留 Orientation）；
 *    HEIC / AVIF 用浏览器解码后经 canvas 重新编码成 JPEG（像素已按方向摆正，不带任何元数据）。
 *    浏览器解码不了 HEIC 时给出明确提示。超过上传上限的大图按长边 4096 缩小后重新编码。
 * 3. 位置默认不公开：「在地图上显示（约10公里精度）」勾选后才把坐标粗化到 0.1° 交给表单；原始坐标永远不发给 Worker。
 */
import { exifToFields, imageKind, orientedSize, readExif, stripMetadata, type ExifData, type ExifFields } from './exif';
import { coarseCoord } from './sections';

export interface PreparedPhoto {
  file: File;
  exif: ExifData | null;
  fields: ExifFields | null;
  /** 原始坐标（只在浏览器内存里） */
  gps: { lat: number; lng: number } | null;
  width: number;
  height: number;
  /** 做了什么：去除元数据 / 转换格式 / 缩小 */
  notes: string[];
}

export const HEIC_HINT = '这个浏览器无法解码 HEIC（iPhone 默认格式）。请用 Safari 上传，或在 iPhone「设置 › 相机 › 格式」选「兼容性最佳」，也可以先把照片导出为 JPEG 再上传。';
export const GEO_LABEL = '在地图上显示 (约10公里精度)';
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_EDGE = 4096;

export class PhotoError extends Error {}

/** 勾选才保存坐标，而且只保存粗化到 0.1° 的值。 */
export function gpsForSave(gps: { lat: number; lng: number } | null, show: boolean): { geo: 'on' | 'off'; lat: string; lng: string } {
  if (!gps || !show) return { geo: 'off', lat: '', lng: '' };
  const lat = coarseCoord(gps.lat.toFixed(6), 90);
  const lng = coarseCoord(gps.lng.toFixed(6), 180);
  return lat && lng ? { geo: 'on', lat, lng } : { geo: 'off', lat: '', lng: '' };
}

/** 约 25.3°N, 110.3°E —— 界面上也只显示粗化后的位置。 */
export function coarseLabel(gps: { lat: number; lng: number }): string {
  const lat = Math.round(gps.lat * 10) / 10, lng = Math.round(gps.lng * 10) / 10;
  return `约 ${Math.abs(lat)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng)}°${lng >= 0 ? 'E' : 'W'}`;
}

async function decode(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(blob);
  }
}

async function reencode(bmp: ImageBitmap, type: 'image/jpeg' | 'image/webp', quality: number, maxEdge = MAX_EDGE): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext('2d')!;
  if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, quality));
  if (!out) throw new PhotoError('无法重新编码图片');
  return out;
}

const rename = (name: string, ext: string) => `${name.replace(/\.[^.]+$/, '') || 'photo'}.${ext}`;

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const src = new Uint8Array(await file.arrayBuffer());
  const kind = imageKind(src);
  const exif = readExif(src);
  const notes: string[] = [];
  let out: Blob;
  let name = file.name;
  let type = file.type;
  if (kind === 'jpeg' || kind === 'png' || kind === 'webp') {
    const r = stripMetadata(src);
    out = new Blob([r.bytes as BlobPart], { type: kind === 'jpeg' ? 'image/jpeg' : `image/${kind}` });
    type = out.type;
    if (r.changed) notes.push('已去除 EXIF / GPS');
  } else if (kind === 'heic' || kind === 'avif') {
    let bmp: ImageBitmap;
    try {
      bmp = await decode(file);
    } catch {
      throw new PhotoError(kind === 'heic' ? HEIC_HINT : '这个浏览器无法解码 AVIF，请先转换为 JPEG 再上传。');
    }
    out = await reencode(bmp, 'image/jpeg', 0.9);
    bmp.close?.();
    name = rename(file.name, 'jpg');
    type = 'image/jpeg';
    notes.push(`${kind.toUpperCase()} 已转换为 JPEG（不含 EXIF / GPS）`);
  } else if (kind === 'gif') {
    out = file;
  } else {
    throw new PhotoError('只支持 JPEG / PNG / WebP / GIF / AVIF / HEIC 图片');
  }
  // 尺寸：浏览器解码时会按 EXIF 方向摆正；解码失败就按 EXIF 方向推算
  let width = 0, height = 0;
  try {
    const bmp = await decode(out);
    width = bmp.width; height = bmp.height;
    if (out.size > MAX_BYTES && kind !== 'gif') {
      out = await reencode(bmp, 'image/jpeg', 0.86);
      name = rename(name, 'jpg');
      type = 'image/jpeg';
      const s = Math.min(1, MAX_EDGE / Math.max(width, height));
      width = Math.round(width * s); height = Math.round(height * s);
      notes.push(`超过 5 MB，已缩小到长边 ${Math.max(width, height)}px`);
    }
    bmp.close?.();
  } catch {
    if (exif) ({ width, height } = orientedSize(width, height, exif.orientation));
  }
  return { file: new File([out], name, { type }), exif, fields: exif ? exifToFields(exif) : null, gps: exif?.gps ?? null, width, height, notes };
}
