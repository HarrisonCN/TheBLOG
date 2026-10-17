/**
 * L42 / v1.42.0 扫街路线（web = worker 逐字相同，纯函数）：
 * 路线校验（2–15 站、坐标范围、站点编号唯一、步速与停留时间范围、配图替代文字）、摘要与排序、
 * 大圆距离（haversine）、每段距离与总距离、步行 + 停留时间估算、距离 / 时长文字、SVG 示意图投影、GPX 导出。
 */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const MIN_STOPS = 2;
export const MAX_STOPS = 15;

export interface Img {
  src: string;
  alt: string;
  w: number;
  h: number;
}
export interface Stop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  tip?: string;
  image?: Img;
}
export interface Item {
  slug: string;
  title: string;
  summary: string;
  area: string;
  /** 步速 km/h（2–7，默认 4） */
  pace: number;
  /** 每站停留分钟（0–60，默认 10） */
  stopMinutes: number;
  stops: Stop[];
  date: string;
  status: 'published' | 'draft';
}
export interface Summary {
  slug: string;
  title: string;
  summary: string;
  area: string;
  date: string;
  status: Item['status'];
  stops: number;
  meters: number;
  minutes: number;
  cover?: Img;
}
export interface Issue {
  path: string;
  message: string;
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);
const SAFE_SRC = /^(https:\/\/|\/(?!\/))[^\s"'<>]+$/;
const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: Issue[] } {
  const issues: Issue[] = [];
  const bad = (path: string, message: string) => issues.push({ path, message });
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const slug = typeof o.slug === 'string' && SLUG_RE.test(o.slug) ? o.slug : (bad('slug', '地址只能用小写字母、数字和连字符'), '');
  const title = str(o.title, 60) ?? (bad('title', '路线名必填（≤ 60 字）'), '');
  const summary = str(o.summary, 200) ?? (bad('summary', '简介必填（≤ 200 字）'), '');
  const area = str(o.area, 40) ?? (bad('area', '区域必填（≤ 40 字）'), '');
  const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : (bad('date', '日期格式 YYYY-MM-DD'), '');
  const status = o.status === 'draft' ? 'draft' : o.status === 'published' ? 'published' : (bad('status', '状态只能是 published / draft'), 'draft');
  const pace = o.pace === undefined ? 4 : num(o.pace, 2, 7) ? (o.pace as number) : (bad('pace', '步速 2–7 公里 / 小时'), 4);
  const stopMinutes = o.stopMinutes === undefined ? 10 : Number.isInteger(o.stopMinutes) && num(o.stopMinutes, 0, 60) ? (o.stopMinutes as number) : (bad('stopMinutes', '每站停留 0–60 分钟（整数）'), 10);
  const stops: Stop[] = [];
  if (!Array.isArray(o.stops) || o.stops.length < MIN_STOPS || o.stops.length > MAX_STOPS) bad('stops', `站点 ${MIN_STOPS}–${MAX_STOPS} 个`);
  else {
    const seen = new Set<string>();
    o.stops.forEach((s, i) => {
      const x = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
      const p = `stops.${i}`;
      const id = typeof x.id === 'string' && ID_RE.test(x.id) ? x.id : null;
      if (!id) return void bad(`${p}.id`, '站点编号只能用小写字母、数字和连字符');
      if (seen.has(id)) return void bad(`${p}.id`, `站点编号「${id}」重复`);
      seen.add(id);
      const name = str(x.name, 40);
      if (!name) return void bad(`${p}.name`, '站点名称必填（≤ 40 字）');
      if (!num(x.lat, -90, 90) || !num(x.lng, -180, 180)) return void bad(`${p}.lat`, '坐标超出范围');
      const tip = x.tip === undefined || x.tip === '' ? undefined : str(x.tip, 300);
      if (tip === null) return void bad(`${p}.tip`, '拍摄提示 ≤ 300 字');
      let image: Img | undefined;
      if (x.image !== undefined) {
        const m = (x.image && typeof x.image === 'object' ? x.image : {}) as Record<string, unknown>;
        const src = typeof m.src === 'string' && SAFE_SRC.test(m.src) ? m.src : null;
        const alt = str(m.alt, 200);
        const w = Number.isInteger(m.w) && (m.w as number) > 0 ? (m.w as number) : 0;
        const h = Number.isInteger(m.h) && (m.h as number) > 0 ? (m.h as number) : 0;
        if (!src) return void bad(`${p}.image.src`, '图片地址必须是 https:// 或站内路径');
        if (!alt) return void bad(`${p}.image.alt`, '图片必须有替代文字');
        if (!w || !h) return void bad(`${p}.image.w`, '图片宽高必须是正整数');
        image = { src, alt, w, h };
      }
      stops.push({ id, name, lat: x.lat as number, lng: x.lng as number, ...(tip ? { tip } : {}), ...(image ? { image } : {}) });
    });
  }
  if (issues.length) return { issues };
  return { item: { slug, title, summary, area, pace, stopMinutes, stops, date, status: status as Item['status'] }, issues };
}

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;
/** 两点间大圆距离（米） */
export function haversine(a: Pick<Stop, 'lat' | 'lng'>, b: Pick<Stop, 'lat' | 'lng'>): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** 每一段的距离（米，取整）；第 i 项是第 i 站到第 i+1 站 */
export const legs = (stops: Pick<Stop, 'lat' | 'lng'>[]) => stops.slice(1).map((s, i) => Math.round(haversine(stops[i]!, s)));
export const totalMeters = (stops: Pick<Stop, 'lat' | 'lng'>[]) => legs(stops).reduce((a, b) => a + b, 0);
/** 估算总用时（分钟）：步行 + 中间各站停留（起点和终点不算） */
export function estimateMinutes(w: Pick<Item, 'stops' | 'pace' | 'stopMinutes'>): number {
  const walk = (totalMeters(w.stops) / 1000 / w.pace) * 60;
  return Math.round(walk + Math.max(0, w.stops.length - 2) * w.stopMinutes);
}
export const formatDistance = (m: number) => (m < 1000 ? `${Math.round(m)} 米` : `${(Math.round(m / 100) / 10).toFixed(1)} 公里`);
export function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h} 小时 ${m} 分` : `${h} 小时`) : `${m} 分钟`;
}

/** 把站点投影到 w×h 的示意图（等距矩形投影，按纬度修正经度、保持比例、四周留白） */
export function project(stops: Pick<Stop, 'lat' | 'lng'>[], w: number, h: number, pad = 24): { x: number; y: number }[] {
  const k = Math.cos(rad(stops.reduce((s, p) => s + p.lat, 0) / stops.length));
  const xs = stops.map((s) => s.lng * k);
  const ys = stops.map((s) => s.lat);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(x1 - x0, y1 - y0) || 1;
  const sc = Math.min((w - 2 * pad) / (x1 - x0 || span), (h - 2 * pad) / (y1 - y0 || span));
  const ox = (w - (x1 - x0) * sc) / 2;
  const oy = (h - (y1 - y0) * sc) / 2;
  return stops.map((_, i) => ({ x: Math.round((ox + (xs[i]! - x0) * sc) * 10) / 10, y: Math.round((h - oy - (ys[i]! - y0) * sc) * 10) / 10 }));
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** GPX 1.1：路线点（rtept）按站点顺序 */
export function toGpx(w: Pick<Item, 'title' | 'stops'>): string {
  const pts = w.stops.map((s) => `<rtept lat="${s.lat}" lon="${s.lng}"><name>${xml(s.name)}</name></rtept>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="TheBLOG" xmlns="http://www.topografix.com/GPX/1/1"><rte><name>${xml(w.title)}</name>${pts}</rte></gpx>`;
}

export function summarize(w: Item): Summary {
  const cover = w.stops.find((s) => s.image)?.image;
  return { slug: w.slug, title: w.title, summary: w.summary, area: w.area, date: w.date, status: w.status, stops: w.stops.length, meters: totalMeters(w.stops), minutes: estimateMinutes(w), ...(cover ? { cover } : {}) };
}
export function sortItems<T extends { date: string; slug: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}
