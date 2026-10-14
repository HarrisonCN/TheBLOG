/**
 * 演示模式的 L24 内容编辑器 2.0 接口：与 worker/src/editor.ts 相同的路径、状态码与返回结构（共用 editor-core.ts）。
 *  - 服务器草稿（修订号冲突 409）、定时发布（每次请求先把到点的草稿发布出去 = Worker 的 cron）、媒体库、模板；
 *  - 公开 GET /api/scheduled：即将发布的文章（只有 slug、标题、分类、时间）。
 * 数据存在访客自己的浏览器（localStorage）里。
 */
import {
  duePosts,
  isDraftKey,
  MEDIA_LIMITS,
  resolveDraftWrite,
  searchMedia,
  TEMPLATES,
  UPCOMING_MAX,
  validateDraft,
  validateMedia,
  validateSchedule,
  cleanAlt,
  type DraftSnapshot,
  type MediaAsset,
  type UpcomingPost,
} from '../editor-core';
import type { Post } from '../types';

export interface EditorState {
  drafts: Record<string, DraftSnapshot>;
  media: MediaAsset[];
  /** slug → 定时发布时间（Worker 里是 posts.publish_at） */
  schedule: Record<string, string>;
  nextMediaId: number;
}
export const editorSeed = (): EditorState => ({ drafts: {}, media: [], schedule: {}, nextMediaId: 1 });

export class EditorError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

interface Host {
  state: () => EditorState;
  commit: (mutate: (s: EditorState) => void) => void;
  posts: () => Post[];
  /** 改文章（发布到点的定时文章） */
  commitPosts: (mutate: (posts: Post[]) => void) => void;
  now: () => Date;
}
type R = { status: number; body: unknown };
const ok = (body: unknown, status = 200): R => ({ status, body });

export class MockEditor {
  constructor(private h: Host) {}

  /** = Worker 的定时任务：把到点的定时草稿发布出去；已发布 / 已删除的文章清掉定时 */
  tick(): void {
    const s = this.h.state();
    const slugs = Object.keys(s.schedule);
    if (!slugs.length) return;
    const nowIso = this.h.now().toISOString();
    const posts = this.h.posts();
    const rows = slugs.map((slug) => ({ slug, publishAt: s.schedule[slug]!, status: posts.find((p) => p.slug === slug)?.status ?? 'gone' }));
    const due = duePosts(rows, nowIso);
    const stale = rows.filter((r) => r.status !== 'draft');
    if (!due.length && !stale.length) return;
    if (due.length)
      this.h.commitPosts((list) => {
        for (const d of due) {
          const p = list.find((x) => x.slug === d.slug);
          if (!p) continue;
          p.status = 'published';
          p.publishedAt = d.publishAt;
          p.updatedAt = nowIso;
        }
      });
    this.h.commit((st) => {
      for (const r of [...due, ...stale]) delete st.schedule[r.slug];
    });
  }

  private upcoming(): (UpcomingPost & { slug: string })[] {
    const s = this.h.state();
    const posts = this.h.posts();
    return Object.entries(s.schedule)
      .map(([slug, at]) => ({ p: posts.find((x) => x.slug === slug), slug, at }))
      .filter((x) => x.p && x.p.status === 'draft')
      .map((x) => ({ slug: x.slug, title: x.p!.title, category: x.p!.category ?? '', publishAt: x.at }))
      .sort((a, b) => (a.publishAt < b.publishAt ? -1 : a.publishAt > b.publishAt ? 1 : 0));
  }

  routePublic(m: string, path: string): R | null {
    if (path === '/api/scheduled' && (m === 'GET' || m === 'HEAD')) return ok({ posts: this.upcoming().slice(0, UPCOMING_MAX) });
    return null;
  }

