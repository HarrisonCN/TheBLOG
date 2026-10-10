/**
 * ⌘K / Ctrl K 命令面板：一处搜索文章、页面、分类、标签，并执行常用操作。
 * - 模糊匹配（palette-core.ts），↑↓ 选择、Enter 打开、Esc 关闭、Tab 不会跑出对话框；
 * - 空输入时显示「最近」+ 常用页面与操作；没有结果时可以去全文搜索页；
 * - 读屏：input[role=combobox] + listbox / option + aria-activedescendant。
 */
import { icon } from './icons';
import { group, markHits, pushRecent, rank, RECENT_KEY, type Match, type PaletteItem } from './palette-core';
import type { SearchDoc, SiteData } from './types';

export interface PaletteCtx {
  site: () => SiteData;
  searchIndex: () => Promise<SearchDoc[]>;
  go: (href: string) => void;
  url: (path: string) => string;
  postPath: (slug: string) => string;
  tagPath: (t: string) => string;
  categoryPath: (c: string) => string;
  nav: { label: string; icon: string; href?: string; children?: { label: string; icon: string; href?: string }[] }[];
  run: (action: string) => void;
  isPost: () => boolean;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function isApple(): boolean {
  const p = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || navigator.userAgent;
  return /mac|iphone|ipad|ipod/i.test(p);
}
export const shortcutLabel = () => (isApple() ? '⌘K' : 'Ctrl K');

function loadRecent(): PaletteItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') as PaletteItem[];
    return Array.isArray(v) ? v.filter((x) => x && typeof x.title === 'string').slice(0, 6) : [];
  } catch {
    return [];
  }
}
function saveRecent(list: PaletteItem[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function paletteHtml(): string {
  return `<div class="search palette" id="search" hidden role="dialog" aria-modal="true" aria-label="搜索与命令">
  <div class="search__mask js-search-close"></div>
  <div class="search__panel palette__panel">
    <div class="search__head">${icon('search')}<input type="text" role="combobox" aria-expanded="true" aria-controls="search-results" aria-autocomplete="list" placeholder="搜索文章、页面、标签，或输入命令…" aria-label="搜索与命令" autocomplete="off" spellcheck="false" enterkeyhint="go"><kbd class="palette__esc" aria-hidden="true">Esc</kbd><button class="icon-btn js-search-close" type="button" aria-label="关闭">${icon('close')}</button></div>
    <div class="search__results" id="search-results" role="listbox" aria-label="结果"></div>
    <div class="palette__foot" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd>选择</span><span><kbd>↵</kbd>打开</span><span><kbd>Esc</kbd>关闭</span><span class="palette__shortcut"></span></div>
  </div>
</div>`;
}

export function createPalette(ctx: PaletteCtx) {
  let docs: SearchDoc[] | null = null;
  let loading: Promise<void> | null = null;
  let flat: Match[] = [];
  let active = 0;
  let lastFocus: HTMLElement | null = null;
  const $ = () => document.getElementById('search');

  function staticItems(): PaletteItem[] {
    const site = ctx.site();
    const items: PaletteItem[] = [];
    const seen = new Set<string>();
    const addPage = (label: string, ic: string, href: string | undefined, parent?: string) => {
      const key = `${label}|${href}`;
      if (!href || seen.has(key)) return;
      seen.add(key);
      items.push({ id: `page:${label}:${href}`, kind: 'page', title: label, sub: parent ? `${parent} › ${label}` : '栏目', href: ctx.url(href), icon: ic, keywords: href.replace(/[/%]/g, ' ') });
    };
    for (const n of ctx.nav) {
      addPage(n.label, n.icon, n.href);
      for (const c of n.children ?? []) addPage(c.label, c.icon, c.href, n.label);
    }
    for (const c of site.categories) items.push({ id: `cat:${c.category}`, kind: 'category', title: c.category, sub: `${c.count} 篇文章`, href: ctx.categoryPath(c.category), icon: 'folder' });
    for (const t of site.tags) items.push({ id: `tag:${t.tag}`, kind: 'tag', title: `#${t.tag}`, sub: `${t.count} 篇文章`, href: ctx.tagPath(t.tag), icon: 'tag', keywords: t.tag });
    const dark = document.documentElement.dataset.theme === 'dark';
    const acts: [string, string, string, string][] = [
      ['theme', dark ? 'sun' : 'moon', dark ? '切换到浅色模式' : '切换到深色模式', 'dark light theme 主题 深色 浅色 夜间'],
      ['copy-link', 'copy', '复制当前页面链接', 'copy link url 链接'],
      ['random', 'shuffle', '随便看一篇', 'random 随机'],
      ['top', 'arrowUp', '回到顶部', 'top scroll'],
      ['rss', 'rss', '打开 RSS 订阅源', 'rss feed atom 订阅'],
    ];
    if (ctx.isPost()) acts.unshift(['share', 'send', '分享本文（海报 / 二维码）', 'share poster qr 分享 海报 二维码']);
    for (const [a, ic, title, kw] of acts) items.push({ id: `act:${a}`, kind: 'action', title, action: a, icon: ic, keywords: kw, sub: '操作' });
    return items;
  }

  function postItems(): PaletteItem[] {
    const site = ctx.site();
    const list: SearchDoc[] = docs ?? site.posts.map((p) => ({ slug: p.slug, title: p.title, summary: p.summary, tags: p.tags, category: p.category, text: p.summary }));
    return list.map((d) => ({
      id: `post:${d.slug}`,
      kind: 'post',
      title: d.title,
      sub: [d.category, d.summary].filter(Boolean).join(' · '),
      keywords: `${d.tags.join(' ')} ${d.category ?? ''} ${(d.text ?? '').slice(0, 600)}`,
      href: ctx.postPath(d.slug),
      icon: 'file',
    }));
  }

  function optionHtml(m: Match, i: number): string {
    const it = m.item;
    const sub = it.sub ? `<span class="palette__sub">${esc(it.sub)}</span>` : '';
    const kindIcon = it.icon ?? 'file';
    const href = it.href ? ` data-href="${esc(it.href)}"` : '';
    return `<li id="pal-opt-${i}" role="option" class="palette__opt" aria-selected="${i === active}" data-i="${i}"${href}>
  <span class="palette__ic">${icon(kindIcon)}</span><span class="palette__txt"><b>${markHits(it.title, m.hits, esc)}</b>${sub}</span>${it.kind === 'action' ? '<span class="palette__tag">操作</span>' : `<span class="palette__go">${icon('arrowRight')}</span>`}</li>`;
  }

  function render(q: string): void {
    const out = document.getElementById('search-results');
    const input = $()?.querySelector<HTMLInputElement>('input');
    if (!out || !input) return;
    const query = q.trim();
    let groups: { label: string; items: Match[] }[];
    if (!query) {
      const recent = loadRecent().map((item) => ({ item: { ...item, kind: 'recent' as const }, score: 0, hits: [] }));
      const st = staticItems();
      const quick = st.filter((x) => x.kind === 'page').slice(0, 6).map((item) => ({ item, score: 0, hits: [] }));
      const acts = st.filter((x) => x.kind === 'action').map((item) => ({ item, score: 0, hits: [] }));
      const latest = postItems().slice(0, 3).map((item) => ({ item, score: 0, hits: [] }));
      groups = [
        ...(recent.length ? [{ label: '最近', items: recent }] : []),
        { label: '最新文章', items: latest },
        { label: '页面', items: quick },
        { label: '操作', items: acts },
      ];
    } else {
      groups = group(rank([...postItems(), ...staticItems()], query, 24));
    }
    flat = groups.flatMap((g) => g.items);
    if (active >= flat.length) active = 0;
    let i = 0;
    const body = groups
      .map((g) => `<div class="palette__group" role="group" aria-label="${esc(g.label)}"><p class="palette__label" aria-hidden="true">${esc(g.label)}</p><ul class="search__list" role="presentation">${g.items.map((m) => optionHtml(m, i++)).join('')}</ul></div>`)
      .join('');
    const fallback = query
      ? `<a class="palette__full" href="${esc(ctx.url(`/search/?q=${encodeURIComponent(query)}`))}">${icon('search')}在搜索页全文搜索「${esc(query)}」</a>`
      : '';
    out.innerHTML = flat.length
      ? `${query ? `<p class="search__count">找到 ${flat.length} 个结果${docs ? '' : '（正文索引加载中…）'}</p>` : ''}${body}${fallback}`
      : `<p class="search__hint">没有找到与「${esc(query)}」相关的内容。</p>${fallback}`;
    syncActive(false);
  }

  function syncActive(scroll = true): void {
    const input = $()?.querySelector<HTMLInputElement>('input');
    const out = document.getElementById('search-results');
    if (!input || !out) return;
    out.querySelectorAll<HTMLElement>('[role=option]').forEach((el) => el.setAttribute('aria-selected', String(Number(el.dataset.i) === active)));
    const cur = document.getElementById(`pal-opt-${active}`);
    if (cur) {
      input.setAttribute('aria-activedescendant', cur.id);
      if (scroll) cur.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  function choose(i: number, newTab = false): void {
    const m = flat[i];
    if (!m) return;
    const it = m.item;
    saveRecent(pushRecent(loadRecent(), it));
    const input = $()?.querySelector<HTMLInputElement>('input');
    if (input) input.value = ''; // 下次打开从「最近」开始
    if (it.action) {
      close(false);
      ctx.run(it.action);
      return;
    }
    if (!it.href) return;
    if (newTab) {
      window.open(it.href, '_blank', 'noopener');
      return;
    }
    close(false);
    ctx.go(it.href);
  }

  function open(prefill = ''): void {
    const m = $();
    if (!m) return;
    lastFocus = document.activeElement as HTMLElement | null;
    m.hidden = false;
    requestAnimationFrame(() => m.classList.add('is-open'));
    const input = m.querySelector<HTMLInputElement>('input')!;
    if (prefill) input.value = prefill;
    input.focus();
    input.select();
    active = 0;
    render(input.value);
    if (!docs && !loading) {
      loading = ctx
        .searchIndex()
        .then((d) => void (docs = d))
        .catch(() => undefined)
        .then(() => {
          if (!m.hidden) render(input.value);
        });
    }
  }

  function close(restore = true): void {
    const m = $();
    if (!m || m.hidden) return;
    m.classList.remove('is-open');
    setTimeout(() => (m.hidden = true), 160);
    if (restore && lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
  }

  function mount(): void {
    const m = $();
    if (!m || m.dataset.bound) return;
    m.dataset.bound = '1';
    const input = m.querySelector<HTMLInputElement>('input')!;
    const sc = m.querySelector('.palette__shortcut');
    if (sc) sc.innerHTML = `<kbd>${esc(shortcutLabel())}</kbd>随时打开`;
    input.addEventListener('input', () => {
      active = 0;
      render(input.value);
    });
    m.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (!flat.length) return;
        active = (active + (ev.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length;
        syncActive();
      } else if (ev.key === 'Home' && ev.ctrlKey) {
        active = 0;
        syncActive();
      } else if (ev.key === 'Enter' && !ev.isComposing) {
        const opt = (ev.target as HTMLElement).closest?.('.palette__full');
        if (opt) return;
        ev.preventDefault();
        choose(active, ev.metaKey || ev.ctrlKey);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        close();
      } else if (ev.key === 'Tab') {
        // 焦点留在对话框里：输入框 ↔ 全文搜索链接 ↔ 关闭按钮
        const f = [...m.querySelectorAll<HTMLElement>('input, .palette__full, button.js-search-close')].filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        const idx = f.indexOf(document.activeElement as HTMLElement);
        const next = ev.shiftKey ? (idx <= 0 ? f.length - 1 : idx - 1) : idx >= f.length - 1 ? 0 : idx + 1;
        ev.preventDefault();
        f[next]!.focus();
      }
    });
    const results = document.getElementById('search-results')!;
    results.addEventListener('click', (ev) => {
      const full = (ev.target as HTMLElement).closest<HTMLAnchorElement>('.palette__full');
      if (full) {
        close(false);
        return; // 交给全局路由
      }
      const li = (ev.target as HTMLElement).closest<HTMLElement>('[role=option]');
      if (!li) return;
      ev.preventDefault();
      choose(Number(li.dataset.i), (ev as MouseEvent).metaKey || (ev as MouseEvent).ctrlKey);
    });
    results.addEventListener('pointermove', (ev) => {
      const li = (ev.target as HTMLElement).closest<HTMLElement>('[role=option]');
      if (li && Number(li.dataset.i) !== active) {
        active = Number(li.dataset.i);
        syncActive(false);
      }
    });
    m.querySelectorAll('.js-search-close').forEach((b) => b.addEventListener('click', () => close()));
  }

  return { open, close, mount, render, isOpen: () => !!$() && !$()!.hidden };
}
