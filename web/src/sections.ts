/**
 * 扩展栏目（此刻 / 作品集 / 器材 / 书影音 / 时间线 / 更新日志 / 开源项目）的数据模型、字段规格与校验。
 * 纯数据模块：浏览器、预渲染（Node）、演示 mock API 和后台编辑器共用。
 * Worker 端的 zod 规则见 worker/src/schema.ts（字段与上限保持一致）。
 */

export type NowKind = 'doing' | 'learning' | 'reading' | 'listening' | 'watching' | 'playing';
export interface NowItem {
  kind: NowKind;
  title: string;
  detail: string;
  url: string;
  /** 0–100；0 表示不显示进度条 */
  progress: number;
  /** 开始时间，例如 2026-09 */
  since: string;
}

export interface Work {
  id: string;
  title: string;
  url: string;
  series: string;
  date: string;
  location: string;
  camera: string;
  lens: string;
  focal: string;
  aperture: string;
  shutter: string;
  iso: string;
  tags: string[];
  /** 署名：占位照片来自 Wikimedia Commons 等自由授权图库时填写；自己的作品留空 */
  credit: string;
  creditUrl: string;
  width: number;
  height: number;
  /** 照片地图：on = 这张作品公开（粗化后的）坐标；默认 off */
  geo?: 'off' | 'on';
  /** 十进制度数字符串，保存时粗化到 0.1°（约 11 km）；空 = 没有坐标 */
  lat?: string;
  lng?: string;
}

/** 坐标粗化：四舍五入到 0.1°，与 Worker 的 workSchema 一致。非法 → ''。 */
export function coarseCoord(v: unknown, max: number): string {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  if (!s || !/^-?\d{1,3}(\.\d+)?$/.test(s) || Math.abs(Number(s)) > max) return '';
  return String(Math.round(Number(s) * 10) / 10);
}

export type GearCategory = '相机' | '镜头' | '手机' | '配件' | '电脑与外设' | '软件';
export interface GearItem {
  name: string;
  category: string;
  brand: string;
  note: string;
  /** 1–5 */
  rating: number;
  since: string;
  url: string;
}

export type ShelfKind = 'book' | 'movie' | 'music' | 'game';
export type ShelfStatus = 'doing' | 'done' | 'want';
export interface ShelfItem {
  kind: ShelfKind;
  title: string;
  creator: string;
  year: string;
  status: ShelfStatus;
  /** 0–5，0 表示未评分 */
  rating: number;
  note: string;
  url: string;
}

export type TimelineKind = 'study' | 'work' | 'project' | 'life' | 'award';
export interface TimelineItem {
  date: string;
  kind: TimelineKind;
  title: string;
  detail: string;
  url: string;
}

export type ChangeType = 'feature' | 'improve' | 'fix' | 'weekly';
export interface ChangelogEntry {
  version: string;
  date: string;
  type: ChangeType;
  title: string;
  items: string[];
}

export interface Repo {
  owner: string;
  repo: string;
  title: string;
  description: string;
  language: string;
  /** 构建时的快照；浏览器端会尝试从 GitHub API 刷新 */
  stars: number;
  forks: number;
  url: string;
  status: 'active' | 'wip' | 'archived' | 'private';
  topics: string[];
}

export interface SectionMap {
  now: NowItem[];
  works: Work[];
  gear: GearItem[];
  shelf: ShelfItem[];
  timeline: TimelineItem[];
  changelog: ChangelogEntry[];
  repos: Repo[];
}
export type SectionKey = keyof SectionMap;
export const SECTION_KEYS: SectionKey[] = ['now', 'works', 'gear', 'shelf', 'timeline', 'changelog', 'repos'];
export const isSectionKey = (k: string): k is SectionKey => (SECTION_KEYS as string[]).includes(k);

