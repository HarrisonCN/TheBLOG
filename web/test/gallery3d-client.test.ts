// @vitest-environment happy-dom
/**
 * L35 hall-client（3D 展厅增强）：
 * - 减少动态效果 / 不支持 3D：保持平面列表，3D 舞台不打开（但提供切换按钮，支持 3D 时用户可以手动打开）；
 * - 立体视图：舞台出现，展品是可聚焦的按钮（roving tabindex），方向键 / Home / End / PageUp / PageDown 导览，
 *   当前展品 aria-current、读屏播报（aria-live）、房间转向当前墙面；Enter 近看、Esc 退出；
 * - 视图选择记在 localStorage；没有任何计时器推动导览（不自动播放）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindHall, HALL_PREF_KEY } from '../src/hall-client';
import { renderRoute } from '../src/render';
import { validateHall, type Hall } from '../src/gallery-core';

const img = (n: string) => ({ src: `/demo/photos/${n}-1280.webp`, alt: `示例照片 ${n}`, w: 1280, h: 853 });
const hall: Hall = validateHall({
  slug: 'test-hall',
  title: '测试展厅',
  summary: '',
  date: '2026-10-15',
  status: 'published',
  exhibits: [
    { id: 'e1', title: '湖', image: img('hero-lake'), wall: 'east' },
    { id: 'e2', title: '山', image: img('himalayas'), wall: 'north' },
    { id: 'e3', title: '海', image: img('baltic-view'), wall: 'east' },
    { id: 'e4', title: '花', image: img('iris'), wall: 'west' },
  ],
}).hall!;
const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;

function mount(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = renderRoute({ name: 'hall', slug: 'test-hall' } as never, site, { hall } as never).main;
  document.body.innerHTML = '';
  document.body.appendChild(root);
  return root;
}
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const stage = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-hall-stage]')!;
const toggle = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('[data-hall-toggle]')!;
const current = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-hall-ex][aria-current="true"]');

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe('hall-client', () => {
  it('减少动态效果：保持平面，舞台隐藏；切换按钮可见且 aria-pressed=false', () => {
    const root = mount();
    bindHall(root, { reducedMotion: true, supports3d: true });
    expect(stage(root).hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('.hall-flat')!.hidden).toBe(false);
    expect(toggle(root).hidden).toBe(false);
    expect(toggle(root).getAttribute('aria-pressed')).toBe('false');
  });
  it('不支持 3D：只有平面，切换按钮隐藏', () => {
    const root = mount();
    bindHall(root, { reducedMotion: false, supports3d: false });
    expect(stage(root).hidden).toBe(true);
    expect(toggle(root).hidden).toBe(true);
  });
  it('立体视图：舞台打开，第一件（北墙「山」）是唯一 tabindex=0；方向键导览并播报；房间转向当前墙面', () => {
    const root = mount();
    bindHall(root, { reducedMotion: false, supports3d: true });
    const st = stage(root);
    expect(st.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('.hall-flat')!.hidden).toBe(true);
    const ex = [...st.querySelectorAll<HTMLElement>('[data-hall-ex]')];
    expect(ex).toHaveLength(4);
    expect(ex.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    expect(current(root)!.textContent).toContain('山');
    for (const b of ex) expect(b.querySelector('img')!.getAttribute('alt')).toMatch(/^示例照片 /);
    const live = st.querySelector<HTMLElement>('[aria-live="polite"]')!;
    key(current(root)!, 'ArrowRight');
    expect(current(root)!.textContent).toContain('湖');
    expect(live.textContent).toBe('第 2 件，共 4 件 · 东墙 · 湖');
    expect(st.querySelector<HTMLElement>('[data-hall-room]')!.style.getPropertyValue('--hall-ry')).toBe('-90deg');
    key(current(root)!, 'End');
    expect(current(root)!.textContent).toContain('花');
    expect(st.querySelector<HTMLElement>('[data-hall-room]')!.style.getPropertyValue('--hall-ry')).toBe('-270deg');
    key(current(root)!, 'ArrowRight');
    expect(current(root)!.textContent).toContain('山');
    expect(st.querySelector<HTMLElement>('[data-hall-room]')!.style.getPropertyValue('--hall-ry')).toBe('-360deg');
    key(current(root)!, 'PageDown');
    expect(current(root)!.textContent).toContain('湖');
    key(current(root)!, 'Home');
    expect(current(root)!.textContent).toContain('山');
    expect(document.activeElement).toBe(current(root));
  });
  it('Enter 近看（aria-expanded，说明出现）、Esc 退出；上一件 / 下一件按钮', () => {
    const root = mount();
    bindHall(root, { reducedMotion: false, supports3d: true });
    const st = stage(root);
    key(current(root)!, 'Enter');
    expect(st.classList.contains('is-near')).toBe(true);
    expect(current(root)!.getAttribute('aria-expanded')).toBe('true');
    key(current(root)!, 'Escape');
    expect(st.classList.contains('is-near')).toBe(false);
    expect(current(root)!.getAttribute('aria-expanded')).toBe('false');
    st.querySelector<HTMLButtonElement>('[data-hall-next]')!.click();
    expect(current(root)!.textContent).toContain('湖');
    st.querySelector<HTMLButtonElement>('[data-hall-prev]')!.click();
    expect(current(root)!.textContent).toContain('山');
  });
  it('切换到平面并记住；再次绑定时沿用；手动选立体即使减少动态效果也打开（但标记 no-motion）', () => {
    const root = mount();
    bindHall(root, { reducedMotion: false, supports3d: true });
    toggle(root).click();
    expect(stage(root).hidden).toBe(true);
    expect(localStorage.getItem(HALL_PREF_KEY)).toBe('flat');
    const r2 = mount();
    bindHall(r2, { reducedMotion: false, supports3d: true });
    expect(stage(r2).hidden).toBe(true);
    toggle(r2).click();
    expect(localStorage.getItem(HALL_PREF_KEY)).toBe('3d');
    const r3 = mount();
    bindHall(r3, { reducedMotion: true, supports3d: true });
    expect(stage(r3).hidden).toBe(false);
    expect(stage(r3).classList.contains('no-motion')).toBe(true);
  });
  it('不自动播放：过去很久，当前展品不变；重复绑定不会重复生成', () => {
    vi.useFakeTimers();
    const root = mount();
    bindHall(root, { reducedMotion: false, supports3d: true });
    bindHall(root, { reducedMotion: false, supports3d: true });
    expect(stage(root).querySelectorAll('[data-hall-ex]')).toHaveLength(4);
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(current(root)!.textContent).toContain('山');
    expect(vi.getTimerCount()).toBe(0);
  });
});
