/**
 * L20 MCP 分层工具：read-public（公开内容只读）/ author（只动令牌所属会员自己的作品）/ moderator（审核队列）。
 * 每个工具需要的最低权限见 open-core.TOOL_SCOPES；mcp.ts 在调用前统一检查作用域并写审计。
 * 作者工具通过 actAsMember 以令牌所属会员的身份调用现有的会员接口逻辑（同样的校验、限流、审核规则），
 * 并且在调用前额外确认 author_id = 令牌会员（共同作者的作品也不行：只能操作自己的内容）。
 */
import { z } from 'zod';
import type { ToolDef, McpCtx } from './mcp';
import { HttpError } from './http';
import { actAsMember } from './community';
import { card } from './social';
import { adminAction, adminQueue, createWork, deleteWork, loadWork, myWorks, publishWork, toWorks, updateWork } from './ugc';
import * as svc from './service';
import { adminMentions, moderateMention, publicProfile, publicWorkRows, siteBase, toOpenWork, topicBySlug, PUBLIC_SQL } from './open';
import { decodeOpenCursor, SCOPE_LABEL } from './open-core';

const needMember = (ctx: McpCtx): number => {
  if (ctx.memberId === null) throw new HttpError(400, 'member_token_required', '这个工具需要会员的 MCP 令牌（在 /me/ 设置里创建），站长环境令牌没有对应的会员身份');
  return ctx.memberId;
};
const actReq = (ctx: McpCtx, path = '/'): Request => actAsMember(new Request(new URL(path, ctx.req.url).href, { method: 'POST', headers: { 'cf-connecting-ip': ctx.req.headers.get('cf-connecting-ip') ?? '' } }), needMember(ctx));
/** 只能操作自己的作品：不存在 / 不是自己的 → 一律 not_found（不暴露别人的草稿是否存在） */
async function ownOnly(env: Parameters<ToolDef['run']>[0], ctx: McpCtx, id: number) {
  const me = needMember(ctx);
  const w = await loadWork(env, id);
  if (!w || w.deleted_at || w.author_id !== me) throw new HttpError(404, 'not_found', '作品不存在，或者不是你的作品（MCP 令牌只能操作自己的内容）');
  return w;
}
const workFields = {
  title: z.string().max(80).optional(),
  body: z.string().max(20000).optional(),
  caption: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  visibility: z.enum(['public', 'followers', 'private']).optional(),
  topics: z.array(z.string().max(32)).max(3).optional(),
};
const idArg = z.object({ id: z.number().int().positive().describe('作品 id') });
const ro = { readOnlyHint: true, openWorldHint: false } as const;
const rw = (destructive = false) => ({ readOnlyHint: false, destructiveHint: destructive, idempotentHint: false, openWorldHint: false }) as const;

