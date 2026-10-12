// L22 账号安全与隐私中心 —— 纯函数核心（不碰 D1 / 网络）。worker/src 与 web/src 各一份，内容必须逐字相同（测试会比对）。
// 内容：Base32 + TOTP（管理员二次验证，RFC 4648 / 4226 / 6238）、User-Agent → 设备名（会话列表，不保存原始 UA）、
// 登录异常判断、注销冷静期、最小 CBOR 解码 + COSE(ES256 / RS256) → JWK、WebAuthn clientDataJSON / authenticatorData 校验、DER → raw 签名、
// 断言签名校验、网络前缀（IPv4 /24、IPv6 /48，只用来判断「新网络」，再加盐哈希后才落库）、恢复码、otpauth:// URI。

export const SECURITY_LIMITS = {
  /** 申请注销后的冷静期（天），期间登录可撤销 */
  deletionGraceDays: 7,
  /** TOTP 允许的前后时间步 */
  totpWindow: 1,
  totpStep: 30,
  /** WebAuthn challenge 有效期（秒） */
  challengeTtl: 300,
  /** 每个账号最多保存的 Passkey 数 */
  maxPasskeys: 10,
} as const;

// ---------------------------------------------------------------- Base32
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Uint8Array {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error(`invalid base32 character "${ch}"`);
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

// ---------------------------------------------------------------- HOTP / TOTP
export async function hotp(secret: Uint8Array, counter: number, digits = 6): Promise<string> {
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 255;
    c = Math.floor(c / 256);
  }
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const off = h[h.length - 1]! & 15;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/**
 * 校验 6 位 TOTP。`lastStep` 是这个账号上一次成功使用的时间步：同一步或更早的码一律拒绝（防重放）。
 * 成功时返回命中的时间步，调用方把它存为新的 lastStep。
 */
export async function totpVerify(secret: Uint8Array, code: string, nowSec: number, lastStep = -1): Promise<{ ok: true; step: number } | { ok: false }> {
  if (!/^\d{6}$/.test(code)) return { ok: false };
  const cur = Math.floor(nowSec / SECURITY_LIMITS.totpStep);
  for (let d = -SECURITY_LIMITS.totpWindow; d <= SECURITY_LIMITS.totpWindow; d++) {
    const step = cur + d;
    if (step <= lastStep) continue;
    if (timingEq(await hotp(secret, step), code)) return { ok: true, step };
  }
  return { ok: false };
}

function timingEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------------------------------------------------------------- 设备名
export interface DeviceInfo { browser: string; os: string; type: 'mobile' | 'tablet' | 'desktop'; label: string }

export function describeDevice(ua: string): DeviceInfo {
  const u = ua || '';
  const browser =
    /MicroMessenger\//.test(u) ? '微信'
      : /Edg(A|iOS)?\//.test(u) ? 'Edge'
        : /OPR\/|Opera/.test(u) ? 'Opera'
          : /SamsungBrowser\//.test(u) ? 'Samsung Internet'
            : /Firefox\/|FxiOS\//.test(u) ? 'Firefox'
              : /Chrome\/|CriOS\//.test(u) ? 'Chrome'
                : /Safari\//.test(u) && /Version\//.test(u) ? 'Safari'
                  : '未知浏览器';
  const os =
    /iPhone|iPod/.test(u) ? 'iOS'
      : /iPad/.test(u) ? 'iPadOS'
        : /Android/.test(u) ? 'Android'
          : /Windows NT/.test(u) ? 'Windows'
            : /Mac OS X|Macintosh/.test(u) ? 'macOS'
              : /CrOS/.test(u) ? 'ChromeOS'
                : /Linux/.test(u) ? 'Linux'
                  : '未知系统';
  const type: DeviceInfo['type'] = /iPad|Tablet/.test(u) ? 'tablet' : /Mobile|iPhone|Android/.test(u) ? 'mobile' : 'desktop';
  return { browser, os, type, label: `${browser} · ${os}` };
}

// ---------------------------------------------------------------- 登录异常
export interface LoginFingerprint { device: string; ipPrefix: string }

/**
 * 新登录是否需要提醒：之前的登录里从没出现过的设备 → new_device；设备见过但网络（加盐 IP 哈希前缀）没见过 → new_network。
 * 账号第一次登录（没有历史）不提醒。
 */
export function loginAlert(known: readonly LoginFingerprint[], cur: LoginFingerprint): 'new_device' | 'new_network' | null {
  if (!known.length) return null;
  if (!known.some((k) => k.device === cur.device)) return 'new_device';
  if (!known.some((k) => k.ipPrefix === cur.ipPrefix)) return 'new_network';
  return null;
}

// ---------------------------------------------------------------- 注销冷静期
export type DeletionState = { state: 'none' } | { state: 'pending' | 'due'; purgeAt: number; daysLeft: number };

export function deletionState(requestedAt: number | null, nowSec: number): DeletionState {
  if (requestedAt == null) return { state: 'none' };
  const purgeAt = requestedAt + SECURITY_LIMITS.deletionGraceDays * 86400;
  const daysLeft = Math.max(0, Math.ceil((purgeAt - nowSec) / 86400));
  return { state: nowSec >= purgeAt ? 'due' : 'pending', purgeAt, daysLeft };
}

// ---------------------------------------------------------------- CBOR（只支持 WebAuthn 用到的子集）
export function cborDecode(buf: Uint8Array, pos = 0): { value: unknown; end: number } {
  const need = (n: number) => {
    if (pos + n > buf.length) throw new Error('cbor: truncated');
  };
  need(1);
  const ib = buf[pos++]!;
  const major = ib >> 5;
  const info = ib & 31;
  let len: number;
  if (info < 24) len = info;
  else if (info === 24) { need(1); len = buf[pos++]!; }
  else if (info === 25) { need(2); len = (buf[pos]! << 8) | buf[pos + 1]!; pos += 2; }
  else if (info === 26) { need(4); len = ((buf[pos]! << 24) >>> 0) + (buf[pos + 1]! << 16) + (buf[pos + 2]! << 8) + buf[pos + 3]!; pos += 4; }
  else throw new Error('cbor: unsupported length');
  switch (major) {
    case 0: return { value: len, end: pos };
    case 1: return { value: -1 - len, end: pos };
    case 2: need(len); return { value: buf.slice(pos, pos + len), end: pos + len };
    case 3: need(len); return { value: new TextDecoder().decode(buf.slice(pos, pos + len)), end: pos + len };
    case 4: {
      const arr: unknown[] = [];
      for (let i = 0; i < len; i++) { const r = cborDecode(buf, pos); arr.push(r.value); pos = r.end; }
      return { value: arr, end: pos };
    }
    case 5: {
      const m = new Map<unknown, unknown>();
      for (let i = 0; i < len; i++) {
        const k = cborDecode(buf, pos);
        const v = cborDecode(buf, k.end);
        m.set(k.value, v.value);
        pos = v.end;
      }
      return { value: m, end: pos };
    }
    case 7:
      if (info === 20) return { value: false, end: pos };
      if (info === 21) return { value: true, end: pos };
      if (info === 22) return { value: null, end: pos };
      throw new Error('cbor: unsupported simple value');
    default:
      throw new Error('cbor: unsupported major type');
  }
}

/** COSE_Key → JWK。只接受 ES256（kty 2 EC2, alg -7, crv 1 P-256）和 RS256（kty 3 RSA, alg -257, n ≥ 2048 位）。 */
export function coseToJwk(m: Map<unknown, unknown>): JsonWebKey {
  if (m.get(1) === 3 && m.get(3) === -257) {
    const n = m.get(-1);
    const e = m.get(-2);
    if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array) || n.length < 256 || e.length < 1 || e.length > 8) throw new Error('bad RSA key');
    return { kty: 'RSA', alg: 'RS256', n: b64url(n), e: b64url(e), ext: true };
  }
  if (m.get(1) !== 2 || m.get(3) !== -7 || m.get(-1) !== 1) throw new Error('only ES256 (P-256) or RS256 passkeys are supported');
  const x = m.get(-2);
  const y = m.get(-3);
  if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) throw new Error('bad EC2 coordinates');
  return { kty: 'EC', crv: 'P-256', x: b64url(x), y: b64url(y), ext: true };
}

