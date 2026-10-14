/**
 * 演示模式的 L28 兴趣社群（小组）接口：与 worker/src/groups.ts 相同的路径、状态码、返回结构和权限规则（共享 group-core.ts）。
 * 状态放在 DemoDb.groups（localStorage，随「重置演示数据」一起清空）。
 * 种子：两个虚构示例小组（组长是示例用户 小林 @xiaolin / Momo @momo），动态里是他们自己的示例作品。
 */
import {
  can,
  canRemoveShare,
  checkGroup,
  checkGroupPatch,
  checkMemberAction,
  checkShare,
  CREATE_PER_DAY,
  GROUP_SLUG_RE,
  groupRank,
  joinBlocked,
  joinResult,
  JOIN_PER_HOUR,
  MAX_OWNED_GROUPS,
  memberActionError,
  SHARE_PER_HOUR,
  visibleShares,
  type JoinPolicy,
  type Role,
  type Standing,
} from '../group-core';
import { SocialError, type MockSocial } from './mock-social';
import type { MockUgc } from './mock-ugc';
import type { Member } from './community-types';

interface DemoGroup { id: number; slug: string; name: string; intro: string; joinPolicy: JoinPolicy; notice: string; ownerId: number; createdAt: string; updatedAt: string }
interface DemoGroupMember { groupId: number; memberId: number; role: Role | 'pending'; createdAt: string }
interface DemoGroupWork { groupId: number; workId: number; memberId: number; createdAt: string }
export interface GroupsState {
  groups: DemoGroup[];
  members: DemoGroupMember[];
  works: DemoGroupWork[];
  /** 简单的频率限制：key → 时间戳（毫秒）列表 */
  hits: Record<string, number[]>;
  nextId: number;
}

export function groupsSeed(now: Date): GroupsState {
  const t = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  return {
    groups: [
      { id: 1, slug: 'street-walk', name: '周末扫街小组', intro: '【演示小组】每周末一起出门拍街头，分享手机和相机拍的照片。', joinPolicy: 'open', notice: '【演示公告】本周六上午 9 点在老城区集合，记得带充电宝。', ownerId: 1, createdAt: t(20), updatedAt: t(2) },
      { id: 2, slug: 'film-lab', name: '胶片冲扫研究所', intro: '【演示小组】交流胶片冲洗、扫描和调色，需要审核后加入。', joinPolicy: 'approval', notice: '', ownerId: 2, createdAt: t(12), updatedAt: t(5) },
    ],
    members: [
      { groupId: 1, memberId: 1, role: 'owner', createdAt: t(20) },
      { groupId: 1, memberId: 2, role: 'mod', createdAt: t(18) },
      { groupId: 2, memberId: 2, role: 'owner', createdAt: t(12) },
    ],
    works: [
      { groupId: 1, workId: 2, memberId: 1, createdAt: t(4) },
      { groupId: 1, workId: 1, memberId: 2, createdAt: t(3) },
    ],
    hits: {},
    nextId: 100,
  };
}

export interface GroupsHost {
  state(): GroupsState;
  commit(mutate: (s: GroupsState) => void): void;
  ugc: MockUgc;
  social: MockSocial;
  members(): Member[];
  memberFrom(headers: Record<string, string>): Member;
  optionalMember(headers: Record<string, string>): Member | null;
  now(): Date;
}

const bad = (path: string, message: string) => new SocialError(400, 'validation_error', '参数校验失败', [{ path, message }]);
const notFound = (msg = '没有这个小组') => new SocialError(404, 'not_found', msg);
const forbidden = (msg: string) => new SocialError(403, 'forbidden', msg);

