import { beforeEach, describe, expect, it } from 'vitest';
import { activityHeatmap, jsonFeed, rssXml, searchDocs, SECTION_KEYS, SECTION_SPECS, snippet, toList, validateSection, type SectionMap } from '../src/sections';
import { changelogPage, gearPage, heatmap, homeSections, link, nowPage, opensourcePage, searchPage, shelfPage, statsPage, subscribePage, timelinePage, worksPage } from '../src/sections-view';
import { navbar, needs, parseRoute, renderRoute, routePath, SECTION_ROUTES, setBasePath } from '../src/render';
import { DB_KEY, DemoBackend, memoryKV, type KV } from '../src/demo/mock-api';
import { createSeed, DEMO_PASSWORD } from '../src/demo/seed';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type PostSummary, type SiteData } from '../src/types';

const seed = createSeed('/');
const sections: SectionMap = { now: seed.now, works: seed.works, gear: seed.gear, shelf: seed.shelf, timeline: seed.timeline, changelog: seed.changelog, repos: seed.repos };
const summary = (p: (typeof seed.posts)[number], i: number): PostSummary => {
  const { contentMd: _c, ...rest } = p;
  return { ...rest, id: i + 1 };
};
const posts = seed.posts.filter((p) => p.status === 'published').map(summary);
const site: SiteData = {
  settings: DEFAULT_SETTINGS,
  profile: DEFAULT_PROFILE,
  posts,
  total: posts.length,
  tags: [{ tag: '摄影', count: 4 }, { tag: '动效', count: 2 }],
  categories: [{ category: '摄影', count: 4 }, { category: '前端', count: 3 }],
};
const today = new Date('2026-10-10T12:00:00Z');

describe('扩展栏目：数据校验', () => {
  it('种子数据全部通过校验，规格覆盖每个栏目', () => {
    for (const k of SECTION_KEYS) {
      const r = validateSection(k, sections[k]);
      expect(r.issues, k).toEqual([]);
      expect(r.items.length, k).toBeGreaterThan(0);
      expect(SECTION_SPECS[k].fields.length).toBeGreaterThan(2);
    }
  });
  it('补齐默认值、规范化列表', () => {
    const r = validateSection('now', [{ title: ' 打 CS ', progress: '40' }]);
    expect(r.issues).toEqual([]);
    expect(r.items[0]).toEqual({ kind: 'doing', title: '打 CS', since: '', progress: 40, url: '', detail: '' });
    expect(toList('a, b，c、d')).toEqual(['a', 'b', 'c', 'd']);
    expect(toList('第一条\n第二条, 带逗号', true)).toEqual(['第一条', '第二条, 带逗号']);
    const c = validateSection('changelog', [{ version: 'v1', date: '2026-10-10', title: 't', items: '一\n二' }]);
    expect(c.items[0]!.items).toEqual(['一', '二']);
  });
  it('拒绝危险链接、越界数字、未知枚举、重复 id、超长列表、非法 GitHub 名', () => {
    const bad = (k: Parameters<typeof validateSection>[0], items: unknown[]) => validateSection(k, items).issues.map((i) => i.path);
    expect(bad('now', [{ title: 'x', url: 'javascript:alert(1)' }])).toContain('items.0.url');
    expect(bad('now', [{ title: 'x', progress: 120 }])).toContain('items.0.progress');
    expect(bad('now', [{ title: 'x', kind: 'sleeping' }])).toContain('items.0.kind');
    expect(bad('now', [{ title: '' }])).toContain('items.0.title');
    expect(bad('works', [{ id: 'a', title: 'x', url: '/a.jpg' }, { id: 'a', title: 'y', url: '/b.jpg' }])).toContain('items');
    expect(bad('works', [{ id: 'Bad Id', title: 'x', url: '/a.jpg' }])).toContain('items.0.id');
    expect(bad('works', [{ id: 'a', title: 'x', url: 'data:image/svg+xml;base64,PHN2Zz4=' }])).toContain('items.0.url');
    expect(bad('gear', [{ name: 'x', rating: 0 }])).toContain('items.0.rating');
    expect(bad('repos', [{ title: 'x', owner: '../../etc' }])).toContain('items.0.repo');
    expect(bad('changelog', [{ version: 'v', date: 'd', title: 't', items: Array(21).fill('x') }])).toContain('items.0.items');
    expect(validateSection('now', 'nope').issues[0]!.path).toBe('items');
    expect(validateSection('repos', Array(41).fill({ title: 'x' })).issues.map((i) => i.path)).toContain('items');
  });
});

