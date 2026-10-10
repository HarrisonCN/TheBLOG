/**
 * 会动的描边图标：
 * - 出现时描入：一个共享的 IntersectionObserver，图标进入视口时加 .si-in，CSS 用 stroke-dashoffset 描线（pathLength="1"）。
 * - 悬停 / 键盘聚焦时动一下：动作表与 Motionary <usa-anim-icon> 同源 —— 有对应图标的（search / heart / star / gear / arrow /
 *   check / bell / download）直接用 Motionary 的 ANIM_ICONS 关键帧；品牌 / 栏目图标用本地补充的同格式关键帧。
 * - prefers-reduced-motion 或站点动效设为「关」：什么都不做，图标保持静态（完整显示）。
 * Motionary 的 <usa-anim-icon> 只有 8 个单路径图标、没有「出现时描入」，所以这里没有直接用这个元素（见 PR 说明的上游候选）。
 */
import { ANIM_ICONS } from 'motionary/components/svg';

type Frames = Keyframe[];
interface Motion {
  frames: Frames;
  duration: number;
  origin?: string;
  /** 'draw'：对每条描边重描（check / 打勾类） */
  target?: 'svg' | 'draw';
}

const M = (k: keyof typeof ANIM_ICONS): Motion => {
  const i = ANIM_ICONS[k]!;
  return { frames: i.frames, duration: i.duration, origin: i.origin, target: i.frames[0] && 'strokeDashoffset' in i.frames[0] ? 'draw' : 'svg' };
};
const wiggle: Motion = { frames: [{ rotate: '0deg' }, { rotate: '-12deg' }, { rotate: '10deg' }, { rotate: '-6deg' }, { rotate: '0deg' }], duration: 600 };
const pop: Motion = { frames: [{ scale: 1 }, { scale: 1.18 }, { scale: 0.95 }, { scale: 1 }], duration: 450 };
const nudgeUp: Motion = { frames: [{ translate: '0 0' }, { translate: '0 -3px' }, { translate: '0 0' }], duration: 500 };
const nudgeRight: Motion = M('arrow');
const flicker: Motion = { frames: [{ scale: '1 1', rotate: '0deg' }, { scale: '0.94 1.1', rotate: '-4deg' }, { scale: '1.04 0.95', rotate: '3deg' }, { scale: '0.97 1.06', rotate: '-2deg' }, { scale: '1 1', rotate: '0deg' }], duration: 700, origin: '50% 100%' };
const fly: Motion = { frames: [{ translate: '0 0' }, { translate: '3px -3px' }, { translate: '0 0' }], duration: 520 };
const spin: Motion = { frames: [{ rotate: '0deg' }, { rotate: '360deg' }], duration: 700 };
const swing: Motion = { frames: [{ rotate: '0deg' }, { rotate: '14deg' }, { rotate: '-10deg' }, { rotate: '5deg' }, { rotate: '0deg' }], duration: 700, origin: '30% 20%' };
const redraw: Motion = { frames: [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], duration: 560, target: 'draw' };

const TABLE: Record<string, Motion> = {
  // 与 Motionary ANIM_ICONS 同源
  search: M('search'), zoom: M('search'), heart: M('heart'), star: M('star'), settings: M('gear'), arrowRight: M('arrow'), check: M('check'),
  megaphone: M('bell'), arrowDown: M('download'), upload: { ...M('download'), frames: [{ translate: '0 0' }, { translate: '0 -3px' }, { translate: '0 0' }] },
  // 本地补充（同一格式）
  github: wiggle, wechat: pop, weibo: wiggle, xiaohongshu: pop, tv: wiggle, camera: pop, play: pop, xLogo: spin, rss: redraw, mail: fly, send: fly, link: wiggle, external: fly,
  flame: flicker, sparkles: { frames: [{ scale: 1, rotate: '0deg' }, { scale: 1.2, rotate: '20deg' }, { scale: 1, rotate: '0deg' }], duration: 600 },
  clock: redraw, history: { frames: [{ rotate: '0deg' }, { rotate: '-360deg' }], duration: 800 }, refresh: spin, sun: { frames: [{ rotate: '0deg' }, { rotate: '90deg' }], duration: 700 },
  moon: swing, tag: swing, pin: nudgeUp, mapPin: nudgeUp, bookmark: nudgeUp, arrowUp: nudgeUp, chevronRight: nudgeRight, chevronLeft: { ...nudgeRight, frames: [{ translate: '0 0' }, { translate: '-4px 0' }, { translate: '0 0' }] },
  arrowLeft: { ...nudgeRight, frames: [{ translate: '0 0' }, { translate: '-5px 0' }, { translate: '0 0' }] }, verified: redraw, copy: pop, edit: wiggle, plus: spin, home: nudgeUp, file: nudgeUp,
  folder: pop, book: pop, archive: nudgeUp, users: pop, user: pop, message: pop, chart: redraw, list: redraw, globe: spin, aperture: spin, code: wiggle, fork: redraw, lock: wiggle, eye: pop,
  calendar: pop, image: pop, box: pop, library: pop, briefcase: pop, music: wiggle, gamepad: wiggle, logout: nudgeRight, trash: wiggle, dashboard: pop, shuffle: redraw,
};
const DEFAULT: Motion = pop;

