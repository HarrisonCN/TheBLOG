/**
 * L39 / v1.39.0 照片日历：把「今天」（Asia/Shanghai）的月历格子标成 aria-current="date"（按需加载，只在打开页面时算一次，没有计时器）。
 */
import { TZ, todayIn } from './calendar-core';

export function bind(root: ParentNode, now: Date = new Date()): void {
  const today = todayIn(now, TZ);
  for (const box of root.querySelectorAll<HTMLElement>('[data-daily]')) {
    for (const c of box.querySelectorAll<HTMLElement>('[aria-current="date"]')) c.removeAttribute('aria-current');
    const cell = box.querySelector<HTMLElement>(`td[data-date="${today}"]`);
    if (!cell) continue;
    cell.setAttribute('aria-current', 'date');
    cell.classList.add('is-today');
    if (!cell.querySelector('.dl-today')) cell.insertAdjacentHTML('beforeend', '<span class="dl-today">今天</span>');
  }
}
