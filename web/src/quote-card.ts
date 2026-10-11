/**
 * 引用卡片图片（点击「生成引用卡片」后才加载）：在 canvas 上画出摘录 + 来源 + 站名，
 * 预览在对话框里，可以下载 PNG、调用系统分享（支持文件分享的浏览器）或复制文字。不用任何外部服务。
 */
import { icon } from './icons';
import { wrapText } from './essay-core';

export interface QuoteCardOpts {
  text: string;
  source: string;
  site: string;
  url: string;
  opener?: HTMLElement | null;
  notify: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

export const CARD_W = 1080;
export const CARD_H = 1350;
const SERIF = '"Noto Serif SC", "Songti SC", "STSong", "SimSun", serif';
const SANS = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

/** 画卡片；返回 canvas（测试里可以替换 measure）。 */
export function drawQuoteCard(c: HTMLCanvasElement, o: Pick<QuoteCardOpts, 'text' | 'source' | 'site' | 'url'>, dark = false): HTMLCanvasElement {
  c.width = CARD_W;
  c.height = CARD_H;
  const g = c.getContext('2d');
  if (!g) return c;
  const bg = g.createLinearGradient(0, 0, CARD_W, CARD_H);
  bg.addColorStop(0, dark ? '#0f172a' : '#f8fafc');
  bg.addColorStop(1, dark ? '#1e293b' : '#e0ecff');
  g.fillStyle = bg;
  g.fillRect(0, 0, CARD_W, CARD_H);
  // 左上的引号
  g.fillStyle = dark ? '#60a5fa' : '#2563eb';
  g.font = `bold 220px ${SERIF}`;
  g.fillText('“', 70, 260);
  // 正文
  const fg = dark ? '#f1f5f9' : '#0f172a';
  const size = o.text.length > 80 ? 46 : o.text.length > 40 ? 56 : 68;
  g.font = `600 ${size}px ${SERIF}`;
  g.fillStyle = fg;
  const lines = wrapText(o.text, CARD_W - 220, (t) => g.measureText(t).width, 12);
  const lh = Math.round(size * 1.6);
  let y = Math.max(360, Math.round(CARD_H / 2 - (lines.length * lh) / 2));
  for (const l of lines) {
    g.fillText(l, 110, y);
    y += lh;
  }
  // 来源
  if (o.source) {
    g.font = `500 38px ${SANS}`;
    g.fillStyle = dark ? '#cbd5e1' : '#334155';
    const src = wrapText(`—— ${o.source}`, CARD_W - 220, (t) => g.measureText(t).width, 2);
    y += 30;
    for (const l of src) {
      g.fillText(l, 110, y);
      y += 54;
    }
  }
  // 页脚：站名 + 链接
  g.fillStyle = dark ? '#334155' : '#cbd5e1';
  g.fillRect(110, CARD_H - 170, CARD_W - 220, 2);
  g.font = `600 34px ${SANS}`;
  g.fillStyle = fg;
  g.fillText(o.site, 110, CARD_H - 110);
  g.font = `400 26px ${SANS}`;
  g.fillStyle = dark ? '#94a3b8' : '#475569';
  const u = o.url.replace(/^https?:\/\//, '');
  g.fillText(u.length > 60 ? `${u.slice(0, 59)}…` : u, 110, CARD_H - 66);
  return c;
}

export function openQuoteCard(o: QuoteCardOpts): void {
  const dark = document.documentElement.dataset.theme === 'dark';
  const canvas = drawQuoteCard(document.createElement('canvas'), o, dark);
  let dataUrl = '';
  try {
    dataUrl = canvas.toDataURL('image/png');
  } catch {
    o.notify('这个浏览器不能生成图片', 'error');
    return;
  }
  const d = document.createElement('dialog');
  d.className = 'qc-dialog';
  d.setAttribute('aria-labelledby', 'qc-title');
  const canShare = typeof navigator.share === 'function';
  d.innerHTML = `<div class="qc-dialog__box">
<h2 class="qc-dialog__t" id="qc-title">引用卡片</h2>
<img class="qc-dialog__img" alt="" width="${CARD_W}" height="${CARD_H}">
<div class="qc-dialog__bar">
<a class="btn btn--primary js-qc-dl" download="quote.png">${icon('arrowDown')}下载 PNG</a>
${canShare ? `<button type="button" class="btn btn--soft js-qc-share">${icon('external')}分享</button>` : ''}
<button type="button" class="btn btn--soft js-qc-copy">${icon('copy')}复制文字</button>
<button type="button" class="btn btn--ghost js-qc-close">${icon('close')}关闭</button>
</div></div>`;
  const im = d.querySelector<HTMLImageElement>('.qc-dialog__img')!;
  im.src = dataUrl;
  im.alt = `引用卡片：${o.text}${o.source ? ` —— ${o.source}` : ''}`;
  d.querySelector<HTMLAnchorElement>('.js-qc-dl')!.href = dataUrl;
  const close = () => d.close();
  d.addEventListener('close', () => {
    d.remove();
    o.opener?.focus();
  });
  d.addEventListener('click', (ev) => {
    if (ev.target === d) close();
  });
  d.querySelector('.js-qc-close')!.addEventListener('click', close);
  d.querySelector('.js-qc-copy')!.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`「${o.text}」${o.source ? `—— ${o.source}` : ''}\n${o.url}`);
      o.notify('已复制引用文字', 'success');
    } catch {
      o.notify('复制失败，请手动选择文字', 'error');
    }
  });
  d.querySelector('.js-qc-share')?.addEventListener('click', async () => {
    try {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      const file = blob ? new File([blob], 'quote.png', { type: 'image/png' }) : null;
      if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: o.source || o.site, text: o.text });
      else await navigator.share({ title: o.source || o.site, text: `「${o.text}」`, url: o.url });
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') o.notify('分享失败，可以先下载图片', 'warning');
    }
  });
  document.body.append(d);
  d.showModal();
  d.querySelector<HTMLElement>('.js-qc-dl')?.focus();
}
