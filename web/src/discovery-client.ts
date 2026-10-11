/**
 * L17 发现与活跃前端（按需加载：只在 /discover/、/t/、/t/:slug/、/events/、/events/:slug/、/c/:id/ 才下载；
 * 个人主页与「我的」页面再按需拉一次做徽章 / 合集）。
 * 发现页（话题、精选与活跃创作者、最新作品、进行中的活动）、话题页（精选 / 最新 / 热门 + 订阅 + 站长文章）、
 * 摄影活动（投稿、修改说明、撤回、投票、精选与结果）、合集（公开 / 私密、加入合集对话框）、社区徽章与创作者认证。
 * 接口：/api/social/{topics,discover,events,collections,…}（演示站由浏览器内 mock 实现）。所有权限判断都在服务端。
 */
import './discovery.css';
import { ApiError, DEMO, request } from './api';
import { currentMember } from './community';
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { postPath, url, userPath } from './render';
import { ago, avatar, card, errMsg, gate, img, type UgcCtx, type Work } from './ugc-client';
import { PARAM_KEYS, PARAM_LABEL } from './ugc-core';
import { COLLECTION_KIND_LABEL, EVENT_KIND_LABEL, EVENT_PHASE_LABEL, TOPIC_SORT_LABEL, type CollectionKind, type EventKind, type EventPhase, type TopicSort } from './discovery-core';

interface Card { username: string; nickname: string; avatarUrl: string; bio: string }
interface Topic { slug: string; name: string; intro: string; counts: { works: number; subscribers: number }; subscribed: boolean }
interface Creator extends Card { note: string; verified: string | null; works: number; cover: { url: string; alt: string } | null }
interface EventSummary { slug: string; kind: EventKind; title: string; intro: string; rules: string; topic: { slug: string; name: string } | null; startsAt: string; endsAt: string; voting: boolean; voteEndsAt: string | null; hideTallies: boolean; minAccountDays: number; maxEntries: number; phase: EventPhase; resultsAt: string | null; counts: { entries: number; participants: number }; cover: { url: string; alt: string } | null }
interface Entry { id: number; note: string; credit: string; picked: boolean; votes: number | null; mine: boolean; work: Work; createdAt: string }
interface EventMe { entries: { id: number; workId: number; note: string; credit: string }[]; vote: number | null; canSubmit: string | null; canVote: string | null }
interface Collection { id: number; title: string; description: string; visibility: 'public' | 'private'; owner: Card; itemCount: number; updatedAt: string; contains?: boolean }
interface CItem { kind: CollectionKind; ref: string; title: string; addedAt: string; work?: Work; unavailable?: boolean }
interface Badges { community: { code: string; label: string; desc: string; icon: string; count: number; firstAt: string }[]; verified: { label: string; verifiedAt: string } | null }

