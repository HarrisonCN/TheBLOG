// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { highlight, langLabel, langOf } from '../src/highlight';
import { renderMarkdown } from '../src/markdown';
import { fuzzy, group, markHits, pushRecent, rank, type PaletteItem } from '../src/palette-core';
import { continueList, parseHistory, progressOf, resumeFor, upsert, type ReadEntry } from '../src/reading';
import { applyLocal, isReaction, readMine, REACTIONS, toggleMine } from '../src/reactions-core';
import { posterFileName, qrMatrix, wrapText } from '../src/share';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { ghRecentlyFailed, GH_FAIL_BACKOFF } from '../src/sections-client';
import { continueCard, homePage, postPage, reactionsBar, setBasePath } from '../src/render';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type Post, type SiteData } from '../src/types';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

describe('语法高亮', () => {
  it('识别语言别名并输出 token span', () => {
    expect(langOf('ts')).toBe('js');
    expect(langOf('Shell')).toBe('bash');
    expect(langOf('brainfuck')).toBeNull();
    expect(langLabel('ts')).toBe('TS');
    expect(langLabel('python')).toBe('Python');
    const h = highlight('const a = "x"; // hi\nreturn 42;', 'js');
    expect(h).toContain('<span class="tk-kw">const</span>');
    expect(h).toContain('<span class="tk-str">&quot;x&quot;</span>');
    expect(h).toContain('<span class="tk-com">// hi</span>');
    expect(h).toContain('<span class="tk-num">42</span>');
  });
  it('关键词只在单词边界匹配（format 里不会高亮 for）', () => {
    expect(highlight('format(x)', 'js')).not.toContain('tk-kw');
  });
  it('输入整体转义：代码里的 HTML 不会变成标签', () => {
    for (const lang of ['js', 'html', 'css', 'bash', 'unknown', undefined]) {
      const out = highlight('<img src=x onerror=alert(1)><script>alert(2)</script>', lang);
      expect(out).not.toMatch(/<(img|script)/i);
      expect(out.replace(/<\/?span[^>]*>/g, '')).not.toMatch(/[<>]/);
    }
  });
  it('Markdown 代码块：语言标签、可聚焦、info 字符串不能注入属性', () => {
    const html = renderMarkdown('```ts\nconst x = 1;\n```\n\n```"><img src=x onerror=alert(1)>\nhi\n```');
    expect(html).toContain('<pre class="code" tabindex="0" data-lang="TS">');
    expect(html).toContain('tk-kw');
    expect(html).not.toMatch(/<img/i);
  });
});

describe('⌘K 模糊匹配', () => {
  const items: PaletteItem[] = [
    { id: 'p1', kind: 'post', title: '用手机拍夜景的五个小习惯', keywords: '摄影 手机摄影', href: '/posts/a/' },
    { id: 'p2', kind: 'post', title: '桂林夜游：日月双塔的倒影', keywords: '夜景 旅行', href: '/posts/b/' },
    { id: 'g1', kind: 'page', title: '作品集', sub: '摄影 › 作品集', href: '/works/' },
    { id: 'a1', kind: 'action', title: '切换到深色模式', keywords: 'dark theme 主题', action: 'theme' },
    { id: 't1', kind: 'tag', title: '#夜景', keywords: '夜景', href: '/tags/x/' },
  ];
  it('包含 > 子序列，标题优先于关键词', () => {
    expect(fuzzy('夜景', '用手机拍夜景')!.score).toBeGreaterThan(fuzzy('夜景', '夜游景点')?.score ?? 0);
    expect(fuzzy('zzz', 'abc')).toBeNull();
    const r = rank(items, '夜景');
    expect(r[0]!.item.id).toBe('p1');
    expect(r.map((m) => m.item.id)).toContain('p2'); // 关键词命中
    expect(r.map((m) => m.item.id)).toContain('t1');
  });
  it('英文关键词能找到操作；多个词都要命中', () => {
    expect(rank(items, 'dark')[0]!.item.id).toBe('a1');
    expect(rank(items, '夜景 桂林').map((m) => m.item.id)).toEqual(['p2']);
    expect(rank(items, '')).toEqual([]);
  });
  it('分组：最好结果所在的组在前', () => {
    const g = group(rank(items, '作品'));
    expect(g[0]!.kind).toBe('page');
  });
  it('高亮转义，不注入标签', () => {
    expect(markHits('<b>夜景', [3, 4], esc)).toBe('&#60;b&#62;<mark>夜景</mark>');
  });
  it('最近：去重、最多 6 条、新的在前', () => {
    let list: PaletteItem[] = [];
    for (let i = 0; i < 8; i++) list = pushRecent(list, { id: `x${i}`, kind: 'post', title: `T${i}` });
    list = pushRecent(list, { id: 'x5', kind: 'recent', title: 'T5' });
    expect(list).toHaveLength(6);
    expect(list[0]!.id).toBe('x5');
    expect(list[0]!.kind).toBe('post');
    expect(new Set(list.map((x) => x.id)).size).toBe(6);
  });
});

