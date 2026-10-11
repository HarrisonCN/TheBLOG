/**
 * L16 用户内容发布（COMMUNITY PUBLISHING）的纯函数：Worker 与前端演示 mock 共用（web/src/ugc-core.ts 为同内容副本，改动需同步；测试会比对）。
 * 不依赖 D1 / DOM：投稿校验（按类型）、可见范围判定、反垃圾（链接数 / 重复检测指纹）、信誉与初始审核、回应 / 举报 / 审核动作枚举、动态流游标。
 *
 * 删除的三种状态严格区分：
 *  - 软删除（作者删除）：deleted_at 有值，任何人（含作者）都读不到，管理员审核队列可见、可审计；
 *  - 审核隐藏（管理员）：mod_state = 'hidden'，公开读取一律 404，作者本人能看到「已被隐藏」提示，可恢复；
 *  - 硬删除（管理员 purge / 账号注销）：行被删除，媒体 / 评论 / 回应 / 提及随外键级联删除，审核日志保留。
 */

export const WORK_TYPES = ['short', 'article', 'photo', 'album'] as const;
export type WorkType = (typeof WORK_TYPES)[number];
export const WORK_VISIBILITIES = ['public', 'followers', 'private'] as const;
export type WorkVisibility = (typeof WORK_VISIBILITIES)[number];
export type WorkStatus = 'draft' | 'pending' | 'published';
export type ModState = 'ok' | 'hidden';
export const WORK_TYPE_LABEL: Record<WorkType, string> = { short: '短动态', article: '长文', photo: '摄影作品', album: '影集' };
export const VISIBILITY_LABEL: Record<WorkVisibility, string> = { public: '公开', followers: '仅关注者', private: '仅自己' };

/** 用户内容的回应：固定集合 + (post, member, kind) 唯一约束。 */
export const WORK_REACTIONS = ['like', 'love', 'fire', 'clap', 'wow'] as const;
export type WorkReaction = (typeof WORK_REACTIONS)[number];
export const WORK_REACTION_EMOJI: Record<WorkReaction, string> = { like: '👍', love: '❤️', fire: '🔥', clap: '👏', wow: '😮' };

export const REPORT_REASONS = ['spam', 'abuse', 'nsfw', 'copyright', 'privacy', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_LABEL: Record<ReportReason, string> = { spam: '垃圾广告', abuse: '辱骂骚扰', nsfw: '不适宜内容', copyright: '侵犯版权', privacy: '泄露隐私', other: '其他' };
export const REPORT_TARGETS = ['work', 'comment', 'user'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];
export const MOD_ACTIONS = ['approve', 'hide', 'restore', 'purge', 'ban', 'unban', 'dismiss'] as const;
export type ModAction = (typeof MOD_ACTIONS)[number];

/** 社区规则的默认值（管理员可在后台改）：新会员前 N 条内容先审核、每条内容最多几个链接。 */
export interface CommunityRules { reviewFirstN: number; maxLinks: number }
export const DEFAULT_RULES: CommunityRules = { reviewFirstN: 2, maxLinks: 3 };
export function checkRules(input: unknown, cur: CommunityRules = DEFAULT_RULES): Check<CommunityRules> {
  const o = (input ?? {}) as Record<string, unknown>;
  const out = { ...cur };
  for (const [k, max] of [['reviewFirstN', 50], ['maxLinks', 20]] as const) {
    if (!(k in o)) continue;
    const n = o[k];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > max) return { ok: false, path: k, error: `${k} 必须是 0–${max} 的整数` };
    out[k] = n;
  }
  return { ok: true, value: out };
}

export type Check<T> = { ok: true; value: T } | { ok: false; path: string; error: string };

export interface WorkParams { camera?: string; lens?: string; focal?: string; aperture?: string; shutter?: string; iso?: string; takenAt?: string; place?: string }
export const PARAM_KEYS: readonly (keyof WorkParams)[] = ['camera', 'lens', 'focal', 'aperture', 'shutter', 'iso', 'takenAt', 'place'];
export const PARAM_LABEL: Record<keyof WorkParams, string> = { camera: '机身', lens: '镜头', focal: '焦距', aperture: '光圈', shutter: '快门', iso: 'ISO', takenAt: '拍摄时间', place: '地点' };
export interface WorkMediaInput { url: string; alt: string; width: number; height: number }
export interface WorkInput {
  type: WorkType;
  title: string;
  body: string;
  caption: string;
  notes: string;
  params: WorkParams;
  media: WorkMediaInput[];
  visibility: WorkVisibility;
}

