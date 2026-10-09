/**
 * 后台公共工具：带 CSRF 的请求、通知（usa-toaster）、提交按钮状态（usa-button）、长按确认（usa-hold）、骨架屏。
 * 浏览器里不保存任何长期密钥：CSRF token 只在内存中，刷新后从 /api/auth/session 重新获取。
 */
import { request, ApiError } from '../api';
import { escapeHtml as e } from '../markdown';
import { icon } from '../icons';
import { defineUsed, loadFeedback } from '../usa';

export { e, icon };

let csrf = '';
let onExpired: () => void = () => undefined;
export const setCsrf = (t: string) => void (csrf = t);
export const hasCsrf = () => !!csrf;
export const setOnExpired = (fn: () => void) => void (onExpired = fn);

export function adminFetch<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && typeof init.body === 'string') headers.set('content-type', 'application/json');
  if (init.method && init.method !== 'GET') headers.set('x-csrf-token', csrf);
  return request<T>(path, { ...init, headers, credentials: 'include' }).catch((err) => {
    if (err instanceof ApiError && err.status === 401) {
      csrf = '';
      onExpired();
    }
    throw err;
  });
}
export const get = <T>(path: string) => adminFetch<T>(path);
export const send = <T>(method: string, path: string, body?: unknown) => adminFetch<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export function errText(err: unknown): string {
  if (err instanceof ApiError) {
    const d = Array.isArray(err.details) ? '：' + (err.details as { path: string; message: string }[]).map((x) => `${x.path} ${x.message}`).join('；') : '';
    return err.message + d;
  }
  return (err as Error)?.message || String(err);
}

export async function toast(msg: string, type: 'success' | 'error' | 'info' | 'warning' = 'success'): Promise<void> {
  try {
    const { toast: t } = await loadFeedback();
    t(msg, { type } as never);
  } catch {
    /* 组件加载失败时静默 */
  }
}

type BtnEl = HTMLElement & { state?: string };
/** 表单提交：usa-button 依次显示 loading → success / error，1.6 秒后回到 idle。 */
export async function withButton<T>(scope: HTMLElement | null, fn: () => Promise<T>): Promise<T> {
  const b = (scope?.matches?.('usa-button') ? scope : scope?.querySelector('usa-button[morph="submit"]')) as BtnEl | null;
  const native = b?.querySelector<HTMLButtonElement>('button');
  if (native) native.disabled = true;
  if (b) b.state = 'loading';
  try {
    const r = await fn();
    if (b) b.state = 'success';
    return r;
  } catch (err) {
    if (b) b.state = 'error';
    throw err;
  } finally {
    if (native) native.disabled = false;
    setTimeout(() => b && (b.state = 'idle'), 1600);
  }
}

/** 提交按钮（submit → loading → success） */
export const saveBtn = (label: string, opts: { id?: string; cls?: string; type?: 'submit' | 'button'; ic?: string } = {}) =>
  `<usa-button deform="squash" morph="submit" class="adm-save${opts.cls ? ` ${opts.cls}` : ''}"${opts.id ? ` id="${opts.id}"` : ''}><button class="btn" type="${opts.type ?? 'submit'}">${opts.ic ? icon(opts.ic) : ''}<span>${e(label)}</span></button></usa-button>`;

/** 长按确认的危险操作（usa-hold），触发 usa:confirm */
export const holdBtn = (label: string, data: Record<string, string | number>, opts: { ic?: string; duration?: number } = {}) =>
  `<usa-hold class="adm-hold" duration="${opts.duration ?? 900}" label="长按${e(label)}"${Object.entries(data).map(([k, v]) => ` data-${k}="${e(String(v))}"`).join('')}>${icon(opts.ic ?? 'trash')}<span>${e(label)}</span></usa-hold>`;

export const skeleton = (blocks = 3) =>
  `<div class="adm-skel" aria-busy="true">${Array.from({ length: blocks }, (_, i) => `<div class="card adm-card"><usa-skeleton loading lines="${i ? 3 : 2}"${i ? '' : ' avatar'}></usa-skeleton></div>`).join('')}</div>`;

export function fmtDate(iso: string | null | undefined, time = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}${time ? ` ${p(d.getHours())}:${p(d.getMinutes())}` : ''}`;
}
export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
export const num = (n: number) => new Intl.NumberFormat('zh-CN').format(n);

/** 只允许 http(s) / 站内路径 / data:image 作为图片地址 */
export function safeImg(u: string | null | undefined): string {
  const s = String(u ?? '').trim();
  if (/^data:image\/(png|jpeg|webp|gif|avif);base64,/i.test(s) || /^https?:\/\//i.test(s) || s.startsWith('/')) return s;
  return '';
}

/** 上传图片（R2 / 演示站本地）：返回可用的 URL */
export async function uploadImage(file: File, alt = ''): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('alt', alt || file.name.replace(/\.[^.]+$/, ''));
  const r = await adminFetch<{ url: string; markdown: string }>('/api/admin/images', { method: 'POST', body: fd, timeoutMs: 60_000 });
  return r.url;
}

/** 图片字段：预览 + URL + 上传按钮 */
export function imageField(name: string, label: string, value: string, opts: { hint?: string; round?: boolean } = {}): string {
  const src = safeImg(value);
  return `<div class="field adm-img" data-img-field="${e(name)}">
  <label for="f-${e(name)}">${e(label)}</label>
  <div class="adm-img__row">
    <div class="adm-img__pv${opts.round ? ' is-round' : ''}${src ? '' : ' is-empty'}">${src ? `<img src="${e(src)}" alt="">` : icon('image')}</div>
    <div class="adm-img__ctl">
      <input id="f-${e(name)}" name="${e(name)}" value="${e(value)}" placeholder="https://… 或上传" maxlength="2100000" autocomplete="off">
      <div class="row"><label class="btn btn--ghost btn--sm">${icon('upload')}上传<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden data-upload-for="${e(name)}"></label>
      <button type="button" class="btn btn--ghost btn--sm" data-clear-img="${e(name)}">清除</button></div>
      ${opts.hint ? `<small class="muted">${e(opts.hint)}</small>` : ''}
    </div>
  </div>
