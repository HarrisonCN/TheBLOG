/**
 * 影集「故事模式」（点击后才加载）：一屏一张，左右滑 / 点两侧 / ←→ 键切换，Esc 关闭。
 * 从不自动翻页（没有计时器）；减少动态效果时不做滑动过渡。照片数据直接从影集的 DOM 里读。
 */
import { icon } from './icons';

export interface StoryPhoto {
  src: string;
  srcset: string;
  alt: string;
  caption: string;
  exif: string;
  credit: string;
}

export function readEssay(sec: HTMLElement): StoryPhoto[] {
  return [...sec.querySelectorAll<HTMLElement>('.essay__item')].map((li, i) => {
    const im = li.querySelector<HTMLImageElement>('img');
    return {
      src: im?.getAttribute('src') ?? '',
      srcset: im?.getAttribute('srcset') ?? '',
      alt: im?.alt ?? '',
      caption: li.querySelector('.essay__caption')?.textContent?.trim() || im?.alt || `第 ${i + 1} 张`,
      exif: li.querySelector('.exif-strip__v')?.textContent?.trim() ?? '',
      credit: li.querySelector('.essay__credit')?.textContent?.trim() ?? '',
    };
  });
}

/** 水平滑动距离 → 方向（阈值 40px，且水平位移要大于竖直位移）。 */
export function swipeDir(dx: number, dy: number, threshold = 40): -1 | 0 | 1 {
  if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.2) return 0;
  return dx < 0 ? 1 : -1;
}

export function openStory(sec: HTMLElement, start: number, o: { opener?: HTMLElement | null; reducedMotion?: boolean } = {}): HTMLDialogElement | null {
  const photos = readEssay(sec);
  if (!photos.length) return null;
  const title = document.querySelector('.post-top__title')?.textContent?.trim() ?? '影集';
  const d = document.createElement('dialog');
  d.className = `story${o.reducedMotion ? ' story--still' : ''}`;
  d.setAttribute('aria-label', `故事模式：${title}`);
  d.innerHTML = `<div class="story__bars" aria-hidden="true">${photos.map(() => '<i class="story__bar"></i>').join('')}</div>
<div class="story__top"><span class="story__title">${esc(title)}</span><span class="story__pos js-story-pos" aria-live="polite"></span><button type="button" class="story__close js-story-close" aria-label="关闭故事模式（Esc）">${icon('close')}</button></div>
<div class="story__stage js-story-stage"><img class="story__img js-story-img" alt="" draggable="false"></div>
<button type="button" class="story__nav story__nav--prev js-story-prev" aria-label="上一张（←）">${icon('chevronLeft')}</button>
<button type="button" class="story__nav story__nav--next js-story-next" aria-label="下一张（→）">${icon('chevronRight')}</button>
<div class="story__foot"><p class="story__cap js-story-cap"></p><p class="story__exif js-story-exif"></p><p class="story__credit js-story-credit"></p><p class="story__hint">左右滑动或按 ← → 切换 · Esc 关闭 · 不会自动翻页</p></div>`;
  const $ = <T extends HTMLElement>(s: string) => d.querySelector<T>(s)!;
  const img = $<HTMLImageElement>('.js-story-img');
  const bars = [...d.querySelectorAll<HTMLElement>('.story__bar')];
  let i = Math.min(Math.max(0, start), photos.length - 1);
  const show = (n: number, dir = 0) => {
    i = (n + photos.length) % photos.length;
    const p = photos[i]!;
    if (p.srcset) img.setAttribute('srcset', p.srcset);
    else img.removeAttribute('srcset');
    img.sizes = '100vw';
    img.src = p.src;
    img.alt = p.alt || p.caption;
    $('.js-story-cap').textContent = p.caption;
    $('.js-story-exif').textContent = p.exif;
    $('.js-story-credit').textContent = p.credit;
    $('.js-story-pos').textContent = `${i + 1} / ${photos.length}`;
    bars.forEach((b, k) => b.classList.toggle('is-done', k <= i));
    if (dir && !o.reducedMotion) {
      img.classList.remove('is-in-l', 'is-in-r');
      void img.offsetWidth;
      img.classList.add(dir > 0 ? 'is-in-r' : 'is-in-l');
    }
    // 预取下一张
    const nx = photos[(i + 1) % photos.length];
    if (nx && nx.src !== p.src) {
      const pre = new Image();
      pre.src = nx.src;
    }
  };
  const next = () => show(i + 1, 1);
  const prev = () => show(i - 1, -1);
  $('.js-story-next').addEventListener('click', next);
  $('.js-story-prev').addEventListener('click', prev);
  $('.js-story-close').addEventListener('click', () => d.close());
  d.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowRight') {
      ev.preventDefault();
      next();
    } else if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      prev();
    } else if (ev.key === 'Home') show(0);
    else if (ev.key === 'End') show(photos.length - 1);
  });
  let sx = 0;
  let sy = 0;
  let tracking = false;
  const stage = $('.js-story-stage');
  stage.addEventListener('pointerdown', (ev) => {
    tracking = true;
    sx = ev.clientX;
    sy = ev.clientY;
  });
  stage.addEventListener('pointerup', (ev) => {
    if (!tracking) return;
    tracking = false;
    const dir = swipeDir(ev.clientX - sx, ev.clientY - sy);
    if (dir > 0) next();
    else if (dir < 0) prev();
  });
  stage.addEventListener('pointercancel', () => (tracking = false));
  d.addEventListener('close', () => {
    d.remove();
    document.documentElement.classList.remove('story-open');
    o.opener?.focus();
  });
  document.body.append(d);
  document.documentElement.classList.add('story-open');
  show(i);
  d.showModal();
  $('.js-story-next').focus();
  return d;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
