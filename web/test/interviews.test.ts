/**
 * L44 / v1.44.0 摄影人访谈：
 * - interview-core（web = worker 同一份）：校验（受访者必须标明虚构、2–30 组问答、编号唯一、回答段落、引语逐字出自回答、封面替代文字）、
 *   目录锚点、引语归位、阅读时长、摘要与排序；
 * - 演示 mock 与 Worker 同形状：GET /api/interviews、/api/interviews/:slug、站长 PUT / DELETE /api/admin/interviews/:slug；
 * - 新路由 /interviews/（专题 › 摄影人访谈）与 /interviews/:slug/：虚构声明、目录、问答 h2、引语卡；没有 JS 也完整。
 */
import { describe, expect, it } from 'vitest';
import { placeQuotes, readingMinutes, sortItems, summarize, toc, validateItem, type Item } from '../src/interview-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';

const iv = (over: Partial<Item> = {}): Item => ({
  slug: 'test-iv',
  title: '测试访谈',
  summary: '一篇测试访谈。',
  person: { name: '测试者（虚构）', role: '测试', bio: '虚构人物。', fictional: true },
  cover: { src: '/demo/photos/x.webp', alt: '示例图', w: 10, h: 10 },
  qa: [
    { id: 'one', q: '第一个问题？', a: ['第一段回答。', '光比快门更重要。'] },
    { id: 'two', q: '第二个问题？', a: ['只有一段。'] },
  ],
  quotes: ['光比快门更重要。'],
  date: '2026-10-15',
  status: 'published',
  ...over,
});

describe('interview-core 校验', () => {
  it('合法访谈通过；引语可省略', () => {
    expect(validateItem(iv()).issues).toEqual([]);
    const { quotes, ...rest } = iv();
    void quotes;
    expect(validateItem(rest).item!.quotes).toEqual([]);
  });
  it('受访者必须标明虚构', () => {
    expect(validateItem(iv({ person: { ...iv().person, fictional: false as never } })).issues.map((i) => i.path)).toEqual(['person.fictional']);
    const p = { ...iv().person } as Record<string, unknown>;
    delete p.fictional;
    expect(validateItem({ ...iv(), person: p }).issues.map((i) => i.path)).toEqual(['person.fictional']);
  });
  it('问答数量、编号唯一、空回答、引语出处、封面替代文字', () => {
    expect(validateItem(iv({ qa: [iv().qa[0]!] , quotes: [] })).issues.map((i) => i.path)).toEqual(['qa']);
    expect(validateItem(iv({ qa: [iv().qa[0]!, { ...iv().qa[1]!, id: 'one' }] })).issues[0]!.message).toBe('问题编号「one」重复');
    expect(validateItem(iv({ qa: [iv().qa[0]!, { id: 'x', q: '问？', a: [] }] })).issues.map((i) => i.path)).toEqual(['qa.1.a']);
    expect(validateItem(iv({ quotes: ['回答里没有这句话'] })).issues.map((i) => i.path)).toEqual(['quotes.0']);
    expect(validateItem(iv({ cover: { src: '/a.webp', alt: '', w: 1, h: 1 } })).issues.map((i) => i.path)).toEqual(['cover.alt']);
    expect(validateItem(iv({ cover: { src: 'javascript:alert(1)', alt: 'x', w: 1, h: 1 } })).issues.map((i) => i.path)).toEqual(['cover.src']);
  });
});

describe('interview-core 计算', () => {
  it('目录锚点与引语归位（放在第一个包含它的回答之后）', () => {
    expect(toc(iv().qa)).toEqual([{ href: '#q-one', text: '第一个问题？' }, { href: '#q-two', text: '第二个问题？' }]);
    expect(placeQuotes(iv().qa, ['光比快门更重要。', '只有一段。', '不存在'])).toEqual({ one: ['光比快门更重要。'], two: ['只有一段。'] });
  });
  it('阅读时长：每分钟约 400 字，至少 1 分钟', () => {
    expect(readingMinutes(iv())).toBe(1);
    expect(readingMinutes({ qa: [{ id: 'a', q: '问', a: ['字'.repeat(1199)] }] })).toBe(3);
  });
  it('摘要与排序', () => {
    expect(summarize(iv())).toMatchObject({ name: '测试者（虚构）', questions: 2, minutes: 1, cover: { alt: '示例图' } });
    expect(sortItems([iv({ slug: 'a', date: '2026-01-01' }), iv({ slug: 'b', date: '2026-02-01' })]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
});

describe('路由与页面', () => {
  const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
  it('路由往返；专题 › 摄影人访谈', () => {
    expect(parseRoute('/interviews/')).toEqual({ name: 'interviews' });
    expect(parseRoute('/interviews/night-ferry/')).toEqual({ name: 'interview', slug: 'night-ferry' });
    expect(routePath({ name: 'interview', slug: 'x' } as never)).toBe('/interviews/x/');
    expect(sectionOf('interviews' as never)?.id).toBe('curation');
    expect(findEntry('curation', 'interviews' as never)?.href).toBe('/interviews/');
  });
  it('访谈页：虚构声明、目录锚点、问题 h2、引语卡、转义', () => {
    const p = renderRoute({ name: 'interview', slug: 'test-iv' } as never, site, { interview: iv({ summary: '<b>x</b>', qa: [iv().qa[0]!, { id: 'two', q: '<i>问</i>', a: ['答'] }] }) } as never);
    expect(p.main).toContain('虚构访谈');
    expect(p.main).toContain('<nav class="iv-toc" aria-label="访谈目录">');
    expect(p.main).toContain('href="#q-one"');
    expect(p.main).toContain('id="q-one"');
    expect((p.main.match(/<h2 class="iv-q"/g) ?? []).length).toBe(2);
    expect(p.main).toContain('<blockquote class="iv-quote"><p>光比快门更重要。</p><footer class="small">— 测试者（虚构）</footer></blockquote>');
    expect(p.main.indexOf('iv-quote')).toBeLessThan(p.main.indexOf('id="q-two"'));
    expect(p.main).toContain('&lt;i&gt;问&lt;/i&gt;');
    expect(p.main).toContain('alt="示例图"');
  });
  it('列表页与 404', () => {
    const l = renderRoute({ name: 'interviews' } as never, site, { interviews: [summarize(iv())] } as never);
    expect(l.main).toContain('/interviews/test-iv/');
    expect(l.main).toContain('测试者（虚构） · 测试 · 2 问 · 约 1 分钟');
    expect(renderRoute({ name: 'interviews' } as never, site, { interviews: [] } as never).main).toMatch(/还没有访谈/);
    expect(renderRoute({ name: 'interview', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/interviews', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 9, 17, 12)) });
  it('示例：2 篇已发布、都合法且都标明虚构、日期倒序、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/interviews')).body as { interviews: { slug: string; questions: number }[] };
    expect(l.interviews.map((x) => x.slug)).toEqual(['night-ferry', 'field-flowers']);
    expect(l.interviews.map((x) => x.questions)).toEqual([4, 3]);
    for (const s of l.interviews) {
      const it = ((await b.handle('GET', `/api/interviews/${s.slug}`)).body as { interview: Item }).interview;
      expect(validateItem(it).issues).toEqual([]);
      expect(it.person.fictional).toBe(true);
    }
    expect((await b.handle('GET', '/api/interviews/draft-interview')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；未标虚构 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/interviews/test-iv', iv())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/interviews/test-iv', iv(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/interviews/test-iv')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/interviews/test-iv', iv({ person: { ...iv().person, fictional: false as never } }), adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/interviews/test-iv', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/interviews/test-iv')).status).toBe(404);
  });
});
