/**
 * 极简语法高亮（无依赖，浏览器与预渲染共用）：只做关键词 / 字符串 / 注释 / 数字 / 标签几类，
 * 输出 <span class="tk-*">，输入先整体转义，所以结果里除了这些 span 不会有别的标签。
 * 支持：js / ts / jsx / tsx / json / css / html / xml / bash / sh / shell / python / py / yaml / sql。
 */
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

type Rule = [cls: string, re: RegExp];

const JS_KW = 'await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|interface|let|new|of|return|static|super|switch|this|throw|try|type|typeof|var|void|while|yield|async|as|implements|enum|readonly|public|private|protected|declare|satisfies|keyof';
const JS_LIT = 'true|false|null|undefined|NaN|Infinity';
const PY_KW = 'and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|self';
const SH_KW = 'if|then|else|elif|fi|for|while|do|done|case|esac|in|function|export|local|return|echo|cd|sudo|npm|npx|pnpm|yarn|git|node|curl|wrangler';
const SQL_KW = 'select|from|where|insert|into|values|update|set|delete|create|table|index|if|not|exists|primary|key|integer|text|default|on|conflict|do|order|by|limit|and|or|join|left|inner|as|group|having|returning|references|unique|null|check|in';

const C_STR: Rule = ['str', /^(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/];
const NUM: Rule = ['num', /^(?:0x[\da-f]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)\b/i];

const LANGS: Record<string, Rule[]> = {
  js: [
    ['com', /^(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/],
    C_STR,
    ['kw', new RegExp(`^(?:${JS_KW})\\b`)],
    ['lit', new RegExp(`^(?:${JS_LIT})\\b`)],
    NUM,
    ['fn', /^[A-Za-z_$][\w$]*(?=\s*\()/],
    ['typ', /^[A-Z][\w$]*/],
  ],
  json: [['key', /^"(?:[^"\\\n]|\\.)*"(?=\s*:)/], ['str', /^"(?:[^"\\\n]|\\.)*"/], ['lit', /^(?:true|false|null)\b/], NUM],
  css: [
    ['com', /^\/\*[\s\S]*?\*\//],
    C_STR,
    ['kw', /^@[\w-]+/],
    ['key', /^[\w-]+(?=\s*:[^:])/],
    ['num', /^#[\da-f]{3,8}\b|^-?\d*\.?\d+(?:px|rem|em|vh|vw|%|s|ms|deg|fr)?\b/i],
    ['fn', /^[\w-]+(?=\()/],
  ],
  html: [
    ['com', /^<!--[\s\S]*?-->/],
    ['tag', /^<\/?[A-Za-z][\w:-]*/],
    ['tag', /^\/?>/],
    ['key', /^[\w:-]+(?==)/],
    ['str', /^"[^"]*"|^'[^']*'/],
  ],
  bash: [['com', /^#[^\n]*/], C_STR, ['kw', new RegExp(`^(?:${SH_KW})\\b`)], ['key', /^--?[\w-]+/], ['lit', /^\$\{?[\w@#?$!*-]+\}?/], NUM],
  python: [['com', /^#[^\n]*/], ['str', /^(?:"""[\s\S]*?"""|'''[\s\S]*?''')/], C_STR, ['kw', new RegExp(`^(?:${PY_KW})\\b`)], ['lit', /^(?:True|False|None)\b/], NUM, ['fn', /^[A-Za-z_]\w*(?=\s*\()/]],
  yaml: [['com', /^#[^\n]*/], ['key', /^[\w.-]+(?=\s*:(?:\s|$))/], C_STR, ['lit', /^(?:true|false|null|yes|no)\b/], NUM],
  sql: [['com', /^--[^\n]*/], C_STR, ['kw', new RegExp(`^(?:${SQL_KW})\\b`, 'i')], NUM],
};
const ALIAS: Record<string, string> = {
  javascript: 'js', mjs: 'js', cjs: 'js', ts: 'js', typescript: 'js', jsx: 'js', tsx: 'js',
  jsonc: 'json', json5: 'json', scss: 'css', less: 'css', xml: 'html', svg: 'html', vue: 'html',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', py: 'python', yml: 'yaml', toml: 'yaml', sqlite: 'sql',
};
/** 显示用的语言名 */
const LABEL: Record<string, string> = { js: 'JS', json: 'JSON', css: 'CSS', html: 'HTML', bash: 'Shell', python: 'Python', yaml: 'YAML', sql: 'SQL' };

export function langOf(info: string | undefined): string | null {
  const l = (info ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (!l) return null;
  const k = ALIAS[l] ?? l;
  return LANGS[k] ? k : null;
}

export function langLabel(info: string | undefined): string {
  const raw = (info ?? '').trim().split(/\s+/)[0] ?? '';
  const k = langOf(raw);
  if (k && /^(ts|typescript|tsx|jsx)$/i.test(raw)) return raw.toUpperCase() === 'TYPESCRIPT' ? 'TS' : raw.toUpperCase();
  return k ? LABEL[k]! : raw.replace(/[^\w+#.-]/g, '').slice(0, 12);
}

/** 返回转义并高亮后的 HTML（不含外层 <pre><code>）。不认识的语言只转义。 */
export function highlight(code: string, info?: string): string {
  const k = langOf(info);
  if (!k || code.length > 60_000) return escapeHtml(code);
  const rules = LANGS[k]!;
  let out = '';
  let plain = '';
  let i = 0;
  const flush = () => {
    if (plain) out += escapeHtml(plain);
    plain = '';
  };
  while (i < code.length) {
    const rest = code.slice(i);
    // 单词中间不开始匹配（避免 "format" 里的 "for"）
    const prev = code[i - 1] ?? '';
    const midWord = /[\w$]/.test(prev);
    let hit: [string, string] | null = null;
    if (!midWord || /^["'`#/<>]/.test(rest)) {
      for (const [cls, re] of rules) {
        const m = re.exec(rest);
        if (m && m[0]) {
          hit = [cls, m[0]];
          break;
        }
      }
    }
    if (hit) {
      flush();
      out += `<span class="tk-${hit[0]}">${escapeHtml(hit[1])}</span>`;
      i += hit[1].length;
    } else {
      // 一次吃掉一个完整单词，避免在单词内部触发规则
      const w = /^[\w$]+|^[\s\S]/.exec(rest)![0];
      plain += w;
      i += w.length;
    }
  }
  flush();
  return out;
}
