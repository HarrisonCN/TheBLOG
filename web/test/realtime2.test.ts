/**
 * L30 / v1.30.0 实时社交 2.0：
 * - 私信图片（必须写替代文字）与语音（≤ 2 分钟）：共享校验 dm-core.checkMedia、附件只能用在自己上传到这个会话的媒体上；
 * - 消息搜索：只搜自己参与的会话、不含撤回 / 仅自己删除的消息，包括图片替代文字；
 * - 断线重连与幂等：同一个 clientId 发两次只有一条消息；重试退避有上限；
 * - 跨设备同步：阅读进度与稍后读（L25 / L27 当时只存本机，SKIPPED 的会员同步）——合并规则可交换、删除用墓碑、按时间取新。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { DemoBackend, memoryKV, type KV } from '../src/demo/mock-api';
import { DEMO_OTP } from '../src/demo/seed';
import {
  ALT_MAX, DM_IMAGE_MAX, DM_VOICE_MAX, DM_VOICE_MAX_MS, attachmentLabel, backoffMs, checkMedia, excerptOf, fmtDuration, highlightHits, searchMessages,
  type DmMessage,
} from '../src/dm-core';
import { SYNC_LATER_TOMBSTONES, checkSyncDoc, emptySyncDoc, laterTombstones, mergeSync, type SyncDoc } from '../src/sync-core';

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

describe('共享代码与迁移', () => {
  it('web 与 worker 的 dm-core.ts / sync-core.ts 一致；迁移 0022 只做加法', () => {
    expect(read('../src/dm-core.ts')).toBe(read('../../worker/src/dm-core.ts'));
    expect(read('../src/sync-core.ts')).toBe(read('../../worker/src/sync-core.ts'));
    const sql = read('../../worker/migrations/0022_realtime2.sql').replace(/--.*$/gm, '');
    expect(sql).not.toMatch(/^\s*(DROP|UPDATE|DELETE)\b|ALTER TABLE \w+ (DROP|RENAME)/im);
    expect(sql).toMatch(/ALTER TABLE messages ADD COLUMN attachment TEXT/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS dm_media/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS sync_docs/);
  });
});

describe('dm-core：媒体校验', () => {
  const img = { kind: 'image', mime: 'image/jpeg', size: 200_000, alt: '傍晚的江边', durationMs: 0, width: 1200, height: 800 };
  it('图片：必须有替代文字，类型 / 大小受限', () => {
    expect(checkMedia(img)).toMatchObject({ ok: true, value: { kind: 'image', alt: '傍晚的江边' } });
    expect(checkMedia({ ...img, alt: '  ' })).toMatchObject({ ok: false, code: 'alt_required' });
    expect(checkMedia({ ...img, alt: 'x'.repeat(ALT_MAX + 1) })).toMatchObject({ ok: false, code: 'validation_error' });
    expect(checkMedia({ ...img, mime: 'image/gif' })).toMatchObject({ ok: false, code: 'unsupported_type' });
    expect(checkMedia({ ...img, mime: 'image/svg+xml' })).toMatchObject({ ok: false, code: 'unsupported_type' });
    expect(checkMedia({ ...img, size: DM_IMAGE_MAX + 1 })).toMatchObject({ ok: false, code: 'too_large', status: 413 });
    expect(checkMedia({ ...img, size: 0 })).toMatchObject({ ok: false });
  });
  it('语音：时长 1 秒 – 2 分钟，类型 / 大小受限，替代文字可选', () => {
    const v = { kind: 'voice', mime: 'audio/webm;codecs=opus', size: 50_000, alt: '', durationMs: 12_300, width: 0, height: 0 };
    expect(checkMedia(v)).toMatchObject({ ok: true, value: { kind: 'voice', mime: 'audio/webm', durationMs: 12_300 } });
    expect(checkMedia({ ...v, durationMs: 0 })).toMatchObject({ ok: false });
    expect(checkMedia({ ...v, durationMs: DM_VOICE_MAX_MS + 1 })).toMatchObject({ ok: false });
    expect(checkMedia({ ...v, size: DM_VOICE_MAX + 1 })).toMatchObject({ ok: false, status: 413 });
    expect(checkMedia({ ...v, mime: 'video/mp4' })).toMatchObject({ ok: false, code: 'unsupported_type' });
    expect(checkMedia({ ...v, kind: 'file' })).toMatchObject({ ok: false });
  });
  it('附件文字：摘要、时长', () => {
    expect(fmtDuration(12_300)).toBe('0:12');
    expect(fmtDuration(65_000)).toBe('1:05');
    expect(attachmentLabel({ kind: 'image', alt: '傍晚的江边' } as never)).toBe('[图片] 傍晚的江边');
    expect(attachmentLabel({ kind: 'voice', durationMs: 12_300 } as never)).toBe('[语音 0:12]');
    expect(excerptOf({ body: '', attachment: { kind: 'voice', durationMs: 5000 } } as never)).toBe('[语音 0:05]');
    expect(excerptOf({ body: '看这张', attachment: { kind: 'image', alt: '江边' } } as never)).toBe('[图片] 看这张');
  });
  it('重连退避：指数增长，有上限', () => {
    expect([0, 1, 2, 3, 10].map((n) => backoffMs(n))).toEqual([1000, 2000, 4000, 8000, 30000]);
  });
});

describe('dm-core：消息搜索', () => {
  const m = (id: number, body: string, extra: Partial<DmMessage> = {}): DmMessage =>
    ({ id, conversationId: 1, sender: null, mine: false, body, clientId: null, createdAt: '2026-10-15T00:00:00Z', recalled: false, removed: false, attachment: null, ...extra }) as DmMessage;
  const items = [m(1, '周末去江边扫街'), m(2, 'Street walk at the river'), m(3, '撤回的江边', { recalled: true }), m(4, '', { attachment: { kind: 'image', alt: '江边的夕阳', url: 'x', mime: 'image/jpeg', size: 1, durationMs: 0, width: 1, height: 1 } }), m(5, 'ＲＩＶＥＲ 全角')];
  it('不区分大小写 / 全半角；含图片替代文字；不含撤回；新消息在前', () => {
    expect(searchMessages(items, '江边').map((x) => x.message.id)).toEqual([4, 1]);
    expect(searchMessages(items, 'river').map((x) => x.message.id)).toEqual([5, 2]);
    expect(searchMessages(items, ' ')).toEqual([]);
    expect(searchMessages(items, 'x'.repeat(51))).toEqual([]);
  });
  it('高亮：转义后包 <mark>', () => {
    expect(highlightHits('a<b>江边c', '江边')).toBe('a&lt;b&gt;<mark>江边</mark>c');
    expect(highlightHits('River river', 'RIVER')).toBe('<mark>River</mark> <mark>river</mark>');
  });
});

describe('sync-core：跨设备阅读进度 / 稍后读', () => {
  const doc = (o: Partial<SyncDoc>): SyncDoc => ({ ...emptySyncDoc(), ...o });
  const a = doc({ history: [{ slug: 'p1', title: 'P1', cover: null, pct: 0.4, y: 100, at: 10 }, { slug: 'p2', title: 'P2', cover: null, pct: 1, y: 0, at: 5 }], later: [{ slug: 'p3', title: 'P3', at: 7 }] });
  const b = doc({ history: [{ slug: 'p1', title: 'P1', cover: null, pct: 0.8, y: 300, at: 20 }], later: [{ slug: 'p4', title: 'P4', at: 8 }], laterRemoved: [{ slug: 'p3', at: 9 }] });
  it('按时间取新、墓碑删除；合并可交换、幂等', () => {
    const ab = mergeSync(a, b), ba = mergeSync(b, a);
    expect(ab).toEqual(ba);
    expect(mergeSync(ab, ab)).toEqual(ab);
    expect(ab.history.find((x) => x.slug === 'p1')!.pct).toBe(0.8);
    expect(ab.history.map((x) => x.slug)).toEqual(['p1', 'p2']);
    expect(ab.later.map((x) => x.slug)).toEqual(['p4']);
    // 删除之后又重新加入（时间更新）→ 保留
    const re = mergeSync(ab, doc({ later: [{ slug: 'p3', title: 'P3', at: 30 }] }));
    expect(re.later.map((x) => x.slug)).toEqual(['p3', 'p4']);
  });
  it('本机删除检测：上次同步有、现在没有 → 墓碑', () => {
    expect(laterTombstones(['p1', 'p2'], [{ slug: 'p2', title: '', at: 1 }], 100)).toEqual([{ slug: 'p1', at: 100 }]);
  });
  it('严格校验：非法 slug / 超量 / 非对象被拒绝或截断', () => {
    expect(checkSyncDoc({ history: [{ slug: 'Bad Slug', title: 'x', pct: 0.1, at: 1 }], later: [], laterRemoved: [] })).toMatchObject({ ok: true, value: { history: [] } });
    expect(checkSyncDoc('nope')).toMatchObject({ ok: false });
    const many = Array.from({ length: SYNC_LATER_TOMBSTONES + 50 }, (_, i) => ({ slug: `s${i}`, at: i }));
    expect((checkSyncDoc({ history: [], later: [], laterRemoved: many }) as { ok: true; value: SyncDoc }).value.laterRemoved.length).toBe(SYNC_LATER_TOMBSTONES);
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
type U = { token: string; id: number; username: string };
async function join(email: string, name: string, username: string): Promise<U> {
  await api.handle('POST', '/api/members/register', { name, email });
  const r = B(await api.handle('POST', '/api/members/verify', { email, code: DEMO_OTP }));
  await api.handle('PUT', '/api/social/me', { username }, as(r.token));
  const db = JSON.parse(kv.getItem('blog-demo:db:v2')!);
  db.members.find((m: any) => m.id === r.member.id).joinedAt = new Date(clock - 10 * 86400_000).toISOString();
  kv.setItem('blog-demo:db:v2', JSON.stringify(db));
  api.invalidate();
  return { token: r.token, id: r.member.id, username };
}
const get = (p: string, u?: U) => api.handle('GET', p, undefined, u ? as(u.token) : {});
const post = (p: string, u: U, body: unknown = {}) => api.handle('POST', p, body, as(u.token));
const put = (p: string, u: U, body: unknown) => api.handle('PUT', p, body, as(u.token));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function pair() {
  const A = await join('a@example.com', 'Ada', 'ada_demo');
  const C = await join('c@example.com', 'Cy', 'cy_demo');
  const D = await join('d@example.com', 'Di', 'di_demo');
  await post(`/api/social/follows/${C.username}`, A);
  await post(`/api/social/follows/${A.username}`, C);
  const conv = B(await post('/api/social/dm/conversations', A, { username: C.username })).conversation.id as number;
  return { A, C, D, conv };
}

describe('演示 mock：私信图片 / 语音', () => {
  it('上传 → 发送附件消息；对方看到；摘要显示 [图片]；非成员不能上传', async () => {
    const { A, C, D, conv } = await pair();
    const up = await post(`/api/social/dm/conversations/${conv}/media`, A, { kind: 'image', type: 'image/png', size: 70, alt: '一个像素', width: 1, height: 1, dataUrl: PNG });
    expect(up.status).toBe(201);
    const media = B(up).media;
    expect(media).toMatchObject({ kind: 'image', alt: '一个像素' });
    const sent = await post(`/api/social/dm/conversations/${conv}/messages`, A, { body: '', mediaId: media.id, clientId: 'cimg000001' });
    expect(sent.status).toBe(201);
    expect(B(sent).message.attachment).toMatchObject({ kind: 'image', alt: '一个像素' });
    const seen = B(await get(`/api/social/dm/conversations/${conv}/messages`, C)).items.at(-1);
    expect(seen.attachment.url).toMatch(/^data:image\/png/);
    expect(B(await get('/api/social/dm/conversations', C)).items[0].lastMessage.excerpt).toBe('[图片] 一个像素');
    expect((await post(`/api/social/dm/conversations/${conv}/media`, D, { kind: 'image', type: 'image/png', size: 70, alt: 'x', dataUrl: PNG })).status).toBe(404);
  });
  it('缺替代文字 / 别人的媒体 / 用过的媒体 → 拒绝；空消息无附件 → 拒绝', async () => {
    const { A, C, conv } = await pair();
    expect(B(await post(`/api/social/dm/conversations/${conv}/media`, A, { kind: 'image', type: 'image/png', size: 70, alt: '', dataUrl: PNG })).error.code).toBe('alt_required');
    const m = B(await post(`/api/social/dm/conversations/${conv}/media`, A, { kind: 'voice', type: 'audio/webm', size: 900, durationMs: 3200, dataUrl: 'data:audio/webm;base64,GkXfow==' })).media;
    expect((await post(`/api/social/dm/conversations/${conv}/messages`, C, { body: '', mediaId: m.id })).status).toBe(400);
    expect((await post(`/api/social/dm/conversations/${conv}/messages`, A, { body: '', mediaId: m.id })).status).toBe(201);
    expect((await post(`/api/social/dm/conversations/${conv}/messages`, A, { body: '', mediaId: m.id })).status).toBe(400);
    expect((await post(`/api/social/dm/conversations/${conv}/messages`, A, { body: '   ' })).status).toBe(400);
  });
  it('同一个 clientId 重发（断线重连）只有一条消息', async () => {
    const { A, C, conv } = await pair();
    const r1 = await post(`/api/social/dm/conversations/${conv}/messages`, A, { body: '只发一次', clientId: 'cdup000001' });
    const r2 = await post(`/api/social/dm/conversations/${conv}/messages`, A, { body: '只发一次', clientId: 'cdup000001' });
    expect(r1.status).toBe(201);
    expect(B(r2).duplicate).toBe(true);
    expect(B(await get(`/api/social/dm/conversations/${conv}/messages`, C)).items.filter((x: any) => x.body === '只发一次').length).toBe(1);
  });
});

describe('演示 mock：消息搜索', () => {
  it('只搜自己的会话，含替代文字，不含撤回 / 仅自己删除', async () => {
    const { A, C, D, conv } = await pair();
    await post(`/api/social/dm/conversations/${conv}/messages`, A, { body: '周末去江边扫街' });
    const gone = B(await post(`/api/social/dm/conversations/${conv}/messages`, A, { body: '江边撤回' })).message.id;
    await post(`/api/social/dm/messages/${gone}/recall`, A);
    const mine = B(await post(`/api/social/dm/conversations/${conv}/messages`, C, { body: '江边删除' })).message.id;
    await api.handle('DELETE', `/api/social/dm/messages/${mine}`, undefined, as(A.token));
    const m = B(await post(`/api/social/dm/conversations/${conv}/media`, C, { kind: 'image', type: 'image/png', size: 70, alt: '江边夕阳', dataUrl: PNG })).media;
    await post(`/api/social/dm/conversations/${conv}/messages`, C, { body: '', mediaId: m.id });
    const r = B(await get(`/api/social/dm/search?q=${encodeURIComponent('江边')}`, A));
    expect(r.items.map((x: any) => x.message.body || x.message.attachment?.alt)).toEqual(['江边夕阳', '周末去江边扫街']);
    expect(r.items[0].conversation).toMatchObject({ id: conv });
    expect(B(await get(`/api/social/dm/search?q=${encodeURIComponent('江边')}`, D)).items).toEqual([]);
    expect((await get('/api/social/dm/search?q=%E6%B1%9F')).status).toBe(401);
  });
});

describe('演示 mock：跨设备同步（阅读进度 + 稍后读）', () => {
  it('两台设备各自推送，服务端合并；版本号递增；未登录 401；导出包含同步数据', async () => {
    const A = await join('a@example.com', 'Ada', 'ada_demo');
    expect((await get('/api/social/sync/reading')).status).toBe(401);
    expect(B(await get('/api/social/sync/reading', A))).toMatchObject({ rev: 0, doc: { history: [], later: [] } });
    const phone = await put('/api/social/sync/reading', A, { history: [{ slug: 'p1', title: 'P1', pct: 0.3, y: 10, at: 100 }], later: [{ slug: 'p3', title: 'P3', at: 100 }], laterRemoved: [] });
    expect(B(phone).rev).toBe(1);
    const laptop = await put('/api/social/sync/reading', A, { history: [{ slug: 'p1', title: 'P1', pct: 0.9, y: 900, at: 200 }], later: [], laterRemoved: [{ slug: 'p3', at: 150 }] });
    expect(B(laptop)).toMatchObject({ rev: 2, doc: { later: [] } });
    expect(B(laptop).doc.history[0].pct).toBe(0.9);
    const exp = B(await get('/api/social/me/export', A));
    expect(exp.readingSync.history[0].slug).toBe('p1');
  });
});
