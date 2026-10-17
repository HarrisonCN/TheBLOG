/**
 * L45 / v1.45.0 52 周挑战：
 * - challenge-core（web = worker 同一份）：ISO 8601 周（跨年边界、53 周年份）、周一到周日范围、本周（Asia/Shanghai）、
 *   校验（年份、4–53 条、周次范围与递增、作品链接安全）、本地完成记录读回、进度文字、摘要与排序；
 * - 演示 mock 与 Worker 同形状：GET /api/challenges、/api/challenges/:slug、站长 PUT / DELETE /api/admin/challenges/:slug；
 * - 新路由 /challenges/（社区 › 52 周挑战）与 /challenges/:slug/：每周 h2 + <time> 范围；勾选与进度默认隐藏（需要 JS）。
 */
import { describe, expect, it } from 'vitest';
import { currentWeek, isoWeek, parseStored, progressText, rangeText, sortItems, storageKey, summarize, todayIn, validateItem, weekRange, weeksInYear, type Item } from '../src/challenge-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';

const ch = (over: Partial<Item> = {}): Item => ({
  slug: 'test-ch',
  title: '测试挑战',
  summary: '一份测试挑战。',
  year: 2026,
  weeks: [
    { week: 1, theme: '一', tip: '提示', link: { href: '/colors/', text: '配色' } },
    { week: 2, theme: '二' },
    { week: 3, theme: '三' },
    { week: 53, theme: '最后' },
  ],
  date: '2026-10-15',
  status: 'published',
  ...over,
});

describe('challenge-core ISO 周', () => {
  it('isoWeek：跨年边界', () => {
    expect(isoWeek('2026-01-01')).toEqual({ year: 2026, week: 1 }); // 星期四
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 }); // 星期五，属于上一年第 53 周
    expect(isoWeek('2024-12-30')).toEqual({ year: 2025, week: 1 }); // 星期一，属于下一年第 1 周
    expect(isoWeek('2026-10-17')).toEqual({ year: 2026, week: 42 });
    expect(isoWeek('2021-01-03')).toEqual({ year: 2020, week: 53 });
    expect(() => isoWeek('2026-02-30')).toThrow();
  });
  it('weeksInYear 与 weekRange', () => {
    expect([2020, 2021, 2026, 2027, 2032].map(weeksInYear)).toEqual([53, 52, 53, 52, 53]);
    expect(weekRange(2026, 1)).toEqual({ start: '2025-12-29', end: '2026-01-04' });
    expect(weekRange(2026, 42)).toEqual({ start: '2026-10-12', end: '2026-10-18' });
    expect(weekRange(2026, 53)).toEqual({ start: '2026-12-28', end: '2027-01-03' });
    expect(rangeText(weekRange(2026, 42))).toBe('10 月 12 日 – 10 月 18 日');
  });
  it('本周：按 Asia/Shanghai 的日期；不在年份或周次里 → null', () => {
    expect(todayIn(new Date(Date.UTC(2026, 9, 18, 17)))).toBe('2026-10-19'); // UTC 周日 17 点 = 上海周一 1 点
    const it2 = { year: 2026, weeks: [{ week: 42, theme: 'x' }, { week: 43, theme: 'y' }] };
    expect(currentWeek(it2, '2026-10-18')).toBe(42);
    expect(currentWeek(it2, '2026-10-19')).toBe(43);
    expect(currentWeek(it2, '2026-11-02')).toBeNull();
    expect(currentWeek({ ...it2, year: 2025 }, '2026-10-18')).toBeNull();
  });
});

