/**
 * L37 / v1.37.0 修图前后对比滑块（按需加载）：打开预渲染时隐藏的对比区和原生 range 滑块（键盘与读屏由浏览器原生提供，
 * aria-valuetext 跟着更新）；快捷位置按钮；在对比图上拖动指针也能移动分界线。并排两张图在打开滑块后隐藏（打印时恢复）。
 */
import { clampPos, clipFor, valueText } from './retouch-core';

export function bind(root: ParentNode): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-retouch]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const stage = box.querySelector<HTMLElement>('[data-retouch-stage]');
    const ctl = box.querySelector<HTMLElement>('[data-retouch-ctl]');
    const range = box.querySelector<HTMLInputElement>('[data-rt-range]');
    const after = box.querySelector<HTMLElement>('[data-rt-after]');
    const line = box.querySelector<HTMLElement>('[data-rt-line]');
    const pair = box.querySelector<HTMLElement>('[data-retouch-pair]');
    if (!stage || !ctl || !range || !after || !line) continue;
    const set = (v: unknown) => {
      const p = clampPos(v);
      range.value = String(p);
      range.setAttribute('aria-valuetext', valueText(p));
      after.style.clipPath = clipFor(p);
      line.style.left = `${p}%`;
      for (const b of ctl.querySelectorAll<HTMLButtonElement>('[data-rt-preset]')) b.setAttribute('aria-pressed', String(Number(b.dataset.rtPreset) === p));
    };
    stage.hidden = false;
    ctl.hidden = false;
    pair?.classList.add('is-enhanced');
    set(box.dataset.start ?? 50);
    range.addEventListener('input', () => set(range.value));
    ctl.addEventListener('click', (ev) => {
      const b = (ev.target as Element).closest<HTMLButtonElement>('[data-rt-preset]');
      if (b) set(b.dataset.rtPreset);
    });
    let drag = false;
    const fromPointer = (ev: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      if (r.width) set(((ev.clientX - r.left) / r.width) * 100);
    };
    stage.addEventListener('pointerdown', (ev) => {
      drag = true;
      stage.setPointerCapture?.(ev.pointerId);
      fromPointer(ev);
    });
    stage.addEventListener('pointermove', (ev) => drag && fromPointer(ev));
    const stop = () => (drag = false);
    stage.addEventListener('pointerup', stop);
    stage.addEventListener('pointercancel', stop);
  }
}
