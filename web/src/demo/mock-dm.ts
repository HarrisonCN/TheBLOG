/**
 * 演示模式的 L19 私信 / 消息请求 / 活动聊天室：与 worker/src/dm.ts 相同的路径、状态码、返回结构和权限规则（共用 dm-core.ts）。
 * 状态放在 DemoDb.dm（localStorage，随「重置演示数据」一起清空）。
 * 「实时」在浏览器里模拟：每次写入后通过宿主的 emit() 发事件；client.ts 用 BroadcastChannel 转给同一浏览器的其他标签页，
 * 本标签页直接回调。示例用户（小林 / Momo，均为虚构）会自动接受请求并回复，用来演示实时到达；不会连接任何服务器。
 */
import {
  canRecall,
  canSeePresence,
  canSend,
  checkBody,
  checkClientId,
  checkPolicy,
  checkRoomConfig,
  clampPage,
  decideStart,
  decodeConvCursor,
  DECLINE_COOLDOWN_DAYS,
  DM_SETTINGS_DEFAULT,
  encodeConvCursor,
  excerpt,
  limitsFor,
  parseId,
  receiptsVisible,
  ROOM_MAX_BODY,
  roomMessageVisible,
  type ConvStatus,
  type DmConversation,
  type DmEvent,
  type DmMessage,
  type DmSettings,
  type DmUser,
  type RoomRetention,
} from '../dm-core';
import { SocialError, type MockSocial } from './mock-social';
import type { MockUgc } from './mock-ugc';
import type { Member } from './community-types';

interface DConv { id: number; kind: 'dm' | 'room'; a: number | null; b: number | null; eventSlug: string | null; title: string; status: ConvStatus; requestedBy: number | null; retention: RoomRetention; ttlHours: number; closed: boolean; createdAt: string; lastMessageId: number | null; lastAt: string }
interface DMem { conv: number; member: number; role: 'member' | 'moderator'; lastReadId: number; clearedBeforeId: number; hidden: boolean; muted: boolean; joinedAt: string }
interface DMsg { id: number; conv: number; sender: number | null; body: string; clientId: string | null; createdAt: string; recalledAt: string | null; removedBy: number | null }
interface DChange { seq: number; conv: number; kind: 'msg' | 'recall' | 'read' | 'conv' | 'remove'; messageId: number | null; actor: number | null; target: number | null; data: Record<string, unknown> }
export interface DmState {
  convs: DConv[];
  members: DMem[];
  messages: DMsg[];
  hidden: string[];
  declines: { requester: number; target: number; untilMs: number }[];
  settings: Record<string, DmSettings>;
  changes: DChange[];
  reports: { reportId: number; messageId: number; conv: number; reporter: number | null; snapshot: string; createdAt: string }[];
  seen: Record<string, number>;
  welcomed: number[];
  /** 演示：标签页正以示例用户身份操作（id → 时间戳），这段时间不再模拟自动回复，免得和真人操作打架 */
  acting?: Record<string, number>;
  nextId: number;
  seq: number;
}

/** 种子：「每日一图」活动开着一个临时聊天室，小林和 Momo 已经聊了两句（虚构示例用户）。 */
export function dmSeed(now: Date): DmState {
  const t = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
  return {
    convs: [{ id: 1, kind: 'room', a: null, b: null, eventSlug: 'daily-sky', title: '每日一图：今天的天空', status: 'active', requestedBy: null, retention: 'ephemeral', ttlHours: 24, closed: false, createdAt: t(120), lastMessageId: 3, lastAt: t(20) }],
    members: [
      { conv: 1, member: 1, role: 'moderator', lastReadId: 3, clearedBeforeId: 0, hidden: false, muted: false, joinedAt: t(120) },
      { conv: 1, member: 2, role: 'member', lastReadId: 3, clearedBeforeId: 0, hidden: false, muted: false, joinedAt: t(110) },
    ],
    messages: [
      { id: 2, conv: 1, sender: 1, body: '【演示】今天傍晚的火烧云太夸张了，大家都拍到了吗？', clientId: null, createdAt: t(40), recalledAt: null, removedBy: null },
      { id: 3, conv: 1, sender: 2, body: '【演示】拍到了！手机压了 -0.7 EV，颜色刚好。', clientId: null, createdAt: t(20), recalledAt: null, removedBy: null },
    ],
    hidden: [],
    declines: [],
    settings: {},
    changes: [],
    reports: [],
    seen: {},
    welcomed: [],
    nextId: 10,
    seq: 0,
  };
}

export interface DmHost {
  state(): DmState;
  commit(mutate: (s: DmState) => void): void;
  social: MockSocial;
  ugc: MockUgc;
  members(): Member[];
  memberFrom(headers: Record<string, string>): Member;
  /** 演示的「实时」：把事件发给这些成员（本标签页 + BroadcastChannel 其他标签页） */
  emit(to: number[], ev: DmEvent): void;
  /** 示例用户自动回复用的延时（测试里可以同步执行） */
  schedule(fn: () => void, ms: number): void;
  isAdmin(headers: Record<string, string>): boolean;
  now(): Date;
}

const bad = (path: string, message: string) => new SocialError(400, 'validation_error', '参数校验失败', [{ path, message }]);
const notFound = (msg = '会话不存在') => new SocialError(404, 'not_found', msg);
const REPORT_REASONS = ['spam', 'abuse', 'nsfw', 'copyright', 'privacy', 'other'];
const SEED_IDS = new Set([1, 2]);
/** 演示：示例用户「在线」状态是模拟的 */
const SEED_ONLINE: Record<number, boolean> = { 1: true, 2: false };
const SEED_REPLIES = ['【演示】收到！这条回复是演示站模拟的，真实站点里会由对方本人发出。', '【演示】哈哈好的～可以再开一个标签页登录另一个账号，试试两边实时收发。', '【演示】晚点把那组夜景发你看看 📷'];

