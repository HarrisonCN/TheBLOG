import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { call, disposeEnv, login, setupEnv, API_TOKEN, mcp } from './helpers';
import worker from '../src/index';
import { testOutbox } from '../src/community';
import type { Env } from '../src/env';
import { drainWebmentions, mdLite, sendDigests } from '../src/open';
import {
  atomFeed,
  checkAiPublish,
  checkTokenInput,
  checkWebmention,
  discoverEndpoint,
  draftOutline,
  extractiveSummary,
  extractTextLinks,
  interpretMention,
  isPrivateHost,
  jsonFeedOf,
  maxScopeFor,
  parseMf2,
  parseRepoUrl,
  rssFeed,
  scopeAllows,
  suggestTopics,
  targetOf,
  toolScope,
} from '../src/open-core';
import { TOOLS } from '../src/mcp';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({ EMAIL_PROVIDER: 'memory', WEBMENTION_ALLOW_PRIVATE: '1' } as Partial<Env>);
  admin = await login(env, '10.20.0.1');
  expect((await adm('/api/admin/ugc/rules', { reviewFirstN: 0 }, 'PUT')).status).toBe(200);
});
afterAll(async () => {
  // 测试库在各测试文件之间共用：清掉本文件建的项目，免得影响 studio.test.ts 的项目列表断言
  for (const t of ['project_links', 'project_logs', 'project_members']) await env.DB.prepare(`DELETE FROM ${t} WHERE project_id IN (SELECT id FROM projects WHERE slug IN ('gh-card', 'gh-missing'))`).run().catch(() => undefined);
  await env.DB.prepare("DELETE FROM projects WHERE slug IN ('gh-card', 'gh-missing')").run();
  await call(env, '/api/admin/ugc/rules', { method: 'PUT', cookie: admin.cookie, csrf: admin.csrf, body: { reviewFirstN: 2 } });
  await call(env, '/api/admin/ai', { method: 'PUT', cookie: admin.cookie, csrf: admin.csrf, body: { enabled: false } });
  await disposeEnv();
});

