/**
 * L24 发布预览 / 即将发布（按需加载）：
 *  - /preview/：读站长浏览器里写作台存的预览草稿（localStorage，键 PREVIEW_KEY），用文章页同一套渲染；另一个标签页改动时自动刷新；
 *  - /scheduled/：从 /api/scheduled 读即将发布的文章。
 */
import { request } from './api';
import { parsePreview, PREVIEW_KEY, type UpcomingPost } from './editor-core';
import { previewBody, previewEmpty, upcomingList } from './editor-view';

let stopStorage: (() => void) | null = null;

export function mountEditorPages(root: HTMLElement): void {
  stopStorage?.();
  stopStorage = null;
  const pv = root.querySelector<HTMLElement>('.js-editor-preview');
  if (pv) {
    const paint = () => {
      let raw: string | null = null;
      try {
        raw = localStorage.getItem(PREVIEW_KEY);
      } catch {
        raw = null;
      }
      const p = parsePreview(raw);
      pv.innerHTML = p ? previewBody(p) : previewEmpty();
      pv.dataset.state = p ? 'ready' : 'empty';
    };
    paint();
    const on = (ev: StorageEvent) => {
      if (ev.key === PREVIEW_KEY) paint();
    };
    window.addEventListener('storage', on);
    stopStorage = () => window.removeEventListener('storage', on);
  }
  const sc = root.querySelector<HTMLElement>('.js-scheduled');
  if (sc) {
    request<{ posts: UpcomingPost[] }>('/api/scheduled')
      .then((r) => {
        sc.innerHTML = upcomingList(r.posts, Date.now());
        sc.dataset.state = 'ready';
      })
      .catch(() => {
        sc.innerHTML = '<p class="empty">暂时读不到发布时间表（服务器还没有部署这个功能）。</p>';
        sc.dataset.state = 'error';
      });
  }
}