export class MockDm {
  private lastAuto = new Map<number, number>();
  constructor(private h: DmHost) {}
  private iso = () => this.h.now().toISOString();
  private st = () => this.h.state();

  private user(id: number | null): DmUser | null {
    if (id == null) return null;
    const c = this.h.social.card(id);
    return c ? { username: c.username, nickname: c.nickname, avatarUrl: c.avatarUrl } : null;
  }
  settingsOf(id: number): DmSettings {
    return this.st().settings[String(id)] ?? { ...DM_SETTINGS_DEFAULT };
  }
  private peerOf(c: DConv, me: number): number | null {
    return c.kind === 'dm' ? (c.a === me ? c.b : c.a) : null;
  }
  private mem(conv: number, member: number): DMem | undefined {
    return this.st().members.find((m) => m.conv === conv && m.member === member);
  }
  private touchSeen(id: number): void {
    const now = this.h.now().getTime();
    if ((this.st().seen[String(id)] ?? 0) > now - 15_000) return;
    this.h.commit((s) => (s.seen[String(id)] = now));
  }
  private loadConv(id: number, me: number): { c: DConv; mine: DMem; peer: number | null } {
    const c = this.st().convs.find((x) => x.id === id && x.kind === 'dm');
    if (!c) throw notFound();
    const mine = this.mem(id, me);
    if (!mine) throw notFound();
    const peer = this.peerOf(c, me);
    if (peer != null && this.h.social.rel(me, peer).blockedBy) throw notFound();
    return { c, mine, peer };
  }
  private isHidden(me: number, mid: number): boolean {
    return this.st().hidden.includes(`${me}:${mid}`);
  }
  private toMessage(r: DMsg, me: number): DmMessage {
    const gone = !!r.recalledAt || r.removedBy != null;
    return { id: r.id, conversationId: r.conv, sender: this.user(r.sender), mine: r.sender === me, body: gone ? '' : r.body, clientId: r.sender === me ? r.clientId : null, createdAt: r.createdAt, recalled: !!r.recalledAt, removed: r.removedBy != null };
  }
  private unreadOf(c: DConv, m: DMem, me: number): number {
    const from = Math.max(m.lastReadId, m.clearedBeforeId);
    return this.st().messages.filter((x) => x.conv === c.id && x.id > from && x.sender !== me && !x.recalledAt && x.removedBy == null && !this.isHidden(me, x.id)).length;
  }
  private toConversation(c: DConv, m: DMem, me: number): DmConversation {
    const peer = this.peerOf(c, me);
    const pu = this.user(peer);
    const last = c.lastMessageId && c.lastMessageId > m.clearedBeforeId ? this.st().messages.find((x) => x.id === c.lastMessageId) : undefined;
    const vis = peer != null && receiptsVisible(this.settingsOf(me).readReceipts, this.settingsOf(peer).readReceipts);
    return {
      id: c.id,
      kind: c.kind,
      status: c.status,
      peer: pu,
      title: c.title || pu?.nickname || '',
      requestedByMe: c.requestedBy === me,
      unread: this.unreadOf(c, m, me),
      lastMessage: last ? { id: last.id, excerpt: last.recalledAt || last.removedBy != null ? '' : excerpt(last.body), createdAt: last.createdAt, mine: last.sender === me, recalled: !!last.recalledAt } : null,
      lastAt: c.lastAt,
      peerLastReadId: vis && peer != null ? (this.mem(c.id, peer)?.lastReadId ?? 0) : null,
      muted: m.muted,
    };
  }
  private log(s: DmState, ch: Omit<DChange, 'seq'>): number {
    s.seq += 1;
    s.changes.push({ ...ch, seq: s.seq });
    if (s.changes.length > 600) s.changes.splice(0, s.changes.length - 600);
    return s.seq;
  }
  private pendingCount(conv: number, me: number): number {
    return this.st().messages.filter((x) => x.conv === conv && x.sender === me).length;
  }

  // ------------------------------------------------------------ 会话
  /** 演示：第一次打开私信时收到一条来自 Momo 的示例消息请求（虚构用户） */
  private welcome(me: Member): void {
    if (SEED_IDS.has(me.id) || this.st().welcomed.includes(me.id)) return;
    const t = this.iso();
    this.h.commit((s) => {
      s.welcomed.push(me.id);
      if (s.convs.some((c) => c.kind === 'dm' && (c.a === me.id || c.b === me.id))) return;
      const id = s.nextId++;
      const mid = s.nextId++;
      s.convs.push({ id, kind: 'dm', a: 2, b: me.id, eventSlug: null, title: '', status: 'request', requestedBy: 2, retention: 'retained', ttlHours: 24, closed: false, createdAt: t, lastMessageId: mid, lastAt: t });
      s.members.push({ conv: id, member: 2, role: 'member', lastReadId: mid, clearedBeforeId: 0, hidden: false, muted: false, joinedAt: t }, { conv: id, member: me.id, role: 'member', lastReadId: 0, clearedBeforeId: 0, hidden: false, muted: false, joinedAt: t });
      s.messages.push({ id: mid, conv: id, sender: 2, body: '【演示】你好呀！我是示例用户 Momo。这是一条「消息请求」：我们还没有互相关注，所以要你接受之后才能互相聊天。', clientId: null, createdAt: t, recalledAt: null, removedBy: null });
      this.log(s, { conv: id, kind: 'conv', messageId: null, actor: 2, target: null, data: { status: 'request' } });
    });
  }

