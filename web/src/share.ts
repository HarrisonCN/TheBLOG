/**
 * 分享面板：复制链接、系统分享（Web Share API，支持时连海报图片一起分享）、
 * 在浏览器里生成分享海报（封面 + 标题 + 摘要 + 二维码，canvas 绘制，不经过任何服务器）并下载。
 * 二维码用 uqr（MIT，零依赖）；这个模块按需加载，只有打开分享面板时才下载。
 */
import { encode } from 'uqr';
import { icon } from './icons';
import { flashResult } from './result-icon';

export interface ShareInfo {
  title: string;
  url: string;
  summary: string;
  cover?: string | null;
  site: string;
  author: string;
  date: string;
  category?: string | null;
}

/** 二维码矩阵（含 2 格静区），供绘制与单测使用。 */
export function qrMatrix(text: string): boolean[][] {
  return encode(text, { ecc: 'M', border: 2 }).data;
}

/** 按宽度断行（中文逐字、英文按词），最多 maxLines 行，超出加省略号。 */
export function wrapText(measure: (s: string) => number, text: string, width: number, maxLines: number): string[] {
  const tokens = text.match(/[A-Za-z0-9_.,:;!?'"()\-–—/@#&%+]+\s*|\s+|./gu) ?? [];
  const lines: string[] = [];
  let cur = '';
  for (const t of tokens) {
    if (measure(cur + t) <= width || !cur) {
      cur += t;
      continue;
    }
    lines.push(cur.trimEnd());
    cur = t.trimStart();
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur.trimEnd());
  const used = lines.join('').replace(/\s/g, '').length;
  if (used < text.replace(/\s/g, '').length && lines.length) {
    let last = lines[lines.length - 1]!;
    while (last && measure(`${last}…`) > width) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last}…`;
  }
  return lines.slice(0, maxLines);
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
    setTimeout(() => resolve(null), 6000);
  });
}

const W = 1080;
const H = 1440;
/** 画海报，返回 canvas（跨域封面无法读取时用渐变代替，保证能导出 PNG）。 */
export async function drawPoster(info: ShareInfo, dark = false): Promise<HTMLCanvasElement> {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const bg = dark ? '#0f1625' : '#ffffff';
  const fg = dark ? '#f2f5fb' : '#0f172a';
  const muted = dark ? '#9aa6ba' : '#5d6879';
  const accent = dark ? '#8aafff' : '#2563eb';
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // 封面
  const coverH = 640;
  const grad = g.createLinearGradient(0, 0, W, coverH);
  grad.addColorStop(0, '#2f6bff');
  grad.addColorStop(1, '#7aa7ff');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, coverH);
  if (info.cover) {
    const img = await loadImage(info.cover);
    if (img) {
      const r = Math.max(W / img.naturalWidth, coverH / img.naturalHeight);
      const w = img.naturalWidth * r;
      const h = img.naturalHeight * r;
      g.drawImage(img, (W - w) / 2, (coverH - h) / 2, w, h);
      // 跨域图片会污染画布：检测一下，污染了就退回渐变
      try {
        g.getImageData(0, 0, 1, 1);
      } catch {
        g.fillStyle = grad;
        g.fillRect(0, 0, W, coverH);
      }
    }
  }
  const shade = g.createLinearGradient(0, coverH * 0.55, 0, coverH);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = shade;
  g.fillRect(0, 0, W, coverH);
  const serif = '"Blog Serif", "Noto Serif SC", "Songti SC", "STSong", serif';
  const sans = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';
  // 分类
  let y = coverH + 84;
  if (info.category) {
    g.font = `600 30px ${sans}`;
    const tw = g.measureText(info.category).width;
    g.fillStyle = dark ? 'rgba(138,175,255,0.16)' : '#e8f0ff';
    roundRect(g, 72, y - 40, tw + 40, 54, 27);
    g.fill();
    g.fillStyle = accent;
    g.fillText(info.category, 92, y - 3);
    y += 54;
  }
  // 标题
  g.fillStyle = fg;
  g.font = `700 64px ${serif}`;
  const titleLines = wrapText((s) => g.measureText(s).width, info.title, W - 144, 3);
  for (const line of titleLines) {
    y += 78;
    g.fillText(line, 72, y);
  }
  // 摘要
  g.fillStyle = muted;
  g.font = `400 32px ${sans}`;
  y += 26;
  for (const line of wrapText((s) => g.measureText(s).width, info.summary, W - 144, 3)) {
    y += 50;
    g.fillText(line, 72, y);
  }
  // 底栏：站点 + 作者 + 日期，右侧二维码
  const qrSize = 220;
  const qx = W - 72 - qrSize;
  const qy = H - 72 - qrSize;
  g.strokeStyle = dark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.08)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(72, qy - 40);
  g.lineTo(W - 72, qy - 40);
  g.stroke();
  g.fillStyle = fg;
  g.font = `700 44px ${serif}`;
  g.fillText(info.site, 72, qy + 70);
  g.fillStyle = muted;
  g.font = `400 30px ${sans}`;
  g.fillText(`${info.author} · ${info.date}`, 72, qy + 126);
  g.fillStyle = accent;
  g.font = `600 28px ${sans}`;
  g.fillText('长按或扫码阅读全文 →', 72, qy + 186);
  // 二维码（白底，深色模式下也保证能扫）
  g.fillStyle = '#ffffff';
  roundRect(g, qx - 12, qy - 12, qrSize + 24, qrSize + 24, 20);
  g.fill();
  const m = qrMatrix(info.url);
  const cell = qrSize / m.length;
  g.fillStyle = '#0f172a';
  m.forEach((row, r) =>
    row.forEach((on, col) => {
      if (on) g.fillRect(qx + col * cell, qy + r * cell, Math.ceil(cell), Math.ceil(cell));
    }),
  );
  return c;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob | null>((r) => c.toBlob((b) => r(b), 'image/png'));
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
export const posterFileName = (title: string) => `${title.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'poster'}.png`;

/** 打开分享面板（原生 <dialog>：焦点圈在里面，Esc 关闭）。 */
export async function openShareDialog(info: ShareInfo, notify: (m: string, t?: 'success' | 'error' | 'info') => void): Promise<void> {
  document.getElementById('share-dlg')?.remove();
  const canShare = typeof navigator.share === 'function';
  document.body.insertAdjacentHTML(
    'beforeend',
    `<dialog class="share-dlg" id="share-dlg" aria-labelledby="share-dlg-t">
  <div class="share-dlg__head"><h2 id="share-dlg-t">${icon('send')}分享这篇文章</h2><button class="icon-btn js-share-close" type="button" aria-label="关闭">${icon('close')}</button></div>
  <div class="share-dlg__body">
    <figure class="share-dlg__poster" aria-busy="true"><div class="share-dlg__ph">正在生成海报…</div></figure>
    <div class="share-dlg__side">
      <p class="share-dlg__title">${esc(info.title)}</p>
      <label class="share-dlg__url"><span class="visually-hidden">文章链接</span><input type="text" readonly value="${esc(info.url)}"></label>
      <div class="share-dlg__btns">
        <button class="btn btn--sm js-share-copy" type="button">${icon('copy')}复制链接</button>
        ${canShare ? `<button class="btn btn--sm btn--soft js-share-native" type="button">${icon('external')}系统分享</button>` : ''}
        <button class="btn btn--sm btn--soft js-share-dl" type="button" disabled>${icon('image')}下载海报</button>
      </div>
      <p class="share-dlg__note muted">海报在你的浏览器里生成，包含标题、摘要和指向本文的二维码。</p>
    </div>
  </div>
</dialog>`,
  );
  const dlg = document.getElementById('share-dlg') as HTMLDialogElement;
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (ev) => {
    if (ev.target === dlg) dlg.close(); // 点遮罩关闭
  });
  dlg.querySelector('.js-share-close')!.addEventListener('click', () => dlg.close());
  dlg.showModal();
  let blob: Blob | null = null;
  dlg.querySelector('.js-share-copy')!.addEventListener('click', () => {
    const input = dlg.querySelector<HTMLInputElement>('.share-dlg__url input')!;
    input.select();
    void (navigator.clipboard?.writeText(info.url) ?? Promise.reject())
      .then(() => (flashResult(dlg.querySelector<HTMLElement>('.js-share-copy')!, 'success'), notify('链接已复制', 'success')))
      .catch(() => (flashResult(dlg.querySelector<HTMLElement>('.js-share-copy')!, 'error'), notify('请手动复制输入框里的链接', 'info')));
  });
  dlg.querySelector('.js-share-native')?.addEventListener('click', () => {
    const file = blob ? new File([blob], posterFileName(info.title), { type: 'image/png' }) : null;
    const data: ShareData = { title: info.title, text: info.summary, url: info.url };
    if (file && navigator.canShare?.({ files: [file] })) data.files = [file];
    void navigator.share(data).catch(() => undefined);
  });
  const dl = dlg.querySelector<HTMLButtonElement>('.js-share-dl')!;
  dl.addEventListener('click', () => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = posterFileName(info.title);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
  try {
    const canvas = await drawPoster(info, document.documentElement.dataset.theme === 'dark');
    blob = await toBlob(canvas);
    const fig = dlg.querySelector<HTMLElement>('.share-dlg__poster')!;
    if (blob) {
      const u = URL.createObjectURL(blob);
      fig.innerHTML = `<img src="${u}" alt="分享海报：${esc(info.title)}" width="${W}" height="${H}">`;
      dlg.addEventListener('close', () => URL.revokeObjectURL(u));
      dl.disabled = false;
    }
    fig.removeAttribute('aria-busy');
  } catch {
    dlg.querySelector('.share-dlg__ph')!.textContent = '海报生成失败，可以先复制链接分享';
  }
}
