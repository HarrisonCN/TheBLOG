/**
 * 扩展栏目的浏览器端交互：作品集筛选 + 灯箱、书影音筛选、GitHub 星标刷新、搜索页、订阅地址复制。
 * 每次换页后由 main.ts 调用 bindSections(root)。不依赖后端：静态 GitHub Pages 上同样可用。
 */
import { escapeHtml as e } from './markdown';
import { workExposure } from './photo-core';
import type { Work } from './sections';
import type { PostSummary, SearchDoc } from './types';

interface Ctx {
  notify: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => unknown;
  searchIndex: () => Promise<{ posts: SearchDoc[] }>;
  /** 已加载的文章摘要（给搜索结果补发布时间与系列） */
  posts?: () => PostSummary[];
  /** 部署前缀（如 /TheBLOG），根路径部署时为空 */
  basePath: string;
}

export function bindSections(root: ParentNode, ctx: Ctx): void {
  bindWorks(root, ctx.basePath);
  bindShelf(root);
  void refreshStars(root);
  bindSearch(root, ctx);
  // L29：摄影工具箱（按需加载）
  if (root.querySelector('form[data-ptool]')) void import('./photo-tools-client').then((m) => m.bindPhotoTools(root, ctx));
  // L33：视觉杂志键盘翻篇（按需加载）
  if (root.querySelector('[data-magazine]')) void import('./magazine-client').then((m) => m.bindMagazine(root));
  // L34：视频与声音播放器增强（按需加载）
  if (root.querySelector('[data-av]')) void import('./av-client').then((m) => m.bindAv(root));
  // L35：沉浸式展厅 3D 增强（按需加载）
  if (root.querySelector('[data-hall]')) void import('./hall-client').then((m) => m.bindHall(root));
  // L36：摄影术语表（按需加载）
  if (root.querySelector('[data-glossary]')) void import('./glossary-client').then((m) => m.bind(root));
  // L37：修图前后对比（按需加载）
  if (root.querySelector('[data-retouch]')) void import('./retouch-client').then((m) => m.bind(root));
  // L38：拍摄清单（按需加载）
  if (root.querySelector('[data-checklist]')) void import('./checklist-client').then((m) => m.bind(root));
  // @content:clients — L36+ 内容栏目挂载点（scaffold）
  // L28：小组（按需加载）
  if (root.querySelector('[data-groups], [data-group]')) void import('./groups-client').then((m) => m.bindGroups(root, ctx));
  // L27：稍后读 / 书摘筛选（按需加载）
  if (root.querySelector('.js-later-toggle, [data-later-list], .js-quotes-filter')) void import('./reading2-client').then((m) => m.bindReading2(root, ctx));
  bindFeeds(root, ctx);
  // 热力图在窄屏上横向滚动：默认滚到最近的一周
  root.querySelectorAll<HTMLElement>('.heat__scroll').forEach((el) => {
    el.scrollLeft = el.scrollWidth;
  });
}

/** 分段按钮组：单选，返回当前值。 */
function segGroup(el: HTMLElement | null, onChange: (v: string) => void): void {
  if (!el || el.dataset.bound) return;
  el.dataset.bound = '1';
  el.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-v],button[data-series]');
    if (!b) return;
    el.querySelectorAll<HTMLButtonElement>('button').forEach((x) => {
      const on = x === b;
      x.classList.toggle('is-on', on);
      x.setAttribute('aria-pressed', String(on));
    });
    onChange(b.dataset.v ?? b.dataset.series ?? '');
  });
}

