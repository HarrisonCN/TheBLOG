/**
 * 演示模式的 L18 摄影与创作工具接口：与 worker/src/studio.ts 相同的路径、状态码、返回结构和权限规则。
 * 状态放在 DemoDb.studio（localStorage，随「重置演示数据」一起清空）；EXIF 归一化 / 校验 / 协作权限 / 媒体删除影响 / 统计序列用共享的 studio-core.ts。
 * 种子：虚构示例用户小林 @xiaolin 的项目「夜景手机调色预设」与摄影专题「江边的夜」，以及小林参与的 Momo 影集（共同作者）。
 */
import {
  checkExifQuery,
  checkFeature,
  checkInvite,
  checkLinks,
  checkLog,
  checkProject,
  checkView,
  COLLAB_ROLES,
  exifFacets,
  fillSeries,
  GITHUB_REPO_RE,
  MAX_COAUTHORS,
  MAX_PROJECTS,
  MAX_REVISIONS,
  matchesExif,
  mediaRemoval,
  normalizeExif,
  PROJECT_SLUG_RE,
  referrerDomain,
  snapshotDiff,
  STAT_RANGES,
  STATS_PRIVACY_NOTE,
  sumSeries,
  workCan,
  type CollabRole,
  type CollabStatus,
  type FeatureBlock,
  type ProjectInput,
  type RevMedia,
  type RevSnapshot,
  type StatKind,
  type WorkRight,
} from '../studio-core';
import type { Post } from '../types';
import { needsReview } from '../ugc-core';
import { SocialError, type MockSocial } from './mock-social';
import type { DemoWork, MockUgc, StudioHooks } from './mock-ugc';
import type { Member } from './community-types';

interface DemoProject { id: number; ownerId: number; slug: string; title: string; tagline: string; description: string; status: ProjectInput['status']; repoUrl: string; homepageUrl: string; coverUrl: string; visibility: 'public' | 'private'; createdAt: string; updatedAt: string }
interface DemoMembership { id: number; memberId: number; role: CollabRole; label: string; status: CollabStatus; invitedBy: number | null; createdAt: string; respondedAt: string | null }
interface DemoLog { id: number; projectId: number; authorId: number | null; kind: 'log' | 'release'; title: string; body: string; version: string; createdAt: string; updatedAt: string }
interface DemoFeature { id: number; ownerId: number; slug: string; title: string; dek: string; blocks: FeatureBlock[]; status: 'draft' | 'published'; createdAt: string; updatedAt: string; publishedAt: string | null }
export interface StudioState {
  coauthors: DemoMembership[]; // id = post id
  revisions: { postId: number; rev: number; editorId: number | null; snapshot: RevSnapshot; note: string; createdAt: string }[];
  projects: DemoProject[];
  members: DemoMembership[]; // id = project id
  logs: DemoLog[];
  links: { projectId: number; kind: 'work' | 'post'; ref: string; position: number }[];
  features: DemoFeature[];
  stats: { kind: StatKind; ref: string; ownerId: number; day: string; views: number }[];
  refs: { kind: StatKind; ref: string; ownerId: number; day: string; domain: string; n: number }[];
  nextId: number;
}

export function studioSeed(now: Date): StudioState {
  const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  return {
    coauthors: [{ id: 3, memberId: 1, role: 'editor', label: '', status: 'accepted', invitedBy: 2, createdAt: ago(3), respondedAt: ago(3) }],
    revisions: [],
    projects: [
      {
        id: 1,
        ownerId: 1,
        slug: 'night-presets',
        title: '夜景手机调色预设',
        tagline: '【演示数据】给手机夜景准备的一套轻量调色预设',
        description: '【演示数据】这是一个虚构示例项目：记录我为手机夜景照片做的一套调色预设——从白平衡、高光压制到颗粒，每次更新都写在下面的日志里。\n\n- 只用手机自带相册就能套用\n- 每个版本附前后对比作品',
        status: 'active',
        repoUrl: 'https://github.com/example/night-presets',
        homepageUrl: '',
        coverUrl: '',
        visibility: 'public',
        createdAt: ago(20),
        updatedAt: ago(1),
      },
    ],
    members: [{ id: 1, memberId: 2, role: 'contributor', label: '测试与反馈', status: 'accepted', invitedBy: 1, createdAt: ago(18), respondedAt: ago(18) }],
    logs: [
      { id: 1, projectId: 1, authorId: 1, kind: 'log', title: '高光压制改成分区处理', body: '【演示数据】路灯和招牌分开处理以后，天空不再发灰。', version: '', createdAt: ago(9), updatedAt: ago(9) },
      { id: 2, projectId: 1, authorId: 1, kind: 'release', title: '第一个公开版本', body: '【演示数据】\n- 三套基础预设：冷夜 / 暖街 / 霓虹\n- 附带前后对比作品', version: '1.0.0', createdAt: ago(1), updatedAt: ago(1) },
    ],
    links: [
      { projectId: 1, kind: 'work', ref: '6', position: 0 },
      { projectId: 1, kind: 'work', ref: '2', position: 1 },
    ],
    features: [
      {
        id: 1,
        ownerId: 1,
        slug: 'river-nights',
        title: '江边的夜',
        dek: '【演示数据】同一条江，三个不同的夜晚。',
        blocks: [
          { t: 'text', text: '【演示数据】这组照片是三个不同的晚上在江边拍的：一次雨后，一次起雾，一次是普通的周五。' },
          { t: 'work', id: 2, caption: '雨后，云层很低。' },
          { t: 'text', text: '后来换成手机，反而更敢于靠近人群。' },
          { t: 'work', id: 6, caption: '手机拍的，夜景模式。' },
          { t: 'work', id: 8, caption: '最后一晚，用回相机。' },
        ],
        status: 'published',
        createdAt: ago(5),
        updatedAt: ago(2),
        publishedAt: ago(2),
      },
    ],
    stats: [],
    refs: [],
    nextId: 100,
  };
}

export interface StudioHost {
  state(): StudioState;
  commit(mutate: (s: StudioState) => void): void;
  ugc: MockUgc;
  social: MockSocial;
  posts(): Post[];
  members(): Member[];
  memberFrom(headers: Record<string, string>): Member;
  optionalMember(headers: Record<string, string>): Member | null;
  now(): Date;
}
const bad = (path: string, message: string) => new SocialError(400, 'validation_error', '参数校验失败', [{ path, message }]);
const notFound = (msg = '内容不存在或你没有权限查看') => new SocialError(404, 'not_found', msg);
const forbidden = (msg: string) => new SocialError(403, 'forbidden', msg);
const RIGHTS: WorkRight[] = ['edit', 'visibility', 'delete', 'publish', 'members', 'restore'];
const rightsOf = (role: 'owner' | CollabRole | null, status: CollabStatus | null) => Object.fromEntries(RIGHTS.map((r) => [r, workCan(role, status, r)])) as Record<WorkRight, boolean>;

