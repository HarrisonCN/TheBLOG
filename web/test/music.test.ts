// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkAudioUpload, dequeue, enqueue, EMPTY_QUEUE, formatTime, isHttpsUrl, MAX_AUDIO_BYTES, parseQueue, playlistToTrack, sanitizeTrack, serializeQueue, sniffAudioType, stepIndex,
  validatePlaylist, validatePlaylistItem, type QueueState, type Track,
} from '../src/music-core';
import {
  archiveSearchUrl, ccLabelFromUrl, cleanQuery, itunesUrl, licenseLabel, mergeResults, openverseUrl, parseArchiveItem, parseArchiveSearch, parseItunes, parseLength, parseOpenverse, searchFull,
  searchPreview,
} from '../src/music-search';
import { claimMedia, onMediaClaim } from '../src/media-bus';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

const OV = {
  result_count: 4,
  results: [
    { id: 'a1', title: 'Old Movie Ragtime Piano', url: 'https://prod-1.storage.jamendo.com/?trackid=923463&format=mp32', creator: 'Akashic Records', license: 'by-nc-nd', license_version: '3.0', license_url: 'https://creativecommons.org/licenses/by-nc-nd/3.0/', foreign_landing_url: 'https://www.jamendo.com/track/923463', source: 'jamendo', provider: 'jamendo', duration: 72000, mature: false, thumbnail: 'https://api.openverse.org/v1/audio/a1/thumb/', audio_set: { title: 'Silent Movie' } },
    { id: 'a2', title: 'Too short', url: 'https://cdn.freesound.org/x.mp3', creator: 'x', license: 'cc0', duration: 4000, source: 'freesound' },
    { id: 'a3', title: 'http only', url: 'http://insecure.example.com/a.mp3', creator: 'x', license: 'by', duration: 90000, source: 'jamendo' },
    { id: 'a4', title: 'Mature', url: 'https://ok.example.com/a.mp3', creator: 'x', license: 'by', duration: 90000, mature: true },
    { id: 'a5', title: 'No duration', url: 'https://ok.example.com/b.mp3', creator: 'x', license: 'by', duration: null },
    { id: 'a6', title: 'Public domain', url: 'https://upload.wikimedia.org/a.ogg', creator: 'Anon', license: 'pdm', duration: 125000, source: 'wikimedia_audio' },
  ],
};
const IA_SEARCH = { response: { docs: [{ identifier: 'NS050', title: 'Another Day', creator: 'No-Source Netlabel', licenseurl: 'http://creativecommons.org/licenses/by-nc-sa/4.0/' }, { identifier: 'bad id!', title: 'x', licenseurl: 'http://creativecommons.org/licenses/by/4.0/' }, { identifier: 'nolicense', title: 'x' }] } };
const IA_META = {
  metadata: { identifier: 'NS050', title: 'Another Day, Another Way', creator: 'No-Source Netlabel', licenseurl: 'http://creativecommons.org/licenses/by-nc-sa/4.0/' },
  files: [
    { name: 'cover.jpg', format: 'JPEG' },
    { name: '03-NS050-Cocolixe_Swing-Low.mp3', format: 'VBR MP3', length: '200.43', title: 'Swing Low', creator: 'Cocolixe' },
    { name: 'short.mp3', format: 'VBR MP3', length: '12.0', title: 'Short' },
    { name: 'disc 2/04 The Light.mp3', format: 'VBR MP3', length: '3:03' },
    { name: '05.flac', format: 'Flac', length: '181' },
  ],
};
const IT = { resultCount: 2, results: [{ kind: 'song', trackId: 1469577741, trackName: 'Upside Down', artistName: 'Jack Johnson', collectionName: 'Curious George', previewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/x.m4a', artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/a/100x100bb.jpg', trackViewUrl: 'https://music.apple.com/us/album/upside-down/1469577723?i=1469577741' }, { kind: 'music-video', trackId: 2, trackName: 'v', previewUrl: 'https://x.apple.com/v.m4v' }] };

const good = { id: 'swing-low', title: 'Swing Low', artist: 'Cocolixe', album: 'Another Day', src: 'https://archive.org/download/NS050/03.mp3', cover: '', duration: 200, license: 'CC BY-NC-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/', link: 'https://archive.org/details/NS050' };

describe('music-core：web 与 worker 两份完全相同', () => {
  it('music-core.ts', () => expect(read('../src/music-core.ts')).toBe(read('../../worker/src/music-core.ts')));
});

