/**
 * 社区模块：好朋友（邮箱验证码 / 可选 Google 登录）、徽章、在线状态、便利贴、
 * 上传与语音留言（R2，站长审核）、节日与项目。接口形状与前端演示 mock（web/src/demo/mock-api.ts）一致。
 */
import { z } from 'zod';
import type { Env } from './env';
import { HttpError, json } from './http';
import { clientIp, getCookie } from './auth';
import { randomToken, sha256Hex, timingSafeEqual } from './crypto';
import { sniffImageType } from './images';
import { validate } from './service';
import { isDefaultStyle, validateNoteStyle, type NoteStyle } from './note-style';
import { legacyDesign, normalizeBadgeDesign, validateBadgeDesign, type BadgeDesign } from './badge-design';

const nowIso = () => new Date().toISOString();
const nowSec = () => Math.floor(Date.now() / 1000);
const text = (max: number) => z.string().trim().max(max);
const SAFE_HTTP = /^https:\/\/[^\s<>"']+$/i;

// ============================================================ 类型
export type BadgeStyle = 'pearlescent' | 'brushed-metal';
/** design：DIY 设计（读库时严格再校验；旧徽章 / 坏数据 → 按 style 对应的预设）。 */
export interface Badge { code: string; label: string; style: BadgeStyle; design: BadgeDesign; grantedAt: string }
export interface Member { id: number; email: string; name: string; avatarUrl: string; bio: string; website: string; badges: Badge[]; joinedAt: string; provider: 'email' | 'google' }
export type PublicMember = Omit<Member, 'email'>;

interface MemberRow { id: number; email: string; name: string; avatar_url: string; bio: string; website: string; provider: 'email' | 'google'; joined_at: string }

// ============================================================ 限流（D1 固定窗口）
export async function rateLimit(env: Env, bucket: string, key: string, limit: number, windowSec: number, message = '操作太频繁，请稍后再试'): Promise<void> {
  const now = nowSec();
  await env.DB.prepare(
    `INSERT INTO rate_limits (bucket, key, count, window_start) VALUES (?, ?, 1, ?)
     ON CONFLICT(bucket, key) DO UPDATE SET
       count = CASE WHEN ? - rate_limits.window_start >= ? THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN ? - rate_limits.window_start >= ? THEN ? ELSE rate_limits.window_start END`,
  )
    .bind(bucket, key, now, now, windowSec, now, windowSec, now)
    .run();
  const row = await env.DB.prepare('SELECT count, window_start FROM rate_limits WHERE bucket = ? AND key = ?').bind(bucket, key).first<{ count: number; window_start: number }>();
  if (row && row.count > limit) {
    throw new HttpError(429, 'rate_limited', message, { 'retry-after': String(Math.max(1, windowSec - (now - row.window_start))) });
  }
}

/** IP 不落库：只存加盐哈希（盐 = JWT_SECRET）。 */
export async function ipKey(req: Request, env: Env): Promise<string> {
  return (await sha256Hex(`${clientIp(req)}|${env.JWT_SECRET ?? ''}`)).slice(0, 32);
}

// ============================================================ 邮件（可插拔：resend / cloudflare / console / memory）
export interface OutgoingEmail { to: string; subject: string; text: string }
/** EMAIL_PROVIDER=memory 时（只用于测试）邮件进这里。 */
export const testOutbox: OutgoingEmail[] = [];

export async function sendEmail(env: Env, msg: OutgoingEmail): Promise<void> {
  const provider = (env.EMAIL_PROVIDER ?? 'console').toLowerCase();
  const from = env.EMAIL_FROM ?? 'Winston 的博客 <noreply@example.com>';
  if (provider === 'memory') {
    testOutbox.push(msg);
    return;
  }
  if (provider === 'console') {
    // 仅用于本地开发：验证码打印在 wrangler dev 的日志里
    console.log(`[email:console] to=${msg.to} subject=${msg.subject}\n${msg.text}`);
    return;
  }
  if (provider === 'resend') {
    if (!env.RESEND_API_KEY) throw new HttpError(503, 'not_configured', '服务端未配置 RESEND_API_KEY');
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text }),
    });
    if (!r.ok) throw new HttpError(502, 'email_failed', '验证码邮件发送失败，请稍后再试');
    return;
  }
  if (provider === 'cloudflare') {
    if (!env.EMAIL) throw new HttpError(503, 'not_configured', '服务端未配置 send_email 绑定 EMAIL');
    const mod = 'cloudflare:email';
    const { EmailMessage } = (await import(/* @vite-ignore */ mod)) as { EmailMessage: new (from: string, to: string, raw: string) => unknown };
    const addr = /<([^>]+)>/.exec(from)?.[1] ?? from;
    const raw = [
      `From: ${from}`,
      `To: ${msg.to}`,
      `Subject: =?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(msg.subject)))}?=`,
      `Message-ID: <${crypto.randomUUID()}@${addr.split('@')[1] ?? 'localhost'}>`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      msg.text,
    ].join('\r\n');
    await env.EMAIL.send(new EmailMessage(addr, msg.to, raw));
    return;
  }
  throw new HttpError(503, 'not_configured', `未知的 EMAIL_PROVIDER：${provider}`);
}

