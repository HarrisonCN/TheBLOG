import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const api = process.env.BLOG_DEV_API ?? 'http://127.0.0.1:8787';

export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), admin: resolve(import.meta.dirname, 'admin.html') },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': api, '/mcp': api },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
} as never);
