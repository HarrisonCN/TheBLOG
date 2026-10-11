/**
 * Markdown → HTML，结构上安全：
 * - 原始 HTML（块级与行内）一律转义，不会被当作标签；
 * - 链接只允许 http(s)、mailto、站内路径与锚点；图片只允许 http(s)、站内路径与位图 base64 data URL；
 * - 外链加 rel="noopener noreferrer nofollow"。
 * 浏览器端再经过 DOMPurify（见 sanitize.ts）做第二道防线；预渲染（Node）依赖本模块本身的安全性。
 */
import { Marked, type Tokens } from 'marked';
import { highlight, langLabel } from './highlight';
import { parseAudioBlock, parseMapBlock, parseNotesBlock, parseQuoteSource } from './essay-core';
import { shotNotesHtml } from './essay-view';

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


// ---------------------------------------------------------------- ::: 嵌入块
/**
 * :::tip|warn|note [标题]   提示 / 注意 / 备注
 * :::details 摘要           折叠块
 * :::compare [图注]          两张图（前 / 后）的对比滑块，脚本加载后才出现滑块，否则并排显示
 * :::audio                  src / title / artist / credit / link，点播放交给左下角音乐播放器（不自动播放）
 * :::map 地名               下一行「纬度, 经度」，只保留 0.1°（约 11 km）
 * :::quote 来源 | 链接       摘录卡片，可生成分享图片
 * :::notes [标题]            拍摄手记：地点 / 光线 / 器材 / 参数 / 想法
 * 块以单独一行的 ::: 结束，可以嵌套（例如折叠块里放提示）。
 */
export const EMBED_KINDS = ['tip', 'warn', 'note', 'details', 'compare', 'audio', 'map', 'quote', 'notes'] as const;
const CALLOUT_LABEL: Record<string, string> = { tip: '提示', warn: '注意', note: '备注' };
const OPEN_RE = new RegExp(`^:::(${EMBED_KINDS.join('|')})(?:[ \\t]+([^\\n]*))?[ \\t]*(?:\\n|$)`);
const IMG_RE = /!\[([^\]\n]*)\]\(\s*([^\s)]+)(?:\s+"([^"\n]*)")?\s*\)/g;

function splitContainer(src: string): { raw: string; kind: string; title: string; body: string } | null {
  const m = OPEN_RE.exec(src);
  if (!m) return null;
  let pos = m[0].length;
  let depth = 1;
  const lineRe = /^.*(?:\n|$)/gm;
  lineRe.lastIndex = pos;
  let line: RegExpExecArray | null;
  while (pos < src.length && (line = lineRe.exec(src))) {
    if (!line[0]) break;
    const t = line[0].replace(/\n$/, '');
    if (/^:::[a-z]+/.test(t)) depth++;
    else if (/^:::\s*$/.test(t)) depth--;
    pos = line.index + line[0].length;
    if (depth === 0) return { raw: src.slice(0, pos), kind: m[1]!, title: (m[2] ?? '').trim(), body: src.slice(m[0].length, line.index).replace(/\n$/, '') };
    lineRe.lastIndex = pos;
  }
  return null; // 没有结束标记：按普通文字处理
}
const embedError = (msg: string) => `<p class="embed-error" role="note">${escapeHtml(msg)}</p>\n`;

