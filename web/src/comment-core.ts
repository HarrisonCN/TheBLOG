/**
 * 文章评论：输入校验、Markdown-lite 渲染（白名单、先转义再还原少量格式）、两级楼中楼整理。
 *
 * 这个文件在 web/src/comment-core.ts 与 worker/src/comment-core.ts 各有一份，内容必须完全相同
 * （web/test/l12-features.test.ts 会比对两份文件）。不依赖任何库，浏览器、Worker、Node 都能跑。
 */

export const COMMENT_NAME_MAX = 30;
export const COMMENT_BODY_MIN = 2;
export const COMMENT_BODY_MAX = 1000;
/** 蜜罐字段：页面上对人隐藏，机器人会填。填了就假装成功、什么也不存。 */
export const COMMENT_HONEYPOT = 'homepage';
export const COMMENT_INPUT_KEYS = ['name', 'content', 'parentId', COMMENT_HONEYPOT] as const;
export const COMMENT_STATUSES = ['pending', 'approved', 'hidden'] as const;
export const COMMENT_ACTIONS = ['approve', 'hide', 'delete'] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];
export type CommentAction = (typeof COMMENT_ACTIONS)[number];

export interface CommentInput {
  name: string;
  content: string;
  parentId: number | null;
}
/** 接口返回的评论（公开列表只有 approved；后台能看到全部状态）。 */
export interface PostComment {
  id: number;
  slug: string;
  parentId: number | null;
  /** 回复楼中楼里的某一条时，被回复人的昵称（只做展示） */
  replyTo: string;
  name: string;
  content: string;
  /** 好朋友（已登录会员）发的评论 */
  member: boolean;
  status: CommentStatus;
  createdAt: string;
}
export interface CommentThread extends PostComment {
  replies: PostComment[];
}

const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;
const clean = (s: string) => s.normalize('NFC').replace(/\r\n?/g, '\n').replace(INVISIBLE, '');

export type CommentResult = { ok: true; value: CommentInput; spam: boolean } | { ok: false; error: string; path: string };

/** 严格校验：普通对象、只允许已知字段、长度限制；昵称不能有换行；蜜罐有值 → spam。 */
export function validateComment(input: unknown): CommentResult {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) return { ok: false, error: '请求体必须是对象', path: 'body' };
  const o = input as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => !(COMMENT_INPUT_KEYS as readonly string[]).includes(k));
  if (extra.length) return { ok: false, error: `不支持字段：${extra.slice(0, 3).join(', ')}`, path: extra[0]! };
  if (typeof o.name !== 'string') return { ok: false, error: '请填写昵称', path: 'name' };
  if (typeof o.content !== 'string') return { ok: false, error: '请填写评论内容', path: 'content' };
  const name = clean(o.name).replace(/\s+/g, ' ').trim();
  const content = clean(o.content).replace(/\n{3,}/g, '\n\n').trim();
  if (!name) return { ok: false, error: '请填写昵称', path: 'name' };
  if (Array.from(name).length > COMMENT_NAME_MAX) return { ok: false, error: `昵称最多 ${COMMENT_NAME_MAX} 个字`, path: 'name' };
  if (/[<>]/.test(name)) return { ok: false, error: '昵称不能包含 < >', path: 'name' };
  const len = Array.from(content).length;
  if (len < COMMENT_BODY_MIN) return { ok: false, error: `评论至少 ${COMMENT_BODY_MIN} 个字`, path: 'content' };
  if (len > COMMENT_BODY_MAX) return { ok: false, error: `评论最多 ${COMMENT_BODY_MAX} 个字`, path: 'content' };
  let parentId: number | null = null;
  if (o.parentId !== undefined && o.parentId !== null) {
    if (typeof o.parentId !== 'number' || !Number.isInteger(o.parentId) || o.parentId <= 0) return { ok: false, error: 'parentId 必须是正整数', path: 'parentId' };
    parentId = o.parentId;
  }
  const hp = o[COMMENT_HONEYPOT];
  if (hp !== undefined && typeof hp !== 'string') return { ok: false, error: '参数错误', path: COMMENT_HONEYPOT };
  return { ok: true, value: { name, content, parentId }, spam: typeof hp === 'string' && hp.trim() !== '' };
}

