/**
 * L48 / v1.48.0 投稿与展览征集（按需加载）：页面打开时按当前时间重新计算每个截止徽标（预渲染 HTML 里的是构建时的状态），
 * 列表页把这期间已经截止的征集移到「已截止（归档）」最前面。只算一次，没有计时器，没有网络请求。
 */
import { deadlineState, stateText } from './call-core';

export function bind(root: ParentNode, now: Date = new Date()): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-calls]')) {
    for (const b of box.querySelectorAll<HTMLElement>('.cl-state[data-deadline]')) {
      const s = deadlineState(b.dataset.deadline!, now);
      b.textContent = stateText(s);
      b.className = `cl-state cl-state--${s.state}`;
    }
    const open = box.querySelector<HTMLElement>('[data-cl-open]');
    const closed = box.querySelector<HTMLElement>('[data-cl-closed]');
    if (!open || !closed) continue;
    const moved = [...open.querySelectorAll<HTMLElement>(':scope > .cl-card')].filter((li) => li.querySelector('.cl-state--closed'));
    for (const li of moved) closed.prepend(li);
    box.querySelector<HTMLElement>('[data-cl-empty]')!.hidden = open.children.length > 0;
  }
}
