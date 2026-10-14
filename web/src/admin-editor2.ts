/**
 * L24 / v1.24.0 写作台 2.0（后台「写文章」里的一块面板）：
 *  - 块大纲：正文按块列出（段落 / 标题 / 引用 / 列表 / 代码 / 图片 / 提示块 / 分割线），可上下移动（按钮或 Alt+↑/↓）、删除、插入新块；
 *  - 发布前检查：图片替代文字、标题跳级等；字数 / 阅读时间；
 *  - 自动保存：停笔 1.5 秒后存到本机，再同步到服务器草稿（修订号冲突时让站长选用哪份）；重新打开时提示恢复；
 *  - 内容模板、媒体库（替代文字、多尺寸）、定时发布、发布预览（/preview/，另开标签页，自动跟着更新）。
 * Markdown 文本框仍然是唯一的正文来源：面板里的操作都改写文本框再触发 input。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import {
  applyTemplate,
  BLOCK_LABELS,
  BLOCK_TYPES,
  blocksToMarkdown,
  blockSummary,
  checkBlocks,
  DRAFT_LIMITS,
  draftKey,
  findTemplate,
  fromLocalInput,
  insertBlock,
  mediaMarkdown,
  moveBlock,
  newBlock,
  parseBlocks,
  pickNewer,
  planVariants,
  PREVIEW_KEY,
  removeBlock,
  shouldOfferRecovery,
  srcsetOf,
  TEMPLATES,
  textStats,
  toLocalInput,
  type BlockType,
  type DraftSnapshot,
  type MediaAsset,
  type PreviewPayload,
  type UpcomingPost,
} from './editor-core';
import type { Post } from './types';

export interface Editor2Host {
  root: HTMLElement;
  form: HTMLFormElement;
  content: HTMLTextAreaElement;
  post: Post | null;
  get: <T>(path: string) => Promise<T>;
  send: <T>(path: string, body: unknown, method: string) => Promise<T>;
  /** 上传一张（已去掉 EXIF 的）图片，返回地址 */
  uploadBlob: (blob: Blob, name: string) => Promise<{ url: string }>;
  /** 上传原图（读 EXIF、去掉 GPS），返回地址与尺寸 */
  uploadPhoto: (file: File) => Promise<{ url: string; width: number; height: number; file: Blob }>;
  msg: (text: string, err?: boolean) => void;
  /** 发布预览页地址（站点前缀 + preview/） */
  previewUrl: string;
  /** 错误对象里取状态码 / 服务器版本 */
  errStatus: (err: unknown) => { status: number; details?: unknown };
}

const LOCAL_PREFIX = 'blog-editor-draft:';
const BLOCK_ADD: BlockType[] = BLOCK_TYPES.filter((t) => t !== 'raw');

