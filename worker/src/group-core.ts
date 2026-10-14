/**
 * L28 兴趣社群（小组）的纯函数：Worker 与前端演示 mock 共用（web/src/group-core.ts 与 worker/src/group-core.ts 必须完全一致，worker 测试会比对）。
 * 不依赖 D1 / DOM：小组输入校验、角色权限矩阵、加入流程（直接加入 / 需要审核）、成员操作（审核、移出、任免管理员）的合法性、
 * 动态可见性（屏蔽 / 静音的人在我这里看不到）。
 *
 * 角色：owner（组长，唯一）> mod（管理员）> member（成员）；还有 pending（申请中）和 none（不是成员）两种状态。
 */

export type Check<T> = { ok: true; value: T } | { ok: false; path: string; error: string };
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
function text(v: unknown, max: number, path: string, min = 0): Check<string> {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') return { ok: false, path, error: '必须是字符串' };
  const s = v.trim();
  if (CTRL.test(s)) return { ok: false, path, error: '包含不允许的控制字符' };
  if (s.length < min) return { ok: false, path, error: '不能为空' };
  if (s.length > max) return { ok: false, path, error: `最多 ${max} 个字` };
  return { ok: true, value: s };
}

// ============================================================ 小组
export const GROUP_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])$/;
export const JOIN_POLICIES = ['open', 'approval'] as const;
export type JoinPolicy = (typeof JOIN_POLICIES)[number];
export const JOIN_POLICY_LABEL: Record<JoinPolicy, string> = { open: '直接加入', approval: '需要审核' };
/** 每人最多当几个组的组长 */
export const MAX_OWNED_GROUPS = 5;
/** 每天最多创建几个小组 */
export const CREATE_PER_DAY = 3;
/** 每小时最多申请加入几次 */
export const JOIN_PER_HOUR = 20;
/** 每小时最多分享几条作品到小组 */
export const SHARE_PER_HOUR = 10;

export interface GroupInput {
  slug: string;
  name: string;
  intro: string;
  joinPolicy: JoinPolicy;
  notice: string;
}
/** 创建小组：slug、名称必填。 */
export function checkGroup(input: unknown): Check<GroupInput> {
  const o = (input ?? {}) as Record<string, unknown>;
  const slug = typeof o.slug === 'string' ? o.slug.trim().toLowerCase() : '';
  if (!GROUP_SLUG_RE.test(slug)) return { ok: false, path: 'slug', error: '网址只能是 2–32 位小写字母、数字和连字符' };
  const name = text(o.name, 30, 'name', 1);
  if (!name.ok) return name;
  const intro = text(o.intro, 300, 'intro');
  if (!intro.ok) return intro;
  const joinPolicy = (o.joinPolicy ?? 'open') as JoinPolicy;
  if (!JOIN_POLICIES.includes(joinPolicy)) return { ok: false, path: 'joinPolicy', error: '加入方式只能是 open / approval' };
  const notice = text(o.notice, 300, 'notice');
  if (!notice.ok) return notice;
  return { ok: true, value: { slug, name: name.value, intro: intro.value, joinPolicy, notice: notice.value } };
}
export type GroupPatch = Partial<Omit<GroupInput, 'slug'>>;
/** 修改小组：只校验给出的字段；slug 不能改。 */
export function checkGroupPatch(input: unknown): Check<GroupPatch> {
  const o = (input ?? {}) as Record<string, unknown>;
  const out: GroupPatch = {};
  if ('slug' in o) return { ok: false, path: 'slug', error: '小组网址创建后不能修改' };
  if (o.name !== undefined) {
    const v = text(o.name, 30, 'name', 1);
    if (!v.ok) return v;
    out.name = v.value;
  }
  if (o.intro !== undefined) {
    const v = text(o.intro, 300, 'intro');
    if (!v.ok) return v;
    out.intro = v.value;
  }
  if (o.notice !== undefined) {
    const v = text(o.notice, 300, 'notice');
    if (!v.ok) return v;
    out.notice = v.value;
  }
  if (o.joinPolicy !== undefined) {
    if (!JOIN_POLICIES.includes(o.joinPolicy as JoinPolicy)) return { ok: false, path: 'joinPolicy', error: '加入方式只能是 open / approval' };
    out.joinPolicy = o.joinPolicy as JoinPolicy;
  }
  if (!Object.keys(out).length) return { ok: false, path: '', error: '没有要修改的内容' };
  return { ok: true, value: out };
}

// ============================================================ 角色与权限
export const ROLES = ['owner', 'mod', 'member'] as const;
export type Role = (typeof ROLES)[number];
export type Standing = Role | 'pending' | 'none';
export const ROLE_LABEL: Record<Standing, string> = { owner: '组长', mod: '管理员', member: '成员', pending: '申请中', none: '未加入' };
const RANK: Record<Standing, number> = { owner: 3, mod: 2, member: 1, pending: 0, none: 0 };

