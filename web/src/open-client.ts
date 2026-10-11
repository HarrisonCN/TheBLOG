/**
 * L20 开放创作者网络的前端（按需加载，不进首屏包）：
 *  - 站外回应（Webmention）：文章 / 作品下方显示经审核的回复、喜欢、转发、提及（作者 h-card），以及「我写了回应」表单
 *  - 订阅源与自动发现：主页 / 话题 / 项目的 RSS / Atom / JSON Feed 链接，<link rel="alternate"> 写进 <head>
 *  - 邮件摘要订阅（默认关闭，主动开启）、GitHub 仓库卡片、作品分享卡片（复用 l14 引用卡片 PNG）
 *  - 「我的」设置：MCP 分层令牌（创建只显示一次 / 撤销 / 审计 / 连接测试）、邮件订阅管理
 *  - 发布器里的 AI 辅助建议（站长开启才出现；标注为 AI 建议，点「采用」才填入，发布前还要再确认）
 */
import './open.css';
import { ApiError, API_BASE, DEMO, request } from './api';
import { currentMember } from './community';
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { url } from './render';
import { AI_KIND_LABEL, AI_NOTE, FEED_LABEL, FREQ_LABEL, MCP_SCOPES, SCOPE_LABEL, SCOPE_NOTE, ROLE_LABEL, TOKEN_TTLS, feedPath, type AiKind, type FeedFormat, type FeedScope, type McpScope, type MemberRole } from './open-core';

