/**
 * L56 / v1.56.0 活动与聚会（web = worker 逐字相同，纯函数）：活动的字段表（主办人、开始 / 结束时间 YYYY-MM-DDTHH:MM（北京时间）、地点或线上、名额 1–500、已报名不超过名额、议程 1–12 项 HH:MM）、时间文字、剩余名额、iCalendar（.ics，UTC 时间、转义、CRLF）、是否已结束、摘要。
 * 校验用 content-kit 的字段表；演示站只收录虚构内容（fictional 必须为 true）。
 */
import { baseSummary, validateWith, type BaseSummary, type Schema } from './content-kit';

export { SLUG_RE, sortItems } from './content-kit';
export type { Issue } from './content-kit';

export interface Item extends BaseSummary {
  fictional: true;
  host: string;
  start: string;
  end: string;
  place: string;
  online: boolean;
  capacity: number;
  going: number;
  agenda: { time: string; text: string }[];
  tags: string[];
}
export interface Summary extends BaseSummary {
  host: string;
  start: string;
  end: string;
  place: string;
  online: boolean;
  left: number;
}
export const SCHEMA: Schema = {
  host: { k: 's', label: '主办人', max: 20 },
  start: { k: 'dt', label: '开始时间' },
  end: { k: 'dt', label: '结束时间' },
  place: { k: 's', label: '地点', max: 60 },
  online: { k: 'b', label: '线上活动' },
  capacity: { k: 'i', label: '名额', lo: 1, hi: 500 },
  going: { k: 'i', label: '已报名', lo: 0, hi: 500 },
  agenda: { k: 'l', label: '议程', min: 1, max: 12, of: { time: { k: 's', label: '时间', max: 5 }, text: { k: 's', label: '内容', max: 80 } } },
  tags: { k: 't', label: '标签', max: 5, len: 12 },
};
/** 本机记住的报名：{ slug: 'going' | 'maybe' | 'no' } */
export const RSVP_KEY = 'ck:meetups:rsvp';
export const TZ_LABEL = '北京时间';
/** 北京时间（UTC+8，无夏令时）→ UTC 的 iCalendar 时间「20261205T060000Z」 */
export function icsTime(dt: string): string {
  const [d, t] = dt.split('T');
  const [y, mo, da] = d!.split('-').map(Number);
  const [h, mi] = t!.split(':').map(Number);
  const u = new Date(Date.UTC(y!, mo! - 1, da!, h! - 8, mi!));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${u.getUTCFullYear()}${p(u.getUTCMonth() + 1)}${p(u.getUTCDate())}T${p(u.getUTCHours())}${p(u.getUTCMinutes())}00Z`;
}
/** 北京时间的活动结束时刻（毫秒） */
export const endMs = (dt: string) => Date.parse(`${dt}:00+08:00`);
export const isPast = (end: string, now: Date) => endMs(end) <= now.getTime();
const icsEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/([;,])/g, '\\$1').replace(/\r?\n/g, '\\n');
/** 一个活动的 .ics 文本（CRLF 换行；DTSTAMP 用活动发布日期，保证预渲染结果稳定） */
export function toIcs(it: Pick<Item, 'slug' | 'title' | 'summary' | 'start' | 'end' | 'place' | 'online' | 'date'>): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TheBLOG demo//meetups//ZH',
    'BEGIN:VEVENT',
    `UID:${it.slug}@theblog-demo`,
    `DTSTAMP:${it.date.replace(/-/g, '')}T000000Z`,
    `DTSTART:${icsTime(it.start)}`,
    `DTEND:${icsTime(it.end)}`,
    `SUMMARY:${icsEsc(it.title)}`,
    `DESCRIPTION:${icsEsc(it.summary)}`,
    `LOCATION:${icsEsc(it.online ? `线上：${it.place}` : it.place)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
/** 「2026-12-05 14:00–17:00（北京时间）」；跨天时写全两端 */
export function whenText(start: string, end: string): string {
  const [sd, st] = start.split('T');
  const [ed, et] = end.split('T');
  return sd === ed ? `${sd} ${st}–${et}（${TZ_LABEL}）` : `${sd} ${st} – ${ed} ${et}（${TZ_LABEL}）`;
}
/** 剩余名额（本机「参加」占一个） */
export const seatsLeft = (capacity: number, going: number, mineGoing = false) => Math.max(0, capacity - going - (mineGoing ? 1 : 0));
export const seatsText = (left: number) => (left > 0 ? `还剩 ${left} 个名额` : '名额已满');

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: import('./content-kit').Issue[] } {
  return validateWith<Item>(SCHEMA, input, (it, bad, raw) => {
    if (it.end <= it.start) bad('end', '结束时间必须晚于开始时间');
    if (it.going > it.capacity) bad('going', '已报名人数不能超过名额');
    it.agenda.forEach((a, i) => {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(a.time)) bad(`agenda.${i}.time`, '议程时间格式 HH:MM');
    });
    void raw;
  });
}
export function summarize(it: Item): Summary {
  return { ...baseSummary(it), host: it.host, start: it.start, end: it.end, place: it.place, online: it.online, left: seatsLeft(it.capacity, it.going) };
}
