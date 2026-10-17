/**
 * L46 / v1.46.0 胶片记录页面（纯函数，浏览器和预渲染共用；不需要 JS）：
 * - /film/：胶卷卡片（片种、画幅、ISO → EI、推拉档数、工艺、张数）；
 * - /film/:slug/：冲洗参数（推拉档数 + 估算显影时间）、互易律补偿表（预渲染，常用测光时间）、逐张记录表（caption/th scope）；
 *   JS 加载后多一个「任意测光时间」补偿计算器（film-client，<output> 显示结果）。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, pageHead, shell, tile, url, type Page, type Route } from './render';
import { devMinutes, METERED, mmss, pushStops, reciprocity, secondsText, shutterSeconds, stopsText, type Item, type Summary } from './film-core';
import type { SiteData } from './types';

export function detailPage(site: SiteData, route: Extract<Route, { name: 'filmroll' }>, it: Item): Page {
  const stops = pushStops(it.stock.iso, it.ei);
  const dev = devMinutes(it.baseMinutes, stops);
  const p = it.stock.p;
  const recip = p
    ? `<section class="fm-sec" aria-labelledby="fm-recip-h"><h2 id="fm-recip-h">互易律失效补偿</h2><p class="small muted">${e(it.stock.name)} 的指数 p = ${p}：补偿时间 = 测光时间<sup>p</sup>（只对 1 秒以上的曝光）。</p><div class="fm-scroll" role="region" aria-labelledby="fm-recip-h" tabindex="0"><table class="fm-table fm-recip"><caption>测光时间 → 实际曝光时间</caption><thead><tr><th scope="col">测光</th><th scope="col">实际</th></tr></thead><tbody>${METERED.map((t) => `<tr><th scope="row">${secondsText(t)}</th><td>${secondsText(reciprocity(t, p))}</td></tr>`).join('')}</tbody></table></div><form class="fm-calc" data-fm-calc="${p}" hidden><label for="fm-tm">任意测光时间（秒）</label> <input id="fm-tm" type="number" min="0.1" max="3600" step="0.1" value="10" inputmode="decimal"> <output for="fm-tm" class="fm-out" aria-live="polite"></output></form></section>`
    : `<section class="fm-sec" aria-labelledby="fm-recip-h"><h2 id="fm-recip-h">互易律失效补偿</h2><p class="small muted">这卷没有登记互易律指数，长曝光按测光时间拍。</p></section>`;
  const rows = it.frames
    .map((f) => {
      const s = shutterSeconds(f.shutter)!;
      const fix = p && s > 1 ? `${secondsText(reciprocity(s, p))}` : '—';
      return `<tr><th scope="row">${f.n}</th><td>${e(f.subject)}</td><td>${e(f.shutter.endsWith('s') ? secondsText(s) : f.shutter)}</td><td>f/${f.aperture}</td><td>${fix}</td><td>${f.note ? e(f.note) : ''}</td></tr>`;
    })
    .join('');
  const cover = it.cover ? `<figure class="fm-cover"><img src="${e(it.cover.src)}" alt="${e(it.cover.alt)}" width="${it.cover.w}" height="${it.cover.h}" loading="lazy" decoding="async"><figcaption class="small muted">${e(it.cover.alt)}</figcaption></figure>` : '';
  const body = `<div class="fm" data-film="${e(it.slug)}">
<p class="fm-sum">${e(it.summary)}</p>
${cover}
<dl class="fm-facts">
<div><dt>片种</dt><dd>${e(it.stock.name)}（${it.stock.format}）</dd></div>
<div><dt>标称 ISO → 实际 EI</dt><dd>${it.stock.iso} → ${it.ei}</dd></div>
<div><dt>推拉</dt><dd class="fm-stops">${stopsText(stops)}</dd></div>
<div><dt>冲洗</dt><dd>${it.process} · ${e(it.developer)}</dd></div>
<div><dt>显影时间</dt><dd><strong class="fm-dev">${mmss(dev)}</strong> <span class="small muted">（基准 ${mmss(it.baseMinutes)}，${stops > 0 ? `每推一档 ×1.3` : stops < 0 ? `每拉一档 ×0.8` : '不调整'}）</span></dd></div>
</dl>
<p class="fm-warn small" role="note">${icon('flag')}<span>显影时间与互易律补偿都是经验估算，正式冲洗请以厂商资料为准。</span></p>
${recip}
<section class="fm-sec" aria-labelledby="fm-frames-h"><h2 id="fm-frames-h">逐张记录</h2><div class="fm-scroll" role="region" aria-labelledby="fm-frames-h" tabindex="0"><table class="fm-table fm-frames"><caption>${it.frames.length} 张</caption><thead><tr><th scope="col">张</th><th scope="col">拍了什么</th><th scope="col">快门</th><th scope="col">光圈</th><th scope="col">补偿后</th><th scope="col">备注</th></tr></thead><tbody>${rows}</tbody></table></div></section>
<p class="fm-back"><a class="btn btn--sm" href="${url('/film/')}">${icon('camera')}全部胶卷</a></p>
</div>`;
  return shell(site, route, {
    title: `${it.title} · 胶片记录`,
    description: it.summary.slice(0, 120),
    top: pageHead(it.title, `胶片记录 · ${it.stock.name}`),
    main: bento(tile('full', body, { cls: 'ia-tile fm-tile' })),
    kind: 'page--ia page--film',
  });
}

function card(s: Summary): string {
  const cover = s.cover ? `<span class="fm-card__cover"><img src="${e(s.cover.src)}" alt="${e(s.cover.alt)}" width="${s.cover.w}" height="${s.cover.h}" loading="lazy" decoding="async"></span>` : '';
  return `<li class="fm-card"><a class="fm-card__a" href="${url(`/film/${s.slug}/`)}">${cover}<span class="fm-card__title">${e(s.title)}</span><span class="fm-card__meta small muted">${e(s.stock)} · ${s.format} · ISO ${s.iso} → EI ${s.ei}（${stopsText(s.stops)}）· ${s.process} · ${s.frames} 张</span><span class="fm-card__sum small">${e(s.summary)}</span></a></li>`;
}

export function listPage(site: SiteData, route: Route, list: Summary[]): Page {
  return shell(site, route, {
    title: '胶片记录',
    description: '每卷胶片的片种、推拉、冲洗与逐张参数，附推拉冲时间与互易律补偿估算',
    top: pageHead('胶片记录', '每卷胶片的片种、推拉、冲洗与逐张参数，附推拉冲时间与互易律补偿估算'),
    main: bento(tile('full', list.length ? `<ul class="fm-cards" role="list">${list.map(card).join('')}</ul>` : '<p class="muted">还没有胶卷记录。</p>', { cls: 'ia-tile fm-tile' })),
    kind: 'page--ia page--film',
  });
}
