/**
 * 照片 EXIF：读取 + 去除（纯函数，只处理字节，不发任何网络请求）。
 * 浏览器上传前、演示 mock API、Worker 存图时共用同一份逻辑（worker/src/exif.ts 是同一个文件的副本，改动时两边一起改）。
 *
 * 读取：JPEG（APP1 Exif）、PNG（eXIf）、WebP（EXIF 块）、HEIC / AVIF（在 ISO-BMFF 里找 Exif 头）。
 *   取拍摄时间、机身（手机型号）、镜头、焦距（优先 35mm 等效）、光圈、快门、ISO、方向、GPS。
 * 去除：JPEG 删掉 APP1（Exif / XMP）、APP13（IPTC）和注释段，方向 ≠ 1 时只写回一个仅含 Orientation 的最小 Exif，
 *   这样不重新编码（画质不变），浏览器仍按正确方向显示；ICC（APP2）和 Adobe（APP14）保留。
 *   PNG 删 eXIf / tEXt / iTXt / zTXt / tIME；WebP 删 EXIF / XMP 块并清掉 VP8X 标志位。其它格式原样返回。
 */

export interface ExifData {
  make: string;
  model: string;
  /** 拍摄时间（相机本地时间）：YYYY-MM-DD HH:mm；没有就是 '' */
  dateTime: string;
  lens: string;
  /** 实际焦距（mm），0 = 没有 */
  focal: number;
  /** 35mm 等效焦距（mm），0 = 没有 */
  focal35: number;
  /** 光圈 f 值，0 = 没有 */
  fNumber: number;
  /** 曝光时间（秒），0 = 没有 */
  exposure: number;
  iso: number;
  /** 1–8，1 = 正常 */
  orientation: number;
  /** 原始坐标：只留在浏览器里，提交前必须经过 coarseCoord（0.1°） */
  gps: { lat: number; lng: number } | null;
}

export interface ExifFields {
  date: string;
  camera: string;
  lens: string;
  focal: string;
  aperture: string;
  shutter: string;
  iso: string;
}

type Kind = 'jpeg' | 'png' | 'webp' | 'heic' | 'avif' | 'gif' | null;

export function imageKind(b: Uint8Array): Kind {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (ascii(b, 4, 4) === 'ftyp') {
    const brands = ascii(b, 8, Math.min(32, Math.max(0, readU32(b, 0, false) - 8)));
    if (/avif|avis/.test(brands)) return 'avif';
    if (/heic|heix|heim|heis|hevc|hevx|mif1|msf1/.test(brands)) return 'heic';
  }
  return null;
}

function ascii(b: Uint8Array, at: number, n: number): string {
  let s = '';
  for (let i = at; i < at + n && i < b.length; i++) s += String.fromCharCode(b[i]!);
  return s;
}
function readU16(b: Uint8Array, at: number, le: boolean): number {
  const x = b[at] ?? 0, y = b[at + 1] ?? 0;
  return le ? x | (y << 8) : (x << 8) | y;
}
function readU32(b: Uint8Array, at: number, le: boolean): number {
  return le ? (readU16(b, at, true) + readU16(b, at + 2, true) * 65536) : (readU16(b, at, false) * 65536 + readU16(b, at + 2, false));
}

/** 找到 TIFF 头（"II*\0" / "MM\0*"）的位置；Exif 段内容从这里开始。 */
function tiffStart(b: Uint8Array, from: number, to: number): number {
  for (let i = from; i < to && i + 8 <= b.length; i++) {
    if ((b[i] === 0x49 && b[i + 1] === 0x49 && b[i + 2] === 0x2a && b[i + 3] === 0) || (b[i] === 0x4d && b[i + 1] === 0x4d && b[i + 2] === 0 && b[i + 3] === 0x2a)) return i;
  }
  return -1;
}

