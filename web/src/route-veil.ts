/**
 * 进入二级界面的转场「白色遮罩」：
 *   点击处（或被点的卡片）→ 白色遮罩放大到全屏 → 显示 Motionary <usa-spinner kind="bars"> → 新界面在遮罩下面画好
 *   → 遮罩向中心缩起，无缝露出新界面。深色模式用主题的卡片底色（浅色模式就是白色）。
 * - prefers-reduced-motion / 动效「关」：遮罩只做一次很快的淡入淡出。
 * - 永远不会卡住：加载有超时（交给调用方渲染错误页），遮罩本身还有一个硬性兜底定时器。
 * Motionary 的 pageTransition() 只有 View Transitions 的 fade / circle / zoom 等效果，没有「遮罩 + 加载器」的两段式转场，
 * 所以这里在本地实现（上游候选：<usa-route-veil> / pageTransition({ effect: 'veil', loader })）。
 */
export interface VeilOrigin {
  x: number;
  y: number;
  rect?: { top: number; left: number; width: number; height: number; radius: number } | null;
}

import { defineUsed } from './usa';

let lastOrigin: VeilOrigin | null = null;
let lastAt = 0;
/** 记录这次点击的位置；点的是文章卡片时记录卡片矩形，遮罩从卡片展开。 */
export function rememberOrigin(ev: MouseEvent, target: Element | null): void {
  const card = target?.closest('.post-card, .fcard, .lrow, .tile, .work, .post-tile, .side-card li, .slide') as HTMLElement | null;
  let rect: VeilOrigin['rect'] = null;
  if (card) {
    const r = card.getBoundingClientRect();
    if (r.width > 40 && r.height > 30 && r.width < innerWidth * 0.98) rect = { top: r.top, left: r.left, width: r.width, height: r.height, radius: parseFloat(getComputedStyle(card).borderTopLeftRadius) || 12 };
  }
  lastOrigin = { x: ev.clientX || innerWidth / 2, y: ev.clientY || innerHeight / 2, rect };
  lastAt = performance.now();
}
function takeOrigin(): VeilOrigin {
  const o = lastOrigin && performance.now() - lastAt < 1500 ? lastOrigin : { x: innerWidth / 2, y: innerHeight / 2, rect: null };
  lastOrigin = null;
  return o;
}

const EASE_IN = 'cubic-bezier(0.7, 0, 0.3, 1)';
const EASE_OUT = 'cubic-bezier(0.25, 1, 0.5, 1)';
/** element.animate 不存在（旧浏览器 / 测试环境）时直接视为完成。 */
function anim(el: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): Promise<unknown> {
  if (typeof (el as HTMLElement).animate !== 'function') return Promise.resolve();
  try {
    return el.animate(frames, opts).finished.catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}
const raf = () => new Promise<void>((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 16)));
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let veil: HTMLElement | null = null;
let busy = 0;
let guard: ReturnType<typeof setTimeout> | undefined;

function ensureVeil(): HTMLElement {
  if (veil?.isConnected) return veil;
  veil = document.createElement('div');
  veil.className = 'route-veil';
  veil.innerHTML = `<div class="route-veil__loader"><usa-spinner kind="bars" size="40" label="正在打开页面"></usa-spinner></div>`;
  document.body.append(veil);
  void defineUsed(veil);
  return veil;
}
function removeVeil(): void {
  clearTimeout(guard);
  veil?.remove();
  veil = null;
  document.documentElement.removeAttribute('data-veil');
}

export interface VeilRun<T> {
  reduced: boolean;
  /** 加载下一个界面的数据。 */
  load: () => Promise<T>;
  /** 在遮罩下替换界面（同步或异步）。 */
  swap: (value: T) => unknown;
  /** 遮罩收起前再等一下（例如新界面里的自定义元素升级），有上限。 */
  settle?: () => Promise<unknown>;
  /** 加载超时（毫秒），超时后 load 的结果视为失败，交给 onTimeout 渲染错误页。 */
  timeoutMs?: number;
  onError: (err: unknown) => T;
  /** 新的导航开始后旧的这次作废（返回 false 时不替换界面，也不收遮罩）。 */
  alive: () => boolean;
}