/** 校验 WebAuthn 断言签名：签名对象是 authenticatorData || SHA-256(clientDataJSON)。ES256 签名是 DER，RS256 是 PKCS#1 v1.5。 */
export async function verifyAssertion(jwk: JsonWebKey, signature: Uint8Array, authData: Uint8Array, clientDataJSON: Uint8Array): Promise<boolean> {
  const cdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
  const data = new Uint8Array(authData.length + cdHash.length);
  data.set(authData, 0);
  data.set(cdHash, authData.length);
  try {
    if (jwk.kty === 'RSA') {
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
    }
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(signature), data);
  } catch {
    return false;
  }
}

function b64url(b: Uint8Array): string {
  let s = '';
  for (const c of b) s += String.fromCharCode(c);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------- WebAuthn
export function verifyClientData(json: Uint8Array, type: 'webauthn.create' | 'webauthn.get', challenge: string, origins: readonly string[]): { ok: true } | { ok: false; reason: string } {
  let cd: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  try {
    cd = JSON.parse(new TextDecoder().decode(json)) as typeof cd;
  } catch {
    return { ok: false, reason: 'clientDataJSON is not JSON' };
  }
  if (cd.type !== type) return { ok: false, reason: 'wrong type' };
  if (typeof cd.challenge !== 'string' || !timingEq(cd.challenge, challenge)) return { ok: false, reason: 'challenge mismatch' };
  if (typeof cd.origin !== 'string' || !origins.includes(cd.origin)) return { ok: false, reason: 'origin not allowed' };
  if (cd.crossOrigin === true) return { ok: false, reason: 'cross-origin not allowed' };
  return { ok: true };
}

export type ParsedAuthData =
  | { ok: true; userPresent: boolean; userVerified: boolean; signCount: number; credentialId?: Uint8Array; credentialPublicKey?: Uint8Array }
  | { ok: false; reason: string };

/** 解析 authenticatorData，校验 rpIdHash 与 UP 标志；带 AT 标志时取出凭据 ID 和 COSE 公钥字节。 */
export async function parseAuthData(ad: Uint8Array, rpId: string): Promise<ParsedAuthData> {
  if (ad.length < 37) return { ok: false, reason: 'authenticatorData too short' };
  const want = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId)));
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= want[i]! ^ ad[i]!;
  if (diff) return { ok: false, reason: 'rpIdHash mismatch' };
  const flags = ad[32]!;
  const userPresent = (flags & 0x01) !== 0;
  const userVerified = (flags & 0x04) !== 0;
  if (!userPresent) return { ok: false, reason: 'user not present' };
  const signCount = ((ad[33]! << 24) >>> 0) + (ad[34]! << 16) + (ad[35]! << 8) + ad[36]!;
  if (!(flags & 0x40)) return { ok: true, userPresent, userVerified, signCount };
  if (ad.length < 55) return { ok: false, reason: 'attested credential data truncated' };
  const idLen = (ad[53]! << 8) | ad[54]!;
  if (ad.length < 55 + idLen + 1) return { ok: false, reason: 'credential id truncated' };
  const credentialId = ad.slice(55, 55 + idLen);
  let keyEnd: number;
  try {
    keyEnd = cborDecode(ad, 55 + idLen).end;
  } catch {
    return { ok: false, reason: 'bad credential public key' };
  }
  return { ok: true, userPresent, userVerified, signCount, credentialId, credentialPublicKey: ad.slice(55 + idLen, keyEnd) };
}

