/**
 * L16 用户内容前端（按需加载：只在 /feed/、/w/:id/、/compose/ 才下载，经由 social-client 二次分包）：
 * 动态流（关注 / 最新 / 我的，按类型筛选，游标「加载更多」）、作品页（图片 + 参数 + 拍摄手记、回应、收藏、评论、举报、编辑 / 删除）、
 * 发布器（短动态 / 长文 / 摄影作品 / 影集四种模式，图片必须写替代文字，草稿 / 发布，可见范围）。
 * 接口：/api/social/works…（演示站由浏览器内 mock 实现）。所有权限判断都在服务端，这里的按钮只是便利。
 */
import './ugc.css';
import { ApiError, API_BASE, DEMO, request } from './api';
import { currentMember } from './community';
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { url, userPath } from './render';
import { renderCommentHtml } from './comment-core';
import { preparePhoto, PhotoError } from './photo-upload';
import {
  checkWork,
  PARAM_KEYS,
  PARAM_LABEL,
  REPORT_REASONS,
  REPORT_REASON_LABEL,
  TYPE_RULES,
  VISIBILITY_LABEL,
  WORK_REACTIONS,
  WORK_REACTION_EMOJI,
  WORK_TYPE_LABEL,
  WORK_TYPES,
  type WorkParams,
  type WorkReaction,
  type WorkType,
  type WorkVisibility,
} from './ugc-core';

