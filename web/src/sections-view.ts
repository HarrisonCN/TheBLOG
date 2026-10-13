/**
 * 扩展栏目的纯函数视图：此刻 / 作品集 / 器材 / 书影音 / 时间线 / 更新日志 / 开源 / 数据 / 搜索 / 订阅，
 * 以及首页的「此刻与作品」瓷砖组。与 render.ts 一样输出 HTML 字符串，浏览器与预渲染共用；
 * 交互（筛选、灯箱、GitHub 星标刷新、搜索）在 sections-client.ts。
 */
import { escapeHtml as e, safeHref } from './markdown';
import { icon } from './icons';
import { bento, formatDate, hashHue, img, kicker, more, pageHead, postPath, shell, tagCloud, tile, url, type Extra, type Page } from './render';
import type { PostSummary, SiteData } from './types';
import { exploreTile } from './site-map-view';
import {
  activityHeatmap, CHANGE_TYPE, GEAR_CATEGORIES, NOW_KIND, REPO_STATUS, SHELF_KIND, SHELF_STATUS, shelfStatusLabel, sortByDateDesc, TIMELINE_KIND,
  type ChangelogEntry, type GearItem, type HeatCell, type NowItem, type Repo, type ShelfItem, type TimelineItem, type Work,
} from './sections';

/** 站内路径（/xxx）加部署前缀；外链只允许 http(s)。 */
export function link(u: string | undefined): string | null {
  if (!u) return null;
  if (u.startsWith('/') && !u.startsWith('//')) return url(u);
  return safeHref(u);
}
const ext = (u: string) => (u.startsWith('/') && !u.startsWith('//') ? '' : ' target="_blank" rel="noopener noreferrer"');
const aOpen = (u: string | undefined, cls = '') => {
  const h = link(u);
  return h ? `<a class="${cls}" href="${e(h)}"${ext(u!)}>` : '';
};
const stars = (n: number, max = 5) => `<span class="rate" role="img" aria-label="${n} / ${max} 分">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
const LANG_HUE: Record<string, number> = { TypeScript: 211, JavaScript: 50, Kotlin: 270, HTML: 14, Python: 205, CSS: 290, Rust: 25, Go: 190 };
const langDot = (l: string) => (l ? `<span class="lang"><i style="--h:${LANG_HUE[l] ?? hashHue(l)}"></i>${e(l)}</span>` : '');
const json = (o: unknown) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const pub = (p: PostSummary) => p.publishedAt ?? p.createdAt;
const progress = (n: number, label: string) =>
  n > 0 ? `<div class="pbar" role="progressbar" aria-label="${e(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${n}"><i style="--p:${n}%"></i></div><span class="pbar__n">${n}%</span>` : '';
const GEAR_ICON: Record<string, string> = { 相机: 'camera', 镜头: 'aperture', 手机: 'tv', 配件: 'box', 电脑与外设: 'briefcase', 软件: 'code' };
const empty = (text: string) => bento(tile('full', `<p class="empty">${e(text)}</p>`));

// ================================================================ 热力图
export function heatEvents(site: SiteData, changelog: ChangelogEntry[] = []): { date: string; weight: number }[] {
  return [
    ...site.posts.map((p) => ({ date: pub(p).slice(0, 10), weight: 3 })),
    ...site.posts.filter((p) => p.updatedAt.slice(0, 10) !== pub(p).slice(0, 10)).map((p) => ({ date: p.updatedAt.slice(0, 10), weight: 1 })),
    ...changelog.map((c) => ({ date: c.date, weight: 2 })),
  ];
}
export function heatmap(site: SiteData, changelog: ChangelogEntry[] = [], weeks = 53, today = new Date()): string {
  const h = activityHeatmap(heatEvents(site, changelog), today, weeks);
  const cols: HeatCell[][] = [];
  h.cells.forEach((c, i) => (cols[Math.floor(i / 7)] ??= []).push(c));
  const months: string[] = cols.map((col, i) => {
    const m = col[0]!.date.slice(5, 7);
    const prev = i > 0 ? cols[i - 1]![0]!.date.slice(5, 7) : '';
    return m !== prev ? `${Number(m)}月` : '';
  });
  return `<div class="heat" style="--weeks:${cols.length}">
  <div class="heat__scroll" tabindex="0" role="region" aria-label="最近一年的写作热力图（可横向滚动）"><div class="heat__months" aria-hidden="true">${months.map((m) => `<span>${m}</span>`).join('')}</div>
  <div class="heat__grid" role="img" aria-label="近 ${weeks} 周有 ${h.activeDays} 天在写作或更新站点">${cols
    .map((col) => `<div class="heat__col">${col.map((c) => `<i class="l${c.level}" title="${c.date}${c.score ? ` · ${c.score} 分` : ''}"></i>`).join('')}</div>`)
    .join('')}</div></div>
  <div class="heat__foot"><span>${h.activeDays} 天有动静 · 连续 ${h.streak} 天</span><span class="heat__legend" aria-hidden="true">少<i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i>多</span></div>
