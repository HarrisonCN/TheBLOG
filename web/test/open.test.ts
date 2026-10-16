import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { DemoBackend, memoryKV, type KV } from '../src/demo/mock-api';
import { DEMO_OTP, DEMO_PASSWORD } from '../src/demo/seed';
import { feedPath, parseMf2 } from '../src/open-core';

let kv: KV;
let api: DemoBackend;
const clock = Date.parse('2026-10-11T08:00:00Z');
beforeEach(() => {
  kv = memoryKV();
  api = new DemoBackend({ storage: kv, base: '/TheBLOG/', now: () => new Date(clock) });
});
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const B = (r: { body: unknown }) => r.body as any;
type U = { token: string; id: number; username: string };
async function join(email: string, name: string, username: string): Promise<U> {
  expect((await api.handle('POST', '/api/members/register', { name, email })).status).toBe(200);
  const r = B(await api.handle('POST', '/api/members/verify', { email, code: DEMO_OTP }));
  expect((await api.handle('PUT', '/api/social/me', { username }, as(r.token))).status).toBe(200);
  return { token: r.token, id: r.member.id, username };
}
async function adminLogin(): Promise<Record<string, string>> {
  const r = B(await api.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD }));
  return { 'x-csrf-token': r.csrfToken };
}
const get = (p: string, u?: U) => api.handle('GET', p, undefined, u ? as(u.token) : {});
const post = (p: string, u: U | null, body: unknown = {}) => api.handle('POST', p, body, u ? as(u.token) : {});
const SITE = 'https://harrisoncn.github.io/TheBLOG/';
async function publicWork(u: U, body: string, extra: Record<string, unknown> = {}) {
  // 新会员前 2 条先审核：演示里先把规则调成 0
  const r = await post('/api/social/works', u, { type: 'short', title: '', body, caption: '', notes: '', params: {}, media: [], visibility: 'public', ...extra });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return B(r).work as { id: number; aiAssisted: boolean; status: string };
}
async function rules0() {
  const h = await adminLogin();
  expect((await api.handle('PUT', '/api/admin/ugc/rules', { reviewFirstN: 0 }, h)).status).toBe(200);
  return h;
}
const rpc = async (token: string, method: string, params?: unknown) => B(await api.handle('POST', '/mcp', { jsonrpc: '2.0', id: 1, method, params }, { authorization: `Bearer ${token}` }));

describe('L20 open-core 共享', () => {
  it('web 与 worker 的 open-core.ts 内容一致；迁移 0017 只做加法', () => {
    const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
    expect(read('../src/open-core.ts')).toBe(read('../../worker/src/open-core.ts'));
    const sql = read('../../worker/migrations/0017_open.sql').replace(/--.*$/gm, '');
    expect(sql).not.toMatch(/^\s*(DROP|UPDATE|DELETE)\b|ALTER TABLE \w+ (DROP|RENAME)/im);
    expect(sql).toMatch(/ALTER TABLE user_posts ADD COLUMN ai_assisted INTEGER NOT NULL DEFAULT 0/);
  });
  it('订阅源地址：Worker 动态源 / 演示站静态文件', () => {
    expect(feedPath({ kind: 'user', ref: 'momo' }, 'atom', { apiBase: '', base: '/' })).toBe('/api/feeds/users/momo.atom');
    expect(feedPath({ kind: 'topic', ref: 'night' }, 'json', { apiBase: 'https://api.x', base: '/' })).toBe('https://api.x/api/feeds/topics/night.json');
    expect(feedPath({ kind: 'project', ref: 'p1' }, 'rss', { apiBase: null, base: '/TheBLOG/' })).toBe('/TheBLOG/feeds/project/p1/rss.xml');
    expect(feedPath({ kind: 'site' }, 'atom', { apiBase: null, base: '/TheBLOG/' })).toBe('/TheBLOG/atom.xml');
  });
});

