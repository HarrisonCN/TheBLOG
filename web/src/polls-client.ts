/**
 * L53 / v1.53.0 投票与小测验（按需加载）：每题显示单选表单；提交后这台设备就不能再改（一机一票），结果条按示例票数 + 你的一票重算；
 * 测验提交后才标出对错、显示解析，全部答完显示得分。选择只存在 localStorage，没有网络请求。
 */
import { readMap, writeMap } from './ck-store';
import { ANSWER_KEY, scoreText, tally } from './polls-core';

export function bind(root: ParentNode): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-poll]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const slug = box.dataset.poll!;
    const quiz = box.dataset.kind === 'quiz';
    const qs = [...box.querySelectorAll<HTMLElement>('.pl-q[data-q]')];
    const scoreEl = box.querySelector<HTMLElement>('[data-pl-score]');
    const correctOf = (li: HTMLElement) => li.querySelector<HTMLInputElement>('input[data-c]')?.value;
    const paintScore = () => {
      if (!quiz || !scoreEl) return;
      const m = readMap(ANSWER_KEY);
      const answered = qs.filter((li) => typeof m[`${slug}/${li.dataset.q}`] === 'string');
      const right = answered.filter((li) => m[`${slug}/${li.dataset.q}`] === correctOf(li)).length;
      scoreEl.hidden = answered.length < qs.length;
      scoreEl.textContent = answered.length === qs.length ? `${scoreText({ right, total: qs.length })}。` : '';
    };
    for (const li of qs) {
      const key = `${slug}/${li.dataset.q}`;
      const form = li.querySelector<HTMLFormElement>('[data-pl-form]');
      const st = li.querySelector<HTMLElement>('[data-pl-st]');
      const rows = [...li.querySelectorAll<HTMLElement>('[data-pl-bars] li[data-opt]')];
      if (!form || !st) continue;
      const base = rows.map((r) => ({ id: r.dataset.opt!, text: '', votes: Number(r.querySelector('[data-pl-n]')!.textContent) || 0 }));
      const radios = [...form.querySelectorAll<HTMLInputElement>('input[type=radio]')];
      const paint = (announce: boolean) => {
        const v = readMap(ANSWER_KEY)[key];
        const mine = typeof v === 'string' && radios.some((r) => r.value === v) ? v : undefined;
        const t = tally(base, mine);
        rows.forEach((r, i) => {
          r.querySelector('[data-pl-n]')!.textContent = String(t[i]!.n);
          r.querySelector('[data-pl-pct]')!.textContent = String(t[i]!.pct);
          const p = r.querySelector('progress')!;
          p.value = t[i]!.pct;
          p.setAttribute('aria-label', `${r.querySelector('.pl-bar__text')!.textContent} ${t[i]!.pct}%`);
          r.classList.toggle('is-mine', r.dataset.opt === mine);
          if (quiz && mine) r.classList.toggle('is-correct', r.dataset.opt === correctOf(li));
        });
        if (!mine) return;
        for (const r of radios) {
          r.checked = r.value === mine;
          r.disabled = true;
        }
        form.querySelector('button')!.disabled = true;
        const ex = li.querySelector<HTMLElement>('[data-pl-explain]');
        if (ex) ex.hidden = false;
        if (announce || !st.textContent) st.textContent = quiz ? (mine === correctOf(li) ? '回答正确。' : '回答错误，正确答案已标出。') : '已投票（这台设备只能投一次）。';
      };
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const pick = radios.find((r) => r.checked);
        if (!pick) {
          st.textContent = '请先选一个选项。';
          return;
        }
        const m = readMap(ANSWER_KEY);
        if (typeof m[key] === 'string') return;
        m[key] = pick.value;
        writeMap(ANSWER_KEY, m);
        paint(true);
        paintScore();
      });
      form.hidden = false;
      paint(false);
    }
    paintScore();
  }
}
