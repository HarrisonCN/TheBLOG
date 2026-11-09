/**
 * L60 / v1.60.0 社区周刊（按需加载）：读 1.54「关注与动态流」在本机保存的关注列表，给周刊里关注的人的动态加「关注」标记，
 * 并提供「只看我关注的人」。只读 localStorage，不写入，没有网络请求。
 */
import { readList } from './ck-store';
import { FOLLOW_KEY } from './activity-core';

export function bind(root: ParentNode): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-weekly]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const wrap = box.querySelector<HTMLElement>('[data-wk-follow-wrap]');
    const cb = box.querySelector<HTMLInputElement>('[data-wk-follow]');
    const st = box.querySelector<HTMLElement>('[data-wk-status]');
    if (!wrap || !cb || !st) continue;
    const items = [...box.querySelectorAll<HTMLElement>('.wk-item[data-member]')];
    const mine = new Set(readList(FOLLOW_KEY));
    for (const li of items) if (mine.has(li.dataset.member!)) li.classList.add('is-followed'), li.insertAdjacentHTML('beforeend', ' <span class="wk-tag">关注</span>');
    cb.addEventListener('change', () => {
      for (const li of items) li.hidden = cb.checked && !mine.has(li.dataset.member!);
      for (const sec of box.querySelectorAll<HTMLElement>('.wk-sec')) sec.hidden = cb.checked && !sec.querySelector('.wk-item:not([hidden])');
      const n = items.filter((li) => !li.hidden).length;
      st.textContent = cb.checked ? (mine.size ? `你关注的人本周有 ${n} 条动态` : '你还没有关注任何人，去「关注与动态流」看看吧') : '';
    });
    wrap.hidden = false;
  }
}
