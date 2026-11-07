# 构图辅助线（L47 · 1.47.0）

摄影栏目新增 **构图辅助线** `/composition/`：在照片上叠加三分线、黄金分割线和对角线，看主体落在哪里。

- **页面**：`/composition/` 按日期倒序列出构图分析（适用的辅助线、兴趣点数）；`/composition/:slug/` 预渲染为：照片 + 叠加的内联 SVG（`aria-hidden`，`viewBox` 等于照片像素尺寸，三组线 `<g hidden>` **默认全部关闭**，兴趣点编号圆点）、构图说明文字、兴趣点文字（方位 + 离最近交点的距离，例如「城堡（右中）离最近的三分交点约 2%」）。说明文字是基线：没有 JS、看不到图的读者也能完整理解。
- **切换（客户端）**：JS 加载后显示一组按钮（`role="group"`，每个按钮 `aria-pressed`），按下显示对应线组，再按一次关闭；本图适用的辅助线带「适用」标记。不记住状态，没有网络请求。打印时隐藏按钮。
- **共享核心**：`composition-core.ts`（web 与 worker 逐字相同）：`guideLines`（三分 1/3·2/3、黄金分割 0.382·0.618、两条对角线，照片像素坐标）、`intersections`、`zone`（九宫格方位）、`nearest`（按画面对角线归一化的距离百分比）、`pointText`；校验：照片地址/替代文字/宽高必填、辅助线 1–3 种不重复、兴趣点 ≤ 6 个且坐标 0–1、说明 1–8 段。
- **接口**：`GET /api/composition`、`GET /api/composition/:slug`（只给已发布）；站长 `GET /api/admin/composition`、`GET / PUT / DELETE /api/admin/composition/:slug`。D1 表 `composition_studies`（迁移 `0038_composition.sql`）；正式库迁移 SKIPPED-verifiable。
- **演示数据**：2 份已发布分析 + 1 份草稿，照片是站内已有的开放授权示例照片，说明为虚构示例。
