/**
 * L56 / v1.56.0 活动与聚会：
 * - meetups-core（web = worker 同一份）：字段表校验（虚构声明、必填、地址、日期）与本栏目规则、摘要、排序、辅助函数；
 * - 演示 mock 与 Worker 同形状：GET /api/meetups、/api/meetups/:slug、站长 PUT / DELETE /api/admin/meetups/:slug；
 * - 新路由 /meetups/（社区 › 活动与聚会）与 /meetups/:slug/：列表卡片、详情正文、转义、404。
 */
import { describe, expect, it } from 'vitest';
import * as C from '../src/meetups-core';
import { sortItems, summarize, validateItem, type Item } from '../src/meetups-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';
void C;

const base = (over: Partial<Item> = {}): Item => ({ ...structuredClone({
  "slug": "winter-board-games",
  "title": "冬日桌游下午",
  "summary": "带上你喜欢的桌游，一起玩一个下午，新手友好。",
  "fictional": true,
  "date": "2026-11-06",
  "status": "published",
  "host": "小满（虚构）",
  "start": "2026-12-05T14:00",
  "end": "2026-12-05T17:30",
  "place": "示例社区活动室（虚构地址）",
  "online": false,
  "capacity": 20,
  "going": 19,
  "agenda": [
    {
      "time": "14:00",
      "text": "签到、分组"
    },
    {
      "time": "14:30",
      "text": "轻策略桌游两轮"
    },
    {
      "time": "16:30",
      "text": "自由交换桌游、合影"
    }
  ],
  "tags": [
    "桌游",
    "线下"
  ]
}), slug: 'test-x', status: 'published', ...over }) as unknown as Item;
const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
const paths = (x: unknown) => validateItem(x).issues.map((i) => i.path);

