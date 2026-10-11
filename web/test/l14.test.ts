// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  coarsen, exifLine, parseAudioBlock, parseMapBlock, parseNotesBlock, parseQuoteSource, safeAudioSrc, safeImageSrc, validateEssay, validateShotNote, wrapText,
} from '../src/essay-core';
import { renderMarkdown } from '../src/markdown';
import { renderSafe } from '../src/sanitize';
import { essaySection, postPage, postCard } from '../src/render';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type Post, type PostSummary, type SiteData } from '../src/types';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { createSeed, DEMO_PASSWORD } from '../src/demo/seed';
import { parseSearch, searchUrl } from '../src/openlibrary';
import { swipeDir } from '../src/essay-story';
import { clampPos, mapPinSvg } from '../src/embeds-client';
import { EMBED_TEMPLATES, essayEditorHtml, readPostMediaRaw } from '../src/admin-essay';
import { shelfStatusLabel, validateSection } from '../src/sections';
import { shelfPage } from '../src/sections-view';
import { beforeEach } from 'vitest';

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const photo = (o: Record<string, unknown> = {}) => ({ src: '/api/images/2026/09/0b1c2d3e-0000-4000-8000-000000000001.webp', alt: '漓江', caption: '雾里的山', ...o });

describe('essay-core：web 与 worker 两份完全相同', () => {
  it('essay-core.ts', () => expect(read('../src/essay-core.ts')).toBe(read('../../worker/src/essay-core.ts')));
});

describe('validateEssay', () => {
  it('null → 普通文章', () => expect(validateEssay(null)).toEqual({ essay: null, issues: [] }));
  it('规范化一张合法照片', () => {
    const r = validateEssay({ layout: 'diptych', photos: [photo({ exif: { camera: 'iPhone 15 Pro', focal: '26mm', aperture: 'f/1.8', shutter: '1/120s', iso: 64 }, notes: { place: '桂林 · 阳朔', light: '晨雾' } })] });
    expect(r.issues).toEqual([]);
    expect(r.essay!.layout).toBe('diptych');
    expect(r.essay!.photos[0]!.exif.iso).toBe('64');
    expect(r.essay!.photos[0]!.notes).toEqual({ place: '桂林 · 阳朔', light: '晨雾', gear: '', settings: '', thought: '' });
    expect(r.essay!.photos[0]!.width).toBe(0);
  });
  it('严格：多余字段、坏版式、坏 EXIF、不安全链接、坐标地点', () => {
    const r = validateEssay({ layout: 'carousel', extra: 1, photos: [photo({ src: 'javascript:alert(1)', gps: '1', exif: { iso: 'abc', focal: '26', lat: 1 }, notes: { place: '25.2734, 110.2900' } })] });
    const paths = r.issues.map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['extra', 'layout', 'photos.0.src', 'photos.0.gps', 'photos.0.exif.iso', 'photos.0.exif.focal', 'photos.0.exif.lat', 'photos.0.notes.place']));
  });
  it('至少 1 张、最多 40 张、尖括号', () => {
    expect(validateEssay({ layout: 'grid', photos: [] }).issues[0]!.path).toBe('photos');
    expect(validateEssay({ layout: 'grid', photos: Array.from({ length: 41 }, () => photo()) }).issues.some((i) => i.message.includes('40'))).toBe(true);
    expect(validateEssay({ photos: [photo({ caption: '<img src=x onerror=1>' })] }).issues[0]!.path).toBe('photos.0.caption');
  });
  it('data: 只允许位图', () => {
    expect(safeImageSrc('data:image/png;base64,AAAA')).toBeTruthy();
    expect(safeImageSrc('data:image/svg+xml;base64,AAAA')).toBeNull();
    expect(safeImageSrc('//evil.example/a.jpg')).toBeNull();
    expect(safeImageSrc('http://insecure.example/a.jpg')).toBeNull();
  });
});

