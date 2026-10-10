import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
beforeAll(async () => {
  env = await setupEnv();
});
afterAll(disposeEnv);

const ip = (n: number) => ({ 'cf-connecting-ip': `10.30.0.${n}` });
const react = (body: unknown, n = 1, slug = 'welcome') => call(env, `/api/posts/${slug}/reactions`, { body, headers: ip(n) });

describe('文章表情回应', () => {
  it('新文章没有回应；同一访客重复点同一表情只算一次，可以撤销', async () => {
    const r0 = await call(env, '/api/posts/welcome/reactions');
    expect(r0.status).toBe(200);
    expect(r0.headers.get('cache-control')).toBe('no-store');
    expect(await r0.json()).toEqual({ counts: {} });

    expect(((await (await react({ emoji: '👍' }, 1)).json()) as any).counts).toEqual({ '👍': 1 });
    expect(((await (await react({ emoji: '👍' }, 1)).json()) as any).counts).toEqual({ '👍': 1 });
    const two = (await (await react({ emoji: '👍' }, 2)).json()) as any;
    expect(two).toEqual({ counts: { '👍': 2 }, mine: true });
    await react({ emoji: '🎉' }, 2);
    const off = (await (await react({ emoji: '👍', on: false }, 1)).json()) as any;
    expect(off.counts).toEqual({ '👍': 1, '🎉': 1 });
    // 没投过的人撤销不会把计数减成负数
    const noop = (await (await react({ emoji: '🎉', on: false }, 9)).json()) as any;
    expect(noop.counts['🎉']).toBe(1);
  });

  it('只接受固定表情；不存在 / 草稿文章 404；必须是 JSON', async () => {
    expect((await react({ emoji: '💩' })).status).toBe(400);
    expect((await react({ emoji: '<b>' })).status).toBe(400);
    expect((await react({ emoji: '👍' }, 1, 'no-such-post')).status).toBe(404);
    expect((await call(env, '/api/posts/no-such-post/reactions')).status).toBe(404);
    expect((await call(env, '/api/posts/welcome/reactions', { raw: 'emoji=1', headers: { 'content-type': 'text/plain', ...ip(3) } })).status).toBe(415);
  });

  it('跨域 POST 被拒（Origin 校验）', async () => {
    const r = await call(env, '/api/posts/welcome/reactions', { body: { emoji: '👍' }, headers: { origin: 'https://evil.example', ...ip(4) } });
    expect(r.status).toBe(403);
  });

  it('限流：10 分钟内同一访客最多 60 次', async () => {
    let last = 0;
    for (let i = 0; i < 62; i++) last = (await react({ emoji: '🤔', on: i % 2 === 0 }, 7)).status;
    expect(last).toBe(429);
  });
});
