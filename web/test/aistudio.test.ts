/**
 * L31 / v1.31.0 AI 创作台 2.0 + 开放网络 2.0：
 * - AI 建议扩展到 标题 / 摘要 / 替代文字 / 标签 / 校对（+ 原来的提纲），全部只在点击时生成、作者确认才写入；
 *   站长默认关闭，每月预算上限（按上海时间分月），用完返回 429；校对只给出可逐条采用的修改，不会自动改文；
 * - Webhook：签名（t=…,v1=HMAC-SHA256）、校验（时间容差）、重试退避、只允许 https 公网地址；
 * - ActivityPub 只读试验：WebFinger、Actor、Outbox（JSON-LD）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { DemoBackend, memoryKV, type KV } from '../src/demo/mock-api';
import { DEMO_OTP, DEMO_PASSWORD } from '../src/demo/seed';
import {
  AI2_KINDS, AI_BUDGET_DEFAULT, aiMonth, applyFixes, budgetState, checkAi2Input, checkAiConfig, proofread, suggestAlt, suggestTitles,
} from '../src/ai-core';
import {
  WEBHOOK_EVENTS, WEBHOOK_MAX_ATTEMPTS, checkWebhookInput, isRetryableStatus, nextRetryAt, signatureHeader, verifySignature,
} from '../src/webhook-core';
import { AP_CONTENT_TYPE, apActor, apOutbox, webfinger } from '../src/ap-core';

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

describe('共享代码与迁移', () => {
  it('web 与 worker 的 ai-core / webhook-core / ap-core 一致；迁移 0023 只做加法', () => {
    for (const f of ['ai-core.ts', 'webhook-core.ts', 'ap-core.ts']) expect(read(`../src/${f}`)).toBe(read(`../../worker/src/${f}`));
    const sql = read('../../worker/migrations/0023_aistudio.sql').replace(/--.*$/gm, '');
    expect(sql).not.toMatch(/^\s*(DROP|UPDATE|DELETE)\b|ALTER TABLE \w+ (DROP|RENAME)/im);
    for (const t of ['ai_usage', 'webhooks', 'webhook_deliveries']) expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`));
  });
});

describe('ai-core：设置与预算', () => {
  it('六种建议；默认预算；按上海时间分月', () => {
    expect([...AI2_KINDS]).toEqual(['title', 'summary', 'alt', 'tags', 'proof', 'draft']);
    expect(AI_BUDGET_DEFAULT).toBeGreaterThan(0);
    expect(aiMonth(new Date('2026-10-31T16:30:00Z'))).toBe('2026-11'); // 上海已是 11 月 1 日 00:30
    expect(aiMonth(new Date('2026-10-31T15:59:00Z'))).toBe('2026-10');
  });
  it('预算状态与设置校验', () => {
    expect(budgetState(3, 10)).toEqual({ used: 3, budget: 10, left: 7, exhausted: false });
    expect(budgetState(12, 10)).toMatchObject({ left: 0, exhausted: true });
    expect(budgetState(0, 0).exhausted).toBe(true);
    expect(checkAiConfig({ enabled: true })).toMatchObject({ ok: true, value: { enabled: true } });
    expect(checkAiConfig({ monthlyBudget: 50 })).toMatchObject({ ok: true, value: { monthlyBudget: 50 } });
    expect(checkAiConfig({ monthlyBudget: -1 }).ok).toBe(false);
    expect(checkAiConfig({ monthlyBudget: 1.5 }).ok).toBe(false);
    expect(checkAiConfig({ monthlyBudget: 100001 }).ok).toBe(false);
    expect(checkAiConfig({ enabled: 'yes' }).ok).toBe(false);
    expect(checkAiConfig({}).ok).toBe(false);
  });
  it('输入校验：kind；替代文字可以只给图片说明', () => {
    expect(checkAi2Input({ kind: 'nope', body: '一些内容在这里' }).ok).toBe(false);
    expect(checkAi2Input({ kind: 'proof', body: '这是一段正文。' })).toMatchObject({ ok: true });
    expect(checkAi2Input({ kind: 'alt', meta: { caption: '湖边的日落' } })).toMatchObject({ ok: true });
    expect(checkAi2Input({ kind: 'alt', meta: {} }).ok).toBe(false);
    expect(checkAi2Input({ kind: 'title', body: '短' }).ok).toBe(false);
  });
});

describe('ai-core：校对（只给建议，逐条采用）', () => {
  it('中文里的半角标点、重复的虚词、重复标点', () => {
    const text = '今天去了西湖,风很大.我们的的相机差点被吹倒，，还好没事';
    const issues = proofread(text);
    const rules = issues.map((i) => `${i.rule}:${i.found}→${i.replace}`);
    expect(rules).toContain('half-punct:,→，');
    expect(rules).toContain('half-punct:.→。');
    expect(rules).toContain('dup-word:的的→的');
    expect(rules).toContain('dup-punct:，，→，');
    for (const i of issues) expect(text.slice(i.start, i.end)).toBe(i.found);
    expect(applyFixes(text, issues)).toBe('今天去了西湖，风很大。我们的相机差点被吹倒，还好没事');
    // 只采用选中的
    const one = issues.find((i) => i.rule === 'dup-word')!;
    expect(applyFixes(text, issues, [one.id])).toBe('今天去了西湖,风很大.我们的相机差点被吹倒，，还好没事');
  });
  it('不误伤：小数、网址、英文句子、代码、叠词', () => {
    expect(proofread('镜头是 2.8 光圈，见 https://example.com/a.b,c 页面')).toEqual([]);
    expect(proofread('Hello, world. This is fine.')).toEqual([]);
    expect(proofread('代码 `a,b.c` 和\n```\nx = 1,2.\n```\n结束')).toEqual([]);
    expect(proofread('慢慢走，看看风景，常常回来')).toEqual([]);
  });
  it('重叠或越界的修改被跳过；id 稳定', () => {
    const t = '好的的的';
    const issues = proofread(t);
    expect(applyFixes(t, issues)).toBe('好的');
    expect(proofread(t).map((i) => i.id)).toEqual(issues.map((i) => i.id));
    expect(applyFixes('abc', [{ id: 'x', start: 5, end: 9, found: 'zz', replace: 'y', rule: 'half-punct', message: '' }])).toBe('abc');
  });
});

describe('ai-core：标题与替代文字（不编造）', () => {
  it('标题候选来自作者自己的句子，去掉句末标点，最多 3 个，排除当前标题', () => {
    const body = '这次在桂林拍了三天的山水。清晨的漓江有很重的雾。我用长曝光拍了遇龙河的竹筏。最后一天下雨了。';
    const t = suggestTitles('桂林三日', body);
    expect(t.length).toBeGreaterThan(0);
    expect(t.length).toBeLessThanOrEqual(3);
    for (const s of t) {
      expect(body.replace(/[。]/g, '')).toContain(s.replace(/…$/, ''));
      expect(s).not.toMatch(/[。！？，]$/);
      expect([...s].length).toBeLessThanOrEqual(28);
    }
    expect(suggestTitles('', '')).toEqual([]);
  });
  it('替代文字只用给出的信息：说明 / 标题 / 地点；相机文件名不算', () => {
    expect(suggestAlt({ caption: '湖边的日落。很美', place: '杭州' })).toBe('湖边的日落，拍摄于杭州');
    expect(suggestAlt({ title: '夜里的港口' })).toBe('夜里的港口');
    expect(suggestAlt({ filename: 'IMG_1234.JPG' })).toBe('');
    expect(suggestAlt({ filename: 'west-lake-boat.jpg' })).toBe('west lake boat');
    expect([...suggestAlt({ caption: '长'.repeat(400) })].length).toBeLessThanOrEqual(200);
  });
});

describe('webhook-core', () => {
  it('输入校验：https 公网地址、事件子集、数量上限', () => {
    expect(checkWebhookInput({ url: 'https://hooks.example.com/blog', events: ['work.published'] })).toMatchObject({ ok: true, value: { url: 'https://hooks.example.com/blog', events: ['work.published'], active: true } });
    expect(checkWebhookInput({ url: 'http://hooks.example.com/x', events: ['work.published'] }).ok).toBe(false);
    expect(checkWebhookInput({ url: 'https://127.0.0.1/x', events: ['work.published'] }).ok).toBe(false);
    expect(checkWebhookInput({ url: 'https://192.168.1.2/x', events: ['work.published'] }).ok).toBe(false);
    expect(checkWebhookInput({ url: 'http://127.0.0.1:9/x', events: ['work.published'] }, { allowPrivate: true }).ok).toBe(true);
    expect(checkWebhookInput({ url: 'https://a.example/x', events: [] }).ok).toBe(false);
    expect(checkWebhookInput({ url: 'https://a.example/x', events: ['nope'] }).ok).toBe(false);
    expect(WEBHOOK_EVENTS).toContain('post.published');
    expect(WEBHOOK_EVENTS).toContain('ping');
  });
  it('签名：t=…,v1=HMAC-SHA256(t.body)；改动正文 / 密钥 / 过期都校验失败', async () => {
    const secret = 'whsec_test_secret_value_0123456789';
    const body = JSON.stringify({ id: 'evt_1', type: 'ping' });
    const h = await signatureHeader(secret, 1760500000, body);
    // 参考值：printf '1760500000.{"id":"evt_1","type":"ping"}' | openssl dgst -sha256 -hmac whsec_test_secret_value_0123456789
    expect(h).toMatch(/^t=1760500000,v1=[0-9a-f]{64}$/);
    expect(h).toBe('t=1760500000,v1=' + REF_SIG);
    expect(await verifySignature(h, secret, body, 1760500100)).toBe(true);
    expect(await verifySignature(h, secret, body + ' ', 1760500100)).toBe(false);
    expect(await verifySignature(h, 'whsec_other', body, 1760500100)).toBe(false);
    expect(await verifySignature(h, secret, body, 1760500000 + 301)).toBe(false);
    expect(await verifySignature('garbage', secret, body, 1760500000)).toBe(false);
  });
  it('重试：网络错误 / 408 / 429 / 5xx 重试，其他 4xx 不重试；退避递增，次数用完返回 null', () => {
    expect([0, 408, 429, 500, 503].every(isRetryableStatus)).toBe(true);
    expect([400, 401, 404, 410].some(isRetryableStatus)).toBe(false);
    const t0 = 1_000_000;
    const ds = Array.from({ length: WEBHOOK_MAX_ATTEMPTS - 1 }, (_, i) => nextRetryAt(i + 1, t0)! - t0);
    for (let i = 1; i < ds.length; i++) expect(ds[i]!).toBeGreaterThan(ds[i - 1]!);
    expect(nextRetryAt(WEBHOOK_MAX_ATTEMPTS, t0)).toBeNull();
  });
});

describe('ap-core：ActivityPub 只读', () => {
  const site = { url: 'https://blog.example/', apiBase: 'https://api.blog.example', title: '示例博客', description: '演示', icon: 'https://blog.example/icon.png', handle: 'blog' };
  it('WebFinger 只认 acct:blog@域名', () => {
    const wf = webfinger('acct:blog@blog.example', site)!;
    expect(wf.subject).toBe('acct:blog@blog.example');
    expect(wf.links.find((l) => l.rel === 'self')).toMatchObject({ type: AP_CONTENT_TYPE, href: 'https://api.blog.example/api/ap/actor' });
    expect(webfinger('acct:other@blog.example', site)).toBeNull();
    expect(webfinger('acct:blog@evil.example', site)).toBeNull();
  });
  it('Actor / Outbox 是合法的 JSON-LD（只读：没有 inbox 写入能力的说明）', () => {
    const a = apActor(site);
    expect(a['@context']).toContain('https://www.w3.org/ns/activitystreams');
    expect(a).toMatchObject({ type: 'Service', id: 'https://api.blog.example/api/ap/actor', preferredUsername: 'blog', outbox: 'https://api.blog.example/api/ap/outbox', url: 'https://blog.example/' });
    const o = apOutbox(site, [{ id: 'https://blog.example/posts/hello/', url: 'https://blog.example/posts/hello/', title: '你好 <b>世界</b>', summary: '摘要 & 说明', published: '2026-10-01T00:00:00Z', tags: ['摄影'] }]);
    expect(o).toMatchObject({ type: 'OrderedCollection', totalItems: 1 });
    const act = o.orderedItems[0]!;
    expect(act).toMatchObject({ type: 'Create', actor: a.id, published: '2026-10-01T00:00:00Z' });
    expect(act.object).toMatchObject({ type: 'Article', id: 'https://blog.example/posts/hello/', attributedTo: a.id, name: '你好 <b>世界</b>' });
    expect(act.object.content).toBe('<p>摘要 &amp; 说明</p>');
    expect(act.object.tag[0]).toMatchObject({ type: 'Hashtag', name: '#摄影' });
    expect(act.to).toEqual(['https://www.w3.org/ns/activitystreams#Public']);
  });
});

// ---------------------------------------------------------------- 演示 mock：与 Worker 同规则
let kv: KV;
let api: DemoBackend;
const clock = Date.parse('2026-10-15T08:00:00Z');
beforeEach(() => {
  kv = memoryKV();
  api = new DemoBackend({ storage: kv, base: '/TheBLOG/', now: () => new Date(clock) });
});
const as = (t: string) => ({ authorization: `Bearer ${t}` });
const B = (r: { body: unknown }) => r.body as any;
async function member(email = 'm31@example.com') {
  await api.handle('POST', '/api/members/register', { name: 'Mo', email });
  return B(await api.handle('POST', '/api/members/verify', { email, code: DEMO_OTP })).token as string;
}
/** 演示站的站长登录：会话 + CSRF（与 open.test.ts 相同） */
let admin: Record<string, string> = {};
async function adminLogin() {
  const r = B(await api.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD }));
  admin = { 'x-csrf-token': r.csrfToken };
}

