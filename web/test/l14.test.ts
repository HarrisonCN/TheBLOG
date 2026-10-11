// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  coarsen, exifLine, parseAudioBlock, parseMapBlock, parseNotesBlock, parseQuoteSource, safeAudioSrc, safeImageSrc, validateEssay, validateShotNote, wrapText,
} from '../src/essay-core';
import { renderMarkdown } from '../src/markdown';
import { renderSafe } from '../src/sanitize';

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
