/**
 * L43 / v1.43.0 色彩研究：「复制色值」按钮（按需加载）。预渲染时按钮隐藏（没有 JS 时色值本身就是可选中的文字）；
 * 复制结果写进 role=status。不需要网络。
 */
export function bind(root: ParentNode): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-colors]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const status = box.querySelector<HTMLElement>('[data-co-status]');
    for (const b of box.querySelectorAll<HTMLButtonElement>('[data-co-copy]')) b.hidden = false;
    box.addEventListener('click', async (ev) => {
      const b = (ev.target as Element).closest<HTMLButtonElement>('[data-co-copy]');
      if (!b) return;
      const v = b.dataset.coCopy!;
      let okd = false;
      try {
        await navigator.clipboard.writeText(v);
        okd = true;
      } catch {
        okd = false;
      }
      if (status) status.textContent = okd ? `已复制 ${v}` : `复制失败，请手动选中 ${v}`;
    });
  }
}