/** 带 details 的错误（媒体删除影响）：与 Worker 的 error.details 结构一致。 */
class DetailError extends SocialError {
  constructor(status: number, code: string, message: string, public extra: unknown) {
    super(status, code, message);
    (this as unknown as { details: unknown }).details = extra;
  }
}

export class MockStudio implements StudioHooks {
  constructor(private h: StudioHost) {}
  private iso = () => this.h.now().toISOString();
  private card(id: number | null) {
    return (id ? this.h.social.card(id) : null) ?? { username: 'unknown', nickname: '已注销用户', avatarUrl: '', bio: '' };
  }
  private uid(username: string): number {
    return this.h.social.byUsername(username.toLowerCase()).memberId;
  }
  private poster(headers: Record<string, string>) {
    return this.h.ugc.poster(headers);
  }

  // ------------------------------------------------------------ StudioHooks（给 mock-ugc 用）
  collab(w: DemoWork, viewerId: number | null) {
    const rows = this.h.state().coauthors.filter((c) => c.id === w.id);
    const own = viewerId === w.authorId;
    const mine = rows.find((r) => r.memberId === viewerId) ?? null;
    const role: 'owner' | CollabRole | null = own ? 'owner' : mine && (mine.status === 'accepted' || mine.status === 'invited') ? mine.role : null;
    const status = own ? null : (mine?.status ?? null);
    return {
      coauthors: rows.filter((r) => own || r.status === 'accepted' || r.status === 'removed' || r.memberId === viewerId).map((r) => ({ user: this.card(r.memberId), role: r.role, status: r.status })),
      role,
      status,
      can: rightsOf(role, status),
    };
  }
  canSee(workId: number, viewerId: number | null): boolean {
    return !!viewerId && this.h.state().coauthors.some((c) => c.id === workId && c.memberId === viewerId && (c.status === 'invited' || c.status === 'accepted'));
  }
  role(w: DemoWork, memberId: number): { role: 'owner' | CollabRole | null; status: CollabStatus | null } {
    if (w.authorId === memberId) return { role: 'owner', status: null };
    const r = this.h.state().coauthors.find((c) => c.id === w.id && c.memberId === memberId);
    return r ? { role: r.role, status: r.status } : { role: null, status: null };
  }
  private curMedia(w: DemoWork): RevMedia[] {
    return w.media.map((m) => ({ url: m.url, alt: m.alt, width: m.width, height: m.height, uploadedBy: m.uploadedBy ?? null }));
  }
  private impact(w: DemoWork, ms: RevMedia[]) {
    const revs = this.h.state().revisions.filter((r) => r.postId === w.id);
    return ms.map((m) => ({ url: m.url, alt: m.alt, uploadedBy: m.uploadedBy ? this.card(m.uploadedBy).username : null, revisions: revs.filter((r) => r.snapshot.media.some((x) => x.url === m.url)).length }));
  }
  guardMedia(w: DemoWork, actorId: number, next: { url: string }[], confirmed: boolean): (number | null)[] {
    const cur = this.curMedia(w);
    const r = mediaRemoval(cur, next, actorId, w.authorId);
    if (r.blocked.length) throw new DetailError(403, 'media_not_yours', '这张图片是其他作者上传的，只有作品所有者可以删除', { items: this.impact(w, r.blocked) });
    if (r.needsConfirm.length && !confirmed) throw new DetailError(409, 'media_impact', `将删除 ${r.needsConfirm.length} 张其他作者上传的图片，请确认`, { items: this.impact(w, r.needsConfirm) });
    const by = new Map(cur.map((m) => [m.url, m.uploadedBy]));
    return next.map((m) => (by.has(m.url) ? by.get(m.url)! : actorId === w.authorId ? null : actorId));
  }
  private snap(w: DemoWork): RevSnapshot {
    return { title: w.title, body: w.body, caption: w.caption, notes: w.notes, params: { ...(w.params as Record<string, string>) }, media: this.curMedia(w), visibility: w.visibility };
  }
  ensureBase(w: DemoWork): void {
    if (this.h.state().revisions.some((r) => r.postId === w.id)) return;
    this.h.commit((s) => s.revisions.push({ postId: w.id, rev: 1, editorId: w.authorId, snapshot: this.snap(w), note: '初始版本', createdAt: w.createdAt }));
  }
  afterSave(workId: number, editorId: number, note = ''): void {
    const w = this.h.ugc.work(workId);
    if (!w) return;
    const snap = this.snap(w);
    const revs = this.h.state().revisions.filter((r) => r.postId === workId).sort((a, b) => b.rev - a.rev);
    if (revs[0] && JSON.stringify(revs[0].snapshot) === JSON.stringify(snap) && !note) return;
    const rev = (revs[0]?.rev ?? 0) + 1;
    this.h.commit((s) => {
      s.revisions.push({ postId: workId, rev, editorId, snapshot: snap, note: note.slice(0, 80), createdAt: this.iso() });
      s.revisions = s.revisions.filter((r) => r.postId !== workId || r.rev > rev - MAX_REVISIONS);
    });
  }
  exifMatch(w: DemoWork, q: URLSearchParams): boolean {
    const c = checkExifQuery(q);
    if (!c.ok) throw bad(c.path, c.error);
    if (!Object.values(c.value).some((v) => v !== null)) return true;
    if (w.type !== 'photo' && w.type !== 'album') return false;
    return matchesExif(normalizeExif(w.params), c.value);
  }

  // ------------------------------------------------------------ EXIF 筛选项
  private facets(q: URLSearchParams) {
    const topic = q.get('topic');
    const author = q.get('author');
    const inTopic = topic ? this.h.ugc.topicPostIds(topic) : null;
    const authorId = author ? this.uid(author) : null;
    const rows = this.h.ugc
      .allWorks()
      .filter((w) => (w.type === 'photo' || w.type === 'album') && this.h.ugc.visible(w) && w.visibility === 'public' && (!inTopic || inTopic.has(w.id)) && (!authorId || w.authorId === authorId))
      .map((w) => normalizeExif(w.params));
    return { facets: exifFacets(rows), total: rows.length };
  }