describe('L20 demo mock：Webmention', () => {
  it('种子：虚构站点的回复 / 喜欢 / 转发按类型分组，待审核的不公开', async () => {
    const r = B(await get('/api/webmentions?kind=post&ref=phone-night-photography'));
    expect(r.counts).toMatchObject({ reply: 1, like: 1, repost: 1 });
    expect(r.replies[0].author.name).toContain('虚构');
    expect(JSON.stringify(r)).not.toContain('等待站长审核');
    for (const m of [...r.replies, ...r.likes, ...r.reposts]) expect(new URL(m.source).hostname).toMatch(/\.example$/);
  });
  it('站内往返：作品链接到文章 → 发送 → 验证 → 待审核 → 站长通过 → 文章下显示；站外来源停在排队中', async () => {
    const h = await rules0();
    const ann = await join('ann@demo.test', 'Ann', 'ann_demo');
    const target = `${SITE}posts/welcome/`;
    const w = await publicWork(ann, `读完了 ${target} 很受用`);
    const send = B(await api.handle('POST', '/api/admin/webmentions/send', { kind: 'work', ref: w.id }, h));
    expect(send.results).toEqual([expect.objectContaining({ target, status: 'sent', httpStatus: 202 })]);
    const q = B(await api.handle('GET', '/api/admin/webmentions?status=pending', undefined, h));
    const item = q.items.find((i: any) => i.source === `${SITE}w/${w.id}/`);
    expect(item).toMatchObject({ status: 'pending', targetKind: 'post', targetRef: 'welcome', author: { name: 'Ann', url: `${SITE}u/ann_demo/` } });
    expect(B(await api.handle('GET', '/api/admin/ugc/queue?view=pending', undefined, h)).counts.webmentions).toBe(2);
    expect(B(await get('/api/webmentions?kind=post&ref=welcome')).total).toBe(0);
    expect((await api.handle('POST', `/api/admin/webmentions/${item.id}`, { action: 'approve' }, h)).status).toBe(200);
    const pub = B(await get(`/api/webmentions?target=${encodeURIComponent(target)}`));
    expect(pub.mentions[0]).toMatchObject({ type: 'mention', url: `${SITE}w/${w.id}/`, author: { name: 'Ann' } });
    // 站外来源：演示站不能抓取
    const ext = await api.handle('POST', '/api/webmention', { source: 'https://someone.example/post', target });
    expect(ext.status).toBe(202);
    expect(B(ext).status).toBe('queued');
    // 不链接 → invalid
    const w2 = await publicWork(ann, '这一条没有链接');
    const r2 = B(await api.handle('POST', '/api/webmention', { source: `${SITE}w/${w2.id}/`, target }));
    expect(r2.status).toBe('invalid');
    expect((await api.handle('POST', '/api/webmention', { source: 'https://x.example/', target: 'https://evil.example/w/1/' })).status).toBe(400);
  });
});

