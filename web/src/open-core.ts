/**
 * L20 开放创作者网络（OPEN CREATOR NETWORK）的纯函数：Worker 与前端演示 mock 共用
 * （web/src/open-core.ts 为同内容副本，改动需同步；测试会比对）。
 * - 微格式 mf2 解析（h-entry / h-card / rels）、链接提取、Webmention 端点发现、输入校验与类型判定
 * - 订阅源构建：RSS 2.0 / Atom 1.0 / JSON Feed 1.1
 * - MCP 权限分层（read-public < author < moderator < admin）与每个工具需要的最低权限
 * - AI 辅助的本地确定性回退（抽取式摘要、按话题匹配标签、提纲草稿）
 * - 邮件摘要订阅、GitHub 仓库元数据、开放接口游标
 * 不依赖 DOM / Node / Workers API。
 */

export type Check<T> = { ok: true; value: T } | { ok: false; path: string; error: string };
const bad = (path: string, error: string): { ok: false; path: string; error: string } => ({ ok: false, path, error });

// ============================================================ HTML 解析（够 mf2 用的最小实现）
export interface HNode {
  tag: string;
  attrs: Record<string, string>;
  children: (HNode | string)[];
}
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'param']);
const RAW = new Set(['script', 'style', 'template', 'textarea', 'title']);
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', '#39': "'" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8}|#39);/gi, (m, g: string) => {
    const k = g.toLowerCase();
    if (k[0] === '#') {
      const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENT[k] ?? m;
  });
}
function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const k = m[1]!.toLowerCase();
    if (!(k in out)) out[k] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}
