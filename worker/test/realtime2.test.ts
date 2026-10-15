// L30 / v1.30.0 实时社交 2.0（Worker，miniflare D1 + R2）：私信图片 / 语音（替代文字、类型嗅探、去 EXIF、只有会话成员能取）、
// 消息搜索（只搜自己的会话）、clientId 幂等、跨设备阅读同步（合并 + rev）。真实 D1 / R2 = SKIPPED-verifiable（Cloudflare 未部署）。
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, setupEnv } from './helpers';
import { testOutbox } from '../src/community';
import type { Env } from '../src/env';
import { readExif } from '../src/exif';

let env: Env;
beforeAll(async () => {
  env = await setupEnv({ EMAIL_PROVIDER: 'memory' });
});
afterAll(async () => {
  await disposeEnv();
});

const ip = (n: number) => ({ 'cf-connecting-ip': `10.30.1.${n}` });
const codeFor = (email: string) => /(\d{6})/.exec(testOutbox.filter((m) => m.to === email).at(-1)?.text ?? '')?.[1] ?? '';
type U = { token: string; id: number; username: string };
async function join(email: string, name: string, username: string, n: number): Promise<U> {
  expect((await call(env, '/api/members/register', { body: { name, email }, headers: ip(n) })).status).toBe(200);
  const b = (await (await call(env, '/api/members/verify', { body: { email, code: codeFor(email) } })).json()) as any;
  expect((await call(env, '/api/social/me', { method: 'PUT', token: b.token, body: { username } })).status).toBe(200);
  await env.DB.prepare('UPDATE members SET joined_at = ? WHERE id = ?').bind(new Date(Date.now() - 10 * 86400_000).toISOString(), b.member.id).run();
  return { token: b.token, id: b.member.id, username };
}
const J = async (r: Response) => (await r.json()) as any;
const get = (path: string, token?: string) => call(env, path, { token });
const post = (path: string, token: string | undefined, body?: unknown) => call(env, path, { method: 'POST', token, body: body ?? {} });
const fx = (n: string) => new Uint8Array(readFileSync(pjoin(__dirname, '../../web/test/fixtures/exif', n)));
function upload(u: U, conv: number, file: Blob, fields: Record<string, string>) {
  const fd = new FormData();
  fd.set('file', file, 'f');
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return call(env, `/api/social/dm/conversations/${conv}/media`, { method: 'POST', token: u.token, raw: fd });
}

let A: U, C: U, D: U, conv: number;
beforeAll(async () => {
  A = await join('a30@example.com', 'Ada', 'ada30', 1);
  C = await join('c30@example.com', 'Cy', 'cy30', 2);
  D = await join('d30@example.com', 'Di', 'di30', 3);
  await post(`/api/social/follows/${C.username}`, A.token);
  await post(`/api/social/follows/${A.username}`, C.token);
  conv = (await J(await post('/api/social/dm/conversations', A.token, { username: C.username }))).conversation.id;
});

describe('迁移 0022 只做加法', () => {
  it('ALTER ADD COLUMN + CREATE TABLE，没有 DROP / UPDATE / DELETE', () => {
    const sql = readFileSync(pjoin(__dirname, '../migrations/0022_realtime2.sql'), 'utf8').replace(/--.*$/gm, '');
    expect(sql).not.toMatch(/^\s*(DROP|UPDATE|DELETE)\b|ALTER TABLE \w+ (DROP|RENAME)/im);
  });
});

describe('私信图片 / 语音', () => {
  it('图片：替代文字必填；类型按内容嗅探；保存前去掉 EXIF（含 GPS）；对方可取、第三人 404、未登录 401', async () => {
    const jpg = fx('iphone-gps.jpg');
    expect((await J(await upload(A, conv, new Blob([jpg], { type: 'image/jpeg' }), { kind: 'image', alt: '' }))).error.code).toBe('alt_required');
    expect((await upload(A, conv, new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }), { kind: 'image', alt: '假图片' })).status).toBe(415);
    expect((await upload(D, conv, new Blob([jpg], { type: 'image/jpeg' }), { kind: 'image', alt: '第三人' })).status).toBe(404);
    const up = await upload(A, conv, new Blob([jpg], { type: 'image/jpeg' }), { kind: 'image', alt: '桂林的傍晚', width: '1', height: '1' });
    expect(up.status).toBe(201);
    const media = (await J(up)).media;
    expect(media.id).toMatch(new RegExp(`^dm/${conv}/${A.id}/`));
    // 未发送前只有上传者能取
    expect((await get(`/api/social/dm/media/${media.id}`, C.token)).status).toBe(404);
    const sent = await post(`/api/social/dm/conversations/${conv}/messages`, A.token, { body: '', mediaId: media.id, clientId: 'cimg30a001' });
    expect(sent.status).toBe(201);
    const msg = (await J(sent)).message;
    expect(msg.attachment).toMatchObject({ kind: 'image', alt: '桂林的傍晚', url: `/api/social/dm/media/${media.id}` });
    const r = await get(msg.attachment.url, C.token);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/jpeg');
    expect(r.headers.get('cache-control')).toMatch(/private/);
    const stored = new Uint8Array(await r.arrayBuffer());
    expect(readExif(stored)?.gps ?? null).toBeNull();
    expect((await get(msg.attachment.url, D.token)).status).toBe(404);
    expect((await get(msg.attachment.url)).status).toBe(401);
    // 摘要
    const list = await J(await get('/api/social/dm/conversations', C.token));
    expect(list.items.find((x: any) => x.id === conv).lastMessage.excerpt).toBe('[图片] 桂林的傍晚');
    // 同一媒体不能再发；别人的媒体不能用
    expect((await post(`/api/social/dm/conversations/${conv}/messages`, A.token, { body: '', mediaId: media.id })).status).toBe(400);
    expect((await post(`/api/social/dm/conversations/${conv}/messages`, C.token, { body: '', mediaId: media.id })).status).toBe(400);
  });
  it('语音：时长 1 秒 – 2 分钟；撤回后对象删除', async () => {
    const ogg = new Blob([new Uint8Array(2048).fill(7)], { type: 'audio/webm' });
    expect((await upload(A, conv, ogg, { kind: 'voice', durationMs: '500' })).status).toBe(400);
    expect((await upload(A, conv, ogg, { kind: 'voice', durationMs: '121000' })).status).toBe(400);
    const m = (await J(await upload(A, conv, ogg, { kind: 'voice', durationMs: '4200' }))).media;
    const msg = (await J(await post(`/api/social/dm/conversations/${conv}/messages`, A.token, { body: '听听', mediaId: m.id }))).message;
    expect(msg.attachment).toMatchObject({ kind: 'voice', durationMs: 4200 });
    expect((await get(msg.attachment.url, C.token)).status).toBe(200);
    expect((await post(`/api/social/dm/messages/${msg.id}/recall`, A.token)).status).toBe(200);
    expect((await get(msg.attachment.url, C.token)).status).toBe(404);
    expect(await (env.UPLOADS ?? env.IMAGES).get(m.id)).toBeNull();
  });
  it('同一个 clientId 重发只有一条消息', async () => {
    const r1 = await post(`/api/social/dm/conversations/${conv}/messages`, A.token, { body: '重连后重发', clientId: 'cdup30a001' });
    const r2 = await post(`/api/social/dm/conversations/${conv}/messages`, A.token, { body: '重连后重发', clientId: 'cdup30a001' });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    expect((await J(r2)).duplicate).toBe(true);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM messages WHERE body = '重连后重发'").first<{ n: number }>();
    expect(n?.n).toBe(1);
  });
});