</div>`;
}

// ================================================================ 首页瓷砖
function nowTile(list: NowItem[]): string {
  if (!list.length) return '';
  return tile(
    'third',
    `${kicker('clock', '此刻')}<ul class="now-mini">${list
      .slice(0, 5)
      .map((n) => `<li><span class="now-mini__k">${icon(NOW_KIND[n.kind]?.icon ?? 'sparkles')}${e(NOW_KIND[n.kind]?.label ?? '')}</span><b>${e(n.title)}</b>${n.progress > 0 ? `<div class="pbar pbar--sm" aria-hidden="true"><i style="--p:${n.progress}%"></i></div>` : ''}</li>`)
      .join('')}</ul>${more(url('/now/'), '我最近在做什么')}`,
    { cls: 'now-tile', rows: 2 },
  );
}
function worksTile(works: Work[]): string {
  if (!works.length) return '';
  const w = works.slice(0, 6);
  return tile(
    'twothird',
    `<div class="works-strip">${w
      .map((x, i) => `<a class="works-strip__item" href="${url('/works/')}#${e(x.id)}" aria-label="${e(x.title)}" style="--i:${i}">${img(x.url, x.title, 'works-strip__img', { sizes: '(max-width: 700px) 50vw, 260px' })}<span class="works-strip__exif">${e([x.focal, x.aperture, x.shutter].filter(Boolean).join(' · '))}</span></a>`)
      .join('')}</div>
  <div class="works-tile__cap">${kicker('aperture', '作品集')}<b>${works.length} 张作品 · ${new Set(works.map((x) => x.series).filter(Boolean)).size} 个系列</b>${more(url('/works/'), '看大图和参数')}</div>`,
    { cls: 'works-tile', rows: 2, label: '作品集' },
  );
}
function reposTile(repos: Repo[]): string {
  const open = repos.filter((r) => r.owner && r.repo);
  if (!repos.length) return '';
  return tile(
    'third',
    `${kicker('github', '开源')}<ul class="repo-mini">${repos
      .slice(0, 4)
      .map((r) => {
        const a = aOpen(r.url, 'repo-mini__a');
        return `<li>${a || '<span class="repo-mini__a">'}<b>${e(r.title)}</b>${langDot(r.language)}${r.owner && r.repo ? `<span class="repo-mini__s">${icon('star')}<span class="js-stars" data-repo="${e(`${r.owner}/${r.repo}`)}">${r.stars}</span></span>` : `<span class="chip chip--ghost">${e(REPO_STATUS[r.status])}</span>`}${a ? '</a>' : '</span>'}</li>`;
      })
      .join('')}</ul><p class="muted small">${open.length} 个公开仓库 · 星标来自 GitHub</p>${more(url('/opensource/'), '全部项目')}`,
    { cls: 'repos-tile' },
  );
}
function changelogTile(list: ChangelogEntry[]): string {
  const c = sortByDateDesc(list)[0];
  if (!c) return '';
  return tile(
    'third',
    `${kicker('list', '站点更新')}<p class="cl-mini__v"><span class="chip chip--accent">${e(c.version)}</span><time>${e(c.date)}</time></p><h3 class="tile__h">${e(c.title)}</h3><ul class="cl-mini">${c.items
      .slice(0, 3)
      .map((i) => `<li>${e(i)}</li>`)
      .join('')}</ul>${more(url('/changelog/'), '更新日志')}`,
    { cls: 'cl-tile' },
  );
}
function heatTile(site: SiteData, changelog: ChangelogEntry[]): string {
  return tile('twothird', `${kicker('chart', '写作热力图')}${heatmap(site, changelog, 53)}${more(url('/stats/'), '更多数据')}`, { cls: 'heat-tile' });
}
function shelfTile(shelf: ShelfItem[]): string {
  const doing = shelf.filter((s) => s.status === 'doing').slice(0, 4);
  if (!doing.length) return '';
  return tile(
    'third',
    `${kicker('library', '书影音 · 进行中')}<ul class="shelf-mini">${doing
      .map((s) => `<li><span class="shelf-mini__k" style="--h:${hashHue(s.title)}">${icon(SHELF_KIND[s.kind]?.icon ?? 'book')}</span><span><b>${e(s.title)}</b><small>${e(s.creator)}</small></span></li>`)
      .join('')}</ul>${more(url('/shelf/'), '书影音')}`,
    { cls: 'shelf-tile' },
  );
}
/** 首页第二组瓷砖（只在第 1 页）。 */
export function homeSections(site: SiteData, x: Extra): string {
  const tiles = [nowTile(x.now ?? []), worksTile(x.works ?? []), heatTile(site, x.changelog ?? []), reposTile(x.repos ?? []), changelogTile(x.changelog ?? []), shelfTile(x.shelf ?? []), exploreTile()].join('');
  return `<h2 class="section-h reveal">${icon('clock')}此刻与作品</h2>${bento(tiles, 'bento--home2')}`;
}

// ================================================================ 此刻
export function nowPage(site: SiteData, list: NowItem[]): Page {
  const last = list.map((n) => n.since).sort().pop() ?? '';
  const order = Object.keys(NOW_KIND) as NowItem['kind'][];
  const groups = order.map((k) => [k, list.filter((n) => n.kind === k)] as const).filter(([, l]) => l.length);
  return shell(site, { name: 'now' }, {
    title: '此刻',
    description: '我最近在做、在学、在读、在听、在玩的事',
    top: pageHead('此刻', `最近在做什么${last ? ` · 更新于 ${e(last)}` : ''}`),
    main: list.length
      ? bento(
          tile('third', `${kicker('clock', '什么是 Now 页面')}<p>一个“近况”页：不追热点，只写此刻真正占用我时间和注意力的事。灵感来自 <a href="https://nownownow.com/about" target="_blank" rel="noopener noreferrer">nownownow.com</a>。</p><p class="muted small">大概每个月更新一次。</p>`, { cls: 'now-intro', rows: 2 }) +
            groups
              .flatMap(([k, l]) =>
                l.map((n) =>
                  tile(
                    l.length > 1 || k === 'doing' ? 'third' : 'third',
                    `<p class="now__k">${icon(NOW_KIND[k].icon)}<span>${NOW_KIND[k].label}</span>${n.since ? `<time class="chip chip--ghost">${e(n.since)} 起</time>` : ''}</p>
  <h2 class="tile__h">${aOpen(n.url) ? `${aOpen(n.url)}${e(n.title)}</a>` : e(n.title)}</h2>${n.detail ? `<p class="muted">${e(n.detail)}</p>` : ''}
  ${n.progress > 0 ? `<div class="now__prog">${progress(n.progress, `${n.title} 进度`)}</div>` : ''}`,
                    { cls: `now now--${k}` },
                  ),
                ),
              )
              .join(''),
          'bento--now',
        )
      : empty('还没有写近况。'),
  });
}

// ================================================================ 作品集
export function worksPage(site: SiteData, works: Work[]): Page {
  const series = [...new Set(works.map((w) => w.series).filter(Boolean))];
  const sample = works.some((w) => w.credit);
  const chips = (w: Work) => [w.focal, w.aperture, w.shutter, w.iso && `ISO ${w.iso}`].filter(Boolean) as string[];
  const grid = works
    .map(
      (w, i) => `<figure class="work reveal" id="${e(w.id)}" data-series="${e(w.series)}" style="--ar:${w.width && w.height ? (w.width / w.height).toFixed(3) : '1.5'}">
  <button class="work__btn js-work" type="button" data-i="${i}" aria-label="查看大图：${e(w.title)}">${img(w.url, w.title, 'work__img', { sizes: '(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw', w: w.width ? 1280 : undefined, h: w.width && w.height ? Math.round((1280 * w.height) / w.width) : undefined })}<span class="work__zoom">${icon('zoom')}</span></button>
  <figcaption><b>${e(w.title)}</b><span class="work__meta">${e([w.location, w.date].filter(Boolean).join(' · '))}</span>
  <span class="exif">${chips(w).map((c) => `<span class="chip">${e(c)}</span>`).join('')}</span></figcaption></figure>`,
    )
    .join('');
  return shell(site, { name: 'works' }, {
    title: '作品集',
    description: '摄影作品与拍摄参数',
    top: pageHead('作品集', `${works.length} 张作品 · ${series.length} 个系列`, works[0]?.url),
    main: works.length
      ? `${bento(
          tile(
            'full',
            `<div class="works-bar"><div class="seg js-works-filter" role="group" aria-label="按系列筛选"><button type="button" class="seg__b is-on" data-series="" aria-pressed="true">全部</button>${series
              .map((s) => `<button type="button" class="seg__b" data-series="${e(s)}" aria-pressed="false">${e(s)}</button>`)
              .join('')}</div><span class="muted small js-works-count">${works.length} 张</span></div>${
              sample ? `<p class="muted small works-note">${icon('megaphone')}示例作品使用 Wikimedia Commons 的自由授权照片占位（大图里有署名），EXIF 为示意参数；在后台「栏目 → 作品集」换成自己的作品即可。</p>` : ''
            }`,
            { cls: 'works-head' },
          ),
          'bento--head',
        )}
