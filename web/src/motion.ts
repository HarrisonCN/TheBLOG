/**
 * 动效：全部来自 Winston 自己的 Motionary（motionary/core + motionary/runtime）。
 * - motionary/core 的 createMotion().reveal()：卡片 / 区块滚动入场（自带 reduced-motion 处理）
 * - motionary/runtime/text 的 splitText()：标题逐字入场（normal / high）
 * - 阅读进度条：<usa-scroll-progress>；滚动场景：<usa-scroll-scene>（见 render.ts / usa/）
 * prefers-reduced-motion 或设置为 off 时完全不启用。
 */
import { createMotion, type MotionInstance } from 'motionary/core';
import { use, tween } from 'motionary/runtime';
import { scroll, killScenes } from 'motionary/runtime/scroll';
import { text, splitText, type SplitResult } from 'motionary/runtime/text';
import type { Animation } from './types';

let motion: MotionInstance | null = null;
let registered = false;
let cleanups: (() => void)[] = [];

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function effectiveLevel(level: Animation): Animation {
  return prefersReducedMotion() ? 'off' : level;
}

export function teardownMotion(): void {
  for (const c of cleanups.splice(0)) {
    try {
      c();
    } catch {
      /* ignore */
    }
  }
  if (registered) killScenes();
}

export function applyMotion(root: HTMLElement, level: Animation): void {
  teardownMotion();
  const lvl = effectiveLevel(level);
  document.documentElement.dataset.motion = lvl;
  if (lvl === 'off') return;
  if (!registered) {
    use(scroll, text);
    registered = true;
  }
  motion ??= createMotion({ reducedMotion: 'user' });

  // 1) 滚动入场
  const reveals = root.querySelectorAll<HTMLElement>('.reveal');
  if (reveals.length) {
    const preset = lvl === 'low' ? 'fade' : 'fade-up';
    cleanups.push(motion.reveal(reveals, preset, { stagger: lvl === 'high' ? 90 : 60, duration: lvl === 'low' ? 400 : 650, once: true, threshold: 0.1 }));
  }

  // 2) 标题逐字入场
  if (lvl === 'normal' || lvl === 'high') {
    const title = root.querySelector<HTMLElement>('[data-split]');
    if (title) {
      const split: SplitResult = splitText(title, { type: lvl === 'high' ? 'chars,words' : 'words' });
      const pieces = lvl === 'high' ? split.chars : split.words;
      const tw = tween(pieces, { from: { y: '0.6em', opacity: 0 }, to: { y: '0em', opacity: 1 }, duration: 520, stagger: lvl === 'high' ? 28 : 60, ease: 'cubic-out' });
      cleanups.push(() => {
        tw.kill?.();
        split.revert();
      });
    }
  }

}
