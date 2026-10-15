/**
 * L19 私信与实时交流的纯规则（Worker 与演示 mock 共用同一份：web/src/dm-core.ts 与本文件保持一致）。
 * 不依赖 D1 / DOM：谁能发起会话、消息请求、发送限额、撤回窗口、在线状态可见性、活动聊天室保留策略、游标。
 */

export const DM_POLICIES = ['everyone', 'followers', 'mutuals', 'nobody'] as const;
export type DmPolicy = (typeof DM_POLICIES)[number];
export const DM_POLICY_LABEL: Record<DmPolicy, string> = {
  everyone: '所有登录的好朋友（非互关需先通过消息请求）',
  followers: '关注我的人（非互关需先通过消息请求）',
  mutuals: '只有互相关注的人',
  nobody: '不接受新的私信',
};

export type ConvStatus = 'active' | 'request' | 'declined';
export type ConvKind = 'dm' | 'room';
export type RoomRetention = 'retained' | 'ephemeral';

export const MAX_BODY = 2000;
/** 发送后多久内可以「撤回（双方都删除）」 */
export const RECALL_WINDOW_MS = 10 * 60 * 1000;
/** 消息请求被接受前，发起人最多能发几条 */
export const REQUEST_PENDING_MAX = 3;
/** 被婉拒后多少天内不能再次向同一人发起请求 */
export const DECLINE_COOLDOWN_DAYS = 30;
/** 注册不满 N 天算新账号：更严格的限额 */
export const NEW_ACCOUNT_DAYS = 3;
export const PAGE_DEFAULT = 30;
export const PAGE_MAX = 100;
/** 实时连接不可用时的轮询间隔（毫秒）：前台 / 后台标签页 */
export const POLL_MS = 4000;
export const POLL_HIDDEN_MS = 20000;
/** 活动聊天室：临时房间的默认保留小时数、上限 */
export const ROOM_TTL_DEFAULT = 24;
export const ROOM_TTL_MAX = 24 * 14;
export const ROOM_MAX_BODY = 500;
/** WebSocket 票据有效期（秒） */
export const TICKET_TTL = 60;

export interface Limits { msgsPerMin: number; requestsPerDay: number; roomPerMin: number }
export function limitsFor(joinedAt: string, now: number): Limits {
  const isNew = isNewAccount(joinedAt, now);
  return isNew ? { msgsPerMin: 10, requestsPerDay: 3, roomPerMin: 5 } : { msgsPerMin: 30, requestsPerDay: 20, roomPerMin: 12 };
}
export function isNewAccount(joinedAt: string, now: number): boolean {
  const t = Date.parse(joinedAt);
  return !Number.isFinite(t) || now - t < NEW_ACCOUNT_DAYS * 86400_000;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g;
export function checkBody(raw: unknown, max = MAX_BODY): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof raw !== 'string') return { ok: false, message: '消息内容不能为空' };
  const value = raw.replace(/\r\n?/g, '\n').replace(CONTROL, '').trim();
  if (!value) return { ok: false, message: '消息内容不能为空' };
  if ([...value].length > max) return { ok: false, message: `消息最多 ${max} 个字` };
  return { ok: true, value };
}
export const CLIENT_ID_RE = /^[A-Za-z0-9_-]{6,40}$/;
export function checkClientId(raw: unknown): string | null {
  return typeof raw === 'string' && CLIENT_ID_RE.test(raw) ? raw : null;
}
export function checkPolicy(raw: unknown): DmPolicy | null {
  return typeof raw === 'string' && (DM_POLICIES as readonly string[]).includes(raw) ? (raw as DmPolicy) : null;
}

export interface Rel { following: boolean; followedBy: boolean; blocked: boolean; blockedBy: boolean }
export type StartDecision =
  | { ok: true; kind: 'direct' | 'request' }
  | { ok: false; status: number; code: string; message: string };

/**
 * 我（me）想给对方发私信：互相关注 → 直接会话；其他人 → 消息请求（要对方的隐私开关允许）。
 * 拉黑（任一方向）一律拒绝；对方拉黑我时返回和「用户不存在」一样的 404，不泄露拉黑关系。
 */
