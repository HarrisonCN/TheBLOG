/**
 * L54 / v1.54.0 关注与动态流（按需加载）：成员页显示「关注 / 已关注」按钮（aria-pressed + role=status），关注者数本机 +1；
 * 列表页提供「只看我关注的」：时间线和成员卡片都只留关注的人。关注列表只存在 localStorage，没有网络请求，也不会通知任何人。
 */
import { readList, writeList } from './ck-store';
import { FOLLOW_KEY, followerText } from './activity-core';

export function bind(root: ParentNode): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-stream]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const slug = box.dataset.stream!;
    const n = Number(box.dataset.followers) || 0;
    const tools = box.querySelector<HTMLElement>('[data-af-tools]');
    const btn = box.querySelector<HTMLButtonElement>('[data-af-btn]');
    const count = box.querySelector<HTMLElement>('[data-af-count]');
    const st = box.querySelector<HTMLElement>('[data-af-status]');
    if (!tools || !btn || !count || !st) continue;
    const paint = () => {
      const f = readList(FOLLOW_KEY).includes(slug);
      btn.setAttribute('aria-pressed', String(f));
      btn.querySelector('span')!.textContent = f ? '已关注' : '关注';
      count.textContent = followerText(n, f);
    };
    btn.addEventListener('click', () => {
      const list = readList(FOLLOW_KEY);
      const f = list.includes(slug);
      writeList(FOLLOW_KEY, f ? list.filter((x) => x !== slug) : [...list, slug]);
      st.textContent = f ? '已取消关注。' : '已关注（只记在这台设备上）。';
      paint();
    });
    tools.hidden = false;
    paint();
  }
  for (const box of root.querySelectorAll<HTMLElement>('[data-streams]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const wrap = box.querySelector<HTMLElement>('[data-af-filter-wrap]');
    const cb = box.querySelector<HTMLInputElement>('[data-af-filter]');
    const st = box.querySelector<HTMLElement>('[data-af-filter-status]');
    const empty = box.querySelector<HTMLElement>('[data-af-empty]');
    if (!wrap || !cb || !st || !empty) continue;
    const items = [...box.querySelectorAll<HTMLElement>('.af-item[data-member]')];
    const cards = [...box.querySelectorAll<HTMLElement>('.ck-card[data-slug]')];
    cb.addEventListener('change', () => {
      const mine = new Set(readList(FOLLOW_KEY, cards.map((c) => c.dataset.slug!)));
      for (const li of items) li.hidden = cb.checked && !mine.has(li.dataset.member!);
      for (const c of cards) c.hidden = cb.checked && !mine.has(c.dataset.slug!);
      const shown = items.filter((li) => !li.hidden).length;
      empty.hidden = !cb.checked || shown > 0;
      st.textContent = cb.checked ? `关注了 ${mine.size} 人，显示 ${shown} 条动态` : '';
    });
    wrap.hidden = false;
  }
}