export const ACTIONS = ['view', 'join', 'leave', 'post', 'pin', 'edit', 'review', 'kick', 'setRole', 'removePost', 'delete'] as const;
export type Action = (typeof ACTIONS)[number];
/**
 * 权限矩阵（不含对象相关的判断，例如「只能移出比自己低的人」「只能删自己的分享」由 canActOn / canRemoveShare 判断）：
 *  view：所有人（小组和动态都是公开的）；join：未加入；leave：成员 / 管理员 / 申请中（取消申请），组长不能直接退出；
 *  post：成员以上；pin（公告）、review（审核申请）、kick、removePost（删任意分享）：管理员以上；
 *  edit（名称 / 简介 / 加入方式）、setRole、delete：只有组长。
 */
export const MATRIX: Record<Action, Standing[]> = {
  view: ['owner', 'mod', 'member', 'pending', 'none'],
  join: ['none'],
  leave: ['mod', 'member', 'pending'],
  post: ['owner', 'mod', 'member'],
  pin: ['owner', 'mod'],
  edit: ['owner'],
  review: ['owner', 'mod'],
  kick: ['owner', 'mod'],
  setRole: ['owner'],
  removePost: ['owner', 'mod'],
  delete: ['owner'],
};
export function can(s: Standing, a: Action): boolean {
  return MATRIX[a].includes(s);
}
/** 对另一个成员执行 kick / setRole：必须严格高于对方，且对方是正式成员（不是申请中）。 */
export function canActOn(actor: Standing, target: Standing, a: 'kick' | 'setRole'): boolean {
  if (!can(actor, a)) return false;
  if (target === 'none' || target === 'pending' || target === 'owner') return false;
  return RANK[actor] > RANK[target];
}
/** 删除一条分享：自己的分享随时可以删；管理员以上可以删任何分享。 */
export function canRemoveShare(actor: Standing, actorId: number, sharerId: number): boolean {
  if (actor === 'none' || actor === 'pending') return false;
  return actorId === sharerId || can(actor, 'removePost');
}
/** 申请加入后的状态：开放小组直接成为成员，审核小组进入申请中。 */
export function joinResult(policy: JoinPolicy): 'member' | 'pending' {
  return policy === 'open' ? 'member' : 'pending';
}
/**
 * 能否加入：被组长或任何管理员屏蔽的人不能加入（也不能申请）；屏蔽了组长的人也不能加入（避免互相看不到的尴尬）。
 * blockedBy：组长 / 管理员里有人屏蔽了申请人；blocksOwner：申请人屏蔽了组长。
 */
export function joinBlocked(r: { blockedBy: boolean; blocksOwner: boolean }): boolean {
  return r.blockedBy || r.blocksOwner;
}
export const REVIEW_ACTIONS = ['approve', 'reject'] as const;
export const MEMBER_ACTIONS = ['approve', 'reject', 'kick', 'role'] as const;
export type MemberAction = (typeof MEMBER_ACTIONS)[number];
export function checkMemberAction(input: unknown): Check<{ action: MemberAction; role?: 'mod' | 'member' }> {
  const o = (input ?? {}) as Record<string, unknown>;
  if (!MEMBER_ACTIONS.includes(o.action as MemberAction)) return { ok: false, path: 'action', error: 'action 只能是 approve / reject / kick / role' };
  if (o.action === 'role') {
    if (o.role !== 'mod' && o.role !== 'member') return { ok: false, path: 'role', error: 'role 只能是 mod / member' };
    return { ok: true, value: { action: 'role', role: o.role } };
  }
  return { ok: true, value: { action: o.action as MemberAction } };
}
/** 成员操作是否合法（审核只针对申请中的人；kick / role 走 canActOn）。返回错误说明或 null。 */
export function memberActionError(actor: Standing, target: Standing, a: MemberAction): string | null {
  if (a === 'approve' || a === 'reject') {
    if (!can(actor, 'review')) return '只有组长和管理员可以审核';
    return target === 'pending' ? null : '对方没有在申请中';
  }
  if (a === 'kick') return canActOn(actor, target, 'kick') ? null : '不能移出这个人';
  return canActOn(actor, target, 'setRole') ? null : '只有组长可以任免管理员';
}

// ============================================================ 动态
/** 小组动态：去掉我屏蔽 / 静音的人和屏蔽了我的人分享的内容；按分享时间倒序，同一作品只出现一次。 */
export function visibleShares<T extends { sharerId: number; authorId: number; workId: number; sharedAt: string }>(items: T[], hidden: Set<number>): T[] {
  const seen = new Set<number>();
  return [...items]
    .sort((a, b) => b.sharedAt.localeCompare(a.sharedAt) || b.workId - a.workId)
    .filter((x) => {
      if (hidden.has(x.sharerId) || hidden.has(x.authorId) || seen.has(x.workId)) return false;
      seen.add(x.workId);
      return true;
    });
}
export function checkShare(input: unknown): Check<{ workId: number }> {
  const o = (input ?? {}) as Record<string, unknown>;
  const id = Number(o.workId);
  if (!Number.isInteger(id) || id < 1) return { ok: false, path: 'workId', error: 'workId 必须是正整数' };
  return { ok: true, value: { workId: id } };
}
/** 小组列表排序：成员多的在前，其次最近活跃。 */
export function groupRank(a: { members: number; lastActiveAt: string | null; name: string }, b: { members: number; lastActiveAt: string | null; name: string }): number {
  return b.members - a.members || (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? '') || a.name.localeCompare(b.name);
}
