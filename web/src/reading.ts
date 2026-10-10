/**
 * 阅读记录（只存在访客自己的浏览器里）：每篇文章读到的位置，用于「继续阅读」。
 * 纯函数 + 一个很薄的 localStorage 包装，便于单测。
 */
export interface ReadEntry {
  slug: string;
  title: string;
  cover?: string | null;
  /** 0–1，正文读到的比例 */
  pct: number;
  /** 文档里的绝对滚动位置（同一设备上恢复更准确） */
  y: number;
  at: number;
}
export const READ_KEY = 'blog-reading';
export const READ_MAX = 20;
const DAY = 864e5;

export function parseHistory(raw: string | null): ReadEntry[] {
  try {
    const v = JSON.parse(raw || '[]') as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is ReadEntry => !!x && typeof x === 'object' && typeof (x as ReadEntry).slug === 'string' && /^[a-z0-9-]{1,120}$/.test((x as ReadEntry).slug) && typeof (x as ReadEntry).title === 'string' && Number.isFinite((x as ReadEntry).pct))
      .map((x) => ({ slug: x.slug, title: String(x.title).slice(0, 200), cover: typeof x.cover === 'string' ? x.cover : null, pct: Math.min(1, Math.max(0, x.pct)), y: Math.max(0, Number(x.y) || 0), at: Number(x.at) || 0 }));
  } catch {
    return [];
  }
}

/** 记录一篇文章的进度：同一篇只保留最新一条，最近的在前，最多 READ_MAX 条。读得更少时不覆盖已读完的标记。 */
export function upsert(list: ReadEntry[], e: ReadEntry, max = READ_MAX): ReadEntry[] {
  const prev = list.find((x) => x.slug === e.slug);
  const done = (prev?.pct ?? 0) >= 0.95 && e.pct < 0.05; // 读完后又从头打开：保留「读完」
  const next = done ? { ...e, pct: prev!.pct, y: prev!.y } : e;
  return [next, ...list.filter((x) => x.slug !== e.slug)].slice(0, max);
}

/** 值得「继续」的条目：读了一部分（5%–95%）、30 天内、不是当前这篇。 */
export function continueList(list: ReadEntry[], now = Date.now(), exclude?: string, n = 3): ReadEntry[] {
  return list.filter((x) => x.pct >= 0.05 && x.pct < 0.95 && now - x.at < 30 * DAY && x.slug !== exclude).slice(0, n);
}

/** 打开文章时是否提示「从上次位置继续」。 */
export function resumeFor(list: ReadEntry[], slug: string, now = Date.now()): ReadEntry | null {
  const e = list.find((x) => x.slug === slug);
  return e && e.pct >= 0.05 && e.pct < 0.95 && now - e.at < 30 * DAY ? e : null;
}

/** 正文进度：article 顶部到底部之间，视口底边走过的比例。 */
export function progressOf(top: number, height: number, scrollY: number, viewH: number): number {
  if (height <= 0) return 0;
  return Math.min(1, Math.max(0, (scrollY + viewH - top) / height));
}

export function loadHistory(): ReadEntry[] {
  try {
    return parseHistory(localStorage.getItem(READ_KEY));
  } catch {
    return [];
  }
}
export function saveHistory(list: ReadEntry[]): void {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify(list));
  } catch {
    /* 隐私模式 / 空间不足 */
  }
}
export function clearHistory(): void {
  try {
    localStorage.removeItem(READ_KEY);
  } catch {
    /* ignore */
  }
}