describe('拍摄手记', () => {
  it('全空 → null', () => expect(validateShotNote({ place: '  ' }).note).toBeNull());
  it('度分秒也算坐标', () => expect(validateShotNote({ place: '25°16′N' }).issues).toHaveLength(1));
  it(':::notes 支持中文键', () => {
    const r = parseNotesBlock('地点：长沙 · 岳麓山\nlight: 逆光\n参数: f/1.8 1/250s ISO 50\n想法: 等云');
    expect(r.issues).toEqual([]);
    expect(r.note).toMatchObject({ place: '长沙 · 岳麓山', light: '逆光', settings: 'f/1.8 1/250s ISO 50', thought: '等云' });
  });
  it('未知键报错', () => expect(parseNotesBlock('gps: 1,2\nplace: 长沙').issues[0]!.path).toBe('gps'));
});

describe('嵌入块解析', () => {
  it('坐标粗化到 0.1°', () => {
    expect(coarsen('25.2734', 110.29)).toEqual({ lat: 25.3, lng: 110.3 });
    expect(coarsen(-0.04, 0)).toEqual({ lat: 0, lng: 0 });
    expect(coarsen(91, 0)).toBeNull();
  });
  it(':::map 地名必填，不能是坐标', () => {
    expect(parseMapBlock('桂林', '25.27, 110.29')).toEqual({ place: '桂林', lat: 25.3, lng: 110.3 });
    expect(parseMapBlock('25.27,110.29', '25.27, 110.29')).toBeNull();
    expect(parseMapBlock('桂林', 'nowhere')).toBeNull();
  });
  it(':::audio 只接受 https 或本站上传', () => {
    expect(parseAudioBlock('src: https://archive.org/download/x/a.mp3\ntitle: 夜')!.title).toBe('夜');
    expect(parseAudioBlock('src: http://x/a.mp3')).toBeNull();
    expect(parseAudioBlock('src: javascript:alert(1)')).toBeNull();
    expect(safeAudioSrc('/api/audio/2026/10/0b1c2d3e-0000-4000-8000-000000000001.mp3')).toBeTruthy();
    expect(safeAudioSrc('/api/audio/../../etc/passwd')).toBeNull();
  });
  it(':::quote 来源与链接', () => {
    expect(parseQuoteSource('王维《终南别业》 | https://zh.wikisource.org/wiki/x')).toEqual({ source: '王维《终南别业》', link: 'https://zh.wikisource.org/wiki/x' });
    expect(parseQuoteSource('某人 | javascript:alert(1)').link).toBe('');
  });
  it('exifLine', () => expect(exifLine({ camera: 'iPhone', focal: '26mm', aperture: 'f/1.8', shutter: '1/120', iso: '64' })).toBe('iPhone · 26mm · f/1.8 · 1/120s · ISO 64'));
  it('wrapText：CJK 逐字、拉丁整词、行数上限加省略号', () => {
    const m = (t: string) => t.length;
    expect(wrapText('行到水穷处坐看云起时', 5, m)).toEqual(['行到水穷处', '坐看云起时']);
    expect(wrapText('hello brave new world', 12, m)).toEqual(['hello brave', 'new world']);
    expect(wrapText('一二三四五六七八九十', 2, m, 2)).toEqual(['一二', '三…']);
  });
});

