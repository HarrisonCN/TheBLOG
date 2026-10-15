/**
 * L19 私信前端（按需加载：只在 /messages/…、活动聊天室、用户主页点「私信」时才下载）：
 * 收件箱、会话、消息请求（接受 / 婉拒 / 拉黑）、私信设置（谁能私信我 / 已读回执 / 在线状态）、活动聊天室。
 * 实时：POST /dm/ticket → WebSocket（只推送）；连接不上 / 没有绑定 → 轮询 /dm/sync?since=；断线重连后用 since 补齐。
 * 演示站：同一浏览器的标签页之间用 BroadcastChannel 模拟实时（demo/client.ts），不连任何服务器。
 * 无障碍：新消息通过 aria-live 区域播报（只读摘要）；会话列表与消息操作都可以用键盘完成；尊重「减少动态效果」。
 * 所有权限（参与者、拉黑、隐私开关、限流）都在服务端判断，前端只负责显示。
 */
import './dm.css';
import { API_BASE, ApiError, DEMO, request } from './api';
import { currentMember } from './community';
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { url, userPath } from './render';
import {
  announceText,
  DM_POLICIES,
  DM_POLICY_LABEL,
  MAX_BODY,
  POLL_HIDDEN_MS,
  POLL_MS,
  RECALL_WINDOW_MS,
  REQUEST_PENDING_MAX,
  ROOM_MAX_BODY,
  ALT_MAX,
  DM_VOICE_MAX_MS,
  fmtDuration,
  backoffMs,
  type DmAttachment,
  type DmConversation,
  type DmEvent,
  type DmMessage,
  type DmSettings,
  type DmUser,
} from './dm-core';

type Notify = (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => Promise<void> | void;
export interface DmCtx { notify: Notify; navigate?: (href: string) => void }
interface Unread { total: number; requests: number }
interface RoomInfo { id: number; slug: string; title: string; retention: 'retained' | 'ephemeral'; ttlHours: number; closed: boolean; joined: boolean; moderator: boolean; members: number }

// ---------------------------------------------------------------- 请求
function auth(): Record<string, string> {
  const m = currentMember();
  return m ? { authorization: `Bearer ${m.token}` } : {};
}
const JSON_H = { 'content-type': 'application/json' };
const get = <T>(p: string) => request<T>(p, { headers: auth() });
const send = <T>(p: string, method: string, body?: unknown) => request<T>(p, { method, headers: { ...JSON_H, ...auth() }, body: JSON.stringify(body ?? {}) });
export const dm = {
  list: (box: 'inbox' | 'requests', cursor?: string | null) => get<{ items: DmConversation[]; nextCursor: string | null; unread: Unread }>(`/api/social/dm/conversations?box=${box}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  start: (username: string) => send<{ conversation: DmConversation; created: boolean }>('/api/social/dm/conversations', 'POST', { username }),
  conv: (id: number) => get<{ conversation: DmConversation; viewer: { blocked: boolean; canSend: boolean } }>(`/api/social/dm/conversations/${id}`),
  messages: (id: number, before?: number | null) => get<{ items: DmMessage[]; hasMore: boolean; nextBefore: number | null }>(`/api/social/dm/conversations/${id}/messages?limit=30${before ? `&before=${before}` : ''}`),
  send: (id: number, body: string, clientId: string, mediaId?: string) => send<{ message: DmMessage; duplicate: boolean }>(`/api/social/dm/conversations/${id}/messages`, 'POST', mediaId ? { body, clientId, mediaId } : { body, clientId }),
  /** L30：上传图片 / 语音（multipart；演示站在 demo/client.ts 里转成 data URL） */
  upload: (id: number, file: Blob, f: { kind: 'image' | 'voice'; alt?: string; durationMs?: number; width?: number; height?: number }) => {
    const fd = new FormData();
    fd.set('file', file, f.kind === 'image' ? 'image' : 'voice');
    fd.set('kind', f.kind);
    if (f.alt) fd.set('alt', f.alt);
    if (f.durationMs) fd.set('durationMs', String(Math.round(f.durationMs)));
    if (f.width) fd.set('width', String(f.width));
    if (f.height) fd.set('height', String(f.height));
    return request<{ media: DmAttachment & { id: string } }>(`/api/social/dm/conversations/${id}/media`, { method: 'POST', headers: auth(), body: fd, timeoutMs: 60_000 });
  },
  search: (q: string) => get<{ q: string; items: { message: DmMessage; field: 'body' | 'alt'; html: string; conversation: { id: number; peer: DmUser | null; title: string } }[] }>(`/api/social/dm/search?q=${encodeURIComponent(q)}`),
  read: (id: number, lastReadId: number) => send<{ lastReadId: number }>(`/api/social/dm/conversations/${id}/read`, 'POST', { lastReadId }),
  respond: (id: number, action: 'accept' | 'decline' | 'block') => send<{ status: string }>(`/api/social/dm/conversations/${id}/${action}`, 'POST'),
  hide: (id: number) => send<{ hidden: boolean }>(`/api/social/dm/conversations/${id}`, 'DELETE'),
  deleteForMe: (mid: number) => send<{ deleted: boolean }>(`/api/social/dm/messages/${mid}`, 'DELETE'),
  recall: (mid: number) => send<{ recalled: boolean }>(`/api/social/dm/messages/${mid}/recall`, 'POST'),
  report: (mid: number, reason: string, detail: string) => send<{ reported: boolean }>(`/api/social/dm/messages/${mid}/report`, 'POST', { reason, detail }),
  unread: () => get<Unread>('/api/social/dm/unread'),
  sync: (since: number | null) => get<{ events: DmEvent[]; seq: number; hasMore: boolean; unread: Unread }>(`/api/social/dm/sync${since == null ? '' : `?since=${since}`}`),
  settings: () => get<{ settings: DmSettings }>('/api/social/dm/settings'),
  saveSettings: (s: Partial<DmSettings>) => send<{ settings: DmSettings }>('/api/social/dm/settings', 'PUT', s),
  presence: (names: string[]) => get<{ presence: Record<string, boolean | null> }>(`/api/social/dm/presence?u=${names.map(encodeURIComponent).join(',')}`),
  ticket: (room?: string) => send<{ realtime: boolean; ticket?: string; path?: string; ttl?: number; reason?: string }>('/api/social/dm/ticket', 'POST', room ? { room } : {}),
  room: (slug: string, after?: number | null) => get<{ room: RoomInfo; items: DmMessage[] }>(`/api/social/rooms/${slug}${after ? `?after=${after}` : ''}`),
  roomSend: (slug: string, body: string, clientId: string) => send<{ message: DmMessage }>(`/api/social/rooms/${slug}/messages`, 'POST', { body, clientId }),
  roomRemove: (slug: string, mid: number) => send<{ removed: boolean }>(`/api/social/rooms/${slug}/messages/${mid}`, 'DELETE'),
};

const errMsg = (x: unknown) => (x instanceof ApiError ? x.message : '网络错误，请稍后再试');
const clientId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const TIME = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' });
function when(iso: string): string {
  const d = new Date(iso);
  return new Date().toDateString() === d.toDateString() ? TIME.format(d) : `${DAY.format(d)} ${TIME.format(d)}`;
}
function avatar(u: DmUser | null, cls = 'soc-av'): string {
  if (!u) return `<span class="${cls} soc-av--letter" aria-hidden="true">?</span>`;
  if (u.avatarUrl) return `<img class="${cls}" src="${e(u.avatarUrl.startsWith('/api/') ? API_BASE + u.avatarUrl : u.avatarUrl)}" alt="" loading="lazy" decoding="async">`;
  let h = 0;
  for (const ch of u.username) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `<span class="${cls} soc-av--letter" style="--h:${h}" aria-hidden="true">${e((u.nickname || u.username).slice(0, 1))}</span>`;
}
const LISTENERS = new WeakMap<HTMLElement, AbortController>();
function freshSignal(box: HTMLElement): AbortSignal {
  LISTENERS.get(box)?.abort();
  const ac = new AbortController();
  LISTENERS.set(box, ac);
  return ac.signal;
}
/** 页面换走（SPA 导航把容器移出文档）时停止实时连接 / 轮询 */
function whileMounted(box: HTMLElement, stop: () => void): void {
  const timer = setInterval(() => {
    if (!box.isConnected) {
      clearInterval(timer);
      stop();
    }
  }, 1500);
}
function gate(): string {
  return `<div class="soc-gate tile tile--full">${icon('lock')}<h2>登录后使用私信</h2><p class="muted">用邮箱验证码登录好朋友账号，就能和互相关注的人一对一聊天。</p><a class="btn btn--primary" href="${url('/join/')}">${icon('user')}登录 / 注册</a></div>`;
}

// ---------------------------------------------------------------- 实时（WebSocket → 轮询降级；演示站 BroadcastChannel）
type Listener = (ev: DmEvent) => void;
export class Live {
  private ws: WebSocket | null = null;
  private seq: number | null = null;
  private listeners = new Set<Listener>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private retry = 0;
  private stopped = false;
  private demoOff: (() => void) | null = null;
  mode: 'connecting' | 'realtime' | 'polling' | 'demo' | 'offline' = 'connecting';
  onMode: ((m: Live['mode']) => void) | null = null;
  constructor(private room?: string) {}

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(ev: DmEvent): void {
    if ('seq' in ev && typeof ev.seq === 'number' && ev.t !== 'hello') this.seq = Math.max(this.seq ?? 0, ev.seq);
    for (const fn of this.listeners) fn(ev);
  }
  private setMode(m: Live['mode']): void {
    this.mode = m;
    this.onMode?.(m);
  }

  async start(): Promise<void> {
    this.stopped = false;
    if (!this.room) {
      const s = await dm.sync(null).catch(() => null);
      this.seq = s?.seq ?? 0;
    }
    addEventListener('online', this.onOnline);
    addEventListener('offline', this.onOffline);
    document.addEventListener('visibilitychange', this.onVisible);
    if (DEMO) {
      const { onDemoDm } = await import('./demo/client');
      // 演示站模拟断网：离线期间收不到广播（和真实站点一样），恢复网络后用 /dm/sync?since= 补齐
      this.demoOff = onDemoDm((ev) => navigator.onLine !== false && this.emit(ev));
      this.setMode('demo');
      return;
    }
    await this.connect();
  }
  stop(): void {
    this.stopped = true;
    this.ws?.close(1000, 'bye');
    this.ws = null;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.demoOff?.();
    removeEventListener('online', this.onOnline);
    removeEventListener('offline', this.onOffline);
    document.removeEventListener('visibilitychange', this.onVisible);
  }
  private onOnline = () => void this.resync().then(() => (DEMO ? this.setMode('demo') : this.connect()));
  private onOffline = () => this.setMode('offline');
  private onVisible = () => {
    if (!document.hidden && this.mode === 'polling') {
      if (this.pollTimer) clearTimeout(this.pollTimer);
      void this.poll();
    }
  };

  private async connect(): Promise<void> {
    if (this.stopped || typeof WebSocket === 'undefined') return this.startPolling();
    let t: Awaited<ReturnType<typeof dm.ticket>>;
    try {
      t = await dm.ticket(this.room);
    } catch {
      return this.startPolling();
    }
    if (!t.realtime || !t.ticket || !t.path) return this.startPolling();
    const base = new URL(API_BASE || location.origin, location.href);
    const wsUrl = `${base.protocol === 'https:' ? 'wss:' : 'ws:'}//${base.host}${t.path}?ticket=${encodeURIComponent(t.ticket)}`;
    let opened = false;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;
    const ping = setInterval(() => ws.readyState === 1 && ws.send('ping'), 25_000);
    ws.addEventListener('open', () => {
      opened = true;
      this.retry = 0;
      if (this.pollTimer) clearTimeout(this.pollTimer);
      this.setMode('realtime');
      // 连接建立后补齐断线期间的变更（D1 是事实来源）
      void this.resync();
    });
    ws.addEventListener('message', (m) => {
      if (m.data === 'pong') return;
      try {
        const ev = JSON.parse(String(m.data)) as DmEvent;
        if (ev.t !== 'hello') this.emit(ev);
      } catch {
        /* 忽略坏数据 */
      }
    });
    ws.addEventListener('close', () => {
      clearInterval(ping);
      if (this.ws === ws) this.ws = null;
      if (this.stopped) return;
      // 连不上就轮询；连上过又断了 → 退避重连，期间轮询兜底
      this.startPolling();
      if (opened || this.retry < 3) {
        const wait = backoffMs(this.retry++); // dm-core 共享退避（1 s → 30 s 上限，单元测试覆盖）
        setTimeout(() => !this.stopped && navigator.onLine !== false && void this.connect(), wait);
      }
    });
  }

  private startPolling(): void {
    if (this.stopped) return;
    if (this.mode !== 'polling') this.setMode(navigator.onLine === false ? 'offline' : 'polling');
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.poll(), document.hidden ? POLL_HIDDEN_MS : POLL_MS);
  }
  private async poll(): Promise<void> {
    if (this.stopped || this.ws) return;
    await this.resync();
    this.startPolling();
  }
  /** 离线同步：会话用 /dm/sync?since=，聊天室用 after=最后一条 id（由聊天室视图处理） */
  async resync(): Promise<void> {
    if (this.room) {
      this.emit({ t: 'hello', seq: 0 });
      return;
    }
    try {
      let more = true;
      while (more && !this.stopped) {
        const r = await dm.sync(this.seq ?? 0);
        for (const ev of r.events) this.emit(ev);
        this.seq = Math.max(this.seq ?? 0, r.seq);
        more = r.hasMore;
        document.dispatchEvent(new CustomEvent('blog:dm-unread', { detail: r.unread }));
      }
      if (this.mode === 'offline' && navigator.onLine !== false) this.setMode(DEMO ? 'demo' : this.ws ? 'realtime' : 'polling');
    } catch {
      if (navigator.onLine === false) this.setMode('offline');
    }
  }
}