// ============================================================ 好朋友
async function badgesFor(env: Env, ids: number[]): Promise<Map<number, Badge[]>> {
  const out = new Map<number, Badge[]>();
  if (!ids.length) return out;
  const { results } = await env.DB.prepare(`SELECT member_id, code, label, style, design, granted_at FROM badges WHERE member_id IN (${ids.map(() => '?').join(',')}) ORDER BY granted_at`)
    .bind(...ids)
    .all<{ member_id: number; code: string; label: string; style: BadgeStyle; design: string | null; granted_at: string }>();
  for (const b of results) {
    const list = out.get(b.member_id) ?? [];
    list.push({ code: b.code, label: b.label, style: b.style, design: normalizeBadgeDesign(b.design, legacyDesign(b.style)), grantedAt: b.granted_at });
    out.set(b.member_id, list);
  }
  return out;
}

function rowToMember(r: MemberRow, badges: Badge[]): Member {
  return { id: r.id, email: r.email, name: r.name, avatarUrl: r.avatar_url, bio: r.bio, website: r.website, badges, joinedAt: r.joined_at, provider: r.provider };
}
export function toPublic(m: Member): PublicMember {
  const { email: _e, ...rest } = m;
  return rest;
}

export async function listMembers(env: Env): Promise<Member[]> {
  const { results } = await env.DB.prepare('SELECT * FROM members ORDER BY id').all<MemberRow>();
  const badges = await badgesFor(env, results.map((r) => r.id));
  return results.map((r) => rowToMember(r, badges.get(r.id) ?? []));
}

export async function getMember(env: Env, id: number): Promise<Member> {
  const r = await env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(id).first<MemberRow>();
  if (!r) throw new HttpError(404, 'not_found', '好朋友不存在');
  return rowToMember(r, (await badgesFor(env, [id])).get(id) ?? []);
}

export const registerSchema = z.object({
  name: text(40).min(1),
  email: z.string().trim().toLowerCase().max(120).email('邮箱格式不正确'),
  bio: text(120).optional().default(''),
});
export const OTP_TTL_SECONDS = 600;
export const OTP_MAX_TRIES = 5;
const SESSION_DAYS = 30;

async function otpHash(env: Env, email: string, code: string): Promise<string> {
  return sha256Hex(`otp|${email}|${code}|${env.JWT_SECRET}`);
}

function needSecret(env: Env): void {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) throw new HttpError(503, 'not_configured', '服务端未配置 JWT_SECRET');
}

export async function register(req: Request, env: Env, input: unknown): Promise<{ sent: true }> {
  needSecret(env);
  const v = validate(registerSchema, input);
  await rateLimit(env, 'otp-ip', await ipKey(req, env), 10, 3600, '发送验证码太频繁，请一小时后再试');
  await rateLimit(env, 'otp-email', v.email, 3, 600, '这个邮箱刚收过验证码，请 10 分钟后再试');
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  const code = String(n[0]! % 1_000_000).padStart(6, '0');
  await env.DB.prepare(
    `INSERT INTO member_otps (email, code_hash, name, bio, tries, expires_at) VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, name = excluded.name, bio = excluded.bio, tries = 0, expires_at = excluded.expires_at`,
  )
    .bind(v.email, await otpHash(env, v.email, code), v.name, v.bio, nowSec() + OTP_TTL_SECONDS)
    .run();
  await sendEmail(env, {
    to: v.email,
    subject: `你的验证码：${code}`,
    text: `${v.name}，你好！\n\n你的好朋友验证码是 ${code}，10 分钟内有效。\n如果不是你本人操作，忽略这封邮件即可。`,
  });
  return { sent: true };
}

async function issueSession(env: Env, memberId: number): Promise<string> {
  const token = `m_${randomToken(32)}`;
  await env.DB.prepare('DELETE FROM member_sessions WHERE expires_at < ?').bind(nowSec()).run();
  await env.DB.prepare('INSERT INTO member_sessions (token_hash, member_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), memberId, nowSec() + SESSION_DAYS * 86_400)
    .run();
  return token;
}

export const verifySchema = z.object({ email: z.string().trim().toLowerCase().max(120), code: z.string().trim().regex(/^\d{6}$/, '验证码是 6 位数字') });

export async function verify(env: Env, input: unknown): Promise<{ member: PublicMember; token: string }> {
  needSecret(env);
  const v = validate(verifySchema, input);
  const row = await env.DB.prepare('SELECT * FROM member_otps WHERE email = ?').bind(v.email).first<{ code_hash: string; name: string; bio: string; tries: number; expires_at: number }>();
  if (!row || row.expires_at < nowSec()) throw new HttpError(400, 'no_pending', '请先获取验证码');
  if (row.tries + 1 > OTP_MAX_TRIES) {
    await env.DB.prepare('DELETE FROM member_otps WHERE email = ?').bind(v.email).run();
    throw new HttpError(429, 'too_many', '尝试次数太多，请重新获取验证码');
  }
  await env.DB.prepare('UPDATE member_otps SET tries = tries + 1 WHERE email = ?').bind(v.email).run();
  if (!timingSafeEqual(await otpHash(env, v.email, v.code), row.code_hash)) throw new HttpError(400, 'bad_code', '验证码不正确');
  await env.DB.prepare('DELETE FROM member_otps WHERE email = ?').bind(v.email).run();
  let m = await env.DB.prepare('SELECT * FROM members WHERE email = ?').bind(v.email).first<MemberRow>();
  if (!m) {
    m = await env.DB.prepare("INSERT INTO members (email, name, bio, provider, joined_at) VALUES (?, ?, ?, 'email', ?) RETURNING *")
      .bind(v.email, row.name, row.bio, nowIso())
      .first<MemberRow>();
  }
  const member = await getMember(env, m!.id);
  return { member: toPublic(member), token: await issueSession(env, member.id) };
}

/** 会员接口用 Authorization: Bearer m_xxx（不用 Cookie，所以不需要 CSRF 令牌）。 */
export async function requireMember(req: Request, env: Env): Promise<Member> {
  const m = /^Bearer\s+(m_[A-Za-z0-9_-]{16,128})$/i.exec(req.headers.get('authorization') ?? '');
  if (!m) throw new HttpError(401, 'unauthorized', '请先注册 / 登录好朋友账号');
  const row = await env.DB.prepare('SELECT member_id, expires_at FROM member_sessions WHERE token_hash = ?').bind(await sha256Hex(m[1]!)).first<{ member_id: number; expires_at: number }>();
  if (!row || row.expires_at < nowSec()) throw new HttpError(401, 'unauthorized', '登录已过期，请重新验证邮箱');
  return getMember(env, row.member_id);
}

export async function optionalMember(req: Request, env: Env): Promise<Member | null> {
  if (!/^Bearer\s+m_/i.test(req.headers.get('authorization') ?? '')) return null;
  return requireMember(req, env).catch(() => null);
}

export async function logoutMember(req: Request, env: Env): Promise<{ ok: true }> {
  const m = /^Bearer\s+(m_\S+)$/i.exec(req.headers.get('authorization') ?? '');
  if (m) await env.DB.prepare('DELETE FROM member_sessions WHERE token_hash = ?').bind(await sha256Hex(m[1]!)).run();
  return { ok: true };
}

// ---------- 可选 Google 登录（只取名字和头像；需要用户在 Google 授权页同意） ----------
export function googleEnabled(env: Env): boolean {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI);
}
const STATE_COOKIE = 'g_oauth_state';

