/**
 * L51 / v1.51.0 兴趣圈子（按需加载）：详情页显示「加入 / 退出圈子」按钮（aria-pressed + role=status），成员数本机 +1；
 * 列表页给已加入的圈子加「已加入」标记，并提供「只看我加入的」筛选。状态只存在 localStorage，没有网络请求。
 */
import { readList, writeList } from './ck-store';
import { JOIN_KEY, memberText } from './circles-core';

export function bind(root: ParentNode): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-circle]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const slug = box.dataset.circle!;
    const n = Number(box.dataset.members) || 0;
    const tools = box.querySelector<HTMLElement>('[data-cc-tools]');
    const btn = box.querySelector<HTMLButtonElement>('[data-cc-join]');
    const count = box.querySelector<HTMLElement>('[data-cc-count]');
    const status = box.querySelector<HTMLElement>('[data-cc-status]');
    if (!tools || !btn || !count || !status) continue;
    const joined = () => readList(JOIN_KEY).includes(slug);
    const paint = () => {
      const j = joined();
      btn.setAttribute('aria-pressed', String(j));
      btn.querySelector('span')!.textContent = j ? '退出圈子' : '加入圈子';
      count.textContent = memberText(n, j);
    };
    btn.addEventListener('click', () => {
      const list = readList(JOIN_KEY);
      const j = list.includes(slug);
      writeList(JOIN_KEY, j ? list.filter((x) => x !== slug) : [...list, slug]);
      status.textContent = j ? '已退出这个圈子。' : '已加入（只记在这台设备上）。';
      paint();
    });
    tools.hidden = false;
    paint();
  }
  for (const box of root.querySelectorAll<HTMLElement>('[data-circles]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const cards = [...box.querySelectorAll<HTMLElement>('.ck-card[data-slug]')];
    const mine = new Set(readList(JOIN_KEY, cards.map((c) => c.dataset.slug!)));
    for (const c of cards) {
      if (mine.has(c.dataset.slug!)) c.querySelector('.ck-card__title')?.insertAdjacentHTML('beforeend', ' <span class="cc-badge">已加入</span>');
    }
    const wrap = box.querySelector<HTMLElement>('[data-cc-filter-wrap]');
    const cb = box.querySelector<HTMLInputElement>('[data-cc-filter]');
    const st = box.querySelector<HTMLElement>('[data-cc-filter-status]');
    if (!wrap || !cb || !st) continue;
    cb.addEventListener('change', () => {
      for (const c of cards) c.hidden = cb.checked && !mine.has(c.dataset.slug!);
      st.textContent = cb.checked ? (mine.size ? `显示你加入的 ${mine.size} 个圈子` : '你还没有加入圈子') : '';
    });
    wrap.hidden = false;
  }
}