// ---------------------------------------------------------------- 文案
export const NOW_KIND: Record<NowKind, { label: string; icon: string }> = {
  doing: { label: '正在做', icon: 'sparkles' },
  learning: { label: '在学', icon: 'book' },
  reading: { label: '在读', icon: 'file' },
  listening: { label: '在听', icon: 'music' },
  watching: { label: '在看', icon: 'tv' },
  playing: { label: '在玩', icon: 'gamepad' },
};
export const SHELF_KIND: Record<ShelfKind, { label: string; icon: string; verb: string }> = {
  book: { label: '书', icon: 'book', verb: '读' },
  movie: { label: '影', icon: 'tv', verb: '看' },
  music: { label: '音', icon: 'music', verb: '听' },
  game: { label: '游', icon: 'gamepad', verb: '玩' },
};
export const SHELF_STATUS: Record<ShelfStatus, string> = { doing: '进行中', done: '已完成', want: '想要' };
export const TIMELINE_KIND: Record<TimelineKind, { label: string; icon: string }> = {
  study: { label: '学习', icon: 'book' },
  work: { label: '实习与工作', icon: 'briefcase' },
  project: { label: '项目', icon: 'box' },
  life: { label: '生活', icon: 'heart' },
  award: { label: '荣誉', icon: 'star' },
};
export const CHANGE_TYPE: Record<ChangeType, string> = { feature: '新功能', improve: '优化', fix: '修复', weekly: '周报' };
export const REPO_STATUS: Record<Repo['status'], string> = { active: '活跃维护', wip: '开发中', archived: '已归档', private: '暂未开源' };
export const GEAR_CATEGORIES: GearCategory[] = ['相机', '镜头', '手机', '配件', '电脑与外设', '软件'];

// ---------------------------------------------------------------- 字段规格（校验 + 后台表单）
export type FieldSpec =
  | { key: string; label: string; t: 'str'; max: number; required?: boolean; wide?: boolean; textarea?: boolean; placeholder?: string }
  | { key: string; label: string; t: 'url'; required?: boolean; image?: boolean; wide?: boolean; placeholder?: string }
  | { key: string; label: string; t: 'int'; min: number; max: number; wide?: boolean }
  | { key: string; label: string; t: 'enum'; options: readonly string[]; labels?: Record<string, string>; wide?: boolean }
  | { key: string; label: string; t: 'list'; max: number; each: number; wide?: boolean; lines?: boolean; placeholder?: string };

export interface SectionSpec {
  key: SectionKey;
  label: string;
  icon: string;
  path: string;
  max: number;
  note: string;
  fields: FieldSpec[];
}

