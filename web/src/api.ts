import type { Post, PostSummary, Profile, Settings, TagCount } from './types';

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
  posts: (q: { tag?: string; limit?: number; offset?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.tag) p.set('tag', q.tag);
    if (q.limit) p.set('limit', String(q.limit));
    if (q.offset) p.set('offset', String(q.offset));
    const qs = p.toString();
    return request<{ posts: PostSummary[]; total: number }>(`/api/posts${qs ? `?${qs}` : ''}`);
  },
  post: (slug: string) => request<Post>(`/api/posts/${encodeURIComponent(slug)}`),
  tags: () => request<{ tags: TagCount[] }>('/api/tags'),
  profile: () => request<Profile>('/api/profile'),
  settings: () => request<Settings>('/api/settings'),
};
