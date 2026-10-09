/**
 * 后台管理（/admin）：密码登录 → 短期 httpOnly 会话 Cookie；写操作带 X-CSRF-Token。
 * 浏览器里不保存任何长期密钥：CSRF token 只在内存中，刷新后从 /api/auth/session 重新获取。
 */
import './styles.css';
import './admin.css';
import { request, ApiError } from './api';
import { escapeHtml as e } from './markdown';
import { renderSafe } from './sanitize';
import type { Post, PostSummary, Profile, Settings } from './types';

const root = document.getElementById('admin')!;
let csrf = '';
let tab: 'posts' | 'editor' | 'profile' | 'settings' = 'posts';
let editing: Post | null = null;

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

function msg(text: string, err = false): void {
  const el = root.querySelector('.msg');
  if (el) {
    el.textContent = text;
    el.classList.toggle('msg--err', err);
  }
}

function errText(err: unknown): string {
  if (err instanceof ApiError) {
    const d = Array.isArray(err.details) ? '：' + (err.details as { path: string; message: string }[]).map((x) => `${x.path} ${x.message}`).join('；') : '';
    return err.message + d;
  }
  return String(err);
}

function renderLogin(note = ''): void {
  root.innerHTML = `<form class="panel login" id="login-form">
  <h1>博客后台</h1>
  <p class="meta">请输入管理密码</p>
  <div class="field"><label for="pw">密码</label><input id="pw" name="password" type="password" autocomplete="current-password" required maxlength="256"></div>
  <button class="btn" type="submit">登录</button>
  <p class="msg" role="status">${e(note)}</p>
</form>`;
  const form = root.querySelector<HTMLFormElement>('#login-form')!;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;
    msg('登录中…');
    try {
      const r = await request<{ csrfToken: string }>('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      csrf = r.csrfToken;
      tab = 'posts';
      void renderApp();
    } catch (err) {
      msg(errText(err), true);
    }
  });
}

function shell(content: string): string {
  const t = (id: typeof tab, label: string) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${tab === id}">${label}</button>`;
  return `<div class="admin-bar"><h1>博客后台</h1>
  <div class="tabs" role="tablist">${t('posts', '文章')}${t('editor', editing ? '编辑' : '写文章')}${t('profile', '资料')}${t('settings', '展示设置')}</div>
  <div class="row"><a href="/" target="_blank" rel="noopener">查看站点</a><button class="btn btn--ghost btn--sm" type="button" id="logout">退出</button></div></div>
  <p class="msg" role="status"></p>${content}`;
}

async function renderApp(): Promise<void> {
  try {
    if (tab === 'posts') return await renderPosts();
    if (tab === 'editor') return renderEditor();
    if (tab === 'profile') return await renderProfile();
    if (tab === 'settings') return await renderSettings();
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401)) root.innerHTML = shell(`<p class="msg msg--err">${e(errText(err))}</p>`);
  }
}

async function renderPosts(): Promise<void> {
  const { posts } = await adminFetch<{ posts: PostSummary[] }>('/api/admin/posts?status=all&limit=100');
  const rows = posts
    .map(
      (p) => `<tr><td><strong>${e(p.title)}</strong><br><span class="meta">/${e(p.slug)}</span></td>
  <td><span class="badge${p.status === 'published' ? ' badge--pub' : ''}">${p.status === 'published' ? '已发布' : '草稿'}</span></td>
  <td class="hide-sm meta">${e((p.updatedAt ?? '').slice(0, 16).replace('T', ' '))}</td>
  <td><div class="row">
    <button class="btn btn--sm" data-act="edit" data-slug="${e(p.slug)}">编辑</button>
    <button class="btn btn--ghost btn--sm" data-act="${p.status === 'published' ? 'unpublish' : 'publish'}" data-slug="${e(p.slug)}">${p.status === 'published' ? '撤回' : '发布'}</button>
    <button class="btn btn--danger btn--sm" data-act="delete" data-slug="${e(p.slug)}">删除</button>
  </div></td></tr>`,
    )
    .join('');
  root.innerHTML = shell(`<div class="panel"><div class="row row--between"><h2>全部文章（${posts.length}）</h2><button class="btn" data-act="new">写文章</button></div>
  <table><thead><tr><th>标题</th><th>状态</th><th class="hide-sm">更新</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="4">还没有文章</td></tr>'}</tbody></table></div>`);
}

