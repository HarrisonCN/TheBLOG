/**
 * L15 社交基础的纯函数（Worker 与前端演示 mock 共用同一份逻辑；web/src/social-core.ts 为同内容副本）。
 * 不依赖 D1 / DOM：用户名与资料校验、游标编解码、通知去重键 / 聚合规则、收藏合并去重。
 */

export const USERNAME_RE = /^[a-z0-9](?:[a-z0-9_]{1,18})[a-z0-9]$/;
/** 保留用户名：路由 / 系统词，避免冒充。 */
export const RESERVED_USERNAMES = new Set(['admin', 'administrator', 'root', 'system', 'winston', 'theblog', 'api', 'me', 'settings', 'notifications', 'support', 'help', 'about', 'null', 'undefined', 'login', 'logout', 'official', 'mod', 'moderator']);

export type Visibility = 'public' | 'members' | 'private';
export type NotificationType = 'follow' | 'reply' | 'mention' | 'bookmark' | 'system';
export type BookmarkKind = 'post' | 'photo' | 'essay';
export type RelationKind = 'block' | 'mute';
export const NOTIFICATION_TYPES: readonly NotificationType[] = ['follow', 'reply', 'mention', 'bookmark', 'system'];
export const BOOKMARK_KINDS: readonly BookmarkKind[] = ['post', 'photo', 'essay'];
export const NOTIFICATION_FILTERS = ['all', 'unread', 'follow', 'reply', 'mention', 'bookmark'] as const;
export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

export interface SocialLink { label: string; url: string }
export interface ProfileInput {
  username?: string;
  nickname?: string;
  avatarUrl?: string;
  coverUrl?: string;
  bio?: string;
  website?: string;
  links?: SocialLink[];
  visibility?: Visibility;
  showFollows?: boolean;
  discoverable?: boolean;
}

export type Check<T> = { ok: true; value: T } | { ok: false; path: string; error: string };

/** 用户名：3–20 位小写字母 / 数字 / 下划线，首尾不能是下划线，不能连续下划线，不能是保留词。 */
export function checkUsername(raw: unknown): Check<string> {
  if (typeof raw !== 'string') return { ok: false, path: 'username', error: '用户名必填' };
  const u = raw.trim().toLowerCase();
  if (u.length < 3 || u.length > 20) return { ok: false, path: 'username', error: '用户名 3–20 个字符' };
  if (!USERNAME_RE.test(u) || u.includes('__')) return { ok: false, path: 'username', error: '只能用小写字母、数字和下划线，首尾不能是下划线' };
  if (RESERVED_USERNAMES.has(u)) return { ok: false, path: 'username', error: '这个用户名被保留了' };
  return { ok: true, value: u };
}

