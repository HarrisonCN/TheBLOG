import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const api = process.env.BLOG_DEV_API ?? 'http://127.0.0.1:8787';

// `vite build --mode demo`：GitHub Pages 演示版（浏览器内 mock API，部署在 /TheBLOG/ 子路径）
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    base: demo ? (process.env.BLOG_BASE ?? '/TheBLOG/') : '/',
    define: {
      'import.meta.env.VITE_DEMO': JSON.stringify(demo ? '1' : process.env.VITE_DEMO ?? '0'),
      // L21：版本号（前端错误上报的 release、演示站 /api/version）；只在发版时变化，不放 commit（commit 写在 dist/build.json，避免每次提交都改变包内容）
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')).version),
      // 测试 / E2E 构建：演示数据后追加 n 篇夹具文章（正式演示站不设置 = 0）
      'import.meta.env.VITE_DEMO_FIXTURE_POSTS': JSON.stringify(demo ? String(Number(process.env.DEMO_FIXTURE_POSTS ?? 0) || 0) : '0'),
    },
    // 正式构建：把演示客户端换成空替身，演示代码与演示密码不会出现在产物里
    resolve: demo ? {} : { alias: [{ find: /^\.\/demo\/client$/, replacement: resolve(import.meta.dirname, 'src/demo/disabled.ts') }] },
    build: {
      target: 'es2022',
      rollupOptions: {
        input: { main: resolve(import.meta.dirname, 'index.html'), admin: resolve(import.meta.dirname, 'admin.html') },
      },
    },
    server: {
      port: 5173,
      proxy: demo ? undefined : { '/api': api, '/mcp': api },
    },
    preview: {
      port: 4173,
      proxy: demo ? undefined : { '/api': api, '/mcp': api },
    },
    test: {
      include: ['test/**/*.test.ts'],
    },
  } as never;
});
