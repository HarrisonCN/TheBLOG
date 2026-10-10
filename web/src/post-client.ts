/**
 * 文章页 / 首页的浏览器端增强：
 * - 代码块：语言标签 + 复制按钮；
 * - 标题锚点：悬停出现 #，点击复制本节链接；
 * - 阅读记录：保存读到的位置，回来时提示「从上次位置继续」；首页侧栏「继续阅读」；
 * - 表情回应：乐观更新，失败回滚；接口不存在（旧 Worker）时隐藏。
 */
import { api, ApiError } from './api';
import { flashResult } from './result-icon';
import { icon } from './icons';
import { applyLocal, mineKey, readMine, toggleMine } from './reactions-core';
import { clearHistory, continueList, loadHistory, progressOf, resumeFor, saveHistory, upsert } from './reading';

export interface PostCtx {
  notify: (m: string, t?: 'success' | 'error' | 'info' | 'warning') => void;
  postPath: (slug: string) => string;
  reducedMotion: () => boolean;
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;left:-9999px';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    ok ? resolve() : reject(new Error('copy'));
  });
}

// ---------------------------------------------------------------- 代码块
export function enhanceCode(root: ParentNode, ctx: PostCtx): void {
  root.querySelectorAll<HTMLPreElement>('.prose pre').forEach((pre) => {
    if (pre.parentElement?.classList.contains('code-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'code-wrap';
    pre.replaceWith(wrap);
    wrap.append(pre);
    if (!pre.hasAttribute('tabindex')) pre.tabIndex = 0; // 可横向滚动的区域要能用键盘到达
    const lang = pre.dataset.lang;
    if (lang) pre.setAttribute('aria-label', `${lang} 代码`);
    wrap.insertAdjacentHTML(
      'beforeend',
      `<div class="code-tools">${lang ? `<span class="code-lang">${esc(lang)}</span>` : ''}<button class="code-copy" type="button" aria-label="复制代码">${icon('copy')}<span>复制</span></button></div>`,
    );
  });
}

// ---------------------------------------------------------------- 标题锚点
export function enhanceHeadings(root: ParentNode, ctx: PostCtx): void {
  root.querySelectorAll<HTMLElement>('#post-body h2[id], #post-body h3[id]').forEach((h) => {
    if (h.querySelector('.heading-anchor')) return;
    const text = h.textContent ?? '';
    h.insertAdjacentHTML('beforeend', ` <a class="heading-anchor" href="#${esc(encodeURIComponent(h.id))}" aria-label="复制「${esc(text)}」这一节的链接">#</a>`);
  });
}

/**
 * 代码复制 / 标题锚点用文档级事件委托：正文外层的 <usa-double-tap> 升级时会重建子节点，直接绑在按钮上的监听会丢。
 */
let delegated = false;
export function installPostDelegation(ctx: PostCtx): void {
  if (delegated) return;
  delegated = true;
  document.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const btn = t.closest<HTMLButtonElement>('.code-copy');
    if (btn) {
      ev.preventDefault();
      const pre = btn.closest('.code-wrap')?.querySelector('pre');
      const code = pre?.querySelector('code')?.textContent ?? pre?.textContent ?? '';
      void copyText(code)
        .then(() => {
          flashResult(btn, 'success', 1600);
          btn.classList.add('is-done');
          btn.querySelector('span')!.textContent = '已复制';
          btn.setAttribute('aria-label', '已复制');
          setTimeout(() => {
            btn.classList.remove('is-done');
            btn.querySelector('span')!.textContent = '复制';
            btn.setAttribute('aria-label', '复制代码');
          }, 1600);
        })
        .catch(() => {
          flashResult(btn, 'error', 1600);
          ctx.notify('复制失败，请手动选择代码', 'error');
        });
      return;
    }
    const a = t.closest<HTMLAnchorElement>('.heading-anchor');
    if (a) {
      ev.preventDefault();
      ev.stopPropagation();
      const id = decodeURIComponent(a.hash.slice(1));
      const u = new URL(location.href);
      u.hash = id;
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
      document.getElementById(id)?.scrollIntoView({ behavior: ctx.reducedMotion() ? 'auto' : 'smooth' });
      void copyText(u.href).then(() => ctx.notify('已复制本节链接', 'success')).catch(() => undefined);
    }
  }, true);
}

