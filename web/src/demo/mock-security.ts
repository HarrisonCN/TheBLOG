/**
 * 演示模式的 L22 账号安全与隐私中心：与 worker/src/security.ts 相同的路径、状态码与返回结构，校验逻辑共用 security-core.ts。
 * 演示站没有服务器，所以：
 *  - 「登录设备」里除了本机，还有两台标明「演示数据」的虚构设备（可以退出，用来体验）；网络标记是虚构的；
 *  - Passkey 是真的：浏览器 / 系统认证器创建的公钥保存在 localStorage，登录时用同样的规则校验 clientData、rpIdHash、签名与计数；
 *  - 管理员二次验证的密钥只存在这个浏览器里（真实站点用服务器端密钥派生的加密密钥加密后存进 D1）；
 *  - 没有定时任务：冷静期到期的注销在下一次请求时清除。
 */
import {
  SECURITY_LIMITS,
  base32Decode,
  base32Encode,
  cborDecode,
  coseToJwk,
  deletionState,
  describeDevice,
  loginAlert,
  newRecoveryCodes,
  normalizeRecoveryCode,
  otpauthUri,
  parseAuthData,
  totpVerify,
  verifyAssertion,
  verifyClientData,
} from '../security-core';
import { SocialError, type MockSocial } from './mock-social';
import type { MockDm } from './mock-dm';

type R = { status: number; body: unknown };
interface Member { id: number; name: string; email: string }

export interface SecSession { id: string; memberId: number; token: string; device: string; method: string; network: string; createdAt: number; lastSeenAt: number; demo?: boolean }
export interface SecPasskey { credId: string; memberId: number; jwk: JsonWebKey; alg: string; signCount: number; label: string; createdAt: number; lastUsedAt: number | null }
export interface SecEvent { id: number; memberId: number | null; kind: string; device: string; network: string; detail: string; createdAt: number }
export interface SecurityState {
  sessions: SecSession[];
  passkeys: SecPasskey[];
  challenges: { id: string; memberId: number | null; kind: 'register' | 'login'; challenge: string; expiresAt: number }[];
  events: SecEvent[];
  deletion: Record<string, number>;
  loginAlerts: Record<string, boolean>;
  totp: { secret: string; pending: string; lastStep: number; recovery: string[]; enabledAt: number | null };
  preAuth: { id: string; exp: number; used: boolean; tries: number }[];
  nextId: number;
}
export const securitySeed = (): SecurityState => ({
  sessions: [],
  passkeys: [],
  challenges: [],
  events: [],
  deletion: {},
  loginAlerts: {},
  totp: { secret: '', pending: '', lastStep: -1, recovery: [], enabledAt: null },
  preAuth: [],
  nextId: 1,
});

export interface SecurityHost {
  state(): SecurityState;
  commit(mutate: (s: SecurityState) => void): void;
  social: MockSocial;
  dm: () => MockDm;
  memberFrom(headers: Record<string, string>): Member;
  /** 演示站的会员令牌表（token → memberId） */
  tokens(): Record<string, number>;
  setTokens(t: Record<string, number>): void;
  publicMember(id: number): unknown;
  now(): Date;
}

/** Passkey 的 RP：演示站用当前页面的主机名（本地 E2E 必须用 localhost，IP 地址不能当 RP ID）；测试环境没有 location。 */
const loc = (globalThis as { location?: Location }).location;
export const DEMO_RP = loc && /^https?:$/.test(loc.protocol) ? { id: loc.hostname, origin: loc.origin } : { id: 'demo.invalid', origin: 'https://demo.invalid' };