export const OPEN_TOOLS: ToolDef[] = [
  {
    name: 'whoami',
    title: '当前令牌',
    description: '返回当前 MCP 令牌的权限层级和所属会员（站长环境令牌返回 admin、无会员）。',
    input: z.object({}),
    annotations: ro,
    run: async (env, _a, ctx) => ({ scope: ctx.scope, scopeLabel: SCOPE_LABEL[ctx.scope], member: ctx.memberId ? await card(env, ctx.memberId) : null }),
  },
  {
    name: 'search_public_works',
    title: '搜索公开作品',
    description: '列出 / 搜索社区里的公开作品（已发布、公开可见）。可按类型、话题、作者筛选，q 匹配标题 / 图注 / 正文；游标分页。',
    input: z.object({
      q: z.string().max(60).optional(),
      type: z.enum(['short', 'article', 'photo', 'album']).optional(),
      topic: z.string().max(32).optional(),
      author: z.string().max(20).optional().describe('用户名'),
      limit: z.number().int().min(1).max(50).optional(),
      cursor: z.string().max(200).optional(),
    }),
    annotations: ro,
    run: async (env, a, ctx) => {
      const where: string[] = [];
      const binds: unknown[] = [];
      if (a.type) (where.push('AND p.type = ?'), binds.push(a.type));
      if (a.topic) (where.push('AND p.id IN (SELECT post_id FROM post_topics WHERE topic_id = ?)'), binds.push((await topicBySlug(env, a.topic)).id));
      if (a.author) (where.push('AND p.author_id = ?'), binds.push((await publicProfile(env, a.author)).id));
      if (a.q) {
        where.push("AND (p.title LIKE ? ESCAPE '\\' OR p.caption LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\')");
        const like = `%${a.q.replace(/[\\%_]/g, (c: string) => `\\${c}`)}%`;
        binds.push(like, like, like);
      }
      const cursor = decodeOpenCursor(a.cursor ?? null);
      if (cursor === 'bad') throw new HttpError(400, 'validation_error', 'cursor 无效');
      const { rows, next } = await publicWorkRows(env, { where: where.join(' '), binds, limit: a.limit ?? 20, cursor });
      const site = siteBase(env, ctx.req);
      return { works: (await toWorks(env, rows, null)).map((w) => toOpenWork(w, site, ctx.req)), nextCursor: next };
    },
  },
  {
    name: 'get_public_work',
    title: '读取公开作品',
    description: '按 id 读取一条公开作品（草稿 / 私密 / 仅关注者可见的内容一律不存在）。',
    input: idArg,
    annotations: ro,
    run: async (env, a, ctx) => {
      const { rows } = await publicWorkRows(env, { where: 'AND p.id = ?', binds: [a.id], limit: 1, cursor: null });
      if (!rows.length) throw new HttpError(404, 'not_found', '作品不存在或不公开');
      return { work: toOpenWork((await toWorks(env, rows, null))[0]!, siteBase(env, ctx.req), ctx.req) };
    },
  },
  {
    name: 'list_public_posts',
    title: '列出公开文章',
    description: '列出站长已发布的文章（摘要，不含草稿）。',
    input: z.object({ limit: z.number().int().min(1).max(50).optional(), tag: z.string().max(40).optional() }),
    annotations: ro,
    run: async (env, a) => {
      const r = await svc.listPosts(env, { limit: a.limit ?? 20, cursor: null, ...(a.tag ? { tag: a.tag } : {}) } as never);
      return { posts: r.posts.map((p) => ({ slug: p.slug, title: p.title, summary: p.summary, tags: p.tags, publishedAt: p.publishedAt })), total: r.total };
    },
  },
  {
    name: 'get_public_profile',
    title: '读取公开主页',
    description: '按用户名读取公开的创作者主页（主页设为私密 / 仅好朋友可见时不存在）。',
    input: z.object({ username: z.string().min(3).max(20) }),
    annotations: ro,
    run: async (env, a) => {
      const u = await publicProfile(env, a.username);
      const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM user_posts p WHERE ${PUBLIC_SQL} AND p.author_id = ?`).bind(u.id).first<{ n: number }>();
      return { user: { username: u.username, nickname: u.nickname, bio: u.bio, website: u.website, joinedAt: u.joinedAt, publicWorks: n?.n ?? 0 } };
    },
  },
  {
    name: 'list_topics',
    title: '列出话题',
    description: '列出全部话题（slug、名称、简介）。',
    input: z.object({}),
    annotations: ro,
    run: async (env) => ({ topics: (await env.DB.prepare('SELECT slug, name, intro FROM topics ORDER BY sort, id').all()).results }),
  },
  // ---------------------------------------------------------------- author
  {
    name: 'list_my_works',
    title: '列出我的作品',
    description: '列出令牌所属会员自己的作品（含草稿 / 待审核）。',
    input: z.object({ status: z.enum(['all', 'draft', 'pending', 'published', 'hidden']).optional(), limit: z.number().int().min(1).max(50).optional() }),
    annotations: ro,
    run: async (env, a, ctx) => myWorks(actReq(ctx), env, new URL(`https://mcp.internal/?status=${a.status ?? 'all'}&limit=${a.limit ?? 20}`)),
  },
  {
    name: 'get_my_work',
    title: '读取我的作品',
    description: '读取自己的一条作品（含草稿）。别人的作品一律不存在。',
    input: idArg,
    annotations: ro,
    run: async (env, a, ctx) => {
      const w = await ownOnly(env, ctx, a.id);
      return { work: (await toWorks(env, [w], ctx.memberId))[0] };
    },
  },
  {
    name: 'create_my_work',
    title: '新建我的作品',
    description: '以令牌所属会员的身份新建作品，默认保存为草稿（draft: false 则按社区规则直接发布或进入审核）。type: short 短动态 / article 长文（需要标题）。摄影作品 / 影集需要先上传图片，请在网页上完成。',
    input: z.object({ type: z.enum(['short', 'article']), ...workFields, draft: z.boolean().optional().describe('默认 true') }),
    annotations: rw(),
    run: async (env, a, ctx) => {
      const { draft, ...rest } = a;
      return createWork(actReq(ctx), env, { visibility: 'public', title: '', body: '', caption: '', notes: '', params: {}, media: [], ...rest, draft: draft !== false });
    },
  },
  {
    name: 'update_my_work',
    title: '修改我的作品',
    description: '修改自己的作品（只传要改的字段）。只能修改自己是作者的作品。',
    input: idArg.extend(workFields),
    annotations: rw(),
    run: async (env, a, ctx) => {
      const w = await ownOnly(env, ctx, a.id);
      const cur = (await toWorks(env, [w], ctx.memberId))[0]!;
      const { id, ...patch } = a;
      return updateWork(actReq(ctx), env, id, { type: cur.type, title: cur.title, body: cur.body, caption: cur.caption, notes: cur.notes, params: cur.params, visibility: cur.visibility, media: cur.media, topics: cur.topics.map((t) => t.slug), ...patch });
    },
  },
  {
    name: 'publish_my_work',
    title: '发布我的草稿',
    description: '发布自己的一篇草稿（新会员按社区规则先进入审核）。草稿采用过 AI 建议时，需要 aiConfirmed: true 表示作者已检查。',
    input: idArg.extend({ aiConfirmed: z.boolean().optional() }),
    annotations: rw(),
    run: async (env, a, ctx) => {
      await ownOnly(env, ctx, a.id);
      return publishWork(actReq(ctx), env, a.id, { aiConfirmed: a.aiConfirmed === true });
    },
  },
  {
    name: 'delete_my_work',
    title: '删除我的作品',
    description: '删除自己的一条作品（软删除，任何人都读不到）。',
    input: idArg,
    annotations: rw(true),
    run: async (env, a, ctx) => {
      await ownOnly(env, ctx, a.id);
      return deleteWork(actReq(ctx), env, a.id);
    },
  },
  // ---------------------------------------------------------------- moderator
  {
    name: 'list_moderation_queue',
    title: '审核队列',
    description: '查看社区审核队列：pending 待审核 / reports 被举报 / hidden 已隐藏。',
    input: z.object({ view: z.enum(['pending', 'reports', 'hidden']).optional() }),
    annotations: ro,
    run: (env, a) => adminQueue(env, new URL(`https://mcp.internal/?view=${a.view ?? 'pending'}`)),
  },
  {
    name: 'moderate_content',
    title: '处理作品 / 评论',
    description: '审核员处理一条作品或评论：approve 通过 / hide 隐藏 / restore 恢复 / dismiss 驳回举报。（清除和封禁只有站长能做。）',
    input: z.object({ targetKind: z.enum(['work', 'comment']), targetId: z.number().int().positive(), action: z.enum(['approve', 'hide', 'restore', 'dismiss']), reason: z.string().max(200).optional() }),
    annotations: rw(),
    run: (env, a, ctx) => adminAction(env, ctx.memberId ? `mcp:member:${ctx.memberId}` : 'token', { ...a, reason: a.reason ?? '' }),
  },
  {
    name: 'list_webmentions',
    title: '列出 Webmention',
    description: '列出站外回应（Webmention）：pending 待审核 / approved / rejected / spam / invalid / queued / all。',
    input: z.object({ status: z.enum(['pending', 'approved', 'rejected', 'spam', 'invalid', 'queued', 'all']).optional() }),
    annotations: ro,
    run: (env, a) => adminMentions(env, new URL(`https://mcp.internal/?status=${a.status ?? 'pending'}`)),
  },
  {
    name: 'moderate_webmention',
    title: '审核 Webmention',
    description: '审核一条 Webmention：approve 显示 / reject 拒绝 / spam 标记垃圾。',
    input: z.object({ id: z.number().int().positive(), action: z.enum(['approve', 'reject', 'spam']) }),
    annotations: rw(),
    run: (env, a) => moderateMention(env, a.id, a.action),
  },
];