export function editor2Html(p: Post | null): string {
  const canSchedule = !!p && p.status === 'draft';
  return `<div class="adm-tile__head"><p class="tile__kicker">${icon('edit')}<span>写作台 2.0</span></p><p class="muted small ed2-status" id="ed2-status" role="status">还没有改动</p></div>
<div class="ed2-recover" id="ed2-recover" role="alert" hidden></div>
<div class="ed2-tools">
  <div class="ed2-tool"><label for="ed2-tpl">内容模板</label><div class="adm-row"><select id="ed2-tpl">${TEMPLATES.map((t) => `<option value="${t.id}">${e(t.label)} · ${e(t.desc)}</option>`).join('')}</select><button class="btn btn--soft btn--sm" type="button" id="ed2-tpl-apply">${icon('plus')}套用模板</button></div></div>
  <div class="ed2-tool"><span class="ed2-tool__label" id="ed2-sched-l">定时发布</span>${
    canSchedule
      ? `<div class="adm-row"><input type="datetime-local" id="ed2-sched" aria-labelledby="ed2-sched-l"><button class="btn btn--soft btn--sm" type="button" id="ed2-sched-set">${icon('clock')}定时</button><button class="btn btn--ghost btn--sm" type="button" id="ed2-sched-clear" hidden>取消定时</button></div><p class="muted small" id="ed2-sched-now">没有定时。到点后自动发布并出现在「即将发布」之外的所有列表里。</p>`
      : `<p class="muted small">${p ? '这篇已经发布了。' : '先「保存草稿」，就可以给它定一个发布时间。'}</p>`
  }</div>
  <div class="ed2-tool"><span class="ed2-tool__label">素材与预览</span><div class="adm-row"><button class="btn btn--soft btn--sm" type="button" id="ed2-media-open">${icon('image')}媒体库</button><button class="btn btn--soft btn--sm" type="button" id="ed2-preview">${icon('eye')}发布预览</button></div></div>
</div>
<div class="ed2-outline">
  <div class="adm-row adm-row--between"><h2 class="ed2-h" id="ed2-blocks-h">正文块</h2><span class="muted small" id="ed2-stats"></span></div>
  <ol class="ed2-blocks" id="ed2-blocks" aria-labelledby="ed2-blocks-h"></ol>
  <div class="adm-row"><label for="ed2-add" class="muted small">在末尾插入</label><select id="ed2-add">${BLOCK_ADD.map((t) => `<option value="${t}">${BLOCK_LABELS[t]}</option>`).join('')}</select><button class="btn btn--ghost btn--sm" type="button" id="ed2-add-btn">${icon('plus')}插入块</button></div>
  <ul class="ed2-issues" id="ed2-issues" aria-label="发布前检查"></ul>
</div>
<dialog class="ed2-media" id="ed2-media" aria-labelledby="ed2-media-h">
  <div class="adm-row adm-row--between"><h2 class="ed2-h" id="ed2-media-h">媒体库</h2><button class="adm-icon-btn" type="button" id="ed2-media-close" aria-label="关闭媒体库">${icon('close')}</button></div>
  <div class="adm-row"><label class="sr-only" for="ed2-media-q">搜索媒体库</label><input id="ed2-media-q" type="search" placeholder="按替代文字搜索"><label class="btn btn--soft btn--sm">${icon('upload')}上传图片<input type="file" id="ed2-media-file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden></label></div>
  <p class="muted small">上传时自动生成 640 / 1280 / 1920 宽的尺寸（只缩小，不放大），并去掉 EXIF / GPS。插入正文前请写好替代文字。</p>
  <ul class="ed2-media__grid" id="ed2-media-list" role="list"></ul>
</dialog>`;
}