// ---------------------------------------------------------------- 请求
const auth = (): Record<string, string> => {
  const m = currentMember();
  return m ? { authorization: `Bearer ${m.token}` } : {};
};
const JH = { 'content-type': 'application/json' };
const send = <T>(path: string, method: string, body?: unknown) => request<T>(path, { method, headers: { ...(body === undefined ? {} : JH), ...auth() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const get = <T>(path: string) => request<T>(path, { headers: auth() });
export const disc = {
  discover: () => get<{ featuredCreators: Creator[]; newest: Work[]; activeCreators: Creator[]; topics: Topic[]; events: EventSummary[] }>('/api/social/discover'),
  topics: () => get<{ topics: Topic[] }>('/api/social/topics'),
  topic: (slug: string) => get<{ topic: Topic; featured: Work[]; posts: { slug: string; title: string; summary: string; cover: string | null; publishedAt: string | null }[] }>(`/api/social/topics/${slug}`),
  topicWorks: (slug: string, sort: TopicSort, cursor?: string | null) => get<{ works: Work[]; nextCursor: string | null }>(`/api/social/topics/${slug}/works?sort=${sort}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  subscribe: (slug: string, on: boolean) => send<{ subscribed: boolean; counts: Topic['counts'] }>(`/api/social/topics/${slug}/subscribe`, on ? 'POST' : 'DELETE'),
  myTopics: () => get<{ topics: Topic[] }>('/api/social/me/topics'),
  events: (status = 'all') => get<{ events: EventSummary[] }>(`/api/social/events?status=${status}`),
  event: (slug: string) => get<{ event: EventSummary; entries: Entry[]; me: EventMe | null }>(`/api/social/events/${slug}`),
  submit: (slug: string, b: { workId: number; note: string; credit: string }) => send<{ entry: { id: number } }>(`/api/social/events/${slug}/entries`, 'POST', b),
  editEntry: (id: number, b: { note: string; credit: string }) => send<{ entry: { id: number } }>(`/api/social/events/entries/${id}`, 'PATCH', b),
  withdraw: (id: number) => send<{ withdrawn: boolean }>(`/api/social/events/entries/${id}`, 'DELETE'),
  vote: (slug: string, entryId: number) => send<{ vote: number }>(`/api/social/events/${slug}/votes`, 'POST', { entryId }),
  unvote: (slug: string) => send<{ vote: null }>(`/api/social/events/${slug}/votes`, 'DELETE'),
  myEntries: () => get<{ entries: { id: number; workId: number; note: string; event: { slug: string; title: string }; picked: boolean }[] }>('/api/social/me/entries'),
  myWorks: () => get<{ works: Work[] }>('/api/social/me/works?status=published&limit=50'),
  myCollections: (kind?: string, ref?: string) => get<{ collections: Collection[] }>(`/api/social/me/collections${kind && ref ? `?kind=${kind}&ref=${encodeURIComponent(ref)}` : ''}`),
  userCollections: (u: string) => get<{ collections: Collection[] }>(`/api/social/users/${encodeURIComponent(u)}/collections`),
  collection: (id: number) => get<{ collection: Collection; items: CItem[]; canEdit: boolean }>(`/api/social/collections/${id}`),
  createCollection: (b: { title: string; description?: string; visibility: string }) => send<{ collection: Collection }>('/api/social/collections', 'POST', b),
  updateCollection: (id: number, b: unknown) => send<{ collection: Collection }>(`/api/social/collections/${id}`, 'PATCH', b),
  deleteCollection: (id: number) => send<{ deleted: boolean }>(`/api/social/collections/${id}`, 'DELETE'),
  addItem: (id: number, b: { kind: string; ref: string; title?: string }) => send<{ added: boolean }>(`/api/social/collections/${id}/items`, 'POST', b),
  removeItem: (id: number, kind: string, ref: string) => send<{ removed: boolean }>(`/api/social/collections/${id}/items/${kind}/${encodeURIComponent(ref)}`, 'DELETE'),
  badges: (u: string) => get<Badges>(`/api/social/users/${encodeURIComponent(u)}/badges`),
};

// ---------------------------------------------------------------- 小部件
/** 同一个容器重新渲染时撤掉上一轮的事件监听（避免重复绑定导致一次点击触发多次）。 */
const LISTENERS = new WeakMap<HTMLElement, AbortController>();
function freshSignal(box: HTMLElement): AbortSignal {
  LISTENERS.get(box)?.abort();
  const ac = new AbortController();
  LISTENERS.set(box, ac);
  return ac.signal;
}
const DT = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' });
const when = (iso: string) => DT.format(new Date(iso));
const topicPath = (slug: string) => url(`/t/${slug}/`);
const eventPath = (slug: string) => url(`/events/${slug}/`);
const collectionPath = (id: number) => url(`/c/${id}/`);
const demoNote = () => (DEMO ? `<p class="disc-demo muted small" role="note">${icon('sparkles')}演示站：话题、作品、活动都由虚构的示例用户生成，数据只保存在你的浏览器里。</p>` : '');
const subBtn = (t: Topic) =>
  currentMember()
    ? `<button type="button" class="btn btn--sm ${t.subscribed ? 'btn--soft' : 'btn--primary'} js-sub" data-slug="${e(t.slug)}" aria-pressed="${t.subscribed}" aria-label="${t.subscribed ? `取消订阅话题 ${e(t.name)}` : `订阅话题 ${e(t.name)}`}">${icon(t.subscribed ? 'check' : 'plus')}<span>${t.subscribed ? '已订阅' : '订阅'}</span></button>`
    : `<a class="btn btn--soft btn--sm" href="${url('/join/')}">${icon('plus')}登录后订阅</a>`;
function topicCard(t: Topic, level = 3): string {
  return `<article class="disc-topic tile" aria-labelledby="tp-${e(t.slug)}"><h${level} class="disc-topic__name" id="tp-${e(t.slug)}"><a href="${topicPath(t.slug)}">#${e(t.name)}</a></h${level}><p class="muted small disc-topic__intro">${e(t.intro)}</p><p class="disc-topic__foot"><span class="muted small">${t.counts.works} 件作品 · ${t.counts.subscribers} 人订阅</span>${subBtn(t)}</p></article>`;
}
function creatorCard(c: Creator, level = 3): string {
  return `<article class="disc-creator tile">${c.cover ? `<a class="disc-creator__cover" href="${userPath(c.username)}" tabindex="-1" aria-hidden="true">${img({ url: c.cover.url, alt: '', width: 0, height: 0 })}</a>` : ''}<div class="disc-creator__id">${avatar(c, 'soc-av soc-av--lg')}<div><h${level} class="disc-creator__name"><a href="${userPath(c.username)}">${e(c.nickname)}</a>${c.verified ? `<span class="disc-verified" title="站长认证">${icon('verified')}<span>${e(c.verified)}</span></span>` : ''}</h${level}><p class="muted small">@${e(c.username)} · ${c.works} 件公开作品</p></div></div>${c.note ? `<p class="disc-creator__note">${e(c.note)}</p>` : c.bio ? `<p class="disc-creator__note muted">${e(c.bio)}</p>` : ''}</article>`;
}
const phaseChip = (p: EventPhase) => `<span class="disc-phase disc-phase--${p}">${EVENT_PHASE_LABEL[p]}</span>`;
function eventCard(ev: EventSummary, level = 3): string {
  const range = ev.phase === 'upcoming' ? `${when(ev.startsAt)} 开始` : ev.phase === 'open' ? `投稿截止 ${when(ev.endsAt)}` : ev.phase === 'voting' ? `投票截止 ${when(ev.voteEndsAt!)}` : `已于 ${when(ev.voteEndsAt ?? ev.endsAt)} 结束`;
  return `<article class="disc-event tile" aria-labelledby="ev-${e(ev.slug)}">${ev.cover ? `<a class="disc-event__cover" href="${eventPath(ev.slug)}" tabindex="-1" aria-hidden="true">${img({ url: ev.cover.url, alt: '', width: 0, height: 0 })}</a>` : ''}<div class="disc-event__txt"><p class="disc-event__meta"><span class="soc-chip">${EVENT_KIND_LABEL[ev.kind]}</span>${phaseChip(ev.phase)}${ev.voting ? '<span class="soc-chip soc-chip--soft">可投票</span>' : ''}</p><h${level} class="disc-event__title" id="ev-${e(ev.slug)}"><a href="${eventPath(ev.slug)}">${e(ev.title)}</a></h${level}><p class="muted small">${range} · ${ev.counts.entries} 件投稿 / ${ev.counts.participants} 人参与</p>${ev.intro ? `<p class="small disc-event__intro">${e(ev.intro)}</p>` : ''}</div></article>`;
}
const empty = (msg: string, ic = 'image') => `<div class="soc-gate tile tile--full">${icon(ic)}<p class="muted">${msg}</p></div>`;

/** 话题订阅按钮：所有页面共用。 */
function bindSubscribe(box: HTMLElement, ctx: UgcCtx, after?: (slug: string, r: { subscribed: boolean; counts: Topic['counts'] }) => void): void {
  box.addEventListener('click', async (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('.js-sub');
    if (!b || b.disabled) return;
    const slug = b.dataset.slug!;
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.disabled = true;
    try {
      const r = await disc.subscribe(slug, on);
      box.querySelectorAll<HTMLButtonElement>(`.js-sub[data-slug="${CSS.escape(slug)}"]`).forEach((x) => {
        x.setAttribute('aria-pressed', String(r.subscribed));
        x.classList.toggle('btn--primary', !r.subscribed);
        x.classList.toggle('btn--soft', r.subscribed);
        x.querySelector('span')!.textContent = r.subscribed ? '已订阅' : '订阅';
        const name = x.getAttribute('aria-label')!.replace(/^(取消)?订阅话题 /, '');
        x.setAttribute('aria-label', r.subscribed ? `取消订阅话题 ${name}` : `订阅话题 ${name}`);
        x.innerHTML = `${icon(r.subscribed ? 'check' : 'plus')}<span>${r.subscribed ? '已订阅' : '订阅'}</span>`;
      });
      void ctx.notify(r.subscribed ? '已订阅：这个话题的新作品会出现在你的「关注」动态里' : '已取消订阅', r.subscribed ? 'success' : 'info');
      after?.(slug, r);
    } catch (x) {
      void ctx.notify(errMsg(x), 'error');
    } finally {
      b.disabled = false;
    }
  });
}

// ---------------------------------------------------------------- 挂载
export async function mountDiscovery(box: HTMLElement, view: string, ctx: UgcCtx): Promise<void> {
  if (view === 'discover') return renderDiscover(box, ctx);
  if (view === 'topics') return renderTopics(box, ctx);
  if (view === 'topic') return renderTopic(box, box.dataset.slug ?? '', ctx);
  if (view === 'events') return renderEvents(box);
  if (view === 'event') return renderEvent(box, box.dataset.slug ?? '', ctx);
  if (view === 'collection') return renderCollection(box, Number(box.dataset.id), ctx);
}

// ---------------------------------------------------------------- 发现页
async function renderDiscover(box: HTMLElement, ctx: UgcCtx): Promise<void> {
  const d = await disc.discover();
  box.innerHTML = `<div class="disc">
  <section class="tile tile--full disc-intro" aria-labelledby="disc-intro-h"><h2 class="soc-h" id="disc-intro-h">${icon('sparkles')}从这里开始逛</h2><p class="muted">不需要先关注任何人：挑一个感兴趣的话题，看看站长精选的创作者，或者参加一次摄影活动。</p><p class="soc-actions"><a class="btn btn--primary btn--sm" href="${url('/t/')}">${icon('tag')}全部话题</a><a class="btn btn--soft btn--sm" href="${url('/events/')}">${icon('camera')}摄影活动</a><a class="btn btn--ghost btn--sm" href="${url('/feed/?tab=latest')}">${icon('users')}最新动态</a></p>${demoNote()}</section>
  <section class="disc-sec" aria-labelledby="disc-topics-h"><h2 class="soc-h disc-sec__h" id="disc-topics-h">${icon('tag')}话题</h2><div class="disc-grid disc-grid--topics">${d.topics.map((t) => topicCard(t)).join('')}</div></section>
  ${d.events.length ? `<section class="disc-sec" aria-labelledby="disc-ev-h"><h2 class="soc-h disc-sec__h" id="disc-ev-h">${icon('camera')}进行中的摄影活动</h2><div class="disc-grid disc-grid--events">${d.events.map((x) => eventCard(x)).join('')}</div></section>` : ''}
  <section class="disc-sec" aria-labelledby="disc-fc-h"><h2 class="soc-h disc-sec__h" id="disc-fc-h">${icon('star')}精选创作者</h2>${d.featuredCreators.length ? `<div class="disc-grid disc-grid--creators">${d.featuredCreators.map((c) => creatorCard(c)).join('')}</div>` : empty('站长还没有精选创作者。', 'star')}</section>
  <section class="disc-sec" aria-labelledby="disc-new-h"><h2 class="soc-h disc-sec__h" id="disc-new-h">${icon('image')}最新作品</h2>${d.newest.length ? `<div class="ugc-list">${d.newest.map(card).join('')}</div>` : empty('还没有公开作品。')}<p class="disc-more"><a class="more-pill" href="${url('/feed/?tab=latest')}">查看更多${icon('arrowRight')}</a></p></section>
  ${d.activeCreators.length ? `<section class="disc-sec" aria-labelledby="disc-ac-h"><h2 class="soc-h disc-sec__h" id="disc-ac-h">${icon('flame')}最近活跃的创作者</h2><div class="disc-grid disc-grid--creators">${d.activeCreators.map((c) => creatorCard(c)).join('')}</div></section>` : ''}
</div>`;
  bindSubscribe(box, ctx);
}

async function renderTopics(box: HTMLElement, ctx: UgcCtx): Promise<void> {
  const { topics } = await disc.topics();
  box.innerHTML = `<div class="disc"><h2 class="visually-hidden">全部话题</h2>${demoNote() ? `<div class="tile tile--full">${demoNote()}</div>` : ''}<div class="disc-grid disc-grid--topics">${topics.map((t) => topicCard(t, 2)).join('')}</div></div>`;
  bindSubscribe(box, ctx);
}

// ---------------------------------------------------------------- 话题页
async function renderTopic(box: HTMLElement, slug: string, ctx: UgcCtx): Promise<void> {
  const { topic: t, featured, posts } = await disc.topic(slug);
  document.title = `#${t.name} | ${document.title.split('|').pop()?.trim() ?? ''}`;
  const sp = new URLSearchParams(location.search);
  let sort: TopicSort = (['featured', 'latest', 'hot'] as const).find((x) => x === sp.get('sort')) ?? 'latest';
  let cursor: string | null = null;
  box.innerHTML = `<div class="disc">
  <header class="tile tile--full disc-head"><p class="disc-head__kicker muted small"><a href="${url('/t/')}">话题</a></p><h1 class="disc-head__title">#${e(t.name)}</h1><p class="muted">${e(t.intro)}</p><p class="disc-head__foot"><span class="muted small js-tcounts">${t.counts.works} 件作品 · ${t.counts.subscribers} 人订阅</span>${subBtn(t)}${currentMember() ? `<a class="btn btn--ghost btn--sm" href="${url(`/compose/?topic=${t.slug}`)}">${icon('plus')}发布到这个话题</a>` : ''}</p>${demoNote()}</header>
  ${featured.length ? `<section class="disc-sec" aria-labelledby="tp-feat-h"><h2 class="soc-h disc-sec__h" id="tp-feat-h">${icon('star')}精选</h2><div class="ugc-list">${featured.map(card).join('')}</div></section>` : ''}
  <section class="disc-sec" aria-labelledby="tp-works-h"><h2 class="soc-h disc-sec__h" id="tp-works-h">${icon('image')}作品</h2>
    <div class="soc-filters disc-tabs" role="group" aria-label="作品排序">${(['latest', 'hot', 'featured'] as const).map((k) => `<button type="button" class="soc-filter js-sort" data-sort="${k}" aria-pressed="${sort === k}">${TOPIC_SORT_LABEL[k]}</button>`).join('')}</div>
    <p class="muted small disc-hint js-sort-hint"></p>
    <p class="visually-hidden js-live" role="status" aria-live="polite"></p>
    <div class="ugc-list js-list" aria-busy="true"></div>
    <button class="btn btn--ghost btn--sm ugc-more js-more" type="button" hidden>加载更多</button>
  </section>
  ${posts.length ? `<section class="disc-sec" aria-labelledby="tp-posts-h"><h2 class="soc-h disc-sec__h" id="tp-posts-h">${icon('book')}站长文章</h2><ul class="disc-posts tile tile--full">${posts.map((p) => `<li><a href="${postPath(p.slug)}"><b>${e(p.title)}</b></a>${p.summary ? `<span class="muted small">${e(p.summary)}</span>` : ''}</li>`).join('')}</ul></section>` : ''}
</div>`;
  const list = box.querySelector<HTMLElement>('.js-list')!;
  const more = box.querySelector<HTMLButtonElement>('.js-more')!;
  const hint = box.querySelector<HTMLElement>('.js-sort-hint')!;
  const live = box.querySelector<HTMLElement>('.js-live')!;
  const HINT: Record<TopicSort, string> = { latest: '按发布时间排序。', hot: '近 30 天内按互动（回应 + 评论 + 收藏）与发布时间简单计算，越新越靠前；不做个性化推荐。', featured: '由站长挑选。' };
  const load = async (append: boolean) => {
    list.setAttribute('aria-busy', 'true');
    hint.textContent = HINT[sort];
    try {
      const r = await disc.topicWorks(t.slug, sort, append ? cursor : null);
      cursor = r.nextCursor;
      const html = r.works.map(card).join('');
      if (append) list.insertAdjacentHTML('beforeend', html);
      else list.innerHTML = html || `<div class="soc-gate tile tile--full">${icon('image')}<p class="muted">${sort === 'featured' ? '还没有精选作品。' : '这个话题还没有作品，来发布第一件吧。'}</p></div>`;
      more.hidden = !cursor;
      live.textContent = `已加载 ${list.querySelectorAll('.ugc-card').length} 件作品`;
    } catch (x) {
      list.innerHTML = `<p class="tile tile--full muted">${e(errMsg(x))}</p>`;
    } finally {
      list.removeAttribute('aria-busy');
    }
  };
  box.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('.js-sort');
    if (!b) return;
    sort = b.dataset.sort as TopicSort;
    box.querySelectorAll('.js-sort').forEach((x) => x.setAttribute('aria-pressed', String((x as HTMLElement).dataset.sort === sort)));
    history.replaceState(history.state, '', `${location.pathname}?sort=${sort}`);
    void load(false);
  });
  more.addEventListener('click', () => void load(true));
  bindSubscribe(box, ctx, (_s, r) => (box.querySelector<HTMLElement>('.js-tcounts')!.textContent = `${r.counts.works} 件作品 · ${r.counts.subscribers} 人订阅`));
  await load(false);
}

// ---------------------------------------------------------------- 活动
async function renderEvents(box: HTMLElement): Promise<void> {
  const [cur, ended] = await Promise.all([disc.events('current'), disc.events('ended')]);
  box.innerHTML = `<div class="disc">
  <section class="tile tile--full disc-intro" aria-labelledby="ev-about-h"><h2 class="soc-h" id="ev-about-h">${icon('camera')}怎么参加</h2><p class="muted">登录后在活动页选择你已发布的公开摄影作品或影集投稿；投稿期内可以修改说明或撤回。开启投票的活动每人一票、不能投自己。活动徽章纪念参与和被精选，不按票数发放。</p>${demoNote()}</section>
  <section class="disc-sec" aria-labelledby="ev-cur-h"><h2 class="soc-h disc-sec__h" id="ev-cur-h">${icon('clock')}进行中 / 即将开始</h2>${cur.events.length ? `<div class="disc-grid disc-grid--events">${cur.events.map((x) => eventCard(x)).join('')}</div>` : empty('现在没有进行中的活动。', 'camera')}</section>
  <section class="disc-sec" aria-labelledby="ev-end-h"><h2 class="soc-h disc-sec__h" id="ev-end-h">${icon('archive')}往期活动</h2>${ended.events.length ? `<div class="disc-grid disc-grid--events">${ended.events.map((x) => eventCard(x)).join('')}</div>` : empty('还没有往期活动。', 'archive')}</section>
</div>`;
}

async function renderEvent(box: HTMLElement, slug: string, ctx: UgcCtx): Promise<void> {
  const { event: ev, entries, me } = await disc.event(slug);
  document.title = `${ev.title} | ${document.title.split('|').pop()?.trim() ?? ''}`;
  const member = currentMember();
  const mine = new Set((me?.entries ?? []).map((x) => x.id));
  const voteRule = ev.voting
    ? `每人一票，不能投给自己${ev.minAccountDays ? `；注册满 ${ev.minAccountDays} 天才能投票` : ''}${ev.hideTallies ? '；结束前不公开票数' : ''}。`
    : '这个活动不投票，由站长挑选精选作品。';
  let submitPanel = '';
  if (!member) submitPanel = `<p class="muted small"><a href="${url('/join/')}">登录</a>后可以投稿${ev.voting ? '和投票' : ''}。</p>`;
  else if (me?.canSubmit) submitPanel = `<p class="muted small" role="note">${icon('lock')}${e(me.canSubmit)}</p>`;
  else submitPanel = `<form class="disc-submit js-submit" novalidate aria-labelledby="ev-sub-h"><h2 class="soc-h small" id="ev-sub-h">${icon('upload')}投稿</h2><div class="field"><label class="field__label" for="ev-work">选择作品</label><select id="ev-work" name="workId" required aria-describedby="ev-work-h"><option value="">加载中…</option></select><p class="muted small" id="ev-work-h">只能投已发布、公开的摄影作品或影集；拍摄参数、图注、手记和署名会随作品一起展示。还没有？<a href="${url(`/compose/${ev.topic ? `?topic=${ev.topic.slug}` : ''}`)}">先发布一件</a>。</p></div><div class="field"><label class="field__label" for="ev-note">投稿说明 <span class="muted small">（可选）</span></label><textarea id="ev-note" name="note" rows="2" maxlength="300"></textarea></div><div class="field"><label class="field__label" for="ev-credit">署名补充 <span class="muted small">（可选，如合作者 / 模特）</span></label><input id="ev-credit" name="credit" maxlength="120"></div><p class="field__err js-err" role="alert" hidden></p><button class="btn btn--primary btn--sm" type="submit">${icon('send')}投稿</button></form>`;
  const entryHtml = (x: Entry) => {
    const w = x.work;
    const params = PARAM_KEYS.filter((k) => w.params[k]).slice(0, 5);
    const voted = me?.vote === x.id;
    const canVoteHere = !!member && ev.voting && !x.mine && (ev.phase === 'open' || ev.phase === 'voting');
    return `<li class="disc-entry tile${x.picked ? ' is-picked' : ''}${x.mine ? ' is-mine' : ''}" data-id="${x.id}">
  ${w.media[0] ? `<a class="disc-entry__img" href="${url(`/w/${w.id}/`)}">${img(w.media[0])}</a>` : ''}
  <div class="disc-entry__txt">
    <p class="disc-entry__badges">${x.picked ? `<span class="disc-pick">${icon('star')}精选</span>` : ''}${x.mine ? '<span class="soc-chip">我的投稿</span>' : ''}${x.votes !== null ? `<span class="soc-chip soc-chip--soft">${x.votes} 票</span>` : ''}</p>
    <h3 class="disc-entry__title"><a href="${url(`/w/${w.id}/`)}">${e(w.title || '无题')}</a></h3>
    <p class="small">by <a href="${userPath(w.author.username)}">${e(w.author.nickname)}</a>${x.credit ? ` · ${e(x.credit)}` : ''}</p>
    ${w.caption ? `<p class="small muted">${e(w.caption)}</p>` : ''}
    ${x.note ? `<p class="small disc-entry__note">「${e(x.note)}」</p>` : ''}
    ${params.length ? `<dl class="disc-entry__params">${params.map((k) => `<div><dt>${PARAM_LABEL[k]}</dt><dd>${e(w.params[k]!)}</dd></div>`).join('')}</dl>` : ''}
    <p class="disc-entry__act">${canVoteHere ? `<button type="button" class="btn btn--sm ${voted ? 'btn--soft' : 'btn--primary'} js-vote" data-id="${x.id}" aria-pressed="${voted}"${!voted && (me?.vote || me?.canVote) ? ' disabled' : ''} aria-label="${voted ? `取消投给「${e(w.title || '无题')}」的票` : `投票给「${e(w.title || '无题')}」`}">${icon(voted ? 'check' : 'heart')}<span>${voted ? '已投票' : '投票'}</span></button>` : ''}${x.mine && ev.phase === 'open' ? `<button type="button" class="btn btn--ghost btn--sm js-edit-entry" data-id="${x.id}">${icon('edit')}修改说明</button><button type="button" class="btn btn--ghost btn--sm js-withdraw" data-id="${x.id}">${icon('trash')}撤回</button>` : ''}</p>
  </div>
</li>`;
  };
  box.innerHTML = `<div class="disc">
  <header class="tile tile--full disc-head disc-head--event"><p class="disc-head__kicker muted small"><a href="${url('/events/')}">摄影活动</a> · ${EVENT_KIND_LABEL[ev.kind]}${ev.topic ? ` · <a href="${topicPath(ev.topic.slug)}">#${e(ev.topic.name)}</a>` : ''}</p><h1 class="disc-head__title">${e(ev.title)}</h1><p class="disc-event__meta">${phaseChip(ev.phase)}<span class="muted small">${when(ev.startsAt)} – ${when(ev.endsAt)}${ev.voting && ev.voteEndsAt ? `（投票到 ${when(ev.voteEndsAt)}）` : ''} · ${ev.counts.entries} 件投稿 / ${ev.counts.participants} 人参与</span></p>${ev.intro ? `<p>${e(ev.intro)}</p>` : ''}
    <details class="disc-rules" open><summary>活动规则</summary>${ev.rules ? `<p class="small">${e(ev.rules)}</p>` : ''}<ul class="small"><li>每人最多投稿 ${ev.maxEntries} 件；投稿期内可以修改说明或撤回。</li><li>${voteRule}</li><li>参与即获得「活动参与者」徽章；被选为精选获得「活动精选」徽章。徽章不按票数发放。</li></ul></details>
    ${ev.voting && me?.canVote && (ev.phase === 'open' || ev.phase === 'voting') ? `<p class="muted small" role="note">${icon('lock')}${e(me.canVote)}</p>` : ''}
    ${ev.voting && me?.vote ? `<p class="small" role="note">${icon('check')}你已经投过票了；想改投请先取消原来的投票。</p>` : ''}
    ${ev.resultsAt ? `<p class="disc-results" role="note">${icon('star')}结果已于 ${when(ev.resultsAt)} 公布，精选作品排在最前。</p>` : ''}
    ${ev.phase === 'open' || !member ? submitPanel : ''}
    ${demoNote()}
  </header>
  <section class="tile tile--full dm-room-host js-room" aria-labelledby="room-h" hidden></section>
  <section class="disc-sec" aria-labelledby="ev-gal-h"><h2 class="soc-h disc-sec__h" id="ev-gal-h">${icon('image')}投稿作品 <span class="muted small">${entries.length}</span></h2>
    <p class="visually-hidden js-live" role="status" aria-live="polite"></p>
    ${entries.length ? `<ul class="disc-entries">${entries.map(entryHtml).join('')}</ul>` : empty(ev.phase === 'upcoming' ? '活动还没开始。' : '还没有投稿。', 'camera')}
  </section>
</div>`;
  // L19 活动聊天室：登录后按需加载私信代码（没有开启聊天室时保持隐藏）
  const roomHost = box.querySelector<HTMLElement>('.js-room');
  if (member && roomHost) void import('./dm-client').then((m) => m.mountRoom(roomHost, slug, ctx)).catch(() => undefined);
  const rerender = async (focusSel?: string) => {
    await renderEvent(box, slug, ctx);
    if (focusSel) box.querySelector<HTMLElement>(focusSel)?.focus();
  };
  // 投稿：列出我可以投的作品（已发布 + 公开 + 摄影作品 / 影集，且还没投过）
  const sel = box.querySelector<HTMLSelectElement>('#ev-work');
  if (sel) {
    try {
      const { works } = await disc.myWorks();
      const taken = new Set((me?.entries ?? []).map((x) => x.workId));
      const ok = works.filter((w) => (w.type === 'photo' || w.type === 'album') && w.visibility === 'public' && w.status === 'published' && w.modState === 'ok' && !taken.has(w.id));
      sel.innerHTML = ok.length ? `<option value="">请选择…</option>${ok.map((w) => `<option value="${w.id}">${e(w.title || `作品 #${w.id}`)}${w.type === 'album' ? '（影集）' : ''}</option>`).join('')}` : '<option value="">没有可投稿的公开摄影作品</option>';
    } catch {
      sel.innerHTML = '<option value="">加载作品失败</option>';
    }
  }
  box.querySelector<HTMLFormElement>('.js-submit')?.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const f = evt.currentTarget as HTMLFormElement;
    const err = f.querySelector<HTMLElement>('.js-err')!;
    const workId = Number((f.elements.namedItem('workId') as HTMLSelectElement).value);
    if (!workId) {
      err.hidden = false;
      err.textContent = '请选择要投稿的作品';
      sel?.setAttribute('aria-invalid', 'true');
      sel?.focus();
      return;
    }
    const btn = f.querySelector<HTMLButtonElement>('button[type=submit]')!;
    btn.disabled = true;
    try {
      await disc.submit(slug, { workId, note: (f.elements.namedItem('note') as HTMLTextAreaElement).value, credit: (f.elements.namedItem('credit') as HTMLInputElement).value });
      void ctx.notify('投稿成功！投稿期内还可以修改说明或撤回', 'success');
      await rerender('#ev-gal-h');
    } catch (x) {
      err.hidden = false;
      err.textContent = errMsg(x);
      btn.disabled = false;
    }
  });
  const signal = freshSignal(box);
  box.addEventListener('click', async (evt) => {
    const b = (evt.target as HTMLElement).closest<HTMLButtonElement>('.js-vote, .js-withdraw, .js-edit-entry');
    if (!b || b.disabled) return;
    const id = Number(b.dataset.id);
    try {
      if (b.classList.contains('js-vote')) {
        b.disabled = true;
        if (b.getAttribute('aria-pressed') === 'true') {
          await disc.unvote(slug);
          void ctx.notify('已取消投票', 'info');
        } else {
          await disc.vote(slug, id);
          void ctx.notify('投票成功，谢谢参与', 'success');
        }
        await rerender(`.js-vote[data-id="${id}"]`);
      } else if (b.classList.contains('js-withdraw')) {
        if (!confirm('撤回这件投稿？它收到的票会作废。投稿期内可以重新投。')) return;
        await disc.withdraw(id);
        void ctx.notify('已撤回投稿', 'info');
        await rerender('#ev-gal-h');
      } else {
        const cur = me?.entries.find((x) => x.id === id);
        openEntryEdit(id, cur?.note ?? '', cur?.credit ?? '', b, async (note, credit) => {
          await disc.editEntry(id, { note, credit });
          void ctx.notify('投稿说明已更新', 'success');
          await rerender(`.js-edit-entry[data-id="${id}"]`);
        }, ctx);
      }
    } catch (x) {
      b.disabled = false;
      void ctx.notify(errMsg(x), 'error');
    }
  }, { signal });
  void mine;
}

