/**
 * 后台管理（/admin）：与前台同一套 Butterfly 风格视觉。
 * 左侧导航（手机上为抽屉）+ 顶栏 + 各管理页面；hash 路由（#/posts、#/editor/slug …），刷新与后退都能回到原页面。
 * 登录：密码 → 短期 httpOnly 会话 Cookie；写操作带 X-CSRF-Token（只保存在内存里）。
 */
import './styles.css';
import './admin.css';
import { request, DEMO } from './api';
import { toggleTheme, currentMode } from './theme';
import type { AdminStats } from './demo/community-types';
import { e, errText, get, icon, nav, setCsrf, setOnExpired, skeleton, upgrade } from './admin/core';
import { renderDashboard } from './admin/dashboard';
import { renderPosts, renderEditor, renderCategories, editorDirty } from './admin/posts';
import { renderSettings, renderProfile, renderFestivals } from './admin/site';
import { renderContent } from './admin/content';
import { renderGuestbook, renderNotes, renderMembers, renderInbox } from './admin/community';

const root = document.getElementById('admin')!;

type Screen = (view: HTMLElement, arg: string) => Promise<void> | void;
interface NavItem {
  id: string;
  label: string;
  ic: string;
  screen: Screen;
  badge?: (s: AdminStats) => number;
}
const NAV: { group: string; items: NavItem[] }[] = [
  { group: '概览', items: [{ id: 'dashboard', label: '仪表盘', ic: 'dashboard', screen: renderDashboard }] },
  {
    group: '内容',
    items: [
      { id: 'posts', label: '文章', ic: 'file', screen: renderPosts },
      { id: 'editor', label: '写文章', ic: 'edit', screen: renderEditor },
      { id: 'categories', label: '分类', ic: 'folder', screen: renderCategories },
      { id: 'gallery', label: '画廊', ic: 'image', screen: (v) => renderContent(v, 'gallery') },
      { id: 'friends', label: '友链', ic: 'link', screen: (v) => renderContent(v, 'friends') },
      { id: 'favorites', label: '收藏与项目', ic: 'star', screen: (v) => renderContent(v, 'favorites') },
    ],
  },
  {
    group: '互动',
    items: [
      { id: 'guestbook', label: '留言板', ic: 'message', screen: renderGuestbook, badge: (s) => s.guestbook.pending },
      { id: 'notes', label: '便利贴', ic: 'note', screen: renderNotes, badge: (s) => s.notes.hidden },
      { id: 'members', label: '好朋友', ic: 'users', screen: renderMembers },
      { id: 'inbox', label: '收件箱', ic: 'inbox', screen: renderInbox, badge: (s) => s.inbox.pendingFiles + s.inbox.unreadVoice },
    ],
  },
  {
    group: '站点',
    items: [
      { id: 'settings', label: '外观设置', ic: 'settings', screen: renderSettings },
      { id: 'profile', label: '个人资料', ic: 'user', screen: renderProfile },
      { id: 'festivals', label: '节日', ic: 'sparkles', screen: renderFestivals },
    ],
  },
];
const ITEMS = NAV.flatMap((g) => g.items);

function parseHash(): { id: string; arg: string } {
  const m = /^#\/([a-z]+)(?:\/(.*))?$/.exec(location.hash);
  const id = m && ITEMS.some((i) => i.id === m[1]) ? m[1]! : 'dashboard';
  return { id, arg: m?.[2] ? decodeURIComponent(m[2]) : '' };
}
function go(id: string, arg = ''): void {
  const h = `#/${id}${arg ? `/${encodeURIComponent(arg)}` : ''}`;
  if (location.hash === h) void route();
  else location.hash = h;
}
nav.go = go;

