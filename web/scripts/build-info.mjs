// L21：构建信息 dist/build.json —— 部署后 smoke 检查用它确认线上前端就是这次提交构建出来的包。
//   { version, commit, builtAt, mode, bundleHash, assets, entry }
//   bundleHash = sha256(排序后的「assets/<文件>:<sha256>」逐行拼接)，算法与 scripts/ops/lib.mjs 的 bundleHash() 相同。
// commit 来源：GITHUB_SHA（Actions）→ BLOG_COMMIT → git rev-parse HEAD → "dev"。
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleHash, entryScript } from '../../scripts/ops/lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
let commit = process.env.GITHUB_SHA || process.env.BLOG_COMMIT || '';
if (!commit) {
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    commit = 'dev';
  }
}
const b = bundleHash(dist);
const info = {
  version: pkg.version,
  commit,
  builtAt: new Date().toISOString(),
  mode: process.argv.includes('--demo') ? 'demo' : 'production',
  bundleHash: b.hash,
  assets: b.files,
  entry: entryScript(readFileSync(join(dist, 'index.html'), 'utf8')),
};
writeFileSync(join(dist, 'build.json'), JSON.stringify(info, null, 2) + '\n');
console.log(`[build-info] ${info.version} ${commit.slice(0, 7)} bundle ${b.hash.slice(0, 12)} (${b.files} assets) → dist/build.json`);