/** ASN.1 DER ECDSA 签名 → WebCrypto 需要的 64 字节 r||s。 */
export function derToRaw(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error('not a DER sequence');
  let p = 2;
  const read = () => {
    if (der[p] !== 0x02) throw new Error('DER: expected integer');
    const len = der[p + 1]!;
    let v = der.slice(p + 2, p + 2 + len);
    p += 2 + len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) throw new Error('DER: integer too long');
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = read();
  const s = read();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

// ---------------------------------------------------------------- 网络前缀 / 恢复码 / otpauth
/** 「同一个网络」的粗粒度：IPv4 取 /24，IPv6 取 /48；其它（unknown）原样。调用方再加盐哈希，原始 IP 不落库。 */
export function networkOf(ip: string): string {
  const v = (ip || '').trim();
  const m4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  if (m4) return `${m4[1]}.${m4[2]}.${m4[3]}.0/24`;
  if (v.includes(':') && /^[0-9a-f:]+$/i.test(v)) {
    const [head = '', tail = ''] = v.toLowerCase().split('::');
    const h = head ? head.split(':') : [];
    const t = v.includes('::') ? (tail ? tail.split(':') : []) : [];
    const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
    return `${full.slice(0, 3).map((x) => x.replace(/^0+(?=.)/, '')).join(':')}::/48`;
  }
  return 'unknown';
}

/** 一次性恢复码：10 位 Base32（50 位熵），显示为 XXXXX-XXXXX。 */
export function newRecoveryCodes(n = 10): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = base32Encode(crypto.getRandomValues(new Uint8Array(7))).slice(0, 10);
    out.push(`${c.slice(0, 5)}-${c.slice(5)}`);
  }
  return out;
}

/** 用户输入的恢复码 → 规范形式（大写、去掉空格和连字符）；格式不对返回 null。 */
export function normalizeRecoveryCode(input: string): string | null {
  const s = (input || '').toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z2-7]{10}$/.test(s) ? s : null;
}

export function otpauthUri(secretB32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${SECURITY_LIMITS.totpStep}`;
}
