/**
 * L35 / v1.35.0 3D 与沉浸式展厅（纯函数；web 与 worker 逐字相同，测试会检查）：
 * - 展厅 = 四面墙（北 / 东 / 南 / 西），每件展品挂在一面墙上；校验时每件展品必须有替代文字（无障碍门槛）；
 * - 导览顺序按墙面（北 → 东 → 南 → 西），同一面墙保持录入顺序；平面列表、3D 舞台、键盘导览共用这一个顺序；
 * - 视图模式：默认跟随系统（减少动态效果或浏览器不支持 3D → 平面），用户手动选择优先；
 * - 没有任何自动播放：导览只在用户按键 / 点按时前进。
 */
export const HALL_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const EXHIBIT_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const WALLS = ['north', 'east', 'south', 'west'] as const;
export type Wall = (typeof WALLS)[number];
export const WALL_LABEL: Record<Wall, string> = { north: '北墙', east: '东墙', south: '南墙', west: '西墙' };
export const HALL_STATUSES = ['draft', 'published'] as const;
export type HallStatus = (typeof HALL_STATUSES)[number];
export const MAX_EXHIBITS = 24;
export const MAX_PER_WALL = 6;

export interface HallImage {
  src: string;
  alt: string;
  w: number;
  h: number;
}
export interface Exhibit {
  id: string;
  title: string;
  wall: Wall;
  image: HallImage;
  caption?: string;
  credit?: string;
}
export interface Hall {
  slug: string;
  title: string;
  summary: string;
  date: string;
  status: HallStatus;
  intro?: string;
  exhibits: Exhibit[];
}
export interface HallSummary {
  slug: string;
  title: string;
  summary: string;
  date: string;
  status: HallStatus;
  exhibits: number;
  walls: number;
  cover?: HallImage;
}
export interface HallIssue {
  path: string;
  message: string;
}

// ---------------- 校验 ----------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const posInt = (v: unknown, max = 20000): boolean => Number.isInteger(v) && (v as number) > 0 && (v as number) <= max;
/** 图片地址：https:// 或站内绝对路径（不允许 //host、javascript: 等） */
export function safeImageSrc(src: unknown): boolean {
  const s = str(src);
  if (!s || s.length > 500 || /[\s"'<>\\]/.test(s)) return false;
  return /^https:\/\/[^/]/.test(s) || /^\/(?!\/)/.test(s);
}
function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function validateHall(input: unknown): { hall: Hall | null; issues: HallIssue[] } {
  const issues: HallIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  if (!isObj(input)) return { hall: null, issues: [{ path: '', message: '展厅必须是对象' }] };
  const h = input;
  const slug = str(h.slug);
  if (!HALL_SLUG_RE.test(slug)) add('slug', '地址只能用小写字母、数字和连字符（1–40 个字符）');
  const title = str(h.title);
  if (!title || title.length > 80) add('title', '标题必填，最多 80 字');
  const summary = str(h.summary);
  if (summary.length > 300) add('summary', '简介最多 300 字');
  const intro = str(h.intro);
  if (intro.length > 2000) add('intro', '前言最多 2000 字');
  const date = str(h.date);
  if (!validDate(date)) add('date', '日期格式是 YYYY-MM-DD');
  const status = h.status as HallStatus;
  if (!(HALL_STATUSES as readonly string[]).includes(status as string)) add('status', '状态只能是草稿或已发布');

  const exhibits: Exhibit[] = [];
  if (!Array.isArray(h.exhibits) || !h.exhibits.length || h.exhibits.length > MAX_EXHIBITS) add('exhibits', `需要 1–${MAX_EXHIBITS} 件展品`);
  else {
    const ids = new Set<string>();
    const perWall: Record<string, number> = {};
    h.exhibits.forEach((x: unknown, i: number) => {
      const p = `exhibits.${i}`;
      if (!isObj(x)) return add(p, '展品格式不对');
      const id = str(x.id);
      if (!EXHIBIT_ID_RE.test(id)) add(`${p}.id`, '展品编号只能用小写字母、数字和连字符');
      else if (ids.has(id)) add(`${p}.id`, `展品编号重复：${id}`);
      ids.add(id);
      const t = str(x.title);
      if (!t || t.length > 80) add(`${p}.title`, '展品标题必填，最多 80 字');
      const wall = x.wall as Wall;
      if (!(WALLS as readonly string[]).includes(wall as string)) add(`${p}.wall`, '墙面只能是北、东、南、西');
      else perWall[wall] = (perWall[wall] ?? 0) + 1;
      const caption = str(x.caption);
      if (caption.length > 500) add(`${p}.caption`, '说明最多 500 字');
      const credit = str(x.credit);
      if (credit.length > 200) add(`${p}.credit`, '署名最多 200 字');
      let image: HallImage = { src: '', alt: '', w: 0, h: 0 };
      if (!isObj(x.image)) add(`${p}.image`, '展品需要图片');
      else {
        const im = x.image;
        if (!safeImageSrc(im.src)) add(`${p}.image.src`, '图片地址只允许 https:// 或站内路径');
        const alt = str(im.alt);
        if (!alt || alt.length > 300) add(`${p}.image.alt`, '每件展品都需要替代文字（给看不见画面的读者）');
        if (!posInt(im.w) || !posInt(im.h)) add(`${p}.image.w`, '图片宽高必须是正整数');
        image = { src: str(im.src), alt, w: im.w as number, h: im.h as number };
      }
      exhibits.push({ id, title: t, wall, image, ...(caption ? { caption } : {}), ...(credit ? { credit } : {}) });
    });
    for (const w of WALLS) if ((perWall[w] ?? 0) > MAX_PER_WALL) add(`exhibits.${w}`, `${WALL_LABEL[w]}最多挂 ${MAX_PER_WALL} 件`);
  }
  if (issues.length) return { hall: null, issues };
  return { hall: { slug, title, summary, date, status, ...(intro ? { intro } : {}), exhibits }, issues };
}

// ---------------- 摘要、排序、导览顺序 ----------------

/** 导览顺序：按墙面（北 → 东 → 南 → 西），同一面墙保持录入顺序；返回展品下标 */
export function tourOrder(exhibits: Pick<Exhibit, 'wall'>[]): number[] {
  const out: number[] = [];
  for (const w of WALLS) exhibits.forEach((x, i) => x.wall === w && out.push(i));
  return out;
}

export function hallSummary(h: Hall): HallSummary {
  const order = tourOrder(h.exhibits);
  const first = h.exhibits[order[0] ?? -1];
  return {
    slug: h.slug,
    title: h.title,
    summary: h.summary,
    date: h.date,
    status: h.status,
    exhibits: h.exhibits.length,
    walls: new Set(h.exhibits.map((x) => x.wall)).size,
    ...(first ? { cover: first.image } : {}),
  };
}

export function sortHalls<T extends { date: string; slug: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.date === b.date ? (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0) : a.date < b.date ? 1 : -1));
}