export function decideStart(o: { self: boolean; rel: Rel; policy: DmPolicy; declinedUntil?: number | null; now: number }): StartDecision {
  if (o.self) return { ok: false, status: 400, code: 'self', message: '不能给自己发私信' };
  if (o.rel.blockedBy) return { ok: false, status: 404, code: 'not_found', message: '没有这个用户' };
  if (o.rel.blocked) return { ok: false, status: 403, code: 'blocked', message: '你已拉黑对方，先解除拉黑' };
  if (o.policy === 'nobody') return { ok: false, status: 403, code: 'dm_closed', message: '对方目前不接受新的私信' };
  const mutual = o.rel.following && o.rel.followedBy;
  if (mutual) return { ok: true, kind: 'direct' };
  if (o.policy === 'mutuals') return { ok: false, status: 403, code: 'dm_mutuals_only', message: '对方只接受互相关注的人私信' };
  if (o.policy === 'followers' && !o.rel.following) return { ok: false, status: 403, code: 'dm_followers_only', message: '对方只接受关注 TA 的人发起私信请求' };
  if (o.declinedUntil && o.declinedUntil > o.now) return { ok: false, status: 429, code: 'request_cooldown', message: '对方婉拒了你的消息请求，暂时不能再次发起' };
  return { ok: true, kind: 'request' };
}

/** 在已有会话里发消息是否允许。 */
export function canSend(o: { kind: ConvKind; status: ConvStatus; isRequester: boolean; myCountWhilePending: number; blockedEither: boolean; closed?: boolean }): { ok: true } | { ok: false; status: number; code: string; message: string } {
  if (o.blockedEither) return { ok: false, status: 403, code: 'blocked', message: '你们之间存在拉黑关系，无法发送' };
  if (o.kind === 'room') return o.closed ? { ok: false, status: 403, code: 'room_closed', message: '聊天室已关闭' } : { ok: true };
  if (o.status === 'declined') return { ok: false, status: 403, code: 'request_declined', message: '对方婉拒了这个消息请求' };
  if (o.status === 'request') {
    if (!o.isRequester) return { ok: false, status: 409, code: 'request_pending', message: '先接受消息请求再回复' };
    if (o.myCountWhilePending >= REQUEST_PENDING_MAX) return { ok: false, status: 429, code: 'request_pending_limit', message: `对方接受请求前最多发送 ${REQUEST_PENDING_MAX} 条` };
  }
  return { ok: true };
}

export function canRecall(o: { isSender: boolean; createdAt: string; now: number; recalled: boolean }): { ok: true } | { ok: false; status: number; code: string; message: string } {
  if (!o.isSender) return { ok: false, status: 403, code: 'forbidden', message: '只能撤回自己发送的消息' };
  if (o.recalled) return { ok: false, status: 409, code: 'already_recalled', message: '消息已撤回' };
  if (o.now - Date.parse(o.createdAt) > RECALL_WINDOW_MS) return { ok: false, status: 409, code: 'recall_expired', message: `只能撤回 ${RECALL_WINDOW_MS / 60000} 分钟内的消息` };
  return { ok: true };
}

/** 在线状态：对方开启了「显示在线状态」、互相没有拉黑、并且是会话对象或互相关注。 */
export function canSeePresence(o: { self: boolean; showPresence: boolean; blockedEither: boolean; related: boolean }): boolean {
  if (o.self) return true;
  return o.showPresence && !o.blockedEither && o.related;
}

/** 已读回执：双方都开启时才显示「已读」（关闭的一方既不发送也看不到对方的回执）。 */
export function receiptsVisible(mine: boolean, theirs: boolean): boolean {
  return mine && theirs;
}

/** 活动聊天室：临时房间只显示 ttl 小时内的消息。 */
export function roomMessageVisible(o: { retention: RoomRetention; ttlHours: number; createdAt: string; now: number }): boolean {
  if (o.retention === 'retained') return true;
  return o.now - Date.parse(o.createdAt) <= Math.max(1, o.ttlHours) * 3600_000;
}
export function checkRoomConfig(raw: unknown): { ok: true; value: { enabled: boolean; retention: RoomRetention; ttlHours: number; closed: boolean } } | { ok: false; message: string } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const retention = o.retention === undefined ? 'ephemeral' : o.retention;
  if (retention !== 'retained' && retention !== 'ephemeral') return { ok: false, message: 'retention 只能是 retained / ephemeral' };
  const ttl = o.ttlHours === undefined ? ROOM_TTL_DEFAULT : Number(o.ttlHours);
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > ROOM_TTL_MAX) return { ok: false, message: `ttlHours 取 1–${ROOM_TTL_MAX}` };
  return { ok: true, value: { enabled: o.enabled === undefined ? true : !!o.enabled, retention, ttlHours: ttl, closed: !!o.closed } };
}

