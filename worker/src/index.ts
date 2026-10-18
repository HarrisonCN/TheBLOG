import type { Env } from './env';
import { HttpError, errorResponse, json, readJson, withSecurityHeaders } from './http';
import { allowedOrigins, checkOrigin, handleLogin, handleLogout, readSession, requireAdmin, verifyBearer } from './auth';
import { handleMcp } from './mcp';
import { serveImage, uploadFromRequest } from './images';
import { serveAudio, uploadAudioFromRequest } from './audio';
import { CONTENT_KEYS, listQuerySchema, type ContentKey, type ListQuery } from './schema';
import { parsePageQuery, type PageCursor } from './post-page-core';
import type { z } from 'zod';
import * as svc from './service';
import { routeAdmin as communityAdmin, routePublic as communityPublic } from './community';
import { routeReactions } from './reactions';
import { routeAdminComments, routeComments } from './comments';
import { routeSocial } from './social';
import { routeAdminUgc } from './ugc';
import { routeAdminDiscovery } from './discovery';
import { routeAdminStudio } from './studio';
import { routeAdminDm } from './dm';
import { routeAdminOpen, routeOpen, routeOpenSocial, scheduledOpen, verifyMcpToken } from './open';
import { routeAdminMagazine, routeMagazinePublic } from './magazine';
import { routeAdminAv, routeAvPublic } from './av';
import { routeAdminHalls, routeHallsPublic } from './halls';
import { routeAdmin as routeAdminGlossary, routePublic as routePublicGlossary } from './glossary';
import { routeAdmin as routeAdminRetouch, routePublic as routePublicRetouch } from './retouch';
import { routeAdmin as routeAdminChecklists, routePublic as routePublicChecklists } from './checklists';
import { routeAdmin as routeAdminCalendar, routePublic as routePublicCalendar } from './calendar';
import { routeAdmin as routeAdminCourses, routePublic as routePublicCourses } from './courses';
import { routeAdmin as routeAdminCritique, routePublic as routePublicCritique } from './critique';
// @content:wk-imports — L36+ 内容栏目挂载点（scaffold）
import { dispatchEvent, routeAiStudioAdmin, routeAiStudioSocial, routeAp, scheduledWebhooks } from './aistudio';
import { rateLimit } from './community';
import { MCP_LIMITS } from './open-core';
import { reportUnhandled, routeAdminOps, routeOps, scheduledOps } from './ops';
import { routeAdminEditor, routeEditorPublic, scheduledEditor } from './editor';
import { adminAudit, adminTotpEnabled, handleSecondFactor, routeAdminSecurity, routeSecurity, scheduledSecurity } from './security';
export { DmHub } from './dm-hub';

const PUBLIC_CACHE = { 'cache-control': 'public, max-age=30, s-maxage=60' };
const NO_STORE = { 'cache-control': 'no-store' };
// 摘要索引：浏览器 / CDN 短缓存，过期后带 If-None-Match 重新验证（304 不重传）
const INDEX_CACHE = { 'cache-control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300' };

/** 分页参数：limit / cursor 严格校验（越界 → 400），其余字段走 zod。 */
function pageParams(url: URL, schema: z.ZodType<ListQuery>): { cursor: PageCursor | null; q: ListQuery } {
  const sp = url.searchParams;
  const pq = parsePageQuery(sp.get('limit'), sp.get('cursor'));
  if (!pq.ok) throw new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path: pq.field, message: pq.message }]);
  const rest = Object.fromEntries([...sp].filter(([k]) => k !== 'cursor' && k !== 'limit'));
  const q = svc.validate(schema, rest);
  return { cursor: pq.cursor, q: { ...q, limit: pq.limit } };
}

