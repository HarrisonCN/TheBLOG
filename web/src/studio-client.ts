/**
 * L18 摄影与创作工具前端（按需加载：只在 /projects/、/p/:slug/、/f/、/f/:slug/、/me/stats/ 才下载；
 * 作品页有共同作者 / 有协作权限时、「我的」页面和用户主页再按需拉一次）。
 * 摄影专题（照片 + 文字的长页面）、EXIF 筛选（手机 / 相机、焦段、光圈、ISO）、项目页（开发日志、版本、关联作品、成员）、
 * 共同作者（邀请、角色、修订历史与恢复、多人图片删除确认）、创作者数据中心（只有本人可见的按天汇总数据）。
 * 接口：/api/social/{works/*,projects,features,me/stats,invitations,views}（演示站由浏览器内 mock 实现）。所有权限判断都在服务端。
 */
import './studio.css';
import { ApiError, DEMO, request } from './api';
import { currentMember } from './community';
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { postPath, url, userPath } from './render';
import { renderCommentHtml } from './comment-core';
import { ago, avatar, card, confirmMediaRemoval, errMsg, gate, img, recordView, type UgcCtx, type Work } from './ugc-client';
import {
  APERTURE_BUCKETS,
  COLLAB_ROLE_LABEL,
  COLLAB_STATUS_LABEL,
  DEVICE_LABEL,
  FOCAL_BUCKETS,
  ISO_BUCKETS,
  LOG_KIND_LABEL,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUSES,
  STAT_RANGES,
  type CollabRole,
  type CollabStatus,
  type DeviceKind,
  type ExifFacets,
  type FeatureBlock,
  type LogKind,
  type ProjectStatus,
} from './studio-core';

interface Card { username: string; nickname: string; avatarUrl: string; bio: string }
interface ProjectCard { slug: string; title: string; tagline: string; status: ProjectStatus; coverUrl: string; visibility: 'public' | 'private'; owner: Card; repo: { url: string; owner: string; name: string } | null; latestRelease: { version: string; at: string } | null; counts: { logs: number; links: number }; updatedAt: string }
interface Member { user: Card; role: CollabRole; label: string; status: CollabStatus }
interface Log { id: number; kind: LogKind; title: string; body: string; version: string; author: Card | null; createdAt: string; updatedAt: string; canEdit: boolean }
type Link = { kind: 'work'; ref: string; work: Work } | { kind: 'post'; ref: string; title: string; excerpt: string; date: string | null };
interface Project extends ProjectCard { description: string; homepageUrl: string; repoUrl: string; createdAt: string; members: Member[]; logs: Log[]; links: Link[] }
interface ProjectMine { role: 'owner' | CollabRole | null; status: CollabStatus | null; canEdit: boolean; canManage: boolean }
interface FeatureCard { slug: string; title: string; dek: string; status: 'draft' | 'published'; owner: Card; cover: { url: string; alt: string; width: number; height: number } | null; works: number; publishedAt: string | null; updatedAt: string }
type ShownBlock = { t: 'text'; text: string } | { t: 'work'; caption: string; work: Work };
interface Feature extends FeatureCard { blocks: ShownBlock[]; raw?: FeatureBlock[]; hidden: number }
interface Invitation { kind: 'work' | 'project'; id: number; title: string; role: CollabRole; label: string; from: Card | null; createdAt: string; href: string }
interface Revision { rev: number; editor: Card | null; note: string; createdAt: string; changes: string[]; title: string; mediaCount: number }
interface Series { day: string; n: number }
interface Stats {
  days: number;
  private: { views: { total: number; series: Series[] }; top: { kind: string; ref: string; views: number; title: string; href: string }[]; referrers: { domain: string; n: number }[] };
  trends: { reactions: { total: number; series: Series[] }; bookmarks: { total: number; series: Series[] }; comments: { total: number; series: Series[] }; followers: { total: number; gained: number; series: Series[] } };
  public: { reactions: number; bookmarks: number; comments: number; followers: number };
  privacy: string;
}

