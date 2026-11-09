/**
 * L62 / v1.62.0 树洞（按需加载）：列表页「写一张纸条」——按 treehole-core.checkNote 检查长度和隐私规则（手机号、邮箱、网址、@），
 * 通过后保存为「待审核（仅本机）」，可以撤回；纸条页「抱抱」（aria-pressed，本机 +1）。只存在 localStorage，没有网络请求。
 */
import { readList, readMap, store, writeList } from './ck-store';
import { checkNote, HUG_KEY, MINE_KEY, MOODS, type Mood } from './treehole-core';

interface Mine {
  id: string;
  mood: Mood;
  text: string;
}
const readMine = (): Mine[] => {
  try {
    const v = JSON.parse(store.get(MINE_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is Mine => !!x && typeof x.id === 'string' && typeof x.text === 'string' && typeof x.mood === 'string' && x.mood in MOODS) : [];
  } catch {
    return [];
  }
};
const writeMine = (l: Mine[]) => store.set(MINE_KEY, l.length ? JSON.stringify(l) : null);
void readMap;

export function bind(root: ParentNode): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-treehole]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const sec = box.querySelector<HTMLElement>('[data-tn-write]');
    const form = box.querySelector<HTMLFormElement>('[data-tn-form]');
    const ul = box.querySelector<HTMLElement>('[data-tn-mine]');
    const none = box.querySelector<HTMLElement>('[data-tn-none]');
    const msg = box.querySelector<HTMLElement>('[data-tn-msg]');
    if (!sec || !form || !ul || !none || !msg) continue;
    const ta = form.querySelector<HTMLTextAreaElement>('textarea')!;
    const mood = form.querySelector<HTMLSelectElement>('select')!;
    const paint = () => {
      const l = readMine();
      ul.textContent = '';
      for (const m of l) {
        const li = document.createElement('li');
        li.className = 'tn-mine__item';
        li.innerHTML = '<p class="small"><span class="tn-pending">待审核</span> <span class="tn-mood"></span></p><p class="tn-mine__text"></p><button type="button" class="btn btn--sm">撤回</button>';
        li.querySelector('.tn-mood')!.textContent = MOODS[m.mood];
        li.querySelector('.tn-mine__text')!.textContent = m.text;
        li.querySelector('button')!.addEventListener('click', () => {
          writeMine(readMine().filter((x) => x.id !== m.id));
          msg.textContent = '已撤回这张纸条。';
          paint();
          ta.focus();
        });
        ul.append(li);
      }
      none.hidden = l.length > 0;
    };
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const why = checkNote(ta.value);
      if (why.length) {
        msg.textContent = `没有投进去：${why.join('、')}。`;
        return;
      }
      const l = readMine();
      writeMine([...l, { id: `m${Date.now().toString(36)}${l.length}`, mood: mood.value as Mood, text: ta.value.trim() }]);
      ta.value = '';
      msg.textContent = '已投进树洞：标为待审核，只保存在这台设备上。';
      paint();
    });
    sec.hidden = false;
    paint();
  }
  for (const box of root.querySelectorAll<HTMLElement>('[data-treenote]')) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const slug = box.dataset.treenote!;
    const base = Number(box.dataset.hugs) || 0;
    const tools = box.querySelector<HTMLElement>('[data-tn-tools]');
    const btn = box.querySelector<HTMLButtonElement>('[data-tn-hug]');
    const n = box.querySelector<HTMLElement>('[data-tn-n]');
    const st = box.querySelector<HTMLElement>('[data-tn-status]');
    if (!tools || !btn || !n || !st) continue;
    const paint = () => {
      const h = readList(HUG_KEY).includes(slug);
      btn.setAttribute('aria-pressed', String(h));
      n.textContent = String(base + (h ? 1 : 0));
    };
    btn.addEventListener('click', () => {
      const l = readList(HUG_KEY);
      const h = l.includes(slug);
      writeList(HUG_KEY, h ? l.filter((x) => x !== slug) : [...l, slug]);
      st.textContent = h ? '已收回抱抱。' : '抱抱已送出（只记在这台设备上）。';
      paint();
    });
    tools.hidden = false;
    paint();
  }
}
