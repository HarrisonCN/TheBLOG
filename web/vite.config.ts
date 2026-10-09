import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const api = process.env.BLOG_DEV_API ?? 'http://127.0.0.1:8787';

// `vite build --mode demo`：GitHub Pages 演示版（浏览器内 mock API，部署在 /TheBLOG/ 子路径）
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    base: demo ? (process.env.BLOG_BASE ?? '/TheBLOG/') : '/',
    define: { 'import.meta.env.VITE_DEMO': JSON.stringify(demo ? '1' : process.env.VITE_DEMO ?? '0') },
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