// ---------------------------------------------------------------- 请求
const auth = (): Record<string, string> => {
  const m = currentMember();
  return m ? { authorization: `Bearer ${m.token}` } : {};
};
const JH = { 'content-type': 'application/json' };
const send = <T>(path: string, method: string, body?: unknown) => request<T>(path, { method, headers: { ...(body === undefined ? {} : JH), ...auth() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const get = <T>(path: string) => request<T>(path, { headers: auth() });
type ProjectRes = { project: Project; mine: ProjectMine };
type FeatureRes = { feature: Feature; mine: { canEdit: boolean } };
export const studio = {
  projects: () => get<{ projects: ProjectCard[] }>('/api/social/projects'),
  myProjects: () => get<{ projects: ProjectCard[] }>('/api/social/me/projects'),
  userProjects: (u: string) => get<{ projects: ProjectCard[] }>(`/api/social/users/${encodeURIComponent(u)}/projects`),
  project: (slug: string) => get<ProjectRes>(`/api/social/projects/${slug}`),
  createProject: (b: unknown) => send<ProjectRes>('/api/social/projects', 'POST', b),
  updateProject: (slug: string, b: unknown) => send<ProjectRes>(`/api/social/projects/${slug}`, 'PATCH', b),
  deleteProject: (slug: string) => send<{ deleted: boolean }>(`/api/social/projects/${slug}`, 'DELETE'),
  addLog: (slug: string, b: unknown) => send<ProjectRes>(`/api/social/projects/${slug}/logs`, 'POST', b),
  deleteLog: (id: number) => send<ProjectRes>(`/api/social/projects/logs/${id}`, 'DELETE'),
  setLinks: (slug: string, links: { kind: string; ref: string }[]) => send<ProjectRes>(`/api/social/projects/${slug}/links`, 'PUT', { links }),
  inviteMember: (slug: string, b: unknown) => send<ProjectRes>(`/api/social/projects/${slug}/members`, 'POST', b),
  removeMember: (slug: string, u: string) => send<ProjectRes | { left: true }>(`/api/social/projects/${slug}/members/${encodeURIComponent(u)}`, 'DELETE'),
  features: (mine = false) => get<{ features: FeatureCard[] }>(`/api/social/features${mine ? '?mine=1' : ''}`),
  feature: (slug: string) => get<FeatureRes>(`/api/social/features/${slug}`),
  createFeature: (b: unknown) => send<FeatureRes>('/api/social/features', 'POST', b),
  updateFeature: (slug: string, b: unknown) => send<FeatureRes>(`/api/social/features/${slug}`, 'PATCH', b),
  publishFeature: (slug: string, on: boolean) => send<FeatureRes>(`/api/social/features/${slug}/publish`, on ? 'POST' : 'DELETE'),
  deleteFeature: (slug: string) => send<{ deleted: boolean }>(`/api/social/features/${slug}`, 'DELETE'),
  facets: () => get<{ facets: ExifFacets; total: number }>('/api/social/works/exif-facets'),
  exifWorks: (qs: string, cursor?: string | null) => get<{ works: Work[]; nextCursor: string | null }>(`/api/social/works?tab=latest&limit=12${qs ? `&${qs}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  coauthors: (id: number) => get<{ owner: Card; coauthors: Member[]; mine: { role: string | null; status: CollabStatus | null; can: Record<string, boolean> } }>(`/api/social/works/${id}/coauthors`),
  inviteCoauthor: (id: number, b: unknown) => send<unknown>(`/api/social/works/${id}/coauthors`, 'POST', b),
  removeCoauthor: (id: number, u: string) => send<unknown>(`/api/social/works/${id}/coauthors/${encodeURIComponent(u)}`, 'DELETE'),
  revisions: (id: number) => get<{ revisions: Revision[]; current: number }>(`/api/social/works/${id}/revisions`),
  restore: (id: number, rev: number, confirm = false) => send<{ work: Work; restoredFrom: number }>(`/api/social/works/${id}/revisions/${rev}/restore`, 'POST', confirm ? { confirmMediaRemoval: true } : {}),
  invitations: () => get<{ invitations: Invitation[] }>('/api/social/me/invitations'),
  respond: (kind: string, id: number, accept: boolean) => send<{ status: string }>(`/api/social/invitations/${kind}/${id}/${accept ? 'accept' : 'decline'}`, 'POST'),
  stats: (days: number) => get<Stats>(`/api/social/me/stats?days=${days}`),
  myWorks: () => get<{ works: Work[] }>('/api/social/me/works?status=published&limit=50'),
};

// ---------------------------------------------------------------- 小部件
const LISTENERS = new WeakMap<HTMLElement, AbortController>();
function freshSignal(box: HTMLElement): AbortSignal {
  LISTENERS.get(box)?.abort();
  const ac = new AbortController();
  LISTENERS.set(box, ac);
  return ac.signal;
}
let meName: Promise<string> | null = null;
/** 当前登录者的用户名（社交资料里的，不是邮箱登录名）。 */
const myUsername = (): Promise<string> => (meName ??= get<{ profile: { username: string } }>('/api/social/me').then((r) => r.profile.username).catch(() => ((meName = null), '')));
const DATE = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'Asia/Shanghai' });
const fmtDay = (iso: string) => DATE.format(new Date(iso));
const projectPath = (slug: string) => url(`/p/${slug}/`);
const featurePath = (slug: string) => url(`/f/${slug}/`);
const demoNote = (what: string) => (DEMO ? `<p class="st-demo muted small" role="note">${icon('sparkles')}演示站：${what}都由虚构的示例用户生成，数据只保存在你的浏览器里。</p>` : '');
const empty = (msg: string, ic = 'image') => `<div class="soc-gate tile tile--full">${icon(ic)}<p class="muted">${msg}</p></div>`;
const statusChip = (s: ProjectStatus) => `<span class="st-status st-status--${s}">${PROJECT_STATUS_LABEL[s]}</span>`;
const fieldErr = (f: HTMLFormElement, x: unknown) => {
  const slot = f.querySelector<HTMLElement>('.js-err');
  const det = x instanceof ApiError && Array.isArray(x.details) ? (x.details as { path: string; message: string }[])[0] : null;
  const msg = det ? det.message : errMsg(x);
  if (slot) {
    slot.textContent = msg;
    slot.hidden = false;
    slot.setAttribute('tabindex', '-1');
    slot.focus();
  }
  const name = det?.path?.split('.')[0];
  const ctl = name ? f.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`) : null;
  if (ctl) {
    ctl.setAttribute('aria-invalid', 'true');
    ctl.focus();
  }
};
const clearErr = (f: HTMLFormElement) => {
  f.querySelectorAll('[aria-invalid]').forEach((x) => x.removeAttribute('aria-invalid'));
  const slot = f.querySelector<HTMLElement>('.js-err');
  if (slot) {
    slot.hidden = true;
    slot.textContent = '';
  }
};
const val = (f: HTMLFormElement, n: string) => ((f.elements.namedItem(n) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null)?.value ?? '').trim();

function projectCard(p: ProjectCard, level = 3): string {
  return `<article class="st-pcard tile" aria-labelledby="pj-${e(p.slug)}">
  <p class="st-pcard__meta">${statusChip(p.status)}${p.visibility === 'private' ? `<span class="soc-chip soc-chip--soft">${icon('lock')}仅成员</span>` : ''}${p.latestRelease ? `<span class="soc-chip">${e(p.latestRelease.version)}</span>` : ''}</p>
  <h${level} class="st-pcard__title" id="pj-${e(p.slug)}"><a href="${projectPath(p.slug)}">${e(p.title)}</a></h${level}>
  ${p.tagline ? `<p class="muted small st-pcard__tag">${e(p.tagline)}</p>` : ''}
  <p class="st-pcard__foot muted small"><a class="st-owner" href="${userPath(p.owner.username)}">${avatar(p.owner, 'soc-av soc-av--sm')}${e(p.owner.nickname)}</a><span>${p.counts.logs} 条日志 · ${p.counts.links} 件关联</span></p>
</article>`;
}
function featureCard(f: FeatureCard, level = 3): string {
  return `<article class="st-fcard tile" aria-labelledby="ft-${e(f.slug)}">${f.cover ? `<a class="st-fcard__cover" href="${featurePath(f.slug)}" tabindex="-1" aria-hidden="true">${img({ url: f.cover.url, alt: '', width: f.cover.width, height: f.cover.height })}</a>` : ''}
  <div class="st-fcard__txt"><p class="st-pcard__meta">${f.status === 'draft' ? '<span class="soc-chip soc-chip--soft">草稿</span>' : ''}<span class="muted small">${f.works} 张作品</span></p>
  <h${level} class="st-fcard__title" id="ft-${e(f.slug)}"><a href="${featurePath(f.slug)}">${e(f.title)}</a></h${level}>
  ${f.dek ? `<p class="muted small">${e(f.dek)}</p>` : ''}
  <p class="muted small"><a class="st-owner" href="${userPath(f.owner.username)}">${avatar(f.owner, 'soc-av soc-av--sm')}${e(f.owner.nickname)}</a></p></div>
</article>`;
}

// ---------------------------------------------------------------- 挂载
export async function mountStudio(box: HTMLElement, view: string, ctx: UgcCtx): Promise<void> {
  if (view === 'projects') return renderProjects(box, ctx);
  if (view === 'project') return renderProject(box, box.dataset.slug ?? '', ctx);
  if (view === 'features') return renderFeatures(box, ctx);
  if (view === 'feature') return renderFeature(box, box.dataset.slug ?? '', ctx);
  if (view === 'mystats') return renderStats(box);
}

// ---------------------------------------------------------------- 项目列表
async function renderProjects(box: HTMLElement, ctx: UgcCtx): Promise<void> {
  const me = currentMember();
  const [all, mine] = await Promise.all([studio.projects(), me ? studio.myProjects() : Promise.resolve(null)]);
  box.innerHTML = `<div class="st">
  ${demoNote('项目、日志和作品')}
  ${
    me
      ? `<section class="tile tile--full st-sec" aria-labelledby="pj-mine-h"><h2 class="soc-h" id="pj-mine-h">${icon('briefcase')}我的项目</h2>
    ${mine?.projects.length ? `<div class="st-grid">${mine.projects.map((p) => projectCard(p)).join('')}</div>` : '<p class="muted small">还没有项目。项目适合长期维护的东西：一套调色预设、一个开源工具、一组持续更新的照片。</p>'}
    <details class="st-new"><summary>${icon('plus')}新建项目</summary>${projectForm(null)}</details></section>`
      : `<p class="muted small st-hint"><a href="${url('/join/')}">登录</a>后可以创建自己的项目。</p>`
  }
  <section class="st-sec" aria-labelledby="pj-all-h"><h2 class="soc-h st-sec__h" id="pj-all-h">${icon('sparkles')}最近更新</h2>
  ${all.projects.length ? `<div class="st-grid">${all.projects.map((p) => projectCard(p)).join('')}</div>` : empty('还没有公开的项目。', 'briefcase')}</section>
</div>`;
  const signal = freshSignal(box);
  box.addEventListener(
    'submit',
    async (ev) => {
      const f = (ev.target as HTMLElement).closest<HTMLFormElement>('.js-pform');
      if (!f) return;
      ev.preventDefault();
      clearErr(f);
      try {
        const r = await studio.createProject(readProject(f));
        void ctx.notify('项目已创建', 'success');
        ctx.navigate?.(projectPath(r.project.slug));
      } catch (x) {
        fieldErr(f, x);
      }
    },
    { signal },
  );
}
function projectForm(p: Project | null, owner = true): string {
  const id = p ? 'pe' : 'pn';
  const f = (name: string, label: string, v: string, attrs = '', hint = '') =>
    `<div class="field"><label class="field__label" for="${id}-${name}">${label}</label><input id="${id}-${name}" name="${name}" value="${e(v)}" ${attrs}${hint ? ` aria-describedby="${id}-${name}-h"` : ''}>${hint ? `<p class="muted small" id="${id}-${name}-h">${hint}</p>` : ''}</div>`;
  return `<form class="soc-form st-form js-pform" novalidate>
  ${f('title', '项目名称 *', p?.title ?? '', 'maxlength="60" required aria-required="true"')}
  ${p ? '' : f('slug', '地址 *', '', 'maxlength="40" required aria-required="true" pattern="[a-z0-9-]+" autocapitalize="off"', '小写字母、数字和短横线，会成为 /p/地址/；创建后不能修改。')}
  ${f('tagline', '一句话介绍', p?.tagline ?? '', 'maxlength="120"')}
  <div class="field"><label class="field__label" for="${id}-description">详细说明</label><textarea id="${id}-description" name="description" rows="5" maxlength="4000">${e(p?.description ?? '')}</textarea></div>
  ${f('repoUrl', 'GitHub 仓库', p?.repoUrl ?? '', 'maxlength="200" inputmode="url" placeholder="https://github.com/owner/repo"', '只接受 https://github.com/所有者/仓库。')}
  ${f('homepageUrl', '主页', p?.homepageUrl ?? '', 'maxlength="200" inputmode="url" placeholder="https://"')}
  <div class="st-row">
    <div class="field"><label class="field__label" for="${id}-status">状态</label><select id="${id}-status" name="status">${PROJECT_STATUSES.map((s) => `<option value="${s}"${(p?.status ?? 'active') === s ? ' selected' : ''}>${PROJECT_STATUS_LABEL[s]}</option>`).join('')}</select></div>
    ${owner ? `<div class="field"><label class="field__label" for="${id}-visibility">谁可以看</label><select id="${id}-visibility" name="visibility"><option value="public"${p?.visibility !== 'private' ? ' selected' : ''}>所有人</option><option value="private"${p?.visibility === 'private' ? ' selected' : ''}>只有项目成员</option></select></div>` : ''}
  </div>
  <p class="field__err js-err" role="alert" hidden></p>
  <button class="btn btn--primary btn--sm" type="submit">${icon(p ? 'check' : 'plus')}${p ? '保存项目' : '创建项目'}</button>
</form>`;
}
function readProject(f: HTMLFormElement): Record<string, string> {
  const o: Record<string, string> = {};
  for (const k of ['title', 'slug', 'tagline', 'description', 'repoUrl', 'homepageUrl', 'status', 'visibility']) if (f.elements.namedItem(k)) o[k] = val(f, k);
  return o;
}

// ---------------------------------------------------------------- 项目页
async function renderProject(box: HTMLElement, slug: string, ctx: UgcCtx): Promise<void> {
  let { project: p, mine } = await studio.project(slug);
  const draw = () => {
    document.title = `${p.title} | ${document.title.split('|').pop()?.trim() ?? ''}`;
    const accepted = p.members.filter((m) => m.status === 'accepted');
    const others = p.members.filter((m) => m.status !== 'accepted');
    const releases = p.logs.filter((l) => l.kind === 'release');
    box.innerHTML = `<div class="st">
<article class="st-head tile tile--full" aria-labelledby="pj-title">
  <p class="st-head__kicker muted small"><a href="${url('/projects/')}">创作者项目</a></p>
  <p class="st-pcard__meta">${statusChip(p.status)}${p.visibility === 'private' ? `<span class="soc-chip soc-chip--soft">${icon('lock')}仅成员可见</span>` : ''}${p.latestRelease ? `<span class="soc-chip">最新版本 ${e(p.latestRelease.version)}</span>` : ''}</p>
  <h1 class="st-head__title" id="pj-title">${e(p.title)}</h1>
  ${p.tagline ? `<p class="st-head__dek">${e(p.tagline)}</p>` : ''}
  <p class="st-people"><a class="st-owner" href="${userPath(p.owner.username)}">${avatar(p.owner, 'soc-av')}<span><b>${e(p.owner.nickname)}</b><span class="muted small"> 发起人</span></span></a>${accepted.map((m) => `<a class="st-owner" href="${userPath(m.user.username)}">${avatar(m.user, 'soc-av')}<span><b>${e(m.user.nickname)}</b><span class="muted small"> ${e(m.label || COLLAB_ROLE_LABEL[m.role])}</span></span></a>`).join('')}</p>
  <p class="st-links">${p.repo ? `<a class="btn btn--soft btn--sm" href="${e(p.repo.url)}" rel="noopener nofollow ugc" target="_blank">${icon('github')}${e(p.repo.owner)}/${e(p.repo.name)}</a>` : ''}${p.homepageUrl ? `<a class="btn btn--ghost btn--sm" href="${e(p.homepageUrl)}" rel="noopener nofollow ugc" target="_blank">${icon('external')}主页</a>` : ''}</p>
  ${p.description ? `<div class="prose st-desc">${renderCommentHtml(p.description)}</div>` : ''}
</article>
${releases.length ? `<section class="tile tile--full st-sec" aria-labelledby="pj-rel-h"><h2 class="soc-h" id="pj-rel-h">${icon('flag')}版本</h2><ol class="st-versions">${releases.map((l) => `<li><b>${e(l.version)}</b><span class="muted small">${fmtDay(l.createdAt)}</span><span>${e(l.title)}</span></li>`).join('')}</ol></section>` : ''}
<section class="tile tile--full st-sec" aria-labelledby="pj-log-h"><h2 class="soc-h" id="pj-log-h">${icon('history')}开发日志</h2>
  ${mine.canEdit ? `<details class="st-new"><summary>${icon('plus')}写一条日志</summary><form class="soc-form st-form js-logform" novalidate>
    <div class="st-row"><div class="field"><label class="field__label" for="lg-kind">类型</label><select id="lg-kind" name="kind"><option value="log">${LOG_KIND_LABEL.log}</option><option value="release">${LOG_KIND_LABEL.release}</option></select></div>
    <div class="field"><label class="field__label" for="lg-version">版本号（发布时必填）</label><input id="lg-version" name="version" maxlength="30" placeholder="v1.2.0"></div></div>
    <div class="field"><label class="field__label" for="lg-title">标题 *</label><input id="lg-title" name="title" maxlength="80" required aria-required="true"></div>
    <div class="field"><label class="field__label" for="lg-body">内容</label><textarea id="lg-body" name="body" rows="4" maxlength="4000"></textarea></div>
    <p class="field__err js-err" role="alert" hidden></p><button class="btn btn--primary btn--sm" type="submit">${icon('send')}发布日志</button></form></details>` : ''}
  ${
    p.logs.length
      ? `<ol class="st-logs">${p.logs
          .map(
            (l) =>
              `<li class="st-log st-log--${l.kind}"><article aria-labelledby="lg-${l.id}"><p class="st-log__meta muted small"><span class="soc-chip${l.kind === 'release' ? '' : ' soc-chip--soft'}">${l.kind === 'release' ? `${icon('flag')}${e(l.version)}` : LOG_KIND_LABEL.log}</span><time datetime="${e(l.createdAt)}">${fmtDay(l.createdAt)}</time>${l.author ? `<span>· ${e(l.author.nickname)}</span>` : ''}</p><h3 class="st-log__title" id="lg-${l.id}">${e(l.title)}</h3>${l.body ? `<div class="prose small">${renderCommentHtml(l.body)}</div>` : ''}${l.canEdit ? `<button type="button" class="btn btn--ghost btn--sm js-dellog" data-id="${l.id}" aria-label="删除日志：${e(l.title)}">${icon('trash')}删除</button>` : ''}</article></li>`,
          )
          .join('')}</ol>`
      : '<p class="muted small">还没有日志。</p>'
  }
</section>
<section class="tile tile--full st-sec" aria-labelledby="pj-link-h"><h2 class="soc-h" id="pj-link-h">${icon('link')}关联作品与文章</h2>
  ${
    p.links.length
      ? `<ul class="st-linked">${p.links
          .map((l) =>
            l.kind === 'work'
              ? `<li>${card(l.work)}${mine.canEdit ? `<button type="button" class="btn btn--ghost btn--sm js-unlink" data-kind="work" data-ref="${e(l.ref)}" aria-label="取消关联作品 ${e(l.work.title || `#${l.ref}`)}">${icon('close')}取消关联</button>` : ''}</li>`
              : `<li class="st-postlink tile"><a href="${postPath(l.ref)}"><b>${e(l.title)}</b></a>${l.excerpt ? `<p class="muted small">${e(l.excerpt)}</p>` : ''}${mine.canEdit ? `<button type="button" class="btn btn--ghost btn--sm js-unlink" data-kind="post" data-ref="${e(l.ref)}" aria-label="取消关联文章 ${e(l.title)}">${icon('close')}取消关联</button>` : ''}</li>`,
          )
          .join('')}</ul>`
      : '<p class="muted small">还没有关联的作品或文章。</p>'
  }
  ${mine.canEdit ? `<details class="st-new js-linkbox"><summary>${icon('plus')}关联作品或站长文章</summary><form class="soc-form st-form js-linkform" novalidate><div class="st-row"><div class="field"><label class="field__label" for="lk-work">我的作品</label><select id="lk-work" name="work"><option value="">加载中…</option></select></div><div class="field"><label class="field__label" for="lk-post">或文章地址（slug）</label><input id="lk-post" name="post" maxlength="80" autocapitalize="off"></div></div><p class="field__err js-err" role="alert" hidden></p><button class="btn btn--soft btn--sm" type="submit">${icon('link')}关联</button></form></details>` : ''}
</section>
<section class="tile tile--full st-sec" aria-labelledby="pj-mem-h"><h2 class="soc-h" id="pj-mem-h">${icon('users')}成员</h2>
  <ul class="st-members"><li>${avatar(p.owner, 'soc-av soc-av--sm')}<a href="${userPath(p.owner.username)}">${e(p.owner.nickname)}</a><span class="soc-chip">${COLLAB_ROLE_LABEL.owner}</span></li>${[...accepted, ...others]
    .map(
      (m) =>
        `<li>${avatar(m.user, 'soc-av soc-av--sm')}<a href="${userPath(m.user.username)}">${e(m.user.nickname)}</a><span class="soc-chip soc-chip--soft">${e(m.label || COLLAB_ROLE_LABEL[m.role])}</span>${m.status !== 'accepted' ? `<span class="muted small">${COLLAB_STATUS_LABEL[m.status]}</span>` : ''}${mine.canManage && (m.status === 'accepted' || m.status === 'invited') ? `<button type="button" class="btn btn--ghost btn--sm js-rmmem" data-u="${e(m.user.username)}" aria-label="移除成员 ${e(m.user.nickname)}">${icon('close')}${m.status === 'invited' ? '撤回邀请' : '移除'}</button>` : ''}</li>`,
    )
    .join('')}</ul>
  ${mine.status === 'invited' ? `<p class="st-invite">${icon('users')}你被邀请加入这个项目。<button type="button" class="btn btn--primary btn--sm js-accept">${icon('check')}接受</button><button type="button" class="btn btn--ghost btn--sm js-decline">婉拒</button></p>` : ''}
  ${mine.status === 'accepted' && !mine.canManage ? `<button type="button" class="btn btn--ghost btn--sm js-leave">${icon('logout')}退出项目</button>` : ''}
  ${mine.canManage ? `<form class="soc-form st-form js-memform" novalidate><div class="st-row"><div class="field"><label class="field__label" for="mm-u">邀请成员（用户名）</label><input id="mm-u" name="username" maxlength="20" required aria-required="true" autocapitalize="off"></div><div class="field"><label class="field__label" for="mm-role">角色</label><select id="mm-role" name="role"><option value="contributor">${COLLAB_ROLE_LABEL.contributor}</option><option value="editor">${COLLAB_ROLE_LABEL.editor}</option></select></div><div class="field"><label class="field__label" for="mm-label">署名（可选）</label><input id="mm-label" name="label" maxlength="20" placeholder="如：调色 / 文档"></div></div><p class="muted small">对方接受邀请后才会出现在成员里；「可编辑」成员能写日志、改项目信息和关联作品。</p><p class="field__err js-err" role="alert" hidden></p><button class="btn btn--soft btn--sm" type="submit">${icon('userPlus')}发送邀请</button></form>` : ''}
</section>
${mine.canEdit ? `<section class="tile tile--full st-sec" aria-labelledby="pj-edit-h"><h2 class="soc-h" id="pj-edit-h">${icon('settings')}项目设置</h2><details class="st-new"><summary>${icon('edit')}编辑项目信息</summary>${projectForm(p, mine.canManage)}</details>${mine.canManage ? `<button type="button" class="btn btn--ghost btn--sm js-delproj">${icon('trash')}删除项目</button>` : ''}</section>` : ''}
</div>`;
  };
  draw();
  recordView('project', p.slug);
  const signal = freshSignal(box);
  const act = async (fn: () => Promise<ProjectRes | { left: true } | unknown>, ok: string, focus?: string) => {
    try {
      const r = (await fn()) as Partial<ProjectRes>;
      if (r && r.project) {
        p = r.project;
        mine = r.mine!;
      } else ({ project: p, mine } = await studio.project(slug));
      draw();
      void ctx.notify(ok, 'success');
      if (focus) box.querySelector<HTMLElement>(focus)?.focus();
      return true;
    } catch (x) {
      void ctx.notify(errMsg(x), 'error');
      return false;
    }
  };
  box.addEventListener(
    'click',
    async (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b || b.disabled) return;
      if (b.classList.contains('js-dellog')) {
        if (!confirm('删除这条日志？')) return;
        await act(() => studio.deleteLog(Number(b.dataset.id)), '日志已删除', '#pj-log-h');
      } else if (b.classList.contains('js-unlink')) {
        const links = p.links.filter((l) => !(l.kind === b.dataset.kind && l.ref === b.dataset.ref)).map((l) => ({ kind: l.kind, ref: l.ref }));
        await act(() => studio.setLinks(slug, links), '已取消关联', '#pj-link-h');
      } else if (b.classList.contains('js-rmmem')) {
        await act(() => studio.removeMember(slug, b.dataset.u!), '已更新成员', '#pj-mem-h');
      } else if (b.classList.contains('js-accept') || b.classList.contains('js-decline')) {
        const acc = b.classList.contains('js-accept');
        const pid = await projectIdFromInvites(slug);
        if (pid === null) return void ctx.notify('没有找到这条邀请', 'error');
        await act(() => studio.respond('project', pid, acc), acc ? '已加入项目' : '已婉拒邀请', '#pj-mem-h');
      } else if (b.classList.contains('js-leave')) {
        if (!confirm('退出这个项目？你写过的日志会保留。')) return;
        { const u = await myUsername(); await act(() => studio.removeMember(slug, u), '已退出项目', '#pj-mem-h'); }
      } else if (b.classList.contains('js-delproj')) {
        if (!confirm(`删除项目「${p.title}」？日志、成员和关联会一起删除（作品本身不受影响），无法恢复。`)) return;
        try {
          await studio.deleteProject(slug);
          void ctx.notify('项目已删除', 'success');
          ctx.navigate?.(url('/projects/'));
        } catch (x) {
          void ctx.notify(errMsg(x), 'error');
        }
      }
    },
    { signal },
  );
  box.addEventListener(
    'toggle',
    async (ev) => {
      const d = ev.target as HTMLDetailsElement;
      if (!d.classList?.contains('js-linkbox') || !d.open) return;
      const sel = d.querySelector<HTMLSelectElement>('select[name=work]')!;
      try {
        const { works } = await studio.myWorks();
        const have = new Set(p.links.filter((l) => l.kind === 'work').map((l) => l.ref));
        const opts = works.filter((w) => !have.has(String(w.id)));
        sel.innerHTML = `<option value="">（不选）</option>${opts.map((w) => `<option value="${w.id}">${e(w.title || w.caption || `作品 #${w.id}`)}</option>`).join('')}`;
      } catch {
        sel.innerHTML = '<option value="">（无法加载）</option>';
      }
    },
    { signal, capture: true },
  );
  box.addEventListener(
    'submit',
    async (ev) => {
      const f = ev.target as HTMLFormElement;
      ev.preventDefault();
      clearErr(f);
      try {
        let r: ProjectRes;
        let ok = '';
        let focus = '';
        if (f.classList.contains('js-logform')) {
          r = await studio.addLog(slug, { kind: val(f, 'kind'), title: val(f, 'title'), body: val(f, 'body'), version: val(f, 'version') });
          ok = '日志已发布';
          focus = '#pj-log-h';
        } else if (f.classList.contains('js-linkform')) {
          const w = val(f, 'work');
          const post = val(f, 'post');
          if (!w && !post) throw new ApiError(400, '选择一件作品或填写文章地址');
          const links = [...p.links.map((l) => ({ kind: l.kind, ref: l.ref })), ...(w ? [{ kind: 'work', ref: w }] : []), ...(post ? [{ kind: 'post', ref: post }] : [])];
          r = await studio.setLinks(slug, links);
          ok = '已关联';
          focus = '#pj-link-h';
        } else if (f.classList.contains('js-memform')) {
          r = await studio.inviteMember(slug, { username: val(f, 'username'), role: val(f, 'role'), label: val(f, 'label') });
          ok = '邀请已发送，对方接受后会出现在成员里';
          focus = '#pj-mem-h';
        } else if (f.classList.contains('js-pform')) {
          r = await studio.updateProject(slug, readProject(f));
          ok = '项目已保存';
          focus = '#pj-title';
        } else return;
        p = r.project;
        mine = r.mine;
        draw();
        void ctx.notify(ok, 'success');
        box.querySelector<HTMLElement>(focus)?.setAttribute('tabindex', '-1');
        box.querySelector<HTMLElement>(focus)?.focus();
      } catch (x) {
        fieldErr(f, x);
      }
    },
    { signal },
  );
}
async function projectIdFromInvites(slug: string): Promise<number | null> {
  const { invitations } = await studio.invitations();
  return invitations.find((i) => i.kind === 'project' && i.href === `/p/${slug}/`)?.id ?? null;
}

