import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';
import { validatePlaylist } from '../src/music-core';

let env: Env;
let admin: { cookie: string; csrf: string };
const adm = (path: string, o: { method?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}) => call(env, path, { ...o, cookie: admin.cookie, csrf: admin.csrf });

const good = { id: 'swing-low', title: 'Swing Low', artist: 'Cocolixe', album: 'Another Day', src: 'https://archive.org/download/NS050/03.mp3', cover: '', duration: 200, license: 'CC BY-NC-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/', link: 'https://archive.org/details/NS050' };
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0, 0, ...Array.from({ length: 200 }, (_, i) => i & 255)]);

function form(bytes: Uint8Array, type: string, name = 'a.mp3'): FormData {
  const fd = new FormData();
  fd.set('file', new File([bytes], name, { type }));
  return fd;
}

beforeAll(async () => {
  env = await setupEnv();
  admin = await login(env, '10.113.9.1');
});
afterAll(disposeEnv);

describe('站长歌单 site_content.playlist', () => {
  it('默认空；公开可读', async () => {
    const r = await call(env, '/api/content/playlist');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ items: [] });
  });
  it('未登录不能写', async () => {
    expect((await call(env, '/api/admin/content/playlist', { method: 'PUT', body: { items: [good] } })).status).toBe(401);
  });
  it('合法条目保存成功并公开', async () => {
    const r = await adm('/api/admin/content/playlist', { method: 'PUT', body: { items: [good] } });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).items).toEqual([good]);
    expect(await (await call(env, '/api/content/playlist')).json()).toEqual({ items: [good] });
  });
  it.each([
    ['http 链接', { src: 'http://archive.org/a.mp3' }, 'src'],
    ['javascript:', { src: 'javascript:alert(1)' }, 'src'],
    ['data:', { src: 'data:audio/mpeg;base64,AAAA' }, 'src'],
    ['带账号密码', { src: 'https://u:p@archive.org/a.mp3' }, 'src'],
    ['伪造上传路径', { src: '/api/audio/../../x.mp3' }, 'src'],
    ['超长链接', { src: 'https://a.com/' + 'x'.repeat(500) }, 'src'],
    ['封面 http', { cover: 'http://a.com/a.jpg' }, 'cover'],
    ['出处 javascript', { link: 'javascript:1' }, 'link'],
    ['标题超长', { title: 'x'.repeat(81) }, 'title'],
    ['尖括号', { artist: '<img src=x>' }, 'artist'],
    ['id 格式', { id: 'Bad Id' }, 'id'],
    ['时长', { duration: 99999 }, 'duration'],
    ['多余字段', { onclick: 'x' }, 'onclick'],
  ])('拒绝：%s', async (_n, patch, field) => {
    const r = await adm('/api/admin/content/playlist', { method: 'PUT', body: { items: [{ ...good, ...patch }] } });
    expect(r.status).toBe(400);
    const body = (await r.json()) as any;
    expect(JSON.stringify(body.error.details)).toContain(`items.0.${field}`);
  });
  it('重复 id / 超过 100 首 / 非数组', async () => {
    expect((await adm('/api/admin/content/playlist', { method: 'PUT', body: { items: [good, good] } })).status).toBe(400);
    expect((await adm('/api/admin/content/playlist', { method: 'PUT', body: { items: Array.from({ length: 101 }, (_, i) => ({ ...good, id: `t${i}` })) } })).status).toBe(400);
    expect((await adm('/api/admin/content/playlist', { method: 'PUT', body: { items: 'x' } })).status).toBe(400);
    // 失败不改动已保存的歌单
    expect(await (await call(env, '/api/content/playlist')).json()).toEqual({ items: [good] });
  });
});

describe('音频上传 /api/admin/audio 与播放 /api/audio/…', () => {
  let url = '';
  it('未登录 401', async () => {
    expect((await call(env, '/api/admin/audio', { method: 'POST', raw: form(MP3, 'audio/mpeg') })).status).toBe(401);
  });
  it('上传 MP3 → R2，返回 /api/audio/…', async () => {
    const r = await adm('/api/admin/audio', { method: 'POST', raw: form(MP3, 'audio/mpeg') });
    expect(r.status).toBe(201);
    const body = (await r.json()) as any;
    expect(body.url).toMatch(/^\/api\/audio\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.mp3$/);
    expect(body).toMatchObject({ contentType: 'audio/mpeg', size: MP3.length });
    url = body.url;
  });
  it('播放：整段与 Range 请求（206，便于拖动进度）', async () => {
    const r = await call(env, url);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('audio/mpeg');
    expect(r.headers.get('accept-ranges')).toBe('bytes');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(MP3);
    const p = await call(env, url, { headers: { range: 'bytes=10-19' } });
    expect(p.status).toBe(206);
    expect(p.headers.get('content-range')).toBe(`bytes 10-19/${MP3.length}`);
    expect(new Uint8Array(await p.arrayBuffer())).toEqual(MP3.slice(10, 20));
    const s = await call(env, url, { headers: { range: 'bytes=-5' } });
    expect(s.status).toBe(206);
    expect(new Uint8Array(await s.arrayBuffer())).toEqual(MP3.slice(-5));
    expect((await call(env, url, { headers: { range: 'bytes=99999-' } })).status).toBe(416);
  });
  it('上传的音频可以写进歌单', async () => {
    const r = await adm('/api/admin/content/playlist', { method: 'PUT', body: { items: [good, { ...good, id: 'uploaded', src: url }] } });
    expect(r.status).toBe(200);
    expect(validatePlaylist(((await r.json()) as any).items).issues).toEqual([]);
  });
  it('拒绝：伪装成音频的图片 / HTML、声明非音频类型、空文件', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0]);
    expect((await adm('/api/admin/audio', { method: 'POST', raw: form(png, 'audio/mpeg') })).status).toBe(415);
    expect((await adm('/api/admin/audio', { method: 'POST', raw: form(new TextEncoder().encode('<html><script>alert(1)</script></html>'), 'audio/mpeg') })).status).toBe(415);
    expect((await adm('/api/admin/audio', { method: 'POST', raw: form(MP3, 'text/html') })).status).toBe(415);
    expect((await adm('/api/admin/audio', { method: 'POST', raw: form(new Uint8Array(0), 'audio/mpeg') })).status).toBe(400);
  });
  it('拒绝：超过 20 MB', async () => {
    const big = new Uint8Array(21 * 1024 * 1024);
    big.set(MP3);
    expect((await adm('/api/admin/audio', { method: 'POST', raw: big, headers: { 'content-type': 'audio/mpeg' } })).status).toBe(413);
    expect((await adm('/api/admin/audio', { method: 'POST', raw: form(big, 'audio/mpeg') })).status).toBe(413);
  });
  it('播放路径白名单：其它键 404', async () => {
    expect((await call(env, '/api/audio/../images/x')).status).toBe(404);
    expect((await call(env, '/api/audio/2026/10/not-a-uuid.mp3')).status).toBe(404);
    expect((await call(env, '/api/audio/2026/10/0b1f6a52-1c1d-4c55-9b87-1e0d7d1b7a11.mp3')).status).toBe(404);
  });
});
