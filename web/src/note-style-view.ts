/** 便签文字样式 → 安全的 HTML：只输出白名单类名 + 一个已校验的 #rrggbb 颜色变量，文字全部转义。 */
import { ANIMATED_EFFECTS, normalizeNoteStyle, type NotePaper, type NoteStyle } from './note-style';

import { escapeHtml as esc } from './markdown';

export function noteClasses(s: NoteStyle): string {
  return ['ns', `ns--f-${s.font}`, `ns--s-${s.size}`, s.weight === 'bold' ? 'ns--b' : '', s.italic ? 'ns--i' : '', s.effect !== 'none' ? `ns--fx-${s.effect}` : '', ANIMATED_EFFECTS.includes(s.effect) ? 'ns--anim' : '']
    .filter(Boolean)
    .join(' ');
}

/** 按字拆开（摇摆 / 彩虹需要逐字动画），用 Array.from 保证 emoji / 生僻字不被劈开。 */
function perChar(text: string): string {
  return Array.from(text)
    .map((ch, i) => (ch === ' ' ? ' ' : `<span class="ns__c" style="--i:${i}">${esc(ch)}</span>`))
    .join('');
}

/** 便签正文 HTML。style 可以是任何来自接口的值（会先宽松归一化）。 */
export function noteTextHtml(content: string, style: unknown, paper: NotePaper = 'yellow'): string {
  const s = normalizeNoteStyle(style, paper);
  const body = s.effect === 'wobble' || s.effect === 'rainbow' ? perChar(content) : esc(content);
  const n = Array.from(content).length;
  return `<span class="${noteClasses(s)}" style="--ns-c:${s.color};--ns-n:${Math.max(1, Math.min(60, n))}" data-effect="${s.effect}">${body}</span>`;
}