/** 把 HTML 解析成一棵简单的树（容错：多余的结束标签忽略，未闭合的元素在父元素结束时一并结束）。 */
export function parseHtml(html: string): HNode {
  const root: HNode = { tag: '#root', attrs: {}, children: [] };
  const stack: HNode[] = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const top = () => stack[stack.length - 1]!;
  const text = (s: string) => {
    if (s) top().children.push(decodeEntities(s));
  };
  while ((m = re.exec(html))) {
    text(html.slice(last, m.index));
    last = re.lastIndex;
    if (!m[2]) continue; // 注释 / doctype
    const tag = m[2].toLowerCase();
    if (m[1]) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]!.tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const rawAttrs = m[3] ?? '';
    const node: HNode = { tag, attrs: parseAttrs(rawAttrs.replace(/\/\s*$/, '')), children: [] };
    top().children.push(node);
    if (VOID.has(tag) || /\/\s*$/.test(rawAttrs)) continue;
    if (RAW.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, last);
      const stop = end < 0 ? html.length : end;
      if (tag === 'title' || tag === 'textarea') node.children.push(decodeEntities(html.slice(last, stop)));
      const close = end < 0 ? html.length : html.indexOf('>', end) + 1 || html.length;
      last = close;
      re.lastIndex = close;
      continue;
    }
    stack.push(node);
  }
  text(html.slice(last));
  return root;
}
const isEl = (n: HNode | string): n is HNode => typeof n !== 'string';
export function textOf(n: HNode | string): string {
  if (typeof n === 'string') return n;
  if (n.tag === 'script' || n.tag === 'style' || n.tag === 'template') return '';
  if (n.tag === 'img') return n.attrs.alt ?? '';
  if (n.tag === 'br') return '\n';
  return n.children.map(textOf).join('');
}
const squash = (s: string) => s.replace(/[ \t\r\f\v\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => escHtml(s).replace(/"/g, '&quot;');
export function htmlOf(n: HNode | string): string {
  if (typeof n === 'string') return escHtml(n);
  const inner = n.children.map(htmlOf).join('');
  if (n.tag === '#root') return inner;
  const a = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
  return VOID.has(n.tag) ? `<${n.tag}${a}>` : `<${n.tag}${a}>${inner}</${n.tag}>`;
}
export function walkEls(n: HNode, fn: (el: HNode) => void): void {
  for (const c of n.children) if (isEl(c)) {
    fn(c);
    walkEls(c, fn);
  }
}

// ============================================================ URL 工具
export function absUrl(href: string, base: string): string | null {
  try {
    const u = new URL(href.trim(), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}
/** 比较用的规范化：去掉 #片段、默认端口、末尾斜杠，主机名小写。 */
export function normUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = '';
    let s = `${x.protocol}//${x.host.toLowerCase()}${x.pathname}${x.search}`;
    if (s.endsWith('/') && x.pathname !== '/') s = s.slice(0, -1);
    if (x.pathname === '/' && !x.search) s = s.replace(/\/$/, '');
    return s;
  } catch {
    return u;
  }
}
export const sameUrl = (a: string, b: string) => normUrl(a) === normUrl(b);
/** 不允许 Worker 去抓取的地址（SSRF 防护）：本机、内网、链路本地、保留域名。 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || h === '0.0.0.0') return true;
  if (h === '::1' || h === '::' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h) || /^::ffff:/.test(h)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  return false;
}

// ============================================================ 微格式 mf2
export interface Mf2Item {
  type: string[];
  properties: Record<string, Mf2Value[]>;
  children?: Mf2Item[];
  value?: string;
  id?: string;
}
export type Mf2Value = string | { html: string; value: string } | Mf2Item;
export interface Mf2Doc {
  items: Mf2Item[];
  rels: Record<string, string[]>;
}
const H_RE = /^h-(?:[a-z0-9]+-)?[a-z]+(?:-[a-z]+)*$/;
const P_RE = /^(p|u|dt|e)-((?:[a-z0-9]+-)?[a-z]+(?:-[a-z]+)*)$/;
const classesOf = (el: HNode) => (el.attrs.class ?? '').split(/\s+/).filter(Boolean);
const hTypes = (el: HNode) => [...new Set(classesOf(el).filter((c) => H_RE.test(c)))].sort();
const pProps = (el: HNode) => classesOf(el).map((c) => P_RE.exec(c)).filter((x): x is RegExpExecArray => !!x).map((x) => ({ prefix: x[1] as 'p' | 'u' | 'dt' | 'e', name: x[2]! }));

function pValue(el: HNode): string {
  if ((el.tag === 'img' || el.tag === 'area') && 'alt' in el.attrs) return el.attrs.alt!;
  if (el.tag === 'abbr' && el.attrs.title) return el.attrs.title;
  if ((el.tag === 'data' || el.tag === 'input') && 'value' in el.attrs) return el.attrs.value!;
  return squash(textOf(el));
}
function uValue(el: HNode, base: string): string {
  const pick = (v?: string) => (v !== undefined ? (absUrl(v, base) ?? v) : undefined);
  if ((el.tag === 'a' || el.tag === 'area' || el.tag === 'link') && 'href' in el.attrs) return pick(el.attrs.href)!;
  if (['img', 'audio', 'video', 'source', 'iframe'].includes(el.tag) && 'src' in el.attrs) return pick(el.attrs.src)!;
  if (el.tag === 'video' && el.attrs.poster) return pick(el.attrs.poster)!;
  if (el.tag === 'object' && el.attrs.data) return pick(el.attrs.data)!;
  if (el.tag === 'abbr' && el.attrs.title) return el.attrs.title;
  if ((el.tag === 'data' || el.tag === 'input') && 'value' in el.attrs) return el.attrs.value!;
  return squash(textOf(el));
}
function dtValue(el: HNode): string {
  if (['time', 'ins', 'del'].includes(el.tag) && el.attrs.datetime) return el.attrs.datetime;
  if (el.tag === 'abbr' && el.attrs.title) return el.attrs.title;
  if ((el.tag === 'data' || el.tag === 'input') && 'value' in el.attrs) return el.attrs.value!;
  return squash(textOf(el));
}
function propValue(prefix: 'p' | 'u' | 'dt' | 'e', el: HNode, base: string): Mf2Value {
  if (prefix === 'p') return pValue(el);
  if (prefix === 'u') return uValue(el, base);
  if (prefix === 'dt') return dtValue(el);
  return { html: el.children.map(htmlOf).join('').trim(), value: squash(textOf(el)) };
}
const elChildren = (el: HNode) => el.children.filter(isEl);
function walkProps(el: HNode, item: Mf2Item, base: string): void {
  for (const c of elChildren(el)) {
    const types = hTypes(c);
    const props = pProps(c);
    if (types.length) {
      const sub = parseItem(c, base);
      if (props.length) {
        for (const p of props) {
          const v: Mf2Item = { ...sub };
          const first = sub.properties[p.prefix === 'u' ? 'url' : 'name']?.[0];
          v.value = typeof first === 'string' ? first : squash(textOf(c));
          (item.properties[p.name] ??= []).push(v);
        }
      } else (item.children ??= []).push(sub);
      continue;
    }
    for (const p of props) (item.properties[p.name] ??= []).push(propValue(p.prefix, c, base));
    walkProps(c, item, base);
  }
}
function parseItem(el: HNode, base: string): Mf2Item {
  const item: Mf2Item = { type: hTypes(el), properties: {} };
  if (el.attrs.id) item.id = el.attrs.id;
  walkProps(el, item, base);
  const keys = Object.keys(item.properties);
  const has = (prefix: string) => {
    // 只看本元素直接解析出的属性前缀：判断隐含属性时近似用「是否已有任何 p-/e- 或 u- 属性」
    let found = false;
    walkEls(el, (d) => {
      if (!found && pProps(d).some((p) => (prefix === 'p' ? p.prefix === 'p' || p.prefix === 'e' : p.prefix === prefix))) found = true;
    });
    return found;
  };
  if (!keys.includes('name') && !has('p') && !item.children?.length) {
    const n = el.tag === 'img' || el.tag === 'area' ? (el.attrs.alt ?? '') : el.tag === 'abbr' && el.attrs.title ? el.attrs.title : squash(textOf(el));
    if (n) item.properties.name = [n];
  }
  if (!keys.includes('photo') && !has('u')) {
    let src: string | undefined;
    if (el.tag === 'img') src = el.attrs.src;
    else {
      const imgs = elChildren(el).filter((c) => c.tag === 'img' && !hTypes(c).length);
      if (imgs.length === 1) src = imgs[0]!.attrs.src;
    }
    const u = src ? absUrl(src, base) : null;
    if (u) item.properties.photo = [u];
  }
  if (!keys.includes('url') && !has('u')) {
    let href: string | undefined;
    if ((el.tag === 'a' || el.tag === 'area') && el.attrs.href) href = el.attrs.href;
    else {
      const as = elChildren(el).filter((c) => c.tag === 'a' && c.attrs.href && !hTypes(c).length);
      if (as.length === 1) href = as[0]!.attrs.href;
    }
    const u = href ? absUrl(href, base) : null;
    if (u) item.properties.url = [u];
  }
  return item;
}
/** 解析整页 HTML 的微格式（mf2 子集：h-*、p-/u-/dt-/e- 属性、隐含 name/photo/url、rels）。 */
export function parseMf2(html: string, base: string): Mf2Doc {
  const root = parseHtml(html);
  let baseHref = base;
  walkEls(root, (el) => {
    if (el.tag === 'base' && el.attrs.href && baseHref === base) baseHref = absUrl(el.attrs.href, base) ?? base;
  });
  const items: Mf2Item[] = [];
  const rels: Record<string, string[]> = {};
  const scan = (n: HNode) => {
    for (const c of elChildren(n)) {
      if (hTypes(c).length) items.push(parseItem(c, baseHref));
      else scan(c);
    }
  };
  scan(root);
  walkEls(root, (el) => {
    if ((el.tag === 'a' || el.tag === 'link' || el.tag === 'area') && el.attrs.rel && 'href' in el.attrs) {
      const u = absUrl(el.attrs.href!, baseHref);
      if (!u) return;
      for (const r of el.attrs.rel.toLowerCase().split(/\s+/).filter(Boolean)) if (!(rels[r] ??= []).includes(u)) rels[r]!.push(u);
    }
  });
  return { items, rels };
}
/** 找第一个 h-entry（顶层或 h-feed 里）。 */
export function findEntry(doc: Mf2Doc): Mf2Item | null {
  const visit = (list: Mf2Item[]): Mf2Item | null => {
    for (const it of list) {
      if (it.type.includes('h-entry')) return it;
      const sub = visit(it.children ?? []);
      if (sub) return sub;
    }
    return null;
  };
  return visit(doc.items);
}
const str = (v: Mf2Value | undefined): string => (v === undefined ? '' : typeof v === 'string' ? v : 'type' in v ? (v.value ?? (typeof v.properties.url?.[0] === 'string' ? (v.properties.url[0] as string) : '')) : v.value);
const urlsOf = (vals: Mf2Value[] | undefined): string[] =>
  (vals ?? []).flatMap((v) => (typeof v === 'string' ? [v] : 'type' in v ? [...(v.properties.url ?? []).map((x) => str(x)), v.value ?? ''] : [v.value])).filter(Boolean);

// ============================================================ 链接与 Webmention
/** 页面里的全部外链（a/area href、媒体 src、引用 cite），绝对地址、去重。 */
export function extractLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  walkEls(parseHtml(html), (el) => {
    const v = el.tag === 'a' || el.tag === 'area' ? el.attrs.href : ['img', 'video', 'audio', 'source'].includes(el.tag) ? el.attrs.src : el.tag === 'blockquote' || el.tag === 'q' ? el.attrs.cite : undefined;
    const u = v ? absUrl(v, base) : null;
    if (u) out.add(u);
  });
  return [...out];
}
/** Markdown / 纯文本里的 http(s) 链接（发送 Webmention 用：站长文章、会员作品的正文）。 */
export function extractTextLinks(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'()\[\]{}]+[^\s<>"'()\[\]{}.,;:!?。，；：！？）】」]/g)) {
    const u = absUrl(m[0], 'http://invalid/');
    if (u) out.add(u);
  }
  return [...out];
}
export const linksTo = (links: string[], target: string) => links.some((l) => sameUrl(l, target));
/** Webmention 端点发现：先看 HTTP Link 头，再看页面里第一个 rel=webmention 的 link / a。 */
export function discoverEndpoint(linkHeader: string | null, html: string, pageUrl: string): string | null {
  if (linkHeader) {
    for (const part of linkHeader.split(/,(?=\s*<)/)) {
      const m = /<([^>]*)>\s*;(.*)$/.exec(part.trim());
      if (!m) continue;
      const rel = /rel\s*=\s*(?:"([^"]*)"|([^\s;,]+))/i.exec(m[2]!);
      if (rel && (rel[1] ?? rel[2] ?? '').toLowerCase().split(/\s+/).includes('webmention')) return absUrl(m[1]!, pageUrl);
    }
  }
  let found: string | null = null;
  walkEls(parseHtml(html), (el) => {
    if (found !== null || (el.tag !== 'link' && el.tag !== 'a') || !('href' in el.attrs)) return;
    if ((el.attrs.rel ?? '').toLowerCase().split(/\s+/).includes('webmention')) found = absUrl(el.attrs.href!, pageUrl) ?? '';
  });
  return found || null;
}