const MODE_TEXT: Record<Live['mode'], string> = { connecting: '正在连接…', realtime: '实时连接', polling: '自动刷新（实时连接不可用）', demo: '演示：标签页之间模拟实时', offline: '离线：恢复网络后自动同步' };
function modeChip(): string {
  return `<span class="dm-mode js-mode" data-mode="connecting"><span class="dm-mode__dot" aria-hidden="true"></span><span class="js-mode-text">${MODE_TEXT.connecting}</span></span>`;
}
function bindMode(box: HTMLElement, live: Live): void {
  live.onMode = (m) => {
    const el = box.querySelector<HTMLElement>('.js-mode');
    if (!el) return;
    el.dataset.mode = m;
    el.querySelector('.js-mode-text')!.textContent = MODE_TEXT[m];
  };
}
function announce(box: HTMLElement, text: string): void {
  const live = box.querySelector<HTMLElement>('.js-dm-live');
  if (!live) return;
  live.textContent = '';
  setTimeout(() => (live.textContent = text), 30);
}

// ---------------------------------------------------------------- 未读（导航小红点）
export async function refreshDmDot(): Promise<Unread | null> {
  if (!currentMember()) return null;
  try {
    const u = await dm.unread();
    paintDot(u);
    return u;
  } catch {
    return null;
  }
}
function paintDot(u: Unread): void {
  const n = u.total + u.requests;
  document.querySelectorAll<HTMLElement>('.js-dm-dot').forEach((d) => (d.hidden = n === 0));
  document.querySelectorAll<HTMLElement>('.nav__dm').forEach((a) => a.setAttribute('aria-label', n ? `私信（${u.total} 条未读${u.requests ? `，${u.requests} 个消息请求` : ''}）` : '私信'));
}

/** 用户主页「私信」按钮：发起（或打开已有）会话后跳转。 */
export async function startDm(username: string, ctx: DmCtx): Promise<void> {
  try {
    const r = await dm.start(username);
    const href = url(`/messages/c/${r.conversation.id}/`);
    if (ctx.navigate) ctx.navigate(href);
    else location.href = href;
  } catch (x) {
    void ctx.notify(errMsg(x), 'error');
  }
}

