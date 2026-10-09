import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_TOKEN, call, disposeEnv, mcp, setupEnv, tool } from './helpers';
import type { Env } from '../src/env';

let env: Env;
beforeAll(async () => {
  env = await setupEnv();
});
afterAll(disposeEnv);

const EXPECTED_TOOLS = [
  'list_posts', 'get_post', 'create_post', 'update_post', 'delete_post', 'publish_post',
  'get_profile', 'update_profile', 'get_settings', 'update_settings', 'upload_image',
];

describe('MCP 传输层', () => {
  it('无 token / 错误 token 返回 401 + WWW-Authenticate', async () => {
    const r = await call(env, '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toContain('Bearer');
    expect((await mcp(env, 'ping', undefined, 'wrong-token-wrong-token')).status).toBe(401);
  });

  it('非法 Origin 被拒（防 DNS rebinding）', async () => {
    const r = await call(env, '/mcp', { token: API_TOKEN, body: { jsonrpc: '2.0', id: 1, method: 'ping' }, headers: { origin: 'https://evil.example' } });
    expect(r.status).toBe(403);
  });

  it('initialize 协商协议版本', async () => {
    const r = await mcp(env, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(r.status).toBe(200);
    expect(r.body.result.protocolVersion).toBe('2025-06-18');
    expect(r.body.result.capabilities.tools).toBeTruthy();
    expect(r.body.result.serverInfo.name).toBe('winston-blog');
    const future = await mcp(env, 'initialize', { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(future.body.result.protocolVersion).toBe('2025-11-25');
  });

  it('通知返回 202，未知方法 -32601，坏 JSON -32700，批量请求', async () => {
    const n = await call(env, '/mcp', { token: API_TOKEN, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    expect(n.status).toBe(202);
    expect((await mcp(env, 'foo/bar')).body.error.code).toBe(-32601);
    const bad = await call(env, '/mcp', { token: API_TOKEN, raw: '{oops', headers: { 'content-type': 'application/json' } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error.code).toBe(-32700);
    const batch = await call(env, '/mcp', { token: API_TOKEN, body: [{ jsonrpc: '2.0', id: 'a', method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }] });
    const arr = (await batch.json()) as any[];
    expect(arr).toHaveLength(1);
    expect(arr[0].id).toBe('a');
  });

  it('GET /mcp 返回 405；不支持的 MCP-Protocol-Version 返回 400', async () => {
    expect((await call(env, '/mcp', { token: API_TOKEN })).status).toBe(405);
    const r = await call(env, '/mcp', { token: API_TOKEN, body: { jsonrpc: '2.0', id: 1, method: 'ping' }, headers: { 'mcp-protocol-version': '1999-01-01' } });
    expect(r.status).toBe(400);
  });

  it('tools/list 列出全部 11 个工具，inputSchema 为 object', async () => {
    const r = await mcp(env, 'tools/list');
    const tools = r.body.result.tools as any[];
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    for (const t of tools) {
      expect(t.inputSchema.type).toBe('object');
      expect(t.inputSchema.$schema).toBeUndefined();
    }
    expect(tools.find((t) => t.name === 'delete_post').annotations.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === 'create_post').inputSchema.required).toEqual(['title']);
  });
});

describe('MCP 工具', () => {
  it('create → get → update → publish → list → delete', async () => {
    const c = await tool(env, 'create_post', { title: 'MCP Post', slug: 'mcp-post', contentMd: '# 来自 MCP', tags: ['mcp'] });
    expect(c.isError).toBe(false);
    expect(c.structuredContent.status).toBe('draft');
    expect(JSON.parse(c.content[0]!.text).slug).toBe('mcp-post');

    const g = await tool(env, 'get_post', { slug: 'mcp-post' });
    expect(g.structuredContent.contentMd).toBe('# 来自 MCP');

    const u = await tool(env, 'update_post', { slug: 'mcp-post', title: 'MCP Post v2', newSlug: 'mcp-post-v2' });
    expect(u.structuredContent.title).toBe('MCP Post v2');
    expect(u.structuredContent.slug).toBe('mcp-post-v2');

    const p = await tool(env, 'publish_post', { slug: 'mcp-post-v2' });
    expect(p.structuredContent.status).toBe('published');
    expect((await call(env, '/api/posts/mcp-post-v2')).status).toBe(200);

    const l = await tool(env, 'list_posts', { tag: 'mcp' });
    expect(l.structuredContent.posts.map((x: any) => x.slug)).toContain('mcp-post-v2');

    const d = await tool(env, 'delete_post', { slug: 'mcp-post-v2' });
    expect(d.structuredContent.deleted).toBe(true);
    const gone = await tool(env, 'get_post', { slug: 'mcp-post-v2' });
    expect(gone.isError).toBe(true);
    expect(gone.content[0]!.text).toContain('not_found');
  });

  it('参数错误以 isError 结果返回；未知工具为 JSON-RPC 错误', async () => {
    const bad = await tool(env, 'create_post', { title: '' });
    expect(bad.isError).toBe(true);
    expect(bad.content[0]!.text).toContain('参数校验失败');
    const unknown = await mcp(env, 'tools/call', { name: 'rm_rf', arguments: {} });
    expect(unknown.body.error.code).toBe(-32602);
  });

  it('资料与设置', async () => {
    expect((await tool(env, 'get_profile')).structuredContent.name).toBe('Winston');
    const up = await tool(env, 'update_profile', { location: '长沙' });
    expect(up.structuredContent.location).toBe('长沙');
    const s = await tool(env, 'update_settings', { animation: 'high', featuredSlugs: ['welcome'] });
    expect(s.structuredContent.animation).toBe('high');
    expect((await tool(env, 'get_settings')).structuredContent.animation).toBe('high');
    const bad = await tool(env, 'update_settings', { theme: 'neon' });
    expect(bad.isError).toBe(true);
  });

  it('upload_image：base64 PNG 写入 R2；非图片拒绝', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]).toString('base64');
    const r = await tool(env, 'upload_image', { dataBase64: png, contentType: 'image/png', alt: '测试' });
    expect(r.isError).toBe(false);
    expect(r.structuredContent.markdown).toMatch(/^!\[测试\]\(\/api\/images\//);
    expect((await call(env, r.structuredContent.url)).status).toBe(200);
    const txt = await tool(env, 'upload_image', { dataBase64: Buffer.from('hello world').toString('base64'), contentType: 'image/png' });
    expect(txt.isError).toBe(true);
  });
});