  start(headers: Record<string, string>, input: unknown) {
    const me = this.h.memberFrom(headers);
    this.touchSeen(me.id);
    const username = String((input as { username?: unknown } | null)?.username ?? '').trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw bad('username', '用户名格式不正确');
    const target = this.h.social.byUsername(username).memberId;
    const rel = this.h.social.rel(me.id, target);
    const [a, b] = me.id < target ? [me.id, target] : [target, me.id];
    const existing = this.st().convs.find((c) => c.kind === 'dm' && c.a === a && c.b === b);
    if (rel.blockedBy) throw notFound('没有这个用户');
    if (rel.blocked) throw new SocialError(403, 'blocked', '你已拉黑对方，先解除拉黑');
    const now = this.h.now().getTime();
    if (existing && existing.status !== 'declined') {
      this.h.commit((s) => {
        const m = s.members.find((x) => x.conv === existing.id && x.member === me.id);
        if (m) m.hidden = false;
      });
      return { conversation: this.toConversation(existing, this.mem(existing.id, me.id)!, me.id), created: false };
    }
    const dec = this.st().declines.find((d) => d.requester === me.id && d.target === target);
    const d = decideStart({ self: me.id === target, rel, policy: this.settingsOf(target).policy, declinedUntil: dec?.untilMs ?? null, now });
    if (!d.ok) throw new SocialError(d.status, d.code, d.message);
    const lim = limitsFor(me.joinedAt, now);
    if (d.kind === 'request') this.h.social.limit(`dm-request:${me.id}`, lim.requestsPerDay, 86400_000, `每天最多发起 ${lim.requestsPerDay} 个消息请求`);
    const status: ConvStatus = d.kind === 'direct' ? 'active' : 'request';
    const t = this.iso();
    let id = existing?.id ?? 0;
    this.h.commit((s) => {
      if (existing) {
        const c = s.convs.find((x) => x.id === existing.id)!;
        Object.assign(c, { status, requestedBy: me.id, lastAt: t });
      } else {
        id = s.nextId++;
        s.convs.push({ id, kind: 'dm', a, b, eventSlug: null, title: '', status, requestedBy: me.id, retention: 'retained', ttlHours: 24, closed: false, createdAt: t, lastMessageId: null, lastAt: t });
        s.members.push({ conv: id, member: me.id, role: 'member', lastReadId: 0, clearedBeforeId: 0, hidden: false, muted: false, joinedAt: t }, { conv: id, member: target, role: 'member', lastReadId: 0, clearedBeforeId: 0, hidden: false, muted: false, joinedAt: t });
      }
      const m = s.members.find((x) => x.conv === id && x.member === me.id);
      if (m) m.hidden = false;
      const seq = this.log(s, { conv: id, kind: 'conv', messageId: null, actor: me.id, target: null, data: { status } });
      queueMicrotask(() => this.h.emit([me.id], { t: 'conv', seq, conversationId: id, status }));
    });
    const c = this.st().convs.find((x) => x.id === id)!;
    return { conversation: this.toConversation(c, this.mem(id, me.id)!, me.id), created: true };
  }

  list(headers: Record<string, string>, q: URLSearchParams) {
    const me = this.h.memberFrom(headers);
    this.welcome(me);
    this.touchSeen(me.id);
    const box = q.get('box') === 'requests' ? 'requests' : 'inbox';
    const limit = Math.min(50, clampPage(q.get('limit')));
    const cur = decodeConvCursor(q.get('cursor'));
    const rows = this.st()
      .convs.filter((c) => {
        if (c.kind !== 'dm') return false;
        const m = this.mem(c.id, me.id);
        if (!m || m.hidden) return false;
        const peer = this.peerOf(c, me.id)!;
        if (this.h.social.rel(me.id, peer).blockedBy) return false;
        return box === 'requests' ? c.status === 'request' && c.requestedBy !== me.id && c.lastMessageId != null : c.status === 'active' || c.requestedBy === me.id;
      })
      .sort((x, y) => (x.lastAt === y.lastAt ? y.id - x.id : x.lastAt < y.lastAt ? 1 : -1))
      .filter((c) => !cur || c.lastAt < cur.lastAt || (c.lastAt === cur.lastAt && c.id < cur.id));
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return { items: page.map((c) => this.toConversation(c, this.mem(c.id, me.id)!, me.id)), nextCursor: rows.length > limit && last ? encodeConvCursor(last.lastAt, last.id) : null, unread: this.unreadTotals(me.id) };
  }

  unreadTotals(me: number): { total: number; requests: number } {
    let total = 0;
    let requests = 0;
    for (const c of this.st().convs) {
      if (c.kind !== 'dm') continue;
      const m = this.mem(c.id, me);
      if (!m || m.hidden || m.muted) continue;
      if (this.h.social.rel(me, this.peerOf(c, me)!).blockedBy) continue;
      const n = this.unreadOf(c, m, me);
      if (!n) continue;
      if (c.status === 'request' && c.requestedBy !== me) requests++;
      else if (c.status === 'active') total += n;
    }
    return { total, requests };
  }

  get(headers: Record<string, string>, id: number) {
    const me = this.h.memberFrom(headers);
    const { c, mine, peer } = this.loadConv(id, me.id);
    const rel = peer != null ? this.h.social.rel(me.id, peer) : null;
    return { conversation: this.toConversation(c, mine, me.id), viewer: { blocked: !!rel?.blocked, canSend: canSend({ kind: 'dm', status: c.status, isRequester: c.requestedBy === me.id, myCountWhilePending: c.status === 'request' ? this.pendingCount(c.id, me.id) : 0, blockedEither: !!rel?.blocked }).ok } };
  }

  messages(headers: Record<string, string>, id: number, q: URLSearchParams) {
    const me = this.h.memberFrom(headers);
    const { mine } = this.loadConv(id, me.id);
    const limit = clampPage(q.get('limit'));
    const before = parseId(q.get('before'));
    const after = parseId(q.get('after'));
    let rows = this.st().messages.filter((x) => x.conv === id && x.id > mine.clearedBeforeId && (before == null || x.id < before) && (after == null || x.id > after) && !this.isHidden(me.id, x.id));
    rows = after != null ? rows.sort((x, y) => x.id - y.id) : rows.sort((x, y) => y.id - x.id);
    const page = rows.slice(0, limit);
    const items = page.map((r) => this.toMessage(r, me.id));
    if (after == null) items.reverse();
    const hasMore = rows.length > limit;
    return { items, hasMore, nextBefore: after == null && hasMore && items[0] ? items[0].id : null };
  }

