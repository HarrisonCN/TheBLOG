// L21 运维脚本共用的纯函数（Node ≥ 22，无依赖）。
// compareDeploy / pickPreviousDeployment / selectRetained / migrationNumber 与 worker/src/ops-core.ts 同名函数行为一致
// （worker/test/ops-scripts.test.ts 用同一组输入对比两边结果），因为 Node 22 不能直接 import TypeScript。
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** 迁移文件名 → 编号（0018_ops.sql → 18） */
export function migrationNumber(name) {
  const m = /^(\d{4})_/.exec(name ?? '');
  return m ? Number(m[1]) : -1;
}

/** worker/migrations 里最新的迁移名（不带 .sql） */
export function latestMigration(dir) {
  const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  return files.length ? files.at(-1).replace(/\.sql$/, '') : null;
}

/** 对比部署出来的 Worker 和期望值，返回问题列表（空 = 通过） */
export function compareDeploy(f, want) {
  const problems = [];
  if (want.version && f.version !== want.version) problems.push(`version: deployed ${f.version} ≠ expected ${want.version}`);
  if (want.commit) {
    const a = (f.commit || '').toLowerCase();
    const b = want.commit.toLowerCase();
    const short = Math.max(7, Math.min(a.length, b.length));
    if (!a || a === 'dev' || a.slice(0, short) !== b.slice(0, short)) problems.push(`commit: deployed ${f.commit || '(none)'} ≠ expected ${want.commit}`);
  }
  if (want.migration && migrationNumber(f.migration?.latest) < migrationNumber(want.migration)) problems.push(`migration: D1 at ${f.migration?.latest ?? '(none)'} < expected ${want.migration}`);
  return problems;
}

/** 回滚目标：当前生产部署之前、最近一次成功的生产部署 */
export function pickPreviousDeployment(list, currentId) {
  const prod = list
    .filter((d) => d.environment === 'production' && !d.is_skipped && (!d.latest_stage || (d.latest_stage.name === 'deploy' && d.latest_stage.status === 'success')))
    .sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on));
  const cur = currentId ? prod.findIndex((d) => d.id === currentId) : 0;
  if (cur < 0) return prod[0] ?? null;
  return prod[cur + 1] ?? null;
}

/** 备份保留：最近 N 天每天一份、N 周每周一份、N 个月每月一份 */
export function selectRetained(items, policy) {
  const sorted = [...items].filter((i) => Number.isFinite(Date.parse(i.at))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const keep = new Set();
  const pick = (bucketOf, n) => {
    const seen = new Set();
    for (const i of sorted) {
      if (seen.size >= n) break;
      const b = bucketOf(new Date(i.at));
      if (seen.has(b)) continue;
      seen.add(b);
      keep.add(i.key);
    }
  };
  pick((d) => d.toISOString().slice(0, 10), policy.daily);
  pick((d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))).toISOString().slice(0, 10), policy.weekly);
  pick((d) => d.toISOString().slice(0, 7), policy.monthly);
  return keep;
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** 递归列出目录里的文件（相对路径，/ 分隔，排序） */
export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

/** 前端包指纹：dist/assets 下所有文件「路径 + sha256」排序后再取 sha256（与 build.json.bundleHash 相同算法） */
export function bundleHash(distDir) {
  const assets = join(distDir, 'assets');
  const lines = listFiles(assets).map((f) => `assets/${f}:${sha256(readFileSync(join(assets, f)))}`);
  return { hash: sha256(lines.join('\n')), files: lines.length };
}

/** index.html 里的入口脚本（/assets/main-xxxx.js） */
export function entryScript(html) {
  const m = /<script[^>]+type="module"[^>]+src="([^"]*\/assets\/main-[^"]+\.js)"/.exec(html) ?? /src="([^"]*\/assets\/main-[^"]+\.js)"/.exec(html);
  return m ? m[1] : null;
}

/** 解析 --key value / --flag 命令行参数 */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const [k, v] = a.slice(2).split('=', 2);
    if (v !== undefined) out[k] = v;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}

/** 带超时和重试的 fetch → JSON（smoke 用：部署后几秒内边缘节点可能还是旧版本） */
export async function fetchRetry(url, { tries = 6, delayMs = 5000, timeoutMs = 10000, accept = (r) => r.ok, init = {} } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), headers: { 'cache-control': 'no-cache', ...(init.headers ?? {}) } });
      if (accept(r)) return r;
      last = new Error(`${url} → HTTP ${r.status}`);
    } catch (e) {
      last = e;
    }
    if (i < tries - 1) await new Promise((res) => setTimeout(res, delayMs));
  }
  throw last;
}

/** GitHub Actions 摘要（不在 Actions 里就打印到 stdout） */
export async function summary(md) {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) (await import('node:fs')).appendFileSync(f, md + '\n');
  else console.log(md);
}

/** Cloudflare API 调用（需要 CLOUDFLARE_API_TOKEN） */
export async function cfApi(path, init = {}) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('缺少 CLOUDFLARE_API_TOKEN');
  const r = await fetch(`${process.env.CLOUDFLARE_API_BASE ?? 'https://api.cloudflare.com/client/v4'}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.success === false) throw new Error(`Cloudflare API ${path} → HTTP ${r.status} ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
  return body;
}