const ip = (n: number) => ({ 'cf-connecting-ip': `10.20.1.${n}` });
const codeFor = (email: string) => /(\d{6})/.exec(testOutbox.filter((m) => m.to === email).at(-1)?.text ?? '')?.[1] ?? '';
type U = { token: string; id: number; username: string; email: string };
async function join(email: string, name: string, username: string, n: number): Promise<U> {
  expect((await call(env, '/api/members/register', { body: { name, email }, headers: ip(n) })).status).toBe(200);
  const b = (await (await call(env, '/api/members/verify', { body: { email, code: codeFor(email) } })).json()) as any;
  expect((await call(env, '/api/social/me', { method: 'PUT', token: b.token, body: { username } })).status).toBe(200);
  await env.DB.prepare('UPDATE members SET joined_at = ? WHERE id = ?').bind(new Date(Date.now() - 10 * 86400_000).toISOString(), b.member.id).run();
  return { token: b.token, id: b.member.id, username, email };
}
const J = async (r: Response) => (await r.json()) as any;
const get = (path: string, token?: string) => call(env, path, { token });
const post = (path: string, token: string | undefined, body?: unknown) => call(env, path, { method: 'POST', token, body: body ?? {} });
const adm = (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => call(env, path, { method, cookie: admin.cookie, csrf: admin.csrf, body });
const newWork = async (u: U, o: Record<string, unknown>) => {
  const r = await post('/api/social/works', u.token, { type: 'short', title: '', body: '', caption: '', notes: '', params: {}, media: [], visibility: 'public', ...o });
  const b = await J(r);
  if (r.status !== 201) throw new Error(`createWork ${r.status} ${JSON.stringify(b)}`);
  return b.work as { id: number; status: string; aiAssisted: boolean };
};
const rpc = async (token: string, method: string, params?: unknown) => (await mcp(env, method, params, token)).body;
const callTool = async (token: string, name: string, args: unknown = {}) => (await rpc(token, 'tools/call', { name, arguments: args })).result as { isError: boolean; structuredContent?: any; content: { text: string }[] };

// ============================================================ 纯函数
describe('open-core', () => {
  it('mf2：h-entry / h-card / 回复类型 / 隐含属性 / rels', () => {
    const html = `<html><head><link rel="webmention" href="/wm"></head><body>
      <div class="h-card"><a class="u-url p-name" href="https://ann.example/">Ann</a></div>
      <article class="h-entry">
        <span class="p-author h-card"><img class="u-photo" src="/ann.jpg" alt=""><a class="p-name u-url" href="https://ann.example/">Ann Lee</a></span>
        <a class="u-in-reply-to" href="https://blog.test/posts/hello/">原文</a>
        <div class="e-content"><p>写得真好 &amp; 学到了</p></div>
        <time class="dt-published" datetime="2026-10-11T10:00:00Z">10 月 11 日</time>
        <a class="u-url" href="/notes/1">永久链接</a>
      </article></body></html>`;
    const doc = parseMf2(html, 'https://ann.example/notes/1');
    expect(doc.rels.webmention).toEqual(['https://ann.example/wm']);
    // 隐含 url：只有在没有任何显式 u-* 属性时才从 a[href] 推出（mf2 规范）
    expect((parseMf2('<a class="h-card" href="/me">Me</a>', 'https://x.example/').items[0]!.properties)).toEqual({ name: ['Me'], url: ['https://x.example/me'] });
    const entry = doc.items.find((i) => i.type.includes('h-entry'))!;
    expect(entry.properties['in-reply-to']).toEqual(['https://blog.test/posts/hello/']);
    expect((entry.properties.content![0] as any).value).toBe('写得真好 & 学到了');
    const author = entry.properties.author![0] as any;
    expect(author.type).toEqual(['h-card']);
    expect(author.properties.photo).toEqual(['https://ann.example/ann.jpg']);
    expect(author.properties.url).toEqual(['https://ann.example/']);
    const r = interpretMention(html, 'https://ann.example/notes/1', 'https://blog.test/posts/hello');
    expect(r.linked).toBe(true);
    expect(r.parsed).toMatchObject({ type: 'reply', author: { name: 'Ann Lee', url: 'https://ann.example/', photo: 'https://ann.example/ann.jpg' }, content: '写得真好 & 学到了', published: '2026-10-11T10:00:00Z', url: 'https://ann.example/notes/1' });
    const like = interpretMention('<div class="h-entry"><a class="u-like-of" href="https://blog.test/w/3/">❤</a></div>', 'https://x.example/l', 'https://blog.test/w/3/');
    expect(like.parsed.type).toBe('like');
    expect(interpretMention('<p>no link</p>', 'https://x.example/', 'https://blog.test/w/3/').linked).toBe(false);
  });
  it('端点发现 / 链接提取 / 目标映射 / SSRF', () => {
    expect(discoverEndpoint('<https://a.example/wm>; rel="webmention"', '', 'https://a.example/p')).toBe('https://a.example/wm');
    expect(discoverEndpoint('<https://a.example/x>; rel="other", </wm2>; rel="webmention other"', '', 'https://a.example/p')).toBe('https://a.example/wm2');
    expect(discoverEndpoint(null, '<a rel="webmention" href="../wm3">x</a>', 'https://a.example/b/c')).toBe('https://a.example/wm3');
    expect(discoverEndpoint(null, '<p>none</p>', 'https://a.example/')).toBeNull();
    expect(extractTextLinks('看 [这篇](https://a.example/x) 和 https://b.example/y。')).toEqual(['https://a.example/x', 'https://b.example/y']);
    const sites = ['https://blog.test/', 'https://api.blog.test/'];
    expect(targetOf('https://blog.test/posts/hello/', sites)).toEqual({ kind: 'post', ref: 'hello' });
    expect(targetOf('https://blog.test/w/12/', sites)).toEqual({ kind: 'work', ref: '12' });
    expect(targetOf('https://blog.test/u/Ann_1/', sites)).toEqual({ kind: 'user', ref: 'ann_1' });
    expect(targetOf('https://api.blog.test/api/open/h/works/9', sites)).toEqual({ kind: 'work', ref: '9' });
    expect(targetOf('https://evil.test/w/12/', sites)).toBeNull();
    expect(checkWebmention({ source: 'https://blog.test/w/1/', target: 'https://blog.test/w/1' }, sites).ok).toBe(false);
    expect(checkWebmention({ source: 'javascript:alert(1)', target: 'https://blog.test/w/1/' }, sites).ok).toBe(false);
    for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.1', '169.254.169.254', '[::1]', 'foo.internal']) expect(isPrivateHost(h)).toBe(true);
    expect(isPrivateHost('example.com')).toBe(false);
  });
  it('订阅源：RSS / Atom / JSON Feed 结构完整、转义正确', () => {
    const meta = { title: 'T & <站>', description: 'd', homeUrl: 'https://blog.test/', author: { name: 'W' } };
    const items = [{ id: 'https://blog.test/w/1/', url: 'https://blog.test/w/1/', title: 'A "x" <b>', summary: 's & t', published: '2026-10-10T00:00:00Z', tags: ['摄影'] }];
    const rss = rssFeed(meta, items, 'https://blog.test/api/feeds/site.rss', '2026-10-11T00:00:00Z');
    expect(rss).toContain('<title>T &amp; &lt;站&gt;</title>');
    expect(rss).toContain('rel="self"');
    const atom = atomFeed(meta, items, 'https://blog.test/api/feeds/site.atom', '2026-10-11T00:00:00Z');
    for (const tag of ['<feed xmlns="http://www.w3.org/2005/Atom"', '<id>https://blog.test/</id>', '<updated>2026-10-10T00:00:00.000Z</updated>', '<entry>', '<author><name>W</name>']) expect(atom).toContain(tag);
    expect(wellFormed(rss) && wellFormed(atom)).toBe(true);
    const jf = JSON.parse(jsonFeedOf(meta, items, 'https://blog.test/api/feeds/site.json'));
    expect(jf).toMatchObject({ version: 'https://jsonfeed.org/version/1.1', feed_url: 'https://blog.test/api/feeds/site.json', items: [{ id: 'https://blog.test/w/1/', content_text: 's & t' }] });
  });
  it('MCP 作用域层级与工具表', () => {
    expect(scopeAllows('author', 'read-public')).toBe(true);
    expect(scopeAllows('read-public', 'author')).toBe(false);
    expect(maxScopeFor('member')).toBe('author');
    expect(checkTokenInput({ name: 'x', scope: 'moderator' }, 'member').ok).toBe(false);
    expect(checkTokenInput({ name: 'x', scope: 'moderator' }, 'moderator').ok).toBe(true);
    // 所有站长原有工具都是 admin；表里的读写工具分层正确
    expect(toolScope('create_post')).toBe('admin');
    expect(toolScope('search_public_works')).toBe('read-public');
    expect(toolScope('update_my_work')).toBe('author');
    expect(toolScope('moderate_content')).toBe('moderator');
    for (const t of TOOLS) if (t.annotations.readOnlyHint === false && toolScope(t.name) === 'read-public') throw new Error(`write tool ${t.name} is read-public`);
  });
  it('AI 本地回退：确定性、只用站内话题、发布需确认', () => {
    const body = '今晚在江边拍了很多夜景。长曝光让车流变成了光轨。三脚架很重要，快门线也很重要。最后修图只调了白平衡。';
    expect(extractiveSummary('江边夜景', body)).toBe(extractiveSummary('江边夜景', body));
    expect(extractiveSummary('江边夜景', body).length).toBeLessThanOrEqual(120);
    const t = suggestTopics('江边夜景', body, [{ slug: 'night', name: '夜景' }, { slug: 'code', name: '编程' }, { slug: 'gear', name: '器材', tags: ['三脚架'] }]);
    expect(t.map((x) => x.slug)).toEqual(['night', 'gear']);
    expect(draftOutline('标题', body)).toMatch(/^# 标题\n\n## 缘起/);
    expect(checkAiPublish({ aiAssisted: true }, true).ok).toBe(false);
    expect(checkAiPublish({ aiAssisted: true, aiConfirmed: true }, true).ok).toBe(true);
    expect(checkAiPublish({ aiAssisted: true }, false).ok).toBe(true);
  });
  it('GitHub 仓库地址 / mdLite 安全', () => {
    expect(parseRepoUrl('https://github.com/HarrisonCN/TheBLOG')).toEqual({ owner: 'HarrisonCN', repo: 'TheBLOG' });
    expect(parseRepoUrl('https://github.com/a/b.git')).toEqual({ owner: 'a', repo: 'b' });
    expect(parseRepoUrl('https://gitlab.com/a/b')).toBeNull();
    expect(mdLite('<script>x</script> [a](javascript:alert(1)) https://ok.example/p')).toBe('<p>&lt;script&gt;x&lt;/script&gt; [a](javascript:alert(1)) <a href="https://ok.example/p" rel="nofollow ugc">https://ok.example/p</a></p>');
  });
});
/** 测试用的极简 XML 良构检查：标签成对、正确嵌套（真正的 XML 解析器校验在 E2E 里用浏览器 DOMParser 做）。 */
function wellFormed(x: string): boolean {
  const stack: string[] = [];
  for (const m of x.replace(/<\?[\s\S]*?\?>/g, '').matchAll(/<(\/?)([A-Za-z][\w:.-]*)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (m[1]) {
      if (stack.pop() !== m[2]) return false;
    } else stack.push(m[2]!);
  }
  return stack.length === 0 && !/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-f]+;)/i.test(x);
}

// ============================================================ Worker
let ann: U, bob: U, cat: U;
describe('L20 feeds / open API / h-entry', () => {
  let w1: number, w2: number, priv: number;
  it('准备：两位会员与作品、话题、项目', async () => {
    ann = await join('ann20@e2e.test', 'Ann', 'ann20', 1);
    bob = await join('bea20@e2e.test', 'Bea', 'bea20', 2);
    cat = await join('cat20@e2e.test', 'Cat', 'cat20', 3);
    w1 = (await newWork(ann, { body: '第一条公开动态 https://example.org/x' })).id;
    w2 = (await newWork(ann, { type: 'article', title: '长文标题', body: '正文 **粗体**' })).id;
    priv = (await newWork(ann, { body: '仅自己可见', visibility: 'private' })).id;
    expect(w1 && w2 && priv).toBeTruthy();
  });
  it('用户 / 站点 / 话题订阅源：只含公开作品，格式正确', async () => {
    const atom = await get('/api/feeds/users/ann20.atom');
    expect(atom.status).toBe(200);
    expect(atom.headers.get('content-type')).toContain('application/atom+xml');
    const x = await atom.text();
    expect(wellFormed(x)).toBe(true);
    expect(x).toContain(`/w/${w1}/`);
    expect(x).toContain('长文标题');
    expect(x).not.toContain('仅自己可见');
    const rss = await (await get('/api/feeds/users/ann20.rss')).text();
    expect(wellFormed(rss) && rss.includes('<rss version="2.0"')).toBe(true);
    const jf = await J(await get('/api/feeds/users/ann20.json'));
    expect(jf.items.map((i: any) => i.id)).toEqual(expect.arrayContaining([expect.stringContaining(`/w/${w2}/`)]));
    expect(jf.feed_url).toBe('http://blog.test/api/feeds/users/ann20.json');
    expect((await get('/api/feeds/site.atom')).status).toBe(200);
    expect((await get('/api/feeds/users/nobody_here.rss')).status).toBe(404);
    // 主页设为私密 → 没有订阅源
    expect((await call(env, '/api/social/me', { method: 'PUT', token: cat.token, body: { visibility: 'private' } })).status).toBe(200);
    expect((await get('/api/feeds/users/cat20.atom')).status).toBe(404);
  });
  it('开放接口：游标分页、私密内容不出现、坏游标 400', async () => {
    const p1 = await J(await get('/api/open/v1/works?author=ann20&limit=1'));
    expect(p1.works).toHaveLength(1);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await J(await get(`/api/open/v1/works?author=ann20&limit=1&cursor=${p1.nextCursor}`));
    expect(p2.works[0].id).not.toBe(p1.works[0].id);
    const all = await J(await get('/api/open/v1/works?author=ann20&limit=50'));
    expect(all.works.map((w: any) => w.id)).not.toContain(priv);
    expect(JSON.stringify(all)).not.toContain('ann20@e2e.test');
    expect((await get('/api/open/v1/works?cursor=@@')).status).toBe(400);
    expect((await get(`/api/open/v1/works/${priv}`)).status).toBe(404);
    expect((await J(await get('/api/open/v1/users/ann20'))).user.feeds.atom).toBe('http://blog.test/api/feeds/users/ann20.atom');
    expect((await get('/api/open/v1/works')).headers.get('access-control-allow-origin')).toBe('*');
  });
  it('h-entry 页面：可解析、带 Webmention 端点与分享卡片', async () => {
    const r = await get(`/api/open/h/works/${w2}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('link')).toContain('rel="webmention"');
    const html = await r.text();
    expect(html).toContain('<meta property="og:title"');
    expect(html).toContain('<meta name="twitter:card"');
    const doc = parseMf2(html, `http://blog.test/api/open/h/works/${w2}`);
    const e = doc.items.find((i) => i.type.includes('h-entry'))!;
    expect(e.properties.name).toEqual(['长文标题']);
    expect((e.properties.author![0] as any).properties.name).toEqual(['Ann']);
    expect(doc.rels.webmention).toEqual(['http://blog.test/api/webmention']);
    const card = parseMf2(await (await get('/api/open/h/users/ann20')).text(), 'http://blog.test/');
    expect(card.items.find((i) => i.type.includes('h-card'))!.properties.name).toEqual(['Ann']);
    expect((await get(`/api/open/h/works/${priv}`)).status).toBe(404);
  });
});

// ============================================================ Webmention：两个本地端点之间的往返
interface Site { url: string; server: Server; env: Env }
async function startSite(): Promise<Site> {
  const site = { url: '', server: null as unknown as Server, env: null as unknown as Env };
  site.server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let path = req.url ?? '/';
    // 模拟 Pages 上的页面：/w/:id/、/posts/:slug/、/u/:name/ 都带 rel=webmention（这里直接用 Worker 的 h-entry 页面）
    path = path.replace(/^\/w\/(\d+)\/?$/, '/api/open/h/works/$1').replace(/^\/posts\/([a-z0-9-]+)\/?$/, '/api/open/h/posts/$1').replace(/^\/u\/(\w+)\/?$/, '/api/open/h/users/$1');
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const r = await worker.fetch(new Request(site.url.replace(/\/$/, '') + path, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined }) as never, site.env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((ok) => site.server.listen(0, '127.0.0.1', ok));
  site.url = `http://127.0.0.1:${(site.server.address() as AddressInfo).port}/`;
  site.env = { ...env, SITE_URL: site.url };
  return site;
}
describe('L20 Webmention round trip（两个本地端点）', () => {
  let A: Site, B: Site;
  let wa: number, wb: number;
  beforeAll(async () => {
    A = await startSite();
    B = await startSite();
  });
  afterAll(() => {
    A.server.close();
    B.server.close();
  });
  it('A 站作品链接到 B 站作品 → A 站长发送 → B 收到并异步验证 → 审核后公开显示', async () => {
    wb = (await newWork(bob, { body: 'B 站上的一条作品' })).id;
    const target = `${B.url}w/${wb}/`;
    wa = (await newWork(ann, { body: `回应一下 Bob：${target} 很棒` })).id;
    const send = await fetch(`${A.url}api/admin/webmentions/send`, { method: 'POST', headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf, 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'work', ref: wa }) });
    const sb = (await send.json()) as any;
    expect(send.status).toBe(200);
    expect(sb.source).toBe(`${A.url}api/open/h/works/${wa}`);
    const res = sb.results.find((r: any) => r.target === target);
    expect(res).toMatchObject({ status: 'sent', endpoint: `${B.url}api/webmention`, httpStatus: 202 });
    await drainWebmentions();
    const q = await J(await adm('/api/admin/webmentions?status=pending'));
    const item = q.items.find((i: any) => i.source === sb.source && i.target === target);
    expect(item).toMatchObject({ status: 'pending', type: 'mention', targetKind: 'work', targetRef: String(wb), author: { name: 'Ann' } });
    expect((await J(await adm('/api/admin/ugc/queue?view=pending'))).counts.webmentions).toBeGreaterThanOrEqual(1);
    // 审核前不公开
    expect((await J(await fetch(`${B.url}api/webmentions?kind=work&ref=${wb}`))).total).toBe(0);
    expect((await adm(`/api/admin/webmentions/${item.id}`, { action: 'approve' })).status).toBe(200);
    const pub = (await (await fetch(`${B.url}api/webmentions?target=${encodeURIComponent(target)}`)).json()) as any;
    expect(pub.total).toBe(1);
    expect(pub.mentions[0]).toMatchObject({ type: 'mention', author: { name: 'Ann', url: `${A.url}u/ann20/` }, url: `${A.url}w/${wa}/` });
    expect(JSON.stringify(pub)).not.toContain('ip_hash');
    const sent = await J(await adm(`/api/admin/webmentions/sent?kind=work&ref=${wa}`));
    expect(sent.items.some((s: any) => s.target === target && s.status === 'sent')).toBe(true);
  });
  it('来源删除后重新通知 → 验证为 source_gone，不再显示；来源不链接 → invalid', async () => {
    expect((await call(env, `/api/social/works/${wa}`, { method: 'DELETE', token: ann.token })).status).toBe(200);
    const source = `${A.url}api/open/h/works/${wa}`;
    const target = `${B.url}w/${wb}/`;
    const r = await fetch(`${B.url}api/webmention`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ source, target }) });
    expect(r.status).toBe(202);
    const st = (await r.json()) as any;
    expect(r.headers.get('location')).toBe(`${B.url}api/webmention/${st.id}`);
    await drainWebmentions();
    expect((await J(await fetch(`${B.url}api/webmention/${st.id}`))).status).toBe('invalid');
    expect((await J(await fetch(`${B.url}api/webmentions?kind=work&ref=${wb}`))).total).toBe(0);
    // 不链接到 target 的来源
    const other = (await newWork(ann, { body: '没有链接' })).id;
    const r2 = await fetch(`${B.url}api/webmention`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ source: `${A.url}w/${other}/`, target }) });
    const s2 = (await r2.json()) as any;
    await drainWebmentions();
    expect(await J(await fetch(`${B.url}api/webmention/${s2.id}`))).toMatchObject({ status: 'invalid', error: 'no_link' });
  });
  it('输入校验与限流：非本站目标 400、未知内容类型 415、不存在的目标 400、同一 IP 每小时 20 次', async () => {
    const form = (o: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o) });
    expect((await fetch(`${B.url}api/webmention`, form({ source: 'https://x.example/a', target: 'https://evil.example/w/1/' }))).status).toBe(400);
    expect((await fetch(`${B.url}api/webmention`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' })).status).toBe(415);
    expect((await fetch(`${B.url}api/webmention`, form({ source: 'https://x.example/a', target: `${B.url}w/999999/` }))).status).toBe(400);
    // 默认（不允许内网）时：内网来源一律验证失败（SSRF 防护）
    const strict = { ...env, SITE_URL: 'http://blog.test/' } as Env;
    delete (strict as Partial<Env>).WEBMENTION_ALLOW_PRIVATE;
    const rr = await worker.fetch(new Request('http://blog.test/api/webmention', { ...form({ source: 'http://169.254.169.254/latest', target: `http://blog.test/w/${wb}/` }), headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '10.20.9.9' } }) as never, strict);
    expect(rr.status).toBe(202);
    const sid = ((await rr.json()) as any).id;
    await drainWebmentions();
    expect(await J(await get(`/api/webmention/${sid}`))).toMatchObject({ status: 'invalid', error: 'private_host' });
    let limited = 0;
    for (let i = 0; i < 22; i++) {
      const x = await worker.fetch(new Request('http://blog.test/api/webmention', { ...form({ source: `https://spam${i}.example/a`, target: `http://blog.test/w/${wb}/` }), headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '10.20.9.10' } }) as never, strict);
      if (x.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
    await drainWebmentions();
  });
});

