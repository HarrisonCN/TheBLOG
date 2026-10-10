/**
 * 徽章渲染 + DIY 搭配面板（实时预览）。只输出白名单类名 + badgeColors() 算出的 #rrggbb 变量；所有文字都转义。
 * 站长在后台给任何徽章改设计；好朋友在「成为好朋友」页改自己名下的徽章（编号 / 名称仍由站长决定）。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import {
  BADGE_BORDERS, BADGE_COLOR_PRESETS, BADGE_EFFECTS, BADGE_GRADIENTS, BADGE_ICONS, BADGE_LABEL_MAX, BADGE_PRESETS, BADGE_SHAPES, BADGE_SIZES, BADGE_TEXTURES, BORDER_LABELS,
  EFFECT_LABELS_BADGE, GRADIENT_HEX, GRADIENT_LABELS, SHAPE_LABELS, SIZE_LABELS_BADGE, TEXTURE_LABELS, badgeClasses, badgeColors, badgeContrast, legacyDesign, matchPreset,
  normalizeBadgeDesign, sanitizeBadgeLabel, validateBadgeDesign, type BadgeDesign,
} from './badge-design';

/** 一枚徽章的 HTML。design 可以是任何来自接口的值（先宽松归一化；坏数据 → style 对应的预设）。 */
export function badgeHtml(code: string, label: string, design: unknown, style?: string, extraCls = ''): string {
  const d = normalizeBadgeDesign(design, legacyDesign(style));
  const c = badgeColors(d);
  const text = d.label;
  const name = `${label || '好朋友徽章'}：${text ? `${text} · ` : ''}${code}`;
  return `<span class="${badgeClasses(d)}${extraCls ? ` ${extraCls}` : ''}" style="--bd-bg:${c.bg};--bd-bg2:${c.bg2};--bd-ink:${c.ink};--bd-ac:${c.accent}" role="img" aria-label="${e(name)}" title="${e(label || code)}"><span class="bd__em" aria-hidden="true">${icon(d.icon)}</span><span class="bd__plate" aria-hidden="true">${text ? `<b class="bd__t">${e(text)}</b>` : ''}<span class="bd__code">${e(code)}</span></span></span>`;
}

/** 预设陈列（「成为好朋友」页侧栏）。 */
export function presetGallery(code = 'FRIEND-0001'): string {
  return `<ul class="bd-gallery" aria-label="徽章预设样式">${BADGE_PRESETS.map((p) => `<li>${badgeHtml(code, p.label, p.design)}<span>${e(p.label)}</span></li>`).join('')}</ul>`;
}

let seq = 0;
const radio = (group: string, name: string, value: string, checked: boolean, body: string, label: string, cls = '') =>
  `<label class="bdb__opt${cls ? ` ${cls}` : ''}"><input type="radio" name="${name}" value="${e(value)}"${checked ? ' checked' : ''} data-g="${group}"><span class="bdb__optv">${body}</span><span class="visually-hidden">${e(label)}</span></label>`;