  send(headers: Record<string, string>, id: number, input: unknown) {
    const me = this.h.memberFrom(headers);
    this.touchSeen(me.id);
    const { c, peer } = this.loadConv(id, me.id);
    const o = (input ?? {}) as { body?: unknown; clientId?: unknown };
    const b = checkBody(o.body);
    if (!b.ok) throw bad('body', b.message);
    const clientId = o.clientId == null ? null : checkClientId(o.clientId);
    if (o.clientId != null && !clientId) throw bad('clientId', 'clientId 格式不正确');
    if (clientId) {
      const dup = this.st().messages.find((x) => x.conv === id && x.sender === me.id && x.clientId === clientId);
      if (dup) return { status: 200, body: { message: this.toMessage(dup, me.id), duplicate: true } };
    }
    const rel = peer != null ? this.h.social.rel(me.id, peer) : null;
    const can = canSend({ kind: 'dm', status: c.status, isRequester: c.requestedBy === me.id, myCountWhilePending: c.status === 'request' ? this.pendingCount(id, me.id) : 0, blockedEither: !!(rel?.blocked || rel?.blockedBy) });
    if (!can.ok) throw new SocialError(can.status, can.code, can.message);
    const lim = limitsFor(me.joinedAt, this.h.now().getTime());
    this.h.social.limit(`dm-msg:${me.id}`, lim.msgsPerMin, 60_000, '发送太快了，请稍等一会儿');
    const msg = this.insert(id, me.id, b.value, clientId, peer);
    if (peer != null && SEED_IDS.has(peer)) this.autoReply(id, peer);
    return { status: 201, body: { message: this.toMessage(msg, me.id), duplicate: false } };
  }

  private insert(conv: number, sender: number, body: string, clientId: string | null, peer: number | null): DMsg {
    const t = this.iso();
    let msg!: DMsg;
    let seq = 0;
    this.h.commit((s) => {
      msg = { id: s.nextId++, conv, sender, body, clientId, createdAt: t, recalledAt: null, removedBy: null };
      s.messages.push(msg);
      const c = s.convs.find((x) => x.id === conv)!;
      c.lastMessageId = msg.id;
      c.lastAt = t;
      for (const m of s.members) if (m.conv === conv) {
        m.hidden = false;
        if (m.member === sender) m.lastReadId = msg.id;
      }
      seq = this.log(s, { conv, kind: 'msg', messageId: msg.id, actor: sender, target: null, data: {} });
    });
    const to = peer != null ? [sender, peer] : [sender];
    for (const uid of to) this.h.emit([uid], { t: 'msg', seq, conversationId: conv, message: this.toMessage(msg, uid) });
    return msg;
  }

  /** 演示：某个标签页切换成示例用户后，6 小时内由真人替它回复 */
  markActing(seedId: number): void {
    this.h.commit((s) => {
      s.acting = { ...(s.acting ?? {}), [String(seedId)]: this.h.now().getTime() };
    });
  }

  /** 示例用户（虚构）：接受请求并回复，演示实时到达。每个会话 20 秒内最多自动回复一次。 */
  private autoReply(conv: number, seedId: number): void {
    const now = this.h.now().getTime();
    if ((this.st().acting?.[String(seedId)] ?? 0) > now - 6 * 3600_000) return;
    if ((this.lastAuto.get(conv) ?? 0) > now - 20_000) return;
    this.lastAuto.set(conv, now);
    this.h.schedule(() => {
      const c = this.st().convs.find((x) => x.id === conv);
      if (!c) return;
      const other = this.peerOf(c, seedId);
      if (other == null || this.h.social.rel(seedId, other).blocked || this.h.social.rel(seedId, other).blockedBy) return;
      if (c.status === 'request' && c.requestedBy !== seedId) {
        let seq = 0;
        this.h.commit((s) => {
          s.convs.find((x) => x.id === conv)!.status = 'active';
          seq = this.log(s, { conv, kind: 'conv', messageId: null, actor: seedId, target: null, data: { status: 'active' } });
        });
        this.h.emit([other], { t: 'conv', seq, conversationId: conv, status: 'active' });
      }
      if (this.st().convs.find((x) => x.id === conv)?.status !== 'active') return;
      // 示例用户读了消息（已读回执）再回复
      const last = this.st().convs.find((x) => x.id === conv)!.lastMessageId ?? 0;
      this.readAs(seedId, conv, last);
      const n = this.st().messages.filter((x) => x.conv === conv && x.sender === seedId).length;
      this.h.schedule(() => this.insert(conv, seedId, SEED_REPLIES[n % SEED_REPLIES.length]!, null, other), 900);
    }, 900);
  }

  private readAs(me: number, conv: number, want: number): number {
    const c = this.st().convs.find((x) => x.id === conv)!;
    const mine = this.mem(conv, me)!;
    const next = Math.min(Math.max(mine.lastReadId, want), c.lastMessageId ?? 0);
    if (next <= mine.lastReadId) return mine.lastReadId;
    const peer = this.peerOf(c, me);
    const u = this.user(me)?.username ?? '';
    const vis = peer != null && receiptsVisible(this.settingsOf(me).readReceipts, this.settingsOf(peer).readReceipts);
    let s1 = 0;
    let s2 = 0;
    this.h.commit((s) => {
      s.members.find((x) => x.conv === conv && x.member === me)!.lastReadId = next;
      s1 = this.log(s, { conv, kind: 'read', messageId: null, actor: me, target: me, data: { lastReadId: next } });
      if (vis) s2 = this.log(s, { conv, kind: 'read', messageId: null, actor: me, target: peer, data: { lastReadId: next } });
    });
    this.h.emit([me], { t: 'read', seq: s1, conversationId: conv, username: u, lastReadId: next });
    if (vis && peer != null) this.h.emit([peer], { t: 'read', seq: s2, conversationId: conv, username: u, lastReadId: next });
    return next;
  }

