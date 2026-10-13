/**
 * L23「栏目整理」：按访客身份显示菜单 / 落地页里的条目。
 * 注册表里 audience = member / admin 的条目渲染成 data-aud + hidden（预渲染 HTML 默认不露出），这里按身份切换。
 * - member：已登录的好朋友（community.ts 的会话）；
 * - admin：站长在本浏览器登录过后台（admin.ts 写下提示），再向 /api/auth/session 确认一次；普通访客不发这个请求。
 */
import { request } from './api';
import { currentMember } from './community';
import type { Audience } from './site-map';

export const ADMIN_HINT_KEY = 'blog-admin-hint';
let admin = false;

export function audience(): Audience {
  return { member: !!currentMember(), admin };
}

export function applyAudience(root: ParentNode = document): void {
  const a = audience();
  root.querySelectorAll<HTMLElement>('[data-aud]').forEach((el) => {
    const want = el.dataset.aud;
    el.hidden = want === 'member' ? !a.member : want === 'admin' ? !a.admin : want === 'guest' ? a.member : false;
  });
}

function hint(): boolean {
  try {
    return localStorage.getItem(ADMIN_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

/** 只有本浏览器登录过后台才确认站长身份（不给普通访客增加请求） */
export async function refreshAdmin(): Promise<void> {
  if (!hint()) return;
  try {
    const s = await request<{ authenticated: boolean }>('/api/auth/session', { credentials: 'include' });
    admin = !!s.authenticated;
    if (!admin) localStorage.removeItem(ADMIN_HINT_KEY);
  } catch {
    admin = false;
  }
  applyAudience();
}
