/**
 * L35 / v1.35.0 3D 与沉浸式展厅：
 * - gallery-core（web = worker 同一份）：展厅校验（每件展品必须有替代文字、墙面只能是北 / 东 / 南 / 西、每面墙最多 MAX_PER_WALL 件、
 *   展品编号唯一、图片地址安全）、摘要与排序、导览顺序（按墙面）、键盘动作映射、导览步进（循环、跳墙）、
 *   视图模式判定（减少动态效果 / 不支持 3D → 平面；用户可以手动切换）、转向最近角度、读屏播报文字；
 * - 演示 mock 与 Worker 同形状：GET /api/halls、/api/halls/:slug（只给已发布）、站长 PUT / DELETE /api/admin/halls/:slug；
 * - 新路由 /halls/（摄影 › 沉浸式展厅）与 /halls/:slug/：预渲染内容是完整可读的平面展品列表（不需要 JS、不需要 3D），
 *   3D 舞台默认隐藏，只有浏览器支持且用户没有要求减少动态效果时才由 hall-client 打开；没有任何自动播放 / 自动旋转。
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_EXHIBITS, MAX_PER_WALL, WALLS, announce, decideMode, hallSummary, keyAction, sortHalls, stepTour, tourOrder, turnTo, validateHall, wallAngle, type Hall,
} from '../src/gallery-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';

const img = (n: string) => ({ src: `/demo/photos/${n}-1280.webp`, alt: `示例照片 ${n}`, w: 1280, h: 853 });
const hall = (): Hall => ({
  slug: 'test-hall',
  title: '测试展厅',
  summary: '一间测试用的展厅。',
  date: '2026-10-15',
  status: 'published',
  exhibits: [
    { id: 'e1', title: '湖', image: img('hero-lake'), wall: 'east', caption: '清晨的湖面' },
    { id: 'e2', title: '山', image: img('himalayas'), wall: 'north' },
    { id: 'e3', title: '海', image: img('baltic-view'), wall: 'east' },
    { id: 'e4', title: '花', image: img('iris'), wall: 'west' },
  ],
});

describe('gallery-core 校验', () => {
  it('合法展厅通过；去掉首尾空白', () => {
    const r = validateHall({ ...hall(), title: '  测试展厅 ' });
    expect(r.issues).toEqual([]);
    expect(r.hall!.title).toBe('测试展厅');
    expect(r.hall!.exhibits).toHaveLength(4);
  });
  it('无障碍门槛：展品缺替代文字 → 拒绝', () => {
    const h = hall();
    h.exhibits[1]!.image.alt = '  ';
    const r = validateHall(h);
    expect(r.hall).toBeNull();
    expect(r.issues.map((i) => i.path)).toContain('exhibits.1.image.alt');
  });
  it('墙面、编号、数量、地址、日期、状态', () => {
    const bad = hall() as any;
    bad.slug = 'Bad Slug';
    bad.date = '2026-02-30';
    bad.status = 'live';
    bad.exhibits[0].wall = 'ceiling';
    bad.exhibits[2].id = 'e1';
    bad.exhibits[3].image.src = 'javascript:alert(1)';
    const paths = validateHall(bad).issues.map((i) => i.path);
    for (const p of ['slug', 'date', 'status', 'exhibits.0.wall', 'exhibits.2.id', 'exhibits.3.image.src']) expect(paths).toContain(p);
    expect(validateHall({ ...hall(), exhibits: [] }).issues.map((i) => i.path)).toContain('exhibits');
    const many = Array.from({ length: MAX_EXHIBITS + 1 }, (_, i) => ({ id: `x${i}`, title: `${i}`, image: img('iris'), wall: WALLS[i % 4] }));
    expect(validateHall({ ...hall(), exhibits: many }).issues.map((i) => i.path)).toContain('exhibits');
    const crowded = Array.from({ length: MAX_PER_WALL + 1 }, (_, i) => ({ id: `y${i}`, title: `${i}`, image: img('iris'), wall: 'north' }));
    expect(validateHall({ ...hall(), exhibits: crowded }).issues.map((i) => i.path)).toContain('exhibits.north');
    expect(validateHall('x').hall).toBeNull();
    expect(validateHall({ ...hall(), exhibits: [{ ...hall().exhibits[0], image: { ...img('iris'), src: '//evil.example/a.webp' } }] }).hall).toBeNull();
    expect(validateHall({ ...hall(), exhibits: [{ ...hall().exhibits[0], image: { ...img('iris'), src: 'https://example.org/a.webp' } }] }).hall).not.toBeNull();
  });
  it('摘要（封面 = 导览第一件）与排序（日期倒序，同日按地址）', () => {
    const s = hallSummary(validateHall(hall()).hall!);
    expect(s).toMatchObject({ slug: 'test-hall', title: '测试展厅', exhibits: 4, walls: 3, date: '2026-10-15', status: 'published' });
    expect(s.cover?.src).toBe('/demo/photos/himalayas-1280.webp');
    const a = { ...hall(), slug: 'a', date: '2026-10-01' };
    const b = { ...hall(), slug: 'b', date: '2026-10-09' };
    const c = { ...hall(), slug: 'c', date: '2026-10-09' };
    expect(sortHalls([a, c, b]).map((x) => x.slug)).toEqual(['b', 'c', 'a']);
  });
});

describe('gallery-core 导览与键盘', () => {
  const h = hall();
  const order = tourOrder(h.exhibits);
  it('导览顺序：北 → 东 → 南 → 西，同一面墙保持原顺序', () => {
    expect(WALLS).toEqual(['north', 'east', 'south', 'west']);
    expect(order).toEqual([1, 0, 2, 3]);
  });
  it('键盘映射', () => {
    expect(keyAction('ArrowRight')).toBe('next');
    expect(keyAction('ArrowDown')).toBe('next');
    expect(keyAction('ArrowLeft')).toBe('prev');
    expect(keyAction('ArrowUp')).toBe('prev');
    expect(keyAction('Home')).toBe('first');
    expect(keyAction('End')).toBe('last');
    expect(keyAction('PageDown')).toBe('nextWall');
    expect(keyAction('PageUp')).toBe('prevWall');
    expect(keyAction('Enter')).toBe('open');
    expect(keyAction(' ')).toBe('open');
    expect(keyAction('Escape')).toBe('close');
    expect(keyAction('a')).toBeNull();
    expect(keyAction('Tab')).toBeNull();
  });
  it('步进：循环、首尾、跳到下一面 / 上一面有展品的墙', () => {
    expect(stepTour(0, order, 'next', h.exhibits)).toBe(1);
    expect(stepTour(3, order, 'next', h.exhibits)).toBe(0);
    expect(stepTour(0, order, 'prev', h.exhibits)).toBe(3);
    expect(stepTour(2, order, 'first', h.exhibits)).toBe(0);
    expect(stepTour(0, order, 'last', h.exhibits)).toBe(3);
    // 北(0) → 东(1,2) → 西(3)（南墙没有展品，跳过）
    expect(stepTour(0, order, 'nextWall', h.exhibits)).toBe(1);
    expect(stepTour(1, order, 'nextWall', h.exhibits)).toBe(3);
    expect(stepTour(2, order, 'nextWall', h.exhibits)).toBe(3);
    expect(stepTour(3, order, 'nextWall', h.exhibits)).toBe(0);
    expect(stepTour(0, order, 'prevWall', h.exhibits)).toBe(3);
    expect(stepTour(2, order, 'prevWall', h.exhibits)).toBe(0);
    expect(stepTour(2, order, 'open', h.exhibits)).toBe(2);
    expect(stepTour(0, [], 'next', [])).toBe(0);
  });
  it('视图模式：默认跟随系统；减少动态效果或不支持 3D → 平面；手动选择优先（不支持 3D 时仍是平面）', () => {
    expect(decideMode({ reducedMotion: false, supports3d: true, pref: 'auto' })).toBe('3d');
    expect(decideMode({ reducedMotion: true, supports3d: true, pref: 'auto' })).toBe('flat');
    expect(decideMode({ reducedMotion: false, supports3d: false, pref: 'auto' })).toBe('flat');
    expect(decideMode({ reducedMotion: false, supports3d: true, pref: 'flat' })).toBe('flat');
    expect(decideMode({ reducedMotion: true, supports3d: true, pref: '3d' })).toBe('3d');
    expect(decideMode({ reducedMotion: false, supports3d: false, pref: '3d' })).toBe('flat');
    expect(decideMode({ reducedMotion: false, supports3d: true, pref: 'weird' as never })).toBe('3d');
  });
  it('墙面角度与最近转向（不绕远路）', () => {
    expect(WALLS.map(wallAngle)).toEqual([0, 90, 180, 270]);
    expect(turnTo(0, 'north')).toBe(0);
    expect(turnTo(0, 'east')).toBe(-90);
    expect(turnTo(0, 'west')).toBe(90);
    expect(turnTo(-90, 'south')).toBe(-180);
    expect(turnTo(90, 'south')).toBe(180);
    expect(turnTo(-270, 'north')).toBe(-360);
    expect(Math.abs(turnTo(720, 'east') - 720)).toBe(90);
  });
  it('读屏播报：第几件 / 共几件 · 墙面 · 标题', () => {
    expect(announce(h.exhibits, order, 0)).toBe('第 1 件，共 4 件 · 北墙 · 山');
    expect(announce(h.exhibits, order, 2)).toBe('第 3 件，共 4 件 · 东墙 · 海');
    expect(announce([], [], 0)).toBe('');
  });
});

describe('演示 mock /api/halls', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 9, 16, 12)) });
  it('示例展厅：都已发布、都是合法展厅、图片是站内示例照片、标题标「示例」', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/halls')).body as { halls: { slug: string; title: string; exhibits: number }[] };
    expect(l.halls.length).toBeGreaterThanOrEqual(2);
    expect(l.halls.every((x) => x.title.includes('示例'))).toBe(true);
    for (const s of l.halls) {
      const d = (await b.handle('GET', `/api/halls/${s.slug}`)).body as { hall: Hall };
      expect(validateHall(d.hall).issues).toEqual([]);
      expect(d.hall.exhibits.length).toBe(s.exhibits);
      expect(d.hall.exhibits.every((x) => x.image.src.startsWith('/TheBLOG/demo/photos/'))).toBe(true);
    }
    expect((await b.handle('GET', '/api/halls/nope')).status).toBe(404);
  });
  it('站长 PUT（草稿不公开 → 发布后公开）→ DELETE；非站长 401；缺替代文字 400；地址不一致 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/halls/test-hall', hall())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/halls/test-hall', { ...hall(), status: 'draft' }, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/halls/test-hall')).status).toBe(404);
    expect(((await b.handle('GET', '/api/admin/halls', undefined, adm)).body as any).halls.some((x: any) => x.slug === 'test-hall' && x.status === 'draft')).toBe(true);
    expect((await b.handle('PUT', '/api/admin/halls/test-hall', hall(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/halls/test-hall')).status).toBe(200);
    const noAlt = hall();
    noAlt.exhibits[0]!.image.alt = '';
    expect((await b.handle('PUT', '/api/admin/halls/test-hall', noAlt, adm)).status).toBe(400);
    expect((await b.handle('PUT', '/api/admin/halls/other', hall(), adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/halls/test-hall', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/halls/test-hall')).status).toBe(404);
  });
});

describe('路由与页面', () => {
  const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
  it('路由往返；摄影 › 沉浸式展厅', () => {
    expect(parseRoute('/halls/')).toEqual({ name: 'halls' });
    expect(parseRoute('/halls/sea-and-hills/')).toEqual({ name: 'hall', slug: 'sea-and-hills' });
    expect(parseRoute('/halls/Bad Slug/').name).toBe('notfound');
    expect(routePath({ name: 'hall', slug: 'x1' } as never)).toBe('/halls/x1/');
    expect(routePath({ name: 'halls' } as never)).toBe('/halls/');
    expect(sectionOf('halls' as never)?.id).toBe('photo');
    expect(sectionOf('hall' as never)?.id).toBe('photo');
    expect(findEntry('photo', 'halls' as never)?.href).toBe('/halls/');
  });
  it('展厅页：平面展品列表完整可读（图片 + 替代文字 + 墙面 + 说明），3D 舞台默认隐藏，有键盘说明，没有自动播放', () => {
    const h = validateHall(hall()).hall!;
    const p = renderRoute({ name: 'hall', slug: 'test-hall' } as never, site, { hall: h } as never);
    expect(p.title).toMatch(/测试展厅/);
    expect(p.main).toContain('data-hall="test-hall"');
    expect(p.main).toMatch(/<ol class="hall-flat"/);
    for (const x of h.exhibits) {
      expect(p.main).toContain(`alt="${x.image.alt}"`);
      expect(p.main).toContain(`id="ex-${x.id}"`);
    }
    expect(p.main).toContain('清晨的湖面');
    // 平面列表按导览顺序：北墙的「山」在东墙的「湖」之前
    expect(p.main.indexOf('id="ex-e2"')).toBeLessThan(p.main.indexOf('id="ex-e1"'));
    expect(p.main).toMatch(/北墙/);
    expect(p.main).toMatch(/<div[^>]*data-hall-stage[^>]*hidden/);
    expect(p.main).toMatch(/方向键/);
    expect(p.main).not.toMatch(/\bautoplay\b/);
    expect(p.main).not.toMatch(/data-autoplay|data-auto-rotate/);
  });
  it('列表页：每间展厅的封面、件数、链接；空列表有提示', () => {
    const l = renderRoute({ name: 'halls' } as never, site, { halls: [hallSummary(hall())] } as never);
    expect(l.main).toContain('/halls/test-hall/');
    expect(l.main).toContain('4 件展品');
    expect(l.main).toContain('alt="示例照片 himalayas"');
    expect(renderRoute({ name: 'halls' } as never, site, { halls: [] } as never).main).toMatch(/还没有展厅/);
    expect(renderRoute({ name: 'hall', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});
