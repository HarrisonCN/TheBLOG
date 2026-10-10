/**
 * 文章内图片 lightbox（缩放 / 拖动 / 滑动切换 / 图注 / 键盘）、脚注悬停预览、照片地图点位交互。
 * 全部是渐进增强：没有 JS 时图片和脚注照常显示，脚注链接照常跳转。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));

/** 图注：figure 里的 figcaption → title → alt。 */
export function captionOf(img: HTMLImageElement): string {
  const fig = img.closest('figure')?.querySelector('figcaption')?.textContent?.trim();
  return fig || img.title?.trim() || img.alt?.trim() || '';
}

let dlg: HTMLDialogElement | null = null;
function ensureDialog(): HTMLDialogElement {
  if (dlg && document.body.contains(dlg)) return dlg;
  dlg = document.createElement('dialog');
  dlg.className = 'plb';
  dlg.setAttribute('aria-label', '图片查看器');
  dlg.innerHTML = `<div class="plb__stage js-plb-stage"><img class="plb__img js-plb-img" alt="" draggable="false"></div>
<div class="plb__foot"><p class="plb__cap js-plb-cap" aria-live="polite"></p>
<div class="plb__bar" role="toolbar" aria-label="图片操作">
<button type="button" class="plb__b js-plb-prev" aria-label="上一张（←）">${icon('chevronLeft')}</button>
<span class="plb__pos js-plb-pos" aria-live="polite"></span>
<button type="button" class="plb__b js-plb-next" aria-label="下一张（→）">${icon('chevronRight')}</button>
<span class="plb__sep" aria-hidden="true"></span>
<button type="button" class="plb__b js-plb-out" aria-label="缩小（-）"><span aria-hidden="true">−</span></button>
<span class="plb__zoom js-plb-zoom">100%</span>
<button type="button" class="plb__b js-plb-in" aria-label="放大（+）"><span aria-hidden="true">+</span></button>
<button type="button" class="plb__b js-plb-reset" aria-label="还原大小（0）">${icon('refresh')}</button>
<button type="button" class="plb__b js-plb-close" aria-label="关闭（Esc）">${icon('close')}</button>
</div><p class="plb__hint muted small">←/→ 切换 · +/− 缩放 · 双击放大 · 拖动查看 · 手机上左右滑动</p></div>`;
  document.body.append(dlg);
  return dlg;
}

export function bindLightbox(root: ParentNode): void {
  const prose = root.querySelector<HTMLElement>('.post .prose');
  if (!prose) return;
  const imgs = [...prose.querySelectorAll<HTMLImageElement>('img')];
  if (!imgs.length) return;
  imgs.forEach((im, i) => {
    if (im.dataset.lb) return;
    im.dataset.lb = String(i);
    im.tabIndex = 0;
    im.setAttribute('role', 'button');
    im.setAttribute('aria-label', `查看大图：${captionOf(im) || `第 ${i + 1} 张图片`}`);
    im.classList.add('lb-zoomable');
  });
  if (prose.dataset.lbBound) return;
  prose.dataset.lbBound = '1';
  const open = (i: number) => openLightbox(imgs, i);
  prose.addEventListener('click', (ev) => {
    const im = (ev.target as HTMLElement).closest<HTMLImageElement>('img[data-lb]');
    if (im) open(Number(im.dataset.lb));
  });
  prose.addEventListener('keydown', (ev) => {
    const im = (ev.target as HTMLElement).closest?.<HTMLImageElement>('img[data-lb]');
    if (im && (ev.key === 'Enter' || ev.key === ' ')) {
      ev.preventDefault();
      open(Number(im.dataset.lb));
    }
  });
}

