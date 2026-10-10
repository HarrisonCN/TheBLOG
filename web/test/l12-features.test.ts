// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BADGE_COLOR_PRESETS, BADGE_GRADIENTS, BADGE_PRESETS, BADGE_TEXTURES, DEFAULT_BADGE_DESIGN, badgeClasses, badgeColors, badgeContrast, legacyDesign, matchPreset, normalizeBadgeDesign,
  sanitizeBadgeLabel, validateBadgeDesign, type BadgeDesign,
} from '../src/badge-design';
import { badgeBuilderHtml, badgeHtml, presetGallery, readBuilder } from '../src/badge-view';
import { renderCommentHtml, resolveParent, threadComments, validateComment, type PostComment } from '../src/comment-core';
import { archiveCalendar, relatedPosts, seriesOf } from '../src/post-extras';
import { dailyIndex, dailyWork, isLand, mapPoints, project } from '../src/photo-map';
import { coarseCoord, validateSection, type Work } from '../src/sections';
import { renderMarkdown } from '../src/markdown';
import { parseReadingSettings, pickVoice, RS_DEFAULT, speakableBlocks, speechSupported } from '../src/reading-tools';
import { captionOf, clampZoom } from '../src/post-media';
import { commentListHtml } from '../src/comments-client';
import { archivesPage, dailyPhotoCard, mapPage, parseRoute, postPage, routePath } from '../src/render';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { createSeed, DEMO_PASSWORD } from '../src/demo/seed';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type Post, type PostSummary, type SiteData } from '../src/types';

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const HEX = /^#[0-9a-f]{6}$/;

describe('共享模块：web 与 worker 两份完全相同', () => {
  it('badge-design.ts / comment-core.ts', () => {
    expect(read('../src/badge-design.ts')).toBe(read('../../worker/src/badge-design.ts'));
    expect(read('../src/comment-core.ts')).toBe(read('../../worker/src/comment-core.ts'));
  });
});