describe('消息搜索', () => {
  it('只搜自己的会话；含替代文字；不含撤回 / 仅自己删除；% 和 _ 按字面匹配', async () => {
    await post(`/api/social/dm/conversations/${conv}/messages`, A.token, { body: '周末去漓江扫街' });
    await post(`/api/social/dm/conversations/${conv}/messages`, A.token, { body: '100% 的漓江' });
    const gone = (await J(await post(`/api/social/dm/conversations/${conv}/messages`, C.token, { body: '漓江删除' }))).message.id;
    await call(env, `/api/social/dm/messages/${gone}`, { method: 'DELETE', token: A.token });
    const r = await J(await get(`/api/social/dm/search?q=${encodeURIComponent('漓江')}`, A.token));
    expect(r.items.map((x: any) => x.message.body)).toEqual(['100% 的漓江', '周末去漓江扫街']);
    expect(r.items[0].html).toContain('<mark>漓江</mark>');
    expect(r.items[0].conversation.id).toBe(conv);
    expect((await J(await get(`/api/social/dm/search?q=${encodeURIComponent('漓江删除')}`, C.token))).items).toHaveLength(1);
    expect((await J(await get(`/api/social/dm/search?q=${encodeURIComponent('桂林的傍晚')}`, C.token))).items[0].field).toBe('alt');
    expect((await J(await get(`/api/social/dm/search?q=${encodeURIComponent('漓江')}`, D.token))).items).toEqual([]);
    expect((await J(await get(`/api/social/dm/search?q=${encodeURIComponent('%')}`, A.token))).items.map((x: any) => x.message.body)).toEqual(['100% 的漓江']);
    expect((await get('/api/social/dm/search?q=a')).status).toBe(401);
  });
});

describe('跨设备阅读同步', () => {
  it('两台设备推送，服务端合并；rev 递增、无变化不增；导出 / 注销清理', async () => {
    expect((await get('/api/social/sync/reading')).status).toBe(401);
    expect(await J(await get('/api/social/sync/reading', A.token))).toMatchObject({ rev: 0, doc: { history: [], later: [], laterRemoved: [] } });
    const put = (body: unknown) => call(env, '/api/social/sync/reading', { method: 'PUT', token: A.token, body });
    const p1 = await J(await put({ history: [{ slug: 'p1', title: 'P1', pct: 0.3, y: 10, at: 100 }], later: [{ slug: 'p3', title: 'P3', at: 100 }], laterRemoved: [] }));
    expect(p1.rev).toBe(1);
    const p2 = await J(await put({ history: [{ slug: 'p1', title: 'P1', pct: 0.9, y: 900, at: 200 }], later: [], laterRemoved: [{ slug: 'p3', at: 150 }] }));
    expect(p2).toMatchObject({ rev: 2, doc: { later: [] } });
    expect(p2.doc.history[0].pct).toBe(0.9);
    const p3 = await J(await put({ history: [], later: [], laterRemoved: [] }));
    expect(p3.rev).toBe(2);
    expect((await put('nope')).status).toBe(400);
    expect((await call(env, '/api/social/sync/reading', { method: 'PUT', token: A.token, raw: JSON.stringify({ history: [], later: [], laterRemoved: [], pad: 'x'.repeat(70_000) }), headers: { 'content-type': 'application/json' } })).status).toBe(413);
    const exp = await J(await get('/api/social/me/export', A.token));
    expect(exp.readingSync.history[0].slug).toBe('p1');
    expect(exp.directMessages.some((m: any) => m.attachment && !String(m.attachment).includes('"key"'))).toBe(true);
  });
});
