import './styles/tokens.css';
/**
 * 后台管理（/admin）—— 与前台同一套便当网格 / 玻璃瓷砖风格。
 * 密码登录 → 短期 httpOnly 会话 Cookie；写操作带 X-CSRF-Token（只在内存里，刷新后从 /api/auth/session 重新获取）。
 */
import { PAGE_LIMIT_MAX, walkPages } from './post-page-core';
import './styles.css';
import './admin.css';
import './motion-ui.css';
import './l12.css';
import './l14.css';
import { request, ApiError, API_BASE, DEMO } from './api';
import { escapeHtml as e } from './markdown';
import { renderSafe } from './sanitize';
import { icon } from './icons';
import { defineUsed } from './usa';
import { resultIconHtml } from './result-icon';
import { installIconMotion } from './icon-motion';
import { backdrop, essaySection, festivalText, memberBadge, url } from './render';
import { bindEssayEditor, essayEditorHtml, readPostMediaRaw } from './admin-essay';
import { bindEditor2, editor2Html } from './admin-editor2';
import { validateEssay } from './essay-core';
import { searchBooks, type BookHit } from './openlibrary';
import { shotNotesHtml } from './essay-view';
import { badgeBuilderHtml, bindBadgeBuilder } from './badge-view';
import { renderCommentHtml, type CommentStatus, type PostComment } from './comment-core';
import { toggleTheme } from './theme';
import type { Album, ContentKey, ContentMap, Favorite, Friend, GuestbookEntry, Post, PostSummary, Profile, Settings, SocialIcon } from './types';
import { normalizeSettings } from './types';
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_LABEL } from './webhook-core';
import type { Festival, Member, Project, StickyNote, UploadedFile, VoiceMessage } from './demo/community-types';
import { isSectionKey, SECTION_KEYS, SECTION_SPECS, toList, type SectionKey } from './sections';
import { AUDIO_ACCEPT, MAX_AUDIO_BYTES, type PlaylistItem } from './music-core';
import { coarseLabel, GEO_LABEL, gpsForSave, PhotoError, preparePhoto, type PreparedPhoto } from './photo-upload';

/** 博客首页（部署前缀） */
const SITE_HOME = import.meta.env.BASE_URL || '/';
const SOCIAL_KEYS: SocialIcon[] = ['github', 'wechat', 'xiaohongshu', 'weibo', 'bilibili', 'zhihu', 'instagram', 'x', 'youtube', 'email', 'rss', 'link'];

// ============================================================ 状态与请求
type View = 'dash' | 'posts' | 'editor' | 'categories' | 'settings' | 'profile' | 'friends' | 'gallery' | 'favorites' | 'projects' | 'playlist' | 'guestbook' | 'notes' | 'festivals' | 'members' | 'inbox' | 'comments' | 'ugc' | 'discovery' | 'ops' | 'security' | SectionKey;
const root = document.getElementById('admin')!;
let csrf = '';
let view: View = 'dash';
let editing: Post | null = null;
let postFilter = { q: '', status: 'all', category: '' };

const NAV: { group: string; items: [View, string, string][] }[] = [
  { group: '概览', items: [['dash', 'dashboard', '仪表盘']] },
  { group: '内容', items: [['posts', 'file', '文章'], ['editor', 'edit', '写文章'], ['categories', 'folder', '分类']] },
  { group: '站点', items: [['settings', 'settings', '展示设置'], ['profile', 'user', '个人资料'], ['friends', 'link', '友链'], ['gallery', 'image', '画廊'], ['favorites', 'star', '收藏'], ['projects', 'box', '项目'], ['playlist', 'music', '音乐歌单']] },
  { group: '栏目', items: SECTION_KEYS.map((k) => [k, SECTION_SPECS[k].icon, SECTION_SPECS[k].label] as [View, string, string]) },
  { group: '社区', items: [['ugc', 'flag', '社区审核'], ['discovery', 'camera', '发现与活动'], ['comments', 'message', '评论审核'], ['guestbook', 'message', '留言审核'], ['notes', 'pin', '便利贴'], ['festivals', 'sparkles', '节日'], ['members', 'users', '好朋友与徽章'], ['inbox', 'mail', '上传与语音']] },
  { group: '运维', items: [['ops', 'chart', '运行状态'], ['security', 'lock', '二次验证']] },
];
const TITLE: Record<View, string> = Object.fromEntries(NAV.flatMap((g) => g.items.map(([v, , l]) => [v, l]))) as Record<View, string>;

function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && typeof init.body === 'string') headers.set('content-type', 'application/json');
  if (init.method && init.method !== 'GET') headers.set('x-csrf-token', csrf);
  return request<T>(path, { ...init, headers, credentials: 'include' }).catch((err) => {
    if (err instanceof ApiError && err.status === 401) {
      csrf = '';
      renderLogin('登录已过期，请重新登录');
    }
    throw err;
  });
}
const put = <T>(path: string, body: unknown, method = 'PUT') => adminFetch<T>(path, { method, body: JSON.stringify(body) });

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function msg(text: string, err = false): void {
  const el = root.querySelector<HTMLElement>('.adm-msg');
  if (!el) return;
  // 结果图标：Motionary <usa-check>（描入 + 弹一下）；文字单独放一个 span
  el.innerHTML = text ? `${resultIconHtml(err ? 'error' : 'success', 18)}<span></span>` : '';
  el.querySelector('span')?.append(text);
  void defineUsed(el);
  el.classList.toggle('adm-msg--err', err);
  el.classList.toggle('is-on', !!text);
  clearTimeout(toastTimer);
  if (text && !err) toastTimer = setTimeout(() => el.classList.remove('is-on'), 2600);
}

function errText(err: unknown): string {
  if (err instanceof ApiError) {
    const d = Array.isArray(err.details) ? '：' + (err.details as { path: string; message: string }[]).map((x) => `${x.path} ${x.message}`).join('；') : '';
    return err.message + d;
  }
  return String(err);
}

const fmtDate = (s: string | null | undefined) => (s ? s.slice(0, 16).replace('T', ' ') : '—');
const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const rawUrl = (u: string | undefined) => (!u ? '' : u.startsWith('/api/') ? API_BASE + u : u);

// ============================================================ 布局
function tile(size: 'full' | 'twothird' | 'half' | 'third' | 'quarter', body: string, cls = '', attrs = ''): string {
  return `<section class="tile tile--${size} adm-tile${cls ? ` ${cls}` : ''}" ${attrs}>${body}</section>`;
}
const head = (ic: string, title: string, extra = '') => `<div class="adm-tile__head"><p class="tile__kicker">${icon(ic)}<span>${e(title)}</span></p>${extra}</div>`;
const stat = (ic: string, label: string, value: number | string, go: View, tone = '') =>
  tile('quarter', `<button type="button" class="adm-stat${tone ? ` adm-stat--${tone}` : ''}" data-go="${go}"><span class="adm-stat__ic">${icon(ic)}</span><b class="adm-stat__n">${e(String(value))}</b><span class="adm-stat__l">${e(label)}</span></button>`, 'adm-stat-tile');

function shell(content: string): string {
  const nav = NAV.map(
    (g) => `<p class="adm-side__group">${e(g.group)}</p>${g.items
      .map(([v, ic, label]) => `<button type="button" class="adm-nav${view === v ? ' is-active' : ''}" data-view="${v}"${view === v ? ' aria-current="page"' : ''}>${icon(ic)}<span>${e(v === 'editor' && editing ? '编辑文章' : label)}</span></button>`)
      .join('')}`,
  ).join('');
  return `${backdrop()}<div class="adm-layout">
<aside class="adm-side" aria-label="后台导航"><div class="adm-brand"><span class="adm-brand__logo">${icon('dashboard')}</span><span>博客后台</span></div><nav class="adm-side__nav">${nav}</nav>
<div class="adm-side__foot"><a class="adm-nav" href="${e(import.meta.env.BASE_URL)}" target="_blank" rel="noopener">${icon('external')}<span>查看站点</span></a><button type="button" class="adm-nav" id="logout">${icon('logout')}<span>退出登录</span></button></div></aside>
<main class="adm-main" id="main"><header class="adm-top"><h1>${e(view === 'editor' && editing ? '编辑文章' : TITLE[view])}</h1><div class="adm-top__act"><button type="button" class="btn btn--soft btn--sm" id="theme-toggle" aria-label="切换深浅色">${icon('moon', 'only-light')}${icon('sun', 'only-dark')}</button></div></header>
<p class="adm-msg" role="status" aria-live="polite"></p>
<div class="bento adm-bento">${content}</div></main></div>`;
}

function mount(content: string): void {
  root.innerHTML = shell(content);
  void defineUsed(root); // usa-blobs 背景、徽章的 usa-fx 材质
  // 手机上侧边栏是横向滚动条：把当前项滚进视野
  const active = root.querySelector<HTMLElement>('.adm-nav.is-active');
  const side = root.querySelector<HTMLElement>('.adm-side');
  if (active && side && side.scrollWidth > side.clientWidth) side.scrollLeft = active.offsetLeft - (side.clientWidth - active.offsetWidth) / 2;
}

// ============================================================ 登录
function renderLogin(note = ''): void {
  root.innerHTML = `${backdrop()}<main class="adm-contents"><form class="tile adm-login" id="login-form">
  <div class="adm-login__cover" aria-hidden="true"></div>
  <span class="adm-brand__logo adm-brand__logo--lg">${icon('lock')}</span>
  <h1>博客后台</h1>
  <p class="muted">请输入管理密码登录</p>
  <p class="demo-hint" hidden></p>
  <div class="field"><label for="pw">密码</label><input id="pw" name="password" type="password" autocomplete="current-password" required maxlength="256"></div>
  <button class="btn btn--primary btn--block" type="submit">${icon('lock')}登录</button>
  <p class="adm-msg${note ? ' is-on' : ''}" role="status">${e(note)}</p>
  <a class="adm-login__back" href="${e(SITE_HOME)}">${icon('arrowLeft')}返回博客首页</a>
</form></main>`;
  void defineUsed(root);
  const form = root.querySelector<HTMLFormElement>('#login-form')!;
  if (DEMO) {
    void import('./demo/client').then(({ DEMO_PASSWORD }) => {
      const hint = form.querySelector<HTMLElement>('.demo-hint');
      if (!hint) return;
      hint.innerHTML = `演示密码：<code>${e(DEMO_PASSWORD)}</code>（所有改动只保存在你的浏览器里）`;
      hint.hidden = false;
    });
  }
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;
    msg('登录中…');
    try {
      const r = await request<{ csrfToken?: string; needsTotp?: boolean; preAuth?: string }>('/api/auth/login', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
      // L22：开启了二次验证 → 第二步输入验证器里的 6 位码（或恢复码）
      if (r.needsTotp && r.preAuth) return renderSecondFactor(r.preAuth);
      csrf = r.csrfToken ?? '';
      view = 'dash';
      void go();
    } catch (err) {
      msg(errText(err), true);
    }
  });
}

/** L22 登录第二步：TOTP 或一次性恢复码（preAuth 5 分钟有效、只能用一次） */
function renderSecondFactor(preAuth: string): void {
  root.innerHTML = `${backdrop()}<main class="adm-contents"><form class="tile adm-login" id="totp-form">
  <div class="adm-login__cover" aria-hidden="true"></div>
  <span class="adm-brand__logo adm-brand__logo--lg">${icon('lock')}</span>
  <h1>二次验证</h1>
  <p class="muted">打开身份验证器 App，输入 6 位验证码；手机不在身边时可以输入一个恢复码。</p>
  <div class="field"><label for="totp">验证码或恢复码</label><input id="totp" name="code" autocomplete="one-time-code" inputmode="text" required maxlength="20" autocapitalize="characters" spellcheck="false"></div>
  <button class="btn btn--primary btn--block" type="submit">${icon('check')}验证并登录</button>
  <p class="adm-msg" role="status"></p>
  <button class="btn btn--ghost btn--sm adm-login__back" type="button" id="totp-back">${icon('arrowLeft')}重新输入密码</button>
</form></main>`;
  void defineUsed(root);
  const form = root.querySelector<HTMLFormElement>('#totp-form')!;
  const input = form.querySelector<HTMLInputElement>('#totp')!;
  input.focus();
  root.querySelector('#totp-back')?.addEventListener('click', () => renderLogin());
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    msg('验证中…');
    try {
      const r = await request<{ csrfToken: string }>('/api/auth/2fa', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ preAuth, code: input.value.trim() }) });
      csrf = r.csrfToken;
      view = 'dash';
      void go();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'preauth_expired') return renderLogin(err.message);
      msg(errText(err), true);
      input.select();
    }
  });
}

/** L22 后台「二次验证」：按需加载 admin-security（含二维码生成） */
async function renderSecurityAdmin(): Promise<void> {
  mount(tile('full', `<div class="js-adm-sec" aria-busy="true"><p class="muted">加载中…</p></div>`));
  const box = root.querySelector<HTMLElement>('.js-adm-sec')!;
  const m = await import('./admin-security');
  await m.mountAdminSecurity(box, { fetch: adminFetch, msg, errText });
}

// ============================================================ 路由
/** L23：告诉前台「本浏览器登录过后台」，前台据此确认站长身份后显示「站长后台」入口（只是提示，权限仍由服务端判断） */
function setAdminHint(on: boolean): void {
  try {
    if (on) localStorage.setItem('blog-admin-hint', '1');
    else localStorage.removeItem('blog-admin-hint');
  } catch {
    /* ignore */
  }
}
async function go(next?: View): Promise<void> {
  if (next) view = next;
  setAdminHint(true);
  history.replaceState(null, '', `#${view}`);
  try {
    switch (view) {
      case 'dash': return await renderDash();
      case 'posts': return await renderPosts();
      case 'editor': return await renderEditor();
      case 'categories': return await renderCategories();
      case 'settings': return await renderSettings();
      case 'profile': return await renderProfile();
      case 'friends': case 'favorites': case 'gallery': return await renderContent(view);
      case 'projects': return await renderProjects();
      case 'playlist': return await renderPlaylist();
      case 'guestbook': return await renderGuestbook();
      case 'notes': return await renderNotes();
      case 'festivals': return await renderFestivals();
      case 'members': return await renderMembers();
      case 'comments': return await renderComments();
      case 'ugc': return await renderUgc();
      case 'discovery': return await renderDiscoveryAdmin();
      case 'ops': return await renderOpsAdmin();
      case 'security': return await renderSecurityAdmin();
      case 'inbox': return await renderInbox();
      default: if (isSectionKey(view)) return await renderSection(view);
    }
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401)) mount(tile('full', `<p class="adm-msg adm-msg--err is-on">${e(errText(err))}</p>`));
  }
}

/** 旧版 Worker 没有社区接口时返回 404：对应模块显示「未启用」而不是报错。 */
async function optional<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return fallback;
    throw err;
  }
}

/** 后台：全部文章（含草稿）的摘要，按游标逐页拉取，不再有 100 篇上限 */
function adminPostsAll(): Promise<{ posts: PostSummary[]; total: number }> {
  return walkPages((cursor) => adminFetch<{ posts: PostSummary[]; total: number; nextCursor?: string | null }>(`/api/admin/posts?status=all&limit=${PAGE_LIMIT_MAX}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`));
}

// ============================================================ 仪表盘
async function renderDash(): Promise<void> {
  const [posts, gb, notes, members, inbox] = await Promise.all([
    adminPostsAll(),
    adminFetch<{ entries: GuestbookEntry[] }>('/api/admin/guestbook?status=pending'),
    optional(adminFetch<{ notes: StickyNote[] }>('/api/admin/notes'), { notes: [] }),
    optional(adminFetch<{ members: Member[] }>('/api/admin/members'), { members: [] }),
    optional(adminFetch<{ files: UploadedFile[]; voice: VoiceMessage[] }>('/api/admin/inbox'), { files: [], voice: [] }),
  ]);
  const pub = posts.posts.filter((p) => p.status === 'published');
  const words = pub.reduce((n, p) => n + (p.wordCount || 0), 0);
  const hiddenNotes = notes.notes.filter((n) => n.hidden).length;
  const pendingFiles = inbox.files.filter((f) => f.status === 'pending').length;
  const unread = inbox.voice.filter((v) => !v.read).length;
  const recent = posts.posts.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 6);
  const todo = [
    gb.entries.length ? `<li><button type="button" class="adm-link" data-go="guestbook">${icon('message')}${gb.entries.length} 条留言待审核</button></li>` : '',
    hiddenNotes ? `<li><button type="button" class="adm-link" data-go="notes">${icon('pin')}${hiddenNotes} 张便利贴被举报隐藏</button></li>` : '',
    pendingFiles ? `<li><button type="button" class="adm-link" data-go="inbox">${icon('upload')}${pendingFiles} 个文件待审核</button></li>` : '',
    unread ? `<li><button type="button" class="adm-link" data-go="inbox">${icon('mail')}${unread} 条语音未读</button></li>` : '',
  ].join('');
  mount(
    stat('file', '已发布文章', pub.length, 'posts') +
      stat('edit', '草稿', posts.posts.length - pub.length, 'posts', 'warm') +
      stat('users', '好朋友', members.members.length, 'members', 'pink') +
      stat('message', '待审核留言', gb.entries.length, 'guestbook', gb.entries.length ? 'alert' : '') +
      tile(
        'twothird',
        `${head('history', '最近更新', `<button type="button" class="btn btn--soft btn--sm" data-go="posts">全部文章</button>`)}
<ul class="adm-list">${recent
          .map((p) => `<li><button type="button" class="adm-link" data-act="edit" data-slug="${e(p.slug)}"><span class="adm-dot adm-dot--${p.status}"></span><span class="adm-list__t">${e(p.title)}</span></button><span class="muted small">${e(fmtDate(p.updatedAt))}</span></li>`)
          .join('') || '<li class="empty">还没有文章</li>'}</ul>`,
        '',
      ) +
      tile('third', `${head('check', '待处理')}<ul class="adm-list adm-list--todo">${todo || '<li class="empty">都处理完了，喝杯咖啡吧</li>'}</ul>`) +
      tile('third', `${head('chart', '写作统计')}<p class="adm-big">${words.toLocaleString('zh-CN')}<small> 字</small></p><p class="muted small">已发布文章的总字数 · 平均 ${pub.length ? Math.round(words / pub.length).toLocaleString('zh-CN') : 0} 字 / 篇</p>`) +
      tile('third', `${head('plus', '快捷操作')}<div class="adm-quick"><button type="button" class="btn btn--sm" data-act="new">${icon('edit')}写文章</button><button type="button" class="btn btn--soft btn--sm" data-go="settings">${icon('settings')}展示设置</button><button type="button" class="btn btn--soft btn--sm" data-go="festivals">${icon('sparkles')}节日</button><button type="button" class="btn btn--soft btn--sm" data-go="members">${icon('users')}颁发徽章</button></div>`) +
      tile('third', `${head('mail', '收件箱')}<p class="adm-big">${inbox.files.length + inbox.voice.length}<small> 件</small></p><p class="muted small">${inbox.files.length} 个文件 · ${inbox.voice.length} 条语音 · ${unread} 条未读</p>`),
  );
}

