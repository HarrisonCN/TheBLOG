/**
 * L57 / v1.57.0 读书会（web = worker 逐字相同，纯函数）：读书会的字段表（书的作者、领读人、页数、每周进度 1–12 周且周次从 1 起连续、开始日期严格递增、每周讨论 0–20 条且编号在整本书内唯一）、当前周（Asia/Shanghai 的今天）、进度文字、摘要。
 * 校验用 content-kit 的字段表；演示站只收录虚构内容（fictional 必须为 true）。
 */
import { baseSummary, validateWith, type BaseSummary, type Schema } from './content-kit';

export { SLUG_RE, sortItems } from './content-kit';
export type { Issue } from './content-kit';

export interface Item extends BaseSummary {
  fictional: true;
  author: string;
  host: string;
  pages: number;
  weeks: Week[];
}
export interface Summary extends BaseSummary {
  author: string;
  host: string;
  weeks: number;
  starts: string;
  posts: number;
}
export const SCHEMA: Schema = {
  author: { k: 's', label: '作者', max: 30 },
  host: { k: 's', label: '领读人', max: 20 },
  pages: { k: 'i', label: '页数', lo: 1, hi: 5000 },
  weeks: {
    k: 'l',
    label: '阅读计划',
    min: 1,
    max: 12,
    of: {
      week: { k: 'i', label: '周次', lo: 1, hi: 12 },
      from: { k: 'd', label: '开始日期' },
      chapters: { k: 's', label: '章节', max: 60 },
      posts: { k: 'l', label: '讨论', min: 0, max: 20, of: { id: { k: 's', label: '编号', max: 20 }, author: { k: 's', label: '发言人', max: 20 }, text: { k: 's', label: '内容', max: 400 } } },
    },
  },
};
export interface Week {
  week: number;
  from: string;
  chapters: string;
  posts: { id: string; author: string; text: string }[];
}
/** 本机记住的进度：{ slug: [读完的周次] } */
export const PROGRESS_KEY = 'ck:bookclub:progress';
export const TZ = 'Asia/Shanghai';
/** 某个时区的今天「YYYY-MM-DD」 */
export function todayIn(now: Date, tz = TZ): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
/** 今天落在第几周（最后一周持续 7 天）；还没开始或已经读完返回 null */
export function currentWeek(weeks: Pick<Week, 'week' | 'from'>[], today: string): number | null {
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (weeks[i]!.from <= today) {
      if (i < weeks.length - 1) return weeks[i]!.week;
      const end = new Date(`${weeks[i]!.from}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 7);
      return today < end.toISOString().slice(0, 10) ? weeks[i]!.week : null;
    }
  }
  return null;
}
export const progressText = (done: number, total: number) => `已读 ${done} / ${total} 周`;

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: import('./content-kit').Issue[] } {
  return validateWith<Item>(SCHEMA, input, (it, bad, raw) => {
    const ids = new Set<string>();
    it.weeks.forEach((w, i) => {
      if (w.week !== i + 1) bad(`weeks.${i}.week`, `周次必须从 1 起连续（这里应为 ${i + 1}）`);
      if (i > 0 && w.from <= it.weeks[i - 1]!.from) bad(`weeks.${i}.from`, '每周的开始日期必须晚于上一周');
      w.posts.forEach((p, j) => {
        if (ids.has(p.id)) bad(`weeks.${i}.posts.${j}.id`, '讨论编号不能重复');
        ids.add(p.id);
      });
    });
    void raw;
  });
}
export function summarize(it: Item): Summary {
  return { ...baseSummary(it), author: it.author, host: it.host, weeks: it.weeks.length, starts: it.weeks[0]!.from, posts: it.weeks.reduce((a, w) => a + w.posts.length, 0) };
}