  read(headers: Record<string, string>, id: number, input: unknown) {
    const me = this.h.memberFrom(headers);
    const { c, mine } = this.loadConv(id, me.id);
    const want = parseId(String((input as { lastReadId?: unknown } | null)?.lastReadId ?? c.lastMessageId ?? 0)) ?? 0;
    if (Math.min(Math.max(mine.lastReadId, want), c.lastMessageId ?? 0) <= mine.lastReadId) return { lastReadId: mine.lastReadId };
    return { lastReadId: this.readAs(me.id, id, want) };
  }

  respond(headers: Record<string, string>, id: number, action: 'accept' | 'decline' | 'block') {
    const me = this.h.memberFrom(headers);
    const { c, peer } = this.loadConv(id, me.id);
    if (c.status !== 'request' || c.requestedBy === me.id || peer == null) throw new SocialError(409, 'not_a_request', '这不是等待你处理的消息请求');
    if (action === 'block') {
      const u = this.user(peer);
      if (u) this.h.social.relation(headers, u.username, 'block', true);
    }
    const status: ConvStatus = action === 'accept' ? 'active' : 'declined';
    let seq = 0;
    this.h.commit((s) => {
      s.convs.find((x) => x.id === id)!.status = status;
      if (status === 'declined') {
        s.declines = s.declines.filter((d) => !(d.requester === peer && d.target === me.id));
        s.declines.push({ requester: peer, target: me.id, untilMs: this.h.now().getTime() + DECLINE_COOLDOWN_DAYS * 86400_000 });
        s.members.find((x) => x.conv === id && x.member === me.id)!.hidden = true;
      }
      seq = this.log(s, { conv: id, kind: 'conv', messageId: null, actor: me.id, target: null, data: { status } });
    });
    this.h.emit(action === 'block' ? [me.id] : [me.id, peer], { t: 'conv', seq, conversationId: id, status });
    return { status };
  }

  hide(headers: Record<string, string>, id: number) {
    const me = this.h.memberFrom(headers);
    const { c } = this.loadConv(id, me.id);
    let seq = 0;
    this.h.commit((s) => {
      const m = s.members.find((x) => x.conv === id && x.member === me.id)!;
      m.hidden = true;
      m.clearedBeforeId = c.lastMessageId ?? 0;
      m.lastReadId = Math.max(m.lastReadId, c.lastMessageId ?? 0);
      seq = this.log(s, { conv: id, kind: 'conv', messageId: null, actor: me.id, target: me.id, data: { status: 'hidden' } });
    });
    this.h.emit([me.id], { t: 'conv', seq, conversationId: id, status: 'hidden' });
    return { hidden: true };
  }

  private loadMessage(mid: number, me: number): { m: DMsg; c: DConv; peer: number | null } {
    const m = this.st().messages.find((x) => x.id === mid);
    if (!m) throw notFound('消息不存在');
    const c = this.st().convs.find((x) => x.id === m.conv);
    if (!c) throw notFound('消息不存在');
    if (c.kind === 'dm') {
      const { peer, mine } = this.loadConv(c.id, me);
      if (m.id <= mine.clearedBeforeId) throw notFound('消息不存在');
      return { m, c, peer };
    }
    if (!this.mem(c.id, me)) throw notFound('消息不存在');
    return { m, c, peer: null };
  }

  deleteForMe(headers: Record<string, string>, mid: number) {
    const me = this.h.memberFrom(headers);
    const { m } = this.loadMessage(mid, me.id);
    let seq = 0;
    this.h.commit((s) => {
      if (!s.hidden.includes(`${me.id}:${mid}`)) s.hidden.push(`${me.id}:${mid}`);
      seq = this.log(s, { conv: m.conv, kind: 'remove', messageId: mid, actor: me.id, target: me.id, data: { forMe: true } });
    });
    this.h.emit([me.id], { t: 'remove', seq, conversationId: m.conv, messageId: mid });
    return { deleted: true };
  }

  recall(headers: Record<string, string>, mid: number) {
    const me = this.h.memberFrom(headers);
    const { m, c, peer } = this.loadMessage(mid, me.id);
    const can = canRecall({ isSender: m.sender === me.id, createdAt: m.createdAt, now: this.h.now().getTime(), recalled: !!m.recalledAt });
    if (!can.ok) throw new SocialError(can.status, can.code, can.message);
    let seq = 0;
    this.h.commit((s) => {
      const x = s.messages.find((y) => y.id === mid)!;
      x.recalledAt = this.iso();
      x.body = '-';
      seq = this.log(s, { conv: c.id, kind: 'recall', messageId: mid, actor: me.id, target: null, data: {} });
    });
    const to = c.kind === 'room' ? this.st().members.filter((x) => x.conv === c.id).map((x) => x.member) : peer != null ? [me.id, peer] : [me.id];
    this.h.emit(to, { t: 'recall', seq, conversationId: c.id, messageId: mid });
    return { recalled: true };
  }

  report(headers: Record<string, string>, mid: number, input: unknown) {
    const me = this.h.memberFrom(headers);
    this.h.social.limit(`report:${me.id}`, 10, 3_600_000, '举报太频繁，请稍后再试');
    const o = (input ?? {}) as { reason?: unknown; detail?: unknown };
    const reason = typeof o.reason === 'string' && REPORT_REASONS.includes(o.reason) ? o.reason : null;
    if (!reason) throw bad('reason', `reason 只能是 ${REPORT_REASONS.join(' / ')}`);
    const detail = typeof o.detail === 'string' ? o.detail.trim().slice(0, 300) : '';
    const { m } = this.loadMessage(mid, me.id);
    if (m.sender === me.id) throw new SocialError(400, 'self', '不能举报自己的消息');
    if (m.sender == null) throw notFound('消息不存在');
    if (m.recalledAt) throw new SocialError(409, 'already_recalled', '消息已被撤回');
    const text = `[私信 #${mid}] ${excerpt(m.body, 120)}${detail ? ` | ${detail}` : ''}`.slice(0, 500);
    const reportId = this.h.ugc.fileUserReport(me.id, m.sender, reason, text);
    this.h.commit((s) => {
      if (!s.reports.some((r) => r.reportId === reportId && r.messageId === mid)) s.reports.push({ reportId, messageId: mid, conv: m.conv, reporter: me.id, snapshot: m.body, createdAt: this.iso() });
    });
    return { reported: true, reportId };
  }