describe('阅读记录', () => {
  const now = Date.UTC(2026, 9, 10);
  const e = (slug: string, pct: number, at = now): ReadEntry => ({ slug, title: slug, pct, y: 100, at });
  it('解析时丢掉坏数据、限制范围', () => {
    expect(parseHistory('not json')).toEqual([]);
    expect(parseHistory('{"a":1}')).toEqual([]);
    const list = parseHistory(JSON.stringify([{ slug: 'ok', title: 'T', pct: 3, y: -5, at: 1 }, { slug: '../x', title: 'bad', pct: 0.5 }, { slug: 'n', title: 1, pct: 0.5 }]));
    expect(list).toEqual([{ slug: 'ok', title: 'T', cover: null, pct: 1, y: 0, at: 1 }]);
  });
  it('upsert：同一篇只留一条，最多 20 条；读完后从头打开不覆盖', () => {
    let l: ReadEntry[] = [];
    for (let i = 0; i < 25; i++) l = upsert(l, e(`p${i}`, 0.5));
    expect(l).toHaveLength(20);
    l = upsert(l, e('p3', 0.97));
    l = upsert(l, e('p3', 0.01));
    expect(l[0]).toMatchObject({ slug: 'p3', pct: 0.97 });
  });
  it('继续阅读：5%–95%、30 天内、排除当前', () => {
    const l = [e('a', 0.5), e('b', 0.99), e('c', 0.02), e('d', 0.4, now - 40 * 864e5), e('f', 0.3)];
    expect(continueList(l, now).map((x) => x.slug)).toEqual(['a', 'f']);
    expect(continueList(l, now, 'a').map((x) => x.slug)).toEqual(['f']);
    expect(resumeFor(l, 'a', now)?.pct).toBe(0.5);
    expect(resumeFor(l, 'b', now)).toBeNull();
  });
  it('进度：视口底边走过正文的比例', () => {
    expect(progressOf(1000, 2000, 0, 800)).toBe(0);
    expect(progressOf(1000, 2000, 1200, 800)).toBe(0.5);
    expect(progressOf(1000, 2000, 99999, 800)).toBe(1);
    expect(progressOf(0, 0, 10, 800)).toBe(0);
  });
});

describe('表情回应', () => {
  it('固定表情集合与本地记录', () => {
    expect(REACTIONS.map((r) => r.emoji)).toEqual(['👍', '❤️', '🎉', '🤯', '🤔', '📷']);
    expect(isReaction('👍')).toBe(true);
    expect(isReaction('💩')).toBe(false);
    const store = { getItem: (k: string) => (k === 'blog-react:a' ? '["👍","<x>",1]' : null) };
    expect(readMine(store, 'a')).toEqual(['👍']);
    expect(readMine({ getItem: () => '{oops' }, 'a')).toEqual([]);
    expect(toggleMine(['👍'], '👍')).toEqual({ list: [], on: false });
    expect(toggleMine([], '🎉')).toEqual({ list: ['🎉'], on: true });
    expect(applyLocal({ '👍': 1 }, '👍', false)).toEqual({});
    expect(applyLocal({}, '🎉', true)).toEqual({ '🎉': 1 });
  });
  it('mock API：与 Worker 相同的形状；去重、撤销、校验、草稿 404', async () => {
    const api = new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/' });
    const g = await api.handle('GET', '/api/posts/welcome/reactions');
    expect(g.status).toBe(200);
    const start = ((g.body as { counts: Record<string, number> }).counts['🎉'] ?? 0);
    const on = await api.handle('POST', '/api/posts/welcome/reactions', { emoji: '🎉', on: true });
    expect((on.body as { counts: Record<string, number>; mine: boolean })).toEqual(expect.objectContaining({ mine: true }));
    expect((on.body as { counts: Record<string, number> }).counts['🎉']).toBe(start + 1);
    const again = await api.handle('POST', '/api/posts/welcome/reactions', { emoji: '🎉', on: true });
    expect((again.body as { counts: Record<string, number> }).counts['🎉']).toBe(start + 1);
    const off = await api.handle('POST', '/api/posts/welcome/reactions', { emoji: '🎉', on: false });
    expect((off.body as { counts: Record<string, number> }).counts['🎉'] ?? 0).toBe(start);
    expect((await api.handle('POST', '/api/posts/welcome/reactions', { emoji: '💩' })).status).toBe(400);
    expect((await api.handle('GET', '/api/posts/no-such/reactions')).status).toBe(404);
    expect((await api.handle('POST', '/api/posts/film-simulation-draft/reactions', { emoji: '👍' })).status).toBe(404);
  });
});

