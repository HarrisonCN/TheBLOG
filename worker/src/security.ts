/**
 * L22 账号安全与隐私中心（Worker 侧）。纯逻辑在 security-core.ts（与前端逐字相同）。
 *
 * 会员（Bearer m_xxx，写操作在 index.ts 入口做 Origin 校验）：
 *   GET  /api/security/overview                      会话 / Passkey / 最近安全记录 / 注销状态 / 隐私设置
 *   GET  /api/security/sessions                      登录设备与会话（current 标出本机）
 *   DELETE /api/security/sessions/:id                退出某个设备
 *   POST /api/security/sessions/revoke-others        退出其它所有设备
 *   POST /api/security/sessions/revoke-all           退出全部设备（包括本机）
 *   GET  /api/security/events?before=&limit=         安全记录（分页）
 *   GET  /api/security/passkeys                      Passkey 列表
 *   POST /api/security/passkeys/register/options     创建 Passkey：challenge + 选项
 *   POST /api/security/passkeys/register/verify      校验 attestation（fmt 不校验证书链，见 docs/security.md）并保存公钥
 *   PATCH/DELETE /api/security/passkeys/:id          改名 / 删除
 *   POST /api/security/passkeys/login/options        （公开）无用户名 Passkey 登录：challenge
 *   POST /api/security/passkeys/login/verify         （公开）校验断言 → 会员令牌
 *   GET  /api/security/export                        完整数据导出（JSON + 媒体清单），每 24 小时 3 次
 *   POST /api/security/deletion  {confirm}           申请注销（7 天冷静期）
 *   POST /api/security/deletion/cancel               撤销注销
 *   GET/PUT /api/security/privacy                    隐私权限面板（资料可见性 / 私信 / 可被发现 / 登录提醒 + 拉黑名单）
 * 站长：
 *   GET  /api/admin/security/2fa                     二次验证状态 + 后台安全记录
 *   POST /api/admin/security/2fa/setup|confirm|disable|recovery
 *   POST /api/auth/2fa {preAuth, code}               登录第二步（TOTP 或恢复码，限流）
 */
import { z } from 'zod';
import type { Env } from './env';
import { HttpError, json } from './http';
import { PRE_AUTH_TTL, adminSessionResponse, clientIp, preAuthSecret } from './auth';
import { b64urlDecode, b64urlEncode, randomToken, sha256Hex, timingSafeEqual, verifyJwt } from './crypto';
import { getMember, ipKey, issueSession, rateLimit, requireMember, toPublic, type Member } from './community';
import { buildExport, card, ensureProfile, notify, purgeMember } from './social';
import { validate } from './service';
import {
  SECURITY_LIMITS,
  base32Encode,
  cborDecode,
  coseToJwk,
  deletionState,
  describeDevice,
  loginAlert,
  networkOf,
  newRecoveryCodes,
  normalizeRecoveryCode,
  otpauthUri,
  parseAuthData,
  totpVerify,
  verifyAssertion,
  verifyClientData,
} from './security-core';

const NO_STORE = { 'cache-control': 'no-store' };
const nowSec = () => Math.floor(Date.now() / 1000);
const ok = (data: unknown, status = 200) => json(data, { status, headers: NO_STORE });
/** 安全记录保留天数 */
export const SECURITY_EVENT_RETENTION_DAYS = 180;
/** 每次定时任务最多清除的到期账号数（避免单次 cron 超时；剩下的下一轮继续） */
export const PURGE_BATCH = 20;

export type SecurityEventKind =
  | 'login' | 'new_device' | 'new_network' | 'logout_device' | 'logout_others' | 'logout_all'
  | 'passkey_added' | 'passkey_renamed' | 'passkey_removed' | 'passkey_counter'
  | 'export' | 'deletion_requested' | 'deletion_cancelled' | 'privacy_changed'
  | 'admin_login' | 'admin_login_failed' | 'admin_2fa_enabled' | 'admin_2fa_disabled' | 'admin_2fa_failed' | 'admin_recovery_used' | 'admin_recovery_regenerated' | 'account_purged';

// ============================================================ 指纹 / 记录
export async function fingerprint(req: Request, env: Env): Promise<{ device: string; ipPrefix: string }> {
  const device = describeDevice(req.headers.get('user-agent') ?? '').label;
  const ipPrefix = (await sha256Hex(`${networkOf(clientIp(req))}|${env.JWT_SECRET ?? ''}`)).slice(0, 16);
  return { device, ipPrefix };
}