describe('演示 mock：AI 创作台 2.0', () => {
  it('默认关闭；开启后六种建议都可用；预算用完 429；新的月份重置', async () => {
    const t = await member();
    const body = '今天去了西湖,风很大.我们的的相机差点被吹倒。湖边的日落非常好看。';
    expect((await api.handle('POST', '/api/social/ai/suggest', { kind: 'proof', body }, as(t))).status).toBe(403);
    expect(B(await api.handle('GET', '/api/social/ai/status', undefined, as(t)))).toMatchObject({ enabled: false });
    await adminLogin();
    expect((await api.handle('PUT', '/api/admin/ai', { enabled: true, monthlyBudget: 3 }, admin)).status).toBe(200);
    const st = B(await api.handle('GET', '/api/social/ai/status', undefined, as(t)));
    expect(st).toMatchObject({ enabled: true, kinds: [...AI2_KINDS], budget: { month: '2026-10', used: 0, budget: 3, left: 3 } });
    const p = B(await api.handle('POST', '/api/social/ai/suggest', { kind: 'proof', title: '西湖', body }, as(t))).suggestion;
    expect(p.kind).toBe('proof');
    expect(p.issues.length).toBeGreaterThanOrEqual(3);
    expect(p.generated).toBe(true);
    const ti = B(await api.handle('POST', '/api/social/ai/suggest', { kind: 'title', title: '西湖', body }, as(t))).suggestion;
    expect(ti.options.length).toBeGreaterThan(0);
    const alt = B(await api.handle('POST', '/api/social/ai/suggest', { kind: 'alt', meta: { caption: '湖边的日落', place: '杭州' } }, as(t))).suggestion;
    expect(alt.text).toBe('湖边的日落，拍摄于杭州');
    const over = await api.handle('POST', '/api/social/ai/suggest', { kind: 'summary', title: '西湖', body }, as(t));
    expect(over.status).toBe(429);
    expect(B(over).error.code).toBe('ai_budget_exhausted');
    expect(B(await api.handle('GET', '/api/admin/ai', undefined, admin))).toMatchObject({ enabled: true, budget: { used: 3, budget: 3, left: 0 } });
    // 下个月（上海时间）重置
    const next = new DemoBackend({ storage: kv, base: '/TheBLOG/', now: () => new Date('2026-11-01T00:00:00Z') });
    expect((await next.handle('POST', '/api/social/ai/suggest', { kind: 'summary', title: '西湖', body }, as(t))).status).toBe(200);
  });
});

