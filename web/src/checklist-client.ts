/**
 * L38 / v1.38.0 拍摄清单的本机勾选（按需加载）：从 localStorage 恢复勾选（丢掉未知编号），勾选变化立刻保存，
 * 进度条 + role=status 文字；「清空勾选」第一次点击要求再点一次确认；「打印清单」调用浏览器打印。没有网络请求，没有计时器。
 */
import { allIds, parseStored, progress, progressText, storageKey } from './checklist-core';

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

export function bind(root: ParentNode): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-checklist]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const slug = box.dataset.checklist!;
    const boxes = [...box.querySelectorAll<HTMLInputElement>('input[data-ck-id]')];
    const ids = boxes.map((b) => b.dataset.ckId!);
    const groups = { groups: [{ title: '', items: ids.map((id) => ({ id, label: id })) }] };
    const bar = box.querySelector<HTMLElement>('[data-ck-bar]');
    const prog = box.querySelector<HTMLProgressElement>('.ck-progress');
    const status = box.querySelector<HTMLElement>('#ck-status');
    const reset = box.querySelector<HTMLButtonElement>('[data-ck-reset]');
    if (!bar || !prog || !status || !reset) continue;
    const checked = () => boxes.filter((b) => b.checked).map((b) => b.dataset.ckId!);
    const paint = () => {
      const p = progress(checked(), groups);
      prog.value = p.done;
      status.textContent = progressText(p);
      box.classList.toggle('is-done', p.total > 0 && p.done === p.total);
    };
    const saved = new Set(parseStored(store.get(storageKey(slug)), allIds(groups)));
    for (const b of boxes) b.checked = saved.has(b.dataset.ckId!);
    bar.hidden = false;
    paint();
    box.addEventListener('change', (ev) => {
      if (!(ev.target as Element).matches('input[data-ck-id]')) return;
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
      reset.textContent = '清空勾选';
      for (const b of boxes) b.checked = false;
      store.set(storageKey(slug), null);
      paint();
      status.textContent = `已清空。${status.textContent}`;
    });
    reset.addEventListener('blur', () => {
      if (armed) {
        armed = false;
        reset.textContent = '清空勾选';
      }
    });
    box.querySelector<HTMLButtonElement>('[data-ck-print]')?.addEventListener('click', () => window.print());
  }
}
