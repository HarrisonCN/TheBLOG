/**
 * L28 兴趣社群（小组）前端（按需加载：只在 /groups/ 与 /groups/:slug/ 才下载）。
 * 列表 + 创建；详情页：加入 / 申请 / 取消申请 / 退出、公告、小组动态（分享自己的公开作品、删除、举报进现有审核队列）、成员，
 * 组长与管理员的管理面板（审核申请、移出、任免管理员、改公告和加入方式、解散）。所有权限判断都在服务端。
 */
import './groups.css';
import { ApiError, request } from './api';
import { currentMember } from './community';
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { url, userPath } from './render';
import { avatar, card, errMsg, type Work } from './ugc-client';
import { can, JOIN_POLICY_LABEL, ROLE_LABEL, type JoinPolicy, type Standing } from './group-core';

interface Card { username: string; nickname: string; avatarUrl: string; bio: string }
interface Group { slug: string; name: string; intro: string; joinPolicy: JoinPolicy; notice: string; owner: Card | null; members: number; shares: number; lastActiveAt: string | null; pending: number; myRole: Standing; createdAt: string }
interface MemberRow extends Card { role: string; joinedAt: string }
interface FeedItem { work: Work; sharedBy: Card | null; sharedAt: string; canRemove: boolean }
export interface GroupsCtx { notify: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => unknown }