export function isCommentAction(v: unknown): v is CommentAction {
  return typeof v === 'string' && (COMMENT_ACTIONS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------- Markdown-lite
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const LINK = /^https?:\/\/[^\s<>"'`]+$/i;

/** 行内格式：`代码`、**粗体**、*斜体*、~~删除线~~、[文字](https://…)、裸 https 链接。输入已转义。 */
function inline(s: string): string {
  const codes: string[] = [];
  let out = s.replace(/`([^`\n]{1,200})`/g, (_m, c: string) => `\u0000${codes.push(`<code>${c}</code>`) - 1}\u0000`);
  const links: string[] = [];
  const keep = (html: string) => `\u0001${links.push(html) - 1}\u0001`;
  const a = (href: string, text: string) => `<a href="${href}" target="_blank" rel="nofollow ugc noopener noreferrer">${text}</a>`;
  // 已转义的文本里 & 变成了 &amp;：还原后再校验 URL，输出时重新转义
  const unesc = (h: string) => h.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  out = out.replace(/\[([^\]\n]{1,80})\]\(([^)\s]{1,500})\)/g, (m, text: string, href: string) => (LINK.test(unesc(href)) ? keep(a(esc(unesc(href)), text)) : m));
  out = out.replace(/(^|[\s(（])(https?:\/\/[^\s<>"'`）)]{1,500})/gi, (m, pre: string, href: string) => {
    const h = unesc(href).replace(/[.,;:!?。，；：！？]+$/, '');
    const tail = unesc(href).slice(h.length);
    return LINK.test(h) ? `${pre}${keep(a(esc(h), esc(h)))}${esc(tail)}` : m;
  });
  out = out
    .replace(/\*\*([^*\n]{1,200})\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]{1,200})\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]{1,200})~~/g, '<del>$1</del>');
  return out.replace(/\u0001(\d+)\u0001/g, (_m, i: string) => links[Number(i)]!).replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[Number(i)]!);
}

/**
 * 评论正文 → 安全 HTML。先整体转义，再把白名单里的少量格式还原成固定标签：
 * <p> <br> <blockquote> <code> <strong> <em> <del> <a href="https://…" rel="nofollow ugc …">。不会出现任何属性值来自用户的事件 / 样式。
 */
export function renderCommentHtml(text: string): string {
  const src = clean(String(text ?? '')).slice(0, COMMENT_BODY_MAX * 2);
  const blocks = src.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return blocks
    .map((b) => {
      const lines = b.split('\n');
      if (lines.every((l) => /^>\s?/.test(l))) return `<blockquote>${lines.map((l) => inline(esc(l.replace(/^>\s?/, '')))).join('<br>')}</blockquote>`;
      return `<p>${lines.map((l) => inline(esc(l))).join('<br>')}</p>`;
    })
    .join('');
}

// ---------------------------------------------------------------- 楼中楼（两级）
/** 平铺列表 → 两级：顶层评论 + 它下面的回复（时间正序）。孤儿回复（父评论不可见）提升为顶层。 */
export function threadComments(list: PostComment[]): CommentThread[] {
  const sorted = list.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id));
  const tops = new Map<number, CommentThread>();
  for (const c of sorted) if (c.parentId === null) tops.set(c.id, { ...c, replies: [] });
  for (const c of sorted) {
    if (c.parentId === null) continue;
    const parent = tops.get(c.parentId);
    if (parent) parent.replies.push(c);
    else tops.set(c.id, { ...c, parentId: null, replies: [] });
  }
  return [...tops.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id));
}

/** 回复某条评论时真正挂到哪一层：回复「回复」→ 挂到它的顶层评论下，并记下被回复人。 */
export function resolveParent(target: Pick<PostComment, 'id' | 'parentId' | 'name'>): { parentId: number; replyTo: string } {
  return target.parentId === null ? { parentId: target.id, replyTo: '' } : { parentId: target.parentId, replyTo: target.name };
}