export async function googleStart(env: Env): Promise<Response> {
  if (!googleEnabled(env)) throw new HttpError(404, 'not_configured', '站长没有开启 Google 登录');
  const state = randomToken(24);
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: env.GOOGLE_REDIRECT_URI!, response_type: 'code', scope: 'openid email profile', state, prompt: 'consent' }).toString();
  return new Response(null, {
    status: 302,
    headers: { location: u.toString(), 'set-cookie': `${STATE_COOKIE}=${state}; Path=/api/members/google; HttpOnly; Secure; SameSite=Lax; Max-Age=600`, 'cache-control': 'no-store' },
  });
}

export async function googleCallback(req: Request, env: Env, url: URL): Promise<Response> {
  if (!googleEnabled(env)) throw new HttpError(404, 'not_configured', '站长没有开启 Google 登录');
  const state = url.searchParams.get('state') ?? '';
  const cookie = getCookie(req, STATE_COOKIE) ?? '';
  if (!state || !cookie || !timingSafeEqual(state, cookie)) throw new HttpError(400, 'bad_state', '登录状态已失效，请重新点击 Google 登录');
  const code = url.searchParams.get('code');
  if (!code) throw new HttpError(400, 'denied', '你取消了 Google 授权');
  const tok = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, redirect_uri: env.GOOGLE_REDIRECT_URI!, grant_type: 'authorization_code' }),
  });
  if (!tok.ok) throw new HttpError(502, 'google_failed', 'Google 登录失败，请重试');
  const { access_token } = (await tok.json()) as { access_token?: string };
  const info = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${access_token}` } });
  if (!info.ok) throw new HttpError(502, 'google_failed', 'Google 登录失败，请重试');
  const g = (await info.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
  if (!g.sub || !g.email || g.email_verified !== true) throw new HttpError(400, 'unverified', 'Google 账号的邮箱未验证');
  const email = g.email.toLowerCase();
  const name = (g.name ?? email.split('@')[0]!).trim().slice(0, 40) || '好朋友';
  const avatar = g.picture && SAFE_HTTP.test(g.picture) ? g.picture.slice(0, 500) : '';
  let m = await env.DB.prepare('SELECT * FROM members WHERE google_sub = ? OR email = ? ORDER BY google_sub IS NULL LIMIT 1').bind(g.sub, email).first<MemberRow>();
  if (m) await env.DB.prepare("UPDATE members SET google_sub = ?, avatar_url = ?, provider = CASE WHEN provider = 'email' AND google_sub IS NULL THEN provider ELSE 'google' END WHERE id = ?").bind(g.sub, avatar, m.id).run();
  else m = await env.DB.prepare("INSERT INTO members (email, name, avatar_url, provider, google_sub, joined_at) VALUES (?, ?, ?, 'google', ?, ?) RETURNING *").bind(email, name, avatar, g.sub, nowIso()).first<MemberRow>();
  const token = await issueSession(env, m!.id);
  const site = (env.SITE_URL ?? new URL(req.url).origin).replace(/\/+$/, '');
  return new Response(null, {
    status: 302,
    // 令牌放在 # 后面：不会出现在服务器日志和 Referer 里
    headers: { location: `${site}/join/#member-token=${token}`, 'set-cookie': `${STATE_COOKIE}=; Path=/api/members/google; HttpOnly; Secure; SameSite=Lax; Max-Age=0`, 'cache-control': 'no-store' },
  });
}

// ============================================================ 徽章
export const badgeGrantSchema = z.object({
  code: z.string().trim().min(1).max(24).regex(/^[A-Za-z0-9-]+$/, '编号只能包含字母、数字和连字符'),
  label: text(30).optional().default(''),
  style: z.enum(['pearlescent', 'brushed-metal']).optional().default('brushed-metal'),
  design: z.unknown().optional(),
}).strict();
/** 徽章 DIY 设计：同一份校验器（badge-design.ts），白名单键 + 枚举 + #rrggbb。 */
function designOrThrow(input: unknown): BadgeDesign {
  const r = validateBadgeDesign(input);
  if (!r.ok) throw new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path: 'design', message: r.error }]);
  return r.design;
}
export const MAX_BADGES = 5;

