#!/usr/bin/env node
// L21 部署后冒烟检查（deploy.yml / rollback.yml 调用；本地也能对任意环境跑）。
//
//   node scripts/ops/smoke.mjs --api https://api.example.com --site https://blog.example.com \
//        [--expect-commit <sha>] [--expect-site-commit <sha>] [--expect-version 1.21.0] [--expect-migration auto|0018_ops] [--dist web/dist] [--tries 6]
//
// 检查：
//   1) Worker  GET /api/health → 200 + ok，D1 可用；GET /api/version → version / commit 与期望一致；
//      D1 迁移级别 ≥ 期望（auto = worker/migrations 里最新的文件）
//   2) Pages   GET /build.json → commit 与期望一致；bundleHash 与本地 --dist 构建一致；
//      入口脚本（index.html 里的 /assets/main-*.js）可以下载且 sha256 与本地相同
// 任何一项不符 → 退出码 1（工作流失败）。结果写进 GitHub Actions 摘要。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleHash, compareDeploy, entryScript, fetchRetry, latestMigration, parseArgs, sha256, summary } from './lib.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..');
const a = parseArgs(process.argv.slice(2));
const tries = Number(a.tries ?? 6);
const delayMs = Number(a['delay-ms'] ?? 5000);
const rows = [];
const problems = [];
const check = (name, ok, detail) => {
  rows.push(`| ${ok ? '✅' : '❌'} | ${name} | ${String(detail).replace(/\|/g, '\\|')} |`);
  if (!ok) problems.push(`${name}: ${detail}`);
};

const wantMigration = a['expect-migration'] === 'auto' || a['expect-migration'] === undefined ? latestMigration(join(repo, 'worker/migrations')) : a['expect-migration'] === 'none' ? undefined : a['expect-migration'];
const want = { version: a['expect-version'] || undefined, commit: a['expect-commit'] || undefined, migration: wantMigration || undefined };

// ---------------------------------------------------------------- Worker
if (a.api) {
  const api = String(a.api).replace(/\/+$/, '');
  try {
    const h = await (await fetchRetry(`${api}/api/health`, { tries, delayMs, accept: (r) => r.status === 200 })).json();
    check('Worker /api/health', h.ok === true, `ok=${h.ok} d1=${h.checks?.d1} r2=${h.checks?.r2} do=${h.checks?.do}`);
    // 版本 / commit 可能要等边缘节点切换：不符时重试几次
    let v;
    let diff = [];
    for (let i = 0; i < tries; i++) {
      v = await (await fetchRetry(`${api}/api/version`, { tries: 2, delayMs })).json();
      diff = compareDeploy(v, want);
      if (!diff.length) break;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
    check('Worker version', !diff.some((d) => d.startsWith('version')), `${v.version}${want.version ? ` (expected ${want.version})` : ''}`);
    check('Worker commit', !diff.some((d) => d.startsWith('commit')), `${v.commit}${want.commit ? ` (expected ${want.commit.slice(0, 12)})` : ''}`);
    check('D1 migration level', !diff.some((d) => d.startsWith('migration')) && v.migration?.ok !== false, `${v.migration?.latest ?? '(none)'}${want.migration ? ` (expected ≥ ${want.migration})` : ''}`);
  } catch (e) {
    check('Worker reachable', false, e instanceof Error ? e.message : String(e));
  }
}

// ---------------------------------------------------------------- Pages
if (a.site) {
  const site = String(a.site).replace(/\/+$/, '');
  const dist = a.dist ? String(a.dist) : null;
  const local = dist ? bundleHash(dist) : null;
  // 回滚 Pages 时前端的期望 commit 和 Worker 不一定相同
  const siteCommit = a['expect-site-commit'] || want.commit;
  try {
    let info;
    for (let i = 0; i < tries; i++) {
      info = await (await fetchRetry(`${site}/build.json?ts=${Date.now()}`, { tries: 2, delayMs })).json();
      const commitOk = !siteCommit || compareDeploy({ version: info.version, commit: info.commit, migration: { latest: null } }, { commit: siteCommit }).length === 0;
      const hashOk = !local || info.bundleHash === local.hash;
      if (commitOk && hashOk) break;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
    if (siteCommit) check('Pages build commit', compareDeploy({ version: info.version, commit: info.commit, migration: { latest: null } }, { commit: siteCommit }).length === 0, `${info.commit} (expected ${siteCommit.slice(0, 12)})`);
    if (want.version) check('Pages build version', info.version === want.version, `${info.version} (expected ${want.version})`);
    if (local) check('Pages bundle hash', info.bundleHash === local.hash, `${String(info.bundleHash).slice(0, 16)}… (local ${local.hash.slice(0, 16)}…, ${local.files} assets)`);
    const html = await (await fetchRetry(`${site}/`, { tries, delayMs })).text();
    const entry = entryScript(html);
    check('Pages entry script in index.html', !!entry, entry ?? '(not found)');
    if (entry && dist) {
      const rel = entry.replace(/^.*?\/assets\//, 'assets/');
      const remote = Buffer.from(await (await fetchRetry(new URL(entry, `${site}/`).href, { tries, delayMs })).arrayBuffer());
      const want2 = sha256(readFileSync(join(dist, rel)));
      check('Pages entry script bytes', sha256(remote) === want2, `${rel} sha256 ${sha256(remote).slice(0, 12)}… (local ${want2.slice(0, 12)}…)`);
    }
  } catch (e) {
    check('Pages reachable', false, e instanceof Error ? e.message : String(e));
  }
}

if (!a.api && !a.site) {
  console.error('用法：node scripts/ops/smoke.mjs --api <worker origin> --site <pages origin> [--expect-commit sha] [--expect-version x.y.z] [--dist web/dist]');
  process.exit(2);
}

await summary(`### ${problems.length ? '❌ Post-deploy smoke: FAILED' : '✅ Post-deploy smoke: passed'}\n\n| | check | detail |\n|---|---|---|\n${rows.join('\n')}\n`);
if (problems.length) {
  for (const p of problems) console.error(`::error title=smoke::${p}`);
  process.exit(1);
}
console.log(`[smoke] ${rows.length} checks passed`);
