/**
 * 照片地图 + 每日一图（纯函数，浏览器 / 预渲染 / 测试共用）。
 *
 * 隐私：只有作品自己选了 geo=on、并且填了坐标的才上地图；坐标在保存时已经粗化到 0.1°，这里渲染前再粗化一次
 * （防止旧数据或手改的数据带着精确坐标）。底图是内置的点阵世界地图（Natural Earth 110m 陆地，公有领域，3° 网格），
 * 不加载任何第三方地图瓦片，所以不会把访客 IP 交给地图服务商。
 */
import { coarseCoord, type Work } from './sections';

/** 3° 网格陆地掩码：120 列（经度 -180→180）× 48 行（纬度 84→-60），按位 base64。 */
const MASK = 'AAAAAf4P+AAAAAAAAAAAAAAAD+P//ADQAAAYAAAAAAAZL8f/+AAAACADgAAAAAAYvsB/+AAAAgH/9BAAA8ADy/g/4AAMADf///+Ah////64/gAB/z/f/////A////7wcBgDv///////+B///+DAMAAPf//////9cAIP/+DoAACLP/////+BAAAD//j8AACCf/////4DAAAB//7+AAF////////CAAAAf//wAAB////////AAAAAf//wAAB/9e////9AAAAAf//gAAF34d////5AAAAAf/+AAAHBz+///9gAAAAAf/+AAAHCX+///+iAAAAAP/8AAAD4A////8MAAAAAH/4AAAH+Y////+QAAAAAB8IAAAP/+9///+AAAAAAA8AAAAf//+P//8AAAAAAAYEAAAf//fx/fwAAAAAAAcggAAf//Pg8egAAAAAAAHgAAA///vA4fCAAAAAAAAwAAA///8AYHAAAAAAAAAR0AAf//+AYBAAAAAAAAAD8AAP//+AAABAAAAAAAAD/gAEP/8AAIMAAAAAAAAD/gAAH/4AAG4AAAAAAAAH/4AAH/wAACaIAAAAAAAH/+AAD/gAACAHAAAAAAAH//AAD/gAAAwDgAAAAAAD//AAD/gAAAAAAAAAAAAB/+AAD/yAAAAZAAAAAAAA/+AAD/mAAAB9gAAAAAAAf+AAD/EAAAD/gAAAAAAAf8AAB/MAAAP/wAAAAAAA/wAAB+AAAAP/4AAAAAAA/wAAB+AAAAP/4AAAAAAA/gAAA8AAAAH/4AAAAAAA/AAAAgAAAAEDwAAAAAAB+AAAAAAAAAABwCAAAAAB4AAAAAAAAAAAACAAAAAAwAAAAAAAAAAAAEAAAAABwAAAAAAAAAAAAIAAAAABgAAAAAAAAAAAAAAAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export const MAP_COLS = 120;
export const MAP_ROWS = 48;
const STEP = 3;
const TOP = 84;

let bits: Uint8Array | null = null;
function maskBits(): Uint8Array {
  if (bits) return bits;
  const bin = atob(MASK);
  const out = new Uint8Array(MAP_COLS * MAP_ROWS);
  for (let i = 0; i < out.length; i++) out[i] = (bin.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1;
  return (bits = out);
}
export function isLand(col: number, row: number): boolean {
  return col >= 0 && col < MAP_COLS && row >= 0 && row < MAP_ROWS && maskBits()[row * MAP_COLS + col] === 1;
}

export interface MapPoint {
  lat: number;
  lng: number;
  works: Work[];
}

/** 公开的作品点位：geo=on + 合法坐标；同一个粗化坐标的作品合并成一个点。 */
export function mapPoints(works: Work[]): MapPoint[] {
  const byKey = new Map<string, MapPoint>();
  for (const w of works) {
    if (w.geo !== 'on') continue;
    const la = coarseCoord(w.lat, 90);
    const ln = coarseCoord(w.lng, 180);
    if (!la || !ln) continue;
    const key = `${la},${ln}`;
    const p = byKey.get(key) ?? { lat: Number(la), lng: Number(ln), works: [] };
    p.works.push(w);
    byKey.set(key, p);
  }
  return [...byKey.values()];
}

/** 等距圆柱投影：经纬度 → SVG 坐标（viewBox 0 0 360 144，纬度 84→-60）。 */
export function project(lat: number, lng: number): { x: number; y: number } {
  return { x: Math.round((lng + 180) * 100) / 100, y: Math.round((TOP - Math.max(-60, Math.min(TOP, lat))) * 100) / 100 };
}

/** 点阵底图（只依赖内置掩码）。 */
export function dotsPath(): string {
  let d = '';
  for (let r = 0; r < MAP_ROWS; r++) for (let c = 0; c < MAP_COLS; c++) if (isLand(c, r)) d += `M${c * STEP + 1.5} ${r * STEP + 1.5}h0`;
  return d;
}

/** 按日期（Asia/Shanghai 的公历日）轮换的每日一图；同一天所有访客看到同一张。 */
export function dailyIndex(n: number, now: Date = new Date()): number {
  if (n <= 0) return -1;
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const day = Math.floor(Date.parse(`${ymd}T00:00:00Z`) / 864e5);
  return ((day % n) + n) % n;
}
export function dailyWork(works: Work[], now: Date = new Date()): Work | null {
  const i = dailyIndex(works.length, now);
  return i < 0 ? null : works[i]!;
}
