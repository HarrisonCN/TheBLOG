/**
 * L35 / v1.35.0 沉浸式展厅的 3D 增强（按需加载；页面本身是完整可读的平面列表）：
 * - 视图模式：默认跟随系统（减少动态效果 / 不支持 CSS 3D → 平面）；「立体视图」开关（aria-pressed）记在 localStorage；
 * - 立体视图：CSS 3D 房间（四面墙），展品是按钮（roving tabindex，同一时间只有当前展品可 Tab 到），
 *   方向键 / Home / End / PageUp / PageDown 导览，房间转向当前墙面（最近角度），aria-live 播报「第几件 · 墙面 · 标题」；
 *   Enter / 点按当前展品 = 近看（aria-expanded + 说明），Esc 退出；上一件 / 下一件按钮；
 * - 手动选择立体视图但系统要求减少动态效果：打开但不做过渡动画（no-motion）；
 * - 不使用任何计时器：没有自动播放、没有自动旋转。
 */
import { WALLS, WALL_LABEL, announce, decideMode, keyAction, stepTour, tourOrder, turnTo, type Exhibit, type HallPref, type Wall } from './gallery-core';

export const HALL_PREF_KEY = 'blog:hall-view';

export interface HallEnv {
  reducedMotion?: boolean;
  supports3d?: boolean;
}

