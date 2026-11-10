/**
 * L59 / v1.59.0 成员主页与成就（按需加载）：成员页「只看已获得」的成就筛选；列表页按最近更新 / 成就最多 / 最早加入排序。
 * 只在页面里隐藏、重排现有元素，没有网络请求。
 */
export function bind(root: ParentNode): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-member]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const wrap = box.querySelector<HTMLElement>('[data-mb-only-wrap]');
    const cb = box.querySelector<HTMLInputElement>('[data-mb-only]');
    if (!wrap || !cb) continue;
    const items = [...box.querySelectorAll<HTMLElement>('.mb-badge')];
    cb.addEventListener('change', () => {
      for (const li of items) li.hidden = cb.checked && li.dataset.earned !== '1';
    });
    wrap.hidden = false;
  }
  for (const box of root.querySelectorAll<HTMLElement>('[data-members]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const wrap = box.querySelector<HTMLElement>('[data-mb-sort-wrap]');
    const sel = box.querySelector<HTMLSelectElement>('[data-mb-sort]');
    const ul = box.querySelector<HTMLElement>('.ck-cards');
    if (!wrap || !sel || !ul) continue;
    const cards = [...ul.querySelectorAll<HTMLElement>(':scope > .ck-card')].map((el, i) => {
      const d = el.querySelector<HTMLElement>('.mb-stat')!.dataset;
      return { el, i, joined: d.joined!, badges: Number(d.badges) };
    });
    sel.addEventListener('change', () => {
      const v = sel.value;
      const sorted = [...cards].sort((a, b) => (v === 'badges' ? b.badges - a.badges || a.i - b.i : v === 'joined' ? (a.joined !== b.joined ? (a.joined < b.joined ? -1 : 1) : a.i - b.i) : a.i - b.i));
      for (const c of sorted) ul.append(c.el);
    });
    wrap.hidden = false;
  }
}
