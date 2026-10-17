/**
 * L46 / v1.46.0 胶片记录（按需加载）：互易律补偿计算器 —— 输入任意测光时间（秒），<output> 立即显示补偿后的时间。没有网络请求。
 */
import { reciprocity, secondsText } from './film-core';

export function bind(root: ParentNode): void {
  for (const form of root.querySelectorAll<HTMLFormElement>('form[data-fm-calc]')) {
    if (form.dataset.bound) continue;
    form.dataset.bound = '1';
    const p = Number(form.dataset.fmCalc);
    const input = form.querySelector<HTMLInputElement>('input');
    const out = form.querySelector<HTMLOutputElement>('output');
    if (!input || !out) continue;
    const paint = () => {
      const v = Number(input.value);
      out.value = Number.isFinite(v) && v > 0 && v <= 3600 ? `实际曝光约 ${secondsText(reciprocity(v, p))}` : '请输入 0.1–3600 秒';
    };
    form.addEventListener('submit', (ev) => ev.preventDefault());
    input.addEventListener('input', paint);
    form.hidden = false;
    paint();
  }
}