// ============================================================ 文章
let postsCache: PostSummary[] = [];
async function renderPosts(): Promise<void> {
  const { posts } = await adminPostsAll();
  postsCache = posts;
  const cats = [...new Set(posts.map((p) => p.category).filter(Boolean) as string[])].sort();
  const opt = (v: string, cur: string, label: string) => `<option value="${e(v)}"${v === cur ? ' selected' : ''}>${e(label)}</option>`;
  mount(
    tile(
      'full',
      `${head('file', `全部文章（${posts.length}）`, `<button class="btn btn--sm" type="button" data-act="new">${icon('plus')}写文章</button>`)}
<div class="adm-toolbar">
  <label class="adm-search">${icon('search')}<input type="search" id="post-q" placeholder="搜索标题、slug、标签" value="${e(postFilter.q)}" aria-label="搜索文章"></label>
  <select id="post-status" aria-label="按状态筛选">${opt('all', postFilter.status, '全部状态')}${opt('published', postFilter.status, '已发布')}${opt('draft', postFilter.status, '草稿')}</select>
  <select id="post-cat" aria-label="按分类筛选">${opt('', postFilter.category, '全部分类')}${cats.map((c) => opt(c, postFilter.category, c)).join('')}${opt('__none', postFilter.category, '未分类')}</select>
</div>
<div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>标题</th><th>分类</th><th>状态</th><th class="hide-sm">更新</th><th>操作</th></tr></thead><tbody id="post-rows"></tbody></table></div>`,
    ),
  );
  const paint = () => {
    const q = postFilter.q.trim().toLowerCase();
    const rows = postsCache
      .filter((p) => postFilter.status === 'all' || p.status === postFilter.status)
      .filter((p) => !postFilter.category || (postFilter.category === '__none' ? !p.category : p.category === postFilter.category))
      .filter((p) => !q || `${p.title} ${p.slug} ${p.tags.join(' ')}`.toLowerCase().includes(q));
    root.querySelector('#post-rows')!.innerHTML =
      rows
        .map(
          (p) => `<tr><td><div class="adm-post">${p.coverUrl ? `<img src="${e(rawUrl(p.coverUrl))}" alt="" loading="lazy">` : `<span class="adm-post__ph">${icon('file')}</span>`}<div><strong>${e(p.title)}</strong><br><span class="muted small">/${e(p.slug)}${p.tags.length ? ` · ${p.tags.map((t) => `#${e(t)}`).join(' ')}` : ''}</span></div></div></td>
<td>${p.category ? `<span class="chip">${e(p.category)}</span>` : '<span class="muted small">未分类</span>'}</td>
<td><span class="chip ${p.status === 'published' ? 'chip--pub' : 'chip--draft'}">${p.status === 'published' ? '已发布' : '草稿'}</span></td>
<td class="hide-sm muted small">${e(fmtDate(p.updatedAt))}</td>
<td><div class="adm-row">
  <button class="adm-icon-btn${p.pinned ? ' is-on' : ''}" type="button" data-act="pin" data-slug="${e(p.slug)}" aria-pressed="${p.pinned}" title="${p.pinned ? '取消置顶' : '置顶'}">${icon('pin')}</button>
  <button class="btn btn--soft btn--sm" type="button" data-act="edit" data-slug="${e(p.slug)}">编辑</button>
  <button class="btn btn--ghost btn--sm" type="button" data-act="${p.status === 'published' ? 'unpublish' : 'publish'}" data-slug="${e(p.slug)}">${p.status === 'published' ? '撤回' : '发布'}</button>
  <button class="adm-icon-btn adm-icon-btn--danger" type="button" data-act="delete" data-slug="${e(p.slug)}" title="删除" aria-label="删除 ${e(p.title)}">${icon('trash')}</button>
</div></td></tr>`,
        )
        .join('') || '<tr><td colspan="5" class="empty">没有符合条件的文章</td></tr>';
  };
  paint();
  root.querySelector<HTMLInputElement>('#post-q')!.addEventListener('input', (ev) => ((postFilter.q = (ev.target as HTMLInputElement).value), paint()));
  root.querySelector<HTMLSelectElement>('#post-status')!.addEventListener('change', (ev) => ((postFilter.status = (ev.target as HTMLSelectElement).value), paint()));
  root.querySelector<HTMLSelectElement>('#post-cat')!.addEventListener('change', (ev) => ((postFilter.category = (ev.target as HTMLSelectElement).value), paint()));
}

async function uploadImage(file: File): Promise<{ url: string; markdown: string }> {
  return (await uploadPhoto(file)).res;
}

/** 上传前在浏览器里读 EXIF、去掉文件里的 EXIF / GPS（photo-upload.ts），再上传处理后的文件。 */
async function uploadPhoto(file: File): Promise<{ res: { url: string; markdown: string }; prep: PreparedPhoto }> {
  const prep = await preparePhoto(file);
  const fd = new FormData();
  fd.append('file', prep.file);
  fd.append('alt', file.name.replace(/\.[^.]+$/, '').slice(0, 100));
  const res = await adminFetch<{ url: string; markdown: string }>('/api/admin/images', { method: 'POST', body: fd });
  return { res, prep };
}

const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,.heic,.heif';
const EXIF_FIELDS = [
  ['date', '拍摄时间', '2026-09-12 18:42'],
  ['camera', '机身 / 手机', 'iPhone 15 Pro'],
  ['lens', '镜头', ''],
  ['focal', '焦距', '24mm'],
  ['aperture', '光圈', 'f/1.8'],
  ['shutter', '快门', '1/120s'],
  ['iso', 'ISO', '100'],
] as const;

/** 读出的 EXIF：可编辑字段 + 位置开关（默认不勾选）。原始坐标不写进任何输入框。 */
function exifPanelHtml(prep: PreparedPhoto, url: string, extra: string, actions: string): string {
  const f = prep.fields;
  const gps = prep.gps;
  return `<div class="adm-exif">
  <div class="adm-exif__pv"><img src="${e(rawUrl(url))}" alt="" width="${prep.width || 160}" height="${prep.height || 120}"><p class="muted small">${prep.width && prep.height ? `${prep.width} × ${prep.height} · ` : ''}${e(prep.notes.join(' · ') || '文件里没有元数据')}</p></div>
  <div class="adm-exif__body">
    <p class="adm-exif__status" role="status">${f ? `${icon('check')}已从照片读取 EXIF，可以修改` : `${icon('camera')}照片里没有 EXIF，请手动填写`}</p>
    <div class="adm-grid2">${extra}${EXIF_FIELDS.map(([k, label, ph]) => `<label class="field"><span>${label}</span><input name="exif-${k}" data-exif="${k}" maxlength="${k === 'lens' ? 60 : k === 'camera' ? 40 : 20}" value="${e(f?.[k] ?? '')}" placeholder="${e(ph)}"></label>`).join('')}</div>
    ${gps ? `<div class="adm-exif__geo"><label class="adm-check"><input type="checkbox" data-exif-geo> ${e(GEO_LABEL)}</label><span class="muted small">照片带有位置：${e(coarseLabel(gps))}。不勾选就不保存任何位置；勾选只保存粗化到 0.1° 的坐标，精确坐标不会上传。</span></div>` : '<p class="muted small adm-exif__geo">照片里没有 GPS 位置。</p>'}
    <div class="adm-row">${actions}</div>
  </div>
</div>`;
}
const exifValues = (box: HTMLElement): Record<string, string> =>
  Object.fromEntries([...box.querySelectorAll<HTMLInputElement>('[data-exif]')].map((i) => [i.dataset.exif!, i.value.trim()]));
const geoChecked = (box: HTMLElement) => !!box.querySelector<HTMLInputElement>('[data-exif-geo]')?.checked;
const photoErr = (err: unknown) => (err instanceof PhotoError ? err.message : errText(err));

