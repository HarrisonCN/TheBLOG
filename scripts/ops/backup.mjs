#!/usr/bin/env node
// L21 D1 / R2 备份（backup.yml 每天跑；本地也能对本地 D1 跑，用于恢复演练）。
//
//   node scripts/ops/backup.mjs [--remote | --local [--persist-to dir]] [--database blog] [--out backups]
//        [--r2-bucket blog-backups] [--images-bucket blog-images] [--prune] [--keep-daily 14 --keep-weekly 8 --keep-monthly 6]
//
// 做的事：
//   1) wrangler d1 export → backups/d1-<db>-<UTC 时间>.sql，gzip 压缩，计算 sha256；
//   2) R2 清单（--images-bucket，需要 CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID）：列出图片桶里所有对象的 key / size / etag /
//      上传时间，写成 r2-manifest-<时间>.json —— R2 本身没有对象版本，靠每天一份清单对比「哪些对象被删 / 被改」；
//   3) manifest-<时间>.json：文件名、大小、sha256、表数量、迁移级别、提交 sha；
//   4) --r2-bucket：把上面的文件上传到备份桶 d1/<时间>/…（wrangler r2 object put --remote）；
//      不给就只留在 --out 目录（工作流把它作为 Actions artifact 上传，保留 14 天）；
//   5) --prune：按保留策略（每天 / 每周 / 每月）删除备份桶里过期的备份（需要 Cloudflare API 列出对象）。
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { cfApi, latestMigration, parseArgs, selectRetained, sha256, summary } from './lib.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..');
const worker = join(repo, 'worker');
const a = parseArgs(process.argv.slice(2));
const db = String(a.database ?? 'blog');
const out = resolve(String(a.out ?? join(repo, 'backups')));
const remote = !!a.remote;
const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
mkdirSync(out, { recursive: true });

const wrangler = (args, opts = {}) =>
  execFileSync('npx', ['wrangler', ...args], { cwd: worker, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, maxBuffer: 256 * 1024 * 1024, ...opts });

