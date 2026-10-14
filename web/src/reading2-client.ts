/**
 * L27 阅读与书影音 2.0 浏览器端（按需加载）：
 * - 文章页「稍后读」开关（localStorage blog-later，只在这台设备上）；
 * - /reading-list/ 列表：合并本机阅读进度、移除、复制 / 下载 Markdown；
 * - /quotes/ 按来源筛选。
 */
import { escapeHtml as e } from './markdown';
import { addLater, hasLater, LATER_KEY, laterMarkdown, laterRows, parseLater, removeLater, type LaterItem } from './reading-core';
import { loadHistory } from './reading';

export interface Reading2Ctx {
  basePath: string;
  notify: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => unknown;
}

const load = (): LaterItem[] => {
  try {
    return parseLater(localStorage.getItem(LATER_KEY));
  } catch {
    return [];
  }
};
const save = (l: LaterItem[]) => {
  try {
    localStorage.setItem(LATER_KEY, JSON.stringify(l));
  } catch {
    /* 隐私模式等：静默 */
  }
};

function bindToggle(root: ParentNode, ctx: Reading2Ctx): void {
  const btn = root.querySelector<HTMLButtonElement>('.js-later-toggle');
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = '1';
  const m = /\/posts\/([a-z0-9-]+)\/?$/.exec(location.pathname);
  if (!m) {
    btn.hidden = true;
    return;
  }
  const slug = m[1]!;
  const title = (document.querySelector('.post-head h1, article h1, h1')?.textContent ?? slug).trim();
  const label = btn.querySelector<HTMLElement>('.js-later-label');
  const paint = () => {
    const on = hasLater(load(), slug);
    btn.setAttribute('aria-pressed', String(on));
    if (label) label.textContent = on ? '已加入稍后读' : '稍后读';
  };
  btn.addEventListener('click', () => {
    const l = load();
    const on = hasLater(l, slug);
    save(on ? removeLater(l, slug) : addLater(l, { slug, title }, Date.now()));
    paint();
    ctx.notify(on ? '已从稍后读移除' : '已加入稍后读（只保存在这台设备上）', 'success');
  });
  paint();
}

function bindList(root: ParentNode, ctx: Reading2Ctx): void {
  const list = root.querySelector<HTMLElement>('[data-later-list]');
  if (!list || list.dataset.bound) return;
  list.dataset.bound = '1';
  const count = root.querySelector<HTMLElement>('.js-later-count')!;
  const empty = root.querySelector<HTMLElement>('.js-later-empty')!;
  const exports = [...root.querySelectorAll<HTMLButtonElement>('.js-later-export')];
  const base = ctx.basePath;
  const rows = () => laterRows(load(), loadHistory());
  const paint = () => {
    const r = rows();
    const unread = r.filter((x) => !x.done).length;
    count.textContent = r.length ? `${r.length} 篇 · 还没读完 ${unread} 篇` : '0 篇';
    empty.hidden = r.length > 0;
    for (const b of exports) b.disabled = !r.length;
    list.innerHTML = r
      .map(
        (x) =>
          `<li class="later-row${x.done ? ' is-done' : ''}" data-slug="${e(x.slug)}"><a class="later-row__a" href="${e(base)}/posts/${e(x.slug)}/"><b>${e(x.title)}</b><span class="later-row__p" role="img" aria-label="${x.done ? '已读完' : `读到 ${Math.round(x.pct * 100)}%`}"><i style="--p:${x.pct}"></i></span><small class="muted">${x.done ? '已读完' : x.pct > 0 ? `读到 ${Math.round(x.pct * 100)}%` : '还没开始'}</small></a><button class="icon-btn js-later-remove" type="button" aria-label="从稍后读移除《${e(x.title)}》">×</button></li>`,
      )
      .join('');
  };
  list.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>('.js-later-remove');
    if (!b) return;
    const slug = b.closest<HTMLElement>('[data-slug]')?.dataset.slug ?? '';
    save(removeLater(load(), slug));
    paint();
    ctx.notify('已移除', 'success');
  });
  for (const b of exports)
    b.addEventListener('click', async () => {
      const md = laterMarkdown(rows(), location.origin + base, new Date().toISOString().slice(0, 10));
      if (b.dataset.mode === 'download') {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
        a.download = 'reading-list.md';
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        ctx.notify('已下载 reading-list.md', 'success');
      } else {
        try {
          await navigator.clipboard.writeText(md);
          ctx.notify('已复制 Markdown', 'success');
        } catch {
          ctx.notify('浏览器不允许复制，请改用下载', 'warning');
        }
        list.dataset.lastExport = md;
      }
    });
  paint();
}

function bindQuotes(root: ParentNode): void {
  const seg = root.querySelector<HTMLElement>('.js-quotes-filter');
  if (!seg || seg.dataset.bound) return;
  seg.dataset.bound = '1';
  const cards = [...root.querySelectorAll<HTMLElement>('.js-quotes .qcard')];
  const count = root.querySelector<HTMLElement>('.js-quotes-count');
  const empty = root.querySelector<HTMLElement>('.js-quotes-empty');
  seg.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('.seg__b');
    if (!b) return;
    for (const x of seg.querySelectorAll<HTMLButtonElement>('.seg__b')) {
      x.classList.toggle('is-on', x === b);
      x.setAttribute('aria-pressed', String(x === b));
    }
    const v = b.dataset.v ?? '';
    let n = 0;
    for (const c of cards) {
      const show = !v || c.dataset.from === v;
      c.hidden = !show;
      if (show) n++;
    }
    if (count) count.textContent = `共 ${n} 段`;
    if (empty) empty.hidden = n > 0;
  });
}

export function bindReading2(root: ParentNode, ctx: Reading2Ctx): void {
  bindToggle(root, ctx);
  bindList(root, ctx);
  bindQuotes(root);
}
