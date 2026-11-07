/**
 * L47 / v1.47.0 构图辅助线（按需加载）：显示切换按钮（aria-pressed），按下时显示对应的 SVG 线组；默认全部关闭，不记住状态。没有网络请求。
 */
export function bind(root: ParentNode): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-composition]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const bar = box.querySelector<HTMLElement>('[data-cp-bar]');
    if (!bar) continue;
    for (const btn of bar.querySelectorAll<HTMLButtonElement>('[data-cp-toggle]')) {
      const g = box.querySelector<SVGGElement>(`g[data-guide="${btn.dataset.cpToggle}"]`);
      if (!g) continue;
      btn.addEventListener('click', () => {
        const on = btn.getAttribute('aria-pressed') !== 'true';
        btn.setAttribute('aria-pressed', String(on));
        if (on) g.removeAttribute('hidden');
        else g.setAttribute('hidden', '');
      });
    }
    bar.hidden = false;
  }
}