let installed = false;
let io: IntersectionObserver | null = null;
const running = new WeakMap<Element, Animation[]>();

function allowed(): boolean {
  const de = document.documentElement;
  return !matchMedia('(prefers-reduced-motion: reduce)').matches && de.dataset.motion !== 'off' && !de.hasAttribute('data-paused');
}

/** 悬停 / 聚焦：播放图标自己的动作（正在播的不打断）。 */
export function playIcon(svg: SVGElement): void {
  if (!allowed() || running.get(svg)?.some((a) => a.playState === 'running')) return;
  const m = TABLE[svg.dataset.i ?? ''] ?? DEFAULT;
  const anims: Animation[] = [];
  if (m.target === 'draw') {
    svg.querySelectorAll<SVGElement>('[pathLength]').forEach((el, i) => anims.push(el.animate(m.frames, { duration: m.duration, delay: i * 60, easing: 'ease-in-out' })));
  } else {
    svg.style.transformOrigin = m.origin ?? '50% 50%';
    svg.style.transformBox = 'fill-box';
    anims.push(svg.animate(m.frames, { duration: m.duration, easing: 'ease-in-out' }));
  }
  running.set(svg, anims);
}

const HOSTS = 'a, button, summary, label, [role="button"], [role="menuitem"], [data-si-host], .sec-head, .kicker, .chip, .pill, .cchip';

function observe(root: ParentNode): void {
  if (!io) return;
  root.querySelectorAll<SVGElement>('svg.si:not(.si-in)').forEach((el) => io!.observe(el));
}

/** 安装一次：描入观察器 + 新节点监听 + 悬停 / 聚焦委托。 */
export function installIconMotion(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const de = document.documentElement;
  if (!('IntersectionObserver' in window) || !allowed()) return; // 静态图标：不加 si-on，CSS 不会隐藏描边
  de.classList.add('si-on');
  io = new IntersectionObserver(
    (entries) => {
      let n = 0;
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target as SVGElement;
        el.style.setProperty('--si-d', `${Math.min(n++, 8) * 45}ms`);
        el.classList.add('si-in');
        io!.unobserve(el);
      }
    },
    { rootMargin: '0px 0px -4% 0px' },
  );
  observe(document);
  new MutationObserver((recs) => {
    for (const r of recs)
      r.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        const el = n as Element;
        if (el.matches?.('svg.si:not(.si-in)')) io!.observe(el);
        else if (el.firstElementChild) observe(el);
      });
  }).observe(document.body, { childList: true, subtree: true });
  const onEnter = (ev: Event) => {
    const t = ev.target as Element | null;
    const host = t?.closest?.(HOSTS);
    if (!host) return;
    const rel = (ev as PointerEvent).relatedTarget as Node | null;
    if (ev.type === 'pointerover' && rel && host.contains(rel)) return; // 只在「进入」时播放
    host.querySelectorAll<SVGElement>('svg.si').forEach((s, i) => i < 3 && playIcon(s));
  };
  document.addEventListener('pointerover', onEnter, { passive: true });
  document.addEventListener('focusin', onEnter);
  // 动效设置切换为「关」或系统开启减少动态效果：立刻全部显示为静态
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  const sync = () => de.classList.toggle('si-on', !!io && allowed());
  mq.addEventListener?.('change', sync);
  new MutationObserver(sync).observe(de, { attributes: true, attributeFilter: ['data-motion', 'data-paused'] });
}
