/**
 * 便签文字 DIY 样式：严格校验的样式对象（只接受白名单枚举 + #rrggbb 颜色，绝不接受原始 CSS）。
 *
 * 这个文件在 web/src/note-style.ts 与 worker/src/note-style.ts 各有一份，内容必须完全相同
 * （web/test/note-style.test.ts 会比对两份文件）。不依赖任何库，浏览器、Worker、Node 都能跑。
 */

export const NOTE_PAPERS = ['yellow', 'pink', 'blue', 'green'] as const;
export type NotePaper = (typeof NOTE_PAPERS)[number];
/** Motionary <usa-sticky-wall> 的纸张底色（深色模式下也不变）。 */
export const PAPER_HEX: Record<NotePaper, string> = { yellow: '#fef08a', pink: '#fbcfe8', blue: '#bae6fd', green: '#bbf7d0' };

export const NOTE_FONTS = ['sans', 'serif', 'kai', 'hand', 'round', 'mono'] as const;
export const NOTE_SIZES = ['s', 'm', 'l', 'xl'] as const;
export const NOTE_WEIGHTS = ['normal', 'bold'] as const;
export const NOTE_EFFECTS = ['none', 'shadow', 'glow', 'gradient', 'wobble', 'typewriter', 'rainbow'] as const;
/** 会动的效果：prefers-reduced-motion 时变成静态。 */
export const ANIMATED_EFFECTS: readonly NoteEffect[] = ['wobble', 'typewriter', 'rainbow'];

export type NoteFont = (typeof NOTE_FONTS)[number];
export type NoteSize = (typeof NOTE_SIZES)[number];
export type NoteWeight = (typeof NOTE_WEIGHTS)[number];
export type NoteEffect = (typeof NOTE_EFFECTS)[number];

export interface NoteStyle {
  color: string; // #rrggbb（小写）
  font: NoteFont;
  size: NoteSize;
  weight: NoteWeight;
  italic: boolean;
  effect: NoteEffect;
}

export const NOTE_STYLE_KEYS = ['color', 'font', 'size', 'weight', 'italic', 'effect'] as const;
export const DEFAULT_NOTE_STYLE: NoteStyle = { color: '#3f3a2e', font: 'hand', size: 'm', weight: 'normal', italic: false, effect: 'none' };

/** 预设墨水颜色（在四种纸张上对比度都 ≥ 4.5:1）。 */
export const INK_PRESETS: readonly { hex: string; label: string }[] = [
  { hex: '#3f3a2e', label: '墨褐' },
  { hex: '#1f2937', label: '石墨' },
  { hex: '#1d4ed8', label: '钢笔蓝' },
  { hex: '#b91c1c', label: '朱红' },
  { hex: '#065f46', label: '松绿' },
  { hex: '#6d28d9', label: '葡萄紫' },
  { hex: '#9a3412', label: '赭石' },
  { hex: '#9d174d', label: '玫红' },
];

export const FONT_LABELS: Record<NoteFont, string> = { sans: '黑体', serif: '宋体', kai: '楷体', hand: '手写', round: '圆体', mono: '等宽' };
export const SIZE_LABELS: Record<NoteSize, string> = { s: '小', m: '中', l: '大', xl: '特大' };
export const EFFECT_LABELS: Record<NoteEffect, string> = { none: '无', shadow: '投影', glow: '发光', gradient: '渐变', wobble: '摇摆', typewriter: '打字机', rainbow: '彩虹' };

const HEX = /^#[0-9a-fA-F]{6}$/;
export const MIN_CONTRAST = 4.5;

// ---------------------------------------------------------------- 颜色与对比度
function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** 文字颜色在给定纸张上的对比度。 */
export function inkContrast(color: string, paper: NotePaper): number {
  return contrastRatio(color, PAPER_HEX[paper]);
}
/** 对比度守卫：颜色太浅时逐步加深（向黑色混合），直到在所有纸张上都 ≥ MIN_CONTRAST。返回调整后的颜色。 */
export function guardInk(color: string, paper?: NotePaper): string {
  if (!HEX.test(color)) return DEFAULT_NOTE_STYLE.color;
  const papers = paper ? [paper] : NOTE_PAPERS;
  const ok = (c: string) => papers.every((p) => inkContrast(c, p) >= MIN_CONTRAST);
  let [r, g, b] = rgb(color.toLowerCase());
  let c = color.toLowerCase();
  for (let i = 0; i < 40 && !ok(c); i++) {
    r = Math.round(r * 0.9);
    g = Math.round(g * 0.9);
    b = Math.round(b * 0.9);
    c = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }
  return c;
}

// ---------------------------------------------------------------- 校验
export type NoteStyleResult = { ok: true; style: NoteStyle } | { ok: false; error: string };

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/**
 * 严格校验（写入接口用）：必须是普通对象；只允许 NOTE_STYLE_KEYS；每个字段类型 / 枚举 / 格式都要对；
 * 缺省字段用默认值补齐；颜色在纸张 paper 上对比度必须 ≥ MIN_CONTRAST。
 */
export function validateNoteStyle(input: unknown, paper: NotePaper = 'yellow'): NoteStyleResult {
  if (input === undefined || input === null) return { ok: true, style: { ...DEFAULT_NOTE_STYLE } };
  if (typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) return { ok: false, error: 'style 必须是对象' };
  const o = input as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => !(NOTE_STYLE_KEYS as readonly string[]).includes(k));
  if (extra.length) return { ok: false, error: `style 不支持字段：${extra.slice(0, 3).join(', ')}` };
  const s: NoteStyle = { ...DEFAULT_NOTE_STYLE };
  if (o.color !== undefined) {
    if (typeof o.color !== 'string' || !HEX.test(o.color)) return { ok: false, error: 'style.color 必须是 #rrggbb' };
    s.color = o.color.toLowerCase();
  }
  if (o.font !== undefined) {
    if (!isOneOf(NOTE_FONTS, o.font)) return { ok: false, error: 'style.font 不在可选字体内' };
    s.font = o.font;
  }
  if (o.size !== undefined) {
    if (!isOneOf(NOTE_SIZES, o.size)) return { ok: false, error: 'style.size 不在可选字号内' };
    s.size = o.size;
  }
  if (o.weight !== undefined) {
    if (!isOneOf(NOTE_WEIGHTS, o.weight)) return { ok: false, error: 'style.weight 只能是 normal / bold' };
    s.weight = o.weight;
  }
  if (o.italic !== undefined) {
    if (typeof o.italic !== 'boolean') return { ok: false, error: 'style.italic 必须是布尔值' };
    s.italic = o.italic;
  }
  if (o.effect !== undefined) {
    if (!isOneOf(NOTE_EFFECTS, o.effect)) return { ok: false, error: 'style.effect 不在可选特效内' };
    s.effect = o.effect;
  }
  if (inkContrast(s.color, paper) < MIN_CONTRAST) return { ok: false, error: `style.color 与便签底色对比度不足 ${MIN_CONTRAST}:1` };
  return { ok: true, style: s };
}

/** 宽松读取（渲染 / 读库用）：任何不合法的数据都退回默认样式，绝不抛错。 */
export function normalizeNoteStyle(input: unknown, paper: NotePaper = 'yellow'): NoteStyle {
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {
      return { ...DEFAULT_NOTE_STYLE };
    }
  }
  const r = validateNoteStyle(input, paper);
  return r.ok ? r.style : { ...DEFAULT_NOTE_STYLE };
}

export function isDefaultStyle(s: NoteStyle): boolean {
  return NOTE_STYLE_KEYS.every((k) => s[k] === DEFAULT_NOTE_STYLE[k]);
}
