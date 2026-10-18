/**
 * L50 / v1.50.0 毕业作品集（按需加载）：显示「打印作品集」按钮，点击调用浏览器打印（打印样式一页一件）。没有网络请求。
 */
export function bind(root: ParentNode): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-portfolio]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const tools = box.querySelector<HTMLElement>('[data-pf-tools]');
    const btn = box.querySelector<HTMLButtonElement>('[data-pf-print]');
    if (!tools || !btn) continue;
    btn.addEventListener('click', () => window.print());
    tools.hidden = false;
  }
}