const urlF = (key = 'url', label = '链接'): FieldSpec => ({ key, label, t: 'url' });
export const SECTION_SPECS: Record<SectionKey, SectionSpec> = {
  now: {
    key: 'now', label: '此刻', icon: 'clock', path: '/now/', max: 30,
    note: '「此刻」页和首页瓷砖：最近在做、在学、在听、在玩的事。进度填 0 表示不显示进度条。',
    fields: [
      { key: 'kind', label: '类型', t: 'enum', options: Object.keys(NOW_KIND), labels: Object.fromEntries(Object.entries(NOW_KIND).map(([k, v]) => [k, v.label])) },
      { key: 'title', label: '标题', t: 'str', max: 60, required: true },
      { key: 'since', label: '开始于', t: 'str', max: 20, placeholder: '2026-09' },
      { key: 'progress', label: '进度 %', t: 'int', min: 0, max: 100 },
      urlF(),
      { key: 'detail', label: '说明', t: 'str', max: 200, wide: true },
    ],
  },
  works: {
    key: 'works', label: '作品集', icon: 'aperture', path: '/works/', max: 120,
    note: '作品集照片和 EXIF。示例里的照片来自 Wikimedia Commons（保留署名），参数为示意：换成自己的作品时把「署名」留空。',
    fields: [
      { key: 'title', label: '标题', t: 'str', max: 60, required: true },
      { key: 'id', label: 'id（小写字母-数字）', t: 'str', max: 60, required: true },
      { key: 'url', label: '图片 URL', t: 'url', image: true, required: true, wide: true },
      { key: 'series', label: '系列', t: 'str', max: 30 },
      { key: 'date', label: '拍摄日期', t: 'str', max: 20, placeholder: '2026-09-12' },
      { key: 'location', label: '地点', t: 'str', max: 40 },
      { key: 'camera', label: '机身', t: 'str', max: 40 },
      { key: 'lens', label: '镜头', t: 'str', max: 60 },
      { key: 'focal', label: '焦距', t: 'str', max: 20, placeholder: '35mm' },
      { key: 'aperture', label: '光圈', t: 'str', max: 20, placeholder: 'f/2.8' },
      { key: 'shutter', label: '快门', t: 'str', max: 20, placeholder: '1/250s' },
      { key: 'iso', label: 'ISO', t: 'str', max: 10, placeholder: '100' },
      { key: 'width', label: '宽（像素）', t: 'int', min: 0, max: 20000 },
      { key: 'height', label: '高（像素）', t: 'int', min: 0, max: 20000 },
      { key: 'tags', label: '标签（逗号分隔）', t: 'list', max: 8, each: 20, wide: true },
      { key: 'credit', label: '署名（他人照片才填）', t: 'str', max: 200, wide: true },
      { key: 'creditUrl', label: '署名链接', t: 'url', wide: true },
      { key: 'geo', label: '照片地图', t: 'enum', options: ['off', 'on'], labels: { off: '不公开位置', on: '公开（粗化到约 11 km）' } },
      { key: 'lat', label: '纬度（可选）', t: 'str', max: 16, placeholder: '25.3' },
      { key: 'lng', label: '经度（可选）', t: 'str', max: 16, placeholder: '110.3' },
    ],
  },
  gear: {
    key: 'gear', label: '器材', icon: 'camera', path: '/gear/', max: 80,
    note: '器材清单按「分类」分组；推荐度 1–5。',
    fields: [
      { key: 'name', label: '名称', t: 'str', max: 60, required: true },
      { key: 'brand', label: '品牌', t: 'str', max: 30 },
      { key: 'category', label: '分类', t: 'enum', options: GEAR_CATEGORIES },
      { key: 'rating', label: '推荐度 1–5', t: 'int', min: 1, max: 5 },
      { key: 'since', label: '入手时间', t: 'str', max: 20 },
      urlF(),
      { key: 'note', label: '一句话评价', t: 'str', max: 200, wide: true },
    ],
  },
  shelf: {
    key: 'shelf', label: '书影音', icon: 'library', path: '/shelf/', max: 200,
    note: '书 / 影 / 音 / 游四类；评分 0 表示还没评。',
    fields: [
      { key: 'kind', label: '类型', t: 'enum', options: Object.keys(SHELF_KIND), labels: Object.fromEntries(Object.entries(SHELF_KIND).map(([k, v]) => [k, v.label])) },
      { key: 'title', label: '标题', t: 'str', max: 60, required: true },
      { key: 'creator', label: '作者 / 导演 / 艺人', t: 'str', max: 60 },
      { key: 'year', label: '年份', t: 'str', max: 10 },
      { key: 'status', label: '状态', t: 'enum', options: Object.keys(SHELF_STATUS), labels: SHELF_STATUS },
      { key: 'rating', label: '评分 0–5', t: 'int', min: 0, max: 5 },
      urlF(),
      { key: 'note', label: '短评', t: 'str', max: 200, wide: true },
    ],
  },
  timeline: {
    key: 'timeline', label: '时间线', icon: 'history', path: '/timeline/', max: 100,
    note: '按日期倒序显示；日期写 2026-07 或 2026-07-15。',
    fields: [
      { key: 'date', label: '日期', t: 'str', max: 20, required: true, placeholder: '2026-07' },
      { key: 'kind', label: '类型', t: 'enum', options: Object.keys(TIMELINE_KIND), labels: Object.fromEntries(Object.entries(TIMELINE_KIND).map(([k, v]) => [k, v.label])) },
      { key: 'title', label: '标题', t: 'str', max: 60, required: true },
      urlF(),
      { key: 'detail', label: '说明', t: 'str', max: 300, wide: true },
    ],
  },
  changelog: {
    key: 'changelog', label: '更新日志', icon: 'list', path: '/changelog/', max: 100,
    note: '站点更新与周报；每行一条变更。',
    fields: [
      { key: 'version', label: '版本 / 期数', t: 'str', max: 20, required: true },
      { key: 'date', label: '日期', t: 'str', max: 20, required: true, placeholder: '2026-10-10' },
      { key: 'type', label: '类型', t: 'enum', options: Object.keys(CHANGE_TYPE), labels: CHANGE_TYPE },
      { key: 'title', label: '标题', t: 'str', max: 80, required: true, wide: true },
      { key: 'items', label: '变更（每行一条）', t: 'list', max: 20, each: 200, lines: true, wide: true },
    ],
  },
  repos: {
    key: 'repos', label: '开源项目', icon: 'github', path: '/opensource/', max: 40,
    note: 'owner / repo 填写后，浏览器会从 GitHub 公开 API 刷新星标数（失败时显示这里的数字）。没开源的项目把状态设为「暂未开源」。',
    fields: [
      { key: 'title', label: '名称', t: 'str', max: 40, required: true },
      { key: 'owner', label: 'GitHub owner', t: 'str', max: 40 },
      { key: 'repo', label: 'GitHub repo', t: 'str', max: 100 },
      { key: 'language', label: '主要语言', t: 'str', max: 20 },
      { key: 'status', label: '状态', t: 'enum', options: Object.keys(REPO_STATUS), labels: REPO_STATUS },
      { key: 'stars', label: '星标（快照）', t: 'int', min: 0, max: 10_000_000 },
      { key: 'forks', label: 'Fork（快照）', t: 'int', min: 0, max: 10_000_000 },
      urlF(),
      { key: 'topics', label: '主题（逗号分隔）', t: 'list', max: 8, each: 30, wide: true },
      { key: 'description', label: '简介', t: 'str', max: 240, wide: true },
    ],
  },
};

