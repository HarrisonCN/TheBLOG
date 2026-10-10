/**
 * 栏目内翻页（首页「最新文章」第 1 / 2 … 页）：
 * - 不用全屏遮罩；主体布局保持不动，只在这一栏上盖一层 Motionary <usa-spinner kind="ring">；
 * - 只替换列表内容和分页条；列表高度先锁住再替换，不跳动；
 * - 滚动：这一栏的顶部已经滚出视口时才把它滚回来，否则保持原位；
 * - 焦点移到这一栏的标题，读屏会听到「已加载第 n 页」。
 */
export interface PagerParts {
  page: number;
  pages: number;
  title: string;
  sub: string;
  rows: string;
  pager: string;
  docTitle: string;
}
export interface PagerRun {
  section: HTMLElement;
  parts: () => Promise<PagerParts | null>;
  reduced: boolean;
  /** 新内容放进页面后：注册组件、刷新收藏状态等。 */
  after?: (section: HTMLElement) => void;
  alive: () => boolean;
  navOffset?: number;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function pageInPlace(run: PagerRun): Promise<PagerParts | null> {
  const { section } = run;
  const list = section.querySelector<HTMLElement>('.llist');
  if (!list) return null;
  // 1) 锁高度 + 环形加载器（只在这一栏）
  const h = list.offsetHeight;
  list.style.minHeight = `${Math.max(h, parseFloat(list.style.minHeight) || 0)}px`;
  section.classList.add('is-paging');
  list.setAttribute('aria-busy', 'true');
  let busy = section.querySelector<HTMLElement>('.list-busy');
  if (!busy) {
    section.insertAdjacentHTML('beforeend', '<div class="list-busy"><usa-spinner kind="ring" size="36" label="正在加载这一页"></usa-spinner></div>');
    busy = section.querySelector<HTMLElement>('.list-busy')!;
  }
  // 环形加载器放在列表区域的可见部分中间
  const lr = list.getBoundingClientRect();
  const sr = section.getBoundingClientRect();
  const visTop = Math.max(lr.top, run.navOffset ?? 0);
  const visBottom = Math.min(lr.bottom, innerHeight);
  const mid = visBottom > visTop ? (visTop + visBottom) / 2 : lr.top + Math.min(lr.height, 240) / 2;
  busy.style.top = `${lr.top - sr.top}px`;
  busy.style.height = `${lr.height}px`;
  busy.style.setProperty('--ring-y', `${Math.max(24, mid - lr.top)}px`);
  let parts: PagerParts | null = null;
  try {
    [parts] = await Promise.all([run.parts(), wait(run.reduced ? 120 : 380)]);
  } catch {
    parts = null;
  }
  if (!run.alive()) return null;
  if (parts) {
    // 2) 只替换这一栏
    const titleEl = section.querySelector('.sec-head__title > span');
    if (titleEl) titleEl.textContent = parts.title;
    const subEl = section.querySelector('.sec-head__sub');
    if (subEl) subEl.textContent = parts.sub;
    list.innerHTML = parts.rows;
    list.querySelectorAll('.reveal').forEach((el, i) => {
      el.classList.remove('reveal');
      if (!run.reduced) {
        el.classList.add('lrow--in');
        (el as HTMLElement).style.setProperty('--in-d', `${i * 45}ms`);
      }
    });
    const oldPager = section.querySelector('.pager');
    if (parts.pager) {
      if (oldPager) oldPager.outerHTML = parts.pager;
      else list.insertAdjacentHTML('afterend', parts.pager);
    } else oldPager?.remove();
    // 新的一页更高时放开下限；更矮时保持锁定的高度，避免页面跳动
    list.style.minHeight = `${Math.max(list.scrollHeight, parseFloat(list.style.minHeight) || 0)}px`;
    run.after?.(section);
  }
  section.classList.remove('is-paging');
  list.removeAttribute('aria-busy');
  busy.remove();
  // 3) 滚动：栏目顶部已经在视口上方时才滚回来
  const top = section.getBoundingClientRect().top;
  const off = (run.navOffset ?? 64) + 12;
  if (top < off) scrollBy({ top: top - off, behavior: run.reduced ? 'auto' : 'smooth' });
  // 4) 焦点 + 读屏提示
  const head = section.querySelector<HTMLElement>('.sec-head__title');
  if (head && parts) {
    head.tabIndex = -1;
    head.focus({ preventScroll: true });
  }
  let live = section.querySelector<HTMLElement>('.list-live');
  if (!live) {
    section.insertAdjacentHTML('beforeend', '<p class="list-live visually-hidden" role="status" aria-live="polite"></p>');
    live = section.querySelector<HTMLElement>('.list-live')!;
  }
  live.textContent = parts ? `已加载第 ${parts.page} 页，共 ${parts.pages} 页` : '这一页加载失败';
  return parts;
}
