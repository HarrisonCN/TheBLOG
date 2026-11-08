/**
 * L58 / v1.58.0 话题广场（按需加载）：列表页的排序（最新 / 回复最多 / 最热，置顶永远在前）与标签筛选（aria-pressed，可多选、取交集）；
 * 帖子页「只看楼主」。全部在页面里重排 / 隐藏现有卡片，没有网络请求。
 */
import { sortThreads, type SortMode } from './threads-core';

export function bind(root: ParentNode): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-threads]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const tools = box.querySelector<HTMLElement>('[data-th-tools]');
    const sel = box.querySelector<HTMLSelectElement>('[data-th-sort]');
    const st = box.querySelector<HTMLElement>('[data-th-status]');
    const ul = box.querySelector<HTMLElement>('.ck-cards');
    if (!tools || !sel || !st || !ul) continue;
    const cards = [...ul.querySelectorAll<HTMLElement>(':scope > .ck-card')].map((el) => {
      const d = el.querySelector<HTMLElement>('.th-stats')!.dataset;
      return { el, slug: el.dataset.slug!, date: d.date!, replies: Number(d.replies), heat: Number(d.heat), pinned: d.pinned === '1', tags: d.tags ? d.tags.split('|') : [] };
    });
    const tagBtns = [...tools.querySelectorAll<HTMLButtonElement>('[data-th-tag]')];
    const apply = () => {
      const on = tagBtns.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.thTag!);
      for (const c of sortThreads(cards, sel.value as SortMode)) {
        ul.append(c.el);
        c.el.hidden = !on.every((t) => c.tags.includes(t));
      }
      const n = cards.filter((c) => !c.el.hidden).length;
      st.textContent = `${on.length ? `标签：${on.join('、')}，` : ''}显示 ${n} 个帖子`;
    };
    sel.addEventListener('change', apply);
    apply();
    for (const b of tagBtns)
      b.addEventListener('click', () => {
        b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
        apply();
      });
    tools.hidden = false;
  }
  for (const box of root.querySelectorAll<HTMLElement>('[data-thread]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const wrap = box.querySelector<HTMLElement>('[data-th-op-wrap]');
    const cb = box.querySelector<HTMLInputElement>('[data-th-op]');
    const st = box.querySelector<HTMLElement>('[data-th-op-status]');
    if (!wrap || !cb || !st) continue;
    const op = box.dataset.op!;
    const rs = [...box.querySelectorAll<HTMLElement>('.th-reply')];
    cb.addEventListener('change', () => {
      for (const r of rs) r.hidden = cb.checked && r.dataset.author !== op;
      st.textContent = cb.checked ? `只显示楼主的 ${rs.filter((r) => !r.hidden).length} 条回复` : '';
    });
    wrap.hidden = !rs.length;
  }
}