type Notify = (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
export interface OpenCtx { notify: Notify }
const auth = (): Record<string, string> => {
  const m = currentMember();
  return m ? { authorization: `Bearer ${m.token}` } : {};
};
const send = <T>(path: string, method: string, body?: unknown, headers: Record<string, string> = {}) => request<T>(path, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...auth(), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const errMsg = (x: unknown) => {
  if (x instanceof ApiError) {
    const d = Array.isArray(x.details) ? (x.details as { message: string }[]).map((y) => y.message).join('；') : '';
    return d ? `${x.message}：${d}` : x.message;
  }
  return (x as Error)?.message || '出错了，请稍后再试';
};
const DAY = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' });
const fmt = (iso: string | null) => (iso ? DAY.format(new Date(iso)) : '—');
const BASE = import.meta.env.BASE_URL ?? '/';
const pageUrl = () => `${location.origin}${location.pathname}`;
const endpoint = () => (DEMO ? `${location.origin}${BASE}api/webmention` : `${API_BASE || location.origin}/api/webmention`);
const letter = (name: string, href: string, cls = 'open-face') => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const inner = `<span class="open-face__l" style="--h:${h}" aria-hidden="true">${e(name.slice(0, 1) || '?')}</span>`;
  return href ? `<a class="${cls}" href="${e(href)}" rel="noopener nofollow ugc" target="_blank" title="${e(name)}">${inner}<span class="visually-hidden">${e(name)}</span></a>` : `<span class="${cls}" title="${e(name)}">${inner}<span class="visually-hidden">${e(name)}</span></span>`;
};
const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

// ---------------------------------------------------------------- 订阅源 + 自动发现
const FMTS: FeedFormat[] = ['rss', 'atom', 'json'];
const FEED_MIME: Record<FeedFormat, string> = { rss: 'application/rss+xml', atom: 'application/atom+xml', json: 'application/feed+json' };
export const feedHref = (scope: FeedScope, fmt: FeedFormat) => feedPath(scope, fmt, { apiBase: DEMO ? null : API_BASE, base: BASE });
export function setAutodiscovery(scope: FeedScope | null, title: string): void {
  document.head.querySelectorAll('link[data-open-feed]').forEach((l) => l.remove());
  if (!scope) return;
  for (const f of FMTS) {
    const l = document.createElement('link');
    l.rel = 'alternate';
    l.type = FEED_MIME[f];
    l.title = `${title}（${FEED_LABEL[f]}）`;
    l.href = feedHref(scope, f);
    l.dataset.openFeed = '';
    document.head.append(l);
  }
}
function feedBar(scope: FeedScope, label: string, extra = ''): string {
  return `<div class="open-bar" role="group" aria-label="${e(label)}的订阅方式"><span class="open-bar__label">${icon('rss')}订阅源</span>${FMTS.map((f) => `<a class="open-chip" href="${e(feedHref(scope, f))}" type="${FEED_MIME[f]}">${FEED_LABEL[f]}</a>`).join('')}${extra}</div>`;
}

// ---------------------------------------------------------------- 邮件订阅
interface Sub { id: number; kind: 'user' | 'topic'; ref: string; label: string; url: string; frequency: 'daily' | 'weekly'; lastSentAt: string | null; createdAt: string }
function subWidget(kind: 'user' | 'topic', ref: string, self: boolean): string {
  if (self) return '';
  if (!currentMember()) return `<a class="open-chip open-chip--ghost" href="${url('/join/')}">${icon('mail')}登录后邮件订阅</a>`;
  return `<span class="open-sub js-open-sub" data-kind="${kind}" data-ref="${e(ref)}"><button type="button" class="open-chip open-chip--btn js-sub-toggle" aria-expanded="false" aria-pressed="false">${icon('mail')}<span>邮件订阅</span></button></span>`;
}
async function bindSub(root: HTMLElement, ctx: OpenCtx): Promise<void> {
  const w = root.querySelector<HTMLElement>('.js-open-sub');
  if (!w) return;
  const kind = w.dataset.kind as 'user' | 'topic';
  const ref = w.dataset.ref!;
  const btn = w.querySelector<HTMLButtonElement>('.js-sub-toggle')!;
  let cur: Sub | null = null;
  let email = '';
  const paint = () => {
    btn.setAttribute('aria-pressed', String(!!cur));
    btn.querySelector('span')!.textContent = cur ? `已订阅（${FREQ_LABEL[cur.frequency]}）` : '邮件订阅';
  };
  try {
    const r = await send<{ subscriptions: Sub[]; email: string }>(`/api/social/subscriptions?kind=${kind}&ref=${encodeURIComponent(ref)}`, 'GET');
    cur = r.subscriptions[0] ?? null;
    email = r.email;
  } catch {
    /* 未登录 / 接口不可用：保持默认 */
  }
  paint();
  const panelId = `open-sub-${kind}-${ref}`;
  btn.setAttribute('aria-controls', panelId);
  btn.addEventListener('click', () => {
    let p = w.querySelector<HTMLElement>('.js-sub-panel');
    if (p) {
      p.remove();
      btn.setAttribute('aria-expanded', 'false');
      return;
    }
    p = document.createElement('div');
    p.className = 'open-sub__panel js-sub-panel';
    p.id = panelId;
    p.innerHTML = cur
      ? `<p class="small">正在用邮件订阅（${FREQ_LABEL[cur.frequency]}汇总）。</p><button type="button" class="btn btn--soft btn--sm js-sub-off">${icon('close')}取消邮件订阅</button>`
      : `<form class="js-sub-form"><fieldset><legend class="small">把新的公开作品汇总成一封邮件，发到你的注册邮箱${email ? `（${e(email)}）` : ''}。默认不开启，可以随时退订。</legend><label class="soc-check"><input type="radio" name="frequency" value="weekly" checked><span>每周一封</span></label><label class="soc-check"><input type="radio" name="frequency" value="daily"><span>每天一封</span></label></fieldset><button type="submit" class="btn btn--primary btn--sm">${icon('mail')}确认订阅</button></form>`;
    w.append(p);
    btn.setAttribute('aria-expanded', 'true');
    p.querySelector<HTMLElement>('input, button')?.focus();
    p.querySelector('.js-sub-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.currentTarget as HTMLFormElement;
      const frequency = (f.querySelector<HTMLInputElement>('input[name=frequency]:checked')?.value ?? 'weekly') as 'weekly' | 'daily';
      try {
        cur = (await send<{ subscription: Sub }>('/api/social/subscriptions', 'POST', { kind, ref, frequency })).subscription;
        ctx.notify(`已订阅：${FREQ_LABEL[frequency]}一封摘要邮件`, 'success');
        p!.remove();
        btn.setAttribute('aria-expanded', 'false');
        paint();
        btn.focus();
      } catch (x) {
        ctx.notify(errMsg(x), 'error');
      }
    });
    p.querySelector('.js-sub-off')?.addEventListener('click', async () => {
      try {
        await send(`/api/social/subscriptions/${cur!.id}`, 'DELETE');
        cur = null;
        ctx.notify('已取消邮件订阅', 'success');
        p!.remove();
        btn.setAttribute('aria-expanded', 'false');
        paint();
        btn.focus();
      } catch (x) {
        ctx.notify(errMsg(x), 'error');
      }
    });
  });
}