function circleAt(x: number, y: number, r: number): string {
  return `circle(${r}px at ${x}px ${y}px)`;
}
function insetFrom(rect: NonNullable<VeilOrigin['rect']>): string {
  const b = innerHeight - rect.top - rect.height;
  const rr = innerWidth - rect.left - rect.width;
  return `inset(${rect.top}px ${rr}px ${b}px ${rect.left}px round ${rect.radius}px)`;
}

/** 跑一次完整的遮罩转场。返回时遮罩已经收起（或者被更新的导航接管）。 */
export async function veilNavigate<T>(run: VeilRun<T>): Promise<void> {
  const myBusy = ++busy;
  const v = ensureVeil();
  const de = document.documentElement;
  const already = de.getAttribute('data-veil') === 'open';
  de.setAttribute('data-veil', 'open');
  const timeoutMs = run.timeoutMs ?? 8000;
  clearTimeout(guard);
  guard = setTimeout(removeVeil, timeoutMs + 4000); // 硬性兜底：无论发生什么，遮罩都会消失
  const origin = takeOrigin();
  const R = Math.hypot(Math.max(origin.x, innerWidth - origin.x), Math.max(origin.y, innerHeight - origin.y)) + 2;

  // 1) 遮罩展开（和数据加载并行）
  let expand: Promise<unknown> = Promise.resolve();
  if (!already) {
    if (run.reduced) {
      expand = anim(v, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear', fill: 'forwards' });
    } else {
      const from = origin.rect ? insetFrom(origin.rect) : circleAt(origin.x, origin.y, 0);
      const to = origin.rect ? 'inset(0px 0px 0px 0px round 0px)' : circleAt(origin.x, origin.y, R);
      expand = anim(v, [{ clipPath: from, opacity: origin.rect ? 0.6 : 1 }, { clipPath: to, opacity: 1 }], { duration: 440, easing: EASE_IN, fill: 'forwards' });
    }
  }
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('页面加载超时，请稍后再试')), timeoutMs));
  const loading = Promise.race([run.load(), timeout]).catch((e) => run.onError(e));
  await expand;
  // 2) 加载器：展开完成后出现；至少显示一小会儿，避免一闪而过
  v.classList.add('is-loading');
  const minShow = run.reduced ? 0 : 320;
  const [value] = await Promise.all([loading, wait(minShow)]);
  if (!run.alive() || myBusy !== busy) return; // 被新的导航接管：遮罩留给它
  // 3) 遮罩下替换界面，等新界面稳定
  try {
    await run.swap(value);
  } catch (e) {
    console.warn('[veil] swap failed', e);
  }
  await Promise.race([run.settle?.() ?? Promise.resolve(), wait(500)]);
  await raf();
  await raf();
  if (!run.alive() || myBusy !== busy) return;
  // 4) 收起遮罩
  v.classList.remove('is-loading');
  try {
    if (run.reduced) await anim(v, [{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'linear', fill: 'forwards' });
    else {
      const cx = innerWidth / 2;
      const cy = Math.min(innerHeight / 2, 360);
      const R2 = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy)) + 2;
      await anim(v, [{ clipPath: circleAt(cx, cy, R2), opacity: 1 }, { clipPath: circleAt(cx, cy, 0), opacity: 0.85 }], { duration: 420, easing: EASE_OUT, fill: 'forwards' });
    }
  } catch {
    /* 动画被取消也要收起 */
  }
  if (myBusy === busy) removeVeil();
}

/** 测试 / 调试用：遮罩当前是否在页面上。 */
export const veilActive = () => !!veil?.isConnected;