const enc = new TextEncoder();
const b64u = (b: Uint8Array) => {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const rand = (n: number) => b64u(crypto.getRandomValues(new Uint8Array(n)));
/** 令牌 → 16 位十六进制的会话 ID（同步、稳定；只用来在列表里指代会话，不能反推令牌） */
function sessionId(token: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < token.length; i++) {
    a = Math.imul(a ^ token.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b ^ token.charCodeAt(token.length - 1 - i), 0x5bd1e995) >>> 0;
  }
  return (a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')).slice(0, 16);
}
const err = (status: number, code: string, message: string) => new SocialError(status, code, message);
const bad = (path: string, message: string) => new SocialError(400, 'validation_error', '参数校验失败', [{ path, message }]);
const ua = () => (globalThis as { navigator?: Navigator }).navigator?.userAgent ?? '';
const DEMO_NET = '演示';

const MEDIA_RE = /(\/api\/(images|audio)\/|^https:\/\/\S+\.(jpe?g|png|webp|gif|avif|heic|mp3|m4a|ogg|opus|webm|wav)(\?|$))/i;
/** 与 worker 的 mediaManifest 相同：在归档里找所有媒体地址（path = 它在归档里的位置）。 */
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

const PRIVACY_KEYS = { visibility: ['public', 'members', 'private'], dmPolicy: ['everyone', 'followers', 'mutuals', 'nobody'] } as const;
const PRIVACY_BOOLS = ['discoverable', 'showFollows', 'readReceipts', 'showPresence', 'loginAlerts'] as const;

export class MockSecurity {
  constructor(private h: SecurityHost) {}
  private sec = () => Math.floor(this.h.now().getTime() / 1000);
  private st = () => this.h.state();

  private log(s: SecurityState, memberId: number | null, kind: string, detail = '', device = describeDevice(ua()).label, network = DEMO_NET): number {
    const id = s.nextId++;
    s.events.push({ id, memberId, kind, device, network, detail, createdAt: this.sec() });
    if (s.events.length > 500) s.events.splice(0, s.events.length - 500);
    return id;
  }
  private bearer = (headers: Record<string, string>) => (headers.authorization ?? '').replace(/^Bearer\s+/i, '');

  /** 会员登录成功（邮箱验证码 / Passkey）：记录设备、写安全记录、必要时「新设备」提醒；第一次登录时补两台虚构设备。 */
  onLogin(token: string, memberId: number, method: 'email' | 'google' | 'passkey'): void {
    this.bestEffort(() => this.recordLogin(token, memberId, method));
  }
  private recordLogin(token: string, memberId: number, method: string): void {
    const now = this.sec();
    const device = describeDevice(ua()).label;
    this.h.commit((s) => {
      const known = s.sessions.filter((x) => x.memberId === memberId).map((x) => ({ device: x.device, ipPrefix: x.network }));
      const firstEver = !s.events.some((e) => e.memberId === memberId);
      s.sessions.push({ id: sessionId(token), memberId, token, device, method, network: DEMO_NET, createdAt: now, lastSeenAt: now });
      this.log(s, memberId, 'login', method, device);
      const alert = loginAlert(known, { device, ipPrefix: DEMO_NET });
      if (alert && s.loginAlerts[String(memberId)] !== false) this.log(s, memberId, alert, '', device);
      if (firstEver) {
        s.sessions.push(
          { id: sessionId(`demo-a-${memberId}-${now}`), memberId, token: '', device: 'Safari · iOS（演示数据）', method: 'email', network: 'D3', createdAt: now - 5 * 86400, lastSeenAt: now - 7200, demo: true },
          { id: sessionId(`demo-b-${memberId}-${now}`), memberId, token: '', device: 'Edge · Windows（演示数据）', method: 'passkey', network: 'E7', createdAt: now - 21 * 86400, lastSeenAt: now - 3 * 86400, demo: true },
        );
      }
    });
  }

  /** 演示站没有定时任务：冷静期到期的账号在下一次请求时清除。 */
  private purgeIfDue(headers: Record<string, string>, me: Member): void {
    const t = this.st().deletion[String(me.id)];
    if (t === undefined || deletionState(t, this.sec()).state !== 'due') return;
    const username = this.h.social.profileOf(me.id).username;
    this.h.social.deleteMe(headers, { confirm: username });
    const tokens = this.h.tokens();
    for (const [k, v] of Object.entries(tokens)) if (v === me.id) delete tokens[k];
    this.h.setTokens(tokens);
    this.h.commit((s) => {
      s.sessions = s.sessions.filter((x) => x.memberId !== me.id);
      s.passkeys = s.passkeys.filter((x) => x.memberId !== me.id);
      s.events = s.events.filter((x) => x.memberId !== me.id);
      delete s.deletion[String(me.id)];
      delete s.loginAlerts[String(me.id)];
      this.log(s, null, 'account_purged', `#${me.id}`, '定时任务', '');
    });
    throw err(401, 'unauthorized', '请先注册 / 登录好朋友账号');
  }

  // ------------------------------------------------------------ 会话
  private sessions(headers: Record<string, string>, me: Member) {
    const tokens = this.h.tokens();
    const cur = this.bearer(headers);
    return this.st().sessions
      .filter((x) => x.memberId === me.id && (x.demo || tokens[x.token] === me.id))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt || b.createdAt - a.createdAt)
      .map((x) => ({ id: x.id, device: x.device, method: x.method, network: x.network, createdAt: x.createdAt, lastSeenAt: x.lastSeenAt, expiresAt: x.createdAt + 30 * 86400, current: !!x.token && x.token === cur, ...(x.demo ? { demo: true } : {}) }));
  }
  private dropTokens(pred: (t: string) => boolean): void {
    const tokens = this.h.tokens();
    for (const k of Object.keys(tokens)) if (pred(k)) delete tokens[k];
    this.h.setTokens(tokens);
  }
  private revoke(headers: Record<string, string>, me: Member, id: string) {
    const row = this.st().sessions.find((x) => x.memberId === me.id && x.id === id && (x.demo || this.h.tokens()[x.token] === me.id));
    if (!row) throw err(404, 'not_found', '会话不存在');
    if (row.token) this.dropTokens((t) => t === row.token);
    this.h.commit((s) => {
      s.sessions = s.sessions.filter((x) => x !== row && !(x.id === row.id && x.memberId === me.id));
      this.log(s, me.id, 'logout_device', id.slice(0, 4));
    });
    return { revoked: 1 };
  }
  private revokeMany(headers: Record<string, string>, me: Member, keepCurrent: boolean) {
    const cur = this.bearer(headers);
    const mine = this.sessions(headers, me).filter((x) => !(keepCurrent && x.current));
    const tokens = this.h.tokens();
    this.dropTokens((t) => tokens[t] === me.id && !(keepCurrent && t === cur));
    this.h.commit((s) => {
      s.sessions = s.sessions.filter((x) => x.memberId !== me.id || (keepCurrent && x.token === cur));
      this.log(s, me.id, keepCurrent ? 'logout_others' : 'logout_all', String(mine.length));
    });
    return { revoked: mine.length };
  }

  // ------------------------------------------------------------ 安全记录
  private events(memberId: number | null, q?: URLSearchParams) {
    const limit = Math.min(50, Math.max(1, Number(q?.get('limit') ?? 20) || 20));
    const before = Number(q?.get('before') ?? 0) || Number.MAX_SAFE_INTEGER;
    const rows = this.st().events.filter((e) => e.memberId === memberId && e.id < before).sort((a, b) => b.id - a.id);
    const page = rows.slice(0, limit).map(({ memberId: _m, ...e }) => e);
    return { events: page, nextBefore: rows.length > limit ? page.at(-1)!.id : null };
  }

  // ------------------------------------------------------------ Passkey
  private passkeys(memberId: number) {
    return this.st().passkeys.filter((p) => p.memberId === memberId).sort((a, b) => b.createdAt - a.createdAt).map((p) => ({ id: p.credId, label: p.label, alg: p.alg, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt }));
  }
  private newChallenge(kind: 'register' | 'login', memberId: number | null) {
    const id = rand(16);
    const challenge = rand(32);
    const now = this.sec();
    this.h.commit((s) => {
      s.challenges = s.challenges.filter((c) => c.expiresAt >= now);
      s.challenges.push({ id, memberId, kind, challenge, expiresAt: now + SECURITY_LIMITS.challengeTtl });
    });
    return { challengeId: id, challenge };
  }
  private takeChallenge(id: unknown, kind: 'register' | 'login', memberId: number | null): string {
    const row = typeof id === 'string' ? this.st().challenges.find((c) => c.id === id) : undefined;
    if (row) this.h.commit((s) => (s.challenges = s.challenges.filter((c) => c.id !== row.id)));
    if (!row || row.kind !== kind || row.expiresAt < this.sec() || (memberId !== null && row.memberId !== memberId)) throw err(400, 'challenge_invalid', '验证已过期，请重试');
    return row.challenge;
  }
  private field(v: unknown, name: string): Uint8Array {
    if (typeof v !== 'string' || !/^[A-Za-z0-9_-]+$/.test(v) || v.length > 64 * 1024) throw bad(name, '必须是 base64url');
    return unb64u(v);
  }
  private registerOptions(me: Member) {
    this.h.social.limit(`passkey-reg:${me.id}`, 10, 3600_000, '操作太频繁，请一小时后再试');
    const existing = this.passkeys(me.id);
    if (existing.length >= SECURITY_LIMITS.maxPasskeys) throw err(400, 'too_many', `每个账号最多 ${SECURITY_LIMITS.maxPasskeys} 个 Passkey`);
    const { challengeId, challenge } = this.newChallenge('register', me.id);
    return {
      challengeId,
      publicKey: {
        rp: { id: DEMO_RP.id, name: 'TheBLOG（演示）' },
        user: { id: b64u(enc.encode(`demo-member-${me.id}`)), name: this.h.social.profileOf(me.id).username, displayName: me.name },
        challenge,
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        timeout: SECURITY_LIMITS.challengeTtl * 1000,
        attestation: 'none',
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
        excludeCredentials: existing.map((k) => ({ type: 'public-key', id: k.id })),
      },
    };
  }
  private async registerVerify(me: Member, input: unknown) {
    const b = (input ?? {}) as Record<string, unknown>;
    const challenge = this.takeChallenge(b.challengeId, 'register', me.id);
    const cd = verifyClientData(this.field(b.clientDataJSON, 'clientDataJSON'), 'webauthn.create', challenge, [DEMO_RP.origin]);
    if (!cd.ok) throw err(400, 'passkey_invalid', `Passkey 校验失败：${cd.reason}`);
    let authData: Uint8Array;
    try {
      const att = cborDecode(this.field(b.attestationObject, 'attestationObject')).value;
      const ad = att instanceof Map ? att.get('authData') : null;
      if (!(ad instanceof Uint8Array)) throw new Error('no authData');
      authData = ad;
    } catch (e) {
      if (e instanceof SocialError) throw e;
      throw err(400, 'passkey_invalid', 'Passkey 校验失败：attestationObject 无法解析');
    }
    const pa = await parseAuthData(authData, DEMO_RP.id);
    if (!pa.ok) throw err(400, 'passkey_invalid', `Passkey 校验失败：${pa.reason}`);
    if (!pa.credentialId || !pa.credentialPublicKey) throw err(400, 'passkey_invalid', 'Passkey 校验失败：缺少凭据');
    const credId = b64u(pa.credentialId);
    if (typeof b.id === 'string' && b.id !== credId) throw err(400, 'passkey_invalid', 'Passkey 校验失败：凭据 ID 不一致');
    let jwk: JsonWebKey;
    try {
      jwk = coseToJwk(cborDecode(pa.credentialPublicKey).value as Map<unknown, unknown>);
    } catch (e) {
      throw err(400, 'passkey_unsupported', `不支持的 Passkey 算法（只支持 ES256 / RS256）：${(e as Error).message}`);
    }
    if (this.st().passkeys.some((p) => p.credId === credId)) throw err(409, 'passkey_exists', '这个 Passkey 已经添加过了');
    const label = (typeof b.label === 'string' ? b.label.trim().slice(0, 40) : '') || describeDevice(ua()).label;
    this.h.commit((s) => {
      s.passkeys.push({ credId, memberId: me.id, jwk, alg: jwk.kty === 'RSA' ? 'RS256' : 'ES256', signCount: pa.signCount, label, createdAt: this.sec(), lastUsedAt: null });
      this.log(s, me.id, 'passkey_added', label);
    });
    return { passkey: this.passkeys(me.id).find((k) => k.id === credId) };
  }
  private loginOptions() {
    this.h.social.limit('passkey-login', 20, 600_000, 'Passkey 登录尝试太频繁，请稍后再试');
    const { challengeId, challenge } = this.newChallenge('login', null);
    return { challengeId, publicKey: { challenge, rpId: DEMO_RP.id, timeout: SECURITY_LIMITS.challengeTtl * 1000, userVerification: 'preferred', allowCredentials: [] } };
  }
  private async loginVerify(input: unknown, issue: (memberId: number) => string) {
    const b = (input ?? {}) as Record<string, unknown>;
    const challenge = this.takeChallenge(b.challengeId, 'login', null);
    const fail = () => err(401, 'passkey_invalid', 'Passkey 无效或已被删除');
    const row = typeof b.id === 'string' ? this.st().passkeys.find((p) => p.credId === b.id) : undefined;
    if (!row) throw fail();
    const cdBytes = this.field(b.clientDataJSON, 'clientDataJSON');
    const cd = verifyClientData(cdBytes, 'webauthn.get', challenge, [DEMO_RP.origin]);
    if (!cd.ok) throw err(401, 'passkey_invalid', `Passkey 校验失败：${cd.reason}`);
    const authData = this.field(b.authenticatorData, 'authenticatorData');
    const pa = await parseAuthData(authData, DEMO_RP.id);
    if (!pa.ok) throw err(401, 'passkey_invalid', `Passkey 校验失败：${pa.reason}`);
    if (!(await verifyAssertion(row.jwk, this.field(b.signature, 'signature'), authData, cdBytes))) throw fail();
    if ((pa.signCount !== 0 || row.signCount !== 0) && pa.signCount <= row.signCount) {
      this.h.commit((s) => void this.log(s, row.memberId, 'passkey_counter', `${row.signCount}→${pa.signCount}`));
      throw err(401, 'passkey_counter', 'Passkey 签名计数异常，已拒绝登录；请删除这个 Passkey 后重新添加');
    }
    this.h.commit((s) => {
      const p = s.passkeys.find((x) => x.credId === row.credId)!;
      p.signCount = pa.signCount;
      p.lastUsedAt = this.sec();
    });
    const token = issue(row.memberId);
    this.onLogin(token, row.memberId, 'passkey');
    return { member: this.h.publicMember(row.memberId), token };
  }
  private renamePasskey(me: Member, id: string, input: unknown) {
    const label = String((input as { label?: unknown } | null)?.label ?? '').trim();
    if (!label || label.length > 40) throw bad('label', '名称 1–40 个字');
    if (!this.st().passkeys.some((p) => p.credId === id && p.memberId === me.id)) throw err(404, 'not_found', 'Passkey 不存在');
    this.h.commit((s) => {
      s.passkeys.find((p) => p.credId === id && p.memberId === me.id)!.label = label;
      this.log(s, me.id, 'passkey_renamed', label);
    });
    return { passkeys: this.passkeys(me.id) };
  }
  private removePasskey(me: Member, id: string) {
    const row = this.st().passkeys.find((p) => p.credId === id && p.memberId === me.id);
    if (!row) throw err(404, 'not_found', 'Passkey 不存在');
    this.h.commit((s) => {
      s.passkeys = s.passkeys.filter((p) => p.credId !== id);
      this.log(s, me.id, 'passkey_removed', row.label);
    });
    return { passkeys: this.passkeys(me.id) };
  }

  // ------------------------------------------------------------ 隐私权限
  private privacy(headers: Record<string, string>, me: Member) {
    const set = (this.h.social.getMe(headers) as { settings: { visibility: string; showFollows: boolean; discoverable: boolean } }).settings;
    const dm = (this.h.dm().route('GET', '/dm/settings', new URLSearchParams(), undefined, headers)?.body as { settings: { policy: string; readReceipts: boolean; showPresence: boolean } }).settings;
    const prefs = (this.h.social.getPrefs(headers) as { prefs: { email: boolean } }).prefs;
    return {
      privacy: {
        visibility: set.visibility,
        discoverable: set.discoverable,
        showFollows: set.showFollows,
        dmPolicy: dm.policy,
        readReceipts: dm.readReceipts,
        showPresence: dm.showPresence,
        loginAlerts: this.st().loginAlerts[String(me.id)] !== false,
        emailNotifications: !!prefs.email,
      },
      blocked: this.h.social.listRelations(headers, 'block').users,
    };
  }
  private putPrivacy(headers: Record<string, string>, me: Member, input: unknown) {
    this.h.social.limit(`privacy:${me.id}`, 30, 600_000, '改得太频繁，请稍后再试');
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!(k in PRIVACY_KEYS) && !(PRIVACY_BOOLS as readonly string[]).includes(k)) throw bad(k, '未知字段');
    for (const [k, allowed] of Object.entries(PRIVACY_KEYS)) if (o[k] !== undefined && !(allowed as readonly string[]).includes(o[k] as string)) throw bad(k, `只能是 ${allowed.join(' / ')}`);
    for (const k of PRIVACY_BOOLS) if (o[k] !== undefined && typeof o[k] !== 'boolean') throw bad(k, '必须是 true / false');
    const cur = this.privacy(headers, me).privacy as Record<string, unknown>;
    const prof: Record<string, unknown> = {};
    for (const k of ['visibility', 'discoverable', 'showFollows']) if (o[k] !== undefined) prof[k] = o[k];
    if (Object.keys(prof).length) this.h.social.updateMe(headers, prof);
    const dm: Record<string, unknown> = {};
    if (o.dmPolicy !== undefined) dm.policy = o.dmPolicy;
    if (o.readReceipts !== undefined) dm.readReceipts = o.readReceipts;
    if (o.showPresence !== undefined) dm.showPresence = o.showPresence;
    if (Object.keys(dm).length) this.h.dm().route('PUT', '/dm/settings', new URLSearchParams(), dm, headers);
    const changed = Object.keys(o).filter((k) => o[k] !== cur[k]);
    this.h.commit((s) => {
      if (typeof o.loginAlerts === 'boolean') s.loginAlerts[String(me.id)] = o.loginAlerts;
      if (changed.length) this.log(s, me.id, 'privacy_changed', changed.join(','));
    });
    return this.privacy(headers, me);
  }

  // ------------------------------------------------------------ 导出 / 注销
  private exportAll(headers: Record<string, string>, me: Member) {
    this.h.social.limit(`export-full:${me.id}`, 3, 86_400_000, '完整导出每 24 小时最多 3 次');
    const base = this.h.social.exportMe(headers) as Record<string, unknown>;
    const archive = {
      format: 'theblog-export/2',
      ...base,
      security: {
        sessions: this.sessions(headers, me).map(({ id: _id, network: _n, ...x }) => x),
        passkeys: this.passkeys(me.id).map(({ id: _id, ...k }) => k),
        events: this.st().events.filter((e) => e.memberId === me.id).map(({ kind, device, detail, createdAt }) => ({ kind, device_label: device, detail, created_at: createdAt })),
        deletion: deletionState(this.st().deletion[String(me.id)] ?? null, this.sec()),
      },
    };
    const items = mediaManifest(archive);
    this.h.commit((s) => void this.log(s, me.id, 'export', `${items.length} media`));
    return { ...archive, mediaManifest: { note: '媒体文件不打包在 JSON 里：按清单里的地址逐个下载（演示站的图片是示例图）。', count: items.length, items } };
  }
  private deletion(memberId: number) {
    return deletionState(this.st().deletion[String(memberId)] ?? null, this.sec());
  }
  private requestDeletion(headers: Record<string, string>, me: Member, input: unknown) {
    const username = this.h.social.profileOf(me.id).username;
    const confirm = String((input as { confirm?: unknown } | null)?.confirm ?? '').trim().toLowerCase();
    if (confirm !== username) throw err(400, 'confirm_required', '请输入你的用户名确认注销');
    if (this.deletion(me.id).state !== 'none') return { deletion: this.deletion(me.id) };
    const cur = this.bearer(headers);
    const tokens = this.h.tokens();
    this.dropTokens((t) => tokens[t] === me.id && t !== cur);
    this.h.commit((s) => {
      s.deletion[String(me.id)] = this.sec();
      s.sessions = s.sessions.filter((x) => x.memberId !== me.id || x.token === cur);
      this.log(s, me.id, 'deletion_requested');
    });
    return { deletion: this.deletion(me.id) };
  }
  private cancelDeletion(me: Member) {
    if (this.st().deletion[String(me.id)] !== undefined) {
      this.h.commit((s) => {
        delete s.deletion[String(me.id)];
        this.log(s, me.id, 'deletion_cancelled');
      });
    }
    return { deletion: this.deletion(me.id) };
  }

  // ------------------------------------------------------------ 会员路由
  async route(m: string, path: string, q: URLSearchParams, body: unknown, headers: Record<string, string>, issue: (memberId: number) => string): Promise<R | null> {
    if (!path.startsWith('/api/security/')) return null;
    const sub = path.slice('/api/security'.length);
    const ok = (b: unknown, status = 200): R => ({ status, body: b });
    let mt: RegExpExecArray | null;
    if (sub === '/passkeys/login/options' && m === 'POST') return ok(this.loginOptions());
    if (sub === '/passkeys/login/verify' && m === 'POST') {
      this.h.social.limit('passkey-login', 20, 600_000, 'Passkey 登录尝试太频繁，请稍后再试');
      return ok(await this.loginVerify(body, issue));
    }
    const me = this.h.memberFrom(headers);
    this.purgeIfDue(headers, me);
    // 会话的「最近活跃」
    const cur = this.bearer(headers);
    const row = this.st().sessions.find((x) => x.token === cur);
    // L22 之前登录的令牌没有设备记录：补一条（不算新登录）
    if (!row) this.h.commit((s) => void s.sessions.push({ id: sessionId(cur), memberId: me.id, token: cur, device: describeDevice(ua()).label, method: 'email', network: DEMO_NET, createdAt: this.sec(), lastSeenAt: this.sec() }));
    else if (this.sec() - row.lastSeenAt > 300) this.h.commit((s) => void (s.sessions.find((x) => x.token === cur)!.lastSeenAt = this.sec()));
    if (m === 'GET') {
      if (sub === '/overview') return ok({ sessions: this.sessions(headers, me), passkeys: this.passkeys(me.id), events: this.events(me.id).events.slice(0, 5), deletion: this.deletion(me.id), ...this.privacy(headers, me), demo: true });
      if (sub === '/sessions') return ok({ sessions: this.sessions(headers, me) });
      if (sub === '/events') return ok(this.events(me.id, q));
      if (sub === '/passkeys') return ok({ passkeys: this.passkeys(me.id) });
      if (sub === '/export') return ok(this.exportAll(headers, me));
      if (sub === '/privacy') return ok(this.privacy(headers, me));
      if (sub === '/deletion') return ok({ deletion: this.deletion(me.id) });
      return null;
    }
    if ((mt = /^\/sessions\/([0-9a-f]{16})$/.exec(sub)) && m === 'DELETE') return ok(this.revoke(headers, me, mt[1]!));
    if (sub === '/sessions/revoke-others' && m === 'POST') return ok(this.revokeMany(headers, me, true));
    if (sub === '/sessions/revoke-all' && m === 'POST') return ok(this.revokeMany(headers, me, false));
    if (sub === '/passkeys/register/options' && m === 'POST') return ok(this.registerOptions(me));
    if (sub === '/passkeys/register/verify' && m === 'POST') return ok(await this.registerVerify(me, body), 201);
    if ((mt = /^\/passkeys\/([A-Za-z0-9_-]{8,1400})$/.exec(sub))) {
      if (m === 'PATCH' || m === 'PUT') return ok(this.renamePasskey(me, mt[1]!, body));
      if (m === 'DELETE') return ok(this.removePasskey(me, mt[1]!));
    }
    if (sub === '/deletion' && m === 'POST') return ok(this.requestDeletion(headers, me, body));
    if (sub === '/deletion/cancel' && m === 'POST') return ok(this.cancelDeletion(me));
    if (sub === '/privacy' && (m === 'PUT' || m === 'PATCH')) return ok(this.putPrivacy(headers, me, body));
    return null;
  }

  // ------------------------------------------------------------ 管理员二次验证
  totpEnabled(): boolean {
    return !!this.st().totp.enabledAt;
  }
  /** 密码正确之后：开启了二次验证 → 返回 preAuth（不给会话）；否则记录登录并返回 null。 */
  adminPasswordOk(): { ok: true; needsTotp: true; preAuth: string } | null {
    if (!this.totpEnabled()) {
      this.bestEffort(() => this.h.commit((s) => void this.log(s, null, 'admin_login', 'password')));
      return null;
    }
    const id = rand(18);
    this.h.commit((s) => {
      s.preAuth = s.preAuth.filter((p) => p.exp > this.sec());
      s.preAuth.push({ id, exp: this.sec() + 300, used: false, tries: 0 });
    });
    return { ok: true, needsTotp: true, preAuth: id };
  }
  adminPasswordFailed(): void {
    this.bestEffort(() => this.h.commit((s) => void this.log(s, null, 'admin_login_failed', 'password')));
  }
  /** 安全记录写不进去（例如本地存储满了）不影响登录本身，与 Worker 的处理一致 */
  private bestEffort(fn: () => void): void {
    try {
      fn();
    } catch {
      /* 忽略 */
    }
  }
  private async check(code: string): Promise<'totp' | 'recovery' | null> {
    const t = this.st().totp;
    const c = code.trim();
    if (/^\d{6}$/.test(c)) {
      const v = await totpVerify(base32Decode(t.secret), c, this.sec(), t.lastStep);
      if (!v.ok) return null;
      this.h.commit((s) => void (s.totp.lastStep = v.step));
      return 'totp';
    }
    const n = normalizeRecoveryCode(c);
    if (!n || !t.recovery.includes(n)) return null;
    this.h.commit((s) => void (s.totp.recovery = s.totp.recovery.filter((x) => x !== n)));
    return 'recovery';
  }
  /** POST /api/auth/2fa：成功返回 true（调用方签发后台会话）。 */
  async secondFactor(input: unknown): Promise<true> {
    const b = (input ?? {}) as { preAuth?: unknown; code?: unknown };
    const p = this.st().preAuth.find((x) => x.id === b.preAuth);
    if (!p || p.used || p.exp < this.sec() || p.tries >= 5) throw err(401, 'preauth_expired', '登录已过期，请重新输入密码');
    this.h.commit((s) => void s.preAuth.find((x) => x.id === p.id)!.tries++);
    if (!this.totpEnabled()) return true;
    const used = typeof b.code === 'string' ? await this.check(b.code) : null;
    if (!used) {
      this.h.commit((s) => void this.log(s, null, 'admin_2fa_failed', ''));
      throw err(401, 'bad_code', '验证码或恢复码不正确');
    }
    this.h.commit((s) => {
      s.preAuth.find((x) => x.id === p.id)!.used = true;
      this.log(s, null, used === 'recovery' ? 'admin_recovery_used' : 'admin_login', used);
    });
    return true;
  }
  async routeAdmin(m: string, sub: string, q: URLSearchParams, body: unknown): Promise<R | null> {
    if (!sub.startsWith('/security/')) return null;
    const ok = (b: unknown): R => ({ status: 200, body: b });
    const code = () => String((body as { code?: unknown } | null)?.code ?? '');
    const t = this.st().totp;
    if (sub === '/security/2fa' && m === 'GET') return ok({ enabled: !!t.enabledAt, enabledAt: t.enabledAt, pending: !!t.pending && !t.enabledAt, recoveryRemaining: t.enabledAt ? t.recovery.length : 0, ...this.events(null, q), demo: true });
    if (sub === '/security/2fa/setup' && m === 'POST') {
      if (t.enabledAt) throw err(409, 'already_enabled', '二次验证已经开启；要更换请先关闭');
      const secret = base32Encode(crypto.getRandomValues(new Uint8Array(20)));
      this.h.commit((s) => void (s.totp.pending = secret));
      return ok({ secret, otpauth: otpauthUri(secret, 'admin', 'TheBLOG') });
    }
    if (sub === '/security/2fa/confirm' && m === 'POST') {
      this.h.social.limit('totp-admin', 30, 900_000, '验证码尝试太多，请 15 分钟后再试');
      if (!t.pending || t.enabledAt) throw err(400, 'no_pending', '请先生成二次验证密钥');
      const v = await totpVerify(base32Decode(t.pending), code().trim(), this.sec());
      if (!v.ok) throw err(400, 'bad_code', '验证码不正确：确认手机时间准确后重试');
      const codes = newRecoveryCodes(10);
      this.h.commit((s) => {
        s.totp = { secret: t.pending, pending: '', lastStep: v.step, recovery: codes.map((c) => normalizeRecoveryCode(c)!), enabledAt: this.sec() };
        this.log(s, null, 'admin_2fa_enabled', '');
      });
      return ok({ enabled: true, recoveryCodes: codes });
    }
    if (sub === '/security/2fa/disable' && m === 'POST') {
      this.h.social.limit('totp-admin', 30, 900_000, '验证码尝试太多，请 15 分钟后再试');
      if (!t.enabledAt) return ok({ enabled: false });
      const used = await this.check(code());
      if (!used) {
        this.h.commit((s) => void this.log(s, null, 'admin_2fa_failed', 'disable'));
        throw err(400, 'bad_code', '验证码或恢复码不正确');
      }
      this.h.commit((s) => {
        s.totp = { secret: '', pending: '', lastStep: -1, recovery: [], enabledAt: null };
        this.log(s, null, 'admin_2fa_disabled', used);
      });
      return ok({ enabled: false });
    }
    if (sub === '/security/2fa/recovery' && m === 'POST') {
      if (!t.enabledAt) throw err(400, 'not_enabled', '二次验证没有开启');
      if (!/^\d{6}$/.test(code().trim()) || (await this.check(code())) !== 'totp') throw err(400, 'bad_code', '请输入身份验证器里的 6 位验证码');
      const codes = newRecoveryCodes(10);
      this.h.commit((s) => {
        s.totp.recovery = codes.map((c) => normalizeRecoveryCode(c)!);
        this.log(s, null, 'admin_recovery_regenerated', '');
      });
      return ok({ recoveryCodes: codes });
    }
    return null;
  }
}