export function openLightbox(imgs: HTMLImageElement[], start: number): void {
  const d = ensureDialog();
  const img = d.querySelector<HTMLImageElement>('.js-plb-img')!;
  const stage = d.querySelector<HTMLElement>('.js-plb-stage')!;
  let i = start;
  let z = 1;
  let tx = 0;
  let ty = 0;
  const opener = imgs[start] ?? null;
  const apply = () => {
    if (z <= 1) {
      tx = 0;
      ty = 0;
    }
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`;
    d.querySelector('.js-plb-zoom')!.textContent = `${Math.round(z * 100)}%`;
    d.classList.toggle('is-zoomed', z > 1);
  };
  const show = (n: number) => {
    i = (n + imgs.length) % imgs.length;
    const src = imgs[i]!;
    img.src = src.currentSrc || src.src;
    img.alt = src.alt;
    d.querySelector('.js-plb-cap')!.textContent = captionOf(src);
    d.querySelector('.js-plb-pos')!.textContent = `${i + 1} / ${imgs.length}`;
    d.querySelector<HTMLButtonElement>('.js-plb-prev')!.disabled = imgs.length < 2;
    d.querySelector<HTMLButtonElement>('.js-plb-next')!.disabled = imgs.length < 2;
    z = 1;
    apply();
  };
  const zoomBy = (f: number) => {
    z = clampZoom(z * f);
    apply();
  };
  d.classList.toggle('plb--rm', reduced());
  // 每次打开重新绑定（用 AbortController 收拾上一次的监听）
  (d as HTMLDialogElement & { _ac?: AbortController })._ac?.abort();
  const ac = new AbortController();
  (d as HTMLDialogElement & { _ac?: AbortController })._ac = ac;
  const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (ev: HTMLElementEventMap[K]) => void, opts: AddEventListenerOptions = {}) => el.addEventListener(type, fn as EventListener, { ...opts, signal: ac.signal });
  on(d, 'click', (ev) => {
    const t = ev.target as HTMLElement;
    if (t.closest('.js-plb-prev')) show(i - 1);
    else if (t.closest('.js-plb-next')) show(i + 1);
    else if (t.closest('.js-plb-in')) zoomBy(1.5);
    else if (t.closest('.js-plb-out')) zoomBy(1 / 1.5);
    else if (t.closest('.js-plb-reset')) {
      z = 1;
      apply();
    } else if (t.closest('.js-plb-close') || t === d) d.close();
  });
  on(d, 'keydown', (ev) => {
    if (ev.key === 'ArrowLeft') show(i - 1);
    else if (ev.key === 'ArrowRight') show(i + 1);
    else if (ev.key === '+' || ev.key === '=') zoomBy(1.5);
    else if (ev.key === '-' || ev.key === '_') zoomBy(1 / 1.5);
    else if (ev.key === '0') {
      z = 1;
      apply();
    } else return;
    ev.preventDefault();
  });
  on(stage, 'wheel', (ev) => {
    ev.preventDefault();
    zoomBy(ev.deltaY < 0 ? 1.2 : 1 / 1.2);
  }, { passive: false });
  on(stage, 'dblclick', () => {
    z = z > 1 ? 1 : 2;
    apply();
  });
  // 指针：放大时拖动平移；未放大时左右滑动切换；两指捏合缩放
  const pts = new Map<number, { x: number; y: number }>();
  let startX = 0;
  let startY = 0;
  let startTx = 0;
  let startTy = 0;
  let pinch0 = 0;
  let zoom0 = 1;
  on(stage, 'pointerdown', (ev) => {
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    stage.setPointerCapture?.(ev.pointerId);
    startX = ev.clientX;
    startY = ev.clientY;
    startTx = tx;
    startTy = ty;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch0 = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      zoom0 = z;
    }
  });
  on(stage, 'pointermove', (ev) => {
    if (!pts.has(ev.pointerId)) return;
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pts.size === 2 && pinch0) {
      const [a, b] = [...pts.values()];
      z = clampZoom((zoom0 * Math.hypot(a!.x - b!.x, a!.y - b!.y)) / pinch0);
      apply();
    } else if (z > 1) {
      tx = startTx + (ev.clientX - startX);
      ty = startTy + (ev.clientY - startY);
      apply();
    }
  });
  const end = (ev: PointerEvent) => {
    if (!pts.has(ev.pointerId)) return;
    pts.delete(ev.pointerId);
    if (pts.size < 2) pinch0 = 0;
    if (z <= 1 && pts.size === 0) {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(ev.clientY - startY)) show(i + (dx < 0 ? 1 : -1));
    }
  };
  on(stage, 'pointerup', end);
  on(stage, 'pointercancel', end);
  on(d, 'close', () => {
    ac.abort();
    opener?.focus({ preventScroll: true });
  });
  show(start);
  if (!d.open) d.showModal();
  d.querySelector<HTMLButtonElement>('.js-plb-close')!.focus();
}

// ---------------------------------------------------------------- 脚注悬停 / 聚焦预览
export function bindFootnotes(root: ParentNode): void {
  const prose = root.querySelector<HTMLElement>('.post .prose');
  if (!prose || prose.dataset.fnBound) return;
  const refs = prose.querySelectorAll<HTMLAnchorElement>('.fn-ref a[data-fn]');
  if (!refs.length) return;
  prose.dataset.fnBound = '1';
  let tip = document.getElementById('fn-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'fn-tip';
    tip.className = 'fn-tip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    document.body.append(tip);
  }
  const t = tip;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const show = (a: HTMLAnchorElement) => {
    clearTimeout(hideTimer);
    const li = prose.querySelector(`#fn-${a.dataset.fn}`);
    if (!li) return;
    const clone = li.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.fn-back').forEach((x) => x.remove());
    t.innerHTML = `<b class="fn-tip__n">脚注 ${e(a.dataset.fn ?? '')}</b>${clone.innerHTML}`;
    t.hidden = false;
    const r = a.getBoundingClientRect();
    const w = Math.min(320, innerWidth - 24);
    t.style.width = `${w}px`;
    t.style.left = `${Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2)) + scrollX}px`;
    const below = r.bottom + 10 + t.offsetHeight < innerHeight;
    t.style.top = `${(below ? r.bottom + 8 : r.top - t.offsetHeight - 8) + scrollY}px`;
    t.classList.toggle('is-above', !below);
    a.setAttribute('aria-describedby', 'fn-tip');
  };
  const hide = (a?: HTMLAnchorElement) => {
    hideTimer = setTimeout(() => {
      t.hidden = true;
      a?.removeAttribute('aria-describedby');
    }, 120);
  };
  refs.forEach((a) => {
    a.addEventListener('mouseenter', () => show(a));
    a.addEventListener('mouseleave', () => hide(a));
    a.addEventListener('focus', () => show(a));
    a.addEventListener('blur', () => hide(a));
    a.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        t.hidden = true;
        a.removeAttribute('aria-describedby');
      }
    });
  });
  t.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  t.addEventListener('mouseleave', () => hide());
}