/** 在文件里找 Exif 的 TIFF 块：返回 [start, end)。 */
function locateTiff(b: Uint8Array): [number, number] | null {
  const kind = imageKind(b);
  if (kind === 'jpeg') {
    let p = 2;
    while (p + 4 <= b.length && b[p] === 0xff) {
      const m = b[p + 1]!;
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { p += 2; continue; }
      if (m === 0xda || m === 0xd9) break;
      const len = readU16(b, p + 2, false);
      if (m === 0xe1 && ascii(b, p + 4, 6) === 'Exif\0\0') return [p + 10, Math.min(b.length, p + 2 + len)];
      p += 2 + len;
    }
    return null;
  }
  if (kind === 'png') {
    let p = 8;
    while (p + 12 <= b.length) {
      const len = readU32(b, p, false);
      const type = ascii(b, p + 4, 4);
      if (type === 'eXIf') return [p + 8, Math.min(b.length, p + 8 + len)];
      if (type === 'IEND') break;
      p += 12 + len;
    }
    return null;
  }
  if (kind === 'webp') {
    let p = 12;
    while (p + 8 <= b.length) {
      const len = readU32(b, p + 4, true);
      if (ascii(b, p, 4) === 'EXIF') {
        const s = tiffStart(b, p + 8, Math.min(b.length, p + 8 + 16)); // 有的写入器会带 "Exif\0\0" 前缀
        return s < 0 ? null : [s, Math.min(b.length, p + 8 + len)];
      }
      p += 8 + len + (len & 1);
    }
    return null;
  }
  if (kind === 'heic' || kind === 'avif') {
    // ISO-BMFF：Exif 项的数据是「4 字节偏移 + "Exif\0\0" + TIFF」。不完整解析 iloc，直接找 "Exif\0\0" 后面的 TIFF 头。
    for (let i = 0; i + 14 < b.length; i++) {
      if (b[i] === 0x45 && b[i + 1] === 0x78 && b[i + 2] === 0x69 && b[i + 3] === 0x66 && b[i + 4] === 0 && b[i + 5] === 0) {
        const s = tiffStart(b, i + 6, i + 10);
        if (s >= 0) return [s, Math.min(b.length, s + 256 * 1024)];
      }
    }
  }
  return null;
}

interface Tag { type: number; count: number; at: number }

function readIfd(b: Uint8Array, base: number, end: number, off: number, le: boolean): Map<number, Tag> {
  const out = new Map<number, Tag>();
  const p = base + off;
  if (off < 8 || p + 2 > end) return out;
  const n = Math.min(readU16(b, p, le), 512);
  const size = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
  for (let i = 0; i < n; i++) {
    const e = p + 2 + i * 12;
    if (e + 12 > end) break;
    const type = readU16(b, e + 2, le);
    const count = readU32(b, e + 4, le);
    const bytes = (size[type] ?? 0) * count;
    if (!bytes || count > 65536) continue;
    const at = bytes <= 4 ? e + 8 : base + readU32(b, e + 8, le);
    if (at + bytes > end) continue;
    out.set(readU16(b, e, le), { type, count, at });
  }
  return out;
}