// ============================================================ MCP 分层令牌
describe('L20 MCP scoped tokens', () => {
  let readTok: string, authorTok: string, annDraft: number, annPub: number, bobWork: number;
  it('创建：只显示一次、哈希存储、作用域不超过角色', async () => {
    const r1 = await post('/api/social/mcp/tokens', bob.token, { name: '只读', scope: 'read-public' });
    expect(r1.status).toBe(201);
    readTok = (await J(r1)).token;
    authorTok = (await J(await post('/api/social/mcp/tokens', bob.token, { name: '写作', scope: 'author', ttlDays: 30 }))).token;
    expect(readTok).toMatch(/^mcp_/);
    const rows = (await env.DB.prepare('SELECT token_hash, prefix FROM mcp_tokens WHERE member_id = ?').bind(bob.id).all<{ token_hash: string; prefix: string }>()).results;
    expect(rows.length).toBe(2);
    expect(JSON.stringify(rows)).not.toContain(readTok);
    expect(JSON.stringify(rows)).not.toContain(authorTok);
    const list = await J(await get('/api/social/mcp/tokens', bob.token));
    expect(JSON.stringify(list)).not.toContain(readTok.slice(12));
    expect(list.scopes).toEqual(['read-public', 'author']);
    expect((await post('/api/social/mcp/tokens', bob.token, { name: '审核', scope: 'moderator' })).status).toBe(400);
    annDraft = (await newWork(ann, { body: 'Ann 的草稿', draft: true })).id;
    annPub = (await newWork(ann, { body: 'Ann 的公开作品' })).id;
    bobWork = (await newWork(bob, { body: 'Bob 自己的作品' })).id;
  });
  it('read-public 令牌：只能读，不能写', async () => {
    const tools = (await rpc(readTok, 'tools/list')).result.tools.map((t: any) => t.name);
    expect(tools).toContain('search_public_works');
    expect(tools).not.toContain('create_my_work');
    expect(tools).not.toContain('create_post');
    const found = await callTool(readTok, 'search_public_works', { author: 'ann20' });
    expect(found.isError).toBe(false);
    expect(found.structuredContent.works.map((w: any) => w.id)).toContain(annPub);
    expect(found.structuredContent.works.map((w: any) => w.id)).not.toContain(annDraft);
    for (const [name, args] of [['create_my_work', { type: 'short', body: 'x' }], ['update_my_work', { id: bobWork, body: 'x' }], ['delete_my_work', { id: bobWork }], ['create_post', { title: 'x', slug: 'x-mcp', contentMd: 'x' }], ['moderate_content', { targetKind: 'work', targetId: annPub, action: 'hide' }]] as const) {
      const r = await callTool(readTok, name, args);
      expect(r.isError, name).toBe(true);
      expect(r.content[0]!.text, name).toContain('insufficient_scope');
    }
    expect((await J(await get(`/api/social/works/${bobWork}`, bob.token))).work.body).toBe('Bob 自己的作品');
  });
  it('author 令牌：能管自己的作品，碰不到别人的', async () => {
    const mine = await callTool(authorTok, 'update_my_work', { id: bobWork, body: 'Bob 通过 MCP 修改' });
    expect(mine.isError).toBe(false);
    expect((await J(await get(`/api/social/works/${bobWork}`, bob.token))).work.body).toBe('Bob 通过 MCP 修改');
    const created = await callTool(authorTok, 'create_my_work', { type: 'short', body: 'MCP 草稿' });
    expect(created.isError).toBe(false);
    expect(created.structuredContent.status).toBe('draft');
    expect(created.structuredContent.work.author.username).toBe('bea20');
    for (const [name, args] of [['update_my_work', { id: annPub, body: '篡改' }], ['delete_my_work', { id: annPub }], ['get_my_work', { id: annDraft }], ['publish_my_work', { id: annDraft }]] as const) {
      const r = await callTool(authorTok, name, args);
      expect(r.isError, name).toBe(true);
      expect(r.content[0]!.text, name).toContain('not_found');
    }
    const annNow = await env.DB.prepare('SELECT body, status, deleted_at FROM user_posts WHERE id IN (?, ?) ORDER BY id').bind(annDraft, annPub).all<{ body: string; status: string; deleted_at: string | null }>();
    expect(annNow.results).toEqual([{ body: 'Ann 的草稿', status: 'draft', deleted_at: null }, { body: 'Ann 的公开作品', status: 'published', deleted_at: null }]);
    expect((await callTool(authorTok, 'list_moderation_queue')).content[0]!.text).toContain('insufficient_scope');
    expect((await callTool(authorTok, 'update_settings', { theme: 'dark' })).content[0]!.text).toContain('insufficient_scope');
  });
  it('审核员角色由站长授予；撤销角色后旧令牌自动降级；撤销令牌后 401；审计', async () => {
    expect((await adm(`/api/admin/members/${bob.id}/role`, { role: 'moderator' }, 'PUT')).status).toBe(200);
    const modTok = (await J(await post('/api/social/mcp/tokens', bob.token, { name: '审核', scope: 'moderator' }))).token;
    const q = await callTool(modTok, 'list_moderation_queue', { view: 'pending' });
    expect(q.isError).toBe(false);
    expect((await callTool(modTok, 'create_post', { title: 'x', slug: 'mod-x', contentMd: 'x' })).content[0]!.text).toContain('insufficient_scope');
    expect((await adm(`/api/admin/members/${bob.id}/role`, { role: 'member' }, 'PUT')).status).toBe(200);
    expect((await callTool(modTok, 'list_moderation_queue')).content[0]!.text).toContain('insufficient_scope');
    const ids = (await J(await get('/api/social/mcp/tokens', bob.token))).tokens;
    const readId = ids.find((t: any) => t.name === '只读').id;
    expect((await call(env, `/api/social/mcp/tokens/${readId}`, { method: 'DELETE', token: bob.token })).status).toBe(200);
    expect((await mcp(env, 'tools/list', {}, readTok)).status).toBe(401);
    // 别人不能撤销 Bob 的令牌
    const authorId = ids.find((t: any) => t.name === '写作').id;
    expect((await call(env, `/api/social/mcp/tokens/${authorId}`, { method: 'DELETE', token: ann.token })).status).toBe(404);
    const audit = (await J(await get('/api/social/mcp/audit', bob.token))).audit;
    expect(audit.some((a: any) => a.tool === 'create_my_work' && a.ok)).toBe(true);
    expect(audit.some((a: any) => a.code === 'insufficient_scope' && !a.ok)).toBe(true);
    expect(audit.some((a: any) => a.method === 'token/revoke')).toBe(true);
    expect(JSON.stringify(await J(await get('/api/social/mcp/audit', ann.token)))).not.toContain('create_my_work');
    // 站长环境令牌仍然是 admin（向后兼容）
    expect((await rpc(API_TOKEN, 'tools/list')).result.tools.map((t: any) => t.name)).toContain('create_post');
  });
  it('按令牌限流：每分钟 60 次', async () => {
    const tok = (await J(await post('/api/social/mcp/tokens', ann.token, { name: '限流', scope: 'read-public' }))).token;
    let s429 = 0;
    for (let i = 0; i < 62; i++) if ((await mcp(env, 'ping', {}, tok)).status === 429) s429++;
    expect(s429).toBeGreaterThan(0);
  });
});

