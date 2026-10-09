import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 每次测试用一个全新的本地 D1/R2 状态目录，并应用迁移（含种子数据）。
export default function setup({ provide }: { provide: (k: string, v: string) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'blog-test-'));
  execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'blog', '--local', '--persist-to', dir], {
    stdio: 'pipe',
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });
  process.env.BLOG_TEST_PERSIST = dir;
  provide('persist', dir);
  return () => rmSync(dir, { recursive: true, force: true });
}
