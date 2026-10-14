/**
 * ⌘K 命令面板的纯逻辑（无 DOM，便于单测）：模糊匹配 + 打分 + 分组。
 * 匹配规则：整串包含 > 词首 / 连续子序列 > 零散子序列；中文按字符逐个匹配。
 */
export type ItemKind = 'post' | 'page' | 'tag' | 'category' | 'action' | 'recent';

export interface PaletteItem {
  id: string;
  kind: ItemKind;
  title: string;
  /** 次要文字：摘要 / 路径 / 快捷键说明 */
  sub?: string;
  /** 额外参与匹配但不显示的文字（标签、正文片段、拼音别名） */
  keywords?: string;
  href?: string;
  /** action 的标识，由 UI 层执行 */
  action?: string;
  icon?: string;
}

export interface Match {
  item: PaletteItem;
  score: number;
  /** title 中命中的字符下标（高亮用） */
  hits: number[];
}

/** 子序列匹配：返回分数与命中位置；不匹配返回 null。 */
export function fuzzy(query: string, text: string): { score: number; hits: number[] } | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  const t = text.toLowerCase();
  if (!q) return { score: 0, hits: [] };
  const direct = t.indexOf(q);
  if (direct >= 0) {
    const hits = Array.from({ length: q.length }, (_, k) => direct + k);
    // 越靠前越好；从词首开始额外加分
    const boundary = direct === 0 || /[\s\-_/·|（(【]/.test(t[direct - 1] ?? '') ? 6 : 0;
    return { score: 100 + q.length * 4 + boundary - Math.min(direct, 30) * 0.5, hits };
  }
  const hits: number[] = [];
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (const ch of q) {
    const at = t.indexOf(ch, ti);
    if (at < 0) return null;
    const contiguous = hits.length && at === hits[hits.length - 1]! + 1;
    streak = contiguous ? streak + 1 : 0;
    const boundary = at === 0 || /[\s\-_/·|]/.test(t[at - 1] ?? '');
    score += 2 + streak * 3 + (boundary ? 4 : 0) - Math.min(at - ti, 10) * 0.3;
    hits.push(at);
    ti = at + 1;
  }
  // 太零散的子序列（跨度远大于查询）不要
  const span = hits[hits.length - 1]! - hits[0]! + 1;
  if (span > q.length * 6 + 6) return null;
  return { score, hits };
}

const KIND_WEIGHT: Record<ItemKind, number> = { action: 6, page: 4, post: 5, tag: 2, category: 3, recent: 7 };

/** 对所有条目打分并排序。query 为空时返回 null（由 UI 显示默认列表）。 */
export function rank(items: PaletteItem[], query: string, limit = 30): Match[] {
  const q = query.trim();
  if (!q) return [];
  // 多个词：每个词都要命中（标题或关键词），分数相加
  const words = q.split(/\s+/).filter(Boolean).slice(0, 6);
  const out: Match[] = [];
  for (const item of items) {
    let total = 0;
    let titleHits: number[] = [];
    let ok = true;
    for (const w of words) {
      const inTitle = fuzzy(w, item.title);
      const inSub = item.sub ? fuzzy(w, item.sub) : null;
      const inKw = item.keywords ? fuzzy(w, item.keywords) : null;
      const best = Math.max(inTitle ? inTitle.score * 1.6 : -1, inKw ? inKw.score * 0.8 : -1, inSub ? inSub.score * 0.6 : -1);
      if (best < 0) {
        ok = false;
        break;
      }
      total += best;
      if (inTitle) titleHits = titleHits.concat(inTitle.hits);
    }
    if (!ok) continue;
    out.push({ item, score: total + KIND_WEIGHT[item.kind], hits: [...new Set(titleHits)].sort((a, b) => a - b) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export const GROUP_LABEL: Record<ItemKind, string> = { recent: '最近', action: '操作', page: '页面', post: '文章', category: '分类', tag: '标签' };
const GROUP_ORDER: ItemKind[] = ['recent', 'post', 'page', 'action', 'category', 'tag'];

/** 按类型分组（保持组内顺序），组的顺序：最好的结果所在组在前，其余按固定顺序。 */
export function group(matches: Match[]): { kind: ItemKind; label: string; items: Match[] }[] {
  const by = new Map<ItemKind, Match[]>();
  for (const m of matches) by.set(m.item.kind, [...(by.get(m.item.kind) ?? []), m]);
  const first = matches[0]?.item.kind;
  const order = first ? [first, ...GROUP_ORDER.filter((k) => k !== first)] : GROUP_ORDER;
  return order.filter((k) => by.has(k)).map((k) => ({ kind: k, label: GROUP_LABEL[k], items: by.get(k)! }));
}

/** 把命中位置包成 <mark>（text 先转义）。 */
export function markHits(text: string, hits: number[], esc: (s: string) => string): string {
  if (!hits.length) return esc(text);
  const set = new Set(hits);
  let out = '';
  let open = false;
  text.split('').forEach((ch, i) => {
    const on = set.has(i);
    if (on && !open) out += '<mark>';
    if (!on && open) out += '</mark>';
    open = on;
    out += esc(ch);
  });
  return open ? `${out}</mark>` : out;
}

// ---------------------------------------------------------------- 最近访问（localStorage，最多 6 条）
export const RECENT_KEY = 'blog-palette-recent';
export function pushRecent(list: PaletteItem[], item: PaletteItem, max = 6): PaletteItem[] {
  const clean: PaletteItem = { id: item.id, kind: item.kind === 'recent' ? 'post' : item.kind, title: item.title, sub: item.sub, href: item.href, action: item.action, icon: item.icon };
  return [clean, ...list.filter((x) => x.id !== item.id)].slice(0, max);
}

/**
 * L26：⌘K 与搜索页用同一套排名。core 是 search-core 对文章的命中（已转成面板条目），
 * 按 id 与模糊匹配合并：同一条取较高分；core 分数换算到模糊匹配的量级（标题直中 ≈ 100+）。
 */
export function blend(fuzzyMatches: Match[], core: { item: PaletteItem; score: number; hits: number[] }[], limit = 24): Match[] {
  const by = new Map<string, Match>();
  for (const m of fuzzyMatches) by.set(m.item.id, m);
  for (const c of core) {
    const s = 60 + c.score * 6 + KIND_WEIGHT[c.item.kind];
    const cur = by.get(c.item.id);
    if (!cur || cur.score < s) by.set(c.item.id, { item: c.item, score: s, hits: cur?.hits.length ? cur.hits : c.hits });
  }
  return [...by.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