  sync(headers: Record<string, string>, q: URLSearchParams) {
    const me = this.h.memberFrom(headers);
    this.touchSeen(me.id);
    const since = parseId(q.get('since'));
    const s = this.st();
    if (since == null) return { events: [], seq: s.seq, hasMore: false, unread: this.unreadTotals(me.id) };
    const rows = s.changes.filter((ch) => {
      if (ch.seq <= since) return false;
      if (ch.target != null && ch.target !== me.id) return false;
      const c = s.convs.find((x) => x.id === ch.conv);
      if (!c || !this.mem(c.id, me.id)) return false;
      if (c.kind === 'dm' && this.h.social.rel(me.id, this.peerOf(c, me.id)!).blockedBy) return false;
      return true;
    });
    const page = rows.slice(0, 200);
    const events: DmEvent[] = [];
    for (const ch of page) {
      if (ch.kind === 'msg' && ch.messageId) {
        const mine = this.mem(ch.conv, me.id)!;
        if (ch.messageId <= mine.clearedBeforeId || this.isHidden(me.id, ch.messageId)) continue;
        const m = s.messages.find((x) => x.id === ch.messageId);
        if (m) events.push({ t: 'msg', seq: ch.seq, conversationId: ch.conv, message: this.toMessage(m, me.id) });
      } else if (ch.kind === 'recall' && ch.messageId) events.push({ t: 'recall', seq: ch.seq, conversationId: ch.conv, messageId: ch.messageId });
      else if (ch.kind === 'remove' && ch.messageId) events.push({ t: 'remove', seq: ch.seq, conversationId: ch.conv, messageId: ch.messageId });
      else if (ch.kind === 'read') events.push({ t: 'read', seq: ch.seq, conversationId: ch.conv, username: this.user(ch.actor)?.username ?? '', lastReadId: Number(ch.data.lastReadId) || 0 });
      else if (ch.kind === 'conv') events.push({ t: 'conv', seq: ch.seq, conversationId: ch.conv, status: (ch.data.status as ConvStatus | 'hidden') ?? 'active' });
    }
    const last = page[page.length - 1];
    return { events, seq: last ? last.seq : s.seq, hasMore: rows.length > 200, unread: this.unreadTotals(me.id) };
  }

  getSettings(headers: Record<string, string>) {
    return { settings: this.settingsOf(this.h.memberFrom(headers).id) };
  }
  putSettings(headers: Record<string, string>, input: unknown) {
    const me = this.h.memberFrom(headers);
    const cur = this.settingsOf(me.id);
    const o = (input ?? {}) as Record<string, unknown>;
    const policy = o.policy === undefined ? cur.policy : checkPolicy(o.policy);
    if (!policy) throw bad('policy', 'policy 只能是 everyone / followers / mutuals / nobody');
    const next: DmSettings = { policy, readReceipts: o.readReceipts === undefined ? cur.readReceipts : !!o.readReceipts, showPresence: o.showPresence === undefined ? cur.showPresence : !!o.showPresence };
    this.h.commit((s) => (s.settings[String(me.id)] = next));
    return { settings: next };
  }

  presence(headers: Record<string, string>, q: URLSearchParams) {
    const me = this.h.memberFrom(headers);
    this.touchSeen(me.id);
    const names = [...new Set((q.get('u') ?? '').split(',').map((x) => x.trim()).filter((x) => /^[A-Za-z0-9_]{3,20}$/.test(x)))].slice(0, 20);
    const out: Record<string, boolean | null> = {};
    const now = this.h.now().getTime();
    for (const n of names) {
      let id: number;
      try {
        id = this.h.social.byUsername(n).memberId;
      } catch {
        out[n] = null;
        continue;
      }
      const rel = id === me.id ? null : this.h.social.rel(me.id, id);
      const [a, b] = me.id < id ? [me.id, id] : [id, me.id];
      const conv = this.st().convs.find((c) => c.kind === 'dm' && c.a === a && c.b === b);
      const related = !!rel && ((rel.following && rel.followedBy) || conv?.status === 'active');
      const ok = canSeePresence({ self: id === me.id, showPresence: this.settingsOf(id).showPresence, blockedEither: !!(rel?.blocked || rel?.blockedBy), related });
      out[n] = ok ? (SEED_IDS.has(id) ? SEED_ONLINE[id]! : (this.st().seen[String(id)] ?? 0) > now - 45_000) : null;
    }
    return { presence: out };
  }