// ---------------------------------------------------------------- 挂载
export async function mountDm(box: HTMLElement, view: string, ctx: DmCtx): Promise<void> {
  if (!currentMember()) {
    box.innerHTML = `${gate()}${DEMO ? demoIdentity() : ''}`;
    bindDemoIdentity(box);
    return;
  }
  if (view === 'messages') return renderInbox(box, 'inbox', ctx);
  if (view === 'msgrequests') return renderInbox(box, 'requests', ctx);
  if (view === 'msgsettings') return renderSettings(box, ctx);
  if (view === 'conversation') return renderConversation(box, Number(box.dataset.id), ctx);
}

function tabs(active: 'inbox' | 'requests' | 'settings', u?: Unread): string {
  const t = (key: typeof active, href: string, label: string, n?: number) =>
    `<a class="dm-tab${key === active ? ' is-active' : ''}" href="${url(href)}"${key === active ? ' aria-current="page"' : ''}>${label}${n ? ` <span class="dm-badge" aria-label="${n} 个">${n > 99 ? '99+' : n}</span>` : ''}</a>`;
  return `<nav class="dm-tabs" aria-label="私信">${t('inbox', '/messages/', '收件箱', u?.total)}${t('requests', '/messages/requests/', '消息请求', u?.requests)}${t('settings', '/messages/settings/', '设置')}</nav>`;
}

/** 演示站：在本标签页切换为虚构示例用户，方便开两个标签页演示实时收发。 */
function demoIdentity(): string {
  const cur = currentMember();
  return `<section class="tile tile--full dm-demo" aria-labelledby="dm-demo-h"><h2 class="soc-h small" id="dm-demo-h">${icon('sparkles')}演示：两个标签页实时聊天</h2>
  <p class="muted small">再开一个标签页，在那里切换成示例用户（小林 / Momo，均为虚构），两边发消息会通过浏览器的 BroadcastChannel 实时出现。切换只影响当前标签页，数据只存在本机浏览器里。${cur ? `当前：<b>${e(cur.member.name)}</b>` : ''}</p>
  <p class="dm-demo__act"><button class="btn btn--soft btn--sm js-act-as" type="button" data-id="1">本标签页以「小林」身份</button><button class="btn btn--soft btn--sm js-act-as" type="button" data-id="2">本标签页以「Momo」身份</button>${sessionStorage.getItem('blog-member') ? '<button class="btn btn--ghost btn--sm js-act-reset" type="button">恢复我的账号</button>' : ''}</p></section>`;
}
function bindDemoIdentity(box: HTMLElement): void {
  if (!DEMO) return;
  box.querySelectorAll<HTMLButtonElement>('.js-act-as').forEach((b) =>
    b.addEventListener('click', async () => {
      const { backend } = await import('./demo/client');
      sessionStorage.setItem('blog-member', JSON.stringify(backend.actAs(Number(b.dataset.id))));
      location.reload();
    }),
  );
  box.querySelector('.js-act-reset')?.addEventListener('click', () => {
    sessionStorage.removeItem('blog-member');
    location.reload();
  });
}

function convItem(c: DmConversation, box: 'inbox' | 'requests'): string {
  const name = c.peer?.nickname ?? '已注销的用户';
  const last = c.lastMessage ? (c.lastMessage.recalled ? '消息已撤回' : `${c.lastMessage.mine ? '我：' : ''}${c.lastMessage.excerpt}`) : c.status === 'request' && c.requestedByMe ? '等待对方接受' : '还没有消息';
  const state = c.status === 'request' ? (c.requestedByMe ? '<span class="soc-chip soc-chip--soft">等待接受</span>' : '') : c.status === 'declined' ? '<span class="soc-chip soc-chip--soft">已婉拒</span>' : '';
  const label = `${name}${c.unread ? `，${c.unread} 条未读` : ''}：${last}`;
  return `<li class="dm-item${c.unread ? ' is-unread' : ''}" data-id="${c.id}">
  <a class="dm-item__link" href="${url(`/messages/c/${c.id}/`)}" aria-label="${e(label)}">
    ${avatar(c.peer)}
    <span class="dm-item__txt"><span class="dm-item__top"><b class="dm-item__name">${e(name)}</b>${state}<time class="muted small" datetime="${e(c.lastAt)}">${when(c.lastAt)}</time></span><span class="dm-item__last muted small">${e(last)}</span></span>
    ${c.unread ? `<span class="dm-badge" aria-hidden="true">${c.unread > 99 ? '99+' : c.unread}</span>` : ''}
  </a>
  ${box === 'requests' ? `<span class="dm-item__act"><button class="btn btn--primary btn--sm js-req" data-act="accept" type="button" aria-label="接受 ${e(name)} 的消息请求">${icon('check')}接受</button><button class="btn btn--soft btn--sm js-req" data-act="decline" type="button" aria-label="婉拒 ${e(name)} 的消息请求">婉拒</button><button class="btn btn--ghost btn--sm js-req" data-act="block" type="button" aria-label="拉黑 ${e(name)}">${icon('ban')}拉黑</button></span>` : ''}
</li>`;
}