async function renderEditor(): Promise<void> {
  const p = editing;
  const { categories } = await request<{ categories: { category: string }[] }>('/api/categories').catch(() => ({ categories: [] }));
  mount(
    tile(
      'half',
      `<form id="post-form" class="adm-form">
  <div class="field"><label for="f-title">标题</label><input id="f-title" name="title" required maxlength="200" value="${e(p?.title ?? '')}"></div>
  <div class="adm-grid2">
    <div class="field"><label for="f-slug">slug（留空自动生成）</label><input id="f-slug" name="slug" maxlength="80" pattern="[a-z0-9]+(-[a-z0-9]+)*" value="${e(p?.slug ?? '')}"></div>
    <div class="field"><label for="f-cat">分类</label><input id="f-cat" name="category" maxlength="30" list="cat-list" value="${e(p?.category ?? '')}"><datalist id="cat-list">${categories.map((c) => `<option value="${e(c.category)}">`).join('')}</datalist></div>
  </div>
  <div class="field"><label for="f-series">系列连载（可选，同名文章按发布时间组成系列）</label><input id="f-series" name="series" maxlength="40" value="${e(p?.series ?? '')}"></div>
  <div class="field"><label for="f-summary">摘要</label><input id="f-summary" name="summary" maxlength="500" value="${e(p?.summary ?? '')}"></div>
  <div class="field"><label for="f-tags">标签（逗号分隔）</label><input id="f-tags" name="tags" value="${e((p?.tags ?? []).join(', '))}"></div>
  <div class="field"><label for="f-cover">封面图</label><div class="adm-cover"><input id="f-cover" name="coverUrl" placeholder="URL，或点右边上传" value="${e(p?.coverUrl ?? '')}"><label class="btn btn--soft btn--sm">${icon('upload')}上传封面<input type="file" id="f-cover-file" accept="${PHOTO_ACCEPT}" hidden></label></div></div>
  <label class="adm-check"><input type="checkbox" name="pinned" ${p?.pinned ? 'checked' : ''}> 置顶这篇文章</label>
  ${essayEditorHtml(p)}
  <div class="field"><div class="adm-row adm-row--between"><label for="f-content">正文（Markdown）</label><label class="btn btn--ghost btn--sm">${icon('image')}插入图片<input type="file" id="f-image" accept="${PHOTO_ACCEPT}" hidden></label></div><textarea id="f-content" name="contentMd" class="adm-md">${e(p?.contentMd ?? '')}</textarea></div>
  <div class="adm-row">
    <button class="btn" type="submit">${icon('check')}${p ? '保存' : '保存草稿'}</button>
    ${p ? `<button class="btn btn--ghost" type="button" data-act="${p.status === 'published' ? 'unpublish' : 'publish'}" data-slug="${e(p.slug)}">${p.status === 'published' ? '撤回发布' : '发布'}</button>` : '<button class="btn btn--ghost" type="submit" data-publish="1">保存并发布</button>'}
    ${p ? `<span class="chip ${p.status === 'published' ? 'chip--pub' : 'chip--draft'}">${p.status === 'published' ? '已发布' : '草稿'}</span><span class="muted small" id="wc"></span>` : '<span class="muted small" id="wc"></span>'}
  </div>
</form>`,
      'adm-editor',
    ) +
      tile('half', `${head('eye', '实时预览')}<article class="adm-preview" id="preview"></article>`, 'adm-preview-tile') +
      tile('full', editor2Html(p), 'adm-ed2-tile', 'id="ed2"') +
      tile('full', '', 'adm-exif-tile', 'id="post-exif" hidden'),
  );
  const form = root.querySelector<HTMLFormElement>('#post-form')!;
  const content = form.querySelector<HTMLTextAreaElement>('#f-content')!;
  const preview = root.querySelector<HTMLElement>('#preview')!;
  const field = (n: string) => (form.elements.namedItem(n) as HTMLInputElement).value;
  const update = () => {
    const cover = field('coverUrl').trim();
    const tags = field('tags').split(/[,，]/).map((t) => t.trim()).filter(Boolean);
    preview.innerHTML = `${cover ? `<img class="adm-preview__cover" src="${e(rawUrl(cover))}" alt="">` : ''}
<p class="muted small">${field('category') ? `${e(field('category'))} · ` : ''}${tags.map((t) => `#${e(t)}`).join(' ')}</p>
<h1 class="adm-preview__title">${e(field('title') || '（无标题）')}</h1>${field('summary') ? `<p class="adm-preview__sum">${e(field('summary'))}</p>` : ''}
<div class="prose">${renderSafe(content.value)}</div>${mediaPreview()}`;
    const wc = root.querySelector('#wc');
    if (wc) wc.textContent = `${content.value.replace(/\s+/g, '').length} 字`;
  };
  function mediaPreview(): string {
    const m = readPostMediaRaw(form);
    const ess = m.essay ? validateEssay({ ...m.essay, photos: m.essay.photos.filter((x) => x.src) }).essay : null;
    return `${ess?.photos.length ? essaySection(ess) : ''}${m.notes ? shotNotesHtml(m.notes, '拍摄手记', true) : ''}`;
  }
  const l14 = bindEssayEditor(form, {
    upload: async (file) => {
      const { res, prep } = await uploadPhoto(file);
      return { url: res.url, width: prep.width, height: prep.height, exif: prep.fields, notes: prep.notes };
    },
    msg: (t, err) => msg(t, err),
    onChange: () => update(),
    insert: (md) => {
      const pos = content.selectionStart ?? content.value.length;
      content.value = `${content.value.slice(0, pos)}${pos ? '\n\n' : ''}${md}\n\n${content.value.slice(pos)}`;
      content.focus();
      update();
    },
  });
  form.addEventListener('input', update);
  update();
  // L24 写作台 2.0：块大纲、自动保存与草稿恢复、模板、媒体库、定时发布、发布预览
  const ed2 = bindEditor2({
    root,
    form,
    content,
    post: p,
    get: (path) => adminFetch(path),
    send: (path, body, method) => (method === 'DELETE' ? adminFetch(path, { method }) : put(path, body, method)),
    uploadBlob: async (blob, name) => {
      const fd = new FormData();
      fd.append('file', new File([blob], name, { type: blob.type || 'image/webp' }));
      fd.append('alt', '');
      return adminFetch<{ url: string }>('/api/admin/images', { method: 'POST', body: fd });
    },
    uploadPhoto: async (file) => {
      const { res, prep } = await uploadPhoto(file);
      return { url: res.url, width: prep.width, height: prep.height, file: prep.file };
    },
    msg: (t, err) => msg(t, err),
    previewUrl: `${SITE_HOME.replace(/\/?$/, '/')}preview/`,
    errStatus: (err) => (err instanceof ApiError ? { status: err.status, details: err.details } : { status: 0 }),
  });
  form.querySelector<HTMLInputElement>('#f-cover-file')!.addEventListener('change', async (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    msg('封面上传中…');
    try {
      (form.elements.namedItem('coverUrl') as HTMLInputElement).value = (await uploadImage(file)).url;
      update();
      msg('封面已上传（已去除 EXIF / GPS）');
    } catch (err) {
      msg(photoErr(err), true);
    }
  });
  form.querySelector<HTMLInputElement>('#f-image')!.addEventListener('change', async (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    msg('上传中…');
    try {
      const { res: r, prep } = await uploadPhoto(file);
      const pos = content.selectionStart ?? content.value.length;
      const before = `${content.value.slice(0, pos)}\n\n${r.markdown}\n`;
      content.value = `${before}\n${content.value.slice(pos)}`;
      update();
      const box = root.querySelector<HTMLElement>('#post-exif')!;
      box.hidden = false;
      box.innerHTML = `${head('aperture', '照片参数')}${exifPanelHtml(prep, r.url, '', `<button class="btn btn--soft btn--sm" type="button" data-exif-caption>${icon('plus')}在图片下插入参数说明</button>`)}`;
      box.querySelector('[data-exif-caption]')!.addEventListener('click', () => {
        const v = exifValues(box);
        const g = gpsForSave(prep.gps, geoChecked(box));
        const parts = [v.camera, v.focal, v.aperture, v.shutter, v.iso && `ISO ${v.iso}`, v.date, g.geo === 'on' && `约 ${g.lat}, ${g.lng}`].filter(Boolean);
        if (!parts.length) return msg('没有可插入的参数', true);
        const at = content.value.indexOf(r.markdown);
        const end = at < 0 ? content.value.length : at + r.markdown.length;
        content.value = `${content.value.slice(0, end)}\n*${parts.join(' · ').replace(/[*_[\]]/g, '')}*${content.value.slice(end)}`;
        update();
        msg('已插入参数说明');
      });
      msg(`图片已上传并插入正文${prep.notes.length ? `（${prep.notes.join('，')}）` : ''}`);
    } catch (err) {
      msg(photoErr(err), true);
    }
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const publish = (ev as SubmitEvent).submitter?.hasAttribute('data-publish');
    const slug = String(fd.get('slug') ?? '').trim();
    const body: Record<string, unknown> = {
      title: String(fd.get('title') ?? '').trim(),
      summary: String(fd.get('summary') ?? '').trim(),
      contentMd: String(fd.get('contentMd') ?? ''),
      tags: String(fd.get('tags') ?? '').split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      coverUrl: String(fd.get('coverUrl') ?? '').trim(),
      category: String(fd.get('category') ?? '').trim(),
      series: String(fd.get('series') ?? '').trim(),
      pinned: fd.get('pinned') === 'on',
    };
    if (slug) body.slug = slug;
    const media = l14.validate();
    if (!media.ok) return msg('影集 / 拍摄手记有需要修改的地方，见表单下方的提示', true);
    Object.assign(body, media.body);
    try {
      if (editing) editing = await put<Post>(`/api/admin/posts/${encodeURIComponent(editing.slug)}`, body, 'PATCH');
      else {
        if (publish) body.status = 'published';
        editing = await put<Post>('/api/admin/posts', body, 'POST');
      }
      ed2.saved();
      await renderEditor();
      msg('已保存');
    } catch (err) {
      msg(errText(err), true);
    }
  });
}

// ============================================================ 分类
async function renderCategories(): Promise<void> {
  const { posts } = await adminPostsAll();
  postsCache = posts;
  const counts = new Map<string, { all: number; pub: number }>();
  for (const p of posts) {
    const k = p.category ?? '';
    const c = counts.get(k) ?? { all: 0, pub: 0 };
    c.all++;
    if (p.status === 'published') c.pub++;
    counts.set(k, c);
  }
  const list = [...counts].sort((a, b) => b[1].all - a[1].all);
  mount(
    tile(
      'twothird',
      `${head('folder', `分类（${list.filter(([k]) => k).length}）`)}
<div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>分类</th><th>文章</th><th>已发布</th><th>操作</th></tr></thead><tbody>${list
        .map(
          ([k, c]) => `<tr><td>${k ? `<span class="chip">${e(k)}</span>` : '<span class="muted">未分类</span>'}</td><td>${c.all}</td><td>${c.pub}</td><td><div class="adm-row">${
            k ? `<button class="btn btn--soft btn--sm" type="button" data-act="cat-rename" data-cat="${e(k)}">重命名 / 合并</button><button class="btn btn--ghost btn--sm" type="button" data-act="cat-clear" data-cat="${e(k)}">取消分类</button>` : ''
          }<button class="btn btn--ghost btn--sm" type="button" data-act="cat-filter" data-cat="${e(k || '__none')}">查看文章</button></div></td></tr>`,
        )
        .join('')}</tbody></table></div>`,
    ) + tile('third', `${head('sparkles', '说明')}<p class="muted small">分类是文章上的一个字段：在编辑器里填新名字即可新建分类。重命名为已有分类的名字就是合并；「取消分类」会把这些文章改成未分类。</p>`),
  );
}

async function recategorize(from: string, to: string): Promise<void> {
  const targets = postsCache.filter((p) => p.category === from);
  for (const p of targets) await put(`/api/admin/posts/${encodeURIComponent(p.slug)}`, { category: to }, 'PATCH');
  msg(`已更新 ${targets.length} 篇文章`);
  await renderCategories();
}

// ============================================================ 展示设置（实时预览）
async function renderSettings(): Promise<void> {
  const s = normalizeSettings(await adminFetch<Settings>('/api/admin/settings'));
  const SECS: [keyof Settings['sections'], string][] = [['hero', '顶部大图'], ['announcement', '公告'], ['featured', '精选文章'], ['latest', '最新文章'], ['postList', '文章列表'], ['categories', '分类'], ['tags', '标签云'], ['stats', '统计'], ['about', '关于我']];
  const opt = (v: string, cur: string, label: string) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;
  mount(
    tile(
      'half',
      `<form id="settings-form" class="adm-form">
  <div class="field"><label for="s-title">站点标题</label><input id="s-title" name="siteTitle" required maxlength="80" value="${e(s.siteTitle)}"></div>
  <div class="field"><label for="s-desc">站点描述</label><input id="s-desc" name="siteDescription" maxlength="200" value="${e(s.siteDescription)}"></div>
  <div class="field"><label for="s-subs">首页轮播副标题（每行一句）</label><textarea id="s-subs" name="heroSubtitles" class="adm-short">${e(s.heroSubtitles.join('\n'))}</textarea></div>
  <div class="field"><label for="s-ann">公告（Markdown，可留空）</label><textarea id="s-ann" name="announcement" class="adm-short">${e(s.announcement)}</textarea></div>
  <div class="field"><label for="s-hero">首页大图 URL</label><input id="s-hero" name="heroImage" value="${e(s.heroImage)}"></div>
  <div class="adm-grid2">
    <div class="field"><label for="s-theme">默认主题</label><select id="s-theme" name="theme">${opt('system', s.theme, '跟随系统')}${opt('light', s.theme, '浅色')}${opt('dark', s.theme, '深色')}</select></div>
    <div class="field"><label for="s-anim">动效强度</label><select id="s-anim" name="animation">${opt('off', s.animation, '关闭')}${opt('low', s.animation, '低（仅淡入）')}${opt('normal', s.animation, '标准')}${opt('high', s.animation, '强（逐字入场）')}</select></div>
    <div class="field"><label for="s-ppp">每页文章数</label><input id="s-ppp" name="postsPerPage" type="number" min="1" max="50" value="${s.postsPerPage}"></div>
    <div class="field"><label for="s-feat">精选 slug（逗号分隔）</label><input id="s-feat" name="featuredSlugs" value="${e(s.featuredSlugs.join(', '))}"></div>
  </div>
  <fieldset class="adm-sections"><legend>首页区块</legend>${SECS.map(([k, l]) => `<label class="adm-check"><input type="checkbox" name="sec-${k}" ${s.sections[k] ? 'checked' : ''}> ${l}</label>`).join('')}</fieldset>
  <button class="btn" type="submit">${icon('check')}保存设置</button>
</form>`,
    ) + tile('half', `${head('eye', '首页预览')}<div class="adm-sitepreview" id="site-preview"></div>`, 'adm-preview-tile'),
  );
  const form = root.querySelector<HTMLFormElement>('#settings-form')!;
  const box = root.querySelector<HTMLElement>('#site-preview')!;
  const update = () => {
    const fd = new FormData(form);
    const on = (k: string) => fd.get(`sec-${k}`) === 'on';
    const theme = String(fd.get('theme'));
    const subs = String(fd.get('heroSubtitles') ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
    const hero = String(fd.get('heroImage') ?? '').trim();
    box.dataset.theme = theme === 'system' ? '' : theme;
    box.innerHTML = `<div class="sp-nav"><b>${e(String(fd.get('siteTitle') || '站点标题'))}</b><span></span><span></span><span></span></div>
<div class="sp-grid">${on('hero') ? `<div class="sp-tile sp-hero"${hero ? ` style="background-image:linear-gradient(transparent,rgb(0 0 0 / .55)),url('${e(rawUrl(hero)).replace(/'/g, '%27')}')"` : ''}><small>${e(subs[0] ?? String(fd.get('siteDescription') ?? ''))}</small><strong>${e(String(fd.get('siteTitle') || ''))}</strong></div>` : ''}
${on('announcement') && String(fd.get('announcement')).trim() ? `<div class="sp-tile sp-ann">${icon('megaphone')}<span>${renderSafe(String(fd.get('announcement')))}</span></div>` : ''}
${on('featured') ? '<div class="sp-tile sp-half"><i>精选文章</i></div>' : ''}${on('latest') ? '<div class="sp-tile sp-half"><i>最新文章</i></div>' : ''}
${on('postList') ? `<div class="sp-tile sp-full"><i>文章列表 · 每页 ${Number(fd.get('postsPerPage')) || 10} 篇</i></div>` : ''}
${on('categories') ? '<div class="sp-tile"><i>分类</i></div>' : ''}${on('tags') ? '<div class="sp-tile"><i>标签云</i></div>' : ''}${on('stats') ? '<div class="sp-tile"><i>统计</i></div>' : ''}${on('about') ? '<div class="sp-tile sp-full"><i>关于我</i></div>' : ''}</div>
<p class="muted small sp-foot">动效：${e(String(fd.get('animation')))} · 主题：${e(theme)}</p>`;
  };
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  update();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const sections = Object.fromEntries(SECS.map(([k]) => [k, fd.get(`sec-${k}`) === 'on']));
    try {
      await put<Settings>('/api/admin/settings', {
        siteTitle: fd.get('siteTitle'),
        siteDescription: fd.get('siteDescription'),
        heroSubtitles: String(fd.get('heroSubtitles') ?? '').split('\n').map((x) => x.trim()).filter(Boolean),
        announcement: String(fd.get('announcement') ?? ''),
        heroImage: String(fd.get('heroImage') ?? '').trim(),
        theme: fd.get('theme'),
        animation: fd.get('animation'),
        postsPerPage: Number(fd.get('postsPerPage')),
        sections,
        featuredSlugs: String(fd.get('featuredSlugs') ?? '').split(/[,，]/).map((x) => x.trim()).filter(Boolean),
      });
      msg('设置已保存');
    } catch (err) {
      msg(errText(err), true);
    }
  });
}

// ============================================================ 个人资料
async function renderProfile(): Promise<void> {
  const p = await adminFetch<Profile>('/api/admin/profile');
  mount(
    tile(
      'twothird',
      `<form id="profile-form" class="adm-form">
  <div class="adm-grid2">
    <div class="field"><label for="p-name">名字</label><input id="p-name" name="name" required maxlength="60" value="${e(p.name)}"></div>
    <div class="field"><label for="p-location">所在地</label><input id="p-location" name="location" maxlength="60" value="${e(p.location)}"></div>
  </div>
  <div class="field"><label for="p-tagline">一句话介绍</label><input id="p-tagline" name="tagline" maxlength="120" value="${e(p.tagline)}"></div>
  <div class="field"><label for="p-role">身份一行（个人卡片名字下方）</label><input id="p-role" name="role" maxlength="80" placeholder="例如：摄影 / 产品体验 / 前端动效" value="${e(p.role ?? '')}"></div>
  <div class="field"><label for="p-stats">卡片数字（每行：名称 | 数值，最多 2 行；「文章」自动统计。示例数字请改成真实的或删掉）</label><textarea id="p-stats" name="stats" class="adm-short" placeholder="关注者 | 1.2k">${e((p.stats ?? []).map((x) => `${x.label} | ${x.value}`).join('\n'))}</textarea></div>
  <div class="field"><label for="p-avatar">头像 URL</label><input id="p-avatar" name="avatarUrl" value="${e(p.avatarUrl)}"></div>
  <div class="field"><label for="p-links">社交链接与社交 ID（每行：名称 | URL | 图标 | 社交 ID，后两项可省略）</label><textarea id="p-links" name="links" class="adm-short" placeholder="微信 | /about/ | wechat | your-wechat-id">${e(p.links.map((l) => [l.label, l.url, l.icon ?? '', l.handle ?? ''].join(' | ').replace(/( \| )+$/, '')).join('\n'))}</textarea>
    <small class="muted">图标可选：${SOCIAL_KEYS.join(' / ')}。填了社交 ID 的图标，访客点开能看到并复制这个 ID。</small></div>
  <div class="field"><label for="p-bio">简介（Markdown）</label><textarea id="p-bio" name="bioMd" class="adm-md adm-md--sm">${e(p.bioMd)}</textarea></div>
  <button class="btn" type="submit">${icon('check')}保存资料</button>
</form>`,
    ) + tile('third', `${head('eye', '名片预览')}<div id="profile-preview" class="adm-card-preview"></div>`, 'adm-preview-tile'),
  );
  const form = root.querySelector<HTMLFormElement>('#profile-form')!;
  const box = root.querySelector<HTMLElement>('#profile-preview')!;
  const update = () => {
    const fd = new FormData(form);
    const av = String(fd.get('avatarUrl') ?? '').trim();
    box.innerHTML = `${av ? `<img class="adm-av" src="${e(rawUrl(av))}" alt="">` : `<span class="adm-av adm-av--txt">${e(String(fd.get('name') ?? '').slice(0, 1))}</span>`}
<h3>${e(String(fd.get('name') ?? ''))}</h3><p class="muted small">${e(String(fd.get('tagline') ?? ''))}${fd.get('location') ? ` · ${icon('mapPin')}${e(String(fd.get('location')))}` : ''}</p><div class="prose small">${renderSafe(String(fd.get('bioMd') ?? ''))}</div>`;
  };
  form.addEventListener('input', update);
  update();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const links = String(fd.get('links') ?? '')
      .split('\n')
      .map((l) => l.split('|').map((x) => x.trim()))
      .filter((x) => x.length >= 2 && x[0] && x[1])
      .map(([label, url, ic, handle]) => ({
        label: label!,
        url: url!,
        ...(ic && (SOCIAL_KEYS as string[]).includes(ic) ? { icon: ic as SocialIcon } : {}),
        ...(handle ? { handle } : {}),
      }));
    const stats = String(fd.get('stats') ?? '')
      .split('\n')
      .map((l) => l.split('|').map((x) => x.trim()))
      .filter((x) => x.length >= 2 && x[0] && x[1])
      .slice(0, 2)
      .map(([label, value]) => ({ label: label!, value: value! }));
    try {
      await put<Profile>('/api/admin/profile', { name: fd.get('name'), tagline: fd.get('tagline'), avatarUrl: fd.get('avatarUrl'), location: fd.get('location'), bioMd: fd.get('bioMd'), links, role: fd.get('role'), stats }, 'PATCH');
      msg('资料已保存');
    } catch (err) {
      msg(errText(err), true);
    }
  });
}

// ============================================================ 通用列表编辑器（友链 / 收藏 / 画廊 / 项目 / 节日）
interface FieldDef { key: string; label: string; type?: 'text' | 'number' | 'textarea' | 'select' | 'list' | 'lines'; options?: string[]; optionLabels?: Record<string, string>; wide?: boolean; placeholder?: string }
function listEditor<T extends Record<string, unknown>>(o: { id: string; items: T[]; fields: FieldDef[]; blank: T; title: (x: T) => string; preview?: (x: T) => string; save: (items: T[]) => Promise<unknown> }): { add: (x: T) => Promise<void> } {
  let items = o.items.map((x) => ({ ...x }));
  const card = (x: T, i: number) => `<div class="adm-item" data-i="${i}">
  <div class="adm-item__head">${o.preview ? `<span class="adm-item__pv">${o.preview(x)}</span>` : ''}<b>${e(o.title(x) || '（未命名）')}</b>
  <span class="adm-row"><button class="adm-icon-btn" type="button" data-li="up" data-i="${i}" title="上移" aria-label="上移">${icon('arrowUp')}</button><button class="adm-icon-btn" type="button" data-li="down" data-i="${i}" title="下移" aria-label="下移">${icon('arrowDown')}</button><button class="adm-icon-btn adm-icon-btn--danger" type="button" data-li="del" data-i="${i}" title="删除" aria-label="删除">${icon('trash')}</button></span></div>
  <div class="adm-item__fields">${o.fields
    .map((f) => {
      const v = x[f.key];
      const val = Array.isArray(v) ? (f.type === 'list' ? v.join('，') : f.type === 'lines' ? v.join('\n') : '') : String(v ?? '');
      const name = `${f.key}`;
      const input =
        f.type === 'textarea' || f.type === 'lines'
          ? `<textarea name="${name}" class="adm-short" placeholder="${e(f.placeholder ?? '')}">${e(f.key === 'photos' ? photosText(v as Album['photos']) : val)}</textarea>`
          : f.type === 'select'
            ? `<select name="${name}">${(f.options ?? []).map((op) => `<option value="${e(op)}"${op === val ? ' selected' : ''}>${e(f.optionLabels?.[op] ?? op)}</option>`).join('')}</select>`
            : `<input name="${name}" ${f.type === 'number' ? 'type="number" min="0"' : ''} value="${e(val)}" placeholder="${e(f.placeholder ?? '')}">`;
      return `<label class="field${f.wide ? ' field--wide' : ''}"><span>${e(f.label)}</span>${input}</label>`;
    })
    .join('')}</div></div>`;
  const box = root.querySelector<HTMLElement>(`#${o.id}`)!;
  const paint = () => {
    box.innerHTML = items.map(card).join('') || '<p class="empty">还没有条目</p>';
  };
  const read = () => {
    items = [...box.querySelectorAll<HTMLElement>('.adm-item')].map((el, i) => {
      const x = { ...items[i]! } as Record<string, unknown>;
      for (const f of o.fields) {
        const inp = el.querySelector<HTMLInputElement>(`[name="${f.key}"]`);
        if (!inp) continue;
        x[f.key] = f.key === 'photos' ? parsePhotos(inp.value) : f.type === 'number' ? Number(inp.value) || 0 : f.type === 'list' ? toList(inp.value) : f.type === 'lines' ? toList(inp.value, true) : inp.value.trim();
      }
      return x as T;
    });
  };
  paint();
  box.addEventListener('input', () => {
    read();
    box.querySelectorAll<HTMLElement>('.adm-item').forEach((el, i) => {
      const b = el.querySelector('.adm-item__head b');
      if (b) b.textContent = o.title(items[i]!) || '（未命名）';
      const pv = el.querySelector('.adm-item__pv');
      if (pv && o.preview) pv.innerHTML = o.preview(items[i]!);
    });
  });
  box.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-li]');
    if (!b) return;
    read();
    const i = Number(b.dataset.i);
    if (b.dataset.li === 'del') items.splice(i, 1);
    if (b.dataset.li === 'up' && i > 0) [items[i - 1], items[i]] = [items[i]!, items[i - 1]!];
    if (b.dataset.li === 'down' && i < items.length - 1) [items[i + 1], items[i]] = [items[i]!, items[i + 1]!];
    paint();
  });
  root.querySelector(`[data-add="${o.id}"]`)?.addEventListener('click', () => {
    read();
    items.push({ ...o.blank });
    paint();
    box.querySelector<HTMLInputElement>('.adm-item:last-child input')?.focus();
  });
  root.querySelector(`[data-save="${o.id}"]`)?.addEventListener('click', async () => {
    read();
    try {
      await o.save(items);
      msg('已保存');
    } catch (err) {
      msg(errText(err), true);
    }
  });
  return {
    async add(x: T) {
      read();
      items.push(x);
      paint();
      await o.save(items);
    },
  };
}
const photosText = (ph: Album['photos'] | undefined) => (ph ?? []).map((p) => `${p.url} | ${p.caption}`).join('\n');
const parsePhotos = (s: string): Album['photos'] =>
  s.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((x) => x[0]).map(([url, caption]) => ({ url: url!, caption: caption ?? '' }));
