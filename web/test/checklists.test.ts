/**
 * L38 / v1.38.0 拍摄清单：
 * - checklist-core（web = worker 同一份）：校验（1–8 组、每组 1–20 项、最多 80 项、条目编号唯一）、摘要、按拍摄类型排序、
 *   本地勾选记录的读回（坏数据 → 空、丢掉未知编号、去重）、进度与进度文字；
 * - 演示 mock 与 Worker 同形状：GET /api/checklists、/api/checklists/:slug、站长 PUT / DELETE /api/admin/checklists/:slug；
 * - 新路由 /checklists/（工具 › 拍摄清单）与 /checklists/:slug/：真正的复选框 + fieldset/legend（没有 JS 也能勾和打印），进度条默认隐藏。
 */
import { describe, expect, it } from 'vitest';
import { KIND_LABEL, MAX_ITEMS, allIds, parseStored, progress, progressText, sortItems, storageKey, summarize, validateItem, type Item } from '../src/checklist-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';

const ck = (over: Partial<Item> = {}): Item => ({
  slug: 'test-list',
  title: '测试清单',
  summary: '一份测试用的清单。',
  kind: 'night',
  groups: [
    { title: '器材', items: [{ id: 'tripod', label: '三脚架' }, { id: 'remote', label: '快门线', note: '或手机遥控' }] },
    { title: '设置', items: [{ id: 'raw', label: 'RAW' }] },
  ],
  date: '2026-10-15',
  status: 'published',
  ...over,
});

describe('checklist-core 校验', () => {
  it('合法清单通过', () => {
    const r = validateItem(ck());
    expect(r.issues).toEqual([]);
    expect(allIds(r.item!)).toEqual(['tripod', 'remote', 'raw']);
  });
  it('条目编号在整份清单里唯一；编号格式；内容必填', () => {
    const dup = ck({ groups: [{ title: 'a', items: [{ id: 'x', label: '1' }] }, { title: 'b', items: [{ id: 'x', label: '2' }] }] });
    expect(validateItem(dup).issues).toEqual([{ path: 'groups.1.items.0.id', message: '条目编号「x」重复' }]);
    expect(validateItem(ck({ groups: [{ title: 'a', items: [{ id: 'Bad Id', label: '1' }, { id: 'y', label: '' }] }] })).issues.map((i) => i.path)).toEqual(['groups.0.items.0.id', 'groups.0.items.1.label']);
  });
  it('分组 1–8、每组 1–20 项、最多 80 项；必填字段', () => {
    expect(validateItem(ck({ groups: [] })).issues.map((i) => i.path)).toEqual(['groups']);
    expect(validateItem(ck({ groups: [{ title: 'a', items: [] }] })).issues.map((i) => i.path)).toEqual(['groups.0.items']);
    const many = Array.from({ length: 5 }, (_, gi) => ({ title: `g${gi}`, items: Array.from({ length: 17 }, (_, ii) => ({ id: `i${gi}-${ii}`, label: 'x' })) }));
    expect(5 * 17).toBeGreaterThan(MAX_ITEMS);
    expect(validateItem(ck({ groups: many })).issues.map((i) => i.path)).toEqual(['groups']);
    expect(validateItem({ slug: 'X', title: '', summary: '', kind: 'x', date: '1', status: 'x' }).issues.map((i) => i.path).sort()).toEqual(['date', 'groups', 'kind', 'slug', 'status', 'summary', 'title']);
  });
});

describe('checklist-core 进度', () => {
  it('摘要与排序（按拍摄类型顺序）', () => {
    expect(summarize(ck())).toMatchObject({ groups: 2, items: 3, kind: 'night' });
    expect(sortItems([ck({ slug: 'n', kind: 'night' }), ck({ slug: 'l', kind: 'landscape' }), ck({ slug: 's', kind: 'street' })]).map((x) => x.slug)).toEqual(['l', 's', 'n']);
    expect(Object.keys(KIND_LABEL)).toHaveLength(6);
  });
  it('读回本地记录：坏数据 → 空、丢掉未知编号、去重', () => {
    const ids = allIds(ck());
    expect(storageKey('test-list')).toBe('blog:checklist:test-list');
    expect(parseStored(null, ids)).toEqual([]);
    expect(parseStored('{oops', ids)).toEqual([]);
    expect(parseStored('{"a":1}', ids)).toEqual([]);
    expect(parseStored('["raw","ghost","raw",3]', ids)).toEqual(['raw']);
  });
  it('进度与文字', () => {
    expect(progress(['raw', 'tripod'], ck())).toEqual({ done: 2, total: 3, pct: 67 });
    expect(progressText({ done: 2, total: 3 })).toBe('已准备 2 / 3 项，还差 1 项');
    expect(progressText({ done: 3, total: 3 })).toBe('全部 3 项都准备好了');
    expect(progressText({ done: 0, total: 0 })).toBe('清单是空的');
  });
});