export function readExif(bytes: Uint8Array): ExifData | null {
  const loc = locateTiff(bytes);
  if (!loc) return null;
  const [base, end] = loc;
  const b = bytes;
  const le = b[base] === 0x49;
  const num = (t: Tag | undefined, i = 0): number => {
    if (!t) return 0;
    switch (t.type) {
      case 3: return readU16(b, t.at + i * 2, le);
      case 4: return readU32(b, t.at + i * 4, le);
      case 5: { const d = readU32(b, t.at + i * 8 + 4, le); return d ? readU32(b, t.at + i * 8, le) / d : 0; }
      case 10: { const n = readU32(b, t.at + i * 8, le) | 0; const d = readU32(b, t.at + i * 8 + 4, le) | 0; return d ? n / d : 0; }
      case 1: case 7: return b[t.at + i] ?? 0;
      default: return 0;
    }
  };
  const str = (t: Tag | undefined): string => {
    if (!t || (t.type !== 2 && t.type !== 7)) return '';
    let s = '';
    for (let i = 0; i < t.count; i++) { const c = b[t.at + i]!; if (c === 0) break; s += String.fromCharCode(c); }
    try { s = decodeURIComponent(escape(s)); } catch { /* 不是 UTF-8 就按 Latin-1 */ }
    return clean(s);
  };
  const ifd0 = readIfd(b, base, end, readU32(b, base + 4, le), le);
  const exif = ifd0.has(0x8769) ? readIfd(b, base, end, num(ifd0.get(0x8769)), le) : new Map<number, Tag>();
  const gpsIfd = ifd0.has(0x8825) ? readIfd(b, base, end, num(ifd0.get(0x8825)), le) : new Map<number, Tag>();

  const dt = str(exif.get(0x9003)) || str(exif.get(0x9004)) || str(ifd0.get(0x0132));
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})/.exec(dt);
  let gps: ExifData['gps'] = null;
  const lt = gpsIfd.get(0x0002), lg = gpsIfd.get(0x0004);
  if (lt && lg && lt.count >= 3 && lg.count >= 3) {
    const deg = (t: Tag) => num(t, 0) + num(t, 1) / 60 + num(t, 2) / 3600;
    let lat = deg(lt), lng = deg(lg);
    if (str(gpsIfd.get(0x0001)).toUpperCase() === 'S') lat = -lat;
    if (str(gpsIfd.get(0x0003)).toUpperCase() === 'W') lng = -lng;
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) gps = { lat, lng };
  }
  const orientation = num(ifd0.get(0x0112));
  return {
    make: str(ifd0.get(0x010f)),
    model: str(ifd0.get(0x0110)),
    dateTime: m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : '',
    lens: str(exif.get(0xa434)),
    focal: num(exif.get(0x920a)),
    focal35: num(exif.get(0xa405)),
    fNumber: num(exif.get(0x829d)),
    exposure: num(exif.get(0x829a)),
    iso: num(exif.get(0x8827)),
    orientation: orientation >= 1 && orientation <= 8 ? orientation : 1,
    gps,
  };
}

/** 去掉控制字符和尖括号，压缩空白。 */
function clean(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
}
const trimNum = (n: number, d = 1) => String(Math.round(n * 10 ** d) / 10 ** d);

/** 1/120s、0.5s、8s。 */
export function formatShutter(sec: number): string {
  if (!(sec > 0)) return '';
  if (sec < 0.3) return `1/${Math.round(1 / sec)}s`;
  return `${trimNum(sec, 1)}s`;
}

/** 机身：手机通常 Make = Apple / Model = iPhone 15 Pro → "iPhone 15 Pro"；Model 不含品牌时拼上品牌。 */
export function cameraName(make: string, model: string): string {
  const mk = clean(make), md = clean(model);
  if (!md) return mk.slice(0, 40);
  if (!mk || md.toLowerCase().includes(mk.toLowerCase().split(' ')[0]!) || /^(apple|google)$/i.test(mk)) return md.slice(0, 40);
  const brand = mk.length <= 3 || mk === mk.toUpperCase() ? mk : mk[0]!.toUpperCase() + mk.slice(1);
  return `${brand} ${md}`.slice(0, 40);
}

/** 把 EXIF 转成作品集表单字段（格式与 sections.ts / Worker 的校验规则一致）。 */
export function exifToFields(x: ExifData): ExifFields {
  const focalMm = x.focal35 || x.focal;
  return {
    date: x.dateTime,
    camera: cameraName(x.make, x.model),
    lens: x.lens.slice(0, 60),
    focal: focalMm > 0 && focalMm < 10000 ? `${trimNum(focalMm, focalMm >= 10 ? 0 : 1)}mm` : '',
    aperture: x.fNumber > 0 && x.fNumber < 100 ? `f/${trimNum(x.fNumber, 1)}` : '',
    shutter: formatShutter(x.exposure),
    iso: x.iso > 0 && x.iso < 1e6 ? String(Math.round(x.iso)) : '',
  };
}

/** 方向 5–8 时宽高互换。 */
export function orientedSize(w: number, h: number, orientation: number): { width: number; height: number } {
  return orientation >= 5 && orientation <= 8 ? { width: h, height: w } : { width: w, height: h };
}

