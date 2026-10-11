/**
 * 左下角的音乐小抽屉把手（主包里只有这一点点）：默认收起、不出声。
 * 第一次点开时才懒加载播放器（music-player.ts + music.css）。打开 / 收起状态记在 localStorage，默认收起；
 * 即使上次是打开的，刷新后也只是把面板摆出来，绝不自动播放。
 */
import { icon } from './icons';
import { OPEN_KEY, type Track } from './music-core';

export interface MusicPlayerHandle {
  open(focus?: boolean): void;
  close(returnFocus?: boolean): void;
  toggle(): void;
  isOpen(): boolean;
  /** 正文音频块：加入队列并播放（只在用户点击后调用，不会自动播放） */
  addAndPlay(t: Track): void;
}

export function musicTabHtml(): string {
  return `<button class="mtab js-mtab" id="mtab" type="button" aria-label="打开音乐播放器" aria-expanded="false" aria-controls="mplayer"><span class="mtab__ic mtab__ic--note">${icon('music')}</span><span class="mtab__ic mtab__ic--x">${icon('chevronLeft')}</span><span class="mtab__eq" aria-hidden="true"><i></i><i></i><i></i></span></button>`;
}

let player: Promise<MusicPlayerHandle> | null = null;
function ensurePlayer(tab: HTMLButtonElement): Promise<MusicPlayerHandle> {
  tab.classList.add('is-loading');
  player ??= import('./music-player').then((m) => m.createPlayer(tab));
  void player.catch(() => (player = null)).finally(() => tab.classList.remove('is-loading'));
  return player;
}

const readOpen = (): boolean => {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
};

export function installMusicTab(): void {
  const tab = document.querySelector<HTMLButtonElement>('.js-mtab');
  if (!tab || tab.dataset.bound) return;
  tab.dataset.bound = '1';
  tab.addEventListener('click', () => void ensurePlayer(tab).then((p) => p.toggle()));
  if (readOpen()) {
    const go = () => void ensurePlayer(tab).then((p) => p.open(false));
    if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 1500 });
    else setTimeout(go, 300);
  }
}

/** 正文 :::audio 块的「播放」按钮：打开播放器、把这一首加到队列里播放。 */
export function playInMusicPlayer(t: Track): Promise<void> {
  const tab = document.querySelector<HTMLButtonElement>('.js-mtab');
  if (!tab) return Promise.reject(new Error('no music tab'));
  return ensurePlayer(tab).then((p) => p.addAndPlay(t));
}