const SAFE_HTTPS = /^https:\/\/[^\s<>"'`]+$/i;
const SAFE_IMAGE = /^(https:\/\/[^\s<>"'`]+|\/api\/images\/[A-Za-z0-9/_.-]+|\/[A-Za-z0-9/_.-]+\.(?:png|jpe?g|webp|avif|svg))$/i;
const str = (v: unknown, max: number, path: string): Check<string> => {
  if (v === undefined || v === null) return { ok: true, value: '' };
  if (typeof v !== 'string') return { ok: false, path, error: '必须是文字' };
  const s = v.trim();
  if (s.length > max) return { ok: false, path, error: `最多 ${max} 个字符` };
  // 控制字符一律拒绝
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)) return { ok: false, path, error: '含有不可见控制字符' };
  return { ok: true, value: s };
};

/** 资料校验：只返回出现的字段（PATCH 语义）。所有链接只允许 https；头像 / 封面允许站内图片路径。 */
export function checkProfile(input: unknown): Check<ProfileInput> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, path: '', error: '请求体必须是对象' };
  const o = input as Record<string, unknown>;
  const out: ProfileInput = {};
  if ('username' in o) {
    const u = checkUsername(o.username);
    if (!u.ok) return u;
    out.username = u.value;
  }
  if ('nickname' in o) {
    const n = str(o.nickname, 40, 'nickname');
    if (!n.ok) return n;
    if (!n.value) return { ok: false, path: 'nickname', error: '昵称不能为空' };
    out.nickname = n.value;
  }
  for (const k of ['avatarUrl', 'coverUrl'] as const) {
    if (!(k in o)) continue;
    const v = str(o[k], 300, k);
    if (!v.ok) return v;
    if (v.value && !SAFE_IMAGE.test(v.value)) return { ok: false, path: k, error: '图片地址必须是 https 或站内图片' };
    out[k] = v.value;
  }
  if ('bio' in o) {
    const v = str(o.bio, 160, 'bio');
    if (!v.ok) return v;
    out.bio = v.value;
  }
  if ('website' in o) {
    const v = str(o.website, 200, 'website');
    if (!v.ok) return v;
    if (v.value && !SAFE_HTTPS.test(v.value)) return { ok: false, path: 'website', error: '网站必须以 https:// 开头' };
    out.website = v.value;
  }
  if ('links' in o) {
    if (!Array.isArray(o.links)) return { ok: false, path: 'links', error: '社交链接必须是数组' };
    if (o.links.length > 5) return { ok: false, path: 'links', error: '最多 5 个社交链接' };
    const links: SocialLink[] = [];
    for (let i = 0; i < o.links.length; i++) {
      const l = o.links[i] as Record<string, unknown> | null;
      const label = str(l?.label, 24, `links.${i}.label`);
      if (!label.ok) return label;
      const url = str(l?.url, 200, `links.${i}.url`);
      if (!url.ok) return url;
      if (!url.value) continue;
      if (!SAFE_HTTPS.test(url.value)) return { ok: false, path: `links.${i}.url`, error: '链接必须以 https:// 开头' };
      links.push({ label: label.value || hostOf(url.value), url: url.value });
    }
    out.links = links;
  }
  if ('visibility' in o) {
    if (o.visibility !== 'public' && o.visibility !== 'members' && o.visibility !== 'private') return { ok: false, path: 'visibility', error: 'visibility 只能是 public / members / private' };
    out.visibility = o.visibility;
  }
  for (const k of ['showFollows', 'discoverable'] as const) {
    if (!(k in o)) continue;
    if (typeof o[k] !== 'boolean') return { ok: false, path: k, error: '必须是 true / false' };
    out[k] = o[k] as boolean;
  }
  return { ok: true, value: out };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 24);
  }
}

/** 解析存库的 links JSON；坏数据 / 非 https 一律丢弃。 */
export function parseLinks(raw: string | null | undefined): SocialLink[] {
  try {
    const arr = JSON.parse(raw ?? '[]');
    if (!Array.isArray(arr)) return [];
    return arr.filter((l) => l && typeof l.url === 'string' && SAFE_HTTPS.test(l.url) && typeof l.label === 'string').slice(0, 5).map((l) => ({ label: String(l.label).slice(0, 24), url: String(l.url).slice(0, 200) }));
  } catch {
    return [];
  }
}

/** 默认用户名：只由会员 id 推出（绝不从邮箱推导，避免泄露邮箱前缀）。 */
export const defaultUsername = (memberId: number) => `friend${String(memberId).padStart(3, '0')}`;

// ============================================================ 游标（按 (created_at, id) 倒序）
export interface SocialCursor { t: string; id: number }
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
export function encodeCursor(c: SocialCursor): string {
  return b64(`${c.t}|${c.id}`);
}
export function decodeCursor(raw: string | null | undefined): SocialCursor | null | 'bad' {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw.length > 120 || !/^[A-Za-z0-9_-]+$/.test(raw)) return 'bad';
  try {
    const [t, id] = unb64(raw).split('|');
    const n = Number(id);
    if (!t || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(t) || !Number.isInteger(n) || n < 0) return 'bad';
    return { t, id: n };
  } catch {
    return 'bad';
  }
}
export function clampLimit(raw: string | null | undefined, def = 20, max = 50): number | 'bad' {
  if (raw === null || raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) return 'bad';
  return n;
}