function openEntryEdit(id: number, note: string, credit: string, opener: HTMLElement, save: (note: string, credit: string) => Promise<void>, ctx: UgcCtx): void {
  const dlg = document.createElement('dialog');
  dlg.className = 'disc-dialog';
  dlg.setAttribute('aria-labelledby', `ee-h-${id}`);
  dlg.innerHTML = `<form method="dialog"><h2 id="ee-h-${id}">${icon('edit')}修改投稿说明</h2><div class="field"><label class="field__label" for="ee-note">投稿说明</label><textarea id="ee-note" name="note" rows="3" maxlength="300">${e(note)}</textarea></div><div class="field"><label class="field__label" for="ee-credit">署名补充</label><input id="ee-credit" name="credit" maxlength="120" value="${e(credit)}"></div><div class="ugc-row"><button class="btn btn--soft" value="cancel" type="submit">取消</button><button class="btn btn--primary" value="save" type="submit">保存</button></div></form>`;
  document.body.append(dlg);
  dlg.addEventListener('close', async () => {
    const f = dlg.querySelector('form')!;
    const ok = dlg.returnValue === 'save';
    const n = (f.elements.namedItem('note') as HTMLTextAreaElement).value;
    const c = (f.elements.namedItem('credit') as HTMLInputElement).value;
    dlg.remove();
    opener.focus();
    if (!ok) return;
    try {
      await save(n, c);
    } catch (x) {
      void ctx.notify(errMsg(x), 'error');
    }
  });
  dlg.showModal();
  dlg.querySelector<HTMLElement>('textarea')?.focus();
}