export class MockGroups {
  constructor(private h: GroupsHost) {}
  private iso() {
    return this.h.now().toISOString();
  }
  private group(slug: string): DemoGroup {
    if (!GROUP_SLUG_RE.test(slug)) throw notFound();
    const g = this.h.state().groups.find((x) => x.slug === slug);
    if (!g) throw notFound();
    return g;
  }
  private standing(s: GroupsState, gid: number, memberId: number | null): Standing {
    if (!memberId) return 'none';
    return s.members.find((m) => m.groupId === gid && m.memberId === memberId)?.role ?? 'none';
  }
  private limit(s: GroupsState, key: string, max: number, windowMs: number): void {
    const now = this.h.now().getTime();
    const list = (s.hits[key] ?? []).filter((x) => now - x < windowMs);
    if (list.length >= max) throw new SocialError(429, 'rate_limited', '操作太频繁，请稍后再试');
    list.push(now);
    s.hits[key] = list;
  }
  private counts(gid: number) {
    const s = this.h.state();
    const ms = s.members.filter((m) => m.groupId === gid);
    const ws = s.works.filter((w) => w.groupId === gid);
    return { members: ms.filter((m) => m.role !== 'pending').length, pending: ms.filter((m) => m.role === 'pending').length, shares: ws.length, lastActiveAt: ws.map((w) => w.createdAt).sort().at(-1) ?? null };
  }
  private toGroup(g: DemoGroup, viewerId: number | null) {
    const c = this.counts(g.id);
    const my = this.standing(this.h.state(), g.id, viewerId);
    return {
      slug: g.slug,
      name: g.name,
      intro: g.intro,
      joinPolicy: g.joinPolicy,
      notice: g.notice,
      owner: this.h.social.card(g.ownerId),
      members: c.members,
      shares: c.shares,
      lastActiveAt: c.lastActiveAt,
      pending: can(my, 'review') ? c.pending : 0,
      myRole: my,
      createdAt: g.createdAt,
    };
  }