export async function logEvent(env: Env, memberId: number | null, kind: SecurityEventKind, fp: { device: string; ipPrefix: string } | null, detail = ''): Promise<number> {
  const r = await env.DB.prepare('INSERT INTO security_events (member_id, kind, device_label, ip_prefix, detail, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(memberId, kind, fp?.device ?? '', fp?.ipPrefix ?? '', detail.slice(0, 200), nowSec())
    .first<{ id: number }>();
  return r?.id ?? 0;
}

const ALERT_TEXT: Partial<Record<SecurityEventKind, string>> = {
  new_device: '新设备登录了你的账号',
  new_network: '你的账号在新的网络登录',
  passkey_added: '你的账号添加了新的 Passkey',
  passkey_counter: 'Passkey 签名计数异常，已拒绝这次登录',
  deletion_requested: '你申请了注销账号（7 天后清除，可随时撤销）',
};

/** 站内通知（type system）。邮件只在用户自己打开了「邮件提醒」时由 notify() 发送（L15 的 opt-in 开关）。 */
async function alertMember(env: Env, memberId: number, kind: SecurityEventKind, eventId: number, device: string): Promise<void> {
  const text = ALERT_TEXT[kind];
  if (!text) return;
  const pref = await env.DB.prepare('SELECT login_alerts FROM security_prefs WHERE member_id = ?').bind(memberId).first<{ login_alerts: number }>();
  if ((kind === 'new_device' || kind === 'new_network') && pref && !pref.login_alerts) return;
  await notify(env, { to: memberId, type: 'system', objectKind: 'security', objectRef: `security:${eventId}`, excerpt: device ? `${text}：${device}` : text });
}

/** 由 community.issueSession 调用：补全会话设备信息、写安全记录、判断是否需要「新设备 / 新网络」提醒。失败不影响登录。 */
export async function recordLogin(env: Env, req: Request, memberId: number, tokenHash: string, method: string): Promise<void> {
  try {
    const fp = await fingerprint(req, env);
    const { results } = await env.DB.prepare(
      "SELECT DISTINCT device_label AS device, ip_prefix AS ipPrefix FROM security_events WHERE member_id = ? AND kind IN ('login', 'new_device', 'new_network') ORDER BY id DESC LIMIT 200",
    ).bind(memberId).all<{ device: string; ipPrefix: string }>();
    const alert = loginAlert(results, fp);
    const t = nowSec();
    await env.DB.prepare('UPDATE member_sessions SET device_label = ?, ip_prefix = ?, method = ?, created_at = ?, last_seen_at = ? WHERE token_hash = ?')
      .bind(fp.device, fp.ipPrefix, method, t, t, tokenHash).run();
    const id = await logEvent(env, memberId, alert ?? 'login', fp, method);
    if (alert) await alertMember(env, memberId, alert, id, fp.device);
  } catch (e) {
    console.error('recordLogin failed', e);
  }
}

function bearerToken(req: Request): string | null {
  return /^Bearer\s+(m_[A-Za-z0-9_-]{16,128})$/i.exec(req.headers.get('authorization') ?? '')?.[1] ?? null;
}
async function currentHash(req: Request): Promise<string> {
  const t = bearerToken(req);
  return t ? sha256Hex(t) : '';
}

// ============================================================ 会话
export interface SessionItem { id: string; device: string; method: string; network: string; createdAt: number; lastSeenAt: number; expiresAt: number; current: boolean }

async function listSessions(req: Request, env: Env, me: Member): Promise<SessionItem[]> {
  const cur = (await currentHash(req)).slice(0, 16);
  const { results } = await env.DB.prepare(
    'SELECT substr(token_hash, 1, 16) AS id, device_label, method, ip_prefix, created_at, last_seen_at, expires_at FROM member_sessions WHERE member_id = ? AND expires_at >= ? ORDER BY last_seen_at DESC, created_at DESC LIMIT 50',
  ).bind(me.id, nowSec()).all<{ id: string; device_label: string; method: string; ip_prefix: string; created_at: number; last_seen_at: number; expires_at: number }>();
  return results.map((r) => ({
    id: r.id,
    device: r.device_label || '未知设备',
    method: r.method || 'email',
    network: r.ip_prefix.slice(0, 4),
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at || r.created_at,
    expiresAt: r.expires_at,
    current: r.id === cur,
  }));
}

async function revokeSession(req: Request, env: Env, me: Member, id: string) {
  if (!/^[0-9a-f]{16}$/.test(id)) throw new HttpError(404, 'not_found', '会话不存在');
  const r = await env.DB.prepare('DELETE FROM member_sessions WHERE member_id = ? AND substr(token_hash, 1, 16) = ?').bind(me.id, id).run();
  if (!r.meta.changes) throw new HttpError(404, 'not_found', '会话不存在');
  await logEvent(env, me.id, 'logout_device', await fingerprint(req, env), id.slice(0, 4));
  return { revoked: r.meta.changes };
}

async function revokeMany(req: Request, env: Env, me: Member, keepCurrent: boolean) {
  const cur = await currentHash(req);
  const r = keepCurrent
    ? await env.DB.prepare('DELETE FROM member_sessions WHERE member_id = ? AND token_hash <> ?').bind(me.id, cur).run()
    : await env.DB.prepare('DELETE FROM member_sessions WHERE member_id = ?').bind(me.id).run();
  await logEvent(env, me.id, keepCurrent ? 'logout_others' : 'logout_all', await fingerprint(req, env), String(r.meta.changes));
  return { revoked: r.meta.changes };
}

// ============================================================ 安全记录
export interface SecurityEventItem { id: number; kind: string; device: string; network: string; detail: string; createdAt: number }
const toEvent = (r: { id: number; kind: string; device_label: string; ip_prefix: string; detail: string; created_at: number }): SecurityEventItem => ({
  id: r.id, kind: r.kind, device: r.device_label, network: r.ip_prefix.slice(0, 4), detail: r.detail, createdAt: r.created_at,
});

async function listEvents(env: Env, memberId: number | null, url?: URL): Promise<{ events: SecurityEventItem[]; nextBefore: number | null }> {
  const limit = Math.min(50, Math.max(1, Number(url?.searchParams.get('limit') ?? 20) || 20));
  const before = Number(url?.searchParams.get('before') ?? 0) || Number.MAX_SAFE_INTEGER;
  const where = memberId === null ? 'member_id IS NULL' : 'member_id = ?';
  const binds: unknown[] = memberId === null ? [before, limit + 1] : [memberId, before, limit + 1];
  const { results } = await env.DB.prepare(`SELECT id, kind, device_label, ip_prefix, detail, created_at FROM security_events WHERE ${where} AND id < ? ORDER BY id DESC LIMIT ?`)
    .bind(...binds).all<{ id: number; kind: string; device_label: string; ip_prefix: string; detail: string; created_at: number }>();
  const page = results.slice(0, limit).map(toEvent);
  return { events: page, nextBefore: results.length > limit ? page.at(-1)!.id : null };
}

// ============================================================ Passkey
function rp(req: Request, env: Env): { id: string; origins: string[] } {
  const site = new URL(env.SITE_URL ?? req.url);
  const id = env.WEBAUTHN_RP_ID?.trim() || site.hostname;
  const origins = (env.WEBAUTHN_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return { id, origins: origins.length ? origins : [site.origin] };
}

/** user.id（user handle）：由会员 id 与 JWT_SECRET 推出，不暴露自增 id，也不用另存。 */
async function userHandle(env: Env, memberId: number): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`webauthn|${memberId}|${env.JWT_SECRET ?? ''}`)));
  return b64urlEncode(h.slice(0, 16));
}