export async function grantBadge(env: Env, memberId: number, input: unknown): Promise<Member> {
  const v = validate(badgeGrantSchema, input);
  const m = await getMember(env, memberId);
  if (m.badges.length >= MAX_BADGES) throw new HttpError(400, 'too_many', `每人最多 ${MAX_BADGES} 枚徽章`);
  const code = v.code.toUpperCase();
  const taken = await env.DB.prepare('SELECT 1 FROM badges WHERE code = ?').bind(code).first();
  if (taken) throw new HttpError(409, 'badge_conflict', `编号「${code}」已被使用`);
  const design = v.design === undefined || v.design === null ? null : JSON.stringify(designOrThrow(v.design));
  await env.DB.prepare('INSERT INTO badges (code, member_id, label, style, design, granted_at) VALUES (?, ?, ?, ?, ?, ?)').bind(code, memberId, v.label || '好朋友', v.style, design, nowIso()).run();
  return getMember(env, memberId);
}

/** 修改徽章设计：站长可以改任何人的；好朋友只能改自己名下的（编号和名称仍由站长决定）。 */
export async function setBadgeDesign(env: Env, memberId: number, code: string, input: unknown): Promise<Member> {
  const body = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const extra = Object.keys(body).filter((k) => k !== 'design');
  if (extra.length) throw new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path: extra[0], message: '只能修改 design' }]);
  const design = designOrThrow(body.design);
  const r = await env.DB.prepare('UPDATE badges SET design = ? WHERE member_id = ? AND code = ?').bind(JSON.stringify(design), memberId, code.toUpperCase()).run();
  if (!r.meta.changes) throw new HttpError(404, 'not_found', '徽章不存在');
  return getMember(env, memberId);
}

export async function setOwnBadgeDesign(req: Request, env: Env, code: string, input: unknown): Promise<PublicMember> {
  const me = await requireMember(req, env);
  await rateLimit(env, 'badge-design', String(me.id), 30, 3600, '改得太频繁啦，一小时后再试');
  return toPublic(await setBadgeDesign(env, me.id, code, input));
}

export async function revokeBadge(env: Env, memberId: number, code: string): Promise<Member> {
  await getMember(env, memberId);
  await env.DB.prepare('DELETE FROM badges WHERE member_id = ? AND code = ?').bind(memberId, code.toUpperCase()).run();
  return getMember(env, memberId);
}

export async function removeMember(env: Env, id: number): Promise<{ deleted: true; id: number }> {
  await getMember(env, id);
  const { results } = await env.DB.prepare('SELECT r2_key FROM uploads WHERE member_id = ?').bind(id).all<{ r2_key: string }>();
  if (results.length) await bucket(env).delete(results.map((r) => r.r2_key));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM badges WHERE member_id = ?').bind(id),
    env.DB.prepare('DELETE FROM member_sessions WHERE member_id = ?').bind(id),
    env.DB.prepare('DELETE FROM uploads WHERE member_id = ?').bind(id),
    env.DB.prepare('DELETE FROM members WHERE id = ?').bind(id),
  ]);
  return { deleted: true, id };
}

// ============================================================ 在线状态（D1 心跳）
export const PRESENCE_WINDOW = 45;
export const presenceSchema = z.object({ sid: z.string().trim().min(4).max(40).regex(/^[A-Za-z0-9_-]+$/), page: text(40).optional().default('') });

export async function presence(req: Request, env: Env, input: unknown) {
  const v = validate(presenceSchema, input);
  await rateLimit(env, 'presence', v.sid, 30, 600);
  const me = await optionalMember(req, env);
  const now = nowSec();
  // L19：关闭了「显示在线状态」的好朋友在「谁在看」里显示为访客；member_id 只用于私信在线状态（另有可见性规则）
  const hidden = me ? !!(await env.DB.prepare('SELECT 1 AS x FROM dm_settings WHERE member_id = ? AND show_presence = 0').bind(me.id).first().catch(() => null)) : false;
  const shown = me && !hidden ? me : null;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM presence WHERE seen_at < ?').bind(now - PRESENCE_WINDOW * 2),
    env.DB.prepare(
      `INSERT INTO presence (sid, name, avatar, member, page, seen_at, member_id) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(sid) DO UPDATE SET name = excluded.name, avatar = excluded.avatar, member = excluded.member, page = excluded.page, seen_at = excluded.seen_at, member_id = excluded.member_id`,
    ).bind(v.sid, shown?.name ?? '访客', shown?.avatarUrl ?? '', shown ? 1 : 0, v.page, now, me?.id ?? null),
  ]);
  const { results } = await env.DB.prepare('SELECT sid, name, avatar, member, page, member_id FROM presence WHERE seen_at >= ? ORDER BY member DESC, seen_at DESC LIMIT 20')
    .bind(now - PRESENCE_WINDOW)
    .all<{ sid: string; name: string; avatar: string; member: number; page: string; member_id: number | null }>();
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM presence WHERE seen_at >= ?').bind(now - PRESENCE_WINDOW).first<{ n: number }>();
  // 互相拉黑的人彼此显示为访客
  const blocked = new Set<number>();
  if (me) {
    const rs = (await env.DB.prepare("SELECT owner_id, target_id FROM user_relations WHERE kind = 'block' AND (owner_id = ? OR target_id = ?)").bind(me.id, me.id).all<{ owner_id: number; target_id: number }>()).results;
    for (const r of rs) blocked.add(r.owner_id === me.id ? r.target_id : r.owner_id);
  }
  // 别人的 sid 不外泄：只回传自己的
  const viewers = results.map((r, i) => {
    const anon = r.member_id != null && blocked.has(r.member_id);
    return { sid: r.sid === v.sid ? r.sid : `v${i}`, name: anon ? '访客' : r.name, avatar: anon ? '' : r.avatar, member: anon ? false : !!r.member, page: r.page };
  });
  return { viewers, total: total?.n ?? viewers.length };
}