// ---------------------------------------------------------------- 站外回应（Webmention）
interface Mention { id: number; type: string; source: string; url: string; author: { name: string; url: string; photo: string }; content: string; published: string }
interface MentionList { total: number; replies: Mention[]; likes: Mention[]; reposts: Mention[]; bookmarks: Mention[]; mentions: Mention[] }
const WM_LABEL: Record<string, string> = { reply: '回复', like: '喜欢', repost: '转发', bookmark: '收藏', mention: '提及' };
function mentionItem(m: Mention): string {
  const when = m.published && !Number.isNaN(Date.parse(m.published)) ? `<time class="dt-published muted small" datetime="${e(m.published)}">${fmt(m.published)}</time>` : '';
  return `<li class="open-wm__item h-entry"><div class="open-wm__who"><span class="p-author h-card">${m.author.photo ? `<img class="u-photo open-face__img" src="${e(m.author.photo)}" alt="" width="28" height="28" loading="lazy">` : letter(m.author.name, '', 'open-face open-face--sm')}${m.author.url ? `<a class="p-name u-url" href="${e(m.author.url)}" rel="noopener nofollow ugc" target="_blank">${e(m.author.name)}</a>` : `<span class="p-name">${e(m.author.name)}</span>`}</span><span class="soc-chip">${WM_LABEL[m.type] ?? '提及'}</span>${when}</div>${m.content ? `<p class="p-content">${e(m.content)}</p>` : ''}<a class="u-url small" href="${e(m.url)}" rel="noopener nofollow ugc" target="_blank">来自 ${e(hostOf(m.url))}${icon('external')}</a></li>`;
}
export async function mountMentions(sec: HTMLElement, ctx: OpenCtx): Promise<void> {
  if (sec.dataset.mounted) return;
  sec.dataset.mounted = '1';
  const kind = sec.dataset.kind!;
  const ref = sec.dataset.ref!;
  let data: MentionList = { total: 0, replies: [], likes: [], reposts: [], bookmarks: [], mentions: [] };
  try {
    data = await request<MentionList>(`/api/webmentions?kind=${kind}&ref=${encodeURIComponent(ref)}`);
  } catch {
    /* 旧 Worker 没有这个接口：显示空状态 */
  }
  const faces = (list: Mention[], label: string) => (list.length ? `<div class="open-wm__faces"><span class="open-wm__count">${label} ${list.length}</span><span class="open-wm__stack">${list.map((m) => letter(m.author.name, m.author.url)).join('')}</span></div>` : '');
  const talk = [...data.replies, ...data.mentions].sort((a, b) => (a.published < b.published ? -1 : 1));
  const id = `wm-h-${kind}`;
  if (!document.head.querySelector('link[rel="webmention"]')) {
    const l = document.createElement('link');
    l.rel = 'webmention';
    l.href = endpoint();
    document.head.append(l);
  }
  sec.hidden = false;
  sec.setAttribute('aria-labelledby', id);
  sec.innerHTML = `<h2 class="soc-h" id="${id}">${icon('link')}站外回应 <span class="muted small">Webmention · <span class="js-wm-total">${data.total}</span></span></h2>
<p class="muted small">别的网站引用、回复或喜欢这里时，会通过 Webmention 通知本站；验证对方确实链接到这里、并经站长审核后显示在这里。</p>
${faces(data.likes, '喜欢')}${faces(data.reposts, '转发')}${faces(data.bookmarks, '收藏')}
${talk.length ? `<ol class="open-wm__list">${talk.map(mentionItem).join('')}</ol>` : data.total ? '' : '<p class="soc-empty muted">还没有站外回应。</p>'}
<form class="open-wm__form js-wm-form" novalidate><label class="field__label" for="wm-src-${kind}">在自己的网站写了回应？贴上那篇文章的地址</label><div class="open-wm__row"><input id="wm-src-${kind}" name="source" type="url" inputmode="url" maxlength="2000" placeholder="https://你的网站/文章" required aria-describedby="wm-hint-${kind}"><button class="btn btn--soft btn--sm" type="submit">${icon('send')}发送 Webmention</button></div><p class="muted small" id="wm-hint-${kind}">对方页面里需要有指向本页的链接。端点：<code>${e(endpoint())}</code>${DEMO ? '。演示站只能验证本站自己的页面。' : ''}</p><p class="open-wm__status js-wm-status" role="status" aria-live="polite"></p></form>`;
  sec.querySelector<HTMLFormElement>('.js-wm-form')!.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget as HTMLFormElement;
    const inp = f.elements.namedItem('source') as HTMLInputElement;
    const st = f.querySelector<HTMLElement>('.js-wm-status')!;
    const v = inp.value.trim();
    if (!/^https?:\/\/\S+$/i.test(v)) {
      inp.setAttribute('aria-invalid', 'true');
      st.textContent = '请输入以 http:// 或 https:// 开头的地址';
      inp.focus();
      return;
    }
    inp.removeAttribute('aria-invalid');
    st.textContent = '正在发送…';
    try {
      const r = await request<{ id: number; status: string }>('/api/webmention', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: v, target: pageUrl() }) });
      const msg: Record<string, string> = {
        queued: DEMO ? '已收到。演示站不能抓取站外页面，这条会一直停在「排队验证」。' : '已收到，正在异步验证对方页面是否链接到这里，通过后由站长审核显示。',
        pending: '验证通过：对方页面确实链接到这里。等站长审核后就会显示。',
        approved: '验证通过，已显示。',
        invalid: '验证失败：对方页面里没有指向本页的链接。',
        rejected: '这个来源之前被站长拒绝过。',
        spam: '这个来源被标记为垃圾。',
      };
      st.textContent = msg[r.status] ?? `状态：${r.status}`;
      st.dataset.status = r.status;
      if (r.status === 'approved') void mountMentionsAgain(sec, ctx);
    } catch (x) {
      st.textContent = errMsg(x);
      st.dataset.status = 'error';
    }
  });
}
async function mountMentionsAgain(sec: HTMLElement, ctx: OpenCtx): Promise<void> {
  delete sec.dataset.mounted;
  await mountMentions(sec, ctx);
}