// ---------------------------------------------------------------- 摄影专题列表 + EXIF 浏览
const EXIF_KEYS = ['device', 'focal', 'aperture', 'iso', 'camera', 'lens'] as const;
type ExifKey = (typeof EXIF_KEYS)[number];
const EXIF_LABEL: Record<ExifKey, string> = { device: '设备', focal: '焦段', aperture: '光圈', iso: 'ISO', camera: '机型', lens: '镜头' };
function bucketLabel(k: ExifKey, key: string): string {
  if (k === 'device') return DEVICE_LABEL[key as DeviceKind] ?? key;
  const bs = k === 'focal' ? FOCAL_BUCKETS : k === 'aperture' ? APERTURE_BUCKETS : k === 'iso' ? ISO_BUCKETS : null;
  return bs?.find((b) => b.key === key)?.label ?? key;
}
async function renderFeatures(box: HTMLElement, ctx: UgcCtx): Promise<void> {
  const me = currentMember();
  const [pub, mine, fx] = await Promise.all([studio.features(), me ? studio.features(true) : Promise.resolve(null), studio.facets().catch(() => null)]);
  const drafts = (mine?.features ?? []).filter((f) => f.status === 'draft');
  box.innerHTML = `<div class="st">
  ${demoNote('专题和照片')}
  <section class="st-sec" aria-labelledby="ft-all-h"><h2 class="soc-h st-sec__h" id="ft-all-h">${icon('book')}最新专题</h2>
  ${pub.features.length ? `<div class="st-grid st-grid--features">${pub.features.map((f) => featureCard(f)).join('')}</div>` : empty('还没有发布的摄影专题。', 'camera')}</section>
  ${
    me
      ? `<section class="tile tile--full st-sec" aria-labelledby="ft-mine-h"><h2 class="soc-h" id="ft-mine-h">${icon('edit')}我的专题</h2>
    ${drafts.length ? `<ul class="disc-clist st-drafts">${drafts.map((f) => `<li><a href="${featurePath(f.slug)}"><b>${e(f.title)}</b></a><span class="muted small">草稿 · ${f.works} 张作品</span></li>`).join('')}</ul>` : '<p class="muted small">没有草稿。专题把几张照片和文字排成一页，适合讲一次出行、一个系列或一段时间的记录。</p>'}
    <details class="st-new"><summary>${icon('plus')}新建摄影专题</summary><form class="soc-form st-form js-fnew" novalidate>
      <div class="field"><label class="field__label" for="fn-title">标题 *</label><input id="fn-title" name="title" maxlength="60" required aria-required="true"></div>
      <div class="field"><label class="field__label" for="fn-slug">地址 *</label><input id="fn-slug" name="slug" maxlength="40" required aria-required="true" autocapitalize="off" aria-describedby="fn-slug-h"><p class="muted small" id="fn-slug-h">小写字母、数字和短横线，会成为 /f/地址/。</p></div>
      <div class="field"><label class="field__label" for="fn-dek">导语</label><input id="fn-dek" name="dek" maxlength="160"></div>
      <p class="field__err js-err" role="alert" hidden></p><button class="btn btn--primary btn--sm" type="submit">${icon('plus')}创建草稿</button></form></details></section>`
      : ''
  }
  <section class="tile tile--full st-sec st-exif" aria-labelledby="ex-h"><h2 class="soc-h" id="ex-h">${icon('aperture')}按拍摄参数浏览社区照片</h2>
    <p class="muted small">参数来自作者填写或上传时读取的 EXIF（不含位置）。手机照片会按机型自动归到「手机」。</p>
    ${fx ? exifBar(fx.facets) : '<p class="muted small">筛选暂时不可用。</p>'}
    <p class="visually-hidden js-ex-live" role="status" aria-live="polite"></p>
    <ul class="ugc-list st-exgrid js-exlist" aria-busy="true"></ul>
    <p class="disc-more"><button type="button" class="btn btn--soft btn--sm js-exmore" hidden>${icon('chevronDown')}更多</button></p>
  </section>
</div>`;
  const signal = freshSignal(box);
  const q = new URLSearchParams(location.search);
  let cursor: string | null = null;
  const qs = () => {
    const sp = new URLSearchParams();
    for (const k of EXIF_KEYS) {
      const v = box.querySelector<HTMLSelectElement>(`.js-ex[name="${k}"]`)?.value;
      if (v) sp.set(k, v);
    }
    return sp.toString();
  };
  for (const k of EXIF_KEYS) {
    const v = q.get(k);
    const sel = box.querySelector<HTMLSelectElement>(`.js-ex[name="${k}"]`);
    if (v && sel && [...sel.options].some((o) => o.value === v)) sel.value = v;
  }
  const load = async (append = false) => {
    const list = box.querySelector<HTMLElement>('.js-exlist')!;
    const more = box.querySelector<HTMLButtonElement>('.js-exmore')!;
    list.setAttribute('aria-busy', 'true');
    try {
      const r = await studio.exifWorks(qs() || 'type=photo', append ? cursor : null);
      cursor = r.nextCursor;
      const html = r.works.map((w) => `<li>${card(w)}</li>`).join('');
      if (append) list.insertAdjacentHTML('beforeend', html);
      else list.innerHTML = html || `<li class="muted">没有符合这些参数的照片，换个条件试试。</li>`;
      more.hidden = !cursor;
      box.querySelector<HTMLElement>('.js-ex-live')!.textContent = append ? `又加载了 ${r.works.length} 张` : `找到 ${r.works.length}${cursor ? '+' : ''} 张照片`;
    } catch (x) {
      list.innerHTML = `<li class="muted">${e(errMsg(x))}</li>`;
    } finally {
      list.removeAttribute('aria-busy');
    }
  };
  void load();
  box.addEventListener(
    'change',
    (ev) => {
      const t = ev.target as HTMLElement;
      if (!t.classList.contains('js-ex')) return;
      const s = qs();
      history.replaceState(history.state, '', `${location.pathname}${s ? `?${s}` : ''}`);
      void load();
    },
    { signal },
  );
  box.addEventListener(
    'click',
    (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('.js-exmore, .js-exreset');
      if (!b) return;
      if (b.classList.contains('js-exmore')) return void load(true);
      box.querySelectorAll<HTMLSelectElement>('.js-ex').forEach((s) => (s.value = ''));
      history.replaceState(history.state, '', location.pathname);
      void load();
      box.querySelector<HTMLElement>('.js-ex')?.focus();
    },
    { signal },
  );
  box.addEventListener(
    'submit',
    async (ev) => {
      const f = (ev.target as HTMLElement).closest<HTMLFormElement>('.js-fnew');
      if (!f) return;
      ev.preventDefault();
      clearErr(f);
      try {
        const r = await studio.createFeature({ title: val(f, 'title'), slug: val(f, 'slug'), dek: val(f, 'dek'), blocks: [] });
        void ctx.notify('草稿已创建：接下来添加作品和文字', 'success');
        ctx.navigate?.(featurePath(r.feature.slug));
      } catch (x) {
        fieldErr(f, x);
      }
    },
    { signal },
  );
}
function exifBar(fx: ExifFacets): string {
  const sel = (k: ExifKey) => {
    const opts = (fx[k] as { key: string; n: number }[]).filter((o) => o.n > 0);
    return `<div class="field st-exf"><label class="field__label" for="ex-${k}">${EXIF_LABEL[k]}</label><select id="ex-${k}" class="js-ex" name="${k}"><option value="">全部</option>${opts.map((o) => `<option value="${e(o.key)}">${e(bucketLabel(k, o.key))}（${o.n}）</option>`).join('')}</select></div>`;
  };
  return `<form class="st-exbar" role="search" aria-label="按拍摄参数筛选" onsubmit="return false">${EXIF_KEYS.map(sel).join('')}<button type="button" class="btn btn--ghost btn--sm js-exreset">${icon('refresh')}清除</button></form>`;
}

