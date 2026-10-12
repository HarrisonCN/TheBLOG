/**
 * L22 隐私与安全中心 /me/security/（按需加载：只有打开这个页面或点「用 Passkey 登录」时才下载）。
 * 5 个标签页：登录设备 · Passkey · 隐私权限（含拉黑名单）· 数据与注销（完整导出、7 天冷静期 + 撤销）· 安全记录。
 * 接口：/api/security/*（演示站由浏览器内 mock 实现，规则相同）。
 */
import './security.css';
import { ApiError, DEMO, request } from './api';
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { url, userPath } from './render';

type Notify = (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => Promise<void> | void;
interface Ctx { notify: Notify; navigate?: (href: string) => void }

export interface SessionItem { id: string; device: string; method: string; network: string; createdAt: number; lastSeenAt: number; current: boolean; demo?: boolean }
export interface PasskeyItem { id: string; label: string; alg: string; createdAt: number; lastUsedAt: number | null }
export interface EventItem { id: number; kind: string; device: string; network: string; detail: string; createdAt: number }
type Deletion = { state: 'none' } | { state: 'pending' | 'due'; purgeAt: number; daysLeft: number };
interface Privacy { visibility: 'public' | 'members' | 'private'; discoverable: boolean; showFollows: boolean; dmPolicy: 'everyone' | 'followers' | 'mutuals' | 'nobody'; readReceipts: boolean; showPresence: boolean; loginAlerts: boolean; emailNotifications: boolean }
interface Card { username: string; nickname: string; avatarUrl: string }
interface Overview { sessions: SessionItem[]; passkeys: PasskeyItem[]; events: EventItem[]; deletion: Deletion; privacy: Privacy; blocked: Card[]; demo?: boolean }

// ---------------------------------------------------------------- 令牌（与 community.ts 同一个存储位置；不 import community，避免把它拉进这个包）
const MEMBER_KEY = 'blog-member';
function token(): string {
  try {
    const raw = (DEMO && sessionStorage.getItem(MEMBER_KEY)) || localStorage.getItem(MEMBER_KEY);
    return raw ? ((JSON.parse(raw) as { token?: string }).token ?? '') : '';
  } catch {
    return '';
  }
}
const auth = (): Record<string, string> => (token() ? { authorization: `Bearer ${token()}` } : {});
const JSON_H = { 'content-type': 'application/json' };
const call = <T>(path: string, method = 'GET', body?: unknown) =>
  request<T>(`/api/security${path}`, { method, headers: { ...auth(), ...(body !== undefined ? JSON_H : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), timeoutMs: 20_000 });
const errMsg = (x: unknown) => (x instanceof ApiError ? x.message : (x as Error)?.message || '出错了，请稍后再试');

// ---------------------------------------------------------------- WebAuthn 编解码（纯函数，测试覆盖）
export function bytesToB64u(b: Uint8Array | ArrayBuffer): string {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64uToBytes(s: string): Uint8Array {
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
}
const buf = (s: string) => b64uToBytes(s).buffer as ArrayBuffer;
type JsonCreation = { challenge: string; user: { id: string; name: string; displayName: string }; excludeCredentials?: { type: string; id: string }[]; [k: string]: unknown };
type JsonRequest = { challenge: string; allowCredentials?: { type: string; id: string }[]; [k: string]: unknown };
export function toCreationOptions(o: JsonCreation): PublicKeyCredentialCreationOptions {
  return {
    ...(o as unknown as PublicKeyCredentialCreationOptions),
    challenge: buf(o.challenge),
    user: { ...o.user, id: buf(o.user.id) },
    excludeCredentials: (o.excludeCredentials ?? []).map((c) => ({ type: 'public-key' as const, id: buf(c.id) })),
  };
}
export function toRequestOptions(o: JsonRequest): PublicKeyCredentialRequestOptions {
  return { ...(o as unknown as PublicKeyCredentialRequestOptions), challenge: buf(o.challenge), allowCredentials: (o.allowCredentials ?? []).map((c) => ({ type: 'public-key' as const, id: buf(c.id) })) };
}
/** navigator.credentials 的结果 → 发给服务器的 JSON（字段都是 base64url） */
export function credentialJson(c: PublicKeyCredential): Record<string, string> {
  const r = c.response as AuthenticatorAttestationResponse & AuthenticatorAssertionResponse;
  const out: Record<string, string> = { id: bytesToB64u(c.rawId), clientDataJSON: bytesToB64u(r.clientDataJSON) };
  if ('attestationObject' in r && r.attestationObject) out.attestationObject = bytesToB64u(r.attestationObject);
  if ('authenticatorData' in r && r.authenticatorData) out.authenticatorData = bytesToB64u(r.authenticatorData);
  if ('signature' in r && r.signature) out.signature = bytesToB64u(r.signature);
  return out;
}
export const passkeySupported = () => typeof window !== 'undefined' && 'PublicKeyCredential' in window && !!navigator.credentials;

const passkeyError = (x: unknown): string => {
  const n = (x as DOMException)?.name;
  if (n === 'NotAllowedError') return '已取消，或者这台设备上没有可用的 Passkey';
  if (n === 'InvalidStateError') return '这台设备上的 Passkey 已经添加过了';
  if (n === 'SecurityError') return '当前网址不能使用 Passkey（需要 HTTPS 域名）';
  return errMsg(x);
};

/** 登录页「用 Passkey 登录」：无用户名（可发现凭据），成功返回会员令牌。 */
export async function passkeyLogin(): Promise<{ member: unknown; token: string }> {
  if (!passkeySupported()) throw new Error('这个浏览器不支持 Passkey');
  const o = await request<{ challengeId: string; publicKey: JsonRequest }>('/api/security/passkeys/login/options', { method: 'POST', headers: JSON_H, body: '{}' });
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.get({ publicKey: toRequestOptions(o.publicKey) })) as PublicKeyCredential | null;
  } catch (x) {
    throw new Error(passkeyError(x));
  }
  if (!cred) throw new Error('已取消');
  return request('/api/security/passkeys/login/verify', { method: 'POST', headers: JSON_H, body: JSON.stringify({ challengeId: o.challengeId, ...credentialJson(cred) }) });
}

// ---------------------------------------------------------------- 文案（与后台共用）
import { EVENT_LABEL, METHOD, WARN, eventText } from './security-labels';
export { EVENT_LABEL, eventText };

const TIME = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmt = (sec: number) => TIME.format(new Date(sec * 1000));
function ago(sec: number): string {
  const s = Math.max(0, Date.now() / 1000 - sec);
  if (s < 120) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`;
  return fmt(sec);
}
const when = (sec: number) => `<time datetime="${new Date(sec * 1000).toISOString()}" title="${e(fmt(sec))}">${e(ago(sec))}</time>`;

// ---------------------------------------------------------------- 外壳（标签页）
export const SEC_TABS = [
  { key: 'devices', icon: 'user', label: '登录设备' },
  { key: 'passkeys', icon: 'lock', label: 'Passkey' },
  { key: 'privacy', icon: 'eye', label: '隐私权限' },
  { key: 'data', icon: 'download', label: '数据与注销' },
  { key: 'log', icon: 'history', label: '安全记录' },
] as const;
export type SecTab = (typeof SEC_TABS)[number]['key'];
const isTab = (t: string | null): t is SecTab => SEC_TABS.some((x) => x.key === t);

export function centerHtml(active: SecTab): string {
  const tabs = SEC_TABS.map((t) => {
    const on = t.key === active;
    return `<button type="button" role="tab" class="sec-tab" id="sec-tab-${t.key}" aria-controls="sec-panel-${t.key}" aria-selected="${on}" tabindex="${on ? 0 : -1}" data-tab="${t.key}">${icon(t.icon)}<span>${t.label}</span></button>`;
  }).join('');
  const panels = SEC_TABS.map((t) => `<div class="sec-panel js-sec-panel" role="tabpanel" id="sec-panel-${t.key}" aria-labelledby="sec-tab-${t.key}" tabindex="0" data-panel="${t.key}"${t.key === active ? '' : ' hidden'}><p class="muted">加载中…</p></div>`).join('');
  return `<section class="tile tile--full sec" aria-labelledby="sec-h"><h2 class="soc-h" id="sec-h">${icon('lock')}隐私与安全中心</h2><p class="muted small js-sec-summary"></p><div class="sec-tabs" role="tablist" aria-label="隐私与安全">${tabs}</div>${panels}</section>`;
}

function sessionsHtml(o: Overview): string {
  const others = o.sessions.filter((s) => !s.current).length;
  const rows = o.sessions
    .map(
      (s) => `<li class="sec-item${s.current ? ' is-current' : ''}"><div class="sec-item__main"><b>${e(s.device)}</b>${s.current ? '<span class="sec-chip sec-chip--ok">本机</span>' : ''}${s.demo ? '<span class="sec-chip">演示数据</span>' : ''}<span class="muted small">${e(METHOD[s.method] ?? s.method)}登录 · 最近活跃 ${when(s.lastSeenAt)} · 首次登录 ${e(fmt(s.createdAt))}${s.network ? ` · 网络 ${e(s.network)}` : ''}</span></div>${s.current ? '' : `<button class="btn btn--ghost btn--sm js-sec-revoke" type="button" data-id="${e(s.id)}" aria-label="退出 ${e(s.device)}">${icon('logout')}退出</button>`}</li>`,
    )
    .join('');
  return `<p class="muted small">这里列出所有登录着你账号的设备。我们只保存浏览器和系统名称，不保存完整的 User-Agent 或 IP 地址（「网络」是加盐哈希后的短标记，只用来判断是不是新网络）。</p>
<ul class="sec-list">${rows || '<li class="muted">没有登录中的设备。</li>'}</ul>
<div class="sec-actions"><button class="btn btn--soft btn--sm js-sec-revoke-others" type="button"${others ? '' : ' disabled'}>${icon('logout')}退出其它所有设备</button><button class="btn btn--ghost btn--sm js-sec-revoke-all" type="button">${icon('close')}退出全部设备（包括本机）</button></div>`;
}

function passkeysHtml(o: Overview): string {
  const sup = passkeySupported();
  const rows = o.passkeys
    .map(
      (k) => `<li class="sec-item"><div class="sec-item__main"><b>${e(k.label)}</b><span class="sec-chip">${e(k.alg)}</span><span class="muted small">添加于 ${e(fmt(k.createdAt))} · ${k.lastUsedAt ? `最近使用 ${when(k.lastUsedAt)}` : '还没用过'}</span></div><div class="sec-item__act"><button class="btn btn--ghost btn--sm js-pk-rename" type="button" data-id="${e(k.id)}" data-label="${e(k.label)}" aria-label="重命名 ${e(k.label)}">${icon('edit')}重命名</button><button class="btn btn--ghost btn--sm js-pk-del" type="button" data-id="${e(k.id)}" data-label="${e(k.label)}" aria-label="删除 ${e(k.label)}">${icon('trash')}删除</button></div></li>`,
    )
    .join('');
  return `<p class="muted small">Passkey 用手机或电脑的指纹 / 面容 / 锁屏密码登录，不用再收邮箱验证码；私钥只在你的设备里，网站只保存公钥。Passkey 是可选的，邮箱验证码登录一直可用。</p>
<ul class="sec-list">${rows || '<li class="muted sec-empty">还没有 Passkey。</li>'}</ul>
${sup ? `<form class="sec-form js-pk-add"><label for="pk-label">名称（可选）</label><div class="sec-row"><input id="pk-label" name="label" maxlength="40" placeholder="例如：我的手机" autocomplete="off"><button class="btn btn--primary btn--sm" type="submit">${icon('plus')}添加 Passkey</button></div></form>` : '<p class="sec-note">这个浏览器不支持 Passkey。可以换用新版 Chrome、Safari、Edge 或 Firefox。</p>'}
${DEMO ? '<p class="muted small">演示站：Passkey 会真的由你的设备创建，公钥只保存在这个浏览器里。</p>' : ''}`;
}

function privacyHtml(o: Overview): string {
  const p = o.privacy;
  const radio = (name: string, v: string, cur: string, label: string) => `<label class="soc-radio"><input type="radio" name="${name}" value="${v}"${cur === v ? ' checked' : ''}><span>${label}</span></label>`;
  const chk = (name: string, on: boolean, label: string, hint = '') => `<label class="soc-check"><input type="checkbox" name="${name}"${on ? ' checked' : ''}><span>${label}${hint ? `<small class="muted">${hint}</small>` : ''}</span></label>`;
  const blocked = o.blocked
    .map((u) => `<li class="sec-item"><div class="sec-item__main"><a href="${userPath(u.username)}"><b>${e(u.nickname)}</b></a><span class="muted small">@${e(u.username)}</span></div><button class="btn btn--ghost btn--sm js-sec-unblock" type="button" data-u="${e(u.username)}" aria-label="取消拉黑 ${e(u.nickname)}">取消拉黑</button></li>`)
    .join('');
  return `<form class="sec-form js-sec-privacy">
<fieldset><legend>谁能看我的主页</legend>${radio('visibility', 'public', p.visibility, '所有人')}${radio('visibility', 'members', p.visibility, '仅登录的好朋友')}${radio('visibility', 'private', p.visibility, '仅自己')}</fieldset>
<fieldset><legend>谁可以给我发私信</legend>${radio('dmPolicy', 'everyone', p.dmPolicy, '所有人（陌生人先进消息请求）')}${radio('dmPolicy', 'followers', p.dmPolicy, '我关注的人')}${radio('dmPolicy', 'mutuals', p.dmPolicy, '互相关注')}${radio('dmPolicy', 'nobody', p.dmPolicy, '不接收')}</fieldset>
<fieldset><legend>可见性与提醒</legend>${chk('discoverable', p.discoverable, '允许别人通过搜索找到我')}${chk('showFollows', p.showFollows, '公开我的关注 / 粉丝列表')}${chk('readReceipts', p.readReceipts, '发送已读回执', '关闭后你也看不到别人的已读')}${chk('showPresence', p.showPresence, '显示在线状态', '只对会话对象 / 互关可见')}${chk('loginAlerts', p.loginAlerts, '新设备 / 新网络登录时提醒我', '在通知中心里提醒')}</fieldset>
<p class="muted small">邮件提醒：${p.emailNotifications ? '已开启' : '已关闭'}（在 <a href="${url('/me/')}">我的 → 通知设置</a> 修改）。</p>
<button class="btn btn--primary btn--sm" type="submit">${icon('check')}保存隐私设置</button></form>
<h3 class="sec-h3">拉黑名单</h3><p class="muted small">被拉黑的人看不到你的主页和作品，不能关注你、给你发私信或回复你。</p>
<ul class="sec-list js-sec-blocked">${blocked || '<li class="muted sec-empty">没有拉黑任何人。</li>'}</ul>`;
}

function dataHtml(o: Overview, username: string): string {
  const d = o.deletion;
  const del =
    d.state === 'none'
      ? `<details class="soc-del"><summary>注销账号</summary><form class="sec-form js-sec-delete"><p class="small">申请后有 <b>7 天冷静期</b>：期间可以随时撤销；到期后你的资料、作品、私信、收藏、关注和上传文件会被永久删除，博客文章下的评论保留为匿名。申请时会退出其它所有设备。</p><label for="sec-confirm">输入你的用户名 <b>${e(username)}</b> 确认</label><input id="sec-confirm" name="confirm" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn btn--danger btn--sm" type="submit">${icon('trash')}申请注销</button></form></details>`
      : `<div class="sec-pending" role="status"><p><b>账号将在 ${e(fmt(d.purgeAt))} 被永久删除</b>（还剩 ${d.daysLeft} 天）。</p><p class="muted small">改变主意了？撤销后账号恢复正常，什么都不会丢。</p><button class="btn btn--primary btn--sm js-sec-cancel" type="button">${icon('refresh')}撤销注销</button></div>`;
  return `<h3 class="sec-h3">导出全部数据</h3><p class="muted small">一个 JSON 文件：账号与资料、作品与草稿、评论、私信、收藏、关注、通知、项目、活动投稿、登录设备与安全记录，外加媒体文件清单（图片地址逐个列出）。每 24 小时最多 3 次。</p>
<button class="btn btn--soft btn--sm js-sec-export" type="button">${icon('download')}导出全部数据</button>
<h3 class="sec-h3">注销账号</h3>${del}`;
}

function eventsHtml(list: EventItem[], next: number | null): string {
  const rows = list
    .map((v) => `<li class="sec-ev${WARN.has(v.kind) ? ' is-warn' : ''}"><span class="sec-ev__ic" aria-hidden="true">${icon(WARN.has(v.kind) ? 'flag' : 'check')}</span><div><b>${e(eventText(v))}</b><span class="muted small">${when(v.createdAt)}${v.device ? ` · ${e(v.device)}` : ''}${v.network ? ` · 网络 ${e(v.network)}` : ''}</span></div></li>`)
    .join('');
  return `${rows ? `<ul class="sec-evs js-sec-evs">${rows}</ul>` : '<p class="muted sec-empty">还没有安全记录。</p>'}${next ? `<button class="btn btn--ghost btn--sm js-sec-more" type="button" data-before="${next}">更早的记录</button>` : ''}<p class="muted small">安全记录保留 180 天。</p>`;
}

// ---------------------------------------------------------------- 挂载
export async function mountSecurity(box: HTMLElement, ctx: Ctx): Promise<void> {
  if (!token()) {
    box.innerHTML = `<div class="soc-gate tile tile--full">${icon('lock')}<h2>登录后查看隐私与安全中心</h2><p class="muted">在这里管理登录设备、Passkey、隐私权限、数据导出与注销。</p><a class="btn btn--primary" href="${url('/join/')}">${icon('user')}登录 / 注册</a></div>`;
    return;
  }
  const params = new URLSearchParams(location.search);
  let active: SecTab = isTab(params.get('tab')) ? (params.get('tab') as SecTab) : 'devices';
  const [o, me] = await Promise.all([call<Overview>('/overview'), request<{ profile: { username: string } }>('/api/social/me', { headers: auth() })]);
  let data = o;
  const username = me.profile.username;
  box.innerHTML = centerHtml(active);
  const panel = (k: SecTab) => box.querySelector<HTMLElement>(`[data-panel="${k}"]`)!;
  const summary = () => {
    const s = box.querySelector<HTMLElement>('.js-sec-summary');
    if (s) s.textContent = `${data.sessions.length} 台设备登录中 · ${data.passkeys.length} 个 Passkey${data.deletion.state === 'none' ? '' : ' · 账号注销冷静期中'}${data.sessions.some((x) => x.demo) ? ' · 演示站：设备列表含虚构数据' : ''}`;
  };
  const paint = (k: SecTab) => {
    const p = panel(k);
    if (k === 'devices') p.innerHTML = sessionsHtml(data);
    else if (k === 'passkeys') p.innerHTML = passkeysHtml(data);
    else if (k === 'privacy') p.innerHTML = privacyHtml(data);
    else if (k === 'data') p.innerHTML = dataHtml(data, username);
    else void loadEvents(false);
    summary();
  };
  const refresh = async (k: SecTab) => {
    data = await call<Overview>('/overview');
    paint(k);
  };
  const evs: EventItem[] = [];
  const loadEvents = async (more: boolean, before?: number) => {
    const r = await call<{ events: EventItem[]; nextBefore: number | null }>(`/events?limit=20${before ? `&before=${before}` : ''}`);
    if (!more) evs.length = 0;
    evs.push(...r.events);
    panel('log').innerHTML = eventsHtml(evs, r.nextBefore);
  };
  const select = (k: SecTab, focus = false) => {
    active = k;
    box.querySelectorAll<HTMLButtonElement>('[role="tab"]').forEach((t) => {
      const on = t.dataset.tab === k;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    box.querySelectorAll<HTMLElement>('.js-sec-panel').forEach((p) => (p.hidden = p.dataset.panel !== k));
    const u = new URL(location.href);
    u.searchParams.set('tab', k);
    history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    paint(k);
  };
  paint(active);
  const tablist = box.querySelector<HTMLElement>('[role="tablist"]')!;
  tablist.addEventListener('click', (ev) => {
    const t = (ev.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    if (t) select(t.dataset.tab as SecTab);
  });
  tablist.addEventListener('keydown', (ev) => {
    const i = SEC_TABS.findIndex((t) => t.key === active);
    const n = ev.key === 'ArrowRight' ? i + 1 : ev.key === 'ArrowLeft' ? i - 1 : ev.key === 'Home' ? 0 : ev.key === 'End' ? SEC_TABS.length - 1 : null;
    if (n === null) return;
    ev.preventDefault();
    select(SEC_TABS[(n + SEC_TABS.length) % SEC_TABS.length]!.key, true);
  });

  const busy = async (btn: HTMLButtonElement | null, fn: () => Promise<void>) => {
    if (btn) btn.disabled = true;
    try {
      await fn();
    } catch (x) {
      if (x instanceof ApiError && x.status === 401) {
        void ctx.notify('已退出登录', 'info');
        return void (location.href = url('/join/'));
      }
      void ctx.notify(errMsg(x), 'error');
    } finally {
      if (btn?.isConnected) btn.disabled = false;
    }
  };
  const focusTab = (k: SecTab) => panel(k).focus();

  box.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const b = t.closest<HTMLButtonElement>('button');
    if (!b) return;
    if (b.matches('.js-sec-revoke'))
      return void busy(b, async () => {
        await call(`/sessions/${b.dataset.id}`, 'DELETE');
        void ctx.notify('已退出这台设备', 'success');
        await refresh('devices');
        focusTab('devices');
      });
    if (b.matches('.js-sec-revoke-others'))
      return void busy(b, async () => {
        if (!confirm('退出除本机以外的所有设备？')) return;
        const r = await call<{ revoked: number }>('/sessions/revoke-others', 'POST', {});
        void ctx.notify(`已退出 ${r.revoked} 台设备`, 'success');
        await refresh('devices');
        focusTab('devices');
      });
    if (b.matches('.js-sec-revoke-all'))
      return void busy(b, async () => {
        if (!confirm('退出全部设备，包括这台？之后需要重新登录。')) return;
        await call('/sessions/revoke-all', 'POST', {});
        localStorage.removeItem(MEMBER_KEY);
        if (DEMO) sessionStorage.removeItem(MEMBER_KEY);
        document.dispatchEvent(new CustomEvent('blog:member'));
        void ctx.notify('已退出全部设备', 'info');
        location.href = url('/join/');
      });
    if (b.matches('.js-pk-rename'))
      return void busy(b, async () => {
        const label = prompt('Passkey 名称', b.dataset.label ?? '')?.trim();
        if (!label) return;
        await call(`/passkeys/${b.dataset.id}`, 'PATCH', { label });
        void ctx.notify('已重命名', 'success');
        await refresh('passkeys');
        focusTab('passkeys');
      });
    if (b.matches('.js-pk-del'))
      return void busy(b, async () => {
        if (!confirm(`删除 Passkey「${b.dataset.label}」？删除后这台设备不能再用它登录（设备上的凭据请在系统设置里删除）。`)) return;
        await call(`/passkeys/${b.dataset.id}`, 'DELETE');
        void ctx.notify('已删除 Passkey', 'success');
        await refresh('passkeys');
        focusTab('passkeys');
      });
    if (b.matches('.js-sec-unblock'))
      return void busy(b, async () => {
        await request(`/api/social/blocks/${encodeURIComponent(b.dataset.u!)}`, { method: 'DELETE', headers: auth() });
        void ctx.notify('已取消拉黑', 'success');
        await refresh('privacy');
        focusTab('privacy');
      });
    if (b.matches('.js-sec-export'))
      return void busy(b, async () => {
        const archive = await call<unknown>('/export');
        const blob = new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `theblog-${username}-full-export.json`;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        void ctx.notify('已导出', 'success');
      });
    if (b.matches('.js-sec-cancel'))
      return void busy(b, async () => {
        await call('/deletion/cancel', 'POST', {});
        void ctx.notify('已撤销注销，账号恢复正常', 'success');
        await refresh('data');
        focusTab('data');
      });
    if (b.matches('.js-sec-more')) return void busy(b, () => loadEvents(true, Number(b.dataset.before)));
  });

  box.addEventListener('submit', (ev) => {
    const f = ev.target as HTMLFormElement;
    ev.preventDefault();
    const btn = f.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (f.matches('.js-pk-add'))
      return void busy(btn, async () => {
        const label = (f.elements.namedItem('label') as HTMLInputElement).value.trim();
        const o = await call<{ challengeId: string; publicKey: JsonCreation }>('/passkeys/register/options', 'POST', {});
        let cred: PublicKeyCredential | null;
        try {
          cred = (await navigator.credentials.create({ publicKey: toCreationOptions(o.publicKey) })) as PublicKeyCredential | null;
        } catch (x) {
          throw new Error(passkeyError(x));
        }
        if (!cred) throw new Error('已取消');
        await call('/passkeys/register/verify', 'POST', { challengeId: o.challengeId, label, ...credentialJson(cred) });
        void ctx.notify('已添加 Passkey', 'success');
        await refresh('passkeys');
        focusTab('passkeys');
      });
    if (f.matches('.js-sec-privacy'))
      return void busy(btn, async () => {
        const v = (n: string) => (f.querySelector<HTMLInputElement>(`input[name="${n}"]:checked`)?.value ?? '');
        const c = (n: string) => !!f.querySelector<HTMLInputElement>(`input[name="${n}"]`)?.checked;
        await call('/privacy', 'PUT', { visibility: v('visibility'), dmPolicy: v('dmPolicy'), discoverable: c('discoverable'), showFollows: c('showFollows'), readReceipts: c('readReceipts'), showPresence: c('showPresence'), loginAlerts: c('loginAlerts') });
        void ctx.notify('隐私设置已保存', 'success');
        data = await call<Overview>('/overview');
      });
    if (f.matches('.js-sec-delete'))
      return void busy(btn, async () => {
        const confirmName = (f.elements.namedItem('confirm') as HTMLInputElement).value.trim();
        const r = await call<{ deletion: Deletion }>('/deletion', 'POST', { confirm: confirmName });
        void ctx.notify(r.deletion.state === 'none' ? '没有申请成功' : '已申请注销：7 天后删除，期间可以撤销', 'warning');
        await refresh('data');
        focusTab('data');
      });
  });
}