// ============================================================ 徽章 DIY
describe('徽章设计校验器', () => {
  it('缺省 → 默认；部分字段补齐；预设都能通过严格校验', () => {
    expect(validateBadgeDesign(undefined)).toEqual({ ok: true, design: DEFAULT_BADGE_DESIGN });
    const r = validateBadgeDesign({ shape: 'hexagon', color: '#ABCDEF' });
    expect(r.ok && r.design).toEqual({ ...DEFAULT_BADGE_DESIGN, shape: 'hexagon', color: '#abcdef' });
    for (const p of BADGE_PRESETS) expect(validateBadgeDesign(p.design).ok, p.id).toBe(true);
    expect(BADGE_PRESETS.map((p) => p.id)).toEqual(expect.arrayContaining(['enamel', 'holo', 'pixel', 'ribbon', 'stamp', 'neon', 'film', 'wax']));
  });
  it('拒绝原始 CSS、未知键、错误类型、非白名单枚举、非 #rrggbb', () => {
    for (const bad of [
      'color:red', [], 42, { css: 'x' }, { style: 'background:url(x)' }, { color: 'red' }, { color: '#fff' }, { color: '#12345g' }, { color: '#ffffff;background:red' },
      { shape: 'star' }, { texture: 'gold' }, { fill: 'radial' }, { gradient: 'linear-gradient(red,blue)' }, { border: '1px solid red' }, { icon: '<svg>' }, { icon: 'trash' },
      { effect: 'blink' }, { size: 'xl' }, { size: 2 }, { label: 5 }, { label: '<script>' }, { label: '一二三四五六七八九' }, { label: 'a\u202Eb' }, Object.create({ shape: 'circle' }),
    ]) expect(validateBadgeDesign(bad).ok, JSON.stringify(bad)).toBe(false);
  });
  it('label 清洗：去掉不可见 / 双向覆盖字符，过滤 < > 等，最多 8 个码点（emoji 不被劈开）', () => {
    expect(sanitizeBadgeLabel('  好 \u200b朋\u202E友  ')).toBe('好 朋友');
    expect(sanitizeBadgeLabel('<b>hi</b>')).toBe('bhi/b'.replace('/', ''));
    expect(sanitizeBadgeLabel('一二三四五六七八九十')).toBe('一二三四五六七八');
    expect(Array.from(sanitizeBadgeLabel('📷📷📷📷📷📷📷📷📷')).length).toBe(8);
    expect(sanitizeBadgeLabel(null)).toBe('');
    expect(validateBadgeDesign({ label: '夜猫子 🌙' }).ok).toBe(true);
  });
  it('normalize：坏 JSON / 坏数据 → fallback；旧徽章按 style 映射到预设', () => {
    expect(normalizeBadgeDesign('{oops')).toEqual(DEFAULT_BADGE_DESIGN);
    expect(normalizeBadgeDesign({ color: 'javascript:alert(1)' }, legacyDesign('pearlescent')).texture).toBe('pearl');
    expect(legacyDesign('brushed-metal').texture).toBe('metal');
    expect(normalizeBadgeDesign(JSON.stringify(BADGE_PRESETS[0]!.design))).toEqual(BADGE_PRESETS[0]!.design);
    expect(matchPreset(BADGE_PRESETS[2]!.design)).toBe('pixel');
    expect(matchPreset({ ...BADGE_PRESETS[2]!.design, label: 'x' })).toBe('custom');
  });
  it('对比度自动调整：任意底色 / 渐变 / 材质，文字与渐变两端都 ≥ 4.5:1', () => {
    const colors = [...BADGE_COLOR_PRESETS.map((c) => c.hex), '#ffff00', '#00ff00', '#ff00ff', '#777777', '#808080', '#00ffff', '#ff7f50', '#000000', '#ffffff', '#4a4a4a'];
    for (let i = 0; i < 40; i++) colors.push(`#${((i * 2654435761) >>> 8).toString(16).padStart(6, '0').slice(-6)}`);
    for (const texture of BADGE_TEXTURES)
      for (const color of colors)
        for (const fill of ['solid', 'gradient'] as const)
          for (const gradient of BADGE_GRADIENTS) {
            const d: BadgeDesign = { ...DEFAULT_BADGE_DESIGN, texture, color, fill, gradient };
            const c = badgeColors(d);
            for (const v of Object.values(c)) expect(v).toMatch(HEX);
            expect(badgeContrast(c.ink, c.bg), `${texture} ${fill} ${color} ${gradient}`).toBeGreaterThanOrEqual(4.5);
            expect(badgeContrast(c.ink, c.bg2), `${texture} ${fill} ${color} ${gradient}`).toBeGreaterThanOrEqual(4.5);
          }
  });
  it('渲染只输出白名单类名 + #rrggbb 变量，文字全部转义', () => {
    const html = badgeHtml('FRIEND-0001', '<img src=x onerror=alert(1)>', { ...BADGE_PRESETS[0]!.design, label: '好朋友' });
    const host = document.createElement('div');
    host.innerHTML = html;
    const el = host.firstElementChild as HTMLElement;
    expect(host.querySelector('img')).toBeNull();
    expect(el.getAttribute('aria-label')).toContain('<img src=x');
    for (const c of el.className.split(/\s+/)) expect(c).toMatch(/^bd(--(sh|tx|bo|sz|fx)-[a-z]+|--anim)?$/);
    const style = el.getAttribute('style')!;
    expect(style).toMatch(/^(--bd-(bg|bg2|ink|ac):#[0-9a-f]{6};?)+$/);
    // 坏设计 → 旧材质预设，不抛错
    expect(badgeHtml('X', 'y', { shape: 'url(javascript:1)' }, 'pearlescent')).toContain('bd--tx-pearl');
    expect(badgeClasses({ ...DEFAULT_BADGE_DESIGN, effect: 'float' })).toContain('bd--anim');
    expect(badgeClasses({ ...DEFAULT_BADGE_DESIGN, effect: 'glow' })).not.toContain('bd--anim');
  });
  it('DIY 面板：预设 / 形状 / 底色 / 图标 / 特效 / 大小 都有，读回来的设计能通过校验', () => {
    const host = document.createElement('div');
    host.innerHTML = badgeBuilderHtml({ code: 'FRIEND-0002', label: '夜猫子', design: BADGE_PRESETS[5]!.design, who: 'member' });
    const form = host.querySelector('form')!;
    expect(form.querySelectorAll('.bdb__preset').length).toBe(BADGE_PRESETS.length);
    expect(form.querySelector('.bdb__preset[aria-pressed="true"]')?.getAttribute('data-preset')).toBe('neon');
    for (const g of ['shape', 'texture', 'fill', 'border', 'icon', 'effect', 'size']) expect(form.querySelectorAll(`input[data-g="${g}"]`).length, g).toBeGreaterThan(1);
    const v = validateBadgeDesign(readBuilder(form));
    expect(v.ok && v.design).toEqual(BADGE_PRESETS[5]!.design);
    expect(presetGallery()).toContain('bd-gallery');
  });
});

// ============================================================ 评论
describe('评论：校验 / Markdown-lite / 楼中楼', () => {
  it('validateComment：字段白名单、长度、蜜罐、parentId', () => {
    expect(validateComment({ name: ' 小林 ', content: '写得好！' })).toEqual({ ok: true, value: { name: '小林', content: '写得好！', parentId: null }, spam: false });
    expect(validateComment({ name: 'a', content: '你好呀', homepage: 'http://spam' })).toMatchObject({ ok: true, spam: true });
    for (const bad of [null, [], 'x', { name: '', content: '你好' }, { name: 'a', content: '短' }, { name: 'a'.repeat(31), content: '你好' }, { name: '<b>', content: '你好' }, { name: 'a', content: 'x'.repeat(1001) }, { name: 'a', content: '你好', parentId: -1 }, { name: 'a', content: '你好', parentId: '3' }, { name: 'a', content: '你好', extra: 1 }, { name: 'a', content: '你好', homepage: 3 }])
      expect(validateComment(bad).ok, JSON.stringify(bad)).toBe(false);
  });
  it('renderCommentHtml：先转义；只有白名单格式；危险链接不生成 <a>', () => {
    const x = renderCommentHtml('<script>alert(1)</script> <img src=x onerror=alert(1)>');
    expect(x).not.toMatch(/<script|<img/);
    expect(x).toContain('&lt;script&gt;');
    expect(renderCommentHtml('[点我](javascript:alert(1))')).not.toContain('<a');
    expect(renderCommentHtml('[x](https://a.test/"onmouseover="alert(1))')).not.toMatch(/<a[^>]*onmouseover/);
    expect(renderCommentHtml('**粗** *斜* ~~删~~ `<b>代码</b>`')).toBe('<p><strong>粗</strong> <em>斜</em> <del>删</del> <code>&lt;b&gt;代码&lt;/b&gt;</code></p>');
    expect(renderCommentHtml('[博客](https://example.com/a?b=1&c=2)')).toBe('<p><a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="nofollow ugc noopener noreferrer">博客</a></p>');
    expect(renderCommentHtml('看 https://example.com/x。')).toContain('<a href="https://example.com/x"');
    expect(renderCommentHtml('> 引用\n> 第二行\n\n正文\n换行')).toBe('<blockquote>引用<br>第二行</blockquote><p>正文<br>换行</p>');
    expect(renderCommentHtml('`**不加粗**`')).toBe('<p><code>**不加粗**</code></p>');
    // 输出里只允许这些标签
    const tags = [...renderCommentHtml('**a** *b* [c](https://d.test) `e` > f\n\ng ~~h~~').matchAll(/<\/?([a-z]+)/g)].map((m) => m[1]);
    for (const t of tags) expect(['p', 'br', 'blockquote', 'code', 'strong', 'em', 'del', 'a']).toContain(t);
  });
  it('threadComments：两级；孤儿回复提升为顶层；resolveParent 把回复的回复挂到顶层', () => {
    const c = (id: number, parentId: number | null, t: string, name = 'u'): PostComment => ({ id, slug: 's', parentId, replyTo: '', name, content: 'xx', member: false, status: 'approved', createdAt: `2026-10-0${t}T00:00:00Z` });
    const th = threadComments([c(3, 1, '3'), c(1, null, '1'), c(2, null, '2'), c(4, 99, '4'), c(5, 1, '2')]);
    expect(th.map((t) => t.id)).toEqual([1, 2, 4]);
    expect(th[0]!.replies.map((r) => r.id)).toEqual([5, 3]);
    expect(th[2]!.parentId).toBeNull();
    expect(resolveParent({ id: 1, parentId: null, name: 'A' })).toEqual({ parentId: 1, replyTo: '' });
    expect(resolveParent({ id: 3, parentId: 1, name: 'B' })).toEqual({ parentId: 1, replyTo: 'B' });
    const html = commentListHtml(th);
    expect(html).toContain('c-replies');
    expect(commentListHtml([])).toContain('还没有评论');
  });
});

// ============================================================ 系列 / 相关 / 归档日历
const P = (id: number, slug: string, o: Partial<PostSummary> = {}): PostSummary => ({ id, slug, title: slug, summary: '', tags: [], coverUrl: null, category: null, pinned: false, wordCount: 10, status: 'published', publishedAt: `2026-0${id}-15T12:00:00Z`, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...o });
describe('系列连载 / 相关文章 / 归档日历', () => {
  const posts = [P(1, 'a', { series: 'S', tags: ['x'] }), P(3, 'c', { series: 'S', tags: ['x', 'y'] }), P(2, 'b', { series: 'S' }), P(4, 'd', { tags: ['x', 'y'], category: 'K' }), P(5, 'e', { tags: ['z'], category: 'K' }), P(6, 'f', { tags: ['q'] })];
  it('seriesOf：按发布时间排序、位置、上一篇 / 下一篇；单篇系列或无系列 → null', () => {
    const s = seriesOf(posts, posts[2]!)!;
    expect(s.posts.map((p) => p.slug)).toEqual(['a', 'b', 'c']);
    expect([s.index, s.prev?.slug, s.next?.slug]).toEqual([1, 'a', 'c']);
    expect(seriesOf(posts, posts[3]!)).toBeNull();
    expect(seriesOf([P(1, 'solo', { series: 'T' })], { slug: 'solo', series: 'T' })).toBeNull();
  });
  it('relatedPosts：标签 Jaccard + 分类，排除同系列，没有交集不推荐', () => {
    const r = relatedPosts(posts, { slug: 'c', tags: ['x', 'y'], category: 'K', series: 'S' });
    expect(r.map((p) => p.slug)).toEqual(['d', 'e']);
    expect(relatedPosts(posts, { slug: 'c', tags: ['x', 'y'], category: null, series: 'S' }, 3, { excludeSeries: false }).map((p) => p.slug)[0]).toBe('d');
  });
  it('archiveCalendar：Asia/Shanghai 年月计数，新年份在前', () => {
    const cal = archiveCalendar([P(1, 'a'), P(2, 'b', { publishedAt: '2025-12-31T17:00:00Z' }), P(3, 'c', { publishedAt: '2026-03-01T01:00:00Z' })]);
    // 2025-12-31T17:00Z 在上海已经是 2026-01-01：不会多出一个 2025 年
    expect(cal.map((y) => y.year)).toEqual(['2026']);
    expect(cal[0]!.months[0]).toBe(2);
    expect(cal[0]!.months[2]).toBe(1);
    expect(cal[0]!.total).toBe(3);
    expect(archiveCalendar([P(1, 'a'), P(2, 'b', { publishedAt: '2025-06-01T00:00:00Z' })]).map((y) => y.year)).toEqual(['2026', '2025']);
  });
});

// ============================================================ 照片地图 / 每日一图
const W = (id: string, o: Partial<Work> = {}): Work => ({ id, title: id, url: `/${id}.webp`, series: '', date: '', location: '某地', camera: '', lens: '', focal: '', aperture: '', shutter: '', iso: '', tags: [], credit: '', creditUrl: '', width: 0, height: 0, ...o });
describe('照片地图 / 每日一图', () => {
  it('只有 geo=on 且坐标合法的作品上地图；坐标再粗化到 0.1°；同点合并', () => {
    const pts = mapPoints([W('a', { geo: 'on', lat: '25.2789', lng: '110.2961' }), W('b', { geo: 'on', lat: '25.31', lng: '110.33' }), W('c', { geo: 'off', lat: '31.2', lng: '121.5' }), W('d', { lat: '1', lng: '1' }), W('e', { geo: 'on', lat: '95', lng: '0' }), W('f', { geo: 'on', lat: 'x', lng: '0' })]);
    expect(pts).toHaveLength(1);
    expect(pts[0]).toMatchObject({ lat: 25.3, lng: 110.3 });
    expect(pts[0]!.works.map((w) => w.id)).toEqual(['a', 'b']);
    expect(coarseCoord('-8.8123', 180)).toBe('-8.8');
    expect(coarseCoord('181', 180)).toBe('');
    expect(project(84, -180)).toEqual({ x: 0, y: 0 });
    expect(project(-60, 180)).toEqual({ x: 360, y: 144 });
  });
  it('后台校验也会粗化坐标并拒绝非法值', () => {
    const r = validateSection('works', [{ ...W('a'), geo: 'on', lat: '25.27891', lng: 'abc' }]);
    expect(r.items[0]!.lat).toBe('25.3');
    expect(r.issues.some((i) => i.path.endsWith('lng'))).toBe(true);
  });
  it('点阵底图：撒哈拉是陆地，太平洋中部是海', () => {
    const cell = (lat: number, lng: number) => isLand(Math.floor((lng + 180) / 3), Math.floor((84 - lat) / 3));
    expect(cell(23, 10)).toBe(true);
    expect(cell(0, -150)).toBe(false);
    expect(cell(40, -100)).toBe(true);
  });
  it('每日一图：同一天（上海时间）相同，第二天换下一张', () => {
    const d1 = new Date('2026-10-10T03:00:00Z');
    const d1b = new Date('2026-10-10T15:00:00Z');
    const d2 = new Date('2026-10-10T17:00:00Z'); // 上海已是 10-11
    expect(dailyIndex(7, d1)).toBe(dailyIndex(7, d1b));
    expect(dailyIndex(7, d2)).toBe((dailyIndex(7, d1) + 1) % 7);
    expect(dailyWork([], d1)).toBeNull();
    expect(dailyPhotoCard([W('x', { title: '湖' })], d1)).toContain('每日一图');
  });
});

// ============================================================ Markdown：脚注 + 图注
describe('Markdown：脚注与图注', () => {
  it('脚注：按首次引用编号、重复引用共用编号、未定义的保持原样、末尾生成脚注区', () => {
    const html = renderMarkdown('甲[^a]乙[^b]丙[^a]丁[^nope]\n\n[^b]: 第二\n[^a]: 第一 *强调*\n');
    expect(html).toContain('<sup class="fn-ref" id="fnref-1"><a href="#fn-1" data-fn="1"');
    expect(html).toContain('id="fnref-1-2"');
    expect(html).toContain('[^nope]');
    expect(html).toMatch(/<li id="fn-1"><p>第一 <em>强调<\/em> <a href="#fnref-1" class="fn-back"/);
    expect(html.indexOf('id="fn-1"')).toBeLessThan(html.indexOf('id="fn-2"'));
  });
  it('脚注内容同样走安全渲染（原始 HTML 被转义，危险链接被丢弃）', () => {
    const html = renderMarkdown('x[^a]\n\n[^a]: <script>1</script> [y](javascript:alert(1))\n');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
  });
  it('单独一行的图片 → figure + figcaption（title 优先）', () => {
    expect(renderMarkdown('![湖](/a.webp "日出")')).toContain('<figure class="figure"><img src="/a.webp" alt="湖" title="日出"');
    expect(renderMarkdown('![湖](/a.webp)')).toContain('<figcaption>湖</figcaption>');
    expect(renderMarkdown('文字 ![湖](/a.webp) 文字')).not.toContain('<figure');
  });
});

// ============================================================ 阅读设置 / 朗读 / lightbox 辅助
describe('阅读设置 / 朗读 / lightbox', () => {
  it('parseReadingSettings：只接受白名单值', () => {
    expect(parseReadingSettings(null)).toEqual(RS_DEFAULT);
    expect(parseReadingSettings('{"size":"xl","font":"comic","theme":"sepia","x":1}')).toEqual({ ...RS_DEFAULT, size: 'xl', theme: 'sepia' });
    expect(parseReadingSettings('{bad')).toEqual(RS_DEFAULT);
    expect(parseReadingSettings('[1]')).toEqual(RS_DEFAULT);
  });
  it('speechSupported / pickVoice', () => {
    expect(speechSupported({})).toBe(false);
    expect(speechSupported({ speechSynthesis: {}, SpeechSynthesisUtterance: function () {} })).toBe(true);
    expect(pickVoice([{ lang: 'en-US', name: 'a', default: true }, { lang: 'zh-TW', name: 'b' }, { lang: 'zh-CN', name: 'c' }])?.name).toBe('c');
    expect(pickVoice([{ lang: 'en-US', name: 'a', default: true }, { lang: 'zh-HK', name: 'b' }])?.name).toBe('b');
    expect(pickVoice([])).toBeNull();
  });
  it('speakableBlocks：跳过代码块和脚注区', () => {
    const d = document.createElement('div');
    d.innerHTML = '<h2>标题</h2><p>一</p><pre><code>code</code></pre><ul><li>二</li></ul><blockquote><p>三</p></blockquote><section class="footnotes"><ol><li><p>注</p></li></ol></section><p> </p>';
    expect(speakableBlocks(d).map((x) => x.textContent)).toEqual(['标题', '一', '二', '三']);
  });
  it('captionOf / clampZoom', () => {
    const d = document.createElement('div');
    d.innerHTML = '<figure><img alt="甲" title="乙"><figcaption>丙</figcaption></figure><img alt="丁" title="戊"><img alt="己">';
    const [a, b, c] = [...d.querySelectorAll('img')];
    expect([captionOf(a!), captionOf(b!), captionOf(c!)]).toEqual(['丙', '戊', '己']);
    expect([clampZoom(0.2), clampZoom(9), clampZoom(1.234)]).toEqual([1, 4, 1.23]);
  });
});

// ============================================================ 页面渲染
const site = (posts: PostSummary[]): SiteData => ({ settings: DEFAULT_SETTINGS, profile: DEFAULT_PROFILE, posts, total: posts.length, tags: [], categories: [] });
describe('页面渲染', () => {
  it('文章页：阅读工具、系列导航（进度条）、评论区（蜜罐）', () => {
    const posts = [P(1, 'a', { series: 'S' }), P(2, 'b', { series: 'S' }), P(3, 'c')];
    const post: Post = { ...posts[1]!, contentMd: '正文[^1]\n\n[^1]: 注' };
    const html = postPage(site(posts), post).main;
    expect(html).toContain('class="post-tools"');
    expect(html).toContain('id="rs-panel"');
    expect(html).toContain('class="tts js-tts" hidden');
    expect(html).toMatch(/role="progressbar"[^>]*aria-valuemax="2" aria-valuenow="2"/);
    expect(html).toContain('id="comments"');
    expect(html).toMatch(/class="c-hp" aria-hidden="true"><label>主页<input name="homepage" tabindex="-1"/);
  });
  it('照片地图路由与页面：只画公开作品', () => {
    expect(parseRoute('/map/')).toEqual({ name: 'map' });
    expect(routePath({ name: 'map' })).toBe('/map/');
    const html = mapPage(site([]), [W('a', { geo: 'on', lat: '25.3', lng: '110.3' }), W('b', { lat: '30', lng: '120' })]).main;
    expect((html.match(/class="pmap__pin"/g) ?? []).length).toBe(1);
    expect(html).toContain('另有 1 张作品没有公开位置');
  });
  it('归档：日历表格 + 每个月只有一个锚点 id', () => {
    const posts = [P(1, 'a'), P(1, 'b'), P(2, 'c')];
    const html = archivesPage(site(posts)).main;
    expect(html).toContain('<table class="acal">');
    expect((html.match(/id="y2026-01"/g) ?? []).length).toBe(1);
    expect(html).toContain('aria-label="2026 年 1 月：2 篇"');
  });
});

// ============================================================ 演示 mock API 与 Worker 保持一致
describe('演示 mock API：评论 / 徽章设计 / 系列 / 作品坐标', () => {
  let api: DemoBackend;
  let csrf = '';
  let clock = Date.parse('2026-10-10T08:00:00Z');
  const admin = (m: string, p: string, b?: unknown) => api.handle(m, p, b, { 'x-csrf-token': csrf });
  beforeEach(async () => {
    clock += 3_600_000;
    api = new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(clock) });
    csrf = ((await api.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as { csrfToken: string }).csrfToken;
  });
  it('评论：公开列表只有 approved；访客 → pending；站长审核后出现；回复的回复挂到顶层', async () => {
    const list = await api.handle('GET', '/api/posts/phone-night-photography/comments');
    const seeded = (list.body as { comments: PostComment[] }).comments;
    expect(seeded.every((c) => c.status === 'approved')).toBe(true);
    const r = await api.handle('POST', '/api/posts/phone-night-photography/comments', { name: '测试', content: '回复回复', parentId: 3 });
    expect(r.status).toBe(201);
    const c = (r.body as { comment: PostComment; status: string }).comment;
    expect([c.status, c.parentId, c.replyTo]).toEqual(['pending', 1, '路过的同学']);
    const q = await admin('GET', '/api/admin/comments?status=pending');
    expect((q.body as { comments: PostComment[] }).comments.some((x) => x.id === c.id)).toBe(true);
    expect((await admin('POST', `/api/admin/comments/${c.id}`, { action: 'approve' })).status).toBe(200);
    const after = (await api.handle('GET', '/api/posts/phone-night-photography/comments')).body as { comments: PostComment[] };
    expect(after.comments.some((x) => x.id === c.id)).toBe(true);
    expect((await admin('POST', `/api/admin/comments/${c.id}`, { action: 'nuke' })).status).toBe(400);
    expect((await admin('POST', '/api/admin/comments/1', { action: 'delete' })).status).toBe(200);
    const gone = (await api.handle('GET', '/api/posts/phone-night-photography/comments')).body as { comments: PostComment[] };
    expect(gone.comments.some((x) => x.id === 1 || x.parentId === 1)).toBe(false);
  });
  it('评论：蜜罐静默丢弃、校验失败 400、文章不存在 404、限流 429', async () => {
    const hp = await api.handle('POST', '/api/posts/welcome/comments', { name: 'bot', content: 'buy now', homepage: 'http://x' });
    expect(hp.status).toBe(201);
    expect((hp.body as { comment: unknown }).comment).toBeNull();
    expect((await api.handle('POST', '/api/posts/welcome/comments', { name: '', content: 'x' })).status).toBe(400);
    expect((await api.handle('POST', '/api/posts/nope/comments', { name: 'a', content: '你好呀' })).status).toBe(404);
    let last = 0;
    for (let i = 0; i < 4; i++) last = (await api.handle('POST', '/api/posts/welcome/comments', { name: 'a', content: `第 ${i} 条` })).status;
    expect(last).toBe(429);
  });
  it('徽章设计：站长改任何人的、好朋友改自己的；坏设计 400；读接口再归一化', async () => {
    const good = { ...BADGE_PRESETS[7]!.design, label: '亲启' };
    expect((await admin('PUT', '/api/admin/members/1/badges/FRIEND-0001', { design: good })).status).toBe(200);
    expect((await admin('PUT', '/api/admin/members/1/badges/FRIEND-0001', { design: { ...good, color: 'red' } })).status).toBe(400);
    expect((await admin('PUT', '/api/admin/members/1/badges/FRIEND-0001', { design: good, code: 'X' })).status).toBe(400);
    expect((await admin('PUT', '/api/admin/members/1/badges/NOPE', { design: good })).status).toBe(404);
    const pub = (await api.handle('GET', '/api/members')).body as { members: { id: number; badges: { design: BadgeDesign }[] }[] };
    expect(pub.members.find((m) => m.id === 1)!.badges[0]!.design).toEqual(good);
    // 好朋友：注册 → 改自己的徽章；不能改别人的
    await api.handle('POST', '/api/members/register', { name: 'Momo', email: 'friend2@example.com' });
    const code = ((await api.handle('POST', '/api/members/register', { name: 'Momo', email: 'friend2@example.com' })).body as { demoCode: string }).demoCode;
    const v = (await api.handle('POST', '/api/members/verify', { email: 'friend2@example.com', code })).body as { token: string };
    const auth = { authorization: `Bearer ${v.token}` };
    expect((await api.handle('PUT', '/api/members/me/badges/FRIEND-0002', { design: BADGE_PRESETS[1]!.design }, auth)).status).toBe(200);
    expect((await api.handle('PUT', '/api/members/me/badges/FRIEND-0001', { design: BADGE_PRESETS[1]!.design }, auth)).status).toBe(404);
    expect((await api.handle('PUT', '/api/members/me/badges/FRIEND-0002', { design: BADGE_PRESETS[1]!.design })).status).toBe(401);
    // 颁发时可以直接带设计
    expect((await admin('POST', '/api/admin/members/2/badges', { code: 'FRIEND-0003', label: '新', design: BADGE_PRESETS[3]!.design })).status).toBe(200);
    expect((await admin('POST', '/api/admin/members/2/badges', { code: 'FRIEND-0004', label: '新', design: { shape: 'star' } })).status).toBe(400);
  });
  it('文章系列字段 + 作品坐标粗化', async () => {
    const created = await admin('POST', '/api/admin/posts', { title: '系列测试', series: '夜色与城市', status: 'published' });
    expect((created.body as Post).series).toBe('夜色与城市');
    const upd = await admin('PATCH', `/api/admin/posts/${(created.body as Post).slug}`, { series: '' });
    expect((upd.body as Post).series).toBeNull();
    const works = createSeed('/TheBLOG/').works.map((w) => (w.id === 'hero-lake' ? { ...w, lat: '-41.28765' } : w));
    const r = await admin('PUT', '/api/admin/content/works', { items: works });
    expect(r.status).toBe(200);
    expect((r.body as { items: Work[] }).items.find((w) => w.id === 'hero-lake')!.lat).toBe('-41.3');
  });
});