// ---------------- 键盘与导览 ----------------

export type HallAction = 'next' | 'prev' | 'first' | 'last' | 'nextWall' | 'prevWall' | 'open' | 'close';
const KEYS: Record<string, HallAction> = {
  ArrowRight: 'next',
  ArrowDown: 'next',
  ArrowLeft: 'prev',
  ArrowUp: 'prev',
  Home: 'first',
  End: 'last',
  PageDown: 'nextWall',
  PageUp: 'prevWall',
  Enter: 'open',
  ' ': 'open',
  Escape: 'close',
};
export function keyAction(key: string): HallAction | null {
  return Object.prototype.hasOwnProperty.call(KEYS, key) ? KEYS[key]! : null;
}

/** 导览步进：pos 是导览顺序里的位置（不是展品下标）；前后循环；跳墙跳过没有展品的墙 */
export function stepTour(pos: number, order: number[], action: HallAction, exhibits: Pick<Exhibit, 'wall'>[]): number {
  const n = order.length;
  if (!n) return 0;
  const p = Math.min(Math.max(pos, 0), n - 1);
  const wallOf = (q: number) => exhibits[order[q]!]!.wall;
  switch (action) {
    case 'next':
      return (p + 1) % n;
    case 'prev':
      return (p - 1 + n) % n;
    case 'first':
      return 0;
    case 'last':
      return n - 1;
    case 'nextWall':
    case 'prevWall': {
      // 每面墙在导览里的起点；跳到下一面 / 上一面有展品的墙的第一件（循环）
      const starts: number[] = [];
      for (let q = 0; q < n; q++) if (q === 0 || wallOf(q) !== wallOf(q - 1)) starts.push(q);
      let ci = 0;
      starts.forEach((s, i) => s <= p && (ci = i));
      const m = starts.length;
      return starts[(ci + (action === 'nextWall' ? 1 : -1) + m) % m]!;
    }
    default:
      return p;
  }
}

// ---------------- 视图模式与转向 ----------------

export type HallPref = 'auto' | '3d' | 'flat';
export type HallMode = '3d' | 'flat';
export function decideMode(o: { reducedMotion: boolean; supports3d: boolean; pref: HallPref }): HallMode {
  if (!o.supports3d) return 'flat';
  if (o.pref === 'flat') return 'flat';
  if (o.pref === '3d') return '3d';
  return o.reducedMotion ? 'flat' : '3d';
}

/** 墙面在房间里的角度（北墙正对观众） */
export function wallAngle(w: Wall): number {
  return WALLS.indexOf(w) * 90;
}
/** 房间要转到的角度：等于 -wallAngle（模 360），并且离当前角度最近（不绕远路；平局时取更小的角度） */
export function turnTo(current: number, w: Wall): number {
  const base = -wallAngle(w);
  const k = Math.round((current - base) / 360);
  let best = base + 360 * k;
  for (const c of [best - 360, best + 360]) {
    const d = Math.abs(c - current) - Math.abs(best - current);
    if (d < 0 || (d === 0 && c < best)) best = c;
  }
  return best;
}

/** 读屏播报：「第 2 件，共 4 件 · 东墙 · 湖」 */
export function announce(exhibits: Pick<Exhibit, 'wall' | 'title'>[], order: number[], pos: number): string {
  const x = exhibits[order[pos] ?? -1];
  if (!x) return '';
  return `第 ${pos + 1} 件，共 ${order.length} 件 · ${WALL_LABEL[x.wall]} · ${x.title}`;
}
