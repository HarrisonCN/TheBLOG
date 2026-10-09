import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_TOKEN, call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
beforeAll(async () => {
  env = await setupEnv();
});
afterAll(disposeEnv);

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89]);

describe('公开接口', () => {
  it('health', async () => {
    const r = await call(env, '/api/health');
    expect(r.status).toBe(200);
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('列出种子文章（只含已发布，不含正文）', async () => {
    const r = await call(env, '/api/posts');
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await r.json()) as any;
    expect(body.total).toBeGreaterThanOrEqual(1);
    const welcome = body.posts.find((p: any) => p.slug === 'welcome');
    expect(welcome.title).toBe('欢迎来到我的博客');
    expect(welcome.contentMd).toBeUndefined();
    expect(welcome.tags).toContain('建站');
  });

  it('按 slug 获取文章、标签、资料、设置', async () => {
    const post = (await (await call(env, '/api/posts/welcome')).json()) as any;
    expect(post.contentMd).toContain('# 你好，世界');
    const tags = (await (await call(env, '/api/tags')).json()) as any;
    expect(tags.tags.map((t: any) => t.tag)).toContain('随笔');
    const profile = (await (await call(env, '/api/profile')).json()) as any;
    expect(profile.name).toBe('Winston');
    const settings = (await (await call(env, '/api/settings')).json()) as any;
    expect(settings.animation).toBe('normal');
    expect(settings.sections.hero).toBe(true);
  });

  it('不存在 / 非法 slug 返回 404 / 400', async () => {
    expect((await call(env, '/api/posts/nope')).status).toBe(404);
    expect((await call(env, '/api/posts/Bad%20Slug')).status).toBe(400);
    expect((await call(env, '/api/whatever')).status).toBe(404);
  });

  it('按标签过滤与分页参数校验', async () => {
    const r = (await (await call(env, '/api/posts?tag=建站')).json()) as any;
    expect(r.posts.every((p: any) => p.tags.includes('建站'))).toBe(true);
    expect((await call(env, '/api/posts?limit=1000')).status).toBe(400);
  });
});

describe('后台 REST', () => {
  it('未登录拒绝', async () => {
    expect((await call(env, '/api/admin/posts')).status).toBe(401);
    expect((await call(env, '/api/admin/posts', { token: 'wrong-token-wrong-token' })).status).toBe(401);
  });

  it('Bearer token：草稿 → 发布 → 修改 → 删除', async () => {
    const created = await call(env, '/api/admin/posts', { token: API_TOKEN, body: { title: 'Hello REST', contentMd: '正文', tags: ['测试'] } });
    expect(created.status).toBe(201);
    const post = (await created.json()) as any;
    expect(post.slug).toBe('hello-rest');
    expect(post.status).toBe('draft');
    // 草稿不公开
    expect((await call(env, '/api/posts/hello-rest')).status).toBe(404);
    // 发布
    const pub = (await (await call(env, '/api/admin/posts/hello-rest/publish', { token: API_TOKEN, body: {} })).json()) as any;
    expect(pub.status).toBe('published');
    expect(pub.publishedAt).toBeTruthy();
    expect((await call(env, '/api/posts/hello-rest')).status).toBe(200);
    // 修改 + 重命名
    const upd = await call(env, '/api/admin/posts/hello-rest', { method: 'PATCH', token: API_TOKEN, body: { title: '新标题', slug: 'hello-rest-2' } });
    expect(upd.status).toBe(200);
    expect(((await upd.json()) as any).title).toBe('新标题');
    // slug 冲突
    const conflict = await call(env, '/api/admin/posts', { token: API_TOKEN, body: { title: 'x', slug: 'hello-rest-2' } });
    expect(conflict.status).toBe(409);
    // 撤回
    const unpub = (await (await call(env, '/api/admin/posts/hello-rest-2/publish', { token: API_TOKEN, body: { published: false } })).json()) as any;
    expect(unpub.status).toBe('draft');
    // 后台可见草稿
    const list = (await (await call(env, '/api/admin/posts?status=draft', { token: API_TOKEN })).json()) as any;
    expect(list.posts.some((p: any) => p.slug === 'hello-rest-2')).toBe(true);
    // 删除
    expect((await call(env, '/api/admin/posts/hello-rest-2', { method: 'DELETE', token: API_TOKEN })).status).toBe(200);
    expect((await call(env, '/api/admin/posts/hello-rest-2', { token: API_TOKEN })).status).toBe(404);
  });

  it('输入校验：危险 URL、超长标题、非 JSON', async () => {
    const bad = await call(env, '/api/admin/posts', { token: API_TOKEN, body: { title: 'x', coverUrl: 'javascript:alert(1)' } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error.code).toBe('validation_error');
    expect((await call(env, '/api/admin/posts', { token: API_TOKEN, body: { title: 'x'.repeat(201) } })).status).toBe(400);
    expect((await call(env, '/api/admin/posts', { token: API_TOKEN, raw: 'title=x', headers: { 'content-type': 'text/plain' } })).status).toBe(415);
  });

  it('资料与设置（局部更新）', async () => {
    const p = (await (await call(env, '/api/admin/profile', { method: 'PATCH', token: API_TOKEN, body: { tagline: '新签名' } })).json()) as any;
    expect(p.tagline).toBe('新签名');
    expect(p.name).toBe('Winston');
    const s = (await (await call(env, '/api/admin/settings', { method: 'PUT', token: API_TOKEN, body: { theme: 'dark', sections: { tags: false }, animation: 'low' } })).json()) as any;
    expect(s.theme).toBe('dark');
    expect(s.sections.tags).toBe(false);
    expect(s.sections.hero).toBe(true);
    expect((await call(env, '/api/admin/settings', { method: 'PUT', token: API_TOKEN, body: { animation: 'crazy' } })).status).toBe(400);
    const pub = (await (await call(env, '/api/settings')).json()) as any;
    expect(pub.theme).toBe('dark');
    await call(env, '/api/admin/settings', { method: 'PUT', token: API_TOKEN, body: { theme: 'system', sections: { tags: true }, animation: 'normal' } });
  });

  it('图片上传（R2）：PNG 通过，SVG / 伪造类型拒绝，可公开读取', async () => {
    const r = await call(env, '/api/admin/images?alt=pixel', { token: API_TOKEN, raw: PNG, headers: { 'content-type': 'image/png' } });
    expect(r.status).toBe(201);
    const up = (await r.json()) as any;
    expect(up.url).toMatch(/^\/api\/images\/\d{4}\/\d{2}\/[0-9a-f-]+\.png$/);
    expect(up.markdown).toBe(`![pixel](${up.url})`);
    const img = await call(env, up.url);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await img.arrayBuffer()).length).toBe(PNG.length);
    const svg = await call(env, '/api/admin/images', { token: API_TOKEN, raw: '<svg onload="alert(1)"/>', headers: { 'content-type': 'image/svg+xml' } });
    expect(svg.status).toBe(415);
    const lie = await call(env, '/api/admin/images', { token: API_TOKEN, raw: PNG, headers: { 'content-type': 'image/jpeg' } });
    expect(lie.status).toBe(415);
    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'a.png');
    const multi = await call(env, '/api/admin/images', { token: API_TOKEN, raw: form });
    expect(multi.status).toBe(201);
    expect((await call(env, '/api/images/../secret')).status).toBe(404);
  });

  it('会话 Cookie 写操作必须带 CSRF token', async () => {
    const { cookie, csrf } = await login(env, '10.9.9.9');
    expect((await call(env, '/api/admin/posts', { cookie })).status).toBe(200);
    expect((await call(env, '/api/admin/posts', { cookie, body: { title: 'csrf' } })).status).toBe(403);
    expect((await call(env, '/api/admin/posts', { cookie, csrf: 'wrong', body: { title: 'csrf' } })).status).toBe(403);
    const ok = await call(env, '/api/admin/posts', { cookie, csrf, body: { title: 'csrf ok' } });
    expect(ok.status).toBe(201);
    await call(env, '/api/admin/posts/csrf-ok', { method: 'DELETE', cookie, csrf });
  });

  it('跨站 Origin 被拒绝；白名单 Origin 得到带凭据的 CORS', async () => {
    const evil = await call(env, '/api/admin/posts', { token: API_TOKEN, headers: { origin: 'https://evil.example' } });
    expect(evil.status).toBe(403);
    const dev = await call(env, '/api/admin/posts', { token: API_TOKEN, headers: { origin: 'http://localhost:5173' } });
    expect(dev.status).toBe(200);
    expect(dev.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(dev.headers.get('access-control-allow-credentials')).toBe('true');
    const pre = await call(env, '/api/admin/posts', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    expect(pre.headers.get('access-control-allow-origin')).toBeNull();
  });
});
