/**
 * L33 / v1.33.0 视觉杂志的键盘翻篇（按需加载）：J / → 下一篇，K / ← 上一篇；
 * 焦点移到那一篇（section tabindex=-1），地址栏 #piece-N 同步（replaceState，不触发重新渲染）。
 * 输入框里打字、按着修饰键时不拦截；减少动态效果时不用平滑滚动。
 */
export function bindMagazine(root: ParentNode): void {
  const box = root.querySelector<HTMLElement>('[data-magazine]');
  if (!box || box.dataset.bound) return;
  box.dataset.bound = '1';
  const pieces = [...box.querySelectorAll<HTMLElement>('[data-mag-piece]')];
  if (!pieces.length) return;
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const current = (): number => {
    const idx = pieces.findIndex((p) => p.contains(document.activeElement));
    if (idx >= 0) return idx;
    // 没有焦点在篇目里：取视口顶部已经越过的最后一篇
    let cur = -1;
    for (let i = 0; i < pieces.length; i++) if (pieces[i]!.getBoundingClientRect().top <= 120) cur = i;
    return cur;
  };
  const go = (i: number) => {
    const p = pieces[Math.max(0, Math.min(pieces.length - 1, i))]!;
    p.scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth', block: 'start' });
    p.focus({ preventScroll: true });
    history.replaceState(history.state, '', `#${p.id}`);
  };
  const onKey = (ev: KeyboardEvent) => {
    if (!box.isConnected) return void document.removeEventListener('keydown', onKey);
    if (ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
    const t = ev.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest('dialog[open]'))) return;
    const k = ev.key.toLowerCase();
    if (k === 'j' || k === 'arrowright') {
      ev.preventDefault();
      go(current() + 1);
    } else if (k === 'k' || k === 'arrowleft') {
      ev.preventDefault();
      go(current() - 1);
    }
  };
  document.addEventListener('keydown', onKey);
}