async function renderInbox(box: HTMLElement, which: 'inbox' | 'requests', ctx: DmCtx): Promise<void> {
  let r = await dm.list(which);
  const signal = freshSignal(box);
  // L30：消息搜索（只搜自己的私信会话；服务端判断权限）
  let sq = '';
  let sres: Awaited<ReturnType<typeof dm.search>> | null = null;
  const searchBlock = () =>
    which !== 'inbox'
      ? ''
      : `<section class="tile tile--full dm-search" aria-labelledby="dm-search-h"><h2 class="soc-h small" id="dm-search-h">${icon('search')}搜索私信</h2><form class="dm-search__form js-dmsearch" role="search" novalidate><label class="visually-hidden" for="dm-search-q">搜索消息内容或图片说明</label><input id="dm-search-q" name="q" type="search" maxlength="50" value="${e(sq)}" placeholder="搜索消息内容或图片说明" autocomplete="off"><button class="btn btn--soft btn--sm" type="submit">${icon('search')}搜索</button></form>${
          sres
            ? sres.items.length
              ? `<p class="muted small js-dmsearch-count" role="status">找到 ${sres.items.length} 条</p><ul class="dm-hits" role="list">${sres.items
                  .map((h) => `<li><a class="dm-hit" href="${url(`/messages/c/${h.conversation.id}/`)}#m-${h.message.id}"><b>${e(h.conversation.title || '会话')}</b><span class="dm-hit__t">${h.field === 'alt' ? '[图片] ' : ''}${h.html}</span><time class="muted small" datetime="${e(h.message.createdAt)}">${when(h.message.createdAt)}</time></a></li>`)
                  .join('')}</ul>`
              : `<p class="muted small js-dmsearch-count" role="status">没有找到包含「${e(sq)}」的消息</p>`
            : ''
        }</section>`;
  const paint = () => {
    box.innerHTML = `<div class="dm">
  ${tabs(which, r.unread)}
  ${searchBlock()}
  <section class="tile tile--full dm-list-wrap" aria-labelledby="dm-list-h">
    <div class="dm-list-head"><h2 class="soc-h" id="dm-list-h">${icon(which === 'inbox' ? 'message' : 'envelope')}${which === 'inbox' ? '会话' : '消息请求'}</h2>${modeChip()}</div>
    ${which === 'requests' ? `<p class="muted small">还没有互相关注的人发来的消息会先放在这里。接受后才能回复；婉拒后对方 30 天内不能再次发起；也可以直接拉黑。对方看不到你是否读过请求。</p>` : ''}
    ${r.items.length ? `<ul class="dm-list" role="list">${r.items.map((c) => convItem(c, which)).join('')}</ul>` : `<p class="dm-empty muted">${which === 'inbox' ? '还没有会话。互相关注的好朋友可以直接私信；其他人需要先发消息请求。' : '没有待处理的消息请求。'}</p>`}
    ${r.nextCursor ? '<button class="btn btn--soft btn--sm js-more" type="button">加载更多</button>' : ''}
  </section>
  ${which === 'inbox' ? `<section class="tile tile--full" aria-labelledby="dm-new-h"><h2 class="soc-h small" id="dm-new-h">${icon('send')}发起私信</h2><form class="dm-new js-new" novalidate><div class="field"><label class="field__label" for="dm-new-u">对方的用户名</label><input id="dm-new-u" name="username" autocomplete="off" spellcheck="false" maxlength="20" pattern="[A-Za-z0-9_]{3,20}" required aria-describedby="dm-new-h2"><p class="muted small" id="dm-new-h2">也可以在对方主页点「私信」。对方没有回关时会作为消息请求发送。</p></div><p class="field__err js-err" role="alert" hidden></p><button class="btn btn--primary btn--sm" type="submit">${icon('send')}开始</button></form></section>` : ''}
  ${DEMO ? demoIdentity() : ''}
  <p class="visually-hidden js-dm-live" role="status" aria-live="polite"></p>
</div>`;
    bindDemoIdentity(box);
  };
  paint();
  paintDot(r.unread);
  box.addEventListener(
    'click',
    async (ev) => {
      const t = ev.target as HTMLElement;
      const more = t.closest('.js-more');
      if (more && r.nextCursor) {
        const n = await dm.list(which, r.nextCursor);
        r = { ...n, items: [...r.items, ...n.items] };
        paint();
        return;
      }
      const b = t.closest<HTMLButtonElement>('.js-req');
      if (!b) return;
      const li = b.closest<HTMLElement>('.dm-item')!;
      const id = Number(li.dataset.id);
      const act = b.dataset.act as 'accept' | 'decline' | 'block';
      if (act === 'block' && !confirm('拉黑后对方不能再给你发消息，也看不到你的动态。确定拉黑？')) return;
      b.disabled = true;
      try {
        await dm.respond(id, act);
        if (act === 'accept') {
          void ctx.notify('已接受，可以开始聊天了', 'success');
          ctx.navigate ? ctx.navigate(url(`/messages/c/${id}/`)) : (location.href = url(`/messages/c/${id}/`));
          return;
        }
        r = { ...r, items: r.items.filter((x) => x.id !== id) };
        paint();
        announce(box, act === 'decline' ? '已婉拒消息请求' : '已拉黑并移除消息请求');
        void refreshDmDot();
      } catch (x) {
        b.disabled = false;
        void ctx.notify(errMsg(x), 'error');
      }
    },
    { signal },
  );
  box.addEventListener(
    'submit',
    async (ev) => {
      const f = (ev.target as HTMLElement).closest<HTMLFormElement>('.js-new');
      if (!f) return;
      ev.preventDefault();
      const err = f.querySelector<HTMLElement>('.js-err')!;
      const u = String(new FormData(f).get('username') ?? '').trim().replace(/^@/, '');
      if (!/^[A-Za-z0-9_]{3,20}$/.test(u)) {
        err.textContent = '用户名是 3–20 位字母、数字或下划线';
        err.hidden = false;
        f.querySelector<HTMLInputElement>('input')!.setAttribute('aria-invalid', 'true');
        return;
      }
      try {
        const res = await dm.start(u);
        const href = url(`/messages/c/${res.conversation.id}/`);
        ctx.navigate ? ctx.navigate(href) : (location.href = href);
      } catch (x) {
        err.textContent = errMsg(x);
        err.hidden = false;
      }
    },
    { signal },
  );
  box.addEventListener(
    'submit',
    async (ev) => {
      const f = (ev.target as HTMLElement).closest<HTMLFormElement>('.js-dmsearch');
      if (!f) return;
      ev.preventDefault();
      sq = String(new FormData(f).get('q') ?? '').trim();
      try {
        sres = sq ? await dm.search(sq) : null;
      } catch (x) {
        void ctx.notify(errMsg(x), 'error');
        return;
      }
      paint();
      box.querySelector<HTMLInputElement>('#dm-search-q')?.focus();
      announce(box, sres ? (sres.items.length ? `找到 ${sres.items.length} 条消息` : '没有找到消息') : '');
    },
    { signal },
  );
  // 列表也实时刷新（新消息 / 新请求）
  const live = new Live();
  bindMode(box, live);
  let pending: ReturnType<typeof setTimeout> | null = null;
  live.on((ev) => {
    if (ev.t !== 'msg' && ev.t !== 'conv' && ev.t !== 'recall') return;
    if (pending) clearTimeout(pending);
    pending = setTimeout(async () => {
      try {
        const before = new Set(r.items.map((x) => `${x.id}:${x.lastMessage?.id ?? 0}`));
        r = await dm.list(which);
        paint();
        live.onMode?.(live.mode);
        paintDot(r.unread);
        const fresh = r.items.find((x) => !before.has(`${x.id}:${x.lastMessage?.id ?? 0}`) && x.lastMessage && !x.lastMessage.mine);
        if (fresh?.lastMessage) announce(box, `新消息：${announceText(fresh.peer?.nickname ?? '', fresh.lastMessage.excerpt)}`);
      } catch {
        /* 下次再试 */
      }
    }, 250);
  });
  await live.start();
  live.onMode?.(live.mode);
  whileMounted(box, () => live.stop());
}

// ---------------------------------------------------------------- 设置
async function renderSettings(box: HTMLElement, ctx: DmCtx): Promise<void> {
  const [{ settings: s }, u] = await Promise.all([dm.settings(), dm.unread().catch(() => undefined)]);
  box.innerHTML = `<div class="dm">
  ${tabs('settings', u)}
  <form class="tile tile--full dm-settings js-settings" aria-labelledby="dm-set-h">
    <h2 class="soc-h" id="dm-set-h">${icon('settings')}私信设置</h2>
    <fieldset class="dm-fs"><legend>谁可以给我发起私信</legend>
      ${DM_POLICIES.map((p) => `<label class="dm-radio"><input type="radio" name="policy" value="${p}"${s.policy === p ? ' checked' : ''}><span>${e(DM_POLICY_LABEL[p])}</span></label>`).join('')}
      <p class="muted small">互相关注的人总是可以直接私信你（选「不接受新的私信」时除外）。已经开始的会话不受影响。被你拉黑的人任何时候都不能给你发消息。</p>
    </fieldset>
    <label class="dm-check"><input type="checkbox" name="readReceipts"${s.readReceipts ? ' checked' : ''}><span><b>已读回执</b><br><span class="muted small">关闭后对方看不到你是否读过消息，你也看不到对方的已读状态。</span></span></label>
    <label class="dm-check"><input type="checkbox" name="showPresence"${s.showPresence ? ' checked' : ''}><span><b>显示在线状态</b><br><span class="muted small">只对会话对象和互相关注的人显示；关闭后在「谁在看」里也显示为访客。互相拉黑的人永远看不到。</span></span></label>
    <p class="muted small">新注册 3 天内的账号每天最多发起 3 个消息请求、每分钟最多 10 条消息；消息请求被接受前最多发 ${REQUEST_PENDING_MAX} 条。发送 ${RECALL_WINDOW_MS / 60000} 分钟内可以撤回（双方都删除）。</p>
    <p class="field__err js-err" role="alert" hidden></p>
    <button class="btn btn--primary btn--sm" type="submit">${icon('check')}保存</button>
  </form>
  <p class="visually-hidden js-dm-live" role="status" aria-live="polite"></p>
</div>`;
  const signal = freshSignal(box);
  box.addEventListener(
    'submit',
    async (ev) => {
      const f = (ev.target as HTMLElement).closest<HTMLFormElement>('.js-settings');
      if (!f) return;
      ev.preventDefault();
      const fd = new FormData(f);
      try {
        await dm.saveSettings({ policy: String(fd.get('policy')) as DmSettings['policy'], readReceipts: fd.get('readReceipts') === 'on', showPresence: fd.get('showPresence') === 'on' });
        void ctx.notify('私信设置已保存', 'success');
        announce(box, '私信设置已保存');
      } catch (x) {
        const err = f.querySelector<HTMLElement>('.js-err')!;
        err.textContent = errMsg(x);
        err.hidden = false;
      }
    },
    { signal },
  );
}