export const WM_TYPES = ['reply', 'like', 'repost', 'bookmark', 'mention'] as const;
export type WmType = (typeof WM_TYPES)[number];
export const WM_TYPE_LABEL: Record<WmType, string> = { reply: '回复', like: '喜欢', repost: '转发', bookmark: '收藏', mention: '提及' };
export const WM_STATUSES = ['pending', 'approved', 'rejected', 'spam', 'invalid'] as const;
export type WmStatus = (typeof WM_STATUSES)[number] | 'queued';
export const WM_LIMITS = { perIpPerHour: 20, perHostPerHour: 10, maxBytes: 512 * 1024, timeoutMs: 5000, maxRedirects: 3, contentChars: 500, maxAttempts: 3 };
export const WM_TARGET_KINDS = ['post', 'work', 'user', 'project'] as const;
export type WmTargetKind = (typeof WM_TARGET_KINDS)[number];
export interface WmTarget { kind: WmTargetKind; ref: string }
export interface WmAuthor { name: string; url: string; photo: string }
export interface WmParsed { type: WmType; author: WmAuthor; content: string; published: string; url: string }

/** 站内地址 → 可以接收 Webmention 的对象（文章 / 作品 / 主页 / 项目；也接受 Worker 的 h-entry 页面）。 */
export function targetOf(target: string, siteUrls: string[]): WmTarget | null {
  let u: URL;
  try {
    u = new URL(target);
  } catch {
    return null;
  }
  for (const s of siteUrls) {
    let b: URL;
    try {
      b = new URL(s);
    } catch {
      continue;
    }
    if (b.host.toLowerCase() !== u.host.toLowerCase() || b.protocol !== u.protocol) continue;
    const basePath = b.pathname.replace(/\/?$/, '/');
    if (!u.pathname.startsWith(basePath) && !u.pathname.startsWith('/api/open/h/')) continue;
    const rest = u.pathname.startsWith('/api/open/h/') ? u.pathname.slice('/api/open/h/'.length).replace(/^posts\//, 'posts/').replace(/^works\//, 'w/').replace(/^users\//, 'u/') : u.pathname.slice(basePath.length);
    const p = rest.replace(/\/+$/, '');
    let m = /^posts\/([a-z0-9-]{1,80})$/.exec(p);
    if (m) return { kind: 'post', ref: m[1]! };
    m = /^w\/(\d{1,10})$/.exec(p);
    if (m) return { kind: 'work', ref: m[1]! };
    m = /^u\/([A-Za-z0-9_]{3,20})$/.exec(p);
    if (m) return { kind: 'user', ref: m[1]!.toLowerCase() };
    m = /^p\/([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)$/.exec(p);
    if (m) return { kind: 'project', ref: m[1]! };
  }
  return null;
}
export function checkWebmention(input: unknown, siteUrls: string[]): Check<{ source: string; target: string; to: WmTarget }> {
  const o = (input ?? {}) as Record<string, unknown>;
  const src = typeof o.source === 'string' ? o.source.trim() : '';
  const tgt = typeof o.target === 'string' ? o.target.trim() : '';
  if (!src || src.length > 2000) return bad('source', 'source 必须是 http(s) 地址');
  if (!tgt || tgt.length > 2000) return bad('target', 'target 必须是 http(s) 地址');
  const source = absUrl(src, 'http://invalid/');
  const target = absUrl(tgt, 'http://invalid/');
  if (!source || !/^https?:\/\//i.test(src)) return bad('source', 'source 必须是 http(s) 地址');
  if (!target || !/^https?:\/\//i.test(tgt)) return bad('target', 'target 必须是 http(s) 地址');
  if (sameUrl(source, target)) return bad('source', 'source 和 target 不能相同');
  const to = targetOf(target, siteUrls);
  if (!to) return bad('target', 'target 不是本站可以接收 Webmention 的页面');
  return { ok: true, value: { source, target, to } };
}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const httpOnly = (u: string) => (/^https?:\/\//i.test(u) ? u.slice(0, 500) : '');
/** 判定一条 Webmention：页面必须链接到 target；按 h-entry 的 in-reply-to / like-of / repost-of / bookmark-of 分类，作者取 h-card。 */
export function interpretMention(html: string, source: string, target: string): { linked: boolean; parsed: WmParsed } {
  const linked = linksTo(extractLinks(html, source), target);
  const doc = parseMf2(html, source);
  const entry = findEntry(doc);
  const host = (() => {
    try {
      return new URL(source).host;
    } catch {
      return source;
    }
  })();
  let type: WmType = 'mention';
  let author: WmAuthor = { name: host, url: '', photo: '' };
  let content = '';
  let published = '';
  let url = source;
  if (entry) {
    const pr = entry.properties;
    if (urlsOf(pr['in-reply-to']).some((u) => sameUrl(u, target))) type = 'reply';
    else if (urlsOf(pr['like-of']).some((u) => sameUrl(u, target))) type = 'like';
    else if (urlsOf(pr['repost-of']).some((u) => sameUrl(u, target))) type = 'repost';
    else if (urlsOf(pr['bookmark-of']).some((u) => sameUrl(u, target))) type = 'bookmark';
    const a = pr.author?.[0] ?? doc.items.find((i) => i.type.includes('h-card'));
    if (a && typeof a === 'object' && 'type' in a) {
      author = { name: clip(str(a.properties.name?.[0]) || host, 80), url: httpOnly(str(a.properties.url?.[0])), photo: httpOnly(str(a.properties.photo?.[0])) };
    } else if (typeof a === 'string' && a) author = { name: clip(a, 80), url: /^https?:/.test(a) ? a : '', photo: '' };
    const c = pr.content?.[0] ?? pr.summary?.[0] ?? pr.name?.[0];
    content = clip(squash(str(c)), WM_LIMITS.contentChars);
    published = str(pr.published?.[0]).slice(0, 40);
    url = httpOnly(str(pr.url?.[0])) || source;
  } else {
    const t = parseHtml(html);
    let title = '';
    walkEls(t, (el) => {
      if (!title && el.tag === 'title') title = squash(textOf(el));
    });
    content = clip(title, 200);
  }
  return { linked, parsed: { type, author, content, published, url } };
}
/** 简单的垃圾判定：链接过多 / 关键词。命中 → spam（不进审核队列，只在后台「垃圾」里可见）。 */
export function looksSpammy(html: string, content: string): boolean {
  const links = (html.match(/<a\s/gi) ?? []).length;
  return links > 200 || /\b(viagra|casino|porn|loan offer|crypto airdrop)\b/i.test(content) || /(博彩|代开发票|色情|赌场)/.test(content);
}

// ============================================================ 订阅源
export interface FeedMeta { title: string; description: string; homeUrl: string; author: { name: string; url?: string }; updated?: string; icon?: string }
export interface FeedItem { id: string; url: string; title: string; summary: string; contentHtml?: string; published: string; updated?: string; author?: { name: string; url?: string }; tags?: string[]; image?: string }
export type FeedFormat = 'rss' | 'atom' | 'json';
export const FEED_TYPES: Record<FeedFormat, string> = { rss: 'application/rss+xml; charset=utf-8', atom: 'application/atom+xml; charset=utf-8', json: 'application/feed+json; charset=utf-8' };
export const FEED_LABEL: Record<FeedFormat, string> = { rss: 'RSS 2.0', atom: 'Atom', json: 'JSON Feed' };
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '');
const iso = (s: string | undefined, fb: string) => {
  const d = new Date(s ?? '');
  return Number.isNaN(d.getTime()) ? fb : d.toISOString();
};
const latest = (meta: FeedMeta, items: FeedItem[], now: string) => items.map((i) => iso(i.updated ?? i.published, now)).sort().at(-1) ?? iso(meta.updated, now);
export function rssFeed(meta: FeedMeta, items: FeedItem[], selfUrl: string, now = new Date().toISOString()): string {
  const body = items
    .map((i) => {
      const d = new Date(i.published);
      return `    <item>
      <title>${xml(i.title || clip(i.summary, 60) || '无标题')}</title>
      <link>${xml(i.url)}</link>
      <guid isPermaLink="${i.id === i.url}">${xml(i.id)}</guid>
      <description>${xml(i.summary)}</description>
${Number.isNaN(d.getTime()) ? '' : `      <pubDate>${d.toUTCString()}</pubDate>\n`}${i.author ? `      <dc:creator>${xml(i.author.name)}</dc:creator>\n` : ''}${(i.tags ?? []).map((t) => `      <category>${xml(t)}</category>\n`).join('')}${i.image ? `      <enclosure url="${xml(i.image)}" length="0" type="${/\.png(\?|$)/i.test(i.image) ? 'image/png' : /\.webp(\?|$)/i.test(i.image) ? 'image/webp' : 'image/jpeg'}"/>\n` : ''}    </item>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${xml(meta.title)}</title>
    <link>${xml(meta.homeUrl)}</link>
    <description>${xml(meta.description || meta.title)}</description>
    <language>zh-CN</language>
    <atom:link href="${xml(selfUrl)}" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${new Date(latest(meta, items, now)).toUTCString()}</lastBuildDate>
${body}
  </channel>
</rss>
`;
}
export function atomFeed(meta: FeedMeta, items: FeedItem[], selfUrl: string, now = new Date().toISOString()): string {
  const body = items
    .map(
      (i) => `  <entry>
    <title>${xml(i.title || clip(i.summary, 60) || '无标题')}</title>
    <id>${xml(i.id)}</id>
    <link rel="alternate" type="text/html" href="${xml(i.url)}"/>
    <published>${iso(i.published, now)}</published>
    <updated>${iso(i.updated ?? i.published, now)}</updated>
${i.author ? `    <author><name>${xml(i.author.name)}</name>${i.author.url ? `<uri>${xml(i.author.url)}</uri>` : ''}</author>\n` : ''}    <summary type="text">${xml(i.summary)}</summary>
${i.contentHtml ? `    <content type="html">${xml(i.contentHtml)}</content>\n` : ''}${(i.tags ?? []).map((t) => `    <category term="${xml(t)}"/>\n`).join('')}  </entry>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="zh-CN">
  <title>${xml(meta.title)}</title>
  <subtitle>${xml(meta.description || meta.title)}</subtitle>
  <id>${xml(meta.homeUrl)}</id>
  <link rel="alternate" type="text/html" href="${xml(meta.homeUrl)}"/>
  <link rel="self" type="application/atom+xml" href="${xml(selfUrl)}"/>
  <updated>${latest(meta, items, now)}</updated>
  <author><name>${xml(meta.author.name)}</name>${meta.author.url ? `<uri>${xml(meta.author.url)}</uri>` : ''}</author>
${meta.icon ? `  <icon>${xml(meta.icon)}</icon>\n` : ''}${body}
</feed>
`;
}
export function jsonFeedOf(meta: FeedMeta, items: FeedItem[], selfUrl: string): string {
  return JSON.stringify(
    {
      version: 'https://jsonfeed.org/version/1.1',
      title: meta.title,
      description: meta.description,
      home_page_url: meta.homeUrl,
      feed_url: selfUrl,
      language: 'zh-CN',
      authors: [{ name: meta.author.name, ...(meta.author.url ? { url: meta.author.url } : {}) }],
      ...(meta.icon ? { icon: meta.icon } : {}),
      items: items.map((i) => ({
        id: i.id,
        url: i.url,
        title: i.title || undefined,
        summary: i.summary,
        ...(i.contentHtml ? { content_html: i.contentHtml } : { content_text: i.summary || i.title }),
        date_published: iso(i.published, new Date(0).toISOString()),
        ...(i.updated ? { date_modified: iso(i.updated, new Date(0).toISOString()) } : {}),
        ...(i.author ? { authors: [{ name: i.author.name, ...(i.author.url ? { url: i.author.url } : {}) }] } : {}),
        ...(i.tags?.length ? { tags: i.tags } : {}),
        ...(i.image ? { image: i.image } : {}),
      })),
    },
    null,
    2,
  );
}
export function buildFeed(fmt: FeedFormat, meta: FeedMeta, items: FeedItem[], selfUrl: string, now?: string): string {
  return fmt === 'rss' ? rssFeed(meta, items, selfUrl, now) : fmt === 'atom' ? atomFeed(meta, items, selfUrl, now) : jsonFeedOf(meta, items, selfUrl);
}
export const FEED_MAX_ITEMS = 30;
export const FEED_FILE: Record<FeedFormat, string> = { rss: 'rss.xml', atom: 'atom.xml', json: 'feed.json' };
export type FeedScope = { kind: 'site' } | { kind: 'user'; ref: string } | { kind: 'topic'; ref: string } | { kind: 'project'; ref: string };
/** 订阅源地址：apiBase 非空 → Worker 动态源（/api/feeds/…）；否则是演示站构建时生成的静态文件（base 下 feeds/…）。 */
export function feedPath(scope: FeedScope, fmt: FeedFormat, o: { apiBase?: string | null; base: string }): string {
  if (o.apiBase !== null && o.apiBase !== undefined) {
    const ext = fmt === 'json' ? 'json' : fmt;
    const p = scope.kind === 'site' ? `site.${ext}` : `${scope.kind === 'user' ? 'users' : scope.kind === 'topic' ? 'topics' : 'projects'}/${scope.ref}.${ext}`;
    return `${o.apiBase.replace(/\/+$/, '')}/api/feeds/${p}`;
  }
  const b = o.base.replace(/\/?$/, '/');
  if (scope.kind === 'site') return `${b}${FEED_FILE[fmt]}`;
  return `${b}feeds/${scope.kind}/${scope.ref}/${FEED_FILE[fmt]}`;
}

// ============================================================ MCP 权限分层
export const MCP_SCOPES = ['read-public', 'author', 'moderator', 'admin'] as const;
export type McpScope = (typeof MCP_SCOPES)[number];
export const SCOPE_LABEL: Record<McpScope, string> = { 'read-public': '只读公开内容', author: '管理自己的内容', moderator: '社区审核', admin: '站长（全部工具）' };
export const SCOPE_NOTE: Record<McpScope, string> = {
  'read-public': '只能读取公开文章、作品、话题和主页；不能写入任何东西。',
  author: '在只读之外，可以创建、修改、发布和删除你自己的作品；碰不到别人的内容。',
  moderator: '在作者权限之外，可以查看审核队列并处理作品 / 评论 / Webmention。需要站长授予审核员身份。',
  admin: '全部站长工具（文章、设置、站点内容）。需要站长身份。',
};
export const scopeRank = (s: McpScope) => MCP_SCOPES.indexOf(s);
export const scopeAllows = (have: McpScope, need: McpScope) => scopeRank(have) >= scopeRank(need);
export type MemberRole = 'member' | 'moderator' | 'admin';
export const ROLE_LABEL: Record<MemberRole, string> = { member: '好朋友', moderator: '审核员', admin: '站长' };
export const maxScopeFor = (role: MemberRole): McpScope => (role === 'admin' ? 'admin' : role === 'moderator' ? 'moderator' : 'author');
export const scopesFor = (role: MemberRole): McpScope[] => MCP_SCOPES.filter((s) => scopeAllows(maxScopeFor(role), s));
export const MCP_TOKEN_RE = /^mcp_[A-Za-z0-9_-]{32,64}$/;
export const MCP_LIMITS = { active: 10, createPerDay: 10, callsPerMinute: 60, auditKeep: 200 };
export const TOKEN_TTLS = [7, 30, 90, 365, 0] as const;
/** 每个 MCP 工具需要的最低权限（Worker 的 TOOLS 与演示 mock 都按这张表把关；表里没有的工具一律视为 admin）。 */
export const TOOL_SCOPES: Record<string, McpScope> = {
  // read-public：公开内容（只读）
  search_public_works: 'read-public',
  get_public_work: 'read-public',
  list_public_posts: 'read-public',
  get_public_profile: 'read-public',
  list_topics: 'read-public',
  whoami: 'read-public',
  // author：只能动自己的作品
  list_my_works: 'author',
  get_my_work: 'author',
  create_my_work: 'author',
  update_my_work: 'author',
  publish_my_work: 'author',
  delete_my_work: 'author',
  // moderator：审核队列
  list_moderation_queue: 'moderator',
  moderate_content: 'moderator',
  list_webmentions: 'moderator',
  moderate_webmention: 'moderator',
  list_guestbook: 'moderator',
  moderate_guestbook: 'moderator',
  list_sticky_notes: 'moderator',
  moderate_sticky_note: 'moderator',
};
export const toolScope = (name: string): McpScope => TOOL_SCOPES[name] ?? 'admin';
export function checkTokenInput(input: unknown, role: MemberRole): Check<{ name: string; scope: McpScope; ttlDays: number }> {
  const o = (input ?? {}) as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  if (!name || name.length > 40 || /[\u0000-\u001f<>]/.test(name)) return bad('name', '令牌名称 1–40 个字符');
  if (!MCP_SCOPES.includes(o.scope as McpScope)) return bad('scope', `scope 只能是 ${MCP_SCOPES.join(' / ')}`);
  const scope = o.scope as McpScope;
  if (!scopeAllows(maxScopeFor(role), scope)) return bad('scope', `你的身份（${ROLE_LABEL[role]}）最多只能创建「${SCOPE_LABEL[maxScopeFor(role)]}」令牌`);
  const ttl = o.ttlDays === undefined ? 90 : o.ttlDays;
  if (!TOKEN_TTLS.includes(ttl as (typeof TOKEN_TTLS)[number])) return bad('ttlDays', '有效期只能是 7 / 30 / 90 / 365 天或 0（不过期）');
  return { ok: true, value: { name, scope, ttlDays: ttl as number } };
}

// ============================================================ AI 辅助（可选；本地确定性回退）
export const AI_KINDS = ['summary', 'tags', 'draft'] as const;
export type AiKind = (typeof AI_KINDS)[number];
export const AI_KIND_LABEL: Record<AiKind, string> = { summary: '摘要', tags: '标签', draft: '草稿提纲' };
export const AI_LABEL = 'AI 建议';
export const AI_NOTE = 'AI 生成的建议，可能不准确。只有你点「采用」后才会填进表单，发布前还需要再确认一次；AI 不会替你发布、评论或点赞。';
export const AI_LIMITS = { perHour: 20, maxBody: 20000 };
export interface AiInput { kind: AiKind; title: string; body: string }
export function checkAiInput(input: unknown): Check<AiInput> {
  const o = (input ?? {}) as Record<string, unknown>;
  if (!AI_KINDS.includes(o.kind as AiKind)) return bad('kind', 'kind 只能是 summary / tags / draft');
  const title = typeof o.title === 'string' ? o.title.trim().slice(0, 120) : '';
  const body = typeof o.body === 'string' ? o.body : '';
  if (body.length > AI_LIMITS.maxBody) return bad('body', '正文太长了');
  if ((title + body).replace(/\s+/g, '').length < 4) return bad('body', '先写几句内容，再请 AI 给建议');
  return { ok: true, value: { kind: o.kind as AiKind, title, body } };
}
const stripMd = (s: string) =>
  s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>~]/g, '')
    .replace(/https?:\/\/\S+/g, ' ');
export function sentencesOf(text: string): string[] {
  return stripMd(text)
    .split(/(?<=[。！？!?；;])|\n+|(?<=\.)\s+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.replace(/[\s\p{P}]/gu, '').length >= 4);
}
const STOP = new Set(['我们', '一个', '这个', '那个', '就是', '因为', '所以', '还是', '但是', '然后', '没有', '自己', '什么', '可以', '已经', '时候', 'the', 'and', 'for', 'with', 'that', 'this', 'are', 'was', 'you', 'from']);
function termsOf(s: string): string[] {
  const out: string[] = [];
  for (const w of s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []) if (!STOP.has(w)) out.push(w);
  const cjk = s.replace(/[^\u4e00-\u9fff]+/g, ' ').split(' ').filter(Boolean);
  for (const run of cjk) for (let i = 0; i + 1 < run.length; i++) {
    const bg = run.slice(i, i + 2);
    if (!STOP.has(bg)) out.push(bg);
  }
  return out;
}
/** 抽取式摘要：按词频给句子打分（首句加分），取最高的两句按原顺序拼接；结果完全确定。 */
export function extractiveSummary(title: string, body: string, maxChars = 120): string {
  const sents = sentencesOf(body);
  if (!sents.length) return clip(title, maxChars);
  const freq = new Map<string, number>();
  for (const t of termsOf(`${title} ${title} ${body}`)) freq.set(t, (freq.get(t) ?? 0) + 1);
  const scored = sents.map((s, i) => {
    const ts = termsOf(s);
    const score = ts.reduce((a, t) => a + (freq.get(t) ?? 0), 0) / Math.max(4, ts.length) + (i === 0 ? 1.5 : 0) - i * 0.01;
    return { s, i, score };
  });
  const top = [...scored].sort((a, b) => b.score - a.score || a.i - b.i).slice(0, 2).sort((a, b) => a.i - b.i);
  return clip(top.map((x) => x.s).join(' '), maxChars);
}
export interface AiTopic { slug: string; name: string; tags?: string[] }
/** 标签建议：只在站内已有话题里选（名称 / 关联标签出现在标题或正文里），最多 3 个；不会编造新话题。 */
export function suggestTopics(title: string, body: string, topics: AiTopic[], max = 3): { slug: string; name: string; score: number }[] {
  const hay = `${title}\n${title}\n${stripMd(body)}`.toLowerCase();
  const count = (needle: string) => {
    const n = needle.toLowerCase().trim();
    if (n.length < 2) return 0;
    let c = 0;
    for (let i = hay.indexOf(n); i >= 0; i = hay.indexOf(n, i + n.length)) c++;
    return c;
  };
  return topics
    .map((t) => ({ slug: t.slug, name: t.name, score: count(t.name) * 2 + (t.tags ?? []).reduce((a, x) => a + count(x), 0) }))
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
    .slice(0, max);
}
/** 草稿提纲：把已有文字按「缘起 / 过程 / 收获」整理成 Markdown 提纲，只重排用户自己的句子，不新增事实。 */
export function draftOutline(title: string, body: string): string {
  const s = sentencesOf(body);
  const third = Math.max(1, Math.ceil(s.length / 3));
  const part = (i: number) => s.slice(i * third, (i + 1) * third);
  const bullets = (xs: string[], fb: string) => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : `- （${fb}）`);
  return [`# ${title || '无标题'}`, '', '## 缘起', bullets(part(0), '为什么想写 / 拍这个'), '', '## 过程', bullets(part(1), '经过与细节'), '', '## 收获', bullets(part(2), '想留下的感受')].join('\n');
}
export interface AiSuggestion { kind: AiKind; text: string; tags: { slug: string; name: string }[]; provider: string; label: string; note: string; generated: true }
export function localSuggest(inp: AiInput, topics: AiTopic[]): AiSuggestion {
  const base = { kind: inp.kind, provider: 'local', label: AI_LABEL, note: AI_NOTE, generated: true as const };
  if (inp.kind === 'summary') return { ...base, text: extractiveSummary(inp.title, inp.body), tags: [] };
  if (inp.kind === 'tags') {
    const t = suggestTopics(inp.title, inp.body, topics).map(({ slug, name }) => ({ slug, name }));
    return { ...base, text: t.map((x) => x.name).join('、'), tags: t };
  }
  return { ...base, text: draftOutline(inp.title, inp.body), tags: [] };
}

// ============================================================ 邮件摘要订阅
export const DIGEST_KINDS = ['user', 'topic'] as const;
export type DigestKind = (typeof DIGEST_KINDS)[number];
export const DIGEST_FREQS = ['daily', 'weekly'] as const;
export type DigestFreq = (typeof DIGEST_FREQS)[number];
export const FREQ_LABEL: Record<DigestFreq, string> = { daily: '每天', weekly: '每周' };
export const SUB_LIMITS = { max: 50, opsPerHour: 20, itemsPerDigest: 20 };
export function checkSubscription(input: unknown): Check<{ kind: DigestKind; ref: string; frequency: DigestFreq }> {
  const o = (input ?? {}) as Record<string, unknown>;
  if (!DIGEST_KINDS.includes(o.kind as DigestKind)) return bad('kind', 'kind 只能是 user / topic');
  const ref = typeof o.ref === 'string' ? o.ref.trim().toLowerCase() : '';
  if (o.kind === 'user' ? !/^[a-z0-9_]{3,20}$/.test(ref) : !/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(ref)) return bad('ref', o.kind === 'user' ? '用户名无效' : '话题无效');
  const f = o.frequency ?? 'weekly';
  if (!DIGEST_FREQS.includes(f as DigestFreq)) return bad('frequency', 'frequency 只能是 daily / weekly');
  return { ok: true, value: { kind: o.kind as DigestKind, ref, frequency: f as DigestFreq } };
}
export function isDigestDue(lastSent: string | null, createdAt: string, freq: DigestFreq, now: Date): boolean {
  const from = Date.parse(lastSent ?? createdAt);
  if (!Number.isFinite(from)) return true;
  return now.getTime() - from >= (freq === 'daily' ? 86400_000 : 7 * 86400_000) - 60_000;
}
export interface DigestItem { title: string; url: string; author: string; source: string }
export function composeDigest(o: { name: string; siteTitle: string; items: DigestItem[]; manageUrl: string; unsubscribeUrl: string }): { subject: string; text: string } {
  const items = o.items.slice(0, SUB_LIMITS.itemsPerDigest);
  return {
    subject: `${o.siteTitle}：你订阅的 ${items.length} 条新内容`,
    text: [
      `${o.name}，你好：`,
      '',
      '你订阅的创作者 / 话题有这些新的公开内容：',
      '',
      ...items.map((i, n) => `${n + 1}. ${i.title}（${i.author} · ${i.source}）\n   ${i.url}`),
      '',
      `管理订阅：${o.manageUrl}`,
      `一键退订全部邮件摘要：${o.unsubscribeUrl}`,
      '',
      '这封邮件只在你主动订阅后发送；没有新内容时不会发。',
    ].join('\n'),
  };
}

// ============================================================ GitHub 仓库
export const GH_TTL_MS = 60 * 60 * 1000;
export function parseRepoUrl(u: string): { owner: string; repo: string } | null {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec((u ?? '').trim());
  return m && m[2] !== '.' && m[2] !== '..' ? { owner: m[1]!, repo: m[2]! } : null;
}
export interface GhRepo { fullName: string; description: string; htmlUrl: string; stars: number; forks: number; openIssues: number; watchers: number; language: string; license: string; topics: string[]; archived: boolean; pushedAt: string; defaultBranch: string; latestRelease: { tag: string; name: string; publishedAt: string; url: string } | null }
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const s = (v: unknown, n = 300) => (typeof v === 'string' ? v.slice(0, n) : '');
export function normalizeRepo(j: Record<string, any>, rel: Record<string, any> | null): GhRepo {
  return {
    fullName: s(j.full_name, 140),
    description: s(j.description, 300),
    htmlUrl: /^https:\/\/github\.com\//.test(s(j.html_url)) ? s(j.html_url) : '',
    stars: num(j.stargazers_count),
    forks: num(j.forks_count),
    openIssues: num(j.open_issues_count),
    watchers: num(j.subscribers_count ?? j.watchers_count),
    language: s(j.language, 40),
    license: s(j.license?.spdx_id && j.license.spdx_id !== 'NOASSERTION' ? j.license.spdx_id : (j.license?.name ?? ''), 60),
    topics: Array.isArray(j.topics) ? j.topics.filter((t: unknown) => typeof t === 'string').slice(0, 8) : [],
    archived: !!j.archived,
    pushedAt: s(j.pushed_at, 40),
    defaultBranch: s(j.default_branch, 60),
    latestRelease: rel && typeof rel.tag_name === 'string' ? { tag: s(rel.tag_name, 60), name: s(rel.name, 120), publishedAt: s(rel.published_at, 40), url: /^https:\/\/github\.com\//.test(s(rel.html_url)) ? s(rel.html_url) : '' } : null,
  };
}

// ============================================================ 开放接口
export const OPEN_LIMITS = { perMinute: 120, defaultLimit: 20, maxLimit: 50 };
export interface OpenCursor { t: string; id: number }
const b64e = (x: string) => {
  const bytes = new TextEncoder().encode(x);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64d = (x: string) => {
  const bin = atob(x.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};
export const encodeOpenCursor = (c: OpenCursor) => b64e(JSON.stringify([c.t, c.id]));
export function decodeOpenCursor(raw: string | null): OpenCursor | null | 'bad' {
  if (!raw) return null;
  if (raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return 'bad';
  try {
    const v = JSON.parse(b64d(raw)) as unknown;
    if (Array.isArray(v) && typeof v[0] === 'string' && v[0].length <= 40 && Number.isInteger(v[1]) && (v[1] as number) >= 0) return { t: v[0], id: v[1] as number };
  } catch {
    /* fallthrough */
  }
  return 'bad';
}
export function openLimit(raw: string | null): number | 'bad' {
  if (raw === null || raw === '') return OPEN_LIMITS.defaultLimit;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= OPEN_LIMITS.maxLimit ? n : 'bad';
}

// ============================================================ 分享卡片（OG / Twitter）
export interface ShareMeta { title: string; description: string; url: string; image: string; type: 'article' | 'profile' | 'website' }
export function shareTags(m: ShareMeta, siteName: string): string[] {
  const a = (v: string) => escAttr(v);
  return [
    `<meta property="og:site_name" content="${a(siteName)}" />`,
    `<meta property="og:type" content="${m.type}" />`,
    `<meta property="og:title" content="${a(m.title)}" />`,
    `<meta property="og:description" content="${a(clip(m.description, 200))}" />`,
    m.url ? `<meta property="og:url" content="${a(m.url)}" />` : '',
    m.image ? `<meta property="og:image" content="${a(m.image)}" />` : '',
    `<meta name="twitter:card" content="${m.image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${a(m.title)}" />`,
    `<meta name="twitter:description" content="${a(clip(m.description, 200))}" />`,
    m.image ? `<meta name="twitter:image" content="${a(m.image)}" />` : '',
  ].filter(Boolean);
}

/** 采用过 AI 建议的内容：发布（或保存为非草稿）时必须带 aiConfirmed=true，表示作者已检查 AI 生成的部分。 */
export function checkAiPublish(input: unknown, publishing: boolean): Check<boolean> {
  const o = (input ?? {}) as { aiAssisted?: unknown; aiConfirmed?: unknown };
  const ai = o.aiAssisted === true;
  if (ai && publishing && o.aiConfirmed !== true) return bad('aiConfirmed', '这篇内容采用了 AI 建议：发布前请确认你已检查过 AI 生成的部分');
  return { ok: true, value: ai };
}