<div class="works js-works">${grid}</div>
<dialog class="lightbox js-lightbox" aria-label="作品大图">
  <div class="lightbox__stage"><img class="lightbox__img" alt="" decoding="async"><button class="lightbox__nav lightbox__nav--prev js-lb-prev" type="button" aria-label="上一张">${icon('chevronLeft')}</button><button class="lightbox__nav lightbox__nav--next js-lb-next" type="button" aria-label="下一张">${icon('chevronRight')}</button></div>
  <aside class="lightbox__info"><button class="lightbox__close js-lb-close" type="button" aria-label="关闭" autofocus>${icon('close')}</button><h2 class="lightbox__title"></h2><p class="lightbox__meta muted"></p><dl class="lightbox__exif"></dl><p class="lightbox__tags"></p><p class="lightbox__credit small muted"></p><p class="lightbox__pos small muted"></p></aside>
</dialog>
<script type="application/json" class="js-works-data">${json(works)}</script>`
      : empty('还没有作品。'),
  });
}

// ================================================================ 器材
export function gearPage(site: SiteData, gear: GearItem[]): Page {
  const cats = [...GEAR_CATEGORIES.filter((c) => gear.some((g) => g.category === c)), ...new Set(gear.map((g) => g.category).filter((c) => !(GEAR_CATEGORIES as string[]).includes(c)))];
  const top = gear.filter((g) => g.rating >= 5).slice(0, 3);
  const summary = tile(
    'full',
    `<div class="gear-sum">${cats.map((c) => `<a class="gear-sum__c" href="#gear-${e(c)}"><b>${gear.filter((g) => g.category === c).length}</b><span>${e(c)}</span></a>`).join('')}</div>${
      top.length ? `<p class="muted small">${icon('star')}满分推荐：${top.map((g) => e(g.name)).join('、')}</p>` : ''
    }`,
    { cls: 'gear-head' },
  );
  return shell(site, { name: 'gear' }, {
    title: '器材',
    description: '我在用的相机、镜头、手机和软件',
    top: pageHead('器材', `${gear.length} 件在用 · 少即是多`),
    main: gear.length
      ? `${bento(summary, 'bento--head')}${cats
          .map(
            (c) => `<h2 class="section-h reveal" id="gear-${e(c)}">${icon(GEAR_ICON[c] ?? 'box')}${e(c)}</h2>${bento(
              gear
                .filter((g) => g.category === c)
                .map((g) =>
                  tile(
                    'quarter',
                    `<div class="gear__top"><span class="gear__ic" style="--h:${hashHue(g.name)}">${icon(GEAR_ICON[g.category] ?? 'box')}</span>${stars(g.rating)}</div>
  <h3 class="gear__name">${aOpen(g.url) ? `${aOpen(g.url)}${e(g.name)}</a>` : e(g.name)}</h3><p class="gear__brand muted small">${e([g.brand, g.since && `${g.since} 入手`].filter(Boolean).join(' · '))}</p><p class="gear__note">${e(g.note)}</p>`,
                    { cls: 'gear tile--hover' },
                  ),
                )
                .join(''),
            )}`,
          )
          .join('')}`
      : empty('器材清单是空的。'),
  });
}

// ================================================================ 书影音
export function shelfPage(site: SiteData, shelf: ShelfItem[]): Page {
  const kinds = Object.keys(SHELF_KIND) as ShelfItem['kind'][];
  const count = (k: string) => shelf.filter((s) => s.kind === k).length;
  const head = tile(
    'full',
    `<div class="shelf-bar"><div class="seg js-shelf-kind" role="group" aria-label="按类型筛选"><button type="button" class="seg__b is-on" data-v="" aria-pressed="true">全部 <small>${shelf.length}</small></button>${kinds
      .map((k) => `<button type="button" class="seg__b" data-v="${k}" aria-pressed="false">${icon(SHELF_KIND[k].icon)}${SHELF_KIND[k].label} <small>${count(k)}</small></button>`)
      .join('')}</div>