// ---------------------------------------------------------------- GitHub 仓库卡片
interface GhRepo { fullName: string; description: string; htmlUrl: string; stars: number; forks: number; openIssues: number; language: string; license: string; topics: string[]; archived: boolean; pushedAt: string; latestRelease: { tag: string; name: string; publishedAt: string; url: string } | null }
async function githubCard(slug: string): Promise<string> {
  let r: { repo: GhRepo; fetchedAt: string; stale: boolean; source: string };
  try {
    r = await request(`/api/social/projects/${slug}/github`);
  } catch (x) {
    if (x instanceof ApiError && x.status === 404) return '';
    return `<section class="tile tile--full open-gh" aria-labelledby="gh-h"><h2 class="soc-h" id="gh-h">${icon('github')}GitHub 仓库</h2><p class="muted small">${e(errMsg(x))}</p></section>`;
  }
  const g = r.repo;
  const n = (v: number) => new Intl.NumberFormat('zh-CN').format(v);
  const stat = (label: string, v: string) => `<div><dt>${label}</dt><dd>${e(v)}</dd></div>`;
  return `<section class="tile tile--full open-gh" aria-labelledby="gh-h"><h2 class="soc-h" id="gh-h">${icon('github')}GitHub 仓库</h2>
<p class="open-gh__name"><a href="${e(g.htmlUrl)}" rel="noopener nofollow ugc" target="_blank">${e(g.fullName)}${icon('external')}</a>${g.archived ? '<span class="soc-chip soc-chip--soft">已归档</span>' : ''}</p>
${g.description ? `<p class="muted">${e(g.description)}</p>` : ''}
<dl class="open-gh__stats">${stat('Star', n(g.stars))}${stat('Fork', n(g.forks))}${stat('未关闭 Issue', n(g.openIssues))}${g.language ? stat('语言', g.language) : ''}${g.license ? stat('许可证', g.license) : ''}${g.pushedAt ? stat('最近推送', fmt(g.pushedAt).slice(0, 10)) : ''}</dl>
${g.latestRelease ? `<p class="small">${icon('flag')}最新发布：${g.latestRelease.url ? `<a href="${e(g.latestRelease.url)}" rel="noopener nofollow ugc" target="_blank">${e(g.latestRelease.tag)}</a>` : e(g.latestRelease.tag)}${g.latestRelease.name ? ` · ${e(g.latestRelease.name)}` : ''} <span class="muted">${fmt(g.latestRelease.publishedAt).slice(0, 10)}</span></p>` : ''}
${g.topics.length ? `<p class="open-gh__topics">${g.topics.map((t) => `<span class="soc-chip soc-chip--soft">${e(t)}</span>`).join('')}</p>` : ''}
<p class="muted small">${r.source === 'demo-snapshot' ? '演示数据：虚构仓库的快照（演示站不访问 GitHub）。' : `数据来自 GitHub 公开 API（服务端抓取，缓存一小时，不需要令牌）· 更新于 ${fmt(r.fetchedAt)}${r.stale ? ' · GitHub 暂时不可用，显示的是旧数据' : ''}`}</p></section>`;
}