const auth = (): Record<string, string> => {
  const m = currentMember();
  return m ? { authorization: `Bearer ${m.token}` } : {};
};
const JH = { 'content-type': 'application/json' };
const send = <T>(path: string, method: string, body?: unknown) => request<T>(path, { method, headers: { ...(body === undefined ? {} : JH), ...auth() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const get = <T>(path: string) => request<T>(path, { headers: auth() });
const G = (slug: string) => `/api/social/groups/${slug}`;
const roleChip = (r: Standing | string) => `<span class="grp-role grp-role--${e(r)}">${e(ROLE_LABEL[r as Standing] ?? r)}</span>`;
const person = (c: Card | null) => (c ? `<a class="grp-person" href="${userPath(c.username)}">${avatar(c, 'soc-av grp-av')}<span>${e(c.nickname)}</span></a>` : '<span class="muted">已注销用户</span>');

// ---------------------------------------------------------------- 列表
async function bindList(root: ParentNode, ctx: GroupsCtx): Promise<void> {
  const list = root.querySelector<HTMLElement>('[data-groups]');
  if (!list || list.dataset.bound) return;
  list.dataset.bound = '1';
  const count = root.querySelector<HTMLElement>('.js-grp-count')!;
  const newBtn = root.querySelector<HTMLButtonElement>('.js-grp-new')!;
  const form = root.querySelector<HTMLFormElement>('#grp-new')!;
  const err = form.querySelector<HTMLElement>('.grp-err')!;
  const paint = async () => {
    try {
      const { groups } = await get<{ groups: Group[] }>('/api/social/groups');
      count.textContent = `共 ${groups.length} 个小组`;
      list.innerHTML = groups
        .map(
          (g) => `<li class="grp-item"><a class="grp-item__a" href="${url(`/groups/${g.slug}/`)}"><span class="grp-item__ic" aria-hidden="true">${icon('users')}</span><span class="grp-item__t"><b>${e(g.name)}</b><small class="muted">${e(g.intro || '还没有简介')}</small><small class="grp-item__m">${g.members} 位成员 · ${g.shares} 条分享 · ${JOIN_POLICY_LABEL[g.joinPolicy]}</small></span>${g.myRole !== 'none' ? roleChip(g.myRole) : ''}</a></li>`,
        )
        .join('');
    } catch (x) {
      count.textContent = `小组加载失败：${errMsg(x)}`;
    }
  };
  if (currentMember()) newBtn.hidden = false;
  newBtn.addEventListener('click', () => {
    form.hidden = !form.hidden;
    newBtn.setAttribute('aria-expanded', String(!form.hidden));
    if (!form.hidden) form.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    const fd = new FormData(form);
    try {
      const { group } = await send<{ group: Group }>('/api/social/groups', 'POST', { name: fd.get('name'), slug: String(fd.get('slug') ?? '').trim().toLowerCase(), intro: fd.get('intro'), joinPolicy: fd.get('joinPolicy') });
      ctx.notify(`小组「${group.name}」已创建`, 'success');
      location.assign(url(`/groups/${group.slug}/`));
    } catch (x) {
      err.textContent = errMsg(x);
    }
  });
  await paint();
}

// ---------------------------------------------------------------- 详情
async function bindDetail(root: ParentNode, ctx: GroupsCtx): Promise<void> {
  const top = root.querySelector<HTMLElement>('[data-group]');
  if (!top || top.dataset.bound) return;
  top.dataset.bound = '1';
  const slug = top.dataset.group!;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const meta = $('.js-grp-meta');
  const noticeTile = $('.js-grp-notice-tile');
  const adminTile = $('.js-grp-admin-tile');
  const adminBody = $('.js-grp-admin-body');
  const shareBox = $('.js-grp-share');
  const feedEl = $('.js-grp-feed');
  const feedEmpty = $('.js-grp-feed-empty');
  const membersEl = $('.js-grp-members');
  const me = currentMember();
  let g: Group;

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    try {
      await fn();
      ctx.notify(okMsg, 'success');
      await load();
    } catch (x) {
      ctx.notify(errMsg(x), 'error');
    }
  };

  const paintMeta = () => {
    const title = document.querySelector<HTMLElement>('#rt .head-tile__title');
    const sub = document.querySelector<HTMLElement>('#rt .head-tile__sub');
    if (title) title.textContent = g.name;
    if (sub) sub.textContent = g.intro || '还没有简介';
    document.title = `${g.name} · 小组 | ${document.title.split(' | ').at(-1)}`;
    let btn = '';
    if (!me) btn = `<a class="btn btn--primary btn--sm" href="${url('/join/')}">${icon('user')}登录后加入</a>`;
    else if (g.myRole === 'none') btn = `<button class="btn btn--primary btn--sm js-grp-join" type="button">${icon('plus')}${g.joinPolicy === 'open' ? '加入小组' : '申请加入'}</button>`;
    else if (g.myRole === 'pending') btn = `<button class="btn btn--ghost btn--sm js-grp-leave" type="button">取消申请</button>`;
    else if (g.myRole !== 'owner') btn = `<button class="btn btn--ghost btn--sm js-grp-leave" type="button">退出小组</button>`;
    meta.innerHTML = `<div class="grp-meta__row"><span class="grp-meta__k">组长</span>${person(g.owner)}</div><div class="grp-meta__row"><span class="grp-meta__k">成员</span><b class="js-grp-n">${g.members}</b></div><div class="grp-meta__row"><span class="grp-meta__k">加入方式</span><span>${JOIN_POLICY_LABEL[g.joinPolicy]}</span></div><div class="grp-meta__row"><span class="grp-meta__k">我的身份</span><span class="js-grp-my">${roleChip(g.myRole)}</span></div><div class="grp-meta__act">${btn}</div>`;
    meta.querySelector('.js-grp-join')?.addEventListener('click', () => act(() => send(`${G(slug)}/join`, 'POST'), g.joinPolicy === 'open' ? '已加入小组' : '已提交申请，等待组长或管理员审核'));
    meta.querySelector('.js-grp-leave')?.addEventListener('click', () => act(() => send(`${G(slug)}/join`, 'DELETE'), g.myRole === 'pending' ? '已取消申请' : '已退出小组'));
    noticeTile.hidden = !g.notice;
    $('.js-grp-notice-text').textContent = g.notice;
  };

  const paintMembers = (members: MemberRow[], pending: MemberRow[]) => {
    const isOwner = g.myRole === 'owner';
    const canKick = (r: string) => (isOwner && r !== 'owner') || (g.myRole === 'mod' && r === 'member');
    membersEl.innerHTML = members
      .map((m) => {
        const ops = [
          isOwner && m.role === 'member' ? `<button class="btn btn--sm btn--ghost js-grp-op" type="button" data-u="${e(m.username)}" data-op="mod">设为管理员</button>` : '',
          isOwner && m.role === 'mod' ? `<button class="btn btn--sm btn--ghost js-grp-op" type="button" data-u="${e(m.username)}" data-op="member">取消管理员</button>` : '',
          canKick(m.role) ? `<button class="btn btn--sm btn--ghost js-grp-op" type="button" data-u="${e(m.username)}" data-op="kick" aria-label="把 ${e(m.nickname)} 移出小组">移出</button>` : '',
        ].join('');
        return `<li class="grp-mem">${person(m)}${roleChip(m.role)}${ops ? `<span class="grp-mem__ops">${ops}</span>` : ''}</li>`;
      })
      .join('');
    const staff = can(g.myRole, 'review');
    adminTile.hidden = !staff;
    if (!staff) {
      adminBody.innerHTML = '';
      return;
    }
    const pend = pending.length
      ? `<ul class="grp-members" role="list">${pending.map((m) => `<li class="grp-mem">${person(m)}<span class="grp-mem__ops"><button class="btn btn--sm btn--primary js-grp-op" type="button" data-u="${e(m.username)}" data-op="approve">通过</button><button class="btn btn--sm btn--ghost js-grp-op" type="button" data-u="${e(m.username)}" data-op="reject">拒绝</button></span></li>`).join('')}</ul>`
      : '<p class="muted small">没有待审核的申请。</p>';
    adminBody.innerHTML = `<h3 class="grp-h3">待审核（<span class="js-grp-pending-n">${pending.length}</span>）</h3>${pend}
<form class="grp-form js-grp-notice-form" novalidate><label class="grp-field grp-field--wide"><span>公告（最多 300 字，留空 = 不显示）</span><textarea name="notice" maxlength="300" rows="2">${e(g.notice)}</textarea></label>${
      isOwner ? `<fieldset class="grp-field grp-field--wide"><legend>加入方式</legend>${(['open', 'approval'] as const).map((p) => `<label class="grp-radio"><input type="radio" name="joinPolicy" value="${p}"${g.joinPolicy === p ? ' checked' : ''}> ${JOIN_POLICY_LABEL[p]}</label>`).join('')}</fieldset>` : ''
    }<div class="grp-actions"><button class="btn btn--primary btn--sm" type="submit">保存</button>${isOwner ? `<button class="btn btn--sm btn--danger js-grp-delete" type="button">解散小组</button>` : ''}</div></form>`;
    adminBody.querySelector<HTMLFormElement>('.js-grp-notice-form')!.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target as HTMLFormElement);
      const body: Record<string, unknown> = { notice: fd.get('notice') };
      if (isOwner) body.joinPolicy = fd.get('joinPolicy');
      void act(() => send(G(slug), 'PATCH', body), '已保存');
    });
    adminBody.querySelector('.js-grp-delete')?.addEventListener('click', async () => {
      if (!confirm(`确定解散「${g.name}」？成员和分享记录都会删除（作品本身不受影响）。`)) return;
      try {
        await send(G(slug), 'DELETE');
        ctx.notify('小组已解散', 'success');
        location.assign(url('/groups/'));
      } catch (x) {
        ctx.notify(errMsg(x), 'error');
      }
    });
  };

  const paintFeed = async (items: FeedItem[]) => {
    feedEmpty.hidden = items.length > 0;
    feedEl.innerHTML = items
      .map(
        (it) => `<li class="grp-share" data-work="${it.work.id}">${card(it.work)}<div class="grp-share__by small muted"><span>由 ${it.sharedBy ? e(it.sharedBy.nickname) : '已注销用户'} 分享</span><span class="grp-share__ops">${me ? `<button class="btn btn--sm btn--ghost js-grp-report" type="button" data-id="${it.work.id}">${icon('flag')}举报</button>` : ''}${it.canRemove ? `<button class="btn btn--sm btn--ghost js-grp-unshare" type="button" data-id="${it.work.id}">移出动态</button>` : ''}</span></div></li>`,
      )
      .join('');
    shareBox.innerHTML = '';
    if (me && can(g.myRole, 'post')) {
      try {
        const { works } = await get<{ works: Work[] }>('/api/social/me/works?status=published&limit=50');
        const shared = new Set(items.map((x) => x.work.id));
        const mine = works.filter((w) => w.visibility === 'public' && w.status === 'published' && !shared.has(w.id));
        shareBox.innerHTML = mine.length
          ? `<form class="grp-sharebar js-grp-share-form"><label class="grp-field"><span>分享我的作品到小组</span><select name="workId">${mine.map((w) => `<option value="${w.id}">${e((w.title || w.body || w.caption || `作品 #${w.id}`).slice(0, 40))}</option>`).join('')}</select></label><button class="btn btn--primary btn--sm" type="submit">${icon('send')}分享</button></form>`
          : `<p class="muted small">你还没有可以分享的公开作品。<a href="${url('/compose/')}">去发布一个</a>（新账号的前几条作品需要站长审核后才能分享）。</p>`;
        shareBox.querySelector<HTMLFormElement>('.js-grp-share-form')?.addEventListener('submit', (ev) => {
          ev.preventDefault();
          const id = Number(new FormData(ev.target as HTMLFormElement).get('workId'));
          void act(() => send(`${G(slug)}/feed`, 'POST', { workId: id }), '已分享到小组');
        });
      } catch {
        /* 我的作品加载失败：只是不显示分享框 */
      }
    }
  };

  feedEl.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const un = t.closest<HTMLElement>('.js-grp-unshare');
    if (un) void act(() => send(`${G(slug)}/feed/${un.dataset.id}`, 'DELETE'), '已移出小组动态');
    const rp = t.closest<HTMLElement>('.js-grp-report');
    if (rp) void act(() => send('/api/social/reports', 'POST', { targetKind: 'work', targetId: Number(rp.dataset.id), reason: 'other', detail: `来自小组 ${slug}` }), '已举报，站长会在审核队列里处理');
  });
  membersEl.parentElement!.parentElement!.addEventListener('click', onOp);
  adminTile.addEventListener('click', onOp);
  function onOp(ev: Event) {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('.js-grp-op');
    if (!b) return;
    const op = b.dataset.op!;
    const body = op === 'mod' || op === 'member' ? { action: 'role', role: op } : { action: op };
    const msg: Record<string, string> = { approve: '已通过申请', reject: '已拒绝申请', kick: '已移出小组', mod: '已设为管理员', member: '已取消管理员' };
    void act(() => send(`${G(slug)}/members/${b.dataset.u}`, 'POST', body), msg[op] ?? '完成');
  }

  async function load(): Promise<void> {
    try {
      const [{ group }, mem, feed] = await Promise.all([get<{ group: Group }>(G(slug)), get<{ members: MemberRow[]; pending: MemberRow[] }>(`${G(slug)}/members`), get<{ items: FeedItem[] }>(`${G(slug)}/feed`)]);
      g = group;
      paintMeta();
      paintMembers(mem.members, mem.pending);
      await paintFeed(feed.items);
    } catch (x) {
      meta.innerHTML = `<p class="empty">${x instanceof ApiError && x.status === 404 ? '没有这个小组，可能已经解散了。' : `加载失败：${e(errMsg(x))}`} <a href="${url('/groups/')}">返回小组列表</a></p>`;
    }
  }
  await load();
}

export function bindGroups(root: ParentNode, ctx: GroupsCtx): void {
  void bindList(root, ctx);
  void bindDetail(root, ctx);
}