describe('L20 demo mock：MCP 分层令牌', () => {
  it('read-public 不能写；author 只能动自己的；令牌只返回一次、本地只存哈希；撤销后 401', async () => {
    await rules0();
    const ann = await join('ann2@demo.test', 'Ann', 'ann_mcp');
    const bob = await join('bob2@demo.test', 'Bob', 'bob_mcp');
    const annWork = await publicWork(ann, 'Ann 的作品');
    const bobWork = await publicWork(bob, 'Bob 的作品');
    const read = B(await post('/api/social/mcp/tokens', bob, { name: 'r', scope: 'read-public' }));
    const author = B(await post('/api/social/mcp/tokens', bob, { name: 'a', scope: 'author' }));
    expect(kv.getItem('blog-demo:db:v2')).not.toContain(read.token);
    expect((await post('/api/social/mcp/tokens', bob, { name: 'm', scope: 'moderator' })).status).toBe(400);
    const tools = (await rpc(read.token, 'tools/list')).result.tools.map((t: any) => t.name);
    expect(tools).toContain('search_public_works');
    expect(tools).not.toContain('update_my_work');
    const denied = (await rpc(read.token, 'tools/call', { name: 'update_my_work', arguments: { id: bobWork.id, body: 'x' } })).result;
    expect(denied.isError).toBe(true);
    expect(denied.content[0].text).toContain('insufficient_scope');
    const other = (await rpc(author.token, 'tools/call', { name: 'update_my_work', arguments: { id: annWork.id, body: '篡改' } })).result;
    expect(other.isError).toBe(true);
    expect(other.content[0].text).toContain('not_found');
    expect(B(await get(`/api/social/works/${annWork.id}`)).work.body).toBe('Ann 的作品');
    const mine = (await rpc(author.token, 'tools/call', { name: 'update_my_work', arguments: { id: bobWork.id, body: 'Bob 通过 MCP 修改' } })).result;
    expect(mine.isError).toBe(false);
    expect(B(await get(`/api/social/works/${bobWork.id}`)).work.body).toBe('Bob 通过 MCP 修改');
    expect((await rpc(author.token, 'tools/call', { name: 'create_post', arguments: {} })).result.content[0].text).toContain('insufficient_scope');
    const audit = B(await get('/api/social/mcp/audit', bob)).audit;
    expect(audit.some((a: any) => a.code === 'insufficient_scope')).toBe(true);
    const list = B(await get('/api/social/mcp/tokens', bob)).tokens;
    expect((await api.handle('DELETE', `/api/social/mcp/tokens/${list.find((t: any) => t.name === 'r').id}`, undefined, as(bob.token))).status).toBe(200);
    expect((await api.handle('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: `Bearer ${read.token}` })).status).toBe(401);
  });
});

describe('L20 demo mock：AI / 订阅 / GitHub / 开放接口 / 订阅源', () => {
  it('AI 默认关闭；开启后只给建议；采用后发布必须确认', async () => {
    const h = await rules0();
    const ann = await join('ann3@demo.test', 'Ann', 'ann_ai');
    expect(B(await get('/api/social/ai/status', ann)).enabled).toBe(false);
    expect((await post('/api/social/ai/suggest', ann, { kind: 'summary', title: 't', body: '一些内容一些内容' })).status).toBe(403);
    expect((await api.handle('PUT', '/api/admin/ai', { enabled: true }, h)).status).toBe(200);
    const s = B(await post('/api/social/ai/suggest', ann, { kind: 'tags', title: '夜景', body: '夜景 长曝光 夜景' }));
    expect(s.suggestion).toMatchObject({ kind: 'tags', label: 'AI 建议', generated: true });
    expect((await post('/api/social/works', ann, { type: 'short', body: 'AI 摘要', visibility: 'public', params: {}, media: [], aiAssisted: true })).status).toBe(400);
    expect((await publicWork(ann, 'AI 摘要（已确认）', { aiAssisted: true, aiConfirmed: true })).aiAssisted).toBe(true);
  });
  it('邮件订阅：默认没有、主动订阅、不能订阅自己', async () => {
    const ann = await join('ann4@demo.test', 'Ann', 'ann_sub');
    expect(B(await get('/api/social/subscriptions', ann)).subscriptions).toEqual([]);
    expect((await post('/api/social/subscriptions', ann, { kind: 'user', ref: 'ann_sub' })).status).toBe(400);
    expect((await post('/api/social/subscriptions', ann, { kind: 'user', ref: 'momo' })).status).toBe(201);
    expect((await post('/api/social/subscriptions', ann, { kind: 'topic', ref: 'photography', frequency: 'daily' })).status).toBe(201);
    expect(B(await get('/api/social/subscriptions', ann)).subscriptions).toHaveLength(2);
  });
  it('GitHub：种子项目返回虚构快照，其它仓库说明演示站不联网', async () => {
    const r = await get('/api/social/projects/night-presets/github');
    expect(r.status).toBe(200);
    expect(B(r)).toMatchObject({ source: 'demo-snapshot', repo: { fullName: 'example/night-presets' } });
  });
  it('开放接口游标分页 + 订阅源格式', async () => {
    const p1 = B(await get('/api/open/v1/works?limit=1'));
    expect(p1.works).toHaveLength(1);
    const p2 = B(await get(`/api/open/v1/works?limit=1&cursor=${p1.nextCursor}`));
    expect(p2.works[0].id).not.toBe(p1.works[0].id);
    expect((await get('/api/open/v1/works?cursor=%%')).status).toBe(400);
    const atom = B(await get('/api/feeds/users/momo.atom')) as string;
    expect(atom).toContain('<feed xmlns="http://www.w3.org/2005/Atom"');
    expect(atom).toContain(`${SITE}w/1/`);
    const jf = JSON.parse(B(await get('/api/feeds/topics/photography.json')));
    expect(jf.version).toBe('https://jsonfeed.org/version/1.1');
    const sc = api.openFeeds().feedScopes();
    expect(sc.users).toContain('momo');
    expect(sc.projects).toContain('night-presets');
  });
  it('h-entry 解析器能读出演示站作品页的微格式（客户端渲染的结构）', () => {
    const doc = parseMf2(`<article class="h-entry"><a class="u-url" href="/TheBLOG/w/1/">#</a><span class="p-author h-card"><a class="p-name u-url" href="/TheBLOG/u/momo/">Momo</a></span><div class="e-content">长曝光</div></article>`, SITE);
    expect(doc.items[0]!.properties.url).toEqual(['https://harrisoncn.github.io/TheBLOG/w/1/']);
  });
});