  // ------------------------------------------------------------ 共同作者
  private editable(headers: Record<string, string>, id: number, right: WorkRight) {
    const me = this.poster(headers);
    const w = this.h.ugc.work(id);
    if (!w || w.deletedAt) throw notFound();
    const r = this.role(w, me.id);
    if (!workCan(r.role, r.status, right)) {
      if (this.h.ugc.access(w, me.id) === 'none') throw notFound();
      throw forbidden(right === 'restore' ? '只有所有者和可编辑的共同作者可以恢复版本' : '只有作品所有者可以这样做');
    }
    return { me, w, role: r.role };
  }
  private listCoauthors(headers: Record<string, string>, id: number) {
    const viewer = this.h.optionalMember(headers);
    const w = this.h.ugc.work(id);
    if (!w || this.h.ugc.access(w, viewer?.id ?? null) === 'none') throw notFound();
    const c = this.collab(w, viewer?.id ?? null);
    return { owner: this.card(w.authorId), coauthors: c.coauthors, mine: { role: c.role, status: c.status, can: c.can } };
  }
  private invite(headers: Record<string, string>, id: number, input: unknown) {
    const { me, w } = this.editable(headers, id, 'members');
    this.h.social.limit(`coauthor-invite:${me.id}`, 30, 3_600_000, '邀请太频繁，请稍后再试');
    if (w.type === 'short') throw bad('type', '短动态不支持共同作者');
    const c = checkInvite(input, ['editor', 'contributor']);
    if (!c.ok) throw bad(c.path, c.error);
    const to = this.uid(c.value.username);
    if (to === me.id) throw bad('username', '不能邀请自己');
    const rel = this.h.social.rel(me.id, to);
    if (rel.blocked || rel.blockedBy) throw forbidden('无法邀请这位用户');
    const rows = this.h.state().coauthors.filter((x) => x.id === w.id);
    if (rows.filter((x) => x.status === 'invited' || x.status === 'accepted').length >= MAX_COAUTHORS) throw new SocialError(409, 'too_many', `一件作品最多 ${MAX_COAUTHORS} 位共同作者`);
    const ex = rows.find((x) => x.memberId === to);
    if (ex && (ex.status === 'invited' || ex.status === 'accepted')) throw new SocialError(409, 'already', ex.status === 'accepted' ? '对方已经是共同作者' : '已经邀请过了，等待对方回应');
    const t = this.iso();
    this.h.commit((s) => {
      s.coauthors = s.coauthors.filter((x) => !(x.id === w.id && x.memberId === to));
      s.coauthors.push({ id: w.id, memberId: to, role: c.value.role, label: '', status: 'invited', invitedBy: me.id, createdAt: t, respondedAt: null });
    });
    this.h.social.notify({ to, type: 'collab', actorId: me.id, objectKind: 'work', objectRef: String(w.id), excerpt: `邀请你成为「${w.title || '作品'}」的共同作者`, key: `collab:work:${w.id}:${to}:${t}` });
    return this.listCoauthors(headers, w.id);
  }
  private removeCoauthor(headers: Record<string, string>, id: number, username: string) {
    const me = this.poster(headers);
    const w = this.h.ugc.work(id);
    if (!w || w.deletedAt) throw notFound();
    const target = this.uid(username);
    const self = target === me.id;
    if (!self && w.authorId !== me.id) throw forbidden('只有作品所有者可以移除共同作者');
    const r = this.h.state().coauthors.find((x) => x.id === w.id && x.memberId === target);
    if (!r) throw notFound('对方不是这件作品的共同作者');
    this.h.commit((s) => {
      if (r.status === 'invited' || r.status === 'declined') s.coauthors = s.coauthors.filter((x) => !(x.id === w.id && x.memberId === target));
      else Object.assign(s.coauthors.find((x) => x.id === w.id && x.memberId === target)!, { status: 'removed', respondedAt: this.iso() });
    });
    return self ? { left: true } : this.listCoauthors(headers, w.id);
  }

  // ------------------------------------------------------------ 修订
  private listRevisions(headers: Record<string, string>, id: number) {
    const { me, w } = this.editable(headers, id, 'restore');
    const rs = this.h
      .state()
      .revisions.filter((r) => r.postId === w.id)
      .sort((a, b) => b.rev - a.rev)
      .slice(0, MAX_REVISIONS);
    return {
      revisions: rs.map((r, i) => ({ rev: r.rev, editor: this.card(r.editorId), note: r.note, createdAt: r.createdAt, changes: snapshotDiff(rs[i + 1]?.snapshot ?? null, r.snapshot), title: r.snapshot.title, mediaCount: r.snapshot.media.length })),
      current: rs[0]?.rev ?? 0,
      canRestore: true,
      mine: { isOwner: me.id === w.authorId },
    };
  }
  private getRevision(headers: Record<string, string>, id: number, rev: number) {
    const { w } = this.editable(headers, id, 'restore');
    const r = this.h.state().revisions.find((x) => x.postId === w.id && x.rev === rev);
    if (!r) throw notFound('没有这个版本');
    return { revision: { rev: r.rev, editor: this.card(r.editorId), note: r.note, createdAt: r.createdAt, snapshot: r.snapshot } };
  }
  private restore(headers: Record<string, string>, id: number, rev: number, input: unknown) {
    const { me, w, role } = this.editable(headers, id, 'restore');
    const r = this.h.state().revisions.find((x) => x.postId === w.id && x.rev === rev);
    if (!r) throw notFound('没有这个版本');
    const s = r.snapshot;
    const uploaders = this.guardMedia(w, me.id, s.media, (input as { confirmMediaRemoval?: unknown } | null)?.confirmMediaRemoval === true);
    const t = this.iso();
    this.h.ugc.patchWork(w.id, {
      title: s.title,
      body: s.body,
      caption: s.caption,
      notes: s.notes,
      params: { ...s.params },
      visibility: role === 'owner' ? (s.visibility as DemoWork['visibility']) : w.visibility,
      // 与普通修改相同：未建立信誉的作者恢复旧版本也要重新审核
      status: w.status === 'published' && needsReview(this.h.ugc.standing(me.id), this.h.ugc.state().rules) ? 'pending' : w.status,
      media: s.media.map((m, i) => ({ url: m.url, alt: m.alt, width: m.width, height: m.height, uploadedBy: uploaders[i] ?? null })),
      editedAt: w.status === 'published' ? t : null,
      updatedAt: t,
    });
    this.afterSave(w.id, me.id, `恢复到第 ${rev} 版`);
    return { work: this.h.ugc.toWork(this.h.ugc.work(w.id)!, me.id), restoredFrom: rev };
  }

