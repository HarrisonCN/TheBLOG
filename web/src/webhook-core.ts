/**
 * L31 / v1.31.0 Webhook（web 与 worker 共用同一份文件，内容必须完全一致）。
 * 签名头：X-TheBLOG-Signature: t=<unix 秒>,v1=<hex HMAC-SHA256(secret, `${t}.${body}`)>；
 * 接收方校验时间容差（默认 300 秒）防重放。只允许 https 公网地址（本地测试可显式放开）。
 */
import { isPrivateHost, type Check } from './open-core';

export const WEBHOOK_EVENTS = ['ping', 'post.published', 'work.published', 'comment.created', 'member.joined', 'group.post'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export const WEBHOOK_EVENT_LABEL: Record<WebhookEvent, string> = {
  ping: '测试（ping）', 'post.published': '文章发布', 'work.published': '作品发布', 'comment.created': '新评论', 'member.joined': '新会员', 'group.post': '小组新动态',
};
export const WEBHOOK_MAX_ATTEMPTS = 5;
export const WEBHOOK_TOLERANCE_S = 300;
export const WEBHOOK_LIMITS = { max: 10, descMax: 100, deliveriesKeep: 50, timeoutMs: 5000 };
export const WEBHOOK_SIG_HEADER = 'X-TheBLOG-Signature';
export const WEBHOOK_SECRET_RE = /^whsec_[A-Za-z0-9_-]{32,}$/;

export interface WebhookInput { url: string; events: WebhookEvent[]; active: boolean; description: string }
const bad = <T>(path: string, error: string): Check<T> => ({ ok: false, path, error });

export function checkWebhookUrl(raw: unknown, o: { allowPrivate?: boolean } = {}): Check<string> {
  if (typeof raw !== 'string' || raw.length > 500) return bad('url', '请填写地址');
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return bad('url', '地址格式不对'); }
  if (u.username || u.password) return bad('url', '地址里不能带用户名或密码');
  if (o.allowPrivate) {
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return bad('url', '只支持 http(s) 地址');
  } else {
    if (u.protocol !== 'https:') return bad('url', 'Webhook 地址必须是 https');
    if (isPrivateHost(u.hostname)) return bad('url', '不能投递到内网或本机地址');
  }
  return { ok: true, value: u.toString() };
}

export function checkWebhookInput(input: unknown, o: { allowPrivate?: boolean; partial?: boolean } = {}): Check<WebhookInput> {
  const x = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const url = checkWebhookUrl(x.url, o);
  if (!url.ok) return url as Check<WebhookInput>;
  if (!Array.isArray(x.events) || !x.events.length) return bad('events', '至少选择一个事件');
  const events: WebhookEvent[] = [];
  for (const e of x.events) {
    if (!WEBHOOK_EVENTS.includes(e as WebhookEvent)) return bad('events', `不认识的事件：${String(e)}`);
    if (!events.includes(e as WebhookEvent)) events.push(e as WebhookEvent);
  }
  if ('active' in x && typeof x.active !== 'boolean') return bad('active', 'active 只能是 true / false');
  const description = typeof x.description === 'string' ? x.description.trim().slice(0, WEBHOOK_LIMITS.descMax) : '';
  return { ok: true, value: { url: url.value, events, active: x.active === undefined ? true : (x.active as boolean), description } };
}

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
export async function signatureHeader(secret: string, t: number, body: string): Promise<string> {
  return `t=${t},v1=${await hmacHex(secret, `${t}.${body}`)}`;
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export async function verifySignature(header: string, secret: string, body: string, nowSec: number, toleranceS = WEBHOOK_TOLERANCE_S): Promise<boolean> {
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec((header ?? '').trim());
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(nowSec - t) > toleranceS) return false;
  return safeEqual(await hmacHex(secret, `${t}.${body}`), m[2]!);
}

/** 0 = 网络错误 / 超时。 */
export const isRetryableStatus = (s: number) => s === 0 || s === 408 || s === 429 || s >= 500;
/** 第 attempt 次失败后的下次重试时间（毫秒时间戳）；30 s、2 min、8 min、32 min；次数用完返回 null。 */
export function nextRetryAt(attempt: number, now: number): number | null {
  if (attempt >= WEBHOOK_MAX_ATTEMPTS) return null;
  return now + 30_000 * 4 ** (attempt - 1);
}

export function newWebhookSecret(): string {
  const b = crypto.getRandomValues(new Uint8Array(24));
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return 'whsec_' + btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface WebhookPayload { id: string; type: WebhookEvent; created: string; data: Record<string, unknown> }
export function webhookPayload(id: string, type: WebhookEvent, created: string, data: Record<string, unknown>): string {
  return JSON.stringify({ id, type, created, data } satisfies WebhookPayload);
}
