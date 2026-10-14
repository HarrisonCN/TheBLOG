/**
 * 后台文章编辑器的 l14 部分：类型（文章 / 影集）、影集照片序列（上传时自动读 EXIF、去掉文件里的 EXIF / GPS）、
 * 每张照片的拍摄手记、文章级拍摄手记，以及「插入嵌入块」菜单。保存前用 essay-core 的同一套规则先校验一遍。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import {
  emptyExif, emptyNote, ESSAY_LAYOUT_LABEL, ESSAY_LAYOUTS, EXIF_KEYS, MAX_ESSAY_PHOTOS, SHOT_NOTE_KEYS, SHOT_NOTE_LABEL, validatePostMedia,
  type Essay, type EssayExif, type EssayPhoto, type Issue, type PostKind, type ShotNote,
} from './essay-core';
import type { Post } from './types';

const EXIF_LABEL: Record<keyof EssayExif, [string, string]> = {
  camera: ['机身 / 手机', 'iPhone 15 Pro'], lens: ['镜头', '主摄 26mm'], focal: ['焦距', '26mm'], aperture: ['光圈', 'f/1.8'], shutter: ['快门', '1/120s'], iso: ['ISO', '64'], date: ['拍摄时间', '2026-09-12 18:42'],
};
const NOTE_PH: Record<keyof ShotNote, string> = { place: '粗略地名，例如 长沙 · 岳麓山（不要填坐标）', light: '例如 傍晚侧逆光', gear: '例如 手机主摄', settings: '例如 f/1.8 · 1/250s · ISO 50', thought: '为什么按下快门' };

/** 插入嵌入块菜单：值 → 插入的 Markdown 模板 */
export const EMBED_TEMPLATES: Record<string, { label: string; md: string }> = {
  tip: { label: '提示框', md: ':::tip 小技巧\n写在这里\n:::' },
  warn: { label: '注意框', md: ':::warn 注意\n写在这里\n:::' },
  note: { label: '备注框', md: ':::note\n写在这里\n:::' },
  details: { label: '折叠块', md: ':::details 点击展开\n折叠起来的内容\n:::' },
  compare: { label: '前后对比滑块', md: ':::compare 调色前后\n![调色前](图片地址 "调色前")\n![调色后](图片地址 "调色后")\n:::' },
  audio: { label: '音频（交给音乐播放器）', md: ':::audio\nsrc: https://\ntitle: 曲名\nartist: 艺人\ncredit: 许可证 / 来源\nlink: https://\n:::' },
  map: { label: '地图标记（约 11 km）', md: ':::map 地名\n纬度, 经度\n:::' },
  quote: { label: '引用卡片', md: ':::quote 作者《出处》 | https://\n摘录的句子\n:::' },
  notes: { label: '拍摄手记', md: ':::notes 这张照片\n地点: \n光线: \n器材: \n参数: \n想法: \n:::' },
};

function noteFields(n: ShotNote | null, prefix: string, idp: string): string {
  const v = n ?? emptyNote();
  return SHOT_NOTE_KEYS.map((k) => {
    const id = `${idp}-${k}`;
    const input = k === 'thought'
      ? `<textarea id="${id}" ${prefix}="${k}" maxlength="300" rows="2" placeholder="${e(NOTE_PH[k])}">${e(v[k])}</textarea>`
      : `<input id="${id}" ${prefix}="${k}" maxlength="${k === 'place' ? 40 : k === 'settings' ? 80 : 60}" placeholder="${e(NOTE_PH[k])}" value="${e(v[k])}">`;
    return `<div class="field${k === 'thought' ? ' adm-wide' : ''}"><label for="${id}">${SHOT_NOTE_LABEL[k]}</label>${input}</div>`;
  }).join('');
}