// ---------------------------------------------------------------- 摄影专题
const exifLine = (w: Work) => {
  const p = w.params;
  const bits = [p.camera, p.lens, p.focal, p.aperture, p.shutter, p.iso ? `ISO ${p.iso.replace(/^iso\s*/i, '')}` : ''].filter(Boolean);
  return bits.length ? `<p class="st-exifline muted small">${icon('aperture')}${bits.map((b) => e(String(b))).join(' · ')}</p>` : '';
};
async function renderFeature(box: HTMLElement, slug: string, ctx: UgcCtx): Promise<void> {
  let { feature: f, mine } = await studio.feature(slug);
  let editing = false;
  let blocks: FeatureBlock[] = f.raw ? f.raw.map((b) => ({ ...b })) : [];
  let pool: Work[] | null = null;
  const draw = () => {
    document.title = `${f.title} | ${document.title.split('|').pop()?.trim() ?? ''}`;
    const first = f.blocks.find((b) => b.t === 'work') as Extract<ShownBlock, { t: 'work' }> | undefined;
    const hero = first?.work.media[0];
    box.innerHTML = `<article class="st-essay" aria-labelledby="fe-title">
  <header class="st-essay__head${hero ? ' has-hero' : ''}">
    ${hero ? `<figure class="st-essay__hero">${img(hero, '', true)}</figure>` : ''}
    <div class="st-essay__htxt tile">
      <p class="muted small"><a href="${url('/f/')}">摄影专题</a>${f.status === 'draft' ? ' · <span class="soc-chip soc-chip--soft">草稿：只有你能看到</span>' : ''}</p>
      <h1 class="st-essay__title" id="fe-title">${e(f.title)}</h1>
      ${f.dek ? `<p class="st-essay__dek">${e(f.dek)}</p>` : ''}
      <p class="muted small"><a class="st-owner" href="${userPath(f.owner.username)}">${avatar(f.owner, 'soc-av soc-av--sm')}${e(f.owner.nickname)}</a>${f.publishedAt ? ` · <time datetime="${e(f.publishedAt)}">${fmtDay(f.publishedAt)}</time>` : ''} · ${f.works} 张作品</p>
      ${mine.canEdit ? `<p class="st-row st-essay__tools"><button type="button" class="btn btn--soft btn--sm js-edit" aria-expanded="${editing}">${icon('edit')}${editing ? '收起编辑' : '编辑专题'}</button><button type="button" class="btn ${f.status === 'draft' ? 'btn--primary' : 'btn--soft'} btn--sm js-pub">${icon(f.status === 'draft' ? 'send' : 'eye')}${f.status === 'draft' ? '发布' : '撤回为草稿'}</button><button type="button" class="btn btn--ghost btn--sm js-delfeat">${icon('trash')}删除</button></p>${f.hidden ? `<p class="muted small" role="note">${icon('eye')}有 ${f.hidden} 件作品已不再公开，读者看不到它们。</p>` : ''}` : ''}
    </div>
  </header>
  ${editing ? editorHtml() : ''}
  <div class="st-essay__body">${
    f.blocks.length
      ? f.blocks
          .map((b, i) =>
            b.t === 'text'
              ? `<div class="st-essay__text prose">${renderCommentHtml(b.text)}</div>`
              : `<figure class="st-essay__work${b.work.media.length > 1 ? ' is-multi' : ''}">${b.work.media.map((m, j) => img(m, '', i === 0 && j === 0)).join('')}<figcaption>${b.caption ? `<span>${e(b.caption)}</span>` : b.work.caption ? `<span>${e(b.work.caption)}</span>` : ''}<a class="muted small" href="${url(`/w/${b.work.id}/`)}">${e(b.work.title || '查看作品')}${b.work.author.username !== f.owner.username ? ` · ${e(b.work.author.nickname)}` : ''}</a>${exifLine(b.work)}</figcaption></figure>`,
          )
          .join('')
      : `<p class="muted st-essay__empty">${mine.canEdit ? '还没有内容：点「编辑专题」添加作品和文字。' : '这个专题还没有内容。'}</p>`
  }</div>
</article>`;
  };
  const editorHtml = () => {
    const byId = new Map((pool ?? []).map((w) => [w.id, w]));
    return `<section class="tile tile--full st-editor" aria-labelledby="fe-ed-h"><h2 class="soc-h" id="fe-ed-h">${icon('edit')}编辑专题</h2>
  <form class="soc-form st-form js-fedit" novalidate>
    <div class="field"><label class="field__label" for="fe-t">标题 *</label><input id="fe-t" name="title" value="${e(f.title)}" maxlength="60" required aria-required="true"></div>
    <div class="field"><label class="field__label" for="fe-d">导语</label><input id="fe-d" name="dek" value="${e(f.dek)}" maxlength="160"></div>
    <ol class="st-blocks">${blocks
      .map((b, i) => {
        const tools = `<span class="st-row">${i > 0 ? `<button type="button" class="adm-icon-btn js-bup" data-i="${i}" aria-label="把第 ${i + 1} 块往前移">${icon('arrowUp')}</button>` : ''}<button type="button" class="adm-icon-btn js-brm" data-i="${i}" aria-label="移除第 ${i + 1} 块">${icon('trash')}</button></span>`;
        if (b.t === 'text') return `<li class="st-block"><div class="field"><label class="field__label" for="fb-${i}">第 ${i + 1} 块 · 文字</label><textarea id="fb-${i}" class="js-btext" data-i="${i}" rows="3" maxlength="2000">${e(b.text)}</textarea></div>${tools}</li>`;
        const w = byId.get(b.id);
        return `<li class="st-block st-block--work">${w?.media[0] ? img(w.media[0]) : ''}<div class="field"><label class="field__label" for="fb-${i}">第 ${i + 1} 块 · ${e(w?.title || `作品 #${b.id}`)} 的图注</label><input id="fb-${i}" class="js-bcap" data-i="${i}" value="${e(b.caption)}" maxlength="200"></div>${tools}</li>`;
      })
      .join('')}</ol>
    <div class="st-row st-addblock">
      <div class="field"><label class="field__label" for="fe-add">添加作品</label><select id="fe-add" class="js-addwork"><option value="">选择一件公开的摄影作品…</option>${(pool ?? []).map((w) => `<option value="${w.id}">${e(w.title || w.caption || `作品 #${w.id}`)}</option>`).join('')}</select></div>
      <button type="button" class="btn btn--soft btn--sm js-addtext">${icon('plus')}添加文字</button>
    </div>
    <p class="muted small">只能使用你自己（或你参与共同创作）的公开摄影作品和影集。</p>
    <p class="field__err js-err" role="alert" hidden></p>
    <button class="btn btn--primary btn--sm" type="submit">${icon('check')}保存专题</button>
  </form></section>`;
  };
  const readEditor = () => {
    box.querySelectorAll<HTMLTextAreaElement>('.js-btext').forEach((t) => {
      const b = blocks[Number(t.dataset.i)];
      if (b?.t === 'text') b.text = t.value;
    });
    box.querySelectorAll<HTMLInputElement>('.js-bcap').forEach((t) => {
      const b = blocks[Number(t.dataset.i)];
      if (b?.t === 'work') b.caption = t.value;
    });
    const t = box.querySelector<HTMLInputElement>('#fe-t');
    const d = box.querySelector<HTMLInputElement>('#fe-d');
    if (t) f = { ...f, title: t.value };
    if (d) f = { ...f, dek: d.value };
  };
  draw();
  if (f.status === 'published') recordView('feature', f.slug);
  const signal = freshSignal(box);
  const reload = (r: FeatureRes) => {
    f = r.feature;
    mine = r.mine;
    blocks = f.raw ? f.raw.map((b) => ({ ...b })) : blocks;
  };
  box.addEventListener(
    'click',
    async (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b || b.disabled) return;
      if (b.classList.contains('js-edit')) {
        editing = !editing;
        if (editing && !pool) {
          try {
            const { works } = await studio.myWorks();
            pool = works.filter((w) => (w.type === 'photo' || w.type === 'album') && w.visibility === 'public' && w.status === 'published' && w.modState === 'ok');
          } catch {
            pool = [];
          }
        }
        draw();
        box.querySelector<HTMLElement>(editing ? '#fe-t' : '.js-edit')?.focus();
      } else if (b.classList.contains('js-pub')) {
        try {
          reload(await studio.publishFeature(slug, f.status === 'draft'));
          draw();
          void ctx.notify(f.status === 'published' ? '专题已发布' : '已撤回为草稿', 'success');
          box.querySelector<HTMLElement>('.js-pub')?.focus();
        } catch (x) {
          void ctx.notify(errMsg(x), 'error');
        }
      } else if (b.classList.contains('js-delfeat')) {
        if (!confirm(`删除专题「${f.title}」？作品本身不会被删除。`)) return;
        try {
          await studio.deleteFeature(slug);
          void ctx.notify('专题已删除', 'success');
          ctx.navigate?.(url('/f/'));
        } catch (x) {
          void ctx.notify(errMsg(x), 'error');
        }
      } else if (b.classList.contains('js-addtext')) {
        readEditor();
        blocks.push({ t: 'text', text: '' });
        draw();
        box.querySelector<HTMLElement>(`#fb-${blocks.length - 1}`)?.focus();
      } else if (b.classList.contains('js-bup') || b.classList.contains('js-brm')) {
        readEditor();
        const i = Number(b.dataset.i);
        if (b.classList.contains('js-brm')) blocks.splice(i, 1);
        else [blocks[i - 1], blocks[i]] = [blocks[i]!, blocks[i - 1]!];
        draw();
        box.querySelector<HTMLElement>(`#fb-${Math.max(0, b.classList.contains('js-brm') ? i - 1 : i - 1)}`)?.focus() ?? box.querySelector<HTMLElement>('#fe-add')?.focus();
      }
    },
    { signal },
  );
  box.addEventListener(
    'change',
    (ev) => {
      const s = ev.target as HTMLSelectElement;
      if (!s.classList.contains('js-addwork') || !s.value) return;
      readEditor();
      blocks.push({ t: 'work', id: Number(s.value), caption: '' });
      draw();
      box.querySelector<HTMLElement>(`#fb-${blocks.length - 1}`)?.focus();
    },
    { signal },
  );
  box.addEventListener(
    'submit',
    async (ev) => {
      const form = (ev.target as HTMLElement).closest<HTMLFormElement>('.js-fedit');
      if (!form) return;
      ev.preventDefault();
      readEditor();
      clearErr(form);
      try {
        reload(await studio.updateFeature(slug, { title: f.title, dek: f.dek, blocks: blocks.filter((b) => b.t === 'work' || b.text.trim()) }));
        editing = false;
        draw();
        void ctx.notify('专题已保存', 'success');
        box.querySelector<HTMLElement>('.js-edit')?.focus();
      } catch (x) {
        fieldErr(form, x);
      }
    },
    { signal },
  );
}

