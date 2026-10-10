/**
 * 「好朋友」徽章 DIY：严格校验的设计对象（只接受白名单键 + 枚举 + #rrggbb，绝不接受原始 CSS）。
 *
 * 这个文件在 web/src/badge-design.ts 与 worker/src/badge-design.ts 各有一份，内容必须完全相同
 * （web/test/l12-features.test.ts 会比对两份文件）。不依赖任何库，浏览器、Worker、Node 都能跑。
 *
 * 安全模型与便签 DIY 相同：
 * - 写入：validateBadgeDesign() 严格校验（未知键 / 错误类型 / 非白名单值 → 拒绝）；
 * - 读取：normalizeBadgeDesign() 宽松归一化（坏数据退回预设，绝不抛错），读库和渲染时都再跑一遍；
 * - 渲染：只输出白名单类名 + badgeColors() 算出的 #rrggbb 变量；文字由调用方转义；
 * - 对比度：badgeColors() 自动调整，文字与底色（含渐变两端）对比度始终 ≥ 4.5:1。
 */

export const BADGE_SHAPES = ['circle', 'shield', 'hexagon', 'ribbon', 'pill'] as const;
export const BADGE_TEXTURES = ['flat', 'enamel', 'holo', 'pixel', 'ribbon', 'stamp', 'neon', 'film', 'wax', 'metal', 'pearl'] as const;
export const BADGE_FILLS = ['solid', 'gradient'] as const;
export const BADGE_GRADIENTS = ['sunset', 'ocean', 'forest', 'berry', 'aurora', 'gold', 'graphite', 'candy'] as const;
export const BADGE_BORDERS = ['none', 'solid', 'double', 'dashed', 'stitch', 'perforated'] as const;
export const BADGE_EFFECTS = ['none', 'shine', 'glow', 'float'] as const;
export const BADGE_SIZES = ['s', 'm', 'l'] as const;
/** 可选图标：站内描边图标集（web/src/icons.ts）里的一部分。 */
export const BADGE_ICONS = ['heart', 'star', 'camera', 'aperture', 'sparkles', 'flame', 'music', 'code', 'gamepad', 'book', 'globe', 'verified', 'image', 'moon', 'sun', 'tree', 'flag', 'mapPin', 'send', 'users'] as const;
/** 会动的效果：prefers-reduced-motion / 动效关闭时变成静态。 */
export const ANIMATED_BADGE_EFFECTS: readonly BadgeEffect[] = ['shine', 'float'];

export type BadgeShape = (typeof BADGE_SHAPES)[number];
export type BadgeTexture = (typeof BADGE_TEXTURES)[number];
export type BadgeFill = (typeof BADGE_FILLS)[number];
export type BadgeGradient = (typeof BADGE_GRADIENTS)[number];
export type BadgeBorder = (typeof BADGE_BORDERS)[number];
export type BadgeEffect = (typeof BADGE_EFFECTS)[number];
export type BadgeSize = (typeof BADGE_SIZES)[number];
export type BadgeIcon = (typeof BADGE_ICONS)[number];

export interface BadgeDesign {
  texture: BadgeTexture;
  shape: BadgeShape;
  fill: BadgeFill;
  color: string; // #rrggbb（小写）
  gradient: BadgeGradient;
  border: BadgeBorder;
  icon: BadgeIcon;
  /** 徽章上的短文字（≤ 8 个字符，已清洗）；空 = 只显示编号 */
  label: string;
  effect: BadgeEffect;
  size: BadgeSize;
}

export const BADGE_DESIGN_KEYS = ['texture', 'shape', 'fill', 'color', 'gradient', 'border', 'icon', 'label', 'effect', 'size'] as const;
export const BADGE_LABEL_MAX = 8;

/** 渐变预设：两端颜色（文字颜色由 badgeColors 自动选，保证两端都 ≥ 4.5:1）。 */
export const GRADIENT_HEX: Record<BadgeGradient, [string, string]> = {
  sunset: ['#b4234a', '#c2410c'],
  ocean: ['#1e40af', '#0e7490'],
  forest: ['#166534', '#3f6212'],
  berry: ['#6d28d9', '#be185d'],
  aurora: ['#0f766e', '#4338ca'],
  gold: ['#fde68a', '#f59e0b'],
  graphite: ['#111827', '#374151'],
  candy: ['#fbcfe8', '#bae6fd'],
};

