/**
 * L29 / v1.29.0 摄影工具箱：纯函数（不碰 DOM、不发网络请求），浏览器和单元测试共用。
 * - 曝光：APEX EV100 = log2(N²/t) − log2(ISO/100)，等效组合、ND 减光、标准 1/3 档刻度；
 * - 景深：弥散圆 = 画幅对角线 / 1500，超焦距 H = f²/(N·c) + f，近 / 远点（含手机传感器）；
 * - 太阳：NOAA 太阳位置算法，按日期 + 经纬度离线算日出日落、黄金时刻（−4°→+6°）与蓝调时刻（−6°→−4°）；
 * - EXIF 报告：把 exif.ts 读出的参数整理成查看器表格（GPS 只给提示，坐标绝不出现在表格里）。
 */
import { cameraName, type ExifData } from './exif';

// ---------------------------------------------------------------- 刻度
/** 1/3 档光圈 */
export const APERTURES = [1, 1.1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22, 25, 29, 32];
/** 1/3 档快门（秒），1/8000 → 30″ */
export const SHUTTERS = [
  ...[8000, 6400, 5000, 4000, 3200, 2500, 2000, 1600, 1250, 1000, 800, 640, 500, 400, 320, 250, 200, 160, 125, 100, 80, 60, 50, 40, 30, 25, 20, 15, 13, 10, 8, 6, 5, 4, 3, 2.5, 2, 1.6, 1.3].map((d) => 1 / d),
  1, 1.3, 1.6, 2, 2.5, 3.2, 4, 5, 6, 8, 10, 13, 15, 20, 25, 30,
];
/** 1/3 档 ISO */
export const ISOS = [50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800, 16000, 20000, 25600];
/** ND 减光镜档数 */
export const ND_STOPS = [0, 1, 2, 3, 6, 10, 15];
/** 常见场景的 EV100（约值，供对照） */
export const SCENES: { ev: number; label: string }[] = [
  { ev: 16, label: '晴天雪地 / 沙滩' },
  { ev: 15, label: '晴天顺光（阳光 16 法则）' },
  { ev: 14, label: '晴天薄云' },
  { ev: 13, label: '多云，阴影柔和' },
  { ev: 12, label: '阴天 / 日落时分' },
  { ev: 10, label: '日落后不久 / 阴雨天' },
  { ev: 8, label: '明亮的室内 / 夜晚的霓虹招牌' },
  { ev: 6, label: '普通室内 / 夜晚的商业街' },
  { ev: 4, label: '烛光 / 城市夜景远景' },
  { ev: 2, label: '路灯下的街道' },
  { ev: -2, label: '满月照亮的风景' },
];

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const trim = (n: number, d = 1) => String(round(n, d));

