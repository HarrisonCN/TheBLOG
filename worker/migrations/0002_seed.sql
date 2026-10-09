-- 种子内容：占位资料、默认设置、一篇欢迎文章
INSERT OR IGNORE INTO profile (id, data) VALUES (1, json('{
  "name": "Winston",
  "tagline": "摄影 · 产品体验 · 动效",
  "avatarUrl": "",
  "bioMd": "你好，我是 Winston。这里是我的个人博客，记录摄影、产品体验和前端动效的折腾。\n\n> 这是一段占位简介，可在后台「资料」里修改。",
  "location": "",
  "links": [{ "label": "GitHub", "url": "https://github.com/HarrisonCN" }]
}'));

INSERT OR IGNORE INTO settings (id, data) VALUES (1, json('{
  "siteTitle": "Winston 的博客",
  "siteDescription": "摄影、产品与动效笔记",
  "theme": "system",
  "sections": { "hero": true, "featured": true, "postList": true, "tags": true, "about": true },
  "featuredSlugs": ["welcome"],
  "animation": "normal",
  "postsPerPage": 10
}'));

INSERT OR IGNORE INTO posts (slug, title, summary, content_md, tags, status, published_at) VALUES (
  'welcome',
  '欢迎来到我的博客',
  '新博客上线：Cloudflare Workers + D1 + R2，还能通过 MCP 让 AI 帮我写文章。',
  '# 你好，世界

这是新博客的第一篇文章。

## 这个博客是怎么搭的

- **前端**：静态站点，部署在 Cloudflare Pages，动效来自我自己的 [Motionary](https://github.com/HarrisonCN/Motionary)。
- **后端**：一个 Cloudflare Worker，文章存在 D1，图片存在 R2。
- **MCP**：Worker 自带 `/mcp` 端点，Claude / Cursor 可以直接列出、撰写和发布文章。

```ts
// 也可以用 REST：
await fetch("/api/posts");
```

欢迎常来看看。',
  '["随笔","建站"]',
  'published',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
