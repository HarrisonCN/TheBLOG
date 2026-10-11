// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/usa', () => ({ defineUsed: () => Promise.resolve() }));
vi.mock('../src/music.css', () => ({}));
const content = vi.fn(async () => ({ items: [{ id: 'swing-low', title: 'Swing Low', artist: 'Cocolixe', album: '', src: 'https://archive.org/download/NS050/03.mp3', cover: '', duration: 200, license: 'CC BY-NC-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/', link: 'https://archive.org/details/NS050' }] }));
vi.mock('../src/api', () => ({ api: { content: () => content() }, API_BASE: '', DEMO: false }));

import { musicTabHtml } from '../src/music-tab';
import { createPlayer, creditHtml, playerHtml } from '../src/music-player';
import { OPEN_KEY, QUEUE_KEY, serializeQueue, type Track } from '../src/music-core';
import { claimMedia } from '../src/media-bus';

const T = (id: string, extra: Partial<Track> = {}): Track => ({ id, title: id, artist: 'Artist', album: '', src: `https://cdn.example.com/${id}.mp3`, cover: '', duration: 120, source: 'openverse', preview: false, license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', link: 'https://www.jamendo.com/track/1', provider: 'Jamendo', ...extra });
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

let plays = 0;
let paused = true;
beforeEach(() => {
  document.body.innerHTML = musicTabHtml();
  localStorage.clear();
  plays = 0;
  paused = true;
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get: () => paused });
  HTMLMediaElement.prototype.play = function () {
    plays++;
    paused = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {
    paused = true;
    this.dispatchEvent(new Event('pause'));
  };
});

describe('把手（主包）', () => {
  it('默认收起：aria-expanded=false，指向面板', () => {
    const tab = document.querySelector<HTMLButtonElement>('.js-mtab')!;
    expect(tab.getAttribute('aria-expanded')).toBe('false');
    expect(tab.getAttribute('aria-controls')).toBe('mplayer');
    expect(tab.getAttribute('aria-label')).toBe('打开音乐播放器');
  });
});

describe('播放器面板', () => {
  it('创建后仍是收起状态（hidden + inert），不出声', async () => {
    createPlayer(document.querySelector('.js-mtab')!);
    await tick();
    const el = document.getElementById('mplayer')!;
    expect(el.hidden).toBe(true);
    expect(el.inert).toBe(true);
    expect(document.querySelectorAll('audio').length).toBe(0); // 唯一的 <audio> 不在 DOM 里
    expect(plays).toBe(0);
  });
  it('打开 / Esc 收起并把焦点还给把手；状态写入 localStorage', async () => {
    const tab = document.querySelector<HTMLButtonElement>('.js-mtab')!;
    const p = createPlayer(tab);
    p.open(true);
    const el = document.getElementById('mplayer')!;
    expect(el.hidden).toBe(false);
    expect(tab.getAttribute('aria-expanded')).toBe('true');
    expect(localStorage.getItem(OPEN_KEY)).toBe('1');
    el.querySelector<HTMLElement>('[role="tab"]')!.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(p.isOpen()).toBe(false);
    expect(tab.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(tab);
    expect(localStorage.getItem(OPEN_KEY)).toBe('0');
    expect(plays).toBe(0);
  });
  it('读回队列；打开不播放；点播放才 play()；空格（焦点在面板上）切换；朗读开始时暂停', async () => {
    localStorage.setItem(QUEUE_KEY, serializeQueue({ tracks: [T('a'), T('b')], index: 1, volume: 0.4, muted: false }));
    const p = createPlayer(document.querySelector('.js-mtab')!);
    p.open(false);
    await tick();
    const el = document.getElementById('mplayer')!;
    expect(el.querySelector('.js-mp-title')!.textContent).toBe('b');
    expect(el.querySelectorAll('.js-mp-queue .mp-item').length).toBe(2);
    expect(plays).toBe(0);
    el.querySelector<HTMLButtonElement>('.js-mp-play')!.click();
    await tick();
    expect(plays).toBe(1);
    expect(el.querySelector('.js-mp-play')!.getAttribute('aria-label')).toBe('暂停');
    expect(document.querySelector('.js-mtab')!.classList.contains('is-playing')).toBe(true);
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    expect(paused).toBe(true);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    await tick();
    expect(paused).toBe(false);
    claimMedia('tts');
    expect(paused).toBe(true);
  });
  it('本站歌单加载并可加入队列（队列持久化）', async () => {
    const p = createPlayer(document.querySelector('.js-mtab')!);
    p.open(false);
    await tick(10);
    const el = document.getElementById('mplayer')!;
    expect(el.querySelector('#mp-tab-site')!.getAttribute('aria-selected')).toBe('true');
    const add = el.querySelector<HTMLButtonElement>('.js-mp-site [data-act="add"]')!;
    expect(add.getAttribute('aria-label')).toContain('Swing Low');
    add.click();
    await tick();
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY)!).tracks[0]).toMatchObject({ id: 'site-swing-low', source: 'site' });
    expect(plays).toBe(0);
  });
  it('标签页：方向键切换 aria-selected', async () => {
    const p = createPlayer(document.querySelector('.js-mtab')!);
    p.open(false);
    await tick(10);
    const tabs = document.querySelector<HTMLElement>('.mp__tabs')!;
    tabs.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.querySelector('#mp-tab-search')!.getAttribute('aria-selected')).toBe('true');
    expect((document.querySelector('#mp-pane-search') as HTMLElement).hidden).toBe(false);
  });
});

describe('署名与转义', () => {
  it('CC 曲目：标题 / 作者 / 许可证链接 / 出处；iTunes：试听说明 + Apple Music', () => {
    const h = creditHtml(T('x', { title: 'Song', artist: 'Me' }));
    expect(h).toContain('“Song” by Me');
    expect(h).toContain('href="https://creativecommons.org/licenses/by/4.0/"');
    expect(h).toContain('来源：Jamendo');
    expect(creditHtml(T('i', { source: 'itunes', preview: true, link: 'https://music.apple.com/x' }))).toMatch(/30秒试听.*Apple Music/);
  });
  it('恶意标题被转义', () => {
    expect(creditHtml(T('x', { title: '<img src=x onerror=alert(1)>' }))).not.toContain('<img');
  });
  it('面板模板包含必要的无障碍标记', () => {
    const h = playerHtml();
    for (const s of ['role="region"', 'aria-label="音乐播放器"', 'aria-label="播放进度"', 'aria-label="音量"', 'role="tablist"', 'role="search"', 'role="status"', 'icons="play,pause"']) expect(h).toContain(s);
  });
});