// ---------------------------------------------------------------- 数据中心
function chart(series: Series[], label: string): string {
  const W = 600;
  const H = 120;
  const max = Math.max(1, ...series.map((s) => s.n));
  const bw = W / Math.max(1, series.length);
  const bars = series
    .map((s, i) => {
      const h = Math.round((s.n / max) * (H - 8));
      return `<rect x="${(i * bw + bw * 0.15).toFixed(1)}" y="${H - h}" width="${(bw * 0.7).toFixed(1)}" height="${h}" rx="2"><title>${s.day}：${s.n}</title></rect>`;
    })
    .join('');
  const total = series.reduce((a, b) => a + b.n, 0);
  const peak = series.reduce((a, b) => (b.n > a.n ? b : a), series[0] ?? { day: '', n: 0 });
  return `<figure class="st-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${e(label)}：${series.length} 天共 ${total}${peak.n ? `，最高 ${peak.day} 的 ${peak.n}` : ''}">${bars}</svg><figcaption class="muted small"><span>${series[0]?.day ?? ''}</span><span>${series.at(-1)?.day ?? ''}</span></figcaption></figure>`;
}
async function renderStats(box: HTMLElement): Promise<void> {
  if (!currentMember()) return void (box.innerHTML = gate('查看自己的创作数据'));
  const draw = async (days: number) => {
    const s = await studio.stats(days);
    const ref = s.private.referrers;
    box.innerHTML = `<div class="st st-stats">
  <aside class="st-privacy tile tile--full" role="note" aria-labelledby="pv-h"><h2 class="soc-h" id="pv-h">${icon('lock')}只有你能看到这些数据</h2><p>${e(s.privacy)}</p><p class="muted small">浏览器开启「请勿追踪」或 GPC 时，不会计入浏览数。</p></aside>
  <div class="soc-filters st-range" role="group" aria-label="时间范围">${STAT_RANGES.map((d) => `<button type="button" class="btn btn--sm ${d === days ? 'btn--primary' : 'btn--soft'} js-range" data-d="${d}" aria-pressed="${d === days}">最近 ${d} 天</button>`).join('')}</div>
  <section class="tile tile--full st-sec" aria-labelledby="sv-h"><h2 class="soc-h" id="sv-h">${icon('eye')}浏览 <b class="st-big">${s.private.views.total}</b></h2>${chart(s.private.views.series, `最近 ${days} 天每日浏览`)}
    <div class="st-cols"><div><h3 class="soc-h small">最受关注</h3>${s.private.top.length ? `<ol class="st-top">${s.private.top.map((t) => `<li><a href="${url(t.href)}">${e(t.title)}</a><span class="muted small">${t.views}</span></li>`).join('')}</ol>` : '<p class="muted small">这段时间还没有浏览。</p>'}</div>
    <div><h3 class="soc-h small">来源概览</h3>${ref.length ? `<ol class="st-top">${ref.map((r) => `<li><span>${r.domain ? e(r.domain) : '直接访问 / 站内'}</span><span class="muted small">${r.n}</span></li>`).join('')}</ol>` : '<p class="muted small">暂无来源数据。</p>'}<p class="muted small">只记录来源网站的域名，不记录具体页面。</p></div></div>
  </section>
  <section class="tile tile--full st-sec" aria-labelledby="st-h"><h2 class="soc-h" id="st-h">${icon('heart')}互动趋势</h2>
    <div class="st-trends">
      <div><h3 class="soc-h small">回应 <b>${s.trends.reactions.total}</b></h3>${chart(s.trends.reactions.series, '每日回应')}</div>
      <div><h3 class="soc-h small">收藏 <b>${s.trends.bookmarks.total}</b></h3>${chart(s.trends.bookmarks.series, '每日收藏')}</div>
      <div><h3 class="soc-h small">评论 <b>${s.trends.comments.total}</b></h3>${chart(s.trends.comments.series, '每日评论')}</div>
      <div><h3 class="soc-h small">新粉丝 <b>+${s.trends.followers.gained}</b> <span class="muted small">共 ${s.trends.followers.total}</span></h3>${chart(s.trends.followers.series, '每日新粉丝')}</div>
    </div>
    <p class="muted small">累计：回应 ${s.public.reactions} · 收藏 ${s.public.bookmarks} · 评论 ${s.public.comments} · 粉丝 ${s.public.followers}。不包括你自己的操作。</p>
  </section>
</div>`;
  };
  await draw(30);
  box.addEventListener(
    'click',
    async (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('.js-range');
      if (!b) return;
      const d = Number(b.dataset.d);
      box.setAttribute('aria-busy', 'true');
      try {
        await draw(d);
      } finally {
        box.removeAttribute('aria-busy');
        box.querySelector<HTMLElement>(`.js-range[data-d="${d}"]`)?.focus();
      }
    },
    { signal: freshSignal(box) },
  );
}