// ---------------------------------------------------------------- 会话
// ---------------------------------------------------------------- L30 附件
/** 附件 HTML：演示站是 data URL，直接显示；真实站点的媒体接口要带登录令牌，先放占位，hydrateMedia 拉取后换成 blob URL。 */
function attachmentHtml(a: DmAttachment): string {
  const direct = /^data:/.test(a.url);
  const src = direct ? `src="${e(a.url)}"` : `data-auth-src="${e(a.url)}"`;
  if (a.kind === 'image') {
    const ratio = a.width && a.height ? ` width="${a.width}" height="${a.height}"` : '';
    return `<figure class="dm-att dm-att--img"><img class="dm-att__img" ${src} alt="${e(a.alt)}"${ratio} loading="lazy" decoding="async"></figure>`;
  }
  return `<figure class="dm-att dm-att--voice"><audio class="dm-att__audio" controls preload="none" ${src} aria-label="语音消息，${fmtDuration(a.durationMs)}"></audio><figcaption class="small muted">${icon('volume')}语音 ${fmtDuration(a.durationMs)}${a.alt ? ` · ${e(a.alt)}` : ''}</figcaption></figure>`;
}
const mediaCache = new Map<string, string>();
async function hydrateMedia(root: ParentNode): Promise<void> {
  const els = [...root.querySelectorAll<HTMLImageElement | HTMLAudioElement>('[data-auth-src]')];
  for (const el of els) {
    const u = el.dataset.authSrc!;
    let obj = mediaCache.get(u);
    if (!obj) {
      try {
        const r = await fetch(API_BASE + u, { headers: auth() });
        if (!r.ok) throw new Error(String(r.status));
        obj = URL.createObjectURL(await r.blob());
        mediaCache.set(u, obj);
      } catch {
        el.replaceWith(Object.assign(document.createElement('span'), { className: 'muted small', textContent: '附件已不可用' }));
        continue;
      }
    }
    el.src = obj;
    el.removeAttribute('data-auth-src');
  }
}
/** 读取图片尺寸（只在本机） */
function imageSize(file: Blob): Promise<{ width: number; height: number }> {
  return new Promise((res) => {
    const img = new Image();
    const u = URL.createObjectURL(file);
    img.onload = () => {
      res({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(u);
    };
    img.onerror = () => {
      res({ width: 0, height: 0 });
      URL.revokeObjectURL(u);
    };
    img.src = u;
  });
}
/** 选好图片后要求写替代文字（必填）；返回 null = 取消 */
function askAlt(box: HTMLElement, file: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dm-dialog';
    dlg.setAttribute('aria-labelledby', 'dm-alt-h');
    const prev = URL.createObjectURL(file);
    dlg.innerHTML = `<form method="dialog" class="dm-alt"><h2 class="soc-h" id="dm-alt-h">${icon('image')}发送图片</h2><img class="dm-alt__prev" src="${prev}" alt=""><div class="field"><label class="field__label" for="dm-alt-t">替代文字（必填）</label><textarea id="dm-alt-t" name="alt" rows="2" maxlength="${ALT_MAX}" required aria-describedby="dm-alt-d"></textarea><p class="muted small" id="dm-alt-d">用一句话描述图片内容，给看不见图片的朋友（读屏软件会读出来）。图片里的位置信息（EXIF / GPS）会在发送前去掉。</p></div><p class="field__err js-alt-err" role="alert" hidden>请写一句替代文字</p><p class="dm-rep__act"><button class="btn btn--primary btn--sm js-alt-ok" value="ok" type="submit">${icon('send')}发送</button><button class="btn btn--soft btn--sm" value="cancel" type="submit" formnovalidate>取消</button></p></form>`;
    box.append(dlg);
    const ta = dlg.querySelector<HTMLTextAreaElement>('#dm-alt-t')!;
    dlg.querySelector('.js-alt-ok')!.addEventListener('click', (ev) => {
      if (!ta.value.trim()) {
        ev.preventDefault();
        dlg.querySelector<HTMLElement>('.js-alt-err')!.hidden = false;
        ta.setAttribute('aria-invalid', 'true');
        ta.focus();
      }
    });
    dlg.addEventListener('close', () => {
      const v = dlg.returnValue === 'ok' ? ta.value.trim() : null;
      URL.revokeObjectURL(prev);
      dlg.remove();
      resolve(v);
    });
    dlg.showModal();
    ta.focus();
  });
}

function bubble(m: DmMessage, opts: { peerRead: number | null; lastMine: number | null; room?: boolean; moderator?: boolean }): string {
  const gone = m.recalled || m.removed;
  const canRecall = m.mine && !gone && Date.now() - Date.parse(m.createdAt) < RECALL_WINDOW_MS;
  const who = m.mine ? '我' : (m.sender?.nickname ?? '已注销的用户');
  const body = m.recalled ? `<i class="muted">${m.mine ? '你' : who}撤回了一条消息</i>` : m.removed ? '<i class="muted">消息已被聊天室管理员移除</i>' : e(m.body).replace(/\n/g, '<br>');
  const read = !opts.room && m.mine && opts.peerRead != null && m.id === opts.lastMine && opts.peerRead >= m.id ? '<span class="dm-read">已读</span>' : '';
  const acts = gone
    ? ''
    : `<span class="dm-msg__acts">${canRecall ? `<button class="dm-act js-recall" type="button" aria-label="撤回这条消息（双方都删除）">撤回</button>` : ''}${!opts.room ? `<button class="dm-act js-del" type="button" aria-label="仅在我这里删除这条消息">删除</button>` : ''}${opts.room && (m.mine || opts.moderator) ? `<button class="dm-act js-rm" type="button" aria-label="移除这条消息">移除</button>` : ''}${!m.mine ? `<button class="dm-act js-report" type="button" aria-label="举报这条消息">举报</button>` : ''}</span>`;
  const att = !gone && m.attachment ? attachmentHtml(m.attachment) : '';
  return `<li class="dm-msg${m.mine ? ' is-mine' : ''}${gone ? ' is-gone' : ''}" data-id="${m.id}" id="m-${m.id}"${m.clientId ? ` data-cid="${e(m.clientId)}"` : ''}>
  ${opts.room && !m.mine ? `<a class="dm-msg__who small" href="${m.sender ? userPath(m.sender.username) : '#'}">${e(who)}</a>` : `<span class="visually-hidden">${e(who)}：</span>`}
  <div class="dm-msg__bubble">${att}${body}</div>
  <span class="dm-msg__meta muted small"><time datetime="${e(m.createdAt)}">${when(m.createdAt)}</time>${read}</span>
  ${acts}
</li>`;
}