// ---------------------------------------------------------------- 照片地图：点位 ↔ 列表
export function bindPhotoMap(root: ParentNode): void {
  const svg = root.querySelector<SVGSVGElement>('.pmap__svg');
  if (!svg || svg.dataset.bound) return;
  svg.dataset.bound = '1';
  const select = (i: string, scroll: boolean) => {
    root.querySelectorAll('.pmap__pin.is-on, .pmap__item.is-on').forEach((x) => x.classList.remove('is-on'));
    svg.querySelector(`.pmap__pin[data-pin="${i}"]`)?.classList.add('is-on');
    const item = root.querySelector<HTMLElement>(`#pm-${i}`);
    item?.classList.add('is-on');
    if (scroll && item) {
      item.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
      item.focus({ preventScroll: true });
    }
  };
  svg.addEventListener('click', (ev) => {
    const pin = (ev.target as Element).closest<SVGAElement>('.pmap__pin');
    if (!pin) return;
    ev.preventDefault(); // SVG <a> 的 href 是 SVGAnimatedString：自己处理，不交给站内路由
    select(pin.dataset.pin!, true);
  });
  svg.addEventListener('keydown', (ev) => {
    const pin = (ev.target as Element).closest<SVGAElement>('.pmap__pin');
    if (pin && (ev.key === 'Enter' || ev.key === ' ')) {
      ev.preventDefault();
      select(pin.dataset.pin!, true);
    }
  });
  root.querySelectorAll<HTMLElement>('.pmap__item').forEach((li) => li.addEventListener('mouseenter', () => select(li.id.slice(3), false)));
}
