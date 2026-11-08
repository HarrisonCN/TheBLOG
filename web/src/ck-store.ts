/**
 * L51+ 社区栏目在本机记住的状态（加入的圈子、投过的票、关注的人…）：只用 localStorage，没有网络请求；
 * 隐私模式等读写失败时只是不记住。读出的数据一律按白名单过滤，丢掉未知条目。
 */
export const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null): void {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* 只是不记住 */
    }
  },
};
/** 读字符串数组（JSON），只保留 allowed 里的值（不传 allowed 时保留全部字符串），去重 */
export function readList(key: string, allowed?: readonly string[]): string[] {
  try {
    const v = JSON.parse(store.get(key) ?? '[]') as unknown;
    if (!Array.isArray(v)) return [];
    return [...new Set(v.filter((x): x is string => typeof x === 'string' && (!allowed || allowed.includes(x))))];
  } catch {
    return [];
  }
}
export function writeList(key: string, list: string[]): void {
  store.set(key, list.length ? JSON.stringify(list) : null);
}
/** 读一个对象（JSON）；不是对象时返回 {} */
export function readMap(key: string): Record<string, unknown> {
  try {
    const v = JSON.parse(store.get(key) ?? '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
export function writeMap(key: string, m: Record<string, unknown>): void {
  store.set(key, Object.keys(m).length ? JSON.stringify(m) : null);
}
