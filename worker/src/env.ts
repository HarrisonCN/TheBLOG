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
  // ---------- 社区模块（全部可选；未配置时对应功能返回 503 / 404） ----------
  /** 好朋友上传 / 语音的 R2 桶；不绑定时与 IMAGES 共用（对象放在 community/ 前缀下，不公开） */
  UPLOADS?: R2Bucket;
  /** 验证码邮件：resend | cloudflare | console（默认，只打印到日志）| memory（测试） */
  EMAIL_PROVIDER?: string;
  /** 发件人，例如 "Winston 的博客 <noreply@blog.example.com>" */
  EMAIL_FROM?: string;
  /** EMAIL_PROVIDER=resend 时必填（wrangler secret put RESEND_API_KEY） */
  RESEND_API_KEY?: string;
  /** EMAIL_PROVIDER=cloudflare 时的 send_email 绑定 */
  EMAIL?: { send(message: unknown): Promise<void> };
  /** 可选 Google 登录：三项都配置才开启 */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  /** Google 登录完成后跳回的博客地址，例如 https://blog.example.com */
  SITE_URL?: string;
  SESSION_TTL_SECONDS?: string;
  COOKIE_SECURE?: string;
}