<div class="seg seg--soft js-shelf-status" role="group" aria-label="按状态筛选"><button type="button" class="seg__b is-on" data-v="" aria-pressed="true">全部</button>${(['want', 'doing', 'done'] as ShelfItem['status'][])
      .map((s) => `<button type="button" class="seg__b" data-v="${s}" aria-pressed="false">${SHELF_STATUS[s]}</button>`)
      .join('')}</div>
<div class="seg seg--soft js-shelf-rating" role="group" aria-label="按评分筛选"><button type="button" class="seg__b is-on" data-v="" aria-pressed="true">不限评分</button><button type="button" class="seg__b" data-v="4" aria-pressed="false">4 星以上</button><button type="button" class="seg__b" data-v="5" aria-pressed="false">5 星</button></div>
<p class="shelf-count muted small js-shelf-count" aria-live="polite">共 ${shelf.length} 项</p></div>`,
    { cls: 'shelf-head' },
  );
  const items = shelf
    .map((s) =>
      tile(
        'quarter',
        `<div class="shelf__cover${s.cover ? ' shelf__cover--img' : ''}" style="--h:${hashHue(s.title + s.creator)}">${s.cover ? img(s.cover, `《${s.title}》封面`, 'shelf__img', { sizes: '(max-width: 640px) 50vw, 240px' }) : ''}<span class="shelf__kind">${icon(SHELF_KIND[s.kind]?.icon ?? 'book')}${SHELF_KIND[s.kind]?.label ?? ''}</span>${s.cover ? '' : `<b class="shelf__t">${e(s.title)}</b>`}</div>
  <div class="shelf__body">${s.cover ? `<p class="shelf__title"><b>${e(s.title)}</b></p>` : ''}<p class="shelf__by muted small">${e([s.creator, s.year].filter(Boolean).join(' · '))}</p><p class="shelf__row"><span class="chip chip--${s.status}">${shelfStatusLabel(s.kind, s.status)}</span>${s.rating ? stars(s.rating) : ''}${s.date ? `<time class="shelf__date muted small">${e(s.date)}</time>` : ''}</p>${s.note ? `<p class="shelf__note">${e(s.note)}</p>` : ''}${aOpen(s.url) ? `${aOpen(s.url, 'tile__more')}详情${icon('arrowRight')}</a>` : ''}</div>`,
        { cls: 'shelf', attrs: `data-kind="${e(s.kind)}" data-status="${e(s.status)}" data-rating="${s.rating}"` },
      ),
    )
    .join('');
  return shell(site, { name: 'shelf' }, {
    title: '书影音',
    description: '读过的书、看过的电影、听过的专辑和玩过的游戏',
    top: pageHead('书影音', kinds.map((k) => `${SHELF_KIND[k].label} ${count(k)}`).join(' · ')),
    main: shelf.length ? `${bento(head, 'bento--head')}${bento(items, 'bento--shelf js-shelf')}<p class="empty js-shelf-empty" hidden>这个筛选下还没有内容。</p>` : empty('书架还是空的。'),
  });
}

// ================================================================ 时间线
export function timelinePage(site: SiteData, list: TimelineItem[]): Page {
  const sorted = sortByDateDesc(list);
  const years = [...new Set(sorted.map((t) => t.date.slice(0, 4)))];
  return shell(site, { name: 'timeline' }, {
    title: '时间线',
    description: '一路走来的学习、项目和生活节点',
    top: pageHead('时间线', `${sorted.length} 个节点 · ${years.length ? `${years[years.length - 1]}–${years[0]}` : ''}`),
    main: sorted.length
      ? bento(
          tile(
            'full',
            `<div class="tl-legend">${(Object.keys(TIMELINE_KIND) as TimelineItem['kind'][]).filter((k) => sorted.some((t) => t.kind === k)).map((k) => `<span class="tl-k tl-k--${k}">${icon(TIMELINE_KIND[k].icon)}${TIMELINE_KIND[k].label}</span>`).join('')}</div>
