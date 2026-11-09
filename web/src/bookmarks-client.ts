/**
 * L61 / v1.61.0 链接分享（按需加载）：链接页的点赞按钮（aria-pressed，再点取消，赞数本机 +1）；列表页把本机点过赞的链接赞数 +1，
 * 并提供「最新 / 最多赞」排序。点赞只存在 localStorage，没有网络请求。
 */
import { readList, writeList } from './ck-store';
import { sortLinks, UP_KEY, withUp } from './bookmarks-core';

export function bind(root: ParentNode): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-bookmark]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const slug = box.dataset.bookmark!;
    const base = Number(box.dataset.votes) || 0;
    const tools = box.querySelector<HTMLElement>('[data-bm-tools]');
    const btn = box.querySelector<HTMLButtonElement>('[data-bm-up]');
    const n = box.querySelector<HTMLElement>('[data-bm-n]');
    const st = box.querySelector<HTMLElement>('[data-bm-status]');
    if (!tools || !btn || !n || !st) continue;
    const paint = () => {
      const up = readList(UP_KEY).includes(slug);
      btn.setAttribute('aria-pressed', String(up));
      btn.querySelector('span')!.textContent = up ? '已点赞' : '点赞';
      n.textContent = String(withUp(base, up));
    };
    btn.addEventListener('click', () => {
      const l = readList(UP_KEY);
      const up = l.includes(slug);
      writeList(UP_KEY, up ? l.filter((x) => x !== slug) : [...l, slug]);
      st.textContent = up ? '已取消点赞。' : '已点赞（只记在这台设备上）。';
      paint();
    });
    tools.hidden = false;
    paint();
  }
  for (const box of root.querySelectorAll<HTMLElement>('[data-bookmarks]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const wrap = box.querySelector<HTMLElement>('[data-bm-sort-wrap]');
    const sel = box.querySelector<HTMLSelectElement>('[data-bm-sort]');
    const ul = box.querySelector<HTMLElement>('.ck-cards');
    if (!wrap || !sel || !ul) continue;
    const cards = [...ul.querySelectorAll<HTMLElement>(':scope > .ck-card')].map((el) => {
      const d = el.querySelector<HTMLElement>('.bm-votes')!;
      return { el, slug: el.dataset.slug!, date: d.dataset.date!, votes: Number(d.dataset.votes), n: d.querySelector<HTMLElement>('[data-bm-n]')! };
    });
    const ups = readList(UP_KEY, cards.map((c) => c.slug));
    for (const c of cards) c.n.textContent = String(withUp(c.votes, ups.includes(c.slug)));
    sel.addEventListener('change', () => {
      for (const c of sortLinks(cards, sel.value as 'latest' | 'top', ups)) ul.append(c.el);
    });
    wrap.hidden = false;
  }
}
