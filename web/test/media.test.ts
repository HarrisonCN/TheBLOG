/**
 * L34 / v1.34.0 视频与声音作品：
 * - media-core（web = worker 同一份）：WebVTT 解析 / 生成（时间戳、多行、标签、NOTE、转义）、时间格式、?t= 深链参数、
 *   作品校验（视频必须有字幕和封面替代文字，声音必须有文字稿；章节从 0 开始递增且在时长内；来源 MIME 白名单、地址安全）、
 *   当前字幕 / 章节查找（二分）、文字稿搜索、摘要与排序；
 * - 演示 mock 与 Worker 同形状：GET /api/av、/api/av/:slug（只给已发布）、/api/av/:slug/captions.vtt、站长 PUT / DELETE /api/admin/av/:slug；
 * - 新路由 /av/（摄影 › 视频与声音）与 /av/:slug/，预渲染内容有播放器、章节链接（?t=）和完整文字稿（没有 JS 也能读）。
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_CUES, activeCue, avSummary, chapterAt, formatClock, parseStart, parseVtt, searchCues, sortAvWorks, toVtt, validateAvWork, type AvWork,
} from '../src/media-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';

const cues = () => [
  { start: 0, end: 3.5, text: '清晨的港口，船还没有出海。' },
  { start: 3.5, end: 8, text: '灯一盏一盏熄灭。' },
  { start: 8, end: 12, text: '海鸥落在防波堤上。' },
];
const video = (): AvWork => ({
  slug: 'test-video',
  kind: 'video',
  title: '测试视频',
  summary: '一段测试用的短片。',
  date: '2026-10-12',
  status: 'published',
  duration: 12,
  width: 640,
  height: 360,
  poster: { src: '/demo/av/poster.webp', alt: '海港夜景', w: 640, h: 360 },
  sources: [
    { src: '/demo/av/clip.webm', type: 'video/webm' },
    { src: '/demo/av/clip.mp4', type: 'video/mp4' },
  ],
  chapters: [
    { t: 0, title: '开场' },
    { t: 3.5, title: '熄灯' },
    { t: 8, title: '海鸥' },
  ],
  cues: cues(),
});
const audio = (): AvWork => ({
  slug: 'test-audio',
  kind: 'audio',
  title: '测试声音',
  summary: '海浪声。',
  date: '2026-10-10',
  status: 'published',
  duration: 20,
  sources: [{ src: '/demo/av/waves.mp3', type: 'audio/mpeg' }],
  chapters: [{ t: 0, title: '开始' }],
  cues: [{ start: 0, end: 20, text: '（海浪声）' }],
});

describe('WebVTT', () => {
  it('解析：头、标识、hh:mm:ss.ttt 与 mm:ss.ttt、多行、语音标签、NOTE 块', () => {
    const vtt = 'WEBVTT - 测试\n\nNOTE 这是注释\n会跨行\n\n1\n00:00:01.000 --> 00:00:04.250 align:start\n<v 旁白>第一句</v>\n第二行\n\n01:02.5 --> 01:05.000\n&lt;尖括号&gt; &amp; 符号\n';
    const r = parseVtt(vtt);
    expect(r.errors).toEqual([]);
    expect(r.cues).toEqual([
      { start: 1, end: 4.25, text: '第一句\n第二行' },
      { start: 62.5, end: 65, text: '<尖括号> & 符号' },
    ]);
  });
  it('不是 WEBVTT、时间倒挂、时间戳非法 → 报错', () => {
    expect(parseVtt('hello\n\n00:01.000 --> 00:02.000\nx').errors.length).toBeGreaterThan(0);
    expect(parseVtt('WEBVTT\n\n00:05.000 --> 00:02.000\nx').errors[0]).toMatch(/结束/);
    expect(parseVtt('WEBVTT\n\n0:5 --> 00:02.000\nx').errors.length).toBeGreaterThan(0);
  });
  it('生成后再解析不变（含需要转义的字符）', () => {
    const c = [...cues(), { start: 3725.125, end: 3726, text: 'a --> b & <c>\n第二行' }];
    const out = toVtt(c);
    expect(out.startsWith('WEBVTT\n')).toBe(true);
    expect(out).toContain('01:02:05.125 --> 01:02:06.000');
    expect(parseVtt(out)).toEqual({ cues: c, errors: [] });
  });
});

describe('时间', () => {
  it('formatClock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65.9)).toBe('1:05');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(-3)).toBe('0:00');
  });
  it.each([
    ['90', 90], ['1:30', 90], ['1m30s', 90], ['1h2m3s', 3723], ['01:02:03', 3723], ['45s', 45], ['12.5', 12.5],
  ])('parseStart(%s) = %s', (s, v) => {
    expect(parseStart(s, 4000)).toBe(v);
  });
  it.each([[null], [''], ['abc'], ['-5'], ['1:75'], ['javascript:1']])('parseStart(%s) = null', (s) => {
    expect(parseStart(s as string | null, 4000)).toBeNull();
  });
  it('parseStart 超过时长时取时长', () => {
    expect(parseStart('999', 12)).toBe(12);
  });
  it('activeCue / chapterAt（二分，空隙返回 -1）', () => {
    const c = [{ start: 0, end: 2, text: 'a' }, { start: 5, end: 7, text: 'b' }, { start: 7, end: 9, text: 'c' }];
    expect(activeCue(c, 0)).toBe(0);
    expect(activeCue(c, 3)).toBe(-1);
    expect(activeCue(c, 7)).toBe(2);
    expect(activeCue(c, 9.5)).toBe(-1);
    expect(activeCue([], 1)).toBe(-1);
    const ch = video().chapters;
    expect(chapterAt(ch, 0)).toBe(0);
    expect(chapterAt(ch, 5)).toBe(1);
    expect(chapterAt(ch, 11.9)).toBe(2);
  });
  it('searchCues：忽略大小写与空白，返回命中的字幕序号', () => {
    expect(searchCues(cues(), '海鸥')).toEqual([2]);
    expect(searchCues(cues(), ' 灯 ')).toEqual([1]);
    expect(searchCues([{ start: 0, end: 1, text: 'Harbour Lights' }], 'harbour')).toEqual([0]);
    expect(searchCues(cues(), '')).toEqual([]);
  });
});

describe('作品校验', () => {
  it('合法视频 / 声音通过', () => {
    expect(validateAvWork(video()).issues).toEqual([]);
    expect(validateAvWork(audio()).issues).toEqual([]);
    expect(validateAvWork(video()).work?.cues).toHaveLength(3);
  });
  it.each([
    ['slug 非法', (w: any) => { w.slug = 'Bad Slug'; }, 'slug'],
    ['类型未知', (w: any) => { w.kind = 'gif'; }, 'kind'],
    ['日期格式', (w: any) => { w.date = '2026/10/12'; }, 'date'],
    ['时长不是正数', (w: any) => { w.duration = 0; }, 'duration'],
    ['视频没有字幕（无障碍）', (w: any) => { w.cues = []; }, 'cues'],
    ['视频封面缺替代文字', (w: any) => { w.poster.alt = ''; }, 'poster.alt'],
    ['视频缺封面', (w: any) => { delete w.poster; }, 'poster'],
    ['来源 MIME 不在白名单', (w: any) => { w.sources[0].type = 'video/x-flv'; }, 'sources.0.type'],
    ['来源地址不安全', (w: any) => { w.sources[1].src = 'javascript:alert(1)'; }, 'sources.1.src'],
    ['视频用了声音 MIME', (w: any) => { w.sources[0].type = 'audio/mpeg'; }, 'sources.0.type'],
    ['没有来源', (w: any) => { w.sources = []; }, 'sources'],
    ['字幕时间倒挂', (w: any) => { w.cues[1].end = 1; }, 'cues.1'],
    ['字幕超出时长', (w: any) => { w.cues[2].end = 30; }, 'cues.2'],
    ['字幕没按时间排序', (w: any) => { w.cues.reverse(); }, 'cues'],
    ['字幕文字为空', (w: any) => { w.cues[0].text = ' '; }, 'cues.0.text'],
    ['章节不从 0 开始', (w: any) => { w.chapters[0].t = 1; }, 'chapters.0.t'],
    ['章节不递增', (w: any) => { w.chapters[2].t = 2; }, 'chapters.2.t'],
    ['章节超出时长', (w: any) => { w.chapters[2].t = 99; }, 'chapters.2.t'],
    ['章节标题为空', (w: any) => { w.chapters[1].title = ''; }, 'chapters.1.title'],
    ['状态未知', (w: any) => { w.status = 'live'; }, 'status'],
  ])('%s → 报错 %s', (_n, mut, path) => {
    const w = structuredClone(video());
    mut(w);
    const r = validateAvWork(w);
    expect(r.work).toBeNull();
    expect(r.issues.map((x) => x.path)).toContain(path);
  });
  it('声音没有文字稿 → 报错 cues；声音用了视频 MIME → 报错', () => {
    const a = audio();
    a.cues = [];
    expect(validateAvWork(a).issues.map((x) => x.path)).toContain('cues');
    const b = audio();
    b.sources[0]!.type = 'video/mp4';
    expect(validateAvWork(b).issues.map((x) => x.path)).toContain('sources.0.type');
  });
  it('字幕条数上限', () => {
    const w = video();
    w.duration = MAX_CUES + 10;
    w.cues = Array.from({ length: MAX_CUES + 1 }, (_, i) => ({ start: i, end: i + 1, text: `第 ${i} 句` }));
    expect(validateAvWork(w).issues.map((x) => x.path)).toContain('cues');
  });
  it('摘要与排序（日期倒序，同日按 slug）', () => {
    const s = avSummary(video());
    expect(s).toMatchObject({ slug: 'test-video', kind: 'video', duration: 12, chapters: 3, cues: 3, poster: { alt: '海港夜景' } });
    expect((s as any).sources).toBeUndefined();
    const l = [{ ...avSummary(audio()), slug: 'b' }, { ...avSummary(video()), slug: 'a' }, { ...avSummary(audio()), slug: 'a2' }];
    expect(sortAvWorks(l).map((x) => x.slug)).toEqual(['a', 'a2', 'b']);
  });
});

describe('演示 mock：/api/av', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 9, 16, 12)) });
  it('列表只有已发布的示例作品（标着示例，视频和声音都有），详情可通过校验，字幕 VTT 可解析', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/av')).body as { works: { slug: string; title: string; kind: string }[] };
    expect(l.works.length).toBeGreaterThanOrEqual(2);
    expect(l.works.every((x) => x.title.includes('示例'))).toBe(true);
    expect(new Set(l.works.map((x) => x.kind))).toEqual(new Set(['video', 'audio']));
    for (const s of l.works) {
      const d = (await b.handle('GET', `/api/av/${s.slug}`)).body as { work: AvWork };
      expect(validateAvWork(d.work).issues).toEqual([]);
      expect(d.work.sources.every((x) => x.src.startsWith('/TheBLOG/demo/av/'))).toBe(true);
      const v = await b.handle('GET', `/api/av/${s.slug}/captions.vtt`);
      expect(v.status).toBe(200);
      expect(parseVtt(String(v.body)).cues).toEqual(d.work.cues);
    }
    expect((await b.handle('GET', '/api/av/nope')).status).toBe(404);
  });
  it('站长 PUT（草稿不公开 → 发布后公开）→ DELETE；非站长 401；非法 400；地址不一致 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/av/test-video', video())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/av/test-video', { ...video(), status: 'draft' }, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/av/test-video')).status).toBe(404);
    expect(((await b.handle('GET', '/api/admin/av', undefined, adm)).body as any).works.some((x: any) => x.slug === 'test-video' && x.status === 'draft')).toBe(true);
    expect((await b.handle('PUT', '/api/admin/av/test-video', video(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/av/test-video')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/av/test-video', { ...video(), cues: [] }, adm)).status).toBe(400);
    expect((await b.handle('PUT', '/api/admin/av/other', video(), adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/av/test-video', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/av/test-video')).status).toBe(404);
  });
});

describe('路由与页面', () => {
  const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
  it('路由往返；摄影 › 视频与声音', () => {
    expect(parseRoute('/av/')).toEqual({ name: 'avlist' });
    expect(parseRoute('/av/harbour-night/')).toEqual({ name: 'av', slug: 'harbour-night' });
    expect(parseRoute('/av/Bad Slug/').name).toBe('notfound');
    expect(routePath({ name: 'av', slug: 'x1' } as never)).toBe('/av/x1/');
    expect(sectionOf('avlist' as never)?.id).toBe('photo');
    expect(sectionOf('av' as never)?.id).toBe('photo');
    expect(findEntry('photo', 'av' as never)?.href).toBe('/av/');
  });
  it('视频页：<video> 带封面与全部来源、章节 ?t= 链接、完整文字稿（时间码链接），不自动播放', () => {
    const w = validateAvWork(video()).work!;
    const p = renderRoute({ name: 'av', slug: 'test-video' } as never, site, { avWork: w } as never);
    expect(p.title).toMatch(/测试视频/);
    expect(p.main).toMatch(/<video\b[^>]*\bcontrols\b/);
    expect(p.main).not.toMatch(/\bautoplay\b/);
    expect(p.main).toContain('poster="/demo/av/poster.webp"');
    expect(p.main).toContain('<source src="/demo/av/clip.webm" type="video/webm">');
    expect(p.main).toContain('<source src="/demo/av/clip.mp4" type="video/mp4">');
    expect(p.main).toContain('href="?t=3.5"');
    expect(p.main).toContain('data-seek="8"');
    for (const c of w.cues) expect(p.main).toContain(c.text);
    expect(p.main).toMatch(/文字稿/);
    expect(p.main).toContain('0:08');
  });
  it('声音页：<audio>、文字稿；列表页分视频 / 声音，显示时长', () => {
    const p = renderRoute({ name: 'av', slug: 'test-audio' } as never, site, { avWork: validateAvWork(audio()).work! } as never);
    expect(p.main).toMatch(/<audio\b[^>]*\bcontrols\b/);
    expect(p.main).toContain('（海浪声）');
    const l = renderRoute({ name: 'avlist' } as never, site, { avWorks: [avSummary(video()), avSummary(audio())] } as never);
    expect(l.main).toContain('/av/test-video/');
    expect(l.main).toContain('/av/test-audio/');
    expect(l.main).toContain('0:12');
    expect(l.main).toMatch(/视频/);
    expect(l.main).toMatch(/声音/);
  });
});
