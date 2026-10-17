// @vitest-environment happy-dom
/**
 * L39 / v1.39.0 照片日历：
 * - calendar-core（web = worker 同一份）：校验（地址 YYYY-MM、日期在当月范围（含闰年）、同一天只能一张、替代文字必填）、
 *   摘要（张数、封面 = 第一天）、月份倒序、月历网格（周一开头）、星期、相邻月份、Asia/Shanghai 的「今天」；
 * - 演示 mock 与 Worker 同形状：GET /api/calendar、/api/calendar/:yyyy-mm、站长 PUT / DELETE /api/admin/calendar/:yyyy-mm；
 * - 新路由 /calendar/（摄影 › 照片日历）与 /calendar/:yyyy-mm/：月历表格（caption、列标题）+ 图片列表，没有 JS 也完整；
 *   calendar-client 只把今天的格子标成 aria-current="date"。
 */
import { describe, expect, it } from 'vitest';
import { adjacent, daysInMonth, monthGrid, monthLabel, sortItems, summarize, todayIn, validateItem, weekdayOf, type Item } from '../src/calendar-core';
import { bind } from '../src/calendar-client';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';

const img = (n: string) => ({ src: `/demo/photos/${n}.webp`, alt: `示例 ${n}`, w: 1280, h: 853 });
const mo = (over: Partial<Item> = {}): Item => ({
  slug: '2026-10',
  title: '十月',
  days: [{ day: 3, title: '三号', image: img('c') }, { day: 1, title: '一号', image: img('a'), note: '第一天' }],
  date: '2026-10-17',
  status: 'published',
  ...over,
});

describe('calendar-core 日历', () => {
  it('每月天数（含闰年）、星期（周一 = 0）', () => {
    expect([daysInMonth(2026, 2), daysInMonth(2028, 2), daysInMonth(2100, 2), daysInMonth(2000, 2), daysInMonth(2026, 10)]).toEqual([28, 29, 28, 29, 31]);
    expect(weekdayOf(2026, 10, 1)).toBe(3); // 2026-10-01 是星期四
    expect(weekdayOf(2026, 10, 5)).toBe(0); // 星期一
  });
  it('月历网格：周一开头、前后补空、每行 7 格', () => {
    const g = monthGrid(2026, 10);
    expect(g.every((r) => r.length === 7)).toBe(true);
    expect(g[0]).toEqual([null, null, null, 1, 2, 3, 4]);
    expect(g.at(-1)).toEqual([26, 27, 28, 29, 30, 31, null]);
    expect(monthGrid(2021, 2)).toHaveLength(4); // 2021 年 2 月从周一开始、正好四周
    expect(monthLabel('2026-09')).toBe('2026 年 9 月');
  });
  it('Asia/Shanghai 的今天（跨日边界）', () => {
    expect(todayIn(new Date('2026-10-17T15:59:00Z'))).toBe('2026-10-17');
    expect(todayIn(new Date('2026-10-17T16:01:00Z'))).toBe('2026-10-18');
    expect(todayIn(new Date('2026-10-17T16:01:00Z'), 'America/New_York')).toBe('2026-10-17');
  });
});

describe('calendar-core 校验与排序', () => {
  it('合法月份通过，按日期排好', () => {
    const r = validateItem(mo());
    expect(r.issues).toEqual([]);
    expect(r.item!.days.map((d) => d.day)).toEqual([1, 3]);
  });
  it('日期超出当月、同一天两张、缺替代文字、地址不是月份', () => {
    expect(validateItem(mo({ slug: '2026-02', days: [{ day: 29, title: 'x', image: img('a') }] })).issues).toEqual([{ path: 'days.0.day', message: '日期必须在 1–28 之间' }]);
    expect(validateItem(mo({ slug: '2028-02', days: [{ day: 29, title: 'x', image: img('a') }] })).issues).toEqual([]);
    expect(validateItem(mo({ days: [{ day: 2, title: 'a', image: img('a') }, { day: 2, title: 'b', image: img('b') }] })).issues[0]!.message).toBe('2 日已经有一张了');
    expect(validateItem(mo({ days: [{ day: 2, title: 'a', image: { ...img('a'), alt: '' } }] })).issues.map((i) => i.path)).toEqual(['days.0.image.alt']);
    expect(validateItem(mo({ slug: '2026-13' })).issues.map((i) => i.path)).toEqual(['slug']);
    expect(validateItem(mo({ slug: 'october' })).issues.map((i) => i.path)).toEqual(['slug']);
  });
  it('摘要、月份倒序、相邻月份', () => {
    expect(summarize(validateItem(mo()).item!)).toMatchObject({ count: 2, cover: { alt: '示例 a' } });
    const list = [mo({ slug: '2026-08' }), mo({ slug: '2026-10' }), mo({ slug: '2026-09' })];
    expect(sortItems(list).map((x) => x.slug)).toEqual(['2026-10', '2026-09', '2026-08']);
    const a = adjacent(list, '2026-09');
    expect([a.prev?.slug, a.next?.slug]).toEqual(['2026-08', '2026-10']);
    expect(adjacent(list, '2026-10').next).toBeNull();
  });
});