// ---------------------------------------------------------------- 合集
async function renderCollection(box: HTMLElement, id: number, ctx: UgcCtx): Promise<void> {
  const { collection: c, items, canEdit } = await disc.collection(id);
  document.title = `${c.title} | ${document.title.split('|').pop()?.trim() ?? ''}`;
  const itemHtml = (i: CItem) => {
    const rm = canEdit ? `<button type="button" class="btn btn--ghost btn--sm js-rm" data-kind="${i.kind}" data-ref="${e(i.ref)}" aria-label="从合集移除「${e(i.title || i.ref)}」">${icon('trash')}移除</button>` : '';
    if (i.work) return `<li class="disc-citem disc-citem--work">${card(i.work)}${rm ? `<p class="disc-citem__act">${rm}</p>` : ''}</li>`;
    if (i.unavailable) return `<li class="disc-citem tile"><p class="muted">${icon('lock')}这件作品已不可见（被删除、隐藏或改为不公开）。</p>${rm}</li>`;
    const href = i.kind === 'post' || i.kind === 'essay' ? postPath(i.ref) : i.kind === 'photo' ? url(`/gallery/${i.ref}/`) : '#';
    return `<li class="disc-citem tile"><span class="soc-chip">${COLLECTION_KIND_LABEL[i.kind]}</span><a href="${href}"><b>${e(i.title || i.ref)}</b></a>${rm}</li>`;
  };
  box.innerHTML = `<div class="disc">
  <header class="tile tile--full disc-head"><p class="disc-head__kicker muted small">合集 · ${c.visibility === 'private' ? `${icon('lock')}仅自己可见` : '公开'} · ${c.itemCount} 项</p><h1 class="disc-head__title">${e(c.title)}</h1>${c.description ? `<p>${e(c.description)}</p>` : ''}<p class="small">由 <a href="${userPath(c.owner.username)}">${e(c.owner.nickname)}</a> 整理 · 更新于 ${ago(c.updatedAt)}</p>
  ${canEdit ? `<details class="disc-cedit"><summary>编辑合集</summary><form class="soc-form js-cedit" novalidate><label>名称<input name="title" required maxlength="40" value="${e(c.title)}"></label><label class="soc-form__wide">简介<textarea name="description" rows="2" maxlength="300">${e(c.description)}</textarea></label><fieldset><legend>谁可以看</legend><label class="soc-radio"><input type="radio" name="visibility" value="private"${c.visibility === 'private' ? ' checked' : ''}><span>仅自己</span></label><label class="soc-radio"><input type="radio" name="visibility" value="public"${c.visibility === 'public' ? ' checked' : ''}><span>公开（出现在我的主页）</span></label></fieldset><p class="soc-form__err js-cerr" role="alert"></p><p class="soc-actions"><button class="btn btn--primary btn--sm" type="submit">${icon('check')}保存</button><button class="btn btn--danger btn--sm js-cdel" type="button">${icon('trash')}删除合集</button></p></form></details>` : ''}
  </header>
  <section class="disc-sec" aria-labelledby="c-items-h"><h2 class="soc-h disc-sec__h" id="c-items-h">${icon('folder')}内容</h2>${items.length ? `<ul class="disc-citems">${items.map(itemHtml).join('')}</ul>` : empty(canEdit ? '合集还是空的：在作品页点「加入合集」，或从「我的」里的收藏添加。' : '合集还是空的。', 'folder')}</section>
</div>`;
  box.querySelector<HTMLFormElement>('.js-cedit')?.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const f = evt.currentTarget as HTMLFormElement;
    try {
      await disc.updateCollection(id, { title: (f.elements.namedItem('title') as HTMLInputElement).value, description: (f.elements.namedItem('description') as HTMLTextAreaElement).value, visibility: (f.querySelector<HTMLInputElement>('input[name=visibility]:checked')?.value ?? 'private') });
      void ctx.notify('合集已保存', 'success');
      await renderCollection(box, id, ctx);
    } catch (x) {
      f.querySelector<HTMLElement>('.js-cerr')!.textContent = errMsg(x);
    }
  });
  const signal = freshSignal(box);
  box.addEventListener('click', async (evt) => {
    const b = (evt.target as HTMLElement).closest<HTMLButtonElement>('.js-rm, .js-cdel');
    if (!b) return;
    try {
      if (b.classList.contains('js-cdel')) {
        if (!confirm('删除这个合集？合集里的作品和文章本身不受影响。')) return;
        await disc.deleteCollection(id);
        void ctx.notify('合集已删除', 'info');
        ctx.navigate?.(url('/me/'));
        return;
      }
      await disc.removeItem(id, b.dataset.kind!, b.dataset.ref!);
      void ctx.notify('已从合集移除', 'info');
      await renderCollection(box, id, ctx);
      box.querySelector<HTMLElement>('#c-items-h')?.focus();
    } catch (x) {
      void ctx.notify(errMsg(x), 'error');
    }
  }, { signal });
}

