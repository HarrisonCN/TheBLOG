// L27 阅读与书影音 2.0：Worker 与前端共用 reading-core（逐字相同）；GET /api/quotes 只取已发布文章里的 :::quote 块，锚点与文章页 figure id 一致。
// 会员书摘 / 稍后读的 D1 同步 = SKIPPED-verifiable（访客与演示站用 localStorage）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_TOKEN, call, disposeEnv, setupEnv } from './helpers';
import type { Env } from '../src/env';
import { quoteAnchor } from '../src/reading-core';
import { shelfItemSchema } from '../src/schema';

let env: Env;
const J = async (r: Response) => (await r.json()) as any;
const post = async (title: string, contentMd: string, publish = true) => {
  const r = await J(await call(env, '/api/admin/posts', { token: API_TOKEN, body: { title, contentMd, tags: ['l27'], summary: '' } }));
  const slug = r.slug ?? r.post?.slug;
  if (publish) await call(env, `/api/admin/posts/${slug}/publish`, { token: API_TOKEN, body: {} });
  return slug as string;
};
let pub = '';

beforeAll(async () => {
  env = await setupEnv();
  pub = await post('L27 书摘测试', '前言。\n\n:::quote 演示来源 | https://example.com/q\nL27 已发布的**摘录**。\n:::\n\n```\n:::quote 代码块\n不算\n:::\n```\n');
  await post('L27 草稿书摘', ':::quote 草稿\nL27 草稿里的摘录\n:::\n', false);
});
afterAll(async () => {
  await disposeEnv();
});

describe('reading-core 共享', () => {
  it('Worker 与前端的 reading-core.ts 逐字相同', () => {
    const w = readFileSync(join(__dirname, '../src/reading-core.ts'), 'utf8');
    const f = readFileSync(join(__dirname, '../../web/src/reading-core.ts'), 'utf8');
    expect(w).toBe(f);
  });
});

describe('GET /api/quotes', () => {
  it('只来自已发布文章，跳过代码块，带 slug / 标题 / 来源 / 稳定锚点', async () => {
    const r = await call(env, '/api/quotes');
    expect(r.status).toBe(200);
    const b = await J(r);
    const mine = b.quotes.filter((q: any) => q.text.startsWith('L27'));
    expect(mine.map((q: any) => q.text)).toEqual(['L27 已发布的摘录。']);
    expect(mine[0]).toMatchObject({ slug: pub, postTitle: 'L27 书摘测试', source: '演示来源', link: 'https://example.com/q', from: 'post' });
    expect(mine[0].id).toBe(quoteAnchor('L27 已发布的**摘录**。'));
    expect(b.quotes.some((q: any) => q.text.includes('不算') || q.text.includes('草稿'))).toBe(false);
  });
});

describe('书影音条目的摘录字段', () => {
  it('quote ≤ 200 字，缺省为空串', () => {
    expect(shelfItemSchema.parse({ title: 'x' }).quote).toBe('');
    expect(shelfItemSchema.parse({ title: 'x', quote: '一句' }).quote).toBe('一句');
    expect(() => shelfItemSchema.parse({ title: 'x', quote: '长'.repeat(201) })).toThrow();
  });
});
