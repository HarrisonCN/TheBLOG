/**
 * L41 / v1.41.0 作品点评的「先自己打分」（按需加载）：打开预渲染时隐藏的表单，提交时在本页比较自评和平均分，
 * 结果写进 role=status 列表。不上传、不存储、没有网络请求。
 */
import { DIMS, compareSelf, compareText, type Review, type Scores } from './critique-core';

export function bind(root: ParentNode, reviewsOf: (slug: string) => Review[] | undefined = () => undefined): void {
  for (const box of root.querySelectorAll<HTMLElement>('[data-critique]')) {
    const form = box.querySelector<HTMLFormElement>('[data-cq-self]');
    const out = box.querySelector<HTMLElement>('[data-cq-out]');
    if (!form || !out || form.dataset.bound) continue;
    form.dataset.bound = '1';
    // 平均分来自页面上的表格（预渲染时算好），不再请求接口
    const reviews = reviewsOf(box.dataset.critique!);
    const avgFromTable = () => {
      const a: Partial<Scores> = {};
      for (const d of DIMS) a[d] = Number(box.querySelector(`[data-cq-avg="${d}"]`)?.textContent ?? NaN);
      return a as Scores;
    };
    form.hidden = false;
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const self: Partial<Scores> = {};
      for (const d of DIMS) {
        const v = (form.elements.namedItem(`cq-${d}`) as RadioNodeList | null)?.value;
        if (v) self[d] = Number(v);
      }
      const base = reviews ?? [{ by: '平均', scores: avgFromTable(), comment: '-' }];
      const res = compareSelf(self, base);
      out.innerHTML = '';
      if (!res.length) {
        const li = document.createElement('li');
        li.textContent = '先在上面至少选一个维度的分数。';
        out.append(li);
        return;
      }
      for (const c of res) {
        const li = document.createElement('li');
        li.textContent = compareText(c);
        out.append(li);
      }
    });
  }
}
