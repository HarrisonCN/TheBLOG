export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  /** HMAC 密钥，用于签发后台会话 JWT（wrangler secret put JWT_SECRET） */
  JWT_SECRET: string;
  /** 后台密码的 PBKDF2 哈希：pbkdf2$<iterations>$<saltB64>$<hashB64>（wrangler secret put ADMIN_PASSWORD_HASH） */
  ADMIN_PASSWORD_HASH: string;
  /** API / MCP Bearer token 的 SHA-256 十六进制哈希，可用逗号分隔多个以便轮换（wrangler secret put API_TOKEN_HASH） */
  API_TOKEN_HASH: string;
  ALLOWED_ORIGINS?: string;
  SESSION_TTL_SECONDS?: string;
  COOKIE_SECURE?: string;
}