// ---------------------------------------------------------------- 作品页：共同作者 + 修订历史
export async function workStudio(box: HTMLElement, w: Work, ctx: UgcCtx): Promise<void> {
  box.querySelector('.js-studio-work')?.remove();
  const sec = document.createElement('section');
  sec.className = 'st-work tile tile--full js-studio-work';
  sec.setAttribute('aria-labelledby', 'sw-h');
  box.querySelector('.ugc-comments')?.before(sec);
  const can = w.mine.can;
  const draw = async () => {
    const co = await studio.coauthors(w.id);
    const rows = co.coauthors;
    const invited = co.mine.status === 'invited';
    sec.innerHTML = `<h2 class="soc-h" id="sw-h">${icon('users')}共同创作</h2>
  ${invited ? `<p class="st-invite">${icon('users')}${e(co.owner.nickname)} 邀请你成为这件作品的共同作者（${COLLAB_ROLE_LABEL[(co.mine.role as CollabRole) ?? 'contributor']}）。<button type="button" class="btn btn--primary btn--sm js-wacc">${icon('check')}接受</button><button type="button" class="btn btn--ghost btn--sm js-wdec">婉拒</button></p>` : ''}
  <ul class="st-members"><li>${avatar(co.owner, 'soc-av soc-av--sm')}<a href="${userPath(co.owner.username)}">${e(co.owner.nickname)}</a><span class="soc-chip">${COLLAB_ROLE_LABEL.owner}</span></li>${rows
    .map(
      (r) =>
        `<li>${avatar(r.user, 'soc-av soc-av--sm')}<a href="${userPath(r.user.username)}">${e(r.user.nickname)}</a><span class="soc-chip soc-chip--soft">${COLLAB_ROLE_LABEL[r.role]}</span>${r.status !== 'accepted' ? `<span class="muted small">${COLLAB_STATUS_LABEL[r.status]}</span>` : ''}${can?.members && (r.status === 'accepted' || r.status === 'invited') ? `<button type="button" class="btn btn--ghost btn--sm js-wrm" data-u="${e(r.user.username)}" aria-label="移除共同作者 ${e(r.user.nickname)}">${icon('close')}${r.status === 'invited' ? '撤回邀请' : '移除'}</button>` : ''}</li>`,
    )
    .join('')}</ul>
  ${co.mine.status === 'accepted' ? `<button type="button" class="btn btn--ghost btn--sm js-wleave">${icon('logout')}退出共同创作</button>` : ''}
  ${
    can?.members && w.type !== 'short'
      ? `<form class="soc-form st-form js-winv" novalidate><div class="st-row"><div class="field"><label class="field__label" for="wi-u">邀请共同作者（用户名）</label><input id="wi-u" name="username" maxlength="20" required aria-required="true" autocapitalize="off"></div><div class="field"><label class="field__label" for="wi-r">角色</label><select id="wi-r" name="role"><option value="contributor">${COLLAB_ROLE_LABEL.contributor}</option><option value="editor">${COLLAB_ROLE_LABEL.editor}</option></select></div></div><p class="muted small">「可编辑」可以改文字和添加图片，但不能删除别人上传的图片、改可见范围或删除作品；被移除后署名保留为「曾参与」。</p><p class="field__err js-err" role="alert" hidden></p><button class="btn btn--soft btn--sm" type="submit">${icon('userPlus')}发送邀请</button></form>`
      : ''
  }
  ${can?.restore ? `<details class="st-revs js-revs"><summary>${icon('history')}修订历史</summary><div class="js-revlist"><p class="muted small">加载中…</p></div></details>` : ''}`;
  };
  const drawRevs = async () => {
    const holder = sec.querySelector<HTMLElement>('.js-revlist');
    if (!holder) return;
    const { revisions, current } = await studio.revisions(w.id);
    holder.innerHTML = revisions.length
      ? `<ol class="st-revlist">${revisions.map((r) => `<li><p><b>第 ${r.rev} 版</b>${r.rev === current ? ' <span class="soc-chip">当前</span>' : ''} <span class="muted small">${ago(r.createdAt)} · ${e(r.editor?.nickname ?? '已注销用户')}${r.note ? ` · ${e(r.note)}` : ''}</span></p><p class="muted small">${r.changes.length ? e(r.changes.join('、')) : '无内容变化'} · ${r.mediaCount} 张图</p>${r.rev !== current ? `<button type="button" class="btn btn--ghost btn--sm js-restore" data-rev="${r.rev}">${icon('refresh')}恢复到这一版</button>` : ''}</li>`).join('')}</ol><p class="muted small">最多保留最近 50 个版本。恢复会生成一个新版本，不会删除历史。</p>`
      : '<p class="muted small">还没有修订记录：第一次修改后会出现。</p>';
  };
  await draw();
  const act = async (fn: () => Promise<unknown>, ok: string, reloadPage = false) => {
    try {
      await fn();
      void ctx.notify(ok, 'success');
      if (reloadPage) return ctx.navigate?.(url(`/w/${w.id}/`));
      await draw();
      sec.querySelector<HTMLElement>('#sw-h')?.setAttribute('tabindex', '-1');
      sec.querySelector<HTMLElement>('#sw-h')?.focus();
    } catch (x) {
      void ctx.notify(errMsg(x), 'error');
    }
  };
  sec.addEventListener('toggle', (ev) => {
    const d = ev.target as HTMLDetailsElement;
    if (d.classList?.contains('js-revs') && d.open) void drawRevs().catch((x) => (sec.querySelector('.js-revlist')!.innerHTML = `<p class="muted small">${e(errMsg(x))}</p>`));
  }, true);
  sec.addEventListener('click', async (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b || b.disabled) return;
    if (b.classList.contains('js-wacc') || b.classList.contains('js-wdec')) {
      const acc = b.classList.contains('js-wacc');
      await act(() => studio.respond('work', w.id, acc), acc ? '已加入共同创作' : '已婉拒邀请', true);
    } else if (b.classList.contains('js-wrm')) {
      await act(() => studio.removeCoauthor(w.id, b.dataset.u!), '已更新共同作者');
    } else if (b.classList.contains('js-wleave')) {
      if (!confirm('退出共同创作？作品上会保留「曾参与」署名，你将不能再编辑。')) return;
      { const u = await myUsername(); await act(() => studio.removeCoauthor(w.id, u), '已退出', true); }
    } else if (b.classList.contains('js-restore')) {
      const rev = Number(b.dataset.rev);
      if (!confirm(`恢复到第 ${rev} 版？当前内容会保存在历史里。`)) return;
      b.disabled = true;
      try {
        try {
          await studio.restore(w.id, rev);
        } catch (x) {
          if (!(x instanceof ApiError && x.code === 'media_impact')) throw x;
          const items = (x.details as { items?: { url: string; alt: string; uploadedBy: string | null; revisions: number }[] } | undefined)?.items ?? [];
          if (!(await confirmMediaRemoval(items, b))) return;
          await studio.restore(w.id, rev, true);
        }
        void ctx.notify(`已恢复到第 ${rev} 版`, 'success');
        ctx.navigate?.(url(`/w/${w.id}/`));
      } catch (x) {
        void ctx.notify(errMsg(x), 'error');
      } finally {
        b.disabled = false;
      }
    }
  });
  sec.addEventListener('submit', async (ev) => {
    const f = (ev.target as HTMLElement).closest<HTMLFormElement>('.js-winv');
    if (!f) return;
    ev.preventDefault();
    clearErr(f);
    try {
      await studio.inviteCoauthor(w.id, { username: val(f, 'username'), role: val(f, 'role') });
      void ctx.notify('邀请已发送，对方接受后会出现在署名里', 'success');
      await draw();
      sec.querySelector<HTMLElement>('#wi-u')?.focus();
    } catch (x) {
      fieldErr(f, x);
    }
  });
}

