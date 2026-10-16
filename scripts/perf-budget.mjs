#!/usr/bin/env node
// L32 / v1.32.0 性能预算：node scripts/perf-budget.mjs [--dist web/dist] [--base /TheBLOG/] [--json]
// 在 `npm run build:demo` 之后运行（CI check 任务里）。超预算 → 退出码 1，并列出每一项。预算在 scripts/perf-budget.json。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { checkBudget, kb, measure } from '../web/scripts/perf-budget-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const dist = resolve(arg('--dist', join(here, '../web/dist')));
const base = arg('--base', process.env.BLOG_BASE ?? '/TheBLOG/');
const budget = JSON.parse(readFileSync(join(here, 'perf-budget.json'), 'utf8'));
const m = measure(dist, base);
const v = checkBudget(m, budget);
if (process.argv.includes('--json')) console.log(JSON.stringify({ measured: m, budget, violations: v }, null, 2));
else {
  console.log(`性能预算（gzip）  dist=${dist}`);
  console.log(`  首屏 JS      ${kb(m.initialJs)} KB / ${budget.initialJsKb} KB`);
  console.log(`  首屏 CSS     ${kb(m.initialCss)} KB / ${budget.initialCssKb} KB`);
  console.log(`  最大懒加载块 ${kb(m.largestLazy.gzip)} KB / ${budget.lazyChunkKb} KB  (${m.largestLazy.file})`);
  console.log(`  JS 总量      ${kb(m.totalJs)} KB / ${budget.totalJsKb} KB  (${m.chunks} 个块)`);
  for (const x of v) console.error(`✗ ${x.message}`);
  console.log(v.length ? `✗ ${v.length} 项超预算` : '✓ 全部在预算内');
}
process.exit(v.length ? 1 : 0);
