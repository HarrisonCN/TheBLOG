/**
 * 预渲染的可测试部分：严格模式判定、按游标拉取全部文章、数量核对。
 * prerender.mjs 与 web/test/prerender.test.ts 共用。
 */

/** 每页拉取多少篇（= API 的上限） */
export const PRERENDER_PAGE_SIZE = 100;

/**
 * 严格模式：CI / GitHub Pages / 正式部署。任何失败（API 不可达、某页渲染失败、数量对不上）都让构建失败。
 * 触发：NODE_ENV=production、PRERENDER_STRICT=1/true，或命令行 --strict。--lenient / PRERENDER_STRICT=0 显式关闭。
 */
export function isStrict(argv = [], env = {}) {
  if (argv.includes('--lenient')) return false;
  if (argv.includes('--strict')) return true;
  const flag = String(env.PRERENDER_STRICT ?? '').toLowerCase();
  if (flag === '0' || flag === 'false') return false;
  if (flag === '1' || flag === 'true') return true;
  return env.NODE_ENV === 'production';
}

export class PrerenderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PrerenderError';
  }
}

/**
 * 按游标逐页拉取全部已发布文章摘要。
 * get(path) → 解析后的 JSON。旧 Worker 不返回 nextCursor 时退回 offset 分页。
 * 结果的篇数必须等于 API 报告的 total，否则抛 PrerenderError。
 */
export async function fetchAllPosts(get, { pageSize = PRERENDER_PAGE_SIZE, maxPages = 1000 } = {}) {
  const posts = [];
  const seen = new Set();
  let cursor = null;
  let total = 0;
  let pages = 0;
  for (;;) {
    const qs = cursor ? `cursor=${encodeURIComponent(cursor)}` : posts.length ? `offset=${posts.length}` : '';
    const r = await get(`/api/posts?limit=${pageSize}${qs ? `&${qs}` : ''}`);
    pages++;
    total = Number(r.total ?? 0);
    for (const p of r.posts ?? []) {
      if (seen.has(p.slug)) throw new PrerenderError(`分页返回了重复文章：${p.slug}`);
      seen.add(p.slug);
      posts.push(p);
    }
    const next = r.nextCursor ?? null;
    if (!(r.posts ?? []).length) break;
    if (next) {
      if (next === cursor) throw new PrerenderError('分页游标没有前进');
      cursor = next;
    } else if ('nextCursor' in r || posts.length >= total) {
      break;
    }
    if (pages >= maxPages) throw new PrerenderError(`分页超过 ${maxPages} 页`);
  }
  if (posts.length !== total) throw new PrerenderError(`文章数量不一致：分页拿到 ${posts.length} 篇，API 报告 total=${total}`);
  return { posts, total, pages };
}

/** 预渲染结束后的核对：文章页数量必须等于 API 的 total；严格模式下也不允许任何失败页。 */
export function verifyCounts({ postPages, total, failures = [] }) {
  const problems = [];
  if (postPages !== total) problems.push(`预渲染了 ${postPages} 篇文章页，API 报告 total=${total}`);
  for (const f of failures) problems.push(`页面失败：${f}`);
  return problems;
}
