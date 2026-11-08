/**
 * L55 / v1.55.0 接龙写作页面（纯函数，浏览器和预渲染共用；没有 JS 也完整）：/relay/ 故事卡片（进度「第 N / M 段」、进行中 / 已完成）；/relay/:slug/ 开头提示、规则、段落有序列表（每段作者），进行中的故事 JS 加载后出现「续写下一段」表单（只存在本机）。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { url, type Page, type Route } from './render';
import { chips, ckDetail, ckList } from './ck-view';
import { countText, isDone, MAX_PARA, progressText, type Item, type Summary } from './relay-core';
import type { SiteData } from './types';
void icon; void url; void chips; void e;

const sub = (it: Item) => `接龙写作 · ${it.starter} 发起 · ${progressText(it.paragraphs.length, it.maxTurns)}`;
const attrs = (it: Item) => `data-relay="${e(it.slug)}" data-max="${it.maxTurns}" data-done="${isDone(it) ? 1 : 0}"`;
const meta = (s: Summary) => `${e(s.starter)} 发起 · ${progressText(s.turns, s.maxTurns)} · <span class="rl-state${s.done ? ' is-done' : ''}">${s.done ? '已完成' : '进行中'}</span>`;
function body(it: Item): string {
  const done = isDone(it);
  return `<p class="rl-prompt"><strong>开头提示：</strong>${e(it.prompt)}</p>
<p class="small muted">规则：一人一段，每段不超过 ${MAX_PARA} 字；同一个人不能连续写两段；写满 ${it.maxTurns} 段就完结。</p>
<ol class="rl-paras" role="list" data-rl-paras>${it.paragraphs.map((p) => `<li class="rl-para" id="p-${p.n}" data-author="${e(p.author)}"><p class="rl-text">${e(p.text)}</p><p class="rl-by small muted">第 ${p.n} 段 · ${e(p.author)}</p></li>`).join('')}</ol>
${
  done
    ? `<p class="rl-done" role="note">${icon('check')}<span>这个接龙已经写满 ${it.maxTurns} 段，完结了。</span></p>`
    : `<form class="rl-form" data-rl-form hidden><h2 id="rl-form-h">续写第 ${it.paragraphs.length + 1} 段</h2><p class="small muted">续写只保存在这台设备上，不会提交给别人。</p><label class="rl-field">昵称<input name="author" maxlength="20" autocomplete="nickname" required></label><label class="rl-field">这一段<textarea name="text" rows="4" maxlength="${MAX_PARA + 50}" aria-describedby="rl-count" required></textarea></label><p class="small muted" id="rl-count" data-rl-count>${countText(0)}</p><p><button type="submit" class="btn btn--sm">${icon('edit')}保存续写（本机）</button></p><p class="small" data-rl-msg role="status"></p></form>`
}`;
}
const top = (_l: Summary[]) => '';
const bottom = (_l: Summary[]) => '';
const listAttrs = (_l: Summary[]) => '';

export function detailPage(site: SiteData, route: Extract<Route, { name: 'relaystory' }>, it: Item): Page {
  return ckDetail(site, route, { label: '接龙写作', base: '/relay/', cls: 'rl', title: it.title, summary: it.summary, sub: sub(it), note: '示例接龙：故事和作者都是虚构的演示内容；你的续写只保存在这台设备上，不会提交。', body: body(it), attrs: attrs(it) });
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return ckList(site, route, { label: '接龙写作', desc: '一人一段接着写故事：同一个人不能连续写两段，写满就完结', base: '/relay/', cls: 'rl', cards: list.map((s) => ({ slug: s.slug, title: s.title, summary: s.summary, meta: meta(s) })), empty: '还没有接龙故事。', top: top(list), bottom: bottom(list), attrs: listAttrs(list) });
}
