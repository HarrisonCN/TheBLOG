import type { Settings } from './types';

const KEY = 'blog-theme';
type Mode = 'light' | 'dark';

function systemMode(): Mode {
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** 优先级：访客手动选择 > 站点设置 > 系统。 */
export function applyTheme(settings: Settings): void {
  const stored = localStorage.getItem(KEY) as Mode | null;
  const mode: Mode = stored ?? (settings.theme === 'system' ? systemMode() : settings.theme);
  document.documentElement.dataset.theme = mode;
}

export function toggleTheme(): void {
  const next: Mode = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(KEY, next);
  document.documentElement.dataset.theme = next;
}
