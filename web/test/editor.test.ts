/**
 * L24 / v1.24.0 内容编辑器 2.0：
 * - editor-core：Markdown ⇄ 块往返无损（全部种子文章）、块操作、发布前检查、字数；草稿修订号冲突与恢复；定时发布校验；模板；多尺寸；预览数据；
 * - 新路由 /preview/（发布预览，站长）与 /scheduled/（即将发布）登记在「文章」栏目；
 * - 演示 mock API 与 Worker 同形状的 /api/admin/editor/* 与 /api/scheduled。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyTemplate,
  BLOCK_TYPES,
  blocksToMarkdown,
  blockToMarkdown,
  checkBlocks,
  draftKey,
  duePosts,
  findTemplate,
  fromLocalInput,
  insertBlock,
  isDraftKey,
  mediaMarkdown,
  moveBlock,
  newBlock,
  normalizeMarkdown,
  parseBlocks,
  parsePreview,
  pickNewer,
  planVariants,
  removeBlock,
  resolveDraftWrite,
  searchMedia,
  shouldOfferRecovery,
  srcsetOf,
  TEMPLATES,
  textStats,
  toLocalInput,
  validateDraft,
  validateMedia,
  validateSchedule,
  type Block,
} from '../src/editor-core';
import { renderMarkdown } from '../src/markdown';
import { createSeed, DEMO_PASSWORD } from '../src/demo/seed';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { parseRoute, renderRoute, setBasePath } from '../src/render';
import { noindexRoute, sectionOf, SITE_SECTIONS, sitemapRoutes } from '../src/site-map';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type SiteData } from '../src/types';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('editor-core：Markdown ⇄ 块', () => {
  const seed = createSeed('/');
  it('全部种子文章：块往返 == 规范化原文，规范化不改变渲染结果', () => {
    expect(seed.posts.length).toBeGreaterThan(3);
    for (const p of seed.posts) {
      const blocks = parseBlocks(p.contentMd);
      expect(blocks.length).toBeGreaterThan(0);
      expect(blocksToMarkdown(blocks)).toBe(normalizeMarkdown(p.contentMd));
      expect(renderMarkdown(normalizeMarkdown(p.contentMd))).toBe(renderMarkdown(p.contentMd.replace(/\r\n?/g, '\n').trim()));
    }
  });

  it('逐类识别并原样写回', () => {
    const md = [
      '## 小标题',
      '一段话，**加粗**  \n第二行（硬换行）',
      '> 引用第一行\n>\n> 引用第三行',
      '- 甲\n- 乙',
      '1. 一\n2. 二\n3. 三',
      '```ts\nconst a = 1;\n\n// 空行在代码里保留\n```',
      '![山间的雾](https://example.com/a.jpg)',
      ':::tip 小结\n要点\n:::',
      '---',
      '| a | b |\n|---|---|\n| 1 | 2 |',
      ':::compare\n![前](https://example.com/1.jpg)\n![后](https://example.com/2.jpg)\n:::',
    ].join('\n\n');
    const b = parseBlocks(md);
    expect(b.map((x) => x.type)).toEqual(['heading', 'paragraph', 'quote', 'list', 'list', 'code', 'image', 'callout', 'divider', 'raw', 'raw']);
    expect(b[0]).toMatchObject({ level: 2, text: '小标题' });
    expect(b[2]!.text).toBe('引用第一行\n\n引用第三行');
    expect(b[4]).toMatchObject({ ordered: true, text: '一\n二\n三' });
    expect(b[5]).toMatchObject({ lang: 'ts' });
    expect(b[5]!.text).toContain('\n\n// 空行');
    expect(b[6]).toMatchObject({ alt: '山间的雾', src: 'https://example.com/a.jpg' });
    expect(b[7]).toMatchObject({ kind: 'tip', title: '小结', text: '要点' });
    expect(blocksToMarkdown(b)).toBe(md);
  });

  it('不规整的写法归为原样块（不改原文）；多余空行与 CRLF 规范化', () => {
    for (const raw of ['1. 一\n3. 三', '* 星号列表', '-  两个空格', '<div>html</div>', '```\n没有结束的围栏', '##没有空格']) {
      const b = parseBlocks(raw);
      expect(blocksToMarkdown(b)).toBe(raw);
    }
    expect(normalizeMarkdown('\r\n\r\n第一段\r\n\r\n\r\n\r\n第二段\n   \n第三段\n\n')).toBe('第一段\n\n第二段\n\n第三段');
    // 围栏紧跟段落：切成两块（CommonMark 里围栏本来就能打断段落）
    expect(parseBlocks('说明：\n```js\nx\n```').map((x) => x.type)).toEqual(['paragraph', 'code']);
  });

  it('每种块都能新建、写成 Markdown 后再读回同一类型', () => {
    for (const t of BLOCK_TYPES.filter((x) => x !== 'raw')) {
      const b = newBlock(t);
      expect(parseBlocks(blockToMarkdown(b))[0]!.type).toBe(t);
    }
  });

  it('移动 / 插入 / 删除块', () => {
    const b: Block[] = parseBlocks('一\n\n二\n\n三');
    expect(moveBlock(b, 0, 1).map((x) => x.text)).toEqual(['二', '一', '三']);
    expect(moveBlock(b, 0, -1)).toBe(b);
    expect(moveBlock(b, 2, 1)).toBe(b);
    expect(insertBlock(b, 0, newBlock('divider')).map((x) => x.type)).toEqual(['paragraph', 'divider', 'paragraph', 'paragraph']);
    expect(insertBlock(b, -1, newBlock('heading'))[0]!.type).toBe('heading');
    expect(removeBlock(b, 1).map((x) => x.text)).toEqual(['一', '三']);
  });

  it('发布前检查：图片替代文字 / 地址、标题跳级、一级标题、空块', () => {
    const issues = checkBlocks(parseBlocks('# 大标题\n\n#### 跳级\n\n![](https://x.test/a.jpg)\n\n![有说明](javascript:alert(1))\n\n## 正常'));
    const msgs = issues.map((i) => `${i.index}:${i.message}`);
    expect(msgs).toContain('0:正文里不要用一级标题（文章标题已经是一级）');
    expect(msgs).toContain('1:标题从 1 级跳到了 4 级');
    expect(msgs).toContain('2:图片缺少替代文字');
    expect(msgs).toContain('3:图片地址必须是 https:// 或站内图片');
    expect(issues.some((i) => i.index === 4)).toBe(false);
    expect(checkBlocks(parseBlocks('## 好\n\n### 也好\n\n![猫](/api/images/2026/10/a.webp)'))).toEqual([]);
  });

  it('字数：汉字逐字、英文按词，代码与图片不算；阅读时间按 400 字/分钟', () => {
    expect(textStats('')).toEqual({ chars: 0, minutes: 0, blocks: 0 });
    const s = textStats('你好世界 hello world\n\n```js\nconst notCounted = 1\n```\n\n![图](https://x.test/a.jpg)');
    expect(s.chars).toBe(6);
    expect(s.minutes).toBe(1);
    expect(s.blocks).toBe(3);
    expect(textStats('字'.repeat(801)).minutes).toBe(3);
  });
});

describe('editor-core：草稿、定时、模板、媒体、预览', () => {
  it('草稿键与校验', () => {
    expect(draftKey('hello-world')).toBe('post:hello-world');
    expect(draftKey(null)).toBe('new');
    expect(isDraftKey('post:hello-world')).toBe(true);
    expect(isDraftKey('new')).toBe(true);
    expect(isDraftKey('post:Bad Slug')).toBe(false);
    expect(isDraftKey('../etc')).toBe(false);
    expect(validateDraft({ title: 't', markdown: 'a\r\nb' })).toEqual({ ok: true, title: 't', markdown: 'a\nb' });
    expect(validateDraft({ title: 'x'.repeat(201), markdown: '' }).ok).toBe(false);
    expect(validateDraft({ title: 't' }).ok).toBe(false);
  });

  it('修订号：baseRev 等于当前修订号才能写，否则冲突', () => {
    expect(resolveDraftWrite(null, 0)).toEqual({ ok: true, rev: 1 });
    expect(resolveDraftWrite(3, 3)).toEqual({ ok: true, rev: 4 });
    expect(resolveDraftWrite(3, 2)).toEqual({ ok: false, serverRev: 3 });
    expect(resolveDraftWrite(null, 2)).toEqual({ ok: false, serverRev: 0 });
  });

  it('草稿恢复：本机草稿与文章不同且更新时才提示；空草稿不提示', () => {
    const local = { key: 'post:a', title: 'T', markdown: '新的正文', rev: 0, savedAt: '2026-10-14T10:00:00.000Z' };
    expect(shouldOfferRecovery(local, { title: 'T', markdown: '旧正文', updatedAt: '2026-10-14T09:00:00.000Z' })).toBe(true);
    expect(shouldOfferRecovery(local, { title: 'T', markdown: '旧正文', updatedAt: '2026-10-14T11:00:00.000Z' })).toBe(false);
    expect(shouldOfferRecovery(local, { title: 'T', markdown: '新的正文\n\n', updatedAt: null })).toBe(false);
    expect(shouldOfferRecovery({ ...local, title: '', markdown: '  ' }, { title: 'T', markdown: 'x', updatedAt: null })).toBe(false);
    expect(shouldOfferRecovery(null, { title: '', markdown: '' })).toBe(false);
    expect(shouldOfferRecovery(local, { title: '', markdown: '' })).toBe(true);
    const server = { ...local, savedAt: '2026-10-14T10:30:00.000Z', markdown: '服务器' };
    expect(pickNewer(local, server)).toBe(server);
    expect(pickNewer(local, null)).toBe(local);
    expect(pickNewer({ ...local, savedAt: server.savedAt }, server)).toBe(server);
  });

  it('定时发布校验：带时区、至少 1 分钟后、最多 365 天，秒舍去；空 = 取消', () => {
    const now = Date.parse('2026-10-14T10:00:00Z');
    expect(validateSchedule(null, now)).toEqual({ ok: true, at: null });
    expect(validateSchedule('', now)).toEqual({ ok: true, at: null });
    expect(validateSchedule('2026-10-14T12:30:45+08:00', now)).toEqual({ ok: false, message: '定时发布的时间至少要在 1 分钟之后' });
    expect(validateSchedule('2026-10-14T20:30:45+08:00', now)).toEqual({ ok: true, at: '2026-10-14T12:30:00.000Z' });
    expect(validateSchedule('2026-10-14T12:30', now).ok).toBe(false);
    expect(validateSchedule('2027-10-15T10:00:00Z', now).ok).toBe(false);
    expect(validateSchedule(12345, now).ok).toBe(false);
    expect(validateSchedule('2026-13-40T10:00:00Z', now).ok).toBe(false);
  });

  it('datetime-local ⇄ ISO（北京时间偏移 -480）；到点的草稿', () => {
    expect(fromLocalInput('2026-10-15T09:30', -480)).toBe('2026-10-15T01:30:00.000Z');
    expect(fromLocalInput('2026-10-15T09:30', 240)).toBe('2026-10-15T13:30:00.000Z');
    expect(fromLocalInput('明天', 0)).toBeNull();
    expect(toLocalInput('2026-10-15T01:30:00.000Z', -480)).toBe('2026-10-15T09:30');
    const rows = [
      { id: 1, status: 'draft', publishAt: '2026-10-14T09:00:00.000Z' },
      { id: 2, status: 'draft', publishAt: '2026-10-14T11:00:00.000Z' },
      { id: 3, status: 'published', publishAt: '2026-10-14T08:00:00.000Z' },
      { id: 4, status: 'draft', publishAt: null },
    ];
    expect(duePosts(rows, '2026-10-14T10:00:00.000Z').map((r) => r.id)).toEqual([1]);
  });

  it('模板：空正文替换，已有正文追加；标签并集；分类只在空时填', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(['tech-note', 'photo-diary', 'shelf-review', 'weekly']);
    for (const t of TEMPLATES) expect(blocksToMarkdown(parseBlocks(t.markdown))).toBe(normalizeMarkdown(t.markdown));
    const t = findTemplate('tech-note')!;
    const a = applyTemplate(t, { title: '标题', markdown: '', tags: ['笔记', 'ts'], category: '' });
    expect(a).toEqual({ title: '标题', markdown: t.markdown, tags: ['笔记', 'ts'], category: '技术' });
    const b = applyTemplate(t, { title: '', markdown: '已有\n\n\n', tags: [], category: '生活' });
    expect(b.markdown.startsWith('已有\n\n## 背景')).toBe(true);
    expect(b.category).toBe('生活');
    expect(findTemplate('nope')).toBeUndefined();
  });

  it('多尺寸：只缩小不放大；srcset 去重排序', () => {
    expect(planVariants(4032, 3024)).toEqual([{ width: 640, height: 480 }, { width: 1280, height: 960 }, { width: 1920, height: 1440 }, { width: 4032, height: 3024 }]);
    expect(planVariants(1280, 720)).toEqual([{ width: 640, height: 360 }, { width: 1280, height: 720 }]);
    expect(planVariants(500, 500)).toEqual([{ width: 500, height: 500 }]);
    expect(planVariants(0, 10)).toEqual([]);
    expect(srcsetOf([{ width: 1280, url: '/b' }, { width: 640, url: '/a' }, { width: 640, url: '/a2' }])).toBe('/a 640w, /b 1280w');
  });

  it('媒体条目校验、插入用 Markdown、搜索', () => {
    const ok = validateMedia({ url: '/api/images/2026/10/a.webp', alt: '雾里的\n山', width: 1280, height: 720, bytes: 1000, variants: [{ width: 640, url: '/api/images/2026/10/b.webp' }] });
    expect(ok).toEqual({ ok: true, value: { url: '/api/images/2026/10/a.webp', alt: '雾里的 山', width: 1280, height: 720, bytes: 1000, variants: [{ width: 640, url: '/api/images/2026/10/b.webp' }] } });
    expect(validateMedia({ url: 'javascript:alert(1)' }).ok).toBe(false);
    expect(validateMedia({ url: 'https://x.test/a.jpg', alt: 'x'.repeat(201) }).ok).toBe(false);
    expect(validateMedia({ url: 'https://x.test/a.jpg', width: -1 }).ok).toBe(false);
    expect(validateMedia({ url: 'https://x.test/a.jpg', variants: [{ width: 640, url: 'ftp://x' }] }).ok).toBe(false);
    expect(mediaMarkdown({ url: 'https://x.test/a.jpg', alt: '有[括号]' })).toBe('![有括号](https://x.test/a.jpg)');
    const items = [{ alt: '海边', url: 'https://x.test/sea.jpg' }, { alt: '山', url: 'https://x.test/hill.jpg' }];
    expect(searchMedia(items, 'SEA')).toEqual([items[0]]);
    expect(searchMedia(items, ' ')).toEqual(items);
  });

  it('预览数据：解析失败返回 null，不安全的封面丢弃', () => {
    expect(parsePreview(null)).toBeNull();
    expect(parsePreview('{bad')).toBeNull();
    expect(parsePreview(JSON.stringify({ title: 1 }))).toBeNull();
    const p = parsePreview(JSON.stringify({ title: '预览', markdown: '正文', savedAt: 'x', coverUrl: 'javascript:1', tags: ['a', 2] }));
    expect(p).toEqual({ title: '预览', summary: '', markdown: '正文', tags: ['a'], category: '', coverUrl: '', savedAt: 'x' });
  });
});

describe('新路由登记在「文章」栏目', () => {
  const site: SiteData = { settings: DEFAULT_SETTINGS, profile: DEFAULT_PROFILE, posts: [], total: 0, tags: [], categories: [] };
  beforeEach(() => setBasePath('/'));
  it('/preview/ 与 /scheduled/ 解析、归属、可见性与 sitemap', () => {
    expect(parseRoute('/preview/').name).toBe('preview');
    expect(parseRoute('/scheduled/').name).toBe('scheduled');
    expect(sectionOf('preview')?.id).toBe('posts');
    expect(sectionOf('scheduled')?.id).toBe('posts');
    const posts = SITE_SECTIONS.find((s) => s.id === 'posts')!;
    expect(posts.entries.find((x) => x.id === 'preview')).toMatchObject({ audience: 'admin', index: false, href: '/preview/' });
    expect(posts.entries.find((x) => x.id === 'scheduled')).toMatchObject({ href: '/scheduled/' });
    const sm = sitemapRoutes();
    expect(sm.render).toContain('preview');
    expect(sm.render).toContain('scheduled');
    expect(sm.index).toContain('scheduled');
    expect(sm.index).not.toContain('preview');
  });
  it('外壳：预览页 noindex 并带挂载点；即将发布页带列表挂载点', () => {
    const pv = renderRoute({ name: 'preview' }, site);
    expect(pv.title.startsWith('发布预览 |')).toBe(true);
    expect(pv.main).toContain('js-editor-preview');
    expect(noindexRoute('preview')).toBe(true);
    expect(noindexRoute('scheduled')).toBe(false);
    expect(noindexRoute('me')).toBe(true);
    const sc = renderRoute({ name: 'scheduled' }, site);
    expect(sc.title.startsWith('即将发布 |')).toBe(true);
    expect(sc.main).toContain('js-scheduled');
  });
});

describe('演示 mock API：/api/admin/editor/* 与 /api/scheduled', () => {
  let api: DemoBackend;
  let clock = Date.parse('2026-10-14T10:00:00Z');
  let csrf = '';
  const admin = (method: string, path: string, body?: unknown) => api.handle(method, path, body, { 'x-csrf-token': csrf });
  beforeEach(async () => {
    clock = Date.parse('2026-10-14T10:00:00Z');
    api = new DemoBackend({ storage: memoryKV(), base: '/', now: () => new Date(clock) });
    csrf = ((await api.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as { csrfToken: string }).csrfToken;
  });

  it('未登录 401', async () => {
    const anon = new DemoBackend({ storage: memoryKV(), base: '/', now: () => new Date(clock) });
    expect((await anon.handle('GET', '/api/admin/editor/drafts')).status).toBe(401);
  });

  it('草稿：rev 递增，过期的 baseRev 409 并返回服务器版本；列表 / 读取 / 删除', async () => {
    let r = await admin('PUT', '/api/admin/editor/drafts/new', { baseRev: 0, title: '草稿', markdown: '第一版' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ draft: { key: 'new', rev: 1, title: '草稿', markdown: '第一版' } });
    r = await admin('PUT', '/api/admin/editor/drafts/new', { baseRev: 1, title: '草稿', markdown: '第二版' });
    expect((r.body as { draft: { rev: number } }).draft.rev).toBe(2);
    expect((await admin('PUT', '/api/admin/editor/drafts/new', { baseRev: 1, title: '草稿', markdown: '另一个标签页' })).status).toBe(409);
    r = await admin('GET', '/api/admin/editor/drafts/new');
    expect(r.body).toMatchObject({ draft: { rev: 2, markdown: '第二版' } });
    r = await admin('GET', '/api/admin/editor/drafts');
    expect((r.body as { drafts: { key: string }[] }).drafts.map((d) => d.key)).toEqual(['new']);
    expect((await admin('PUT', '/api/admin/editor/drafts/..%2Fx', { baseRev: 0, title: '', markdown: '' })).status).toBe(400);
    await admin('DELETE', '/api/admin/editor/drafts/new');
    expect((await admin('GET', '/api/admin/editor/drafts/new')).status).toBe(404);
  });

  it('定时发布：到点前不公开，到点后出现在文章列表并离开「即将发布」', async () => {
    await admin('POST', '/api/admin/posts', { title: '示例：定时发布的文章', contentMd: '正文', slug: 'scheduled-demo' });
    const at = new Date(clock + 2 * 3600_000).toISOString();
    expect((await admin('POST', '/api/admin/editor/schedule/scheduled-demo', { publishAt: new Date(clock + 10_000).toISOString() })).status).toBe(400);
    const r = await admin('POST', '/api/admin/editor/schedule/scheduled-demo', { publishAt: at });
    expect(r.body).toMatchObject({ slug: 'scheduled-demo', publishAt: at });
    const up = (await api.handle('GET', '/api/scheduled')).body as { posts: { slug: string; title: string; publishAt: string }[] };
    expect(up.posts).toEqual([{ slug: 'scheduled-demo', title: '示例：定时发布的文章', category: '', publishAt: at }]);
    const listed = async () => ((await api.handle('GET', '/api/posts?limit=100')).body as { posts: { slug: string }[] }).posts.some((p) => p.slug === 'scheduled-demo');
    expect(await listed()).toBe(false);
    clock += 2 * 3600_000 + 1000;
    expect(await listed()).toBe(true);
    expect(((await api.handle('GET', '/api/scheduled')).body as { posts: unknown[] }).posts).toEqual([]);
    const post = (await admin('GET', '/api/admin/posts/scheduled-demo')).body as { status: string; publishedAt: string };
    expect(post).toMatchObject({ status: 'published', publishedAt: at });
  });

  it('取消定时；已发布的文章不能定时', async () => {
    await admin('POST', '/api/admin/posts', { title: '示例：取消定时', contentMd: '正文', slug: 'cancel-demo' });
    await admin('POST', '/api/admin/editor/schedule/cancel-demo', { publishAt: new Date(clock + 3600_000).toISOString() });
    await admin('POST', '/api/admin/editor/schedule/cancel-demo', { publishAt: null });
    expect(((await admin('GET', '/api/admin/editor/scheduled')).body as { posts: unknown[] }).posts).toEqual([]);
    await admin('POST', '/api/admin/posts/cancel-demo/publish', { published: true });
    expect((await admin('POST', '/api/admin/editor/schedule/cancel-demo', { publishAt: new Date(clock + 3600_000).toISOString() })).status).toBe(409);
  });

  it('媒体库：登记 / 列表 / 搜索 / 改替代文字 / 移出；模板列表', async () => {
    let r = await admin('POST', '/api/admin/editor/media', { url: PNG, alt: '示例图', width: 1, height: 1, bytes: 68 });
    expect(r.status).toBe(201);
    const id = (r.body as { media: { id: number } }).media.id;
    expect((await admin('POST', '/api/admin/editor/media', { url: 'javascript:1' })).status).toBe(400);
    r = await admin('GET', '/api/admin/editor/media?q=示例');
    expect((r.body as { media: { id: number }[] }).media.map((m) => m.id)).toEqual([id]);
    r = await admin('PATCH', `/api/admin/editor/media/${id}`, { alt: '雾中的山' });
    expect(r.body).toMatchObject({ media: { id, alt: '雾中的山' } });
    await admin('DELETE', `/api/admin/editor/media/${id}`);
    expect(((await admin('GET', '/api/admin/editor/media')).body as { media: unknown[] }).media).toEqual([]);
    r = await admin('GET', '/api/admin/editor/templates');
    expect((r.body as { templates: { id: string }[] }).templates.map((t) => t.id)).toEqual(TEMPLATES.map((t) => t.id));
  });
});