  // ------------------------------------------------------------ 邀请
  private invitations(headers: Record<string, string>) {
    const me = this.h.memberFrom(headers);
    const s = this.h.state();
    const out: { kind: 'work' | 'project'; id: number; title: string; role: CollabRole; label: string; from: ReturnType<MockStudio['card']>; createdAt: string; href: string }[] = [];
    for (const c of s.coauthors.filter((x) => x.memberId === me.id && x.status === 'invited')) {
      const w = this.h.ugc.work(c.id);
      if (w && !w.deletedAt) out.push({ kind: 'work', id: w.id, title: w.title || '未命名作品', role: c.role, label: '', from: this.card(c.invitedBy), createdAt: c.createdAt, href: `/w/${w.id}/` });
    }
    for (const m of s.members.filter((x) => x.memberId === me.id && x.status === 'invited')) {
      const p = s.projects.find((x) => x.id === m.id);
      if (p) out.push({ kind: 'project', id: p.id, title: p.title, role: m.role, label: m.label, from: this.card(m.invitedBy), createdAt: m.createdAt, href: `/p/${p.slug}/` });
    }
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { invitations: out };
  }
  private respond(headers: Record<string, string>, kind: 'work' | 'project', id: number, accept: boolean) {
    const me = this.h.memberFrom(headers);
    const list = kind === 'work' ? this.h.state().coauthors : this.h.state().members;
    const r = list.find((x) => x.id === id && x.memberId === me.id);
    if (!r || r.status !== 'invited') throw notFound('没有待处理的邀请');
    this.h.commit((s) => {
      const x = (kind === 'work' ? s.coauthors : s.members).find((y) => y.id === id && y.memberId === me.id)!;
      x.status = accept ? 'accepted' : 'declined';
      x.respondedAt = this.iso();
    });
    if (r.invitedBy) this.h.social.notify({ to: r.invitedBy, type: 'collab', actorId: me.id, objectKind: kind, objectRef: String(id), excerpt: accept ? '接受了你的协作邀请' : '婉拒了你的协作邀请', key: `collab:${kind}:${id}:${me.id}:${accept ? 'a' : 'd'}` });
    return { status: accept ? 'accepted' : 'declined', kind, id };
  }