// ============================================================ 通知：去重键与聚合
/**
 * dedupe_key 决定幂等与聚合：
 *  - follow:<actor>              同一人反复关注 / 取关 / 再关注 → 永远只有一条
 *  - reply:<slug>:<thread>       同一楼的回复 → 未读时聚合（count+1，最新回复者覆盖 actor）
 *  - mention:<kind>:<ref>        同一处内容的提及只算一次
 *  - bookmark:<kind>:<ref>       同一作品被收藏 → 未读时聚合
 */
export function notificationKey(type: NotificationType, p: { actorId?: number | null; objectKind?: string; objectRef?: string; thread?: string | number }): string {
  switch (type) {
    case 'follow':
      return `follow:${p.actorId ?? 0}`;
    case 'reply':
      return `reply:${p.objectRef ?? ''}:${p.thread ?? ''}`;
    case 'mention':
      return `mention:${p.objectKind ?? ''}:${p.objectRef ?? ''}`;
    case 'bookmark':
      return `bookmark:${p.objectKind ?? ''}:${p.objectRef ?? ''}`;
    default:
      return `system:${p.objectRef ?? ''}`;
  }
}
/** 已存在同键通知时：follow / mention 不变（幂等）；reply / bookmark 在未读时聚合计数，已读则重新置为未读并从 1 开始。 */
export function aggregates(type: NotificationType): boolean {
  return type === 'reply' || type === 'bookmark';
}

/** 正文里的 @用户名（去重、最多 5 个），给 mention 通知用。 */
export function extractMentions(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(^|[^A-Za-z0-9_@/])@([a-z0-9][a-z0-9_]{1,18}[a-z0-9])\b/gi)) {
    const u = m[2]!.toLowerCase();
    if (checkUsername(u).ok) out.add(u);
    if (out.size >= 5) break;
  }
  return [...out];
}

// ============================================================ 收藏
export interface BookmarkInput { kind: BookmarkKind; ref: string; title: string }
export function checkBookmark(input: unknown): Check<BookmarkInput> {
  const o = (input ?? {}) as Record<string, unknown>;
  const kind = (o.kind ?? 'post') as BookmarkKind;
  if (!BOOKMARK_KINDS.includes(kind)) return { ok: false, path: 'kind', error: 'kind 只能是 post / photo / essay' };
  if (typeof o.ref !== 'string' || !/^[a-z0-9][a-z0-9-]{0,159}$/i.test(o.ref.trim())) return { ok: false, path: 'ref', error: 'ref 格式不正确' };
  const title = str(o.title, 160, 'title');
  if (!title.ok) return title;
  return { ok: true, value: { kind, ref: o.ref.trim(), title: title.value } };
}
/** 合并本地收藏：校验每一项、按 (kind, ref) 去重、上限 200；返回合法项与丢弃数。 */
export function mergeBookmarkInputs(items: unknown, max = 200): { items: BookmarkInput[]; rejected: number } {
  if (!Array.isArray(items)) return { items: [], rejected: 0 };
  const seen = new Set<string>();
  const out: BookmarkInput[] = [];
  let rejected = 0;
  for (const it of items.slice(0, max)) {
    const c = checkBookmark(it);
    if (!c.ok) {
      rejected++;
      continue;
    }
    const k = `${c.value.kind}:${c.value.ref}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c.value);
  }
  return { items: out, rejected: rejected + Math.max(0, items.length - max) };
}

/** 资料可见性：对方拉黑了我 → 完全不可见（像不存在一样）；我拉黑了对方 → 只显示基础身份 + 解除拉黑；private 只本人；members 需登录。 */
export function canViewProfile(o: { visibility: Visibility; isSelf: boolean; viewerLoggedIn: boolean; blockedByTarget: boolean; viewerBlocked: boolean }): 'full' | 'restricted' | 'hidden' {
  if (o.isSelf) return 'full';
  if (o.blockedByTarget) return 'hidden';
  if (o.viewerBlocked) return 'restricted';
  if (o.visibility === 'public') return 'full';
  if (o.visibility === 'members') return o.viewerLoggedIn ? 'full' : 'restricted';
  return 'restricted';
}