// ---------------------------------------------------------------- 「我的」：MCP 令牌 + 邮件订阅
interface Token { id: number; name: string; scope: McpScope; prefix: string; createdAt: string; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null; active: boolean }
interface Audit { id: number; tokenName: string | null; method: string; tool: string; ok: boolean; code: string; createdAt: string }
let lastToken = '';
async function settingsHtml(): Promise<string> {
  const [t, a, s] = await Promise.all([
    send<{ tokens: Token[]; role: MemberRole; scopes: McpScope[]; endpoint: string; limits: { active: number; callsPerMinute: number } }>('/api/social/mcp/tokens', 'GET'),
    send<{ audit: Audit[] }>('/api/social/mcp/audit', 'GET'),
    send<{ subscriptions: Sub[]; email: string }>('/api/social/subscriptions', 'GET'),
  ]);
  const subs = s.subscriptions.length
    ? `<ul class="open-subs js-subs">${s.subscriptions.map((x) => `<li data-id="${x.id}"><a href="${e(x.url)}">${e(x.label)}</a><label class="open-subs__f"><span class="visually-hidden">${e(x.label)} 的频率</span><select class="js-sub-freq" data-kind="${x.kind}" data-ref="${e(x.ref)}">${(['weekly', 'daily'] as const).map((f) => `<option value="${f}"${x.frequency === f ? ' selected' : ''}>${FREQ_LABEL[f]}</option>`).join('')}</select></label><button type="button" class="btn btn--ghost btn--sm js-sub-del" data-id="${x.id}" aria-label="取消订阅 ${e(x.label)}">${icon('close')}</button></li>`).join('')}</ul>`
    : '<p class="soc-empty muted js-subs">还没有邮件订阅。在创作者主页或话题页点「邮件订阅」开启。</p>';
  const scopeRow = (sc: McpScope) => {
    const ok = t.scopes.includes(sc);
    return `<label class="open-scope${ok ? '' : ' is-off'}"><input type="radio" name="scope" value="${sc}"${sc === 'read-public' ? ' checked' : ''}${ok ? '' : ' disabled'}><span><b>${SCOPE_LABEL[sc]}</b> <code>${sc}</code><small class="muted">${SCOPE_NOTE[sc]}${ok ? '' : `（你的身份是${ROLE_LABEL[t.role]}，不能创建）`}</small></span></label>`;
  };
  const tokens = t.tokens.length
    ? `<div class="adm-table-wrap open-tablewrap"><table class="open-table"><caption class="visually-hidden">我的 MCP 令牌</caption><thead><tr><th scope="col">名称</th><th scope="col">权限</th><th scope="col">前缀</th><th scope="col">最近使用</th><th scope="col">有效期</th><th scope="col">操作</th></tr></thead><tbody>${t.tokens.map((x) => `<tr class="${x.active ? '' : 'is-dead'}"><td>${e(x.name)}</td><td><span class="soc-chip">${SCOPE_LABEL[x.scope]}</span></td><td><code>${e(x.prefix)}…</code></td><td>${fmt(x.lastUsedAt)}</td><td>${x.revokedAt ? '已撤销' : x.expiresAt ? fmt(x.expiresAt).slice(0, 10) : '不过期'}</td><td>${x.active ? `<button type="button" class="btn btn--ghost btn--sm js-revoke" data-id="${x.id}" aria-label="撤销令牌 ${e(x.name)}">撤销</button>` : '—'}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="soc-empty muted">还没有令牌。</p>';
  const audit = a.audit.length
    ? `<details class="open-audit"><summary>最近的调用记录（${a.audit.length}）</summary><div class="adm-table-wrap open-tablewrap"><table class="open-table"><caption class="visually-hidden">MCP 调用审计</caption><thead><tr><th scope="col">时间</th><th scope="col">令牌</th><th scope="col">操作</th><th scope="col">结果</th></tr></thead><tbody>${a.audit.map((x) => `<tr><td>${fmt(x.createdAt)}</td><td>${e(x.tokenName ?? '—')}</td><td><code>${e(x.method === 'tools/call' ? x.tool : x.method)}</code></td><td>${x.ok ? '成功' : `<span class="open-bad">${e(x.code)}</span>`}</td></tr>`).join('')}</tbody></table></div></details>`
    : '';
  return `<section class="tile tile--half open-me" id="subscriptions" aria-labelledby="open-subs-h"><h2 class="soc-h" id="open-subs-h">${icon('mail')}邮件订阅</h2><p class="muted small">关注的创作者 / 话题有新的公开作品时，按你选的频率汇总成一封邮件${s.email ? `发到 ${e(s.email)}` : ''}。默认没有任何订阅；每封邮件都有一键退订链接。</p>${subs}</section>
<section class="tile tile--full open-me open-mcp" id="mcp-tokens" aria-labelledby="open-mcp-h"><h2 class="soc-h" id="open-mcp-h">${icon('code')}MCP 令牌</h2>
<p class="muted small">让 Claude、Cursor 等 MCP 客户端以你的身份使用本站：端点 <code>${e(t.endpoint)}</code>。令牌分层授权，只显示一次，本站只保存它的哈希；每次调用都会记录，并按令牌限流（每分钟 ${t.limits.callsPerMinute} 次）。作者令牌只能操作你自己的作品。你的身份：<b>${ROLE_LABEL[t.role]}</b>。</p>
<form class="soc-form open-mcp__form js-mcp-create" novalidate><div class="field"><label class="field__label" for="mcp-name">令牌名称</label><input id="mcp-name" name="name" maxlength="40" required placeholder="例如：我的 Claude"><p class="field__err js-mcp-err" hidden></p></div>
<fieldset class="open-scopes"><legend>权限</legend>${MCP_SCOPES.map(scopeRow).join('')}</fieldset>
<div class="field"><label class="field__label" for="mcp-ttl">有效期</label><select id="mcp-ttl" name="ttlDays">${TOKEN_TTLS.map((d) => `<option value="${d}"${d === 90 ? ' selected' : ''}>${d ? `${d} 天` : '不过期'}</option>`).join('')}</select></div>
<button class="btn btn--primary btn--sm" type="submit">${icon('plus')}创建令牌</button></form>
<div class="open-newtoken js-newtoken" hidden role="region" aria-label="新令牌"></div>
${tokens}${audit}
<details class="open-console"><summary>连接测试（直接调用 MCP）</summary><form class="soc-form js-mcp-test" novalidate><div class="field"><label class="field__label" for="mcp-tok">令牌</label><input id="mcp-tok" name="token" type="password" autocomplete="off" spellcheck="false" placeholder="mcp_…" value="${e(lastToken)}"></div><div class="field"><label class="field__label" for="mcp-method">请求</label><select id="mcp-method" name="method"><option value="tools/list">tools/list（这个令牌能用哪些工具）</option><option value="tools/call">tools/call（调用一个工具）</option></select></div><div class="field"><label class="field__label" for="mcp-tool">工具名</label><input id="mcp-tool" name="tool" placeholder="例如 search_public_works" spellcheck="false"></div><div class="field"><label class="field__label" for="mcp-args">参数（JSON）</label><textarea id="mcp-args" name="args" rows="2" spellcheck="false">{}</textarea></div><button class="btn btn--soft btn--sm" type="submit">${icon('send')}发送</button><pre class="open-console__out js-mcp-out" role="status" aria-live="polite" tabindex="0" aria-label="MCP 响应"></pre></form></details>
</section>`;
}
async function bindSettings(box: HTMLElement, ctx: OpenCtx, rerender: () => Promise<void>): Promise<void> {
  box.querySelector('.js-mcp-create')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget as HTMLFormElement;
    const err = f.querySelector<HTMLElement>('.js-mcp-err')!;
    const name = (f.elements.namedItem('name') as HTMLInputElement).value.trim();
    if (!name) {
      err.hidden = false;
      err.textContent = '请给令牌起个名字';
      (f.elements.namedItem('name') as HTMLInputElement).setAttribute('aria-invalid', 'true');
      return void (f.elements.namedItem('name') as HTMLInputElement).focus();
    }
    const scope = f.querySelector<HTMLInputElement>('input[name=scope]:checked')?.value;
    try {
      const r = await send<{ token: string; item: Token }>('/api/social/mcp/tokens', 'POST', { name, scope, ttlDays: Number((f.elements.namedItem('ttlDays') as HTMLSelectElement).value) });
      lastToken = r.token;
      await rerender();
      const box2 = document.querySelector<HTMLElement>('.js-newtoken');
      if (box2) {
        box2.hidden = false;
        box2.innerHTML = `<p><b>新令牌「${e(r.item.name)}」（${SCOPE_LABEL[r.item.scope]}）</b>：只显示这一次，请立即复制保存。</p><div class="open-newtoken__row"><code class="js-token-val">${e(r.token)}</code><button type="button" class="btn btn--soft btn--sm js-copy-token">${icon('copy')}复制</button></div>`;
        box2.querySelector('.js-copy-token')?.addEventListener('click', () => void navigator.clipboard?.writeText(r.token).then(() => ctx.notify('已复制', 'success')).catch(() => ctx.notify('复制失败，请手动选择', 'warning')));
        box2.setAttribute('tabindex', '-1');
        box2.focus();
      }
      ctx.notify('令牌已创建', 'success');
    } catch (x) {
      err.hidden = false;
      err.textContent = errMsg(x);
    }
  });
  box.querySelectorAll<HTMLButtonElement>('.js-revoke').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('撤销后，使用这个令牌的客户端会立刻失去访问权限。确定吗？')) return;
      try {
        await send(`/api/social/mcp/tokens/${b.dataset.id}`, 'DELETE');
        ctx.notify('令牌已撤销', 'success');
        await rerender();
        document.querySelector<HTMLElement>('#open-mcp-h')?.focus();
      } catch (x) {
        ctx.notify(errMsg(x), 'error');
      }
    }),
  );
  box.querySelector('.js-mcp-test')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget as HTMLFormElement;
    const out = f.querySelector<HTMLElement>('.js-mcp-out')!;
    const val = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value.trim();
    let args: unknown = {};
    try {
      args = JSON.parse(val('args') || '{}');
    } catch {
      out.textContent = '参数不是合法的 JSON';
      return;
    }
    const method = val('method');
    const body = { jsonrpc: '2.0', id: Date.now(), method, ...(method === 'tools/call' ? { params: { name: val('tool'), arguments: args } } : {}) };
    try {
      const r = await request<{ result?: { tools?: { name: string }[]; isError?: boolean; content?: { text: string }[] }; error?: { message: string } }>('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${val('token')}` }, body: JSON.stringify(body) });
      out.dataset.ok = String(!r.error && !r.result?.isError);
      out.textContent = r.error ? `错误：${r.error.message}` : r.result?.tools ? `可用工具（${r.result.tools.length}）：\n${r.result.tools.map((t) => t.name).join('\n')}` : r.result?.isError ? `被拒绝：${r.result.content?.[0]?.text ?? ''}` : `成功：\n${(r.result?.content?.[0]?.text ?? '').slice(0, 1500)}`;
    } catch (x) {
      out.dataset.ok = 'false';
      out.textContent = errMsg(x);
    }
  });
  box.querySelectorAll<HTMLButtonElement>('.js-sub-del').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await send(`/api/social/subscriptions/${b.dataset.id}`, 'DELETE');
        ctx.notify('已取消订阅', 'success');
        await rerender();
        document.querySelector<HTMLElement>('#open-subs-h')?.focus();
      } catch (x) {
        ctx.notify(errMsg(x), 'error');
      }
    }),
  );
  box.querySelectorAll<HTMLSelectElement>('.js-sub-freq').forEach((s) =>
    s.addEventListener('change', async () => {
      try {
        await send('/api/social/subscriptions', 'POST', { kind: s.dataset.kind, ref: s.dataset.ref, frequency: s.value });
        ctx.notify(`已改为${FREQ_LABEL[s.value as 'daily' | 'weekly']}`, 'success');
      } catch (x) {
        ctx.notify(errMsg(x), 'error');
      }
    }),
  );
}