${years
  .map(
    (y) => `<section class="tl-year"><h2 class="tl-year__h">${e(y)}</h2><ol class="tl">${sorted
      .filter((t) => t.date.startsWith(y))
      .map(
        (t) => `<li class="tl__item tl__item--${e(t.kind)} reveal"><span class="tl__dot">${icon(TIMELINE_KIND[t.kind]?.icon ?? 'sparkles')}</span><div class="tl__card"><p class="tl__date"><time>${e(t.date)}</time><span class="tl-k tl-k--${e(t.kind)}">${TIMELINE_KIND[t.kind]?.label ?? ''}</span></p><h3>${aOpen(t.url) ? `${aOpen(t.url)}${e(t.title)}</a>` : e(t.title)}</h3>${t.detail ? `<p class="muted">${e(t.detail)}</p>` : ''}</div></li>`,
      )
      .join('')}</ol></section>`,
  )
  .join('')}`,
            { cls: 'tl-tile' },
          ),
        )
      : empty('时间线还是空的。'),
  });
}

// ================================================================ 更新日志
export function changelogPage(site: SiteData, list: ChangelogEntry[]): Page {
  const sorted = sortByDateDesc(list);
  return shell(site, { name: 'changelog' }, {
    title: '更新日志',
    description: '这个博客的更新记录与周报',
    top: pageHead('更新日志', `${sorted.length} 次更新 · <a href="${url('/rss.xml')}">${icon('rss')}订阅文章</a>`),
    main: sorted.length
      ? bento(
          sorted
            .map((c, i) =>
              tile(
                i === 0 ? 'full' : 'half',
                `<header class="cl__head"><span class="cl__v">${e(c.version)}</span><span class="chip chip--${e(c.type)}">${CHANGE_TYPE[c.type] ?? ''}</span><time class="muted small" datetime="${e(c.date)}">${e(c.date)}</time></header><h2 class="tile__h">${e(c.title)}</h2><ul class="cl__list">${c.items.map((x) => `<li>${e(x)}</li>`).join('')}</ul>`,
                { cls: `cl cl--${e(c.type)}${i === 0 ? ' cl--latest' : ''}` },
              ),
            )
            .join(''),
        )
      : empty('还没有更新记录。'),
  });
}

// ================================================================ 开源
export function opensourcePage(site: SiteData, repos: Repo[], changelog: ChangelogEntry[] = []): Page {
  const pub = repos.filter((r) => r.owner && r.repo);
  const totalStars = pub.reduce((n, r) => n + r.stars, 0);
  const langs = [...new Set(repos.map((r) => r.language).filter(Boolean))];
  const cards = repos
    .map((r) =>
      tile(
        'half',
        `<header class="repo__head"><span class="repo__ic" style="--h:${LANG_HUE[r.language] ?? hashHue(r.title)}">${icon(r.status === 'private' ? 'lock' : 'github')}</span><div><h2 class="repo__t">${aOpen(r.url) ? `${aOpen(r.url)}${e(r.title)}</a>` : e(r.title)}</h2>${r.owner && r.repo ? `<p class="muted small">${e(r.owner)}/${e(r.repo)}</p>` : ''}</div><span class="chip chip--${e(r.status)}">${REPO_STATUS[r.status]}</span></header>
  <p class="repo__d">${e(r.description)}</p>
  ${r.topics.length ? `<p class="repo__topics">${r.topics.map((t) => `<span class="chip chip--ghost">#${e(t)}</span>`).join('')}</p>` : ''}
  <footer class="repo__foot">${langDot(r.language)}${r.owner && r.repo ? `<span class="repo__n" title="星标">${icon('star')}<span class="js-stars" data-repo="${e(`${r.owner}/${r.repo}`)}">${r.stars}</span></span><span class="repo__n" title="Fork">${icon('fork')}<span class="js-forks" data-repo="${e(`${r.owner}/${r.repo}`)}">${r.forks}</span></span>` : '<span class="muted small">源码暂未公开</span>'}${aOpen(r.url) ? `${aOpen(r.url, 'btn btn--soft btn--sm repo__go')}${icon('github')}仓库</a>` : ''}</footer>`,
        { cls: 'repo tile--hover', attrs: r.owner && r.repo ? `data-repo="${e(`${r.owner}/${r.repo}`)}"` : '' },
      ),
    )
    .join('');
  return shell(site, { name: 'opensource' }, {
    title: '开源项目',
    description: '我写的开源库和正在做的 App',
    top: pageHead('开源项目', `${repos.length} 个项目 · ${pub.length} 个公开仓库`),
    main: repos.length
      ? `${bento(
          `${tile('quarter', `${kicker('star', '星标')}<b class="big-n js-stars-total">${totalStars}</b><p class="muted small js-gh-note">构建时快照</p>`, { cls: 'os-stat' })}${tile('quarter', `${kicker('code', '语言')}<p class="os-langs">${langs.map(langDot).join('')}</p>`, { cls: 'os-stat' })}${tile('half', `${kicker('chart', '最近一年')}${heatmap(site, changelog, 26)}`, { cls: 'heat-tile' })}`,
        )}${bento(cards, 'bento--repos')}`
      : empty('还没有项目。'),
  });
}

// ================================================================ 数据
export function statsPage(site: SiteData, changelog: ChangelogEntry[] = [], today = new Date()): Page {
  const posts = site.posts;
  const words = posts.reduce((a, p) => a + (p.wordCount || 0), 0);
  const avg = posts.length ? Math.max(1, Math.round(words / posts.length / 400)) : 0;
  const months: { key: string; n: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    months.push({ key, n: posts.filter((p) => pub(p).slice(0, 7) === key).length });
  }
  const maxN = Math.max(1, ...months.map((m) => m.n));
  const bars = `<div class="bars" role="img" aria-label="近 12 个月每月发文数">${months
    .map((m) => `<div class="bars__c" title="${m.key}：${m.n} 篇"><span class="bars__n">${m.n || ''}</span><i style="--v:${(m.n / maxN) * 100}%"></i><small>${Number(m.key.slice(5))}月</small></div>`)
    .join('')}</div>`;
  const cats = site.categories.slice().sort((a, b) => b.count - a.count);
  const catTotal = Math.max(1, cats.reduce((n, c) => n + c.count, 0));
  const share = `<ul class="share">${cats
    .map((c) => `<li><span class="share__l"><i style="--h:${hashHue(c.category)}"></i>${e(c.category)}</span><span class="share__bar"><i style="--v:${(c.count / catTotal) * 100}%;--h:${hashHue(c.category)}"></i></span><b>${c.count}</b></li>`)
    .join('')}</ul>`;
  const longest = posts.slice().sort((a, b) => (b.wordCount || 0) - (a.wordCount || 0))[0];
  const n = (label: string, v: string | number, ic: string) => tile('quarter', `${kicker(ic, label)}<b class="big-n">${e(String(v))}</b>`, { cls: 'stat-n' });
  return shell(site, { name: 'stats' }, {
    title: '数据',
    description: '文章、字数和写作节奏',
    top: pageHead('数据', '写了多少、什么时候写、写了什么'),
    main: bento(
      `${n('文章', site.total, 'file')}${n('总字数', words >= 10000 ? `${(words / 10000).toFixed(1)} 万` : words, 'edit')}${n('平均阅读', `${avg} 分钟`, 'clock')}${n('标签', site.tags.length, 'tag')}
${tile('full', `${kicker('chart', '写作热力图 · 近一年')}${heatmap(site, changelog, 53, today)}<p class="muted small">发布文章记 3 分，更新文章记 1 分，站点更新记 2 分。</p>`, { cls: 'heat-tile heat-tile--full' })}
${tile('half', `${kicker('calendar', '每月发文')}${bars}`, { cls: 'bars-tile' })}
${tile('half', `${kicker('folder', '分类占比')}${share}${longest ? `<p class="muted small">最长的一篇：<a href="${postPath(longest.slug)}">${e(longest.title)}</a>（${longest.wordCount} 字）</p>` : ''}`, { cls: 'share-tile' })}
${tile('full', `${kicker('tag', '标签')}${tagCloud(site.tags, 60)}`, { cls: 'tags-tile' })}`,
    ),
  });
}

// ================================================================ 搜索
export function searchPage(site: SiteData): Page {
  return shell(site, { name: 'search' }, {
    title: '搜索',
    description: '搜索全站文章',
    top: pageHead('搜索', `在 ${site.total} 篇文章里找找`),
    main: bento(
      `${tile(
        'full',
        `<form class="sp-form js-search-page" role="search" action="${url('/search/')}" method="get"><label class="visually-hidden" for="sp-q">搜索关键词</label>${icon('search')}<input id="sp-q" name="q" type="search" maxlength="80" placeholder="输入关键词，例如：夜景、动效、MCP" autocomplete="off" enterkeyhint="search"><button class="btn" type="submit">搜索</button></form>
<div class="sp-chips">${site.tags.slice(0, 12).map((t) => `<button type="button" class="chip js-sp-chip" data-q="${e(t.tag)}">#${e(t.tag)}</button>`).join('')}</div>`,
        { cls: 'sp-tile' },
      )}
${tile('full', `<p class="sp-status muted js-sp-status" role="status" aria-live="polite">输入关键词开始搜索；支持多个词（空格分隔）。</p><ol class="sp-results js-sp-results"></ol>`, { cls: 'sp-res-tile' })}`,
    ),
  });
}

// ================================================================ 订阅
export function subscribePage(site: SiteData): Page {
  const feeds: [string, string, string, string][] = [
    ['RSS 2.0', '/rss.xml', 'rss', '几乎所有阅读器都支持'],
    ['Atom', '/atom.xml', 'rss', '更严格的标准格式，带完整时间与作者信息'],
    ['JSON Feed', '/feed.json', 'code', '更现代的格式，适合开发者'],
  ];
  return shell(site, { name: 'subscribe' }, {
    title: '订阅',
    description: '用 RSS 订阅这个博客',
    top: pageHead('订阅', '不用关注任何平台，用 RSS 就能第一时间看到新文章'),
    main: bento(
      `${feeds
        .map(([name, path, ic, note]) =>
          tile(
            'half',
            `${kicker(ic, name)}<p class="muted">${note}</p><div class="feed-url"><code class="js-feed-url" data-path="${e(path)}">${e(url(path))}</code><button class="btn btn--sm js-copy-feed" type="button" data-path="${e(path)}">${icon('copy')}复制</button></div><a class="tile__more" href="${url(path)}">打开 ${e(path.slice(1))}${icon('arrowRight')}</a>`,
            { cls: 'feed-tile' },
          ),
        )
        .join('')}
${tile('third', `${kicker('book', '推荐阅读器')}<ul class="plain-list"><li><b>NetNewsWire</b> · macOS / iOS，免费开源</li><li><b>Inoreader</b> · 网页 / 安卓 / iOS</li><li><b>Feedly</b> · 网页 / 手机</li><li><b>Folo</b> · 跨平台</li></ul>`, { cls: 'readers-tile' })}
${tile('twothird', `${kicker('history', '最近会推送的文章')}<ul class="mini-list mini-list--plain">${site.posts
        .slice(0, 5)
        .map((p) => `<li><a href="${postPath(p.slug)}"><span><span class="mini-list__title">${e(p.title)}</span><time datetime="${e(pub(p))}">${formatDate(pub(p))}</time></span></a></li>`)
        .join('')}</ul>`, { cls: 'feed-preview' })}
${tile('half', `${kicker('users', '创作者 / 话题 / 项目')}<p class="muted">每个公开的主页、话题和项目都有自己的 RSS / Atom / JSON Feed（页面上的「订阅源」，支持自动发现）；登录后可开启邮件摘要，默认关闭。</p>`, { cls: 'feed-scope-tile' })}
${tile('half', `${kicker('link', 'Webmention')}<p class="muted">在你的博客里链接或回复这里，再把文章地址发到 <code>/api/webmention</code>（或粘贴到文章底部「站外回应」）。验证并审核后显示；本站页面带 microformats2 标记。</p>`, { cls: 'feed-wm-tile', attrs: 'id="webmention"' })}
${tile('full', `${kicker('code', '开放接口')}<p class="muted">公开内容的只读 JSON 接口，免令牌、允许跨域，游标分页（<code>nextCursor</code> → <code>?cursor=</code>），每 IP 每分钟 120 次：<code>/api/open/v1/{posts, works, works/{id}, users/{username}, topics, projects}</code>，订阅源 <code>/api/feeds/…</code>。演示站没有服务器，接口在正式站提供。</p>`, { cls: 'feed-api-tile', attrs: 'id="open-api"' })}
${tile('full', `${kicker('message', '怎么用')}<usa-disclosure class="faq"><details><summary>RSS 是什么？</summary><p>一种开放的订阅格式：把上面的地址粘贴进阅读器，有新文章时阅读器会自动拉取。没有算法推荐，也不会追踪你。</p></details><details><summary>会推送全文吗？</summary><p>订阅源里是标题和摘要，点进来看全文和图片。</p></details><details><summary>想通过邮件收到更新？</summary><p>可以<a href="${url('/join/')}">成为好朋友</a>，然后在创作者主页或话题页开启邮件摘要（每天或每周一封，没有新内容就不发）。</p></details></usa-disclosure>`)}`,
    ),
  });
}