// ============================================================ 便利贴
export interface StickyNote { id: number; name: string; content: string; color: 'yellow' | 'pink' | 'blue' | 'green'; style: NoteStyle | null; reports: number; hidden: boolean; createdAt: string }
interface NoteRow { id: number; name: string; content: string; color: StickyNote['color']; style?: string | null; reports: number; hidden: number; created_at: string }
/** 读库时再校验一遍样式：库里有任何不合法的值都按默认样式（null）返回，绝不把原样数据交给前端。 */
function rowStyle(r: NoteRow): NoteStyle | null {
  if (!r.style) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(r.style);
  } catch {
    return null;
  }
  const v = validateNoteStyle(raw, r.color);
  return v.ok && !isDefaultStyle(v.style) ? v.style : null;
}
const rowToNote = (r: NoteRow): StickyNote => ({ id: r.id, name: r.name, content: r.content, color: r.color, style: rowStyle(r), reports: r.reports, hidden: !!r.hidden, createdAt: r.created_at });

export const noteCreateSchema = z
  .object({ name: text(20).min(1), content: text(60).min(1), color: z.enum(['yellow', 'pink', 'blue', 'green']).optional().default('yellow'), style: z.unknown().optional() })
  .strict()
  .transform((v, ctx) => {
    // 样式对象用和前端同一份校验器（note-style.ts）：白名单字段、枚举、#rrggbb、与纸张的对比度
    const st = validateNoteStyle(v.style ?? null, v.color);
    if (!st.ok) {
      ctx.addIssue({ code: 'custom', path: ['style'], message: st.error });
      return z.NEVER;
    }
    return { name: v.name, content: v.content, color: v.color, style: v.style === undefined || v.style === null || isDefaultStyle(st.style) ? null : st.style };
  });
export const noteModerateSchema = z.object({ id: z.number().int().positive(), action: z.enum(['show', 'hide', 'delete']) });
export const NOTE_HIDE_AT = 3;

export async function listNotes(env: Env, opts: { all?: boolean } = {}): Promise<{ notes: StickyNote[] }> {
  const { results } = await env.DB.prepare(`SELECT * FROM sticky_notes ${opts.all ? '' : 'WHERE hidden = 0'} ORDER BY id DESC LIMIT ${opts.all ? 500 : 60}`).all<NoteRow>();
  return { notes: results.map(rowToNote) };
}

export async function createNote(req: Request, env: Env, input: unknown): Promise<StickyNote> {
  const v = validate(noteCreateSchema, input);
  await rateLimit(env, 'note', await ipKey(req, env), 5, 600, '便利贴贴得太快啦，10 分钟后再来');
  const r = await env.DB.prepare('INSERT INTO sticky_notes (name, content, color, style, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *').bind(v.name, v.content, v.color, v.style ? JSON.stringify(v.style) : null, nowIso()).first<NoteRow>();
  return rowToNote(r!);
}

export async function reportNote(req: Request, env: Env, id: number): Promise<{ ok: true }> {
  const n = await env.DB.prepare('SELECT id FROM sticky_notes WHERE id = ?').bind(id).first();
  if (!n) throw new HttpError(404, 'not_found', '便利贴不存在');
  const who = await ipKey(req, env);
  await rateLimit(env, 'report', who, 20, 3600);
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO note_reports (note_id, reporter) VALUES (?, ?)').bind(id, who).run();
  if (ins.meta.changes > 0) {
    await env.DB.prepare('UPDATE sticky_notes SET reports = reports + 1, hidden = CASE WHEN reports + 1 >= ? THEN 1 ELSE hidden END WHERE id = ?').bind(NOTE_HIDE_AT, id).run();
  }
  return { ok: true };
}

export async function moderateNote(env: Env, input: unknown): Promise<{ id: number; action: string }> {
  const v = validate(noteModerateSchema, input);
  const n = await env.DB.prepare('SELECT id FROM sticky_notes WHERE id = ?').bind(v.id).first();
  if (!n) throw new HttpError(404, 'not_found', '便利贴不存在');
  if (v.action === 'delete') await env.DB.prepare('DELETE FROM sticky_notes WHERE id = ?').bind(v.id).run();
  else if (v.action === 'hide') await env.DB.prepare('UPDATE sticky_notes SET hidden = 1 WHERE id = ?').bind(v.id).run();
  else {
    await env.DB.batch([env.DB.prepare('UPDATE sticky_notes SET hidden = 0, reports = 0 WHERE id = ?').bind(v.id), env.DB.prepare('DELETE FROM note_reports WHERE note_id = ?').bind(v.id)]);
  }
  return { id: v.id, action: v.action };
}

// ============================================================ 上传 / 语音（R2）
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_VOICE_BYTES = 2 * 1024 * 1024;
export const MAX_VOICE_MS = 60_000;
export const MAX_PENDING_FILES = 10;
const FILE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'application/pdf', 'text/plain', 'application/zip', 'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg', 'audio/wav', 'video/mp4']);
const VOICE_TYPES = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav']);