describe('isHttpsUrl', () => {
  it('只收严格的 https 链接', () => {
    expect(isHttpsUrl('https://archive.org/download/a/b.mp3')).toBe(true);
    for (const bad of ['http://a.com/x.mp3', 'javascript:alert(1)', 'data:audio/mpeg;base64,AAAA', 'https://user:pw@a.com/x', 'https://localhost/x', 'https://a.com/x y', 'https://a.com/"x', ' https://a.com/x', 'https://a.com/<x>', 'ftp://a.com/x', '//a.com/x', 'https://' + 'a'.repeat(600) + '.com', '', 1, null])
      expect(isHttpsUrl(bad), String(bad)).toBe(false);
  });
});

describe('站长歌单校验（validatePlaylist）', () => {
  it('合法条目通过，字符串时长可转为整数', () => {
    const r = validatePlaylist([good, { ...good, id: 'two', duration: '95', src: '/api/audio/2026/10/0b1f6a52-1c1d-4c55-9b87-1e0d7d1b7a11.mp3', cover: '/api/images/2026/10/0b1f6a52-1c1d-4c55-9b87-1e0d7d1b7a11.jpg' }]);
    expect(r.issues).toEqual([]);
    expect(r.items).toHaveLength(2);
    expect(r.items[1]!.duration).toBe(95);
  });
  it('拒绝 http / javascript / data / 多余字段 / 超长 / 重复 id / 非数组', () => {
    const bad = (patch: Record<string, unknown>) => validatePlaylistItem({ ...good, ...patch }).issues.map((i) => i.path.split('.').at(-1));
    expect(bad({ src: 'http://a.com/x.mp3' })).toContain('src');
    expect(bad({ src: 'javascript:alert(1)' })).toContain('src');
    expect(bad({ src: 'data:audio/mpeg;base64,AAAA' })).toContain('src');
    expect(bad({ src: '/api/audio/../../etc/passwd' })).toContain('src');
    expect(bad({ cover: 'http://a.com/x.jpg' })).toContain('cover');
    expect(bad({ link: 'javascript:1' })).toContain('link');
    expect(bad({ licenseUrl: 'http://creativecommons.org/' })).toContain('licenseUrl');
    expect(bad({ title: '' })).toContain('title');
    expect(bad({ title: 'x'.repeat(81) })).toContain('title');
    expect(bad({ artist: '<script>' })).toContain('artist');
    expect(bad({ id: 'Bad Id' })).toContain('id');
    expect(bad({ duration: -1 })).toContain('duration');
    expect(bad({ duration: 1.5 })).toContain('duration');
    expect(bad({ onerror: 'x' })).toContain('onerror');
    expect(validatePlaylist([good, good]).issues.some((i) => /重复/.test(i.message))).toBe(true);
    expect(validatePlaylist(Array.from({ length: 101 }, (_, i) => ({ ...good, id: `t${i}` }))).issues[0]!.message).toMatch(/最多 100/);
    expect(validatePlaylist({}).issues[0]!.path).toBe('items');
    expect(validatePlaylist([good, { ...good, id: 'x', src: 'http://a' }]).items).toEqual([]);
  });
  it('playlistToTrack', () => expect(playlistToTrack(good as never)).toMatchObject({ id: 'site-swing-low', source: 'site', preview: false, provider: '本站' }));
});