let rowSeq = 0;
export function photoRowHtml(p: EssayPhoto, i: number): string {
  const id = `ep${++rowSeq}`;
  const x = p.exif ?? emptyExif();
  return `<li class="adm-ep" data-ep>
  <div class="adm-ep__head"><span class="adm-ep__n">${i + 1}</span>${p.src ? `<img class="adm-ep__thumb" src="${e(p.src)}" alt="">` : '<span class="adm-ep__thumb adm-ep__thumb--ph"></span>'}
    <div class="field adm-ep__src"><label for="${id}-src">图片地址</label><input id="${id}-src" data-ep-f="src" value="${e(p.src)}" placeholder="https://… 或上传"></div>
    <div class="adm-ep__tools" role="group" aria-label="第 ${i + 1} 张照片">
      <button type="button" class="btn btn--ghost btn--sm" data-ep-act="up" aria-label="上移第 ${i + 1} 张">${icon('arrowUp')}</button>
      <button type="button" class="btn btn--ghost btn--sm" data-ep-act="down" aria-label="下移第 ${i + 1} 张">${icon('arrowDown')}</button>
      <button type="button" class="btn btn--ghost btn--sm" data-ep-act="remove" aria-label="删除第 ${i + 1} 张">${icon('trash')}</button>
    </div></div>
  <div class="adm-grid2">
    <div class="field"><label for="${id}-caption">图注</label><input id="${id}-caption" data-ep-f="caption" maxlength="200" value="${e(p.caption)}"></div>
    <div class="field"><label for="${id}-chapter">章节标题（可选，从这张开始新的一章）</label><input id="${id}-chapter" data-ep-f="chapter" maxlength="40" value="${e(p.chapter ?? '')}"></div>
    <div class="field"><label for="${id}-alt">替代文字（给读屏用）</label><input id="${id}-alt" data-ep-f="alt" maxlength="120" value="${e(p.alt)}"></div>
  </div>
  <div class="field"><label for="${id}-credit">署名（他人照片才填）</label><input id="${id}-credit" data-ep-f="credit" maxlength="200" value="${e(p.credit)}"></div>
  <input type="hidden" data-ep-f="width" value="${p.width || 0}"><input type="hidden" data-ep-f="height" value="${p.height || 0}">
  <details class="adm-ep__more"${EXIF_KEYS.some((k) => x[k]) ? ' open' : ''}><summary>EXIF（上传时自动读取，文件本身的 EXIF / GPS 会被去掉）</summary><div class="adm-grid3">${EXIF_KEYS.map((k) => `<div class="field"><label for="${id}-x-${k}">${EXIF_LABEL[k][0]}</label><input id="${id}-x-${k}" data-ep-x="${k}" maxlength="${k === 'lens' ? 60 : k === 'camera' ? 40 : 20}" placeholder="${e(EXIF_LABEL[k][1])}" value="${e(x[k])}"></div>`).join('')}</div></details>
  <details class="adm-ep__more"${p.notes ? ' open' : ''}><summary>这张照片的拍摄手记</summary><div class="adm-grid2">${noteFields(p.notes, 'data-ep-n', `${id}-n`)}</div></details>
</li>`;
}

export function essayEditorHtml(p: Post | null): string {
  const kind: PostKind = p?.kind === 'essay' ? 'essay' : 'post';
  const layout = p?.essay?.layout ?? 'single';
  const photos = p?.essay?.photos ?? [];
  return `<div class="adm-l14">
  <div class="adm-grid2">
    <div class="field"><label for="f-kind">类型</label><select id="f-kind" name="kind"><option value="post"${kind === 'post' ? ' selected' : ''}>文章</option><option value="essay"${kind === 'essay' ? ' selected' : ''}>影集（全幅照片序列）</option></select></div>
    <div class="field"><label for="f-embed">插入嵌入块</label><select id="f-embed"><option value="">选择后插入到光标处…</option>${Object.entries(EMBED_TEMPLATES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('')}</select></div>
  </div>
  <fieldset class="adm-essay" id="f-essay"${kind === 'essay' ? '' : ' hidden'}><legend>${icon('aperture')}影集照片</legend>
    <div class="adm-row"><label for="f-layout">版式</label><select id="f-layout" name="layout">${ESSAY_LAYOUTS.map((l) => `<option value="${l}"${l === layout ? ' selected' : ''}>${ESSAY_LAYOUT_LABEL[l]}</option>`).join('')}</select>
      <label class="btn btn--soft btn--sm">${icon('upload')}上传照片（可多选）<input type="file" id="f-ep-file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,.heic,.heif" multiple hidden></label>
      <button type="button" class="btn btn--ghost btn--sm" id="f-ep-add">${icon('plus')}用链接添加</button><span class="muted small" id="f-ep-count">${photos.length} / ${MAX_ESSAY_PHOTOS}</span></div>
    <ol class="adm-ep-list" id="f-ep-list">${photos.map(photoRowHtml).join('')}</ol>
  </fieldset>
  <details class="adm-notes"${p?.notes ? ' open' : ''}><summary>${icon('camera')}拍摄手记（文章级，可选）</summary><div class="adm-grid2" id="f-notes">${noteFields(p?.notes ?? null, 'data-pn', 'pn')}</div></details>
  <ul class="adm-issues" id="f-l14-issues" role="alert" hidden></ul>
</div>`;
}

const val = (el: Element | null) => ((el as HTMLInputElement | null)?.value ?? '').trim();

export function readPhotos(form: HTMLElement): EssayPhoto[] {
  return [...form.querySelectorAll<HTMLElement>('[data-ep]')].map((li) => {
    const f = (k: string) => val(li.querySelector(`[data-ep-f="${k}"]`));
    const exif = emptyExif();
    for (const k of EXIF_KEYS) exif[k] = val(li.querySelector(`[data-ep-x="${k}"]`));
    const n = emptyNote();
    for (const k of SHOT_NOTE_KEYS) n[k] = val(li.querySelector(`[data-ep-n="${k}"]`));
    return { src: f('src'), alt: f('alt'), caption: f('caption'), credit: f('credit'), width: Number(f('width')) || 0, height: Number(f('height')) || 0, exif, notes: SHOT_NOTE_KEYS.some((k) => n[k]) ? n : null, ...(f('chapter') ? { chapter: f('chapter') } : {}) };
  });
}

