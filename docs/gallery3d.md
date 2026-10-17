# 3D 与沉浸式展厅（L35 · 1.35.0）

摄影栏目下的 **沉浸式展厅**（`/halls/`）把一组照片挂上一间有四面墙（北 / 东 / 南 / 西）的展厅。

## 读者看到的

- `/halls/`：展厅卡片（封面 = 导览第一件、件数、墙面数、日期）。
- `/halls/:slug/`：**平面展品列表是基线**——按导览顺序（北 → 东 → 南 → 西，同一面墙保持录入顺序）排列的图片、替代文字、墙面和说明。预渲染进静态 HTML，没有 JS、浏览器不支持 3D、打印时都完整可读。
- **立体视图**（`hall-client`，按需加载）：CSS 3D 房间（`perspective` + `preserve-3d`，没有 WebGL、没有新依赖），房间转向当前展品所在的墙（走最近的角度）。
  - 默认跟随系统：`prefers-reduced-motion: reduce` 或不支持 `transform-style: preserve-3d` → 平面；「立体视图」开关（`aria-pressed`）手动切换，选择记在 `localStorage`（`blog:hall-view`）。手动打开但系统要求减少动态效果时，不做过渡动画。
  - 键盘：← → / ↑ ↓ 逐件，PageUp / PageDown 换一面有展品的墙（空墙跳过），Home / End 第一件 / 最后一件，Enter 或空格近看（`aria-expanded` + 说明），Esc 退出近看。展品按钮用 roving tabindex：整个房间只占一个 Tab 位置。
  - 当前展品 `aria-current="true"`，`aria-live="polite"` 播报「第 3 件，共 8 件 · 东墙 · 林间湖」；另有「上一件 / 下一件」按钮。
  - **不自动播放、不自动旋转**：客户端不使用任何计时器，导览只在用户操作时前进（单元测试用假计时器检查）。

## 发布规则（`gallery-core.validateHall`，前端与 Worker 是同一份文件）

- 1–24 件展品，每面墙最多 6 件；展品编号唯一；墙面只能是 north / east / south / west。
- **每件展品必须有替代文字**（无障碍是发布条件）；图片地址只允许 `https://` 或站内绝对路径，宽高为正整数。
- 标题 ≤ 80 字、简介 ≤ 300 字、说明 ≤ 500 字；日期 `YYYY-MM-DD`；状态 draft / published。

## 接口

- `GET /api/halls`：已发布展厅摘要（日期倒序）；`GET /api/halls/:slug`：已发布展厅全文。
- 站长：`GET /api/admin/halls`（含草稿）、`GET / PUT / DELETE /api/admin/halls/:slug`（PUT 整份写入，地址必须和网址一致）。
- D1 迁移 `0026_halls.sql`（只做加法）；正式库迁移 SKIPPED-verifiable（Cloudflare 未部署）。

## 演示站

两间虚构的示例展厅（「山与海」8 件、「城市灯火」5 件，南墙留空演示跳墙），图片是站内已有的 Wikimedia Commons 开放授权示例照片，署名写在每件展品上。

## 推迟

WebGL / 全景照片、陀螺仪环顾、后台可视化布展界面。
