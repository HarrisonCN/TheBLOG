import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv, tool } from './helpers';
import type { Env } from '../src/env';
import { coarsen, parseMapBlock, validateEssay, validatePostMedia } from '../src/essay-core';

let env: Env;
let admin: { cookie: string; csrf: string };
const adm = (path: string, o: { method?: string; body?: unknown } = {}) => call(env, path, { ...o, cookie: admin.cookie, csrf: admin.csrf });
const IMG = '/api/images/2026/09/0b1c2d3e-0000-4000-8000-000000000001.webp';
const essay = { layout: 'grid', photos: [{ src: IMG, alt: '雾', caption: '清晨的江面', exif: { camera: 'Phone', focal: '24mm', aperture: 'f/1.8', shutter: '1/250s', iso: '50' }, notes: { place: '桂林', light: '晨雾' } }] };

beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.114.9.1');
});
afterAll(disposeEnv);

describe('essay-core（Worker 份）', () => {
  it('validatePostMedia 规则', () => {
    expect(validatePostMedia({ kind: 'essay' }).issues[0]!.path).toBe('essay');
    expect(validatePostMedia({ kind: 'post', essay }).essay).toBeNull();
    expect(validatePostMedia({ kind: 'album' }).issues[0]!.path).toBe('kind');
    expect(validatePostMedia({ notes: { place: '25.2734,110.29' } }).issues[0]!.path).toBe('notes.place');
    expect(validatePostMedia({}, { kind: 'essay', essay: validateEssay(essay).essay, notes: null }).kind).toBe('essay');
  });
  it('坐标粗化', () => {
    expect(coarsen(28.19, 112.97)).toEqual({ lat: 28.2, lng: 113 });
    expect(parseMapBlock('长沙', '28.19, 112.97')).toEqual({ place: '长沙', lat: 28.2, lng: 113 });
  });
});

describe('影集文章接口', () => {
  it('创建影集：保存版式、照片、EXIF、手记；公开接口返回；列表只带 kind', async () => {
    const r = await adm('/api/admin/posts', { body: { title: '影集测试', slug: 'l14-essay', kind: 'essay', essay, notes: { place: '漓江', gear: '手机' }, status: 'published' } });
    expect(r.status).toBe(201);
    const p = (await r.json()) as any;
    expect(p.kind).toBe('essay');
    expect(p.essay.layout).toBe('grid');
    expect(p.essay.photos[0].exif.iso).toBe('50');
    expect(p.essay.photos[0].notes.place).toBe('桂林');
    expect(p.notes).toMatchObject({ place: '漓江', gear: '手机' });
    const pub = (await (await call(env, '/api/posts/l14-essay')).json()) as any;
    expect(pub.essay.photos).toHaveLength(1);
    const list = (await (await call(env, '/api/posts')).json()) as any;
    const s = list.posts.find((x: any) => x.slug === 'l14-essay');
    expect(s.kind).toBe('essay');
    expect(s.essay).toBeUndefined();
  });
  it('严格校验：缺照片、坏 EXIF、多余字段（gps）、不安全链接、坐标地点 → 400 带路径', async () => {
    const r = await adm('/api/admin/posts', {
      body: { title: '坏影集', kind: 'essay', essay: { layout: 'grid', photos: [{ src: 'javascript:alert(1)', gps: '25,110', exif: { iso: 'x' }, notes: { place: '25°16′N' } }] } },
    });
    expect(r.status).toBe(400);
    const paths = ((await r.json()) as any).error.details.map((d: any) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['essay.photos.0.src', 'essay.photos.0.gps', 'essay.photos.0.exif.iso', 'essay.photos.0.notes.place']));
    expect((await adm('/api/admin/posts', { body: { title: '空影集', kind: 'essay' } })).status).toBe(400);
  });
  it('更新：改成普通文章时清空影集；手记 null 清空；不传则保留', async () => {
    let r = await adm('/api/admin/posts/l14-essay', { method: 'PUT', body: { title: '影集测试 2' } });
    expect(((await r.json()) as any).essay.photos).toHaveLength(1);
    r = await adm('/api/admin/posts/l14-essay', { method: 'PUT', body: { kind: 'post', notes: null } });
    const p = (await r.json()) as any;
    expect(p.kind).toBe('post');
    expect(p.essay).toBeNull();
    expect(p.notes).toBeNull();
  });
  it('MCP create_post 也走同一套规则', async () => {
    const ok = await tool(env, 'create_post', { title: 'MCP 影集', slug: 'l14-mcp', kind: 'essay', essay });
    expect(ok.isError).toBeFalsy();
    const bad = await tool(env, 'create_post', { title: 'MCP 坏影集', kind: 'essay', essay: { layout: 'x', photos: [] } });
    expect(bad.isError).toBe(true);
  });
});

describe('书影音封面', () => {
  it('cover 接受 https / 站内路径，拒绝 javascript:', async () => {
    const good = await adm('/api/admin/content/shelf', { method: 'PUT', body: { items: [{ kind: 'book', title: '明室', status: 'done', rating: 5, cover: 'https://covers.openlibrary.org/b/id/1-M.jpg', date: '2026-09' }] } });
    expect(good.status).toBe(200);
    const pub = (await (await call(env, '/api/content/shelf')).json()) as any;
    expect(pub.items[0]).toMatchObject({ cover: 'https://covers.openlibrary.org/b/id/1-M.jpg', date: '2026-09' });
    const bad = await adm('/api/admin/content/shelf', { method: 'PUT', body: { items: [{ kind: 'book', title: 'x', cover: 'javascript:alert(1)' }] } });
    expect(bad.status).toBe(400);
    // 测试共用一个数据库：还原成空，别影响 api.test.ts 的「默认空」断言
    expect((await adm('/api/admin/content/shelf', { method: 'PUT', body: { items: [] } })).status).toBe(200);
  });
});
