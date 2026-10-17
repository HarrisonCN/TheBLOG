import type { NoteStyle } from './note-style';
import type { BadgeDesign } from './badge-design';
import type { CommentStatus, PostComment } from './comment-core';
import type { Festival, Project, PublicMember, StickyNote, Viewer } from './demo/community-types';
import type { CategoryCount, ContentKey, ContentMap, GuestbookEntry, Post, PostSummary, Profile, SearchDoc, Settings, TagCount } from './types';

/** 同域部署时留空；Worker 在独立域名时设置 VITE_API_BASE=https://api.example.com */
export const API_BASE = (import.meta.env?.VITE_API_BASE ?? '').replace(/\/+$/, '');

/** 演示构建（vite --mode demo）：所有请求由浏览器内的 mock API 处理，不访问任何服务器。 */
export const DEMO = import.meta.env.VITE_DEMO === '1';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'error', public details?: unknown) {
    super(message);
  }
}

export async function request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  if (DEMO) {
    const { demoHandle } = await import('./demo/client');
    const res = await demoHandle(path, init);
    if (res.status >= 400) {
      const err = (res.body as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
      throw new ApiError(res.status, err?.message ?? `请求失败（${res.status}）`, err?.code, err?.details);
    }
    return res.body as T;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 10_000);
  try {
    const res = await fetch(API_BASE + path, { ...init, signal: ctrl.signal });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('application/json') ? await res.json() : null;
    if (!res.ok) {
      const err = (body as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
      throw new ApiError(res.status, err?.message ?? `请求失败（${res.status}）`, err?.code, err?.details);
    }
    return body as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, (e as Error)?.name === 'AbortError' ? '请求超时，请检查网络' : '无法连接到服务器');
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  posts: (q: { tag?: string; category?: string; limit?: number; offset?: number; cursor?: string | null } = {}) => {
    const p = new URLSearchParams();
    if (q.tag) p.set('tag', q.tag);
    if (q.category) p.set('category', q.category);
    if (q.limit) p.set('limit', String(q.limit));
    if (q.offset) p.set('offset', String(q.offset));
    if (q.cursor) p.set('cursor', q.cursor);
    const qs = p.toString();
    return request<{ posts: PostSummary[]; total: number; nextCursor?: string | null }>(`/api/posts${qs ? `?${qs}` : ''}`);
  },
  /** 文章摘要索引：全部已发布文章（不含正文），列表 / 归档 / 系列 / 相关文章 / 搜索回退共用 */
  postIndex: () => request<{ posts: PostSummary[]; total: number; version?: string }>('/api/posts/index'),
  post: (slug: string) => request<Post>(`/api/posts/${encodeURIComponent(slug)}`),
  tags: () => request<{ tags: TagCount[] }>('/api/tags'),
  profile: () => request<Profile>('/api/profile'),
  settings: () => request<Settings>('/api/settings'),
  categories: () => request<{ categories: CategoryCount[] }>('/api/categories'),
  searchIndex: () => request<{ posts: SearchDoc[] }>('/api/search-index'),
  quotes: () => request<{ quotes: import('./reading-core').QuoteCard[] }>('/api/quotes'),
  magazine: () => request<{ issues: import('./magazine-core').IssueSummary[] }>('/api/magazine'),
  issue: (slug: string) => request<{ issue: import('./magazine-core').Issue }>(`/api/magazine/${encodeURIComponent(slug)}`),
  content: <K extends ContentKey>(key: K) => request<{ items: ContentMap[K] }>(`/api/content/${key}`),
  reactions: (slug: string) => request<{ counts: Record<string, number> }>(`/api/posts/${encodeURIComponent(slug)}/reactions`),
  react: (slug: string, emoji: string, on: boolean) =>
    request<{ counts: Record<string, number>; mine: boolean }>(`/api/posts/${encodeURIComponent(slug)}/reactions`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ emoji, on }) }),
  comments: (slug: string) => request<{ comments: PostComment[]; total: number }>(`/api/posts/${encodeURIComponent(slug)}/comments`),
  postComment: (slug: string, body: { name: string; content: string; parentId?: number | null; homepage?: string }, token?: string) =>
    request<{ comment: PostComment | null; status: CommentStatus }>(`/api/posts/${encodeURIComponent(slug)}/comments`, { method: 'POST', headers: token ? { ...JSON_H, authorization: `Bearer ${token}` } : JSON_H, body: JSON.stringify(body) }),
  setMyBadge: (token: string, code: string, design: BadgeDesign) =>
    request<{ member: PublicMember }>(`/api/members/me/badges/${encodeURIComponent(code)}`, { method: 'PUT', headers: { ...JSON_H, authorization: `Bearer ${token}` }, body: JSON.stringify({ design }) }),
  guestbook: () => request<{ entries: GuestbookEntry[] }>('/api/guestbook'),
  postGuestbook: (body: { name: string; content: string; website?: string }) =>
    request<GuestbookEntry>('/api/guestbook', { method: 'POST', headers: JSON_H, body: JSON.stringify(body) }),

  // ---- 社区功能（Worker 社区模块；演示站由浏览器内 mock 提供）。旧 Worker 返回 404 时前端自动隐藏对应功能 ----
  festivals: () => request<{ festivals: Festival[] }>('/api/festivals'),
  projects: () => request<{ items: Project[] }>('/api/projects'),
  members: () => request<{ members: PublicMember[] }>('/api/members'),
  notes: () => request<{ notes: StickyNote[] }>('/api/notes'),
  postNote: (body: { name: string; content: string; color: string; style?: NoteStyle }) => request<StickyNote>('/api/notes', { method: 'POST', headers: JSON_H, body: JSON.stringify(body) }),
  reportNote: (id: number) => request<{ ok: true }>(`/api/notes/${id}/report`, { method: 'POST', headers: JSON_H, body: '{}' }),
  presence: (body: { sid: string; page: string }) => request<{ viewers: Viewer[]; total: number }>('/api/presence', { method: 'POST', headers: JSON_H, body: JSON.stringify(body) }),
  register: (body: { name: string; email: string; bio?: string }) => request<{ sent: true; demoCode?: string }>('/api/members/register', { method: 'POST', headers: JSON_H, body: JSON.stringify(body) }),
  verify: (body: { email: string; code: string }) => request<{ member: PublicMember; token: string }>('/api/members/verify', { method: 'POST', headers: JSON_H, body: JSON.stringify(body) }),
  me: (token: string) => request<{ member: PublicMember }>('/api/members/me', { headers: { authorization: `Bearer ${token}` } }),
  upload: (token: string, file: File, note: string) => {
    const fd = new FormData();
    fd.set('file', file);
    fd.set('note', note);
    return request<{ id: number; status: string }>('/api/members/uploads', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd, timeoutMs: 60_000 });
  },
  voice: (token: string, blob: Blob, durationMs: number) => {
    const fd = new FormData();
    fd.set('file', new File([blob], 'voice.webm', { type: blob.type || 'audio/webm' }));
    fd.set('durationMs', String(Math.round(durationMs)));
    return request<{ id: number }>('/api/members/voice', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd, timeoutMs: 60_000 });
  },
};
const JSON_H = { 'content-type': 'application/json' };