async function renderConversation(box: HTMLElement, id: number, ctx: DmCtx): Promise<void> {
  const [{ conversation: c0, viewer }, page] = await Promise.all([dm.conv(id), dm.messages(id)]);
  let c = c0;
  let canSendNow = viewer.canSend;
  const msgs = new Map<number, DmMessage>(page.items.map((m) => [m.id, m]));
  let hasMore = page.hasMore;
  let nextBefore = page.nextBefore;
  const name = c.peer?.nickname ?? '已注销的用户';
  document.title = `与 ${name} 的私信 | ${document.title.split('|').pop()?.trim() ?? ''}`;
  const signal = freshSignal(box);
  const banner = () => {
    if (viewer.blocked) return `<p class="dm-banner" role="note">${icon('ban')}你已拉黑对方，不能发送消息。可以在对方主页解除拉黑。</p>`;
    if (c.status === 'request' && !c.requestedByMe)
      return `<div class="dm-banner" role="note"><p>${icon('envelope')}<b>${e(name)}</b> 想和你私信。接受后才能回复；对方看不到你是否读过。</p><p class="dm-banner__act"><button class="btn btn--primary btn--sm js-req" data-act="accept" type="button">${icon('check')}接受</button><button class="btn btn--soft btn--sm js-req" data-act="decline" type="button">婉拒</button><button class="btn btn--ghost btn--sm js-req" data-act="block" type="button">${icon('ban')}拉黑</button></p></div>`;
    if (c.status === 'request') return `<p class="dm-banner" role="note">${icon('clock')}消息请求已发送，对方接受前最多发 ${REQUEST_PENDING_MAX} 条。</p>`;
    if (c.status === 'declined') return `<p class="dm-banner" role="note">${icon('close')}对方婉拒了这个消息请求。</p>`;
    return '';
  };
  const lastMine = () => [...msgs.values()].filter((m) => m.mine).reduce((a, m) => Math.max(a, m.id), 0) || null;
  const list = () => {
    const sorted = [...msgs.values()].sort((a, b) => a.id - b.id);
    const lm = lastMine();
    return sorted.map((m) => bubble(m, { peerRead: c.peerLastReadId, lastMine: lm })).join('');
  };
  box.innerHTML = `<div class="dm dm--conv">
  <header class="tile tile--full dm-conv-head">
    <a class="btn btn--ghost btn--sm dm-back" href="${url('/messages/')}" aria-label="返回收件箱">${icon('arrowLeft')}</a>
    ${avatar(c.peer, 'soc-av')}
    <div class="dm-conv-head__txt"><h1 class="dm-conv-head__name">${c.peer ? `<a href="${userPath(c.peer.username)}">${e(name)}</a>` : e(name)}</h1><p class="muted small"><span class="js-presence" hidden></span>${c.peer ? `@${e(c.peer.username)}` : ''}</p></div>
    ${modeChip()}
    <button class="btn btn--ghost btn--sm js-hide" type="button" aria-label="删除这个会话（仅自己）">${icon('trash')}</button>
  </header>
  <div class="js-banner">${banner()}</div>
  <section class="tile tile--full dm-thread" aria-label="与 ${e(name)} 的消息">
    <p class="dm-more-wrap">${hasMore ? '<button class="btn btn--soft btn--sm js-older" type="button">加载更早的消息</button>' : '<span class="muted small">没有更早的消息了</span>'}</p>
    <div class="dm-logbox" role="log" aria-live="off" aria-label="消息记录"><ol class="dm-log js-log">${list()}</ol></div>
  </section>
  <form class="tile tile--full dm-compose js-compose" novalidate${canSendNow ? '' : ' hidden'}>
    <label class="visually-hidden" for="dm-input">给 ${e(name)} 发消息</label>
    <textarea id="dm-input" name="body" rows="2" maxlength="${MAX_BODY}" placeholder="写点什么…（Enter 发送，Shift + Enter 换行）" aria-describedby="dm-count"></textarea>
    <div class="dm-compose__foot"><span class="dm-compose__tools"><label class="btn btn--ghost btn--sm dm-attach" title="发送图片"><input class="visually-hidden js-pick-img" type="file" accept="image/jpeg,image/png,image/webp">${icon('image')}<span>图片</span></label><button class="btn btn--ghost btn--sm js-rec" type="button" aria-pressed="false" hidden>${icon('volume')}<span class="js-rec-t">语音</span></button></span><span class="muted small" id="dm-count" aria-live="off">0 / ${MAX_BODY}</span><button class="btn btn--primary btn--sm" type="submit">${icon('send')}发送</button></div>
    <p class="muted small js-rec-hint" role="status" aria-live="polite"></p>
  </form>
  <p class="visually-hidden js-dm-live" role="status" aria-live="polite"></p>
</div>`;
  const log = box.querySelector<HTMLOListElement>('.js-log')!;
  const input = box.querySelector<HTMLTextAreaElement>('#dm-input')!;
  const scrollEnd = () => log.lastElementChild?.scrollIntoView({ block: 'end', behavior: reduced() ? 'auto' : 'smooth' });
  // 从搜索结果跳过来：#m-<id> 高亮那条消息（重绘后保留高亮）
  const hashId = /^#m-(\d+)$/.exec(location.hash)?.[1];
  const markHit = () => hashId && log.querySelector<HTMLElement>(`#m-${hashId}`)?.classList.add('is-hit');
  const repaint = (keep = false) => {
    const y = log.scrollHeight - log.scrollTop;
    log.innerHTML = list();
    markHit();
    if (keep) log.scrollTop = log.scrollHeight - y;
    void hydrateMedia(log);
  };
  void hydrateMedia(log);
  log.scrollTop = log.scrollHeight;
  if (hashId) requestAnimationFrame(() => {
    const el = log.querySelector<HTMLElement>(`#m-${hashId}`);
    if (el) {
      el.classList.add('is-hit');
      el.scrollIntoView({ block: 'center' });
    }
  });
  if (!hashId) requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
  const markRead = () => {
    const last = [...msgs.keys()].reduce((a, b) => Math.max(a, b), 0);
    if (!last || document.hidden) return;
    void dm.read(id, last).then(() => refreshDmDot()).catch(() => undefined);
  };
  markRead();
  // 在线状态（隐私 / 拉黑由服务端判断；null = 不可见）
  const presence = async () => {
    if (!c.peer || !box.isConnected) return;
    const p = await dm.presence([c.peer.username]).catch(() => null);
    const el = box.querySelector<HTMLElement>('.js-presence');
    const v = p?.presence[c.peer.username];
    if (!el) return;
    el.hidden = v == null;
    el.className = `js-presence dm-presence${v ? ' is-on' : ''}`;
    el.textContent = v ? '在线 · ' : '离线 · ';
  };
  void presence();
  const presTimer = setInterval(() => void presence(), 30_000);

  input.addEventListener('input', () => (box.querySelector('#dm-count')!.textContent = `${[...input.value].length} / ${MAX_BODY}`), { signal });
  input.addEventListener(
    'keydown',
    (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
        ev.preventDefault();
        box.querySelector<HTMLFormElement>('.js-compose')!.requestSubmit();
      }
    },
    { signal },
  );
  const sendBody = async (body: string, cid: string) => {
    try {
      const r = await dm.send(id, body, cid);
      log.querySelector(`[data-cid="${CSS.escape(cid)}"].is-pending`)?.remove();
      msgs.set(r.message.id, r.message);
      repaint();
      scrollEnd();
      announce(box, '已发送');
    } catch (x) {
      const li = log.querySelector<HTMLElement>(`[data-cid="${CSS.escape(cid)}"]`);
      if (li) {
        li.classList.add('is-failed');
        li.querySelector('.dm-msg__meta')!.innerHTML = `<span class="dm-fail">${e(errMsg(x))}</span> <button class="dm-act js-retry" type="button" data-body="${e(body)}" data-cid="${e(cid)}">重试</button>`;
      }
      void ctx.notify(errMsg(x), 'error');
    }
  };
  // L30：网络恢复后自动重发失败的消息（同一个 clientId，服务端去重，不会重复）
  addEventListener(
    'online',
    () => {
      log.querySelectorAll<HTMLButtonElement>('.dm-msg.is-failed .js-retry').forEach((b) => b.click());
    },
    { signal },
  );
  // L30：图片 / 语音 —— 先上传拿到 mediaId，再像普通消息一样发送（clientId 幂等）
  const sendMedia = async (file: Blob, meta: { kind: 'image' | 'voice'; alt?: string; durationMs?: number; width?: number; height?: number }) => {
    const cid = clientId();
    const label = meta.kind === 'image' ? `[图片] ${meta.alt ?? ''}` : `[语音 ${fmtDuration(meta.durationMs ?? 0)}]`;
    log.insertAdjacentHTML('beforeend', `<li class="dm-msg is-mine is-pending" data-cid="${e(cid)}"><span class="visually-hidden">我：</span><div class="dm-msg__bubble">${e(label)}</div><span class="dm-msg__meta muted small">正在上传…</span></li>`);
    scrollEnd();
    try {
      const up = await dm.upload(id, file, meta);
      const r = await dm.send(id, '', cid, up.media.id);
      log.querySelector(`[data-cid="${CSS.escape(cid)}"].is-pending`)?.remove();
      msgs.set(r.message.id, r.message);
      repaint();
      scrollEnd();
      announce(box, meta.kind === 'image' ? '图片已发送' : '语音已发送');
    } catch (x) {
      log.querySelector(`[data-cid="${CSS.escape(cid)}"].is-pending`)?.remove();
      void ctx.notify(errMsg(x), 'error');
    }
  };
  const pick = box.querySelector<HTMLInputElement>('.js-pick-img');
  pick?.addEventListener(
    'change',
    async () => {
      const file = pick.files?.[0];
      pick.value = '';
      if (!file) return;
      const alt = await askAlt(box, file);
      if (alt == null) return;
      const size = await imageSize(file);
      await sendMedia(file, { kind: 'image', alt, ...size });
    },
    { signal },
  );
  // 语音：浏览器支持 MediaRecorder 才显示；点一下开始，再点一下发送；最长 2 分钟；麦克风权限只在点按钮时请求
  const recBtn = box.querySelector<HTMLButtonElement>('.js-rec');
  const recHint = box.querySelector<HTMLElement>('.js-rec-hint');
  if (recBtn && typeof MediaRecorder !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
    recBtn.hidden = false;
    let rec: MediaRecorder | null = null;
    let chunks: Blob[] = [];
    let started = 0;
    let timer = 0;
    const stop = () => {
      clearTimeout(timer);
      if (rec && rec.state !== 'inactive') rec.stop();
    };
    recBtn.addEventListener(
      'click',
      async () => {
        if (rec && rec.state === 'recording') return stop();
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';
          rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
          chunks = [];
          rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
          rec.onstop = () => {
            stream.getTracks().forEach((t) => t.stop());
            recBtn.setAttribute('aria-pressed', 'false');
            recBtn.querySelector('.js-rec-t')!.textContent = '语音';
            const durationMs = Date.now() - started;
            const blob = new Blob(chunks, { type: (rec?.mimeType || 'audio/webm').split(';')[0] });
            if (recHint) recHint.textContent = '';
            if (durationMs < 1000) {
              if (recHint) recHint.textContent = '录音太短了（至少 1 秒）';
              return;
            }
            void sendMedia(blob, { kind: 'voice', durationMs: Math.min(durationMs, DM_VOICE_MAX_MS) });
          };
          started = Date.now();
          rec.start();
          recBtn.setAttribute('aria-pressed', 'true');
          recBtn.querySelector('.js-rec-t')!.textContent = '停止并发送';
          if (recHint) recHint.textContent = '正在录音…（最长 2 分钟，再点一次发送）';
          timer = window.setTimeout(stop, DM_VOICE_MAX_MS);
        } catch {
          if (recHint) recHint.textContent = '没有拿到麦克风权限，无法录音';
        }
      },
      { signal },
    );
    signal.addEventListener('abort', stop);
  }
  box.addEventListener(
    'submit',
    (ev) => {
      const f = (ev.target as HTMLElement).closest<HTMLFormElement>('.js-compose');
      if (!f) return;
      ev.preventDefault();
      const body = input.value.trim();
      if (!body) return;
      const cid = clientId();
      input.value = '';
      box.querySelector('#dm-count')!.textContent = `0 / ${MAX_BODY}`;
      // 乐观显示：先放一个「发送中」的气泡，服务器确认后替换
      log.insertAdjacentHTML('beforeend', `<li class="dm-msg is-mine is-pending" data-cid="${e(cid)}"><span class="visually-hidden">我：</span><div class="dm-msg__bubble">${e(body).replace(/\n/g, '<br>')}</div><span class="dm-msg__meta muted small">发送中…</span></li>`);
      scrollEnd();
      void sendBody(body, cid);
    },
    { signal },
  );
  box.addEventListener(
    'click',
    async (ev) => {
      const t = ev.target as HTMLElement;
      if (t.closest('.js-older') && nextBefore) {
        const p = await dm.messages(id, nextBefore);
        for (const m of p.items) msgs.set(m.id, m);
        hasMore = p.hasMore;
        nextBefore = p.nextBefore;
        repaint(true);
        box.querySelector('.dm-more-wrap')!.innerHTML = hasMore ? '<button class="btn btn--soft btn--sm js-older" type="button">加载更早的消息</button>' : '<span class="muted small">没有更早的消息了</span>';
        box.querySelector<HTMLElement>('.js-older')?.focus();
        announce(box, `已加载 ${p.items.length} 条更早的消息`);
        return;
      }
      const retry = t.closest<HTMLButtonElement>('.js-retry');
      if (retry) {
        const li = retry.closest<HTMLElement>('.dm-msg')!;
        li.classList.remove('is-failed');
        li.querySelector('.dm-msg__meta')!.textContent = '发送中…';
        void sendBody(retry.dataset.body ?? '', retry.dataset.cid ?? clientId());
        return;
      }
      const req = t.closest<HTMLButtonElement>('.js-req');
      if (req) {
        const act = req.dataset.act as 'accept' | 'decline' | 'block';
        if (act === 'block' && !confirm('拉黑后对方不能再给你发消息。确定拉黑？')) return;
        try {
          const r = await dm.respond(id, act);
          if (act !== 'accept') {
            ctx.navigate ? ctx.navigate(url('/messages/requests/')) : (location.href = url('/messages/requests/'));
            return;
          }
          c = { ...c, status: r.status as DmConversation['status'] };
          canSendNow = true;
          box.querySelector('.js-banner')!.innerHTML = banner();
          box.querySelector<HTMLFormElement>('.js-compose')!.hidden = false;
          input.focus();
          announce(box, '已接受消息请求');
          void refreshDmDot();
        } catch (x) {
          void ctx.notify(errMsg(x), 'error');
        }
        return;
      }
      if (t.closest('.js-hide')) {
        if (!confirm('删除这个会话？只会从你这里删除，对方仍然保留。')) return;
        await dm.hide(id).catch((x) => void ctx.notify(errMsg(x), 'error'));
        ctx.navigate ? ctx.navigate(url('/messages/')) : (location.href = url('/messages/'));
        return;
      }
      const li = t.closest<HTMLElement>('.dm-msg');
      const mid = Number(li?.dataset.id);
      if (!li || !mid) return;
      try {
        if (t.closest('.js-recall')) {
          if (!confirm('撤回这条消息？双方都会看到「消息已撤回」。')) return;
          await dm.recall(mid);
          const m = msgs.get(mid);
          if (m) msgs.set(mid, { ...m, recalled: true, body: '' });
          repaint();
          announce(box, '消息已撤回');
        } else if (t.closest('.js-del')) {
          await dm.deleteForMe(mid);
          msgs.delete(mid);
          repaint();
          announce(box, '已在你这里删除这条消息');
        } else if (t.closest('.js-report')) {
          const reason = await pickReason(box);
          if (!reason) return;
          await dm.report(mid, reason.reason, reason.detail);
          void ctx.notify('已举报，站长会尽快处理', 'success');
        }
      } catch (x) {
        void ctx.notify(errMsg(x), 'error');
      }
    },
    { signal },
  );

  const live = new Live();
  bindMode(box, live);
  live.on((ev) => {
    if (ev.t === 'hello' || !('conversationId' in ev) || ev.conversationId !== id) return;
    if (ev.t === 'msg') {
      const m = ev.message;
      const known = msgs.has(m.id);
      // 自己发的消息：如果还在「发送中」，由 sendBody 替换
      if (m.mine && m.clientId && log.querySelector(`[data-cid="${CSS.escape(m.clientId)}"].is-pending`)) return;
      msgs.set(m.id, m);
      const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
      repaint();
      if (atEnd) scrollEnd();
      if (!known && !m.mine) {
        announce(box, announceText(m.sender?.nickname ?? name, m.body));
        markRead();
      }
    } else if (ev.t === 'recall' || ev.t === 'remove') {
      const m = msgs.get(ev.messageId);
      if (!m) return;
      if (ev.t === 'remove') msgs.delete(ev.messageId);
      else msgs.set(ev.messageId, { ...m, recalled: true, body: '' });
      repaint();
      if (ev.t === 'recall' && !m.mine) announce(box, `${name} 撤回了一条消息`);
    } else if (ev.t === 'read') {
      if (c.peer && ev.username === c.peer.username && c.peerLastReadId !== null) {
        c = { ...c, peerLastReadId: Math.max(c.peerLastReadId, ev.lastReadId) };
        repaint();
      }
    } else if (ev.t === 'conv') {
      if (ev.status === 'active' && c.status !== 'active') {
        c = { ...c, status: 'active' };
        canSendNow = true;
        box.querySelector('.js-banner')!.innerHTML = banner();
        box.querySelector<HTMLFormElement>('.js-compose')!.hidden = false;
        announce(box, `${name} 接受了你的消息请求`);
        // 接受后才开始共享已读状态
        void dm.conv(id).then((r) => {
          c = r.conversation;
          repaint();
        });
      } else if (ev.status === 'declined') {
        c = { ...c, status: 'declined' };
        box.querySelector('.js-banner')!.innerHTML = banner();
        box.querySelector<HTMLFormElement>('.js-compose')!.hidden = true;
      }
    }
  });
  document.addEventListener('visibilitychange', () => !document.hidden && markRead(), { signal });
  await live.start();
  live.onMode?.(live.mode);
  whileMounted(box, () => {
    live.stop();
    clearInterval(presTimer);
  });
}