function corsHeaders(req: Request, env: Env, path: string): Record<string, string> {
  const origin = req.headers.get('origin');
  // 公开只读接口：任何来源可读，不带凭据
  if (req.method === 'GET' && path.startsWith('/api/') && !path.startsWith('/api/admin') && !path.startsWith('/api/auth')) {
    return { 'access-control-allow-origin': '*' };
  }
  if (origin && allowedOrigins(env).includes(origin)) {
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'content-type, x-csrf-token, authorization, mcp-protocol-version, mcp-session-id',
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'access-control-expose-headers': 'mcp-session-id, www-authenticate',
      'access-control-max-age': '600',
      vary: 'Origin',
    };
  }
  return {};
}

const isContentKey = (k: string): k is ContentKey => (CONTENT_KEYS as readonly string[]).includes(k);

type Ctx = { waitUntil(p: Promise<unknown>): void } | undefined;

async function route(req: Request, env: Env, url: URL, ctx?: Ctx): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;
  let match: RegExpExecArray | null;

  // ---------- MCP ----------
  if (path === '/mcp') {
    checkOrigin(req, env); // 防 DNS rebinding
    // 站长环境令牌 = admin；L20 会员分层令牌（mcp_…）= 令牌的作用域，按令牌限流
    if (await verifyBearer(req, env)) return handleMcp(req, env);
    const auth = await verifyMcpToken(req, env);
    if (!auth) throw new HttpError(401, 'unauthorized', '需要有效的 Bearer token', { 'www-authenticate': 'Bearer realm="blog-mcp"' });
    await rateLimit(env, 'mcp', String(auth.tokenId), MCP_LIMITS.callsPerMinute, 60, 'MCP 调用太频繁，请稍后再试');
    return handleMcp(req, env, auth);
  }

  // ---------- L20 开放网络：Webmention / 订阅源 / 开放接口 / h-entry 页面 / 退订 ----------
  if (path.startsWith('/api/webmention') || path.startsWith('/api/feeds/') || path.startsWith('/api/open/')) {
    const open = await routeOpen(req, env, path, url, ctx);
    if (open) return open;
    throw new HttpError(404, 'not_found', '接口不存在');
  }

  // ---------- L21 运维：健康检查 / 版本 / 公开状态 / 客户端错误上报 ----------
  if (path === '/api/health' || path === '/api/version' || path === '/api/status' || path === '/api/errors') {
    const ops = await routeOps(req, env, path);
    if (ops) return ops;
  }

  // ---------- L24 即将发布（公开，只有标题与时间） ----------
  if (path === '/api/scheduled') {
    const ed = await routeEditorPublic(req, env, path);
    if (ed) return ed;
  }

  // ---------- L33 视觉杂志（公开：只有已发布期刊） ----------
  if (path === '/api/magazine' || path.startsWith('/api/magazine/')) {
    const mg = await routeMagazinePublic(req, env, path);
    if (mg) return mg;
  }

  // ---------- L34 视频与声音（公开：只有已发布作品） ----------
  if (path === '/api/av' || path.startsWith('/api/av/')) {
    const av = await routeAvPublic(req, env, path);
    if (av) return av;
  }

  // ---------- L35 沉浸式展厅（公开：只有已发布展厅） ----------
  if (path === '/api/halls' || path.startsWith('/api/halls/')) {
    const hl = await routeHallsPublic(req, env, path);
    if (hl) return hl;
  }
  // ---------- L36 摄影术语表（公开：只有已发布） ----------
  if (path === '/api/glossary' || path.startsWith('/api/glossary/')) {
    const r36 = await routePublicGlossary(req, env, path);
    if (r36) return r36;
  }
  // ---------- L37 修图前后对比（公开：只有已发布） ----------
  if (path === '/api/retouch' || path.startsWith('/api/retouch/')) {
    const r37 = await routePublicRetouch(req, env, path);
    if (r37) return r37;
  }
  // ---------- L38 拍摄清单（公开：只有已发布） ----------
  if (path === '/api/checklists' || path.startsWith('/api/checklists/')) {
    const r38 = await routePublicChecklists(req, env, path);
    if (r38) return r38;
  }
  // ---------- L39 照片日历（公开：只有已发布） ----------
  if (path === '/api/calendar' || path.startsWith('/api/calendar/')) {
    const r39 = await routePublicCalendar(req, env, path);
    if (r39) return r39;
  }
  // ---------- L40 课程笔记（公开：只有已发布） ----------
  if (path === '/api/courses' || path.startsWith('/api/courses/')) {
    const r40 = await routePublicCourses(req, env, path);
    if (r40) return r40;
  }
  // ---------- L41 作品点评（公开：只有已发布） ----------
  if (path === '/api/critique' || path.startsWith('/api/critique/')) {
    const r41 = await routePublicCritique(req, env, path);
    if (r41) return r41;
  }
  // @content:wk-public — L36+ 内容栏目挂载点（scaffold）

  // ---------- L31 ActivityPub 只读试验（WebFinger / Actor / Outbox） ----------
  const ap = await routeAp(req, env, path, url);
  if (ap) return ap;
  // ---------- 公开接口 ----------
  if (m === 'GET' || m === 'HEAD') {
    if (path === '/api/posts') {
      const { cursor, q } = pageParams(url, listQuerySchema.omit({ status: true }));
      return json(await svc.listPosts(env, { ...q, cursor }), { headers: PUBLIC_CACHE });
    }
    if (path === '/api/posts/index') {
      const idx = await svc.postIndex(env);
      const etag = `"${idx.version}"`;
      const headers = { ...INDEX_CACHE, etag };
      if ((req.headers.get('if-none-match') ?? '').split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) return new Response(null, { status: 304, headers });
      return new Response(m === 'HEAD' ? null : idx.body, { headers: { ...headers, 'content-type': 'application/json; charset=utf-8' } });
    }
    if ((match = /^\/api\/posts\/([^/]+)$/.exec(path))) {
      return json(await svc.getPost(env, decodeURIComponent(match[1]!)), { headers: PUBLIC_CACHE });
    }
    if (path === '/api/tags') return json({ tags: await svc.listTags(env) }, { headers: PUBLIC_CACHE });
    if (path === '/api/categories') return json({ categories: await svc.listCategories(env) }, { headers: PUBLIC_CACHE });
    if (path === '/api/search-index') return json({ posts: await svc.searchIndex(env) }, { headers: PUBLIC_CACHE });
    if (path === '/api/quotes') return json(await svc.listQuotes(env), { headers: PUBLIC_CACHE });
    if (path === '/api/search') return json(await svc.searchPosts(env, url.searchParams.get('q') ?? '', { tag: url.searchParams.get('tag'), year: url.searchParams.get('year') }), { headers: PUBLIC_CACHE });
    if ((match = /^\/api\/content\/([a-z]+)$/.exec(path)) && isContentKey(match[1]!)) return json({ items: await svc.getContent(env, match[1]) }, { headers: PUBLIC_CACHE });
    if (path === '/api/guestbook') return json(await svc.listGuestbook(env, { status: 'approved' }), { headers: NO_STORE });
    if (path === '/api/profile') return json(await svc.getProfile(env), { headers: PUBLIC_CACHE });
    if (path === '/api/settings') return json(await svc.getSettings(env), { headers: PUBLIC_CACHE });
    if ((match = /^\/api\/(images\/.+)$/.exec(path))) return serveImage(env, match[1]!);
    if ((match = /^\/api\/(audio\/.+)$/.exec(path))) return serveAudio(env, match[1]!, req);
  }

  // ---------- 社区（好朋友 / 便利贴 / 在线 / 上传 / 节日 / 项目） ----------
  if (m === 'POST') checkOrigin(req, env);
  // ---------- L22 账号安全与隐私中心（会员 Bearer；写操作校验 Origin） ----------
  if (path.startsWith('/api/security/')) {
    if (m !== 'GET' && m !== 'HEAD') checkOrigin(req, env);
    const sec = await routeSecurity(req, env, path, url, () => readJson(req, 64 * 1024));
    if (sec) return sec;
    throw new HttpError(404, 'not_found', '接口不存在');
  }
  // ---------- 社交（L15）：用户主页 / 关注 / 拉黑 / 收藏 / 通知；所有写方法都校验 Origin ----------
  if (path.startsWith('/api/social/')) {
    if (m !== 'GET' && m !== 'HEAD') checkOrigin(req, env);
    // 投稿正文（长文最多 2 万字 + 影集 30 张图的元数据）需要比社交接口更大的请求体上限
    // L20 订阅 / MCP 令牌 / AI 建议 / 项目 GitHub 卡片
    // L31 AI 创作台 2.0（预算 + 新的建议类型）在 L20 路由之前
    const ais = await routeAiStudioSocial(req, env, path.slice('/api/social'.length), () => readJson(req, 64 * 1024));
    if (ais) return ais;
    const os = await routeOpenSocial(req, env, path.slice('/api/social'.length), url, () => readJson(req, path.startsWith('/api/social/ai/') ? 64 * 1024 : 16 * 1024));
    if (os) return os;
    const social = await routeSocial(req, env, path, url, () => readJson(req, path.startsWith('/api/social/works') ? 128 * 1024 : 16 * 1024));
    if (social) return social;
    throw new HttpError(404, 'not_found', '接口不存在');
  }
  const reactions = await routeReactions(req, env, path, () => readJson(req, 1024));
  if (reactions) return reactions;
  const comments = await routeComments(req, env, path, () => readJson(req, 8 * 1024));
  if (comments) return comments;
  const community = await communityPublic(req, env, path, url, () => readJson(req, 16 * 1024));
  if (community) return community;

  if (path === '/api/guestbook' && m === 'POST') {
    checkOrigin(req, env);
    return json(await svc.createGuestbook(env, await readJson(req)), { status: 201, headers: NO_STORE });
  }

  // ---------- 登录 ----------
  if (path === '/api/auth/login' && m === 'POST') {
    checkOrigin(req, env);
    return handleLogin(req, env, { secondFactor: adminTotpEnabled, audit: adminAudit(req, env) });
  }
  // L22：管理员二次验证（登录第二步）
  if (path === '/api/auth/2fa' && m === 'POST') {
    checkOrigin(req, env);
    return handleSecondFactor(req, env, await readJson(req, 4096));
  }
  if (path === '/api/auth/logout' && m === 'POST') {
    checkOrigin(req, env);
    return handleLogout(env);
  }
  if (path === '/api/auth/session' && m === 'GET') {
    const s = await readSession(req, env);
    return json(s ? { authenticated: true, csrfToken: s.csrf, expiresAt: new Date(s.exp * 1000).toISOString() } : { authenticated: false }, { headers: NO_STORE });
  }

  // ---------- 后台接口 ----------
  if (path.startsWith('/api/admin/')) {
    checkOrigin(req, env);
    const authCtx = await requireAdmin(req, env);
    const sub = path.slice('/api/admin'.length);
    // L16 社区审核队列 / 操作 / 审核日志 / 社区规则
    const ugcAdmin = await routeAdminUgc(req, env, sub, url, () => readJson(req, 16 * 1024), authCtx.kind === 'token' ? 'token' : 'admin');
    if (ugcAdmin) return ugcAdmin;
    // L17 话题 / 精选创作者 / 认证 / 摄影活动
    const discAdmin = await routeAdminDiscovery(req, env, sub, () => readJson(req, 16 * 1024));
    if (discAdmin) return discAdmin;
    const studioAdmin = await routeAdminStudio(req, env, sub);
    if (studioAdmin) return studioAdmin;
    // L19 活动聊天室配置 / 私信举报快照
    const dmAdmin = await routeAdminDm(req, env, sub, () => readJson(req, 8 * 1024));
    if (dmAdmin) return dmAdmin;
    // L20 Webmention 审核 / 外发、站点角色、AI 开关
    const aiAdmin = await routeAiStudioAdmin(req, env, sub, () => readJson(req, 8 * 1024));
    if (aiAdmin) return aiAdmin;
    // L33 视觉杂志（整期 JSON 最多 64 KB）
    const magAdmin = await routeAdminMagazine(req, env, sub, () => readJson(req, 64 * 1024));
    if (magAdmin) return magAdmin;
    // L34 视频与声音（字幕最多 2000 条，整份 JSON 最多 256 KB）
    const avAdmin = await routeAdminAv(req, env, sub, () => readJson(req, 256 * 1024));
    if (avAdmin) return avAdmin;
    // L35 沉浸式展厅（最多 24 件展品，整份 JSON 最多 64 KB）
    const hallAdmin = await routeAdminHalls(req, env, sub, () => readJson(req, 64 * 1024));
    if (hallAdmin) return hallAdmin;
    // L36 摄影术语表（整份 JSON 最多 64 KB）
    const a36 = await routeAdminGlossary(req, env, sub, () => readJson(req, 64 * 1024));
    if (a36) return a36;
    // L37 修图前后对比（整份 JSON 最多 64 KB）
    const a37 = await routeAdminRetouch(req, env, sub, () => readJson(req, 64 * 1024));
    if (a37) return a37;
    // L38 拍摄清单（整份 JSON 最多 64 KB）
    const a38 = await routeAdminChecklists(req, env, sub, () => readJson(req, 64 * 1024));
    if (a38) return a38;
    // L39 照片日历（整份 JSON 最多 64 KB）
    const a39 = await routeAdminCalendar(req, env, sub, () => readJson(req, 64 * 1024));
    if (a39) return a39;
    // L40 课程笔记（整份 JSON 最多 64 KB）
    const a40 = await routeAdminCourses(req, env, sub, () => readJson(req, 64 * 1024));
    if (a40) return a40;
    // L41 作品点评（整份 JSON 最多 64 KB）
    const a41 = await routeAdminCritique(req, env, sub, () => readJson(req, 64 * 1024));
    if (a41) return a41;
    // @content:wk-admin — L36+ 内容栏目挂载点（scaffold）
    const openAdmin = await routeAdminOpen(req, env, sub, url, () => readJson(req, 8 * 1024), ctx);
    if (openAdmin) return openAdmin;
    // L21 运行状态 / 错误事件 / 手动健康检查
    const opsAdmin = await routeAdminOps(req, env, sub, url);
    if (opsAdmin) return opsAdmin;
    // L24 内容编辑器 2.0：草稿 / 定时发布 / 媒体库 / 模板（草稿正文最多 20 万字符）
    const edAdmin = await routeAdminEditor(req, env, sub, url, () => readJson(req, 512 * 1024));
    if (edAdmin) return edAdmin;
    // L22 管理员二次验证
    const secAdmin = await routeAdminSecurity(req, env, sub, url, () => readJson(req, 4096));
    if (secAdmin) return secAdmin;
    if (sub === '/posts' && m === 'GET') {
      const { cursor, q } = pageParams(url, listQuerySchema);
      return json(await svc.listPosts(env, { ...q, cursor, includeDrafts: true }), { headers: NO_STORE });
    }
    if (sub === '/posts' && m === 'POST') {
      const post = await svc.createPost(env, await readJson(req));
      // L31 Webhook：新发布的文章排队 post.published（失败不影响发布）
      if (post.status === 'published') await dispatchEvent(env, 'post.published', { slug: post.slug, title: post.title, summary: post.summary ?? '', publishedAt: post.publishedAt ?? null }).catch(() => 0);
      return json(post, { status: 201, headers: NO_STORE });
    }
    if ((match = /^\/posts\/([^/]+)\/publish$/.exec(sub)) && m === 'POST') {
      const body = (await readJson(req)) as { published?: unknown };
      return json(await svc.setPublished(env, decodeURIComponent(match[1]!), body.published !== false), { headers: NO_STORE });
    }
    if ((match = /^\/posts\/([^/]+)$/.exec(sub))) {
      const slug = decodeURIComponent(match[1]!);
      if (m === 'GET') return json(await svc.getPost(env, slug, { includeDrafts: true }), { headers: NO_STORE });
      if (m === 'PATCH' || m === 'PUT') return json(await svc.updatePost(env, slug, await readJson(req)), { headers: NO_STORE });
      if (m === 'DELETE') return json(await svc.deletePost(env, slug), { headers: NO_STORE });
    }
    if (sub === '/profile') {
      if (m === 'GET') return json(await svc.getProfile(env), { headers: NO_STORE });
      if (m === 'PATCH' || m === 'PUT') return json(await svc.updateProfile(env, await readJson(req)), { headers: NO_STORE });
    }
    if (sub === '/settings') {
      if (m === 'GET') return json(await svc.getSettings(env), { headers: NO_STORE });
      if (m === 'PATCH' || m === 'PUT') return json(await svc.updateSettings(env, await readJson(req)), { headers: NO_STORE });
    }
    if ((match = /^\/content\/([a-z]+)$/.exec(sub)) && isContentKey(match[1]!)) {
      if (m === 'GET') return json({ items: await svc.getContent(env, match[1]) }, { headers: NO_STORE });
      if (m === 'PUT') {
        const body = (await readJson(req)) as { items?: unknown };
        return json({ items: await svc.setContent(env, match[1], body?.items) }, { headers: NO_STORE });
      }
    }
    if (sub === '/guestbook' && m === 'GET') {
      const st = url.searchParams.get('status');
      const status = st === 'pending' || st === 'approved' || st === 'hidden' ? st : 'all';
      return json(await svc.listGuestbook(env, { status, limit: 500 }), { headers: NO_STORE });
    }
    if ((match = /^\/guestbook\/(\d+)$/.exec(sub)) && m === 'POST') {
      const body = (await readJson(req)) as { action?: unknown };
      return json(await svc.moderateGuestbook(env, { id: Number(match[1]), action: body?.action }), { headers: NO_STORE });
    }
    if (sub === '/images' && m === 'POST') return json(await uploadFromRequest(env, req), { status: 201, headers: NO_STORE });
    if (sub === '/audio' && m === 'POST') return json(await uploadAudioFromRequest(env, req), { status: 201, headers: NO_STORE });
    const adminComments = await routeAdminComments(req, env, sub, url, () => readJson(req));
    if (adminComments) return adminComments;
    const admin = await communityAdmin(req, env, sub, () => readJson(req));
    if (admin) return admin;
    throw new HttpError(404, 'not_found', '接口不存在');
  }

  throw new HttpError(404, 'not_found', '接口不存在');
}

export default {
  async fetch(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const cors = corsHeaders(req, env, path);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let res: Response;
    try {
      res = await route(req, env, url, ctx);
    } catch (e) {
      // L21：未处理异常（以及 5xx 的 HttpError）→ 结构化日志 + 错误事件（waitUntil，不拖慢响应）
      if (!(e instanceof HttpError) || e.status >= 500) reportUnhandled(env, req, e, ctx);
      res = errorResponse(e, true);
    }
    // WebSocket 升级（L19 私信实时层）：101 响应原样返回，不能重新包装（会丢掉 webSocket）
    if (res.status === 101) return res;
    res = withSecurityHeaders(res);
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
  // 定时任务（wrangler.jsonc triggers.crons，每 15 分钟）：L20 Webmention 重试验证 + 邮件摘要
  // L22：security = 清理过期 challenge / 超期安全记录 + 清除冷静期已满的注销账号
  // L21：每次触发先记录健康检查，再跑各个任务；每个任务的最近一次运行写进 ops_runs（状态页显示）
  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(scheduledOps(env, { open: () => scheduledOpen(env), security: () => scheduledSecurity(env), editor: () => scheduledEditor(env), webhooks: () => scheduledWebhooks(env) }));
  },
} satisfies ExportedHandler<Env>;