describe('Markdown ::: 块', () => {
  it('提示 / 注意 / 备注', () => {
    const h = renderMarkdown(':::tip 小技巧\n**先测光**再构图\n:::\n\n:::warn\n小心\n:::');
    expect(h).toContain('class="callout callout--tip"');
    expect(h).toContain('<p class="callout__t">小技巧</p>');
    expect(h).toContain('<strong>先测光</strong>');
    expect(h).toContain('<p class="callout__t">注意</p>');
  });
  it('折叠块可以嵌套提示', () => {
    const h = renderMarkdown(':::details 参数表\n:::note\n里面\n:::\n:::');
    expect(h).toMatch(/<details class="md-details"><summary>参数表<\/summary><div class="md-details__b"><div class="callout callout--note"/);
  });
  it('没有结束标记 → 普通文字', () => expect(renderMarkdown(':::tip\n没有结束')).not.toContain('callout'));
  it('对比块需要两张安全图片', () => {
    expect(renderMarkdown(':::compare 调色前后\n![原片](/a.jpg "原片")\n![调色](/b.jpg "调色")\n:::')).toContain('data-label-a="原片"');
    expect(renderMarkdown(':::compare\n![a](javascript:x)\n![b](/b.jpg)\n:::')).toContain('embed-error');
  });
  it('音频块不含 <audio>（不自动播放），交给播放器', () => {
    const h = renderMarkdown(':::audio\nsrc: https://archive.org/download/x/a.mp3\ntitle: 夜曲\nartist: 示例\ncredit: CC BY 4.0\nlink: https://archive.org/details/x\n:::');
    expect(h).toContain('data-src="https://archive.org/download/x/a.mp3"');
    expect(h).not.toContain('<audio');
    expect(h).not.toContain('autoplay');
  });
  it('地图块只输出粗化坐标', () => {
    const h = renderMarkdown(':::map 桂林\n25.27345, 110.29012\n:::');
    expect(h).toContain('data-lat="25.3" data-lng="110.3"');
    expect(h).not.toContain('25.27');
  });
  it('引用卡片与拍摄手记', () => {
    expect(renderMarkdown(':::quote 王维《终南别业》\n行到水穷处，坐看云起时。\n:::')).toMatch(/<figure class="quote-card" data-quote><blockquote class="quote-card__q"><p>行到水穷处，坐看云起时。<\/p>\n<\/blockquote><figcaption class="quote-card__src">— <cite>王维《终南别业》<\/cite><\/figcaption><\/figure>/);
    const n = renderMarkdown(':::notes 第三张\nplace: 桂林\nthought: 等风停\n:::');
    expect(n).toContain('<details class="shot-notes">');
    expect(n).toContain('<dt>想法</dt><dd>等风停</dd>');
  });
  it('块里的 HTML 仍被转义；DOMPurify 后结构保留', () => {
    // happy-dom 会把开头的第一个元素拆掉（真实浏览器没有这个问题），所以前面先放一段文字
    const h = renderSafe('开头\n\n:::tip <img src=x onerror=alert(1)>\n<script>x</script>\n:::\n\n:::details 开\nok\n:::\n\n:::map 长沙\n28.2, 112.9\n:::');
    expect(h).not.toMatch(/<img[^>]*onerror|<script/);
    expect(h).toContain('class="callout callout--tip"');
    expect(h).toContain('role="note"');
    expect(h).toContain('<details class="md-details">');
    expect(h).toContain('data-lat="28.2"');
  });
});

const P = (id: number, slug: string, o: Partial<PostSummary> = {}): PostSummary => ({ id, slug, title: slug, summary: '', tags: [], coverUrl: null, category: null, pinned: false, wordCount: 10, status: 'published', publishedAt: `2026-0${id}-15T12:00:00Z`, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...o });
const site = (posts: PostSummary[]): SiteData => ({ settings: DEFAULT_SETTINGS, profile: DEFAULT_PROFILE, posts, total: posts.length, tags: [], categories: [] });
const ESSAY = validateEssay({ layout: 'diptych', photos: [photo({ exif: { camera: 'Phone', iso: '50' }, notes: { place: '桂林' } }), photo({ caption: '第二张', credit: 'A · CC0' })] }).essay!;

describe('影集页面渲染', () => {
  it('essaySection：版式 class、编号、EXIF 条、署名、每张手记、故事模式按钮；不输出坐标', () => {
    const h = essaySection(ESSAY);
    expect(h).toContain('class="essay essay--diptych"');
    expect(h).toContain('data-essay');
    expect(h).toContain('js-essay-story');
    expect(h.match(/js-essay-open/g)).toHaveLength(2);
    expect(h).toContain('<span class="exif-strip__v">Phone · ISO 50</span>');
    expect(h).toContain('署名：A · CC0');
    expect(h).toContain('拍摄手记 · 第 1 张');
    expect(h).not.toMatch(/lat|lng|gps/i);
  });
  it('postPage：影集类型 → page--essay、无侧栏布局、文章级手记默认展开；普通文章不受影响', () => {
    const s = site([P(1, 'e', { kind: 'essay' })]);
    const pg = postPage(s, { ...P(1, 'e', { kind: 'essay' }), contentMd: '前言', essay: ESSAY, notes: { place: '漓江', light: '', gear: '', settings: '', thought: '等雾' } } as Post);
    expect(pg.kind).toContain('page--essay');
    expect(pg.main).toContain('post-layout--essay');
    expect(pg.main).toContain('<details class="shot-notes" open>');
    expect(pg.top).toContain('影集');
    const plain = postPage(s, { ...P(1, 'e'), contentMd: 'x' } as Post);
    expect(plain.kind).toBe('page--post');
    expect(plain.main).not.toContain('data-essay');
    // kind=essay 但没有照片 → 按普通文章渲染
    expect(postPage(s, { ...P(1, 'e', { kind: 'essay' }), contentMd: 'x', essay: null } as Post).main).not.toContain('data-essay');
  });
  it('文章卡片标出影集', () => expect(postCard(P(1, 'e', { kind: 'essay' }), 0)).toContain('影集'));
});

