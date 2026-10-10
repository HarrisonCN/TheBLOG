/**
 * 成功 / 失败反馈统一用 Motionary 的结果图标 <usa-check>：圆圈描入 → 打勾 / 打叉描入 → 轻轻弹一下。
 * 减少动态效果时 <usa-check> 自己会直接画好（不动）。
 */
import { defineUsed } from './usa';

export type ResultKind = 'success' | 'error' | 'warning';

export function resultIconHtml(kind: ResultKind, size = 20, label = ''): string {
  return `<usa-check class="result-ico result-ico--${kind}" kind="${kind}" size="${size}" start="load"${label ? ` label="${label.replace(/"/g, '&quot;')}"` : ''}></usa-check>`;
}

/** 把 <usa-toaster> 默认的静态图标换成会描入的结果图标（info 保持原样）。 */
export function upgradeToastIcon(el: HTMLElement | null, type: string): void {
  if (!el || (type !== 'success' && type !== 'error' && type !== 'warning')) return;
  const old = el.querySelector('.usa-toast-icon');
  if (!old) return;
  old.insertAdjacentHTML('afterend', resultIconHtml(type, 22));
  old.remove();
}

/** 在按钮（或任意元素）里临时换上结果图标，ms 后恢复原来的图标。 */
export function flashResult(host: HTMLElement, kind: ResultKind, ms = 1600): void {
  const ic = host.querySelector<SVGElement>('svg.icon');
  host.querySelector('.result-ico')?.remove();
  if (ic) ic.style.display = 'none';
  host.insertAdjacentHTML('afterbegin', resultIconHtml(kind, 16));
  void defineUsed(host);
  setTimeout(() => {
    host.querySelector('.result-ico')?.remove();
    if (ic) ic.style.display = '';
  }, ms);
}