const containers = {
  extensions: [
    {
      name: 'container',
      level: 'block' as const,
      start(src: string) {
        return /^:::[a-z]/m.exec(src)?.index;
      },
      tokenizer(this: any, src: string) {
        const c = splitContainer(src);
        if (!c) return undefined;
        const tok: any = { type: 'container', raw: c.raw, kind: c.kind, title: c.title, body: c.body, tokens: [] };
        if (['tip', 'warn', 'note', 'details', 'quote'].includes(c.kind)) tok.tokens = this.lexer.blockTokens(c.body, []);
        return tok;
      },
      renderer(this: any, t: any) {
        const title = escapeHtml(String(t.title).slice(0, 80));
        switch (t.kind) {
          case 'tip':
          case 'warn':
          case 'note':
            return `<div class="callout callout--${t.kind}" role="note" aria-label="${CALLOUT_LABEL[t.kind]}"><p class="callout__t">${title || CALLOUT_LABEL[t.kind]}</p><div class="callout__b">${this.parser.parse(t.tokens)}</div></div>\n`;
          case 'details':
            return `<details class="md-details"><summary>${title || '展开'}</summary><div class="md-details__b">${this.parser.parse(t.tokens)}</div></details>\n`;
          case 'quote': {
            const q = parseQuoteSource(t.title);
            const cite = q.source ? (q.link ? `<a href="${escapeHtml(q.link)}"${/^https?:/i.test(q.link) ? ' target="_blank" rel="noopener noreferrer nofollow"' : ''}><cite>${escapeHtml(q.source)}</cite></a>` : `<cite>${escapeHtml(q.source)}</cite>`) : '';
            return `<figure class="quote-card" data-quote><blockquote class="quote-card__q">${this.parser.parse(t.tokens)}</blockquote>${cite ? `<figcaption class="quote-card__src">— ${cite}</figcaption>` : ''}</figure>\n`;
          }
          case 'compare': {
            const imgs = [...String(t.body).matchAll(IMG_RE)].slice(0, 2).map((m) => ({ alt: m[1] ?? '', src: safeHref(m[2], true), label: (m[3] ?? '').trim() }));
            if (imgs.length < 2 || !imgs[0]!.src || !imgs[1]!.src) return embedError('对比块需要两张图片（前 / 后）');
            const [a, b] = imgs as { alt: string; src: string; label: string }[];
            const la = escapeHtml(a!.label || '前');
            const lb = escapeHtml(b!.label || '后');
            return `<figure class="compare" data-compare data-label-a="${la}" data-label-b="${lb}"><div class="compare__stage"><img class="compare__img compare__img--a" src="${escapeHtml(a!.src)}" alt="${escapeHtml(a!.alt)}" loading="lazy" decoding="async"><img class="compare__img compare__img--b" src="${escapeHtml(b!.src)}" alt="${escapeHtml(b!.alt)}" loading="lazy" decoding="async"><span class="compare__tag compare__tag--a">${la}</span><span class="compare__tag compare__tag--b">${lb}</span></div>${title ? `<figcaption>${title}</figcaption>` : ''}</figure>\n`;
          }
          case 'audio': {
            const a = parseAudioBlock(t.body);
            if (!a) return embedError('音频块需要 src（https 链接或本站上传的音频）');
            const d = (k: string, v: string) => (v ? ` data-${k}="${escapeHtml(v)}"` : '');
            return `<div class="audio-embed" data-audio${d('src', a.src)}${d('title', a.title)}${d('artist', a.artist)}${d('credit', a.credit)}${d('link', a.link)}><span class="audio-embed__disc" aria-hidden="true"></span><div class="audio-embed__meta"><b class="audio-embed__t">${escapeHtml(a.title)}</b>${a.artist ? `<span class="audio-embed__a">${escapeHtml(a.artist)}</span>` : ''}${a.credit ? `<small class="audio-embed__c">${a.link ? `<a href="${escapeHtml(a.link)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(a.credit)}</a>` : escapeHtml(a.credit)}</small>` : ''}</div><a class="audio-embed__open" href="${escapeHtml(a.src)}" target="_blank" rel="noopener noreferrer nofollow">打开音频</a></div>\n`;
          }
          case 'map': {
            const p = parseMapBlock(t.title, t.body);
            if (!p) return embedError('地图块格式：:::map 地名，下一行写「纬度, 经度」');
            return `<figure class="map-pin" data-map data-lat="${p.lat}" data-lng="${p.lng}"><div class="map-pin__stage" aria-hidden="true"></div><figcaption class="map-pin__cap"><b>${escapeHtml(p.place)}</b><span class="map-pin__acc">约 11 km 精度</span></figcaption></figure>\n`;
          }
          case 'notes': {
            const n = parseNotesBlock(t.body);
            if (!n.note) return embedError('拍摄手记块是空的，或地点写成了坐标');
            return shotNotesHtml(n.note, t.title || '拍摄手记') + '\n';
          }
        }
        return '';
      },
    },
  ],
};

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
marked.use(containers);

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
    .replace(/^:::.*$/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
