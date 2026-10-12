// 测试用的「软件认证器」：生成 ES256 / RS256 密钥，拼出注册（attestationObject, fmt none）和登录断言（authenticatorData + DER 签名）。
const enc = new TextEncoder();

export function cborEncode(v: unknown): Uint8Array {
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
export const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
export const unb64u = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));
export function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; let s = [...b.slice(i)]; if (s[0]! & 0x80) s = [0, ...s]; return [0x02, s.length, ...s]; };
  const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}

export interface SoftAuthenticator {
  alg: 'ES256' | 'RS256';
  credId: Uint8Array;
  signCount: number;
  cose: Uint8Array;
  sign(data: Uint8Array): Promise<Uint8Array>;
}

export async function softAuthenticator(alg: 'ES256' | 'RS256' = 'ES256'): Promise<SoftAuthenticator> {
  const credId = crypto.getRandomValues(new Uint8Array(16));
  if (alg === 'RS256') {
    const kp = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as JsonWebKey;
    const cose = cborEncode(new Map<unknown, unknown>([[1, 3], [3, -257], [-1, unb64u(jwk.n!)], [-2, unb64u(jwk.e!)]]));
    return { alg, credId, signCount: 0, cose, sign: async (d) => new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, d)) };
  }
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as JsonWebKey;
  const cose = cborEncode(new Map<unknown, unknown>([[1, 2], [3, -7], [-1, 1], [-2, unb64u(jwk.x!)], [-3, unb64u(jwk.y!)]]));
  return { alg, credId, signCount: 0, cose, sign: async (d) => rawToDer(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, d))) };
}

const rpHash = async (rpId: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(rpId)));

/** navigator.credentials.create() 的结果（JSON 化，字段都是 base64url）。 */
export async function attest(a: SoftAuthenticator, o: { rpId: string; origin: string; challenge: string; flags?: number }) {
  const h = await rpHash(o.rpId);
  const authData = new Uint8Array([...h, o.flags ?? 0x45, 0, 0, 0, 0, ...new Uint8Array(16), 0, a.credId.length, ...a.credId, ...a.cose]);
  const attestationObject = cborEncode(new Map<unknown, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
  const clientDataJSON = enc.encode(JSON.stringify({ type: 'webauthn.create', challenge: o.challenge, origin: o.origin, crossOrigin: false }));
  return { id: b64u(a.credId), clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject) };
}

/** navigator.credentials.get() 的结果。signCount 默认自增；可以手动指定（测克隆检测）。 */
export async function assertion(a: SoftAuthenticator, o: { rpId: string; origin: string; challenge: string; signCount?: number; flags?: number }) {
  a.signCount = o.signCount ?? a.signCount + 1;
  const c = a.signCount;
  const h = await rpHash(o.rpId);
  const authData = new Uint8Array([...h, o.flags ?? 0x05, (c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255]);
  const clientDataJSON = enc.encode(JSON.stringify({ type: 'webauthn.get', challenge: o.challenge, origin: o.origin }));
  const cdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
  const signature = await a.sign(new Uint8Array([...authData, ...cdHash]));
  return { id: b64u(a.credId), clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature) };
}
