/**
 * L48 / v1.48.0 投稿与展览征集（web = worker 逐字相同，纯函数）：
 * 征集校验（主办方必须标明虚构、类型、截止时间必须带时区偏移、链接只许 https、费用、要求 1–10 条）、
 * 截止状态与剩余天数（按传入的「现在」计算，构建时和页面加载时各算一次，没有计时器）、截止时间按它自己的时区显示、
 * .ics（RFC 5545）导出、开放 / 已截止分组、摘要与排序。
 */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
export const KINDS = ['exhibition', 'contest', 'submission'] as const;
export const KIND_LABEL: Record<(typeof KINDS)[number], string> = { exhibition: '展览', contest: '比赛', submission: '投稿' };
/** 截止前多少天算「即将截止」 */
export const CLOSING_DAYS = 7;
/** 截止时间：本地时间 + 必填时区偏移（Z 或 ±HH:MM） */
export const DEADLINE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::00)?(Z|[+-]\d{2}:\d{2})$/;

export interface Item {
  slug: string;
  title: string;
  organizer: string;
  /** 主办方是否虚构：演示站只允许 true */
  fictional: true;
  kind: (typeof KINDS)[number];
  summary: string;
  deadline: string;
  fee: number;
  url?: string;
  rules: string[];
  date: string;
  status: 'published' | 'draft';
}
export interface Summary {
  slug: string;
  title: string;
  organizer: string;
  kind: Item['kind'];
  summary: string;
  deadline: string;
  fee: number;
  date: string;
  status: Item['status'];
}
export interface Issue {
  path: string;
  message: string;
}
export type State = 'open' | 'closing' | 'closed';

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);

/** 截止时间 → UTC 毫秒（格式或日期不合法 → null） */
export function deadlineMs(s: string): number | null {
  const m = DEADLINE_RE.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi] = [+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!];
  if (h > 23 || mi > 59) return null;
  const local = Date.UTC(y, mo - 1, d, h, mi);
  const t = new Date(local);
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  const off = m[6] === 'Z' ? 0 : (m[6]![0] === '-' ? -1 : 1) * (+m[6]!.slice(1, 3) * 60 + +m[6]!.slice(4, 6));
  if (Math.abs(off) > 14 * 60) return null;
  return local - off * 60000;
}
/** 状态与剩余天数（向上取整；已截止为 0） */
export function deadlineState(deadline: string, now: Date): { state: State; days: number } {
  const t = deadlineMs(deadline)!;
  const left = t - now.getTime();
  if (left <= 0) return { state: 'closed', days: 0 };
  const days = Math.ceil(left / 86400000);
  return { state: days <= CLOSING_DAYS ? 'closing' : 'open', days };
}
export function stateText(s: { state: State; days: number }): string {
  if (s.state === 'closed') return '已截止';
  return s.days <= 1 ? '今天截止' : `还剩 ${s.days} 天`;
}
/** 按截止时间自己的时区显示：「2027 年 1 月 15 日 23:59（UTC+08:00）」 */
export function deadlineText(s: string): string {
  const m = DEADLINE_RE.exec(s)!;
  const tz = m[6] === 'Z' ? 'UTC' : `UTC${m[6]}`;
  return `${+m[1]!} 年 ${+m[2]!} 月 ${+m[3]!} 日 ${m[4]}:${m[5]}（${tz}）`;
}
/** 开放（按截止时间升序）/ 已截止（按截止时间倒序，归档） */
export function partition<T extends { deadline: string; slug: string }>(list: T[], now: Date): { open: T[]; closed: T[] } {
  const ms = (x: T) => deadlineMs(x.deadline)!;
  const open = list.filter((x) => ms(x) > now.getTime()).sort((a, b) => ms(a) - ms(b) || (a.slug < b.slug ? -1 : 1));
  const closed = list.filter((x) => ms(x) <= now.getTime()).sort((a, b) => ms(b) - ms(a) || (a.slug < b.slug ? -1 : 1));
  return { open, closed };
}

const icsEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsTime = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** RFC 5545 折行：每行不超过 75 个八位字节（按 UTF-8 计），续行以一个空格开头 */
export function foldIcs(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    if (bytes + b > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}
/** 截止提醒的 .ics：一个 30 分钟的 VEVENT 结束在截止时刻，提前 1 天提醒 */
export function toIcs(it: Pick<Item, 'slug' | 'title' | 'organizer' | 'deadline' | 'url' | 'summary'>, stamp: Date): string {
  const end = deadlineMs(it.deadline)!;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TheBLOG//calls//ZH',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:call-${it.slug}@theblog.demo`,
    `DTSTAMP:${icsTime(stamp.getTime())}`,
    `DTSTART:${icsTime(end - 30 * 60000)}`,
    `DTEND:${icsTime(end)}`,
    `SUMMARY:${icsEsc(`截止：${it.title}`)}`,
    `DESCRIPTION:${icsEsc(`${it.organizer}（虚构示例）· ${it.summary}`)}`,
    ...(it.url ? [`URL:${it.url}`] : []),
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEsc(`明天截止：${it.title}`)}`,
    'TRIGGER:-P1D',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldIcs).join('\r\n') + '\r\n';
}
/** 不需要 JS 的下载链接：data:text/calendar */
export const icsHref = (ics: string) => `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: Issue[] } {
  const issues: Issue[] = [];
  const bad = (path: string, message: string) => issues.push({ path, message });
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const slug = typeof o.slug === 'string' && SLUG_RE.test(o.slug) ? o.slug : (bad('slug', '地址只能用小写字母、数字和连字符'), '');
  const title = str(o.title, 60) ?? (bad('title', '标题必填（≤ 60 字）'), '');
  const organizer = str(o.organizer, 40) ?? (bad('organizer', '主办方必填（≤ 40 字）'), '');
  if (o.fictional !== true) bad('fictional', '演示站只收录虚构征集：fictional 必须为 true');
  const kind = (KINDS as readonly unknown[]).includes(o.kind) ? (o.kind as Item['kind']) : (bad('kind', '类型只能是 exhibition / contest / submission'), 'submission');
  const summary = str(o.summary, 200) ?? (bad('summary', '简介必填（≤ 200 字）'), '');
  const deadline = typeof o.deadline === 'string' && deadlineMs(o.deadline) !== null ? o.deadline : (bad('deadline', '截止时间写成 2027-01-15T23:59+08:00（必须带时区）'), '');
  const fee = typeof o.fee === 'number' && Number.isInteger(o.fee) && o.fee >= 0 && o.fee <= 10000 ? o.fee : (bad('fee', '报名费是 0–10000 的整数（元）'), 0);
  let url: string | undefined;
  if (o.url !== undefined) {
    if (typeof o.url === 'string' && /^https:\/\/[^\s"'<>]+$/.test(o.url) && o.url.length <= 300) url = o.url;
    else bad('url', '链接必须是 https://');
  }
  const rules: string[] = [];
  if (!Array.isArray(o.rules) || o.rules.length < 1 || o.rules.length > 10) bad('rules', '要求 1–10 条');
  else
    o.rules.forEach((t, i) => {
      const s = str(t, 200);
      if (!s) return void bad(`rules.${i}`, '每条 1–200 字');
      rules.push(s);
    });
  const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : (bad('date', '日期格式 YYYY-MM-DD'), '');
  const status = o.status === 'draft' ? 'draft' : o.status === 'published' ? 'published' : (bad('status', '状态只能是 published / draft'), 'draft');
  if (issues.length) return { issues };
  return { item: { slug, title, organizer, fictional: true, kind, summary, deadline, fee, ...(url ? { url } : {}), rules, date, status: status as Item['status'] }, issues };
}

export function summarize(it: Item): Summary {
  return { slug: it.slug, title: it.title, organizer: it.organizer, kind: it.kind, summary: it.summary, deadline: it.deadline, fee: it.fee, date: it.date, status: it.status };
}
/** 默认排序：截止时间升序（列表页再按「现在」分成开放 / 已截止） */
export function sortItems<T extends { slug: string; deadline?: string; date: string }>(list: T[]): T[] {
  const k = (x: T) => (x.deadline ? deadlineMs(x.deadline) ?? 0 : 0);
  return [...list].sort((a, b) => k(a) - k(b) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}
