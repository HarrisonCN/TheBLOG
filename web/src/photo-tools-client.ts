/**
 * L29 / v1.29.0 摄影工具箱的浏览器端交互（按需加载）。
 * 边界：不发任何网络请求；照片用 File.arrayBuffer() 在本机读取；定位权限只在用户点「使用我的位置」时请求，坐标粗化到 0.1°。
 */
import './photo-tools.css';
import { escapeHtml as e } from './markdown';
import { readExif, stripMetadata } from './exif';
import {
  CITIES, SENSORS, coarse, cocFor, cropFactor, dof, equivalents, evAt, exifReport, exposureQuery, fmtAperture, fmtDistance, fmtEv,
  fmtShutterT, fmtTime, localYmd, ndShutter, parseAperture, parseExposureQuery, parseIso, parseShutter, phoneRealFocal, sceneFor,
  shutterValue, sunPosition, sunTimes, type Exposure,
} from './photo-core';

interface Ctx {
  notify: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => unknown;
  basePath: string;
}

export function bindPhotoTools(root: ParentNode, ctx: Ctx): void {
  root.querySelectorAll<HTMLFormElement>('form[data-ptool]').forEach((form) => {
    if (form.dataset.bound) return;
    form.dataset.bound = '1';
    form.addEventListener('submit', (ev) => ev.preventDefault());
    switch (form.dataset.ptool) {
      case 'exposure':
        return bindExposure(form);
      case 'dof':
        return bindDof(form);
      case 'goldenhour':
        return bindGolden(form);
      case 'exifviewer':
        return bindExif(form, ctx);
    }
  });
}

