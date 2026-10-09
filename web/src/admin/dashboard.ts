/** 仪表盘：统计卡片、近 12 个月发文柱状图、待处理事项、最近编辑。 */
import type { AdminStats } from '../demo/community-types';
import { e, fmtDate, get, icon, nav, num, chip } from './core';

export async function renderDashboard(view: HTMLElement): Promise<void> {
  const s = await get<AdminStats>('/api/admin/stats');
  nav.actions(`<a class="btn btn--sm" href="#/editor">${icon('plus')}<span>写文章</span></a>`);
  const card = (ic: string, label: string, value: string, sub: string, href: string, tone = '') =>
    `<a class="card adm-stat adm-reveal${tone ? ` adm-stat--${tone}` : ''}" href="${href}"><span class="adm-stat__ic">${icon(ic)}</span><span class="adm-stat__body"><small>${e(label)}</small><b>${e(value)}</b><span class="muted">${e(sub)}</span></span></a>`;
  const max = Math.max(1, ...s.monthly.map((m) => m.count));
  const bars = s.monthly
    .map((m) => `<li title="${e(m.month)}：${m.count} 篇"><span class="adm-bar__v" style="--h:${((m.count / max) * 100).toFixed(1)}%"><i>${m.count || ''}</i></span><small>${Number(m.month.slice(5))}月</small></li>`)
    .join('');
  const todo = [
    { n: s.guestbook.pending, label: '条留言待审核', href: '#/guestbook', ic: 'message' },
    { n: s.notes.hidden, label: '张便利贴被举报隐藏', href: '#/notes', ic: 'note' },
    { n: s.inbox.pendingFiles, label: '个上传文件待处理', href: '#/inbox', ic: 'upload' },
    { n: s.inbox.unreadVoice, label: '条语音未听', href: '#/inbox', ic: 'mic' },
    { n: s.posts.draft, label: '篇草稿未发布', href: '#/posts/draft', ic: 'edit' },
  ].filter((t) => t.n > 0);
  view.innerHTML = `<section class="adm-hello adm-reveal card"><div><h2>你好，Winston 👋</h2><p class="muted">今天是 ${e(fmtDate(new Date().toISOString()))}。${todo.length ? `有 <b>${todo.reduce((a, t) => a + t.n, 0)}</b> 件事等你处理。` : '一切都处理好了，去拍照吧。'}</p></div>
  <div class="adm-hello__actions"><a class="btn" href="#/editor">${icon('edit')}写文章</a><a class="btn btn--ghost" href="#/settings">${icon('settings')}外观设置</a></div></section>
<div class="adm-stats">
  ${card('file', '文章', num(s.posts.total), `已发布 ${s.posts.published} · 草稿 ${s.posts.draft}`, '#/posts')}
  ${card('book', '总字数', num(s.posts.words), `置顶 ${s.posts.pinned} 篇`, '#/posts', 'pink')}
  ${card('folder', '分类 / 标签', `${s.categories} / ${s.tags}`, '管理分类', '#/categories', 'green')}
  ${card('users', '好朋友', num(s.members), '徽章与成员', '#/members', 'violet')}
  ${card('message', '留言', num(s.guestbook.approved), `待审核 ${s.guestbook.pending}`, '#/guestbook', s.guestbook.pending ? 'warn' : '')}
  ${card('inbox', '收件箱', num(s.inbox.pendingFiles + s.inbox.unreadVoice), `文件 ${s.inbox.pendingFiles} · 语音 ${s.inbox.unreadVoice}`, '#/inbox', s.inbox.pendingFiles + s.inbox.unreadVoice ? 'warn' : '')}
</div>
<div class="adm-grid2">
  <section class="card adm-card adm-reveal"><header class="adm-card__head"><h2>${icon('chart')}近 12 个月发文</h2><span class="muted">共 ${s.monthly.reduce((a, m) => a + m.count, 0)} 篇</span></header>
    <ol class="adm-bars" aria-label="每月发布文章数">${bars}</ol></section>
  <section class="card adm-card adm-reveal"><header class="adm-card__head"><h2>${icon('check')}待处理</h2></header>
    ${todo.length ? `<ul class="adm-todo">${todo.map((t) => `<li><a href="${t.href}">${icon(t.ic)}<span><b>${t.n}</b> ${e(t.label)}</span>${icon('chevronRight')}</a></li>`).join('')}</ul>` : `<div class="adm-empty">${icon('check')}<p>没有待处理的事项</p></div>`}
  </section>
</div>
<section class="card adm-card adm-reveal"><header class="adm-card__head"><h2>${icon('history')}最近编辑</h2><a class="muted" href="#/posts">全部文章 →</a></header>
  <ul class="adm-recent">${s.recent
    .map(
      (p) => `<li><a href="#/editor/${encodeURIComponent(p.slug)}"><span class="adm-recent__t">${p.pinned ? icon('pin', 'adm-pin-ic') : ''}${e(p.title)}</span>
      <span class="adm-recent__m">${p.status === 'published' ? chip('已发布', 'ok') : chip('草稿', 'warn')}${p.category ? chip(p.category, 'muted') : ''}<span class="muted">${e(fmtDate(p.updatedAt, true))}</span></span></a></li>`,
    )
    .join('')}</ul></section>`;
  void nav.badges();
}
