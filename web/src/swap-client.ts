/**
 * L63 / v1.63.0 互助交换（按需加载）：列表页筛选（类型、类别、只看进行中）并标出本机「感兴趣」的帖子；
 * 帖子页「我感兴趣」（aria-pressed，人数本机 +1）。演示站不交换联系方式；只存在 localStorage，没有网络请求。
 */
import { readList, writeList } from './ck-store';
import { INTEREST_KEY, matches, type Filter } from './swap-core';

export function bind(root: ParentNode): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-swap]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const form = box.querySelector<HTMLFormElement>('[data-sw-filter]');
    const st = box.querySelector<HTMLElement>('[data-sw-status]');
    if (!form || !st) continue;
    const cards = [...box.querySelectorAll<HTMLElement>('.ck-card')].map((el) => {
      const d = el.querySelector<HTMLElement>('.sw-head')!.dataset;
      return { el, slug: el.dataset.slug!, kind: d.kind as Filter['kind'] & ('offer' | 'request'), cat: d.cat as Exclude<Filter['cat'], 'all'>, open: d.open === '1' };
    });
    const mine = new Set(readList(INTEREST_KEY, cards.map((c) => c.slug)));
    for (const c of cards) if (mine.has(c.slug)) c.el.querySelector('.ck-card__title')?.insertAdjacentHTML('beforeend', ' <span class="sw-badge">感兴趣</span>');
    const apply = () => {
      const fd = new FormData(form);
      const f: Filter = { kind: (fd.get('sw-kind') as Filter['kind']) ?? 'all', cat: (fd.get('cat') as Filter['cat']) ?? 'all', openOnly: fd.get('open') === 'on' };
      for (const c of cards) c.el.hidden = !matches(c, f);
      st.textContent = `显示 ${cards.filter((c) => !c.el.hidden).length} 个帖子`;
    };
    form.addEventListener('change', apply);
    form.addEventListener('submit', (ev) => ev.preventDefault());
    form.hidden = false;
  }
  for (const box of root.querySelectorAll<HTMLElement>('[data-swapitem]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const slug = box.dataset.swapitem!;
    const base = Number(box.dataset.interested) || 0;
    const tools = box.querySelector<HTMLElement>('[data-sw-tools]');
    const btn = box.querySelector<HTMLButtonElement>('[data-sw-int]');
    const n = box.querySelector<HTMLElement>('[data-sw-n]');
    const msg = box.querySelector<HTMLElement>('[data-sw-msg]');
    if (!tools || !btn || !n || !msg) continue;
    const paint = () => {
      const on = readList(INTEREST_KEY).includes(slug);
      btn.setAttribute('aria-pressed', String(on));
      n.textContent = String(base + (on ? 1 : 0));
    };
    btn.addEventListener('click', () => {
      const l = readList(INTEREST_KEY);
      const on = l.includes(slug);
      writeList(INTEREST_KEY, on ? l.filter((x) => x !== slug) : [...l, slug]);
      msg.textContent = on ? '已取消。' : '已标记感兴趣（只记在这台设备上；演示站不交换联系方式）。';
      paint();
    });
    tools.hidden = false;
    paint();
  }
}
