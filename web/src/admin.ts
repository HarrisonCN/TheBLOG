/**
 * 后台管理（/admin）—— 与前台同一套便当网格 / 玻璃瓷砖风格。
 * 密码登录 → 短期 httpOnly 会话 Cookie；写操作带 X-CSRF-Token（只在内存里，刷新后从 /api/auth/session 重新获取）。
 */
import './styles.css';
import './admin.css';
import { request, ApiError, API_BASE, DEMO } from './api';
import { escapeHtml as e } from './markdown';
import { renderSafe } from './sanitize';
import { icon } from './icons';
import { defineUsed } from './usa';
import { backdrop, festivalText, memberBadge } from './render';
import { toggleTheme } from './theme';
import type { Album, ContentKey, ContentMap, Favorite, Friend, GuestbookEntry, Post, PostSummary, Profile, Settings, SocialIcon } from './types';
import { normalizeSettings } from './types';
import type { Festival, Member, Project, StickyNote, UploadedFile, VoiceMessage } from './demo/community-types';
import { isSectionKey, SECTION_KEYS, SECTION_SPECS, toList, type SectionKey } from './sections';

/** 博客首页（部署前缀） */
const SITE_HOME = import.meta.env.BASE_URL || '/';
const SOCIAL_KEYS: SocialIcon[] = ['github', 'wechat', 'xiaohongshu', 'weibo', 'bilibili', 'zhihu', 'instagram', 'x', 'youtube', 'email', 'rss', 'link'];

// ============================================================ 状态与请求
type View = 'dash' | 'posts' | 'editor' | 'categories' | 'settings' | 'profile' | 'friends' | 'gallery' | 'favorites' | 'projects' | 'guestbook' | 'notes' | 'festivals' | 'members' | 'inbox' | SectionKey;
const root = document.getElementById('admin')!;
let csrf = '';
let view: View = 'dash';
let editing: Post | null = null;
let postFilter = { q: '', status: 'all', category: '' };

const NAV: { group: string; items: [View, string, string][] }[] = [
  { group: '概览', items: [['dash', 'dashboard', '仪表盘']] },
  { group: '内容', items: [['posts', 'file', '文章'], ['editor', 'edit', '写文章'], ['categories', 'folder', '分类']] },
  { group: '站点', items: [['settings', 'settings', '展示设置'], ['profile', 'user', '个人资料'], ['friends', 'link', '友链'], ['gallery', 'image', '画廊'], ['favorites', 'star', '收藏'], ['projects', 'box', '项目']] },
  { group: '栏目', items: SECTION_KEYS.map((k) => [k, SECTION_SPECS[k].icon, SECTION_SPECS[k].label] as [View, string, string]) },
  { group: '社区', items: [['guestbook', 'message', '留言审核'], ['notes', 'pin', '便利贴'], ['festivals', 'sparkles', '节日'], ['members', 'users', '好朋友与徽章'], ['inbox', 'mail', '上传与语音']] },
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
  el.textContent = text;
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
  root.innerHTML = `${backdrop()}<form class="tile adm-login" id="login-form">
  <div class="adm-login__cover" aria-hidden="true"></div>
  <span class="adm-brand__logo adm-brand__logo--lg">${icon('lock')}</span>
  <h1>博客后台</h1>
  <p class="muted">请输入管理密码登录</p>
  <p class="demo-hint" hidden></p>
  <div class="field"><label for="pw">密码</label><input id="pw" name="password" type="password" autocomplete="current-password" required maxlength="256"></div>
  <button class="btn btn--primary btn--block" type="submit">${icon('lock')}登录</button>
  <p class="adm-msg${note ? ' is-on' : ''}" role="status">${e(note)}</p>
  <a class="adm-login__back" href="${e(SITE_HOME)}">${icon('arrowLeft')}返回博客首页</a>
</form>`;
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
      const r = await request<{ csrfToken: string }>('/api/auth/login', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
      csrf = r.csrfToken;
      view = 'dash';
      void go();
    } catch (err) {
      msg(errText(err), true);
    }
  });
}