  // ------------------------------------------------------------ 活动聊天室
  private room(slug: string): DConv | undefined {
    return this.st().convs.find((c) => c.kind === 'room' && c.eventSlug === slug);
  }
  private roomItems(r: DConv, me: number, after: number | null): DmMessage[] {
    const now = this.h.now().getTime();
    const blocked = new Set(this.h.social.socialState().relations.filter((x) => x.owner === me && x.kind === 'block').map((x) => x.target));
    return this.st()
      .messages.filter((m) => m.conv === r.id && (after == null || m.id > after) && m.removedBy == null && !(m.sender != null && blocked.has(m.sender)) && !this.isHidden(me, m.id))
      .filter((m) => roomMessageVisible({ retention: r.retention, ttlHours: r.ttlHours, createdAt: m.createdAt, now }))
      .sort((a, b) => a.id - b.id)
      .slice(-50)
      .map((m) => this.toMessage(m, me));
  }
  getRoom(headers: Record<string, string>, slug: string, q: URLSearchParams) {
    const me = this.h.memberFrom(headers);
    const r = this.room(slug);
    if (!r) throw notFound('这个活动没有开启聊天室');
    const role = this.mem(r.id, me.id)?.role ?? null;
    return {
      room: { id: r.id, slug, title: r.title, retention: r.retention, ttlHours: r.ttlHours, closed: r.closed, joined: !!role, moderator: role === 'moderator', members: this.st().members.filter((m) => m.conv === r.id).length },
      items: this.roomItems(r, me.id, parseId(q.get('after'))),
    };
  }
  postRoom(headers: Record<string, string>, slug: string, input: unknown) {
    const me = this.h.memberFrom(headers);
    const r = this.room(slug);
    if (!r) throw notFound('这个活动没有开启聊天室');
    const can = canSend({ kind: 'room', status: 'active', isRequester: false, myCountWhilePending: 0, blockedEither: false, closed: r.closed });
    if (!can.ok) throw new SocialError(can.status, can.code, can.message);
    const o = (input ?? {}) as { body?: unknown; clientId?: unknown };
    const b = checkBody(o.body, ROOM_MAX_BODY);
    if (!b.ok) throw bad('body', b.message);
    const clientId = o.clientId == null ? null : checkClientId(o.clientId);
    if (clientId) {
      const dup = this.st().messages.find((x) => x.conv === r.id && x.sender === me.id && x.clientId === clientId);
      if (dup) return { status: 200, body: { message: this.toMessage(dup, me.id), duplicate: true } };
    }
    const lim = limitsFor(me.joinedAt, this.h.now().getTime());
    this.h.social.limit(`room-msg:${me.id}`, lim.roomPerMin, 60_000, '发言太快了，请稍等一会儿');
    const t = this.iso();
    let msg!: DMsg;
    let seq = 0;
    this.h.commit((s) => {
      if (!s.members.some((m) => m.conv === r.id && m.member === me.id)) s.members.push({ conv: r.id, member: me.id, role: 'member', lastReadId: 0, clearedBeforeId: 0, hidden: false, muted: false, joinedAt: t });
      msg = { id: s.nextId++, conv: r.id, sender: me.id, body: b.value, clientId, createdAt: t, recalledAt: null, removedBy: null };
      s.messages.push(msg);
      const c = s.convs.find((x) => x.id === r.id)!;
      c.lastMessageId = msg.id;
      c.lastAt = t;
      if (c.retention === 'ephemeral') {
        const cut = this.h.now().getTime() - c.ttlHours * 3600_000;
        s.messages = s.messages.filter((m) => m.conv !== r.id || Date.parse(m.createdAt) >= cut);
      }
      seq = this.log(s, { conv: r.id, kind: 'msg', messageId: msg.id, actor: me.id, target: null, data: {} });
    });
    // 聊天室广播（相当于 Worker 的房间 Durable Object：所有正在看的人都收到，不只是发过言的成员）：
    // 负数 id = 房间频道；from 让每个标签页自己判断 mine
    this.h.emit([-r.id], { t: 'msg', seq, conversationId: r.id, message: { ...this.toMessage(msg, me.id), mine: false }, from: me.id } as DmEvent);
    return { status: 201, body: { message: this.toMessage(msg, me.id), duplicate: false } };
  }
  removeRoomMessage(actor: number | 'admin', slug: string | null, mid: number) {
    const m = this.st().messages.find((x) => x.id === mid);
    const c = m ? this.st().convs.find((x) => x.id === m.conv) : undefined;
    if (!m || !c || c.kind !== 'room' || (slug && c.eventSlug !== slug)) throw notFound('消息不存在');
    if (actor !== 'admin' && m.sender !== actor && this.mem(c.id, actor)?.role !== 'moderator') throw new SocialError(403, 'forbidden', '只有聊天室管理员可以移除别人的消息');
    let seq = 0;
    this.h.commit((s) => {
      const x = s.messages.find((y) => y.id === mid)!;
      x.removedBy = actor === 'admin' ? 0 : actor;
      x.body = '-';
      seq = this.log(s, { conv: c.id, kind: 'remove', messageId: mid, actor: actor === 'admin' ? null : actor, target: null, data: {} });
    });
    this.h.emit([-c.id], { t: 'remove', seq, conversationId: c.id, messageId: mid });
    return { removed: true };
  }
  configureRoom(slug: string, input: unknown, title: string | null) {
    if (title == null) throw notFound('活动不存在');
    const c = checkRoomConfig(input);
    if (!c.ok) throw bad('room', c.message);
    const v = c.value;
    const ex = this.room(slug);
    if (!v.enabled) {
      if (ex) this.h.commit((s) => {
        s.convs = s.convs.filter((x) => x.id !== ex.id);
        s.messages = s.messages.filter((x) => x.conv !== ex.id);
        s.members = s.members.filter((x) => x.conv !== ex.id);
      });
      return { room: null };
    }
    let id = ex?.id ?? 0;
    const t = this.iso();
    this.h.commit((s) => {
      if (ex) Object.assign(s.convs.find((x) => x.id === ex.id)!, { retention: v.retention, ttlHours: v.ttlHours, closed: v.closed, title });
      else {
        id = s.nextId++;
        s.convs.push({ id, kind: 'room', a: null, b: null, eventSlug: slug, title, status: 'active', requestedBy: null, retention: v.retention, ttlHours: v.ttlHours, closed: v.closed, createdAt: t, lastMessageId: null, lastAt: t });
      }
    });
    return { room: { id, slug, retention: v.retention, ttlHours: v.ttlHours, closed: v.closed } };
  }