  /** sub = /api/admin 之后的路径（已校验站长登录与 CSRF） */
  routeAdmin(m: string, sub: string, q: URLSearchParams, body: unknown): R | null {
    if (!sub.startsWith('/editor/')) return null;
    let mt: RegExpExecArray | null;
    if (sub === '/editor/templates' && m === 'GET') return ok({ templates: TEMPLATES });
    // ---- 草稿
    if (sub === '/editor/drafts' && m === 'GET') {
      const list = Object.values(this.h.state().drafts).sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
      return ok({ drafts: list.map(({ markdown, ...rest }) => ({ ...rest, chars: markdown.length })) });
    }
    if ((mt = /^\/editor\/drafts\/([^/]+)$/.exec(sub))) {
      let key: string;
      try {
        key = decodeURIComponent(mt[1]!);
      } catch {
        key = '';
      }
      if (!isDraftKey(key)) throw new EditorError(400, 'validation_error', '草稿键不对');
      const cur = this.h.state().drafts[key] ?? null;
      if (m === 'GET') {
        if (!cur) throw new EditorError(404, 'not_found', '没有这份草稿');
        return ok({ draft: cur });
      }
      if (m === 'PUT') {
        const o = (body ?? {}) as { baseRev?: unknown };
        const v = validateDraft(body);
        if (!v.ok) throw new EditorError(400, 'validation_error', v.message, [{ path: v.field, message: v.message }]);
        const baseRev = typeof o.baseRev === 'number' && Number.isInteger(o.baseRev) && o.baseRev >= 0 ? o.baseRev : -1;
        const w = resolveDraftWrite(cur?.rev ?? null, baseRev);
        if (!w.ok) throw new EditorError(409, 'draft_conflict', '这份草稿在别处（另一个标签页或设备）改过了', { draft: cur });
        const draft: DraftSnapshot = { key, title: v.title, markdown: v.markdown, rev: w.rev, savedAt: this.h.now().toISOString() };
        this.h.commit((s) => void (s.drafts[key] = draft));
        return ok({ draft });
      }
      if (m === 'DELETE') {
        this.h.commit((s) => void delete s.drafts[key]);
        return ok({ ok: true });
      }
    }
    // ---- 定时发布
    if (sub === '/editor/scheduled' && m === 'GET') return ok({ posts: this.upcoming() });
    if ((mt = /^\/editor\/schedule\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(sub)) && m === 'POST') {
      const slug = mt[1]!;
      const post = this.h.posts().find((p) => p.slug === slug);
      if (!post) throw new EditorError(404, 'not_found', '文章不存在');
      if (post.status === 'published') throw new EditorError(409, 'already_published', '文章已经发布了，不能再定时');
      const v = validateSchedule((body as { publishAt?: unknown } | null)?.publishAt ?? null, this.h.now().getTime());
      if (!v.ok) throw new EditorError(400, 'validation_error', v.message, [{ path: 'publishAt', message: v.message }]);
      this.h.commit((s) => {
        if (v.at) s.schedule[slug] = v.at;
        else delete s.schedule[slug];
      });
      return ok({ slug, publishAt: v.at });
    }
    // ---- 媒体库
    if (sub === '/editor/media' && m === 'GET') {
      const list = searchMedia(this.h.state().media, q.get('q') ?? '').slice().sort((a, b) => b.id - a.id);
      return ok({ media: list.slice(0, MEDIA_LIMITS.perPage), total: list.length });
    }
    if (sub === '/editor/media' && m === 'POST') {
      const v = validateMedia(body);
      if (!v.ok) throw new EditorError(400, 'validation_error', v.message, [{ path: v.field, message: v.message }]);
      const existing = this.h.state().media.find((x) => x.url === v.value.url);
      if (existing) return ok({ media: existing });
      const asset: MediaAsset = { ...v.value, id: this.h.state().nextMediaId, createdAt: this.h.now().toISOString() };
      this.h.commit((s) => {
        s.media.push(asset);
        s.nextMediaId = asset.id + 1;
      });
      return ok({ media: asset }, 201);
    }
    if ((mt = /^\/editor\/media\/(\d+)$/.exec(sub))) {
      const id = Number(mt[1]);
      const cur = this.h.state().media.find((x) => x.id === id);
      if (!cur) throw new EditorError(404, 'not_found', '媒体库里没有这张图');
      if (m === 'PATCH') {
        const alt = cleanAlt((body as { alt?: unknown } | null)?.alt);
        if (alt === null) throw new EditorError(400, 'validation_error', `替代文字最多 ${MEDIA_LIMITS.altMax} 字`);
        this.h.commit((s) => void (s.media.find((x) => x.id === id)!.alt = alt));
        return ok({ media: { ...cur, alt } });
      }
      if (m === 'DELETE') {
        this.h.commit((s) => void (s.media = s.media.filter((x) => x.id !== id)));
        return ok({ ok: true });
      }
    }
    throw new EditorError(404, 'not_found', '接口不存在');
  }
}
