#!/usr/bin/env node
// L21 发布回滚（rollback.yml 调用；默认只演练 = --dry-run，加 --execute 才真的执行）。
//
//   node scripts/ops/rollback.mjs --target worker|pages|both [--worker-version <version-id>] [--pages-deployment <id>]
//        [--pages-project winston-blog] --reason "…" [--execute]
//
// Worker：wrangler rollback [<version-id>] --message <reason> -y（不给 version-id = 回到上一个版本）。
//         先 `wrangler deployments list` 记录当前状态写进摘要。
// Pages ：Cloudflare API 列出生产部署 → 选「当前之前最近一次成功的生产部署」（或 --pages-deployment 指定）
//         → POST …/deployments/<id>/rollback。
// D1    ：迁移只向前，不回滚数据库。新代码依赖的新表 / 新列都是「只做加法」，旧版本 Worker 可以在新库上运行；
//         需要撤销结构变更时写补偿迁移（见 docs/ops.md「补偿迁移」）。
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfApi, parseArgs, pickPreviousDeployment, summary } from './lib.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..');
const a = parseArgs(process.argv.slice(2));
const target = String(a.target ?? '');
const execute = !!a.execute;
const reason = String(a.reason ?? '').trim();
if (!['worker', 'pages', 'both'].includes(target)) {
  console.error('需要 --target worker|pages|both');
  process.exit(2);
}
if (!reason) {
  console.error('需要 --reason（写进 Worker 版本说明和工作流摘要）');
  process.exit(2);
}
const acc = process.env.CLOUDFLARE_ACCOUNT_ID;
const lines = [`| mode | ${execute ? '**EXECUTE**' : 'dry run（加 --execute 才会执行）'} |`, `| reason | ${reason.replace(/\|/g, '/')} |`];
const wrangler = (args) => execFileSync('npx', ['wrangler', ...args], { cwd: join(repo, 'worker'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } });

if (target === 'worker' || target === 'both') {
  let current = '';
  try {
    current = wrangler(['deployments', 'list', '--json']);
    const list = JSON.parse(current.slice(current.indexOf('[')));
    const latest = list.at(-1) ?? list[0];
    lines.push(`| worker current | ${latest?.versions?.map((v) => `${v.version_id} (${v.percentage}%)`).join(', ') ?? '?'} |`);
  } catch (e) {
    lines.push(`| worker current | 读取失败：${(e instanceof Error ? e.message : String(e)).slice(0, 120)} |`);
  }
  const args = ['rollback', ...(a['worker-version'] ? [String(a['worker-version'])] : []), '--message', reason.slice(0, 100), '-y'];
  if (execute) {
    const out = wrangler(args);
    lines.push(`| worker rollback | done: \`wrangler ${args.join(' ')}\` |`);
    console.log(out);
  } else lines.push(`| worker rollback | would run \`wrangler ${args.join(' ')}\` |`);
}

if (target === 'pages' || target === 'both') {
  const project = String(a['pages-project'] ?? process.env.PAGES_PROJECT ?? 'winston-blog');
  if (!acc) throw new Error('缺少 CLOUDFLARE_ACCOUNT_ID');
  const r = await cfApi(`/accounts/${acc}/pages/projects/${project}/deployments?env=production&per_page=25`);
  const list = r.result ?? [];
  const cur = list.filter((d) => d.environment === 'production').sort((x, y) => Date.parse(y.created_on) - Date.parse(x.created_on))[0];
  const pick = a['pages-deployment'] ? list.find((d) => d.id === a['pages-deployment']) : pickPreviousDeployment(list, cur?.id);
  if (!pick) throw new Error('找不到可以回滚到的 Pages 生产部署');
  lines.push(`| pages current | ${cur?.id ?? '?'} (${cur?.deployment_trigger?.metadata?.commit_hash?.slice(0, 7) ?? '?'}) |`);
  lines.push(`| pages target | ${pick.id} (${pick.deployment_trigger?.metadata?.commit_hash?.slice(0, 7) ?? '?'}, ${pick.created_on}) |`);
  if (execute) {
    await cfApi(`/accounts/${acc}/pages/projects/${project}/deployments/${pick.id}/rollback`, { method: 'POST' });
    lines.push('| pages rollback | done |');
  }
  // 给后续 smoke 用：回滚后的期望 commit
  if (process.env.GITHUB_OUTPUT) (await import('node:fs')).appendFileSync(process.env.GITHUB_OUTPUT, `pages_commit=${pick.deployment_trigger?.metadata?.commit_hash ?? ''}\n`);
}

await summary(`### ↩️ Rollback (${target})\n\n| item | value |\n|---|---|\n${lines.join('\n')}\n\nD1 不回滚（迁移只向前）；需要撤销结构变更时写补偿迁移，见 docs/ops.md。\n`);
