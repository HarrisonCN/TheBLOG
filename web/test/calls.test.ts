/**
 * L48 / v1.48.0 投稿与展览征集：
 * - call-core（web = worker 同一份）：截止时间必须带时区（解析、非法日期）、状态与剩余天数（向上取整、7 天内即将截止）、
 *   按截止时间自己的时区显示、开放 / 已截止分组、.ics（转义、75 字节折行、CRLF、VALARM）、校验（虚构主办方、类型、https 链接、费用、要求）、摘要与排序；
 * - 演示 mock 与 Worker 同形状：GET /api/calls、/api/calls/:slug、站长 PUT / DELETE /api/admin/calls/:slug；
 * - 新路由 /calls/（社区 › 投稿与展览征集）与 /calls/:slug/：开放中 / 已截止（归档）、状态徽标、data: .ics 下载链接。
 */
import { describe, expect, it } from 'vitest';
import { deadlineMs, deadlineState, deadlineText, foldIcs, icsHref, partition, sortItems, stateText, summarize, toIcs, validateItem, type Item } from '../src/call-core';
import { detailPage, listPage } from '../src/call-view';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';

const call = (over: Partial<Item> = {}): Item => ({
  slug: 'test-call',
  title: '测试征集',
  organizer: '测试主办（虚构）',
  fictional: true,
  kind: 'contest',
  summary: '一个测试征集。',
  deadline: '2027-01-15T18:00+08:00',
  fee: 0,
  url: 'https://example.org/x',
  rules: ['规则一'],
  date: '2026-10-15',
  status: 'published',
  ...over,
});
const NOW = new Date(Date.UTC(2027, 0, 14, 12)); // 2027-01-14 12:00 UTC

describe('call-core 截止时间', () => {
  it('解析：时区偏移必填，非法日期 → null', () => {
    expect(deadlineMs('2027-01-15T18:00+08:00')).toBe(Date.UTC(2027, 0, 15, 10));
    expect(deadlineMs('2026-04-30T17:00-04:00')).toBe(Date.UTC(2026, 3, 30, 21));
    expect(deadlineMs('2027-05-01T12:00Z')).toBe(Date.UTC(2027, 4, 1, 12));
    expect([deadlineMs('2027-01-15T18:00'), deadlineMs('2027-02-30T10:00+08:00'), deadlineMs('2027-01-15T24:00+08:00'), deadlineMs('2027-01-15T10:00+15:00')]).toEqual([null, null, null, null]);
  });
  it('状态与剩余天数（向上取整；7 天内即将截止）', () => {
    expect(deadlineState('2027-01-15T18:00+08:00', NOW)).toEqual({ state: 'closing', days: 1 });
    expect(deadlineState('2027-01-21T12:00Z', NOW)).toEqual({ state: 'closing', days: 7 });
    expect(deadlineState('2027-01-21T12:01Z', NOW)).toEqual({ state: 'open', days: 8 });
    expect(deadlineState('2027-01-14T12:00Z', NOW)).toEqual({ state: 'closed', days: 0 });
    expect([stateText({ state: 'closing', days: 1 }), stateText({ state: 'open', days: 77 }), stateText({ state: 'closed', days: 0 })]).toEqual(['今天截止', '还剩 77 天', '已截止']);
  });
  it('按截止时间自己的时区显示；开放 / 已截止分组', () => {
    expect(deadlineText('2027-01-15T18:00+08:00')).toBe('2027 年 1 月 15 日 18:00（UTC+08:00）');
    expect(deadlineText('2027-05-01T12:00Z')).toBe('2027 年 5 月 1 日 12:00（UTC）');
    const p = partition([call({ slug: 'a', deadline: '2027-03-01T00:00Z' }), call({ slug: 'b', deadline: '2027-01-15T00:00Z' }), call({ slug: 'c', deadline: '2026-01-01T00:00Z' }), call({ slug: 'd', deadline: '2026-06-01T00:00Z' })], NOW);
    expect(p.open.map((x) => x.slug)).toEqual(['b', 'a']);
    expect(p.closed.map((x) => x.slug)).toEqual(['d', 'c']);
  });
});

describe('call-core .ics', () => {
  const ics = toIcs(call({ title: '标题, 测试; 换\n行' }), new Date(Date.UTC(2026, 9, 17)));
  it('CRLF、UTC 时间、转义、VALARM 提前 1 天', () => {
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.split('\r\n').filter(Boolean).every((l) => !l.includes('\n'))).toBe(true);
    expect(ics).toContain('DTSTAMP:20261017T000000Z');
    expect(ics).toContain('DTSTART:20270115T093000Z\r\nDTEND:20270115T100000Z');
    expect(ics).toContain('SUMMARY:截止：标题\\, 测试\\; 换\\n行');
    expect(ics).toContain('UID:call-test-call@theblog.demo');
    expect(ics).toContain('URL:https://example.org/x');
    expect(ics).toContain('TRIGGER:-P1D');
  });
  it('折行：每行 ≤ 75 字节，续行以空格开头，内容不变', () => {
    const long = `SUMMARY:${'很'.repeat(60)}`;
    const f = foldIcs(long);
    expect(f.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(f.split('\r\n').slice(1).every((l) => l.startsWith(' '))).toBe(true);
    expect(f.replace(/\r\n /g, '')).toBe(long);
    expect(icsHref('A,B')).toBe('data:text/calendar;charset=utf-8,A%2CB');
  });
});