// ============================================================ AI 辅助
describe('L20 AI assist（默认关闭、只给建议、发布需确认）', () => {
  it('关闭时 403；开启后返回带标签的建议且不写入任何内容', async () => {
    expect((await J(await get('/api/social/ai/status', bob.token))).enabled).toBe(false);
    expect((await post('/api/social/ai/suggest', bob.token, { kind: 'summary', title: 't', body: '一些内容一些内容' })).status).toBe(403);
    expect((await adm('/api/admin/ai', { enabled: true }, 'PUT')).status).toBe(200);
    const before = (await env.DB.prepare('SELECT COUNT(*) AS n FROM user_posts').first<{ n: number }>())!.n;
    const r = await J(await post('/api/social/ai/suggest', bob.token, { kind: 'summary', title: '江边夜景', body: '今晚在江边拍了夜景。长曝光让车流变成了光轨。' }));
    expect(r.suggestion).toMatchObject({ kind: 'summary', provider: 'local', label: 'AI 建议', generated: true });
    expect(r.suggestion.text.length).toBeGreaterThan(4);
    const tags = await J(await post('/api/social/ai/suggest', bob.token, { kind: 'tags', title: '摄影', body: '摄影 摄影' }));
    const topicSlugs = (await env.DB.prepare('SELECT slug FROM topics').all<{ slug: string }>()).results.map((t) => t.slug);
    for (const t of tags.suggestion.tags) expect(topicSlugs).toContain(t.slug);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM user_posts').first<{ n: number }>())!.n).toBe(before);
    expect((await post('/api/social/ai/suggest', undefined, { kind: 'summary', title: 't', body: 'xxxxxx' })).status).toBe(401);
  });
  it('采用了 AI 建议的内容：不确认不能发布', async () => {
    const r = await post('/api/social/works', bob.token, { type: 'short', body: 'AI 帮我写的摘要', visibility: 'public', aiAssisted: true, params: {}, media: [] });
    expect(r.status).toBe(400);
    expect((await J(r)).error.code).toBe('ai_unconfirmed');
    const ok = await newWork(bob, { body: 'AI 帮我写的摘要（已确认）', aiAssisted: true, aiConfirmed: true });
    expect(ok.aiAssisted).toBe(true);
    const draft = await newWork(bob, { body: 'AI 草稿', aiAssisted: true, draft: true });
    expect(draft.status).toBe('draft');
    expect((await post(`/api/social/works/${draft.id}/publish`, bob.token, {})).status).toBe(400);
    expect((await post(`/api/social/works/${draft.id}/publish`, bob.token, { aiConfirmed: true })).status).toBe(200);
    // 普通内容不受影响
    expect((await newWork(bob, { body: '普通内容' })).aiAssisted).toBe(false);
  });
});

