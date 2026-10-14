/**
 * L25 系列详情页的浏览器端：用本机阅读记录（reading.ts，localStorage blog-reading）填充「我的阅读进度」和「继续读第 N 篇」。
 * 进度不上传；会员跨设备同步需要 Worker D1（SKIPPED-verifiable）。
 */
import { loadHistory } from './reading';
import { seriesProgress } from './series-core';
import type { PostSummary } from './types';

const STATE_LABEL = { read: '已读', reading: '读到一半', unread: '' } as const;

export function mountSeriesPage(root: ParentNode = document): void {
  const box = root.querySelector<HTMLElement>('[data-series-progress]');
  if (box && !box.dataset.ready) {
    box.dataset.ready = '1';
    const items = [...root.querySelectorAll<HTMLElement>('.series-part[data-slug]')];
    const parts = items.map((li) => ({ slug: li.dataset.slug!, title: li.querySelector('b')?.textContent ?? '' }) as PostSummary);
    const p = seriesProgress({ parts }, loadHistory());
    const bar = box.querySelector<HTMLElement>('[role="progressbar"]');
    if (bar) {
      bar.setAttribute('aria-valuenow', String(p.read));
      bar.setAttribute('aria-valuetext', `已读 ${p.read} 篇，共 ${p.total} 篇`);
      const fill = bar.querySelector<HTMLElement>('span');
      if (fill) fill.style.width = `${p.pct}%`;
    }
    const txt = box.querySelector<HTMLElement>('[data-progress-text]');
    if (txt) txt.textContent = p.done ? `全部读完 · ${p.total} / ${p.total} 篇` : `已读 ${p.read} / ${p.total} 篇（${p.pct}%）`;
    const go = box.querySelector<HTMLAnchorElement>('[data-progress-go]');
    if (go) {
      const label = go.querySelector('span');
      if (p.done) {
        go.href = items[0]?.querySelector<HTMLAnchorElement>('a')?.href ?? go.href;
        if (label) label.textContent = '再读一遍';
      } else if (p.next && p.started) {
        const a = items[p.next.index - 1]?.querySelector<HTMLAnchorElement>('a');
        if (a) go.href = a.href;
        if (label) label.textContent = `继续读第 ${p.next.index} 篇`;
      }
      go.dataset.next = String(p.next?.index ?? 0);
    }
    items.forEach((li, i) => {
      const st = p.states[i]!;
      li.dataset.state = st;
      const tag = li.querySelector<HTMLElement>('[data-state]');
      if (tag) {
        tag.textContent = STATE_LABEL[st];
        tag.hidden = st === 'unread';
      }
    });
  }
  root.querySelectorAll<HTMLButtonElement>('.js-series-print').forEach((b) => {
    if (b.dataset.ready) return;
    b.dataset.ready = '1';
    b.addEventListener('click', () => window.print());
  });
}