const listTile = (id: string, ic: string, title: string, note = '') =>
  tile('full', `${head(ic, title, `<span class="adm-row"><button class="btn btn--soft btn--sm" type="button" data-add="${id}">${icon('plus')}添加</button><button class="btn btn--sm" type="button" data-save="${id}">${icon('check')}保存</button></span>`)}${note ? `<p class="muted small">${note}</p>` : ''}<div class="adm-items" id="${id}"></div>`);

async function renderContent(key: ContentKey): Promise<void> {
  const { items } = await adminFetch<{ items: ContentMap[typeof key] }>(`/api/admin/content/${key}`);
  const save = (list: unknown[]) => put(`/api/admin/content/${key}`, { items: list });
  const thumb = (u: unknown) => (typeof u === 'string' && u ? `<img src="${e(rawUrl(u))}" alt="" loading="lazy">` : '');
  if (key === 'friends') {
    mount(listTile('list', 'link', `友链（${items.length}）`));
    listEditor<Friend & Record<string, unknown>>({ id: 'list', items: items as never, blank: { name: '', url: 'https://', avatar: '', description: '' }, title: (x) => x.name, preview: (x) => thumb(x.avatar), save, fields: [{ key: 'name', label: '名字' }, { key: 'url', label: '网址' }, { key: 'avatar', label: '头像 URL' }, { key: 'description', label: '一句话介绍' }] });
  } else if (key === 'favorites') {
    mount(listTile('list', 'star', `收藏（${items.length}）`));
    listEditor<Favorite & Record<string, unknown>>({ id: 'list', items: items as never, blank: { title: '', url: 'https://', description: '', group: '' }, title: (x) => x.title, save, fields: [{ key: 'title', label: '标题' }, { key: 'url', label: '网址' }, { key: 'group', label: '分组' }, { key: 'description', label: '说明' }] });
  } else {
    mount(listTile('list', 'image', `画廊相册（${items.length}）`, '照片每行一张：URL | 说明。'));
    listEditor<Album & Record<string, unknown>>({
      id: 'list', items: items as never, blank: { slug: '', title: '', description: '', cover: '', date: '', photos: [] }, title: (x) => `${x.title}${x.photos?.length ? ` · ${x.photos.length} 张` : ''}`, preview: (x) => thumb(x.cover), save,
      fields: [{ key: 'title', label: '标题' }, { key: 'slug', label: 'slug' }, { key: 'date', label: '日期' }, { key: 'cover', label: '封面 URL' }, { key: 'description', label: '描述', wide: true }, { key: 'photos', label: '照片', type: 'textarea', wide: true, placeholder: 'https://… | 说明' }],
    });
  }
}

/** 扩展栏目（此刻 / 作品集 / 器材 / 书影音 / 时间线 / 更新日志 / 开源项目）：按 sections.ts 的字段规格生成表单。 */
async function renderSection(key: SectionKey): Promise<void> {
  const spec = SECTION_SPECS[key];
  const { items } = await optional(adminFetch<{ items: Record<string, unknown>[] }>(`/api/admin/content/${key}`), { items: [] });
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const uploadTile =
    key === 'works'
      ? tile('full', `${head('upload', '从照片添加', `<label class="btn btn--sm">${icon('upload')}选择照片<input type="file" id="work-photo" accept="${PHOTO_ACCEPT}" hidden></label>`)}<p class="muted small">上传时在浏览器里自动读取 EXIF（拍摄时间、手机 / 机身、镜头、焦距、光圈、快门、ISO），并从文件中去掉 EXIF 和 GPS。位置默认不公开。</p><div id="work-photo-panel"></div>`, 'adm-photo-tile')
      : key === 'shelf'
        ? tile('full', `${head('library', '添加书影音', `<label class="btn btn--sm btn--soft">${icon('upload')}上传封面新建<input type="file" id="shelf-cover" accept="${PHOTO_ACCEPT}" hidden></label>`)}
<form class="adm-row adm-ol" id="ol-form" role="search"><label class="visually-hidden" for="ol-q">书名</label><input id="ol-q" placeholder="书名，例如 明室 / Camera Lucida" maxlength="100" required><label class="visually-hidden" for="ol-a">作者（可选）</label><input id="ol-a" placeholder="作者（可选）" maxlength="60"><button class="btn btn--sm" type="submit">${icon('search')}在 Open Library 找书和封面</button></form>
<p class="muted small">只用 Open Library 的公开搜索接口（不抓取网页）；封面可以换成自己上传的图片或任意 https 链接。电影 / 音乐 / 游戏请手动填写。</p><ul class="adm-ol-list" id="ol-list" aria-live="polite"></ul>`, 'adm-photo-tile')
        : '';
  mount(uploadTile + listTile('list', spec.icon, `${spec.label}（${items.length}）`, `${e(spec.note)} <a href="${e(base + spec.path)}" target="_blank" rel="noopener">查看页面</a>`));
  const fields: FieldDef[] = spec.fields.map((f) => ({
    key: f.key,
    label: f.label,
    wide: f.wide,
    placeholder: 'placeholder' in f ? f.placeholder : undefined,
    ...(f.t === 'int' ? { type: 'number' as const } : f.t === 'enum' ? { type: 'select' as const, options: [...f.options], optionLabels: f.labels } : f.t === 'list' ? { type: f.lines ? ('lines' as const) : ('list' as const) } : f.t === 'str' && f.textarea ? { type: 'textarea' as const } : {}),
  }));
  const blank = Object.fromEntries(spec.fields.map((f) => [f.key, f.t === 'int' ? f.min : f.t === 'enum' ? f.options[0] : f.t === 'list' ? [] : ''])) as Record<string, unknown>;
  const thumb = (u: unknown) => (typeof u === 'string' && u ? `<img src="${e(rawUrl(u))}" alt="" loading="lazy">` : '');
  const list = listEditor<Record<string, unknown>>({
    id: 'list',
    items,
    blank,
    title: (x) => String(x.title ?? x.name ?? x.version ?? '') + (x.date ? ` · ${String(x.date)}` : ''),
    preview: key === 'works' ? (x) => thumb(x.url) : key === 'shelf' ? (x) => thumb(x.cover) : undefined,
    save: (list) => put(`/api/admin/content/${key}`, { items: list }),
    fields,
  });
  if (key === 'works') bindWorkPhoto(blank, list.add);
  if (key === 'shelf') bindShelfTools(blank, list.add);
}

/** 书影音：上传封面新建条目；Open Library 搜书 → 选一本加入书架（状态默认「想读」）。 */
function bindShelfTools(blank: Record<string, unknown>, add: (x: Record<string, unknown>) => Promise<void>): void {
  const file = root.querySelector<HTMLInputElement>('#shelf-cover');
  file?.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    msg('封面上传中…');
    try {
      const url = (await uploadImage(f)).url;
      await add({ ...blank, title: f.name.replace(/\.[^.]+$/, '').slice(0, 60) || '新条目', status: 'want', cover: url });
      msg('已新建条目，记得改标题和类型');
    } catch (err) {
      msg(photoErr(err), true);
    }
  });
  const form = root.querySelector<HTMLFormElement>('#ol-form');
  const out = root.querySelector<HTMLElement>('#ol-list');
  if (!form || !out) return;
  let hits: BookHit[] = [];
  let ctl: AbortController | null = null;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const q = (form.querySelector('#ol-q') as HTMLInputElement).value;
    const a = (form.querySelector('#ol-a') as HTMLInputElement).value;
    if (!q.trim()) return;
    ctl?.abort();
    ctl = new AbortController();
    out.innerHTML = '<li class="muted small">搜索中…</li>';
    try {
      hits = await searchBooks(q, a, ctl.signal);
      out.innerHTML = hits.length
        ? hits.map((h, i) => `<li class="adm-ol-hit">${h.cover ? `<img src="${e(h.cover)}" alt="" loading="lazy" width="48" height="72">` : `<span class="adm-ol-ph">${icon('book')}</span>`}<span><b>${e(h.title)}</b><small class="muted">${e([h.creator, h.year].filter(Boolean).join(' · '))}${h.cover ? '' : ' · 没有封面'}</small></span><button type="button" class="btn btn--sm btn--soft" data-ol="${i}">${icon('plus')}加入书架</button></li>`).join('')
        : '<li class="muted small">没有找到，换个书名或手动添加。</li>';
    } catch (err) {
      if ((err as DOMException)?.name !== 'AbortError') out.innerHTML = '<li class="muted small">Open Library 暂时连不上，可以手动填写。</li>';
    }
  });
  out.addEventListener('click', async (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('[data-ol]');
    const h = b ? hits[Number(b.dataset.ol)] : undefined;
    if (!h) return;
    try {
      await add({ ...blank, kind: 'book', title: h.title, creator: h.creator, year: h.year, status: 'want', cover: h.cover, url: h.key ? `https://openlibrary.org${h.key}` : '' });
      msg(`已加入书架：${h.title}`);
    } catch (err) {
      msg(errText(err), true);
    }
  });
}

/** 作品集「从照片添加」：读 EXIF → 预填 → 位置开关（默认关）→ 加入列表并保存。 */
function bindWorkPhoto(blank: Record<string, unknown>, add: (x: Record<string, unknown>) => Promise<void>): void {
  const input = root.querySelector<HTMLInputElement>('#work-photo');
  const panel = root.querySelector<HTMLElement>('#work-photo-panel');
  if (!input || !panel) return;
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    msg('读取 EXIF 并上传中…');
    try {
      const { res, prep } = await uploadPhoto(file);
      const d = prep.fields?.date ?? '';
      const id = `p-${(d.replace(/\D/g, '').slice(0, 12) || Date.now().toString(36))}`.toLowerCase();
      const title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 60) || '新作品';
      panel.innerHTML = exifPanelHtml(
        prep,
        res.url,
        `<label class="field"><span>标题</span><input name="exif-title" data-exif="title" maxlength="60" value="${e(title)}" required></label><label class="field"><span>id</span><input name="exif-id" data-exif="id" maxlength="60" value="${e(id)}"></label><label class="field"><span>地点</span><input name="exif-location" data-exif="location" maxlength="40" placeholder="例如：桂林"></label>`,
        `<button class="btn btn--sm" type="button" data-exif-add>${icon('check')}添加到作品集并保存</button>`,
      );
      panel.querySelector('[data-exif-add]')!.addEventListener('click', async () => {
        const v = exifValues(panel);
        try {
          await add({ ...blank, ...v, url: res.url, width: prep.width, height: prep.height, ...gpsForSave(prep.gps, geoChecked(panel)) });
          panel.innerHTML = '';
          msg('已添加到作品集并保存');
        } catch (err) {
          msg(errText(err), true);
        }
      });
      msg(`照片已上传${prep.notes.length ? `（${prep.notes.join('，')}）` : ''}`);
    } catch (err) {
      msg(photoErr(err), true);
    }
  });
}

async function renderProjects(): Promise<void> {
  const { items } = await optional(adminFetch<{ items: Project[] }>('/api/admin/projects'), { items: [] });
  mount(listTile('list', 'box', `项目（${items.length}）`, '首页「我的项目」瓷砖里的插件卡片。'));
  listEditor<Project & Record<string, unknown>>({
    id: 'list', items: items as never, blank: { name: '', title: '', version: '', author: 'Winston', engine: '', downloads: 0, url: 'https://', description: '' }, title: (x) => `${x.title}${x.version ? ` v${x.version}` : ''}`, save: (list) => put('/api/admin/projects', { items: list }),
    fields: [{ key: 'title', label: '名称' }, { key: 'name', label: '标识' }, { key: 'version', label: '版本' }, { key: 'url', label: '链接' }, { key: 'author', label: '作者' }, { key: 'engine', label: '依赖版本' }, { key: 'downloads', label: '下载数', type: 'number' }, { key: 'description', label: '介绍', wide: true }],
  });
}

/** 音乐歌单：访客左下角播放器里的「本站歌单」。整首曲目：填 https 音频链接，或上传音频（≤20 MB，只收音频）。 */
async function renderPlaylist(): Promise<void> {
  const { items } = await optional(adminFetch<{ items: PlaylistItem[] }>('/api/admin/content/playlist'), { items: [] });
  const blank: PlaylistItem = { id: '', title: '', artist: '', album: '', src: 'https://', cover: '', duration: 0, license: '', licenseUrl: '', link: '' };
  mount(
    tile('full', `${head('upload', '上传音频', `<label class="btn btn--sm">${icon('upload')}选择音频<input type="file" id="pl-audio" accept="${AUDIO_ACCEPT}" hidden></label>`)}<p class="muted small">MP3 / M4A / OGG / FLAC / WAV / WebM，不超过 ${MAX_AUDIO_BYTES / 1024 / 1024} MB；按文件头检查类型，只收音频。上传后自动加到歌单末尾，补上标题和署名再保存。</p>`) +
      listTile('list', 'music', `音乐歌单（${items.length}）`, '只放你有权公开播放的音乐：自己的作品、CC / 公有领域曲目（写清许可证和出处链接），或获得授权的音频。音频、封面、出处链接都必须是 https://；时长单位是秒（可留 0）。'),
  );
  const list = listEditor<PlaylistItem & Record<string, unknown>>({
    id: 'list',
    items: items as never,
    blank: blank as never,
    title: (x) => `${x.title}${x.artist ? ` · ${x.artist}` : ''}`,
    preview: (x) => (x.cover ? `<img src="${e(rawUrl(x.cover))}" alt="" loading="lazy">` : icon('music')),
    save: (l) => put('/api/admin/content/playlist', { items: l }),
    fields: [
      { key: 'title', label: '标题' },
      { key: 'artist', label: '艺人' },
      { key: 'id', label: 'id（小写字母-数字）' },
      { key: 'duration', label: '时长（秒）', type: 'number' },
      { key: 'src', label: '音频地址（https:// 或上传）', wide: true },
      { key: 'album', label: '专辑' },
      { key: 'cover', label: '封面 URL' },
      { key: 'license', label: '许可证', placeholder: 'CC BY 4.0' },
      { key: 'licenseUrl', label: '许可证链接' },
      { key: 'link', label: '出处链接', wide: true },
    ],
  });
  const input = root.querySelector<HTMLInputElement>('#pl-audio');
  input?.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_AUDIO_BYTES) return msg(`音频不能超过 ${MAX_AUDIO_BYTES / 1024 / 1024} MB`, true);
    msg('上传音频中…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await adminFetch<{ url: string }>('/api/admin/audio', { method: 'POST', body: fd });
      const duration = await audioDuration(file);
      const title = file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim().slice(0, 80) || '新曲目';
      const id = `t-${Date.now().toString(36)}`;
      await list.add({ ...blank, id, title, src: res.url, duration } as never);
      msg('已上传并加入歌单');
    } catch (err) {
      msg(errText(err), true);
    }
  });
}
/** 读取本地音频时长（秒，取整）；读不出返回 0。 */
function audioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const a = document.createElement('audio');
    const u = URL.createObjectURL(file);
    const done = (v: number) => {
      URL.revokeObjectURL(u);
      resolve(Number.isFinite(v) && v > 0 && v <= 36000 ? Math.round(v) : 0);
    };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(a.duration);
    a.onerror = () => done(0);
    setTimeout(() => done(0), 4000);
    a.src = u;
  });
}