const bucket = (env: Env): R2Bucket => env.UPLOADS ?? env.IMAGES;

export interface UploadedFile { id: number; memberId: number; memberName: string; name: string; size: number; contentType: string; note: string; status: 'pending' | 'approved' | 'rejected'; createdAt: string; url: string }
export interface VoiceMessage { id: number; memberId: number; name: string; durationMs: number; size: number; contentType: string; createdAt: string; read: boolean; url: string }
interface UploadRow { id: number; kind: 'file' | 'voice'; member_id: number; member_name: string; r2_key: string; name: string; size: number; content_type: string; note: string; duration_ms: number; status: UploadedFile['status']; read: number; created_at: string }

async function readUpload(req: Request): Promise<{ file: File; fields: FormData }> {
  const ct = (req.headers.get('content-type') ?? '').toLowerCase();
  if (!ct.startsWith('multipart/form-data')) throw new HttpError(415, 'unsupported_media_type', '请用 multipart/form-data 上传');
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_FILE_BYTES + 64 * 1024) throw new HttpError(413, 'too_large', '文件太大（最大 10 MB）');
  let fields: FormData;
  try {
    fields = await req.formData();
  } catch {
    throw new HttpError(400, 'bad_form', '表单格式错误');
  }
  const file = fields.get('file');
  if (!file || typeof file === 'string') throw new HttpError(400, 'no_file', '缺少文件');
  return { file: file as File, fields };
}