export function clampPage(raw: string | null | undefined): number {
  const n = Number(raw ?? PAGE_DEFAULT);
  return Number.isFinite(n) ? Math.min(PAGE_MAX, Math.max(1, Math.floor(n))) : PAGE_DEFAULT;
}
export function parseId(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** 会话列表游标：按 last_at DESC, id DESC。 */
export function encodeConvCursor(lastAt: string, id: number): string {
  return btoa(`${lastAt}|${id}`).replace(/=+$/, '');
}
export function decodeConvCursor(raw: string | null | undefined): { lastAt: string; id: number } | null {
  if (!raw) return null;
  try {
    const [lastAt, id] = atob(raw).split('|');
    const n = Number(id);
    return lastAt && Number.isSafeInteger(n) ? { lastAt, id: n } : null;
  } catch {
    return null;
  }
}

/** 屏幕阅读器播报（aria-live）的文字：不朗读整条长消息。 */
export function announceText(sender: string, body: string): string {
  const s = [...body.replace(/\s+/g, ' ')];
  return `${sender}：${s.slice(0, 80).join('')}${s.length > 80 ? '…' : ''}`;
}

/** 实时事件（服务器 → 浏览器）。WebSocket 只推送，不接收写操作：发送一律走 HTTP，D1 是唯一事实来源。 */
export type DmEvent =
  | { t: 'msg'; seq: number; conversationId: number; message: DmMessage }
  | { t: 'recall'; seq: number; conversationId: number; messageId: number }
  | { t: 'remove'; seq: number; conversationId: number; messageId: number }
  | { t: 'read'; seq: number; conversationId: number; username: string; lastReadId: number }
  | { t: 'conv'; seq: number; conversationId: number; status: ConvStatus | 'hidden' }
  | { t: 'presence'; username: string; online: boolean }
  | { t: 'hello'; seq: number };

export interface DmUser { username: string; nickname: string; avatarUrl: string }
export interface DmMessage {
  id: number;
  conversationId: number;
  sender: DmUser | null;
  mine: boolean;
  body: string;
  clientId: string | null;
  createdAt: string;
  recalled: boolean;
  removed: boolean;
  /** L30：图片 / 语音附件（没有就是 null） */
  attachment: DmAttachment | null;
}
export interface DmConversation {
  id: number;
  kind: ConvKind;
  status: ConvStatus;
  peer: DmUser | null;
  title: string;
  requestedByMe: boolean;
  unread: number;
  lastMessage: { id: number; excerpt: string; createdAt: string; mine: boolean; recalled: boolean } | null;
  lastAt: string;
  peerLastReadId: number | null;
  muted: boolean;
}
export interface DmSettings { policy: DmPolicy; readReceipts: boolean; showPresence: boolean }
export const DM_SETTINGS_DEFAULT: DmSettings = { policy: 'everyone', readReceipts: true, showPresence: true };

export function excerpt(body: string, n = 60): string {
  const s = [...body.replace(/\s+/g, ' ').trim()];
  return s.slice(0, n).join('') + (s.length > n ? '…' : '');
}

// ============================================================ L30 实时社交 2.0：图片 / 语音、搜索、重连退避
export const DM_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const DM_VOICE_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac'] as const;
export const DM_IMAGE_MAX = 5 * 1024 * 1024;
export const DM_VOICE_MAX = 2 * 1024 * 1024;
export const DM_VOICE_MAX_MS = 120_000;
export const ALT_MAX = 200;
/** 每人每小时最多上传的私信媒体数 */
export const DM_MEDIA_PER_HOUR = 30;
export const SEARCH_MAX_Q = 50;
export const SEARCH_LIMIT = 50;

export interface DmAttachment {
  kind: 'image' | 'voice';
  /** 真实站点：/api/social/dm/media/…（只有会话成员能取，浏览器带登录令牌拉取后显示）；演示站：data URL */
  url: string;
  mime: string;
  size: number;
  /** 图片必填的替代文字；语音可以为空 */
  alt: string;
  durationMs: number;
  width: number;
  height: number;
}
export type MediaInput = { kind: unknown; mime: unknown; size: unknown; alt?: unknown; durationMs?: unknown; width?: unknown; height?: unknown };
export type MediaCheck =
  | { ok: true; value: Omit<DmAttachment, 'url'> }
  | { ok: false; status: number; code: string; message: string };

const baseMime = (m: unknown) => String(m ?? '').split(';')[0]!.trim().toLowerCase();
const int = (v: unknown) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : NaN);

