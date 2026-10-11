/**
 * L19 实时层集成测试：用 wrangler 的本地开发服务器（unstable_dev → workerd）运行真实 Worker + DmHub Durable Object + 本地 D1，
 * 两个好朋友各开一条真正的 WebSocket：消息实时到达、断线后用 /dm/sync 补齐、撤回实时同步、未授权的票据被拒绝、非参与者收不到。
 * （getPlatformProxy 不能运行主脚本里的 DO 类；这里只用它往同一个本地 D1 里写测试账号。）
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { inject } from 'vitest';
import { unstable_dev } from 'wrangler';
import { disposeEnv, setupEnv } from './helpers';

type Dev = Awaited<ReturnType<typeof unstable_dev>>;
let dev: Dev;
let BASE = '';
const tokenOf = (n: string) => `m_${n.padEnd(24, 'x')}`;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
type U = { id: number; username: string; token: string };

async function api(path: string, token: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(BASE + path, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers: { authorization: `Bearer ${token}`, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
}

interface Sock { ws: any; got: any[]; wait: (pred: (e: any) => boolean, ms?: number) => Promise<any>; close: () => void }
async function connect(u: U, room?: string): Promise<Sock> {
  const t = await api('/api/social/dm/ticket', u.token, { body: room ? { room } : {} });
  expect(t.body.realtime).toBe(true);
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}${t.body.path}?ticket=${encodeURIComponent(t.body.ticket)}`);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('ws error')), { once: true });
  });
  const got: any[] = [];
  const waiters: { pred: (e: any) => boolean; res: (e: any) => void }[] = [];
  ws.addEventListener('message', (ev: any) => {
    const d = typeof ev.data === 'string' ? ev.data : '';
    const e = d === 'pong' ? { t: 'pong' } : JSON.parse(d);
    got.push(e);
    for (const w of [...waiters]) if (w.pred(e)) {
      waiters.splice(waiters.indexOf(w), 1);
      w.res(e);
    }
  });
  return {
    ws,
    got,
    wait: (pred, ms = 5000) =>
      new Promise((resolve, reject) => {
        const hit = got.find(pred);
        if (hit) return resolve(hit);
        const timer = setTimeout(() => reject(new Error('timeout waiting for ws event; got ' + JSON.stringify(got))), ms);
        waiters.push({ pred, res: (e) => (clearTimeout(timer), resolve(e)) });
      }),
    close: () => ws.close(1000, 'bye'),
  };
}

let A: U, B: U, C: U;
beforeAll(async () => {
  process.env.NO_PROXY = '127.0.0.1,localhost';
  const persist = inject('persist' as never) as string;
  dev = await unstable_dev('src/index.ts', {
    config: 'wrangler.jsonc',
    ip: '127.0.0.1',
    persistTo: persist,
    logLevel: 'error',
    vars: { JWT_SECRET: 'ws-test-secret-' + 'z'.repeat(32), ADMIN_PASSWORD_HASH: 'x', API_TOKEN_HASH: 'x', EMAIL_PROVIDER: 'console', ALLOWED_ORIGINS: 'http://localhost:5173' },
    experimental: { disableExperimentalWarning: true },
  } as never);
  BASE = `http://${dev.address}:${dev.port}`;
  // 测试账号直接写进同一个本地 D1（getPlatformProxy 与开发服务器共用持久化目录）
  const env = await setupEnv();
  const db = env.DB;
  const joined = new Date(Date.now() - 30 * 86400_000).toISOString();
  const mk = async (name: string, username: string): Promise<U> => {
    const r = (await db.prepare('INSERT INTO members (email, name, joined_at) VALUES (?, ?, ?) RETURNING id').bind(`${username}@example.com`, name, joined).first<{ id: number }>())!;
    const token = tokenOf(username);
    await db.batch([
      db.prepare('INSERT INTO member_sessions (token_hash, member_id, expires_at) VALUES (?, ?, ?)').bind(sha(token), r.id, Math.floor(Date.now() / 1000) + 3600),
      db.prepare('INSERT INTO user_profiles (member_id, username) VALUES (?, ?)').bind(r.id, username),
    ]);
    return { id: r.id, username, token };
  };
  A = await mk('Ada', 'ws_ada');
  B = await mk('Bo', 'ws_bo');
  C = await mk('Cy', 'ws_cy');
  await db.batch([
    db.prepare('INSERT INTO user_follows (follower_id, following_id) VALUES (?, ?)').bind(A.id, B.id),
    db.prepare('INSERT INTO user_follows (follower_id, following_id) VALUES (?, ?)').bind(B.id, A.id),
  ]);
}, 120_000);
afterAll(async () => {
  await dev?.stop();
  await disposeEnv();
});

describe('DmHub + WebSocket（workerd 本地运行时里的真实 Durable Object）', () => {
  let conv = 0;
  it('两个连接：A 发送 → B 的 WebSocket 实时收到；A 自己的其他标签页也收到', async () => {
    const s = await api('/api/social/dm/conversations', A.token, { body: { username: B.username } });
    expect(s.status).toBe(201);
    conv = s.body.conversation.id;
    const wb = await connect(B);
    const wa = await connect(A);
    await wb.wait((e) => e.t === 'hello');
    const sent = await api(`/api/social/dm/conversations/${conv}/messages`, A.token, { body: { body: '实时你好', clientId: 'ws-c-1' } });
    expect(sent.status).toBe(201);
    const ev = await wb.wait((e) => e.t === 'msg' && e.message.id === sent.body.message.id);
    expect(ev.message).toMatchObject({ body: '实时你好', mine: false, sender: { username: 'ws_ada' } });
    const mine = await wa.wait((e) => e.t === 'msg' && e.message.id === sent.body.message.id);
    expect(mine.message.mine).toBe(true);
    // ping → pong（运行时自动回复）
    wb.ws.send('ping');
    await wb.wait((e) => e.t === 'pong');
    // 浏览器经 WebSocket 发来的「写操作」被忽略：不会产生消息
    wb.ws.send(JSON.stringify({ t: 'send', conversationId: conv, body: '绕过 HTTP' }));
    const list = await api(`/api/social/dm/conversations/${conv}/messages`, B.token);
    expect(list.body.items.map((m: any) => m.body)).toEqual(['实时你好']);
    // 已读回执实时到达 A
    await api(`/api/social/dm/conversations/${conv}/read`, B.token, { body: { lastReadId: sent.body.message.id } });
    expect((await wa.wait((e) => e.t === 'read')).username).toBe('ws_bo');
    // DO 在线 → 在线状态为 true
    expect((await api('/api/social/dm/presence?u=ws_bo', A.token)).body.presence.ws_bo).toBe(true);
    wa.close();
    wb.close();
  });

  it('断线期间的消息与撤回：重连后用 since=seq 补齐，之后继续实时', async () => {
    const wb = await connect(B);
    const hello = await wb.wait((e) => e.t === 'hello');
    const since = hello.seq;
    wb.close();
    await new Promise((r) => setTimeout(r, 100));
    const m1 = await api(`/api/social/dm/conversations/${conv}/messages`, A.token, { body: { body: '你离线时的消息' } });
    const m2 = await api(`/api/social/dm/conversations/${conv}/messages`, A.token, { body: { body: '这条会撤回' } });
    expect((await api(`/api/social/dm/messages/${m2.body.message.id}/recall`, A.token, { body: {} })).status).toBe(200);
    const wb2 = await connect(B);
    await wb2.wait((e) => e.t === 'hello');
    const s = await api(`/api/social/dm/sync?since=${since}`, B.token);
    expect(s.body.events.map((e: any) => e.t)).toEqual(['msg', 'msg', 'recall']);
    expect(s.body.events[0].message.body).toBe('你离线时的消息');
    expect(s.body.events[1].message).toMatchObject({ id: m2.body.message.id, recalled: true, body: '' });
    expect(m1.status).toBe(201);
    const m3 = await api(`/api/social/dm/conversations/${conv}/messages`, A.token, { body: { body: '重连后实时' } });
    expect((await wb2.wait((e) => e.t === 'msg' && e.message.id === m3.body.message.id)).message.body).toBe('重连后实时');
    // 实时撤回
    await api(`/api/social/dm/messages/${m3.body.message.id}/recall`, A.token, { body: {} });
    expect((await wb2.wait((e) => e.t === 'recall' && e.messageId === m3.body.message.id)).conversationId).toBe(conv);
    wb2.close();
  });

  it('越权：伪造票据被拒；非参与者的连接收不到别人的消息；拉黑后不再推送', async () => {
    // 伪造票据：握手被拒绝（401），连接打不开
    const bad = new WebSocket(`${BASE.replace(/^http/, 'ws')}/api/social/dm/ws?ticket=eyJtIjoxfQ.deadbeef`);
    expect(await new Promise((r) => { bad.addEventListener('open', () => r('open')); bad.addEventListener('error', () => r('error')); })).toBe('error');
    const plain = await fetch(`${BASE}/api/social/dm/ws?ticket=x`);
    expect(plain.status).toBe(426);
    const wc = await connect(C);
    await wc.wait((e) => e.t === 'hello');
    const wb = await connect(B);
    await wb.wait((e) => e.t === 'hello');
    const m = await api(`/api/social/dm/conversations/${conv}/messages`, A.token, { body: { body: '只给 B' } });
    await wb.wait((e) => e.t === 'msg' && e.message.id === m.body.message.id);
    expect(wc.got.some((e) => e.t === 'msg')).toBe(false);
    // B 拉黑 A：A 发不出去，B 也不会再收到推送
    expect((await fetch(`${BASE}/api/social/blocks/ws_ada`, { method: 'POST', headers: { authorization: `Bearer ${B.token}` } })).status).toBe(200);
    expect((await api(`/api/social/dm/conversations/${conv}/messages`, A.token, { body: { body: '拉黑后' } })).body.error.code).toBe('not_found'); // 被拉黑方：会话不可见
    await new Promise((r) => setTimeout(r, 200));
    expect(wb.got.filter((e) => e.t === 'msg').map((e) => e.message.body)).toEqual(['只给 B']);
    wb.close();
    wc.close();
  });
});