/** DIY 搭配面板。code / label 只用于预览；保存时交给 onSave(design)。 */
export function badgeBuilderHtml(o: { code: string; label: string; design: unknown; style?: string; who?: 'admin' | 'member' }): string {
  const id = `bdb${++seq}`;
  const d = normalizeBadgeDesign(o.design, legacyDesign(o.style));
  const cur = matchPreset(d);
  const n = (k: string) => `${id}-${k}`;
  const fieldset = (legend: string, body: string, cls = '') => `<fieldset class="bdb__fs${cls ? ` ${cls}` : ''}"><legend>${legend}</legend><div class="bdb__opts">${body}</div></fieldset>`;
  return `<form class="bdb js-bdb" data-code="${e(o.code)}" data-label="${e(o.label)}" data-id="${id}" novalidate aria-label="徽章 ${e(o.code)} 的样式">
  <div class="bdb__preview" aria-live="polite"><div class="bdb__stage bdb__stage--light js-bdb-prev">${badgeHtml(o.code, o.label, d)}</div><div class="bdb__stage bdb__stage--dark js-bdb-prev2">${badgeHtml(o.code, o.label, d)}</div><p class="bdb__contrast js-bdb-contrast muted small"></p></div>
  ${fieldset('预设', BADGE_PRESETS.map((p) => `<button type="button" class="bdb__preset" data-preset="${p.id}" aria-pressed="${cur === p.id}">${badgeHtml('ID', p.label, { ...p.design, size: 's' })}<span>${e(p.label)}</span></button>`).join(''), 'bdb__fs--presets')}
  ${fieldset('形状', BADGE_SHAPES.map((v) => radio('shape', n('shape'), v, d.shape === v, `<span class="bdb__shape bdb__shape--${v}" aria-hidden="true"></span>${e(SHAPE_LABELS[v])}`, SHAPE_LABELS[v])).join(''))}
  ${fieldset('材质', BADGE_TEXTURES.map((v) => radio('texture', n('texture'), v, d.texture === v, e(TEXTURE_LABELS[v]), TEXTURE_LABELS[v])).join(''))}
  ${fieldset('底色', `${radio('fill', n('fill'), 'solid', d.fill === 'solid', '纯色', '纯色')}${radio('fill', n('fill'), 'gradient', d.fill === 'gradient', '渐变', '渐变')}
    <span class="bdb__swatches js-bdb-solid"${d.fill === 'gradient' ? ' hidden' : ''}>${BADGE_COLOR_PRESETS.map((c) => radio('color', n('color'), c.hex, d.color === c.hex, `<span class="bdb__sw" style="background:${c.hex}"></span>`, c.label, 'bdb__opt--sw')).join('')}<label class="bdb__custom">自定义 <input type="color" class="js-bdb-custom" value="${d.color}" aria-label="自定义底色"></label></span>
    <span class="bdb__swatches js-bdb-grad"${d.fill === 'solid' ? ' hidden' : ''}>${BADGE_GRADIENTS.map((g) => radio('gradient', n('gradient'), g, d.gradient === g, `<span class="bdb__sw" style="background:linear-gradient(135deg,${GRADIENT_HEX[g][0]},${GRADIENT_HEX[g][1]})"></span>`, GRADIENT_LABELS[g], 'bdb__opt--sw')).join('')}</span>`)}
  ${fieldset('边框', BADGE_BORDERS.map((v) => radio('border', n('border'), v, d.border === v, e(BORDER_LABELS[v]), BORDER_LABELS[v])).join(''))}
  ${fieldset('图标', BADGE_ICONS.map((v) => radio('icon', n('icon'), v, d.icon === v, icon(v), `图标 ${v}`, 'bdb__opt--icon')).join(''), 'bdb__fs--icons')}
  <div class="bdb__row"><label class="bdb__text">徽章文字（最多 ${BADGE_LABEL_MAX} 个字，可留空）<input type="text" class="js-bdb-label" maxlength="${BADGE_LABEL_MAX * 2}" value="${e(d.label)}" autocomplete="off"></label><span class="bdb__count js-bdb-count muted small" aria-live="polite"></span></div>
  ${fieldset('特效', BADGE_EFFECTS.map((v) => radio('effect', n('effect'), v, d.effect === v, e(EFFECT_LABELS_BADGE[v]), EFFECT_LABELS_BADGE[v])).join(''))}
  ${fieldset('大小', BADGE_SIZES.map((v) => radio('size', n('size'), v, d.size === v, e(SIZE_LABELS_BADGE[v]), SIZE_LABELS_BADGE[v])).join(''))}
  <p class="bdb__err js-bdb-err" role="alert" hidden></p>
  <div class="bdb__actions"><button class="btn btn--primary btn--sm" type="submit">${icon('check')}保存样式</button><button class="btn btn--ghost btn--sm js-bdb-reset" type="button">还原</button><span class="muted small">${o.who === 'member' ? '只改样式；编号和名称由站长决定。' : '动效在「减少动态效果」时自动变成静态。'}</span></div>
</form>`;
}

/** 从表单读出设计（未校验）。 */
export function readBuilder(form: HTMLFormElement): Record<string, unknown> {
  const pick = (g: string) => form.querySelector<HTMLInputElement>(`input[data-g="${g}"]:checked`)?.value;
  const custom = form.querySelector<HTMLInputElement>('.js-bdb-custom');
  const colorRadio = pick('color');
  return {
    texture: pick('texture'),
    shape: pick('shape'),
    fill: pick('fill'),
    color: (form.dataset.customColor === '1' ? custom?.value : colorRadio) ?? custom?.value,
    gradient: pick('gradient'),
    border: pick('border'),
    icon: pick('icon'),
    label: form.querySelector<HTMLInputElement>('.js-bdb-label')?.value ?? '',
    effect: pick('effect'),
    size: pick('size'),
  };
}

