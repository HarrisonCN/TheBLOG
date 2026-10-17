# 视觉杂志（L33 · 1.33.0）

把照片和文章排成一期期小杂志。栏目：**摄影 › 视觉杂志**。

## 页面

- `/magazine/`：每期一张封面卡片（期号、标题、月份、篇目数 / 照片数 / 页数）。
- `/magazine/:slug/`：封面（第 1 页）→ 编者按 → 目录（第 2 页，带页码和锚点）→ 各篇 → 上一期 / 下一期。
- 两个页面都预渲染进静态 HTML（没有 JS 也完整可读），并进 sitemap。

## 篇目类型（`magazine-core.ts`，web 与 worker 逐字相同）

| 类型 | 说明 |
| --- | --- |
| `feature` 专题 | 大图 + 正文 + 其余图片一行；可链到站内文章（「阅读全文」） |
| `spread` 对页 | `planSpread` 按宽高比选版式：全幅 / 全景 / 左右对页 / 竖图成对 |
| `gallery` 画廊 | `galleryRows` 按宽高比分行（每行 ≤ 3 张） |
| `quote` 引语 | 引文 + 出处 |
| `brief` 短讯 | 一段文字 |

`pageMap` 给每篇分配页码（封面 1、目录 2，之后按篇目所占版面递增）。`validateIssue` 校验：期号是 1–999 的整数（写入时不能与别的期重复）、slug、每张图都要有替代文字和宽高、每期至少一篇。

## 交互与无障碍

- 键盘：`J` / `→` 下一篇，`K` / `←` 上一篇（输入框里不触发）；焦点移到该篇 `<section>`（每篇有可读名称）。
- 每页恰好一个 h1；图片全部有 alt 和 width / height（不跳版）。
- 打印样式：每篇另起一页，隐藏导航。

## 接口（Worker）

- `GET /api/magazine`：已发布期刊摘要（期号倒序）；`GET /api/magazine/:slug`：已发布的一期。
- 站长：`GET /api/admin/magazine`（含草稿）、`GET / PUT / DELETE /api/admin/magazine/:slug`（PUT 整期写入，`validateIssue` 校验；期号已被别的期刊占用 → 400 validation_error）。在权限矩阵测试里（匿名 401、会员 403）。
- 存储：D1 `magazine_issues`，迁移 `0024_magazine.sql`（只新增表）。

## 演示数据

演示站有两期**虚构**样刊（`web/src/demo/mock-magazine.ts`：No.2 海岸、No.1 山间），照片来自站内已有的演示图片，文字为虚构示例。

## 没有做 / 推迟（如实记录）

- **站长后台的杂志编辑界面推迟**：本版只有接口（PUT 整期 JSON）和校验，后台还没有可视化排版编辑器。
- 正式 D1 上执行迁移 = SKIPPED-verifiable（Cloudflare 未配置部署凭据）；测试里由 miniflare 执行迁移。
- PDF 导出、订阅推送新一期：未做。
