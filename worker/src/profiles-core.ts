/**
 * L59 / v1.59.0 成员主页与成就（web = worker 逐字相同，纯函数）：成员主页的字段表（昵称、加入日期不晚于更新日期、简介、所在地、参与数据：帖子 / 回答 / 被采纳（不超过回答数）/ 参加活动 / 最长连续天数、外部链接 https）、8 枚成就的规则与进度、入站天数、摘要。
 * 校验用 content-kit 的字段表；演示站只收录虚构内容（fictional 必须为 true）。
 */
import { baseSummary, validateWith, type BaseSummary, type Schema } from './content-kit';

export { SLUG_RE, sortItems } from './content-kit';
export type { Issue } from './content-kit';

export interface Item extends BaseSummary {
  fictional: true;
  name: string;
  joined: string;
  bio: string;
  city: string;
  stats: Stats;
  links: { label: string; url: string }[];
}
export interface Summary extends BaseSummary {
  name: string;
  joined: string;
  badges: number;
}
export const SCHEMA: Schema = {
  name: { k: 's', label: '昵称', max: 20 },
  joined: { k: 'd', label: '加入日期' },
  bio: { k: 's', label: '简介', max: 200 },
  city: { k: 's', label: '所在地', max: 20 },
  stats: {
    k: 'l',
    label: '参与数据',
    min: 1,
    max: 1,
    of: {
      posts: { k: 'i', label: '帖子数', lo: 0, hi: 100000 },
      answers: { k: 'i', label: '回答数', lo: 0, hi: 100000 },
      accepted: { k: 'i', label: '被采纳数', lo: 0, hi: 100000 },
      meetups: { k: 'i', label: '参加活动数', lo: 0, hi: 10000 },
      streak: { k: 'i', label: '最长连续天数', lo: 0, hi: 10000 },
    },
  },
  links: { k: 'l', label: '链接', min: 0, max: 4, of: { label: { k: 's', label: '链接名', max: 20 }, url: { k: 'u', label: '链接地址' } } },
};
export interface StatsRow {
  posts: number;
  answers: number;
  accepted: number;
  meetups: number;
  streak: number;
}
/** stats 存成只有一行的列表（字段表只支持对象列表），用 statsOf 取出 */
export type Stats = [StatsRow];
export const statsOf = (it: Pick<Item, 'stats'>): StatsRow => it.stats[0];
type Metric = keyof StatsRow | 'days';
export interface Badge {
  id: string;
  label: string;
  desc: string;
  metric: Metric;
  goal: number;
}
/** 成就规则（公开、固定；按数据自动点亮） */
export const BADGES: Badge[] = [
  { id: 'first-post', label: '第一帖', desc: '发出第一个帖子', metric: 'posts', goal: 1 },
  { id: 'prolific', label: '笔耕不辍', desc: '累计 50 个帖子', metric: 'posts', goal: 50 },
  { id: 'helper', label: '热心解答', desc: '回答 10 个问题', metric: 'answers', goal: 10 },
  { id: 'expert', label: '最佳答案', desc: '5 个回答被采纳', metric: 'accepted', goal: 5 },
  { id: 'social', label: '聚会达人', desc: '参加 3 次活动', metric: 'meetups', goal: 3 },
  { id: 'streak7', label: '连续七天', desc: '连续 7 天来社区', metric: 'streak', goal: 7 },
  { id: 'streak30', label: '月度常客', desc: '连续 30 天来社区', metric: 'streak', goal: 30 },
  { id: 'veteran', label: '老朋友', desc: '加入满一年', metric: 'days', goal: 365 },
];
/** 加入到 asOf（含）之间的天数 */
export const daysBetween = (from: string, asOf: string) => Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
/** 每枚成就的进度：value（封顶到 goal）与是否获得；天数按更新日期算，保证预渲染稳定 */
export function badgeProgress(it: Pick<Item, 'stats' | 'joined' | 'date'>): { badge: Badge; value: number; earned: boolean }[] {
  const s = statsOf(it);
  const days = daysBetween(it.joined, it.date);
  return BADGES.map((b) => {
    const v = b.metric === 'days' ? days : s[b.metric];
    return { badge: b, value: Math.min(v, b.goal), earned: v >= b.goal };
  });
}
export const earnedCount = (it: Pick<Item, 'stats' | 'joined' | 'date'>) => badgeProgress(it).filter((x) => x.earned).length;
export const remainText = (b: Badge, value: number) => (value >= b.goal ? '已获得' : `还差 ${b.goal - value}${b.metric === 'days' ? ' 天' : ''}`);

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: import('./content-kit').Issue[] } {
  return validateWith<Item>(SCHEMA, input, (it, bad, raw) => {
    if (it.joined > it.date) bad('joined', '加入日期不能晚于更新日期');
    const s = it.stats[0];
    if (s && s.accepted > s.answers) bad('stats.0.accepted', '被采纳数不能超过回答数');
    void raw;
  });
}
export function summarize(it: Item): Summary {
  return { ...baseSummary(it), name: it.name, joined: it.joined, badges: earnedCount(it) };
}