// ---------------------------------------------------------------- 登录
function renderLogin(note = ''): void {
  document.body.classList.remove('adm-in');
  root.innerHTML = `<div class="adm-login">
<form class="card adm-login__card" id="login-form" novalidate>
  <div class="adm-login__logo">${icon('settings')}</div>
  <h1>博客后台</h1>
  <p class="muted">请输入管理密码</p>
  <p class="demo-hint" hidden></p>
  <div class="field"><label for="pw">密码</label><input id="pw" name="password" type="password" autocomplete="current-password" required maxlength="256"></div>
  <usa-button deform="squash" morph="submit" class="adm-save adm-login__btn"><button class="btn btn--block" type="submit">登录</button></usa-button>
  <p class="msg" role="status">${e(note)}</p>
  <a class="muted adm-login__back" href="${e(import.meta.env.BASE_URL)}">${icon('arrowLeft')}返回博客</a>
</form>
<usa-toaster label="通知" position="top-right"></usa-toaster></div>`;
  void upgrade(root);
  const form = root.querySelector<HTMLFormElement>('#login-form')!;
  const msg = form.querySelector<HTMLElement>('.msg')!;
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
    const btn = form.querySelector<HTMLElement & { state?: string }>('usa-button');
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;
    if (!password) {
      if (btn) btn.state = 'idle';
      msg.textContent = '请输入密码';
      msg.classList.add('msg--err');
      return;
    }
    if (btn) btn.state = 'loading';
    msg.textContent = '登录中…';
    msg.classList.remove('msg--err');
    try {
      const r = await request<{ csrfToken: string }>('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      setCsrf(r.csrfToken);
      if (btn) btn.state = 'success';
      msg.textContent = '';
      setTimeout(() => void boot(), 350);
    } catch (err) {
      if (btn) btn.state = 'error';
      setTimeout(() => btn && (btn.state = 'idle'), 1400);
      msg.textContent = errText(err);
      msg.classList.add('msg--err');
    }
  });
}

// ---------------------------------------------------------------- 外壳
function shell(): void {
  document.body.classList.add('adm-in');
  const navHtml = NAV.map(
    (g) => `<div class="adm-nav__group"><p class="adm-nav__title">${e(g.group)}</p>${g.items
      .map((i) => `<a class="adm-nav__item" href="#/${i.id}" data-nav="${i.id}">${icon(i.ic)}<span>${e(i.label)}</span><b class="adm-nav__badge" data-badge="${i.id}" hidden></b></a>`)
      .join('')}</div>`,
  ).join('');
  root.innerHTML = `<aside class="adm-side" id="adm-side" aria-label="后台导航">
  <a class="adm-brand" href="#/dashboard"><span class="adm-brand__logo">W</span><span><b>博客后台</b><small>Winston's Blog</small></span></a>
  <nav class="adm-nav">${navHtml}</nav>
  <div class="adm-side__foot">
    <a class="adm-nav__item" href="${e(import.meta.env.BASE_URL)}" target="_blank" rel="noopener">${icon('external')}<span>查看站点</span></a>
    <button class="adm-nav__item" type="button" id="adm-theme">${icon(currentMode() === 'dark' ? 'sun' : 'moon')}<span>${currentMode() === 'dark' ? '浅色模式' : '深色模式'}</span></button>
    <button class="adm-nav__item" type="button" id="adm-logout">${icon('logout')}<span>退出登录</span></button>
  </div>
</aside>
<div class="adm-scrim" id="adm-scrim" hidden></div>
<div class="adm-main">
  <header class="adm-top">
    <button class="adm-burger" type="button" id="adm-burger" aria-label="打开导航" aria-controls="adm-side" aria-expanded="false">${icon('menu')}</button>
    <h1 class="adm-top__title" id="adm-title">仪表盘</h1>
    <div class="adm-top__actions" id="adm-actions"></div>
  </header>
  <main class="adm-view" id="adm-view" tabindex="-1"></main>
</div>
<usa-toaster label="通知" position="top-right"></usa-toaster>`;
  void upgrade(root);
}

function setDrawer(open: boolean): void {
  root.querySelector('#adm-side')?.classList.toggle('is-open', open);
  const scrim = root.querySelector<HTMLElement>('#adm-scrim');
  if (scrim) scrim.hidden = !open;
  root.querySelector('#adm-burger')?.setAttribute('aria-expanded', String(open));
}