/** 举报原因（原生 <dialog>：焦点自动进入、Esc 关闭、关闭后焦点回到触发按钮）。 */
function pickReason(box: HTMLElement): Promise<{ reason: string; detail: string } | null> {
  const opener = document.activeElement as HTMLElement | null;
  const REASONS: [string, string][] = [['spam', '垃圾广告'], ['abuse', '骚扰 / 辱骂'], ['nsfw', '不适内容'], ['privacy', '泄露隐私'], ['other', '其他']];
  const dlg = document.createElement('dialog');
  dlg.className = 'dm-dialog tile';
  dlg.setAttribute('aria-labelledby', 'dm-rep-h');
  dlg.innerHTML = `<form method="dialog" class="dm-rep"><h2 class="soc-h" id="dm-rep-h">${icon('flag')}举报这条消息</h2><fieldset class="dm-fs"><legend class="visually-hidden">原因</legend>${REASONS.map(([v, l], i) => `<label class="dm-radio"><input type="radio" name="reason" value="${v}"${i === 0 ? ' checked' : ''}><span>${l}</span></label>`).join('')}</fieldset><div class="field"><label class="field__label" for="dm-rep-d">补充说明（可选）</label><textarea id="dm-rep-d" name="detail" rows="2" maxlength="300"></textarea></div><p class="muted small">站长只能看到被举报的这条消息，看不到整段对话。</p><p class="dm-rep__act"><button class="btn btn--primary btn--sm" value="ok" type="submit">提交举报</button><button class="btn btn--soft btn--sm" value="cancel" type="submit" formnovalidate>取消</button></p></form>`;
  box.append(dlg);
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      const fd = new FormData(dlg.querySelector('form')!);
      const v = dlg.returnValue === 'ok' ? { reason: String(fd.get('reason') ?? 'other'), detail: String(fd.get('detail') ?? '') } : null;
      dlg.remove();
      opener?.focus();
      resolve(v);
    });
    dlg.showModal();
  });
}