async function renderFestivals(): Promise<void> {
  const { festivals } = await optional(adminFetch<{ festivals: Festival[] }>('/api/admin/festivals'), { festivals: [] });
  mount(listTile('list', 'sparkles', `节日（${festivals.length}）`, '日期写 MM-DD 表示每年，写 YYYY-MM-DD 表示只在那一年（农历节日）。节日期间首页出现节日瓷砖和顶部横幅；祝福语里的 emoji 会被换成图标。'));
  listEditor<Festival & Record<string, unknown>>({
    id: 'list', items: festivals as never, blank: { id: '', name: '', date: '', days: 1, theme: 'fireworks', message: '' }, title: (x) => `${x.name} · ${x.date}${x.days > 1 ? ` 起 ${x.days} 天` : ''}`, save: (list) => put('/api/admin/festivals', { festivals: list }),
    preview: (x) => `<span class="adm-fest adm-fest--${e(x.theme)}">${festivalText(x)}</span>`,
    fields: [{ key: 'name', label: '名称' }, { key: 'id', label: 'id（小写字母-数字）' }, { key: 'date', label: '日期', placeholder: '10-01 或 2027-02-06' }, { key: 'days', label: '持续天数', type: 'number' }, { key: 'theme', label: '主题', type: 'select', options: ['lunar', 'xmas', 'halloween', 'fireworks'] }, { key: 'message', label: '祝福语', wide: true }],
  });
}

// ============================================================ 留言 / 便利贴
let gbStatus = 'pending';
async function renderGuestbook(): Promise<void> {
  const { entries } = await adminFetch<{ entries: GuestbookEntry[] }>(`/api/admin/guestbook?status=${gbStatus}`);
  const seg = (v: string, l: string) => `<button type="button" class="adm-seg__b${gbStatus === v ? ' is-on' : ''}" data-gb="${v}">${l}</button>`;
  mount(
    tile(
      'full',
      `${head('message', '留言审核', `<div class="adm-seg" role="group" aria-label="按状态筛选">${seg('pending', '待审核')}${seg('approved', '已通过')}${seg('hidden', '已隐藏')}${seg('all', '全部')}</div>`)}
<div class="adm-gb">${entries
        .map(
          (g) => `<article class="adm-gb__item"><header><b>${e(g.name)}</b>${g.website ? ` <span class="muted small">${e(g.website)}</span>` : ''}<span class="chip chip--${g.status}">${g.status === 'pending' ? '待审核' : g.status === 'approved' ? '已通过' : '已隐藏'}</span><span class="muted small">${e(fmtDate(g.createdAt))}</span></header><p>${e(g.content)}</p>
<div class="adm-row">${g.status !== 'approved' ? `<button class="btn btn--sm" type="button" data-mod="guestbook" data-id="${g.id}" data-action="approve">${icon('check')}通过</button>` : ''}${g.status !== 'hidden' ? `<button class="btn btn--soft btn--sm" type="button" data-mod="guestbook" data-id="${g.id}" data-action="hide">隐藏</button>` : ''}<button class="adm-icon-btn adm-icon-btn--danger" type="button" data-mod="guestbook" data-id="${g.id}" data-action="delete" aria-label="删除">${icon('trash')}</button></div></article>`,
        )
        .join('') || '<p class="empty">这里没有留言</p>'}</div>`,
    ),
  );
}

let cmStatus: CommentStatus | 'all' = 'pending';
async function renderComments(): Promise<void> {
  const { comments, counts } = await optional(adminFetch<{ comments: PostComment[]; counts: Record<CommentStatus, number> }>(`/api/admin/comments?status=${cmStatus}`), { comments: [], counts: { pending: 0, approved: 0, hidden: 0 } });
  const seg = (v: string, l: string) => `<button type="button" class="adm-seg__b${cmStatus === v ? ' is-on' : ''}" data-cm="${v}" aria-pressed="${cmStatus === v}">${l}</button>`;
  const label: Record<CommentStatus, string> = { pending: '待审核', approved: '已通过', hidden: '已隐藏' };
  mount(
    tile(
      'full',
      `${head('message', '评论审核', `<div class="adm-seg" role="group" aria-label="按状态筛选">${seg('pending', `待审核 ${counts.pending}`)}${seg('approved', `已通过 ${counts.approved}`)}${seg('hidden', `已隐藏 ${counts.hidden}`)}${seg('all', '全部')}</div>`)}
<p class="muted small">访客评论默认进入待审核；好朋友（已登录会员）的评论直接公开。删除顶层评论会连同它的回复一起删除。</p>
<div class="adm-gb adm-comments">${comments
        .map(
          (c) => `<article class="adm-gb__item adm-cm" data-id="${c.id}"><header><b>${e(c.name)}</b>${c.member ? '<span class="chip chip--pub">好朋友</span>' : ''}<span class="chip chip--${c.status}">${label[c.status]}</span><a class="muted small" href="${e(SITE_HOME)}posts/${e(c.slug)}/#comments" target="_blank" rel="noopener">${e(c.slug)}</a>${c.parentId ? `<span class="muted small">回复 #${c.parentId}${c.replyTo ? ` @${e(c.replyTo)}` : ''}</span>` : ''}<span class="muted small">${e(fmtDate(c.createdAt))}</span></header><div class="adm-cm__text">${renderCommentHtml(c.content)}</div>
<div class="adm-row">${c.status !== 'approved' ? `<button class="btn btn--sm" type="button" data-mod="comments" data-id="${c.id}" data-action="approve">${icon('check')}通过</button>` : ''}${c.status !== 'hidden' ? `<button class="btn btn--soft btn--sm" type="button" data-mod="comments" data-id="${c.id}" data-action="hide">隐藏</button>` : ''}<button class="adm-icon-btn adm-icon-btn--danger" type="button" data-mod="comments" data-id="${c.id}" data-action="delete" aria-label="删除评论 #${c.id}">${icon('trash')}</button></div></article>`,
        )
        .join('') || '<p class="empty">这里没有评论</p>'}</div>`,
    ),
  );
}

// ============================================================ L16 社区审核（用户投稿 / 投稿评论 / 举报 / 封禁 / 审核日志 / 社区规则）
interface UgcItem { kind: 'work' | 'comment' | 'user'; id: number; author: { id: number; username: string; nickname: string } | null; type: string; title: string; excerpt: string; cover: { url: string; alt: string } | null; workId: number | null; status: string; modState: string; deleted: boolean; reports: { id: number; reason: string; detail: string; createdAt: string }[]; createdAt: string }
interface UgcLog { id: number; actor: string; action: string; targetKind: string; targetId: number; memberId: number | null; reportId: number | null; reason: string; createdAt: string }
const UGC_TYPE: Record<string, string> = { short: '短动态', article: '长文', photo: '摄影作品', album: '影集', comment: '评论', user: '用户' };
const UGC_REASON: Record<string, string> = { spam: '垃圾广告', abuse: '辱骂骚扰', nsfw: '不适宜内容', copyright: '侵犯版权', privacy: '泄露隐私', other: '其他' };
const UGC_ACTION: Record<string, string> = { approve: '通过', hide: '隐藏', restore: '恢复', purge: '彻底删除', ban: '封禁', unban: '解封', dismiss: '驳回举报', auto_pending: '自动进入审核', rules: '修改规则' };
let ugcView: 'pending' | 'reports' | 'hidden' | 'banned' | 'log' | 'webmentions' = 'pending';
// L20 Webmention（站外回应）审核
interface WmItem { id: number; type: string; source: string; url: string; author: { name: string; url: string; photo: string }; content: string; target: string; targetKind: string; targetRef: string; status: string; error: string; sourceHost: string; createdAt: string }
const WM_TYPE: Record<string, string> = { reply: '回复', like: '喜欢', repost: '转发', bookmark: '收藏', mention: '提及' };
const WM_STATUS: Record<string, string> = { queued: '排队验证', pending: '待审核', approved: '已显示', rejected: '已拒绝', spam: '垃圾', invalid: '验证失败' };
let wmStatus = 'pending';
// L31 Webhook
interface WebhookItem { id: number; url: string; events: string[]; active: boolean; description: string; secretHint: string; createdAt: string }
const HOOK_STATUS: Record<string, string> = { demo: '演示（未发送）', ok: '成功', failed: '失败', retrying: '等待重试', pending: '排队中' };
async function renderUgc(): Promise<void> {
  const q = await optional(
    adminFetch<{ items: UgcItem[]; counts: Record<string, number>; rules: { reviewFirstN: number; maxLinks: number } }>(`/api/admin/ugc/queue?view=${ugcView === 'log' || ugcView === 'webmentions' ? 'pending' : ugcView}`),
    { items: [], counts: { pending: 0, reports: 0, hidden: 0, banned: 0 }, rules: { reviewFirstN: 2, maxLinks: 3 } },
  );
  const log = ugcView === 'log' ? (await optional(adminFetch<{ actions: UgcLog[] }>('/api/admin/ugc/log?limit=50'), { actions: [] })).actions : [];
  const wm = ugcView === 'webmentions' ? await optional(adminFetch<{ items: WmItem[]; counts: Record<string, number> }>(`/api/admin/webmentions?status=${wmStatus}`), { items: [], counts: {} }) : { items: [], counts: {} as Record<string, number> };
  const ai = await optional(adminFetch<{ enabled: boolean; provider: string; budget?: { month: string; used: number; budget: number; left: number } }>('/api/admin/ai'), { enabled: false, provider: 'local' });
  const hooks = (await optional(adminFetch<{ items: WebhookItem[] }>('/api/admin/webhooks'), { items: [] })).items;
  const seg = (v: typeof ugcView, l: string) => `<button type="button" class="adm-seg__b${ugcView === v ? ' is-on' : ''}" data-ugcv="${v}" aria-pressed="${ugcView === v}">${l}</button>`;
  const btn = (it: UgcItem, action: string, label: string, cls = 'btn--soft', report?: number) =>
    `<button class="btn ${cls} btn--sm" type="button" data-ugc="${action}" data-kind="${it.kind}" data-id="${it.kind === 'user' ? it.author?.id ?? it.id : it.id}"${report ? ` data-report="${report}"` : ''}>${label}</button>`;
  const link = (it: UgcItem) => (it.workId ? `<a class="muted small" href="${e(SITE_HOME)}w/${it.workId}/" target="_blank" rel="noopener">查看作品 #${it.workId}</a>` : '');
  const item = (it: UgcItem) => `<article class="adm-gb__item adm-ugc" data-kind="${it.kind}" data-id="${it.id}">
<header><b>${e(it.author?.nickname ?? '已注销')}</b>${it.author ? `<span class="muted small">@${e(it.author.username)}</span>` : ''}<span class="chip">${e(UGC_TYPE[it.type] ?? it.type)}</span>${it.status === 'pending' ? '<span class="chip chip--pending">待审核</span>' : ''}${it.modState === 'hidden' ? '<span class="chip chip--hidden">已隐藏</span>' : ''}${it.deleted ? '<span class="chip">作者已删除</span>' : ''}${it.status === 'banned' ? '<span class="chip chip--alert">已封禁</span>' : ''}<span class="muted small">${e(fmtDate(it.createdAt))}</span>${link(it)}</header>
${it.cover ? `<img class="adm-ugc__img" src="${e(rawUrl(it.cover.url))}" alt="${e(it.cover.alt)}" loading="lazy">` : ''}${it.title ? `<p><b>${e(it.title)}</b></p>` : ''}<p>${e(it.excerpt)}</p>
${it.reports.length ? `<ul class="adm-ugc__reports" aria-label="举报">${it.reports.map((r) => `<li><span class="chip chip--alert">${e(UGC_REASON[r.reason] ?? r.reason)}</span>${r.detail ? ` ${e(r.detail)}` : ''} <span class="muted small">${e(fmtDate(r.createdAt))}</span></li>`).join('')}</ul>` : ''}
<div class="adm-row">${
    it.kind === 'user'
      ? it.status === 'banned'
        ? btn(it, 'unban', '解封', 'btn--sm')
        : `${btn(it, 'ban', '封禁', 'btn--danger')}${it.reports.length ? btn(it, 'dismiss', '驳回举报') : ''}`
      : `${it.status === 'pending' ? btn(it, 'approve', `${icon('check')}通过`, '') : ''}${it.modState === 'hidden' ? btn(it, 'restore', '恢复') : btn(it, 'hide', '隐藏', 'btn--soft', it.reports[0]?.id)}${it.reports.length ? btn(it, 'dismiss', '驳回举报', 'btn--ghost', it.reports[0]?.id) : ''}${it.author ? `<button class="btn btn--ghost btn--sm" type="button" data-ugc="ban" data-kind="user" data-id="${it.author.id}">封禁作者</button>` : ''}<button class="adm-icon-btn adm-icon-btn--danger" type="button" data-ugc="purge" data-kind="${it.kind}" data-id="${it.id}" aria-label="彻底删除 ${UGC_TYPE[it.type] ?? ''} #${it.id}">${icon('trash')}</button>`
  }</div></article>`;
  mount(
    tile(
      'full',
      `${head('flag', '社区审核', `<div class="adm-seg" role="group" aria-label="审核队列">${seg('pending', `待审核 ${q.counts.pending ?? 0}`)}${seg('reports', `举报 ${q.counts.reports ?? 0}`)}${seg('hidden', `已隐藏 ${q.counts.hidden ?? 0}`)}${seg('banned', `已封禁 ${q.counts.banned ?? 0}`)}${seg('webmentions', `Webmention ${q.counts.webmentions ?? 0}`)}${seg('log', '审核日志')}</div>`)}
<p class="muted small">用户投稿和投稿下的评论不沿用「好朋友评论直接公开」：新成员的前 ${q.rules.reviewFirstN} 条内容先进这里审核。「隐藏」可恢复；「彻底删除」不可撤销；作者自己删除的内容只做软删除。每个操作都会写入审核日志。</p>
${
  ugcView === 'webmentions'
    ? `<p class="muted small">站外网站通过 Webmention 回应你的文章 / 作品：先异步验证对方页面确实链接到这里，再进这里等你审核；通过过的来源站点以后直接显示。</p><div class="adm-seg" role="group" aria-label="Webmention 状态">${['pending', 'approved', 'queued', 'invalid', 'rejected', 'spam', 'all'].map((s) => `<button type="button" class="adm-seg__b${wmStatus === s ? ' is-on' : ''}" data-wms="${s}" aria-pressed="${wmStatus === s}">${s === 'all' ? '全部' : WM_STATUS[s]} ${s === 'all' ? '' : (wm.counts[s] ?? 0)}</button>`).join('')}</div>
<div class="adm-gb adm-wm-list">${wm.items.map((m) => `<article class="adm-gb__item adm-wm" data-id="${m.id}"><header><b>${e(m.author.name)}</b><span class="chip">${e(WM_TYPE[m.type] ?? m.type)}</span><span class="chip chip--${m.status === 'approved' ? 'pub' : m.status}">${e(WM_STATUS[m.status] ?? m.status)}</span><span class="muted small">${e(fmtDate(m.createdAt))}</span></header>
<p class="small">来自 <a href="${e(m.source)}" target="_blank" rel="noopener nofollow ugc">${e(m.sourceHost)}</a> → <a href="${e(m.target)}" target="_blank" rel="noopener">${e(m.targetKind)} ${e(m.targetRef)}</a>${m.error ? ` · <span class="muted">${e(m.error)}</span>` : ''}</p>${m.content ? `<p>${e(m.content)}</p>` : ''}
<div class="adm-row">${m.status !== 'approved' && m.status !== 'queued' && m.status !== 'invalid' ? `<button class="btn btn--sm" type="button" data-wm="approve" data-id="${m.id}">${icon('check')}通过</button>` : ''}${m.status !== 'rejected' ? `<button class="btn btn--soft btn--sm" type="button" data-wm="reject" data-id="${m.id}">拒绝</button>` : ''}${m.status !== 'spam' ? `<button class="btn btn--ghost btn--sm" type="button" data-wm="spam" data-id="${m.id}">标记垃圾</button>` : ''}<button class="adm-icon-btn adm-icon-btn--danger" type="button" data-wm="delete" data-id="${m.id}" aria-label="删除 Webmention #${m.id}">${icon('trash')}</button></div></article>`).join('') || '<p class="empty">这里是空的 🎉</p>'}</div><p><button class="btn btn--soft btn--sm" type="button" data-wm="process">立即验证排队中的 Webmention</button></p>`
    : ugcView === 'log'
    ? `<div class="adm-table-wrap"><table class="adm-table"><caption class="visually-hidden">审核日志</caption><thead><tr><th scope="col">时间</th><th scope="col">操作者</th><th scope="col">操作</th><th scope="col">对象</th><th scope="col">原因</th></tr></thead><tbody>${log.map((a) => `<tr><td>${e(fmtDate(a.createdAt))}</td><td>${e(a.actor === 'system' ? '系统' : a.actor === 'token' ? 'API 令牌' : '站长')}</td><td>${e(UGC_ACTION[a.action] ?? a.action)}</td><td>${e(UGC_TYPE[a.targetKind] ?? a.targetKind)} #${a.targetId}${a.reportId ? `（举报 #${a.reportId}）` : ''}</td><td>${e(a.reason)}</td></tr>`).join('') || '<tr><td colspan="5">还没有记录</td></tr>'}</tbody></table></div>`
    : `<div class="adm-gb adm-ugc-list">${q.items.map(item).join('') || '<p class="empty">这里是空的 🎉</p>'}</div>`
}`,
    ) +
      tile(
        'full',
        `${head('link', '开放网络')}<div class="adm-open">
<form class="adm-form" data-form="wm-send"><p class="muted small">发送 Webmention：找出一篇已发布文章 / 公开作品正文里的外链，逐个发现对方的 Webmention 端点并通知它们（只由站长手动触发）。</p><div class="adm-grid2"><label class="field"><span>内容类型</span><select name="kind"><option value="post">文章（slug）</option><option value="work">作品（id）</option></select></label><label class="field"><span>slug 或 id</span><input name="ref" required maxlength="80"></label></div><p><button class="btn btn--sm" type="submit">${icon('send')}发送 Webmention</button></p><ul class="adm-wm-sent js-wm-sent plain-list small" aria-live="polite"></ul></form>
<form class="adm-form" data-form="ai-flag"><label class="adm-switch"><input type="checkbox" name="enabled"${ai.enabled ? ' checked' : ''}> AI 创作台（实验）：会员在发布器里可以请求标题 / 摘要 / 替代文字 / 标签 / 校对 / 提纲建议</label><div class="adm-grid2"><label class="field"><span>每月建议次数上限（全站，上海时间分月）</span><input name="monthlyBudget" type="number" min="0" max="100000" step="1" value="${ai.budget?.budget ?? 200}" required></label><p class="muted small adm-ai-usage" aria-live="polite">${ai.budget ? `${e(ai.budget.month)} 已用 ${ai.budget.used} / ${ai.budget.budget} 次，剩余 ${ai.budget.left} 次` : ''}</p></div><p class="muted small">默认关闭。建议只在作者点击「采用」后才会填入（校对逐条勾选），发布前需要作者再次确认，作品会标注「含 AI 辅助内容」。额度用完后本月不再生成建议。AI 不会生成评论、点赞等互动。提供方：${e(ai.provider === 'local' ? '本地确定性回退（不调用任何外部服务）' : ai.provider)}。</p><p><button class="btn btn--sm" type="submit">保存</button></p></form>
<form class="adm-form" data-form="role"><p class="muted small">站点角色决定会员最多能创建哪一级 MCP 令牌：审核员可以用「社区审核」令牌处理审核队列。撤销角色后旧令牌自动降级。</p><div class="adm-grid2"><label class="field"><span>会员 id</span><input name="id" type="number" min="1" required></label><label class="field"><span>角色</span><select name="role"><option value="moderator">审核员</option><option value="admin">站长</option><option value="member">普通好朋友（撤销）</option></select></label></div><p><button class="btn btn--sm" type="submit">保存角色</button></p></form>
</div>`,
      ) +
      tile(
        'full',
        `${head('send', 'Webhook')}<div class="adm-hooks">
<p class="muted small">有新文章 / 作品 / 评论时，用带签名的 POST 通知你的服务（签名头 <code>X-TheBLOG-Signature: t=…,v1=HMAC-SHA256</code>，接收方请校验并拒绝超过 5 分钟的请求）。只允许 https 公网地址；失败会按 30 秒、2 分钟、8 分钟、32 分钟退避重试。${DEMO ? '<b>演示站不会真正发送</b>，「测试投递」只生成带签名的请求体。' : ''}</p>
<form class="adm-form" data-form="hook-new"><div class="adm-grid2"><label class="field"><span>接收地址（https）</span><input name="url" type="url" required maxlength="500" placeholder="https://hooks.example.com/blog" inputmode="url"></label><label class="field"><span>备注</span><input name="description" maxlength="100"></label></div><fieldset class="adm-hook-events"><legend class="small">事件</legend>${WEBHOOK_EVENTS.map((ev) => `<label class="adm-check"><input type="checkbox" name="events" value="${ev}"${ev === 'post.published' ? ' checked' : ''}> ${e(WEBHOOK_EVENT_LABEL[ev])}</label>`).join('')}</fieldset><p><button class="btn btn--sm" type="submit">${icon('plus')}添加 Webhook</button></p><p class="adm-hook-secret js-hook-secret" role="status" aria-live="polite" hidden></p></form>
<div class="adm-gb adm-hook-list">${hooks.map((w) => `<article class="adm-gb__item adm-hook" data-id="${w.id}"><header><b class="adm-hook__url">${e(w.url)}</b><span class="chip">${w.active ? '启用' : '已停用'}</span><span class="muted small">${e(w.secretHint)}</span></header>${w.description ? `<p class="small">${e(w.description)}</p>` : ''}<p class="small">${w.events.map((ev) => `<span class="chip">${e((WEBHOOK_EVENT_LABEL as Record<string, string>)[ev] ?? ev)}</span>`).join(' ')}</p>
<div class="adm-row"><button class="btn btn--soft btn--sm" type="button" data-hook="test" data-id="${w.id}">测试投递</button><button class="btn btn--ghost btn--sm" type="button" data-hook="${w.active ? 'pause' : 'resume'}" data-id="${w.id}">${w.active ? '停用' : '启用'}</button><button class="btn btn--ghost btn--sm" type="button" data-hook="log" data-id="${w.id}" aria-expanded="false" aria-controls="hook-log-${w.id}">投递记录</button><button class="adm-icon-btn adm-icon-btn--danger" type="button" data-hook="delete" data-id="${w.id}" aria-label="删除 Webhook ${e(w.url)}">${icon('trash')}</button></div><div class="adm-hook__log small" id="hook-log-${w.id}" hidden></div></article>`).join('') || '<p class="empty">还没有 Webhook</p>'}</div>
</div>`,
      ) +
      tile(
        'full',
        `${head('settings', '社区规则')}<form class="adm-form adm-ugc-rules" data-form="ugc-rules"><div class="adm-grid2"><label class="field"><span>新成员前几条内容先审核</span><input name="reviewFirstN" type="number" min="0" max="50" value="${q.rules.reviewFirstN}" required></label><label class="field"><span>每条内容最多几个链接</span><input name="maxLinks" type="number" min="0" max="20" value="${q.rules.maxLinks}" required></label></div><p><button class="btn btn--sm" type="submit">保存规则</button></p></form>`,
      ),
  );
  root.querySelector<HTMLFormElement>('[data-form="wm-send"]')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget as HTMLFormElement;
    const kind = (f.elements.namedItem('kind') as HTMLSelectElement).value;
    const ref = (f.elements.namedItem('ref') as HTMLInputElement).value.trim();
    try {
      const r = await put<{ links: number; results: { target: string; status: string; detail: string }[] }>('/api/admin/webmentions/send', { kind, ref }, 'POST');
      const label: Record<string, string> = { sent: '已发送', no_endpoint: '对方不支持', failed: '失败', skipped: '跳过' };
      f.querySelector('.js-wm-sent')!.innerHTML = r.results.map((x) => `<li><span class="chip">${e(label[x.status] ?? x.status)}</span> ${e(x.target)}${x.detail ? ` <span class="muted">${e(x.detail)}</span>` : ''}</li>`).join('') || '<li class="muted">正文里没有外链</li>';
      msg(`处理了 ${r.links} 个外链`);
    } catch (err) {
      msg(errText(err), true);
    }
  });
  root.querySelector<HTMLFormElement>('[data-form="ai-flag"]')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget as HTMLFormElement;
    const on = (f.elements.namedItem('enabled') as HTMLInputElement).checked;
    const budget = Number((f.elements.namedItem('monthlyBudget') as HTMLInputElement | null)?.value ?? 200);
    try {
      const r = await put<{ budget?: { month: string; used: number; budget: number; left: number } }>('/api/admin/ai', { enabled: on, monthlyBudget: budget });
      const u = f.querySelector('.adm-ai-usage');
      if (u && r.budget) u.textContent = `${r.budget.month} 已用 ${r.budget.used} / ${r.budget.budget} 次，剩余 ${r.budget.left} 次`;
      msg(on ? 'AI 创作台已开启' : 'AI 创作台已关闭');
    } catch (err) {
      msg(errText(err), true);
    }
  });
  root.querySelector<HTMLFormElement>('[data-form="hook-new"]')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget as HTMLFormElement;
    const events = [...f.querySelectorAll<HTMLInputElement>('input[name="events"]:checked')].map((c) => c.value);
    try {
      const r = await put<{ secret: string }>('/api/admin/webhooks', { url: (f.elements.namedItem('url') as HTMLInputElement).value.trim(), description: (f.elements.namedItem('description') as HTMLInputElement).value, events }, 'POST');
      await renderUgc();
      const out = root.querySelector<HTMLElement>('.js-hook-secret');
      if (out) {
        out.hidden = false;
        out.innerHTML = `签名密钥（只显示这一次，请马上保存）：<code class="adm-hook__secret" tabindex="0">${e(r.secret)}</code>`;
        out.querySelector<HTMLElement>('code')?.focus();
      }
      msg('Webhook 已添加');
    } catch (err) {
      msg(errText(err), true);
    }
  });
  root.querySelector('.adm-hook-list')?.addEventListener('click', async (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('[data-hook]');
    if (!b) return;
    const id = Number(b.dataset.id);
    const act = b.dataset.hook;
    try {
      if (act === 'test') {
        const r = await put<{ delivery: { status: string; httpStatus: number | null } }>(`/api/admin/webhooks/${id}/test`, {}, 'POST');
        msg(r.delivery.status === 'demo' ? '已生成测试投递（演示站不真正发送）' : r.delivery.status === 'ok' ? `测试投递成功（HTTP ${r.delivery.httpStatus}）` : `测试投递失败：${r.delivery.status}`);
        return;
      }
      if (act === 'log') {
        const box = root.querySelector<HTMLElement>(`#hook-log-${id}`)!;
        const open = b.getAttribute('aria-expanded') === 'true';
        b.setAttribute('aria-expanded', String(!open));
        box.hidden = open;
        if (!open) {
          const r = await adminFetch<{ items: { id: number; event: string; status: string; httpStatus: number | null; attempts: number; createdAt: string }[] }>(`/api/admin/webhooks/${id}/deliveries`);
          box.innerHTML = r.items.length ? `<ul class="plain-list">${r.items.map((d) => `<li><span class="chip">${e(d.event)}</span> ${e(HOOK_STATUS[d.status] ?? d.status)}${d.httpStatus ? ` · HTTP ${d.httpStatus}` : ''} · ${e(fmtDate(d.createdAt))}</li>`).join('')}</ul>` : '<p class="muted">还没有投递记录</p>';
        }
        return;
      }
      if (act === 'delete') {
        if (!confirm('删除这个 Webhook 和它的投递记录？')) return;
        await put(`/api/admin/webhooks/${id}`, {}, 'DELETE');
      } else await put(`/api/admin/webhooks/${id}`, { active: act === 'resume' });
      await renderUgc();
      msg(act === 'delete' ? 'Webhook 已删除' : act === 'resume' ? 'Webhook 已启用' : 'Webhook 已停用');
    } catch (err) {
      msg(errText(err), true);
    }
  });
  root.querySelector<HTMLFormElement>('[data-form="role"]')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget as HTMLFormElement;
    try {
      await put(`/api/admin/members/${Number((f.elements.namedItem('id') as HTMLInputElement).value)}/role`, { role: (f.elements.namedItem('role') as HTMLSelectElement).value });
      msg('角色已保存');
    } catch (err) {
      msg(errText(err), true);
    }
  });
  root.querySelector<HTMLFormElement>('[data-form="ugc-rules"]')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget as HTMLFormElement;
    const num = (n: string) => Number((f.elements.namedItem(n) as HTMLInputElement).value);
    try {
      await put('/api/admin/ugc/rules', { reviewFirstN: num('reviewFirstN'), maxLinks: num('maxLinks') });
      msg('规则已保存');
    } catch (err) {
      msg(errText(err), true);
    }
  });
}