/** 私信媒体的共享校验：图片必须写替代文字；语音 1 秒 – 2 分钟。 */
export function checkMedia(o: MediaInput): MediaCheck {
  const no = (code: string, message: string, status = 400): MediaCheck => ({ ok: false, status, code, message });
  const kind = o.kind;
  if (kind !== 'image' && kind !== 'voice') return no('validation_error', '只支持图片和语音');
  const mime = baseMime(o.mime);
  const size = int(o.size);
  if (!(size > 0)) return no('validation_error', '文件为空');
  const alt = String(o.alt ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if ([...alt].length > ALT_MAX) return no('validation_error', `替代文字最多 ${ALT_MAX} 字`);
  if (kind === 'image') {
    if (!(DM_IMAGE_TYPES as readonly string[]).includes(mime)) return no('unsupported_type', '图片只支持 JPEG / PNG / WebP', 415);
    if (size > DM_IMAGE_MAX) return no('too_large', '图片太大（最大 5 MB）', 413);
    if (!alt) return no('alt_required', '请为图片写一句替代文字（给看不见图片的朋友）');
    const width = Math.max(0, int(o.width) || 0), height = Math.max(0, int(o.height) || 0);
    return { ok: true, value: { kind, mime, size, alt, durationMs: 0, width: Math.min(width, 20000), height: Math.min(height, 20000) } };
  }
  if (!(DM_VOICE_TYPES as readonly string[]).includes(mime)) return no('unsupported_type', '不支持的录音格式', 415);
  if (size > DM_VOICE_MAX) return no('too_large', '录音太大（最大 2 MB）', 413);
  const durationMs = int(o.durationMs);
  if (!(durationMs >= 1000 && durationMs <= DM_VOICE_MAX_MS)) return no('validation_error', '录音时长需在 1 秒到 2 分钟之间');
  return { ok: true, value: { kind, mime, size, alt, durationMs, width: 0, height: 0 } };
}
/** 0:12、1:05 */
export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function attachmentLabel(a: Pick<DmAttachment, 'kind' | 'alt' | 'durationMs'>): string {
  return a.kind === 'image' ? `[图片]${a.alt ? ` ${a.alt}` : ''}` : `[语音 ${fmtDuration(a.durationMs)}]`;
}
/** 会话列表里的最后一条消息摘要：有附件时带上 [图片] / [语音] */
export function excerptOf(m: { body: string; attachment: Pick<DmAttachment, 'kind' | 'alt' | 'durationMs'> | null }, n = 60): string {
  if (!m.attachment) return excerpt(m.body, n);
  if (m.attachment.kind === 'voice') return excerpt(m.body ? `[语音 ${fmtDuration(m.attachment.durationMs)}] ${m.body}` : attachmentLabel(m.attachment), n);
  return excerpt(m.body ? `[图片] ${m.body}` : attachmentLabel(m.attachment), n);
}
/** R2 键：dm/<会话>/<上传者>/<随机> —— 发送时校验键属于这个会话和这个人 */
export const mediaKey = (conv: number, member: number, rand: string) => `dm/${conv}/${member}/${rand}`;
export function parseMediaKey(key: string): { conv: number; member: number } | null {
  const m = /^dm\/(\d{1,12})\/(\d{1,12})\/([A-Za-z0-9-]{8,64})$/.exec(key);
  return m ? { conv: Number(m[1]), member: Number(m[2]) } : null;
}
/** 断线重连 / 发送失败重试的退避：1s、2s、4s… 最多 30s */
export const backoffMs = (attempt: number) => Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));

const norm = (s: string) => s.normalize('NFKC').toLowerCase();
/** 消息搜索（服务端已按权限取出候选，这里做同一套匹配）：不区分大小写 / 全半角，含图片替代文字，不含撤回 / 移除；新消息在前。 */
export function searchMessages<M extends Pick<DmMessage, 'id' | 'body' | 'recalled' | 'removed' | 'attachment'>>(items: M[], q: string, limit = SEARCH_LIMIT): { message: M; field: 'body' | 'alt' }[] {
  const nq = norm(q.trim());
  if (!nq || [...nq].length > SEARCH_MAX_Q) return [];
  const out: { message: M; field: 'body' | 'alt' }[] = [];
  for (const m of [...items].sort((a, b) => b.id - a.id)) {
    if (m.recalled || m.removed) continue;
    if (norm(m.body).includes(nq)) out.push({ message: m, field: 'body' });
    else if (m.attachment?.alt && norm(m.attachment.alt).includes(nq)) out.push({ message: m, field: 'alt' });
    if (out.length >= limit) break;
  }
  return out;
}
const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** 把命中的部分包上 <mark>（先转义；按 NFKC + 小写比较，长度不变时才高亮原文位置） */
export function highlightHits(text: string, q: string): string {
  const nq = norm(q.trim());
  const nt = norm(text);
  if (!nq || nt.length !== text.length) return escHtml(text);
  let out = '', i = 0;
  for (let j = nt.indexOf(nq); j !== -1; j = nt.indexOf(nq, j + nq.length)) {
    out += escHtml(text.slice(i, j)) + `<mark>${escHtml(text.slice(j, j + nq.length))}</mark>`;
    i = j + nq.length;
  }
  return out + escHtml(text.slice(i));
}
/** 有附件时正文可以为空 */
export function checkBodyWith(raw: unknown, hasAttachment: boolean): { ok: true; value: string } | { ok: false; message: string } {
  if (hasAttachment && (raw == null || (typeof raw === 'string' && !raw.replace(CONTROL, '').trim()))) return { ok: true, value: '' };
  return checkBody(raw);
}