/** 每种类型的编辑器约束（前端编辑器模式也读这里，保证两端一致）。 */
export const TYPE_RULES: Record<WorkType, { title: [number, number]; body: [number, number]; media: [number, number]; caption: number; notes: number; params: boolean }> = {
  short: { title: [0, 0], body: [1, 500], media: [0, 4], caption: 0, notes: 0, params: false },
  article: { title: [1, 80], body: [1, 20000], media: [0, 12], caption: 0, notes: 0, params: false },
  photo: { title: [0, 60], body: [0, 2000], media: [1, 1], caption: 300, notes: 4000, params: true },
  album: { title: [1, 60], body: [0, 2000], media: [2, 30], caption: 300, notes: 4000, params: true },
};

const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const SITE_IMAGE = /^\/api\/images\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(?:png|jpg|webp|gif|avif)$/;
const HTTPS_IMAGE = /^https:\/\/[^\s<>"'`()]+$/i;
const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]+=*$/;
/** 演示站的静态示例图（同源路径）。 */
const LOCAL_IMAGE = /^\/[A-Za-z0-9/_.-]{1,200}\.(?:png|jpe?g|webp|avif)$/;

function text(v: unknown, max: number, path: string, min = 0): Check<string> {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') return { ok: false, path, error: '必须是文字' };
  const s = v.replace(/\r\n?/g, '\n').trim();
  if (CTRL.test(s)) return { ok: false, path, error: '含有不可见控制字符' };
  if (s.length > max) return { ok: false, path, error: max === 0 ? '这种类型不需要这一项' : `最多 ${max} 个字符` };
  if (s.length < min) return { ok: false, path, error: min === 1 ? '不能为空' : `至少 ${min} 个字符` };
  return { ok: true, value: s };
}

/**
 * 投稿校验（创建 / 编辑同一套）：按类型检查标题 / 正文 / 图片数量；所有图片必须写替代文字（alt）；
 * 图片地址只接受站内上传（/api/images/…）或 https（演示站额外允许浏览器内的 data:image 与同源示例图）。
 */
export function checkWork(input: unknown, opts: { allowDataUrl?: boolean } = {}): Check<WorkInput> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, path: '', error: '请求体必须是对象' };
  const o = input as Record<string, unknown>;
  const type = o.type as WorkType;
  if (!WORK_TYPES.includes(type)) return { ok: false, path: 'type', error: 'type 只能是 short / article / photo / album' };
  const r = TYPE_RULES[type];
  const visibility = (o.visibility ?? 'public') as WorkVisibility;
  if (!WORK_VISIBILITIES.includes(visibility)) return { ok: false, path: 'visibility', error: 'visibility 只能是 public / followers / private' };
  const title = text(o.title, r.title[1], 'title', r.title[0]);
  if (!title.ok) return title;
  const body = text(o.body, r.body[1], 'body', r.body[0]);
  if (!body.ok) return body;
  const caption = text(o.caption, r.caption, 'caption');
  if (!caption.ok) return caption;
  const notes = text(o.notes, r.notes, 'notes');
  if (!notes.ok) return notes;
  const params: WorkParams = {};
  if (o.params !== undefined && o.params !== null) {
    if (typeof o.params !== 'object' || Array.isArray(o.params)) return { ok: false, path: 'params', error: 'params 必须是对象' };
    const p = o.params as Record<string, unknown>;
    for (const k of Object.keys(p)) {
      if (!PARAM_KEYS.includes(k as keyof WorkParams)) return { ok: false, path: `params.${k}`, error: '未知的参数' };
      if (!r.params && p[k]) return { ok: false, path: `params.${k}`, error: '这种类型不需要拍摄参数' };
      const v = text(p[k], 60, `params.${k}`);
      if (!v.ok) return v;
      if (v.value) params[k as keyof WorkParams] = v.value;
    }
  }
  const rawMedia = o.media ?? [];
  if (!Array.isArray(rawMedia)) return { ok: false, path: 'media', error: 'media 必须是数组' };
  if (rawMedia.length < r.media[0] || rawMedia.length > r.media[1]) {
    const [a, b] = r.media;
    return { ok: false, path: 'media', error: a === b ? `${WORK_TYPE_LABEL[type]}需要正好 ${a} 张图片` : b === 0 ? '这种类型不能带图片' : `${WORK_TYPE_LABEL[type]}需要 ${a}–${b} 张图片` };
  }
  const media: WorkMediaInput[] = [];
  for (let i = 0; i < rawMedia.length; i++) {
    const m = rawMedia[i] as Record<string, unknown> | null;
    if (!m || typeof m !== 'object') return { ok: false, path: `media.${i}`, error: '图片项格式不正确' };
    const url = typeof m.url === 'string' ? m.url.trim() : '';
    const okUrl = SITE_IMAGE.test(url) || (HTTPS_IMAGE.test(url) && url.length <= 500) || (!!opts.allowDataUrl && ((DATA_IMAGE.test(url) && url.length <= 2_000_000) || (LOCAL_IMAGE.test(url) && !url.includes('..'))));
    if (!okUrl) return { ok: false, path: `media.${i}.url`, error: '图片必须先上传到本站' };
    const alt = text(m.alt, 200, `media.${i}.alt`, 1);
    if (!alt.ok) return { ok: false, path: `media.${i}.alt`, error: alt.error === '不能为空' ? '每张图片都要写替代文字（给看不见图片的读者）' : alt.error };
    const w = Number(m.width ?? 0);
    const h = Number(m.height ?? 0);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 0 || h < 0 || w > 20000 || h > 20000) return { ok: false, path: `media.${i}.width`, error: '图片尺寸不正确' };
    media.push({ url, alt: alt.value, width: w, height: h });
  }
  return { ok: true, value: { type, title: title.value, body: body.value, caption: caption.value, notes: notes.value, params, media, visibility } };
}

