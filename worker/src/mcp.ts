/**
 * 极简但符合规范的 MCP 服务端（Streamable HTTP，无状态，JSON 响应）。
 * - POST /mcp：JSON-RPC 请求 / 通知 / 批量；请求返回 application/json，通知返回 202。
 * - GET /mcp：不提供服务端推送流，返回 405（规范允许）。
 * - 不分配 Mcp-Session-Id（规范允许无状态服务端）。
 */
import { z } from 'zod';
import type { Env } from './env';
import { HttpError, json } from './http';
import { b64Decode } from './crypto';
import { storeImage, MAX_IMAGE_BYTES } from './images';
import * as svc from './service';
import { CONTENT_KEYS, albumSchema, favoriteSchema, friendSchema, guestbookModerateSchema, listQuerySchema, postCreateSchema, postUpdateSchema, profilePatchSchema, settingsPatchSchema, slugSchema } from './schema';

export const SERVER_INFO = { name: 'winston-blog', title: 'Winston 的博客', version: '0.2.0' };
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST = SUPPORTED_PROTOCOL_VERSIONS[0]!;

interface ToolDef {
  name: string;
  title: string;
  description: string;
  input: z.ZodObject;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run: (env: Env, args: any) => Promise<unknown>;
}

const slugArg = z.object({ slug: slugSchema.describe('文章 slug') });

