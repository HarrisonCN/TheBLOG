#!/usr/bin/env node
/**
 * 端到端：wrangler dev（本地 D1/R2）→ 用官方 MCP SDK 客户端调用工具创建 / 修改 / 发布文章
 * → 后台 REST 登录 → 前端构建（预渲染）→ 确认文章出现在构建产物中。
 * 用法：npm run e2e   （不需要任何 Cloudflare 凭据）
 */
import { spawn, execFileSync } from 'node:child_process';
import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workerDir = join(root, 'worker');
const webDir = join(root, 'web');
const state = join(root, '.e2e', 'state');
const PORT = Number(process.env.E2E_PORT ?? 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'e2e-password-' + randomBytes(6).toString('hex');
const TOKEN = 'blog_e2e_' + randomBytes(24).toString('base64url');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' };

const step = (m) => console.log(`\n▶ ${m}`);
const assert = (cond, m) => {
  if (!cond) throw new Error(`断言失败：${m}`);
  console.log(`  ✓ ${m}`);
};

rmSync(join(root, '.e2e'), { recursive: true, force: true });
mkdirSync(state, { recursive: true });

step('应用 D1 迁移（本地）');
execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'blog', '--local', '--persist-to', state], { cwd: workerDir, env, stdio: 'pipe' });

const salt = randomBytes(16);
const pwHash = `pbkdf2$100000$${salt.toString('base64')}$${pbkdf2Sync(PASSWORD, salt, 100_000, 32, 'sha256').toString('base64')}`;
const vars = {
  JWT_SECRET: randomBytes(32).toString('base64url'),
  ADMIN_PASSWORD_HASH: pwHash,
  API_TOKEN_HASH: createHash('sha256').update(TOKEN).digest('hex'),
  COOKIE_SECURE: 'false',
};

step(`启动 wrangler dev :${PORT}`);
const dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', state, ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])], {
  cwd: workerDir,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
let devLog = '';
dev.stdout.on('data', (d) => (devLog += d));
dev.stderr.on('data', (d) => (devLog += d));
const stop = () => {
  try {
    process.kill(-dev.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
};
process.on('exit', stop);

try {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) break;
    } catch {
      /* not yet */
    }
    if (i > 120) throw new Error(`wrangler dev 启动超时\n${devLog}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  assert(true, 'Worker 已就绪');

  step('MCP SDK 客户端（Streamable HTTP）');
  const client = new Client({ name: 'blog-e2e', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } });
  await client.connect(transport);
  assert(client.getServerVersion()?.name === 'winston-blog', `initialize 成功，协议 ${transport.protocolVersion ?? '(未知)'}`);
  const { tools } = await client.listTools();
  assert(tools.length === 28, `tools/list 返回 ${tools.length} 个工具`);

  const slug = 'e2e-hello-mcp';
  let r = await client.callTool({ name: 'create_post', arguments: { title: 'E2E 初稿', slug, contentMd: '初稿内容', tags: ['e2e'] } });
  assert(!r.isError && r.structuredContent.status === 'draft', 'create_post 创建草稿');
  r = await client.callTool({ name: 'update_post', arguments: { slug, title: '来自 MCP 的文章', summary: '通过 MCP 工具创建并发布', contentMd: '## MCP 写的小节\n\n这段文字由 **MCP** 客户端写入。\n\n<script>alert(1)</script>' } });
  assert(!r.isError && r.structuredContent.title === '来自 MCP 的文章', 'update_post 修改标题与正文');
  const draftPublic = await fetch(`${BASE}/api/posts/${slug}`);
  assert(draftPublic.status === 404, '草稿对公开接口不可见');
  r = await client.callTool({ name: 'publish_post', arguments: { slug } });
  assert(!r.isError && r.structuredContent.status === 'published', 'publish_post 发布');
  r = await client.callTool({ name: 'update_settings', arguments: { featuredSlugs: ['welcome', slug] } });
  assert(!r.isError, 'update_settings 设置精选');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  r = await client.callTool({ name: 'upload_image', arguments: { dataBase64: png.toString('base64'), contentType: 'image/png', alt: 'pixel' } });
  assert(!r.isError && (await fetch(BASE + r.structuredContent.url)).status === 200, 'upload_image 写入 R2 并可读取');
  await client.close();

  step('后台 REST：密码登录 → Cookie 会话 + CSRF');
  const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  const { csrfToken } = await login.json();
  assert(login.status === 200 && cookie.startsWith('blog_session='), '登录成功并下发 httpOnly Cookie');
  const noCsrf = await fetch(`${BASE}/api/admin/profile`, { method: 'PATCH', headers: { cookie, 'content-type': 'application/json' }, body: '{"location":"x"}' });
  assert(noCsrf.status === 403, '缺少 CSRF token 的写请求被拒');
  const withCsrf = await fetch(`${BASE}/api/admin/profile`, { method: 'PATCH', headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: '{"location":"长沙"}' });
  assert(withCsrf.status === 200, '带 CSRF token 的写请求成功');

  step('前端构建 + 预渲染（BLOG_API_URL 指向本地 Worker）');
  execFileSync('npm', ['run', 'build'], { cwd: webDir, env: { ...env, BLOG_API_URL: BASE }, stdio: 'pipe' });
  const postHtml = join(webDir, 'dist', 'posts', slug, 'index.html');
  assert(existsSync(postHtml), `生成 dist/posts/${slug}/index.html`);
  const html = readFileSync(postHtml, 'utf8');
  assert(html.includes('<title>来自 MCP 的文章 | Winston 的博客</title>'), '文章页 <title> 正确');
  assert(/<h2 id="[^"]+">MCP 写的小节<\/h2>/.test(html) && html.includes('<strong>MCP</strong>'), 'Markdown 正文已渲染进 HTML');
  assert(!html.includes('<script>alert(1)</script>') && html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), '正文中的 <script> 被转义');
  const home = readFileSync(join(webDir, 'dist', 'index.html'), 'utf8');
  assert(home.includes(`href="/posts/${slug}/"`) && home.includes('精选'), '首页列出该文章且显示精选');
  assert(existsSync(join(webDir, 'dist', 'tags', 'e2e', 'index.html')), '生成标签页 /tags/e2e/');
  assert(readFileSync(join(webDir, 'dist', 'about', 'index.html'), 'utf8').includes('长沙'), '关于页包含后台修改的资料');
  console.log('\n✅ E2E 全部通过');
} catch (e) {
  console.error('\n❌ E2E 失败：', e.message);
  console.error(devLog.split('\n').slice(-30).join('\n'));
  process.exitCode = 1;
} finally {
  stop();
}