/** 底色预设（DIY 面板里的色块；也可以填任意 #rrggbb，对比度会自动调整）。 */
export const BADGE_COLOR_PRESETS: readonly { hex: string; label: string }[] = [
  { hex: '#2563eb', label: '钴蓝' },
  { hex: '#0f766e', label: '青绿' },
  { hex: '#15803d', label: '松绿' },
  { hex: '#b45309', label: '琥珀' },
  { hex: '#b91c1c', label: '朱红' },
  { hex: '#be185d', label: '玫红' },
  { hex: '#6d28d9', label: '葡萄紫' },
  { hex: '#1f2937', label: '石墨' },
  { hex: '#fef3c7', label: '奶油' },
  { hex: '#e0f2fe', label: '天青' },
];

export const DEFAULT_BADGE_DESIGN: BadgeDesign = { texture: 'metal', shape: 'pill', fill: 'solid', color: '#cbd5e1', gradient: 'graphite', border: 'solid', icon: 'star', label: '', effect: 'none', size: 'm' };

/** 预设样式：选一个作为起点，再自由搭配。 */
export const BADGE_PRESETS: readonly { id: string; label: string; design: BadgeDesign }[] = [
  { id: 'enamel', label: '珐琅', design: { texture: 'enamel', shape: 'circle', fill: 'solid', color: '#b91c1c', gradient: 'sunset', border: 'double', icon: 'heart', label: '好朋友', effect: 'shine', size: 'm' } },
  { id: 'holo', label: '镭射', design: { texture: 'holo', shape: 'hexagon', fill: 'gradient', color: '#6d28d9', gradient: 'candy', border: 'solid', icon: 'sparkles', label: '闪闪', effect: 'shine', size: 'm' } },
  { id: 'pixel', label: '像素', design: { texture: 'pixel', shape: 'pill', fill: 'solid', color: '#15803d', gradient: 'forest', border: 'dashed', icon: 'gamepad', label: 'PLAYER', effect: 'none', size: 'm' } },
  { id: 'ribbon', label: '绶带', design: { texture: 'ribbon', shape: 'ribbon', fill: 'gradient', color: '#1e40af', gradient: 'ocean', border: 'stitch', icon: 'star', label: '荣誉', effect: 'none', size: 'm' } },
  { id: 'stamp', label: '印章', design: { texture: 'stamp', shape: 'circle', fill: 'solid', color: '#b91c1c', gradient: 'sunset', border: 'perforated', icon: 'verified', label: '认证', effect: 'none', size: 'm' } },
  { id: 'neon', label: '霓虹', design: { texture: 'neon', shape: 'pill', fill: 'solid', color: '#ec4899', gradient: 'berry', border: 'solid', icon: 'flame', label: 'NIGHT', effect: 'glow', size: 'm' } },
  { id: 'film', label: '胶片', design: { texture: 'film', shape: 'pill', fill: 'solid', color: '#1f2937', gradient: 'graphite', border: 'perforated', icon: 'aperture', label: '35MM', effect: 'none', size: 'm' } },
  { id: 'wax', label: '火漆', design: { texture: 'wax', shape: 'circle', fill: 'solid', color: '#9f1239', gradient: 'berry', border: 'none', icon: 'send', label: '亲启', effect: 'float', size: 'm' } },
  { id: 'metal', label: '拉丝金属', design: { ...DEFAULT_BADGE_DESIGN } },
  { id: 'pearl', label: '珍珠母贝', design: { texture: 'pearl', shape: 'pill', fill: 'gradient', color: '#f5f3ff', gradient: 'candy', border: 'solid', icon: 'sparkles', label: '', effect: 'shine', size: 'm' } },
];

export const SHAPE_LABELS: Record<BadgeShape, string> = { circle: '圆形', shield: '盾牌', hexagon: '六边形', ribbon: '绶带', pill: '胶囊' };
export const TEXTURE_LABELS: Record<BadgeTexture, string> = { flat: '纯色', enamel: '珐琅', holo: '镭射', pixel: '像素', ribbon: '织带', stamp: '印章', neon: '霓虹', film: '胶片', wax: '火漆', metal: '拉丝金属', pearl: '珍珠母贝' };
export const GRADIENT_LABELS: Record<BadgeGradient, string> = { sunset: '落日', ocean: '海洋', forest: '森林', berry: '莓果', aurora: '极光', gold: '金色', graphite: '石墨', candy: '糖果' };
export const BORDER_LABELS: Record<BadgeBorder, string> = { none: '无', solid: '实线', double: '双线', dashed: '虚线', stitch: '缝线', perforated: '齿孔' };
export const EFFECT_LABELS_BADGE: Record<BadgeEffect, string> = { none: '无', shine: '流光', glow: '发光', float: '漂浮' };
export const SIZE_LABELS_BADGE: Record<BadgeSize, string> = { s: '小', m: '中', l: '大' };