describe('call-core 校验', () => {
  it('合法征集通过；链接可省略', () => {
    expect(validateItem(call()).issues).toEqual([]);
    const { url, ...rest } = call();
    void url;
    expect(validateItem(rest).issues).toEqual([]);
  });
  it('虚构标记、类型、截止时区、链接、费用、要求', () => {
    expect(validateItem(call({ fictional: false as never })).issues.map((i) => i.path)).toEqual(['fictional']);
    expect(validateItem(call({ kind: 'fair' as never })).issues.map((i) => i.path)).toEqual(['kind']);
    expect(validateItem(call({ deadline: '2027-01-15T18:00' })).issues.map((i) => i.path)).toEqual(['deadline']);
    expect(validateItem(call({ url: 'http://example.org' })).issues.map((i) => i.path)).toEqual(['url']);
    expect(validateItem(call({ fee: -1 })).issues.map((i) => i.path)).toEqual(['fee']);
    expect(validateItem(call({ rules: [] })).issues.map((i) => i.path)).toEqual(['rules']);
  });
  it('摘要与排序（截止时间升序）', () => {
    expect(summarize(call())).toMatchObject({ organizer: '测试主办（虚构）', kind: 'contest', deadline: '2027-01-15T18:00+08:00', fee: 0 });
    expect(sortItems([call({ slug: 'a', deadline: '2027-03-01T00:00Z' }), call({ slug: 'b', deadline: '2027-01-01T00:00Z' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
});

describe('路由与页面', () => {
  const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
  it('路由往返；社区 › 投稿与展览征集', () => {
    expect(parseRoute('/calls/')).toEqual({ name: 'calls' });
    expect(parseRoute('/calls/night-city-2027/')).toEqual({ name: 'call', slug: 'night-city-2027' });
    expect(routePath({ name: 'call', slug: 'x' } as never)).toBe('/calls/x/');
    expect(sectionOf('calls' as never)?.id).toBe('community');
    expect(findEntry('community', 'calls' as never)?.href).toBe('/calls/');
  });
  it('列表页：开放中（截止升序）/ 已截止（归档）、徽标、.ics 链接', () => {
    const l = listPage(site, { name: 'calls' } as never, [summarize(call({ slug: 'late', deadline: '2027-03-01T00:00Z' })), summarize(call()), summarize(call({ slug: 'old', deadline: '2026-01-01T00:00+08:00' }))], NOW);
    const open = l.main.slice(l.main.indexOf('data-cl-open'), l.main.indexOf('data-cl-closed'));
    expect([...open.matchAll(/data-call="([^"]+)"/g)].map((m) => m[1])).toEqual(['test-call', 'late']);
    expect(l.main.slice(l.main.indexOf('data-cl-closed'))).toContain('data-call="old"');
    expect(l.main).toContain('<span class="cl-state cl-state--closing" data-deadline="2027-01-15T18:00+08:00">今天截止</span>');
    expect(l.main).toContain('<span class="cl-state cl-state--closed" data-deadline="2026-01-01T00:00+08:00">已截止</span>');
    expect(l.main).toContain('href="data:text/calendar;charset=utf-8,BEGIN%3AVCALENDAR');
    expect(l.main).toContain('download="call-test-call.ics"');
    expect(l.main).toContain('data-cl-empty hidden');
    expect(renderRoute({ name: 'calls' } as never, site, { calls: [] } as never).main).toMatch(/还没有征集/);
  });
  it('详情页：虚构声明、截止时间、费用、要求、外部链接 rel、转义；404', () => {
    const p = detailPage(site, { name: 'call', slug: 'test-call' } as never, call({ summary: '<b>x</b>', fee: 50, rules: ['<i>r</i>'] }), NOW);
    expect(p.main).toContain('虚构征集');
    expect(p.main).toContain('<time datetime="2027-01-15T18:00+08:00">2027 年 1 月 15 日 18:00（UTC+08:00）</time>');
    expect(p.main).toContain('<dd>50 元</dd>');
    expect(p.main).toContain('rel="noopener nofollow external"');
    expect(p.main).toContain('&lt;i&gt;r&lt;/i&gt;');
    expect(p.main).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(renderRoute({ name: 'call', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/calls', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 9, 17, 12)) });
  it('示例：5 条已发布、都合法且都标明虚构、截止升序、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/calls')).body as { calls: { slug: string }[] };
    expect(l.calls.map((x) => x.slug)).toEqual(['spring-walk-2026', 'summer-light-2026', 'campus-zine-2027', 'night-city-2027', 'small-prints-2027']);
    for (const s of l.calls) {
      const it = ((await b.handle('GET', `/api/calls/${s.slug}`)).body as { call: Item }).call;
      expect(validateItem(it).issues).toEqual([]);
      expect(it.fictional).toBe(true);
    }
    expect((await b.handle('GET', '/api/calls/draft-call')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；无时区 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/calls/test-call', call())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/calls/test-call', call(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/calls/test-call')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/calls/test-call', call({ deadline: '2027-01-15T18:00' }), adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/calls/test-call', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/calls/test-call')).status).toBe(404);
  });
});
