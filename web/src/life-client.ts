/**
 * L64 / v1.64.0 生活专栏（按需加载）：菜谱的用量换算（输入人数，按 life-core.scaleAmount 重算每一行，「适量」不变）和步骤勾选（只存在本机）；
 * 列表页「全部 / 菜谱 / 游记」筛选。没有网络请求。
 */
import { readMap, writeMap } from './ck-store';
import { scaleAmount, STEPS_KEY } from './life-core';

export function bind(root: ParentNode): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-lifepost][data-kind="recipe"]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const slug = box.dataset.lifepost!;
    const from = Number(box.dataset.servings) || 1;
    const wrap = box.querySelector<HTMLElement>('[data-lf-scale]');
    const input = box.querySelector<HTMLInputElement>('[data-lf-to]');
    const st = box.querySelector<HTMLElement>('[data-lf-scale-status]');
    if (wrap && input && st) {
      const cells = [...box.querySelectorAll<HTMLElement>('td[data-amount]')];
      input.addEventListener('input', () => {
        const to = Math.round(Number(input.value));
        if (!Number.isFinite(to) || to < 1 || to > 20) {
          st.textContent = '请输入 1–20 的人数。';
          return;
        }
        for (const c of cells) {
          const a = Number(c.dataset.amount);
          c.textContent = a === 0 ? '适量' : `${scaleAmount(a, from, to)} ${c.dataset.unit}`;
        }
        st.textContent = to === from ? '' : `已按 ${to} 人份换算（原菜谱 ${from} 人份）。`;
      });
      wrap.hidden = false;
    }
    const steps = [...box.querySelectorAll<HTMLInputElement>('input[data-lf-step]')];
    const saved = readMap(STEPS_KEY)[slug];
    const done = new Set(Array.isArray(saved) ? saved : []);
    for (const s of steps) {
      s.checked = done.has(Number(s.dataset.lfStep));
      s.hidden = false;
      s.closest('li')?.classList.toggle('is-done', s.checked);
    }
    box.addEventListener('change', (ev) => {
      const t = ev.target as HTMLInputElement;
      if (!t.matches('input[data-lf-step]')) return;
      t.closest('li')?.classList.toggle('is-done', t.checked);
      const m = readMap(STEPS_KEY);
      const c = steps.filter((s) => s.checked).map((s) => Number(s.dataset.lfStep));
      if (c.length) m[slug] = c;
      else delete m[slug];
      writeMap(STEPS_KEY, m);
    });
  }
  for (const box of root.querySelectorAll<HTMLElement>('[data-life]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const fs = box.querySelector<HTMLElement>('[data-lf-filter]');
    const st = box.querySelector<HTMLElement>('[data-lf-status]');
    if (!fs || !st) continue;
    const cards = [...box.querySelectorAll<HTMLElement>('.ck-card')];
    fs.addEventListener('change', () => {
      const v = fs.querySelector<HTMLInputElement>('input:checked')?.value ?? 'all';
      for (const c of cards) c.hidden = v !== 'all' && c.querySelector<HTMLElement>('.lf-kind')?.dataset.kind !== v;
      st.textContent = `显示 ${cards.filter((c) => !c.hidden).length} 篇`;
    });
    fs.hidden = false;
  }
}