const HEX = /^#[0-9a-fA-F]{6}$/;
export const BADGE_MIN_CONTRAST = 4.5;

// ---------------------------------------------------------------- 颜色与对比度
function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
function lum(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function badgeContrast(a: string, b: string): number {
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** 向黑色（t<0）或白色（t>0）混合。 */
function mix(hex: string, t: number): string {
  const [r, g, b] = rgb(hex);
  return t < 0 ? toHex(r * (1 + t), g * (1 + t), b * (1 + t)) : toHex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t);
}
const INK_DARK = '#111827';
const INK_LIGHT = '#ffffff';
/** 给一组底色挑文字颜色：深 / 浅里两端都过 4.5 的那个；都不过就把底色逐步加深，直到白字通过。 */
function inkFor(bgs: string[]): { ink: string; bgs: string[] } {
  const minC = (ink: string, list: string[]) => Math.min(...list.map((b) => badgeContrast(ink, b)));
  let list = bgs.slice();
  for (let i = 0; i < 40; i++) {
    const dark = minC(INK_DARK, list);
    const light = minC(INK_LIGHT, list);
    if (dark >= BADGE_MIN_CONTRAST || light >= BADGE_MIN_CONTRAST) return { ink: dark >= light ? INK_DARK : INK_LIGHT, bgs: list };
    list = list.map((b) => mix(b, -0.08));
  }
  return { ink: INK_LIGHT, bgs: list.map(() => '#000000') };
}

export interface BadgeColors {
  /** 底色（渐变起点） */
  bg: string;
  /** 渐变终点（纯色时与 bg 相同） */
  bg2: string;
  /** 文字 / 图标颜色，与 bg、bg2 对比度都 ≥ 4.5 */
  ink: string;
  /** 描边 / 发光颜色（装饰用，不承载文字） */
  accent: string;
}

/** 由设计算出渲染用的颜色（全部是 #rrggbb）。霓虹：深色底 + 亮色字；其余：底色 + 自动挑选的文字色。 */
export function badgeColors(d: BadgeDesign): BadgeColors {
  const base = HEX.test(d.color) ? d.color.toLowerCase() : DEFAULT_BADGE_DESIGN.color;
  if (d.texture === 'neon') {
    const bg = '#0b1020';
    const bg2 = '#151b30';
    const ok = (c: string) => Math.min(badgeContrast(c, bg), badgeContrast(c, bg2)) >= BADGE_MIN_CONTRAST;
    let ink = base;
    for (let i = 0; i < 40 && !ok(ink); i++) ink = mix(ink, 0.08);
    if (!ok(ink)) ink = INK_LIGHT;
    return { bg, bg2, ink, accent: base };
  }
  const stops = d.fill === 'gradient' ? GRADIENT_HEX[d.gradient] ?? GRADIENT_HEX.graphite : [base, base];
  const { ink, bgs } = inkFor([...stops]);
  return { bg: bgs[0]!, bg2: bgs[1]!, ink, accent: ink === INK_LIGHT ? mix(bgs[0]!, 0.35) : mix(bgs[0]!, -0.35) };
}

// ---------------------------------------------------------------- 文字清洗
/** 控制字符、零宽字符、双向覆盖字符一律去掉。 */
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;
/** 允许：字母、数字、空格、表情和少量标点。 */
const LABEL_CHAR = /^[\p{L}\p{N}\p{M} ·\-_.!?#+&*~'’:]$|^\p{Extended_Pictographic}$|^\u{FE0F}$/u;
/** 清洗短文字：NFC、去掉不可见字符、合并空白、过滤不允许的字符、按码点截断到 8 个。 */
export function sanitizeBadgeLabel(input: unknown): string {
  if (typeof input !== 'string') return '';
  const s = input.normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  return Array.from(s)
    .filter((ch) => LABEL_CHAR.test(ch))
    .slice(0, BADGE_LABEL_MAX)
    .join('')
    .trim();
}

// ---------------------------------------------------------------- 校验
export type BadgeDesignResult = { ok: true; design: BadgeDesign } | { ok: false; error: string };
const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/**
 * 严格校验（写入接口用）：必须是普通对象；只允许 BADGE_DESIGN_KEYS；每个字段类型 / 枚举 / 格式都要对；
 * 缺省字段用默认值补齐；label 含不允许的字符或超长 → 拒绝（不悄悄改写用户输入）。
 */
export function validateBadgeDesign(input: unknown): BadgeDesignResult {
  if (input === undefined || input === null) return { ok: true, design: { ...DEFAULT_BADGE_DESIGN } };
  if (typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) return { ok: false, error: 'design 必须是对象' };
  const o = input as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => !(BADGE_DESIGN_KEYS as readonly string[]).includes(k));
  if (extra.length) return { ok: false, error: `design 不支持字段：${extra.slice(0, 3).join(', ')}` };
  const d: BadgeDesign = { ...DEFAULT_BADGE_DESIGN };
  const pick = <K extends keyof BadgeDesign>(k: K, list: readonly string[], msg: string): string | null => {
    if (o[k] === undefined) return null;
    if (!isOneOf(list, o[k])) return msg;
    (d as unknown as Record<string, unknown>)[k] = o[k];
    return null;
  };
  const err =
    pick('texture', BADGE_TEXTURES, 'design.texture 不在可选材质内') ??
    pick('shape', BADGE_SHAPES, 'design.shape 不在可选形状内') ??
    pick('fill', BADGE_FILLS, 'design.fill 只能是 solid / gradient') ??
    pick('gradient', BADGE_GRADIENTS, 'design.gradient 不在可选渐变内') ??
    pick('border', BADGE_BORDERS, 'design.border 不在可选边框内') ??
    pick('icon', BADGE_ICONS, 'design.icon 不在可选图标内') ??
    pick('effect', BADGE_EFFECTS, 'design.effect 不在可选特效内') ??
    pick('size', BADGE_SIZES, 'design.size 只能是 s / m / l');
  if (err) return { ok: false, error: err };
  if (o.color !== undefined) {
    if (typeof o.color !== 'string' || !HEX.test(o.color)) return { ok: false, error: 'design.color 必须是 #rrggbb' };
    d.color = o.color.toLowerCase();
  }
  if (o.label !== undefined) {
    if (typeof o.label !== 'string') return { ok: false, error: 'design.label 必须是字符串' };
    const raw = o.label.normalize('NFC').replace(/\s+/g, ' ').trim();
    const clean = sanitizeBadgeLabel(raw);
    if (Array.from(raw).length > BADGE_LABEL_MAX) return { ok: false, error: `design.label 最多 ${BADGE_LABEL_MAX} 个字` };
    if (clean !== raw) return { ok: false, error: 'design.label 含不允许的字符' };
    d.label = clean;
  }
  return { ok: true, design: d };
}

/** 宽松读取（渲染 / 读库用）：任何不合法的数据都退回 fallback（默认是拉丝金属预设），绝不抛错。 */
export function normalizeBadgeDesign(input: unknown, fallback: BadgeDesign = DEFAULT_BADGE_DESIGN): BadgeDesign {
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {
      return { ...fallback };
    }
  }
  if (input === undefined || input === null) return { ...fallback };
  const r = validateBadgeDesign(input);
  return r.ok ? r.design : { ...fallback };
}

/** 旧徽章（只有 style 材质，没有 design）→ 对应的预设。 */
export function legacyDesign(style: string | undefined | null): BadgeDesign {
  const id = style === 'pearlescent' ? 'pearl' : 'metal';
  return { ...BADGE_PRESETS.find((p) => p.id === id)!.design };
}

/** 设计和哪个预设完全一致（DIY 面板高亮用）；不一致 → 'custom'。 */
export function matchPreset(d: BadgeDesign): string {
  return BADGE_PRESETS.find((p) => BADGE_DESIGN_KEYS.every((k) => p.design[k] === d[k]))?.id ?? 'custom';
}

/** 渲染用的白名单类名。 */
export function badgeClasses(d: BadgeDesign): string {
  return ['bd', `bd--sh-${d.shape}`, `bd--tx-${d.texture}`, `bd--bo-${d.border}`, `bd--sz-${d.size}`, d.effect !== 'none' ? `bd--fx-${d.effect}` : '', ANIMATED_BADGE_EFFECTS.includes(d.effect) ? 'bd--anim' : '']
    .filter(Boolean)
    .join(' ');
}