// ---------------------------------------------------------------- 作品集
function bindWorks(root: ParentNode, basePath = ''): void {
  const grid = root.querySelector<HTMLElement>('.js-works');
  const dataEl = root.querySelector<HTMLScriptElement>('.js-works-data');
  if (!grid || !dataEl || grid.dataset.bound) return;
  grid.dataset.bound = '1';
  let works: Work[] = [];
  try {
    works = JSON.parse(dataEl.textContent || '[]') as Work[];
  } catch {
    return;
  }
  const count = root.querySelector<HTMLElement>('.js-works-count');
  segGroup(root.querySelector('.js-works-filter'), (series) => {
    let n = 0;
    grid.querySelectorAll<HTMLElement>('.work').forEach((f) => {
      const show = !series || f.dataset.series === series;
      f.hidden = !show;
      if (show) n++;
    });
    if (count) count.textContent = `${n} 张`;
  });

  const dlg = root.querySelector<HTMLDialogElement>('.js-lightbox');
  if (!dlg) return;
  const imgEl = dlg.querySelector<HTMLImageElement>('.lightbox__img')!;
  let cur = 0;
  const visible = () => [...grid.querySelectorAll<HTMLElement>('.work')].filter((f) => !f.hidden).map((f) => Number(f.querySelector<HTMLElement>('.js-work')?.dataset.i));
  const big = (u: string) => u.replace(/-(640|1280)\.(webp|jpe?g|png)$/i, '-1920.$2');
  const show = (i: number) => {
    const w = works[i];
    if (!w) return;
    cur = i;
    imgEl.src = big(w.url);
    imgEl.alt = w.title;
    dlg.querySelector('.lightbox__title')!.textContent = w.title;
    dlg.querySelector('.lightbox__meta')!.textContent = [w.series, w.location, w.date].filter(Boolean).join(' · ');
    const rows: [string, string][] = [
      ['机身', w.camera],
      ['镜头', w.lens],
      ['焦距', w.focal],
      ['光圈', w.aperture],
      ['快门', w.shutter],
      ['ISO', w.iso],
      ['尺寸', w.width && w.height ? `${w.width} × ${w.height}` : ''],
    ];
    // L29：由光圈 / 快门 / ISO 算出曝光值，并可在曝光计算器里打开
    const xp = workExposure(w);
    const evRow = xp ? `<div class="lightbox__tool"><dt>曝光值</dt><dd><a class="js-lb-ev" href="${e(basePath + xp.href)}">${e(xp.label)}</a></dd></div>` : '';
    dlg.querySelector('.lightbox__exif')!.innerHTML = rows.filter(([, v]) => v).map(([k, v]) => `<div><dt>${k}</dt><dd>${e(v)}</dd></div>`).join('') + evRow + (w.credit ? '<div class="lightbox__sample"><dt>说明</dt><dd>示意参数</dd></div>' : '');
    dlg.querySelector('.lightbox__tags')!.innerHTML = w.tags.map((t) => `<span class="chip">#${e(t)}</span>`).join('');
    const cr = dlg.querySelector<HTMLElement>('.lightbox__credit')!;
    cr.innerHTML = w.credit ? `照片：${/^https?:\/\//i.test(w.creditUrl) ? `<a href="${e(w.creditUrl)}" target="_blank" rel="noopener noreferrer">${e(w.credit)}</a>` : e(w.credit)}` : '';
    const vis = visible();
    dlg.querySelector('.lightbox__pos')!.textContent = `${vis.indexOf(i) + 1} / ${vis.length} · 方向键切换，Esc 关闭`;
    if (history.replaceState) history.replaceState(null, '', `#${w.id}`);
  };
  const step = (d: number) => {
    const vis = visible();
    if (!vis.length) return;
    const pos = vis.indexOf(cur);
    show(vis[(pos + d + vis.length) % vis.length]!);
  };
  let opener: HTMLElement | null = null;
  const open = (i: number, from?: HTMLElement) => {
    opener = from ?? null;
    show(i);
    if (!dlg.open) dlg.showModal();
    document.documentElement.classList.add('lb-open');
  };
  const close = () => {
    if (dlg.open) dlg.close();
  };
  dlg.addEventListener('close', () => {
    document.documentElement.classList.remove('lb-open');
    if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
    opener?.focus();
  });
  grid.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>('.js-work');
    if (b) open(Number(b.dataset.i), b);
  });
  dlg.querySelector('.js-lb-prev')!.addEventListener('click', () => step(-1));
  dlg.querySelector('.js-lb-next')!.addEventListener('click', () => step(1));
  dlg.querySelector('.js-lb-close')!.addEventListener('click', close);
  dlg.addEventListener('click', (ev) => {
    if (ev.target === dlg) close(); // 点遮罩关闭
  });
  dlg.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowLeft') step(-1);
    else if (ev.key === 'ArrowRight') step(1);
  });
  // 手机上左右滑动切换
  let sx = 0;
  let sy = 0;
  const stage = dlg.querySelector<HTMLElement>('.lightbox__stage')!;
  stage.addEventListener('pointerdown', (ev) => {
    sx = ev.clientX;
    sy = ev.clientY;
  });
  stage.addEventListener('pointerup', (ev) => {
    const dx = ev.clientX - sx;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(ev.clientY - sy)) step(dx < 0 ? 1 : -1);
  });
  // #id 直接打开对应作品
  const id = decodeURIComponent(location.hash.slice(1));
  const at = id ? works.findIndex((w) => w.id === id) : -1;
  if (at >= 0) open(at);
}