describe('演示 mock API 与 Worker 同一套影集规则', () => {
  let api: DemoBackend;
  let csrf = '';
  const admin = (m: string, p: string, b?: unknown) => api.handle(m, p, b, { 'x-csrf-token': csrf });
  beforeEach(async () => {
    api = new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date('2026-10-10T12:00:00Z') });
    csrf = ((await api.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as { csrfToken: string }).csrfToken;
  });
  it('创建 / 读取 / 列表只带 kind / 改回文章清空影集', async () => {
    const essay = { layout: 'grid', photos: [photo({ exif: { iso: '64' } })] };
    const r = await admin('POST', '/api/admin/posts', { title: 'E', slug: 'mock-essay', kind: 'essay', essay, notes: { place: '长沙' }, status: 'published' });
    expect(r.status).toBe(201);
    const full = (await api.handle('GET', '/api/posts/mock-essay')).body as Post;
    expect(full.essay!.photos[0]!.exif.iso).toBe('64');
    expect(full.notes!.place).toBe('长沙');
    const list = (await api.handle('GET', '/api/posts')).body as { posts: PostSummary[] };
    const s = list.posts.find((p) => p.slug === 'mock-essay') as unknown as Record<string, unknown>;
    expect(s.kind).toBe('essay');
    expect(s.essay).toBeUndefined();
    const up = (await admin('PATCH', '/api/admin/posts/mock-essay', { kind: 'post', notes: null })).body as Post;
    expect(up.essay).toBeNull();
    expect(up.notes).toBeNull();
  });
  it('同样的错误路径（与 worker/test/l14.test.ts 对应）', async () => {
    const r = await admin('POST', '/api/admin/posts', { title: '坏', kind: 'essay', essay: { layout: 'grid', photos: [{ src: 'javascript:alert(1)', gps: '25,110', exif: { iso: 'x' }, notes: { place: '25°16′N' } }] } });
    expect(r.status).toBe(400);
    const paths = ((r.body as any).error.details as { path: string }[]).map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['essay.photos.0.src', 'essay.photos.0.gps', 'essay.photos.0.exif.iso', 'essay.photos.0.notes.place']));
    expect((await admin('POST', '/api/admin/posts', { title: '空', kind: 'essay' })).status).toBe(400);
  });
  it('种子里的示例影集都能通过严格校验，并且明确标注为示例', () => {
    const seed = createSeed('/TheBLOG/');
    const essays = seed.posts.filter((p) => p.kind === 'essay');
    expect(essays.length).toBe(3);
    for (const p of essays) {
      expect(validateEssay(p.essay).issues).toEqual([]);
      expect(p.title).toMatch(/^示例/);
      expect(p.contentMd).toContain('示例影集');
      for (const ph of p.essay!.photos) expect(ph.credit).toMatch(/Wikimedia Commons/);
    }
    expect(new Set(essays.map((p) => p.essay!.layout))).toEqual(new Set(['single', 'diptych', 'grid']));
    const demo = seed.posts.find((p) => p.slug === 'demo-embeds')!;
    for (const k of ['tip', 'warn', 'note', 'details', 'compare', 'audio', 'map', 'quote', 'notes']) expect(demo.contentMd).toContain(`:::${k}`);
    expect(renderMarkdown(demo.contentMd)).not.toContain('embed-error');
  });
  it('书影音：cover / date 两边一致，javascript: 被拒', async () => {
    const ok = await admin('PUT', '/api/admin/content/shelf', { items: [{ kind: 'book', title: '明室', status: 'done', cover: 'https://covers.openlibrary.org/b/id/1-M.jpg', date: '2026-09' }] });
    expect(ok.status).toBe(200);
    expect(((await api.handle('GET', '/api/content/shelf')).body as any).items[0]).toMatchObject({ cover: 'https://covers.openlibrary.org/b/id/1-M.jpg', date: '2026-09' });
    expect((await admin('PUT', '/api/admin/content/shelf', { items: [{ kind: 'book', title: 'x', cover: 'javascript:alert(1)' }] })).status).toBe(400);
  });
});

