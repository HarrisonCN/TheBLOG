import type { Env } from './env';
import { HttpError, errorResponse, json, readJson, withSecurityHeaders } from './http';
import { allowedOrigins, checkOrigin, handleLogin, handleLogout, readSession, requireAdmin, verifyBearer } from './auth';
import { handleMcp } from './mcp';
import { serveImage, uploadFromRequest } from './images';
import { serveAudio, uploadAudioFromRequest } from './audio';
import { CONTENT_KEYS, listQuerySchema, type ContentKey } from './schema';
import * as svc from './service';
import { routeAdmin as communityAdmin, routePublic as communityPublic } from './community';
import { routeReactions } from './reactions';
import { routeAdminComments, routeComments } from './comments';

const PUBLIC_CACHE = { 'cache-control': 'public, max-age=30, s-maxage=60' };
const NO_STORE = { 'cache-control': 'no-store' };

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

async function route(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;
  let match: RegExpExecArray | null;

  // ---------- MCP ----------
  if (path === '/mcp') {
    checkOrigin(req, env); // 防 DNS rebinding
    if (!(await verifyBearer(req, env))) {
      throw new HttpError(401, 'unauthorized', '需要 Bearer token', { 'www-authenticate': 'Bearer realm="blog-mcp"' });
    }
    return handleMcp(req, env);
  }

  // ---------- 公开接口 ----------
  if (m === 'GET' || m === 'HEAD') {
    if (path === '/api/health') return json({ ok: true }, { headers: NO_STORE });
    if (path === '/api/posts') {
      const q = svc.validate(listQuerySchema.omit({ status: true }), Object.fromEntries(url.searchParams));
      return json(await svc.listPosts(env, q), { headers: PUBLIC_CACHE });
    }
    if ((match = /^\/api\/posts\/([^/]+)$/.exec(path))) {
      return json(await svc.getPost(env, decodeURIComponent(match[1]!)), { headers: PUBLIC_CACHE });
    }
    if (path === '/api/tags') return json({ tags: await svc.listTags(env) }, { headers: PUBLIC_CACHE });
    if (path === '/api/categories') return json({ categories: await svc.listCategories(env) }, { headers: PUBLIC_CACHE });
    if (path === '/api/search-index') return json({ posts: await svc.searchIndex(env) }, { headers: PUBLIC_CACHE });
    if ((match = /^\/api\/content\/([a-z]+)$/.exec(path)) && isContentKey(match[1]!)) return json({ items: await svc.getContent(env, match[1]) }, { headers: PUBLIC_CACHE });
    if (path === '/api/guestbook') return json(await svc.listGuestbook(env, { status: 'approved' }), { headers: NO_STORE });
    if (path === '/api/profile') return json(await svc.getProfile(env), { headers: PUBLIC_CACHE });
    if (path === '/api/settings') return json(await svc.getSettings(env), { headers: PUBLIC_CACHE });
    if ((match = /^\/api\/(images\/.+)$/.exec(path))) return serveImage(env, match[1]!);
    if ((match = /^\/api\/(audio\/.+)$/.exec(path))) return serveAudio(env, match[1]!, req);
  }

  // ---------- 社区（好朋友 / 便利贴 / 在线 / 上传 / 节日 / 项目） ----------
  if (m === 'POST') checkOrigin(req, env);
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
    return handleLogin(req, env);
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
    await requireAdmin(req, env);
    const sub = path.slice('/api/admin'.length);
    if (sub === '/posts' && m === 'GET') {
      const q = svc.validate(listQuerySchema, Object.fromEntries(url.searchParams));
      return json(await svc.listPosts(env, { ...q, includeDrafts: true }), { headers: NO_STORE });
    }
    if (sub === '/posts' && m === 'POST') return json(await svc.createPost(env, await readJson(req)), { status: 201, headers: NO_STORE });
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
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const cors = corsHeaders(req, env, path);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let res: Response;
    try {
      res = await route(req, env, url);
    } catch (e) {
      res = errorResponse(e);
    }
    res = withSecurityHeaders(res);
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
} satisfies ExportedHandler<Env>;