/** 只含 Orientation 一个标签的最小 Exif（APP1 段，含 FFE1 标记）。 */
function orientationApp1(o: number): Uint8Array {
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0];
  const len = body.length + 2;
  return Uint8Array.from([0xff, 0xe1, len >> 8, len & 0xff, ...body]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export interface StripResult { bytes: Uint8Array; changed: boolean; kind: Kind }

/** 无损去掉元数据（见文件头说明）。不认识的格式原样返回 changed=false。 */
export function stripMetadata(bytes: Uint8Array): StripResult {
  const kind = imageKind(bytes);
  if (kind === 'jpeg') return stripJpeg(bytes);
  if (kind === 'png') return stripPng(bytes);
  if (kind === 'webp') return stripWebp(bytes);
  return { bytes, changed: false, kind };
}

function stripJpeg(b: Uint8Array): StripResult {
  const orientation = readExif(b)?.orientation ?? 1;
  const keep: Uint8Array[] = [b.subarray(0, 2)];
  let p = 2;
  let changed = false;
  let insertedAt = -1;
  while (p + 4 <= b.length && b[p] === 0xff) {
    const m = b[p + 1]!;
    if (m === 0xff) { p += 1; continue; }
    if (m === 0xda) break; // 扫描数据开始：之后原样保留
    const len = readU16(b, p + 2, false);
    if (len < 2 || p + 2 + len > b.length) return { bytes: b, changed: false, kind: 'jpeg' }; // 结构异常：不动
    const seg = b.subarray(p, p + 2 + len);
    const drop = m === 0xe1 || m === 0xed || m === 0xfe;
    if (drop) changed = true;
    else keep.push(seg);
    if (insertedAt < 0 && m === 0xe0) insertedAt = keep.length; // APP0(JFIF) 之后
    p += 2 + len;
  }
  if (!changed) return { bytes: b, changed: false, kind: 'jpeg' };
  if (orientation !== 1) keep.splice(insertedAt < 0 ? 1 : insertedAt, 0, orientationApp1(orientation));
  keep.push(b.subarray(p));
  return { bytes: concat(keep), changed: true, kind: 'jpeg' };
}

function stripPng(b: Uint8Array): StripResult {
  const keep: Uint8Array[] = [b.subarray(0, 8)];
  let p = 8;
  let changed = false;
  while (p + 12 <= b.length) {
    const len = readU32(b, p, false);
    const type = ascii(b, p + 4, 4);
    const end = p + 12 + len;
    if (end > b.length) return { bytes: b, changed: false, kind: 'png' };
    if (/^(eXIf|tEXt|iTXt|zTXt|tIME)$/.test(type)) changed = true;
    else keep.push(b.subarray(p, end));
    p = end;
    if (type === 'IEND') break;
  }
  return changed ? { bytes: concat(keep), changed, kind: 'png' } : { bytes: b, changed: false, kind: 'png' };
}

function stripWebp(b: Uint8Array): StripResult {
  const keep: Uint8Array[] = [];
  let p = 12;
  let changed = false;
  while (p + 8 <= b.length) {
    const len = readU32(b, p + 4, true);
    const end = Math.min(b.length, p + 8 + len + (len & 1));
    const type = ascii(b, p, 4);
    if (type === 'EXIF' || type === 'XMP ') changed = true;
    else keep.push(b.slice(p, end));
    p = end;
  }
  if (!changed) return { bytes: b, changed: false, kind: 'webp' };
  for (const c of keep) if (ascii(c, 0, 4) === 'VP8X' && c.length > 8) c[8] = c[8]! & ~0x0c; // 清掉 EXIF / XMP 标志
  const body = concat(keep);
  const head = new Uint8Array(12);
  head.set(b.subarray(0, 12));
  const size = body.length + 4;
  head[4] = size & 0xff; head[5] = (size >> 8) & 0xff; head[6] = (size >> 16) & 0xff; head[7] = (size >>> 24) & 0xff;
  return { bytes: concat([head, body]), changed: true, kind: 'webp' };
}

/** 文件里是否还有任何 GPS 信息（测试 / Worker 自检用）。 */
export function hasGps(bytes: Uint8Array): boolean {
  const x = readExif(bytes);
  if (x?.gps) return true;
  const loc = locateTiff(bytes);
  if (!loc) return false;
  const le = bytes[loc[0]] === 0x49;
  const ifd0 = readIfd(bytes, loc[0], loc[1], readU32(bytes, loc[0] + 4, le), le);
  return ifd0.has(0x8825);
}
