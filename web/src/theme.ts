import type { Settings } from './types';

const KEY = 'blog-theme';
type Mode = 'light' | 'dark';

function systemMode(): Mode {
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** 优先级：访客手动选择 > 站点设置 > 系统。 */
export function applyTheme(settings: Settings): void {
  let stored: Mode | null = null;
  try {
    stored = localStorage.getItem(KEY) as Mode | null;
  } catch {
    /* 隐私模式 */
  }
  const mode: Mode = stored ?? (settings.theme === 'system' ? systemMode() : settings.theme);
  document.documentElement.dataset.theme = mode;
}

export function currentMode(): Mode {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function setMode(next: Mode): void {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* ignore */
  }
  document.documentElement.dataset.theme = next;
}

export function toggleTheme(): void {
  setMode(currentMode() === 'dark' ? 'light' : 'dark');
}
