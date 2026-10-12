/**
 * L21 运维脚本：恢复演练（本地 D1：迁移 + 种子 → backup.mjs → restore.mjs 到空库 → 行数一致）、smoke.mjs 对假部署、
 * rollback.mjs 演练（假 Cloudflare API）、scripts/ops/lib.mjs 与 ops-core.ts 行为一致。
 * 只用独立的临时目录，不碰其它测试共用的库。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '../src/ops-core';

const repo = join(__dirname, '../..');
const ops = join(repo, 'scripts/ops');
const LIB = join(ops, 'lib.mjs');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lib: any;
const tmp = mkdtempSync(join(tmpdir(), 'blog-ops-'));
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };

function run(script: string, args: string[], extraEnv: Record<string, string> = {}): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile('node', [join(ops, script), ...args], { cwd: repo, env: { ...env, ...extraEnv }, maxBuffer: 64 * 1024 * 1024 }, (e, out, err) =>
      resolve({ code: e ? ((e as { code?: number }).code ?? 1) : 0, out: String(out), err: String(err) }),
    );
  });
}
const d1 = (persist: string, sql: string) => {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'blog', '--local', '--persist-to', persist, '--json', '--command', sql], { cwd: join(repo, 'worker'), env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out.slice(out.indexOf('[')))[0].results as Record<string, unknown>[];
};

beforeAll(async () => {
  lib = await import(LIB);
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('scripts/ops/lib.mjs 与 ops-core 一致', () => {
  it('compareDeploy / pickPreviousDeployment / selectRetained / migrationNumber 对同一组输入结果相同', () => {
    const facts = [
      { version: '1.21.0', commit: 'abcdef1234', migration: { latest: '0018_ops', expected: '0018_ops' } },
      { version: '1.20.0', commit: 'dev', migration: { latest: null, expected: '0018_ops' } },
      { version: '1.21.0', commit: '', migration: { latest: '0017_open', expected: '0018_ops' } },
    ];
    const wants = [{}, { version: '1.21.0' }, { commit: 'abcdef1' }, { commit: 'ABCDEF1234ffff' }, { migration: '0018_ops' }, { version: '1.21.0', commit: '1234567', migration: '0019_x' }];
    for (const f of facts) for (const w of wants) expect(lib.compareDeploy(f, w)).toEqual(core.compareDeploy(f, w));
    const list = [
      { id: 'a', created_on: '2026-10-11T10:00:00Z', environment: 'production', latest_stage: { name: 'deploy', status: 'success' } },
      { id: 'b', created_on: '2026-10-10T10:00:00Z', environment: 'production' },
      { id: 'c', created_on: '2026-10-09T10:00:00Z', environment: 'production', is_skipped: true },
      { id: 'd', created_on: '2026-10-08T10:00:00Z', environment: 'preview' },
    ];
    for (const cur of [undefined, 'a', 'b', 'zzz']) expect(lib.pickPreviousDeployment(list, cur)).toEqual(core.pickPreviousDeployment(list, cur));
    const items = Array.from({ length: 120 }, (_, i) => ({ key: `k${i}`, at: new Date(Date.UTC(2026, 9, 11) - i * 43200_000).toISOString() }));
    for (const p of [{ daily: 7, weekly: 4, monthly: 3 }, { daily: 0, weekly: 0, monthly: 12 }, { daily: 30, weekly: 0, monthly: 0 }]) expect([...lib.selectRetained(items, p)].sort()).toEqual([...core.selectRetained(items, p)].sort());
    for (const n of ['0018_ops', '0001_init.sql', 'x', null, undefined]) expect(lib.migrationNumber(n)).toBe(core.migrationNumber(n));
    expect(lib.latestMigration(join(repo, 'worker/migrations'))).toBe('0018_ops');
  });
  it('bundleHash / entryScript', () => {
    const dist = join(tmp, 'dist-a');
    mkdirSync(join(dist, 'assets/sub'), { recursive: true });
    writeFileSync(join(dist, 'assets/main-abc.js'), 'console.log(1)');
    writeFileSync(join(dist, 'assets/sub/x.css'), 'a{}');
    const h1 = lib.bundleHash(dist);
    expect(h1.files).toBe(2);
    writeFileSync(join(dist, 'assets/sub/x.css'), 'a{color:red}');
    expect(lib.bundleHash(dist).hash).not.toBe(h1.hash);
    expect(lib.entryScript('<script type="module" crossorigin src="/TheBLOG/assets/main-abc.js"></script>')).toBe('/TheBLOG/assets/main-abc.js');
    expect(lib.entryScript('<p>nothing</p>')).toBeNull();
  });
});

describe('恢复演练（本地 D1）', () => {
  const src = join(tmp, 'src-db');
  const dst = join(tmp, 'dst-db');
  const out = join(tmp, 'backups');
  it('迁移 + 种子 → 备份 → 恢复到空库 → 表 / 行数 / 迁移级别一致；完整性检查通过', async () => {
    execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'blog', '--local', '--persist-to', src], { cwd: join(repo, 'worker'), env, stdio: 'pipe' });
    d1(src, "INSERT INTO error_events (source, kind, message, fingerprint, first_seen, last_seen) VALUES ('worker', 'drill', '恢复演练 ''引号'' 与 emoji 📷', 'drill', '2026-10-11T00:00:00Z', '2026-10-11T00:00:00Z')");
    const b = await run('backup.mjs', ['--local', '--persist-to', src, '--out', out], { GITHUB_STEP_SUMMARY: join(tmp, 'sum-backup.md') });
    expect(b.code, b.err).toBe(0);
    const manFile = readdirSync(out).find((f) => f.startsWith('manifest-'))!;
    const man = JSON.parse(readFileSync(join(out, manFile), 'utf8'));
    expect(man).toMatchObject({ kind: 'theblog-backup', source: 'local', migration: '0018_ops', expectedMigration: '0018_ops' });
    expect(man.tables).toBeGreaterThan(40);
    expect(readdirSync(out).some((f) => f.endsWith('.sql'))).toBe(false); // 只留 .sql.gz
    expect(readFileSync(join(tmp, 'sum-backup.md'), 'utf8')).toContain('Backup');

    const r = await run('restore.mjs', ['--manifest', join(out, manFile), '--local', '--persist-to', dst], { GITHUB_STEP_SUMMARY: join(tmp, 'sum-restore.md') });
    expect(r.code, r.err + r.out).toBe(0);
    const res = JSON.parse(r.out.trim().split('\n').at(-1)!);
    expect(res).toMatchObject({ ok: true, integrity: 'ok', foreignKeyProblems: 0, migration: '0018_ops.sql' });
    // 一次查询拿全部计数（每次 wrangler 调用都要启动 workerd，很慢）
    const counts = `SELECT ${['posts', 'profile', 'settings', 'topics', 'error_events', 'd1_migrations', 'members', 'user_posts'].map((t) => `(SELECT COUNT(*) FROM ${t}) AS ${t}`).join(', ')}, (SELECT message FROM error_events WHERE kind = 'drill') AS drill`;
    const a0 = d1(src, counts)[0]!;
    const b0 = d1(dst, counts)[0]!;
    expect(b0).toEqual(a0);
    expect(b0.posts).toBeGreaterThan(0);
    expect(b0.drill).toBe("恢复演练 '引号' 与 emoji 📷");
  }, 300_000);
  it('拒绝：sha256 不符、目标不是空库、远程没有 --yes、远程覆盖正在使用的库', async () => {
    const manFile = join(out, readdirSync(out).find((f) => f.startsWith('manifest-'))!);
    expect((await run('restore.mjs', ['--manifest', manFile, '--local', '--persist-to', dst])).err).toContain('不是空的');
    const man = JSON.parse(readFileSync(manFile, 'utf8'));
    const gz = join(out, man.d1.file);
    const bytes = readFileSync(gz);
    bytes[bytes.length - 10] = bytes[bytes.length - 10]! ^ 0xff;
    const bad = join(tmp, 'bad');
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, man.d1.file), bytes);
    writeFileSync(join(bad, 'manifest.json'), JSON.stringify(man));
    const t = await run('restore.mjs', ['--manifest', join(bad, 'manifest.json'), '--local', '--persist-to', join(tmp, 'never')]);
    expect(t.code).toBe(1);
    expect(t.err).toContain('sha256 不匹配');
    expect((await run('restore.mjs', ['--manifest', manFile, '--remote', '--database', 'blog-restore'])).err).toContain('--yes');
    expect((await run('restore.mjs', ['--manifest', manFile, '--remote', '--yes'])).err).toContain('正在使用的库');
    expect((await run('restore.mjs', ['--manifest', manFile])).err).toContain('--local');
  }, 180_000);
});

describe('smoke.mjs（假部署）', () => {
  let srv: Server;
  let base = '';
  const dist = join(tmp, 'dist-smoke');
  const state = { commit: 'feedc0ffee1234567890', version: '1.21.0', migration: '0018_ops', bundle: '' };
  beforeAll(async () => {
    mkdirSync(join(dist, 'assets'), { recursive: true });
    writeFileSync(join(dist, 'assets/main-AbC123.js'), 'export const hi = 1;');
    writeFileSync(join(dist, 'index.html'), '<html><script type="module" crossorigin src="/assets/main-AbC123.js"></script></html>');
    state.bundle = lib.bundleHash(dist).hash;
    srv = createServer((req, res) => {
      const u = new URL(req.url!, 'http://x');
      const j = (b: unknown, s = 200) => res.writeHead(s, { 'content-type': 'application/json' }).end(JSON.stringify(b));
      if (u.pathname === '/api/health') return j({ ok: true, checks: { d1: 'ok', r2: 'ok', do: 'unconfigured' } });
      if (u.pathname === '/api/version') return j({ version: state.version, commit: state.commit, migration: { latest: state.migration, ok: true } });
      if (u.pathname === '/build.json') return j({ version: state.version, commit: state.commit, bundleHash: state.bundle });
      if (u.pathname === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(readFileSync(join(dist, 'index.html')));
      if (u.pathname.startsWith('/assets/')) return res.writeHead(200).end(readFileSync(join(dist, u.pathname)));
      res.writeHead(404).end();
    });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });
  afterAll(() => srv.close());
  const smoke = (extra: string[]) => run('smoke.mjs', ['--api', base, '--site', base, '--dist', dist, '--tries', '1', '--delay-ms', '10', ...extra], { GITHUB_STEP_SUMMARY: join(tmp, 'sum-smoke.md') });
  it('一致 → 通过', async () => {
    const r = await smoke(['--expect-commit', 'feedc0f', '--expect-version', '1.21.0', '--expect-migration', 'auto']);
    expect(r.code, r.err).toBe(0);
    expect(readFileSync(join(tmp, 'sum-smoke.md'), 'utf8')).toContain('Post-deploy smoke: passed');
  });
  it('commit / 版本 / 迁移 / 包指纹不一致 → 失败', async () => {
    expect((await smoke(['--expect-commit', '1234567'])).code).toBe(1);
    expect((await smoke(['--expect-version', '1.20.0'])).code).toBe(1);
    state.migration = '0017_open';
    const m = await smoke(['--expect-migration', 'auto']);
    expect(m.code).toBe(1);
    expect(m.err).toContain('D1 migration level');
    state.migration = '0018_ops';
    state.bundle = 'stale';
    const b = await smoke([]);
    expect(b.code).toBe(1);
    expect(b.err).toContain('Pages bundle hash');
    expect(readFileSync(join(tmp, 'sum-smoke.md'), 'utf8')).toContain('FAILED');
  });
  it('不可达 → 失败；没有参数 → 用法', async () => {
    expect((await run('smoke.mjs', ['--api', 'http://127.0.0.1:1', '--tries', '1', '--delay-ms', '1'])).code).toBe(1);
    expect((await run('smoke.mjs', [])).code).toBe(2);
  });
});

describe('rollback.mjs（演练，假 Cloudflare API）', () => {
  let srv: Server;
  let base = '';
  const posts: string[] = [];
  beforeAll(async () => {
    srv = createServer((req, res) => {
      if (req.method === 'POST') posts.push(req.url!);
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          success: true,
          result: [
            { id: 'cur', created_on: '2026-10-11T10:00:00Z', environment: 'production', latest_stage: { name: 'deploy', status: 'success' }, deployment_trigger: { metadata: { commit_hash: 'aaaaaaa111' } } },
            { id: 'prev', created_on: '2026-10-10T10:00:00Z', environment: 'production', latest_stage: { name: 'deploy', status: 'success' }, deployment_trigger: { metadata: { commit_hash: 'bbbbbbb222' } } },
          ],
        }),
      );
    });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });
  afterAll(() => srv.close());
  const fake = () => ({ CLOUDFLARE_API_BASE: base, CLOUDFLARE_API_TOKEN: 'test-token', CLOUDFLARE_ACCOUNT_ID: 'acc', GITHUB_STEP_SUMMARY: join(tmp, 'sum-rb.md'), GITHUB_OUTPUT: join(tmp, 'out-rb.txt') });
  it('默认演练：选出上一次成功的生产部署，不发 POST；--execute 才回滚', async () => {
    const r = await run('rollback.mjs', ['--target', 'pages', '--reason', 'bad release'], fake());
    expect(r.code, r.err).toBe(0);
    const sum = readFileSync(join(tmp, 'sum-rb.md'), 'utf8');
    expect(sum).toContain('dry run');
    expect(sum).toContain('prev (bbbbbbb');
    expect(posts).toEqual([]);
    expect(readFileSync(join(tmp, 'out-rb.txt'), 'utf8')).toContain('pages_commit=bbbbbbb222');
    const x = await run('rollback.mjs', ['--target', 'pages', '--reason', 'bad release', '--execute'], fake());
    expect(x.code, x.err).toBe(0);
    expect(posts).toEqual(['/accounts/acc/pages/projects/winston-blog/deployments/prev/rollback']);
  });
  it('参数校验', async () => {
    expect((await run('rollback.mjs', ['--target', 'db', '--reason', 'x'])).code).toBe(2);
    expect((await run('rollback.mjs', ['--target', 'worker'])).code).toBe(2);
  });
});