// ---------------------------------------------------------------- 校验
const SAFE_URL = /^(https?:\/\/[^\s<>"']+|\/[^\s<>"']*)$/i;
const DATA_IMG = /^data:image\/(png|jpeg|webp|gif|avif);base64,[a-z0-9+/]+=*$/i;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GH_NAME = /^[A-Za-z0-9_.-]*$/;
export interface SectionIssue {
  path: string;
  message: string;
}

/** 把 "a, b，c" 或数组规范成字符串数组。 */
export function toList(v: unknown, lines = false): string[] {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(lines ? /\r?\n/ : /[,，、\n]/) : [];
  return arr.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean);
}

/** 按字段规格校验并规范化一个栏目的全部条目。 */
export function validateSection<K extends SectionKey>(key: K, input: unknown): { items: SectionMap[K]; issues: SectionIssue[] } {
  const spec = SECTION_SPECS[key];
  const issues: SectionIssue[] = [];
  if (!Array.isArray(input)) return { items: [] as unknown as SectionMap[K], issues: [{ path: 'items', message: 'items 必须是数组' }] };
  if (input.length > spec.max) issues.push({ path: 'items', message: `最多 ${spec.max} 项` });
  const items = input.slice(0, spec.max).map((raw, i) => {
    const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const bad = (k: string, message: string) => issues.push({ path: `items.${i}.${k}`, message });
    for (const f of spec.fields) {
      const v = o[f.key];
      switch (f.t) {
        case 'str': {
          const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
          if (f.required && !s) bad(f.key, '必填');
          if (s.length > f.max) bad(f.key, `最多 ${f.max} 个字符`);
          out[f.key] = s.slice(0, f.max);
          break;
        }
        case 'url': {
          const s = typeof v === 'string' ? v.trim() : '';
          if (f.required && !s) bad(f.key, '必填');
          if (s && !((SAFE_URL.test(s) && s.length <= 2048) || (f.image && DATA_IMG.test(s)))) bad(f.key, '只允许 http(s) 链接或站内路径');
          out[f.key] = s;
          break;
        }
        case 'int': {
          const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : f.min;
          if (!Number.isFinite(n) || !Number.isInteger(n) || n < f.min || n > f.max) bad(f.key, `需要 ${f.min}–${f.max} 的整数`);
          out[f.key] = Number.isFinite(n) ? Math.min(f.max, Math.max(f.min, Math.round(n))) : f.min;
          break;
        }
        case 'enum': {
          const s = typeof v === 'string' && v ? v : f.options[0]!;
          if (!f.options.includes(s)) bad(f.key, `只能是 ${f.options.join(' / ')}`);
          out[f.key] = f.options.includes(s) ? s : f.options[0];
          break;
        }
        case 'list': {
          const list = toList(v, f.lines);
          if (list.length > f.max) bad(f.key, `最多 ${f.max} 项`);
          if (list.some((x) => x.length > f.each)) bad(f.key, `每项最多 ${f.each} 个字符`);
          out[f.key] = list.slice(0, f.max).map((x) => x.slice(0, f.each));
          break;
        }
      }
    }
    if (key === 'works' && out.id && !ID.test(String(out.id))) bad('id', 'id 只能包含小写字母、数字和连字符');
    if (key === 'works') {
      for (const [k, max] of [['lat', 90], ['lng', 180]] as const) {
        const raw = String(out[k] ?? '');
        const c = coarseCoord(raw, max);
        if (raw && !c) bad(k, `坐标需要是 -${max}~${max} 的十进制度数`);
        out[k] = c;
      }
    }
    if (key === 'repos' && (!GH_NAME.test(String(out.owner)) || !GH_NAME.test(String(out.repo)))) bad('repo', 'owner / repo 只能包含字母、数字、._-');
    return out;
  });
  if (key === 'works') {
    const ids = items.map((w) => w.id);
    if (new Set(ids).size !== ids.length) issues.push({ path: 'items', message: '作品 id 不能重复' });
  }
  return { items: items as unknown as SectionMap[K], issues };
}

// ---------------------------------------------------------------- 纯函数辅助
/** 「2026-07」「2026-07-15」「2026」→ 可排序的键 */
export const dateKey = (s: string) => (s || '').trim();
export function sortByDateDesc<T extends { date: string }>(list: T[]): T[] {
  return list.slice().sort((a, b) => (dateKey(a.date) < dateKey(b.date) ? 1 : dateKey(a.date) > dateKey(b.date) ? -1 : 0));
}

/**
 * 近 N 周的活动热力图数据：按天累计（文章发布记 3 分、文章更新 1 分、更新日志 2 分、额外事件 1 分）。
 * 返回从最早的周日开始、按列（周）排列的格子。纯函数，便于测试。
 */
export interface HeatCell {
  date: string;
  score: number;
  level: 0 | 1 | 2 | 3 | 4;
}
export function activityHeatmap(events: { date: string; weight: number }[], today: Date, weeks = 53): { cells: HeatCell[]; total: number; activeDays: number; streak: number } {
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (weeks - 1) * 7 - end.getUTCDay());
  const score = new Map<string, number>();
  for (const ev of events) {
    const k = (ev.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
    score.set(k, (score.get(k) ?? 0) + ev.weight);
  }
  const cells: HeatCell[] = [];
  let total = 0;
  let activeDays = 0;
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = ymd(d);
    const s = score.get(k) ?? 0;
    total += s;
    if (s > 0) activeDays++;
    cells.push({ date: k, score: s, level: s === 0 ? 0 : s <= 1 ? 1 : s <= 2 ? 2 : s <= 4 ? 3 : 4 });
  }
  let streak = 0;
  for (let i = cells.length - 1; i >= 0 && cells[i]!.score > 0; i--) streak++;
  return { cells, total, activeDays, streak };
}

