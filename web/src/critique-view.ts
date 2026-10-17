/**
 * L41 / v1.41.0 作品点评页面（纯函数，浏览器和预渲染共用；不需要 JS 也完整可读）：
 * - /critique/：作品卡片（点评数、总体平均分）；
 * - /critique/:slug/：作品大图、作者想听的意见、各维度平均分表格（含 1–5 分票数分布，用文字写出，不只靠颜色）、逐条点评；
 *   「先自己打分」表单默认隐藏，critique-client（按需加载）打开它：只在本页计算你和大家的差，不上传。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, pageHead, shell, tile, url, type Page, type Route } from './render';
import { DIMS, DIM_LABEL, averages, distribution, overall, type Item, type Summary } from './critique-core';
import type { SiteData } from './types';

const dateCn = (d: string) => {
  const [y, m, day] = d.split('-');
  return `${y} 年 ${Number(m)} 月 ${Number(day)} 日`;
};

export function detailPage(site: SiteData, route: Extract<Route, { name: 'critiquework' }>, c: Item): Page {
  const avg = averages(c.reviews);
  const ov = overall(c.reviews);
  const table = avg
    ? `<table class="cq-avg"><caption>平均分（${c.reviews.length} 位点评人，满分 5）</caption><thead><tr><th scope="col">维度</th><th scope="col">平均</th><th scope="col">分布（1–5 分各几票）</th></tr></thead><tbody>${DIMS.map((d) => {
        const dist = distribution(c.reviews, d);
        return `<tr><th scope="row">${DIM_LABEL[d]}</th><td data-cq-avg="${d}">${avg[d]}</td><td><span class="cq-dist" aria-hidden="true">${dist.map((n, i) => `<span class="cq-dist__bar" style="--n:${n}" title="${i + 1} 分 ${n} 票"></span>`).join('')}</span><span class="cq-dist__txt small">${dist.map((n, i) => `${i + 1} 分 ${n} 票`).join('，')}</span></td></tr>`;
      }).join('')}</tbody><tfoot><tr><th scope="row">总体</th><td colspan="2">${ov}</td></tr></tfoot></table>`
    : '<p class="muted">还没有点评。</p>';
  const reviews = c.reviews
    .map((r) => `<li class="cq-rev"><p class="cq-rev__by"><strong>${e(r.by)}</strong> <span class="small muted">${DIMS.map((d) => `${DIM_LABEL[d]} ${r.scores[d]}`).join(' · ')}</span></p><p class="cq-rev__c">${e(r.comment)}</p></li>`)
    .join('');
  const self = avg
    ? `<form class="cq-self" data-cq-self hidden aria-labelledby="cq-self-h"><h2 id="cq-self-h" class="cq-h">先自己打分</h2><p class="small muted">看点评之前先给自己的判断打个分，再和大家比一比。只在这个页面里计算，不会上传。</p>
<div class="cq-self__grid">${DIMS.map((d) => `<fieldset class="cq-self__f"><legend>${DIM_LABEL[d]}</legend>${[1, 2, 3, 4, 5].map((n) => `<label class="cq-self__opt"><input type="radio" name="cq-${d}" value="${n}">${n}</label>`).join('')}</fieldset>`).join('')}</div>
<button type="submit" class="btn btn--sm">和大家比一比</button><div role="status" aria-live="polite"><ul class="cq-self__out" data-cq-out></ul></div></form>`
    : '';
  const body = `<div class="cq" data-critique="${e(c.slug)}">
<p class="cq-meta small muted"><span>${dateCn(c.date)}</span><span>${c.reviews.length} 条点评</span>${ov === null ? '' : `<span>总体 ${ov} / 5</span>`}</p>
<figure class="cq-fig"><img src="${e(c.image.src)}" alt="${e(c.image.alt)}" width="${c.image.w}" height="${c.image.h}" decoding="async"><figcaption class="small muted">${e(c.summary)}</figcaption></figure>
${c.ask ? `<p class="cq-ask"><strong>作者想听：</strong>${e(c.ask)}</p>` : ''}
${self}
<section aria-labelledby="cq-avg-h"><h2 id="cq-avg-h" class="cq-h">评分</h2>${table}</section>
${reviews ? `<section aria-labelledby="cq-rev-h"><h2 id="cq-rev-h" class="cq-h">逐条点评</h2><ol class="cq-revs" role="list">${reviews}</ol></section>` : ''}
<p class="cq-back"><a class="btn btn--sm" href="${url('/critique/')}">${icon('message')}全部点评</a></p>
</div>`;
  return shell(site, route, {
    title: `${c.title} · 作品点评`,
    description: c.summary.slice(0, 120),
    top: pageHead(c.title, `作品点评 · ${c.reviews.length} 条`),
    main: bento(tile('full', body, { cls: 'ia-tile cq-tile' })),
    kind: 'page--ia page--critique',
  });
}

function card(s: Summary): string {
  return `<li class="cq-card"><a class="cq-card__a" href="${url(`/critique/${s.slug}/`)}"><span class="cq-card__cover"><img src="${e(s.cover.src)}" alt="${e(s.cover.alt)}" width="${s.cover.w}" height="${s.cover.h}" loading="lazy" decoding="async"></span><span class="cq-card__title">${e(s.title)}</span><span class="cq-card__meta small muted">${s.reviews} 条点评${s.overall === null ? '' : ` · 总体 ${s.overall} / 5`} · ${dateCn(s.date)}</span></a></li>`;
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return shell(site, route, {
    title: '作品点评',
    description: '按构图、光线、色彩、叙事四个维度的结构化点评',
    top: pageHead('作品点评', '按构图、光线、色彩、叙事四个维度打分，再写下具体意见'),
    main: bento(tile('full', list.length ? `<ul class="cq-cards" role="list">${list.map(card).join('')}</ul>` : '<p class="muted">还没有作品点评。</p>', { cls: 'ia-tile cq-tile' })),
    kind: 'page--ia page--critique',
  });
}
