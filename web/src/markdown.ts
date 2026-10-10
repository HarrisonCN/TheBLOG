/**
 * Markdown → HTML，结构上安全：
 * - 原始 HTML（块级与行内）一律转义，不会被当作标签；
 * - 链接只允许 http(s)、mailto、站内路径与锚点；图片只允许 http(s)、站内路径与位图 base64 data URL；
 * - 外链加 rel="noopener noreferrer nofollow"。
 * 浏览器端再经过 DOMPurify（见 sanitize.ts）做第二道防线；预渲染（Node）依赖本模块本身的安全性。
 */
import { Marked, type Tokens } from 'marked';
import { highlight, langLabel } from './highlight';

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

// ---------------------------------------------------------------- 脚注 [^id] / [^id]: 文字
const FN_ID = '[A-Za-z0-9_-]{1,30}';
let fnKnown = new Set<string>();
let fnOrder: string[] = [];
let fnRefs = new Map<string, number>();
let fnDefs = new Map<string, string>();
const fnNum = (id: string) => fnOrder.indexOf(id) + 1;

const footnotes = {
  extensions: [
    {
      name: 'footnoteDef',
      level: 'block' as const,
      start(src: string) {
        return /^\[\^/m.exec(src)?.index;
      },
      tokenizer(this: any, src: string) {
        const m = new RegExp(`^\\[\\^(${FN_ID})\\]:[ \\t]+([^\\n]+(?:\\n(?: {2,}|\\t)[^\\n]+)*)(?:\\n+|$)`).exec(src);
        if (!m) return undefined;
        const text = m[2]!.replace(/\n\s+/g, ' ');
        return { type: 'footnoteDef', raw: m[0], id: m[1], tokens: this.lexer.inlineTokens(text) };
      },
      renderer(this: any, t: any) {
        if (!fnDefs.has(t.id)) fnDefs.set(t.id, this.parser.parseInline(t.tokens));
        return '';
      },
    },
    {
      name: 'footnoteRef',
      level: 'inline' as const,
      start(src: string) {
        const i = src.indexOf('[^');
        return i < 0 ? undefined : i;
      },
      tokenizer(src: string) {
        const m = new RegExp(`^\\[\\^(${FN_ID})\\]`).exec(src);
        if (!m || !fnKnown.has(m[1]!)) return undefined;
        return { type: 'footnoteRef', raw: m[0], id: m[1] };
      },
      renderer(t: any) {
        if (!fnOrder.includes(t.id)) fnOrder.push(t.id);
        const n = fnNum(t.id);
        const k = (fnRefs.get(t.id) ?? 0) + 1;
        fnRefs.set(t.id, k);
        return `<sup class="fn-ref" id="fnref-${n}${k > 1 ? `-${k}` : ''}"><a href="#fn-${n}" data-fn="${n}" aria-label="脚注 ${n}">[${n}]</a></sup>`;
      },
    },
  ],
};

function footnoteSection(): string {
  const items = fnOrder.filter((id) => fnDefs.has(id));
  if (!items.length) return '';
  return `<section class="footnotes" aria-label="脚注"><h2 class="footnotes__title">脚注</h2><ol>${items
    .map((id) => {
      const n = fnNum(id);
      return `<li id="fn-${n}"><p>${fnDefs.get(id)} <a href="#fnref-${n}" class="fn-back" aria-label="返回正文第 ${n} 处引用">↩</a></p></li>`;
    })
    .join('')}</ol></section>`;
}

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    // 单独一行的图片 → <figure> + 图注（title 优先，其次 alt）
    paragraph(this: any, token: Tokens.Paragraph) {
      const only = token.tokens.filter((t) => !(t.type === 'text' && !t.raw.trim()));
      if (only.length === 1 && only[0]!.type === 'image') {
        const im = only[0] as Tokens.Image;
        const cap = (im.title || im.text || '').trim();
        const html = this.parser.parseInline(token.tokens);
        if (html.startsWith('<img')) return `<figure class="figure">${html}${cap ? `<figcaption>${escapeHtml(cap)}</figcaption>` : ''}</figure>\n`;
      }
      return `<p>${this.parser.parseInline(token.tokens)}</p>\n`;
    },
    heading(this: any, token: Tokens.Heading) {
      const text = this.parser.parseInline(token.tokens);
      return `<h${token.depth} id="${escapeHtml(headingId(token.text))}">${text}</h${token.depth}>\n`;
    },
    // 代码块：语言标签 + 轻量高亮；复制按钮由浏览器端加上（DOMPurify 不允许正文里出现 <button>）
    code(token: Tokens.Code) {
      const label = langLabel(token.lang);
      return `<pre class="code" tabindex="0"${label ? ` data-lang="${escapeHtml(label)}"` : ''}><code>${highlight(token.text.replace(/\n$/, ''), token.lang)}</code></pre>\n`;
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

marked.use(footnotes);

export function renderMarkdown(md: string): string {
  headingIds = new Map();
  const src = md ?? '';
  fnKnown = new Set([...src.matchAll(new RegExp(`^\\[\\^(${FN_ID})\\]:[ \\t]+\\S`, 'gm'))].map((m) => m[1]!));
  fnOrder = [];
  fnRefs = new Map();
  fnDefs = new Map();
  const html = marked.parse(src, { async: false }) as string;
  return html + footnoteSection();
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