</div>`;
}

/** 绑定 imageField：上传 / 清除 / 输入 URL 时更新预览；onChange 用于实时预览 */
export function bindImageFields(root: HTMLElement, onChange?: () => void): void {
  const paint = (name: string) => {
    const box = root.querySelector<HTMLElement>(`[data-img-field="${CSS.escape(name)}"]`);
    const input = box?.querySelector<HTMLInputElement>(`input[name="${CSS.escape(name)}"]`);
    const pv = box?.querySelector<HTMLElement>('.adm-img__pv');
    if (!input || !pv) return;
    const src = safeImg(input.value);
    pv.classList.toggle('is-empty', !src);
    pv.innerHTML = src ? `<img src="${e(src)}" alt="">` : icon('image');
    onChange?.();
  };
  root.querySelectorAll<HTMLElement>('[data-img-field]').forEach((box) => {
    const name = box.dataset.imgField!;
    box.querySelector<HTMLInputElement>(`input[name="${CSS.escape(name)}"]`)?.addEventListener('change', () => paint(name));
    box.querySelector<HTMLInputElement>('[data-upload-for]')?.addEventListener('change', async (ev) => {
      const inp = ev.target as HTMLInputElement;
      const file = inp.files?.[0];
      inp.value = '';
      if (!file) return;
      const pv = box.querySelector<HTMLElement>('.adm-img__pv')!;
      pv.classList.add('is-busy');
      try {
        const url = await uploadImage(file);
        box.querySelector<HTMLInputElement>(`input[name="${CSS.escape(name)}"]`)!.value = url;
        paint(name);
        void toast('图片已上传');
      } catch (err) {
        void toast(errText(err), 'error');
      } finally {
        pv.classList.remove('is-busy');
      }
    });
    box.querySelector('[data-clear-img]')?.addEventListener('click', () => {
      box.querySelector<HTMLInputElement>(`input[name="${CSS.escape(name)}"]`)!.value = '';
      paint(name);
    });
  });
}

/** 渲染完一屏后：注册用到的 Motionary 组件 */
export const upgrade = (root: ParentNode) => defineUsed(root);

export const field = (name: string, label: string, value: string | number, attrs = '', hint = '') =>
  `<div class="field"><label for="f-${e(name)}">${e(label)}</label><input id="f-${e(name)}" name="${e(name)}" value="${e(String(value))}" ${attrs}>${hint ? `<small class="muted">${e(hint)}</small>` : ''}</div>`;
export const area = (name: string, label: string, value: string, attrs = '', hint = '') =>
  `<div class="field"><label for="f-${e(name)}">${e(label)}</label><textarea id="f-${e(name)}" name="${e(name)}" ${attrs}>${e(value)}</textarea>${hint ? `<small class="muted">${e(hint)}</small>` : ''}</div>`;
export const select = (name: string, label: string, value: string, options: [string, string][]) =>
  `<div class="field"><label for="f-${e(name)}">${e(label)}</label><select id="f-${e(name)}" name="${e(name)}">${options.map(([v, l]) => `<option value="${e(v)}"${v === value ? ' selected' : ''}>${e(l)}</option>`).join('')}</select></div>`;
/** 开关（原生 checkbox，CSS 画成 iOS 风格） */
export const toggle = (name: string, label: string, checked: boolean, hint = '') =>
  `<label class="adm-switch"><input type="checkbox" name="${e(name)}"${checked ? ' checked' : ''}><span class="adm-switch__track" aria-hidden="true"></span><span class="adm-switch__text">${e(label)}${hint ? `<small>${e(hint)}</small>` : ''}</span></label>`;
/** 分段选择（radio） */
export const segmented = (name: string, value: string, options: [string, string][], label = '') =>
  `<div class="adm-seg" role="radiogroup"${label ? ` aria-label="${e(label)}"` : ''}>${options.map(([v, l]) => `<label><input type="radio" name="${e(name)}" value="${e(v)}"${v === value ? ' checked' : ''}><span>${e(l)}</span></label>`).join('')}</div>`;

export const empty = (text: string, ic = 'inbox') => `<div class="adm-empty">${icon(ic)}<p>${e(text)}</p></div>`;
export const chip = (text: string, kind: 'ok' | 'warn' | 'muted' | 'danger' | 'accent' = 'muted') => `<span class="chip chip--${kind}">${e(text)}</span>`;

/** 由 admin.ts 注入：页面模块用来跳转与刷新侧栏角标（避免循环依赖） */
export const nav = {
  go: (_id: string, _arg = ''): void => undefined,
  badges: async (): Promise<unknown> => undefined,
  actions: (html: string): HTMLElement | null => {
    const el = document.getElementById('adm-actions');
    if (el) el.innerHTML = html;
    void defineUsed(el ?? document);
    return el;
  },
};
