/**
 * Markdown → HTML，结构上安全：
 * - 原始 HTML（块级与行内）一律转义，不会被当作标签；
 * - 链接只允许 http(s)、mailto、站内路径与锚点；图片只允许 http(s)、站内路径与位图 base64 data URL；
 * - 外链加 rel="noopener noreferrer nofollow"。
 * 浏览器端再经过 DOMPurify（见 sanitize.ts）做第二道防线；预渲染（Node）依赖本模块本身的安全性。
 */
import { Marked, type Tokens } from 'marked';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const LINK_OK = /^(https?:\/\/|mailto:|\/(?!\/)|#)/i;
const IMG_OK = /^(https?:\/\/|\/(?!\/))/i;
/** 位图 data URL（演示模式里上传的图片存在浏览器本地）；不允许 SVG 等可携带脚本的类型。 */
const DATA_IMG_OK = /^data:image\/(png|jpeg|webp|gif|avif);base64,[a-z0-9+/]+=*$/i;

export function safeHref(href: string | null | undefined, img = false): string | null {
  if (!href) return null;
  const h = href.trim();
  // 去掉控制字符后再判断，防止 "java\tscript:" 之类绕过
  if (/[\u0000-\u001f\u007f]/.test(h)) return null;
  if (img && DATA_IMG_OK.test(h)) return h;
  return (img ? IMG_OK : LINK_OK).test(h) ? h : null;
}

let headingIds = new Map<string, number>();
/** 标题锚点：保留中文等字母数字，重复时加序号（每次渲染重置）。 */
export function headingId(text: string): string {
  const base = 'h-' + (text.toLowerCase().replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'section');
  const n = headingIds.get(base) ?? 0;
  headingIds.set(base, n + 1);
  return n ? `${base}-${n}` : base;
}

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    heading(this: any, token: Tokens.Heading) {
      const text = this.parser.parseInline(token.tokens);
      return `<h${token.depth} id="${escapeHtml(headingId(token.text))}">${text}</h${token.depth}>\n`;
    },
    html(token: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(token.text);
    },
    link(this: any, token: Tokens.Link) {
      const text = this.parser.parseInline(token.tokens);
      const href = safeHref(token.href);
      if (!href) return text;
      const external = /^https?:\/\//i.test(href);
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
      return `<a href="${escapeHtml(href)}"${title}${external ? ' target="_blank" rel="noopener noreferrer nofollow"' : ''}>${text}</a>`;
    },
    image(token: Tokens.Image) {
      const src = safeHref(token.href, true);
      if (!src) return escapeHtml(token.text);
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(token.text)}"${title} loading="lazy" decoding="async">`;
    },
  },
});

export function renderMarkdown(md: string): string {
  headingIds = new Map();
  return marked.parse(md ?? '', { async: false }) as string;
}

/** 纯文本摘录（用于 meta description 等）。 */
export function plainText(md: string, max = 160): string {
  const t = (md ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
