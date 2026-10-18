/**
 * L49 / v1.49.0 作品幕后（web = worker 逐字相同，纯函数）：
 * 幕后记录校验（照片替代文字、拍摄参数、俯视布光示意的相机 / 主体 / 光源坐标 0–100、布光文字描述必填（示意图的替代）、
 * 步骤、器材、术语（术语表地址））、光源相对相机方向的角度与光位名称、参数文字、摘要与排序。
 */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
export const LIGHT_KINDS = ['key', 'fill', 'rim', 'background', 'natural', 'reflector'] as const;
export type LightKind = (typeof LIGHT_KINDS)[number];
export const KIND_LABEL: Record<LightKind, string> = { key: '主光', fill: '辅光', rim: '轮廓光', background: '背景光', natural: '自然光', reflector: '反光板' };
export const SHUTTER_RE = /^(?:1\/\d{1,5}|\d{1,4}(?:\.\d)?s)$/;

export interface Img {
  src: string;
  alt: string;
  w: number;
  h: number;
}
export interface Pt {
  x: number;
  y: number;
}
export interface Light extends Pt {
  id: string;
  kind: LightKind;
  label: string;
  power?: string;
}
export interface Exif {
  camera: string;
  lens: string;
  focal: number;
  aperture: number;
  shutter: string;
  iso: number;
}
export interface Item {
  slug: string;
  title: string;
  summary: string;
  photo: Img;
  exif: Exif;
  setup: { camera: Pt; subject: Pt; lights: Light[] };
  lightingText: string;
  steps: string[];
  gear: string[];
  terms: { slug: string; label: string }[];
  date: string;
  status: 'published' | 'draft';
}
export interface Summary {
  slug: string;
  title: string;
  summary: string;
  exif: string;
  lights: number;
  date: string;
  status: Item['status'];
  cover: Img;
}
export interface Issue {
  path: string;
  message: string;
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);
const SAFE_SRC = /^(https:\/\/|\/(?!\/))[^\s"'<>]+$/;
const isPt = (v: unknown): v is Pt => {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const ok = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;
  return ok(o.x) && ok(o.y);
};

/** 光源相对相机方向的角度（度，整数）：0 = 从相机方向打来，正 = 相机左侧，负 = 右侧，±180 = 主体正后方 */
export function lightAngle(cam: Pt, subj: Pt, light: Pt): number {
  const cx = cam.x - subj.x, cy = cam.y - subj.y;
  const lx = light.x - subj.x, ly = light.y - subj.y;
  const a = Math.round((Math.atan2(cx * ly - cy * lx, cx * lx + cy * ly) * 180) / Math.PI);
  return a === -180 ? 180 : a;
}
/** 光位名称 */
export function positionName(angle: number): string {
  const a = Math.abs(angle);
  return a <= 30 ? '正面光' : a <= 60 ? '前侧光' : a <= 120 ? '侧光' : a <= 150 ? '侧逆光' : '逆光';
}
/** 「左 98° · 侧光」「180° · 逆光」 */
export function angleText(angle: number): string {
  const side = angle > 0 && angle < 180 ? '左 ' : angle < 0 ? '右 ' : '';
  return `${side}${Math.abs(angle)}° · ${positionName(angle)}`;
}
/** 「50mm · f/2.8 · 1/125 · ISO 200」（秒数写成「8 秒」） */
export function exifText(x: Exif): string {
  const sh = x.shutter.endsWith('s') ? `${x.shutter.slice(0, -1)} 秒` : x.shutter;
  return `${x.focal}mm · f/${x.aperture} · ${sh} · ISO ${x.iso}`;
}

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: Issue[] } {
  const issues: Issue[] = [];
  const bad = (path: string, message: string) => issues.push({ path, message });
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const slug = typeof o.slug === 'string' && SLUG_RE.test(o.slug) ? o.slug : (bad('slug', '地址只能用小写字母、数字和连字符'), '');
  const title = str(o.title, 60) ?? (bad('title', '标题必填（≤ 60 字）'), '');
  const summary = str(o.summary, 200) ?? (bad('summary', '简介必填（≤ 200 字）'), '');
  const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : (bad('date', '日期格式 YYYY-MM-DD'), '');
  const status = o.status === 'draft' ? 'draft' : o.status === 'published' ? 'published' : (bad('status', '状态只能是 published / draft'), 'draft');
  const m = (o.photo && typeof o.photo === 'object' ? o.photo : {}) as Record<string, unknown>;
  let photo: Img = { src: '', alt: '', w: 0, h: 0 };
  const src = typeof m.src === 'string' && SAFE_SRC.test(m.src) ? m.src : null;
  const alt = str(m.alt, 200);
  const w = Number.isInteger(m.w) && (m.w as number) > 0 ? (m.w as number) : 0;
  const h = Number.isInteger(m.h) && (m.h as number) > 0 ? (m.h as number) : 0;
  if (!src) bad('photo.src', '照片地址必须是 https:// 或站内路径');
  else if (!alt) bad('photo.alt', '照片必须有替代文字');
  else if (!w || !h) bad('photo.w', '照片宽高必须是正整数');
  else photo = { src, alt, w, h };
  const x = (o.exif && typeof o.exif === 'object' ? o.exif : {}) as Record<string, unknown>;
  const camera = str(x.camera, 40) ?? (bad('exif.camera', '相机必填（≤ 40 字）'), '');
  const lens = str(x.lens, 40) ?? (bad('exif.lens', '镜头必填（≤ 40 字）'), '');
  const focal = Number.isInteger(x.focal) && (x.focal as number) >= 4 && (x.focal as number) <= 1200 ? (x.focal as number) : (bad('exif.focal', '焦距 4–1200 mm 的整数'), 0);
  const aperture = typeof x.aperture === 'number' && x.aperture >= 0.95 && x.aperture <= 64 ? x.aperture : (bad('exif.aperture', '光圈 f/0.95–64'), 0);
  const shutter = typeof x.shutter === 'string' && SHUTTER_RE.test(x.shutter) ? x.shutter : (bad('exif.shutter', '快门写成 1/125 或 8s'), '');
  const iso = Number.isInteger(x.iso) && (x.iso as number) >= 25 && (x.iso as number) <= 204800 ? (x.iso as number) : (bad('exif.iso', 'ISO 25–204800 的整数'), 0);
  const s = (o.setup && typeof o.setup === 'object' ? o.setup : {}) as Record<string, unknown>;
  if (!isPt(s.camera)) bad('setup.camera', '相机位置坐标 0–100');
  if (!isPt(s.subject)) bad('setup.subject', '主体位置坐标 0–100');
  const lights: Light[] = [];
  if (!Array.isArray(s.lights) || s.lights.length < 1 || s.lights.length > 6) bad('setup.lights', '光源 1–6 个');
  else {
    const seen = new Set<string>();
    s.lights.forEach((l0, i) => {
      const l = (l0 && typeof l0 === 'object' ? l0 : {}) as Record<string, unknown>;
      const p = `setup.lights.${i}`;
      const id = typeof l.id === 'string' && /^[a-z0-9-]{1,20}$/.test(l.id) ? l.id : null;
      if (!id) return void bad(`${p}.id`, '光源编号只能用小写字母、数字和连字符');
      if (seen.has(id)) return void bad(`${p}.id`, `光源编号「${id}」重复`);
      seen.add(id);
      if (!(LIGHT_KINDS as readonly unknown[]).includes(l.kind)) return void bad(`${p}.kind`, '光源类型不在列表里');
      if (!isPt(l)) return void bad(p, '光源坐标 0–100');
      const label = str(l.label, 30);
      if (!label) return void bad(`${p}.label`, '光源说明必填（≤ 30 字）');
      const li: Light = { id, kind: l.kind as LightKind, label, x: l.x as number, y: l.y as number };
      if (l.power !== undefined) {
        const pw = str(l.power, 20);
        if (!pw) return void bad(`${p}.power`, '功率 1–20 字');
        li.power = pw;
      }
      lights.push(li);
    });
  }
  const lightingText = str(o.lightingText, 600);
  if (!lightingText || lightingText.length < 10) bad('lightingText', '布光文字描述必填（10–600 字），它是示意图的替代');
  const list = (v: unknown, path: string, lo: number, hi: number, max: number, what: string): string[] => {
    if (!Array.isArray(v) || v.length < lo || v.length > hi) return bad(path, `${what} ${lo}–${hi} 条`), [];
    const out: string[] = [];
    v.forEach((t, i) => {
      const s2 = str(t, max);
      if (!s2) return void bad(`${path}.${i}`, `每条 1–${max} 字`);
      out.push(s2);
    });
    return out;
  };
  const steps = list(o.steps, 'steps', 1, 10, 300, '拍摄步骤');
  const gear = o.gear === undefined ? [] : list(o.gear, 'gear', 0, 8, 40, '器材');
  const terms: Item['terms'] = [];
  if (o.terms !== undefined) {
    if (!Array.isArray(o.terms) || o.terms.length > 8) bad('terms', '术语最多 8 个');
    else
      o.terms.forEach((t0, i) => {
        const t = (t0 && typeof t0 === 'object' ? t0 : {}) as Record<string, unknown>;
        const ts = typeof t.slug === 'string' && SLUG_RE.test(t.slug) ? t.slug : null;
        if (!ts) return void bad(`terms.${i}.slug`, '术语地址只能用小写字母、数字和连字符');
        if (terms.some((y) => y.slug === ts)) return void bad(`terms.${i}.slug`, `术语「${ts}」重复`);
        const label = str(t.label, 20);
        if (!label) return void bad(`terms.${i}.label`, '术语名称必填（≤ 20 字）');
        terms.push({ slug: ts, label });
      });
  }
  if (issues.length) return { issues };
  return {
    item: {
      slug, title, summary, photo,
      exif: { camera, lens, focal, aperture, shutter, iso },
      setup: { camera: { x: (s.camera as Pt).x, y: (s.camera as Pt).y }, subject: { x: (s.subject as Pt).x, y: (s.subject as Pt).y }, lights },
      lightingText: lightingText!, steps, gear, terms, date, status: status as Item['status'],
    },
    issues,
  };
}

export function summarize(it: Item): Summary {
  return { slug: it.slug, title: it.title, summary: it.summary, exif: exifText(it.exif), lights: it.setup.lights.length, date: it.date, status: it.status, cover: it.photo };
}
export function sortItems<T extends { date: string; slug: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}
