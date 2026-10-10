// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindCarousel, bindHomePage, bookmarks, CAROUSEL_INTERVAL, installHomeClient, paintMember } from '../src/home-client';
import { heroCarousel, profileCard, subscribeCard, featureCard, joinPage } from '../src/render';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type Post, type SiteData } from '../src/types';

const base: Post = {
  id: 1, slug: 'a', title: 'A', summary: 's', contentMd: '', tags: [], coverUrl: 'https://img.example/a-1280.webp', category: '摄影', pinned: false, wordCount: 600, status: 'published',
  publishedAt: '2026-10-01T00:00:00Z', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
};
const posts = ['a', 'b', 'c'].map((slug, i) => ({ ...base, id: i + 1, slug, title: slug.toUpperCase() }));
const site: SiteData = {
  settings: DEFAULT_SETTINGS,
  profile: { ...DEFAULT_PROFILE, links: [{ label: '微信', url: '/about/', icon: 'wechat', handle: 'wx-demo' }, { label: 'GitHub', url: 'https://github.com/HarrisonCN', icon: 'github' }] },
  posts, total: 3, tags: [], categories: [],
};
const notify = vi.fn();
const go = vi.fn();
const ctx = { notify, go, basePath: '/TheBLOG', reducedMotion: () => false };
installHomeClient(ctx);

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<div id="rt">${html}</div>`;
  return document.getElementById('rt')!;
}
const active = (root: HTMLElement) => [...root.querySelectorAll('.slide')].findIndex((s) => s.classList.contains('is-active'));

beforeEach(() => {
  localStorage.clear();
  notify.mockClear();
  go.mockClear();
});
afterEach(() => vi.useRealTimers());

describe('首图轮播', () => {
  it('箭头 / 圆点 / 键盘切换，并同步 aria-current、inert、计数', () => {
    const root = mount(heroCarousel(posts));
    bindCarousel(root, { reducedMotion: () => true });
    const car = root.querySelector<HTMLElement>('.js-carousel')!;
    expect(active(root)).toBe(0);
    root.querySelector<HTMLButtonElement>('.js-car-next')!.click();
    expect(active(root)).toBe(1);
    expect(root.querySelector('.js-car-i')!.textContent).toBe('02');
    expect(root.querySelectorAll('.js-car-dot')[1]!.getAttribute('aria-current')).toBe('true');
    expect(root.querySelector('#slide-0')!.hasAttribute('inert')).toBe(true);
    expect(root.querySelector('#slide-1')!.hasAttribute('inert')).toBe(false);
    root.querySelector<HTMLButtonElement>('.js-car-prev')!.click();
    root.querySelector<HTMLButtonElement>('.js-car-prev')!.click();
    expect(active(root)).toBe(2); // 循环
    root.querySelectorAll<HTMLButtonElement>('.js-car-dot')[0]!.click();
    expect(active(root)).toBe(0);
    car.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(active(root)).toBe(1);
  });

  it('自动播放；「减少动态效果」时不自动播放；暂停按钮可以停下', () => {
    vi.useFakeTimers();
    let root = mount(heroCarousel(posts));
    bindCarousel(root, { reducedMotion: () => false });
    vi.advanceTimersByTime(CAROUSEL_INTERVAL + 10);
    expect(active(root)).toBe(1);
    const pause = root.querySelector<HTMLButtonElement>('.js-car-pause')!;
    pause.click();
    expect(pause.getAttribute('aria-pressed')).toBe('true');
    expect(pause.getAttribute('aria-label')).toBe('继续自动播放');
    vi.advanceTimersByTime(CAROUSEL_INTERVAL * 3);
    expect(active(root)).toBe(1);

    root = mount(heroCarousel(posts));
    bindCarousel(root, { reducedMotion: () => true });
    vi.advanceTimersByTime(CAROUSEL_INTERVAL * 3);
    expect(active(root)).toBe(0);
    expect(root.querySelector('.js-car-pause')!.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('收藏 / 社交 ID / 订阅 / 登录状态', () => {
  it('书签按钮切换本地收藏', () => {
    const root = mount(featureCard(posts[0]!));
    const bm = root.querySelector<HTMLButtonElement>('.js-bookmark')!;
    bm.click();
    expect(bookmarks()).toEqual(['a']);
    expect(bm.getAttribute('aria-pressed')).toBe('true');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('已收藏'), 'success');
    bm.click();
    expect(bookmarks()).toEqual([]);
    expect(bm.getAttribute('aria-pressed')).toBe('false');
  });

  it('点社交图标弹出社交 ID 卡片，Esc 关闭；没有 ID 的图标是普通链接', () => {
    const root = mount(profileCard(site, 'full'));
    const soc = root.querySelector<HTMLAnchorElement>('.js-soc')!;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    soc.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    const pop = document.getElementById('soc-pop')!;
    expect(pop.hidden).toBe(false);
    expect(pop.querySelector('.soc-pop__id')!.textContent).toBe('wx-demo');
    expect(pop.textContent).toContain('微信');
    expect(soc.getAttribute('aria-expanded')).toBe('true');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(pop.hidden).toBe(true);
    expect(root.querySelectorAll('.js-soc').length).toBe(1);
    expect(root.querySelector('a.soc:not(.js-soc)')!.getAttribute('href')).toBe('https://github.com/HarrisonCN');
  });

  it('订阅框：邮箱不对时提示；对时带着邮箱去「成为好朋友」', () => {
    const root = mount(subscribeCard());
    const form = root.querySelector<HTMLFormElement>('.js-sub-form')!;
    const input = form.querySelector<HTMLInputElement>('input')!;
    input.value = 'nope';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(notify).toHaveBeenCalledWith('请输入有效的邮箱地址', 'warning');
    expect(go).not.toHaveBeenCalled();
    input.value = 'a+b@example.com';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(go).toHaveBeenCalledWith('/TheBLOG/join/?email=a%2Bb%40example.com&from=subscribe');
  });

  it('注册页：从订阅框过来时预填邮箱并显示说明', () => {
    history.replaceState(null, '', '/join/?email=x%40y.com&from=subscribe');
    const root = mount(joinPage(site).main);
    bindHomePage(root, ctx);
    expect(root.querySelector<HTMLElement & { value?: string }>('.js-join-form [name="email"]')!.value).toBe('x@y.com');
    expect(root.querySelector('.js-join-hint')!.hasAttribute('hidden')).toBe(false);
    history.replaceState(null, '', '/');
  });

  it('顶栏显示好朋友登录状态', () => {
    mount('<a class="js-me" href="/join/" aria-label="好朋友登录 / 注册">u</a>');
    paintMember();
    expect(document.querySelector('.js-me')!.classList.contains('is-member')).toBe(false);
    localStorage.setItem('blog-member', JSON.stringify({ token: 'm_x', member: { id: 1, name: '小林', bio: '', avatarUrl: '', badges: [] } }));
    paintMember();
    const me = document.querySelector('.js-me')!;
    expect(me.classList.contains('is-member')).toBe(true);
    expect(me.getAttribute('aria-label')).toContain('已登录：小林');
  });
});