async function newChallenge(env: Env, kind: 'register' | 'login', memberId: number | null): Promise<{ challengeId: string; challenge: string }> {
  const challengeId = randomToken(16);
  const challenge = randomToken(32);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ?').bind(nowSec()),
    env.DB.prepare('INSERT INTO webauthn_challenges (id, member_id, kind, challenge, expires_at) VALUES (?, ?, ?, ?, ?)').bind(challengeId, memberId, kind, challenge, nowSec() + SECURITY_LIMITS.challengeTtl),
  ]);
  return { challengeId, challenge };
}

/** 取出并立刻删除 challenge（一次性）。 */
async function takeChallenge(env: Env, id: unknown, kind: 'register' | 'login', memberId: number | null): Promise<string> {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw new HttpError(400, 'challenge_invalid', '验证已过期，请重试');
  const row = await env.DB.prepare('DELETE FROM webauthn_challenges WHERE id = ? RETURNING member_id, kind, challenge, expires_at').bind(id).first<{ member_id: number | null; kind: string; challenge: string; expires_at: number }>();
  if (!row || row.kind !== kind || row.expires_at < nowSec() || (memberId !== null && row.member_id !== memberId)) throw new HttpError(400, 'challenge_invalid', '验证已过期，请重试');
  return row.challenge;
}

const b64field = (v: unknown, name: string, max = 16 * 1024): Uint8Array => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]+$/.test(v) || v.length > max) throw new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path: name, message: '必须是 base64url' }]);
  return b64urlDecode(v);
};