// ---------------------------------------------------------------- 把开放功能挂到各个社交页面上（页面重绘后自动补回）
/** 页面的内容区会整体重绘（innerHTML）：用 MutationObserver 把我们插入的块补回去。 */
function keep(box: HTMLElement, cls: string, html: string, place: (frag: HTMLElement) => boolean, after?: (el: HTMLElement) => void): void {
  const ensure = () => {
    if (box.querySelector(`.${cls}`)) return;
    const wrap = document.createElement('div');
    wrap.className = `open-slot ${cls}`;
    wrap.innerHTML = html;
    if (place(wrap)) after?.(wrap);
  };
  ensure();
  new MutationObserver(() => ensure()).observe(box, { childList: true });
}
export async function enhance(box: HTMLElement, view: string, ctx: OpenCtx): Promise<void> {
  if (view === 'user') {
    const username = box.dataset.username ?? '';
    const prof = box.querySelector<HTMLElement>('.soc-profile');
    if (!prof || prof.classList.contains('soc-profile--restricted') || !username) return setAutodiscovery(null, '');
    const self = currentMember()?.member && prof.querySelector('a[href$="/me/"]') !== null;
    const scope: FeedScope = { kind: 'user', ref: username };
    setAutodiscovery(scope, `${prof.querySelector('.soc-name')?.textContent ?? username} 的作品`);
    keep(box, 'js-open-user', feedBar(scope, '这位创作者', subWidget('user', username, !!self)), (w) => {
      const stats = box.querySelector('.soc-profile .soc-stats');
      if (!stats) return false;
      stats.after(w);
      return true;
    }, (w) => void bindSub(w, ctx));
    return;
  }
  if (view === 'topic') {
    const slug = box.dataset.slug ?? '';
    if (!slug) return;
    const scope: FeedScope = { kind: 'topic', ref: slug };
    setAutodiscovery(scope, `话题 ${slug}`);
    keep(box, 'js-open-topic', `<div class="tile tile--full open-tile">${feedBar(scope, '这个话题', subWidget('topic', slug, false))}</div>`, (w) => {
      const first = box.querySelector('.disc > .tile, .disc > *');
      if (!first) return false;
      first.after(w);
      return true;
    }, (w) => void bindSub(w, ctx));
    return;
  }
  if (view === 'project') {
    const slug = box.dataset.slug ?? '';
    if (!slug) return;
    const scope: FeedScope = { kind: 'project', ref: slug };
    setAutodiscovery(scope, `项目 ${slug} 的动态`);
    const gh = await githubCard(slug);
    keep(box, 'js-open-project', `${gh}<div class="tile tile--full open-tile">${feedBar(scope, '这个项目的开发日志')}</div>`, (w) => {
      const head = box.querySelector('.st-head');
      if (!head) return false;
      head.after(w);
      return true;
    });
    return;
  }
  if (view === 'work') {
    const id = Number(box.dataset.id ?? /\/w\/(\d+)/.exec(location.pathname)?.[1] ?? 0);
    const art = box.querySelector<HTMLElement>('.ugc-work');
    if (!id || !art) return;
    setAutodiscovery(null, '');
    keep(box, 'js-open-work', `<section class="tile tile--full open-wm js-open-wm" data-kind="work" data-ref="${id}" hidden></section>`, (w) => {
      const anchor = box.querySelector('.ugc-comments') ?? art;
      anchor.after(w);
      return true;
    }, (w) => void mountMentions(w.querySelector<HTMLElement>('.js-open-wm')!, ctx));
    // 分享卡片：复用 l14 的引用卡片（1080×1350 PNG）
    const addShare = () => {
      const acts = box.querySelector('.ugc-work .ugc-actions');
      if (!acts || acts.querySelector('.js-open-share')) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn--ghost btn--sm js-open-share';
      b.innerHTML = `${icon('image')}分享卡片`;
      b.addEventListener('click', async () => {
        const title = box.querySelector('#ugc-title')?.textContent?.trim() ?? '';
        const text = (box.querySelector('.ugc-caption')?.textContent || box.querySelector('.ugc-body')?.textContent || title).trim().slice(0, 140);
        const author = box.querySelector('.ugc-by b')?.textContent ?? '';
        const { openQuoteCard } = await import('./quote-card');
        openQuoteCard({ text: text || title, source: `${author} · ${title}`.slice(0, 60), site: document.title.split('|').pop()?.trim() ?? '', url: pageUrl(), opener: b, notify: ctx.notify });
      });
      acts.append(b);
    };
    addShare();
    new MutationObserver(addShare).observe(box, { childList: true });
    return;
  }
  if (view === 'me') {
    if (!currentMember()) return;
    let busy = false;
    const render = async () => {
      if (busy) return;
      busy = true;
      try {
        box.querySelectorAll('.js-open-me').forEach((x) => x.remove());
        const wrap = document.createElement('div');
        wrap.className = 'open-slot js-open-me';
        wrap.innerHTML = await settingsHtml();
        const danger = box.querySelector('.soc-danger');
        if (danger) danger.before(wrap);
        else box.append(wrap);
        await bindSettings(wrap, ctx, async () => {
          busy = false;
          await render();
        });
      } catch (x) {
        ctx.notify(errMsg(x), 'error');
      } finally {
        busy = false;
      }
    };
    await render();
  }
}

