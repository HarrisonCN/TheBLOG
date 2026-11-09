/**
 * L65 / v1.65.0 社区守则与治理（按需加载）：列表页的举报表单——按 guidelines-core.checkReport 检查（站内地址、理由、说明），
 * 通过后保存为「已提交（仅本机）」回执，可以撤回。演示站不发送任何举报；只存在 localStorage，没有网络请求。
 */
import { store } from './ck-store';
import { checkReport, REASONS, REPORT_KEY, type Reason } from './guidelines-core';

interface Rep {
  id: string;
  target: string;
  reason: Reason;
  details: string;
}
const read = (): Rep[] => {
  try {
    const v = JSON.parse(store.get(REPORT_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is Rep => !!x && typeof x.id === 'string' && typeof x.target === 'string' && typeof x.reason === 'string' && x.reason in REASONS && typeof x.details === 'string') : [];
  } catch {
    return [];
  }
};
const write = (l: Rep[]) => store.set(REPORT_KEY, l.length ? JSON.stringify(l) : null);

export function bind(root: ParentNode): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-guidelines]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const sec = box.querySelector<HTMLElement>('[data-gl-report]');
    const form = box.querySelector<HTMLFormElement>('[data-gl-form]');
    const ul = box.querySelector<HTMLElement>('[data-gl-mine]');
    const none = box.querySelector<HTMLElement>('[data-gl-none]');
    const msg = box.querySelector<HTMLElement>('[data-gl-msg]');
    if (!sec || !form || !ul || !none || !msg) continue;
    const paint = () => {
      const l = read();
      ul.textContent = '';
      for (const r of l) {
        const li = document.createElement('li');
        li.className = 'gl-mine__item';
        li.innerHTML = '<p class="small"><span class="gl-sent">已提交（仅本机）</span> <span class="gl-id"></span></p><p class="gl-mine__t"></p><button type="button" class="btn btn--sm">撤回</button>';
        li.querySelector('.gl-id')!.textContent = `回执 ${r.id}`;
        li.querySelector('.gl-mine__t')!.textContent = `${REASONS[r.reason]} · ${r.target}${r.details ? ` · ${r.details}` : ''}`;
        li.querySelector('button')!.addEventListener('click', () => {
          write(read().filter((x) => x.id !== r.id));
          msg.textContent = `已撤回回执 ${r.id}。`;
          paint();
        });
        ul.append(li);
      }
      none.hidden = l.length > 0;
    };
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const fd = new FormData(form);
      const r = { target: String(fd.get('target') ?? ''), reason: String(fd.get('reason') ?? ''), details: String(fd.get('details') ?? '') };
      const why = checkReport(r);
      if (why.length) {
        msg.textContent = `没有提交：${why.join('；')}。`;
        return;
      }
      const l = read();
      const id = `R${String(l.length + 1).padStart(3, '0')}-${Date.now().toString(36).slice(-4)}`;
      write([...l, { id, target: r.target.trim(), reason: r.reason as Reason, details: r.details.trim() }]);
      form.reset();
      msg.textContent = `已提交（仅本机），回执 ${id}。`;
      paint();
    });
    sec.hidden = false;
    paint();
  }
}