function applyToForm(form: HTMLFormElement, d: BadgeDesign): void {
  for (const k of ['texture', 'shape', 'fill', 'gradient', 'border', 'icon', 'effect', 'size', 'color'] as const) {
    const el = form.querySelector<HTMLInputElement>(`input[data-g="${k}"][value="${d[k]}"]`);
    form.querySelectorAll<HTMLInputElement>(`input[data-g="${k}"]`).forEach((r) => (r.checked = r === el));
  }
  const custom = form.querySelector<HTMLInputElement>('.js-bdb-custom');
  if (custom) custom.value = d.color;
  form.dataset.customColor = form.querySelector(`input[data-g="color"][value="${d.color}"]`) ? '0' : '1';
  const lab = form.querySelector<HTMLInputElement>('.js-bdb-label');
  if (lab) lab.value = d.label;
}

/** 绑定面板：任何改动 → 校验 → 刷新预览；提交 → onSave(已严格校验的设计)。 */
export function bindBadgeBuilder(form: HTMLFormElement, onSave: (d: BadgeDesign) => Promise<void>): void {
  if (form.dataset.bound) return;
  form.dataset.bound = '1';
  const initial = normalizeBadgeDesign(readBuilder(form));
  const err = form.querySelector<HTMLElement>('.js-bdb-err')!;
  const update = () => {
    const raw = readBuilder(form);
    const label = String(raw.label ?? '');
    const clean = sanitizeBadgeLabel(label);
    const count = form.querySelector<HTMLElement>('.js-bdb-count');
    if (count) count.textContent = `${Array.from(clean).length} / ${BADGE_LABEL_MAX}${clean !== label.replace(/\s+/g, ' ').trim() ? ' · 已过滤不支持的字符' : ''}`;
    const r = validateBadgeDesign({ ...raw, label: clean });
    const d = r.ok ? r.design : normalizeBadgeDesign(null, initial);
    form.querySelector('.js-bdb-solid')?.toggleAttribute('hidden', d.fill !== 'solid');
    form.querySelector('.js-bdb-grad')?.toggleAttribute('hidden', d.fill !== 'gradient');
    const html = badgeHtml(form.dataset.code ?? '', form.dataset.label ?? '', d);
    form.querySelector('.js-bdb-prev')!.innerHTML = html;
    form.querySelector('.js-bdb-prev2')!.innerHTML = html;
    const c = badgeColors(d);
    const ratio = Math.min(badgeContrast(c.ink, c.bg), badgeContrast(c.ink, c.bg2));
    const adjusted = d.texture !== 'neon' && d.fill === 'solid' && c.bg !== d.color;
    form.querySelector('.js-bdb-contrast')!.textContent = `文字对比度 ${ratio.toFixed(1)}:1（AA ≥ 4.5）${adjusted ? ' · 底色已自动加深' : ''}`;
    const preset = matchPreset(d);
    form.querySelectorAll<HTMLButtonElement>('.bdb__preset').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === preset)));
    return d;
  };
  form.addEventListener('input', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.classList.contains('js-bdb-custom')) {
      form.dataset.customColor = '1';
      form.querySelectorAll<HTMLInputElement>('input[data-g="color"]').forEach((r) => (r.checked = false));
    } else if (t.dataset.g === 'color') form.dataset.customColor = '0';
    err.hidden = true;
    update();
  });
  form.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('.bdb__preset');
    if (b) {
      const p = BADGE_PRESETS.find((x) => x.id === b.dataset.preset);
      if (p) applyToForm(form, { ...p.design });
      update();
      return;
    }
    if ((ev.target as HTMLElement).closest('.js-bdb-reset')) {
      applyToForm(form, initial);
      update();
    }
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const raw = readBuilder(form);
    const r = validateBadgeDesign({ ...raw, label: sanitizeBadgeLabel(raw.label) });
    if (!r.ok) {
      err.textContent = r.error;
      err.hidden = false;
      return;
    }
    const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      await onSave(r.design);
    } catch (e2) {
      err.textContent = (e2 as Error).message;
      err.hidden = false;
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  form.dataset.customColor = form.querySelector('input[data-g="color"]:checked') ? '0' : '1';
  update();
}