// ---------------------------------------------------------------- 阅读记录
let detachReading: (() => void) | null = null;
export function trackReading(root: ParentNode, post: { slug: string; title: string; cover?: string | null } | null, ctx: PostCtx): void {
  detachReading?.();
  detachReading = null;
  document.querySelector('.resume-pill')?.remove();
  const article = root.querySelector<HTMLElement>('#post');
  if (!post || !article) return;
  const measure = () => {
    const r = article.getBoundingClientRect();
    const top = r.top + scrollY;
    return { pct: progressOf(top, r.height, scrollY, innerHeight), y: Math.round(scrollY) };
  };
  let timer = 0;
  let touched = false;
  const save = () => {
    if (!article.isConnected) return; // 已经换页：旧文章的尺寸是 0，不能用来覆盖记录
    const { pct, y } = measure();
    saveHistory(upsert(loadHistory(), { slug: post.slug, title: post.title, cover: post.cover ?? null, pct, y, at: Date.now() }));
  };
  const onScroll = () => {
    touched = true;
    clearTimeout(timer);
    timer = window.setTimeout(save, 400);
    if (scrollY > 400) document.querySelector('.resume-pill')?.remove();
  };
  // 提示「继续阅读」：只在从文章顶部打开、且有一段没读完的记录时
  const prev = resumeFor(loadHistory(), post.slug);
  if (prev && !location.hash && scrollY < 200) {
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div class="resume-pill" role="status"><span>上次读到 ${Math.round(prev.pct * 100)}%</span><button class="resume-pill__go" type="button">${icon('arrowDown')}继续阅读</button><button class="resume-pill__x" type="button" aria-label="不用了">${icon('close')}</button></div>`,
    );
    const pill = document.querySelector<HTMLElement>('.resume-pill')!;
    pill.querySelector('.resume-pill__go')!.addEventListener('click', () => {
      const r = article.getBoundingClientRect();
      const top = r.top + scrollY;
      // 优先按比例恢复（文章在别的屏幕宽度下高度不同），减去半屏让读到的那段在视口中间
      const y = Math.max(0, top + prev.pct * r.height - innerHeight * 0.9);
      scrollTo({ top: y, behavior: ctx.reducedMotion() ? 'auto' : 'smooth' });
      pill.remove();
    });
    pill.querySelector('.resume-pill__x')!.addEventListener('click', () => pill.remove());
    setTimeout(() => pill.remove(), 12000);
  } else if (!prev) {
    // 第一次打开：先记一条（0%），离开前再更新
    save();
  }
  const onHide = () => {
    if (touched) save();
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onHide);
  detachReading = () => {
    clearTimeout(timer);
    if (touched && article.isConnected) save();
    removeEventListener('scroll', onScroll);
    removeEventListener('pagehide', onHide);
    document.removeEventListener('visibilitychange', onHide);
  };
}

export function paintContinue(root: ParentNode, ctx: PostCtx): void {
  const card = root.querySelector<HTMLElement>('.js-continue');
  if (!card) return;
  const list = continueList(loadHistory());
  card.hidden = !list.length;
  if (!list.length) return;
  card.querySelector('.continue-list')!.innerHTML = list
    .map(
      (x) => `<li><a href="${esc(ctx.postPath(x.slug))}"><span class="continue__t">${esc(x.title)}</span><span class="continue__bar" role="progressbar" aria-label="已读" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(x.pct * 100)}"><i style="width:${Math.round(x.pct * 100)}%"></i></span><span class="continue__p">已读 ${Math.round(x.pct * 100)}%</span></a></li>`,
    )
    .join('');
  const clear = card.querySelector<HTMLButtonElement>('.js-continue-clear')!;
  if (!clear.dataset.bound) {
    clear.dataset.bound = '1';
    clear.addEventListener('click', () => {
      clearHistory();
      card.hidden = true;
      ctx.notify('阅读记录已清除', 'info');
    });
  }
}

// ---------------------------------------------------------------- 表情回应
export function bindReactions(root: ParentNode, ctx: PostCtx): void {
  const bar = root.querySelector<HTMLElement>('.js-reactions');
  if (!bar || bar.dataset.bound) return;
  bar.dataset.bound = '1';
  const slug = bar.dataset.slug!;
  let counts: Record<string, number> = {};
  let mine = readMine(localStorage, slug);
  let busy = false;
  const paint = () => {
    bar.querySelectorAll<HTMLButtonElement>('.react').forEach((b) => {
      const e = b.dataset.emoji!;
      const n = counts[e] ?? 0;
      const on = mine.includes(e);
      b.setAttribute('aria-pressed', String(on));
      b.querySelector('.react__n')!.textContent = n ? String(n) : '';
      const label = b.title;
      b.setAttribute('aria-label', `${label}${n ? `，${n} 人` : ''}${on ? '（你已回应）' : ''}`);
    });
  };
  paint();
  api
    .reactions(slug)
    .then((r) => {
      counts = r.counts;
      bar.classList.add('is-ready');
      paint();
    })
    .catch((e) => {
      if (e instanceof ApiError && (e.status === 404 || e.status === 405)) bar.hidden = true; // 旧 Worker 没有这个接口
    });
  bar.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('.react');
    if (!b || busy) return;
    const e = b.dataset.emoji!;
    const t = toggleMine(mine, e);
    const before = { counts, mine };
    counts = applyLocal(counts, e, t.on);
    mine = t.list;
    paint();
    if (t.on && !ctx.reducedMotion()) {
      b.classList.remove('is-pop');
      void b.offsetWidth;
      b.classList.add('is-pop');
    }
    busy = true;
    api
      .react(slug, e, t.on)
      .then((r) => {
        counts = r.counts;
        try {
          localStorage.setItem(mineKey(slug), JSON.stringify(mine));
        } catch {
          /* ignore */
        }
      })
      .catch((err) => {
        counts = before.counts;
        mine = before.mine;
        ctx.notify(err instanceof ApiError && err.status === 429 ? err.message : '回应没有发送成功，稍后再试', 'error');
      })
      .finally(() => {
        busy = false;
        paint();
      });
  });
}
