/**
 * L62 / v1.62.0 树洞：
 * - treehole-core（web = worker 同一份）：字段表校验（虚构声明、必填、地址、日期）与本栏目规则、摘要、排序、辅助函数；
 * - 演示 mock 与 Worker 同形状：GET /api/treehole、/api/treehole/:slug、站长 PUT / DELETE /api/admin/treehole/:slug；
 * - 新路由 /treehole/（社区 › 树洞）与 /treehole/:slug/：列表卡片、详情正文、转义、404。
 */
import { describe, expect, it } from 'vitest';
import * as C from '../src/treehole-core';
import { sortItems, summarize, validateItem, type Item } from '../src/treehole-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';
void C;

const base = (over: Partial<Item> = {}): Item => ({ ...structuredClone({
  "slug": "note-quiet-evening",
  "title": "一个安静的晚上",
  "summary": "加完班一个人走回家，路上的风很舒服。",
  "fictional": true,
  "date": "2026-11-06",
  "status": "published",
  "mood": "calm",
  "body": [
    "今天加班到九点，一个人走回家。路上风很轻，路灯一盏一盏亮着，忽然觉得这样也挺好。",
    "希望明天也能早点下班。"
  ],
  "hugs": 31,
  "replies": [
    {
      "id": "r1",
      "text": "辛苦啦，明天会更好。"
    },
    {
      "id": "r2",
      "text": "我也喜欢夜里一个人走路。"
    }
  ]
}), slug: 'test-x', status: 'published', ...over }) as unknown as Item;
const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
const paths = (x: unknown) => validateItem(x).issues.map((i) => i.path);

describe('treehole-core', () => {
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
  it('本栏目规则：隐私审核（手机号、邮箱、网址、@）、没有作者字段、回应编号唯一', () => {
    expect(paths({ ...base(), ...{
  "body": [
    "加我微信 13812345678 聊聊"
  ]
} })).toContain("body.0");
  });
  it('摘要与排序', () => {
    expect(summarize(base())).toMatchObject({ slug: 'test-x', title: base().title });
    expect(sortItems([base({ slug: 'a', date: '2026-01-01' }), base({ slug: 'b', date: '2026-02-01' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
  it('隐私审核、没有作者字段、回应编号唯一、写纸条检查', () => {
    expect(C.moderate('打我电话 138-1234-5678')).toEqual(['不要留手机号或长串数字']);
    expect(C.moderate('邮箱 someone@example.com')).toEqual(['不要留邮箱']);
    expect(C.moderate('看这个 https://example.com 或 www.example.org')).toEqual(['不要放网址']);
    expect(C.moderate('谢谢 @小明同学')).toEqual(['不要 @ 任何人']);
    expect(C.moderate('今天走了 8000 步，很开心。')).toEqual([]);
    expect(C.moderate('2026 年 11 月')).toEqual([]);
    expect(paths(base({ replies: [{ id: 'x', text: '加我 someone@example.com' }] }))).toEqual(['replies.0.text']);
    expect(paths({ ...base(), author: '某人' })).toEqual(['author']);
    expect(paths(base({ replies: [{ id: 'x', text: 'a' }, { id: 'x', text: 'b' }] }))).toEqual(['replies.1.id']);
    expect(C.checkNote('  ')).toEqual(['先写点什么']);
    expect(C.checkNote('字'.repeat(301))).toEqual(['最多 300 字（现在 301 字）']);
    expect(C.checkNote('加我 13812345678，或者 @阿明')).toEqual(['不要留手机号或长串数字', '不要 @ 任何人']);
    expect(C.checkNote('今天很平静。')).toEqual([]);
    expect(summarize(base())).toMatchObject({ mood: 'calm', hugs: 31, replies: 2 });
    expect(JSON.stringify(summarize(base()))).not.toMatch(/author/);
  });
});

describe('路由与页面', () => {
  it('路由往返；社区 › 树洞', () => {
    expect(parseRoute('/treehole/')).toEqual({ name: 'treehole' });
    expect(parseRoute('/treehole/note-quiet-evening/')).toEqual({ name: 'treenote', slug: 'note-quiet-evening' });
    expect(routePath({ name: 'treenote', slug: 'x' } as never)).toBe('/treehole/x/');
    expect(sectionOf('treehole' as never)?.id).toBe('community');
    expect(findEntry('community', 'treehole' as never)?.href).toBe('/treehole/');
  });
  it('详情页：虚构声明、简介转义、正文', () => {
    const p = renderRoute({ name: 'treenote', slug: 'test-x' } as never, site, { treenote: base({ summary: '<b>简介</b>' }) } as never);
    expect(p.main).toContain('ck-note');
    expect(p.main).toContain('&lt;b&gt;简介&lt;/b&gt;');
    expect(p.main).not.toContain('<b>简介</b>');
    expect(p.main).toContain('<div class="tn-paper">');
    expect(p.main).toContain('data-tn-tools hidden');
    expect((p.main.match(/<li id="r-/g) ?? []).length).toBe(2);
  });
  it('列表页卡片；空列表与 404', () => {
    const l = renderRoute({ name: 'treehole' } as never, site, { treehole: [summarize(base())] } as never);
    expect(l.main).toContain('/treehole/test-x/');
    expect((l.main.match(/class="ck-card"/g) ?? []).length).toBe(1);
    expect(l.main).toContain('<span class="tn-mood">平静</span> · 31 个抱抱 · 2 条回应');
    expect(l.main).toContain('data-tn-write hidden');
    expect(renderRoute({ name: 'treehole' } as never, site, { treehole: [] } as never).main).toContain('树洞里还没有公开的纸条。');
    expect(renderRoute({ name: 'treenote', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/treehole', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 10, 8, 12)) });
  it('示例：已发布按日期倒序、全部合法且虚构、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/treehole')).body as { notes: { slug: string }[] };
    expect(l.notes.map((x) => x.slug)).toEqual([
  "note-quiet-evening",
  "note-exam-week",
  "note-thank-you"
]);
    for (const s of l.notes) {
      const it = ((await b.handle('GET', `/api/treehole/${s.slug}`)).body as { note: Item }).note;
      expect(validateItem(it).issues).toEqual([]);
      expect(it.fictional).toBe(true);
    }
    expect((await b.handle('GET', '/api/treehole/note-pending')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；校验失败 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/treehole/test-x', base())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/treehole/test-x', base(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/treehole/test-x')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/treehole/test-x', { ...base(), ...{
  "body": [
    "加我微信 13812345678 聊聊"
  ]
} }, adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/treehole/test-x', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/treehole/test-x')).status).toBe(404);
  });
});
