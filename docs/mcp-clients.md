# 用 Claude / Cursor 管理博客（MCP）

博客 Worker 自带一个 MCP 端点：`https://<你的域名>/mcp`（本地：`http://127.0.0.1:8787/mcp`）。

- 传输：Streamable HTTP（无状态，JSON 响应；`GET /mcp` 返回 405，属规范允许的行为）
- 协议版本：`2025-11-25`、`2025-06-18`、`2025-03-26`、`2024-11-05`
- 鉴权：`Authorization: Bearer <API token>`。Worker 里只存 token 的 SHA-256（`API_TOKEN_HASH`），明文 token 只交给客户端或网关。
- 浏览器发来的跨站请求（`Origin` 不是本站且不在 `ALLOWED_ORIGINS`）会被拒绝（防 DNS rebinding）。

## 工具

| 工具 | 作用 | 备注 |
|---|---|---|
| `list_posts` | 列出文章（含草稿） | `status` = draft / published / all，`tag`、`limit`、`offset` |
| `get_post` | 按 slug 读取全文 | 含 Markdown |
| `create_post` | 新建文章 | 默认草稿；`status: "published"` 立即发布 |
| `update_post` | 修改文章 | 只传要改的字段；`newSlug` 可重命名 |
| `delete_post` | 永久删除 | `destructiveHint: true` |
| `publish_post` | 发布 / 撤回 | `published: false` 撤回为草稿 |
| `get_profile` / `update_profile` | 「关于」资料 | 局部更新 |
| `get_settings` / `update_settings` | 展示设置 | 主题、区块、精选、动效强度 |
| `upload_image` | 上传图片到 R2 | base64，≤ 5 MB，PNG/JPEG/WebP/GIF/AVIF；返回可插入正文的 Markdown |

## 方式一：客户端直连 Worker

生成 token：

```bash
node worker/scripts/hash-secret.mjs token
# TOKEN（交给客户端）: blog_xxxxxxxx
# API_TOKEN_HASH: 3f2a…   → cd worker && npx wrangler secret put API_TOKEN_HASH
```

**Claude Code**

```bash
claude mcp add --transport http blog https://blog.example.com/mcp --header "Authorization: Bearer blog_xxxxxxxx"
```

**Claude Desktop**（用 [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) 桥接成 stdio；`${BLOG_AUTH}` 由 mcp-remote 从 env 展开，冒号后不留空格可避免部分客户端的参数转义问题）

```json
{
  "mcpServers": {
    "blog": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://blog.example.com/mcp", "--header", "Authorization:${BLOG_AUTH}"],
      "env": { "BLOG_AUTH": "Bearer blog_xxxxxxxx" }
    }
  }
}
```

**Cursor**（`~/.cursor/mcp.json` 或项目内 `.cursor/mcp.json`）

```json
{ "mcpServers": { "blog": { "url": "https://blog.example.com/mcp", "headers": { "Authorization": "Bearer blog_xxxxxxxx" } } } }
```

## 方式二：经由 mcp-gateway

[`@winstonsayno/mcp-gateway`](https://www.npmjs.com/package/@winstonsayno/mcp-gateway)（v11，Node ≥ 22）是 Node 服务，不能跑在 Workers 里——把它跑在本机或服务器上，把博客作为 HTTP 上游接入，就能和其他 MCP 服务器一起统一鉴权、限流、审计。

示例配置：[`gateway/gateway.config.yaml`](../gateway/gateway.config.yaml)（`version: 11`，`transport: streamable-http`，`headers.Authorization` 用 `${BLOG_MCP_TOKEN}` 从环境变量注入）。

```bash
npx @winstonsayno/mcp-gateway gen-key          # key 给客户端，hash 填进 auth.apiKeys
# 编辑 gateway.config.yaml：servers[0].url 改成你的 https://<域名>/mcp
export BLOG_MCP_TOKEN=blog_xxxxxxxx            # 博客 token 只留在网关这一侧
npx @winstonsayno/mcp-gateway validate --strict -c gateway/gateway.config.yaml
npx @winstonsayno/mcp-gateway start -c gateway/gateway.config.yaml
```

然后客户端连网关：

```bash
claude mcp add --transport http gateway http://localhost:4000/mcp --header "Authorization: Bearer <gateway key>"
```

```json
{ "mcpServers": { "gateway": { "url": "http://localhost:4000/mcp", "headers": { "Authorization": "Bearer <gateway key>" } } } }
```

或者走网关的 REST：

```bash
curl -H "Authorization: Bearer <gateway key>" http://localhost:4000/api/v1/tools
curl -X POST http://localhost:4000/api/v1/tools/call -H "Authorization: Bearer <gateway key>" \
  -H "Content-Type: application/json" -d '{"tool":"list_posts","arguments":{"status":"all"}}'
```

## 安全提示

- token 等同后台权限（可删除文章）。泄露时：生成新 token → `wrangler secret put API_TOKEN_HASH`（可先用逗号同时放新旧两个哈希，切换完再删旧的）。
- 不要把 token 写进前端代码或提交到仓库。