/** 「加入合集」对话框：勾选 / 取消我的合集，或新建一个（默认私密）。 */
export function openCollect(kind: CollectionKind, ref: string, title: string, ctx: UgcCtx, opener: HTMLElement): void {
  if (!currentMember()) return void ctx.notify('登录后才能使用合集', 'warning');
  const dlg = document.createElement('dialog');
  dlg.className = 'disc-dialog';
  dlg.setAttribute('aria-labelledby', 'col-h');
  dlg.innerHTML = `<div class="disc-dialog__body"><h2 id="col-h">${icon('folder')}加入合集</h2><p class="muted small">「${e(title)}」</p><ul class="disc-cpick js-cpick" aria-busy="true"><li class="muted">加载中…</li></ul>
<form class="disc-cnew js-cnew" novalidate><h3 class="small">新建合集</h3><div class="field"><label class="field__label" for="col-new">名称</label><input id="col-new" name="title" maxlength="40" required></div><label class="soc-check"><input type="checkbox" name="public"><span>公开（出现在我的主页）<small class="muted">不勾选 = 仅自己可见</small></span></label><p class="field__err js-nerr" role="alert" hidden></p><button class="btn btn--soft btn--sm" type="submit">${icon('plus')}新建并加入</button></form>
<p class="ugc-row"><button class="btn btn--primary js-close" type="button">完成</button></p><p class="visually-hidden js-clive" role="status" aria-live="polite"></p></div>`;
  document.body.append(dlg);
  const list = dlg.querySelector<HTMLElement>('.js-cpick')!;
  const live = dlg.querySelector<HTMLElement>('.js-clive')!;
  const load = async () => {
    try {
      const { collections } = await disc.myCollections(kind, ref);
      list.innerHTML = collections.length
        ? collections.map((c) => `<li><label class="soc-check"><input type="checkbox" class="js-cbox" value="${c.id}"${c.contains ? ' checked' : ''}><span>${e(c.title)} <small class="muted">${c.visibility === 'private' ? '仅自己' : '公开'} · ${c.itemCount} 项</small></span></label></li>`).join('')
        : '<li class="muted small">还没有合集，在下面新建一个。</li>';
    } catch (x) {
      list.innerHTML = `<li class="muted">${e(errMsg(x))}</li>`;
    } finally {
      list.removeAttribute('aria-busy');
    }
  };
  dlg.addEventListener('change', async (ev) => {
    const t = ev.target as HTMLInputElement;
    if (!t.classList.contains('js-cbox')) return;
    t.disabled = true;
    try {
      if (t.checked) await disc.addItem(Number(t.value), { kind, ref, title });
      else await disc.removeItem(Number(t.value), kind, ref);
      live.textContent = t.checked ? '已加入合集' : '已从合集移除';
    } catch (x) {
      t.checked = !t.checked;
      void ctx.notify(errMsg(x), 'error');
    } finally {
      t.disabled = false;
    }
  });
  dlg.querySelector<HTMLFormElement>('.js-cnew')!.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget as HTMLFormElement;
    const err = f.querySelector<HTMLElement>('.js-nerr')!;
    const inp = f.elements.namedItem('title') as HTMLInputElement;
    if (!inp.value.trim()) {
      err.hidden = false;
      err.textContent = '请输入合集名称';
      inp.setAttribute('aria-invalid', 'true');
      return inp.focus();
    }
    try {
      const { collection } = await disc.createCollection({ title: inp.value, visibility: (f.elements.namedItem('public') as HTMLInputElement).checked ? 'public' : 'private' });
      await disc.addItem(collection.id, { kind, ref, title });
      inp.value = '';
      err.hidden = true;
      inp.removeAttribute('aria-invalid');
      live.textContent = `已新建合集「${collection.title}」并加入`;
      await load();
    } catch (x) {
      err.hidden = false;
      err.textContent = errMsg(x);
    }
  });
  const close = () => dlg.close();
  dlg.querySelector('.js-close')!.addEventListener('click', close);
  dlg.addEventListener('close', () => {
    dlg.remove();
    opener.focus();
  });
  dlg.showModal();
  void load().then(() => dlg.querySelector<HTMLElement>('.js-cbox, #col-new')?.focus());
}