// ---------------------------------------------------------------- 1) D1 导出
const sqlPath = join(out, `d1-${db}-${stamp}.sql`);
// wrangler d1 export 没有 --persist-to：本地导出指定目录时，用一个临时配置目录，把它的 .wrangler/state 指向那个目录
// （本地状态默认在「配置文件所在目录/.wrangler/state」）
let tmpCfg = null;
let target = remote ? ['--remote'] : ['--local'];
if (!remote && a['persist-to']) {
  tmpCfg = mkdtempSync(join(tmpdir(), 'blog-backup-cfg-'));
  copyFileSync(join(worker, 'wrangler.jsonc'), join(tmpCfg, 'wrangler.jsonc'));
  mkdirSync(join(tmpCfg, '.wrangler'), { recursive: true });
  symlinkSync(resolve(String(a['persist-to'])), join(tmpCfg, '.wrangler', 'state'), 'dir');
  target = ['--local', '--config', join(tmpCfg, 'wrangler.jsonc')];
}
try {
  wrangler(['d1', 'export', db, ...target, '--output', sqlPath, '-y']);
} finally {
  if (tmpCfg) rmSync(tmpCfg, { recursive: true, force: true });
}
const sql = readFileSync(sqlPath);
if (!/CREATE TABLE/i.test(sql.toString('utf8', 0, Math.min(sql.length, 1 << 20)))) throw new Error('导出的 SQL 里没有 CREATE TABLE —— 导出失败？');
const gz = gzipSync(sql, { level: 9 });
const gzPath = `${sqlPath}.gz`;
writeFileSync(gzPath, gz);
const tables = [...sql.toString('utf8').matchAll(/CREATE TABLE (?:IF NOT EXISTS )?["`]?(\w+)/gi)].map((m) => m[1]);
const migRows = /INSERT INTO "?d1_migrations"?[^;]*?VALUES\s*\((\d+),\s*'([^']+)'/gi;
let migLevel = null;
for (const m of sql.toString('utf8').matchAll(migRows)) migLevel = m[2].replace(/\.sql$/, '');

// ---------------------------------------------------------------- 2) R2 对象清单
let r2 = null;
if (a['images-bucket'] && process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) {
  const objects = [];
  let cursor = '';
  do {
    const q = new URLSearchParams({ per_page: '1000', ...(cursor ? { cursor } : {}) });
    const r = await cfApi(`/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/r2/buckets/${a['images-bucket']}/objects?${q}`);
    for (const o of r.result ?? []) objects.push({ key: o.key, size: o.size, etag: o.etag, uploaded: o.last_modified ?? o.uploaded });
    cursor = r.result_info?.is_truncated ? r.result_info.cursor : '';
  } while (cursor);
  const p = join(out, `r2-manifest-${a['images-bucket']}-${stamp}.json`);
  writeFileSync(p, JSON.stringify({ bucket: a['images-bucket'], at: new Date().toISOString(), count: objects.length, bytes: objects.reduce((s, o) => s + (o.size ?? 0), 0), objects }, null, 1));
  r2 = { file: basename(p), count: objects.length, sha256: sha256(readFileSync(p)) };
}

// ---------------------------------------------------------------- 3) manifest
const manifest = {
  kind: 'theblog-backup',
  version: 1,
  database: db,
  source: remote ? 'remote' : 'local',
  at: new Date().toISOString(),
  migration: migLevel,
  expectedMigration: latestMigration(join(worker, 'migrations')),
  tables: tables.length,
  d1: { file: basename(gzPath), bytes: gz.length, rawBytes: sql.length, sha256: sha256(gz), rawSha256: sha256(sql) },
  r2,
  commit: process.env.GITHUB_SHA ?? null,
};
const manPath = join(out, `manifest-${stamp}.json`);
writeFileSync(manPath, JSON.stringify(manifest, null, 2) + '\n');
// 未压缩的 .sql 只是中间文件（恢复脚本两种都认）
if (!a['keep-sql']) rmSync(sqlPath);

// ---------------------------------------------------------------- 4) 上传到备份桶
const uploaded = [];
if (a['r2-bucket']) {
  const prefix = `d1/${stamp}`;
  for (const f of [gzPath, manPath, ...(r2 ? [join(out, r2.file)] : [])]) {
    const key = `${prefix}/${basename(f)}`;
    wrangler(['r2', 'object', 'put', `${a['r2-bucket']}/${key}`, '--file', f, '--remote']);
    uploaded.push(key);
  }
}

// ---------------------------------------------------------------- 5) 保留策略
let pruned = [];
if (a.prune && a['r2-bucket']) {
  const acc = process.env.CLOUDFLARE_ACCOUNT_ID;
  const keys = [];
  let cursor = '';
  do {
    const q = new URLSearchParams({ per_page: '1000', prefix: 'd1/', ...(cursor ? { cursor } : {}) });
    const r = await cfApi(`/accounts/${acc}/r2/buckets/${a['r2-bucket']}/objects?${q}`);
    keys.push(...(r.result ?? []).map((o) => o.key));
    cursor = r.result_info?.is_truncated ? r.result_info.cursor : '';
  } while (cursor);
  // 一个备份 = 一个 d1/<时间>/ 前缀
  const sets = [...new Set(keys.map((k) => k.split('/').slice(0, 2).join('/')))].map((p) => ({ key: p, at: p.slice(3).replace(/T(\d\d)-(\d\d)-(\d\d)Z$/, 'T$1:$2:$3Z') }));
  const keep = selectRetained(sets, { daily: Number(a['keep-daily'] ?? 14), weekly: Number(a['keep-weekly'] ?? 8), monthly: Number(a['keep-monthly'] ?? 6) });
  for (const s of sets) {
    if (keep.has(s.key)) continue;
    for (const k of keys.filter((k) => k.startsWith(`${s.key}/`))) {
      wrangler(['r2', 'object', 'delete', `${a['r2-bucket']}/${k}`, '--remote']);
      pruned.push(k);
    }
  }
}

await summary(
  `### 💾 Backup ${stamp}\n\n| item | value |\n|---|---|\n| D1 | \`${manifest.d1.file}\` ${(gz.length / 1024).toFixed(1)} KB gz (${tables.length} tables, migration ${migLevel ?? '?'}) |\n| sha256 | \`${manifest.d1.sha256}\` |\n| R2 manifest | ${r2 ? `${r2.count} objects` : 'skipped (no --images-bucket / API token)'} |\n| uploaded | ${uploaded.length ? uploaded.length + ' objects → ' + a['r2-bucket'] : 'no (artifact only)'} |\n| pruned | ${pruned.length} |\n`,
);
console.log(JSON.stringify({ manifest: manPath, d1: gzPath, uploaded, pruned: pruned.length }));
