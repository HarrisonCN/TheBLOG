/**
 * L60 / v1.60.0 社区周刊（web = worker 逐字相同，纯函数）：周刊的字段表（ISO 周起始日必须是周一、编辑、导语 1–4 段、栏目按动态类型分组且类型不重复、每条动态时间落在这一周内；已发布的一期至少 1 个栏目）、ISO 周号、日期范围、从成员动态自动组稿（assembleIssue）、摘要。
 * 校验用 content-kit 的字段表；演示站只收录虚构内容（fictional 必须为 true）。
 */
import { baseSummary, validateWith, type BaseSummary, type Schema } from './content-kit';

export { SLUG_RE, sortItems } from './content-kit';
export type { Issue } from './content-kit';

export interface Item extends BaseSummary {
  fictional: true;
  from: string;
  editor: string;
  intro: string[];
  sections: Section[];
}
export interface Summary extends BaseSummary {
  week: string;
  from: string;
  count: number;
  members: number;
}
export const SCHEMA: Schema = {
  from: { k: 'd', label: '周起始日' },
  editor: { k: 's', label: '编辑', max: 20 },
  intro: { k: 'p', label: '导语', min: 1, max: 4, len: 400 },
  sections: {
    k: 'l',
    label: '栏目',
    min: 0,
    max: 6,
    of: {
      verb: { k: 'e', label: '类型', vals: ['post', 'join', 'answer', 'vote', 'read', 'share'] },
      items: { k: 'l', label: '动态', min: 1, max: 30, of: { member: { k: 's', label: '成员', max: 20 }, slug: { k: 's', label: '成员地址', max: 60 }, at: { k: 'dt', label: '时间' }, text: { k: 's', label: '内容', max: 200 } } },
    },
  },
};
type Verb = 'post' | 'join' | 'answer' | 'vote' | 'read' | 'share';
export interface Section {
  verb: Verb;
  items: { member: string; slug: string; at: string; text: string }[];
}
export const VERB_ORDER: Verb[] = ['post', 'join', 'answer', 'vote', 'read', 'share'];
export const SECTION_TITLES: Record<Verb, string> = { post: '新帖与发起', join: '新加入', answer: '本周回答', vote: '投票与测验', read: '读完的书', share: '分享' };
const day = (d: string, add: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + add);
  return t.toISOString().slice(0, 10);
};
/** 是否周一 */
export const isMonday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1;
/** ISO 8601 周号「2026-W45」（周一开始，含 1 月 4 日的那一周是第 1 周） */
export function isoWeek(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7));
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
/** 「2026-11-02 – 2026-11-08」 */
export const weekRange = (from: string) => `${from} – ${day(from, 6)}`;
/** 动态时间是否落在 from 起的 7 天内 */
export const inWeek = (at: string, from: string) => at.slice(0, 10) >= from && at.slice(0, 10) <= day(from, 6);
/** 从成员动态自动组稿：只取这一周的动态，按类型分栏（固定顺序），栏内按时间先后 */
export function assembleIssue(streams: { slug: string; member: string; entries: { id: string; at: string; verb: Verb; text: string }[] }[], from: string): Section[] {
  const all = streams.flatMap((s) => s.entries.filter((x) => inWeek(x.at, from)).map((x) => ({ verb: x.verb, member: s.member, slug: s.slug, at: x.at, text: x.text, id: x.id })));
  return VERB_ORDER.map((verb) => ({
    verb,
    items: all
      .filter((x) => x.verb === verb)
      .sort((a, b) => (a.at !== b.at ? (a.at < b.at ? -1 : 1) : a.slug !== b.slug ? (a.slug < b.slug ? -1 : 1) : a.id < b.id ? -1 : 1))
      .map(({ member, slug, at, text }) => ({ member, slug, at, text })),
  })).filter((s) => s.items.length);
}

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: import('./content-kit').Issue[] } {
  return validateWith<Item>(SCHEMA, input, (it, bad, raw) => {
    if (!isMonday(it.from)) bad('from', '周起始日必须是周一');
    const verbs = new Set<string>();
    it.sections.forEach((s, i) => {
      if (verbs.has(s.verb)) bad(`sections.${i}.verb`, '同一类型只能有一个栏目');
      verbs.add(s.verb);
      s.items.forEach((x, j) => {
        if (!inWeek(x.at, it.from)) bad(`sections.${i}.items.${j}.at`, '动态时间不在这一周内');
      });
    });
    if (it.status === 'published' && !it.sections.length) bad('sections', '已发布的周刊至少要有 1 个栏目');
    void raw;
  });
}
export function summarize(it: Item): Summary {
  return { ...baseSummary(it), week: isoWeek(it.from), from: it.from, count: it.sections.reduce((a, s) => a + s.items.length, 0), members: new Set(it.sections.flatMap((s) => s.items.map((x) => x.slug))).size };
}