// ============================================================ 路由
async function go(next?: View): Promise<void> {
  if (next) view = next;
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
      case 'guestbook': return await renderGuestbook();
      case 'notes': return await renderNotes();
      case 'festivals': return await renderFestivals();
      case 'members': return await renderMembers();
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

// ============================================================ 仪表盘
async function renderDash(): Promise<void> {
  const [posts, gb, notes, members, inbox] = await Promise.all([
    adminFetch<{ posts: PostSummary[]; total: number }>('/api/admin/posts?status=all&limit=100'),
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
  const { posts } = await adminFetch<{ posts: PostSummary[] }>('/api/admin/posts?status=all&limit=100');
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
  const fd = new FormData();
  fd.append('file', file);
  fd.append('alt', file.name.replace(/\.[^.]+$/, ''));
  return adminFetch<{ url: string; markdown: string }>('/api/admin/images', { method: 'POST', body: fd });
}

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
  <div class="field"><label for="f-summary">摘要</label><input id="f-summary" name="summary" maxlength="500" value="${e(p?.summary ?? '')}"></div>
  <div class="field"><label for="f-tags">标签（逗号分隔）</label><input id="f-tags" name="tags" value="${e((p?.tags ?? []).join(', '))}"></div>
  <div class="field"><label for="f-cover">封面图</label><div class="adm-cover"><input id="f-cover" name="coverUrl" placeholder="URL，或点右边上传" value="${e(p?.coverUrl ?? '')}"><label class="btn btn--soft btn--sm">${icon('upload')}上传封面<input type="file" id="f-cover-file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden></label></div></div>
  <label class="adm-check"><input type="checkbox" name="pinned" ${p?.pinned ? 'checked' : ''}> 置顶这篇文章</label>
  <div class="field"><div class="adm-row adm-row--between"><label for="f-content">正文（Markdown）</label><label class="btn btn--ghost btn--sm">${icon('image')}插入图片<input type="file" id="f-image" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden></label></div><textarea id="f-content" name="contentMd" class="adm-md">${e(p?.contentMd ?? '')}</textarea></div>
  <div class="adm-row">
    <button class="btn" type="submit">${icon('check')}${p ? '保存' : '保存草稿'}</button>
    ${p ? `<button class="btn btn--ghost" type="button" data-act="${p.status === 'published' ? 'unpublish' : 'publish'}" data-slug="${e(p.slug)}">${p.status === 'published' ? '撤回发布' : '发布'}</button>` : '<button class="btn btn--ghost" type="submit" data-publish="1">保存并发布</button>'}
    ${p ? `<span class="chip ${p.status === 'published' ? 'chip--pub' : 'chip--draft'}">${p.status === 'published' ? '已发布' : '草稿'}</span><span class="muted small" id="wc"></span>` : '<span class="muted small" id="wc"></span>'}
  </div>
</form>`,
      'adm-editor',
    ) +
      tile('half', `${head('eye', '实时预览')}<article class="adm-preview" id="preview"></article>`, 'adm-preview-tile'),
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
<div class="prose">${renderSafe(content.value)}</div>`;
    const wc = root.querySelector('#wc');
    if (wc) wc.textContent = `${content.value.replace(/\s+/g, '').length} 字`;
  };
  form.addEventListener('input', update);
  update();
  form.querySelector<HTMLInputElement>('#f-cover-file')!.addEventListener('change', async (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    msg('封面上传中…');
    try {
      (form.elements.namedItem('coverUrl') as HTMLInputElement).value = (await uploadImage(file)).url;
      update();
      msg('封面已上传');
    } catch (err) {
      msg(errText(err), true);
    }
  });
  form.querySelector<HTMLInputElement>('#f-image')!.addEventListener('change', async (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    msg('上传中…');
    try {
      const r = await uploadImage(file);
      const pos = content.selectionStart ?? content.value.length;
      content.value = `${content.value.slice(0, pos)}\n\n${r.markdown}\n\n${content.value.slice(pos)}`;
      update();
      msg('图片已上传并插入正文');
    } catch (err) {
      msg(errText(err), true);
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
      pinned: fd.get('pinned') === 'on',
    };
    if (slug) body.slug = slug;
    try {
      if (editing) editing = await put<Post>(`/api/admin/posts/${encodeURIComponent(editing.slug)}`, body, 'PATCH');
      else {
        if (publish) body.status = 'published';
        editing = await put<Post>('/api/admin/posts', body, 'POST');
      }
      await renderEditor();
      msg('已保存');
    } catch (err) {
      msg(errText(err), true);
    }
  });
}

// ============================================================ 分类
async function renderCategories(): Promise<void> {
  const { posts } = await adminFetch<{ posts: PostSummary[] }>('/api/admin/posts?status=all&limit=100');
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
function listEditor<T extends Record<string, unknown>>(o: { id: string; items: T[]; fields: FieldDef[]; blank: T; title: (x: T) => string; preview?: (x: T) => string; save: (items: T[]) => Promise<unknown> }): void {
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
  mount(listTile('list', spec.icon, `${spec.label}（${items.length}）`, `${e(spec.note)} <a href="${e(base + spec.path)}" target="_blank" rel="noopener">查看页面</a>`));
  const fields: FieldDef[] = spec.fields.map((f) => ({
    key: f.key,
    label: f.label,
    wide: f.wide,
    placeholder: 'placeholder' in f ? f.placeholder : undefined,
    ...(f.t === 'int' ? { type: 'number' as const } : f.t === 'enum' ? { type: 'select' as const, options: [...f.options], optionLabels: f.labels } : f.t === 'list' ? { type: f.lines ? ('lines' as const) : ('list' as const) } : f.t === 'str' && f.textarea ? { type: 'textarea' as const } : {}),
  }));
  const blank = Object.fromEntries(spec.fields.map((f) => [f.key, f.t === 'int' ? f.min : f.t === 'enum' ? f.options[0] : f.t === 'list' ? [] : ''])) as Record<string, unknown>;
  const thumb = (u: unknown) => (typeof u === 'string' && u ? `<img src="${e(rawUrl(u))}" alt="" loading="lazy">` : '');
  listEditor<Record<string, unknown>>({
    id: 'list',
    items,
    blank,
    title: (x) => String(x.title ?? x.name ?? x.version ?? '') + (x.date ? ` · ${String(x.date)}` : ''),
    preview: key === 'works' ? (x) => thumb(x.url) : undefined,
    save: (list) => put(`/api/admin/content/${key}`, { items: list }),
    fields,
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
      `${head('users', `好朋友（${members.length}）`)}<p class="muted small">徽章编号全站唯一，每人最多 5 枚；珍珠母贝适合「第一位」这类纪念，拉丝金属适合日常编号。</p>
<div class="adm-members">${members
        .map(
          (m) => `<article class="adm-member"><header>${m.avatarUrl ? `<img class="adm-av" src="${e(m.avatarUrl)}" alt="">` : `<span class="adm-av adm-av--txt">${e(m.name.slice(0, 1))}</span>`}<div><b>${e(m.name)}</b><br><span class="muted small">${e(m.email)} · ${m.provider === 'google' ? 'Google' : '邮箱'} · ${e(fmtDate(m.joinedAt).slice(0, 10))}</span></div>
<button class="adm-icon-btn adm-icon-btn--danger" type="button" data-act="member-del" data-id="${m.id}" data-name="${e(m.name)}" aria-label="删除 ${e(m.name)}">${icon('trash')}</button></header>
${m.bio ? `<p class="small">${e(m.bio)}</p>` : ''}
<div class="adm-badges">${m.badges.map((b) => `<span class="adm-badge">${memberBadge(b.code, b.label, b.style)}<span class="small">${e(b.label)}</span><button type="button" class="adm-x" data-act="badge-revoke" data-id="${m.id}" data-code="${e(b.code)}" aria-label="收回 ${e(b.code)}">${icon('close')}</button></span>`).join('') || '<span class="muted small">还没有徽章</span>'}</div>
<form class="adm-grant" data-id="${m.id}"><input name="code" required maxlength="24" pattern="[A-Za-z0-9]+(-[A-Za-z0-9]+)*" placeholder="${e(nextCode)}" aria-label="徽章编号"><input name="label" maxlength="30" placeholder="名称，如：第一位好朋友" aria-label="徽章名称"><select name="style" aria-label="材质"><option value="brushed-metal">拉丝金属</option><option value="pearlescent">珍珠母贝</option></select><button class="btn btn--sm" type="submit">${icon('plus')}颁发</button></form></article>`,
        )
        .join('') || '<p class="empty">还没有好朋友。访客在「成为好朋友」页验证邮箱后会出现在这里。</p>'}</div>`,
    ),
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
    return renderLogin('已退出');
  }
  if (t.closest('#theme-toggle')) {
    toggleTheme();
    return;
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
