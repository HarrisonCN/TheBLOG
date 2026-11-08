/**
 * L57 / v1.57.0 读书会（按需加载）：每周显示「这周读完了」勾选，进度条 + role=status 文字；按 Asia/Shanghai 的今天标出「本周」
 * （aria-current，只在打开页面时算一次，没有计时器）。进度只存在 localStorage，丢掉未知周次，没有网络请求。
 */
import { readMap, writeMap } from './ck-store';
import { currentWeek, PROGRESS_KEY, progressText, todayIn } from './bookclub-core';

export function bind(root: ParentNode, now: Date = new Date()): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-bookclub]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const slug = box.dataset.bookclub!;
    const prog = box.querySelector<HTMLElement>('[data-bc-prog]');
    const bar = prog?.querySelector('progress');
    const txt = box.querySelector<HTMLElement>('[data-bc-prog-t]');
    const nowEl = box.querySelector<HTMLElement>('[data-bc-now]');
    if (!prog || !bar || !txt || !nowEl) continue;
    const boxes = [...box.querySelectorAll<HTMLInputElement>('input[data-bc-week]')];
    const valid = boxes.map((b) => Number(b.dataset.bcWeek));
    const stored = readMap(PROGRESS_KEY)[slug];
    const done = new Set(Array.isArray(stored) ? stored.filter((x): x is number => valid.includes(x as number)) : []);
    const paint = () => {
      const d = boxes.filter((b) => b.checked).length;
      bar.value = d;
      txt.textContent = progressText(d, boxes.length);
      for (const b of boxes) b.closest('.bc-week')?.classList.toggle('is-done', b.checked);
    };
    for (const b of boxes) {
      b.checked = done.has(Number(b.dataset.bcWeek));
      (b.parentElement as HTMLElement).hidden = false;
    }
    const weeks = [...box.querySelectorAll<HTMLElement>('.bc-week')].map((li) => ({ week: Number(li.dataset.week), from: li.querySelector('.bc-week__h .muted')!.textContent!.slice(0, 10) }));
    const cur = currentWeek(weeks, todayIn(now));
    if (cur !== null) {
      const li = box.querySelector<HTMLElement>(`.bc-week[data-week="${cur}"]`)!;
      li.setAttribute('aria-current', 'true');
      li.classList.add('is-current');
      li.querySelector('.bc-week__h')!.insertAdjacentHTML('beforeend', ' <span class="bc-today">本周</span>');
      nowEl.innerHTML = `现在是第 ${cur} 周：<a href="#w-${cur}">跳到本周</a>`;
    } else nowEl.textContent = '今天不在这期共读的日程里。';
    box.addEventListener('change', (ev) => {
      if (!(ev.target as Element).matches('input[data-bc-week]')) return;
      const m = readMap(PROGRESS_KEY);
      const c = boxes.filter((b) => b.checked).map((b) => Number(b.dataset.bcWeek));
      if (c.length) m[slug] = c;
      else delete m[slug];
      writeMap(PROGRESS_KEY, m);
      paint();
    });
    prog.hidden = false;
    paint();
  }
}