// ============================================================ L21 运行状态（健康检查 / 定时任务 / 绑定 / 错误事件）
interface OpsErr { id: number; source: string; level: string; kind: string; message: string; stack: string; route: string; release: string; status: number; count: number; first_seen: string; last_seen: string; forwarded: number }
interface OpsStatus {
  overall: string; version: string; commit: string; environment: string; demo?: boolean;
  components: { key: string; label: string; state: string; ms?: number }[];
  migration: { latest: string | null; count: number; expected: string; ok: boolean };
  uptime: Record<string, { ratio: number | null; checks: number; failed: number }>;
  bindings: Record<string, boolean>; sampling: { worker: number; client: number };
  limits: { errorRing: number; healthRetentionDays: number; clientPerMinute: number; clientPerDay: number };
  recentChecks: { id: number; at: string; ok: number; d1_ok: number; r2_ok: number | null; do_ok: number | null; d1_ms: number; total_ms: number; source: string; detail: string }[];
  runs: { job: string; last_run: string; last_ok: number; last_ms: number; runs: number; failures: number; detail: string }[];
  errors: { last24h: { source: string; groups: number; events: number }[]; stored: number };
}
let opsSource = '';
let opsBefore: number[] = [];
const OPS_STATE: Record<string, string> = { ok: '正常', degraded: '部分异常', down: '故障', unconfigured: '未配置', unknown: '暂无数据' };
const pct = (u: { ratio: number | null }) => (u.ratio === null ? '—' : `${(u.ratio * 100).toFixed(u.ratio === 1 ? 0 : 2)}%`);
const yes = (b: boolean | number | null) => (b === null ? '—' : b ? '✓' : '✗');
async function renderOpsAdmin(): Promise<void> {
  const before = opsBefore.at(-1);
  const qs = new URLSearchParams({ limit: '20', ...(opsSource ? { source: opsSource } : {}), ...(before ? { before: String(before) } : {}) });
  const [s, er] = await Promise.all([adminFetch<OpsStatus>('/api/admin/ops/status'), adminFetch<{ errors: OpsErr[]; nextBefore: number | null }>(`/api/admin/ops/errors?${qs}`)]);
  const seg = (v: string, label: string) => `<button type="button" class="adm-seg__b${opsSource === v ? ' is-on' : ''}" data-ops="filter" data-src="${v}" aria-pressed="${opsSource === v}">${label}</button>`;
  const e24 = (src: string) => s.errors.last24h.find((x) => x.source === src);
  mount(
    tile('full', `${head('chart', `整体：${OPS_STATE[s.overall] ?? s.overall}`, `<button class="btn btn--sm" type="button" data-ops="check">${icon('refresh')}立即健康检查</button>`)}
<p class="muted small">版本 <b>${e(s.version)}</b> · commit <code>${e(s.commit)}</code> · 环境 ${e(s.environment)} · D1 迁移 <code>${e(s.migration.latest ?? '未知')}</code>（共 ${s.migration.count} 个，代码需要 ${e(s.migration.expected)}）${s.migration.ok ? '' : ' · <b>迁移落后，请执行 wrangler d1 migrations apply</b>'}${s.demo ? ' · 演示站：健康历史是虚构数据' : ''}</p>
<div class="adm-table-wrap"><table class="adm-table"><caption class="visually-hidden">服务组件</caption><thead><tr><th scope="col">组件</th><th scope="col">状态</th><th scope="col">耗时</th></tr></thead><tbody>${s.components.map((c) => `<tr><td>${e(c.label)}</td><td>${e(OPS_STATE[c.state] ?? c.state)}</td><td>${c.ms !== undefined ? `${c.ms} ms` : '—'}</td></tr>`).join('')}</tbody></table></div>
<p class="small">可用率：24 小时 <b>${pct(s.uptime['24h']!)}</b> · 7 天 <b>${pct(s.uptime['7d']!)}</b> · 30 天 <b>${pct(s.uptime['30d']!)}</b>（${s.uptime['30d']!.checks} 次检查，保留 ${s.limits.healthRetentionDays} 天）· <a href="${e(`${location.origin}${url('/status/')}`)}" target="_blank" rel="noopener">公开状态页</a></p>`) +
      tile('half', `${head('settings', '绑定与配置')}<div class="adm-table-wrap"><table class="adm-table"><caption class="visually-hidden">绑定与配置</caption><tbody>${Object.entries(s.bindings).map(([k, v]) => `<tr><th scope="row"><code>${e(k)}</code></th><td>${v ? '已配置' : '未配置'}</td></tr>`).join('')}<tr><th scope="row">采样率</th><td>Worker ${s.sampling.worker} · 前端 ${s.sampling.client}（新错误总是记录）</td></tr><tr><th scope="row">前端上报限流</th><td>每 IP 每分钟 ${s.limits.clientPerMinute} 条 / 每天 ${s.limits.clientPerDay} 条</td></tr></tbody></table></div>`) +
      tile('half', `${head('clock', '定时任务')}<div class="adm-table-wrap"><table class="adm-table"><caption class="visually-hidden">定时任务</caption><thead><tr><th scope="col">任务</th><th scope="col">最近运行</th><th scope="col">结果</th><th scope="col">次数 / 失败</th></tr></thead><tbody>${s.runs.map((r) => `<tr><td><code>${e(r.job)}</code></td><td class="small">${e(fmtDate(r.last_run))}</td><td>${r.last_ok ? '成功' : `失败${r.detail ? `：${e(r.detail)}` : ''}`}</td><td>${r.runs} / ${r.failures}</td></tr>`).join('') || '<tr><td colspan="4">还没有运行过（Cron 每 15 分钟触发一次）</td></tr>'}</tbody></table></div>`) +
      tile('full', `${head('history', `最近的健康检查（${s.recentChecks.length}）`)}<div class="adm-table-wrap"><table class="adm-table"><caption class="visually-hidden">最近的健康检查</caption><thead><tr><th scope="col">时间</th><th scope="col">结果</th><th scope="col">D1</th><th scope="col">R2</th><th scope="col">DO</th><th scope="col">耗时</th><th scope="col">来源</th></tr></thead><tbody>${s.recentChecks.slice(0, 12).map((c) => `<tr><td class="small">${e(fmtDate(c.at))}</td><td>${c.ok ? '通过' : `失败${c.detail ? `：${e(c.detail)}` : ''}`}</td><td>${yes(c.d1_ok)} ${c.d1_ms} ms</td><td>${yes(c.r2_ok)}</td><td>${yes(c.do_ok)}</td><td>${c.total_ms} ms</td><td>${c.source === 'manual' ? '手动' : '定时'}</td></tr>`).join('') || '<tr><td colspan="7">还没有记录</td></tr>'}</tbody></table></div>`) +
      tile('full', `${head('flag', `错误事件（保存 ${s.errors.stored} 组，最多 ${s.limits.errorRing}）`, `<div class="adm-seg" role="group" aria-label="错误来源">${seg('', '全部')}${seg('worker', `Worker${e24('worker') ? ` · 24h ${e24('worker')!.events}` : ''}`)}${seg('client', `前端${e24('client') ? ` · 24h ${e24('client')!.events}` : ''}`)}</div>`)}
<p class="muted small">已清洗：邮箱、IP、令牌、密钥类参数、长哈希、电话号码会被替换。同一错误 1 小时内只累加次数。配置 <code>SENTRY_DSN</code> 后会同时转发到 Sentry 兼容服务。</p>
${er.errors.length ? `<ul class="adm-ops-errs">${er.errors.map((x) => `<li class="adm-ops-err"><div class="adm-row"><b>${e(x.kind)}</b><span class="muted small">${x.source === 'client' ? '前端' : 'Worker'}${x.status ? ` · ${x.status}` : ''} · ×${x.count} · 最近 ${e(fmtDate(x.last_seen))}${x.release ? ` · ${e(x.release)}` : ''}${x.forwarded ? ' · 已转发' : ''}</span><button class="btn btn--soft btn--sm" type="button" data-ops="delete" data-id="${x.id}" aria-label="删除错误 ${x.id}">${icon('trash')}删除</button></div><p class="adm-ops-err__msg">${e(x.message)}</p>${x.route ? `<p class="muted small"><code>${e(x.route)}</code></p>` : ''}${x.stack ? `<details><summary>调用栈</summary><pre class="adm-ops-err__stack">${e(x.stack)}</pre></details>` : ''}</li>`).join('')}</ul>` : `<p class="muted">${opsBefore.length ? '没有更早的错误了。' : '没有错误记录。'}</p>`}
<div class="adm-row">${opsBefore.length ? '<button class="btn btn--soft btn--sm" type="button" data-ops="first">回到最新</button>' : ''}${er.nextBefore ? `<button class="btn btn--soft btn--sm" type="button" data-ops="more" data-before="${er.nextBefore}">更早的错误</button>` : ''}${s.errors.stored ? '<button class="btn btn--sm btn--danger" type="button" data-ops="clear">清空全部</button>' : ''}</div>`),
  );
}