describe('访客队列', () => {
  const t = (id: string, extra: Partial<Track> = {}): Track => ({ id, title: id, artist: 'a', album: '', src: `https://x.example.com/${id}.mp3`, cover: '', duration: 60, source: 'openverse', preview: false, license: 'CC BY 4.0', licenseUrl: '', link: '', provider: 'Jamendo', ...extra });
  it('sanitizeTrack 丢掉不安全的条目，iTunes 永远是试听', () => {
    expect(sanitizeTrack(t('a'))).toMatchObject({ id: 'a' });
    expect(sanitizeTrack(t('b', { src: 'javascript:alert(1)' }))).toBeNull();
    expect(sanitizeTrack(t('c', { source: 'evil' as never }))).toBeNull();
    expect(sanitizeTrack(t('d', { source: 'openverse', src: '/api/audio/2026/10/0b1f6a52-1c1d-4c55-9b87-1e0d7d1b7a11.mp3' }))).toBeNull();
    expect(sanitizeTrack(t('e', { source: 'site', src: '/api/audio/2026/10/0b1f6a52-1c1d-4c55-9b87-1e0d7d1b7a11.mp3' }))).not.toBeNull();
    expect(sanitizeTrack(t('f', { source: 'itunes', preview: false }))!.preview).toBe(true);
    expect(sanitizeTrack(t('g', { link: 'javascript:1', cover: 'http://x.com/a.jpg' }))).toMatchObject({ link: '', cover: '' });
  });
  it('parseQueue / serializeQueue 往返，坏数据回到空队列', () => {
    const q: QueueState = { tracks: [t('a'), t('b')], index: 1, volume: 0.5, muted: true };
    expect(parseQueue(serializeQueue(q))).toEqual(q);
    expect(parseQueue('{bad')).toEqual(EMPTY_QUEUE);
    expect(parseQueue(null).tracks).toEqual([]);
    expect(parseQueue(JSON.stringify({ tracks: [t('a'), { ...t('x'), src: 'javascript:1' }, t('a')], index: 9, volume: 7 }))).toMatchObject({ index: 0, volume: 1, tracks: [{ id: 'a' }] });
  });
  it('enqueue 不重复，dequeue 调整位置，stepIndex 循环', () => {
    let q: QueueState = { ...EMPTY_QUEUE, tracks: [] };
    q = enqueue(q, t('a')).queue;
    const r = enqueue(q, t('b'));
    expect(r.index).toBe(1);
    expect(enqueue(r.queue, t('a')).index).toBe(0);
    q = { ...r.queue, index: 1 };
    expect(dequeue(q, 0).index).toBe(0);
    expect(dequeue(dequeue(q, 0), 0)).toMatchObject({ index: -1, tracks: [] });
    expect([stepIndex(3, 2, 1), stepIndex(3, 0, -1), stepIndex(0, 0, 1)]).toEqual([0, 2, -1]);
  });
  it('formatTime', () => expect([formatTime(0), formatTime(65.9), formatTime(3725), formatTime(NaN)]).toEqual(['0:00', '1:05', '1:02:05', '0:00']));
});

