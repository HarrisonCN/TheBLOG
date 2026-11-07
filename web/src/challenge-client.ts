/**
 * L45 / v1.45.0 52 周挑战（按需加载）：显示本机完成勾选（localStorage，丢掉未知周次）、进度条 + role=status 文字；
 * 按 Asia/Shanghai 的今天标出「本周」（aria-current="true"，只在打开页面时算一次，没有计时器）；「清空记录」要点两次。没有网络请求。
 */
import { currentWeek, parseStored, progressText, storageKey, todayIn, TZ } from './challenge-core';

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null): void {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* 隐私模式等：只是不记住 */
    }
  },
};

export function bind(root: ParentNode, now: Date = new Date()): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-challenge]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const slug = box.dataset.challenge!;
    const year = Number(box.dataset.year);
    const boxes = [...box.querySelectorAll<HTMLInputElement>('input[data-ch-week]')];
    const valid = boxes.map((b) => Number(b.dataset.chWeek));
    const bar = box.querySelector<HTMLElement>('[data-ch-bar]');
    const prog = box.querySelector<HTMLProgressElement>('.ch-progress');
    const status = box.querySelector<HTMLElement>('#ch-status');
    const nowP = box.querySelector<HTMLElement>('[data-ch-now]');
    const reset = box.querySelector<HTMLButtonElement>('[data-ch-reset]');
    if (!bar || !prog || !status || !reset || !nowP) continue;
    const checked = () => boxes.filter((b) => b.checked).map((b) => Number(b.dataset.chWeek));
    const paint = () => {
      const d = checked().length;
      prog.value = d;
      status.textContent = progressText(d, boxes.length);
      for (const b of boxes) b.closest('.ch-week')?.classList.toggle('is-done', b.checked);
    };
    const saved = new Set(parseStored(store.get(storageKey(slug)), valid));
    for (const b of boxes) {
      b.checked = saved.has(Number(b.dataset.chWeek));
      (b.parentElement as HTMLElement).hidden = false;
    }
    const cur = currentWeek({ year, weeks: valid.map((week) => ({ week, theme: '' })) }, todayIn(now, TZ));
    for (const li of box.querySelectorAll<HTMLElement>('.ch-week[aria-current]')) li.removeAttribute('aria-current');
    if (cur !== null) {
      const li = box.querySelector<HTMLElement>(`.ch-week[data-week="${cur}"]`)!;
      li.setAttribute('aria-current', 'true');
      li.classList.add('is-current');
      if (!li.querySelector('.ch-today')) li.querySelector('.ch-week__h')?.insertAdjacentHTML('beforeend', ' <span class="ch-today">本周</span>');
      nowP.innerHTML = `今天在第 ${cur} 周：<a href="#w-${cur}">跳到本周主题</a>`;
    } else nowP.textContent = '今天不在这份挑战的周次里。';
    bar.hidden = false;
    paint();
    box.addEventListener('change', (ev) => {
      if (!(ev.target as Element).matches('input[data-ch-week]')) return;
      const c = checked();
      store.set(storageKey(slug), c.length ? JSON.stringify(c) : null);
      paint();
    });
    let armed = false;
    reset.addEventListener('click', () => {
      if (!checked().length) return;
      if (!armed) {
        armed = true;
        reset.textContent = '再点一次确认清空';
        return;
      }
      armed = false;
      reset.textContent = '清空记录';
      for (const b of boxes) b.checked = false;
      store.set(storageKey(slug), null);
      paint();
      status.textContent = `已清空。${status.textContent}`;
    });
    reset.addEventListener('blur', () => {
      if (armed) {
        armed = false;
        reset.textContent = '清空记录';
      }
    });
  }
}