// ---------------------------------------------------------------- 「我的」页面
export async function meStudio(box: HTMLElement, ctx: UgcCtx): Promise<void> {
  const slot = box.querySelector<HTMLElement>('.js-studio-me');
  if (!slot) return;
  const draw = async () => {
    const [inv, pj, ft, me] = await Promise.all([studio.invitations(), studio.myProjects(), studio.features(true), myUsername()]);
    slot.hidden = false;
    slot.className = 'js-studio-me st-me';
    slot.innerHTML = `<section class="tile tile--half" aria-labelledby="me-st-h"><h2 class="soc-h" id="me-st-h">${icon('briefcase')}创作工具</h2>
  <p class="st-row"><a class="btn btn--soft btn--sm" href="${url('/me/stats/')}">${icon('chart')}我的数据</a><a class="btn btn--ghost btn--sm" href="${url('/projects/')}">${icon('briefcase')}项目</a><a class="btn btn--ghost btn--sm" href="${url('/f/')}">${icon('book')}摄影专题</a></p>
  ${pj.projects.length ? `<h3 class="soc-h small">我的项目</h3><ul class="disc-clist">${pj.projects.map((p) => `<li><a href="${projectPath(p.slug)}"><b>${e(p.title)}</b></a><span class="muted small">${PROJECT_STATUS_LABEL[p.status]}${p.owner.username === me ? '' : ' · 成员'}</span></li>`).join('')}</ul>` : ''}
  ${ft.features.length ? `<h3 class="soc-h small">我的摄影专题</h3><ul class="disc-clist">${ft.features.map((f) => `<li><a href="${featurePath(f.slug)}"><b>${e(f.title)}</b></a><span class="muted small">${f.status === 'draft' ? '草稿' : '已发布'}</span></li>`).join('')}</ul>` : ''}
</section>
<section class="tile tile--half" aria-labelledby="me-inv-h"><h2 class="soc-h" id="me-inv-h">${icon('users')}协作邀请</h2>${
      inv.invitations.length
        ? `<ul class="st-invs">${inv.invitations.map((i) => `<li><p><a href="${url(i.href)}"><b>${e(i.title)}</b></a><span class="muted small"> · ${i.kind === 'work' ? '作品' : '项目'} · ${e(i.label || COLLAB_ROLE_LABEL[i.role])}${i.from ? ` · 来自 ${e(i.from.nickname)}` : ''}</span></p><p class="st-row"><button type="button" class="btn btn--primary btn--sm js-iacc" data-kind="${i.kind}" data-id="${i.id}" aria-label="接受邀请：${e(i.title)}">${icon('check')}接受</button><button type="button" class="btn btn--ghost btn--sm js-idec" data-kind="${i.kind}" data-id="${i.id}" aria-label="婉拒邀请：${e(i.title)}">婉拒</button></p></li>`).join('')}</ul>`
        : '<p class="muted small">没有待处理的邀请。别人邀请你共同创作作品或加入项目时，会出现在这里。</p>'
    }</section>`;
  };
  slot.addEventListener('click', async (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('.js-iacc, .js-idec');
    if (!b) return;
    const acc = b.classList.contains('js-iacc');
    try {
      await studio.respond(b.dataset.kind!, Number(b.dataset.id), acc);
      void ctx.notify(acc ? '已接受邀请' : '已婉拒邀请', 'success');
      await draw();
      slot.querySelector<HTMLElement>('#me-inv-h')?.setAttribute('tabindex', '-1');
      slot.querySelector<HTMLElement>('#me-inv-h')?.focus();
    } catch (x) {
      void ctx.notify(errMsg(x), 'error');
    }
  });
  try {
    await draw();
  } catch (x) {
    if (!(x instanceof ApiError)) throw x;
  }
}

// ---------------------------------------------------------------- 用户主页
export async function profileStudio(box: HTMLElement, username: string): Promise<void> {
  recordView('profile', username);
  const { projects } = await studio.userProjects(username);
  if (!projects.length) return;
  box.querySelector('.js-studio-prof')?.remove();
  const sec = document.createElement('section');
  sec.className = 'tile tile--full st-sec js-studio-prof';
  sec.setAttribute('aria-labelledby', 'sp-h');
  sec.innerHTML = `<h2 class="soc-h" id="sp-h">${icon('briefcase')}参与的项目</h2><div class="st-grid">${projects.map((p) => projectCard(p)).join('')}</div>`;
  box.append(sec);
}
