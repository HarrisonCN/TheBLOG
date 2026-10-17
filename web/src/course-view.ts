/**
 * L40 / v1.40.0 课程笔记页面（纯函数，浏览器和预渲染共用；不需要 JS）：
 * - /courses/：按学期分组的课程卡片（课时数、作业数、完成度）；
 * - /courses/:slug/：课时目录（锚点）、每节课的笔记、作业要求与评分量表（表格：评分项 / 权重 / 得分，加权总分与等级）。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, pageHead, shell, tile, url, type Page, type Route } from './render';
import { SCORE_MAX, doneLessons, gradeOf, rubricScore, sortItems, termLabel, type Assignment, type Item, type Summary } from './course-core';
import type { SiteData } from './types';

const dateCn = (d: string) => {
  const [y, m, day] = d.split('-');
  return `${y} 年 ${Number(m)} 月 ${Number(day)} 日`;
};

function rubricTable(no: number, a: Assignment): string {
  const total = rubricScore(a.rubric);
  const rows = a.rubric.map((c) => `<tr><th scope="row">${e(c.name)}</th><td>${c.weight}%</td><td>${c.score === undefined ? '—' : `${c.score} / ${SCORE_MAX}`}</td></tr>`).join('');
  return `<section class="cs-hw" aria-labelledby="hw-${no}"><h3 class="cs-hw__h" id="hw-${no}">作业：${e(a.title)}</h3><p class="small muted">截止 ${dateCn(a.due)}</p><p>${e(a.brief)}</p>
<table class="cs-rubric"><caption>评分量表（满分 100）</caption><thead><tr><th scope="col">评分项</th><th scope="col">权重</th><th scope="col">得分</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th scope="row">加权总分</th><td colspan="2" data-cs-total>${total === null ? '未评分' : `${total} 分 · ${gradeOf(total)}`}</td></tr></tfoot></table></section>`;
}

export function detailPage(site: SiteData, route: Extract<Route, { name: 'course' }>, c: Item): Page {
  const toc = c.lessons.map((l) => `<li><a href="#lesson-${l.no}">第 ${l.no} 课 · ${e(l.title)}</a>${l.notes.length ? '' : ' <span class="small muted">（待整理）</span>'}</li>`).join('');
  const lessons = c.lessons
    .map(
      (l) =>
        `<section class="cs-lesson" id="lesson-${l.no}" aria-labelledby="lesson-h-${l.no}"><h2 class="cs-lesson__h" id="lesson-h-${l.no}">第 ${l.no} 课 · ${e(l.title)}</h2>${l.notes.length ? l.notes.map((n) => `<p>${e(n)}</p>`).join('') : '<p class="muted">笔记待整理。</p>'}${l.assignment ? rubricTable(l.no, l.assignment) : ''}</section>`,
    )
    .join('');
  const done = doneLessons(c);
  const body = `<div class="cs" data-course="${e(c.slug)}">
<p class="cs-meta small muted"><span>${termLabel(c.term)}</span><span>${c.lessons.length} 节课</span><span>已整理 ${done} / ${c.lessons.length}</span></p>
<p class="cs-summary">${e(c.summary)}</p>
<nav class="cs-toc" aria-label="课时目录"><ol>${toc}</ol></nav>
${lessons}
<p class="cs-back"><a class="btn btn--sm" href="${url('/courses/')}">${icon('book')}全部课程</a></p>
</div>`;
  return shell(site, route, {
    title: `${c.title} · 课程笔记`,
    description: c.summary.slice(0, 120),
    top: pageHead(c.title, `课程笔记 · ${termLabel(c.term)}`),
    main: bento(tile('full', body, { cls: 'ia-tile cs-tile' })),
    kind: 'page--ia page--course',
  });
}

function card(s: Summary): string {
  return `<li class="cs-card"><a class="cs-card__a" href="${url(`/courses/${s.slug}/`)}"><span class="cs-card__title">${e(s.title)}</span><span class="cs-card__meta small muted">${s.lessons} 节课 · ${s.assignments} 份作业 · 已整理 ${s.done} / ${s.lessons}</span><span class="cs-card__sum small">${e(s.summary)}</span></a></li>`;
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  const terms: { term: string; items: Summary[] }[] = [];
  for (const s of sortItems(list)) {
    const g = terms.find((t) => t.term === s.term);
    if (g) g.items.push(s);
    else terms.push({ term: s.term, items: [s] });
  }
  const body = list.length
    ? terms.map((t, i) => `<section class="cs-term" aria-labelledby="term-${i}"><h2 class="cs-term__h" id="term-${i}">${termLabel(t.term)}</h2><ul class="cs-cards" role="list">${t.items.map(card).join('')}</ul></section>`).join('')
    : '<p class="muted">还没有课程笔记。</p>';
  return shell(site, route, {
    title: '课程笔记',
    description: '摄影专业课的课堂笔记、作业要求和评分量表',
    top: pageHead('课程笔记', '摄影专业课的课堂笔记、作业要求和评分量表'),
    main: bento(tile('full', body, { cls: 'ia-tile cs-tile' })),
    kind: 'page--ia page--course',
  });
}