describe('路由与页面', () => {
  const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
  it('路由往返；工具 › 拍摄清单', () => {
    expect(parseRoute('/checklists/')).toEqual({ name: 'checklists' });
    expect(parseRoute('/checklists/night-city/')).toEqual({ name: 'checklist', slug: 'night-city' });
    expect(parseRoute('/checklists/Bad Slug/').name).toBe('notfound');
    expect(routePath({ name: 'checklist', slug: 'x1' } as never)).toBe('/checklists/x1/');
    expect(sectionOf('checklists' as never)?.id).toBe('tools');
    expect(sectionOf('checklist' as never)?.id).toBe('tools');
    expect(findEntry('tools', 'checklists' as never)?.href).toBe('/checklists/');
  });
  it('清单页：fieldset + legend、带 label 的复选框、备注用 aria-describedby；进度条默认隐藏；转义', () => {
    const p = renderRoute({ name: 'checklist', slug: 'test-list' } as never, site, { checklist: ck({ summary: '<b>x</b>' }) } as never);
    expect(p.title).toMatch(/测试清单/);
    expect((p.main.match(/<fieldset/g) ?? []).length).toBe(2);
    expect(p.main).toContain('<legend class="ck-group__h">器材');
    expect(p.main).toContain('<input type="checkbox" id="ck-test-list-tripod" data-ck-id="tripod">');
    expect(p.main).toContain('<label for="ck-test-list-tripod">三脚架</label>');
    expect(p.main).toContain('aria-describedby="ck-n-remote"');
    expect(p.main).toMatch(/<div class="ck-bar" data-ck-bar hidden>/);
    expect(p.main).toContain('已准备 0 / 3 项');
    expect(p.main).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(p.main).not.toMatch(/onsubmit|onclick/);
  });
  it('列表页与 404', () => {
    const l = renderRoute({ name: 'checklists' } as never, site, { checklists: [summarize(ck())] } as never);
    expect(l.main).toContain('/checklists/test-list/');
    expect(l.main).toContain('2 组 · 3 项');
    expect(l.main).toContain('夜景');
    expect(renderRoute({ name: 'checklists' } as never, site, { checklists: [] } as never).main).toMatch(/还没有清单/);
    expect(renderRoute({ name: 'checklist', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/checklists', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 9, 17, 12)) });
  it('示例清单：3 份已发布、都合法、按拍摄类型排序、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/checklists')).body as { checklists: { slug: string; title: string; items: number }[] };
    expect(l.checklists.map((x) => x.slug)).toEqual(['sunrise-landscape', 'street-walk', 'night-city']);
    expect(l.checklists.every((x) => x.title.includes('示例'))).toBe(true);
    for (const s of l.checklists) {
      const d = (await b.handle('GET', `/api/checklists/${s.slug}`)).body as { checklist: Item };
      expect(validateItem(d.checklist).issues).toEqual([]);
      expect(allIds(d.checklist).length).toBe(s.items);
    }
    expect((await b.handle('GET', '/api/checklists/draft-portrait')).status).toBe(404);
  });
  it('站长 PUT（草稿 → 发布）→ DELETE；非站长 401；编号重复 400；地址不一致 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/checklists/test-list', ck())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/checklists/test-list', ck({ status: 'draft' }), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/checklists/test-list')).status).toBe(404);
    expect((await b.handle('PUT', '/api/admin/checklists/test-list', ck(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/checklists/test-list')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/checklists/test-list', ck({ groups: [{ title: 'a', items: [{ id: 'x', label: '1' }, { id: 'x', label: '2' }] }] }), adm)).status).toBe(400);
    expect((await b.handle('PUT', '/api/admin/checklists/other', ck(), adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/checklists/test-list', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/checklists/test-list')).status).toBe(404);
  });
});