describe('challenge-core 校验与本地进度', () => {
  it('合法挑战通过（2026 有 53 周）', () => {
    expect(validateItem(ch()).issues).toEqual([]);
  });
  it('年份、数量、周次范围、递增、主题、链接', () => {
    expect(validateItem(ch({ year: 1999 })).issues.map((i) => i.path)).toContain('year');
    expect(validateItem(ch({ weeks: ch().weeks.slice(0, 3) })).issues.map((i) => i.path)).toEqual(['weeks']);
    expect(validateItem(ch({ year: 2027 })).issues).toEqual([{ path: 'weeks.3.week', message: '周次必须是 1–52（2027 年有 52 个 ISO 周）' }]);
    expect(validateItem(ch({ weeks: [...ch().weeks.slice(0, 3), { week: 3, theme: 'x' }] })).issues.map((i) => i.path)).toEqual(['weeks.3.week']);
    expect(validateItem(ch({ weeks: [{ week: 1, theme: '' }, ...ch().weeks.slice(1)] })).issues.map((i) => i.path)).toEqual(['weeks.0.theme']);
    expect(validateItem(ch({ weeks: [{ week: 1, theme: 'a', link: { href: 'javascript:alert(1)', text: 'x' } }, ...ch().weeks.slice(1)] })).issues.map((i) => i.path)).toEqual(['weeks.0.link.href']);
    expect(validateItem(ch({ weeks: [{ week: 1, theme: 'a', link: { href: '//evil.example/', text: 'x' } }, ...ch().weeks.slice(1)] })).issues.map((i) => i.path)).toEqual(['weeks.0.link.href']);
  });
  it('本地记录读回：坏数据 → 空、未知周次丢掉、去重升序；进度文字', () => {
    expect(storageKey('a')).toBe('blog:challenge:a');
    expect(parseStored('{bad', [1, 2])).toEqual([]);
    expect(parseStored('"x"', [1, 2])).toEqual([]);
    expect(parseStored('[2, 9, 1, 2, "1"]', [1, 2, 3])).toEqual([1, 2]);
    expect(progressText(0, 0)).toBe('还没有主题');
    expect(progressText(2, 9)).toBe('已完成 2 / 9 周，还差 7 周');
    expect(progressText(9, 9)).toBe('全部 9 周都完成了');
  });
  it('摘要与排序', () => {
    expect(summarize(ch())).toMatchObject({ year: 2026, weeks: 4, first: 1, last: 53 });
    expect(sortItems([ch({ slug: 'a', date: '2026-01-01' }), ch({ slug: 'b', date: '2026-02-01' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
});

describe('路由与页面', () => {
  const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
  it('路由往返；社区 › 52 周挑战', () => {
    expect(parseRoute('/challenges/')).toEqual({ name: 'challenges' });
    expect(parseRoute('/challenges/phone-2026-autumn/')).toEqual({ name: 'challenge', slug: 'phone-2026-autumn' });
    expect(routePath({ name: 'challenge', slug: 'x' } as never)).toBe('/challenges/x/');
    expect(sectionOf('challenges' as never)?.id).toBe('community');
    expect(findEntry('community', 'challenges' as never)?.href).toBe('/challenges/');
  });
  it('挑战页：每周 h2 + time 范围、提示、站内链接加 base、勾选与进度默认隐藏、转义', () => {
    const p = renderRoute({ name: 'challenge', slug: 'test-ch' } as never, site, { challenge: ch({ summary: '<b>x</b>', weeks: [...ch().weeks.slice(0, 3), { week: 53, theme: '<i>末</i>' }] }) } as never);
    expect((p.main.match(/<h2 class="ch-week__h"/g) ?? []).length).toBe(4);
    expect(p.main).toContain('<time datetime="2025-12-29">12 月 29 日</time> – <time datetime="2026-01-04">1 月 4 日</time>');
    expect(p.main).toContain('id="w-53" data-week="53"');
    expect(p.main).toContain('data-ch-bar hidden');
    expect((p.main.match(/<label class="ch-week__done" hidden>/g) ?? []).length).toBe(4);
    expect(p.main).toContain('role="status"');
    expect(p.main).toMatch(/href="[^"]*\/colors\/"/);
    expect(p.main).toContain('&lt;i&gt;末&lt;/i&gt;');
    expect(p.main).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(p.main).toContain('2026 年（共 53 个 ISO 周）');
  });
  it('列表页与 404', () => {
    const l = renderRoute({ name: 'challenges' } as never, site, { challenges: [summarize(ch())] } as never);
    expect(l.main).toContain('/challenges/test-ch/');
    expect(l.main).toContain('2026 年 · 4 周 · 第 1–53 周');
    expect(renderRoute({ name: 'challenges' } as never, site, { challenges: [] } as never).main).toMatch(/还没有挑战/);
    expect(renderRoute({ name: 'challenge', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/challenges', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 9, 17, 12)) });
  it('示例：2 份已发布、都合法、日期倒序、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/challenges')).body as { challenges: { slug: string; weeks: number }[] };
    expect(l.challenges.map((x) => x.slug)).toEqual(['phone-2026-autumn', 'beginner-2027']);
    expect(l.challenges.map((x) => x.weeks)).toEqual([9, 6]);
    for (const s of l.challenges) {
      const it = ((await b.handle('GET', `/api/challenges/${s.slug}`)).body as { challenge: Item }).challenge;
      expect(validateItem(it).issues).toEqual([]);
    }
    expect((await b.handle('GET', '/api/challenges/draft-challenge')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；周次越界 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/challenges/test-ch', ch())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/challenges/test-ch', ch(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/challenges/test-ch')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/challenges/test-ch', ch({ year: 2027 }), adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/challenges/test-ch', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/challenges/test-ch')).status).toBe(404);
  });
});
