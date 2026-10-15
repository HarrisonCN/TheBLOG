/**
 * L29 / v1.29.0 摄影工具箱的页面外壳（纯函数，浏览器和预渲染共用）：
 * /tools/exposure/ 曝光计算器 · /tools/dof/ 景深计算器 · /tools/golden-hour/ 黄金 / 蓝调时刻 · /tools/exif/ EXIF 查看器。
 * 表单在服务端就带着默认值和默认结果（没有 JS 也能看到一组参考值），photo-tools-client 按需加载后接管交互。
 * 全部在本机计算：不请求定位权限（只有点「使用我的位置」才问），不上传照片，不发任何网络请求。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, kicker, pageHead, shell, tile, url, type Page, type Route } from './render';
import type { SiteData } from './types';
import {
  APERTURES, CITIES, DEFAULT_EXPOSURE, ISOS, ND_STOPS, SENSORS, SHUTTERS,
  cocFor, cropFactor, dof, evAt, fmtAperture, fmtDistance, fmtEv, fmtShutterT, sceneFor, shutterValue,
} from './photo-core';

type ToolRoute = Extract<Route, { name: 'exposure' | 'dof' | 'goldenhour' | 'exifviewer' }>;

const opt = (v: string, label: string, sel: boolean) => `<option value="${e(v)}"${sel ? ' selected' : ''}>${e(label)}</option>`;
const field = (label: string, control: string, hint = '') => `<label class="pt-field"><span class="pt-label">${label}</span>${control}${hint ? `<span class="pt-hint small muted">${hint}</span>` : ''}</label>`;
const privacy = (text: string) => `<p class="pt-privacy small">${icon('lock')}<span>${text}</span></p>`;
const others = (cur: string) =>
  `<nav class="pt-others" aria-label="其它摄影工具">${[
    ['exposure', '/tools/exposure/', '曝光计算器'],
    ['dof', '/tools/dof/', '景深计算器'],
    ['goldenhour', '/tools/golden-hour/', '黄金 / 蓝调时刻'],
    ['exifviewer', '/tools/exif/', 'EXIF 查看器'],
  ]
    .map(([id, href, label]) => `<a class="chip${id === cur ? ' chip--accent' : ''}" href="${url(href!)}"${id === cur ? ' aria-current="page"' : ''}>${label}</a>`)
    .join('')}</nav>`;

function exposureBody(): string {
  const x = DEFAULT_EXPOSURE;
  const ev = evAt(x.N, x.t, x.iso);
  return `${kicker('aperture', '曝光三要素')}
<form class="pt-form js-pt-form" data-ptool="exposure" novalidate>
  <div class="pt-grid">
    ${field('光圈', `<select name="f" class="pt-input">${APERTURES.map((n) => opt(String(n), fmtAperture(n), n === x.N)).join('')}</select>`)}
    ${field('快门', `<select name="t" class="pt-input">${SHUTTERS.map((t) => opt(shutterValue(t), fmtShutterT(t), Math.abs(t - x.t) < 1e-9)).join('')}</select>`)}
    ${field('ISO', `<select name="iso" class="pt-input">${ISOS.map((n) => opt(String(n), String(n), n === x.iso)).join('')}</select>`)}
    ${field('ND 减光镜', `<select name="nd" class="pt-input">${ND_STOPS.map((n) => opt(String(n), n ? `${n} 档（ND${2 ** n}）` : '不加', n === 0)).join('')}</select>`)}
  </div>
  <p class="pt-from small muted js-pt-from" hidden></p>
  <div class="pt-result" aria-live="polite">
    <p class="pt-big"><span class="js-pt-ev">${fmtEv(ev)}</span><span class="pt-unit">（ISO 100 基准）</span></p>
    <p class="pt-scene js-pt-scene">接近：${e(sceneFor(ev))}</p>
    <p class="pt-nd js-pt-nd small muted" hidden></p>
  </div>
  <fieldset class="pt-lock"><legend>等效组合：保持哪个不变</legend>
    <label class="pt-radio"><input type="radio" name="lock" value="iso" checked> ISO</label>
    <label class="pt-radio"><input type="radio" name="lock" value="N"> 光圈</label>
    <label class="pt-radio"><input type="radio" name="lock" value="t"> 快门</label>
  </fieldset>
  <div class="pt-table-wrap" tabindex="0" role="region" aria-label="等效曝光组合"><table class="pt-table js-pt-equiv"><caption class="visually-hidden">等效曝光组合（吸附到 1/3 档）</caption><thead><tr><th scope="col">光圈</th><th scope="col">快门</th><th scope="col">ISO</th></tr></thead><tbody></tbody></table></div>
  <p class="small muted">EV100 = log₂(N²/t) − log₂(ISO/100)。表格吸附到最近的 1/3 档；标「超出」的组合在普通相机上不存在，只供参考。</p>
</form>`;
}

function dofBody(): string {
  const s = SENSORS[0]!;
  const r = dof({ focal: 50, N: 8, distance: 5, coc: cocFor(s) });
  return `${kicker('camera', '景深与超焦距')}
<form class="pt-form js-pt-form" data-ptool="dof" novalidate>
  <div class="pt-grid">
    ${field('传感器', `<select name="sensor" class="pt-input">${SENSORS.map((x) => opt(x.id, `${x.label} · ×${cropFactor(x).toFixed(1)}`, x.id === s.id)).join('')}</select>`)}
    ${field('焦距（mm）', `<input name="focal" class="pt-input" type="number" inputmode="decimal" min="1" max="1200" step="0.1" value="50" required>`, '<span class="js-pt-focal-hint">实际焦距</span>')}
    <label class="pt-check"><input type="checkbox" name="eq35"> 我填的是 35mm 等效焦距（手机常见）</label>
    ${field('光圈', `<select name="f" class="pt-input">${APERTURES.map((n) => opt(String(n), fmtAperture(n), n === 8)).join('')}</select>`)}
    ${field('对焦距离（m）', `<input name="distance" class="pt-input" type="number" inputmode="decimal" min="0.05" max="10000" step="0.01" value="5" required>`)}
    ${field('弥散圆（mm）', `<input name="coc" class="pt-input" type="number" inputmode="decimal" min="0.001" max="0.2" step="0.001" value="${cocFor(s).toFixed(3)}" required>`, '默认 = 传感器对角线 / 1500')}
  </div>
  <div class="pt-result" aria-live="polite">
    <dl class="pt-dl">
      <div><dt>近点</dt><dd class="js-pt-near">${fmtDistance(r.near)}</dd></div>
      <div><dt>远点</dt><dd class="js-pt-far">${fmtDistance(r.far)}</dd></div>
      <div><dt>景深</dt><dd class="js-pt-total">${fmtDistance(r.total)}</dd></div>
      <div><dt>超焦距</dt><dd class="js-pt-hyper">${fmtDistance(r.hyperfocal)}</dd></div>
    </dl>
    <div class="pt-dofbar" aria-hidden="true"><span class="pt-dofbar__zone js-pt-zone"></span><span class="pt-dofbar__focus js-pt-focus"></span></div>
    <p class="small muted js-pt-tip">对焦到超焦距 ${fmtDistance(r.hyperfocal)}，从 ${fmtDistance(r.hyperfocal / 2)} 到无穷远都清晰。</p>
    <p class="pt-err small js-pt-err" role="alert"></p>
  </div>
  <p class="small muted">H = f²/(N·c) + f；近点 = s(H−f)/(H+s−2f)，远点 = s(H−f)/(H−s)。手机主摄焦距通常只有 5–9 mm，所以景深很深。</p>
</form>`;
}

function goldenBody(): string {
  return `${kicker('sun', '黄金时刻与蓝调时刻')}
<form class="pt-form js-pt-form" data-ptool="goldenhour" novalidate>
  <div class="pt-grid">
    ${field('城市', `<select name="city" class="pt-input">${CITIES.map((c) => opt(c.id, c.name, c.id === 'beijing')).join('')}${opt('custom', '自定义坐标…', false)}</select>`)}
    ${field('日期', `<input name="date" class="pt-input" type="date" min="1900-01-01" max="2100-12-31" required>`)}
  </div>
  <fieldset class="pt-custom js-pt-custom" hidden><legend>自定义坐标（保存为约 10 公里精度）</legend>
    <div class="pt-grid">
      ${field('纬度', `<input name="lat" class="pt-input" type="number" inputmode="decimal" min="-90" max="90" step="0.1" value="39.9">`)}
      ${field('经度', `<input name="lng" class="pt-input" type="number" inputmode="decimal" min="-180" max="180" step="0.1" value="116.4">`)}
      ${field('时区', `<select name="tz" class="pt-input js-pt-tz">${[...new Set(CITIES.map((c) => c.tz)), 'UTC'].map((z) => opt(z, z, z === 'Asia/Shanghai')).join('')}</select>`)}
    </div>
    <button class="btn btn--ghost btn--sm js-pt-geo" type="button">${icon('mapPin')}使用我的位置</button>
    <p class="small muted">只有点这个按钮才会请求定位权限；坐标粗化到 0.1° 后只在本机计算，不会发送到任何地方。</p>
  </fieldset>
  <div class="pt-result" aria-live="polite">
    <p class="pt-polar js-pt-polar" hidden></p>
    <ol class="pt-sun js-pt-sun" role="list"></ol>
    <div class="pt-daybar js-pt-daybar" aria-hidden="true"></div>
    <p class="small muted js-pt-now"></p>
    <p class="pt-err small js-pt-err" role="alert"></p>
  </div>
  <p class="small muted">黄金时刻：太阳高度 −4° 到 +6°；蓝调时刻：−6° 到 −4°；日出日落按 −0.833°（含大气折射）。用 NOAA 太阳位置公式离线计算，时间按所选城市的当地时间显示，地形和天气会让实际光线有出入。</p>
</form>`;
}

function exifBody(): string {
  return `${kicker('image', '本地 EXIF 查看器')}
<form class="pt-form js-pt-form" data-ptool="exifviewer" novalidate>
  <label class="pt-drop js-pt-drop"><input class="pt-file js-pt-file" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif"><span class="pt-drop__text">${icon('upload')}<span>选择或拖入一张照片（JPEG / PNG / WebP / HEIC）</span></span></label>
  <div class="pt-result" aria-live="polite">
    <p class="pt-status small muted js-pt-status">还没有选择照片。</p>
    <div class="pt-exif-wrap js-pt-exif" hidden>
      <img class="pt-preview js-pt-preview" alt="所选照片的预览" hidden>
      <dl class="pt-dl js-pt-rows"></dl>
    </div>
    <div class="pt-gps js-pt-gps" hidden>${icon('mapPin')}<p><strong>这张照片带有 GPS 位置。</strong>本页不显示、也不上传坐标；分享前可以下载一份去除元数据的副本（不重新压缩画质）。</p></div>
    <p class="pt-actions"><a class="btn btn--ghost btn--sm js-pt-open-exposure" href="${url('/tools/exposure/')}" hidden>${icon('aperture')}在曝光计算器中打开</a><button class="btn btn--primary btn--sm js-pt-strip" type="button" hidden>${icon('download')}下载去除元数据的副本</button></p>
  </div>
</form>`;
}

const META: Record<ToolRoute['name'], { title: string; desc: string; body: () => string; note: string }> = {
  exposure: { title: '曝光计算器', desc: 'EV 值与光圈 / 快门 / ISO 等效组合，含 ND 减光', body: exposureBody, note: '全部在本机计算。' },
  dof: { title: '景深计算器', desc: '近点、远点与超焦距，含手机传感器', body: dofBody, note: '全部在本机计算。' },
  goldenhour: { title: '黄金 / 蓝调时刻', desc: '按日期和城市离线计算日出日落与最佳拍摄时段', body: goldenBody, note: '默认用城市坐标，不请求定位权限；全部在本机计算。' },
  exifviewer: { title: 'EXIF 查看器', desc: '在本机读取照片参数，不上传；可下载去除元数据的副本', body: exifBody, note: '照片只在你的浏览器里读取，不会上传，也不会发出任何网络请求。' },
};

export function photoToolPage(site: SiteData, route: ToolRoute): Page {
  const m = META[route.name];
  return shell(site, route, {
    title: m.title,
    description: m.desc,
    top: pageHead(m.title, e(m.desc)),
    main: bento(tile('full', `${others(route.name)}${privacy(m.note)}${m.body()}`, { cls: 'ia-tile pt-tile', attrs: `data-ptool-page="${route.name}"` })),
    kind: 'page--ia page--ptool',
  });
}