/** 表单 → { kind, essay, notes }（未校验） */
export function readPostMediaRaw(form: HTMLElement): { kind: PostKind; essay: Essay | null; notes: ShotNote | null } {
  const kind = (val(form.querySelector('#f-kind')) === 'essay' ? 'essay' : 'post') as PostKind;
  const n = emptyNote();
  for (const k of SHOT_NOTE_KEYS) n[k] = val(form.querySelector(`[data-pn="${k}"]`));
  const notes = SHOT_NOTE_KEYS.some((k) => n[k]) ? n : null;
  const essay = kind === 'essay' ? { layout: (val(form.querySelector('#f-layout')) || 'single') as Essay['layout'], photos: readPhotos(form) } : null;
  return { kind, essay, notes };
}

export function issuesHtml(issues: Issue[]): string {
  return issues.slice(0, 12).map((i) => `<li><code>${e(i.path)}</code> ${e(i.message)}</li>`).join('');
}

export interface EssayEditorOpts {
  upload(file: File): Promise<{ url: string; width: number; height: number; exif: Partial<EssayExif> | null; notes: string[] }>;
  msg(text: string, error?: boolean): void;
  onChange(): void;
  insert(md: string): void;
}

export function bindEssayEditor(form: HTMLElement, o: EssayEditorOpts): { validate(): { ok: boolean; body: Record<string, unknown> } } {
  const kindSel = form.querySelector<HTMLSelectElement>('#f-kind')!;
  const box = form.querySelector<HTMLElement>('#f-essay')!;
  const list = form.querySelector<HTMLOListElement>('#f-ep-list')!;
  const issuesBox = form.querySelector<HTMLElement>('#f-l14-issues')!;
  const renumber = () => {
    const items = [...list.querySelectorAll<HTMLElement>('[data-ep]')];
    items.forEach((li, i) => (li.querySelector('.adm-ep__n')!.textContent = String(i + 1)));
    form.querySelector('#f-ep-count')!.textContent = `${items.length} / ${MAX_ESSAY_PHOTOS}`;
    o.onChange();
  };
  const addPhoto = (p: EssayPhoto) => {
    if (list.querySelectorAll('[data-ep]').length >= MAX_ESSAY_PHOTOS) return o.msg(`影集最多 ${MAX_ESSAY_PHOTOS} 张照片`, true);
    list.insertAdjacentHTML('beforeend', photoRowHtml(p, list.children.length));
    renumber();
  };
  kindSel.addEventListener('change', () => {
    box.hidden = kindSel.value !== 'essay';
    o.onChange();
  });
  form.querySelector<HTMLSelectElement>('#f-embed')!.addEventListener('change', (ev) => {
    const s = ev.target as HTMLSelectElement;
    const t = EMBED_TEMPLATES[s.value];
    if (t) {
      o.insert(t.md);
      o.msg(`已插入「${t.label}」模板`);
    }
    s.value = '';
  });
  form.querySelector('#f-ep-add')!.addEventListener('click', () => {
    addPhoto({ src: '', alt: '', caption: '', credit: '', width: 0, height: 0, exif: emptyExif(), notes: null });
    list.querySelector<HTMLInputElement>('[data-ep]:last-child [data-ep-f="src"]')?.focus();
  });
  form.querySelector<HTMLInputElement>('#f-ep-file')!.addEventListener('change', async (ev) => {
    const input = ev.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    for (const [k, file] of files.entries()) {
      o.msg(`照片上传中（${k + 1} / ${files.length}）…`);
      try {
        const r = await o.upload(file);
        addPhoto({ src: r.url, alt: '', caption: '', credit: '', width: r.width, height: r.height, exif: { ...emptyExif(), ...(r.exif ?? {}) }, notes: null });
      } catch (err) {
        o.msg(err instanceof Error ? err.message : '上传失败', true);
        return;
      }
    }
    if (files.length) o.msg(`已添加 ${files.length} 张照片（已读取 EXIF，文件里的 EXIF / GPS 已去掉）`);
  });
  list.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('[data-ep-act]');
    if (!b) return;
    const li = b.closest<HTMLElement>('[data-ep]')!;
    if (b.dataset.epAct === 'remove') li.remove();
    else if (b.dataset.epAct === 'up' && li.previousElementSibling) li.previousElementSibling.before(li);
    else if (b.dataset.epAct === 'down' && li.nextElementSibling) li.nextElementSibling.after(li);
    renumber();
    if (li.isConnected) li.querySelector<HTMLElement>(`[data-ep-act="${b.dataset.epAct}"]`)?.focus();
  });
  list.addEventListener('input', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.dataset.epF === 'src') {
      const th = t.closest('[data-ep]')!.querySelector<HTMLImageElement>('img.adm-ep__thumb');
      if (th && /^(https:\/\/|\/)/.test(t.value.trim())) th.src = t.value.trim();
    }
  });
  return {
    validate() {
      const raw = readPostMediaRaw(form);
      const r = validatePostMedia(raw);
      issuesBox.hidden = !r.issues.length;
      issuesBox.innerHTML = issuesHtml(r.issues);
      return { ok: !r.issues.length, body: { kind: r.kind, essay: r.essay, notes: r.notes } };
    },
  };
}
