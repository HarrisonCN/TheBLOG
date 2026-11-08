/**
 * L52 / v1.52.0 问答区（按需加载）：回答旁显示赞同 / 反对按钮（aria-pressed；再点一次取消，点另一个改票），票数在本机 ±1；
 * 列表页提供「全部 / 待解决 / 已解决」筛选。投票只存在 localStorage，没有网络请求。
 */
import { readMap, writeMap } from './ck-store';
import { nextVote, VOTE_KEY, withMyVote } from './qa-core';

export function bind(root: ParentNode): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-question]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const slug = box.dataset.question!;
    const status = box.querySelector<HTMLElement>('[data-qa-status]');
    for (const li of box.querySelectorAll<HTMLElement>('.qa-answer[data-answer]')) {
      const key = `${slug}/${li.dataset.answer}`;
      const base = Number(li.dataset.votes) || 0;
      const up = li.querySelector<HTMLButtonElement>('[data-qa-up]');
      const down = li.querySelector<HTMLButtonElement>('[data-qa-down]');
      const n = li.querySelector<HTMLElement>('[data-qa-n]');
      if (!up || !down || !n) continue;
      const mine = () => {
        const v = readMap(VOTE_KEY)[key];
        return v === 1 || v === -1 ? v : 0;
      };
      const paint = () => {
        const m = mine();
        up.setAttribute('aria-pressed', String(m === 1));
        down.setAttribute('aria-pressed', String(m === -1));
        n.textContent = String(withMyVote(base, m));
      };
      const press = (p: 1 | -1) => {
        const map = readMap(VOTE_KEY);
        const v = nextVote(mine(), p);
        if (v) map[key] = v;
        else delete map[key];
        writeMap(VOTE_KEY, map);
        if (status) status.textContent = v === 1 ? '已赞同（只记在这台设备上）。' : v === -1 ? '已反对（只记在这台设备上）。' : '已取消投票。';
        paint();
      };
      up.addEventListener('click', () => press(1));
      down.addEventListener('click', () => press(-1));
      up.hidden = false;
      down.hidden = false;
      paint();
    }
  }
  for (const box of root.querySelectorAll<HTMLElement>('[data-questions]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const fs = box.querySelector<HTMLElement>('[data-qa-filter]');
    const st = box.querySelector<HTMLElement>('[data-qa-filter-status]');
    if (!fs || !st) continue;
    const cards = [...box.querySelectorAll<HTMLElement>('.ck-card')];
    fs.addEventListener('change', () => {
      const v = fs.querySelector<HTMLInputElement>('input:checked')?.value ?? 'all';
      let shown = 0;
      for (const c of cards) {
        const solved = c.querySelector<HTMLElement>('[data-solved]')?.dataset.solved === '1';
        c.hidden = v === 'open' ? solved : v === 'solved' ? !solved : false;
        if (!c.hidden) shown++;
      }
      st.textContent = `显示 ${shown} 个问题`;
    });
    fs.hidden = false;
  }
}