describe('音频上传检查', () => {
  const mp3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const wav = new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WAVEfmt '].map((c) => c.charCodeAt(0))));
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  it('按文件头识别', () => {
    expect(sniffAudioType(mp3)).toBe('audio/mpeg');
    expect(sniffAudioType(wav)).toBe('audio/wav');
    expect(sniffAudioType(new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('audio/mpeg');
    expect(sniffAudioType(new Uint8Array([0xff, 0xf1, 0x50, 0x80, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull(); // AAC ADTS 不算 MP3
    expect(sniffAudioType(new TextEncoder().encode('OggS\0\x02xxxxxxxx'))).toBe('audio/ogg');
    expect(sniffAudioType(png)).toBeNull();
  });
  it('类型 / 大小 / 伪装', () => {
    expect(checkAudioUpload(mp3, 'audio/mpeg')).toMatchObject({ ok: true, type: 'audio/mpeg', ext: 'mp3' });
    expect(checkAudioUpload(mp3, 'audio/mp3')).toMatchObject({ ok: true });
    expect(checkAudioUpload(mp3, '')).toMatchObject({ ok: true });
    expect(checkAudioUpload(wav, 'audio/x-wav')).toMatchObject({ ok: true, ext: 'wav' });
    expect(checkAudioUpload(png, 'audio/mpeg')).toMatchObject({ ok: false, status: 415 });
    expect(checkAudioUpload(mp3, 'image/png')).toMatchObject({ ok: false, status: 415 });
    expect(checkAudioUpload(mp3, 'text/html')).toMatchObject({ ok: false, status: 415 });
    expect(checkAudioUpload(new Uint8Array(0), 'audio/mpeg')).toMatchObject({ ok: false, status: 400 });
    const big = new Uint8Array(MAX_AUDIO_BYTES + 1);
    big.set(mp3);
    expect(checkAudioUpload(big, 'audio/mpeg')).toMatchObject({ ok: false, status: 413 });
  });
});

describe('音乐搜索：接口地址与解析', () => {
  it('查询地址', () => {
    expect(openverseUrl(' lo  fi ')).toBe('https://api.openverse.org/v1/audio/?q=lo+fi&category=music&mature=false&page_size=12');
    const ia = new URL(archiveSearchUrl('piano") OR (x:*')).searchParams.get('q')!;
    expect(ia).toContain('(piano or x) AND mediatype:audio AND collection:(netlabels OR opensource_audio OR audio_music) AND licenseurl:*');
    expect(ia).not.toContain('x:*)');
    expect(itunesUrl('jack johnson')).toBe('https://itunes.apple.com/search?term=jack+johnson&entity=song&media=music&limit=12');
    expect(cleanQuery('a\u0000b' + 'x'.repeat(200)).length).toBe(80);
  });
  it('许可证标签', () => {
    expect([licenseLabel('by', '4.0'), licenseLabel('cc0'), licenseLabel('pdm'), licenseLabel('by-nc-nd', '3.0')]).toEqual(['CC BY 4.0', 'CC0 1.0', '公有领域 (PDM)', 'CC BY-NC-ND 3.0']);
    expect(ccLabelFromUrl('http://creativecommons.org/licenses/by-nc-sa/4.0/')).toBe('CC BY-NC-SA 4.0');
    expect(ccLabelFromUrl('http://creativecommons.org/publicdomain/zero/1.0/')).toBe('CC0 1.0');
    expect(ccLabelFromUrl('https://example.com/license')).toBe('');
  });
  it('Openverse：只留 https、30 秒–20 分钟、非成人、有许可证的曲目', () => {
    const r = parseOpenverse(OV);
    expect(r.map((x) => x.id)).toEqual(['ov-a1', 'ov-a6']);
    expect(r[0]).toMatchObject({ title: 'Old Movie Ragtime Piano', artist: 'Akashic Records', album: 'Silent Movie', duration: 72, source: 'openverse', preview: false, license: 'CC BY-NC-ND 3.0', link: 'https://www.jamendo.com/track/923463', provider: 'Jamendo' });
    expect(r[1]).toMatchObject({ license: '公有领域 (PDM)', provider: 'Wikimedia' });
    expect(parseOpenverse(null)).toEqual([]);
  });
  it('Internet Archive：搜索结果 + 条目文件 → mp3 曲目（含子目录名编码、署名链接）', () => {
    expect(parseArchiveSearch(IA_SEARCH).map((d) => d.identifier)).toEqual(['NS050']);
    const r = parseArchiveItem(IA_META, 3);
    expect(r.map((x) => x.title)).toEqual(['Swing Low', '04 The Light']);
    expect(r[0]).toMatchObject({ artist: 'Cocolixe', album: 'Another Day, Another Way', src: 'https://archive.org/download/NS050/03-NS050-Cocolixe_Swing-Low.mp3', cover: 'https://archive.org/services/img/NS050', license: 'CC BY-NC-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/', link: 'https://archive.org/details/NS050', provider: 'Internet Archive', duration: 200 });
    expect(r[1]).toMatchObject({ src: 'https://archive.org/download/NS050/disc%202/04%20The%20Light.mp3', artist: 'No-Source Netlabel', duration: 183 });
    expect(parseArchiveItem({ ...IA_META, metadata: { ...IA_META.metadata, licenseurl: '' } })).toEqual([]);
    expect([parseLength('240.9'), parseLength('3:20'), parseLength('1:02:03'), parseLength('x')]).toEqual([240.9, 200, 3723, 0]);
  });
  it('iTunes：只要歌曲，30 秒试听，封面放大，附 Apple Music 链接', () => {
    const r = parseItunes(IT);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 'it-1469577741', preview: true, duration: 30, source: 'itunes', license: '30秒试听', provider: 'Apple Music', cover: 'https://is1-ssl.mzstatic.com/image/thumb/a/300x300bb.jpg' });
  });
  it('合并：交替排列 + 按标题艺人去重', () => {
    const mk = (id: string, title: string, artist = 'a') => ({ id, title, artist }) as Track;
    expect(mergeResults([[mk('1', 'A'), mk('2', 'B')], [mk('3', 'a!'), mk('4', 'C')]]).map((x) => x.id)).toEqual(['1', '2', '4']);
  });
  it('searchFull：两路并行，一路失败只标记该来源；searchPreview', async () => {
    const f = vi.fn(async (u: string) => {
      if (u.startsWith('https://api.openverse.org/')) return new Response(JSON.stringify(OV));
      if (u.startsWith('https://archive.org/advancedsearch.php')) return new Response(JSON.stringify(IA_SEARCH));
      if (u.startsWith('https://archive.org/metadata/NS050')) return new Response(JSON.stringify(IA_META));
      if (u.startsWith('https://itunes.apple.com/')) return new Response(JSON.stringify(IT));
      return new Response('no', { status: 404 });
    });
    const r = await searchFull('piano', f as never);
    expect(r.failed).toEqual([]);
    expect(r.tracks.map((x) => x.source)).toEqual(['openverse', 'archive', 'openverse', 'archive']);
    const f2 = vi.fn(async (u: string) => (u.includes('openverse') ? new Response('x', { status: 429 }) : f(u)));
    const r2 = await searchFull('piano', f2 as never);
    expect(r2.failed).toEqual(['Openverse']);
    expect(r2.tracks.every((x) => x.source === 'archive')).toBe(true);
    expect((await searchFull('   ', f as never)).tracks).toEqual([]);
    expect((await searchPreview('jack', f as never)).tracks[0]!.preview).toBe(true);
    expect((await searchPreview('jack', (async () => { throw new Error('net'); }) as never)).failed).toEqual(['Apple Music']);
  });
});

describe('media-bus：音乐与朗读互斥', () => {
  it('别人宣布出声时回调，自己的不回调', () => {
    const music = vi.fn();
    const tts = vi.fn();
    const off1 = onMediaClaim('music', music);
    const off2 = onMediaClaim('tts', tts);
    claimMedia('tts');
    expect(music).toHaveBeenCalledWith('tts');
    expect(tts).not.toHaveBeenCalled();
    claimMedia('music');
    expect(tts).toHaveBeenCalledWith('music');
    off1();
    off2();
    claimMedia('tts');
    expect(music).toHaveBeenCalledTimes(1);
  });
});

describe('演示 mock API：站长歌单 + 音频上传（与 Worker 一致）', () => {
  let api: DemoBackend;
  let csrf = '';
  beforeEach(async () => {
    api = new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/' });
    const r = await api.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD });
    csrf = (r.body as { csrfToken: string }).csrfToken;
  });
  const adm = (m: string, p: string, b?: unknown) => api.handle(m, p, b, { 'x-csrf-token': csrf });
  it('公开读取种子歌单（全部合法）', async () => {
    const r = await api.handle('GET', '/api/content/playlist');
    expect(r.status).toBe(200);
    const items = (r.body as { items: unknown[] }).items;
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(validatePlaylist(items).issues).toEqual([]);
  });
  it('保存时严格校验；需要登录', async () => {
    const anon = new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/' });
    expect((await anon.handle('PUT', '/api/admin/content/playlist', { items: [good] })).status).toBe(401);
    const ok = await adm('PUT', '/api/admin/content/playlist', { items: [good] });
    expect(ok.status).toBe(200);
    expect((await api.handle('GET', '/api/content/playlist')).body).toEqual({ items: [good] });
    const bad = await adm('PUT', '/api/admin/content/playlist', { items: [{ ...good, src: 'http://x.com/a.mp3' }] });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('items.0.src');
    expect((await adm('PUT', '/api/admin/content/playlist', { items: [{ ...good, extra: 1 }] })).status).toBe(400);
  });
  it('上传音频：嗅探类型、限制大小，返回 /api/audio/… 并能取回', async () => {
    const mp3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3]);
    const anon = new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/' });
    expect((await anon.handle('POST', '/api/admin/audio', { bytes: mp3, type: 'audio/mpeg', name: 'a.mp3' })).status).toBe(401);
    const r = await adm('POST', '/api/admin/audio', { bytes: mp3, type: 'audio/mpeg', name: 'a.mp3' });
    expect(r.status).toBe(201);
    const body = r.body as { url: string; contentType: string; size: number };
    expect(body.url).toMatch(/^\/api\/audio\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.mp3$/);
    expect(body).toMatchObject({ contentType: 'audio/mpeg', size: mp3.length });
    const blob = await api.audioBlob(body.url);
    expect(blob?.type).toBe('audio/mpeg');
    expect((await adm('POST', '/api/admin/audio', { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]), type: 'audio/mpeg' })).status).toBe(415);
    expect((await adm('POST', '/api/admin/audio', { bytes: mp3, type: 'text/html' })).status).toBe(415);
    const ok = await adm('PUT', '/api/admin/content/playlist', { items: [{ ...good, src: body.url }] });
    expect(ok.status).toBe(200);
  });
});

describe('TTS 与音乐互斥（reading-tools 接线）', () => {
  it('reading-tools 引用 media-bus：开始朗读宣布 tts，收到 music 时暂停', () => {
    const src = read('../src/reading-tools.ts');
    expect(src).toMatch(/claimMedia\('tts'\)/);
    expect(src).toMatch(/onMediaClaim\('tts'/);
  });
});