// ---------------------------------------------------------------- 活动聊天室（L17 活动页里）
export async function mountRoom(host: HTMLElement, slug: string, ctx: DmCtx): Promise<void> {
  if (!currentMember()) return;
  let r: Awaited<ReturnType<typeof dm.room>>;
  try {
    r = await dm.room(slug);
  } catch {
    return; // 没开聊天室：保持隐藏
  }
  const room = r.room;
  const msgs = new Map<number, DmMessage>(r.items.map((m) => [m.id, m]));
  const keep = room.retention === 'ephemeral' ? `临时聊天室：只显示最近 ${room.ttlHours} 小时的消息` : '聊天记录会保留';
  host.hidden = false;
  host.innerHTML = `<div class="dm-room">
  <div class="dm-list-head"><h2 class="soc-h" id="room-h">${icon('message')}活动聊天室</h2>${modeChip()}</div>
  <p class="muted small">${keep} · ${room.members} 人参与${room.closed ? ' · 已关闭' : ''}。请友善交流；被拉黑的人的发言不会显示给你；可以举报不当消息。</p>
  <div class="dm-logbox" role="log" aria-live="off" aria-labelledby="room-h"><ol class="dm-log dm-log--room js-log">${[...msgs.values()].map((m) => bubble(m, { peerRead: null, lastMine: null, room: true, moderator: room.moderator })).join('')}</ol></div>
  ${room.closed ? '' : `<form class="dm-compose dm-compose--room js-rcompose" novalidate><label class="visually-hidden" for="room-input">在聊天室发言</label><textarea id="room-input" name="body" rows="1" maxlength="${ROOM_MAX_BODY}" placeholder="说点什么…（Enter 发送）"></textarea><button class="btn btn--primary btn--sm" type="submit">${icon('send')}发送</button></form>`}
  <p class="visually-hidden js-dm-live" role="status" aria-live="polite"></p>
</div>`;
  const log = host.querySelector<HTMLOListElement>('.js-log')!;
  const repaint = () => {
    log.innerHTML = [...msgs.values()].sort((a, b) => a.id - b.id).map((m) => bubble(m, { peerRead: null, lastMine: null, room: true, moderator: room.moderator })).join('');
    log.scrollTop = log.scrollHeight;
  };
  log.scrollTop = log.scrollHeight;
  const signal = freshSignal(host);
  const input = host.querySelector<HTMLTextAreaElement>('#room-input');
  input?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      host.querySelector<HTMLFormElement>('.js-rcompose')!.requestSubmit();
    }
  }, { signal });
  host.addEventListener('submit', async (ev) => {
    if (!(ev.target as HTMLElement).closest('.js-rcompose') || !input) return;
    ev.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    try {
      const res = await dm.roomSend(slug, body, clientId());
      msgs.set(res.message.id, res.message);
      repaint();
    } catch (x) {
      input.value = body;
      void ctx.notify(errMsg(x), 'error');
    }
  }, { signal });
  host.addEventListener('click', async (ev) => {
    const t = ev.target as HTMLElement;
    const li = t.closest<HTMLElement>('.dm-msg');
    const mid = Number(li?.dataset.id);
    if (!mid) return;
    try {
      if (t.closest('.js-rm')) {
        await dm.roomRemove(slug, mid);
        msgs.delete(mid);
        repaint();
        announce(host, '消息已移除');
      } else if (t.closest('.js-report')) {
        const reason = await pickReason(host);
        if (!reason) return;
        await dm.report(mid, reason.reason, reason.detail);
        void ctx.notify('已举报，站长会尽快处理', 'success');
      }
    } catch (x) {
      void ctx.notify(errMsg(x), 'error');
    }
  }, { signal });
  const live = new Live(slug);
  bindMode(host, live);
  live.on(async (ev) => {
    if (ev.t === 'hello') {
      // 轮询 / 重连：用最后一条 id 补齐
      const last = [...msgs.keys()].reduce((a, b) => Math.max(a, b), 0);
      const n = await dm.room(slug, last || null).catch(() => null);
      if (n?.items.length) {
        for (const m of n.items) msgs.set(m.id, m);
        repaint();
        const other = n.items.filter((m) => !m.mine).at(-1);
        if (other) announce(host, announceText(other.sender?.nickname ?? '', other.body));
      }
      return;
    }
    if (!('conversationId' in ev) || ev.conversationId !== room.id) return;
    if (ev.t === 'msg') {
      // 房间广播不区分接收者：自己发的消息由 HTTP 响应写入（带 mine），这里只补别人的
      const m = ev.message;
      if (msgs.has(m.id)) return;
      msgs.set(m.id, m);
      repaint();
      if (!m.mine) announce(host, announceText(m.sender?.nickname ?? '', m.body));
    } else if (ev.t === 'remove' || ev.t === 'recall') {
      msgs.delete(ev.messageId);
      repaint();
    }
  });
  await live.start();
  live.onMode?.(live.mode);
  whileMounted(host, () => live.stop());
}