function readPref(): HallPref {
  try {
    const v = localStorage.getItem(HALL_PREF_KEY);
    return v === '3d' || v === 'flat' ? v : 'auto';
  } catch {
    return 'auto';
  }
}
function writePref(v: HallPref): void {
  try {
    localStorage.setItem(HALL_PREF_KEY, v);
  } catch {
    /* 隐私模式：不记 */
  }
}
function detect(): Required<HallEnv> {
  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const supports3d = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('transform-style', 'preserve-3d');
  return { reducedMotion, supports3d };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** 从平面列表读回展品（不需要再请求接口） */
function readExhibits(flat: HTMLElement): Exhibit[] {
  const items = [...flat.querySelectorAll<HTMLElement>('[data-hall-item]')].sort((a, b) => Number(a.dataset.hallItem) - Number(b.dataset.hallItem));
  return items.map((li) => {
    const im = li.querySelector('img')!;
    return {
      id: li.id.replace(/^ex-/, ''),
      title: li.querySelector('.hall-ex__title')?.textContent ?? '',
      wall: (li.dataset.wall as Wall) ?? 'north',
      image: { src: im.getAttribute('src') ?? '', alt: im.getAttribute('alt') ?? '', w: Number(im.getAttribute('width')) || 0, h: Number(im.getAttribute('height')) || 0 },
      caption: li.querySelector('.hall-ex__text')?.textContent ?? undefined,
      credit: li.querySelector('.hall-ex__credit')?.textContent ?? undefined,
    };
  });
}

export function bindHall(root: ParentNode, envOverride: HallEnv = {}): void {
  const box = root.querySelector<HTMLElement>('[data-hall]');
  if (!box || box.dataset.bound) return;
  box.dataset.bound = '1';
  const stage = box.querySelector<HTMLElement>('[data-hall-stage]');
  const flat = box.querySelector<HTMLElement>('.hall-flat');
  const toggle = box.querySelector<HTMLButtonElement>('[data-hall-toggle]');
  if (!stage || !flat || !toggle) return;
  const env = { ...detect(), ...envOverride };
  const exhibits = readExhibits(flat);
  const order = tourOrder(exhibits);
  if (!order.length) return;

  let built = false;
  let pos = 0;
  let angle = 0;
  let near = false;
  let buttons: HTMLButtonElement[] = [];
  let room: HTMLElement | null = null;
  let status: HTMLElement | null = null;
  let caption: HTMLElement | null = null;

  const build = () => {
    if (built) return;
    built = true;
    const walls = WALLS.map((w) => {
      const idx = order.filter((i) => exhibits[i]!.wall === w);
      const inner = idx
        .map((i) => {
          const x = exhibits[i]!;
          return `<button type="button" class="hall3d__ex" data-hall-ex="${i}" tabindex="-1" aria-expanded="false"><img src="${esc(x.image.src)}" alt="${esc(x.image.alt)}" width="${x.image.w}" height="${x.image.h}" loading="lazy" decoding="async"><span class="hall3d__label">${esc(x.title)}</span></button>`;
        })
        .join('');
      return `<div class="hall3d__wall hall3d__wall--${w}" data-wall="${w}" role="group" aria-label="${WALL_LABEL[w]}${idx.length ? '' : '（空）'}">${inner}</div>`;
    }).join('');
    stage.innerHTML = `<div class="hall3d__viewport"><div class="hall3d__room" data-hall-room>${walls}<div class="hall3d__floor" aria-hidden="true"></div></div></div>
<div class="hall3d__controls"><button type="button" class="btn btn--sm" data-hall-prev>上一件</button><p class="hall3d__status small" aria-live="polite" aria-atomic="true"></p><button type="button" class="btn btn--sm" data-hall-next>下一件</button></div>
<div class="hall3d__caption" data-hall-caption hidden></div>`;
    room = stage.querySelector<HTMLElement>('[data-hall-room]');
    status = stage.querySelector<HTMLElement>('.hall3d__status');
    caption = stage.querySelector<HTMLElement>('[data-hall-caption]');
    buttons = [...stage.querySelectorAll<HTMLButtonElement>('[data-hall-ex]')];
    stage.addEventListener('keydown', onKey);
    stage.addEventListener('click', onClick);
    paint(false);
  };

  const btnFor = (p: number) => buttons.find((b) => Number(b.dataset.hallEx) === order[p]);

  const setNear = (v: boolean) => {
    near = v;
    stage.classList.toggle('is-near', v);
    for (const b of buttons) b.setAttribute('aria-expanded', String(v && b === btnFor(pos)));
    if (!caption) return;
    const x = exhibits[order[pos]!]!;
    caption.hidden = !v;
    caption.innerHTML = v ? `<p class="hall3d__cap-title">${esc(x.title)}</p>${x.caption ? `<p>${esc(x.caption)}</p>` : ''}${x.credit ? `<p class="small muted">${esc(x.credit)}</p>` : ''}<p class="small muted"><a href="#ex-${esc(x.id)}" data-hall-flatlink>在平面列表里查看</a></p>` : '';
  };

  const paint = (focus: boolean) => {
    const cur = btnFor(pos);
    for (const b of buttons) {
      const on = b === cur;
      b.tabIndex = on ? 0 : -1;
      if (on) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    }
    const x = exhibits[order[pos]!]!;
    angle = turnTo(angle, x.wall);
    room?.style.setProperty('--hall-ry', `${angle}deg`);
    if (status) status.textContent = announce(exhibits, order, pos);
    if (focus && cur) cur.focus({ preventScroll: true });
  };

  const go = (p: number, focus = true) => {
    if (p !== pos && near) setNear(false);
    pos = p;
    paint(focus);
  };

  function onKey(ev: KeyboardEvent) {
    const a = keyAction(ev.key);
    if (!a) return;
    const onExhibit = ev.target instanceof HTMLElement && ev.target.matches('[data-hall-ex]');
    if (a === 'close') {
      if (near) {
        ev.preventDefault();
        setNear(false);
        btnFor(pos)?.focus({ preventScroll: true });
      }
      return;
    }
    if (!onExhibit) return; // 工具栏按钮保留原生 Enter / 空格
    ev.preventDefault();
    if (a === 'open') {
      setNear(!near);
      return;
    }
    go(stepTour(pos, order, a, exhibits));
  }

  function onClick(ev: MouseEvent) {
    const t = ev.target instanceof Element ? ev.target : null;
    if (!t) return;
    if (t.closest('[data-hall-next]')) return go(stepTour(pos, order, 'next', exhibits), false);
    if (t.closest('[data-hall-prev]')) return go(stepTour(pos, order, 'prev', exhibits), false);
    if (t.closest('[data-hall-flatlink]')) {
      // 回到平面列表看这一件
      apply('flat');
      writePref('flat');
      return;
    }
    const b = t.closest<HTMLButtonElement>('[data-hall-ex]');
    if (!b) return;
    const p = order.indexOf(Number(b.dataset.hallEx));
    if (p < 0) return;
    if (p === pos) setNear(!near);
    else go(p);
  }

  const apply = (mode: '3d' | 'flat') => {
    if (mode === '3d') build();
    stage.hidden = mode !== '3d';
    flat.hidden = mode === '3d';
    stage.classList.toggle('no-motion', env.reducedMotion);
    toggle.setAttribute('aria-pressed', String(mode === '3d'));
    if (mode === 'flat' && near) setNear(false);
  };

  toggle.hidden = !env.supports3d;
  toggle.addEventListener('click', () => {
    const next = toggle.getAttribute('aria-pressed') === 'true' ? 'flat' : '3d';
    writePref(next);
    apply(next);
    if (next === '3d') btnFor(pos)?.focus({ preventScroll: true });
  });
  apply(decideMode({ reducedMotion: env.reducedMotion, supports3d: env.supports3d, pref: readPref() }));
}