  list(headers: Record<string, string>) {
    const me = this.h.optionalMember(headers);
    const gs = this.h.state().groups.map((g) => this.toGroup(g, me?.id ?? null));
    return { groups: gs.sort(groupRank) };
  }
  get(headers: Record<string, string>, slug: string) {
    const me = this.h.optionalMember(headers);
    return { group: this.toGroup(this.group(slug), me?.id ?? null) };
  }
  create(headers: Record<string, string>, input: unknown) {
    const me = this.h.ugc.poster(headers);
    const v = checkGroup(input);
    if (!v.ok) throw bad(v.path, v.error);
    let slug = '';
    this.h.commit((s) => {
      if (s.groups.some((g) => g.slug === v.value.slug)) throw new SocialError(409, 'slug_taken', '这个小组网址已经被用了');
      if (s.groups.filter((g) => g.ownerId === me.id).length >= MAX_OWNED_GROUPS) throw new SocialError(409, 'too_many_groups', `每人最多创建 ${MAX_OWNED_GROUPS} 个小组`);
      this.limit(s, `create:${me.id}`, CREATE_PER_DAY, 86_400_000);
      const id = s.nextId++;
      const t = this.iso();
      s.groups.push({ id, ...v.value, ownerId: me.id, createdAt: t, updatedAt: t });
      s.members.push({ groupId: id, memberId: me.id, role: 'owner', createdAt: t });
      slug = v.value.slug;
    });
    return { group: this.toGroup(this.group(slug), me.id) };
  }
  patch(headers: Record<string, string>, slug: string, input: unknown) {
    const me = this.h.memberFrom(headers);
    const g = this.group(slug);
    const st = this.standing(this.h.state(), g.id, me.id);
    const v = checkGroupPatch(input);
    if (!v.ok) throw bad(v.path, v.error);
    const onlyNotice = Object.keys(v.value).every((k) => k === 'notice');
    if (!(onlyNotice ? can(st, 'pin') : can(st, 'edit'))) throw forbidden(onlyNotice ? '只有组长和管理员可以修改公告' : '只有组长可以修改小组资料');
    this.h.commit((s) => {
      const x = s.groups.find((y) => y.id === g.id)!;
      Object.assign(x, v.value, { updatedAt: this.iso() });
    });
    return { group: this.toGroup(this.group(slug), me.id) };
  }
  remove(headers: Record<string, string>, slug: string) {
    const me = this.h.memberFrom(headers);
    const g = this.group(slug);
    if (!can(this.standing(this.h.state(), g.id, me.id), 'delete')) throw forbidden('只有组长可以解散小组');
    this.h.commit((s) => {
      s.groups = s.groups.filter((x) => x.id !== g.id);
      s.members = s.members.filter((x) => x.groupId !== g.id);
      s.works = s.works.filter((x) => x.groupId !== g.id);
    });
    return { ok: true };
  }
  join(headers: Record<string, string>, slug: string) {
    const me = this.h.ugc.poster(headers);
    const g = this.group(slug);
    const s0 = this.h.state();
    const st = this.standing(s0, g.id, me.id);
    if (st !== 'none') return { state: st };
    const staff = s0.members.filter((m) => m.groupId === g.id && (m.role === 'owner' || m.role === 'mod')).map((m) => m.memberId);
    const blockedBy = staff.some((id) => this.h.social.rel(id, me.id).blocked);
    const blocksOwner = this.h.social.rel(me.id, g.ownerId).blocked;
    if (joinBlocked({ blockedBy, blocksOwner })) throw forbidden('你不能加入这个小组');
    const state = joinResult(g.joinPolicy);
    this.h.commit((s) => {
      this.limit(s, `join:${me.id}`, JOIN_PER_HOUR, 3_600_000);
      s.members.push({ groupId: g.id, memberId: me.id, role: state, createdAt: this.iso() });
    });
    return { state };
  }
  leave(headers: Record<string, string>, slug: string) {
    const me = this.h.memberFrom(headers);
    const g = this.group(slug);
    const st = this.standing(this.h.state(), g.id, me.id);
    if (st === 'owner') throw new SocialError(409, 'owner_cannot_leave', '组长不能退出小组；可以先解散小组');
    if (st === 'none') return { state: 'none' };
    this.h.commit((s) => {
      s.members = s.members.filter((m) => !(m.groupId === g.id && m.memberId === me.id));
    });
    return { state: 'none' };
  }
  listMembers(headers: Record<string, string>, slug: string) {
    const me = this.h.optionalMember(headers);
    const g = this.group(slug);
    const s = this.h.state();
    const st = this.standing(s, g.id, me?.id ?? null);
    const hidden = this.h.ugc.hiddenFor(me?.id ?? null);
    const row = (m: DemoGroupMember) => ({ ...this.h.social.card(m.memberId)!, role: m.role, joinedAt: m.createdAt });
    const ms = s.members.filter((m) => m.groupId === g.id);
    const order: Record<string, number> = { owner: 0, mod: 1, member: 2 };
    return {
      members: ms.filter((m) => m.role !== 'pending' && !hidden.has(m.memberId)).sort((a, b) => order[a.role]! - order[b.role]! || a.createdAt.localeCompare(b.createdAt)).map(row),
      pending: can(st, 'review') ? ms.filter((m) => m.role === 'pending').map(row) : [],
      myRole: st,
    };
  }
  memberAction(headers: Record<string, string>, slug: string, username: string, input: unknown) {
    const me = this.h.memberFrom(headers);
    const g = this.group(slug);
    const v = checkMemberAction(input);
    if (!v.ok) throw bad(v.path, v.error);
    const target = this.h.social.byUsername(username.toLowerCase()).memberId;
    const s0 = this.h.state();
    const actor = this.standing(s0, g.id, me.id);
    const ts = this.standing(s0, g.id, target);
    const err = memberActionError(actor, ts, v.value.action);
    if (err) throw forbidden(err);
    this.h.commit((s) => {
      const i = s.members.findIndex((m) => m.groupId === g.id && m.memberId === target);
      if (v.value.action === 'approve') s.members[i]!.role = 'member';
      else if (v.value.action === 'role') s.members[i]!.role = v.value.role!;
      else s.members.splice(i, 1);
    });
    return { ok: true, state: v.value.action === 'approve' ? 'member' : v.value.action === 'role' ? v.value.role : 'none' };
  }
  feed(headers: Record<string, string>, slug: string, q: URLSearchParams) {
    const me = this.h.optionalMember(headers);
    const g = this.group(slug);
    const s = this.h.state();
    const hidden = this.h.ugc.hiddenFor(me?.id ?? null);
    const rows = s.works
      .filter((x) => x.groupId === g.id)
      .map((x) => ({ x, w: this.h.ugc.work(x.workId) }))
      .filter((r) => r.w && this.h.ugc.visible(r.w) && r.w.visibility === 'public')
      .map((r) => ({ sharerId: r.x.memberId, authorId: r.w!.authorId, workId: r.x.workId, sharedAt: r.x.createdAt }));
    const limit = Math.min(50, Math.max(1, Number(q.get('limit')) || 20));
    const items = visibleShares(rows, hidden).slice(0, limit);
    const st = this.standing(s, g.id, me?.id ?? null);
    return {
      items: items.map((r) => ({ work: this.h.ugc.toWork(this.h.ugc.work(r.workId)!, me?.id ?? null), sharedBy: this.h.social.card(r.sharerId), sharedAt: r.sharedAt, canRemove: !!me && canRemoveShare(st, me.id, r.sharerId) })),
    };
  }
  share(headers: Record<string, string>, slug: string, input: unknown) {
    const me = this.h.ugc.poster(headers);
    const g = this.group(slug);
    const v = checkShare(input);
    if (!v.ok) throw bad(v.path, v.error);
    if (!can(this.standing(this.h.state(), g.id, me.id), 'post')) throw forbidden('加入小组后才能分享');
    const w = this.h.ugc.work(v.value.workId);
    if (!w || w.authorId !== me.id) throw notFound('只能分享你自己的作品');
    if (!this.h.ugc.visible(w) || w.visibility !== 'public') throw new SocialError(409, 'not_public', '只能分享已发布的公开作品');
    this.h.commit((s) => {
      if (s.works.some((x) => x.groupId === g.id && x.workId === w.id)) throw new SocialError(409, 'already_shared', '这个作品已经在小组里了');
      this.limit(s, `share:${me.id}`, SHARE_PER_HOUR, 3_600_000);
      s.works.push({ groupId: g.id, workId: w.id, memberId: me.id, createdAt: this.iso() });
    });
    return { ok: true };
  }
  unshare(headers: Record<string, string>, slug: string, workId: number) {
    const me = this.h.memberFrom(headers);
    const g = this.group(slug);
    const s0 = this.h.state();
    const row = s0.works.find((x) => x.groupId === g.id && x.workId === workId);
    if (!row) throw notFound('小组里没有这条分享');
    if (!canRemoveShare(this.standing(s0, g.id, me.id), me.id, row.memberId)) throw forbidden('只能删除自己的分享');
    this.h.commit((s) => {
      s.works = s.works.filter((x) => !(x.groupId === g.id && x.workId === workId));
    });
    return { ok: true };
  }
  /** 会员注销 / 封禁清理：退出所有小组、删除分享；作为组长的小组一并解散。 */
  purgeMember(s: GroupsState, memberId: number): void {
    const owned = new Set(s.groups.filter((g) => g.ownerId === memberId).map((g) => g.id));
    s.groups = s.groups.filter((g) => !owned.has(g.id));
    s.members = s.members.filter((m) => m.memberId !== memberId && !owned.has(m.groupId));
    s.works = s.works.filter((w) => w.memberId !== memberId && !owned.has(w.groupId));
  }

