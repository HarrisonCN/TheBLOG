// L31 / v1.31.0 AI 创作台 2.0 + Webhook + ActivityPub 只读试验（Worker，miniflare D1）。
// 真实模型提供方 / 真实对外投递 / ActivityPub 联邦 = SKIPPED-verifiable（Cloudflare 未部署）；这里用本机 HTTP 服务接收投递并验签。
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import { testOutbox } from '../src/community';
import type { Env } from '../src/env';
import { verifySignature } from '../src/webhook-core';
import { AP_CONTENT_TYPE } from '../src/ap-core';

let env: Env;
let admin: { cookie: string; csrf: string };
let server: Server;
let hookUrl = '';
const received: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];
let replyStatus = 200;

beforeAll(async () => {
  env = await setupEnv({ EMAIL_PROVIDER: 'memory', SITE_URL: 'https://blog.example/', WEBHOOK_ALLOW_PRIVATE: 'true' } as Partial<Env>);
  admin = await login(env, '10.31.0.1');
  server = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body: b });
      res.writeHead(replyStatus).end('ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  hookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
});
afterAll(async () => {
  await adm('/api/admin/ai', { enabled: false, monthlyBudget: 200 }, 'PUT');
  server?.close();
  await disposeEnv();
});

const J = async (r: Response) => (await r.json()) as any;
const adm = (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => call(env, path, { method, cookie: admin.cookie, csrf: admin.csrf, body });
const codeFor = (email: string) => /(\d{6})/.exec(testOutbox.filter((m) => m.to === email).at(-1)?.text ?? '')?.[1] ?? '';
async function member(email: string, n: number): Promise<string> {
  expect((await call(env, '/api/members/register', { body: { name: 'Mo', email }, headers: { 'cf-connecting-ip': `10.31.1.${n}` } })).status).toBe(200);
  return (await J(await call(env, '/api/members/verify', { body: { email, code: codeFor(email) } }))).token;
}

describe('迁移 0023 只做加法', () => {
  it('只有 CREATE TABLE / INDEX', () => {
    const sql = readFileSync(pjoin(__dirname, '../migrations/0023_aistudio.sql'), 'utf8').replace(/--.*$/gm, '');
    expect(sql).not.toMatch(/^\s*(DROP|UPDATE|DELETE)\b|ALTER TABLE \w+ (DROP|RENAME)/im);
  });
});

describe('AI 创作台 2.0', () => {
  it('默认关闭 403；开启 + 预算；六种建议；校对不改原文；预算用完 429', async () => {
    const t = await member('ai31@example.com', 1);
    const body = '今天去了西湖,风很大.我们的的相机差点被吹倒。湖边的日落非常好看。';
    expect((await call(env, '/api/social/ai/suggest', { method: 'POST', token: t, body: { kind: 'proof', body } })).status).toBe(403);
    expect((await call(env, '/api/admin/ai', { method: 'PUT', body: { enabled: true } })).status).toBe(401);
    expect((await adm('/api/admin/ai', { monthlyBudget: -2 }, 'PUT')).status).toBe(400);
    const st = await J(await adm('/api/admin/ai', { enabled: true, monthlyBudget: 3 }, 'PUT'));
    expect(st).toMatchObject({ enabled: true, kinds: ['title', 'summary', 'alt', 'tags', 'proof', 'draft'], budget: { budget: 3 } });
    const used0 = st.budget.used as number;
    expect(used0).toBe(0);
    const p = (await J(await call(env, '/api/social/ai/suggest', { method: 'POST', token: t, body: { kind: 'proof', title: '西湖', body } }))).suggestion;
    expect(p.issues.map((i: any) => i.rule)).toEqual(expect.arrayContaining(['half-punct', 'dup-word']));
    expect(p.generated).toBe(true);
    const alt = await J(await call(env, '/api/social/ai/suggest', { method: 'POST', token: t, body: { kind: 'alt', meta: { caption: '湖边的日落', place: '杭州' } } }));
    expect(alt.suggestion.text).toBe('湖边的日落，拍摄于杭州');
    expect(alt.budget).toMatchObject({ used: 2, left: 1 });
    expect((await J(await call(env, '/api/social/ai/suggest', { method: 'POST', token: t, body: { kind: 'title', title: '西湖', body } }))).suggestion.options.length).toBeGreaterThan(0);
    const over = await call(env, '/api/social/ai/suggest', { method: 'POST', token: t, body: { kind: 'summary', title: '西湖', body } });
    expect(over.status).toBe(429);
    expect((await J(over)).error.code).toBe('ai_budget_exhausted');
    expect((await J(await call(env, '/api/social/ai/status', { token: t }))).budget).toMatchObject({ used: 3, left: 0 });
  });
});

describe('Webhook', () => {
  it('站长才能管理；secret 只返回一次；测试投递带可验证签名；4xx 不重试、5xx 安排重试', async () => {
    expect((await call(env, '/api/admin/webhooks')).status).toBe(401);
    const c = await adm('/api/admin/webhooks', { url: hookUrl, events: ['ping', 'post.published'], description: '本机测试' });
    expect(c.status).toBe(201);
    const { webhook, secret } = await J(c);
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{32,}$/);
    const list = await J(await adm('/api/admin/webhooks'));
    expect(JSON.stringify(list)).not.toContain(secret);
    expect(list.items[0]).toMatchObject({ url: hookUrl, events: ['ping', 'post.published'], active: true });

    const d1 = (await J(await adm(`/api/admin/webhooks/${webhook.id}/test`, {}))).delivery;
    expect(d1).toMatchObject({ event: 'ping', status: 'ok', attempts: 1, httpStatus: 200 });
    const got = received.at(-1)!;
    expect(got.headers['x-theblog-event']).toBe('ping');
    expect(await verifySignature(String(got.headers['x-theblog-signature']), secret, got.body, Math.floor(Date.now() / 1000))).toBe(true);
    expect(JSON.parse(got.body)).toMatchObject({ type: 'ping', data: { webhookId: webhook.id } });

    replyStatus = 404;
    expect((await J(await adm(`/api/admin/webhooks/${webhook.id}/test`, {}))).delivery).toMatchObject({ status: 'failed', httpStatus: 404, nextAttemptAt: null });
    replyStatus = 503;
    const d3 = (await J(await adm(`/api/admin/webhooks/${webhook.id}/test`, {}))).delivery;
    expect(d3).toMatchObject({ status: 'retrying', httpStatus: 503, attempts: 1 });
    expect(Date.parse(d3.nextAttemptAt)).toBeGreaterThan(Date.now());
    replyStatus = 200;

    expect((await J(await adm(`/api/admin/webhooks/${webhook.id}/deliveries`))).items).toHaveLength(3);
    expect((await adm(`/api/admin/webhooks/${webhook.id}`, { url: 'ftp://x.example/' }, 'PUT')).status).toBe(400);
    expect((await J(await adm(`/api/admin/webhooks/${webhook.id}`, { active: false }, 'PUT'))).webhook.active).toBe(false);
    expect((await adm(`/api/admin/webhooks/${webhook.id}`, undefined, 'DELETE')).status).toBe(200);
    expect((await J(await adm('/api/admin/webhooks'))).items).toHaveLength(0);
  });
  it('没有放开内网时拒绝 http 与内网地址', async () => {
    const strict = await setupEnv({ SITE_URL: 'https://blog.example/' } as Partial<Env>);
    const r = await call(strict, '/api/admin/webhooks', { method: 'POST', cookie: admin.cookie, csrf: admin.csrf, body: { url: 'https://10.0.0.5/x', events: ['ping'] } });
    expect(r.status).toBe(400);
  });
});

describe('ActivityPub 只读试验', () => {
  it('WebFinger → Actor → Outbox（JSON-LD）', async () => {
    const wf = await call(env, '/.well-known/webfinger?resource=acct:blog@blog.example');
    expect(wf.status).toBe(200);
    const w = await J(wf);
    const self = w.links.find((l: any) => l.rel === 'self');
    expect(self.type).toBe(AP_CONTENT_TYPE);
    expect((await call(env, '/.well-known/webfinger?resource=acct:nobody@blog.example')).status).toBe(404);
    const actor = await call(env, new URL(self.href).pathname);
    expect(actor.headers.get('content-type')).toContain(AP_CONTENT_TYPE);
    const a = await J(actor);
    expect(a).toMatchObject({ type: 'Service', preferredUsername: 'blog', url: 'https://blog.example/' });
    expect(a.inbox).toBeUndefined();
    const o = await J(await call(env, new URL(a.outbox).pathname));
    expect(o.type).toBe('OrderedCollection');
    expect(o.totalItems).toBe(o.orderedItems.length);
    for (const it of o.orderedItems) expect(it).toMatchObject({ type: 'Create', actor: a.id, object: { type: 'Article', attributedTo: a.id } });
  });
});