// ============================================================ L17 发现与活动（话题 / 精选创作者 / 认证 / 摄影活动）
interface DTopic { slug: string; name: string; intro: string; sort: number; tags: string[]; counts: { works: number; subscribers: number } }
interface DEvent { slug: string; kind: 'daily' | 'weekly' | 'open'; title: string; phase: string; startsAt: string; endsAt: string; voting: boolean; voteEndsAt: string | null; resultsAt: string | null; counts: { entries: number; participants: number } }
interface DCreator { username: string; nickname: string; note?: string; label?: string }
const D_KIND: Record<string, string> = { daily: '每日一图', weekly: '每周主题', open: '作品征集' };
const D_PHASE: Record<string, string> = { upcoming: '即将开始', open: '投稿中', voting: '投票中', ended: '已结束' };
async function renderDiscoveryAdmin(): Promise<void> {
  const [tp, cr, ev] = await Promise.all([
    optional(adminFetch<{ topics: DTopic[] }>('/api/admin/discovery/topics'), { topics: [] }),
    optional(adminFetch<{ featured: DCreator[]; verified: DCreator[] }>('/api/admin/discovery/creators'), { featured: [], verified: [] }),
    optional(adminFetch<{ events: DEvent[] }>('/api/admin/discovery/events'), { events: [] }),
  ]);
  const local = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  };
  const now = Date.now();
  mount(
    tile(
      'full',
      `${head('camera', `摄影活动（${ev.events.length}）`)}<p class="muted small">活动期内会员投稿自己的公开摄影作品；你来挑选精选。开启投票时每人一票、不能投自己、注册天数门槛和频率限制都在服务端执行。活动结束后「公布结果」会给参与者发通知并授予精选徽章（徽章不按票数发放）。</p>
<div class="adm-table-wrap"><table class="adm-table"><caption class="visually-hidden">摄影活动</caption><thead><tr><th scope="col">活动</th><th scope="col">类型</th><th scope="col">状态</th><th scope="col">时间</th><th scope="col">投稿</th><th scope="col">操作</th></tr></thead><tbody>${
        ev.events
          .map(
            (x) => `<tr><td><a href="${e(`${location.origin}${url(`/events/${x.slug}/`)}`)}" target="_blank" rel="noopener">${e(x.title)}</a><br><span class="muted small">${e(x.slug)}</span></td><td>${D_KIND[x.kind]}${x.voting ? ' · 投票' : ''}</td><td>${D_PHASE[x.phase] ?? x.phase}${x.resultsAt ? ' · 已公布' : ''}</td><td class="small">${e(fmtDate(x.startsAt))} → ${e(fmtDate(x.endsAt))}</td><td>${x.counts.entries} / ${x.counts.participants} 人</td><td><div class="adm-row"><button class="btn btn--soft btn--sm" type="button" data-disc="entries" data-slug="${e(x.slug)}" aria-expanded="false">投稿与精选</button>${x.phase === 'ended' ? `<button class="btn btn--sm" type="button" data-disc="results" data-slug="${e(x.slug)}">${x.resultsAt ? '重新发送结果' : '公布结果'}</button>` : ''}</div></td></tr><tr class="js-disc-entries" data-for="${e(x.slug)}" hidden><td colspan="6"></td></tr>`,
          )
          .join('') || '<tr><td colspan="6">还没有活动</td></tr>'
      }</tbody></table></div>
<details class="adm-details"><summary>活动聊天室（L19）</summary><form class="adm-form" data-form="disc-room"><p class="muted small">给活动开一个实时聊天室（登录会员在活动页里聊天）。临时聊天室只显示最近几小时的消息；关闭后只能看不能发；取消勾选「开启」会删除聊天室和全部消息。你是所有聊天室的管理员，可以移除任何消息。</p><div class="adm-grid2">
<label class="field"><span>活动</span><select name="slug" required>${ev.events.map((x) => `<option value="${e(x.slug)}">${e(x.title)}</option>`).join('')}</select></label>
<label class="field"><span>消息保留</span><select name="retention"><option value="ephemeral" selected>临时（按小时过期）</option><option value="retained">保留</option></select></label>
<label class="field"><span>临时消息保留小时数（1–336）</span><input name="ttlHours" type="number" min="1" max="336" value="24"></label>
<label class="field adm-check"><input name="enabled" type="checkbox" checked><span>开启聊天室</span></label>
<label class="field adm-check"><input name="closed" type="checkbox"><span>只读（暂停发言）</span></label>
</div><p><button class="btn btn--sm" type="submit"${ev.events.length ? '' : ' disabled'}>保存聊天室设置</button></p></form></details>
<details class="adm-details"><summary>新建活动</summary><form class="adm-form" data-form="disc-event"><div class="adm-grid2">
<label class="field"><span>slug（网址）</span><input name="slug" required pattern="[a-z0-9][a-z0-9-]*[a-z0-9]" maxlength="40" placeholder="weekly-rain"></label>
<label class="field"><span>类型</span><select name="kind"><option value="daily">每日一图（≤ 2 天）</option><option value="weekly" selected>每周主题（≤ 14 天）</option><option value="open">作品征集（≤ 120 天）</option></select></label>
<label class="field"><span>标题</span><input name="title" required maxlength="60"></label>
<label class="field"><span>话题</span><select name="topic"><option value="">（无）</option>${tp.topics.map((t) => `<option value="${e(t.slug)}">${e(t.name)}</option>`).join('')}</select></label>
<label class="field"><span>开始</span><input name="startsAt" type="datetime-local" required value="${local(new Date(now).toISOString())}"></label>
<label class="field"><span>投稿截止</span><input name="endsAt" type="datetime-local" required value="${local(new Date(now + 7 * 86_400_000).toISOString())}"></label>
<label class="field"><span>每人最多投稿</span><input name="maxEntries" type="number" min="1" max="10" value="3"></label>
<label class="field"><span>投票资格：注册满几天</span><input name="minAccountDays" type="number" min="0" max="365" value="7"></label>
<label class="field adm-check"><input name="voting" type="checkbox"><span>开启投票（每人一票）</span></label>
<label class="field"><span>投票截止（可选，不早于投稿截止）</span><input name="voteEndsAt" type="datetime-local"></label>
<label class="field adm-check"><input name="hideTallies" type="checkbox" checked><span>结束前隐藏票数</span></label>
</div><label class="field"><span>简介</span><textarea name="intro" rows="2" maxlength="500"></textarea></label><label class="field"><span>规则</span><textarea name="rules" rows="3" maxlength="2000"></textarea></label><p><button class="btn btn--sm" type="submit">创建活动</button></p></form></details>`,
    ) +
      tile(
        'half',
        `${head('star', '精选创作者 / 创作者认证')}<p class="muted small">精选出现在发现页（只显示资料公开且允许被发现的人）。认证与 DIY 徽章分开管理，用于核实过身份的创作者。</p>
<ul class="adm-list">${cr.featured.map((c) => `<li><b>${e(c.nickname)}</b> <span class="muted small">@${e(c.username)}${c.note ? ` · ${e(c.note)}` : ''}</span> <button class="adm-icon-btn adm-icon-btn--danger" type="button" data-disc="unfeature" data-u="${e(c.username)}" aria-label="取消精选 @${e(c.username)}">${icon('trash')}</button></li>`).join('') || '<li class="muted">还没有精选创作者</li>'}</ul>
<form class="adm-form" data-form="disc-feature"><div class="adm-grid2"><label class="field"><span>用户名</span><input name="username" required maxlength="20"></label><label class="field"><span>推荐语</span><input name="note" maxlength="80"></label></div><p><button class="btn btn--sm" type="submit">加入精选</button></p></form>
<h3 class="small">已认证</h3><ul class="adm-list">${cr.verified.map((c) => `<li><b>${e(c.nickname)}</b> <span class="muted small">@${e(c.username)} · ${e(c.label ?? '')}</span> <button class="adm-icon-btn adm-icon-btn--danger" type="button" data-disc="unverify" data-u="${e(c.username)}" aria-label="取消认证 @${e(c.username)}">${icon('trash')}</button></li>`).join('') || '<li class="muted">还没有认证创作者</li>'}</ul>
<form class="adm-form" data-form="disc-verify"><div class="adm-grid2"><label class="field"><span>用户名</span><input name="username" required maxlength="20"></label><label class="field"><span>认证说明</span><input name="label" required maxlength="30" placeholder="摄影师"></label></div><p><button class="btn btn--sm" type="submit">认证</button></p></form>`,
      ) +
      tile(
        'half',
        `${head('tag', `话题（${tp.topics.length}）`)}<p class="muted small">话题通过关联表连接作品（不是自由标签）。「标签映射」把站长文章已有的标签归入话题，文章会出现在话题页。</p>
${tp.topics.map((t) => `<form class="adm-form adm-topic" data-form="disc-topic" data-slug="${e(t.slug)}"><p><b>#${e(t.name)}</b> <span class="muted small">${e(t.slug)} · ${t.counts.works} 件作品 · ${t.counts.subscribers} 人订阅</span></p><div class="adm-grid2"><label class="field"><span>名称</span><input name="name" required maxlength="20" value="${e(t.name)}"></label><label class="field"><span>排序</span><input name="sort" type="number" min="0" max="999" value="${t.sort}"></label></div><label class="field"><span>简介</span><input name="intro" maxlength="200" value="${e(t.intro)}"></label><label class="field"><span>标签映射（逗号分隔）</span><input name="tags" value="${e(t.tags.join('，'))}"></label><p><button class="btn btn--soft btn--sm" type="submit">保存</button></p></form>`).join('')}
<form class="adm-form" data-form="disc-featwork"><h3 class="small">设为话题精选</h3><div class="adm-grid2"><label class="field"><span>话题</span><select name="topic">${tp.topics.map((t) => `<option value="${e(t.slug)}">${e(t.name)}</option>`).join('')}</select></label><label class="field"><span>作品 ID</span><input name="workId" type="number" min="1" required></label></div><label class="field adm-check"><input name="on" type="checkbox" checked><span>精选（取消勾选 = 取消精选）</span></label><p><button class="btn btn--sm" type="submit">保存</button></p></form>`,
      ),
  );
  const val = (f: HTMLFormElement, n: string) => (f.elements.namedItem(n) as HTMLInputElement).value;
  const chk = (f: HTMLFormElement, n: string) => (f.elements.namedItem(n) as HTMLInputElement).checked;
  const iso = (v: string) => (v ? new Date(v).toISOString() : null);
  const on = (sel: string, fn: (f: HTMLFormElement) => Promise<unknown>, ok: string) =>
    root.querySelectorAll<HTMLFormElement>(sel).forEach((f) =>
      f.addEventListener('submit', async (evt) => {
        evt.preventDefault();
        try {
          await fn(f);
          msg(ok);
          await renderDiscoveryAdmin();
        } catch (err) {
          msg(errText(err), true);
        }
      }),
    );
  on('[data-form="disc-event"]', (f) => put('/api/admin/discovery/events', { slug: val(f, 'slug'), kind: val(f, 'kind'), title: val(f, 'title'), intro: val(f, 'intro'), rules: val(f, 'rules'), topic: val(f, 'topic') || null, startsAt: iso(val(f, 'startsAt')), endsAt: iso(val(f, 'endsAt')), voting: chk(f, 'voting'), voteEndsAt: iso(val(f, 'voteEndsAt')), hideTallies: chk(f, 'hideTallies'), minAccountDays: Number(val(f, 'minAccountDays')), maxEntries: Number(val(f, 'maxEntries')) }, 'POST'), '活动已创建');
  on('[data-form="disc-room"]', (f) => put(`/api/admin/rooms/${val(f, 'slug')}`, { enabled: chk(f, 'enabled'), retention: val(f, 'retention'), ttlHours: Number(val(f, 'ttlHours')), closed: chk(f, 'closed') }), '聊天室设置已保存');
  on('[data-form="disc-feature"]', (f) => put('/api/admin/discovery/creators', { username: val(f, 'username'), note: val(f, 'note') }, 'POST'), '已加入精选');
  on('[data-form="disc-verify"]', (f) => put('/api/admin/discovery/verifications', { username: val(f, 'username'), label: val(f, 'label') }, 'POST'), '已认证');
  on('[data-form="disc-topic"]', (f) => put(`/api/admin/discovery/topics/${f.dataset.slug}`, { name: val(f, 'name'), intro: val(f, 'intro'), sort: Number(val(f, 'sort')), tags: val(f, 'tags').split(/[,，]/).map((x) => x.trim()).filter(Boolean) }), '话题已保存');
  on('[data-form="disc-featwork"]', (f) => put(`/api/admin/discovery/topics/${val(f, 'topic')}/featured`, { workId: Number(val(f, 'workId')), on: chk(f, 'on') }, 'POST'), '精选已更新');
  const onClick = async (evt: Event) => {
    const b = (evt.target as HTMLElement).closest<HTMLButtonElement>('[data-disc]');
    if (!b) return;
    const slug = b.dataset.slug ?? '';
    try {
      if (b.dataset.disc === 'entries' || b.dataset.disc === 'pick') {
        const row = root.querySelector<HTMLElement>(`.js-disc-entries[data-for="${CSS.escape(slug)}"]`)!;
        if (b.dataset.disc === 'pick') await put(`/api/admin/discovery/events/${slug}/picks`, { entryId: Number(b.dataset.id), on: b.getAttribute('aria-pressed') !== 'true' }, 'POST');
        else if (!row.hidden) {
          row.hidden = true;
          b.setAttribute('aria-expanded', 'false');
          return;
        }
        const r = await adminFetch<{ entries: { id: number; note: string; picked: boolean; votes: number; work: { id: number; title: string; author: { nickname: string; username: string }; media: { url: string; alt: string }[] } | null }[] }>(`/api/admin/discovery/events/${slug}/entries`);
        row.hidden = false;
        root.querySelector(`[data-disc="entries"][data-slug="${CSS.escape(slug)}"]`)?.setAttribute('aria-expanded', 'true');
        row.querySelector('td')!.innerHTML = r.entries.length
          ? `<ul class="adm-list">${r.entries.map((x) => `<li>${x.work?.media[0] ? `<img class="adm-ugc__img" src="${e(rawUrl(x.work.media[0].url))}" alt="${e(x.work.media[0].alt)}" loading="lazy" width="80">` : ''}<b>#${x.id} ${e(x.work?.title || '无题')}</b> <span class="muted small">${e(x.work?.author.nickname ?? '')} · ${x.votes} 票${x.note ? ` · ${e(x.note)}` : ''}</span> <button class="btn btn--sm ${x.picked ? '' : 'btn--soft'}" type="button" data-disc="pick" data-slug="${e(slug)}" data-id="${x.id}" aria-pressed="${x.picked}">${x.picked ? '已精选' : '设为精选'}</button></li>`).join('')}</ul>`
          : '<p class="muted">还没有投稿</p>';
        if (b.dataset.disc === 'pick') msg('精选已更新');
      } else if (b.dataset.disc === 'results') {
        const r = await put<{ notified: number }>(`/api/admin/discovery/events/${slug}/results`, {}, 'POST');
        msg(`结果已公布，通知了 ${r.notified} 位参与者`);
        await renderDiscoveryAdmin();
      } else if (b.dataset.disc === 'unfeature' || b.dataset.disc === 'unverify') {
        await adminFetch(`/api/admin/discovery/${b.dataset.disc === 'unfeature' ? 'creators' : 'verifications'}/${encodeURIComponent(b.dataset.u!)}`, { method: 'DELETE' });
        msg('已更新');
        await renderDiscoveryAdmin();
      }
    } catch (err) {
      msg(errText(err), true);
    }
  };
  // 每次渲染都是新的 section：监听挂在 section 上，不会重复绑定
  root.querySelectorAll<HTMLElement>('section.adm-tile').forEach((sec) => sec.addEventListener('click', (evt) => void onClick(evt)));
}

async function renderNotes(): Promise<void> {
  const { notes } = await optional(adminFetch<{ notes: StickyNote[] }>('/api/admin/notes'), { notes: [] });
  const sorted = notes.slice().sort((a, b) => Number(b.hidden) - Number(a.hidden) || b.reports - a.reports || b.id - a.id);
  mount(
    tile(
      'full',
      `${head('pin', `便利贴（${notes.length}）`)}<p class="muted small">被 3 位访客举报的便利贴会自动隐藏，等你复核：「恢复」会清零举报数。</p>
<div class="adm-notes">${sorted
        .map(
          (n) => `<article class="adm-note adm-note--${e(n.color)}${n.hidden ? ' is-hidden' : ''}"><p>${e(n.content)}</p><small>— ${e(n.name)} · ${e(fmtDate(n.createdAt))}</small>
<div class="adm-note__meta">${n.reports ? `<span class="chip chip--alert">${n.reports} 次举报</span>` : ''}${n.hidden ? '<span class="chip chip--hidden">已隐藏</span>' : ''}</div>
<div class="adm-row">${n.hidden ? `<button class="btn btn--sm" type="button" data-mod="notes" data-id="${n.id}" data-action="show">恢复</button>` : `<button class="btn btn--soft btn--sm" type="button" data-mod="notes" data-id="${n.id}" data-action="hide">隐藏</button>`}<button class="adm-icon-btn adm-icon-btn--danger" type="button" data-mod="notes" data-id="${n.id}" data-action="delete" aria-label="删除">${icon('trash')}</button></div></article>`,
        )
        .join('') || '<p class="empty">还没有便利贴</p>'}</div>`,
    ),
  );
}

// ============================================================ 好朋友与徽章
async function renderMembers(): Promise<void> {
  const { members } = await optional(adminFetch<{ members: Member[] }>('/api/admin/members'), { members: [] });
  const used = members.flatMap((m) => m.badges.map((b) => b.code));
  const nextCode = `FRIEND-${String(used.length + 1).padStart(4, '0')}`;
  mount(
    tile(
      'full',
      `${head('users', `好朋友（${members.length}）`)}<p class="muted small">徽章编号全站唯一，每人最多 5 枚。颁发后可以展开「设计样式」自由搭配（形状、底色、边框、图标、文字、特效）；好朋友也能在自己的页面改自己徽章的样式。</p>
<div class="adm-members">${members
        .map(
          (m) => `<article class="adm-member"><header>${m.avatarUrl ? `<img class="adm-av" src="${e(m.avatarUrl)}" alt="">` : `<span class="adm-av adm-av--txt">${e(m.name.slice(0, 1))}</span>`}<div><b>${e(m.name)}</b><br><span class="muted small">${e(m.email)} · ${m.provider === 'google' ? 'Google' : '邮箱'} · ${e(fmtDate(m.joinedAt).slice(0, 10))}</span></div>
<button class="adm-icon-btn adm-icon-btn--danger" type="button" data-act="member-del" data-id="${m.id}" data-name="${e(m.name)}" aria-label="删除 ${e(m.name)}">${icon('trash')}</button></header>
${m.bio ? `<p class="small">${e(m.bio)}</p>` : ''}
<div class="adm-badges">${m.badges.map((b) => `<span class="adm-badge">${memberBadge(b.code, b.label, b.style, b.design ?? null)}<span class="small">${e(b.label)}</span><button type="button" class="adm-x" data-act="badge-revoke" data-id="${m.id}" data-code="${e(b.code)}" aria-label="收回 ${e(b.code)}">${icon('close')}</button></span>`).join('') || '<span class="muted small">还没有徽章</span>'}</div>
${m.badges.map((b) => `<details class="bd-edit adm-bd-edit" data-member="${m.id}"><summary>${icon('edit')}<span>设计 ${e(b.code)} 的样式</span></summary>${badgeBuilderHtml({ code: b.code, label: b.label, design: b.design ?? null, style: b.style, who: 'admin' })}</details>`).join('')}
<form class="adm-grant" data-id="${m.id}"><input name="code" required maxlength="24" pattern="[A-Za-z0-9]+(-[A-Za-z0-9]+)*" placeholder="${e(nextCode)}" aria-label="徽章编号"><input name="label" maxlength="30" placeholder="名称，如：第一位好朋友" aria-label="徽章名称"><select name="style" aria-label="起始样式"><option value="brushed-metal">拉丝金属</option><option value="pearlescent">珍珠母贝</option></select><button class="btn btn--sm" type="submit">${icon('plus')}颁发</button></form></article>`,
        )
        .join('') || '<p class="empty">还没有好朋友。访客在「成为好朋友」页验证邮箱后会出现在这里。</p>'}</div>`,
    ),
  );
  root.querySelectorAll<HTMLFormElement>('.adm-bd-edit form.js-bdb').forEach((f) =>
    bindBadgeBuilder(f, async (design) => {
      const mid = f.closest<HTMLElement>('.adm-bd-edit')!.dataset.member;
      await put(`/api/admin/members/${mid}/badges/${encodeURIComponent(f.dataset.code!)}`, { design }, 'PUT');
      await renderMembers();
      msg('徽章样式已保存');
    }),
  );
  root.querySelectorAll<HTMLFormElement>('.adm-grant').forEach((f) =>
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(f);
      try {
        await put(`/api/admin/members/${f.dataset.id}/badges`, { code: fd.get('code'), label: fd.get('label'), style: fd.get('style') }, 'POST');
        await renderMembers();
        msg('徽章已颁发');
      } catch (err) {
        msg(errText(err), true);
      }
    }),
  );
}

// ============================================================ 上传与语音
async function renderInbox(): Promise<void> {
  const { files, voice } = await optional(adminFetch<{ files: UploadedFile[]; voice: VoiceMessage[] }>('/api/admin/inbox'), { files: [], voice: [] });
  const src = (x: { url?: string; dataUrl?: string }) => rawUrl(x.url ?? x.dataUrl);
  mount(
    tile(
      'twothird',
      `${head('upload', `上传的文件（${files.length}）`)}
<div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>文件</th><th>来自</th><th class="hide-sm">大小</th><th>状态</th><th>操作</th></tr></thead><tbody>${files
        .map(
          (f) => `<tr><td><strong>${e(f.name)}</strong><br><span class="muted small">${e(f.contentType)}${f.note ? ` · ${e(f.note)}` : ''}</span></td><td>${e(f.memberName)}<br><span class="muted small">${e(fmtDate(f.createdAt))}</span></td><td class="hide-sm">${fmtSize(f.size)}</td>
<td><span class="chip chip--${f.status}">${f.status === 'pending' ? '待审核' : f.status === 'approved' ? '已通过' : '已拒绝'}</span></td>
<td><div class="adm-row">${src(f) ? `<a class="btn btn--ghost btn--sm" href="${e(src(f))}" download="${e(f.name)}" target="_blank" rel="noopener">下载</a>` : ''}${f.status !== 'approved' ? `<button class="btn btn--sm" type="button" data-mod="inbox/files" data-id="${f.id}" data-action="approve">通过</button>` : ''}${f.status !== 'rejected' ? `<button class="btn btn--soft btn--sm" type="button" data-mod="inbox/files" data-id="${f.id}" data-action="reject">拒绝</button>` : ''}<button class="adm-icon-btn adm-icon-btn--danger" type="button" data-mod="inbox/files" data-id="${f.id}" data-action="delete" aria-label="删除">${icon('trash')}</button></div></td></tr>`,
        )
        .join('') || '<tr><td colspan="5" class="empty">还没有人上传文件</td></tr>'}</tbody></table></div>`,
    ) +
      tile(
        'third',
        `${head('mail', `语音留言（${voice.length}）`)}<div class="adm-voice">${voice
          .map(
            (v) => `<article class="adm-voice__item${v.read ? '' : ' is-unread'}"><header><b>${e(v.name)}</b><span class="muted small">${(v.durationMs / 1000).toFixed(1)} 秒 · ${e(fmtDate(v.createdAt))}</span></header>
${src(v) ? `<audio controls preload="none" src="${e(src(v))}"></audio>` : '<p class="muted small">（演示站未保存录音内容）</p>'}
<div class="adm-row">${v.read ? '<span class="chip">已读</span>' : `<button class="btn btn--sm" type="button" data-mod="inbox/voice" data-id="${v.id}" data-action="read">标为已读</button>`}<button class="adm-icon-btn adm-icon-btn--danger" type="button" data-mod="inbox/voice" data-id="${v.id}" data-action="delete" aria-label="删除">${icon('trash')}</button></div></article>`,
          )
          .join('') || '<p class="empty">还没有语音留言</p>'}</div>`,
      ),
  );
}

// ============================================================ 事件
root.addEventListener('click', async (ev) => {
  const t = ev.target as HTMLElement;
  const nav = t.closest<HTMLElement>('[data-view], [data-go]');
  if (nav) {
    const v = (nav.dataset.view ?? nav.dataset.go) as View;
    if (v === 'editor' && nav.dataset.view) editing = editing && view === 'editor' ? editing : null;
    return void go(v);
  }
  if (t.closest('#logout')) {
    await request('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined);
    csrf = '';
    setAdminHint(false);
    return renderLogin('已退出');
  }
  if (t.closest('#theme-toggle')) {
    toggleTheme();
    return;
  }
  // L21 运行状态：立即检查 / 错误筛选 / 加载更多 / 删除 / 清空
  const opsBtn = t.closest<HTMLElement>('[data-ops]');
  if (opsBtn) {
    const a = opsBtn.dataset.ops!;
    try {
      if (a === 'check') {
        const r = await put<{ check: { ok: number } }>('/api/admin/ops/health-check', {}, 'POST');
        await renderOpsAdmin();
        msg(r.check.ok ? '健康检查通过，已记录' : '健康检查失败，已记录', !r.check.ok);
      } else if (a === 'filter') {
        opsSource = opsBtn.dataset.src ?? '';
        opsBefore = [];
        await renderOpsAdmin();
      } else if (a === 'more') {
        opsBefore.push(Number(opsBtn.dataset.before));
        await renderOpsAdmin();
      } else if (a === 'first') {
        opsBefore = [];
        await renderOpsAdmin();
      } else if (a === 'delete') {
        await adminFetch(`/api/admin/ops/errors/${Number(opsBtn.dataset.id)}`, { method: 'DELETE' });
        await renderOpsAdmin();
        msg('已删除这条错误');
      } else if (a === 'clear') {
        if (!confirm('清空全部错误记录？不能撤销。')) return;
        const r = await adminFetch<{ deleted: number }>('/api/admin/ops/errors', { method: 'DELETE' });
        opsBefore = [];
        await renderOpsAdmin();
        msg(`已清空 ${r.deleted} 条错误记录`);
      }
    } catch (err) {
      msg(errText(err), true);
    }
    return;
  }
  const ugcSeg = t.closest<HTMLElement>('[data-ugcv]');
  if (ugcSeg) {
    ugcView = ugcSeg.dataset.ugcv as typeof ugcView;
    return void renderUgc();
  }
  const wmSeg = t.closest<HTMLElement>('[data-wms]');
  if (wmSeg) {
    wmStatus = wmSeg.dataset.wms!;
    return void renderUgc();
  }
  const wmBtn = t.closest<HTMLElement>('[data-wm]');
  if (wmBtn) {
    const a = wmBtn.dataset.wm!;
    if (a === 'delete' && !confirm('删除这条 Webmention？')) return;
    try {
      if (a === 'process') await put('/api/admin/webmentions/process', {}, 'POST');
      else await put(`/api/admin/webmentions/${Number(wmBtn.dataset.id)}`, { action: a }, 'POST');
      await renderUgc();
      msg(a === 'process' ? '已验证' : a === 'approve' ? '已通过，站外回应会显示在页面上' : '已处理');
    } catch (err) {
      msg(errText(err), true);
    }
    return;
  }
  const ugcBtn = t.closest<HTMLElement>('[data-ugc]');
  if (ugcBtn) {
    const action = ugcBtn.dataset.ugc!;
    if (action === 'purge' && !confirm('彻底删除？内容、图片、评论和回应都会被删除，不能撤销。')) return;
    let reason = '';
    if (action === 'hide' || action === 'ban') {
      const r = prompt(action === 'ban' ? '封禁原因（会记录在审核日志里）' : '隐藏原因（作者能看到）', action === 'ban' ? '多次违反社区规则' : '违反社区规则');
      if (r === null) return;
      reason = r.slice(0, 200);
    }
    try {
      await put('/api/admin/ugc/actions', { targetKind: ugcBtn.dataset.kind, targetId: Number(ugcBtn.dataset.id), action, reason, reportId: ugcBtn.dataset.report ? Number(ugcBtn.dataset.report) : null }, 'POST');
      await renderUgc();
      msg(`已${UGC_ACTION[action] ?? '处理'}`);
    } catch (err) {
      msg(errText(err), true);
    }
    return;
  }
  const cmSeg = t.closest<HTMLElement>('[data-cm]');
  if (cmSeg) {
    cmStatus = cmSeg.dataset.cm as CommentStatus | 'all';
    return void renderComments();
  }
  const seg = t.closest<HTMLElement>('[data-gb]');
  if (seg) {
    gbStatus = seg.dataset.gb!;
    return void renderGuestbook();
  }
  const mod = t.closest<HTMLElement>('[data-mod]');
  if (mod) {
    const action = mod.dataset.action!;
    if (action === 'delete' && !confirm('确定删除？此操作不能撤销。')) return;
    try {
      if (mod.dataset.mod!.startsWith('inbox/') && action === 'delete') await adminFetch(`/api/admin/${mod.dataset.mod}/${mod.dataset.id}`, { method: 'DELETE' });
      else await put(`/api/admin/${mod.dataset.mod}/${mod.dataset.id}`, { action }, 'POST');
      await go();
      msg('已更新');
    } catch (err) {
      msg(errText(err), true);
    }
    return;
  }
  const act = t.closest<HTMLElement>('[data-act]');
  if (!act) return;
  const slug = act.dataset.slug ?? '';
  try {
    switch (act.dataset.act) {
      case 'new':
        editing = null;
        return void go('editor');
      case 'edit':
        editing = await adminFetch<Post>(`/api/admin/posts/${encodeURIComponent(slug)}`);
        return void go('editor');
      case 'pin': {
        const p = postsCache.find((x) => x.slug === slug);
        await put(`/api/admin/posts/${encodeURIComponent(slug)}`, { pinned: !p?.pinned }, 'PATCH');
        msg(p?.pinned ? '已取消置顶' : '已置顶');
        return void go();
      }
      case 'publish':
      case 'unpublish':
        await put(`/api/admin/posts/${encodeURIComponent(slug)}/publish`, { published: act.dataset.act === 'publish' }, 'POST');
        if (view === 'editor' && editing) editing = await adminFetch<Post>(`/api/admin/posts/${encodeURIComponent(slug)}`);
        msg(act.dataset.act === 'publish' ? '已发布' : '已撤回为草稿');
        return void go();
      case 'delete':
        if (!confirm(`确定永久删除「${slug}」？`)) return;
        await adminFetch(`/api/admin/posts/${encodeURIComponent(slug)}`, { method: 'DELETE' });
        if (editing?.slug === slug) editing = null;
        return void go();
      case 'cat-rename': {
        const from = act.dataset.cat!;
        const to = prompt(`把「${from}」重命名为（填已有分类名即合并）：`, from)?.trim();
        if (to && to !== from) await recategorize(from, to);
        return;
      }
      case 'cat-clear':
        if (confirm(`把「${act.dataset.cat}」下的文章都改成未分类？`)) await recategorize(act.dataset.cat!, '');
        return;
      case 'cat-filter':
        postFilter = { q: '', status: 'all', category: act.dataset.cat! };
        return void go('posts');
      case 'badge-revoke':
        await adminFetch(`/api/admin/members/${act.dataset.id}/badges/${encodeURIComponent(act.dataset.code!)}`, { method: 'DELETE' });
        msg('徽章已收回');
        return void go();
      case 'member-del':
        if (!confirm(`删除好朋友「${act.dataset.name}」？他的徽章和上传也会一起删除。`)) return;
        await adminFetch(`/api/admin/members/${act.dataset.id}`, { method: 'DELETE' });
        return void go();
    }
  } catch (err) {
    msg(errText(err), true);
  }
});

(async () => {
  if (DEMO) {
    const { mountDemoBanner } = await import('./demo/client');
    mountDemoBanner({ siteHref: import.meta.env.BASE_URL });
  }
  installIconMotion();
  const fromHash = location.hash.slice(1) as View;
  if (fromHash in TITLE) view = fromHash;
  try {
    const s = await request<{ authenticated: boolean; csrfToken?: string }>('/api/auth/session', { credentials: 'include' });
    if (s.authenticated && s.csrfToken) {
      csrf = s.csrfToken;
      return void go();
    }
  } catch {
    /* 未连接到 API 时也显示登录框 */
  }
  renderLogin();
})();