const baseType = (t: string) => t.split(';')[0]!.trim().toLowerCase();
const safeName = (n: string) => n.replace(/[\u0000-\u001f\\/:*?"<>|]+/g, '_').slice(0, 120) || 'file';

export async function uploadFile(req: Request, env: Env): Promise<{ id: number; status: string }> {
  const m = await requireMember(req, env);
  await rateLimit(env, 'upload', String(m.id), 20, 3600, '上传太频繁，请一小时后再试');
  const { file, fields } = await readUpload(req);
  if (!file.size) throw new HttpError(400, 'no_file', '文件为空');
  if (file.size > MAX_FILE_BYTES) throw new HttpError(413, 'too_large', '文件太大（最大 10 MB）');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let type = baseType(file.type || 'application/octet-stream');
  if (type.startsWith('image/')) {
    const sniffed = sniffImageType(bytes);
    if (!sniffed || sniffed !== type) throw new HttpError(415, 'unsupported_type', '图片内容和类型不符');
  }
  if (!FILE_TYPES.has(type)) throw new HttpError(415, 'unsupported_type', '只支持图片、PDF、文本、ZIP、音频和 MP4');
  const pending = await env.DB.prepare("SELECT COUNT(*) AS n FROM uploads WHERE member_id = ? AND kind = 'file' AND status = 'pending'").bind(m.id).first<{ n: number }>();
  if ((pending?.n ?? 0) >= MAX_PENDING_FILES) throw new HttpError(429, 'too_many', '待审核的文件太多，请等站长处理');
  const note = String(fields.get('note') ?? '').trim().slice(0, 200);
  const key = `community/files/${m.id}/${crypto.randomUUID()}`;
  await bucket(env).put(key, bytes, { httpMetadata: { contentType: type } });
  const r = await env.DB.prepare("INSERT INTO uploads (kind, member_id, r2_key, name, size, content_type, note, created_at) VALUES ('file', ?, ?, ?, ?, ?, ?, ?) RETURNING id, status")
    .bind(m.id, key, safeName(file.name), bytes.byteLength, type, note, nowIso())
    .first<{ id: number; status: string }>();
  return { id: r!.id, status: r!.status };
}

export async function uploadVoice(req: Request, env: Env): Promise<{ id: number }> {
  const m = await requireMember(req, env);
  await rateLimit(env, 'voice', String(m.id), 10, 3600, '语音留言太频繁，请一小时后再试');
  const { file, fields } = await readUpload(req);
  if (!file.size) throw new HttpError(400, 'no_file', '缺少录音');
  if (file.size > MAX_VOICE_BYTES) throw new HttpError(413, 'too_large', '录音太大（最大 2 MB）');
  const type = baseType(file.type || 'audio/webm');
  if (!VOICE_TYPES.has(type)) throw new HttpError(415, 'unsupported_type', '不支持的录音格式');
  const durationMs = Math.round(Number(fields.get('durationMs')) || 0);
  if (durationMs <= 0 || durationMs > MAX_VOICE_MS) throw new HttpError(400, 'validation_error', '录音时长需在 1–60 秒之间');
  const key = `community/voice/${m.id}/${crypto.randomUUID()}`;
  await bucket(env).put(key, await file.arrayBuffer(), { httpMetadata: { contentType: type } });
  const r = await env.DB.prepare("INSERT INTO uploads (kind, member_id, r2_key, name, size, content_type, duration_ms, created_at) VALUES ('voice', ?, ?, 'voice', ?, ?, ?, ?) RETURNING id")
    .bind(m.id, key, file.size, type, durationMs, nowIso())
    .first<{ id: number }>();
  return { id: r!.id };
}

export async function listInbox(env: Env): Promise<{ files: UploadedFile[]; voice: VoiceMessage[] }> {
  const { results } = await env.DB.prepare('SELECT u.*, m.name AS member_name FROM uploads u JOIN members m ON m.id = u.member_id ORDER BY u.id DESC LIMIT 500').all<UploadRow>();
  const files: UploadedFile[] = [];
  const voice: VoiceMessage[] = [];
  for (const r of results) {
    const url = `/api/admin/inbox/${r.kind === 'file' ? 'files' : 'voice'}/${r.id}/raw`;
    if (r.kind === 'file') files.push({ id: r.id, memberId: r.member_id, memberName: r.member_name, name: r.name, size: r.size, contentType: r.content_type, note: r.note, status: r.status, createdAt: r.created_at, url });
    else voice.push({ id: r.id, memberId: r.member_id, name: r.member_name, durationMs: r.duration_ms, size: r.size, contentType: r.content_type, createdAt: r.created_at, read: !!r.read, url });
  }
  return { files, voice };
}

export const inboxActionSchema = z.object({ kind: z.enum(['files', 'voice']), id: z.number().int().positive(), action: z.enum(['approve', 'reject', 'read', 'delete']) });

export async function inboxAction(env: Env, input: unknown): Promise<{ id: number; action: string }> {
  const v = validate(inboxActionSchema, input);
  const kind = v.kind === 'files' ? 'file' : 'voice';
  const row = await env.DB.prepare('SELECT r2_key FROM uploads WHERE id = ? AND kind = ?').bind(v.id, kind).first<{ r2_key: string }>();
  if (!row) throw new HttpError(404, 'not_found', '记录不存在');
  if (v.action === 'delete') {
    await bucket(env).delete(row.r2_key);
    await env.DB.prepare('DELETE FROM uploads WHERE id = ?').bind(v.id).run();
  } else if (kind === 'file' && (v.action === 'approve' || v.action === 'reject')) {
    await env.DB.prepare('UPDATE uploads SET status = ? WHERE id = ?').bind(v.action === 'approve' ? 'approved' : 'rejected', v.id).run();
  } else if (kind === 'voice' && v.action === 'read') {
    await env.DB.prepare('UPDATE uploads SET read = 1 WHERE id = ?').bind(v.id).run();
  } else throw new HttpError(400, 'validation_error', '无效的操作');
  return { id: v.id, action: v.action };
}

/** 站长下载 / 试听：一律 attachment（音频 inline 以便 <audio> 播放），CSP 由 withSecurityHeaders 统一加上。 */
export async function inboxRaw(env: Env, kind: 'files' | 'voice', id: number): Promise<Response> {
  const row = await env.DB.prepare('SELECT r2_key, name, content_type FROM uploads WHERE id = ? AND kind = ?').bind(id, kind === 'files' ? 'file' : 'voice').first<{ r2_key: string; name: string; content_type: string }>();
  if (!row) throw new HttpError(404, 'not_found', '记录不存在');
  const obj = await bucket(env).get(row.r2_key);
  if (!obj) throw new HttpError(404, 'not_found', '文件已不存在');
  const inline = row.content_type.startsWith('audio/');
  return new Response(obj.body, {
    headers: {
      'content-type': row.content_type,
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      'cache-control': 'private, no-store',
    },
  });
}

// ============================================================ 节日 / 项目
export const festivalSchema = z.object({
  id: z.string().trim().min(1).max(40).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'id 只能包含小写字母、数字和连字符'),
  name: text(20).min(1),
  date: z.string().trim().regex(/^(\d{4}-)?\d{2}-\d{2}$/, '日期格式为 MM-DD 或 YYYY-MM-DD'),
  days: z.number().int().min(1).max(30).optional().default(1),
  theme: z.enum(['lunar', 'xmas', 'halloween', 'fireworks']),
  message: text(120).optional().default(''),
});
export const festivalsSchema = z.array(festivalSchema).max(60).refine((a) => new Set(a.map((f) => f.id)).size === a.length, '节日 id 不能重复');
export const projectSchema = z.object({
  name: text(40).min(1),
  title: text(60).min(1),
  version: text(20).optional().default(''),
  author: text(40).optional().default(''),
  engine: text(20).optional().default(''),
  downloads: z.number().int().min(0).optional().default(0),
  url: z.union([z.string().trim().max(2048).regex(/^https?:\/\/[^\s<>"']+$/i, '只允许 http(s) 链接'), z.literal('')]).optional().default(''),
  description: text(300).optional().default(''),
});
export const projectsSchema = z.array(projectSchema).max(30);
type CommunityKey = 'festivals' | 'projects';
export type Festival = z.infer<typeof festivalSchema>;

export async function getCommunity(env: Env, key: CommunityKey): Promise<unknown[]> {
  const r = await env.DB.prepare('SELECT data FROM community_content WHERE key = ?').bind(key).first<{ data: string }>();
  try {
    return r ? (JSON.parse(r.data) as unknown[]) : [];
  } catch {
    return [];
  }
}

export async function setCommunity(env: Env, key: CommunityKey, input: unknown): Promise<unknown[]> {
  const items = validate((key === 'festivals' ? festivalsSchema : projectsSchema) as z.ZodType<unknown[]>, input);
  await env.DB.prepare('INSERT INTO community_content (key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .bind(key, JSON.stringify(items), nowIso())
    .run();
  return items;
}

// ============================================================ 路由
const NO_STORE = { 'cache-control': 'no-store' };
const PUBLIC = { 'cache-control': 'public, max-age=30, s-maxage=60' };

/** 公开 + 会员接口；不匹配时返回 null。调用前已对写操作做 Origin 校验。 */
export async function routePublic(req: Request, env: Env, path: string, url: URL, body: () => Promise<unknown>): Promise<Response | null> {
  const m = req.method;
  let mt: RegExpExecArray | null;
  if (m === 'GET' || m === 'HEAD') {
    if (path === '/api/festivals') return json({ festivals: await getCommunity(env, 'festivals') }, { headers: PUBLIC });
    if (path === '/api/projects') return json({ items: await getCommunity(env, 'projects') }, { headers: PUBLIC });
    if (path === '/api/members') return json({ members: (await listMembers(env)).map(toPublic), google: googleEnabled(env) }, { headers: PUBLIC });
    if (path === '/api/notes') return json(await listNotes(env), { headers: NO_STORE });
    if (path === '/api/members/me') return json({ member: toPublic(await requireMember(req, env)) }, { headers: NO_STORE });
    if (path === '/api/members/google/start') return googleStart(env);
    if (path === '/api/members/google/callback') return googleCallback(req, env, url);
    return null;
  }
  // 好朋友改自己的徽章设计（Bearer 令牌，不用 Cookie）
  if ((mt = /^\/api\/members\/me\/badges\/([A-Za-z0-9-]{1,24})$/.exec(path)) && (m === 'PUT' || m === 'PATCH')) return json({ member: await setOwnBadgeDesign(req, env, mt[1]!, await body()) }, { headers: NO_STORE });
  if (m !== 'POST') return null;
  if (path === '/api/notes') return json(await createNote(req, env, await body()), { status: 201, headers: NO_STORE });
  if ((mt = /^\/api\/notes\/(\d+)\/report$/.exec(path))) return json(await reportNote(req, env, Number(mt[1])), { headers: NO_STORE });
  if (path === '/api/presence') return json(await presence(req, env, await body()), { headers: NO_STORE });
  if (path === '/api/members/register') return json(await register(req, env, await body()), { headers: NO_STORE });
  if (path === '/api/members/verify') return json(await verify(env, await body()), { headers: NO_STORE });
  if (path === '/api/members/logout') return json(await logoutMember(req, env), { headers: NO_STORE });
  if (path === '/api/members/uploads') return json(await uploadFile(req, env), { status: 201, headers: NO_STORE });
  if (path === '/api/members/voice') return json(await uploadVoice(req, env), { status: 201, headers: NO_STORE });
  return null;
}

/** /api/admin 下的社区接口（调用前已 requireAdmin + CSRF）。sub 为去掉 /api/admin 的路径。 */
export async function routeAdmin(req: Request, env: Env, sub: string, body: () => Promise<unknown>): Promise<Response | null> {
  const m = req.method;
  let mt: RegExpExecArray | null;
  const action = async () => ((await body()) as { action?: unknown } | null)?.action;
  if (sub === '/members' && m === 'GET') return json({ members: await listMembers(env) }, { headers: NO_STORE });
  if ((mt = /^\/members\/(\d+)\/badges$/.exec(sub)) && m === 'POST') return json(await grantBadge(env, Number(mt[1]), await body()), { headers: NO_STORE });
  if ((mt = /^\/members\/(\d+)\/badges\/([A-Za-z0-9-]{1,24})$/.exec(sub)) && (m === 'PUT' || m === 'PATCH')) return json(await setBadgeDesign(env, Number(mt[1]), mt[2]!, await body()), { headers: NO_STORE });
  if ((mt = /^\/members\/(\d+)\/badges\/([A-Za-z0-9-]{1,24})$/.exec(sub)) && m === 'DELETE') return json(await revokeBadge(env, Number(mt[1]), mt[2]!), { headers: NO_STORE });
  if ((mt = /^\/members\/(\d+)$/.exec(sub)) && m === 'DELETE') return json(await removeMember(env, Number(mt[1])), { headers: NO_STORE });
  if (sub === '/notes' && m === 'GET') return json(await listNotes(env, { all: true }), { headers: NO_STORE });
  if ((mt = /^\/notes\/(\d+)$/.exec(sub)) && m === 'POST') return json(await moderateNote(env, { id: Number(mt[1]), action: await action() }), { headers: NO_STORE });
  if ((mt = /^\/notes\/(\d+)$/.exec(sub)) && m === 'DELETE') return json(await moderateNote(env, { id: Number(mt[1]), action: 'delete' }), { headers: NO_STORE });
  if (sub === '/festivals') {
    if (m === 'GET') return json({ festivals: await getCommunity(env, 'festivals') }, { headers: NO_STORE });
    if (m === 'PUT') return json({ festivals: await setCommunity(env, 'festivals', ((await body()) as { festivals?: unknown } | null)?.festivals) }, { headers: NO_STORE });
  }
  if (sub === '/projects') {
    if (m === 'GET') return json({ items: await getCommunity(env, 'projects') }, { headers: NO_STORE });
    if (m === 'PUT') return json({ items: await setCommunity(env, 'projects', ((await body()) as { items?: unknown } | null)?.items) }, { headers: NO_STORE });
  }
  if (sub === '/inbox' && m === 'GET') return json(await listInbox(env), { headers: NO_STORE });
  if ((mt = /^\/inbox\/(files|voice)\/(\d+)\/raw$/.exec(sub)) && m === 'GET') return inboxRaw(env, mt[1] as 'files' | 'voice', Number(mt[2]));
  if ((mt = /^\/inbox\/(files|voice)\/(\d+)$/.exec(sub))) {
    if (m === 'POST') return json(await inboxAction(env, { kind: mt[1], id: Number(mt[2]), action: await action() }), { headers: NO_STORE });
    if (m === 'DELETE') return json(await inboxAction(env, { kind: mt[1], id: Number(mt[2]), action: 'delete' }), { headers: NO_STORE });
  }
  return null;
}