export interface PasskeyItem { id: string; label: string; alg: string; createdAt: number; lastUsedAt: number | null }
async function listPasskeys(env: Env, memberId: number): Promise<PasskeyItem[]> {
  const { results } = await env.DB.prepare('SELECT cred_id, label, alg, created_at, last_used_at FROM passkeys WHERE member_id = ? ORDER BY created_at DESC').bind(memberId)
    .all<{ cred_id: string; label: string; alg: string; created_at: number; last_used_at: number | null }>();
  return results.map((r) => ({ id: r.cred_id, label: r.label, alg: r.alg, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
}

async function registerOptions(req: Request, env: Env, me: Member) {
  await rateLimit(env, 'passkey-reg', String(me.id), 10, 3600, '操作太频繁，请一小时后再试');
  const existing = await listPasskeys(env, me.id);
  if (existing.length >= SECURITY_LIMITS.maxPasskeys) throw new HttpError(400, 'too_many', `每个账号最多 ${SECURITY_LIMITS.maxPasskeys} 个 Passkey`);
  const p = await ensureProfile(env, me.id);
  const { challengeId, challenge } = await newChallenge(env, 'register', me.id);
  const r = rp(req, env);
  return {
    challengeId,
    publicKey: {
      rp: { id: r.id, name: 'TheBLOG' },
      user: { id: await userHandle(env, me.id), name: p.username, displayName: me.name },
      challenge,
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      timeout: SECURITY_LIMITS.challengeTtl * 1000,
      attestation: 'none',
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
      excludeCredentials: existing.map((k) => ({ type: 'public-key', id: k.id })),
    },
  };
}

const labelSchema = z.string().trim().max(40);

async function registerVerify(req: Request, env: Env, me: Member, input: unknown) {
  const b = (input ?? {}) as Record<string, unknown>;
  const challenge = await takeChallenge(env, b.challengeId, 'register', me.id);
  const r = rp(req, env);
  const cd = verifyClientData(b64field(b.clientDataJSON, 'clientDataJSON'), 'webauthn.create', challenge, r.origins);
  if (!cd.ok) throw new HttpError(400, 'passkey_invalid', `Passkey 校验失败：${cd.reason}`);
  let authData: Uint8Array;
  try {
    const att = cborDecode(b64field(b.attestationObject, 'attestationObject', 64 * 1024)).value;
    const ad = att instanceof Map ? att.get('authData') : null;
    if (!(ad instanceof Uint8Array)) throw new Error('no authData');
    authData = ad;
  } catch {
    throw new HttpError(400, 'passkey_invalid', 'Passkey 校验失败：attestationObject 无法解析');
  }
  const pa = await parseAuthData(authData, r.id);
  if (!pa.ok) throw new HttpError(400, 'passkey_invalid', `Passkey 校验失败：${pa.reason}`);
  if (!pa.credentialId || !pa.credentialPublicKey) throw new HttpError(400, 'passkey_invalid', 'Passkey 校验失败：缺少凭据');
  const credId = b64urlEncode(pa.credentialId);
  if (typeof b.id === 'string' && b.id !== credId) throw new HttpError(400, 'passkey_invalid', 'Passkey 校验失败：凭据 ID 不一致');
  let jwk: JsonWebKey;
  try {
    jwk = coseToJwk(cborDecode(pa.credentialPublicKey).value as Map<unknown, unknown>);
  } catch (e) {
    throw new HttpError(400, 'passkey_unsupported', `不支持的 Passkey 算法（只支持 ES256 / RS256）：${(e as Error).message}`);
  }
  const label = labelSchema.safeParse(b.label ?? '').data || describeDevice(req.headers.get('user-agent') ?? '').label;
  if ((await listPasskeys(env, me.id)).length >= SECURITY_LIMITS.maxPasskeys) throw new HttpError(400, 'too_many', `每个账号最多 ${SECURITY_LIMITS.maxPasskeys} 个 Passkey`);
  try {
    await env.DB.prepare('INSERT INTO passkeys (cred_id, member_id, public_key_jwk, alg, sign_count, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(credId, me.id, JSON.stringify(jwk), jwk.kty === 'RSA' ? 'RS256' : 'ES256', pa.signCount, label, nowSec()).run();
  } catch (e) {
    if (/UNIQUE|PRIMARY/i.test(String(e))) throw new HttpError(409, 'passkey_exists', '这个 Passkey 已经添加过了');
    throw e;
  }
  const fp = await fingerprint(req, env);
  const id = await logEvent(env, me.id, 'passkey_added', fp, label);
  await alertMember(env, me.id, 'passkey_added', id, label);
  return { passkey: (await listPasskeys(env, me.id)).find((k) => k.id === credId) };
}

async function loginOptions(req: Request, env: Env) {
  await rateLimit(env, 'passkey-login', await ipKey(req, env), 20, 600, 'Passkey 登录尝试太频繁，请稍后再试');
  const { challengeId, challenge } = await newChallenge(env, 'login', null);
  return { challengeId, publicKey: { challenge, rpId: rp(req, env).id, timeout: SECURITY_LIMITS.challengeTtl * 1000, userVerification: 'preferred', allowCredentials: [] } };
}

async function loginVerify(req: Request, env: Env, input: unknown) {
  await rateLimit(env, 'passkey-login', await ipKey(req, env), 20, 600, 'Passkey 登录尝试太频繁，请稍后再试');
  const b = (input ?? {}) as Record<string, unknown>;
  const challenge = await takeChallenge(env, b.challengeId, 'login', null);
  const fail = () => new HttpError(401, 'passkey_invalid', 'Passkey 无效或已被删除');
  if (typeof b.id !== 'string' || !/^[A-Za-z0-9_-]{8,1400}$/.test(b.id)) throw fail();
  const row = await env.DB.prepare('SELECT cred_id, member_id, public_key_jwk, sign_count FROM passkeys WHERE cred_id = ?').bind(b.id).first<{ cred_id: string; member_id: number; public_key_jwk: string; sign_count: number }>();
  if (!row) throw fail();
  const r = rp(req, env);
  const cdBytes = b64field(b.clientDataJSON, 'clientDataJSON');
  const cd = verifyClientData(cdBytes, 'webauthn.get', challenge, r.origins);
  if (!cd.ok) throw new HttpError(401, 'passkey_invalid', `Passkey 校验失败：${cd.reason}`);
  const authData = b64field(b.authenticatorData, 'authenticatorData');
  const pa = await parseAuthData(authData, r.id);
  if (!pa.ok) throw new HttpError(401, 'passkey_invalid', `Passkey 校验失败：${pa.reason}`);
  if (!(await verifyAssertion(JSON.parse(row.public_key_jwk) as JsonWebKey, b64field(b.signature, 'signature'), authData, cdBytes))) throw fail();
  // 签名计数：认证器支持计数（任一方非 0）时必须严格递增，否则可能是被克隆的凭据
  if ((pa.signCount !== 0 || row.sign_count !== 0) && pa.signCount <= row.sign_count) {
    const fp = await fingerprint(req, env);
    const id = await logEvent(env, row.member_id, 'passkey_counter', fp, `${row.sign_count}→${pa.signCount}`);
    await alertMember(env, row.member_id, 'passkey_counter', id, fp.device);
    throw new HttpError(401, 'passkey_counter', 'Passkey 签名计数异常，已拒绝登录；请删除这个 Passkey 后重新添加');
  }
  await env.DB.prepare('UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE cred_id = ?').bind(pa.signCount, nowSec(), row.cred_id).run();
  const member = await getMember(env, row.member_id);
  return { member: toPublic(member), token: await issueSession(env, member.id, req, 'passkey') };
}

async function renamePasskey(req: Request, env: Env, me: Member, id: string, input: unknown) {
  const label = validate(z.object({ label: labelSchema.min(1) }).strict(), input).label;
  const r = await env.DB.prepare('UPDATE passkeys SET label = ? WHERE cred_id = ? AND member_id = ?').bind(label, id, me.id).run();
  if (!r.meta.changes) throw new HttpError(404, 'not_found', 'Passkey 不存在');
  await logEvent(env, me.id, 'passkey_renamed', await fingerprint(req, env), label);
  return { passkeys: await listPasskeys(env, me.id) };
}

async function removePasskey(req: Request, env: Env, me: Member, id: string) {
  const row = await env.DB.prepare('DELETE FROM passkeys WHERE cred_id = ? AND member_id = ? RETURNING label').bind(id, me.id).first<{ label: string }>();
  if (!row) throw new HttpError(404, 'not_found', 'Passkey 不存在');
  await logEvent(env, me.id, 'passkey_removed', await fingerprint(req, env), row.label);
  return { passkeys: await listPasskeys(env, me.id) };
}

// ============================================================ 数据导出
const MEDIA_RE = /(\/api\/(images|audio)\/|^https:\/\/\S+\.(jpe?g|png|webp|gif|avif|heic|mp3|m4a|ogg|opus|webm|wav)(\?|$))/i;

/** 在归档里找所有媒体地址，生成清单（path = 它在归档里的位置，方便对照）。 */
export function mediaManifest(archive: unknown): { url: string; path: string }[] {
  const seen = new Map<string, string>();
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'string') {
      if (MEDIA_RE.test(v) && !seen.has(v)) seen.set(v, path);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(archive, '');
  return [...seen].map(([url, path]) => ({ url, path }));
}

async function fullExport(req: Request, env: Env, me: Member): Promise<Response> {
  await rateLimit(env, 'export-full', String(me.id), 3, 86_400, '完整导出每 24 小时最多 3 次');
  const p = await ensureProfile(env, me.id);
  const base = await buildExport(env, me);
  const uploads = (await env.DB.prepare('SELECT id, kind, name, size, content_type, note, status, created_at FROM uploads WHERE member_id = ?').bind(me.id).all()).results;
  const events = (await env.DB.prepare('SELECT kind, device_label, detail, created_at FROM security_events WHERE member_id = ? ORDER BY id DESC LIMIT 500').bind(me.id).all()).results;
  const archive = {
    format: 'theblog-export/2',
    ...base,
    uploads,
    security: {
      sessions: (await listSessions(req, env, me)).map(({ id: _id, network: _n, ...s }) => s),
      passkeys: (await listPasskeys(env, me.id)).map(({ id: _id, ...k }) => k),
      events,
      deletion: deletionState((await env.DB.prepare('SELECT deletion_requested_at AS t FROM members WHERE id = ?').bind(me.id).first<{ t: number | null }>())?.t ?? null, nowSec()),
    },
  };
  const manifest = mediaManifest(archive);
  await logEvent(env, me.id, 'export', await fingerprint(req, env), `${manifest.length} media`);
  return new Response(JSON.stringify({ ...archive, mediaManifest: { note: '媒体文件不打包在 JSON 里：按清单里的地址逐个下载（公开图片可直接访问；上传文件需站长导出）。', count: manifest.length, items: manifest } }, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="theblog-${p.username}-full-export.json"`, ...NO_STORE },
  });
}

// ============================================================ 注销（7 天冷静期）
async function deletionOf(env: Env, memberId: number) {
  const r = await env.DB.prepare('SELECT deletion_requested_at AS t FROM members WHERE id = ?').bind(memberId).first<{ t: number | null }>();
  return deletionState(r?.t ?? null, nowSec());
}

async function requestDeletion(req: Request, env: Env, me: Member, input: unknown) {
  await rateLimit(env, 'deletion', String(me.id), 5, 3600);
  const p = await ensureProfile(env, me.id);
  const confirm = String((input as { confirm?: unknown } | null)?.confirm ?? '').trim().toLowerCase();
  if (confirm !== p.username) throw new HttpError(400, 'confirm_required', '请输入你的用户名确认注销');
  const cur = await deletionOf(env, me.id);
  if (cur.state !== 'none') return { deletion: cur };
  await env.DB.prepare('UPDATE members SET deletion_requested_at = ? WHERE id = ?').bind(nowSec(), me.id).run();
  // 申请注销时退出其它设备（防止被盗的会话在冷静期里撤销注销 / 继续操作）
  await env.DB.prepare('DELETE FROM member_sessions WHERE member_id = ? AND token_hash <> ?').bind(me.id, await currentHash(req)).run();
  const fp = await fingerprint(req, env);
  const id = await logEvent(env, me.id, 'deletion_requested', fp);
  await alertMember(env, me.id, 'deletion_requested', id, '');
  return { deletion: await deletionOf(env, me.id) };
}

async function cancelDeletion(req: Request, env: Env, me: Member) {
  const r = await env.DB.prepare('UPDATE members SET deletion_requested_at = NULL WHERE id = ? AND deletion_requested_at IS NOT NULL').bind(me.id).run();
  if (r.meta.changes) await logEvent(env, me.id, 'deletion_cancelled', await fingerprint(req, env));
  return { deletion: await deletionOf(env, me.id) };
}

/** 定时任务：清理过期 challenge、超期安全记录；清除冷静期已到的账号（每轮最多 PURGE_BATCH 个）。 */
export async function scheduledSecurity(env: Env, now = nowSec()): Promise<{ purged: number }> {
  await env.DB.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ?').bind(now).run();
  await env.DB.prepare('DELETE FROM security_events WHERE created_at < ?').bind(now - SECURITY_EVENT_RETENTION_DAYS * 86_400).run();
  const { results } = await env.DB.prepare('SELECT id FROM members WHERE deletion_requested_at IS NOT NULL AND deletion_requested_at <= ? ORDER BY deletion_requested_at LIMIT ?')
    .bind(now - SECURITY_LIMITS.deletionGraceDays * 86_400, PURGE_BATCH).all<{ id: number }>();
  let purged = 0;
  for (const r of results) {
    await purgeMember(env, r.id);
    await logEvent(env, null, 'account_purged', null, `#${r.id}`);
    purged++;
  }
  return { purged };
}

// ============================================================ 隐私权限面板
const privacySchema = z.object({
  visibility: z.enum(['public', 'members', 'private']).optional(),
  discoverable: z.boolean().optional(),
  showFollows: z.boolean().optional(),
  dmPolicy: z.enum(['everyone', 'followers', 'mutuals', 'nobody']).optional(),
  readReceipts: z.boolean().optional(),
  showPresence: z.boolean().optional(),
  loginAlerts: z.boolean().optional(),
}).strict();
export type PrivacySettings = Required<z.infer<typeof privacySchema>> & { emailNotifications: boolean };

async function getPrivacy(env: Env, me: Member) {
  const p = await ensureProfile(env, me.id);
  const dm = await env.DB.prepare('SELECT policy, read_receipts, show_presence FROM dm_settings WHERE member_id = ?').bind(me.id).first<{ policy: PrivacySettings['dmPolicy']; read_receipts: number; show_presence: number }>();
  const sp = await env.DB.prepare('SELECT login_alerts FROM security_prefs WHERE member_id = ?').bind(me.id).first<{ login_alerts: number }>();
  const np = await env.DB.prepare('SELECT email FROM notification_prefs WHERE member_id = ?').bind(me.id).first<{ email: number }>();
  const { results } = await env.DB.prepare("SELECT target_id FROM user_relations WHERE owner_id = ? AND kind = 'block' ORDER BY created_at DESC LIMIT 200").bind(me.id).all<{ target_id: number }>();
  const blocked = (await Promise.all(results.map((r) => card(env, r.target_id)))).filter(Boolean);
  const settings: PrivacySettings = {
    visibility: p.visibility,
    discoverable: !!p.discoverable,
    showFollows: !!p.show_follows,
    dmPolicy: dm?.policy ?? 'everyone',
    readReceipts: dm ? !!dm.read_receipts : true,
    showPresence: dm ? !!dm.show_presence : true,
    loginAlerts: sp ? !!sp.login_alerts : true,
    emailNotifications: !!np?.email,
  };
  return { privacy: settings, blocked };
}

async function putPrivacy(req: Request, env: Env, me: Member, input: unknown) {
  await rateLimit(env, 'privacy', String(me.id), 30, 600, '改得太频繁，请稍后再试');
  const v = validate(privacySchema, input);
  const cur = (await getPrivacy(env, me)).privacy;
  const next = { ...cur, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) } as PrivacySettings;
  const t = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE user_profiles SET visibility = ?, discoverable = ?, show_follows = ?, updated_at = ? WHERE member_id = ?').bind(next.visibility, next.discoverable ? 1 : 0, next.showFollows ? 1 : 0, t, me.id),
    env.DB.prepare(
      `INSERT INTO dm_settings (member_id, policy, read_receipts, show_presence, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(member_id) DO UPDATE SET policy = excluded.policy, read_receipts = excluded.read_receipts, show_presence = excluded.show_presence, updated_at = excluded.updated_at`,
    ).bind(me.id, next.dmPolicy, next.readReceipts ? 1 : 0, next.showPresence ? 1 : 0, t),
    env.DB.prepare(
      'INSERT INTO security_prefs (member_id, login_alerts, updated_at) VALUES (?, ?, ?) ON CONFLICT(member_id) DO UPDATE SET login_alerts = excluded.login_alerts, updated_at = excluded.updated_at',
    ).bind(me.id, next.loginAlerts ? 1 : 0, nowSec()),
  ]);
  const changed = Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== (cur as Record<string, unknown>)[k]);
  if (changed.length) await logEvent(env, me.id, 'privacy_changed', await fingerprint(req, env), changed.join(','));
  return getPrivacy(env, me);
}

// ============================================================ 管理员二次验证（TOTP）
async function totpKey(env: Env): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.JWT_SECRET}|admin-totp-key`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function sealSecret(env: Env, secret: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await totpKey(env), secret));
  return `${b64urlEncode(iv)}.${b64urlEncode(ct)}`;
}
async function openSecret(env: Env, sealed: string): Promise<Uint8Array> {
  const [iv = '', ct = ''] = sealed.split('.');
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64urlDecode(iv) }, await totpKey(env), b64urlDecode(ct)));
}

interface TotpRow { secret_enc: string; pending_enc: string; last_step: number; recovery_json: string; enabled_at: number | null }
async function totpRow(env: Env): Promise<TotpRow | null> {
  return env.DB.prepare('SELECT secret_enc, pending_enc, last_step, recovery_json, enabled_at FROM admin_totp WHERE id = 1').first<TotpRow>();
}

/** 登录钩子：二次验证是否已开启（表不存在 = 迁移前 → 未开启）。 */
export async function adminTotpEnabled(env: Env): Promise<boolean> {
  try {
    return !!(await totpRow(env))?.enabled_at;
  } catch {
    return false;
  }
}

export function adminAudit(req: Request, env: Env) {
  return async (kind: string, detail: string) => {
    try {
      await logEvent(env, null, kind as SecurityEventKind, await fingerprint(req, env), detail);
    } catch {
      /* 迁移前没有表：忽略 */
    }
  };
}

async function hashRecovery(env: Env, code: string): Promise<string> {
  return sha256Hex(`recovery|${code}|${env.JWT_SECRET}`);
}
async function freshRecovery(env: Env): Promise<{ codes: string[]; json: string }> {
  const codes = newRecoveryCodes(10);
  const hashes = await Promise.all(codes.map((c) => hashRecovery(env, normalizeRecoveryCode(c)!)));
  return { codes, json: JSON.stringify(hashes) };
}

/** 校验 TOTP 或恢复码；成功时推进 last_step（条件更新，防并发重放）或消耗恢复码。 */
async function checkSecondFactor(env: Env, row: TotpRow, code: string): Promise<'totp' | 'recovery' | null> {
  const c = code.trim();
  if (/^\d{6}$/.test(c)) {
    const v = await totpVerify(await openSecret(env, row.secret_enc), c, nowSec(), row.last_step);
    if (!v.ok) return null;
    const r = await env.DB.prepare('UPDATE admin_totp SET last_step = ?, updated_at = ? WHERE id = 1 AND last_step < ?').bind(v.step, nowSec(), v.step).run();
    return r.meta.changes ? 'totp' : null;
  }
  const norm = normalizeRecoveryCode(c);
  if (!norm) return null;
  const h = await hashRecovery(env, norm);
  const list = JSON.parse(row.recovery_json || '[]') as string[];
  const idx = list.findIndex((x) => timingSafeEqual(x, h));
  if (idx < 0) return null;
  list.splice(idx, 1);
  const r = await env.DB.prepare('UPDATE admin_totp SET recovery_json = ?, updated_at = ? WHERE id = 1 AND recovery_json = ?').bind(JSON.stringify(list), nowSec(), row.recovery_json).run();
  return r.meta.changes ? 'recovery' : null;
}

async function totpRateLimit(req: Request, env: Env): Promise<void> {
  await rateLimit(env, 'totp-ip', await ipKey(req, env), 5, 900, '验证码尝试太多，请 15 分钟后再试');
  await rateLimit(env, 'totp-all', 'admin', 30, 900, '验证码尝试太多，请 15 分钟后再试');
}

/** POST /api/auth/2fa：登录第二步。 */
export async function handleSecondFactor(req: Request, env: Env, input: unknown): Promise<Response> {
  await totpRateLimit(req, env);
  const b = (input ?? {}) as { preAuth?: unknown; code?: unknown };
  const pre = typeof b.preAuth === 'string' ? await verifyJwt(b.preAuth, preAuthSecret(env)) : null;
  if (!pre || pre.csrf !== '2fa') throw new HttpError(401, 'preauth_expired', '登录已过期，请重新输入密码');
  // 同一个 preAuth 只能用一次
  await rateLimit(env, 'totp-pre', pre.jti, 5, 600, '验证码尝试太多，请重新输入密码');
  // 用过的 preAuth（已经换过会话）在校验验证码之前就拒绝，不消耗恢复码
  const spent = await env.DB.prepare("SELECT 1 AS x FROM rate_limits WHERE bucket = 'totp-used' AND key = ?").bind(pre.jti).first();
  if (spent) throw new HttpError(401, 'preauth_expired', '登录已过期，请重新输入密码');
  const row = await totpRow(env);
  const audit = adminAudit(req, env);
  if (!row?.enabled_at) return adminSessionResponse(env);
  const used = typeof b.code === 'string' ? await checkSecondFactor(env, row, b.code) : null;
  if (!used) {
    await audit('admin_2fa_failed', '');
    throw new HttpError(401, 'bad_code', '验证码或恢复码不正确');
  }
  await rateLimit(env, 'totp-used', pre.jti, 1, PRE_AUTH_TTL * 2, '登录已过期，请重新输入密码');
  await audit(used === 'recovery' ? 'admin_recovery_used' : 'admin_login', used);
  return adminSessionResponse(env);
}

async function adminTotpStatus(env: Env, url: URL) {
  const row = await totpRow(env);
  return {
    enabled: !!row?.enabled_at,
    enabledAt: row?.enabled_at ?? null,
    pending: !!row?.pending_enc && !row?.enabled_at,
    recoveryRemaining: row?.enabled_at ? (JSON.parse(row.recovery_json || '[]') as string[]).length : 0,
    ...(await listEvents(env, null, url)),
  };
}

async function adminTotpSetup(env: Env) {
  const row = await totpRow(env);
  if (row?.enabled_at) throw new HttpError(409, 'already_enabled', '二次验证已经开启；要更换请先关闭');
  const secret = crypto.getRandomValues(new Uint8Array(20));
  await env.DB.prepare(
    "INSERT INTO admin_totp (id, pending_enc, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET pending_enc = excluded.pending_enc, updated_at = excluded.updated_at",
  ).bind(await sealSecret(env, secret), nowSec()).run();
  const b32 = base32Encode(secret);
  return { secret: b32, otpauth: otpauthUri(b32, 'admin', 'TheBLOG') };
}

async function adminTotpConfirm(req: Request, env: Env, input: unknown) {
  await totpRateLimit(req, env);
  const code = String((input as { code?: unknown } | null)?.code ?? '').trim();
  const row = await totpRow(env);
  if (!row?.pending_enc || row.enabled_at) throw new HttpError(400, 'no_pending', '请先生成二次验证密钥');
  const sealed = row.pending_enc;
  const v = await totpVerify(await openSecret(env, sealed), code, nowSec());
  if (!v.ok) throw new HttpError(400, 'bad_code', '验证码不正确：确认手机时间准确后重试');
  const rec = await freshRecovery(env);
  await env.DB.prepare("UPDATE admin_totp SET secret_enc = ?, pending_enc = '', last_step = ?, recovery_json = ?, enabled_at = ?, updated_at = ? WHERE id = 1")
    .bind(sealed, v.step, rec.json, nowSec(), nowSec()).run();
  await adminAudit(req, env)('admin_2fa_enabled', '');
  return { enabled: true, recoveryCodes: rec.codes };
}

async function adminTotpDisable(req: Request, env: Env, input: unknown) {
  await totpRateLimit(req, env);
  const row = await totpRow(env);
  if (!row?.enabled_at) return { enabled: false };
  const used = await checkSecondFactor(env, row, String((input as { code?: unknown } | null)?.code ?? ''));
  if (!used) {
    await adminAudit(req, env)('admin_2fa_failed', 'disable');
    throw new HttpError(400, 'bad_code', '验证码或恢复码不正确');
  }
  await env.DB.prepare("UPDATE admin_totp SET secret_enc = '', pending_enc = '', last_step = -1, recovery_json = '[]', enabled_at = NULL, updated_at = ? WHERE id = 1").bind(nowSec()).run();
  await adminAudit(req, env)('admin_2fa_disabled', used);
  return { enabled: false };
}

async function adminRecoveryRegenerate(req: Request, env: Env, input: unknown) {
  await totpRateLimit(req, env);
  const row = await totpRow(env);
  if (!row?.enabled_at) throw new HttpError(400, 'not_enabled', '二次验证没有开启');
  const used = await checkSecondFactor(env, row, String((input as { code?: unknown } | null)?.code ?? ''));
  if (used !== 'totp') throw new HttpError(400, 'bad_code', '请输入身份验证器里的 6 位验证码');
  const rec = await freshRecovery(env);
  await env.DB.prepare('UPDATE admin_totp SET recovery_json = ?, updated_at = ? WHERE id = 1').bind(rec.json, nowSec()).run();
  await adminAudit(req, env)('admin_recovery_regenerated', '');
  return { recoveryCodes: rec.codes };
}

/** 后台路由（已通过 requireAdmin）：sub = /security/… */
export async function routeAdminSecurity(req: Request, env: Env, sub: string, url: URL, body: () => Promise<unknown>): Promise<Response | null> {
  if (!sub.startsWith('/security/')) return null;
  const m = req.method;
  if (sub === '/security/2fa' && m === 'GET') return ok(await adminTotpStatus(env, url));
  if (sub === '/security/2fa/setup' && m === 'POST') return ok(await adminTotpSetup(env));
  if (sub === '/security/2fa/confirm' && m === 'POST') return ok(await adminTotpConfirm(req, env, await body()));
  if (sub === '/security/2fa/disable' && m === 'POST') return ok(await adminTotpDisable(req, env, await body()));
  if (sub === '/security/2fa/recovery' && m === 'POST') return ok(await adminRecoveryRegenerate(req, env, await body()));
  return null;
}

// ============================================================ 会员路由
export async function routeSecurity(req: Request, env: Env, path: string, url: URL, body: () => Promise<unknown>): Promise<Response | null> {
  if (!path.startsWith('/api/security/')) return null;
  const sub = path.slice('/api/security'.length);
  const m = req.method;
  let mt: RegExpExecArray | null;
  // 公开：Passkey 登录
  if (sub === '/passkeys/login/options' && m === 'POST') return ok(await loginOptions(req, env));
  if (sub === '/passkeys/login/verify' && m === 'POST') return ok(await loginVerify(req, env, await body()));
  const me = await requireMember(req, env);
  if (m === 'GET') {
    if (sub === '/overview') {
      return ok({
        sessions: await listSessions(req, env, me),
        passkeys: await listPasskeys(env, me.id),
        events: (await listEvents(env, me.id)).events.slice(0, 5),
        deletion: await deletionOf(env, me.id),
        ...(await getPrivacy(env, me)),
      });
    }
    if (sub === '/sessions') return ok({ sessions: await listSessions(req, env, me) });
    if (sub === '/events') return ok(await listEvents(env, me.id, url));
    if (sub === '/passkeys') return ok({ passkeys: await listPasskeys(env, me.id) });
    if (sub === '/export') return fullExport(req, env, me);
    if (sub === '/privacy') return ok(await getPrivacy(env, me));
    if (sub === '/deletion') return ok({ deletion: await deletionOf(env, me.id) });
    return null;
  }
  if ((mt = /^\/sessions\/([0-9a-f]{16})$/.exec(sub)) && m === 'DELETE') return ok(await revokeSession(req, env, me, mt[1]!));
  if (sub === '/sessions/revoke-others' && m === 'POST') return ok(await revokeMany(req, env, me, true));
  if (sub === '/sessions/revoke-all' && m === 'POST') return ok(await revokeMany(req, env, me, false));
  if (sub === '/passkeys/register/options' && m === 'POST') return ok(await registerOptions(req, env, me));
  if (sub === '/passkeys/register/verify' && m === 'POST') return ok(await registerVerify(req, env, me, await body()), 201);
  if ((mt = /^\/passkeys\/([A-Za-z0-9_-]{8,1400})$/.exec(sub))) {
    if (m === 'PATCH' || m === 'PUT') return ok(await renamePasskey(req, env, me, mt[1]!, await body()));
    if (m === 'DELETE') return ok(await removePasskey(req, env, me, mt[1]!));
  }
  if (sub === '/deletion' && m === 'POST') return ok(await requestDeletion(req, env, me, await body()));
  if (sub === '/deletion/cancel' && m === 'POST') return ok(await cancelDeletion(req, env, me));
  if (sub === '/privacy' && (m === 'PUT' || m === 'PATCH')) return ok(await putPrivacy(req, env, me, await body()));
  return null;
}