// ---------------------------------------------------------------- 发布器：AI 辅助建议
let aiStatus: Promise<{ enabled: boolean; provider: string }> | null = null;
export interface AiHost { form: HTMLFormElement; onAccept: (kind: AiKind) => void; notify: Notify }
export async function mountAiPanel(slot: HTMLElement, h: AiHost): Promise<void> {
  aiStatus ??= send<{ enabled: boolean; provider: string }>('/api/social/ai/status', 'GET').catch(() => ({ enabled: false, provider: 'local' }));
  const st = await aiStatus;
  if (!st.enabled || !slot.isConnected) {
    slot.hidden = true;
    return;
  }
  slot.hidden = false;
  slot.innerHTML = `<section class="open-ai" aria-labelledby="open-ai-h"><h3 class="open-ai__h" id="open-ai-h">${icon('sparkles')}AI 辅助 <span class="open-ai__badge">实验</span></h3><p class="muted small">${AI_NOTE}</p>
<div class="ugc-row" role="group" aria-label="请求 AI 建议">${(['summary', 'tags', 'draft'] as AiKind[]).map((k) => `<button type="button" class="btn btn--soft btn--sm js-ai" data-kind="${k}">生成${AI_KIND_LABEL[k]}建议</button>`).join('')}</div>
<div class="open-ai__out js-ai-out" hidden><p class="open-ai__label"><span class="open-ai__chip">AI 建议</span><span class="muted small js-ai-meta"></span></p><pre class="open-ai__text js-ai-text" tabindex="0" aria-label="AI 建议内容"></pre><div class="ugc-row"><button type="button" class="btn btn--primary btn--sm js-ai-accept">${icon('check')}采用</button><button type="button" class="btn btn--ghost btn--sm js-ai-dismiss">忽略</button></div></div>
<p class="visually-hidden js-ai-live" role="status" aria-live="polite"></p></section>`;
  let last: { kind: AiKind; text: string; tags: { slug: string; name: string }[] } | null = null;
  const out = slot.querySelector<HTMLElement>('.js-ai-out')!;
  const live = slot.querySelector<HTMLElement>('.js-ai-live')!;
  const val = (n: string) => (h.form.elements.namedItem(n) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? '';
  slot.addEventListener('click', async (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    if (b.classList.contains('js-ai')) {
      const kind = b.dataset.kind as AiKind;
      b.disabled = true;
      live.textContent = `正在生成${AI_KIND_LABEL[kind]}建议…`;
      try {
        const r = await send<{ suggestion: { kind: AiKind; text: string; tags: { slug: string; name: string }[]; provider: string } }>('/api/social/ai/suggest', 'POST', { kind, title: val('title'), body: [val('caption'), val('body'), val('notes')].filter(Boolean).join('\n\n') });
        last = r.suggestion;
        out.hidden = false;
        slot.querySelector('.js-ai-meta')!.textContent = `${AI_KIND_LABEL[kind]} · ${r.suggestion.provider === 'local' ? '本地规则生成' : r.suggestion.provider}`;
        slot.querySelector('.js-ai-text')!.textContent = r.suggestion.text || (kind === 'tags' ? '没有匹配的站内话题' : '（空）');
        live.textContent = `AI ${AI_KIND_LABEL[kind]}建议已生成。还没有填进表单：确认后点「采用」。`;
      } catch (x) {
        h.notify(errMsg(x), 'error');
        live.textContent = errMsg(x);
      } finally {
        b.disabled = false;
      }
    } else if (b.classList.contains('js-ai-dismiss')) {
      last = null;
      out.hidden = true;
      live.textContent = '已忽略 AI 建议';
    } else if (b.classList.contains('js-ai-accept') && last) {
      const set = (n: string, v: string) => {
        const el = h.form.elements.namedItem(n) as HTMLInputElement | HTMLTextAreaElement | null;
        if (!el) return false;
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      };
      if (last.kind === 'summary') {
        if (!set('caption', last.text)) set('body', val('body') ? `${last.text}\n\n${val('body')}` : last.text);
      } else if (last.kind === 'tags') {
        let n = h.form.querySelectorAll('.js-topic:checked').length;
        for (const t of last.tags) {
          const c = h.form.querySelector<HTMLInputElement>(`.js-topic[value="${CSS.escape(t.slug)}"]`);
          if (c && !c.checked && n < 3) {
            c.checked = true;
            c.closest('label')?.classList.add('is-on');
            n++;
          }
        }
      } else set('body', val('body') ? `${val('body')}\n\n${last.text}` : last.text);
      const kind = last.kind;
      last = null;
      out.hidden = true;
      h.onAccept(kind);
      live.textContent = `已采用 AI ${AI_KIND_LABEL[kind]}建议。发布前请检查，并勾选确认。`;
    }
  });
}