const $ = <T extends Element = HTMLElement>(f: ParentNode, sel: string) => f.querySelector<T>(sel)!;
const val = (f: HTMLFormElement, name: string) => (f.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';

/** 下拉框里没有这个值（比如 EXIF 原值 f/1.78）时插入一项「照片原值」 */
function ensureOption(sel: HTMLSelectElement, value: string, label: string): void {
  if (![...sel.options].some((o) => o.value === value)) sel.add(new Option(`${label}（原值）`, value), 0);
  sel.value = value;
}

// ---------------------------------------------------------------- 曝光
function bindExposure(f: HTMLFormElement): void {
  const q = location.search;
  if (/[?&](f|t|iso)=/.test(q)) {
    const x = parseExposureQuery(q);
    ensureOption(f.elements.namedItem('f') as HTMLSelectElement, String(x.N), fmtAperture(x.N));
    ensureOption(f.elements.namedItem('t') as HTMLSelectElement, shutterValue(x.t), fmtShutterT(x.t));
    ensureOption(f.elements.namedItem('iso') as HTMLSelectElement, String(x.iso), String(x.iso));
    const from = $(f, '.js-pt-from');
    from.textContent = `已带入参数：${fmtAperture(x.N)} · ${fmtShutterT(x.t)} · ISO ${x.iso}`;
    from.hidden = false;
  }
  const run = () => {
    const x: Exposure = { N: parseAperture(val(f, 'f')) ?? 8, t: parseShutter(val(f, 't')) ?? 1 / 125, iso: parseIso(val(f, 'iso')) ?? 100 };
    const ev = evAt(x.N, x.t, x.iso);
    $(f, '.js-pt-ev').textContent = fmtEv(ev);
    $(f, '.js-pt-scene').textContent = `接近：${sceneFor(ev)}`;
    const nd = Number(val(f, 'nd')) || 0;
    const ndEl = $(f, '.js-pt-nd');
    ndEl.hidden = !nd;
    if (nd) ndEl.textContent = `加 ${nd} 档 ND 后，快门从 ${fmtShutterT(x.t)} 变成 ${fmtShutterT(ndShutter(x.t, nd))}${ndShutter(x.t, nd) > 30 ? '（需要 B 门 + 快门线）' : ''}`;
    const lock = (f.querySelector<HTMLInputElement>('input[name="lock"]:checked')?.value ?? 'iso') as 'iso' | 'N' | 't';
    const rows = equivalents(x, lock);
    $(f, '.js-pt-equiv tbody').innerHTML = rows
      .map((r) => {
        const cur = Math.abs(Math.log2(r.N / x.N)) < 0.05 && Math.abs(Math.log2(r.t / x.t)) < 0.05 && Math.abs(Math.log2(r.iso / x.iso)) < 0.05;
        const flag = r.outOfRange ? ' <span class="pt-flag">超出</span>' : '';
        const tCell = lock === 't' ? fmtShutterT(r.t) : `${fmtShutterT(r.t)}${flag}`;
        const isoCell = lock === 't' ? `${r.iso}${flag}` : String(r.iso);
        return `<tr${cur ? ' class="is-current" aria-current="true"' : ''}${r.outOfRange ? ' data-out="1"' : ''}><td>${fmtAperture(r.N)}</td><td>${tCell}</td><td>${isoCell}</td></tr>`;
      })
      .join('');
  };
  f.addEventListener('change', run);
  run();
}

// ---------------------------------------------------------------- 景深
function bindDof(f: HTMLFormElement): void {
  const cocIn = f.elements.namedItem('coc') as HTMLInputElement;
  let cocTouched = false;
  cocIn.addEventListener('input', () => (cocTouched = true));
  const sensor = () => SENSORS.find((s) => s.id === val(f, 'sensor')) ?? SENSORS[0]!;
  const run = (ev?: Event) => {
    const s = sensor();
    if (ev?.target && (ev.target as HTMLElement).getAttribute('name') === 'sensor' && !cocTouched) cocIn.value = cocFor(s).toFixed(3);
    const eq = (f.elements.namedItem('eq35') as HTMLInputElement).checked;
    const raw = Number(val(f, 'focal'));
    const focal = eq ? phoneRealFocal(raw, s) : raw;
    $(f, '.js-pt-focal-hint').textContent = eq ? `实际焦距约 ${focal.toFixed(1)} mm（×${cropFactor(s).toFixed(1)}）` : `等效约 ${Math.round(raw * cropFactor(s))} mm`;
    const err = $(f, '.js-pt-err');
    try {
      const r = dof({ focal, N: Number(val(f, 'f')), distance: Number(val(f, 'distance')), coc: Number(cocIn.value) });
      err.textContent = '';
      $(f, '.js-pt-near').textContent = fmtDistance(r.near);
      $(f, '.js-pt-far').textContent = fmtDistance(r.far);
      $(f, '.js-pt-total').textContent = fmtDistance(r.total);
      $(f, '.js-pt-hyper').textContent = fmtDistance(r.hyperfocal);
      $(f, '.js-pt-tip').textContent = `对焦到超焦距 ${fmtDistance(r.hyperfocal)}，从 ${fmtDistance(r.hyperfocal / 2)} 到无穷远都清晰。`;
      // 对数刻度条：0.1 m – 1 km
      const pos = (m: number) => Math.max(0, Math.min(100, ((Math.log10(Math.max(m, 0.1)) + 1) / 4) * 100));
      const zone = $(f, '.js-pt-zone');
      zone.style.left = `${pos(r.near)}%`;
      zone.style.width = `${(r.far === Infinity ? 100 : pos(r.far)) - pos(r.near)}%`;
      $(f, '.js-pt-focus').style.left = `${pos(Number(val(f, 'distance')))}%`;
    } catch (x) {
      err.textContent = x instanceof RangeError ? `${x.message}，请检查输入。` : '无法计算，请检查输入。';
    }
  };
  f.addEventListener('input', run);
  f.addEventListener('change', run);
  run();
}

// ---------------------------------------------------------------- 黄金 / 蓝调时刻
function bindGolden(f: HTMLFormElement): void {
  const custom = $(f, '.js-pt-custom');
  const dateIn = f.elements.namedItem('date') as HTMLInputElement;
  const tzSel = $<HTMLSelectElement>(f, '.js-pt-tz');
  const browserTz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  })();
  if (![...tzSel.options].some((o) => o.value === browserTz)) tzSel.add(new Option(`${browserTz}（本机）`, browserTz));
  const place = () => {
    const id = val(f, 'city');
    const c = CITIES.find((x) => x.id === id);
    if (c) return { lat: c.lat, lng: c.lng, tz: c.tz, name: c.name };
    return { lat: coarse(Number(val(f, 'lat'))), lng: coarse(Number(val(f, 'lng'))), tz: val(f, 'tz') || browserTz, name: '自定义坐标' };
  };
  if (!dateIn.value) dateIn.value = localYmd(place().tz, new Date());
  const run = () => {
    custom.hidden = val(f, 'city') !== 'custom';
    const p = place();
    const err = $(f, '.js-pt-err');
    const list = $(f, '.js-pt-sun');
    const polar = $(f, '.js-pt-polar');
    try {
      const s = sunTimes(dateIn.value, p.lat, p.lng, p.tz);
      err.textContent = '';
      const t = (d: Date | null) => fmtTime(d, p.tz);
      const span = (x: { start: Date; end: Date } | null) => (x ? `${t(x.start)} – ${t(x.end)}` : '这天没有');
      const items: [string, string, string][] = [
        ['blue', '蓝调时刻（清晨）', span(s.blueMorning)],
        ['golden', '黄金时刻（清晨）', span(s.goldenMorning)],
        ['rise', '日出', t(s.sunrise)],
        ['noon', '正午', `${t(s.solarNoon)} · 太阳高度 ${s.noonElevation.toFixed(0)}°`],
        ['set', '日落', t(s.sunset)],
        ['golden', '黄金时刻（傍晚）', span(s.goldenEvening)],
        ['blue', '蓝调时刻（傍晚）', span(s.blueEvening)],
      ];
      list.innerHTML = items.map(([k, label, v]) => `<li class="pt-sun__i pt-sun__i--${k}"><span class="pt-sun__k">${label}</span><span class="pt-sun__v">${e(v)}</span></li>`).join('');
      polar.hidden = !s.polar;
      polar.textContent = s.polar === 'day' ? '极昼：这天太阳不落山。' : s.polar === 'night' ? '极夜：这天太阳不升起。' : '';
      // 一天的光线条：每 15 分钟一格
      const bar = $(f, '.js-pt-daybar');
      const segs: string[] = [];
      // 以太阳正午为中心的 24 小时（极昼 / 极夜也有正午）
      const start = new Date(`${dateIn.value}T00:00:00Z`).getTime();
      const s0 = s.solarNoon ? s.solarNoon.getTime() - 12 * 3600000 : start;
      for (let i = 0; i < 96; i++) {
        const el = sunPosition(new Date(s0 + i * 900000), p.lat, p.lng).elevation;
        const k = el >= 6 ? 'day' : el >= -4 ? 'golden' : el >= -6 ? 'blue' : 'night';
        segs.push(`<span class="pt-daybar__s pt-daybar__s--${k}"></span>`);
      }
      bar.innerHTML = segs.join('');
      const now = new Date();
      const nowEl = $(f, '.js-pt-now');
      if (localYmd(p.tz, now) === dateIn.value) {
        const pos = sunPosition(now, p.lat, p.lng);
        nowEl.textContent = `${p.name}此刻（${fmtTime(now, p.tz)}）：太阳高度 ${pos.elevation.toFixed(1)}°，方位 ${pos.azimuth.toFixed(0)}°`;
      } else nowEl.textContent = `时间为 ${p.name}当地时间（${p.tz}）。`;
    } catch (x) {
      list.innerHTML = '';
      err.textContent = x instanceof RangeError ? `${x.message}，请检查输入。` : '无法计算，请检查输入。';
    }
  };
  $(f, '.js-pt-geo').addEventListener('click', () => {
    if (!('geolocation' in navigator)) {
      $(f, '.js-pt-err').textContent = '这个浏览器不支持定位，请手动填写坐标。';
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        (f.elements.namedItem('lat') as HTMLInputElement).value = String(coarse(pos.coords.latitude));
        (f.elements.namedItem('lng') as HTMLInputElement).value = String(coarse(pos.coords.longitude));
        tzSel.value = browserTz;
        run();
      },
      () => ($(f, '.js-pt-err').textContent = '没有拿到定位（可能被拒绝了），请手动填写坐标。'),
      { enableHighAccuracy: false, maximumAge: 600000, timeout: 10000 },
    );
  });
  f.addEventListener('change', run);
  f.addEventListener('input', (ev) => {
    if ((ev.target as HTMLElement).getAttribute('type') === 'number') run();
  });
  run();
}