  exportFor(id: number) {
    const s = this.st();
    return {
      dmSettings: this.settingsOf(id),
      directMessages: s.messages
        .filter((m) => m.sender === id && !m.recalledAt && m.removedBy == null)
        .map((m) => {
          const c = s.convs.find((x) => x.id === m.conv);
          return { conversation_id: m.conv, kind: c?.kind ?? 'dm', peer: c ? (this.user(this.peerOf(c, id))?.username ?? null) : null, body: m.body, created_at: m.createdAt, recalled_at: null };
        }),
    };
  }
  purge(id: number): void {
    this.h.commit((s) => {
      const gone = new Set(s.convs.filter((c) => c.kind === 'dm' && (c.a === id || c.b === id)).map((c) => c.id));
      s.convs = s.convs.filter((c) => !gone.has(c.id));
      s.messages = s.messages.filter((m) => m.sender !== id && !gone.has(m.conv));
      s.members = s.members.filter((m) => m.member !== id && !gone.has(m.conv));
      s.hidden = s.hidden.filter((h) => !h.startsWith(`${id}:`));
      s.declines = s.declines.filter((d) => d.requester !== id && d.target !== id);
      delete s.settings[String(id)];
      delete s.seen[String(id)];
    });
  }

  route(m: string, sub: string, q: URLSearchParams, body: unknown, headers: Record<string, string>): { status: number; body: unknown } | null {
    if (!sub.startsWith('/dm/') && !sub.startsWith('/rooms/')) return null;
    const ok = (b: unknown, status = 200) => ({ status, body: b });
    const SLUG = '([a-z0-9][a-z0-9-]{1,39})';
    let mt: RegExpExecArray | null;
    if (sub === '/dm/ws' || /^\/rooms\/[^/]+\/ws$/.test(sub)) return ok({ error: { code: 'realtime_unavailable', message: '演示站在浏览器里模拟实时（BroadcastChannel），没有 WebSocket 服务器' } }, 503);
    if (m === 'GET') {
      if (sub === '/dm/conversations') return ok(this.list(headers, q));
      if ((mt = /^\/dm\/conversations\/(\d{1,12})$/.exec(sub))) return ok(this.get(headers, Number(mt[1])));
      if ((mt = /^\/dm\/conversations\/(\d{1,12})\/messages$/.exec(sub))) return ok(this.messages(headers, Number(mt[1]), q));
      if (sub === '/dm/unread') return ok(this.unreadTotals(this.h.memberFrom(headers).id));
      if (sub === '/dm/sync') return ok(this.sync(headers, q));
      if (sub === '/dm/settings') return ok(this.getSettings(headers));
      if (sub === '/dm/presence') return ok(this.presence(headers, q));
      if ((mt = new RegExp(`^/rooms/${SLUG}$`).exec(sub))) return ok(this.getRoom(headers, mt[1]!, q));
      return null;
    }
    if (sub === '/dm/conversations' && m === 'POST') {
      const r = this.start(headers, body);
      return ok(r, r.created ? 201 : 200);
    }
    if ((mt = /^\/dm\/conversations\/(\d{1,12})\/messages$/.exec(sub)) && m === 'POST') return this.send(headers, Number(mt[1]), body);
    if ((mt = /^\/dm\/conversations\/(\d{1,12})\/read$/.exec(sub)) && m === 'POST') return ok(this.read(headers, Number(mt[1]), body));
    if ((mt = /^\/dm\/conversations\/(\d{1,12})\/(accept|decline|block)$/.exec(sub)) && m === 'POST') return ok(this.respond(headers, Number(mt[1]), mt[2] as 'accept' | 'decline' | 'block'));
    if ((mt = /^\/dm\/conversations\/(\d{1,12})$/.exec(sub)) && m === 'DELETE') return ok(this.hide(headers, Number(mt[1])));
    if ((mt = /^\/dm\/messages\/(\d{1,12})$/.exec(sub)) && m === 'DELETE') return ok(this.deleteForMe(headers, Number(mt[1])));
    if ((mt = /^\/dm\/messages\/(\d{1,12})\/recall$/.exec(sub)) && m === 'POST') return ok(this.recall(headers, Number(mt[1])));
    if ((mt = /^\/dm\/messages\/(\d{1,12})\/report$/.exec(sub)) && m === 'POST') return ok(this.report(headers, Number(mt[1]), body), 201);
    if (sub === '/dm/settings' && (m === 'PUT' || m === 'PATCH')) return ok(this.putSettings(headers, body));
    if (sub === '/dm/ticket' && m === 'POST') {
      this.h.memberFrom(headers);
      return ok({ realtime: false, reason: 'demo' });
    }
    if ((mt = new RegExp(`^/rooms/${SLUG}/messages$`).exec(sub)) && m === 'POST') return this.postRoom(headers, mt[1]!, body);
    if ((mt = new RegExp(`^/rooms/${SLUG}/messages/(\\d{1,12})$`).exec(sub)) && m === 'DELETE') return ok(this.removeRoomMessage(this.h.memberFrom(headers).id, mt[1]!, Number(mt[2])));
    return null;
  }

  /** 后台 /api/admin/rooms/*、/api/admin/dm/reports/:id（调用前已校验登录与 CSRF）。 */
  routeAdmin(m: string, sub: string, body: unknown, eventTitle: (slug: string) => string | null): { status: number; body: unknown } | null {
    const ok = (b: unknown) => ({ status: 200, body: b });
    let mt: RegExpExecArray | null;
    if ((mt = /^\/rooms\/([a-z0-9][a-z0-9-]{1,39})$/.exec(sub)) && (m === 'PUT' || m === 'POST')) return ok(this.configureRoom(mt[1]!, body, eventTitle(mt[1]!)));
    if ((mt = /^\/rooms\/messages\/(\d{1,12})$/.exec(sub)) && m === 'DELETE') return ok(this.removeRoomMessage('admin', null, Number(mt[1])));
    if ((mt = /^\/dm\/reports\/(\d{1,12})$/.exec(sub)) && m === 'GET') {
      const id = Number(mt[1]);
      return ok({ items: this.st().reports.filter((r) => r.reportId === id).map((r) => ({ message_id: r.messageId, conversation_id: r.conv, snapshot: r.snapshot, created_at: r.createdAt })) });
    }
    return null;
  }
}