// ============================================================ 邮件摘要订阅
describe('L20 email digest subscriptions', () => {
  it('默认没有订阅；主动订阅、限制、到期汇总、一键退订', async () => {
    expect((await J(await get('/api/social/subscriptions', bob.token))).subscriptions).toEqual([]);
    expect((await post('/api/social/subscriptions', bob.token, { kind: 'user', ref: 'bea20' })).status).toBe(400);
    expect((await post('/api/social/subscriptions', bob.token, { kind: 'user', ref: 'cat20' })).status).toBe(404); // 主页私密
    const s = await post('/api/social/subscriptions', bob.token, { kind: 'user', ref: 'ann20', frequency: 'daily' });
    expect(s.status).toBe(201);
    expect((await J(s)).subscription).toMatchObject({ kind: 'user', ref: 'ann20', frequency: 'daily' });
    expect((await J(await get('/api/social/subscriptions?kind=user&ref=ann20', bob.token))).subscriptions).toHaveLength(1);
    // 订阅之后 Ann 发布的新作品进入下一封摘要
    await env.DB.prepare("UPDATE digest_subscriptions SET created_at = '2026-01-01T00:00:00.000Z' WHERE member_id = ?").bind(bob.id).run();
    await newWork(ann, { body: '摘要里应该出现的新作品' });
    const before = testOutbox.length;
    const r = await sendDigests(env, new Date(Date.now() + 2 * 86400_000), 'https://blog.test/', 'https://blog.test');
    expect(r.emails).toBe(1);
    const mail = testOutbox.slice(before).find((m) => m.to === bob.email)!;
    expect(mail.text).toContain('摘要里应该出现的新作品');
    expect(mail.headers?.['List-Unsubscribe']).toMatch(/^<https:\/\/blog\.test\/api\/open\/unsubscribe\?t=/);
    // 没有新内容 → 不再发
    expect((await sendDigests(env, new Date(Date.now() + 5 * 86400_000), 'https://blog.test/', 'https://blog.test')).emails).toBe(0);
    const tok = /unsubscribe\?t=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
    const un = await get(`/api/open/unsubscribe?t=${tok}`);
    expect(un.status).toBe(200);
    expect(await un.text()).toContain('已退订全部邮件摘要');
    expect((await J(await get('/api/social/subscriptions', bob.token))).subscriptions).toEqual([]);
    expect((await get('/api/open/unsubscribe?t=short')).status).toBe(400);
  });
});

