/**
 * L26 搜索页（/search/）浏览器端：按需加载。文章 / 作品 / 影集 / 创作者 / 话题联合搜索，
 * 类型 / 标签 / 年份筛选（写进 URL：?q=&type=&tag=&year=），结果高亮、分面计数、无结果时给建议。
 * 索引在浏览器里建（search-core），数据源各自可失败：失败的那一类跳过并在状态里说明。
 */
import { api, request } from './api';
import { escapeHtml as e } from './markdown';
import { buildIndex, facets, highlightRanges, parseSearchParams, search, searchParamsOf, snippetOf, suggest, SEARCH_KIND_LABEL, type SearchDoc, type SearchIndex, type SearchKind, type SearchState } from './search-core';
import { albumDocs, memberDocs, postDocs, topicDocs, workDocs } from './search-docs';
import type { PostSummary, SearchDoc as PostIdx } from './types';

export interface SearchCtx {
  searchIndex: () => Promise<{ posts: PostIdx[] }>;
  basePath: string;
  posts?: () => PostSummary[];
}

interface Card { username: string; nickname: string; bio?: string; note?: string }
interface Loaded { index: SearchIndex; skipped: string[] }
let loading: Promise<Loaded> | null = null;

async function load(ctx: SearchCtx): Promise<Loaded> {
  const skipped: string[] = [];
  const soft = <T>(p: Promise<T>, label: string, fallback: T): Promise<T> =>
    p.catch(() => {
      skipped.push(label);
      return fallback;
    });
  const [posts, works, gallery, disc] = await Promise.all([
    ctx.searchIndex().then((r) => r.posts),
    soft(api.content('works').then((r) => r.items), '作品', []),
    soft(api.content('gallery').then((r) => r.items), '影集', []),
    soft(request<{ featuredCreators?: Card[]; activeCreators?: Card[]; topics?: { slug: string; name: string; intro: string }[] }>('/api/social/discover'), '用户与话题', {}),
  ]);
  const creators = [...(disc.featuredCreators ?? []), ...(disc.activeCreators ?? [])];
  const docs: SearchDoc[] = [
    ...postDocs(posts, ctx.posts?.() ?? []),
    ...workDocs((works ?? []) as never[]),
    ...albumDocs((gallery ?? []) as never[]),
    ...memberDocs(creators),
    ...topicDocs(disc.topics ?? []),
  ];
  return { index: buildIndex(docs), skipped };
}

function mark(text: string, q: string): string {
  let out = '';
  let at = 0;
  for (const [a, b] of highlightRanges(text, q)) {
    out += e(text.slice(at, a)) + `<mark>${e(text.slice(a, b))}</mark>`;
    at = b;
  }
  return out + e(text.slice(at));
}

const KIND_ICON: Record<SearchKind, string> = { post: '文', work: '图', album: '集', user: '人', topic: '#' };

