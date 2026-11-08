/**
 * L55 / v1.55.0 接龙写作（按需加载）：进行中的故事显示「续写下一段」表单（昵称 + 段落，字数提示）；按 relay-core.checkTurn 校验
 * （不能空、不超过 300 字、不能和上一段同一个作者），通过后作为「你的续写（仅本机）」显示在最后，可删除。只存在 localStorage，没有网络请求。
 */
import { readMap, writeMap } from './ck-store';
import { checkTurn, countText, DRAFT_KEY } from './relay-core';

export function bind(root: ParentNode): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-relay]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const slug = box.dataset.relay!;
    const form = box.querySelector<HTMLFormElement>('[data-rl-form]');
    const list = box.querySelector<HTMLElement>('[data-rl-paras]');
    if (!form || !list || box.dataset.done === '1') continue;
    const max = Number(box.dataset.max) || 0;
    const msg = form.querySelector<HTMLElement>('[data-rl-msg]')!;
    const count = form.querySelector<HTMLElement>('[data-rl-count]')!;
    const ta = form.querySelector<HTMLTextAreaElement>('textarea')!;
    const au = form.querySelector<HTMLInputElement>('input[name=author]')!;
    const paras = () => [...list.querySelectorAll<HTMLElement>('.rl-para:not(.is-mine)')].map((li, i) => ({ n: i + 1, author: li.dataset.author ?? '', text: '' }));
    const paint = () => {
      list.querySelector('.is-mine')?.remove();
      const d = readMap(DRAFT_KEY)[slug] as { author?: unknown; text?: unknown } | undefined;
      const has = d && typeof d.author === 'string' && typeof d.text === 'string';
      form.hidden = !!has;
      if (!has) return;
      const n = paras().length + 1;
      const li = document.createElement('li');
      li.className = 'rl-para is-mine';
      li.id = `p-${n}`;
      li.innerHTML = '<p class="rl-text"></p><p class="rl-by small muted"></p><p><button type="button" class="btn btn--sm" data-rl-del>删除我的续写</button></p>';
      li.querySelector('.rl-text')!.textContent = d!.text as string;
      li.querySelector('.rl-by')!.textContent = `第 ${n} 段 · ${d!.author as string} · 你的续写（仅本机，未提交）`;
      li.querySelector<HTMLButtonElement>('[data-rl-del]')!.addEventListener('click', () => {
        const m = readMap(DRAFT_KEY);
        delete m[slug];
        writeMap(DRAFT_KEY, m);
        paint();
        msg.textContent = '已删除你的续写。';
        ta.value = '';
        count.textContent = countText(0);
        au.focus();
      });
      list.append(li);
    };
    ta.addEventListener('input', () => {
      count.textContent = countText(ta.value.trim().length);
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const err = checkTurn({ paragraphs: paras(), maxTurns: max }, au.value, ta.value);
      if (err) {
        msg.textContent = err;
        return;
      }
      const m = readMap(DRAFT_KEY);
      m[slug] = { author: au.value.trim(), text: ta.value.trim() };
      writeMap(DRAFT_KEY, m);
      paint();
      const mine = list.querySelector<HTMLElement>('.is-mine [data-rl-del]');
      mine?.focus();
    });
    form.noValidate = true;
    paint();
    if (form.hidden && !list.querySelector('.is-mine')) form.hidden = false;
  }
}
