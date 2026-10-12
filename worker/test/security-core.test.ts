// L22 账号安全与隐私中心：纯函数核心（worker/src/security-core.ts，web/src 同名副本逐字相同）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SECURITY_LIMITS,
  base32Decode,
  base32Encode,
  cborDecode,
  coseToJwk,
  deletionState,
  derToRaw,
  describeDevice,
  hotp,
  loginAlert,
  parseAuthData,
  totpVerify,
  verifyClientData,
} from '../src/security-core';

const enc = new TextEncoder();
const RFC_SECRET = enc.encode('12345678901234567890');

describe('base32 (RFC 4648)', () => {
  it('round-trips and matches the RFC 6238 test secret', () => {
    expect(base32Encode(RFC_SECRET)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect([...base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')]).toEqual([...RFC_SECRET]);
    expect([...base32Decode('gezd gnbv-gy3t qojq gezd gnbv gy3t qojq')]).toEqual([...RFC_SECRET]);
    expect(base32Encode(enc.encode('f'))).toBe('MY');
  });
  it('rejects invalid characters', () => {
    expect(() => base32Decode('GEZ1')).toThrow();
  });
});

describe('TOTP (RFC 6238, SHA-1, 6 digits) for admin 2FA', () => {
  const vectors: [number, string][] = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ];
  it.each(vectors)('t=%i → %s', async (t, code) => {
    expect(await hotp(RFC_SECRET, Math.floor(t / 30))).toBe(code);
    expect(await totpVerify(RFC_SECRET, code, t)).toEqual({ ok: true, step: Math.floor(t / 30) });
  });
  it('accepts ±1 step drift, rejects ±2, rejects malformed and replayed codes', async () => {
    expect((await totpVerify(RFC_SECRET, '081804', 1111111109 + 30)).ok).toBe(true);
    expect((await totpVerify(RFC_SECRET, '081804', 1111111109 - 30)).ok).toBe(true);
    expect((await totpVerify(RFC_SECRET, '081804', 1111111109 + 61)).ok).toBe(false);
    expect((await totpVerify(RFC_SECRET, '08180', 1111111109)).ok).toBe(false);
    expect((await totpVerify(RFC_SECRET, 'abcdef', 1111111109)).ok).toBe(false);
    const step = Math.floor(1111111109 / 30);
    expect((await totpVerify(RFC_SECRET, '081804', 1111111109, step)).ok).toBe(false); // 同一步不能用两次
  });
});

describe('device description from User-Agent (sessions list)', () => {
  it('names common browsers / OSes without storing the raw UA', () => {
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toEqual({ browser: 'Safari', os: 'iOS', type: 'mobile', label: 'Safari · iOS' });
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0').label).toBe('Edge · Windows');
    expect(describeDevice('Mozilla/5.0 (Linux; Android 15; PJZ110) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36')).toMatchObject({ browser: 'Chrome', os: 'Android', type: 'mobile' });
    expect(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0').label).toBe('Firefox · macOS');
    expect(describeDevice('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 MicroMessenger/8.0.50').browser).toBe('微信');
    expect(describeDevice('')).toEqual({ browser: '未知浏览器', os: '未知系统', type: 'desktop', label: '未知浏览器 · 未知系统' });
  });
});

describe('login alert (account anomaly reminders)', () => {
  const known = [{ device: 'Chrome · Windows', ipPrefix: 'a1b2' }];
  it('alerts on a device never seen before, not on a known one', () => {
    expect(loginAlert(known, { device: 'Chrome · Windows', ipPrefix: 'a1b2' })).toBeNull();
    expect(loginAlert(known, { device: 'Safari · iOS', ipPrefix: 'a1b2' })).toBe('new_device');
    expect(loginAlert(known, { device: 'Chrome · Windows', ipPrefix: 'ffff' })).toBe('new_network');
    expect(loginAlert([], { device: 'Chrome · Windows', ipPrefix: 'a1b2' })).toBeNull(); // 第一次登录不提醒
  });
});

describe('account deletion with a grace period', () => {
  const day = 86400;
  it('is pending for the grace period, then due; cancel clears it', () => {
    const at = 1_800_000_000;
    expect(SECURITY_LIMITS.deletionGraceDays).toBe(7);
    expect(deletionState(null, at)).toEqual({ state: 'none' });
    expect(deletionState(at, at + 3 * day)).toEqual({ state: 'pending', purgeAt: at + 7 * day, daysLeft: 4 });
    expect(deletionState(at, at + 7 * day)).toEqual({ state: 'due', purgeAt: at + 7 * day, daysLeft: 0 });
  });
});

// ---------------------------------------------------------------- WebAuthn（Passkey）
function cborEncode(v: unknown): Uint8Array {
  const out: number[] = [];
  const head = (major: number, n: number) => {
    if (n < 24) out.push((major << 5) | n);
    else if (n < 256) out.push((major << 5) | 24, n);
    else out.push((major << 5) | 25, n >> 8, n & 255);
  };
  const walk = (x: unknown): void => {
    if (typeof x === 'number') { if (x >= 0) head(0, x); else head(1, -1 - x); }
    else if (typeof x === 'string') { const b = enc.encode(x); head(3, b.length); out.push(...b); }
    else if (x instanceof Uint8Array) { head(2, x.length); out.push(...x); }
    else if (Array.isArray(x)) { head(4, x.length); x.forEach(walk); }
    else if (x instanceof Map) { head(5, x.size); for (const [k, val] of x) { walk(k); walk(val); } }
    else throw new Error('unsupported');
  };
  walk(v);
  return new Uint8Array(out);
}
const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; let s = [...b.slice(i)]; if (s[0]! & 0x80) s = [0, ...s]; return [0x02, s.length, ...s]; };
  const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}

describe('CBOR / COSE', () => {
  it('decodes maps with negative keys, byte strings, text and arrays', () => {
    const m = new Map<unknown, unknown>([[1, 2], [-1, 1], ['fmt', 'none'], [-2, new Uint8Array([1, 2, 3])], ['a', [1, 300]]]);
    const d = cborDecode(cborEncode(m)).value as Map<unknown, unknown>;
    expect(d.get(1)).toBe(2);
    expect(d.get(-1)).toBe(1);
    expect(d.get('fmt')).toBe('none');
    expect([...(d.get(-2) as Uint8Array)]).toEqual([1, 2, 3]);
    expect(d.get('a')).toEqual([1, 300]);
  });
  it('rejects truncated input and unsupported (non-ES256) keys', () => {
    expect(() => cborDecode(new Uint8Array([0x5a]))).toThrow();
    expect(() => coseToJwk(new Map<unknown, unknown>([[1, 3], [3, -257]]))).toThrow(/ES256/);
  });
});

describe('WebAuthn assertion pieces (ES256)', () => {
  const rpId = 'blog.example.com';
  const origin = 'https://blog.example.com';
  it('verifies clientDataJSON type / challenge / origin', () => {
    const cd = enc.encode(JSON.stringify({ type: 'webauthn.get', challenge: 'abc_-', origin, crossOrigin: false }));
    expect(verifyClientData(cd, 'webauthn.get', 'abc_-', [origin])).toEqual({ ok: true });
    expect(verifyClientData(cd, 'webauthn.create', 'abc_-', [origin]).ok).toBe(false);
    expect(verifyClientData(cd, 'webauthn.get', 'other', [origin]).ok).toBe(false);
    expect(verifyClientData(cd, 'webauthn.get', 'abc_-', ['https://evil.example']).ok).toBe(false);
    expect(verifyClientData(enc.encode('{oops'), 'webauthn.get', 'abc_-', [origin]).ok).toBe(false);
  });

  it('parses authenticator data, checks rpIdHash + flags, and a real ES256 signature verifies end-to-end', async () => {
    const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as JsonWebKey;
    const x = new Uint8Array(Buffer.from(jwk.x!, 'base64url'));
    const y = new Uint8Array(Buffer.from(jwk.y!, 'base64url'));
    const cose = cborEncode(new Map<unknown, unknown>([[1, 2], [3, -7], [-1, 1], [-2, x], [-3, y]]));
    const credId = new Uint8Array(16).fill(7);
    const rpHash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(rpId)));
    // 注册：flags UP|UV|AT，signCount 0，带 attested credential data
    const reg = new Uint8Array([...rpHash, 0x45, 0, 0, 0, 0, ...new Uint8Array(16), 0, 16, ...credId, ...cose]);
    const pa = await parseAuthData(reg, rpId);
    expect(pa.ok).toBe(true);
    if (!pa.ok) return;
    expect(pa.userPresent && pa.userVerified).toBe(true);
    expect(pa.signCount).toBe(0);
    expect(b64u(pa.credentialId!)).toBe(b64u(credId));
    const pubJwk = coseToJwk(cborDecode(pa.credentialPublicKey!).value as Map<unknown, unknown>);
    expect(pubJwk).toMatchObject({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y });

    // 登录：authData(UP|UV, signCount 5) || sha256(clientDataJSON) 签名（DER）
    const auth = new Uint8Array([...rpHash, 0x05, 0, 0, 0, 5]);
    const cd = enc.encode(JSON.stringify({ type: 'webauthn.get', challenge: 'c1', origin }));
    const cdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', cd));
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, new Uint8Array([...auth, ...cdHash])));
    const der = rawToDer(raw);
    expect([...derToRaw(der)]).toEqual([...raw]);
    const key = await crypto.subtle.importKey('jwk', pubJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(der), new Uint8Array([...auth, ...cdHash]))).toBe(true);
    const pl = await parseAuthData(auth, rpId);
    expect(pl.ok && pl.signCount).toBe(5);

    // 其它站点的 rpId、没有 UP 标志 → 拒绝
    expect((await parseAuthData(auth, 'evil.example')).ok).toBe(false);
    expect((await parseAuthData(new Uint8Array([...rpHash, 0x04, 0, 0, 0, 6]), rpId)).ok).toBe(false);
    expect((await parseAuthData(new Uint8Array(10), rpId)).ok).toBe(false);
  });
});

describe('web copy is identical', () => {
  it('web/src/security-core.ts === worker/src/security-core.ts', () => {
    const a = readFileSync(join(__dirname, '../src/security-core.ts'), 'utf8');
    const b = readFileSync(join(__dirname, '../../web/src/security-core.ts'), 'utf8');
    expect(b).toBe(a);
  });
});