export function bindSearchPage(root: ParentNode, ctx: SearchCtx): void {
  const form = root.querySelector<HTMLFormElement>('.js-search-page');
  if (!form || form.dataset.bound) return;
  form.dataset.bound = '1';
  const input = form.querySelector<HTMLInputElement>('input[name="q"]')!;
  const status = root.querySelector<HTMLElement>('.js-sp-status')!;
  const out = root.querySelector<HTMLElement>('.js-sp-results')!;
  const fac = root.querySelector<HTMLElement>('.js-sp-facets')!;
  const sug = root.querySelector<HTMLElement>('.js-sp-suggest')!;
  const tagSel = root.querySelector<HTMLSelectElement>('.js-sp-tag')!;
  const yearSel = root.querySelector<HTMLSelectElement>('.js-sp-year')!;
  const reset = root.querySelector<HTMLButtonElement>('.js-sp-reset')!;
  const kindBtns = [...root.querySelectorAll<HTMLButtonElement>('.js-sp-kind')];
  let st: SearchState = parseSearchParams(new URLSearchParams(location.search));

  const ensureOption = (sel: HTMLSelectElement, v: string | null | undefined, label: string) => {
    if (v && ![...sel.options].some((o) => o.value === v)) sel.add(new Option(label, v));
    sel.value = v ?? '';
  };
  const paintControls = () => {
    input.value = st.q;
    for (const b of kindBtns) b.setAttribute('aria-pressed', String((b.dataset.kind === 'all' ? '' : b.dataset.kind) === (st.kind ?? '')));
    ensureOption(tagSel, st.tag, `#${st.tag ?? ''}`);
    ensureOption(yearSel, st.year, st.year ?? '');
    reset.hidden = !(st.kind || st.tag || st.year);
  };
  const base = e(ctx.basePath);
  const run = async () => {
    st.q = st.q.trim().slice(0, 80);
    history.replaceState(history.state, '', location.pathname + searchParamsOf(st));
    paintControls();
    if (!st.q) {
      out.innerHTML = '';
      fac.hidden = true;
      sug.hidden = true;
      for (const n of root.querySelectorAll<HTMLElement>('.js-sp-kn')) n.textContent = '';
      status.textContent = '输入关键词开始搜索；支持多个词（空格分隔），中文按词组匹配。';
      return;
    }
    status.textContent = '搜索中…';
    let L: Loaded;
    try {
      loading ??= load(ctx);
      L = await loading;
    } catch {
      loading = null;
      status.textContent = '搜索索引加载失败，请稍后再试。';
      return;
    }
    const q = st.q;
    const unfiltered = search(L.index, q, { tag: st.tag, year: st.year }, 500);
    const counts = facets(unfiltered);
    for (const n of root.querySelectorAll<HTMLElement>('.js-sp-kn')) {
      const k = n.dataset.kind;
      const c = k === 'all' ? unfiltered.length : (counts.kinds.find((x) => x.kind === k)?.count ?? 0);
      n.textContent = ` ${c}`;
    }
    const hits = st.kind ? unfiltered.filter((h) => h.doc.kind === st.kind) : unfiltered;
    const shown = hits.slice(0, 40);
    const scope = [st.kind ? SEARCH_KIND_LABEL[st.kind] : '', st.tag ? `#${st.tag}` : '', st.year ? `${st.year} 年` : ''].filter(Boolean).join(' · ');
    const skippedNote = L.skipped.length ? `（${L.skipped.join('、')}暂时无法加载，已跳过）` : '';
    status.textContent = hits.length ? `找到 ${hits.length} 条和「${q}」有关的结果${scope ? `（${scope}）` : ''}${skippedNote}` : `没有找到和「${q}」有关的结果${scope ? `（${scope}）` : ''}${skippedNote}`;
    const tagFacets = facets(hits).tags.slice(0, 8);
    fac.hidden = !hits.length || !tagFacets.length;
    fac.innerHTML = tagFacets.length ? `<span class="muted">结果里的标签：</span>${tagFacets.map((t) => `<button type="button" class="chip chip--ghost js-sp-ftag" data-tag="${e(t.tag)}">#${e(t.tag)} <span class="muted">${t.count}</span></button>`).join('')}` : '';
    out.innerHTML = shown
      .map(({ doc }) => {
        const body = snippetOf(doc.text || doc.summary, q, 90);
        const meta = [doc.section ? `<span class="chip">${e(doc.section)}</span>` : '', ...doc.tags.slice(0, 4).map((t) => `<span class="chip chip--ghost">#${e(t)}</span>`), doc.date ? `<span class="sp-hit__date">${e(doc.date.slice(0, 10))}</span>` : ''].join('');
        return `<li class="sp-hit" data-kind="${doc.kind}"><a href="${base}${e(doc.href)}"><span class="sp-hit__kind" aria-hidden="true">${KIND_ICON[doc.kind]}</span><span class="sp-hit__body"><span class="sp-hit__type">${SEARCH_KIND_LABEL[doc.kind]}</span><b>${mark(doc.title, q)}</b>${body ? `<p>${mark(body, q)}</p>` : ''}<span class="sp-hit__meta">${meta}</span></span></a></li>`;
      })
      .join('');
    if (!hits.length) {
      const s = suggest(L.index, q, 5);
      const filtered = !!(st.kind || st.tag || st.year);
      sug.hidden = false;
      sug.innerHTML = `<p>${filtered ? '试试<button type="button" class="linkish js-sp-clear">清除筛选</button>，或者' : ''}${s.length ? '换成这些相近的词：' : '换个更短的词，或者看看热门标签。'}</p>${s.length ? `<div class="sp-chips">${s.map((x) => `<button type="button" class="chip js-sp-chip" data-q="${e(x)}">${e(x)}</button>`).join('')}</div>` : ''}`;
    } else sug.hidden = true;
  };
  const debounced = (() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    return () => {
      clearTimeout(t);
      t = setTimeout(() => void run(), 220);
    };
  })();
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    st.q = input.value;
    void run();
  });
  input.addEventListener('input', () => {
    st.q = input.value;
    debounced();
  });
  for (const b of kindBtns)
    b.addEventListener('click', () => {
      const k = b.dataset.kind ?? 'all';
      st.kind = k === 'all' ? '' : (k as SearchKind);
      void run();
    });
  tagSel.addEventListener('change', () => {
    st.tag = tagSel.value || null;
    void run();
  });
  yearSel.addEventListener('change', () => {
    st.year = yearSel.value || null;
    void run();
  });
  const clear = () => {
    st = { ...st, kind: '', tag: null, year: null };
    void run();
  };
  reset.addEventListener('click', clear);
  // 委托挂在本页的 bento 上（每次换页都是新节点，不会重复绑定）
  const scopeEl: HTMLElement = form.closest<HTMLElement>('.bento') ?? form.parentElement!;
  scopeEl.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const chip = t.closest<HTMLElement>('.js-sp-chip');
    if (chip) {
      st.q = chip.dataset.q ?? '';
      void run();
      return;
    }
    const ft = t.closest<HTMLElement>('.js-sp-ftag');
    if (ft) {
      st.tag = ft.dataset.tag ?? null;
      void run();
      return;
    }
    if (t.closest('.js-sp-clear')) clear();
  });
  paintControls();
  if (st.q) void run();
}
