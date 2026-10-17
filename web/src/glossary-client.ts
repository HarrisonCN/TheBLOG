/**
 * L36 / v1.36.0 摄影术语表的即时搜索（按需加载）：打开预渲染时隐藏的搜索框，在本页按名称 / 英文 / 别名 / 拼音 / 拼音首字母筛选；
 * 空分组一起隐藏；结果数写进 role=status；Esc 清空；?q= 预填。没有网络请求，没有计时器。
 */
import { matchScore, resultText } from './glossary-core';

export function bind(root: ParentNode): void {
  const box = root.querySelector<HTMLElement>('[data-glossary]');
  if (!box || box.dataset.bound) return;
  box.dataset.bound = '1';
  const wrap = box.querySelector<HTMLElement>('[data-glossary-search]');
  const q = box.querySelector<HTMLInputElement>('#gl-q');
  const count = box.querySelector<HTMLElement>('#gl-count');
  const empty = box.querySelector<HTMLElement>('[data-gl-empty]');
  if (!wrap || !q || !count) return;
  const items = [...box.querySelectorAll<HTMLElement>('[data-gl-item]')].map((el) => {
    const parts = (el.dataset.glKeys ?? '').split(' | ');
    const reading = el.dataset.glReading ?? '';
    return { el, t: { title: parts[0] ?? '', en: parts[1] || undefined, aliases: parts.slice(2, -1), reading } };
  });
  const groups = [...box.querySelectorAll<HTMLElement>('[data-gl-group]')];
  const apply = () => {
    let n = 0;
    for (const { el, t } of items) {
      const hit = matchScore(t, q.value) > 0;
      el.hidden = !hit;
      if (hit) n++;
    }
    for (const g of groups) g.hidden = !g.querySelector('[data-gl-item]:not([hidden])');
    if (empty) empty.hidden = n > 0;
    count.textContent = resultText(n, q.value);
  };
  wrap.hidden = false;
  const pre = new URLSearchParams(location.search).get('q');
  if (pre) {
    q.value = pre.slice(0, 40);
    apply();
  }
  q.addEventListener('input', apply);
  q.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && q.value) {
      ev.preventDefault();
      q.value = '';
      apply();
    }
  });
}