// ---------------------------------------------------------------- 个人主页 / 「我的」扩展
/** 主页：社区徽章（与站长授予的 DIY 徽章分开显示）+ 创作者认证 + 公开合集。 */
export async function profileExtras(box: HTMLElement, username: string, self: boolean): Promise<void> {
  const anchor = box.querySelector('.soc-works');
  if (!anchor) return;
  const [b, cols] = await Promise.all([disc.badges(username), disc.userCollections(username)]);
  const sec = document.createElement('div');
  sec.className = 'disc-profile';
  sec.innerHTML = `${b.verified || b.community.length ? `<section class="tile tile--full disc-cbadges" aria-labelledby="cb-h"><h2 class="soc-h" id="cb-h">${icon('verified')}社区徽章</h2>${b.verified ? `<p class="disc-verified disc-verified--lg">${icon('verified')}<span>认证创作者：${e(b.verified.label)}</span></p>` : ''}${b.community.length ? `<ul class="disc-blist">${b.community.map((x) => `<li class="disc-badge"><span class="disc-badge__ic" aria-hidden="true">${x.icon}</span><span><b>${e(x.label)}</b>${x.count > 1 ? ` <span class="muted small">×${x.count}</span>` : ''}<small class="muted">${e(x.desc)}</small></span></li>`).join('')}</ul>` : ''}<p class="muted small">社区徽章纪念第一次发布、参加活动、被精选和帮助别人；不按点赞或票数发放，也没有签到。</p></section>` : ''}
${cols.collections.length || self ? `<section class="tile tile--full" aria-labelledby="pc-h"><h2 class="soc-h" id="pc-h">${icon('folder')}${self ? '我的合集' : '公开合集'}</h2>${cols.collections.length ? `<ul class="disc-clist">${cols.collections.map((c) => `<li><a href="${collectionPath(c.id)}"><b>${e(c.title)}</b></a><span class="muted small">${c.visibility === 'private' ? `${icon('lock')}仅自己 · ` : ''}${c.itemCount} 项</span></li>`).join('')}</ul>` : '<p class="muted small">还没有合集。</p>'}</section>` : ''}`;
  anchor.after(sec);
}