describe('分享海报', () => {
  it('二维码矩阵：版本尺寸 + 三个定位角', () => {
    const m = qrMatrix('https://harrisoncn.github.io/TheBLOG/posts/welcome/');
    expect(m.length).toBe(m[0]!.length);
    expect((m.length - 4 - 21) % 4).toBe(0); // 21 + 4k 个模块 + 2×2 静区
    expect(m[2]![2]).toBe(true); // 左上定位角
    expect(m[2]![m.length - 3]).toBe(true); // 右上
    expect(m[m.length - 3]![2]).toBe(true); // 左下
    expect(m[0]!.every((x) => x === false)).toBe(true); // 静区
  });
  it('断行：中文逐字、超出加省略号', () => {
    const measure = (s: string) => s.length * 10;
    expect(wrapText(measure, '一二三四五六七八九十', 40, 2)).toEqual(['一二三四', '五六七…']);
    expect(wrapText(measure, 'hello world', 60, 2)).toEqual(['hello', 'world']);
    expect(wrapText(measure, '短', 100, 3)).toEqual(['短']);
  });
  it('文件名去掉非法字符', () => {
    expect(posterFileName('a/b:c*?d 你好')).toBe('a-b-c-d-你好.png');
    expect(posterFileName('///')).toBe('poster.png');
  });
});

describe('GitHub 请求失败后的退避', () => {
  beforeEach(() => sessionStorage.clear());
  it('10 分钟内不重试', () => {
    expect(ghRecentlyFailed('k')).toBe(false);
    sessionStorage.setItem('k', String(Date.now()));
    expect(ghRecentlyFailed('k')).toBe(true);
    expect(ghRecentlyFailed('k', Date.now() + GH_FAIL_BACKOFF + 1)).toBe(false);
  });
});

describe('页面结构（审计修复 + 新功能挂载点）', () => {
  setBasePath('/');
  const post: Post = { id: 1, slug: 'hello', title: 'Hello', summary: 's', contentMd: '## 一\n\n```js\nlet a\n```', tags: ['x'], coverUrl: null, category: '前端', pinned: false, wordCount: 10, status: 'published', publishedAt: '2026-10-01T00:00:00Z', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' };
  const site: SiteData = { settings: DEFAULT_SETTINGS, profile: DEFAULT_PROFILE, posts: [post], total: 1, tags: [{ tag: 'x', count: 1 }], categories: [{ category: '前端', count: 1 }] };
  it('首页有 h1（视觉隐藏）和隐藏的「继续阅读」卡片', () => {
    const p = homePage(site);
    expect(p.main).toMatch(/<h1 class="visually-hidden">/);
    expect(p.main).toContain('js-continue');
    expect(continueCard()).toContain('hidden');
  });
  it('文章页有表情回应条（按钮带 aria-pressed / 文字标签）', () => {
    const p = postPage(site, post);
    expect(p.main).toContain('class="reactions js-reactions" data-slug="hello"');
    const bar = reactionsBar('hello');
    expect((bar.match(/<button class="react"/g) ?? []).length).toBe(6);
    expect(bar).toContain('aria-pressed="false" aria-label="赞"');
    expect(reactionsBar('"><x>')).not.toContain('"><x>');
  });
});
