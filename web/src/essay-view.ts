/**
 * 拍摄手记卡片、EXIF 条：正文 :::notes 块（Markdown，经过 DOMPurify，所以这里不放 SVG / 按钮）和影集页共用。
 */
import { exifLine, SHOT_NOTE_KEYS, SHOT_NOTE_LABEL, type EssayExif, type ShotNote } from './essay-core';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** 可折叠的拍摄手记卡片（<details>，键盘 / 读屏原生支持）。 */
export function shotNotesHtml(n: ShotNote | null, title = '拍摄手记', open = false): string {
  if (!n) return '';
  const rows = SHOT_NOTE_KEYS.filter((k) => n[k])
    .map((k) => `<div class="shot-notes__row shot-notes__row--${k}"><dt>${SHOT_NOTE_LABEL[k]}</dt><dd>${esc(n[k])}</dd></div>`)
    .join('');
  const hint = [n.place, n.light].filter(Boolean).join(' · ');
  return `<details class="shot-notes"${open ? ' open' : ''}><summary><span class="shot-notes__t">${esc(title)}</span>${hint ? `<span class="shot-notes__hint">${esc(hint)}</span>` : ''}</summary><dl class="shot-notes__dl">${rows}</dl></details>`;
}

/** EXIF 条：「iPhone 15 Pro · 26mm · f/1.8 · 1/120s · ISO 64」+ 拍摄时间。 */
export function exifStripHtml(x: EssayExif | null | undefined): string {
  const line = exifLine(x);
  if (!line && !x?.date) return '';
  return `<p class="exif-strip"><span class="exif-strip__k">EXIF</span>${line ? `<span class="exif-strip__v">${esc(line)}</span>` : ''}${x?.date ? `<time class="exif-strip__d">${esc(x.date)}</time>` : ''}</p>`;
}