describe('书影音页面', () => {
  it('按类型换动词、封面图、评分筛选、计数 live region', () => {
    expect(shelfStatusLabel('book', 'want')).toBe('想读');
    expect(shelfStatusLabel('movie', 'doing')).toBe('在看');
    expect(shelfStatusLabel('music', 'done')).toBe('听过');
    const items = validateSection('shelf', [{ kind: 'book', title: '明室', status: 'done', rating: 5, cover: '/demo/photos/cover.webp' }, { kind: 'movie', title: '花样年华', status: 'want' }]).items;
    const h = shelfPage(site([]), items).main;
    expect(h).toContain('js-shelf-rating');
    expect(h).toContain('aria-live="polite"');
    expect(h).toContain('alt="《明室》封面"');
    expect(h).toContain('>读过<');
    expect(h).toContain('>想看<');
    expect(h).toContain('data-rating="5"');
  });
});

describe('后台 l14 编辑器', () => {
  it('嵌入块模板都能渲染（除了需要填写的占位）', () => {
    for (const [k, t] of Object.entries(EMBED_TEMPLATES)) {
      const h = renderMarkdown(t.md);
      if (['compare', 'audio', 'map', 'notes'].includes(k)) expect(h).toContain('embed-error');
      else expect(h, k).not.toContain('embed-error');
    }
  });
  it('表单 → { kind, essay, notes }', () => {
    const p = { ...P(1, 'e', { kind: 'essay' }), contentMd: '', essay: ESSAY, notes: null } as Post;
    document.body.innerHTML = `<form id="f">${essayEditorHtml(p)}</form>`;
    const form = document.getElementById('f')!;
    // happy-dom 对 <option selected> 的处理有 bug（会选中第二项），真实浏览器正常：这里先断言 HTML，再手动设值
    expect(form.innerHTML).toContain('<option value="diptych" selected="">');
    form.querySelector<HTMLSelectElement>('#f-layout')!.value = 'diptych';
    const m = readPostMediaRaw(form);
    expect(m.kind).toBe('essay');
    expect(m.essay!.layout).toBe('diptych');
    expect(m.essay!.photos).toHaveLength(2);
    expect(m.essay!.photos[0]!.exif.camera).toBe('Phone');
    expect(m.essay!.photos[0]!.notes!.place).toBe('桂林');
    expect(validateEssay(m.essay).issues).toEqual([]);
    expect(m.notes).toBeNull();
  });
});

describe('客户端小工具', () => {
  it('Open Library：URL 与结果清洗', () => {
    expect(searchUrl('明室', 'Barthes')).toBe('https://openlibrary.org/search.json?title=%E6%98%8E%E5%AE%A4&limit=6&fields=key%2Ctitle%2Cauthor_name%2Cfirst_publish_year%2Ccover_i&author=Barthes');
    const hits = parseSearch({ docs: [{ key: '/works/OL1375083W', title: 'Camera Lucida', author_name: ['Roland Barthes'], first_publish_year: 1981, cover_i: 4379322 }, { title: '<b>x</b>' }, { title: 'No cover', cover_i: -1, key: 'javascript:1' }] });
    expect(hits).toEqual([
      { key: '/works/OL1375083W', title: 'Camera Lucida', creator: 'Roland Barthes', year: '1981', cover: 'https://covers.openlibrary.org/b/id/4379322-M.jpg' },
      { key: '', title: 'No cover', creator: '', year: '', cover: '' },
    ]);
    expect(parseSearch(null)).toEqual([]);
  });
  it('故事模式滑动方向；对比滑块取值；地图 SVG 只用粗化坐标', () => {
    expect(swipeDir(-80, 5)).toBe(1);
    expect(swipeDir(80, 5)).toBe(-1);
    expect(swipeDir(30, 0)).toBe(0);
    expect(swipeDir(-60, 90)).toBe(0);
    expect(clampPos(120)).toBe(100);
    expect(clampPos(NaN)).toBe(50);
    const svg = mapPinSvg(25.3, 110.3, '桂林<script>');
    expect(svg).toContain('cx="290.3"');
    expect(svg).not.toContain('<script>');
  });
});