describe('路由与页面', () => {
  const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
  it('路由往返；摄影 › 照片日历', () => {
    expect(parseRoute('/calendar/')).toEqual({ name: 'calendar' });
    expect(parseRoute('/calendar/2026-10/')).toEqual({ name: 'calendarmonth', slug: '2026-10' });
    expect(parseRoute('/calendar/2026-13/').name).toBe('notfound');
    expect(routePath({ name: 'calendarmonth', slug: '2026-09' } as never)).toBe('/calendar/2026-09/');
    expect(sectionOf('calendar' as never)?.id).toBe('photo');
    expect(sectionOf('calendarmonth' as never)?.id).toBe('photo');
    expect(findEntry('photo', 'calendar' as never)?.href).toBe('/calendar/');
  });
  it('月份页：月历表格语义、有图的日子链接到条目、图片列表带替代文字与星期；转义', () => {
    const p = renderRoute({ name: 'calendarmonth', slug: '2026-10' } as never, site, { calMonth: validateItem(mo({ title: '<b>十月</b>' })).item } as never);
    expect(p.main).toContain('<caption>2026 年 10 月 · 2 张</caption>');
    expect((p.main.match(/<th scope="col"/g) ?? []).length).toBe(7);
    expect((p.main.match(/<tr>/g) ?? []).length).toBe(6); // 表头 + 5 周
    expect(p.main).toContain('href="#d-1"');
    expect(p.main).toContain('id="d-3"');
    expect(p.main).toContain('alt="示例 a"');
    expect(p.main).toContain('10 月 1 日 · 星期四');
    expect(p.main).toContain('data-date="2026-10-17"');
    expect(p.title).toContain('&lt;b&gt;');
  });
  it('列表页与 404', () => {
    const l = renderRoute({ name: 'calendar' } as never, site, { calMonths: [summarize(validateItem(mo()).item!)] } as never);
    expect(l.main).toContain('/calendar/2026-10/');
    expect(l.main).toContain('2026 年 10 月 · 2 张');
    expect(renderRoute({ name: 'calendar' } as never, site, { calMonths: [] } as never).main).toMatch(/还没有照片日历/);
    expect(renderRoute({ name: 'calendarmonth', slug: '2020-01' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
  it('calendar-client：把今天的格子标成 aria-current="date"（其余不标）', () => {
    const p = renderRoute({ name: 'calendarmonth', slug: '2026-10' } as never, site, { calMonth: validateItem(mo()).item } as never);
    const div = document.createElement('div');
    div.innerHTML = p.main;
    bind(div, new Date('2026-10-17T04:00:00Z'));
    const cur = div.querySelectorAll('[aria-current="date"]');
    expect(cur).toHaveLength(1);
    expect((cur[0] as HTMLElement).dataset.date).toBe('2026-10-17');
    expect(cur[0]!.textContent).toContain('今天');
    bind(div, new Date('2026-11-17T04:00:00Z'));
    expect(div.querySelectorAll('[aria-current="date"]')).toHaveLength(0);
  });
});

describe('演示 mock /api/calendar', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 9, 17, 12)) });
  it('示例月份：2 个已发布、月份倒序、都合法、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/calendar')).body as { months: { slug: string; count: number }[] };
    expect(l.months.map((x) => `${x.slug}:${x.count}`)).toEqual(['2026-10:12', '2026-09:8']);
    for (const s of l.months) {
      const d = (await b.handle('GET', `/api/calendar/${s.slug}`)).body as { month: Item };
      expect(validateItem(d.month).issues).toEqual([]);
      expect(d.month.days.every((x) => x.image.src.startsWith('/TheBLOG/demo/photos/'))).toBe(true);
    }
    expect((await b.handle('GET', '/api/calendar/2026-11')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；日期越界 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/calendar/2026-08', mo({ slug: '2026-08' }))).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/calendar/2026-08', mo({ slug: '2026-08' }), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/calendar/2026-08')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/calendar/2026-02', mo({ slug: '2026-02', days: [{ day: 30, title: 'x', image: img('a') }] }), adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/calendar/2026-08', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/calendar/2026-08')).status).toBe(404);
  });
});
