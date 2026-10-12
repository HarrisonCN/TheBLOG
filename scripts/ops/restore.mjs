#!/usr/bin/env node
// L21 从备份恢复 D1（恢复演练 worker/test/ops-scripts.test.ts 每次 CI 都对本地 D1 跑一遍）。
//
//   本地（演练 / 排查）：
//     node scripts/ops/restore.mjs --manifest backups/manifest-<时间>.json --local --persist-to /tmp/restore-db
//   远程（真实恢复，推荐先恢复到一个新库，确认无误后再切换 wrangler.jsonc 的 database_id）：
//     npx wrangler d1 create blog-restore-20261011
//     node scripts/ops/restore.mjs --manifest … --remote --database blog-restore-20261011 --yes
//   覆盖正在使用的库（危险，只在新库方案不可行时）：再加 --overwrite-production
//   最近 30 天内的误操作优先用 D1 Time Travel：npx wrangler d1 time-travel restore blog --timestamp <RFC3339>
//
// 步骤：校验 sha256（manifest 里记录的）→ 解压 → 目标库必须是空库（export 的 SQL 用 CREATE TABLE，不会覆盖已有表）
//      → wrangler d1 execute --file → PRAGMA quick_check/ foreign_key_check → 表数量与 manifest 一致。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { parseArgs, sha256, summary } from './lib.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..');
const worker = join(repo, 'worker');
const a = parseArgs(process.argv.slice(2));
const fail = (msg) => {
  console.error(`[restore] ✗ ${msg}`);
  process.exit(1);
};

let file = a.file ? resolve(String(a.file)) : null;
let manifest = null;
if (a.manifest) {
  const mp = resolve(String(a.manifest));
  manifest = JSON.parse(readFileSync(mp, 'utf8'));
  if (manifest.kind !== 'theblog-backup') fail('不是 TheBLOG 的备份 manifest');
  file ??= join(dirname(mp), manifest.d1.file);
}
if (!file) fail('需要 --manifest 或 --file');
const remote = !!a.remote;
if (!remote && !a.local) fail('请明确指定 --local（本地演练）或 --remote（真实恢复）');
const db = String(a.database ?? 'blog');
if (remote) {
  if (!a.yes) fail('远程恢复需要 --yes 确认');
  if (db === 'blog' && !a['overwrite-production']) fail('目标是正在使用的库 blog：请先恢复到新库（见脚本开头说明），或加 --overwrite-production');
}

// ---------------------------------------------------------------- 校验 + 解压
const raw = readFileSync(file);
if (manifest && sha256(raw) !== manifest.d1.sha256) fail(`sha256 不匹配：备份文件可能损坏或被替换（${sha256(raw).slice(0, 12)}… ≠ ${manifest.d1.sha256.slice(0, 12)}…）`);
const sql = file.endsWith('.gz') ? gunzipSync(raw) : raw;
if (manifest?.d1.rawSha256 && sha256(sql) !== manifest.d1.rawSha256) fail('解压后的 sha256 与 manifest 不一致');
const work = mkdtempSync(join(tmpdir(), 'blog-restore-'));
const sqlPath = join(work, 'restore.sql');
writeFileSync(sqlPath, sql);

const target = remote ? ['--remote'] : ['--local', ...(a['persist-to'] ? ['--persist-to', resolve(String(a['persist-to']))] : [])];
const wrangler = (args) => execFileSync('npx', ['wrangler', ...args], { cwd: worker, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, maxBuffer: 256 * 1024 * 1024 });
const query = (sqlText) => {
  const outp = wrangler(['d1', 'execute', db, ...target, '--json', '--command', sqlText]);
  return JSON.parse(outp.slice(outp.indexOf('[')))[0]?.results ?? [];
};

try {
  // 目标必须是空库（_cf_* 是 D1 内部表）
  const existing = query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'");
  if (existing.length && !a['overwrite-production']) fail(`目标库不是空的（已有 ${existing.length} 张表）。请恢复到新库，或加 --overwrite-production（会先 DROP 已有表）`);
  if (existing.length) {
    const drops = existing.map((t) => `DROP TABLE IF EXISTS "${t.name}";`).join('\n');
    writeFileSync(join(work, 'drop.sql'), `PRAGMA foreign_keys = OFF;\n${drops}\n`);
    wrangler(['d1', 'execute', db, ...target, '--file', join(work, 'drop.sql'), '-y']);
  }
  wrangler(['d1', 'execute', db, ...target, '--file', sqlPath, '-y']);
  // D1 支持的完整性检查是 PRAGMA quick_check（官方兼容列表里没有 integrity_check；本地 workerd 直接拒绝它：SQLITE_AUTH）
  const integrity = query('PRAGMA quick_check')[0];
  const fk = query('PRAGMA foreign_key_check');
  const tables = query("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")[0]?.n ?? 0;
  const mig = query('SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1')[0]?.name ?? null;
  const ok = Object.values(integrity ?? {})[0] === 'ok' && fk.length === 0 && (!manifest || tables === manifest.tables);
  await summary(`### ${ok ? '✅' : '❌'} Restore → ${remote ? `remote ${db}` : `local ${a['persist-to'] ?? '(default)'}`}\n\n| check | value |\n|---|---|\n| quick_check | ${Object.values(integrity ?? {})[0]} |\n| foreign_key_check | ${fk.length} problems |\n| tables | ${tables}${manifest ? ` (manifest ${manifest.tables})` : ''} |\n| migration | ${mig ?? '?'} |\n`);
  console.log(JSON.stringify({ ok, tables, migration: mig, integrity: Object.values(integrity ?? {})[0], foreignKeyProblems: fk.length }));
  if (!ok) process.exit(1);
} finally {
  rmSync(work, { recursive: true, force: true });
}