describe('meetups-core', () => {
  it('合法条目通过', () => {
    expect(validateItem(base()).issues).toEqual([]);
  });
  it('虚构声明、必填、地址、日期、状态', () => {
    expect(paths(base({ fictional: false as never }))).toEqual(['fictional']);
    expect(paths(base({ title: '' }))).toEqual(['title']);
    expect(paths(base({ slug: 'Bad Slug' }))).toEqual(['slug']);
    expect(paths(base({ date: '2026/10/01' }))).toEqual(['date']);
    expect(paths(base({ status: 'x' as never }))).toEqual(['status']);
  });
  it('本栏目规则：结束晚于开始、已报名不超过名额、议程时间 HH:MM', () => {
    expect(paths({ ...base(), ...{
  "end": "2026-12-05T13:00"
} })).toContain("end");
  });
  it('摘要与排序', () => {
    expect(summarize(base())).toMatchObject({ slug: 'test-x', title: base().title });
    expect(sortItems([base({ slug: 'a', date: '2026-01-01' }), base({ slug: 'b', date: '2026-02-01' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
  it('时间先后、名额、议程时间、iCalendar、时间文字、是否结束', () => {
    expect(paths(base({ going: 21 }))).toEqual(['going']);
    expect(paths(base({ agenda: [{ time: '25:00', text: 'x' }] }))).toEqual(['agenda.0.time']);
    expect(paths(base({ start: '2026-12-05 14:00' }))).toEqual(['start']);
    expect(C.icsTime('2026-12-05T14:00')).toBe('20261205T060000Z');
    expect(C.icsTime('2026-12-06T03:30')).toBe('20261205T193000Z');
    const ics = C.toIcs(base({ title: '桌游; 下午, 见', summary: '第一行\n第二行' }));
    expect(ics.split('\r\n')).toContain('DTSTART:20261205T060000Z');
    expect(ics.split('\r\n')).toContain('DTEND:20261205T093000Z');
    expect(ics).toContain('SUMMARY:桌游\\; 下午\\, 见');
    expect(ics).toContain('DESCRIPTION:第一行\\n第二行');
    expect(ics).toContain('DTSTAMP:20261106T000000Z');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(C.whenText('2026-12-05T14:00', '2026-12-05T17:30')).toBe('2026-12-05 14:00–17:30（北京时间）');
    expect(C.whenText('2026-12-05T22:00', '2026-12-06T01:00')).toBe('2026-12-05 22:00 – 2026-12-06 01:00（北京时间）');
    expect(C.isPast('2026-12-05T17:30', new Date('2026-12-05T09:29:00Z'))).toBe(false);
    expect(C.isPast('2026-12-05T17:30', new Date('2026-12-05T09:30:00Z'))).toBe(true);
    expect([C.seatsLeft(20, 19), C.seatsLeft(20, 19, true), C.seatsLeft(15, 15)]).toEqual([1, 0, 0]);
    expect([C.seatsText(3), C.seatsText(0)]).toEqual(['还剩 3 个名额', '名额已满']);
  });
});

describe('路由与页面', () => {
  it('路由往返；社区 › 活动与聚会', () => {
    expect(parseRoute('/meetups/')).toEqual({ name: 'meetups' });
    expect(parseRoute('/meetups/winter-board-games/')).toEqual({ name: 'meetup', slug: 'winter-board-games' });
    expect(routePath({ name: 'meetup', slug: 'x' } as never)).toBe('/meetups/x/');
    expect(sectionOf('meetups' as never)?.id).toBe('community');
    expect(findEntry('community', 'meetups' as never)?.href).toBe('/meetups/');
  });
  it('详情页：虚构声明、简介转义、正文', () => {
    const p = renderRoute({ name: 'meetup', slug: 'test-x' } as never, site, { meetup: base({ summary: '<b>简介</b>' }) } as never);
    expect(p.main).toContain('ck-note');
    expect(p.main).toContain('&lt;b&gt;简介&lt;/b&gt;');
    expect(p.main).not.toContain('<b>简介</b>');
    expect(p.main).toContain('data-mu-rsvp hidden');
    expect(p.main).toContain('href="data:text/calendar;charset=utf-8,BEGIN%3AVCALENDAR');
    expect(p.main).toContain('download="test-x.ics"');
    expect(p.main).toContain('还剩 1 个名额');
    expect((p.main.match(/<span class="mu-time">/g) ?? []).length).toBe(3);
  });
  it('列表页卡片；空列表与 404', () => {
    const l = renderRoute({ name: 'meetups' } as never, site, { meetups: [summarize(base())] } as never);
    expect(l.main).toContain('/meetups/test-x/');
    expect((l.main.match(/class="ck-card"/g) ?? []).length).toBe(1);
    expect(l.main).toContain('data-mu-end="2026-12-05T17:30">2026-12-05 14:00–17:30（北京时间）</span> · 示例社区活动室（虚构地址） · 还剩 1 个名额');
    expect(renderRoute({ name: 'meetups' } as never, site, { meetups: [] } as never).main).toContain('还没有活动。');
    expect(renderRoute({ name: 'meetup', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/meetups', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 10, 8, 12)) });
  it('示例：已发布按日期倒序、全部合法且虚构、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/meetups')).body as { meetups: { slug: string }[] };
    expect(l.meetups.map((x) => x.slug)).toEqual([
  "winter-board-games",
  "online-reading-night",
  "autumn-city-walk"
]);
    for (const s of l.meetups) {
      const it = ((await b.handle('GET', `/api/meetups/${s.slug}`)).body as { meetup: Item }).meetup;
      expect(validateItem(it).issues).toEqual([]);
      expect(it.fictional).toBe(true);
    }
    expect((await b.handle('GET', '/api/meetups/draft-meetup')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；校验失败 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/meetups/test-x', base())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/meetups/test-x', base(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/meetups/test-x')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/meetups/test-x', { ...base(), ...{
  "end": "2026-12-05T13:00"
} }, adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/meetups/test-x', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/meetups/test-x')).status).toBe(404);
  });
});