let stats: AdminStats | null = null;
async function refreshBadges(): Promise<AdminStats | null> {
  try {
    stats = await get<AdminStats>('/api/admin/stats');
  } catch {
    return null;
  }
  for (const i of ITEMS) {
    const b = root.querySelector<HTMLElement>(`[data-badge="${i.id}"]`);
    if (!b || !i.badge) continue;
    const n = i.badge(stats);
    b.hidden = n <= 0;
    b.textContent = n > 99 ? '99+' : String(n);
  }
  return stats;
}
nav.badges = refreshBadges;

let current = '';
async function route(): Promise<void> {
  if (!root.querySelector('#adm-view')) return;
  const { id, arg } = parseHash();
  if (current === 'editor' && (id !== 'editor' || arg !== lastArg) && editorDirty() && !confirm('有未保存的修改，确定离开？')) {
    history.replaceState(null, '', `#/editor${lastArg ? `/${encodeURIComponent(lastArg)}` : ''}`);
    return;
  }
  current = id;
  lastArg = arg;
  const item = ITEMS.find((i) => i.id === id)!;
  root.querySelectorAll<HTMLElement>('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === id;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const title = id === 'editor' && arg ? '编辑文章' : item.label;
  root.querySelector('#adm-title')!.textContent = title;
  document.title = `${title} · 博客后台`;
  root.querySelector('#adm-actions')!.innerHTML = '';
  setDrawer(false);
  const view = root.querySelector<HTMLElement>('#adm-view')!;
  view.className = `adm-view adm-view--${id}`;
  view.innerHTML = skeleton(id === 'dashboard' ? 4 : 3);
  void upgrade(view);
  try {
    await item.screen(view, arg);
    void upgrade(view);
    view.querySelectorAll('.adm-reveal').forEach((el, i) => (el as HTMLElement).style.setProperty('--i', String(Math.min(i, 8))));
  } catch (err) {
    if (!root.querySelector('#adm-view')) return; // 已退回登录页
    view.innerHTML = `<div class="card adm-card adm-error">${icon('close')}<p>${e(errText(err))}</p><button class="btn btn--ghost btn--sm" type="button" data-retry>重试</button></div>`;
    view.querySelector('[data-retry]')?.addEventListener('click', () => void route());
  }
}
let lastArg = '';

async function boot(): Promise<void> {
  shell();
  void refreshBadges();
  await route();
}

root.addEventListener('click', async (ev) => {
  const t = ev.target as HTMLElement;
  if (t.closest('#adm-burger')) return setDrawer(!root.querySelector('#adm-side')?.classList.contains('is-open'));
  if (t.closest('#adm-scrim')) return setDrawer(false);
  if (t.closest('#adm-theme')) {
    toggleTheme();
    const b = root.querySelector('#adm-theme')!;
    b.innerHTML = `${icon(currentMode() === 'dark' ? 'sun' : 'moon')}<span>${currentMode() === 'dark' ? '浅色模式' : '深色模式'}</span>`;
    return;
  }
  if (t.closest('#adm-logout')) {
    await request('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined);
    setCsrf('');
    history.replaceState(null, '', location.pathname);
    return renderLogin('已退出');
  }
  if (t.closest('.adm-nav__item[data-nav]') && t.closest<HTMLAnchorElement>('a')?.getAttribute('href') === location.hash) {
    ev.preventDefault();
    void route();
  }
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') setDrawer(false);
});
window.addEventListener('hashchange', () => void route());
window.addEventListener('beforeunload', (ev) => {
  if (current === 'editor' && editorDirty()) ev.preventDefault();
});
setOnExpired(() => renderLogin('登录已过期，请重新登录'));

(async () => {
  if (DEMO) {
    const { mountDemoBanner } = await import('./demo/client');
    mountDemoBanner({ siteHref: import.meta.env.BASE_URL });
  }
  try {
    const s = await request<{ authenticated: boolean; csrfToken?: string }>('/api/auth/session', { credentials: 'include' });
    if (s.authenticated && s.csrfToken) {
      setCsrf(s.csrfToken);
      return void boot();
    }
  } catch {
    /* 未连接到 API 时也显示登录框 */
  }
  renderLogin();
})();
