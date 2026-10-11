# 架构整理（P2）进度与后续

## 1.14.1 已完成
- **设计令牌文件** `web/src/styles/tokens.css`：字体（`@font-face`）+ 浅色 / 深色 CSS 变量，从 `styles.css` 抽出，`main.ts` / `admin.ts` 第一行导入。构建产物 CSS 与拆分前逐字节一致（css 185219 B / gzip 43872 B），像素对比与基线一致。
- **截图对比工具稳定化**：同一构建两次截图差异从最高 3.4% 降到 ≤0.0042%（图片改 eager + 逐屏滚动触发懒加载、等待 `img.decode()` 与字体、初始化时冻结动画 / reveal、`animations: 'disabled'`、隐藏光标、固定时钟与随机数）。

## 后续（未在 1.14.1 发布，原因如下）
1. **`render.ts` / `admin.ts` 按功能拆模块**（content / photography / community / music / admin 各功能）。已试做 `render.ts → render/{core,content,photography,community}.ts`（`render.ts` 保留路由分发并 `export *`，类型检查与单测通过），但 Rollup 在共享 chunk（music-core）里的模块排列变化让 JS gzip 增加约 550 B（+0.19%，首屏 +0.33%），违反"包体不增长"门槛，因此回退。下一步：用 `manualChunks` 固定 render 相关模块的 chunk 与顺序，或在拆分同时清理死代码抵消。
2. **CSS 分层 `@layer tokens, base, components, features, utilities`**：未分层规则永远压过分层规则，`admin.css` 与 Motionary 注入样式目前都是未分层的。迁移时需让二者保持现有优先级（放进最后一层或保持未分层），并以 390/1280 × 浅/深 像素对比 ≤ 0.01% 为门槛。
3. **死 CSS 清理**：用 Playwright CSS coverage 跑全部页面（390/1280 × 浅/深 + 后台），只删除从未命中且未在 TS 字符串中出现的选择器。

## 行为说明
- **RSS / JSON Feed 不再限条数**：自 1.14.1 起 `/rss.xml`、`/feed.json` 默认包含全部已发布文章（与站点地图一致，配合分页游标与摘要索引）。这是有意保留的行为；文章量很大时 feed 体积随之增长，如需上限可在后续版本加 `?limit=`。