describe('扩展栏目：纯函数', () => {
  it('热力图：53 周 × 7 天，按分数分级，统计连续天数', () => {
    const h = activityHeatmap([{ date: '2026-10-10', weight: 3 }, { date: '2026-10-09', weight: 1 }, { date: '2026-10-09', weight: 1 }, { date: '2020-01-01', weight: 9 }, { date: 'bad', weight: 1 }], today);
    expect(h.cells.length).toBeGreaterThanOrEqual(52 * 7 + 1);
    expect(h.cells.length).toBeLessThanOrEqual(53 * 7);
    expect(h.cells[0]!.date).toBe('2025-10-05'); // 52 周前那一周的周日
    expect(h.cells.at(-1)).toEqual({ date: '2026-10-10', score: 3, level: 3 });
    expect(h.cells.at(-2)).toMatchObject({ score: 2, level: 2 });
    expect(h.activeDays).toBe(2);
    expect(h.streak).toBe(2);
    expect(h.total).toBe(5);
  });
  it('RSS / JSON Feed：转义、绝对链接、最多 30 篇', () => {
    const feedPosts = [{ slug: 'a', title: '<b>&"\'', summary: 'x\u0001y', tags: ['t'], category: '摄影', publishedAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z' }];
    const xml = rssXml({ title: 'T & T', description: 'd', siteUrl: 'https://e.example/TheBLOG', posts: feedPosts, now: today });
    expect(xml).toContain('<title>&lt;b&gt;&amp;&quot;&apos;</title>');
    expect(xml).toContain('<link>https://e.example/TheBLOG/posts/a/</link>');
    expect(xml).toContain('<category>摄影</category>');
    expect(xml).not.toContain('\u0001');
    expect(xml).toContain('<pubDate>Thu, 08 Oct 2026 00:00:00 GMT</pubDate>');
    const many = Array.from({ length: 40 }, (_, i) => ({ ...feedPosts[0]!, slug: `p${i}` }));
    expect(rssXml({ title: 't', description: 'd', siteUrl: 'https://e.example/', posts: many }).match(/<item>/g)).toHaveLength(many.length);
    expect(rssXml({ title: 't', description: 'd', siteUrl: 'https://e.example/', posts: many, limit: 30 }).match(/<item>/g)).toHaveLength(30);
    const jf = JSON.parse(jsonFeed({ title: 't', description: 'd', siteUrl: 'https://e.example/', posts: feedPosts }));
    expect(jf.version).toBe('https://jsonfeed.org/version/1.1');
    expect(jf.items[0]).toMatchObject({ url: 'https://e.example/posts/a/', tags: ['摄影', 't'] });
  });
  it('站内搜索：标题优先、多词需全部命中、摘出片段', () => {
    const docs = [
      { title: '夜景笔记', summary: '', tags: [], category: null, text: '' },
      { title: '随笔', summary: '关于夜景', tags: ['夜景'], category: null, text: '' },
      { title: '动效', summary: '', tags: [], category: null, text: '夜景 动效' },
    ];
    expect(searchDocs(docs, '夜景').map((h) => h.doc.title)).toEqual(['夜景笔记', '随笔', '动效']);
    expect(searchDocs(docs, '夜景 动效').map((h) => h.doc.title)).toEqual(['动效']);
    expect(searchDocs(docs, '   ')).toEqual([]);
    expect(snippet('a'.repeat(100) + '目标' + 'b'.repeat(100), '目标', 40)).toMatch(/^…a+目标b+…$/);
  });
});

describe('扩展栏目：路由与视图', () => {
  beforeEach(() => setBasePath('/'));
  it.each(SECTION_ROUTES.map((r) => [`/${r}/`, r]))('%s → %s（往返）', (path, name) => {
    expect(parseRoute(path).name).toBe(name);
    expect(routePath(parseRoute(path))).toBe(path);
  });
  it('每个路由只请求自己需要的数据', () => {
    expect(needs({ name: 'works' })).toEqual(['works']);
    expect(needs({ name: 'opensource' })).toEqual(['repos', 'changelog']);
    expect(needs({ name: 'search' })).toEqual([]);
    expect(needs({ name: 'home', page: 1 })).toEqual(expect.arrayContaining(['now', 'works', 'repos', 'changelog', 'shelf']));
  });
  it('导航菜单包含新栏目', () => {
    const nav = navbar(site, { name: 'now' });
    for (const p of ['/now/', '/works/', '/gear/', '/shelf/', '/timeline/', '/changelog/', '/opensource/', '/stats/', '/search/', '/subscribe/']) expect(nav).toContain(`href="${p}"`);
  });
  it('首页「此刻与作品」：此刻、作品、热力图、开源、更新、书影音、栏目入口；空数据时只剩入口', () => {
    const h = homeSections(site, sections);
    for (const c of ['now-tile', 'works-tile', 'heat-tile', 'repos-tile', 'cl-tile', 'shelf-tile', 'explore-tile']) expect(h).toContain(c);
    expect(h).toContain('data-repo="HarrisonCN/Motionary"');
    const bare = homeSections(site, {});
    expect(bare).not.toContain('now-tile');
    expect(bare).toContain('explore-tile');
  });
  it('作品集：筛选、EXIF chips、灯箱、JSON 数据不会截断 </script>', () => {
    const w = [{ ...sections.works[0]!, title: '</script><script>alert(1)</script>' }, ...sections.works.slice(1)];
    const p = worksPage(site, w);
    expect(p.main).toContain('js-works-filter');
    expect(p.main).toContain('<dialog class="lightbox js-lightbox"');
    expect(p.main).toMatch(/<span class="exif"><span class="chip">16mm<\/span><span class="chip">f\/8<\/span>/);
    expect(p.main).toContain('示意参数');
    expect(p.main).not.toContain('</script><script>alert(1)');
    expect(p.main.match(/<\/script>/g)).toHaveLength(1);
  });
  it('此刻 / 器材 / 书影音 / 时间线 / 更新日志 / 开源 / 数据 / 搜索 / 订阅都能渲染并转义', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const pages = [
      nowPage(site, [{ ...sections.now[0]!, title: evil, url: 'javascript:alert(1)' }]),
      gearPage(site, [{ ...sections.gear[0]!, name: evil }]),
      shelfPage(site, [{ ...sections.shelf[0]!, title: evil }]),
      timelinePage(site, [{ ...sections.timeline[0]!, title: evil }]),
      changelogPage(site, [{ ...sections.changelog[0]!, items: [evil] }]),
      opensourcePage(site, [{ ...sections.repos[0]!, description: evil }]),
    ];
    for (const p of pages) {
      expect(p.main).not.toContain('<img src=x');
      expect(p.main).not.toContain('javascript:');
      expect(p.main).toContain('&lt;img');
    }
    expect(nowPage(site, sections.now).main).toContain('role="progressbar"');
    expect(gearPage(site, sections.gear).main).toContain('id="gear-镜头"');
    expect(shelfPage(site, sections.shelf).main).toContain('data-kind="game"');
    expect(timelinePage(site, sections.timeline).main.indexOf('2026')).toBeLessThan(timelinePage(site, sections.timeline).main.indexOf('2023'));
    expect(changelogPage(site, sections.changelog).main).toContain('cl--latest');
    const os = opensourcePage(site, sections.repos);
    expect(os.main).toContain('js-stars-total');
    expect(os.main).toContain('源码暂未公开');
    expect(statsPage(site, sections.changelog, today).main).toContain('class="bars"');
    expect(searchPage(site).main).toContain('js-search-page');
    expect(subscribePage(site).main).toContain('/rss.xml');
  });
  it('空栏目显示占位文字', () => {
    for (const p of [nowPage(site, []), worksPage(site, []), gearPage(site, []), shelfPage(site, []), timelinePage(site, []), changelogPage(site, []), opensourcePage(site, [])]) expect(p.main).toContain('class="empty"');
  });
  it('站内链接加部署前缀，外链只允许 http(s)', () => {
    setBasePath('/TheBLOG/');
    expect(link('/changelog/')).toBe('/TheBLOG/changelog/');
    expect(link('https://github.com/x')).toBe('https://github.com/x');
    expect(link('//evil.example')).toBeNull();
    expect(link('javascript:1')).toBeNull();
    expect(renderRoute({ name: 'timeline' }, site, { timeline: sections.timeline }).main).toContain('href="/TheBLOG/changelog/"');
    setBasePath('/');
  });
  it('热力图 HTML：每格一个 <i>，有图例和无障碍说明', () => {
    const h = heatmap(site, sections.changelog, 10, today);
    expect(h.match(/<i class="l\d" title=/g)!.length).toBeGreaterThanOrEqual(9 * 7);
    expect(h).toContain('role="img"');
  });
});

describe('扩展栏目：演示 mock API', () => {
  let kv: KV;
  let api: DemoBackend;
  beforeEach(() => {
    kv = memoryKV();
    api = new DemoBackend({ storage: kv, base: '/TheBLOG/' });
  });
  it('公开读取种子数据；后台写入校验；改动保存在本地', async () => {
    for (const k of SECTION_KEYS) {
      const r = await api.handle('GET', `/api/content/${k}`);
      expect(r.status, k).toBe(200);
      expect((r.body as { items: unknown[] }).items.length, k).toBeGreaterThan(0);
    }
    expect((await api.handle('PUT', '/api/admin/content/now', { items: [] })).status).toBe(401);
    const login = await api.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD });
    const csrf = (login.body as { csrfToken: string }).csrfToken;
    const put = (k: string, items: unknown) => api.handle('PUT', `/api/admin/content/${k}`, { items }, { 'x-csrf-token': csrf });
    const ok = await put('now', [{ kind: 'playing', title: 'CS2' }]);
    expect(ok.status).toBe(200);
    expect(JSON.parse(kv.getItem(DB_KEY)!).now).toEqual([{ kind: 'playing', title: 'CS2', since: '', progress: 0, url: '', detail: '' }]);
    const bad = await put('works', [{ id: 'x', title: 'x', url: 'javascript:1' }]);
    expect(bad.status).toBe(400);
    expect((bad.body as { error: { details: { path: string }[] } }).error.details[0]!.path).toBe('items.0.url');
  });
  it('旧版本地数据（没有新栏目）自动用种子补齐', async () => {
    const old = createSeed('/TheBLOG/') as unknown as Record<string, unknown>;
    for (const k of SECTION_KEYS) delete old[k];
    (old.friends as unknown[]).length = 0;
    kv.setItem(DB_KEY, JSON.stringify(old));
    const fresh = new DemoBackend({ storage: kv, base: '/TheBLOG/' });
    expect(((await fresh.handle('GET', '/api/content/repos')).body as { items: unknown[] }).items.length).toBeGreaterThan(0);
    expect(((await fresh.handle('GET', '/api/content/friends')).body as { items: unknown[] }).items).toEqual([]); // 其余本地改动保留
  });
});