// ============================================================ 反垃圾
/** 正文里的外链数（http / https / www.），超过规则上限拒绝。 */
export function countLinks(...parts: string[]): number {
  let n = 0;
  for (const s of parts) n += (s.match(/\bhttps?:\/\/[^\s<>"')]+|\bwww\.[a-z0-9-]+\.[a-z]{2,}/gi) ?? []).length;
  return n;
}
/** 重复检测指纹：去掉空白 / 标点 / 大小写后的内容 + 图片地址，FNV-1a 32 位（同作者 24 小时内相同指纹视为重复投稿）。 */
export function contentFingerprint(w: Pick<WorkInput, 'title' | 'body' | 'caption' | 'media'>): string {
  const norm = `${w.title}\n${w.body}\n${w.caption}\n${w.media.map((m) => m.url.slice(0, 200)).join('|')}`.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${norm.length.toString(36)}-${h.toString(36)}`;
}

// ============================================================ 信誉与初始审核
export interface Standing { approved: number; reputation: number; banned: boolean }
/** 新会员（审核通过的内容少于 N 条）或信誉为负 → 先进审核队列；被封禁不能发布。这条规则同时覆盖用户投稿和用户投稿下的评论。 */
export function needsReview(s: Standing, rules: CommunityRules): boolean {
  return s.approved < rules.reviewFirstN || s.reputation < 0;
}
/** 信誉变化：通过 +1、被隐藏 -5、被清除 -10。 */
export const REPUTATION_DELTA: Partial<Record<ModAction, number>> = { approve: 1, hide: -5, purge: -10 };

// ============================================================ 可见范围
export interface WorkAccessInput {
  authorId: number;
  status: WorkStatus;
  visibility: WorkVisibility;
  modState: ModState;
  deleted: boolean;
  authorBanned: boolean;
  viewerId: number | null;
  viewerFollowsAuthor: boolean;
  blockedEitherWay: boolean;
}
/**
 * 统一的读取权限（Worker 与 mock 的所有读取路径都走它）：
 *  'full' 可读；'own' 作者本人读自己的草稿 / 待审 / 被隐藏内容；'none' 一律当作不存在（404）。
 */
export function workAccess(a: WorkAccessInput): 'full' | 'own' | 'none' {
  if (a.deleted) return 'none';
  const self = a.viewerId !== null && a.viewerId === a.authorId;
  if (self) return a.status === 'published' && a.modState === 'ok' ? 'full' : 'own';
  if (a.status !== 'published' || a.modState !== 'ok' || a.authorBanned) return 'none';
  if (a.blockedEitherWay) return 'none';
  if (a.visibility === 'public') return 'full';
  if (a.visibility === 'followers') return a.viewerFollowsAuthor ? 'full' : 'none';
  return 'none';
}

// ============================================================ 动态流
export const FEED_TABS = ['following', 'latest'] as const;
export type FeedTab = (typeof FEED_TABS)[number];
export function checkFeedQuery(sp: URLSearchParams): Check<{ tab: FeedTab; type: WorkType | null }> {
  const tab = (sp.get('tab') ?? 'latest') as FeedTab;
  if (!FEED_TABS.includes(tab)) return { ok: false, path: 'tab', error: 'tab 只能是 following / latest' };
  const t = sp.get('type');
  if (t && !WORK_TYPES.includes(t as WorkType)) return { ok: false, path: 'type', error: 'type 无效' };
  return { ok: true, value: { tab, type: (t as WorkType) || null } };
}

// ============================================================ 评论 / 举报
export function checkWorkComment(input: unknown): Check<{ body: string; parentId: number | null }> {
  const o = (input ?? {}) as Record<string, unknown>;
  const body = text(o.body, 1000, 'body', 1);
  if (!body.ok) return body;
  const p = o.parentId ?? null;
  if (p !== null && (!Number.isInteger(p) || (p as number) <= 0)) return { ok: false, path: 'parentId', error: 'parentId 无效' };
  return { ok: true, value: { body: body.value, parentId: p as number | null } };
}
export function checkReport(input: unknown): Check<{ targetKind: ReportTarget; targetId: number; reason: ReportReason; detail: string }> {
  const o = (input ?? {}) as Record<string, unknown>;
  if (!REPORT_TARGETS.includes(o.targetKind as ReportTarget)) return { ok: false, path: 'targetKind', error: 'targetKind 只能是 work / comment / user' };
  if (!Number.isInteger(o.targetId) || (o.targetId as number) <= 0) return { ok: false, path: 'targetId', error: 'targetId 无效' };
  if (!REPORT_REASONS.includes(o.reason as ReportReason)) return { ok: false, path: 'reason', error: '请选择举报原因' };
  const d = text(o.detail, 500, 'detail');
  if (!d.ok) return d;
  return { ok: true, value: { targetKind: o.targetKind as ReportTarget, targetId: o.targetId as number, reason: o.reason as ReportReason, detail: d.value } };
}
export function checkModAction(input: unknown): Check<{ targetKind: ReportTarget; targetId: number; action: ModAction; reason: string; reportId: number | null }> {
  const o = (input ?? {}) as Record<string, unknown>;
  if (!REPORT_TARGETS.includes(o.targetKind as ReportTarget)) return { ok: false, path: 'targetKind', error: 'targetKind 只能是 work / comment / user' };
  if (!Number.isInteger(o.targetId) || (o.targetId as number) <= 0) return { ok: false, path: 'targetId', error: 'targetId 无效' };
  if (!MOD_ACTIONS.includes(o.action as ModAction)) return { ok: false, path: 'action', error: 'action 无效' };
  const a = o.action as ModAction;
  if ((a === 'ban' || a === 'unban') !== (o.targetKind === 'user')) return { ok: false, path: 'action', error: '封禁 / 解封只能对用户；其他操作只能对内容' };
  const reason = text(o.reason, 200, 'reason');
  if (!reason.ok) return reason;
  const rid = o.reportId ?? null;
  if (rid !== null && (!Number.isInteger(rid) || (rid as number) <= 0)) return { ok: false, path: 'reportId', error: 'reportId 无效' };
  return { ok: true, value: { targetKind: o.targetKind as ReportTarget, targetId: o.targetId as number, action: a, reason: reason.value, reportId: rid as number | null } };
}

/** 通知去重键（L16 新增事件）：reaction / bookmark 聚合，new_work / mention / moderation 幂等。 */
export function workNoticeKey(ev: 'reply' | 'mention' | 'reaction' | 'bookmark' | 'new_work' | 'moderation', p: { workId: number; commentId?: number; parentId?: number | null; action?: string }): string {
  switch (ev) {
    case 'reply':
      return `reply:work:${p.workId}:${p.parentId ?? 'post'}`;
    case 'mention':
      return p.commentId ? `mention:wcomment:${p.commentId}` : `mention:work:${p.workId}`;
    case 'reaction':
      return `reaction:work:${p.workId}`;
    case 'bookmark':
      return `bookmark:work:${p.workId}`;
    case 'new_work':
      return `work:${p.workId}`;
    default:
      return `moderation:work:${p.workId}:${p.action ?? ''}`;
  }
}

/** 摘要：给动态卡片 / 通知用，去掉 Markdown 标记。 */
export function excerptOf(w: { title: string; body: string; caption: string }, max = 140): string {
  const s = (w.title || w.caption || w.body).replace(/[#>*_`~[\]()!]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