// ============================================================ GitHub 仓库元数据
describe('L20 GitHub repo metadata（服务端缓存、无令牌）', () => {
  let srv: Server;
  let hits = 0;
  let base = '';
  beforeAll(async () => {
    srv = createServer((req, res) => {
      hits++;
      if (req.headers.authorization) throw new Error('token sent');
      if (req.url === '/repos/fake-owner/fake-repo') {
        if (req.headers['if-none-match'] === '"v1"') return void res.writeHead(304).end();
        res.writeHead(200, { 'content-type': 'application/json', etag: '"v1"' });
        return void res.end(JSON.stringify({ full_name: 'fake-owner/fake-repo', description: '虚构仓库', html_url: 'https://github.com/fake-owner/fake-repo', stargazers_count: 42, forks_count: 3, open_issues_count: 1, language: 'TypeScript', license: { spdx_id: 'MIT' }, topics: ['blog'], pushed_at: '2026-10-01T00:00:00Z' }));
      }
      if (req.url === '/repos/fake-owner/fake-repo/releases/latest') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return void res.end(JSON.stringify({ tag_name: 'v1.2.0', name: '1.2', published_at: '2026-09-01T00:00:00Z', html_url: 'https://github.com/fake-owner/fake-repo/releases/tag/v1.2.0' }));
      }
      res.writeHead(404).end('{}');
    });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });
  afterAll(() => srv.close());
  it('第一次抓取、之后命中缓存、过期后 304 重新验证、不存在 404', async () => {
    const e2 = { ...env, GITHUB_API: base } as Env;
    const mk = async (slug: string, repoUrl: string) => expect((await worker.fetch(new Request('http://blog.test/api/social/projects', { method: 'POST', headers: { authorization: `Bearer ${ann.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ slug, title: slug, repoUrl, visibility: 'public' }) }) as never, e2)).status).toBe(201);
    await mk('gh-card', 'https://github.com/fake-owner/fake-repo');
    await mk('gh-missing', 'https://github.com/fake-owner/missing');
    const g = (slug: string) => worker.fetch(new Request(`http://blog.test/api/social/projects/${slug}/github`) as never, e2);
    const r1 = await J(await g('gh-card'));
    expect(r1).toMatchObject({ cached: false, stale: false, repo: { fullName: 'fake-owner/fake-repo', stars: 42, license: 'MIT', latestRelease: { tag: 'v1.2.0' } } });
    const h = hits;
    expect((await J(await g('gh-card'))).cached).toBe(true);
    expect(hits).toBe(h);
    await env.DB.prepare("UPDATE github_cache SET fetched_at = '2026-01-01T00:00:00.000Z'").run();
    const r3 = await J(await g('gh-card'));
    expect(r3.cached).toBe(true);
    expect(hits).toBe(h + 1);
    expect((await g('gh-missing')).status).toBe(404);
    // 上游挂了：返回旧缓存并标记 stale
    await env.DB.prepare("UPDATE github_cache SET fetched_at = '2026-01-01T00:00:00.000Z' WHERE repo = 'fake-owner/fake-repo'").run();
    const down = { ...env, GITHUB_API: 'http://127.0.0.1:1' } as Env;
    const r4 = await J(await worker.fetch(new Request('http://blog.test/api/social/projects/gh-card/github') as never, down));
    expect(r4).toMatchObject({ stale: true, repo: { stars: 42 } });
    const pf = await get('/api/feeds/projects/gh-card.atom');
    expect(pf.status).toBe(200);
    expect(wellFormed(await pf.text())).toBe(true);
  });
});