// ---------------------------------------------------------------- 曝光：解析
/** f/2.8、F2.8、ƒ/1.8、2.8 → 2.8；不合理（≤0.5 或 >128）返回 null */
export function parseAperture(s: string): number | null {
  const m = /^(?:[fFƒ]\s*\/?\s*)?(\d{1,3}(?:\.\d{1,2})?)$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0.5 && n <= 128 ? n : null;
}
/** 1/250、1/250s、2s、2"、2″、0.5、30 → 秒；范围 1/16000 – 3600 */
export function parseShutter(s: string): number | null {
  const v = String(s ?? '').trim().replace(/\s*(s|sec|秒|"|″)$/i, '');
  let t: number;
  const m = /^(\d{1,6}(?:\.\d+)?)\/(\d{1,6}(?:\.\d+)?)$/.exec(v);
  if (m) t = Number(m[1]) / Number(m[2]);
  else if (/^\d{1,5}(?:\.\d+)?$/.test(v)) t = Number(v);
  else return null;
  return Number.isFinite(t) && t >= 1 / 16000 && t <= 3600 ? t : null;
}
/** 100、ISO 400、iso3200 → 数值；范围 1 – 1,000,000 */
export function parseIso(s: string): number | null {
  const m = /^(?:iso\s*)?(\d{1,7})$/i.exec(String(s ?? '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 1_000_000 ? n : null;
}

// ---------------------------------------------------------------- 曝光：计算
export interface Exposure {
  N: number;
  t: number;
  iso: number;
}
/** 曝光值（ISO 100 基准）：log2(N²/t) */
export const ev100 = (N: number, t: number) => Math.log2((N * N) / t);
/** 这组参数对应的场景 EV100（换算到 ISO 100） */
export const evAt = (N: number, t: number, iso: number) => ev100(N, t) - Math.log2(iso / 100);
/** 保持 EV：已知光圈和 ISO 求快门 */
export const solveShutter = (ev: number, N: number, iso: number) => (N * N) / 2 ** (ev + Math.log2(iso / 100));
/** 保持 EV：已知快门和 ISO 求光圈 */
export const solveAperture = (ev: number, t: number, iso: number) => Math.sqrt(t * 2 ** (ev + Math.log2(iso / 100)));
/** 保持 EV：已知光圈和快门求 ISO */
export const solveIso = (ev: number, N: number, t: number) => 100 * 2 ** (ev100(N, t) - ev);
/** 在刻度里找最近的一档（对数距离） */
export function nearestStop(v: number, scale: readonly number[]): number {
  let best = scale[0]!;
  for (const s of scale) if (Math.abs(Math.log2(s / v)) < Math.abs(Math.log2(best / v))) best = s;
  return best;
}
/** 从 a 换到 b 进光量变化了几档（正数 = 更亮）；kind = 'N' 时光圈数变大进光变少 */
export function stopsBetween(a: number, b: number, kind: 't' | 'N' | 'iso' = 't'): number {
  return kind === 'N' ? -2 * Math.log2(b / a) : Math.log2(b / a);
}
/** 加 ND 减光镜后的快门 */
export const ndShutter = (t: number, stops: number) => t * 2 ** stops;

export interface EquivRow extends Exposure {
  /** 算出来的值超出了标准刻度（不存在这一档） */
  outOfRange: boolean;
}
/**
 * 等效曝光组合：lock = 'iso' 保持 ISO（逐档光圈求快门）；'N' 保持光圈（逐档 ISO 求快门）；'t' 保持快门（逐档光圈求 ISO）。
 * 结果吸附到最近的 1/3 档；超出刻度范围的标记 outOfRange，保留算出的原值，绝不编一个不存在的档位。
 */
export function equivalents(base: Exposure, lock: 'iso' | 'N' | 't'): EquivRow[] {
  const ev = evAt(base.N, base.t, base.iso);
  const inRange = (v: number, scale: readonly number[]) => v >= scale[0]! / 2 ** (1 / 6) && v <= scale.at(-1)! * 2 ** (1 / 6);
  if (lock === 'N')
    return ISOS.map((iso) => {
      const raw = solveShutter(ev, base.N, iso);
      const ok = inRange(raw, SHUTTERS);
      return { N: base.N, t: ok ? nearestStop(raw, SHUTTERS) : raw, iso, outOfRange: !ok };
    });
  if (lock === 't')
    return APERTURES.map((N) => {
      const raw = solveIso(ev, N, base.t);
      const ok = inRange(raw, ISOS);
      return { N, t: base.t, iso: ok ? nearestStop(raw, ISOS) : Math.round(raw), outOfRange: !ok };
    });
  return APERTURES.map((N) => {
    const raw = solveShutter(ev, N, base.iso);
    const ok = inRange(raw, SHUTTERS);
    return { N, t: ok ? nearestStop(raw, SHUTTERS) : raw, iso: base.iso, outOfRange: !ok };
  });
}
/** 最接近的场景描述 */
export function sceneFor(ev: number): string {
  let best = SCENES[0]!;
  for (const s of SCENES) if (Math.abs(s.ev - ev) < Math.abs(best.ev - ev)) best = s;
  return best.label;
}

// ---------------------------------------------------------------- 格式化 / 网址参数
/** 1/250、1/2、2″、17″、2′5″ */
export function fmtShutterT(t: number): string {
  if (!(t > 0)) return '';
  if (t < 1) {
    const d = 1 / t;
    return Math.abs(d - Math.round(d)) < 0.05 || d >= 10 ? `1/${Math.round(d)}` : `${trim(t, 1)}″`;
  }
  if (t < 60) return `${t >= 10 ? Math.round(t) : trim(t, 1)}″`;
  const s = Math.round(t);
  return `${Math.floor(s / 60)}′${s % 60 ? `${s % 60}″` : ''}`;
}
export const fmtAperture = (N: number) => `f/${trim(N, 1)}`;
/** 快门的网址 / 表单值：1/250 或秒数 */
export function shutterValue(t: number): string {
  if (t < 1) {
    const d = 1 / t;
    if (Math.abs(d - Math.round(d)) < 1e-6) return `1/${Math.round(d)}`;
  }
  return String(round(t, 6));
}
export const DEFAULT_EXPOSURE: Exposure = { N: 8, t: 1 / 125, iso: 100 };
/** ?f=2.8&t=1%2F250&iso=400 → 曝光参数（非法值换成默认） */
export function parseExposureQuery(search: string): Exposure {
  const q = new URLSearchParams(search);
  return {
    N: parseAperture(q.get('f') ?? '') ?? DEFAULT_EXPOSURE.N,
    t: parseShutter(q.get('t') ?? '') ?? DEFAULT_EXPOSURE.t,
    iso: parseIso(q.get('iso') ?? '') ?? DEFAULT_EXPOSURE.iso,
  };
}
export const exposureQuery = (x: Exposure) => `?f=${round(x.N, 2)}&t=${encodeURIComponent(shutterValue(x.t))}&iso=${Math.round(x.iso)}`;
export const fmtEv = (ev: number) => `EV ${ev.toFixed(1)}`;

/** 作品集里的 EXIF 展示字段（f/2.8、1/250s、400）→ EV 与曝光计算器链接（不含部署前缀） */
export function workExposure(w: { aperture: string; shutter: string; iso: string }): { ev: number; label: string; href: string } | null {
  const N = parseAperture(w.aperture), t = parseShutter(w.shutter), iso = parseIso(w.iso);
  if (N === null || t === null || iso === null) return null;
  const ev = evAt(N, t, iso);
  return { ev, label: fmtEv(ev), href: `/tools/exposure/${exposureQuery({ N, t, iso })}` };
}

// ---------------------------------------------------------------- 景深
export interface Sensor {
  id: string;
  label: string;
  /** 宽 × 高（mm） */
  w: number;
  h: number;
  phone?: boolean;
}
export const SENSORS: Sensor[] = [
  { id: 'ff', label: '全画幅 36×24', w: 36, h: 24 },
  { id: 'apsc', label: 'APS-C（索尼 / 尼康 / 富士）', w: 23.5, h: 15.6 },
  { id: 'apsc-canon', label: 'APS-C（佳能）', w: 22.3, h: 14.9 },
  { id: 'm43', label: 'M4/3', w: 17.3, h: 13 },
  { id: 'phone-1in', label: '1 英寸（旗舰手机主摄 / 卡片机）', w: 13.2, h: 8.8, phone: true },
  { id: 'phone-1-1.3', label: '1/1.3″（手机主摄）', w: 9.6, h: 7.2, phone: true },
  { id: 'phone-1-1.56', label: '1/1.56″（手机主摄）', w: 8.2, h: 6.1, phone: true },
  { id: 'phone-1-2.55', label: '1/2.55″（手机超广角 / 长焦）', w: 5.6, h: 4.2, phone: true },
  { id: 'mf', label: '中画幅 44×33', w: 44, h: 33 },
];
const FF_DIAG = Math.hypot(36, 24);
const diag = (s: Sensor) => Math.hypot(s.w, s.h);
/** 弥散圆直径（mm）= 对角线 / 1500 */
export const cocFor = (s: Sensor) => diag(s) / 1500;
/** 相对全画幅的裁切系数 */
export const cropFactor = (s: Sensor) => FF_DIAG / diag(s);
/** 手机常标 35mm 等效焦距：换算成实际焦距（mm） */
export const phoneRealFocal = (focal35: number, s: Sensor) => focal35 / cropFactor(s);

export interface DofInput {
  /** 实际焦距 mm */
  focal: number;
  N: number;
  /** 对焦距离 m */
  distance: number;
  /** 弥散圆 mm */
  coc: number;
}
export interface DofResult {
  /** 全部为米；远点 / 景深可能是 Infinity */
  hyperfocal: number;
  near: number;
  far: number;
  total: number;
}
export function dof(i: DofInput): DofResult {
  const { focal: f, N, coc: c } = i;
  const s = i.distance * 1000;
  if (!(f > 0 && f < 2000) || !(N > 0 && N < 200) || !(c > 0 && c < 1) || !(s > 0)) throw new RangeError('参数超出范围');
  if (s <= f) throw new RangeError('对焦距离必须大于焦距');
  const H = (f * f) / (N * c) + f;
  const near = (s * (H - f)) / (H + s - 2 * f);
  const far = s >= H ? Infinity : (s * (H - f)) / (H - s);
  return { hyperfocal: H / 1000, near: near / 1000, far: far / 1000, total: far === Infinity ? Infinity : (far - near) / 1000 };
}
/** 46 cm、5.11 m、42.5 m、223 m、1.5 km、∞ */
export function fmtDistance(m: number): string {
  if (m === Infinity) return '∞';
  if (m < 1) return `${Math.round(m * 100)} cm`;
  if (m < 10) return `${m.toFixed(2)} m`;
  if (m < 100) return `${trim(m, 1)} m`;
  if (m < 1000) return `${Math.round(m)} m`;
  return `${trim(m / 1000, 1)} km`;
}

// ---------------------------------------------------------------- 太阳（NOAA）
const RAD = Math.PI / 180;
const sinD = (d: number) => Math.sin(d * RAD);
const cosD = (d: number) => Math.cos(d * RAD);

function solar(ms: number): { decl: number; eot: number } {
  const jd = ms / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = (((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = sinD(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) + sinD(2 * M) * (0.019993 - 0.000101 * T) + sinD(3 * M) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * sinD(omega);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * cosD(omega);
  const decl = Math.asin(sinD(eps) * sinD(lambda)) / RAD;
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eot =
    (4 / RAD) *
    (y * sinD(2 * L0) - 2 * e * sinD(M) + 4 * e * y * sinD(M) * cosD(2 * L0) - 0.5 * y * y * sinD(4 * L0) - 1.25 * e * e * sinD(2 * M));
  return { decl, eot };
}

/** 太阳高度角（不含大气折射）与方位角（正北 0°，顺时针） */
export function sunPosition(date: Date, lat: number, lng: number): { elevation: number; azimuth: number } {
  const ms = date.getTime();
  const { decl, eot } = solar(ms);
  const utcMin = ((ms / 60000) % 1440 + 1440) % 1440;
  const tst = (((utcMin + eot + 4 * lng) % 1440) + 1440) % 1440;
  let ha = tst / 4 - 180;
  if (ha < -180) ha += 360;
  const cosZ = Math.min(1, Math.max(-1, sinD(lat) * sinD(decl) + cosD(lat) * cosD(decl) * cosD(ha)));
  const zen = Math.acos(cosZ) / RAD;
  const den = cosD(lat) * sinD(zen);
  let az: number;
  if (Math.abs(den) < 1e-9) az = lat > 0 ? 180 : 0;
  else {
    const a = Math.acos(Math.min(1, Math.max(-1, (sinD(lat) * cosD(zen) - sinD(decl)) / den))) / RAD;
    az = ha > 0 ? (a + 180) % 360 : (540 - a) % 360;
  }
  return { elevation: 90 - zen, azimuth: az };
}

const FMT = new Map<string, Intl.DateTimeFormat>();
function fmtFor(tz: string): Intl.DateTimeFormat {
  let f = FMT.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    FMT.set(tz, f);
  }
  return f;
}
function wall(tz: string, d: Date): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const p: Record<string, number> = {};
  for (const x of fmtFor(tz).formatToParts(d)) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return { y: p.year!, mo: p.month!, d: p.day!, h: p.hour! % 24, mi: p.minute!, s: p.second! };
}
/** 时区在某一时刻相对 UTC 的偏移（分钟，东正西负）；非法时区抛 RangeError */
export function tzOffsetMinutes(tz: string, date: Date): number {
  const w = wall(tz, date);
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}
/** 某时区的当地日期 YYYY-MM-DD */
export function localYmd(tz: string, d: Date): string {
  const w = wall(tz, d);
  return `${w.y}-${String(w.mo).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
}
/** HH:mm（该时区） */
export function fmtTime(d: Date | null, tz: string): string {
  if (!d) return '—';
  const w = wall(tz, d);
  return `${String(w.h).padStart(2, '0')}:${String(w.mi).padStart(2, '0')}`;
}
/** 当地某天 00:00 对应的 UTC 毫秒 */
function localMidnight(y: number, m: number, d: number, tz: string): number {
  const base = Date.UTC(y, m - 1, d);
  let t = base - tzOffsetMinutes(tz, new Date(base)) * 60000;
  t = base - tzOffsetMinutes(tz, new Date(t)) * 60000;
  return t;
}

export interface Span {
  start: Date;
  end: Date;
}
export interface SunTimes {
  date: string;
  tz: string;
  sunrise: Date | null;
  sunset: Date | null;
  solarNoon: Date | null;
  /** 正午太阳高度角 */
  noonElevation: number;
  blueMorning: Span | null;
  goldenMorning: Span | null;
  goldenEvening: Span | null;
  blueEvening: Span | null;
  /** 极昼 / 极夜（这天没有日出日落） */
  polar: 'day' | 'night' | null;
}
/** 日出日落的标准定义：太阳中心在地平线下 0.833°（含折射与视半径） */
const HORIZON = -0.833;

/** 按当地日期 + 经纬度 + 时区算这一天的日出日落、黄金 / 蓝调时刻（离线，无网络）。 */
export function sunTimes(ymd: string, lat: number, lng: number, tz: string): SunTimes {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new RangeError('日期格式应为 YYYY-MM-DD');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d || y < 1900 || y > 2100) throw new RangeError('日期不存在');
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180)) throw new RangeError('经纬度超出范围');
  tzOffsetMinutes(tz, probe); // 非法时区在这里抛错
  const start = localMidnight(y, mo, d, tz);
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  const end = localMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), tz);
  const el = (ms: number) => sunPosition(new Date(ms), lat, lng).elevation;
  const STEP = 5 * 60000;
  const samples: { t: number; e: number }[] = [];
  for (let t = start; t <= end; t += STEP) samples.push({ t, e: el(t) });
  if (samples.at(-1)!.t !== end) samples.push({ t: end, e: el(end) });
  const cross = (h: number, rising: boolean): Date | null => {
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1]!, b = samples[i]!;
      if (rising ? a.e < h && b.e >= h : a.e >= h && b.e < h) {
        let lo = a.t, hi = b.t;
        for (let k = 0; k < 20 && hi - lo > 500; k++) {
          const mid = (lo + hi) / 2;
          if ((el(mid) >= h) === rising) hi = mid;
          else lo = mid;
        }
        return new Date(Math.round((lo + hi) / 2 / 1000) * 1000);
      }
    }
    return null;
  };
  // 正午：最高点附近黄金分割搜索
  let best = samples[0]!;
  for (const s of samples) if (s.e > best.e) best = s;
  let lo = best.t - STEP, hi = best.t + STEP;
  for (let k = 0; k < 40 && hi - lo > 500; k++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    if (el(m1) < el(m2)) lo = m1;
    else hi = m2;
  }
  const noonMs = Math.round((lo + hi) / 2 / 1000) * 1000;
  const noonElevation = el(noonMs);
  const span = (a: Date | null, b: Date | null): Span | null => (a && b ? { start: a, end: b } : null);
  const r6 = cross(-6, true), r4 = cross(-4, true), rp6 = cross(6, true);
  const f6 = cross(6, false), f4 = cross(-4, false), fm6 = cross(-6, false);
  const sunrise = cross(HORIZON, true), sunset = cross(HORIZON, false);
  const polar = !sunrise && !sunset && samples.every((s) => s.e >= HORIZON) ? 'day' : !sunrise && !sunset && samples.every((s) => s.e < HORIZON) ? 'night' : null;
  return {
    date: ymd,
    tz,
    sunrise,
    sunset,
    solarNoon: noonElevation > -90 ? new Date(noonMs) : null,
    noonElevation,
    blueMorning: span(r6, r4),
    goldenMorning: span(r4, rp6),
    goldenEvening: span(f6, f4),
    blueEvening: span(f4, fm6),
    polar,
  };
}

/** 粗略城市坐标（两位小数 ≈ 1 km，城市中心），默认不请求定位权限 */
export const CITIES: { id: string; name: string; lat: number; lng: number; tz: string }[] = [
  { id: 'beijing', name: '北京', lat: 39.9, lng: 116.41, tz: 'Asia/Shanghai' },
  { id: 'shanghai', name: '上海', lat: 31.23, lng: 121.47, tz: 'Asia/Shanghai' },
  { id: 'changsha', name: '长沙', lat: 28.23, lng: 112.94, tz: 'Asia/Shanghai' },
  { id: 'guangzhou', name: '广州', lat: 23.13, lng: 113.26, tz: 'Asia/Shanghai' },
  { id: 'shenzhen', name: '深圳', lat: 22.54, lng: 114.06, tz: 'Asia/Shanghai' },
  { id: 'chengdu', name: '成都', lat: 30.57, lng: 104.07, tz: 'Asia/Shanghai' },
  { id: 'hangzhou', name: '杭州', lat: 30.27, lng: 120.16, tz: 'Asia/Shanghai' },
  { id: 'xian', name: '西安', lat: 34.34, lng: 108.94, tz: 'Asia/Shanghai' },
  { id: 'lhasa', name: '拉萨', lat: 29.65, lng: 91.17, tz: 'Asia/Shanghai' },
  { id: 'hongkong', name: '香港', lat: 22.32, lng: 114.17, tz: 'Asia/Hong_Kong' },
  { id: 'taipei', name: '台北', lat: 25.03, lng: 121.57, tz: 'Asia/Taipei' },
  { id: 'tokyo', name: '东京', lat: 35.68, lng: 139.69, tz: 'Asia/Tokyo' },
  { id: 'seoul', name: '首尔', lat: 37.57, lng: 126.98, tz: 'Asia/Seoul' },
  { id: 'singapore', name: '新加坡', lat: 1.35, lng: 103.82, tz: 'Asia/Singapore' },
  { id: 'london', name: '伦敦', lat: 51.51, lng: -0.13, tz: 'Europe/London' },
  { id: 'paris', name: '巴黎', lat: 48.86, lng: 2.35, tz: 'Europe/Paris' },
  { id: 'frankfurt', name: '法兰克福', lat: 50.11, lng: 8.68, tz: 'Europe/Berlin' },
  { id: 'reykjavik', name: '雷克雅未克', lat: 64.15, lng: -21.94, tz: 'Atlantic/Reykjavik' },
  { id: 'newyork', name: '纽约', lat: 40.71, lng: -74.01, tz: 'America/New_York' },
  { id: 'sanfrancisco', name: '旧金山', lat: 37.77, lng: -122.42, tz: 'America/Los_Angeles' },
  { id: 'sydney', name: '悉尼', lat: -33.87, lng: 151.21, tz: 'Australia/Sydney' },
];
/** 自定义坐标统一粗化到 0.1°（约 10 km），和照片地图同一精度 */
export const coarse = (v: number) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------- EXIF 报告
export interface ExifRow {
  key: string;
  label: string;
  value: string;
}
export interface ExifReport {
  rows: ExifRow[];
  hasGps: boolean;
  exposure: Exposure | null;
}
const ORIENT: Record<number, string> = { 2: '水平翻转', 3: '旋转 180°', 4: '垂直翻转', 5: '翻转 + 旋转 90°', 6: '顺时针旋转 90°', 7: '翻转 + 旋转 270°', 8: '逆时针旋转 90°' };
/** 查看器表格：参数 + EV + 裁切系数。GPS 只返回 hasGps，坐标绝不进表格。 */
export function exifReport(x: ExifData): ExifReport {
  const rows: ExifRow[] = [];
  const add = (key: string, label: string, value: string) => value && rows.push({ key, label, value });
  add('camera', '机身', cameraName(x.make, x.model));
  add('lens', '镜头', x.lens.slice(0, 80));
  add('date', '拍摄时间', x.dateTime);
  const f = x.focal > 0 && x.focal < 10000 ? x.focal : 0, f35 = x.focal35 > 0 && x.focal35 < 10000 ? x.focal35 : 0;
  add('focal', '焦距', f && f35 && Math.round(f) !== Math.round(f35) ? `${trim(f, 1)}mm（等效 ${Math.round(f35)}mm）` : f || f35 ? `${trim(f || f35, 1)}mm` : '');
  const N = x.fNumber > 0 && x.fNumber < 200 ? x.fNumber : 0, t = x.exposure > 0 && x.exposure <= 3600 ? x.exposure : 0, iso = x.iso > 0 && x.iso < 1e7 ? x.iso : 0;
  add('aperture', '光圈', N ? fmtAperture(N) : '');
  add('shutter', '快门', t ? fmtShutterT(t) : '');
  add('iso', 'ISO', iso ? String(Math.round(iso)) : '');
  const exposure = N && t && iso ? { N, t, iso } : null;
  add('ev', '曝光值', exposure ? fmtEv(evAt(N, t, iso)) : '');
  add('crop', '裁切系数', f && f35 && f35 / f > 1.05 ? `×${(f35 / f).toFixed(1)}` : '');
  add('orientation', '方向', ORIENT[x.orientation] ?? '');
  return { rows, hasGps: !!x.gps, exposure };
}
