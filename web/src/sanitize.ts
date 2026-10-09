import DOMPurify from 'dompurify';
import { renderMarkdown } from './markdown';

/** 浏览器端：Markdown 渲染后再用 DOMPurify 过一遍。 */
export function renderSafe(md: string): string {
  return DOMPurify.sanitize(renderMarkdown(md), {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'loading', 'decoding'],
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe'],
  });
}