/** RSS 2.0 */
export interface FeedPost {
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  category: string | null;
  publishedAt: string | null;
  updatedAt: string;
}
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
export function rssXml(o: { title: string; description: string; siteUrl: string; posts: FeedPost[]; now?: Date }): string {
  const site = o.siteUrl.replace(/\/?$/, '/');
  const items = o.posts
    .slice(0, 30)
    .map((p) => {
      const link = `${site}posts/${p.slug}/`;
      const date = new Date(p.publishedAt ?? p.updatedAt);
      return `    <item>
      <title>${xml(p.title)}</title>
      <link>${xml(link)}</link>
      <guid isPermaLink="true">${xml(link)}</guid>
      <description>${xml(p.summary)}</description>
${Number.isNaN(date.getTime()) ? '' : `      <pubDate>${date.toUTCString()}</pubDate>\n`}${[p.category, ...p.tags].filter(Boolean).map((c) => `      <category>${xml(c!)}</category>\n`).join('')}    </item>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xml(o.title)}</title>
    <link>${xml(site)}</link>
    <description>${xml(o.description)}</description>
    <language>zh-CN</language>
    <atom:link href="${xml(site)}rss.xml" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${(o.now ?? new Date()).toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

/** JSON Feed 1.1 */
export function jsonFeed(o: { title: string; description: string; siteUrl: string; posts: FeedPost[] }): string {
  const site = o.siteUrl.replace(/\/?$/, '/');
  return JSON.stringify(
    {
      version: 'https://jsonfeed.org/version/1.1',
      title: o.title,
      description: o.description,
      home_page_url: site,
      feed_url: `${site}feed.json`,
      language: 'zh-CN',
      items: o.posts.slice(0, 30).map((p) => ({ id: `${site}posts/${p.slug}/`, url: `${site}posts/${p.slug}/`, title: p.title, summary: p.summary, content_text: p.summary, date_published: p.publishedAt ?? p.updatedAt, date_modified: p.updatedAt, tags: [p.category, ...p.tags].filter(Boolean) })),
    },
    null,
    2,
  );
}

/** 站内搜索打分：标题 > 标签 / 分类 > 摘要 > 正文。返回命中的条目（已排序）。 */
export interface SearchHit<T> {
  doc: T;
  score: number;
}
export function searchDocs<T extends { title: string; summary: string; tags: string[]; category: string | null; text?: string }>(docs: T[], query: string): SearchHit<T>[] {
  const terms = query.toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean).slice(0, 8);
  if (!terms.length) return [];
  const hits: SearchHit<T>[] = [];
  for (const d of docs) {
    const title = d.title.toLowerCase();
    const meta = [...d.tags, d.category ?? ''].join(' ').toLowerCase();
    const sum = d.summary.toLowerCase();
    const text = (d.text ?? '').toLowerCase();
    let score = 0;
    let all = true;
    for (const t of terms) {
      const s = (title.includes(t) ? 10 : 0) + (meta.includes(t) ? 6 : 0) + (sum.includes(t) ? 3 : 0) + (text.includes(t) ? 1 : 0);
      if (!s) all = false;
      score += s;
    }
    if (all && score) hits.push({ doc: d, score });
  }
  return hits.sort((a, b) => b.score - a.score);
}

/** 摘出命中词附近的一段文字（纯文本；调用方负责转义后再高亮）。 */
export function snippet(text: string, query: string, len = 80): string {
  const t = query.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  const i = t ? text.toLowerCase().indexOf(t) : -1;
  if (i < 0) return text.slice(0, len) + (text.length > len ? '…' : '');
  const from = Math.max(0, i - Math.floor(len / 3));
  return (from > 0 ? '…' : '') + text.slice(from, from + len) + (from + len < text.length ? '…' : '');
}