export const TOOLS: ToolDef[] = [
  {
    name: 'list_posts',
    title: '列出文章',
    description: '列出文章（含草稿），可按状态、标签过滤并分页。返回摘要，不含正文。',
    input: listQuerySchema.extend({ status: z.enum(['draft', 'published', 'all']).optional().describe('默认 all') }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (env, a) => svc.listPosts(env, { ...a, includeDrafts: true }),
  },
  {
    name: 'get_post',
    title: '获取文章',
    description: '按 slug 获取一篇文章（含草稿）的完整内容，包括 Markdown 正文。',
    input: slugArg,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (env, a) => svc.getPost(env, a.slug, { includeDrafts: true }),
  },
  {
    name: 'create_post',
    title: '新建文章',
    description: '新建文章，默认保存为草稿；status 设为 published 则立即发布。',
    input: postCreateSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: (env, a) => svc.createPost(env, a),
  },
  {
    name: 'update_post',
    title: '修改文章',
    description: '按 slug 修改文章的标题、正文、摘要、标签、分类、置顶、封面或 slug。只需传要改的字段。',
    input: postUpdateSchema.extend({ slug: slugSchema.describe('要修改的文章 slug'), newSlug: slugSchema.optional().describe('新的 slug（重命名）') }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (env, a) => {
      const { slug, newSlug, ...rest } = a;
      return svc.updatePost(env, slug, { ...rest, ...(newSlug ? { slug: newSlug } : {}) });
    },
  },
  {
    name: 'delete_post',
    title: '删除文章',
    description: '按 slug 永久删除一篇文章。不可撤销。',
    input: slugArg,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: (env, a) => svc.deletePost(env, a.slug),
  },
  {
    name: 'publish_post',
    title: '发布 / 撤回文章',
    description: '发布文章；published 设为 false 则撤回为草稿。',
    input: slugArg.extend({ published: z.boolean().optional().describe('默认 true') }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (env, a) => svc.setPublished(env, a.slug, a.published ?? true),
  },
  {
    name: 'get_profile',
    title: '获取个人资料',
    description: '获取「关于」页面使用的个人资料。',
    input: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (env) => svc.getProfile(env),
  },
  {
    name: 'update_profile',
    title: '修改个人资料',
    description: '修改个人资料（只需传要改的字段）：name、tagline（座右铭）、avatarUrl、bioMd、location、homeUrl（「前往小窝」按钮）、links（社交链接，可带 icon）。',
    input: profilePatchSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (env, a) => svc.updateProfile(env, a),
  },
  {
    name: 'get_settings',
    title: '获取展示设置',
    description: '获取站点展示设置：主题、显示哪些区块、精选文章、动效强度等。',
    input: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (env) => svc.getSettings(env),
  },
  {
    name: 'update_settings',
    title: '修改展示设置',
    description: '修改展示设置（只需传要改的字段）。theme: system|light|dark；animation: off|low|normal|high；sections 控制首页与侧栏区块；heroImage 横幅背景；heroSubtitles 打字机副标题；announcement 公告栏（Markdown）。',
    input: settingsPatchSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (env, a) => svc.updateSettings(env, a),
  },
  {
    name: 'upload_image',
    title: '上传图片',
    description: `上传图片到 R2（PNG/JPEG/WebP/GIF/AVIF，≤ ${MAX_IMAGE_BYTES / 1024 / 1024} MB），返回 URL 和可直接插入正文的 Markdown。`,
    input: z.object({
      dataBase64: z.string().min(4).max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8).describe('图片内容（base64，不含 data: 前缀）'),
      contentType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']),
      alt: z.string().max(100).optional().describe('替代文本'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: async (env, a) => {
      let bytes: Uint8Array;
      try {
        bytes = b64Decode(a.dataBase64.replace(/\s+/g, ''));
      } catch {
        throw new HttpError(400, 'invalid_base64', 'dataBase64 不是合法的 base64');
      }
      return storeImage(env, bytes, a.contentType, a.alt ?? '');
    },
  },
  {
    name: 'list_categories',
    title: '列出分类与标签',
    description: '列出已发布文章的分类和标签及各自的文章数。',
    input: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (env) => ({ categories: await svc.listCategories(env), tags: await svc.listTags(env) }),
  },
  {
    name: 'get_site_content',
    title: '获取站点内容',
    description: '获取友链（friends）、画廊相册（gallery）或收藏（favorites）列表。',
    input: z.object({ key: z.enum(CONTENT_KEYS).describe('friends | gallery | favorites') }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (env, a) => ({ key: a.key, items: await svc.getContent(env, a.key) }),
  },
  {
    name: 'update_friends',
    title: '更新友链',
    description: '用新列表整体替换友链。每项：name、url、avatar（可选）、description（可选）。',
    input: z.object({ items: z.array(friendSchema).max(100) }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: async (env, a) => ({ items: await svc.setContent(env, 'friends', a.items) }),
  },
  {
    name: 'update_gallery',
    title: '更新画廊',
    description: '用新列表整体替换画廊相册。每个相册：slug、title、description、cover、date、photos[{url, caption, width, height}]。',
    input: z.object({ items: z.array(albumSchema).max(50) }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: async (env, a) => ({ items: await svc.setContent(env, 'gallery', a.items) }),
  },
  {
    name: 'update_favorites',
    title: '更新收藏',
    description: '用新列表整体替换「收藏」页（推荐的网站、工具、器材等）。每项：title、url、description、group。',
    input: z.object({ items: z.array(favoriteSchema).max(200) }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: async (env, a) => ({ items: await svc.setContent(env, 'favorites', a.items) }),
  },
  {
    name: 'list_guestbook',
    title: '列出留言',
    description: '列出留言板留言，status 默认 pending（待审核）。',
    input: z.object({ status: z.enum(['pending', 'approved', 'hidden', 'all']).optional() }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (env, a) => svc.listGuestbook(env, { status: a.status ?? 'pending', limit: 200 }),
  },
  {
    name: 'moderate_guestbook',
    title: '审核留言',
    description: '审核一条留言：approve 公开显示、hide 隐藏、delete 永久删除。',
    input: guestbookModerateSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: (env, a) => svc.moderateGuestbook(env, a),
  },
];

function inputSchemaOf(t: ToolDef): Record<string, unknown> {
  const { $schema: _s, ...schema } = z.toJSONSchema(t.input, { io: 'input' }) as Record<string, unknown>;
  return { type: 'object', ...schema };
}

export function listTools() {
  return TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: inputSchemaOf(t), annotations: t.annotations }));
}

type Id = string | number;
interface RpcMessage {
  jsonrpc?: unknown;
  id?: Id | null;
  method?: unknown;
  params?: any;
  result?: unknown;
  error?: unknown;
}

const rpcError = (id: Id | null, code: number, message: string, data?: unknown) => ({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } });
const rpcResult = (id: Id, result: unknown) => ({ jsonrpc: '2.0', id, result });

async function callTool(env: Env, params: any) {
  const name = params?.name;
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { error: { code: -32602, message: `未知工具：${String(name)}` } };
  const parsed = tool.input.safeParse(params?.arguments ?? {});
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    return { result: { content: [{ type: 'text', text: `参数校验失败：${msg}` }], isError: true } };
  }
  try {
    const out = await tool.run(env, parsed.data);
    return { result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out as Record<string, unknown>, isError: false } };
  } catch (e) {
    if (e instanceof HttpError) {
      const details = e.details ? ` ${JSON.stringify(e.details)}` : '';
      return { result: { content: [{ type: 'text', text: `${e.code}: ${e.message}${details}` }], isError: true } };
    }
    console.error('tool error', name, e);
    return { result: { content: [{ type: 'text', text: '工具执行失败（服务器内部错误）' }], isError: true } };
  }
}

async function handleMessage(env: Env, msg: RpcMessage): Promise<object | null> {
  const isRequest = msg && typeof msg === 'object' && 'id' in msg && msg.id !== undefined && msg.id !== null && typeof msg.method === 'string';
  const isNotification = msg && typeof msg === 'object' && typeof msg.method === 'string' && !('id' in msg && msg.id !== undefined);
  const isResponse = msg && typeof msg === 'object' && !('method' in msg) && ('result' in msg || 'error' in msg);
  if (isNotification || isResponse) return null;
  if (!isRequest || msg.jsonrpc !== '2.0') {
    const id = msg && typeof msg === 'object' && (typeof msg.id === 'string' || typeof msg.id === 'number') ? msg.id : null;
    return rpcError(id, -32600, 'Invalid Request');
  }
  const id = msg.id as Id;
  switch (msg.method) {
    case 'initialize': {
      const requested = msg.params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST;
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: '这是 Winston 个人博客的管理接口。文章用 slug 标识；create_post 默认存为草稿，确认后用 publish_post 发布。正文为 Markdown。',
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: listTools() });
    case 'tools/call': {
      const r = await callTool(env, msg.params);
      return 'error' in r && r.error ? rpcError(id, r.error.code, r.error.message) : rpcResult(id, r.result);
    }
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

/** 调用前已完成鉴权与 Origin 校验。 */
export async function handleMcp(req: Request, env: Env): Promise<Response> {
  const headers = { 'cache-control': 'no-store' };
  if (req.method === 'GET' || req.method === 'DELETE') {
    return new Response(null, { status: 405, headers: { ...headers, allow: 'POST' } });
  }
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: { ...headers, allow: 'POST' } });

  const pv = req.headers.get('mcp-protocol-version');
  if (pv && !SUPPORTED_PROTOCOL_VERSIONS.includes(pv)) {
    return json(rpcError(null, -32600, `Unsupported MCP-Protocol-Version: ${pv}`), { status: 400, headers });
  }
  const ct = (req.headers.get('content-type') ?? '').toLowerCase();
  if (!ct.includes('application/json')) {
    return json(rpcError(null, -32700, 'Content-Type 必须是 application/json'), { status: 415, headers });
  }
  const text = await req.text();
  if (text.length > 8 * 1024 * 1024) return json(rpcError(null, -32600, '请求体过大'), { status: 413, headers });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(rpcError(null, -32700, 'Parse error'), { status: 400, headers });
  }

  if (Array.isArray(body)) {
    if (body.length === 0) return json(rpcError(null, -32600, 'Invalid Request'), { status: 400, headers });
    const out = (await Promise.all(body.map((m) => handleMessage(env, m as RpcMessage)))).filter(Boolean);
    return out.length ? json(out, { headers }) : new Response(null, { status: 202, headers });
  }
  const out = await handleMessage(env, body as RpcMessage);
  return out ? json(out, { headers }) : new Response(null, { status: 202, headers });
}
