// L26 搜索与推荐 2.0：Worker 与前端共用 search-core（逐字相同）；GET /api/search 用同一套排名（BM25 + 中文二元组 + 筛选 + 建议）。
// D1 FTS5 = SKIPPED-verifiable（演示站用浏览器内索引；这里的接口在内存里对已发布文章建索引）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_TOKEN, call, disposeEnv, setupEnv } from './helpers';
import type { Env } from '../src/env';

let env: Env;
const J = async (r: Response) => (await r.json()) as any;
const post = async (title: string, contentMd: string, tags: string[], publish = true) => {
  const r = await J(await call(env, '/api/admin/posts', { token: API_TOKEN, body: { title, contentMd, tags, summary: '' } }));
  if (publish) await call(env, `/api/admin/posts/${r.slug ?? r.post?.slug}/publish`, { token: API_TOKEN, body: {} });
  return r.slug ?? r.post?.slug;
};

beforeAll(async () => {
  env = await setupEnv();
  await post('L26 城市夜景笔记', '蓝调时刻的城市灯光，三脚架与长曝光。', ['l26夜景', '摄影']);
  await post('L26 胶片冲扫', '135 胶片冲洗与扫描。', ['l26胶片']);
  await post('L26 草稿夜景', '还没发布的夜景草稿。', ['l26夜景'], false);
});
afterAll(async () => {
  await disposeEnv();
});

describe('search-core 共享', () => {
  it('Worker 与前端的 search-core.ts 逐字相同', () => {
    const w = readFileSync(join(__dirname, '../src/search-core.ts'), 'utf8');
    const f = readFileSync(join(__dirname, '../../web/src/search-core.ts'), 'utf8');
    expect(w).toBe(f);
  });
});

describe('GET /api/search', () => {
  it('中文二元组命中、只搜已发布文章、带高亮用的分数与总数', async () => {
    const r = await call(env, '/api/search?q=' + encodeURIComponent('城市夜景'));
    expect(r.status).toBe(200);
    const b = await J(r);
    const slugs = b.hits.map((h: any) => h.title);
    expect(slugs).toContain('L26 城市夜景笔记');
    expect(slugs).not.toContain('L26 草稿夜景');
    expect(b.hits[0].score).toBeGreaterThan(0);
    expect(b.total).toBe(b.hits.length);
  });
  it('标签筛选与年份筛选', async () => {
    const t = await J(await call(env, '/api/search?q=' + encodeURIComponent('胶片') + '&tag=' + encodeURIComponent('l26胶片')));
    expect(t.hits.map((h: any) => h.title)).toEqual(['L26 胶片冲扫']);
    const y = await J(await call(env, '/api/search?q=' + encodeURIComponent('胶片') + '&year=1999'));
    expect(y.hits).toEqual([]);
  });
  it('没有结果时给建议；空查询返回空；超长查询被截断而不是报错', async () => {
    const none = await J(await call(env, '/api/search?q=' + encodeURIComponent('城市夜晚灯景')));
    expect(Array.isArray(none.suggestions)).toBe(true);
    const empty = await J(await call(env, '/api/search?q='));
    expect(empty).toMatchObject({ hits: [], total: 0 });
    const long = await call(env, '/api/search?q=' + 'a'.repeat(500));
    expect(long.status).toBe(200);
  });
});