  route(m: string, sub: string, q: URLSearchParams, body: unknown, headers: Record<string, string>): { status: number; body: unknown } | null {
    if (!sub.startsWith('/groups')) return null;
    const ok = (b: unknown, status = 200) => ({ status, body: b });
    const SLUG = '([a-z0-9][a-z0-9-]{0,30}[a-z0-9])';
    let mt: RegExpExecArray | null;
    if (sub === '/groups') {
      if (m === 'GET') return ok(this.list(headers));
      if (m === 'POST') return ok(this.create(headers, body), 201);
      return null;
    }
    if ((mt = new RegExp(`^/groups/${SLUG}$`).exec(sub))) {
      if (m === 'GET') return ok(this.get(headers, mt[1]!));
      if (m === 'PATCH' || m === 'PUT') return ok(this.patch(headers, mt[1]!, body));
      if (m === 'DELETE') return ok(this.remove(headers, mt[1]!));
    }
    if ((mt = new RegExp(`^/groups/${SLUG}/join$`).exec(sub))) {
      if (m === 'POST' || m === 'PUT') return ok(this.join(headers, mt[1]!));
      if (m === 'DELETE') return ok(this.leave(headers, mt[1]!));
    }
    if ((mt = new RegExp(`^/groups/${SLUG}/members$`).exec(sub)) && m === 'GET') return ok(this.listMembers(headers, mt[1]!));
    if ((mt = new RegExp(`^/groups/${SLUG}/members/([A-Za-z0-9_]{3,20})$`).exec(sub)) && m === 'POST') return ok(this.memberAction(headers, mt[1]!, mt[2]!, body));
    if ((mt = new RegExp(`^/groups/${SLUG}/feed$`).exec(sub))) {
      if (m === 'GET') return ok(this.feed(headers, mt[1]!, q));
      if (m === 'POST') return ok(this.share(headers, mt[1]!, body), 201);
    }
    if ((mt = new RegExp(`^/groups/${SLUG}/feed/(\\d{1,10})$`).exec(sub)) && m === 'DELETE') return ok(this.unshare(headers, mt[1]!, Number(mt[2])));
    return null;
  }
}
