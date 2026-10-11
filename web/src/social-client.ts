/**
 * L15 社交前端（按需加载：只有打开 /u/…、/notifications/、/me/ 或已登录时才下载）：
 * 用户主页、关注 / 拉黑 / 静音、用户发现、通知中心、个人设置（资料 / 隐私 / 通知偏好 / 收藏 / 拉黑名单 / 数据导出与注销）、
 * 云端收藏同步与登录后合并本地收藏。接口：/api/social/*（演示站由浏览器内 mock 实现）。
 */
import './social.css';
import { ApiError, API_BASE, request } from './api';
import { currentMember } from './community';
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { memberBadge, postPath, url, userPath } from './render';
import { bookmarks as localBookmarks } from './home-client';
import type { NotificationFilter } from './social-core';

type Notify = (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => Promise<void> | void;
export interface SocialCtx { notify: Notify; navigate?: (href: string) => void }

interface Card { username: string; nickname: string; avatarUrl: string; bio: string }
interface Profile extends Card {
  id: number;
  coverUrl: string;
  website: string;
  links: { label: string; url: string }[];
  badges: { code: string; label: string; style: 'pearlescent' | 'brushed-metal'; design?: unknown }[];
  joinedAt: string;
  counts: { followers: number; following: number; works: number };
  showFollows: boolean;
}
interface ViewerRel { self: boolean; loggedIn: boolean; following: boolean; followedBy: boolean; blocked: boolean; muted: boolean }
interface ProfileWork { kind: 'work'; id: number; type: string; title: string; excerpt: string; cover: { url: string; alt: string; width: number; height: number } | null; visibility: string; createdAt: string }
interface ProfileResp { restricted: null | 'members' | 'private' | 'blocked'; profile: Profile; works?: ProfileWork[]; viewer: ViewerRel }
const TYPE_LABEL: Record<string, string> = { short: '短动态', article: '长文', photo: '摄影作品', album: '影集' };
const imgSrc = (u: string) => (u.startsWith('/api/') ? API_BASE + u : u);
interface Settings { visibility: 'public' | 'members' | 'private'; showFollows: boolean; discoverable: boolean }
interface Notice { id: number; type: string; actor: Card | null; objectKind: string; objectRef: string; excerpt: string; count: number; read: boolean; createdAt: string; updatedAt: string }
interface Prefs { follow: boolean; reply: boolean; mention: boolean; bookmark: boolean; reaction: boolean; new_work: boolean; topic_work: boolean; event_result: boolean; email: boolean }

// ---------------------------------------------------------------- 请求
function auth(): Record<string, string> {
  const m = currentMember();
  return m ? { authorization: `Bearer ${m.token}` } : {};
}
const JSON_H = { 'content-type': 'application/json' };
export const social = {
  profile: (u: string) => request<ProfileResp>(`/api/social/users/${encodeURIComponent(u)}`, { headers: auth() }),
  follows: (u: string, which: 'followers' | 'following', cursor?: string | null) => request<{ users: Card[]; nextCursor: string | null }>(`/api/social/users/${encodeURIComponent(u)}/${which}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { headers: auth() }),
  search: (q: string) => request<{ users: Card[] }>(`/api/social/search?q=${encodeURIComponent(q)}`, { headers: auth() }),
  me: () => request<{ profile: Profile; settings: Settings; unread: number }>('/api/social/me', { headers: auth() }),
  updateMe: (body: unknown) => request<{ profile: Profile; settings: Settings }>('/api/social/me', { method: 'PUT', headers: { ...JSON_H, ...auth() }, body: JSON.stringify(body) }),
  follow: (u: string, on: boolean) => request<{ following: boolean; counts: Profile['counts'] }>(`/api/social/follows/${encodeURIComponent(u)}`, { method: on ? 'POST' : 'DELETE', headers: auth() }),
  relation: (u: string, kind: 'blocks' | 'mutes', on: boolean) => request<Record<string, boolean>>(`/api/social/${kind}/${encodeURIComponent(u)}`, { method: on ? 'POST' : 'DELETE', headers: auth() }),
  relations: (kind: 'blocks' | 'mutes') => request<{ users: Card[] }>(`/api/social/me/${kind}`, { headers: auth() }),
  bookmarks: (cursor?: string | null) => request<{ bookmarks: { id: number; kind: string; ref: string; title: string; createdAt: string }[]; nextCursor: string | null }>(`/api/social/bookmarks${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { headers: auth() }),
  addBookmark: (b: { kind?: string; ref: string; title?: string }) => request<{ bookmarked: boolean }>('/api/social/bookmarks', { method: 'POST', headers: { ...JSON_H, ...auth() }, body: JSON.stringify(b) }),
  removeBookmark: (kind: string, ref: string) => request<{ bookmarked: boolean }>(`/api/social/bookmarks/${kind}/${encodeURIComponent(ref)}`, { method: 'DELETE', headers: auth() }),
  merge: (items: { kind: string; ref: string; title?: string }[]) => request<{ added: number; skipped: number; rejected: number }>('/api/social/bookmarks/merge', { method: 'POST', headers: { ...JSON_H, ...auth() }, body: JSON.stringify({ items }) }),
  notifications: (filter: NotificationFilter, cursor?: string | null) => request<{ notifications: Notice[]; unread: number; nextCursor: string | null }>(`/api/social/notifications?filter=${filter}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { headers: auth() }),
  unread: () => request<{ unread: number }>('/api/social/notifications/unread', { headers: auth() }),
  markRead: (body: { ids?: number[]; all?: boolean }) => request<{ unread: number }>('/api/social/notifications/read', { method: 'POST', headers: { ...JSON_H, ...auth() }, body: JSON.stringify(body) }),
  prefs: () => request<{ prefs: Prefs }>('/api/social/notifications/prefs', { headers: auth() }),
  setPrefs: (p: Partial<Prefs>) => request<{ prefs: Prefs }>('/api/social/notifications/prefs', { method: 'PUT', headers: { ...JSON_H, ...auth() }, body: JSON.stringify(p) }),
  exportMe: () => request<unknown>('/api/social/me/export', { headers: auth() }),
  deleteMe: (confirm: string) => request<{ deleted: boolean }>('/api/social/me/delete', { method: 'POST', headers: { ...JSON_H, ...auth() }, body: JSON.stringify({ confirm }) }),
};

const errMsg = (x: unknown) => (x instanceof ApiError ? x.message : (x as Error)?.message || '出错了，请稍后再试');
const DATE = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' });
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : DATE.format(d);
};
function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`;
  return fmtDate(iso);
}

function avatar(c: { nickname: string; avatarUrl: string; username: string }, cls = 'soc-av'): string {
  if (c.avatarUrl) return `<img class="${cls}" src="${e(c.avatarUrl)}" alt="" loading="lazy" decoding="async">`;
  let h = 0;
  for (const ch of c.username) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `<span class="${cls} soc-av--letter" style="--h:${h}" aria-hidden="true">${e((c.nickname || c.username).slice(0, 1))}</span>`;
}
const userLink = (c: Card) => `<a class="soc-user" href="${userPath(c.username)}">${avatar(c)}<span class="soc-user__txt"><b>${e(c.nickname)}</b><span class="muted small">@${e(c.username)}</span></span></a>`;

function gate(view: string): string {
  return `<div class="soc-gate tile tile--full">${icon('lock')}<h2>登录后查看${view}</h2><p class="muted">用邮箱验证码登录好朋友账号，就能关注别人、在多台设备同步收藏、接收通知。</p><a class="btn btn--primary" href="${url('/join/')}">${icon('user')}登录 / 注册</a></div>`;
}

// ---------------------------------------------------------------- 未读角标（导航 / 抽屉）
export async function refreshUnread(): Promise<number> {
  const me = currentMember();
  const links = document.querySelectorAll<HTMLElement>('.js-notif-link, .js-dm-link');
  links.forEach((l) => (l.hidden = !me));
  document.querySelectorAll<HTMLAnchorElement>('.js-me').forEach((a) => (a.href = me ? url('/me/') : url('/join/')));
  if (!me) return 0;
  let n = 0;
  try {
    n = (await social.unread()).unread;
  } catch {
    return 0;
  }
  document.querySelectorAll<HTMLElement>('.js-notif-dot').forEach((d) => (d.hidden = n === 0));
  // L19 私信小红点：只查一个计数接口，不下载私信界面代码
  void request<{ total: number; requests: number }>('/api/social/dm/unread', { headers: auth() })
    .then((u) => document.dispatchEvent(new CustomEvent('blog:dm-unread', { detail: u })))
    .catch(() => undefined);
  document.querySelectorAll<HTMLElement>('.js-notif-count').forEach((d) => {
    d.hidden = n === 0;
    d.textContent = n > 99 ? '99+' : String(n);
  });
  links.forEach((l) => l.setAttribute('aria-label', n ? `通知（${n} 条未读）` : '通知'));
  return n;
}

// ---------------------------------------------------------------- 云端收藏
/** 收藏按钮点击后：已登录则同步到云端（失败不影响本机收藏）。 */
export async function syncBookmark(slug: string, on: boolean, title: string, ctx: SocialCtx): Promise<void> {
  if (!currentMember()) return;
  try {
    if (on) await social.addBookmark({ kind: 'post', ref: slug, title });
    else await social.removeBookmark('post', slug);
  } catch (x) {
    void ctx.notify(`云端收藏同步失败：${errMsg(x)}`, 'warning');
  }
}

const MERGE_KEY = (id: number) => `blog-bm-merged:${id}`;
/** 登录后：本机有收藏且这个账号还没处理过 → 询问是否合并到云端（去重）。 */
export async function offerMerge(ctx: SocialCtx): Promise<void> {
  const me = currentMember();
  if (!me) return;
  const local = localBookmarks();
  if (!local.length || localStorage.getItem(MERGE_KEY(me.member.id))) return;
  if (document.querySelector('.soc-merge')) return;
  const dlg = document.createElement('dialog');
  dlg.className = 'soc-merge';
  dlg.setAttribute('aria-labelledby', 'soc-merge-h');
  dlg.innerHTML = `<form method="dialog"><h2 id="soc-merge-h">${icon('bookmark')}把本机收藏同步到账号？</h2><p>这个浏览器里有 <b>${local.length}</b> 篇本机收藏。合并后在任何设备登录都能看到，重复的会自动去掉。</p><div class="soc-merge__act"><button class="btn btn--soft" value="no" type="submit">暂不</button><button class="btn btn--primary js-merge-yes" value="yes" type="submit">合并到账号</button></div></form>`;
  document.body.append(dlg);
  const prev = document.activeElement as HTMLElement | null;
  dlg.addEventListener('close', async () => {
    const yes = dlg.returnValue === 'yes';
    dlg.remove();
    prev?.focus?.();
    localStorage.setItem(MERGE_KEY(me.member.id), yes ? 'merged' : 'declined');
    if (!yes) return;
    try {
      const r = await social.merge(local.map((ref) => ({ kind: 'post', ref })));
      void ctx.notify(`已合并 ${r.added} 篇收藏${r.skipped ? `（${r.skipped} 篇已在账号里）` : ''}`, 'success');
    } catch (x) {
      localStorage.removeItem(MERGE_KEY(me.member.id));
      void ctx.notify(errMsg(x), 'error');
    }
  });
  dlg.showModal();
  dlg.querySelector<HTMLElement>('.js-merge-yes')?.focus();
}

// L19：导航里的私信小红点（计数来自 refreshUnread / 私信页的同步）
document.addEventListener('blog:dm-unread', (ev) => {
  const u = (ev as CustomEvent<{ total: number; requests: number } | null>).detail;
  const n = u ? u.total + u.requests : 0;
  document.querySelectorAll<HTMLElement>('.js-dm-dot').forEach((d) => (d.hidden = n === 0));
});

// ---------------------------------------------------------------- 挂载
const DISCOVERY_VIEWS = new Set(['discover', 'topics', 'topic', 'events', 'event', 'collection']);
const STUDIO_VIEWS = new Set(['projects', 'project', 'features', 'feature', 'mystats']);
const DM_VIEWS = new Set(['messages', 'msgrequests', 'msgsettings', 'conversation']);
export async function mountSocial(root: HTMLElement, ctx: SocialCtx): Promise<void> {
  const box = root.querySelector<HTMLElement>('.js-social');
  if (!box) return;
  const view = box.dataset.view;
  try {
    // L16 社区动态 / 作品页 / 发布器：再分一个包（只在这三个页面下载）
    if (view === 'feed' || view === 'compose' || view === 'work') await (await import('./ugc-client')).mountUgc(box, view, ctx);
    // L17 发现 / 话题 / 活动 / 合集：再分一个包（只在这些页面下载）
    else if (view && DISCOVERY_VIEWS.has(view)) await (await import('./discovery-client')).mountDiscovery(box, view, ctx);
    // L18 项目 / 摄影专题 / 数据中心：再分一个包
    else if (view && STUDIO_VIEWS.has(view)) await (await import('./studio-client')).mountStudio(box, view, ctx);
    // L19 私信 / 消息请求 / 设置 / 会话：再分一个包
    else if (view && DM_VIEWS.has(view)) await (await import('./dm-client')).mountDm(box, view, ctx);
    else if (view === 'user') await renderProfile(box, box.dataset.username ?? '', ctx);
    else if (view === 'notifications') await renderNotifications(box, ctx);
    else if (view === 'me') await renderMe(box, ctx);
  } catch (x) {
    const nf = x instanceof ApiError && x.status === 404;
    const isWork = view === 'work' || view === 'compose' || (!!view && (DISCOVERY_VIEWS.has(view) || STUDIO_VIEWS.has(view) || DM_VIEWS.has(view)));
    box.innerHTML = `<div class="soc-gate tile tile--full">${icon(nf ? 'user' : 'close')}<h2>${nf ? (isWork ? '内容不存在' : '没有这个用户') : '加载失败'}</h2><p class="muted">${e(nf ? (isWork ? '可能已被删除，或者你没有权限查看。' : '可能是用户名写错了，或者对方不想被你看到。') : errMsg(x))}</p><a class="btn btn--soft" href="${url('/')}">回到首页</a></div>`;
  } finally {
    box.removeAttribute('aria-busy');
  }
}

// ---------------------------------------------------------------- 用户主页
async function renderProfile(box: HTMLElement, username: string, ctx: SocialCtx): Promise<void> {
  const r = await social.profile(username);
  const p = r.profile;
  const v = r.viewer;
  document.title = `${p.nickname}（@${p.username}）| ${document.title.split('|').pop()?.trim() ?? ''}`;
  const actions = v.self
    ? `<a class="btn btn--soft btn--sm" href="${url('/me/')}">${icon('edit')}编辑资料</a>`
    : v.loggedIn
      ? `${v.blocked ? '' : `<button class="btn btn--sm ${v.following ? 'btn--soft' : 'btn--primary'} js-follow" type="button" aria-pressed="${v.following}">${icon(v.following ? 'check' : 'userPlus')}<span>${v.following ? '已关注' : v.followedBy ? '回关' : '关注'}</span></button>`}
         ${v.blocked ? '' : `<button class="btn btn--soft btn--sm js-dm" type="button">${icon('message')}<span>私信</span></button>`}
         <button class="btn btn--ghost btn--sm js-mute" type="button" aria-pressed="${v.muted}">${icon(v.muted ? 'volume' : 'volumeMute')}<span>${v.muted ? '取消静音' : '静音'}</span></button>
         <button class="btn btn--ghost btn--sm js-block" type="button" aria-pressed="${v.blocked}">${icon('ban')}<span>${v.blocked ? '解除拉黑' : '拉黑'}</span></button>`
      : `<a class="btn btn--primary btn--sm" href="${url('/join/')}">${icon('userPlus')}登录后关注</a>`;
  const cover = 'coverUrl' in p && p.coverUrl ? ` style="--cover:url('${e(p.coverUrl).replace(/'/g, '%27')}')"` : '';
  if (r.restricted) {
    const why = r.restricted === 'blocked' ? '你已拉黑对方：互相看不到动态，对方也不能关注你。' : r.restricted === 'members' ? '对方的主页只对登录的好朋友开放。' : '对方把主页设为了私密。';
    box.innerHTML = `<article class="soc-profile soc-profile--restricted tile tile--full"><div class="soc-cover" aria-hidden="true"></div><div class="soc-id">${avatar(p, 'soc-av soc-av--xl')}<div><h1 class="soc-name">${e(p.nickname)}</h1><p class="muted">@${e(p.username)}</p></div></div><p class="soc-note">${icon('lock')}${why}</p><div class="soc-actions">${actions}</div></article>`;
    bindProfileActions(box, p, v, ctx);
    return;
  }
  const links = [p.website ? { label: new URL(p.website).hostname.replace(/^www\./, ''), url: p.website } : null, ...p.links].filter(Boolean) as { label: string; url: string }[];
  box.innerHTML = `<article class="soc-profile tile tile--full" aria-labelledby="soc-name">
  <div class="soc-cover"${cover} aria-hidden="true"></div>
  <div class="soc-id">${avatar(p, 'soc-av soc-av--xl')}<div class="soc-id__txt"><h1 class="soc-name" id="soc-name">${e(p.nickname)}</h1><p class="muted">@${e(p.username)}${v.followedBy && !v.self ? ' · <span class="soc-chip">关注了你</span>' : ''}</p></div><div class="soc-actions">${actions}</div></div>
  ${p.bio ? `<p class="soc-bio">${e(p.bio)}</p>` : ''}
  ${links.length ? `<ul class="soc-links" aria-label="网站与社交链接">${links.map((l) => `<li><a href="${e(l.url)}" rel="noopener nofollow ugc" target="_blank">${icon('external')}${e(l.label)}</a></li>`).join('')}</ul>` : ''}
  ${p.badges.length ? `<p class="soc-badges">${p.badges.map((b) => memberBadge(b.code, b.label, b.style, b.design)).join(' ')}</p>` : ''}
  <dl class="soc-stats">
    <div><dt>粉丝</dt><dd>${p.showFollows || v.self ? `<button class="soc-stat js-list" data-which="followers" type="button" aria-expanded="false"><b class="js-c-followers">${p.counts.followers}</b></button>` : `<b class="js-c-followers">${p.counts.followers}</b>`}</dd></div>
    <div><dt>关注</dt><dd>${p.showFollows || v.self ? `<button class="soc-stat js-list" data-which="following" type="button" aria-expanded="false"><b>${p.counts.following}</b></button>` : `<b>${p.counts.following}</b>`}</dd></div>
    <div><dt>作品</dt><dd><b>${p.counts.works}</b></dd></div>
    <div><dt>加入</dt><dd><b>${fmtDate(p.joinedAt)}</b></dd></div>
  </dl>
  <div class="soc-listbox js-listbox" hidden></div>
</article>
<section class="soc-works tile tile--full" aria-labelledby="soc-works-h"><h2 id="soc-works-h" class="soc-h">${icon('image')}作品</h2>${
    r.works?.length
      ? `<ul class="soc-wgrid">${r.works.map((w) => `<li><a class="soc-wcard" href="${url(`/w/${w.id}/`)}">${w.cover ? `<img src="${e(imgSrc(w.cover.url))}" alt="${e(w.cover.alt)}"${w.cover.width ? ` width="${w.cover.width}" height="${w.cover.height}"` : ''} loading="lazy" decoding="async">` : ''}<span class="soc-wcard__txt"><span class="soc-chip">${TYPE_LABEL[w.type] ?? ''}</span><b>${e(w.title || w.excerpt)}</b>${w.title && w.excerpt && w.excerpt !== w.title ? `<span class="muted small">${e(w.excerpt)}</span>` : ''}<time class="muted small" datetime="${e(w.createdAt)}">${ago(w.createdAt)}</time></span></a></li>`).join('')}</ul>`
      : `<p class="muted">还没有公开的作品。${v.self ? ` <a href="${url('/compose/')}">发布第一条</a>` : ''}</p>`
  }</section>`;
  bindProfileActions(box, p, v, ctx);
  // L17：社区徽章 / 创作者认证 / 公开合集（按需加载，失败不影响主页）
  void import('./discovery-client').then((m) => m.profileExtras(box, p.username, v.self)).catch(() => undefined);
  // L18：参与的项目（按需加载）+ 主页浏览计数（只记每日汇总）
  void import('./studio-client').then((m) => m.profileStudio(box, p.username)).catch(() => undefined);
  box.querySelectorAll<HTMLButtonElement>('.js-list').forEach((b) =>
    b.addEventListener('click', async () => {
      const lb = box.querySelector<HTMLElement>('.js-listbox')!;
      const open = b.getAttribute('aria-expanded') === 'true';
      box.querySelectorAll('.js-list').forEach((x) => x.setAttribute('aria-expanded', 'false'));
      if (open) return void (lb.hidden = true);
      b.setAttribute('aria-expanded', 'true');
      lb.hidden = false;
      lb.innerHTML = '<p class="muted">加载中…</p>';
      try {
        const which = b.dataset.which as 'followers' | 'following';
        const res = await social.follows(p.username, which);
        lb.innerHTML = `<h3 class="soc-h small">${which === 'followers' ? '粉丝' : '关注'}</h3>${res.users.length ? `<ul class="soc-users">${res.users.map((u) => `<li>${userLink(u)}</li>`).join('')}</ul>` : '<p class="muted">还没有人。</p>'}`;
      } catch (x) {
        lb.innerHTML = `<p class="muted">${e(errMsg(x))}</p>`;
      }
    }),
  );
}

function bindProfileActions(box: HTMLElement, p: { username: string }, v: ViewerRel, ctx: SocialCtx): void {
  const rerender = () => renderProfile(box, p.username, ctx).catch((x) => ctx.notify(errMsg(x), 'error'));
  box.querySelector<HTMLButtonElement>('.js-follow')?.addEventListener('click', async (ev) => {
    const b = ev.currentTarget as HTMLButtonElement;
    b.disabled = true;
    try {
      const r = await social.follow(p.username, !v.following);
      void ctx.notify(r.following ? `已关注 @${p.username}` : `已取消关注 @${p.username}`, r.following ? 'success' : 'info');
      await rerender();
      box.querySelector<HTMLElement>('.js-follow')?.focus();
    } catch (x) {
      b.disabled = false;
      void ctx.notify(errMsg(x), 'error');
    }
  });
  box.querySelector<HTMLButtonElement>('.js-dm')?.addEventListener('click', () => void import('./dm-client').then((m) => m.startDm(p.username, ctx)));
  for (const [sel, kind, on, label] of [['.js-mute', 'mutes', !v.muted, v.muted ? '已取消静音' : '已静音：对方的动态和通知不再打扰你'], ['.js-block', 'blocks', !v.blocked, v.blocked ? '已解除拉黑' : '已拉黑：互相取消关注，对方看不到你的主页']] as const) {
    box.querySelector<HTMLButtonElement>(sel)?.addEventListener('click', async () => {
      if (kind === 'blocks' && on && !confirm(`确定拉黑 @${p.username}？会互相取消关注，对方将看不到你的主页、不能关注你。`)) return;
      try {
        await social.relation(p.username, kind, on);
        void ctx.notify(label, 'info');
        await rerender();
        box.querySelector<HTMLElement>(sel)?.focus();
      } catch (x) {
        void ctx.notify(errMsg(x), 'error');
      }
    });
  }
}

// ---------------------------------------------------------------- 通知中心
const FILTERS: [NotificationFilter, string][] = [['all', '全部'], ['unread', '未读'], ['follow', '关注'], ['reply', '回复'], ['mention', '提及'], ['reaction', '回应'], ['bookmark', '收藏'], ['new_work', '新作品'], ['topic_work', '话题'], ['event_result', '活动'], ['collab', '协作']];
function noticeText(n: Notice): string {
  const who = n.actor ? `<a href="${userPath(n.actor.username)}"><b>${e(n.actor.nickname)}</b></a>` : '<b>一位访客</b>';
  const more = n.count > 1 ? `等 ${n.count} 人` : '';
  const target = n.objectKind === 'work' ? `<a href="${url(`/w/${encodeURIComponent(n.objectRef)}/`)}">查看</a>` : n.objectKind === 'topic' ? `<a href="${url(`/t/${encodeURIComponent(n.objectRef)}/`)}">去看看</a>` : n.objectKind === 'event' ? `<a href="${url(`/events/${encodeURIComponent(n.objectRef)}/`)}">查看结果</a>` : n.objectKind === 'project' ? `<a href="${/^\d+$/.test(n.objectRef) ? url('/me/') : url(`/p/${encodeURIComponent(n.objectRef)}/`)}">查看</a>` : n.objectKind === 'post' || n.objectKind === 'comment' ? `<a href="${postPath(n.objectRef.split('#')[0]!)}#comments">查看</a>` : '';
  switch (n.type) {
    case 'follow':
      return `${who} 关注了你`;
    case 'reply':
      return `${who}${more} ${n.objectKind === 'work' ? '评论了你' : '回复了你的评论'} ${target}`;
    case 'mention':
      return `${who} ${n.objectKind === 'work' ? '提到了你' : '在评论里提到了你'} ${target}`;
    case 'bookmark':
      return `${who}${more} 收藏了你的作品 ${target}`;
    case 'reaction':
      return `${who}${more} 回应了你的作品 ${target}`;
    case 'new_work':
      return `${who} 发布了新作品 ${target}`;
    case 'moderation':
      return `${e(n.excerpt || '你的内容有审核结果')} ${target}`;
    case 'topic_work':
      return `${e(n.excerpt || '你订阅的话题有新作品')}${n.count > 1 ? `（${n.count} 件）` : ''} ${target}`;
    case 'event_result':
      return `${e(n.excerpt || '你参加的活动公布了结果')} ${target}`;
    case 'collab':
      return `${who} ${e(n.excerpt || '发来了协作邀请')} ${target}`;
    default:
      return e(n.excerpt || '站内通知');
  }
}
const NOTICE_ICON: Record<string, string> = { follow: 'userPlus', reply: 'message', mention: 'send', bookmark: 'bookmark', system: 'bell', reaction: 'heart', new_work: 'image', moderation: 'flag', topic_work: 'tag', event_result: 'camera', collab: 'users' };

async function renderNotifications(box: HTMLElement, ctx: SocialCtx): Promise<void> {
  if (!currentMember()) return void (box.innerHTML = gate('通知'));
  let filter: NotificationFilter = 'all';
  let cursor: string | null = null;
  box.innerHTML = `<div class="soc-notes tile tile--full">
  <div class="soc-notes__bar"><div class="soc-filters" role="group" aria-label="筛选通知">${FILTERS.map(([k, l]) => `<button type="button" class="soc-filter js-filter" data-f="${k}" aria-pressed="${k === 'all'}">${l}</button>`).join('')}</div>
  <button class="btn btn--soft btn--sm js-readall" type="button">${icon('check')}全部已读</button></div>
  <p class="visually-hidden js-unread-live" role="status"></p>
  <ul class="soc-nlist js-nlist" aria-label="通知列表"></ul>
  <button class="btn btn--ghost btn--sm js-more" type="button" hidden>加载更多</button>
</div>`;
  const list = box.querySelector<HTMLElement>('.js-nlist')!;
  const moreBtn = box.querySelector<HTMLButtonElement>('.js-more')!;
  const live = box.querySelector<HTMLElement>('.js-unread-live')!;
  const load = async (append: boolean) => {
    const r = await social.notifications(filter, append ? cursor : null);
    cursor = r.nextCursor;
    moreBtn.hidden = !cursor;
    live.textContent = `${r.unread} 条未读`;
    const html = r.notifications
      .map(
        (n) => `<li class="soc-n${n.read ? '' : ' is-unread'}" data-id="${n.id}"><span class="soc-n__ic soc-n__ic--${e(n.type)}" aria-hidden="true">${icon(NOTICE_ICON[n.type] ?? 'bell')}</span>${n.actor ? avatar(n.actor) : ''}<div class="soc-n__body"><p>${noticeText(n)}</p>${n.excerpt && n.type !== 'follow' && n.type !== 'moderation' ? `<p class="soc-n__ex muted small">${e(n.excerpt)}</p>` : ''}<time class="muted small" datetime="${e(n.updatedAt)}">${ago(n.updatedAt)}</time></div>${n.read ? '<span class="visually-hidden">已读</span>' : `<button class="soc-n__mark js-mark" type="button" aria-label="标记为已读">${icon('check')}</button>`}</li>`,
      )
      .join('');
    if (append) list.insertAdjacentHTML('beforeend', html);
    else list.innerHTML = html || `<li class="soc-empty muted">${filter === 'unread' ? '没有未读通知，都看完啦。' : '这里还没有通知。'}</li>`;
    void refreshUnread();
  };
  await load(false);
  box.querySelectorAll<HTMLButtonElement>('.js-filter').forEach((b) =>
    b.addEventListener('click', async () => {
      filter = b.dataset.f as NotificationFilter;
      box.querySelectorAll('.js-filter').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      await load(false).catch((x) => ctx.notify(errMsg(x), 'error'));
    }),
  );
  moreBtn.addEventListener('click', () => void load(true).catch((x) => ctx.notify(errMsg(x), 'error')));
  box.querySelector('.js-readall')!.addEventListener('click', async () => {
    try {
      await social.markRead({ all: true });
      void ctx.notify('全部标记为已读', 'success');
      await load(false);
    } catch (x) {
      void ctx.notify(errMsg(x), 'error');
    }
  });
  list.addEventListener('click', async (ev) => {
    const t = ev.target as HTMLElement;
    const li = t.closest<HTMLElement>('.soc-n.is-unread');
    if (!li) return;
    const id = Number(li.dataset.id);
    const viaButton = !!t.closest('.js-mark');
    try {
      const r = await social.markRead({ ids: [id] });
      li.classList.remove('is-unread');
      const btn = li.querySelector<HTMLElement>('.js-mark');
      if (btn) {
        const next = li.nextElementSibling?.querySelector<HTMLElement>('.js-mark') ?? box.querySelector<HTMLElement>('.js-readall');
        btn.outerHTML = '<span class="visually-hidden">已读</span>';
        if (viaButton) next?.focus();
      }
      live.textContent = `${r.unread} 条未读`;
      void refreshUnread();
    } catch (x) {
      void ctx.notify(errMsg(x), 'error');
    }
  });
}

// ---------------------------------------------------------------- 我的（资料 / 隐私 / 通知 / 收藏 / 拉黑 / 账号）
async function renderMe(box: HTMLElement, ctx: SocialCtx): Promise<void> {
  if (!currentMember()) return void (box.innerHTML = gate('「我的」'));
  const [{ profile: p, settings: s }, { prefs }] = await Promise.all([social.me(), social.prefs()]);
  const linkRows = [0, 1, 2, 3, 4].map((i) => {
    const l = p.links[i];
    return `<div class="soc-linkrow"><label><span class="visually-hidden">链接 ${i + 1} 名称</span><input name="ll${i}" maxlength="24" placeholder="名称" value="${e(l?.label ?? '')}"></label><label><span class="visually-hidden">链接 ${i + 1} 地址</span><input name="lu${i}" type="url" maxlength="200" placeholder="https://…" value="${e(l?.url ?? '')}"></label></div>`;
  });
  const chk = (name: string, on: boolean, label: string, hint = '') => `<label class="soc-check"><input type="checkbox" name="${name}"${on ? ' checked' : ''}><span>${label}${hint ? `<small class="muted">${hint}</small>` : ''}</span></label>`;
  box.innerHTML = `<section class="tile tile--full soc-me__head">${avatar(p, 'soc-av soc-av--lg')}<div><h2 class="soc-name">${e(p.nickname)}</h2><p class="muted">@<span class="js-me-username">${e(p.username)}</span> · 粉丝 ${p.counts.followers} · 关注 ${p.counts.following}</p></div><div class="soc-actions"><a class="btn btn--soft btn--sm" href="${url('/messages/')}">${icon('message')}私信</a><a class="btn btn--soft btn--sm js-my-page" href="${userPath(p.username)}">${icon('user')}查看我的主页</a><a class="btn btn--ghost btn--sm" href="${url('/notifications/')}">${icon('bell')}通知</a><a class="btn btn--ghost btn--sm" href="${url('/join/')}">${icon('verified')}徽章与登录</a></div></section>
<section class="tile tile--half soc-find" aria-labelledby="soc-find-h"><h2 class="soc-h" id="soc-find-h">${icon('search')}找人</h2><form class="js-find" role="search"><label for="soc-q" class="visually-hidden">按用户名或昵称搜索</label><div class="soc-find__row"><input id="soc-q" name="q" maxlength="40" placeholder="用户名或昵称" autocomplete="off"><button class="btn btn--primary btn--sm" type="submit">搜索</button></div></form><ul class="soc-users js-find-res" aria-live="polite"></ul></section>
<section class="tile tile--half" aria-labelledby="soc-bm-h"><h2 class="soc-h" id="soc-bm-h">${icon('bookmark')}云端收藏</h2><p class="muted small">在任何设备登录都能看到。文章卡片上的书签按钮会自动同步。</p><ul class="soc-bms js-bms"><li class="muted">加载中…</li></ul><button class="btn btn--ghost btn--sm js-bm-more" type="button" hidden>加载更多</button></section>
<section class="tile tile--full" aria-labelledby="soc-prof-h"><h2 class="soc-h" id="soc-prof-h">${icon('edit')}资料</h2>
<form class="soc-form js-profile" novalidate>
  <label>用户名<input name="username" required minlength="3" maxlength="20" pattern="[a-z0-9_]{3,20}" value="${e(p.username)}" aria-describedby="soc-un-hint" autocapitalize="off" spellcheck="false"><small id="soc-un-hint" class="muted">3–20 位小写字母、数字或下划线，全站唯一；主页地址 /u/用户名/</small></label>
  <label>昵称<input name="nickname" required maxlength="40" value="${e(p.nickname)}"></label>
  <label>头像地址<input name="avatarUrl" type="url" maxlength="300" placeholder="https://…" value="${e(p.avatarUrl)}"></label>
  <label>封面地址<input name="coverUrl" type="url" maxlength="300" placeholder="https://…" value="${e(p.coverUrl)}"></label>
  <label class="soc-form__wide">个人介绍<textarea name="bio" maxlength="160" rows="2">${e(p.bio)}</textarea></label>
  <label class="soc-form__wide">个人网站<input name="website" type="url" maxlength="200" placeholder="https://…" value="${e(p.website)}"></label>
  <fieldset class="soc-form__wide"><legend>社交链接（最多 5 个，仅 https）</legend>${linkRows.join('')}</fieldset>
  <p class="soc-form__err js-perr" role="alert"></p>
  <button class="btn btn--primary" type="submit">${icon('check')}保存资料</button>
</form></section>
<section class="tile tile--half" aria-labelledby="soc-priv-h"><h2 class="soc-h" id="soc-priv-h">${icon('eye')}隐私</h2>
<form class="soc-form js-privacy"><fieldset><legend>谁能看我的主页</legend>
  <label class="soc-radio"><input type="radio" name="visibility" value="public"${s.visibility === 'public' ? ' checked' : ''}><span>所有人</span></label>
  <label class="soc-radio"><input type="radio" name="visibility" value="members"${s.visibility === 'members' ? ' checked' : ''}><span>仅登录的好朋友</span></label>
  <label class="soc-radio"><input type="radio" name="visibility" value="private"${s.visibility === 'private' ? ' checked' : ''}><span>仅自己</span></label></fieldset>
  ${chk('showFollows', s.showFollows, '公开我的关注 / 粉丝列表')}
  ${chk('discoverable', s.discoverable, '允许别人通过搜索找到我')}
  <button class="btn btn--soft btn--sm" type="submit">保存隐私设置</button></form></section>
<section class="tile tile--half" aria-labelledby="soc-mw-h"><h2 class="soc-h" id="soc-mw-h">${icon('image')}我的作品</h2><p class="muted small">管理草稿、待审核和已发布的作品；作品的可见范围可以是公开、仅关注者或仅自己。</p><p class="soc-actions"><a class="btn btn--primary btn--sm" href="${url('/compose/')}">${icon('plus')}发布</a><a class="btn btn--soft btn--sm" href="${url('/feed/?tab=mine')}">${icon('list')}草稿与作品</a></p></section>
<section class="tile tile--half" aria-labelledby="soc-np-h"><h2 class="soc-h" id="soc-np-h">${icon('bell')}通知设置</h2>
<form class="soc-form js-prefs"><fieldset><legend>站内通知</legend>${chk('follow', prefs.follow, '有人关注我')}${chk('reply', prefs.reply, '有人回复我的评论')}${chk('mention', prefs.mention, '有人 @ 我')}${chk('bookmark', prefs.bookmark, '有人收藏我的作品')}${chk('reaction', prefs.reaction !== false, '有人回应我的作品')}${chk('new_work', prefs.new_work !== false, '关注的人发布新作品')}${chk('topic_work', prefs.topic_work !== false, '订阅的话题有新作品', '每个话题每天最多一条')}${chk('event_result', prefs.event_result !== false, '参加的活动公布结果')}</fieldset>
  <fieldset><legend>邮件</legend>${chk('email', prefs.email, '同时发邮件提醒', '默认关闭；每小时最多 5 封')}</fieldset>
  <button class="btn btn--soft btn--sm" type="submit">保存通知设置</button></form></section>
<div class="js-disc-me" hidden></div>
<div class="js-studio-me" hidden></div>
<section class="tile tile--half" aria-labelledby="soc-bl-h"><h2 class="soc-h" id="soc-bl-h">${icon('ban')}拉黑与静音</h2><div class="js-rel"><p class="muted">加载中…</p></div></section>
<section class="tile tile--half soc-danger" aria-labelledby="soc-acc-h"><h2 class="soc-h" id="soc-acc-h">${icon('lock')}账号数据</h2>
  <p class="muted small">导出你的资料、关注、收藏、评论与通知（JSON）。</p><button class="btn btn--soft btn--sm js-export" type="button">${icon('download')}导出我的数据</button>
  <details class="soc-del"><summary>注销账号</summary><form class="soc-form js-delete"><p class="small">注销后资料、关注、收藏和通知会被删除，评论保留为匿名。此操作不可撤销。</p><label>输入你的用户名 <b>${e(p.username)}</b> 确认<input name="confirm" autocomplete="off" autocapitalize="off" spellcheck="false"></label><button class="btn btn--danger btn--sm" type="submit">${icon('trash')}永久注销</button></form></details>
</section>`;
  bindMe(box, ctx);
  // L17：我的合集 / 订阅的话题 / 活动投稿（按需加载）
  void import('./discovery-client').then((m) => m.meExtras(box, ctx)).catch(() => undefined);
  // L18：协作邀请、我的项目 / 摄影专题、数据中心入口
  void import('./studio-client').then((m) => m.meStudio(box, ctx)).catch(() => undefined);
}

function bindMe(box: HTMLElement, ctx: SocialCtx): void {
  const val = (f: HTMLFormElement, n: string) => (f.elements.namedItem(n) as HTMLInputElement | null)?.value.trim() ?? '';
  // 找人
  const find = box.querySelector<HTMLFormElement>('.js-find')!;
  find.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const res = box.querySelector<HTMLElement>('.js-find-res')!;
    const q = val(find, 'q');
    if (!q) return;
    try {
      const r = await social.search(q);
      res.innerHTML = r.users.length ? r.users.map((u) => `<li>${userLink(u)}</li>`).join('') : '<li class="muted">没有找到。</li>';
    } catch (x) {
      res.innerHTML = `<li class="muted">${e(errMsg(x))}</li>`;
    }
  });
  // 收藏
  let bmCursor: string | null = null;
  const bmList = box.querySelector<HTMLElement>('.js-bms')!;
  const bmMore = box.querySelector<HTMLButtonElement>('.js-bm-more')!;
  const loadBm = async (append: boolean) => {
    const r = await social.bookmarks(append ? bmCursor : null);
    bmCursor = r.nextCursor;
    bmMore.hidden = !bmCursor;
    const html = r.bookmarks.map((b) => `<li><a href="${postPath(b.ref)}">${e(b.title || b.ref)}</a><button class="soc-x js-bm-del" type="button" data-kind="${e(b.kind)}" data-ref="${e(b.ref)}" aria-label="取消收藏《${e(b.title || b.ref)}》">${icon('close')}</button></li>`).join('');
    if (append) bmList.insertAdjacentHTML('beforeend', html);
    else bmList.innerHTML = html || '<li class="muted soc-empty">还没有云端收藏。点文章卡片上的书签就能收藏。</li>';
  };
  void loadBm(false).catch((x) => (bmList.innerHTML = `<li class="muted">${e(errMsg(x))}</li>`));
  bmMore.addEventListener('click', () => void loadBm(true));
  bmList.addEventListener('click', async (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('.js-bm-del');
    if (!b) return;
    try {
      await social.removeBookmark(b.dataset.kind!, b.dataset.ref!);
      const li = b.closest('li')!;
      const next = (li.nextElementSibling ?? li.previousElementSibling)?.querySelector<HTMLElement>('button, a');
      li.remove();
      next?.focus();
      void ctx.notify('已取消收藏', 'info');
    } catch (x) {
      void ctx.notify(errMsg(x), 'error');
    }
  });
  // 资料
  const pf = box.querySelector<HTMLFormElement>('.js-profile')!;
  pf.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = pf.querySelector<HTMLElement>('.js-perr')!;
    err.textContent = '';
    const links = [0, 1, 2, 3, 4].map((i) => ({ label: val(pf, `ll${i}`), url: val(pf, `lu${i}`) })).filter((l) => l.url);
    const body = { username: val(pf, 'username').toLowerCase(), nickname: val(pf, 'nickname'), avatarUrl: val(pf, 'avatarUrl'), coverUrl: val(pf, 'coverUrl'), bio: val(pf, 'bio'), website: val(pf, 'website'), links };
    try {
      const r = await social.updateMe(body);
      box.querySelector('.js-me-username')!.textContent = r.profile.username;
      box.querySelector<HTMLAnchorElement>('.js-my-page')!.href = userPath(r.profile.username);
      void ctx.notify('资料已保存', 'success');
    } catch (x) {
      const d = x instanceof ApiError ? ((x.details as { path: string; message: string }[] | undefined)?.[0] ?? null) : null;
      err.textContent = d ? `${d.path}：${d.message}` : errMsg(x);
      const field = d ? pf.querySelector<HTMLElement>(`[name="${d.path.split('.')[0] === 'links' ? `lu${d.path.split('.')[1]}` : d.path}"]`) : x instanceof ApiError && x.code === 'username_taken' ? pf.querySelector<HTMLElement>('[name="username"]') : null;
      field?.setAttribute('aria-invalid', 'true');
      field?.focus();
    }
  });
  pf.addEventListener('input', (ev) => (ev.target as HTMLElement).removeAttribute('aria-invalid'));
  // 隐私
  const pv = box.querySelector<HTMLFormElement>('.js-privacy')!;
  pv.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const vis = (pv.querySelector<HTMLInputElement>('input[name="visibility"]:checked')?.value ?? 'public') as Settings['visibility'];
    try {
      await social.updateMe({ visibility: vis, showFollows: (pv.elements.namedItem('showFollows') as HTMLInputElement).checked, discoverable: (pv.elements.namedItem('discoverable') as HTMLInputElement).checked });
      void ctx.notify('隐私设置已保存', 'success');
    } catch (x) {
      void ctx.notify(errMsg(x), 'error');
    }
  });
  // 通知偏好
  const np = box.querySelector<HTMLFormElement>('.js-prefs')!;
  np.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const get = (n: string) => (np.elements.namedItem(n) as HTMLInputElement).checked;
    try {
      await social.setPrefs({ follow: get('follow'), reply: get('reply'), mention: get('mention'), bookmark: get('bookmark'), reaction: get('reaction'), new_work: get('new_work'), topic_work: get('topic_work'), event_result: get('event_result'), email: get('email') });
      void ctx.notify('通知设置已保存', 'success');
    } catch (x) {
      void ctx.notify(errMsg(x), 'error');
    }
  });
  // 拉黑 / 静音名单
  const rel = box.querySelector<HTMLElement>('.js-rel')!;
  const loadRel = async () => {
    const [b, m] = await Promise.all([social.relations('blocks'), social.relations('mutes')]);
    const row = (u: Card, kind: 'blocks' | 'mutes') => `<li>${userLink(u)}<button class="btn btn--ghost btn--sm js-unrel" type="button" data-kind="${kind}" data-u="${e(u.username)}">${kind === 'blocks' ? '解除拉黑' : '取消静音'}</button></li>`;
    rel.innerHTML = `<h3 class="small">已拉黑（${b.users.length}）</h3>${b.users.length ? `<ul class="soc-users">${b.users.map((u) => row(u, 'blocks')).join('')}</ul>` : '<p class="muted small">没有。</p>'}<h3 class="small">已静音（${m.users.length}）</h3>${m.users.length ? `<ul class="soc-users">${m.users.map((u) => row(u, 'mutes')).join('')}</ul>` : '<p class="muted small">没有。</p>'}`;
  };
  void loadRel().catch((x) => (rel.innerHTML = `<p class="muted">${e(errMsg(x))}</p>`));
  rel.addEventListener('click', async (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('.js-unrel');
    if (!b) return;
    try {
      await social.relation(b.dataset.u!, b.dataset.kind as 'blocks' | 'mutes', false);
      await loadRel();
      rel.querySelector<HTMLElement>('button, a')?.focus();
      void ctx.notify('已更新', 'success');
    } catch (x) {
      void ctx.notify(errMsg(x), 'error');
    }
  });
  // 导出
  box.querySelector('.js-export')!.addEventListener('click', async () => {
    try {
      const data = await social.exportMe();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `theblog-${box.querySelector('.js-me-username')?.textContent ?? 'me'}-export.json`;
      document.body.append(a);
      a.click();
      setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
      void ctx.notify('已导出', 'success');
    } catch (x) {
      void ctx.notify(errMsg(x), 'error');
    }
  });
  // 注销
  const del = box.querySelector<HTMLFormElement>('.js-delete')!;
  del.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await social.deleteMe(val(del, 'confirm'));
      localStorage.removeItem('blog-member');
      document.dispatchEvent(new CustomEvent('blog:member'));
      void ctx.notify('账号已注销', 'info');
      ctx.navigate ? ctx.navigate(url('/')) : location.assign(url('/'));
    } catch (x) {
      void ctx.notify(errMsg(x), 'error');
      del.querySelector<HTMLElement>('input')?.focus();
    }
  });
}