/** 「我的」：合集（新建 / 从云端收藏添加）、订阅的话题、活动投稿。 */
export async function meExtras(box: HTMLElement, ctx: UgcCtx): Promise<void> {
  const slot = box.querySelector<HTMLElement>('.js-disc-me');
  if (!slot) return;
  const draw = async () => {
    const [cols, tps, ents] = await Promise.all([disc.myCollections(), disc.myTopics(), disc.myEntries()]);
    slot.hidden = false;
    slot.className = 'js-disc-me disc-me';
    slot.innerHTML = `<section class="tile tile--half" aria-labelledby="me-col-h"><h2 class="soc-h" id="me-col-h">${icon('folder')}我的合集</h2><p class="muted small">把作品、文章和照片整理成公开或私密的合集；私密合集只有你能看到。</p>${cols.collections.length ? `<ul class="disc-clist">${cols.collections.map((c) => `<li><a href="${collectionPath(c.id)}"><b>${e(c.title)}</b></a><span class="muted small">${c.visibility === 'private' ? '仅自己' : '公开'} · ${c.itemCount} 项</span></li>`).join('')}</ul>` : '<p class="muted small">还没有合集。</p>'}
<form class="soc-form js-mcnew" novalidate><label>新合集名称<input name="title" maxlength="40" required></label><label class="soc-check"><input type="checkbox" name="public"><span>公开</span></label><p class="soc-form__err js-mcerr" role="alert"></p><button class="btn btn--soft btn--sm" type="submit">${icon('plus')}新建合集</button></form>
${cols.collections.length ? `<details class="disc-frombm"><summary>从云端收藏添加</summary><div class="js-frombm"><p class="muted small">加载中…</p></div></details>` : ''}</section>
<section class="tile tile--half" aria-labelledby="me-tp-h"><h2 class="soc-h" id="me-tp-h">${icon('tag')}订阅的话题</h2>${tps.topics.length ? `<ul class="disc-tlist">${tps.topics.map((t) => `<li><a href="${topicPath(t.slug)}">#${e(t.name)}</a>${subBtn(t)}</li>`).join('')}</ul>` : `<p class="muted small">还没有订阅话题。<a href="${url('/t/')}">去看看有哪些话题</a>，订阅后新作品会出现在你的「关注」动态里。</p>`}
<h3 class="soc-h small">${icon('camera')}我的活动投稿</h3>${ents.entries.length ? `<ul class="disc-clist">${ents.entries.map((x) => `<li><a href="${eventPath(x.event.slug)}">${e(x.event.title)}</a><span class="muted small">${x.picked ? '⭐ 精选 · ' : ''}作品 #${x.workId}</span></li>`).join('')}</ul>` : `<p class="muted small">还没有投稿。<a href="${url('/events/')}">看看正在进行的摄影活动</a>。</p>`}</section>`;
    slot.querySelector<HTMLFormElement>('.js-mcnew')!.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.currentTarget as HTMLFormElement;
      try {
        await disc.createCollection({ title: (f.elements.namedItem('title') as HTMLInputElement).value, visibility: (f.elements.namedItem('public') as HTMLInputElement).checked ? 'public' : 'private' });
        void ctx.notify('合集已创建', 'success');
        await draw();
        slot.querySelector<HTMLElement>('#me-col-h')?.focus();
      } catch (x) {
        f.querySelector<HTMLElement>('.js-mcerr')!.textContent = errMsg(x);
      }
    });
    slot.querySelector<HTMLDetailsElement>('.disc-frombm')?.addEventListener('toggle', async (ev) => {
      const d = ev.currentTarget as HTMLDetailsElement;
      if (!d.open) return;
      const holder = d.querySelector<HTMLElement>('.js-frombm')!;
      try {
        const bm = await request<{ bookmarks: { kind: string; ref: string; title: string }[] }>('/api/social/bookmarks', { headers: auth() });
        holder.innerHTML = bm.bookmarks.length
          ? `<form class="soc-form js-bmadd"><label>收藏<select name="bm">${bm.bookmarks.map((b, i) => `<option value="${i}">${e(b.title || b.ref)}（${COLLECTION_KIND_LABEL[(b.kind as CollectionKind) ?? 'post'] ?? '文章'}）</option>`).join('')}</select></label><label>加入合集<select name="col">${cols.collections.map((c) => `<option value="${c.id}">${e(c.title)}</option>`).join('')}</select></label><button class="btn btn--soft btn--sm" type="submit">${icon('plus')}添加</button></form>`
          : '<p class="muted small">云端收藏还是空的。</p>';
        holder.querySelector<HTMLFormElement>('.js-bmadd')?.addEventListener('submit', async (e2) => {
          e2.preventDefault();
          const f = e2.currentTarget as HTMLFormElement;
          const b = bm.bookmarks[Number((f.elements.namedItem('bm') as HTMLSelectElement).value)]!;
          try {
            await disc.addItem(Number((f.elements.namedItem('col') as HTMLSelectElement).value), { kind: b.kind, ref: b.ref, title: b.title });
            void ctx.notify('已加入合集', 'success');
          } catch (x) {
            void ctx.notify(errMsg(x), 'error');
          }
        });
      } catch (x) {
        holder.innerHTML = `<p class="muted small">${e(errMsg(x))}</p>`;
      }
    });
  };
  bindSubscribe(slot, ctx);
  try {
    await draw();
  } catch (x) {
    if (!(x instanceof ApiError)) throw x;
  }
}