// ---------------------------------------------------------------- 书影音
function bindShelf(root: ParentNode): void {
  const list = root.querySelector<HTMLElement>('.js-shelf');
  if (!list) return;
  const state = { kind: '', status: '', rating: 0 };
  const empty = root.querySelector<HTMLElement>('.js-shelf-empty');
  const count = root.querySelector<HTMLElement>('.js-shelf-count');
  const apply = () => {
    let n = 0;
    list.querySelectorAll<HTMLElement>('.shelf').forEach((el) => {
      const show = (!state.kind || el.dataset.kind === state.kind) && (!state.status || el.dataset.status === state.status) && Number(el.dataset.rating || 0) >= state.rating;
      el.hidden = !show;
      if (show) n++;
    });
    if (empty) empty.hidden = n > 0;
    if (count) count.textContent = `共 ${n} 项`;
  };
  segGroup(root.querySelector('.js-shelf-rating'), (v) => {
    state.rating = Number(v) || 0;
    apply();
  });
  segGroup(root.querySelector('.js-shelf-kind'), (v) => {
    state.kind = v;
    apply();
  });
  segGroup(root.querySelector('.js-shelf-status'), (v) => {
    state.status = v;
    apply();
  });
}

// ---------------------------------------------------------------- GitHub 星标
// 每个 owner 只请求一次 /users/:owner/repos（GitHub 匿名限额 60 次 / 小时），结果在 localStorage 缓存 1 小时。
const GH_TTL = 60 * 60 * 1000;
interface RepoStat {
  stars: number;
  forks: number;
}
export const GH_FAIL_BACKOFF = 10 * 60 * 1000;
export function ghRecentlyFailed(key: string, now = Date.now()): boolean {
  try {
    const at = Number(sessionStorage.getItem(key) || 0);
    return at > 0 && now - at < GH_FAIL_BACKOFF;
  } catch {
    return false;
  }
}
function ghMarkFailed(key: string): void {
  try {
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    /* ignore */
  }
}
const ownerReqs = new Map<string, Promise<Map<string, RepoStat> | null>>();
function ownerStats(owner: string): Promise<Map<string, RepoStat> | null> {
  let p = ownerReqs.get(owner);
  if (p) return p;
  p = (async () => {
    const key = `blog-gh:${owner.toLowerCase()}`;
    try {
      const c = JSON.parse(localStorage.getItem(key) || 'null') as { at: number; repos: [string, RepoStat][] } | null;
      if (c && Date.now() - c.at < GH_TTL) return new Map(c.repos);
    } catch {
      /* ignore */
    }
    // 上次失败（限额 / 网络被拦）后 10 分钟内不再请求：每换一页都重试只会在控制台刷一串失败的请求
    const failKey = `blog-gh-fail:${owner.toLowerCase()}`;
    if (ghRecentlyFailed(failKey)) return null;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    try {
      const r = await fetch(`https://api.github.com/users/${encodeURIComponent(owner)}/repos?per_page=100&type=owner`, { signal: ctl.signal, headers: { accept: 'application/vnd.github+json' } });
      if (!r.ok) {
        ghMarkFailed(failKey);
        return null;
      }
      const list = (await r.json()) as { name?: string; stargazers_count?: number; forks_count?: number }[];
      if (!Array.isArray(list)) return null;
      const m = new Map<string, RepoStat>(list.filter((x) => typeof x.name === 'string').map((x) => [x.name!.toLowerCase(), { stars: x.stargazers_count ?? 0, forks: x.forks_count ?? 0 }]));
      try {
        localStorage.setItem(key, JSON.stringify({ at: Date.now(), repos: [...m] }));
      } catch {
        /* ignore */
      }
      return m;
    } catch {
      ghMarkFailed(failKey);
      return null;
    } finally {
      clearTimeout(t);
    }
  })();
  ownerReqs.set(owner, p);
  void p.then((m) => {
    if (!m) ownerReqs.delete(owner); // 失败下次换页再试
  });
  return p;
}
async function repoStat(repo: string): Promise<RepoStat | null> {
  const [owner, name] = repo.split('/');
  const m = await ownerStats(owner!);
  return m?.get(name!.toLowerCase()) ?? null;
}
async function refreshStars(root: ParentNode): Promise<void> {
  const els = [...root.querySelectorAll<HTMLElement>('.js-stars[data-repo], .js-forks[data-repo]')];
  if (!els.length) return;
  const repos = [...new Set(els.map((x) => x.dataset.repo!).filter((r) => /^[\w.-]+\/[\w.-]+$/.test(r)))];
  const stats = new Map<string, RepoStat | null>(await Promise.all(repos.map(async (r) => [r, await repoStat(r)] as const)));
  let ok = 0;
  for (const el of els) {
    const s = stats.get(el.dataset.repo!);
    if (!s) continue;
    el.textContent = String(el.classList.contains('js-forks') ? s.forks : s.stars);
    el.closest('.repo-mini__s, .repo__n')?.classList.add('is-live');
  }
  for (const s of stats.values()) if (s) ok++;
  const total = root.querySelector<HTMLElement>('.js-stars-total');
  if (total && ok) {
    const sum = [...root.querySelectorAll<HTMLElement>('.repo .js-stars')].reduce((n, el) => n + (Number(el.textContent) || 0), 0);
    total.textContent = String(sum);
  }
  const note = root.querySelector<HTMLElement>('.js-gh-note');
  if (note) note.textContent = ok ? `实时 · 来自 GitHub（${ok}/${repos.length}）` : 'GitHub 暂时连不上，显示构建时快照';
}

// ---------------------------------------------------------------- 搜索页（L26：联合搜索 + 筛选，按需加载 search-client）
function bindSearch(root: ParentNode, ctx: Ctx): void {
  const form = root.querySelector<HTMLFormElement>('.js-search-page');
  if (!form || form.dataset.bound) return;
  void import('./search-client').then((m) => m.bindSearchPage(root, ctx));
}

// ---------------------------------------------------------------- 订阅
function bindFeeds(root: ParentNode, ctx: Ctx): void {
  root.querySelectorAll<HTMLElement>('.js-feed-url').forEach((c) => {
    c.textContent = location.origin + ctx.basePath + (c.dataset.path ?? '');
  });
  root.querySelectorAll<HTMLButtonElement>('.js-copy-feed').forEach((b) => {
    if (b.dataset.bound) return;
    b.dataset.bound = '1';
    b.addEventListener('click', async () => {
      const text = location.origin + ctx.basePath + (b.dataset.path ?? '');
      try {
        await navigator.clipboard.writeText(text);
        void ctx.notify('订阅地址已复制', 'success');
      } catch {
        void ctx.notify(text, 'info');
      }
    });
  });
}
