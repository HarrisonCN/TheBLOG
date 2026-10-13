/**
 * 新版首页与全站外壳的浏览器端交互：
 * - 首图轮播（圆点 / 计数 / 左右箭头 / 键盘 / 暂停；自动播放尊重「减少动态效果」，悬停或聚焦时暂停）
 * - 本地收藏（书签按钮，只存在访客自己的浏览器）
 * - 社交 ID 卡片（个人卡片 / 页脚的社交图标：查看、复制 ID，打开主页）
 * - 订阅表单（邮箱 → 成为好朋友；纯静态，不提交到任何第三方）
 * - 顶栏的好朋友登录状态
 */
import { applyAudience } from './audience';
import { currentMember } from './community';
import { flashResult } from './result-icon';
import { icon } from './icons';

const USER_ICON = icon('user');

type Notify = (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => Promise<void> | void;
interface Ctx {
  notify: Notify;
  go: (href: string) => void;
  basePath: string;
  reducedMotion: () => boolean;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---------------------------------------------------------------- 轮播
export const CAROUSEL_INTERVAL = 6500;
const timers = new WeakMap<HTMLElement, ReturnType<typeof setInterval>>();

export function bindCarousel(root: ParentNode, ctx: Pick<Ctx, 'reducedMotion'>): void {
  root.querySelectorAll<HTMLElement>('.js-carousel').forEach((car) => {
    if (car.dataset.bound) return;
    car.dataset.bound = '1';
    const slides = [...car.querySelectorAll<HTMLElement>('.slide')];
    const dots = [...car.querySelectorAll<HTMLButtonElement>('.js-car-dot')];
    const counter = car.querySelector<HTMLElement>('.js-car-i');
    const pauseBtn = car.querySelector<HTMLButtonElement>('.js-car-pause');
    const n = slides.length;
    if (n < 2) return;
    let i = 0;
    let userPaused = ctx.reducedMotion();
    let hover = false;
    const show = (k: number) => {
      i = (k + n) % n;
      slides.forEach((s, j) => {
        const on = j === i;
        s.classList.toggle('is-active', on);
        if (on) {
          s.removeAttribute('aria-hidden');
          s.removeAttribute('inert');
        } else {
          s.setAttribute('aria-hidden', 'true');
          s.setAttribute('inert', '');
        }
        s.querySelector<HTMLElement>('.slide__cta')?.setAttribute('tabindex', on ? '0' : '-1');
      });
      dots.forEach((d, j) => (j === i ? d.setAttribute('aria-current', 'true') : d.removeAttribute('aria-current')));
      if (counter) counter.textContent = String(i + 1).padStart(2, '0');
      car.dataset.index = String(i);
    };
    const stop = () => {
      const t = timers.get(car);
      if (t) clearInterval(t);
      timers.delete(car);
    };
    const start = () => {
      stop();
      if (userPaused || hover || document.hidden || !car.isConnected) return;
      timers.set(
        car,
        setInterval(() => {
          if (!car.isConnected) return stop();
          show(i + 1);
        }, CAROUSEL_INTERVAL),
      );
    };
    const paintPause = () => {
      if (!pauseBtn) return;
      pauseBtn.setAttribute('aria-pressed', String(userPaused));
      pauseBtn.setAttribute('aria-label', userPaused ? '继续自动播放' : '暂停自动播放');
      car.classList.toggle('is-paused', userPaused);
    };
    car.querySelector('.js-car-prev')?.addEventListener('click', () => (show(i - 1), start()));
    car.querySelector('.js-car-next')?.addEventListener('click', () => (show(i + 1), start()));
    dots.forEach((d) => d.addEventListener('click', () => (show(Number(d.dataset.i)), start())));
    pauseBtn?.addEventListener('click', () => {
      userPaused = !userPaused;
      paintPause();
      start();
    });
    car.addEventListener('keydown', (ev) => {
      if ((ev.target as HTMLElement).closest('input, textarea')) return;
      if (ev.key === 'ArrowLeft') (show(i - 1), start());
      else if (ev.key === 'ArrowRight') (show(i + 1), start());
    });
    car.addEventListener('pointerenter', () => ((hover = true), stop()));
    car.addEventListener('pointerleave', () => ((hover = false), start()));
    car.addEventListener('focusin', () => ((hover = true), stop()));
    car.addEventListener('focusout', (ev) => {
      if (!car.contains(ev.relatedTarget as Node)) (hover = false), start();
    });
    // 触摸滑动
    let x0: number | null = null;
    car.addEventListener('touchstart', (ev) => (x0 = ev.touches[0]?.clientX ?? null), { passive: true });
    car.addEventListener('touchend', (ev) => {
      const x1 = ev.changedTouches[0]?.clientX;
      if (x0 !== null && x1 !== undefined && Math.abs(x1 - x0) > 40) (show(x1 < x0 ? i + 1 : i - 1), start());
      x0 = null;
    });
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    paintPause();
    show(0);
    start();
  });
}

// ---------------------------------------------------------------- 本地收藏
const BM_KEY = 'blog-bookmarks';
export function bookmarks(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(BM_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
export function paintBookmarks(root: ParentNode): void {
  const set = new Set(bookmarks());
  root.querySelectorAll<HTMLElement>('.js-bookmark').forEach((b) => b.setAttribute('aria-pressed', String(set.has(b.dataset.slug ?? ''))));
}

// ---------------------------------------------------------------- 社交 ID 卡片
function closeSocPop(): void {
  const pop = document.getElementById('soc-pop');
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  document.querySelector('.js-soc[aria-expanded="true"]')?.setAttribute('aria-expanded', 'false');
}
function openSocPop(a: HTMLAnchorElement, ctx: Ctx): void {
  let pop = document.getElementById('soc-pop');
  if (!pop) {
    document.body.insertAdjacentHTML('beforeend', '<div class="soc-pop" id="soc-pop" role="dialog" aria-label="社交 ID" hidden></div>');
    pop = document.getElementById('soc-pop')!;
  }
  const { handle = '', label = '' } = a.dataset;
  const ic = a.querySelector('svg')?.outerHTML ?? '';
  const ext = a.target === '_blank';
  pop.innerHTML = `<div class="soc-pop__head">${ic}<b>${esc(label)}</b><button type="button" class="soc-pop__x js-soc-close" aria-label="关闭">${icon('close')}</button></div>
<p class="soc-pop__k">社交 ID</p><p class="soc-pop__id">${esc(handle)}</p>
<div class="soc-pop__act"><button type="button" class="btn btn--sm btn--primary js-soc-copy">${icon('copy')}复制 ID</button><a class="btn btn--sm btn--soft" href="${esc(a.href)}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${a.href.startsWith('mailto:') ? '写邮件' : '打开主页'}</a></div>`;
  pop.hidden = false;
  a.setAttribute('aria-expanded', 'true');
  const r = a.getBoundingClientRect();
  const w = pop.offsetWidth;
  const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, document.documentElement.clientWidth - w - 8));
  const below = r.bottom + 10 + pop.offsetHeight < innerHeight;
  pop.style.left = `${left + scrollX}px`;
  pop.style.top = `${(below ? r.bottom + 10 : r.top - pop.offsetHeight - 10) + scrollY}px`;
  pop.querySelector<HTMLButtonElement>('.js-soc-copy')!.onclick = (ev) => {
    const btn = ev.currentTarget as HTMLElement;
    void navigator.clipboard?.writeText(handle).then(
      () => (flashResult(btn, 'success'), ctx.notify(`已复制 ${label} ID：${handle}`, 'success')),
      () => (flashResult(btn, 'error'), ctx.notify('复制失败，请手动选择', 'warning')),
    );
  };
  pop.querySelector<HTMLButtonElement>('.js-soc-close')!.onclick = () => {
    closeSocPop();
    a.focus();
  };
  pop.querySelector<HTMLButtonElement>('.js-soc-copy')!.focus();
}

// ---------------------------------------------------------------- 登录状态
export function paintMember(): void {
  applyAudience();
  const me = currentMember();
  document.querySelectorAll<HTMLAnchorElement>('.js-me').forEach((a) => {
    a.classList.toggle('is-member', !!me);
    if (!me) {
      a.setAttribute('aria-label', '好朋友登录 / 注册');
      a.title = '好朋友登录 / 注册';
      if (a.querySelector('.nav__me-av')) a.innerHTML = USER_ICON;
    } else {
      const n = me.member.name;
      a.setAttribute('aria-label', `已登录：${n}（好朋友）`);
      a.title = `已登录：${n}`;
      a.innerHTML = `<span class="nav__me-av" aria-hidden="true">${esc(n.slice(0, 1))}</span>`;
    }
  });
}

// ---------------------------------------------------------------- 绑定（全局委托，只装一次）
let installed = false;
export function installHomeClient(ctx: Ctx): void {
  if (installed) return;
  installed = true;
  document.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const bm = t.closest<HTMLElement>('.js-bookmark');
    if (bm) {
      ev.preventDefault();
      const slug = bm.dataset.slug ?? '';
      const list = bookmarks();
      const on = !list.includes(slug);
      const next = on ? [slug, ...list] : list.filter((s) => s !== slug);
      try {
        localStorage.setItem(BM_KEY, JSON.stringify(next.slice(0, 200)));
      } catch {
        /* 存储满了 */
      }
      paintBookmarks(document);
      if (on) flashResult(bm, 'success', 1200);
      const signedIn = !!localStorage.getItem('blog-member');
      void ctx.notify(on ? (signedIn ? '已收藏（同步到你的账号）' : '已收藏到本机（登录后可同步到账号）') : '已取消收藏', on ? 'success' : 'info');
      // L15：已登录时由 main.ts 按需加载 social-client 同步到云端
      document.dispatchEvent(new CustomEvent('blog:bookmark', { detail: { slug, on, title: /《(.+)》/.exec(bm.getAttribute('aria-label') ?? '')?.[1] ?? '' } }));
      return;
    }
    const soc = t.closest<HTMLAnchorElement>('.js-soc');
    if (soc && !(ev as MouseEvent).metaKey && !(ev as MouseEvent).ctrlKey) {
      ev.preventDefault();
      ev.stopPropagation();
      if (soc.getAttribute('aria-expanded') === 'true') closeSocPop();
      else {
        closeSocPop();
        openSocPop(soc, ctx);
      }
      return;
    }
    if (!t.closest('#soc-pop')) closeSocPop();
  }, true);
  document.addEventListener('keydown', (ev) => ev.key === 'Escape' && closeSocPop());
  document.addEventListener('blog:member', paintMember);
  addEventListener('resize', closeSocPop);
  document.addEventListener('submit', (ev) => {
    const form = (ev.target as HTMLElement).closest<HTMLFormElement>('.js-sub-form');
    if (!form) return;
    ev.preventDefault();
    const email = String(new FormData(form).get('email') ?? '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      form.querySelector('input')?.focus();
      void ctx.notify('请输入有效的邮箱地址', 'warning');
      return;
    }
    ctx.go(`${ctx.basePath}/join/?email=${encodeURIComponent(email)}&from=subscribe`);
  });
}

/** 每次换页后调用 */
export function bindHomePage(root: HTMLElement, ctx: Ctx): void {
  bindCarousel(root, ctx);
  paintBookmarks(root);
  paintMember();
  // 从订阅框过来：把邮箱填进注册表单
  const form = root.querySelector<HTMLFormElement>('.js-join-form');
  const q = new URLSearchParams(location.search);
  const email = q.get('email');
  if (form && email) {
    const set = () => {
      const f = form.querySelector<HTMLElement & { value?: string }>('[name="email"]');
      if (f) f.value = email.slice(0, 120);
    };
    set();
    void customElements.whenDefined('usa-field').then(set);
    if (q.get('from') === 'subscribe') root.querySelector('.js-join-hint')?.removeAttribute('hidden');
  }
}