export function bindEditor2(h: Editor2Host): { saved: () => void } {
  const $ = <T extends Element = HTMLElement>(sel: string) => h.root.querySelector<T>(sel);
  const status = $('#ed2-status')!;
  const key = draftKey(h.post?.slug);
  const field = (n: string) => h.form.elements.namedItem(n) as HTMLInputElement | null;
  const title = () => field('title')?.value ?? '';
  let rev = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let outlineTimer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;

  // ---------------------------------------------------------------- 本机草稿
  const readLocal = (): DraftSnapshot | null => {
    try {
      const raw = localStorage.getItem(LOCAL_PREFIX + key);
      const o = raw ? (JSON.parse(raw) as DraftSnapshot) : null;
      return o && typeof o.markdown === 'string' && typeof o.title === 'string' && typeof o.savedAt === 'string' ? o : null;
    } catch {
      return null;
    }
  };
  const writeLocal = (d: DraftSnapshot) => {
    try {
      localStorage.setItem(LOCAL_PREFIX + key, JSON.stringify(d));
    } catch {
      /* 存储满了：只同步服务器 */
    }
  };
  const clearLocal = (k = key) => {
    try {
      localStorage.removeItem(LOCAL_PREFIX + k);
    } catch {
      /* ignore */
    }
  };
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

  // ---------------------------------------------------------------- 预览数据（另开的预览页靠 storage 事件自动更新）
  const previewPayload = (): PreviewPayload => ({
    title: title(),
    summary: field('summary')?.value ?? '',
    markdown: h.content.value,
    tags: (field('tags')?.value ?? '').split(/[,，]/).map((t) => t.trim()).filter(Boolean),
    category: field('category')?.value ?? '',
    coverUrl: field('coverUrl')?.value.trim() ?? '',
    savedAt: new Date().toISOString(),
  });
  const writePreview = () => {
    try {
      localStorage.setItem(PREVIEW_KEY, JSON.stringify(previewPayload()));
    } catch {
      /* ignore */
    }
  };

  // ---------------------------------------------------------------- 自动保存
  async function autosave(force = false): Promise<void> {
    const snap: DraftSnapshot = { key, title: title().slice(0, DRAFT_LIMITS.titleMax), markdown: h.content.value, rev, savedAt: new Date().toISOString() };
    writeLocal(snap);
    writePreview();
    status.textContent = `已存到本机 ${hhmm(snap.savedAt)}，正在同步…`;
    try {
      const r = await h.send<{ draft: DraftSnapshot }>(`/api/admin/editor/drafts/${encodeURIComponent(key)}`, { baseRev: rev, title: snap.title, markdown: snap.markdown }, 'PUT');
      rev = r.draft.rev;
      writeLocal({ ...snap, rev });
      dirty = false;
      status.textContent = `已自动保存 ${hhmm(r.draft.savedAt)}（本机 + 服务器，第 ${rev} 版）`;
    } catch (err) {
      const { status: st, details } = h.errStatus(err);
      if (st === 409 && !force) return conflict((details as { draft?: DraftSnapshot } | undefined)?.draft ?? null);
      status.textContent = `已存到本机 ${hhmm(snap.savedAt)}（服务器暂时没保存上）`;
    }
  }
  function schedule(): void {
    dirty = true;
    status.textContent = '有改动，停笔后自动保存…';
    clearTimeout(timer);
    timer = setTimeout(() => void autosave(), DRAFT_LIMITS.autosaveMs);
  }

  const banner = $('#ed2-recover')!;
  function conflict(server: DraftSnapshot | null): void {
    banner.hidden = false;
    banner.innerHTML = `<p>${icon('refresh')}这份草稿在别处（另一个标签页或设备）改过了${server ? `：「${e(server.title || '无标题')}」，${e(hhmm(server.savedAt))}，第 ${server.rev} 版` : ''}。用哪一份？</p><div class="adm-row"><button class="btn btn--sm" type="button" data-ed2="keep">保留我现在的</button>${server ? '<button class="btn btn--ghost btn--sm" type="button" data-ed2="theirs">换成那一份</button>' : ''}</div>`;
    status.textContent = '草稿冲突，等你决定';
    banner.querySelector('[data-ed2="keep"]')!.addEventListener('click', () => {
      rev = server?.rev ?? rev;
      banner.hidden = true;
      void autosave(true);
    });
    banner.querySelector('[data-ed2="theirs"]')?.addEventListener('click', () => {
      rev = server!.rev;
      setText(server!.title, server!.markdown);
      banner.hidden = true;
      writeLocal({ ...server! });
      status.textContent = `已换成第 ${rev} 版`;
    });
  }

  function setText(t: string, md: string): void {
    const ti = field('title');
    if (ti) ti.value = t;
    h.content.value = md;
    h.content.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ---------------------------------------------------------------- 打开时：要不要恢复
  async function offerRecovery(): Promise<void> {
    const local = readLocal();
    let server: DraftSnapshot | null = null;
    try {
      server = (await h.get<{ draft: DraftSnapshot }>(`/api/admin/editor/drafts/${encodeURIComponent(key)}`)).draft;
      rev = server.rev;
    } catch {
      server = null;
    }
    const best = pickNewer(local, server);
    const current = { title: h.post?.title ?? '', markdown: h.post?.contentMd ?? '', updatedAt: h.post?.updatedAt ?? null };
    if (!best || !shouldOfferRecovery(best, current) || dirty) return;
    banner.hidden = false;
    banner.innerHTML = `<p>${icon('history')}发现一份没有正式保存的草稿：「${e(best.title || '无标题')}」，${e(new Date(best.savedAt).toLocaleString('zh-CN', { hour12: false }))}，${textStats(best.markdown).chars} 字。</p><div class="adm-row"><button class="btn btn--sm" type="button" data-ed2="restore">${icon('check')}恢复草稿</button><button class="btn btn--ghost btn--sm" type="button" data-ed2="discard">丢弃</button></div>`;
    banner.querySelector('[data-ed2="restore"]')!.addEventListener('click', () => {
      banner.hidden = true;
      setText(best.title, best.markdown);
      h.msg('已恢复草稿');
    });
    banner.querySelector('[data-ed2="discard"]')!.addEventListener('click', () => {
      banner.hidden = true;
      clearLocal();
      void h.send(`/api/admin/editor/drafts/${encodeURIComponent(key)}`, {}, 'DELETE').catch(() => undefined);
      rev = 0;
      h.msg('已丢弃草稿');
    });
  }

  // ---------------------------------------------------------------- 块大纲
  const list = $<HTMLOListElement>('#ed2-blocks')!;
  function outline(): void {
    clearTimeout(outlineTimer);
    const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('#ed2-blocks [data-i]')?.dataset.i;
    const blocks = parseBlocks(h.content.value);
    const st = textStats(h.content.value);
    $('#ed2-stats')!.textContent = `${st.chars} 字 · 约 ${st.minutes} 分钟 · ${blocks.length} 块`;
    list.innerHTML = blocks.length
      ? blocks
          .map(
            (b, i) => `<li class="ed2-block" tabindex="0" data-i="${i}" aria-label="第 ${i + 1} 块：${BLOCK_LABELS[b.type]}${b.type === 'heading' ? ` ${b.level} 级` : ''}（Alt+↑/↓ 移动）"><span class="chip ed2-block__type">${BLOCK_LABELS[b.type]}${b.type === 'heading' ? ` H${b.level}` : ''}</span><span class="ed2-block__txt">${e(blockSummary(b)) || '<i class="muted">（空）</i>'}</span><span class="ed2-block__acts"><button class="adm-icon-btn" type="button" data-mv="-1" aria-label="上移第 ${i + 1} 块"${i === 0 ? ' disabled' : ''}>${icon('arrowUp')}</button><button class="adm-icon-btn" type="button" data-mv="1" aria-label="下移第 ${i + 1} 块"${i === blocks.length - 1 ? ' disabled' : ''}>${icon('arrowDown')}</button><button class="adm-icon-btn adm-icon-btn--danger" type="button" data-rm aria-label="删除第 ${i + 1} 块">${icon('trash')}</button></span></li>`,
          )
          .join('')
      : '<li class="muted small">正文还是空的：套用一个模板，或者在下面插入第一块。</li>';
    const issues = checkBlocks(blocks);
    $('#ed2-issues')!.innerHTML = issues.length
      ? issues.map((x) => `<li class="ed2-issue ed2-issue--${x.level}">${icon(x.level === 'error' ? 'ban' : 'flag')}第 ${x.index + 1} 块：${e(x.message)}</li>`).join('')
      : `<li class="ed2-issue ed2-issue--ok">${icon('check')}发布前检查通过</li>`;
    if (focused !== undefined) list.querySelector<HTMLElement>(`[data-i="${focused}"]`)?.focus();
  }
  function rewrite(next: ReturnType<typeof parseBlocks>, focus?: number): void {
    h.content.value = blocksToMarkdown(next);
    h.content.dispatchEvent(new Event('input', { bubbles: true }));
    outline(); // 同时取消 input 触发的延迟重绘（否则焦点会丢）
    if (focus !== undefined) list.querySelector<HTMLElement>(`[data-i="${focus}"]`)?.focus();
  }
  list.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest('button');
    const li = btn?.closest<HTMLElement>('[data-i]');
    if (!btn || !li) return;
    const i = Number(li.dataset.i);
    const blocks = parseBlocks(h.content.value);
    if (btn.dataset.mv) {
      const d = Number(btn.dataset.mv) as -1 | 1;
      rewrite(moveBlock(blocks, i, d), i + d);
    } else if (btn.hasAttribute('data-rm')) rewrite(removeBlock(blocks, i), Math.max(0, i - 1));
  });
  list.addEventListener('keydown', (ev) => {
    const li = (ev.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (!li || !ev.altKey || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
    ev.preventDefault();
    const i = Number(li.dataset.i);
    const d = ev.key === 'ArrowUp' ? -1 : 1;
    const blocks = parseBlocks(h.content.value);
    if (i + d < 0 || i + d >= blocks.length) return;
    rewrite(moveBlock(blocks, i, d), i + d);
  });
  $('#ed2-add-btn')!.addEventListener('click', () => {
    const t = $<HTMLSelectElement>('#ed2-add')!.value as BlockType;
    const blocks = parseBlocks(h.content.value);
    rewrite(insertBlock(blocks, blocks.length - 1, newBlock(t)), blocks.length);
  });

  // ---------------------------------------------------------------- 模板
  $('#ed2-tpl-apply')!.addEventListener('click', () => {
    const t = findTemplate($<HTMLSelectElement>('#ed2-tpl')!.value);
    if (!t) return;
    const next = applyTemplate(t, {
      title: title(),
      markdown: h.content.value,
      tags: (field('tags')?.value ?? '').split(/[,，]/).map((x) => x.trim()).filter(Boolean),
      category: field('category')?.value ?? '',
    });
    const tags = field('tags');
    if (tags) tags.value = next.tags.join(', ');
    const cat = field('category');
    if (cat) cat.value = next.category;
    setText(next.title, next.markdown);
    h.msg(`已套用模板「${t.label}」`);
  });

  // ---------------------------------------------------------------- 发布预览
  $('#ed2-preview')!.addEventListener('click', () => {
    writePreview();
    window.open(h.previewUrl, 'blog-preview');
  });

  // ---------------------------------------------------------------- 定时发布
  const schedInput = $<HTMLInputElement>('#ed2-sched');
  if (schedInput && h.post) {
    const slug = h.post.slug;
    const nowLine = $('#ed2-sched-now')!;
    const clearBtn = $<HTMLButtonElement>('#ed2-sched-clear')!;
    const paint = (at: string | null) => {
      nowLine.textContent = at ? `已定时：${new Date(at).toLocaleString('zh-CN', { hour12: false })} 自动发布（会出现在「即将发布」页）` : '没有定时。到点后自动发布。';
      clearBtn.hidden = !at;
      if (at) schedInput.value = toLocalInput(at, new Date().getTimezoneOffset());
    };
    void h
      .get<{ posts: UpcomingPost[] }>('/api/admin/editor/scheduled')
      .then((r) => paint(r.posts.find((x) => x.slug === slug)?.publishAt ?? null))
      .catch(() => paint(null));
    const set = async (value: string | null) => {
      try {
        const r = await h.send<{ publishAt: string | null }>(`/api/admin/editor/schedule/${encodeURIComponent(slug)}`, { publishAt: value }, 'POST');
        paint(r.publishAt);
        h.msg(r.publishAt ? '已定时发布' : '已取消定时');
      } catch (err) {
        h.msg(err instanceof Error ? err.message : '定时失败', true);
      }
    };
    $('#ed2-sched-set')!.addEventListener('click', () => {
      const iso = fromLocalInput(schedInput.value, new Date().getTimezoneOffset());
      if (!iso) return h.msg('请先选一个发布时间', true);
      void set(iso);
    });
    clearBtn.addEventListener('click', () => void set(null));
  }

  // ---------------------------------------------------------------- 媒体库
  const dlg = $<HTMLDialogElement>('#ed2-media')!;
  const mlist = $('#ed2-media-list')!;
  let mediaQ = '';
  async function loadMedia(): Promise<void> {
    try {
      const r = await h.get<{ media: MediaAsset[] }>(`/api/admin/editor/media${mediaQ ? `?q=${encodeURIComponent(mediaQ)}` : ''}`);
      mlist.innerHTML = r.media.length
        ? r.media
            .map(
              (m) => `<li class="ed2-media__item" data-id="${m.id}"><img src="${e(m.variants[0]?.url ?? m.url)}"${m.variants.length ? ` srcset="${e(srcsetOf([...m.variants, { width: m.width || 9999, url: m.url }]))}" sizes="160px"` : ''} alt="${e(m.alt)}" width="160" height="${m.width && m.height ? Math.round((160 * m.height) / m.width) : 120}" loading="lazy">
<label class="sr-only" for="ed2-alt-${m.id}">图片 ${m.id} 的替代文字</label><input id="ed2-alt-${m.id}" data-alt value="${e(m.alt)}" maxlength="200" placeholder="替代文字（必填）">
<span class="muted small">${m.width ? `${m.width}×${m.height}` : ''}${m.variants.length ? ` · ${m.variants.length + 1} 个尺寸` : ''}</span>
<div class="adm-row"><button class="btn btn--ghost btn--sm" type="button" data-save>保存</button><button class="btn btn--soft btn--sm" type="button" data-insert>插入正文</button></div></li>`,
            )
            .join('')
        : '<li class="muted small">媒体库是空的：上传一张图片试试。</li>';
    } catch (err) {
      mlist.innerHTML = `<li class="muted small">读不到媒体库：${e(err instanceof Error ? err.message : '')}</li>`;
    }
  }
  $('#ed2-media-open')!.addEventListener('click', () => {
    dlg.showModal();
    void loadMedia();
  });
  $('#ed2-media-close')!.addEventListener('click', () => dlg.close());
  let qTimer: ReturnType<typeof setTimeout> | undefined;
  $<HTMLInputElement>('#ed2-media-q')!.addEventListener('input', (ev) => {
    mediaQ = (ev.target as HTMLInputElement).value;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => void loadMedia(), 200);
  });
  mlist.addEventListener('click', async (ev) => {
    const btn = (ev.target as HTMLElement).closest('button');
    const li = btn?.closest<HTMLElement>('[data-id]');
    if (!btn || !li) return;
    const id = Number(li.dataset.id);
    const alt = li.querySelector<HTMLInputElement>('[data-alt]')!.value.trim();
    try {
      const r = await h.send<{ media: MediaAsset }>(`/api/admin/editor/media/${id}`, { alt }, 'PATCH');
      if (btn.hasAttribute('data-insert')) {
        if (!alt) return h.msg('先写替代文字再插入（读屏软件会读它）', true);
        const blocks = parseBlocks(h.content.value);
        rewrite(insertBlock(blocks, blocks.length - 1, parseBlocks(mediaMarkdown(r.media))[0]!));
        dlg.close();
        h.msg('已插入图片');
      } else h.msg('已保存替代文字');
    } catch (err) {
      h.msg(err instanceof Error ? err.message : '保存失败', true);
    }
  });
  $<HTMLInputElement>('#ed2-media-file')!.addEventListener('change', async (ev) => {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    h.msg('上传中…');
    try {
      const up = await h.uploadPhoto(file);
      const variants: { width: number; url: string }[] = [];
      for (const v of planVariants(up.width, up.height).filter((x) => x.width < up.width)) {
        const blob = await resize(up.file, v.width, v.height);
        if (blob) variants.push({ width: v.width, url: (await h.uploadBlob(blob, `${file.name.replace(/\.[^.]+$/, '')}-${v.width}w.webp`)).url });
      }
      await h.send('/api/admin/editor/media', { url: up.url, alt: '', width: up.width, height: up.height, bytes: up.file.size, variants }, 'POST');
      h.msg(`已上传（${variants.length + 1} 个尺寸），记得写替代文字`);
      await loadMedia();
    } catch (err) {
      h.msg(err instanceof Error ? err.message : '上传失败', true);
    }
  });

  // ---------------------------------------------------------------- 启动
  h.form.addEventListener('input', (ev) => {
    if ((ev.target as HTMLElement).closest('.ed2-tools, .ed2-outline, #ed2-media')) return;
    schedule();
    clearTimeout(outlineTimer);
    outlineTimer = setTimeout(outline, 150);
  });
  outline();
  void offerRecovery();
  return {
    /** 正式保存成功后：清掉本机和服务器草稿（新文章的 new 草稿也清掉） */
    saved: () => {
      clearTimeout(timer);
      dirty = false;
      clearLocal();
      clearLocal('new');
      void h.send(`/api/admin/editor/drafts/${encodeURIComponent(key)}`, {}, 'DELETE').catch(() => undefined);
    },
  };
}

/** 浏览器里缩小图片（WebP，质量 0.85）；不支持时返回 null（只保留原图） */
async function resize(src: Blob, w: number, hgt: number): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(src);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = hgt;
    c.getContext('2d')!.drawImage(bmp, 0, 0, w, hgt);
    bmp.close?.();
    return await new Promise<Blob | null>((res) => c.toBlob((b) => res(b), 'image/webp', 0.85));
  } catch {
    return null;
  }
}
