#!/usr/bin/env node
// 生成要放进 `wrangler secret put` 的值。
//   node scripts/hash-secret.mjs password        # 从 stdin 或 BLOG_ADMIN_PASSWORD 读密码 → ADMIN_PASSWORD_HASH
//   node scripts/hash-secret.mjs token           # 生成随机 API/MCP token 及其 SHA-256 → API_TOKEN_HASH
//   node scripts/hash-secret.mjs jwt             # 生成随机 JWT_SECRET
import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto';

const mode = process.argv[2];
const ITER = 100_000; // Workers 的 PBKDF2 上限

async function readStdin() {
  if (process.stdin.isTTY) {
    process.stderr.write('输入后台密码后按回车（会回显）：');
    return new Promise((res) => process.stdin.once('data', (d) => res(String(d).replace(/\r?\n$/, ''))));
  }
  let s = '';
  for await (const c of process.stdin) s += c;
  return s.replace(/\r?\n$/, '');
}

if (mode === 'password') {
  const pw = process.env.BLOG_ADMIN_PASSWORD ?? (await readStdin());
  if (!pw || pw.length < 12) {
    console.error('密码至少 12 个字符');
    process.exit(1);
  }
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(pw, salt, ITER, 32, 'sha256');
  console.log(`pbkdf2$${ITER}$${salt.toString('base64')}$${hash.toString('base64')}`);
  process.exit(0);
} else if (mode === 'token') {
  const token = process.argv[3] ?? `blog_${randomBytes(32).toString('base64url')}`;
  console.log(`TOKEN（交给 MCP 客户端 / 网关，只显示一次）: ${token}`);
  console.log(`API_TOKEN_HASH（wrangler secret put API_TOKEN_HASH）: ${createHash('sha256').update(token).digest('hex')}`);
} else if (mode === 'jwt') {
  console.log(randomBytes(48).toString('base64url'));
} else {
  console.error('用法：node scripts/hash-secret.mjs <password|token|jwt>');
  process.exit(1);
}