describe('演示 mock：Webhook', () => {
  it('站长增删改；密钥只在创建时返回一次；测试投递生成签名但演示站不真正发送', async () => {
    expect((await api.handle('GET', '/api/admin/webhooks', undefined, {})).status).toBe(401);
    await adminLogin();
    const c = await api.handle('POST', '/api/admin/webhooks', { url: 'https://hooks.example.com/blog', events: ['work.published', 'post.published'], description: '示例' }, admin);
    expect(c.status).toBe(201);
    const hook = B(c).webhook;
    expect(B(c).secret).toMatch(/^whsec_[A-Za-z0-9_-]{32,}$/);
    const list = B(await api.handle('GET', '/api/admin/webhooks', undefined, admin)).items;
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(B(c).secret);
    expect((await api.handle('POST', '/api/admin/webhooks', { url: 'http://insecure.example/x', events: ['ping'] }, admin)).status).toBe(400);
    const test = B(await api.handle('POST', `/api/admin/webhooks/${hook.id}/test`, {}, admin));
    expect(test.delivery).toMatchObject({ event: 'ping', status: 'demo' });
    expect(await verifySignature(test.delivery.signature, B(c).secret, test.delivery.body, Math.floor(clock / 1000))).toBe(true);
    expect(B(await api.handle('GET', `/api/admin/webhooks/${hook.id}/deliveries`, undefined, admin)).items).toHaveLength(1);
    expect(B(await api.handle('PUT', `/api/admin/webhooks/${hook.id}`, { active: false }, admin)).webhook.active).toBe(false);
    expect((await api.handle('DELETE', `/api/admin/webhooks/${hook.id}`, undefined, admin)).status).toBe(200);
    expect(B(await api.handle('GET', '/api/admin/webhooks', undefined, admin)).items).toHaveLength(0);
  });
});

/** 由 openssl 生成的参考签名（见上方注释），不是用被测代码算出来的。 */
const REF_SIG = '49d835c574537be081b7e94f5cc5cf68950e6b6ddcba243e9baece0335c9468d';