  // ------------------------------------------------------------ 项目
  private projectBySlug(slug: string): DemoProject {
    const p = PROJECT_SLUG_RE.test(slug) ? this.h.state().projects.find((x) => x.slug === slug) : undefined;
    if (!p) throw notFound('没有这个项目');
    return p;
  }
  private projectRole(p: DemoProject, memberId: number | null): { role: 'owner' | CollabRole | null; status: CollabStatus | null } {
    if (!memberId) return { role: null, status: null };
    if (p.ownerId === memberId) return { role: 'owner', status: null };
    const r = this.h.state().members.find((m) => m.id === p.id && m.memberId === memberId);
    return r ? { role: r.role, status: r.status } : { role: null, status: null };
  }
  private canSeeProject = (p: DemoProject, r: { role: string | null; status: CollabStatus | null }) => p.visibility === 'public' || r.role === 'owner' || r.status === 'accepted' || r.status === 'invited';
  private canEditProject = (r: { role: string | null; status: CollabStatus | null }) => r.role === 'owner' || (r.role === 'editor' && r.status === 'accepted');
  private repoOf(u: string) {
    const m = GITHUB_REPO_RE.exec(u);
    return m ? { url: u, owner: m[1]!, name: m[2]! } : null;
  }
  private projectCard(p: DemoProject) {
    const s = this.h.state();
    const logs = s.logs.filter((l) => l.projectId === p.id);
    const rel = logs.filter((l) => l.kind === 'release').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return {
      slug: p.slug,
      title: p.title,
      tagline: p.tagline,
      status: p.status,
      coverUrl: p.coverUrl,
      visibility: p.visibility,
      owner: this.card(p.ownerId),
      repo: this.repoOf(p.repoUrl),
      latestRelease: rel ? { version: rel.version, at: rel.createdAt } : null,
      counts: { logs: logs.length, links: s.links.filter((l) => l.projectId === p.id).length },
      updatedAt: p.updatedAt,
    };
  }
  private listProjects() {
    return {
      projects: this.h
        .state()
        .projects.filter((p) => p.visibility === 'public' && !this.h.ugc.standing(p.ownerId).banned)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 24)
        .map((p) => this.projectCard(p)),
    };
  }
  private projectsOf(headers: Record<string, string>, memberId: number) {
    const viewer = this.h.optionalMember(headers);
    const self = viewer?.id === memberId;
    const s = this.h.state();
    return {
      projects: s.projects
        .filter((p) => (p.ownerId === memberId || s.members.some((m) => m.id === p.id && m.memberId === memberId && m.status === 'accepted')) && (self || p.visibility === 'public'))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((p) => this.projectCard(p)),
    };
  }
  private getProject(headers: Record<string, string>, slug: string) {
    const viewer = this.h.optionalMember(headers);
    const p = this.projectBySlug(slug);
    const r = this.projectRole(p, viewer?.id ?? null);
    if (!this.canSeeProject(p, r)) throw notFound('没有这个项目');
    const owner = r.role === 'owner';
    const s = this.h.state();
    const members = s.members.filter((m) => m.id === p.id && (owner || m.status === 'accepted' || m.status === 'removed' || m.memberId === viewer?.id)).map((m) => ({ user: this.card(m.memberId), role: m.role, label: m.label, status: m.status }));
    const logs = s.logs
      .filter((l) => l.projectId === p.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
      .map((l) => ({ id: l.id, kind: l.kind, title: l.title, body: l.body, version: l.version, author: this.card(l.authorId), createdAt: l.createdAt, updatedAt: l.updatedAt, canEdit: !!viewer && (l.authorId === viewer.id || owner) }));
    const links: unknown[] = [];
    for (const l of s.links.filter((x) => x.projectId === p.id).sort((a, b) => a.position - b.position)) {
      if (l.kind === 'work') {
        const w = this.h.ugc.work(Number(l.ref));
        if (!w || this.h.ugc.access(w, viewer?.id ?? null) !== 'full') continue;
        links.push({ kind: 'work', ref: l.ref, work: this.h.ugc.toWork(w, viewer?.id ?? null) });
      } else {
        const post = this.h.posts().find((x) => x.slug === l.ref && x.status === 'published');
        if (post) links.push({ kind: 'post', ref: l.ref, title: post.title, excerpt: post.summary ?? '', date: post.publishedAt });
      }
    }
    return { project: { ...this.projectCard(p), description: p.description, homepageUrl: p.homepageUrl, repoUrl: p.repoUrl, createdAt: p.createdAt, members, logs, links }, mine: { role: r.role, status: r.status, canEdit: this.canEditProject(r), canManage: owner } };
  }
  private createProject(headers: Record<string, string>, input: unknown) {
    const me = this.poster(headers);
    this.h.social.limit(`project:${me.id}`, 10, 3_600_000, '创建太频繁，请稍后再试');
    const c = checkProject(input);
    if (!c.ok) throw bad(c.path, c.error);
    const s = this.h.state();
    if (s.projects.filter((p) => p.ownerId === me.id).length >= MAX_PROJECTS) throw new SocialError(409, 'too_many', `最多创建 ${MAX_PROJECTS} 个项目`);
    if (s.projects.some((p) => p.slug === c.value.slug)) throw new SocialError(409, 'slug_taken', '这个地址已经被使用了');
    const t = this.iso();
    this.h.commit((st) => st.projects.push({ id: st.nextId++, ownerId: me.id, ...c.value, createdAt: t, updatedAt: t }));
    return this.getProject(headers, c.value.slug);
  }
  private editProject(headers: Record<string, string>, slug: string, needOwner = false) {
    const me = this.poster(headers);
    const p = this.projectBySlug(slug);
    const r = this.projectRole(p, me.id);
    if (!this.canSeeProject(p, r)) throw notFound('没有这个项目');
    if (needOwner ? r.role !== 'owner' : !this.canEditProject(r)) throw forbidden(needOwner ? '只有项目所有者可以这样做' : '你没有编辑这个项目的权限');
    return { me, p, owner: r.role === 'owner' };
  }
  private touch(st: StudioState, id: number) {
    st.projects.find((x) => x.id === id)!.updatedAt = this.iso();
  }
  private updateProject(headers: Record<string, string>, slug: string, input: unknown) {
    const { p, owner } = this.editProject(headers, slug);
    const o = { ...((input ?? {}) as Record<string, unknown>) };
    if (!owner) delete o.visibility;
    const c = checkProject(o, { slug: p.slug, title: p.title, tagline: p.tagline, description: p.description, status: p.status, repoUrl: p.repoUrl, homepageUrl: p.homepageUrl, coverUrl: p.coverUrl, visibility: p.visibility });
    if (!c.ok) throw bad(c.path, c.error);
    this.h.commit((st) => Object.assign(st.projects.find((x) => x.id === p.id)!, c.value, { updatedAt: this.iso() }));
    return this.getProject(headers, slug);
  }
  private deleteProject(headers: Record<string, string>, slug: string) {
    const { p } = this.editProject(headers, slug, true);
    this.h.commit((st) => {
      st.links = st.links.filter((l) => l.projectId !== p.id);
      st.logs = st.logs.filter((l) => l.projectId !== p.id);
      st.members = st.members.filter((m) => m.id !== p.id);
      st.stats = st.stats.filter((x) => !(x.kind === 'project' && x.ref === p.slug));
      st.refs = st.refs.filter((x) => !(x.kind === 'project' && x.ref === p.slug));
      st.projects = st.projects.filter((x) => x.id !== p.id);
    });
    return { deleted: true, slug };
  }
  private addLog(headers: Record<string, string>, slug: string, input: unknown) {
    const { me, p } = this.editProject(headers, slug);
    this.h.social.limit(`project-log:${me.id}`, 30, 3_600_000, '发布太频繁，请稍后再试');
    const c = checkLog(input);
    if (!c.ok) throw bad(c.path, c.error);
    const t = this.iso();
    this.h.commit((st) => {
      st.logs.push({ id: st.nextId++, projectId: p.id, authorId: me.id, ...c.value, createdAt: t, updatedAt: t });
      this.touch(st, p.id);
    });
    return this.getProject(headers, slug);
  }
  private editLog(headers: Record<string, string>, logId: number, input: unknown | null) {
    const me = this.poster(headers);
    const l = this.h.state().logs.find((x) => x.id === logId);
    if (!l) throw notFound('没有这条日志');
    const p = this.h.state().projects.find((x) => x.id === l.projectId)!;
    if (l.authorId !== me.id && p.ownerId !== me.id) throw forbidden('只能修改自己写的日志');
    if (input === null) this.h.commit((st) => void (st.logs = st.logs.filter((x) => x.id !== logId)));
    else {
      const c = checkLog(input);
      if (!c.ok) throw bad(c.path, c.error);
      this.h.commit((st) => Object.assign(st.logs.find((x) => x.id === logId)!, c.value, { updatedAt: this.iso() }));
    }
    return this.getProject(headers, p.slug);
  }
  private setLinks(headers: Record<string, string>, slug: string, input: unknown) {
    const { me, p } = this.editProject(headers, slug);
    const c = checkLinks(input);
    if (!c.ok) throw bad(c.path, c.error);
    for (const [i, l] of c.value.entries()) {
      if (l.kind === 'work') {
        const w = this.h.ugc.work(Number(l.ref));
        if (!w || this.h.ugc.access(w, me.id) === 'none') throw bad(`links.${i}.ref`, '作品不存在或你看不到');
      } else if (!this.h.posts().some((x) => x.slug === l.ref && x.status === 'published')) throw bad(`links.${i}.ref`, '文章不存在');
    }
    this.h.commit((st) => {
      st.links = [...st.links.filter((l) => l.projectId !== p.id), ...c.value.map((l, i) => ({ projectId: p.id, kind: l.kind, ref: l.ref, position: i }))];
      this.touch(st, p.id);
    });
    return this.getProject(headers, slug);
  }
  private inviteMember(headers: Record<string, string>, slug: string, input: unknown) {
    const { me, p } = this.editProject(headers, slug, true);
    this.h.social.limit(`coauthor-invite:${me.id}`, 30, 3_600_000, '邀请太频繁，请稍后再试');
    const c = checkInvite(input, COLLAB_ROLES);
    if (!c.ok) throw bad(c.path, c.error);
    const to = this.uid(c.value.username);
    if (to === me.id) throw bad('username', '不能邀请自己');
    const ex = this.h.state().members.find((m) => m.id === p.id && m.memberId === to);
    if (ex && (ex.status === 'invited' || ex.status === 'accepted')) throw new SocialError(409, 'already', ex.status === 'accepted' ? '对方已经是项目成员' : '已经邀请过了，等待对方回应');
    const t = this.iso();
    this.h.commit((st) => {
      st.members = st.members.filter((m) => !(m.id === p.id && m.memberId === to));
      st.members.push({ id: p.id, memberId: to, role: c.value.role, label: c.value.label, status: 'invited', invitedBy: me.id, createdAt: t, respondedAt: null });
    });
    this.h.social.notify({ to, type: 'collab', actorId: me.id, objectKind: 'project', objectRef: p.slug, excerpt: `邀请你加入项目「${p.title}」`, key: `collab:project:${p.id}:${to}:${t}` });
    return this.getProject(headers, slug);
  }
  private removeMember(headers: Record<string, string>, slug: string, username: string) {
    const me = this.poster(headers);
    const p = this.projectBySlug(slug);
    const target = this.uid(username);
    if (target !== me.id && p.ownerId !== me.id) throw forbidden('只有项目所有者可以移除成员');
    const r = this.h.state().members.find((m) => m.id === p.id && m.memberId === target);
    if (!r) throw notFound('对方不是项目成员');
    this.h.commit((st) => {
      if (r.status === 'accepted') Object.assign(st.members.find((m) => m.id === p.id && m.memberId === target)!, { status: 'removed', respondedAt: this.iso() });
      else st.members = st.members.filter((m) => !(m.id === p.id && m.memberId === target));
    });
    return target === me.id ? { left: true } : this.getProject(headers, slug);
  }

  // ------------------------------------------------------------ 摄影专题
  private featureBySlug(slug: string): DemoFeature {
    const f = PROJECT_SLUG_RE.test(slug) ? this.h.state().features.find((x) => x.slug === slug) : undefined;
    if (!f) throw notFound('没有这个专题');
    return f;
  }
  private checkFeatureWorks(ownerId: number, blocks: FeatureBlock[]) {
    for (const [i, b] of blocks.entries()) {
      if (b.t !== 'work') continue;
      const w = this.h.ugc.work(b.id);
      if (!w || (w.type !== 'photo' && w.type !== 'album') || this.h.ugc.access(w, null) !== 'full') throw bad(`blocks.${i}.id`, '只能使用公开的摄影作品或影集');
      if (w.authorId !== ownerId && !this.h.state().coauthors.some((c) => c.id === w.id && c.memberId === ownerId && c.status === 'accepted')) throw bad(`blocks.${i}.id`, '只能使用自己（或参与创作）的作品');
    }
  }
  private featureCard(f: DemoFeature) {
    const first = f.blocks.find((b) => b.t === 'work') as { id: number } | undefined;
    const m = first ? this.h.ugc.work(first.id)?.media[0] : undefined;
    return { slug: f.slug, title: f.title, dek: f.dek, status: f.status, owner: this.card(f.ownerId), cover: m ? { url: m.url, alt: m.alt, width: m.width, height: m.height } : null, works: f.blocks.filter((b) => b.t === 'work').length, publishedAt: f.publishedAt, updatedAt: f.updatedAt };
  }
  private listFeatures(headers: Record<string, string>, q: URLSearchParams) {
    const s = this.h.state();
    if (q.get('mine') === '1') {
      const me = this.h.memberFrom(headers);
      return { features: s.features.filter((f) => f.ownerId === me.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((f) => this.featureCard(f)) };
    }
    return {
      features: s.features
        .filter((f) => f.status === 'published' && !this.h.ugc.standing(f.ownerId).banned)
        .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
        .slice(0, 24)
        .map((f) => this.featureCard(f)),
    };
  }
  private getFeature(headers: Record<string, string>, slug: string) {
    const viewer = this.h.optionalMember(headers);
    const f = this.featureBySlug(slug);
    const own = viewer?.id === f.ownerId;
    if (f.status !== 'published' && !own) throw notFound('没有这个专题');
    const blocks: unknown[] = [];
    let hidden = 0;
    for (const b of f.blocks) {
      if (b.t === 'text') blocks.push(b);
      else {
        const w = this.h.ugc.work(b.id);
        if (!w || this.h.ugc.access(w, viewer?.id ?? null) !== 'full') {
          hidden++;
          continue;
        }
        blocks.push({ t: 'work', caption: b.caption, work: this.h.ugc.toWork(w, viewer?.id ?? null) });
      }
    }
    return { feature: { ...this.featureCard(f), blocks, raw: own ? f.blocks : undefined, hidden: own ? hidden : 0 }, mine: { canEdit: own } };
  }
  private createFeature(headers: Record<string, string>, input: unknown) {
    const me = this.poster(headers);
    this.h.social.limit(`feature:${me.id}`, 10, 3_600_000, '创建太频繁，请稍后再试');
    const c = checkFeature(input);
    if (!c.ok) throw bad(c.path, c.error);
    if (this.h.state().features.some((f) => f.slug === c.value.slug)) throw new SocialError(409, 'slug_taken', '这个地址已经被使用了');
    this.checkFeatureWorks(me.id, c.value.blocks);
    const t = this.iso();
    this.h.commit((st) => st.features.push({ id: st.nextId++, ownerId: me.id, ...c.value, status: 'draft', createdAt: t, updatedAt: t, publishedAt: null }));
    return this.getFeature(headers, c.value.slug);
  }
  private ownFeature(headers: Record<string, string>, slug: string) {
    const me = this.poster(headers);
    const f = this.featureBySlug(slug);
    if (f.ownerId !== me.id) {
      if (f.status !== 'published') throw notFound('没有这个专题');
      throw forbidden('只能编辑自己的专题');
    }
    return { me, f };
  }
  private updateFeature(headers: Record<string, string>, slug: string, input: unknown) {
    const { me, f } = this.ownFeature(headers, slug);
    const c = checkFeature(input, { slug: f.slug, title: f.title, dek: f.dek, blocks: f.blocks });
    if (!c.ok) throw bad(c.path, c.error);
    this.checkFeatureWorks(me.id, c.value.blocks);
    this.h.commit((st) => Object.assign(st.features.find((x) => x.id === f.id)!, { title: c.value.title, dek: c.value.dek, blocks: c.value.blocks, updatedAt: this.iso() }));
    return this.getFeature(headers, slug);
  }
  private publishFeature(headers: Record<string, string>, slug: string, on: boolean) {
    const { f } = this.ownFeature(headers, slug);
    if (on && !f.blocks.some((b) => b.t === 'work')) throw bad('blocks', '专题至少需要一件作品');
    const t = this.iso();
    this.h.commit((st) => Object.assign(st.features.find((x) => x.id === f.id)!, { status: on ? 'published' : 'draft', publishedAt: on ? (f.publishedAt ?? t) : f.publishedAt, updatedAt: t }));
    return this.getFeature(headers, slug);
  }
  private deleteFeature(headers: Record<string, string>, slug: string) {
    const { f } = this.ownFeature(headers, slug);
    this.h.commit((st) => {
      st.features = st.features.filter((x) => x.id !== f.id);
      st.stats = st.stats.filter((x) => !(x.kind === 'feature' && x.ref === f.slug));
      st.refs = st.refs.filter((x) => !(x.kind === 'feature' && x.ref === f.slug));
    });
    return { deleted: true, slug };
  }

  // ------------------------------------------------------------ 数据中心
  private recordView(headers: Record<string, string>, input: unknown) {
    const c = checkView(input);
    if (!c.ok) throw bad(c.path, c.error);
    const { kind, ref } = c.value;
    const viewer = this.h.optionalMember(headers);
    const s = this.h.state();
    let owner: number | null = null;
    if (kind === 'work') {
      const w = /^\d+$/.test(ref) ? this.h.ugc.work(Number(ref)) : undefined;
      if (w && this.h.ugc.access(w, null) === 'full') owner = w.authorId;
    } else if (kind === 'project') owner = s.projects.find((p) => p.slug === ref && p.visibility === 'public')?.ownerId ?? null;
    else if (kind === 'feature') owner = s.features.find((f) => f.slug === ref && f.status === 'published')?.ownerId ?? null;
    else {
      try {
        const p = this.h.social.byUsername(ref.toLowerCase());
        owner = p.visibility === 'public' ? p.memberId : null;
      } catch {
        owner = null;
      }
    }
    if (!owner || viewer?.id === owner) return { counted: false };
    const day = this.iso().slice(0, 10);
    const domain = referrerDomain((input as { referrer?: unknown }).referrer, typeof location === 'undefined' ? '' : location.hostname);
    this.h.commit((st) => {
      const cur = st.stats.find((x) => x.kind === kind && x.ref === ref && x.day === day);
      if (cur) cur.views = Math.min(cur.views + 1, 1_000_000);
      else st.stats.push({ kind, ref, ownerId: owner!, day, views: 1 });
      if (domain) {
        const r = st.refs.find((x) => x.kind === kind && x.ref === ref && x.day === day && x.domain === domain);
        if (r) r.n++;
        else st.refs.push({ kind, ref, ownerId: owner!, day, domain, n: 1 });
      }
    });
    return { counted: true };
  }
  private stats(headers: Record<string, string>, q: URLSearchParams) {
    const me = this.h.memberFrom(headers);
    const days = Number(q.get('days') ?? 30);
    if (!(STAT_RANGES as readonly number[]).includes(days)) throw bad('days', 'days 只能是 7 / 30 / 90');
    const now = this.h.now().getTime();
    const since = new Date(now - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const s = this.h.state();
    const ugc = this.h.ugc.state();
    const mine = new Set(ugc.works.filter((w) => w.authorId === me.id && !w.deletedAt).map((w) => w.id));
    const group = (xs: { day: string; n: number }[]) => {
      const m = new Map<string, number>();
      for (const x of xs) if (x.day >= since) m.set(x.day, (m.get(x.day) ?? 0) + x.n);
      return fillSeries([...m].map(([day, n]) => ({ day, n })), days, now);
    };
    const views = group(s.stats.filter((x) => x.ownerId === me.id).map((x) => ({ day: x.day, n: x.views })));
    const reactions = group(ugc.reactions.filter((r) => mine.has(r.postId) && r.memberId !== me.id).map((r) => ({ day: r.createdAt.slice(0, 10), n: 1 })));
    const bookmarks = group(ugc.bookmarks.filter((r) => mine.has(r.postId) && r.memberId !== me.id).map((r) => ({ day: r.createdAt.slice(0, 10), n: 1 })));
    const okComment = (c: { postId: number; status: string; modState: string; deletedAt: string | null }) => mine.has(c.postId) && c.status === 'published' && c.modState === 'ok' && !c.deletedAt;
    const comments = group(ugc.comments.filter((c) => okComment(c) && c.authorId !== me.id).map((c) => ({ day: c.createdAt.slice(0, 10), n: 1 })));
    const follows = this.h.social.socialState().follows.filter((f) => f.following === me.id);
    const followers = group(follows.map((f) => ({ day: f.createdAt.slice(0, 10), n: 1 })));
    const agg = new Map<string, { kind: StatKind; ref: string; views: number }>();
    for (const x of s.stats.filter((y) => y.ownerId === me.id && y.day >= since)) {
      const k = `${x.kind}:${x.ref}`;
      const cur = agg.get(k) ?? { kind: x.kind, ref: x.ref, views: 0 };
      cur.views += x.views;
      agg.set(k, cur);
    }
    const top = [...agg.values()]
      .sort((a, b) => b.views - a.views)
      .slice(0, 10)
      .map((r) => {
        if (r.kind === 'work') {
          const w = this.h.ugc.work(Number(r.ref));
          return { ...r, title: w?.title || `作品 #${r.ref}`, href: `/w/${r.ref}/` };
        }
        if (r.kind === 'project') return { ...r, title: s.projects.find((p) => p.slug === r.ref)?.title ?? r.ref, href: `/p/${r.ref}/` };
        if (r.kind === 'feature') return { ...r, title: s.features.find((f) => f.slug === r.ref)?.title ?? r.ref, href: `/f/${r.ref}/` };
        return { ...r, title: '我的主页', href: `/u/${r.ref}/` };
      });
    const rm = new Map<string, number>();
    for (const x of s.refs.filter((y) => y.ownerId === me.id && y.day >= since)) rm.set(x.domain, (rm.get(x.domain) ?? 0) + x.n);
    const refs = [...rm].map(([domain, n]) => ({ domain, n })).sort((a, b) => b.n - a.n).slice(0, 10);
    const total = sumSeries(views);
    const direct = Math.max(0, total - refs.reduce((a, b) => a + b.n, 0));
    return {
      days,
      private: { views: { total, series: views }, top, referrers: [...refs, ...(direct ? [{ domain: '', n: direct }] : [])] },
      trends: { reactions: { total: sumSeries(reactions), series: reactions }, bookmarks: { total: sumSeries(bookmarks), series: bookmarks }, comments: { total: sumSeries(comments), series: comments }, followers: { total: follows.length, gained: sumSeries(followers), series: followers } },
      public: { reactions: ugc.reactions.filter((r) => mine.has(r.postId)).length, bookmarks: ugc.bookmarks.filter((r) => mine.has(r.postId)).length, comments: ugc.comments.filter(okComment).length, followers: follows.length },
      privacy: STATS_PRIVACY_NOTE,
    };
  }

  // ------------------------------------------------------------ 导出 / 注销
  exportFor(id: number) {
    const s = this.h.state();
    return {
      projects: s.projects.filter((p) => p.ownerId === id).map((p) => ({ slug: p.slug, title: p.title, tagline: p.tagline, description: p.description, status: p.status, repo_url: p.repoUrl, homepage_url: p.homepageUrl, visibility: p.visibility, created_at: p.createdAt })),
      projectLogs: s.logs.filter((l) => l.authorId === id).map((l) => ({ project_id: l.projectId, kind: l.kind, title: l.title, body: l.body, version: l.version, created_at: l.createdAt })),
      projectMemberships: s.members.filter((m) => m.memberId === id).map((m) => ({ project_id: m.id, role: m.role, label: m.label, status: m.status, created_at: m.createdAt })),
      coauthorships: s.coauthors.filter((c) => c.memberId === id).map((c) => ({ post_id: c.id, role: c.role, status: c.status, created_at: c.createdAt })),
      photoFeatures: s.features.filter((f) => f.ownerId === id).map((f) => ({ slug: f.slug, title: f.title, dek: f.dek, blocks: JSON.stringify(f.blocks), status: f.status, created_at: f.createdAt })),
      statsDaily: s.stats.filter((x) => x.ownerId === id).map((x) => ({ kind: x.kind, ref: x.ref, day: x.day, views: x.views })),
    };
  }
  purge(id: number): void {
    this.h.commit((s) => {
      const owned = new Set(s.projects.filter((p) => p.ownerId === id).map((p) => p.id));
      s.links = s.links.filter((l) => !owned.has(l.projectId));
      s.logs = s.logs.filter((l) => !owned.has(l.projectId));
      for (const l of s.logs) if (l.authorId === id) l.authorId = null;
      s.members = s.members.filter((m) => !owned.has(m.id) && m.memberId !== id);
      s.projects = s.projects.filter((p) => p.ownerId !== id);
      s.features = s.features.filter((f) => f.ownerId !== id);
      s.coauthors = s.coauthors.filter((c) => c.memberId !== id && c.invitedBy !== id);
      for (const r of s.revisions) if (r.editorId === id) r.editorId = null;
      s.stats = s.stats.filter((x) => x.ownerId !== id);
      s.refs = s.refs.filter((x) => x.ownerId !== id);
    });
  }

  // ------------------------------------------------------------ 路由
  route(m: string, sub: string, q: URLSearchParams, body: unknown, headers: Record<string, string>): { status: number; body: unknown } | null {
    const ok = (b: unknown, status = 200) => ({ status, body: b });
    let mt: RegExpExecArray | null;
    const ID = '(\\d{1,10})';
    const SLUG = '([a-z0-9][a-z0-9-]{0,38}[a-z0-9]?)';
    const re = (s: string) => new RegExp(`^${s}$`);
    if (m === 'GET') {
      if (sub === '/works/exif-facets') return ok(this.facets(q));
      if ((mt = re(`/works/${ID}/coauthors`).exec(sub))) return ok(this.listCoauthors(headers, Number(mt[1])));
      if ((mt = re(`/works/${ID}/revisions`).exec(sub))) return ok(this.listRevisions(headers, Number(mt[1])));
      if ((mt = re(`/works/${ID}/revisions/${ID}`).exec(sub))) return ok(this.getRevision(headers, Number(mt[1]), Number(mt[2])));
      if (sub === '/me/invitations') return ok(this.invitations(headers));
      if (sub === '/me/stats') return ok(this.stats(headers, q));
      if (sub === '/me/projects') return ok(this.projectsOf(headers, this.h.memberFrom(headers).id));
      if (sub === '/projects') return ok(this.listProjects());
      if ((mt = re(`/projects/${SLUG}`).exec(sub))) return ok(this.getProject(headers, mt[1]!));
      if ((mt = /^\/users\/([A-Za-z0-9_]{3,20})\/projects$/.exec(sub))) return ok(this.projectsOf(headers, this.uid(mt[1]!)));
      if (sub === '/features') return ok(this.listFeatures(headers, q));
      if ((mt = re(`/features/${SLUG}`).exec(sub))) return ok(this.getFeature(headers, mt[1]!));
      return null;
    }
    if ((mt = re(`/works/${ID}/coauthors`).exec(sub)) && m === 'POST') return ok(this.invite(headers, Number(mt[1]), body), 201);
    if ((mt = re(`/works/${ID}/coauthors/([A-Za-z0-9_]{3,20})`).exec(sub)) && m === 'DELETE') return ok(this.removeCoauthor(headers, Number(mt[1]), mt[2]!));
    if ((mt = re(`/works/${ID}/revisions/${ID}/restore`).exec(sub)) && m === 'POST') return ok(this.restore(headers, Number(mt[1]), Number(mt[2]), body));
    if ((mt = re(`/invitations/(work|project)/${ID}/(accept|decline)`).exec(sub)) && m === 'POST') return ok(this.respond(headers, mt[1] as 'work' | 'project', Number(mt[2]), mt[3] === 'accept'));
    if (sub === '/projects' && m === 'POST') return ok(this.createProject(headers, body), 201);
    if ((mt = re(`/projects/${SLUG}`).exec(sub))) {
      if (m === 'PATCH' || m === 'PUT') return ok(this.updateProject(headers, mt[1]!, body));
      if (m === 'DELETE') return ok(this.deleteProject(headers, mt[1]!));
    }
    if ((mt = re(`/projects/${SLUG}/logs`).exec(sub)) && m === 'POST') return ok(this.addLog(headers, mt[1]!, body), 201);
    if ((mt = re(`/projects/logs/${ID}`).exec(sub))) {
      if (m === 'PATCH' || m === 'PUT') return ok(this.editLog(headers, Number(mt[1]), body));
      if (m === 'DELETE') return ok(this.editLog(headers, Number(mt[1]), null));
    }
    if ((mt = re(`/projects/${SLUG}/links`).exec(sub)) && m === 'PUT') return ok(this.setLinks(headers, mt[1]!, body));
    if ((mt = re(`/projects/${SLUG}/members`).exec(sub)) && m === 'POST') return ok(this.inviteMember(headers, mt[1]!, body), 201);
    if ((mt = re(`/projects/${SLUG}/members/([A-Za-z0-9_]{3,20})`).exec(sub)) && m === 'DELETE') return ok(this.removeMember(headers, mt[1]!, mt[2]!));
    if (sub === '/features' && m === 'POST') return ok(this.createFeature(headers, body), 201);
    if ((mt = re(`/features/${SLUG}`).exec(sub))) {
      if (m === 'PATCH' || m === 'PUT') return ok(this.updateFeature(headers, mt[1]!, body));
      if (m === 'DELETE') return ok(this.deleteFeature(headers, mt[1]!));
    }
    if ((mt = re(`/features/${SLUG}/publish`).exec(sub)) && (m === 'POST' || m === 'DELETE')) return ok(this.publishFeature(headers, mt[1]!, m === 'POST'));
    if (sub === '/views' && m === 'POST') return ok(this.recordView(headers, body));
    return null;
  }
  routeAdmin(m: string, sub: string): { status: number; body: unknown } | null {
    if (sub === '/studio/reindex-exif' && m === 'POST') return { status: 200, body: { indexed: this.h.ugc.allWorks().filter((w) => (w.type === 'photo' || w.type === 'album') && !w.deletedAt).length } };
    return null;
  }
}