function renderEditor(): void {
  const p = editing;
  root.innerHTML = shell(`<form class="panel" id="post-form">
  <div class="grid2"><div>
    <div class="field"><label for="f-title">标题</label><input id="f-title" name="title" required maxlength="200" value="${e(p?.title ?? '')}"></div>
    <div class="field"><label for="f-slug">slug（小写字母 / 数字 / 连字符，留空自动生成）</label><input id="f-slug" name="slug" maxlength="80" pattern="[a-z0-9]+(-[a-z0-9]+)*" value="${e(p?.slug ?? '')}"></div>
    <div class="field"><label for="f-summary">摘要</label><input id="f-summary" name="summary" maxlength="500" value="${e(p?.summary ?? '')}"></div>
    <div class="field"><label for="f-tags">标签（逗号分隔）</label><input id="f-tags" name="tags" value="${e((p?.tags ?? []).join(', '))}"></div>
    <div class="field"><label for="f-cover">封面图 URL</label><input id="f-cover" name="coverUrl" value="${e(p?.coverUrl ?? '')}"></div>
    <div class="field"><label for="f-content">正文（Markdown）</label><textarea id="f-content" name="contentMd">${e(p?.contentMd ?? '')}</textarea></div>
    <div class="row">
      <button class="btn" type="submit">${p ? '保存' : '保存草稿'}</button>
      ${p ? '' : '<button class="btn btn--ghost" type="submit" data-publish="1">保存并发布</button>'}
      <label class="btn btn--ghost">上传图片<input type="file" id="f-image" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden></label>
      ${p ? `<span class="meta">状态：${p.status === 'published' ? '已发布' : '草稿'}</span>` : ''}
    </div>
  </div>
  <div><p class="meta">预览</p><div class="preview prose" id="preview"></div></div></div>
</form>`);
  const form = root.querySelector<HTMLFormElement>('#post-form')!;
  const content = form.querySelector<HTMLTextAreaElement>('#f-content')!;
  const preview = root.querySelector<HTMLElement>('#preview')!;
  const update = () => (preview.innerHTML = renderSafe(content.value));
  content.addEventListener('input', update);
  update();
  form.querySelector<HTMLInputElement>('#f-image')!.addEventListener('change', async (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    msg('上传中…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('alt', file.name.replace(/\.[^.]+$/, ''));
      const r = await adminFetch<{ markdown: string }>('/api/admin/images', { method: 'POST', body: fd });
      const pos = content.selectionStart ?? content.value.length;
      content.value = `${content.value.slice(0, pos)}\n${r.markdown}\n${content.value.slice(pos)}`;
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
    };
    if (slug) body.slug = slug;
    try {
      if (editing) {
        editing = await adminFetch<Post>(`/api/admin/posts/${encodeURIComponent(editing.slug)}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        if (publish) body.status = 'published';
        editing = await adminFetch<Post>('/api/admin/posts', { method: 'POST', body: JSON.stringify(body) });
      }
      renderEditor();
      msg('已保存');
    } catch (err) {
      msg(errText(err), true);
    }
  });
}

async function renderProfile(): Promise<void> {
  const p = await adminFetch<Profile>('/api/admin/profile');
  root.innerHTML = shell(`<form class="panel" id="profile-form">
  <div class="field"><label for="p-name">名字</label><input id="p-name" name="name" required maxlength="60" value="${e(p.name)}"></div>
  <div class="field"><label for="p-tagline">一句话介绍</label><input id="p-tagline" name="tagline" maxlength="120" value="${e(p.tagline)}"></div>
  <div class="field"><label for="p-avatar">头像 URL</label><input id="p-avatar" name="avatarUrl" value="${e(p.avatarUrl)}"></div>
  <div class="field"><label for="p-location">所在地</label><input id="p-location" name="location" maxlength="60" value="${e(p.location)}"></div>
  <div class="field"><label for="p-links">链接（每行一个：名称 | URL）</label><textarea id="p-links" name="links" class="short">${e(p.links.map((l) => `${l.label} | ${l.url}`).join('\n'))}</textarea></div>
  <div class="field"><label for="p-bio">简介（Markdown）</label><textarea id="p-bio" name="bioMd">${e(p.bioMd)}</textarea></div>
  <button class="btn" type="submit">保存资料</button>
</form>`);
  const form = root.querySelector<HTMLFormElement>('#profile-form')!;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const links = String(fd.get('links') ?? '')
      .split('\n')
      .map((l) => l.split('|').map((x) => x.trim()))
      .filter((x) => x.length >= 2 && x[0] && x[1])
      .map(([label, url]) => ({ label: label!, url: url! }));
    try {
      await adminFetch<Profile>('/api/admin/profile', {
        method: 'PATCH',
        body: JSON.stringify({ name: fd.get('name'), tagline: fd.get('tagline'), avatarUrl: fd.get('avatarUrl'), location: fd.get('location'), bioMd: fd.get('bioMd'), links }),
      });
      msg('资料已保存');
    } catch (err) {
      msg(errText(err), true);
    }
  });
}

async function renderSettings(): Promise<void> {
  const s = await adminFetch<Settings>('/api/admin/settings');
  const sec = (k: keyof Settings['sections'], label: string) => `<label class="check"><input type="checkbox" name="sec-${k}" ${s.sections[k] ? 'checked' : ''}> ${label}</label>`;
  const opt = (v: string, cur: string, label: string) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
  root.innerHTML = shell(`<form class="panel" id="settings-form"><div class="grid2"><div>
  <div class="field"><label for="s-title">站点标题</label><input id="s-title" name="siteTitle" required maxlength="80" value="${e(s.siteTitle)}"></div>
  <div class="field"><label for="s-desc">站点描述</label><input id="s-desc" name="siteDescription" maxlength="200" value="${e(s.siteDescription)}"></div>
  <div class="field"><label for="s-theme">默认主题</label><select id="s-theme" name="theme">${opt('system', s.theme, '跟随系统')}${opt('light', s.theme, '浅色')}${opt('dark', s.theme, '深色')}</select></div>
  <div class="field"><label for="s-anim">动效强度</label><select id="s-anim" name="animation">${opt('off', s.animation, '关闭')}${opt('low', s.animation, '低（仅淡入）')}${opt('normal', s.animation, '标准')}${opt('high', s.animation, '强（逐字入场）')}</select></div>
  <div class="field"><label for="s-ppp">首页文章数</label><input id="s-ppp" name="postsPerPage" type="number" min="1" max="50" value="${s.postsPerPage}"></div>
  </div><div>
  <p class="meta">首页显示的区块</p>
  ${sec('hero', '顶部介绍')}${sec('featured', '精选文章')}${sec('postList', '最新文章')}${sec('tags', '标签云')}${sec('about', '关于我')}
  <div class="field"><label for="s-feat">精选文章 slug（逗号分隔，最多 6 个）</label><input id="s-feat" name="featuredSlugs" value="${e(s.featuredSlugs.join(', '))}"></div>
  </div></div>
  <button class="btn" type="submit">保存设置</button>
</form>`);
  const form = root.querySelector<HTMLFormElement>('#settings-form')!;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const sections = Object.fromEntries((['hero', 'featured', 'postList', 'tags', 'about'] as const).map((k) => [k, fd.get(`sec-${k}`) === 'on']));
    try {
      await adminFetch<Settings>('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          siteTitle: fd.get('siteTitle'),
          siteDescription: fd.get('siteDescription'),
          theme: fd.get('theme'),
          animation: fd.get('animation'),
          postsPerPage: Number(fd.get('postsPerPage')),
          sections,
          featuredSlugs: String(fd.get('featuredSlugs') ?? '').split(/[,，]/).map((x) => x.trim()).filter(Boolean),
        }),
      });
      msg('设置已保存');
    } catch (err) {
      msg(errText(err), true);
    }
  });
}

root.addEventListener('click', async (ev) => {
  const t = ev.target as HTMLElement;
  const tabBtn = t.closest<HTMLElement>('[data-tab]');
  if (tabBtn) {
    tab = tabBtn.dataset.tab as typeof tab;
    return void renderApp();
  }
  if (t.closest('#logout')) {
    await request('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined);
    csrf = '';
    return renderLogin('已退出');
  }
  const act = t.closest<HTMLElement>('[data-act]');
  if (!act) return;
  const slug = act.dataset.slug ?? '';
  try {
    switch (act.dataset.act) {
      case 'new':
        editing = null;
        tab = 'editor';
        return renderEditor();
      case 'edit':
        editing = await adminFetch<Post>(`/api/admin/posts/${encodeURIComponent(slug)}`);
        tab = 'editor';
        return renderEditor();
      case 'publish':
      case 'unpublish':
        await adminFetch(`/api/admin/posts/${encodeURIComponent(slug)}/publish`, { method: 'POST', body: JSON.stringify({ published: act.dataset.act === 'publish' }) });
        return await renderPosts();
      case 'delete':
        if (!confirm(`确定永久删除「${slug}」？`)) return;
        await adminFetch(`/api/admin/posts/${encodeURIComponent(slug)}`, { method: 'DELETE' });
        if (editing?.slug === slug) editing = null;
        return await renderPosts();
    }
  } catch (err) {
    msg(errText(err), true);
  }
});

(async () => {
  try {
    const s = await request<{ authenticated: boolean; csrfToken?: string }>('/api/auth/session', { credentials: 'include' });
    if (s.authenticated && s.csrfToken) {
      csrf = s.csrfToken;
      return void renderApp();
    }
  } catch {
    /* 未连接到 API 时也显示登录框 */
  }
  renderLogin();
})();