type Notify = (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => Promise<void> | void;
export interface UgcCtx { notify: Notify; navigate?: (href: string) => void }
interface Card { username: string; nickname: string; avatarUrl: string; bio: string }
interface Media { url: string; alt: string; width: number; height: number }
export interface Work {
  id: number;
  type: WorkType;
  author: Card;
  title: string;
  body: string;
  caption: string;
  notes: string;
  params: WorkParams;
  media: Media[];
  visibility: WorkVisibility;
  status: 'draft' | 'pending' | 'published';
  modState: 'ok' | 'hidden';
  modReason: string;
  publishedAt: string | null;
  editedAt: string | null;
  createdAt: string;
  counts: { comments: number; bookmarks: number; reactions: Partial<Record<WorkReaction, number>> };
  mine: { reactions: WorkReaction[]; bookmarked: boolean; canEdit: boolean };
}
interface WComment { id: number; parentId: number | null; author: Card; body: string; pending: boolean; createdAt: string; canDelete: boolean }

// ---------------------------------------------------------------- 请求
const auth = (): Record<string, string> => {
  const m = currentMember();
  return m ? { authorization: `Bearer ${m.token}` } : {};
};
const JH = { 'content-type': 'application/json' };
const send = <T>(path: string, method: string, body?: unknown) => request<T>(path, { method, headers: { ...(body === undefined ? {} : JH), ...auth() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
export const ugc = {
  feed: (tab: string, type: string, cursor?: string | null) => request<{ works: Work[]; nextCursor: string | null }>(`/api/social/works?tab=${tab}${type ? `&type=${type}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { headers: auth() }),
  mine: (status: string, cursor?: string | null) => request<{ works: Work[]; counts: Record<string, number>; nextCursor: string | null }>(`/api/social/me/works?status=${status}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { headers: auth() }),
  work: (id: number) => request<{ work: Work }>(`/api/social/works/${id}`, { headers: auth() }),
  create: (b: unknown) => send<{ work: Work; status: string }>('/api/social/works', 'POST', b),
  update: (id: number, b: unknown) => send<{ work: Work; status: string }>(`/api/social/works/${id}`, 'PUT', b),
  publish: (id: number) => send<{ work: Work; status: string }>(`/api/social/works/${id}/publish`, 'POST'),
  remove: (id: number) => send<{ deleted: boolean }>(`/api/social/works/${id}`, 'DELETE'),
  comments: (id: number) => request<{ comments: WComment[]; nextCursor: string | null }>(`/api/social/works/${id}/comments?limit=50`, { headers: auth() }),
  comment: (id: number, body: string, parentId: number | null) => send<{ comment: WComment; status: string }>(`/api/social/works/${id}/comments`, 'POST', { body, parentId }),
  delComment: (cid: number) => send<{ deleted: boolean }>(`/api/social/works/comments/${cid}`, 'DELETE'),
  react: (id: number, kind: WorkReaction, on: boolean) => (on ? send<ReactState>(`/api/social/works/${id}/reactions`, 'POST', { kind }) : send<ReactState>(`/api/social/works/${id}/reactions/${kind}`, 'DELETE')),
  bookmark: (id: number, on: boolean) => send<ReactState>(`/api/social/works/${id}/bookmark`, on ? 'POST' : 'DELETE'),
  report: (b: { targetKind: string; targetId: number; reason: string; detail: string }) => send<{ reported: boolean; duplicate: boolean }>('/api/social/reports', 'POST', b),
  async upload(file: Blob): Promise<{ url: string }> {
    if (DEMO) {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new Error('读取图片失败'));
        r.readAsDataURL(file);
      });
      return send<{ url: string }>('/api/social/uploads', 'POST', { dataUrl });
    }
    const fd = new FormData();
    fd.set('file', file, 'upload');
    return request<{ url: string }>('/api/social/uploads', { method: 'POST', headers: auth(), body: fd, timeoutMs: 60_000 });
  },
};
interface ReactState { reactions: Partial<Record<WorkReaction, number>>; mine: WorkReaction[]; bookmarked: boolean; bookmarks: number }

const errMsg = (x: unknown) => {
  if (x instanceof ApiError) {
    const d = Array.isArray(x.details) ? (x.details as { message: string }[]).map((y) => y.message).join('；') : '';
    return d ? `${x.message}：${d}` : x.message;
  }
  return (x as Error)?.message || '出错了，请稍后再试';
};
export const workPath = (id: number) => url(`/w/${id}/`);
const imgSrc = (u: string) => (u.startsWith('/api/') ? API_BASE + u : u);
const DATE = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' });
function ago(iso: string | null): string {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`;
  return DATE.format(new Date(iso));
}
function avatar(c: Card, cls = 'soc-av'): string {
  if (c.avatarUrl) return `<img class="${cls}" src="${e(imgSrc(c.avatarUrl))}" alt="" loading="lazy" decoding="async">`;
  let h = 0;
  for (const ch of c.username) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `<span class="${cls} soc-av--letter" style="--h:${h}" aria-hidden="true">${e((c.nickname || c.username).slice(0, 1))}</span>`;
}
const byline = (w: Work) =>
  `<a class="ugc-by" href="${userPath(w.author.username)}">${avatar(w.author)}<span><b>${e(w.author.nickname)}</b><span class="muted small"> @${e(w.author.username)}</span></span></a><span class="muted small ugc-meta"><span class="soc-chip">${WORK_TYPE_LABEL[w.type]}</span>${w.visibility !== 'public' ? `<span class="soc-chip soc-chip--soft">${icon('lock')}${VISIBILITY_LABEL[w.visibility]}</span>` : ''}<time datetime="${e(w.publishedAt ?? w.createdAt)}">${ago(w.publishedAt ?? w.createdAt)}</time>${w.editedAt ? '<span>· 已编辑</span>' : ''}</span>`;
const img = (m: Media, cls = '', eager = false) => `<img class="${cls}" src="${e(imgSrc(m.url))}" alt="${e(m.alt)}"${m.width && m.height ? ` width="${m.width}" height="${m.height}"` : ''} loading="${eager ? 'eager' : 'lazy'}" decoding="async">`;
const totalReactions = (w: Work) => Object.values(w.counts.reactions).reduce((a, b) => a + (b ?? 0), 0);
function stateBanner(w: Work): string {
  if (w.modState === 'hidden') return `<p class="ugc-state ugc-state--hidden" role="note">${icon('eye')}这条内容已被管理员隐藏，只有你能看到${w.modReason ? `：${e(w.modReason)}` : ''}。</p>`;
  if (w.status === 'draft') return `<p class="ugc-state" role="note">${icon('edit')}草稿：只有你能看到。</p>`;
  if (w.status === 'pending') return `<p class="ugc-state" role="note">${icon('clock')}等待审核：新成员的前几条内容会先经过站长审核，通过后才会公开。</p>`;
  return '';
}
function card(w: Work): string {
  const media = w.media.slice(0, 4);
  const more = w.media.length - media.length;
  const text = w.type === 'short' ? `<p class="ugc-card__body">${e(w.body)}</p>` : `${w.title ? `<h3 class="ugc-card__title">${e(w.title)}</h3>` : ''}${w.caption || w.body ? `<p class="ugc-card__body muted">${e((w.caption || w.body).slice(0, 160))}</p>` : ''}`;
  return `<article class="ugc-card tile" aria-labelledby="w${w.id}-l">
  <header class="ugc-card__head">${byline(w)}</header>
  ${stateBanner(w)}
  <a class="ugc-card__link" id="w${w.id}-l" href="${workPath(w.id)}">${text || `<span class="visually-hidden">${WORK_TYPE_LABEL[w.type]}</span>`}</a>
  ${media.length ? `<a class="ugc-grid ugc-grid--${media.length}" href="${workPath(w.id)}" tabindex="-1" aria-hidden="true">${media.map((m, i) => `<span class="ugc-grid__cell">${img(m)}${i === media.length - 1 && more > 0 ? `<span class="ugc-grid__more">+${more}</span>` : ''}</span>`).join('')}</a>` : ''}
  <footer class="ugc-card__foot muted small"><span>${icon('heart')}${totalReactions(w)}</span><span>${icon('message')}${w.counts.comments}</span>${w.counts.bookmarks ? `<span>${icon('bookmark')}${w.counts.bookmarks}</span>` : ''}</footer>
</article>`;
}
function gate(what: string): string {
  return `<div class="soc-gate tile tile--full">${icon('lock')}<h2>登录后${what}</h2><p class="muted">用邮箱验证码登录好朋友账号，就能发布作品、关注创作者、参与评论。</p><a class="btn btn--primary" href="${url('/join/')}">${icon('user')}登录 / 注册</a></div>`;
}

// ---------------------------------------------------------------- 挂载
export async function mountUgc(box: HTMLElement, view: string, ctx: UgcCtx): Promise<void> {
  if (view === 'feed') return renderFeed(box, ctx);
  if (view === 'compose') return renderCompose(box, ctx);
  if (view === 'work') return renderWork(box, Number(box.dataset.id), ctx);
}

// ---------------------------------------------------------------- 动态流
const TYPES: [string, string][] = [['', '全部'], ...WORK_TYPES.map((t) => [t, WORK_TYPE_LABEL[t]] as [string, string])];
async function renderFeed(box: HTMLElement, ctx: UgcCtx): Promise<void> {
  const sp = new URLSearchParams(location.search);
  let tab = (['following', 'latest', 'mine'] as const).find((t) => t === sp.get('tab')) ?? (currentMember() ? 'following' : 'latest');
  let type = WORK_TYPES.includes(sp.get('type') as WorkType) ? sp.get('type')! : '';
  let status = 'all';
  let cursor: string | null = null;
  const tabBtn = (k: string, l: string) => `<button type="button" class="soc-filter js-tab" data-tab="${k}" aria-pressed="${tab === k}">${l}</button>`;
  box.innerHTML = `<div class="ugc-feed">
  <div class="ugc-bar tile tile--full">
    <div class="soc-filters" role="group" aria-label="动态分类">${tabBtn('following', '关注')}${tabBtn('latest', '最新')}${tabBtn('mine', '我的')}</div>
    <a class="btn btn--primary btn--sm" href="${url('/compose/')}">${icon('plus')}发布</a>
    <div class="soc-filters ugc-types" role="group" aria-label="只看某种内容">${TYPES.map(([k, l]) => `<button type="button" class="soc-filter js-type" data-type="${k}" aria-pressed="${type === k}">${l}</button>`).join('')}</div>
    <div class="soc-filters ugc-status js-status" role="group" aria-label="按状态筛选我的内容" hidden></div>
    ${DEMO ? `<p class="ugc-demo muted small" role="note">${icon('sparkles')}演示站：这里的作品由虚构的示例用户发布，数据只保存在你的浏览器里。</p>` : ''}
  </div>
  <p class="visually-hidden js-live" role="status" aria-live="polite"></p>
  <div class="ugc-list js-list" aria-busy="true"></div>
  <button class="btn btn--ghost btn--sm ugc-more js-more" type="button" hidden>加载更多</button>
</div>`;
  const list = box.querySelector<HTMLElement>('.js-list')!;
  const more = box.querySelector<HTMLButtonElement>('.js-more')!;
  const live = box.querySelector<HTMLElement>('.js-live')!;
  const statusBox = box.querySelector<HTMLElement>('.js-status')!;
  const load = async (append: boolean) => {
    list.setAttribute('aria-busy', 'true');
    try {
      if ((tab === 'following' || tab === 'mine') && !currentMember()) {
        list.innerHTML = gate(tab === 'mine' ? '管理自己的作品' : '查看关注的人的动态');
        more.hidden = true;
        return;
      }
      let works: Work[];
      if (tab === 'mine') {
        const r = await ugc.mine(status, append ? cursor : null);
        works = r.works.filter((w) => !type || w.type === type);
        cursor = r.nextCursor;
        const lab: [string, string][] = [['all', '全部'], ['draft', `草稿 ${r.counts.draft ?? 0}`], ['pending', `待审核 ${r.counts.pending ?? 0}`], ['published', `已发布 ${r.counts.published ?? 0}`], ['hidden', `被隐藏 ${r.counts.hidden ?? 0}`]];
        statusBox.innerHTML = lab.map(([k, l]) => `<button type="button" class="soc-filter js-st" data-st="${k}" aria-pressed="${status === k}">${l}</button>`).join('');
      } else {
        const r = await ugc.feed(tab, type, append ? cursor : null);
        works = r.works;
        cursor = r.nextCursor;
      }
      statusBox.hidden = tab !== 'mine';
      const html = works.map(card).join('');
      if (append) list.insertAdjacentHTML('beforeend', html);
      else
        list.innerHTML =
          html ||
          `<div class="soc-gate tile tile--full">${icon('image')}<h2>${tab === 'following' ? '关注的人还没有发布作品' : tab === 'mine' ? '你还没有作品' : '还没有作品'}</h2><p class="muted">${tab === 'following' ? '去「最新」里找找喜欢的创作者，关注后他们的新作品会出现在这里。' : '分享一张照片、一段文字，或者一组影集。'}</p><a class="btn btn--soft" href="${url('/compose/')}">${icon('plus')}发布第一条</a></div>`;
      more.hidden = !cursor;
      live.textContent = `已加载 ${list.querySelectorAll('.ugc-card').length} 条`;
    } catch (x) {
      list.innerHTML = `<p class="tile tile--full muted">${e(errMsg(x))}</p>`;
    } finally {
      list.removeAttribute('aria-busy');
    }
  };
  const sync = () => {
    const q = new URLSearchParams();
    q.set('tab', tab);
    if (type) q.set('type', type);
    history.replaceState(history.state, '', `${location.pathname}?${q}`);
  };
  box.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const b = t.closest<HTMLButtonElement>('.js-tab, .js-type, .js-st');
    if (!b) return;
    if (b.classList.contains('js-tab')) tab = b.dataset.tab as typeof tab;
    else if (b.classList.contains('js-type')) type = b.dataset.type ?? '';
    else status = b.dataset.st ?? 'all';
    box.querySelectorAll('.js-tab').forEach((x) => x.setAttribute('aria-pressed', String((x as HTMLElement).dataset.tab === tab)));
    box.querySelectorAll('.js-type').forEach((x) => x.setAttribute('aria-pressed', String((x as HTMLElement).dataset.type === type)));
    sync();
    void load(false);
  });
  more.addEventListener('click', () => void load(true));
  await load(false);
  void ctx;
}

// ---------------------------------------------------------------- 作品页
async function renderWork(box: HTMLElement, id: number, ctx: UgcCtx): Promise<void> {
  const { work: w } = await ugc.work(id);
  const me = currentMember();
  document.title = `${w.title || `${w.author.nickname}的${WORK_TYPE_LABEL[w.type]}`} | ${document.title.split('|').pop()?.trim() ?? ''}`;
  const params = PARAM_KEYS.filter((k) => w.params[k]);
  const media =
    w.type === 'album'
      ? `<ul class="ugc-album" aria-label="影集（${w.media.length} 张）">${w.media.map((m, i) => `<li><figure>${img(m, '', i < 2)}<figcaption class="visually-hidden">第 ${i + 1} 张：${e(m.alt)}</figcaption></figure></li>`).join('')}</ul>`
      : w.media.length
        ? `<div class="ugc-media ugc-media--${w.type}">${w.media.map((m, i) => `<figure>${img(m, '', i === 0)}</figure>`).join('')}</div>`
        : '';
  const reactBar = WORK_REACTIONS.map((k) => {
    const n = w.counts.reactions[k] ?? 0;
    const on = w.mine.reactions.includes(k);
    return `<button type="button" class="ugc-react js-react" data-k="${k}" aria-pressed="${on}" aria-label="${WORK_REACTION_EMOJI[k]} 回应（${n}）"${me ? '' : ' disabled'}><span aria-hidden="true">${WORK_REACTION_EMOJI[k]}</span><span class="ugc-react__n">${n}</span></button>`;
  }).join('');
  box.innerHTML = `<article class="ugc-work tile tile--full" aria-labelledby="ugc-title">
  <header class="ugc-work__head">${byline(w)}</header>
  ${stateBanner(w)}
  <h1 class="ugc-work__title" id="ugc-title">${e(w.title || `${w.author.nickname}的${WORK_TYPE_LABEL[w.type]}`)}</h1>
  ${media}
  ${w.caption ? `<p class="ugc-caption">${e(w.caption)}</p>` : ''}
  ${w.body ? `<div class="prose ugc-body">${renderCommentHtml(w.body)}</div>` : ''}
  ${params.length ? `<dl class="ugc-params" aria-label="拍摄参数">${params.map((k) => `<div><dt>${PARAM_LABEL[k]}</dt><dd>${e(w.params[k]!)}</dd></div>`).join('')}</dl>` : ''}
  ${w.notes ? `<section class="ugc-notes" aria-labelledby="ugc-notes-h"><h2 class="soc-h" id="ugc-notes-h">${icon('book')}拍摄手记</h2><div class="prose">${renderCommentHtml(w.notes)}</div></section>` : ''}
  <div class="ugc-actions">
    <div class="ugc-reacts" role="group" aria-label="回应">${reactBar}</div>
    <button type="button" class="btn btn--soft btn--sm js-bookmark" aria-pressed="${w.mine.bookmarked}"${me ? '' : ' disabled'}>${icon('bookmark')}<span>${w.mine.bookmarked ? '已收藏' : '收藏'}</span></button>
    ${w.mine.canEdit ? `<a class="btn btn--ghost btn--sm" href="${url(`/compose/?edit=${w.id}`)}">${icon('edit')}编辑</a>${w.status === 'draft' ? `<button type="button" class="btn btn--primary btn--sm js-publish">${icon('send')}发布</button>` : ''}<button type="button" class="btn btn--ghost btn--sm js-delete">${icon('trash')}删除</button>` : me ? `<button type="button" class="btn btn--ghost btn--sm js-report" data-kind="work" data-id="${w.id}">${icon('flag')}举报</button>` : ''}
  </div>
  ${me ? '' : `<p class="muted small"><a href="${url('/join/')}">登录</a>后可以回应、收藏和评论。</p>`}
</article>
<section class="ugc-comments tile tile--full" aria-labelledby="ugc-c-h"><h2 class="soc-h" id="ugc-c-h">${icon('message')}评论 <span class="js-ccount">${w.counts.comments}</span></h2>
  <ul class="ugc-clist js-clist" aria-busy="true"></ul>
  ${
    me && w.status === 'published' && w.modState === 'ok'
      ? `<form class="ugc-cform js-cform" novalidate><input type="hidden" name="parentId" value=""><p class="ugc-replying js-replying muted small" hidden></p><label class="field"><span class="field__label">写评论</span><textarea name="body" rows="3" maxlength="1000" required aria-describedby="ugc-c-hint"></textarea></label><p class="muted small" id="ugc-c-hint">可以用 @用户名 提到别人。新成员的评论会先经过审核。</p><div class="ugc-row"><button class="btn btn--primary btn--sm" type="submit">${icon('send')}发表</button><button class="btn btn--ghost btn--sm js-cancel-reply" type="button" hidden>取消回复</button></div></form>`
      : ''
  }
</section>`;
  const loadComments = async () => {
    const ul = box.querySelector<HTMLElement>('.js-clist')!;
    try {
      const { comments } = await ugc.comments(w.id);
      const tops = comments.filter((c) => c.parentId === null || !comments.some((p) => p.id === c.parentId));
      const row = (c: WComment) =>
        `<li class="ugc-c${c.pending ? ' is-pending' : ''}" data-id="${c.id}"><div class="ugc-c__head">${avatar(c.author)}<a href="${userPath(c.author.username)}"><b>${e(c.author.nickname)}</b></a><time class="muted small" datetime="${e(c.createdAt)}">${ago(c.createdAt)}</time>${c.pending ? '<span class="soc-chip">待审核</span>' : ''}</div><div class="ugc-c__body">${renderCommentHtml(c.body)}</div><div class="ugc-c__act">${me && !c.pending ? `<button type="button" class="ugc-link js-reply" data-id="${c.id}" data-name="${e(c.author.nickname)}">回复</button>` : ''}${c.canDelete ? `<button type="button" class="ugc-link js-cdel" data-id="${c.id}">删除</button>` : me && me.member && c.author.username ? `<button type="button" class="ugc-link js-report" data-kind="comment" data-id="${c.id}">举报</button>` : ''}</div>`;
      ul.innerHTML =
        tops.map((t) => `${row(t)}${comments.filter((c) => c.parentId === t.id).length ? `<ul class="ugc-replies">${comments.filter((c) => c.parentId === t.id).map((c) => `${row(c)}</li>`).join('')}</ul>` : ''}</li>`).join('') ||
        '<li class="soc-empty muted">还没有评论。</li>';
    } catch (x) {
      ul.innerHTML = `<li class="muted">${e(errMsg(x))}</li>`;
    } finally {
      ul.removeAttribute('aria-busy');
    }
  };
  await loadComments();

  const applyReact = (r: ReactState) => {
    box.querySelectorAll<HTMLButtonElement>('.js-react').forEach((b) => {
      const k = b.dataset.k as WorkReaction;
      const n = r.reactions[k] ?? 0;
      b.setAttribute('aria-pressed', String(r.mine.includes(k)));
      b.setAttribute('aria-label', `${WORK_REACTION_EMOJI[k]} 回应（${n}）`);
      b.querySelector('.ugc-react__n')!.textContent = String(n);
    });
    const bm = box.querySelector<HTMLButtonElement>('.js-bookmark');
    if (bm) {
      bm.setAttribute('aria-pressed', String(r.bookmarked));
      bm.querySelector('span')!.textContent = r.bookmarked ? '已收藏' : '收藏';
    }
  };
  box.addEventListener('click', async (ev) => {
    const t = ev.target as HTMLElement;
    const b = t.closest<HTMLButtonElement>('button');
    if (!b || b.disabled) return;
    try {
      if (b.classList.contains('js-react')) {
        b.disabled = true;
        applyReact(await ugc.react(w.id, b.dataset.k as WorkReaction, b.getAttribute('aria-pressed') !== 'true'));
        b.disabled = false;
      } else if (b.classList.contains('js-bookmark')) {
        const on = b.getAttribute('aria-pressed') !== 'true';
        applyReact(await ugc.bookmark(w.id, on));
        void ctx.notify(on ? '已收藏' : '已取消收藏', on ? 'success' : 'info');
      } else if (b.classList.contains('js-delete')) {
        if (!confirm('确定删除这条内容？删除后所有人都看不到它。')) return;
        await ugc.remove(w.id);
        void ctx.notify('已删除', 'info');
        ctx.navigate?.(url('/feed/?tab=mine'));
      } else if (b.classList.contains('js-publish')) {
        const r = await ugc.publish(w.id);
        void ctx.notify(r.status === 'pending' ? '已提交，等待审核' : '已发布', 'success');
        await renderWork(box, w.id, ctx);
      } else if (b.classList.contains('js-report')) {
        openReport(b.dataset.kind!, Number(b.dataset.id), ctx, b);
      } else if (b.classList.contains('js-reply')) {
        const f = box.querySelector<HTMLFormElement>('.js-cform');
        if (!f) return;
        (f.elements.namedItem('parentId') as HTMLInputElement).value = b.dataset.id!;
        const rp = f.querySelector<HTMLElement>('.js-replying')!;
        rp.hidden = false;
        rp.textContent = `回复 ${b.dataset.name}`;
        f.querySelector<HTMLElement>('.js-cancel-reply')!.hidden = false;
        f.querySelector<HTMLTextAreaElement>('textarea')!.focus();
      } else if (b.classList.contains('js-cancel-reply')) {
        const f = b.closest('form')!;
        (f.elements.namedItem('parentId') as HTMLInputElement).value = '';
        f.querySelector<HTMLElement>('.js-replying')!.hidden = true;
        b.hidden = true;
      } else if (b.classList.contains('js-cdel')) {
        if (!confirm('删除这条评论？')) return;
        await ugc.delComment(Number(b.dataset.id));
        await loadComments();
        box.querySelector<HTMLElement>('#ugc-c-h')?.focus();
      }
    } catch (x) {
      b.disabled = false;
      void ctx.notify(errMsg(x), 'error');
    }
  });
  box.querySelector<HTMLFormElement>('.js-cform')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget as HTMLFormElement;
    const ta = f.querySelector<HTMLTextAreaElement>('textarea')!;
    const body = ta.value.trim();
    if (!body) {
      ta.setAttribute('aria-invalid', 'true');
      ta.focus();
      return void ctx.notify('评论不能为空', 'warning');
    }
    ta.removeAttribute('aria-invalid');
    const pid = Number((f.elements.namedItem('parentId') as HTMLInputElement).value) || null;
    const btn = f.querySelector<HTMLButtonElement>('button[type=submit]')!;
    btn.disabled = true;
    try {
      const r = await ugc.comment(w.id, body, pid);
      ta.value = '';
      f.querySelector<HTMLElement>('.js-cancel-reply')?.click();
      void ctx.notify(r.status === 'pending' ? '评论已提交，审核通过后公开' : '评论已发表', 'success');
      await loadComments();
    } catch (x) {
      void ctx.notify(errMsg(x), 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

function openReport(kind: string, id: number, ctx: UgcCtx, opener: HTMLElement): void {
  const dlg = document.createElement('dialog');
  dlg.className = 'ugc-report';
  dlg.setAttribute('aria-labelledby', 'ugc-rep-h');
  dlg.innerHTML = `<form method="dialog" class="js-rep"><h2 id="ugc-rep-h">${icon('flag')}举报这条${kind === 'comment' ? '评论' : '内容'}</h2>
<fieldset><legend class="muted small">原因</legend>${REPORT_REASONS.map((r, i) => `<label class="ugc-radio"><input type="radio" name="reason" value="${r}"${i === 0 ? ' checked' : ''}>${REPORT_REASON_LABEL[r]}</label>`).join('')}</fieldset>
<label class="field"><span class="field__label">补充说明（可选）</span><textarea name="detail" rows="2" maxlength="500"></textarea></label>
<p class="muted small">举报只有站长能看到，不会通知对方。</p>
<div class="ugc-row"><button class="btn btn--soft" value="cancel" type="submit">取消</button><button class="btn btn--primary js-rep-send" value="send" type="submit">提交举报</button></div></form>`;
  document.body.append(dlg);
  dlg.addEventListener('close', async () => {
    const f = dlg.querySelector<HTMLFormElement>('form')!;
    const send = dlg.returnValue === 'send';
    const reason = (f.querySelector<HTMLInputElement>('input[name=reason]:checked')?.value ?? 'other') as string;
    const detail = f.querySelector<HTMLTextAreaElement>('textarea')!.value;
    dlg.remove();
    opener.focus();
    if (!send) return;
    try {
      const r = await ugc.report({ targetKind: kind, targetId: id, reason, detail });
      void ctx.notify(r.duplicate ? '你已经举报过了，站长会尽快处理' : '已提交举报，谢谢你', 'success');
    } catch (x) {
      void ctx.notify(errMsg(x), 'error');
    }
  });
  dlg.showModal();
  dlg.querySelector<HTMLInputElement>('input[name=reason]')?.focus();
}

// ---------------------------------------------------------------- 发布器
interface Draft { type: WorkType; title: string; body: string; caption: string; notes: string; params: WorkParams; media: Media[]; visibility: WorkVisibility }
async function renderCompose(box: HTMLElement, ctx: UgcCtx): Promise<void> {
  if (!currentMember()) return void (box.innerHTML = gate('发布作品'));
  const editId = Number(new URLSearchParams(location.search).get('edit')) || 0;
  let editing: Work | null = null;
  if (editId) {
    editing = (await ugc.work(editId)).work;
    if (!editing.mine.canEdit) throw new ApiError(403, '只能编辑自己的内容');
  }
  const d: Draft = editing
    ? { type: editing.type, title: editing.title, body: editing.body, caption: editing.caption, notes: editing.notes, params: { ...editing.params }, media: editing.media.map((m) => ({ ...m })), visibility: editing.visibility }
    : { type: 'photo', title: '', body: '', caption: '', notes: '', params: {}, media: [], visibility: 'public' };
  const draw = () => {
    const r = TYPE_RULES[d.type];
    const field = (name: keyof Draft, label: string, max: number, min: number, rows = 0, hint = '') => {
      if (max === 0) return '';
      const v = String(d[name] ?? '');
      const req = min > 0;
      const id = `ugc-f-${name}`;
      const ctl = rows
        ? `<textarea id="${id}" name="${name}" rows="${rows}" maxlength="${max}"${req ? ' required aria-required="true"' : ''}${hint ? ` aria-describedby="${id}-h"` : ''}>${e(v)}</textarea>`
        : `<input id="${id}" name="${name}" value="${e(v)}" maxlength="${max}"${req ? ' required aria-required="true"' : ''}${hint ? ` aria-describedby="${id}-h"` : ''}>`;
      return `<div class="field"><label class="field__label" for="${id}">${label}${req ? '<span aria-hidden="true"> *</span>' : '<span class="muted small">（可选）</span>'}</label>${ctl}${hint ? `<p class="muted small" id="${id}-h">${hint}</p>` : ''}<p class="field__err js-err" data-for="${name}" hidden></p></div>`;
    };
    const mediaHtml =
      r.media[1] > 0
        ? `<fieldset class="ugc-mediabox"><legend>图片 <span class="muted small">${r.media[0] === r.media[1] ? `需要 ${r.media[0]} 张` : r.media[0] ? `${r.media[0]}–${r.media[1]} 张` : `最多 ${r.media[1]} 张，可选`}</span></legend>
  <ol class="ugc-thumbs">${d.media
    .map(
      (m, i) =>
        `<li class="ugc-thumb">${img(m, '', true)}<div class="field"><label class="field__label" for="ugc-alt-${i}">替代文字（必填）</label><input id="ugc-alt-${i}" class="js-alt" data-i="${i}" value="${e(m.alt)}" maxlength="200" required aria-required="true" aria-describedby="ugc-alt-hint"><p class="field__err js-err" data-for="media.${i}.alt" hidden></p></div><div class="ugc-row">${i > 0 ? `<button type="button" class="adm-icon-btn js-up" data-i="${i}" aria-label="把第 ${i + 1} 张往前移">${icon('arrowUp')}</button>` : ''}<button type="button" class="adm-icon-btn js-rm" data-i="${i}" aria-label="移除第 ${i + 1} 张">${icon('trash')}</button></div></li>`,
    )
    .join('')}</ol>
  ${d.media.length < r.media[1] ? `<label class="btn btn--soft btn--sm ugc-upload">${icon('upload')}<span>选择图片</span><input class="visually-hidden js-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif"${r.media[1] > 1 ? ' multiple' : ''}></label>` : ''}
  <p class="muted small" id="ugc-alt-hint">替代文字写给看不见图片的读者：描述画面里有什么。上传前会在你的浏览器里去掉 GPS 位置等元数据。</p>
  <p class="field__err js-err" data-for="media" hidden></p><p class="visually-hidden js-up-live" role="status" aria-live="polite"></p></fieldset>`
        : '';
    const paramsHtml = r.params
      ? `<fieldset class="ugc-paramsbox"><legend>拍摄参数 <span class="muted small">（可选，选择 JPEG 时会自动读取）</span></legend><div class="ugc-pgrid">${PARAM_KEYS.map((k) => `<div class="field"><label class="field__label" for="ugc-p-${k}">${PARAM_LABEL[k]}</label><input id="ugc-p-${k}" class="js-param" data-k="${k}" value="${e(d.params[k] ?? '')}" maxlength="60"></div>`).join('')}</div></fieldset>`
      : '';
    box.innerHTML = `<form class="ugc-compose tile tile--full js-compose" novalidate aria-labelledby="ugc-compose-h">
  <h2 class="soc-h" id="ugc-compose-h">${icon(editing ? 'edit' : 'plus')}${editing ? '编辑' : '发布新内容'}</h2>
  ${editing ? stateBanner(editing) : ''}
  <fieldset class="ugc-types-pick"${editing ? ' disabled' : ''}><legend>类型${editing ? '<span class="muted small">（发布后不能更改）</span>' : ''}</legend><div class="soc-filters">${WORK_TYPES.map((t) => `<label class="ugc-type${d.type === t ? ' is-on' : ''}"><input type="radio" name="type" value="${t}"${d.type === t ? ' checked' : ''}>${WORK_TYPE_LABEL[t]}</label>`).join('')}</div></fieldset>
  ${field('title', d.type === 'article' ? '标题' : d.type === 'album' ? '影集名' : '标题', r.title[1], r.title[0])}
  ${mediaHtml}
  ${field('caption', '图注', r.caption, 0, 2, '一句话说明这张 / 这组照片。')}
  ${field('body', d.type === 'short' ? '想说点什么' : d.type === 'article' ? '正文' : '描述', r.body[1], r.body[0], d.type === 'article' ? 14 : 4, d.type === 'article' ? '支持 **粗体**、*斜体*、`代码`、> 引用 和 https 链接；空行分段。可以用 @用户名 提到别人。' : '可以用 @用户名 提到别人。')}
  ${paramsHtml}
  ${field('notes', '拍摄手记', r.notes, 0, 4, '这张照片背后的故事：怎么拍的、当时的天气和心情。')}
  <div class="field"><label class="field__label" for="ugc-vis">谁可以看</label><select id="ugc-vis" name="visibility">${(['public', 'followers', 'private'] as const).map((v) => `<option value="${v}"${d.visibility === v ? ' selected' : ''}>${VISIBILITY_LABEL[v]}</option>`).join('')}</select></div>
  <p class="field__err js-err" data-for="" role="alert" hidden></p>
  <div class="ugc-row ugc-submit">${!editing || editing.status === 'draft' ? `<button class="btn btn--soft js-save-draft" type="submit" value="draft">${icon('file')}${editing ? '保存草稿' : '存为草稿'}</button>` : ''}<button class="btn btn--primary js-submit" type="submit" value="publish">${icon('send')}${editing ? (editing.status === 'draft' ? '发布' : '保存修改') : '发布'}</button></div>
</form>`;
  };
  const readForm = () => {
    const f = box.querySelector<HTMLFormElement>('.js-compose')!;
    for (const k of ['title', 'body', 'caption', 'notes'] as const) {
      const el = f.elements.namedItem(k) as HTMLInputElement | null;
      if (el) d[k] = el.value;
      else d[k] = '';
    }
    d.visibility = (f.elements.namedItem('visibility') as HTMLSelectElement).value as WorkVisibility;
    f.querySelectorAll<HTMLInputElement>('.js-alt').forEach((a) => (d.media[Number(a.dataset.i)]!.alt = a.value));
    if (TYPE_RULES[d.type].params) {
      const p: WorkParams = {};
      f.querySelectorAll<HTMLInputElement>('.js-param').forEach((x) => x.value.trim() && (p[x.dataset.k as keyof WorkParams] = x.value.trim()));
      d.params = p;
    } else d.params = {};
  };
  const showErr = (path: string, msg: string) => {
    box.querySelectorAll<HTMLElement>('.js-err').forEach((x) => (x.hidden = true));
    box.querySelectorAll('[aria-invalid]').forEach((x) => x.removeAttribute('aria-invalid'));
    const slot = box.querySelector<HTMLElement>(`.js-err[data-for="${CSS.escape(path)}"]`) ?? box.querySelector<HTMLElement>(`.js-err[data-for="${CSS.escape(path.split('.')[0]!)}"]`) ?? box.querySelector<HTMLElement>('.js-err[data-for=""]')!;
    slot.hidden = false;
    slot.textContent = msg;
    const ctl = slot.parentElement?.querySelector<HTMLElement>('input, textarea, select') ?? null;
    if (ctl && slot.dataset.for !== '') {
      ctl.setAttribute('aria-invalid', 'true');
      const id = slot.id || `${ctl.id}-err`;
      slot.id = id;
      ctl.setAttribute('aria-describedby', `${ctl.getAttribute('aria-describedby') ?? ''} ${id}`.trim());
      ctl.focus();
    } else slot.setAttribute('tabindex', '-1'), slot.focus();
  };
  draw();
  box.addEventListener('change', async (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.name === 'type') {
      readForm();
      d.type = t.value as WorkType;
      const r = TYPE_RULES[d.type];
      if (d.media.length > r.media[1]) d.media = d.media.slice(0, r.media[1]);
      draw();
      box.querySelector<HTMLInputElement>(`input[name=type][value=${d.type}]`)?.focus();
      return;
    }
    if (t.classList.contains('js-file') && t.files?.length) {
      readForm();
      const r = TYPE_RULES[d.type];
      const files = [...t.files].slice(0, r.media[1] - d.media.length);
      const live = box.querySelector<HTMLElement>('.js-up-live');
      for (const file of files) {
        try {
          if (live) live.textContent = `正在处理 ${file.name}…`;
          const p = await preparePhoto(file);
          const up = await ugc.upload(p.file);
          d.media.push({ url: up.url, alt: '', width: p.width, height: p.height });
          // 摄影作品：用 EXIF 预填参数（不含 GPS）
          if (r.params && p.fields && d.media.length === 1) {
            const f = p.fields;
            d.params = { ...{ camera: f.camera, lens: f.lens, focal: f.focal, aperture: f.aperture, shutter: f.shutter, iso: f.iso, takenAt: f.date }, ...d.params };
            for (const k of Object.keys(d.params) as (keyof WorkParams)[]) if (!d.params[k]) delete d.params[k];
          }
        } catch (x) {
          void ctx.notify(x instanceof PhotoError ? x.message : `上传失败：${errMsg(x)}`, 'error');
        }
      }
      draw();
      if (live) live.textContent = `已添加 ${d.media.length} 张图片，请为每张写替代文字`;
      box.querySelector<HTMLInputElement>(`#ugc-alt-${Math.max(0, d.media.length - files.length)}`)?.focus();
    }
  });
  box.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('.js-rm, .js-up');
    if (!b) return;
    readForm();
    const i = Number(b.dataset.i);
    if (b.classList.contains('js-rm')) d.media.splice(i, 1);
    else [d.media[i - 1], d.media[i]] = [d.media[i]!, d.media[i - 1]!];
    draw();
    box.querySelector<HTMLElement>('.js-file')?.closest('label')?.focus();
  });
  box.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const submitter = (ev as SubmitEvent).submitter as HTMLButtonElement | null;
    const asDraft = submitter?.value === 'draft';
    readForm();
    const c = checkWork(d, { allowDataUrl: DEMO });
    if (!c.ok) return showErr(c.path, c.error);
    box.querySelectorAll<HTMLButtonElement>('button[type=submit]').forEach((x) => (x.disabled = true));
    try {
      let res: { work: Work; status: string };
      if (editing) {
        res = await ugc.update(editing.id, c.value);
        if (editing.status === 'draft' && !asDraft) res = await ugc.publish(editing.id);
      } else res = await ugc.create({ ...c.value, draft: asDraft });
      void ctx.notify(res.status === 'draft' ? '草稿已保存，只有你能看到' : res.status === 'pending' ? '已提交，等待站长审核后公开' : editing ? '修改已保存' : '发布成功', 'success');
      ctx.navigate?.(workPath(res.work.id));
    } catch (x) {
      const det = x instanceof ApiError && Array.isArray(x.details) ? (x.details as { path: string; message: string }[])[0] : null;
      showErr(det?.path ?? '', det ? det.message : errMsg(x));
      box.querySelectorAll<HTMLButtonElement>('button[type=submit]').forEach((y) => (y.disabled = false));
    }
  });
}