// ---------------------------------------------------------------- EXIF
function bindExif(f: HTMLFormElement, ctx: Ctx): void {
  const input = $<HTMLInputElement>(f, '.js-pt-file');
  const drop = $(f, '.js-pt-drop');
  const status = $(f, '.js-pt-status');
  const wrap = $(f, '.js-pt-exif');
  const rowsEl = $(f, '.js-pt-rows');
  const gps = $(f, '.js-pt-gps');
  const strip = $<HTMLButtonElement>(f, '.js-pt-strip');
  const openExp = $<HTMLAnchorElement>(f, '.js-pt-open-exposure');
  const preview = $<HTMLImageElement>(f, '.js-pt-preview');
  let current: { bytes: Uint8Array; name: string; type: string } | null = null;
  let objUrl = '';
  const show = async (file: File) => {
    if (file.size > 50 * 1024 * 1024) {
      status.textContent = '照片太大了（超过 50 MB）。';
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    current = { bytes, name: file.name, type: file.type };
    const x = readExif(bytes);
    if (objUrl) URL.revokeObjectURL(objUrl);
    objUrl = URL.createObjectURL(file);
    preview.src = objUrl;
    preview.hidden = false;
    wrap.hidden = false;
    strip.hidden = false;
    if (!x) {
      status.textContent = `「${file.name}」里没有找到 EXIF 参数（可能已经被去除）。`;
      rowsEl.innerHTML = '';
      gps.hidden = true;
      openExp.hidden = true;
      return;
    }
    const rep = exifReport(x);
    status.textContent = `已在本机读取「${file.name}」：${rep.rows.length} 项参数。`;
    rowsEl.innerHTML = rep.rows.map((r) => `<div data-k="${e(r.key)}"><dt>${e(r.label)}</dt><dd>${e(r.value)}</dd></div>`).join('');
    gps.hidden = !rep.hasGps;
    openExp.hidden = !rep.exposure;
    if (rep.exposure) openExp.href = `${ctx.basePath}/tools/exposure/${exposureQuery(rep.exposure)}`;
  };
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void show(file);
  });
  drop.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    drop.classList.add('is-over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (ev) => {
    ev.preventDefault();
    drop.classList.remove('is-over');
    const file = ev.dataTransfer?.files?.[0];
    if (file) void show(file);
  });
  strip.addEventListener('click', () => {
    if (!current) return;
    const r = stripMetadata(current.bytes);
    const blob = new Blob([r.bytes as BlobPart], { type: current.type || 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = current.name.replace(/(\.[a-z0-9]+)?$/i, (m) => `-clean${m || '.jpg'}`);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    ctx.notify(r.changed ? '已生成去除元数据的副本（画质不变）' : '这张照片本来就没有可去除的元数据', 'success');
  });
}
