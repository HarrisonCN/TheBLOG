/**
 * 文章评论的浏览器端：拉取已公开的评论 → 两级楼中楼；发表 / 回复（好朋友自动带上身份，访客进入审核队列）；
 * 旧 Worker 没有评论接口（404）时整块隐藏。
 */
import { api, ApiError } from './api';
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { COMMENT_HONEYPOT, renderCommentHtml, threadComments, type CommentThread, type PostComment } from './comment-core';
import { currentMember } from './community';

type Notify = (m: string, t?: 'success' | 'error' | 'info' | 'warning') => void;
const NAME_KEY = 'blog-comment-name';
const DATE = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : DATE.format(d);
};

function one(c: PostComment, reply: boolean): string {
  const initial = Array.from(c.name)[0] ?? '?';
  return `<article class="c-item${reply ? ' c-item--reply' : ''}" id="comment-${c.id}" data-id="${c.id}" data-name="${e(c.name)}">
  <span class="c-av" aria-hidden="true">${e(initial)}</span>
  <div class="c-body"><header class="c-meta"><b class="c-name">${e(c.name)}</b>${c.member ? `<span class="c-tag">${icon('heart')}好朋友</span>` : ''}${c.replyTo ? `<span class="c-reply-to muted small">回复 @${e(c.replyTo)}</span>` : ''}<time class="muted small" datetime="${e(c.createdAt)}">${when(c.createdAt)}</time></header>
  <div class="c-text">${renderCommentHtml(c.content)}</div>
  <button class="link-btn c-reply js-c-reply" type="button" aria-label="回复 ${e(c.name)}">${icon('message')}回复</button></div>
</article>`;
}

export function commentListHtml(threads: CommentThread[]): string {
  if (!threads.length) return '<p class="c-empty muted">还没有评论，来做第一个留言的人吧。</p>';
  return threads.map((t) => `<div class="c-thread">${one(t, false)}${t.replies.length ? `<div class="c-replies">${t.replies.map((r) => one(r, true)).join('')}</div>` : ''}</div>`).join('');
}

export function bindComments(root: ParentNode, notify: Notify): void {
  const box = root.querySelector<HTMLElement>('.js-comments');
  if (!box || box.dataset.bound) return;
  box.dataset.bound = '1';
  const slug = box.dataset.slug!;
  const list = box.querySelector<HTMLElement>('.js-c-list')!;
  const count = box.querySelector<HTMLElement>('.js-c-count')!;
  const mainForm = box.querySelector<HTMLFormElement>('.js-c-form')!;
  let comments: PostComment[] = [];

  const me = currentMember();
  const prepForm = (f: HTMLFormElement) => {
    const name = f.querySelector<HTMLInputElement>('.js-c-name');
    if (!name) return;
    if (me) {
      name.value = me.member.name;
      name.readOnly = true;
      const tip = f.querySelector<HTMLElement>('.js-c-me');
      if (tip) {
        tip.hidden = false;
        tip.textContent = '已用好朋友身份登录，评论会直接显示';
      }
    } else name.value = localStorage.getItem(NAME_KEY) ?? '';
  };
  prepForm(mainForm);

  const paint = () => {
    const threads = threadComments(comments);
    list.innerHTML = commentListHtml(threads);
    count.textContent = comments.length ? `（${comments.length}）` : '';
  };
  const load = async () => {
    try {
      comments = (await api.comments(slug)).comments;
      paint();
      if (location.hash.startsWith('#comment-')) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'center' });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) box.hidden = true;
      else list.innerHTML = `<p class="muted">评论加载失败：${e((err as Error).message)}</p>`;
    }
  };
  void load();

  const submit = async (f: HTMLFormElement, parentId: number | null) => {
    const fd = new FormData(f);
    const name = String(fd.get('name') ?? '').trim();
    const content = String(fd.get('content') ?? '').trim();
    const msg = f.querySelector<HTMLElement>('.js-c-msg');
    const say = (t: string, bad = false) => {
      if (msg) {
        msg.textContent = t;
        msg.classList.toggle('is-err', bad);
      }
    };
    if (!name) return say('请填写昵称', true), f.querySelector<HTMLInputElement>('.js-c-name')?.focus();
    if (Array.from(content).length < 2) return say('评论至少 2 个字', true), f.querySelector<HTMLTextAreaElement>('.js-c-content')?.focus();
    const btn = f.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const body = { name, content, parentId, [COMMENT_HONEYPOT]: String(fd.get(COMMENT_HONEYPOT) ?? '') };
      const r = await api.postComment(slug, body, me?.token);
      if (!me) localStorage.setItem(NAME_KEY, name);
      f.querySelector<HTMLTextAreaElement>('.js-c-content')!.value = '';
      if (r.status === 'approved' && r.comment) {
        comments.push(r.comment);
        paint();
        notify('评论已发表', 'success');
        document.getElementById(`comment-${r.comment.id}`)?.scrollIntoView({ block: 'center', behavior: 'auto' });
        if (parentId !== null) f.remove();
      } else {
        say('已提交，站长审核后会显示在这里。');
        notify('评论已提交，等待审核', 'info');
      }
    } catch (err) {
      say((err as Error).message, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  };
  mainForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void submit(mainForm, null);
  });

  // 回复：在被回复的评论下面插一个精简表单；回复「回复」时服务端挂到顶层评论下
  list.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('.js-c-reply');
    if (!btn) return;
    const item = btn.closest<HTMLElement>('.c-item')!;
    list.querySelectorAll('.c-form--reply').forEach((x) => x.remove());
    const id = Number(item.dataset.id);
    const f = document.createElement('form');
    f.className = 'c-form c-form--reply';
    f.noValidate = true;
    f.innerHTML = `<p class="c-form__to small">回复 <b>@${e(item.dataset.name ?? '')}</b></p>
<label class="c-field"><span>昵称</span><input name="name" maxlength="30" required class="js-c-name" autocomplete="nickname"></label>
<label class="c-field"><span>回复内容</span><textarea name="content" rows="2" maxlength="1000" required class="js-c-content"></textarea></label>
<div class="c-hp" aria-hidden="true"><label>主页<input name="${COMMENT_HONEYPOT}" tabindex="-1" autocomplete="off"></label></div>
<div class="c-form__foot"><button class="btn btn--ghost btn--sm js-c-cancel" type="button">取消</button><button class="btn btn--primary btn--sm" type="submit">${icon('send')}回复</button></div>
<p class="c-form__msg js-c-msg" role="status" aria-live="polite"></p>`;
    item.querySelector('.c-body')!.append(f);
    prepForm(f);
    (me ? f.querySelector<HTMLTextAreaElement>('.js-c-content') : f.querySelector<HTMLInputElement>('.js-c-name:not([readonly])') ?? f.querySelector<HTMLTextAreaElement>('.js-c-content'))?.focus();
    if (!me && f.querySelector<HTMLInputElement>('.js-c-name')!.value) f.querySelector<HTMLTextAreaElement>('.js-c-content')!.focus();
    const close = () => {
      f.remove();
      btn.focus();
    };
    f.querySelector('.js-c-cancel')!.addEventListener('click', close);
    f.addEventListener('keydown', (k) => {
      if (k.key === 'Escape') close();
    });
    f.addEventListener('submit', (s) => {
      s.preventDefault();
      void submit(f, id);
    });
  });
}
