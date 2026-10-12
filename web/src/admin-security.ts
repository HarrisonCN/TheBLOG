/**
 * L22 后台「二次验证」（按需加载）：开启 TOTP（otpauth 链接 + 手动输入的密钥 + 二维码）、一次性恢复码、关闭、后台安全记录。
 * 二维码用已有的 uqr 依赖生成 SVG（不引入新依赖），密钥不会离开这个页面。
 */
import { encode } from 'uqr';
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { eventText } from './security-labels';

interface EventItem { id: number; kind: string; device: string; detail: string; createdAt: number }

interface Host {
  fetch: <T>(path: string, init?: RequestInit) => Promise<T>;
  msg: (text: string, err?: boolean) => void;
  errText: (err: unknown) => string;
}
interface Status { enabled: boolean; enabledAt: number | null; pending: boolean; recoveryRemaining: number; events: EventItem[]; nextBefore: number | null; demo?: boolean }

/** 二维码 → SVG（每个模块 1 个单位，路径合并成一条；带白底，深色模式下也能被扫描） */
export function qrSvg(text: string, label: string): string {
  const m = encode(text, { ecc: 'M', border: 2 }).data;
  const n = m.length;
  let d = '';
  m.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)));
  return `<svg class="adm-qr" viewBox="0 0 ${n} ${n}" role="img" aria-label="${e(label)}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
/** 密钥每 4 位一组，方便手动输入 */
export const groupSecret = (s: string) => s.replace(/(.{4})(?=.)/g, '$1 ');

const TIME = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmt = (sec: number) => TIME.format(new Date(sec * 1000));
const codesHtml = (codes: string[]) =>
  `<div class="adm-sec-codes" tabindex="-1" role="group" aria-label="恢复码"><p><b>请现在保存这些恢复码</b>：每个只能用一次，手机丢了靠它们登录。离开页面后不会再显示。</p><ol class="adm-sec-codes__list">${codes.map((c) => `<li><code>${e(c)}</code></li>`).join('')}</ol><button class="btn btn--soft btn--sm" type="button" data-sec="copy">${icon('copy')}复制全部</button></div>`;

export async function mountAdminSecurity(box: HTMLElement, h: Host): Promise<void> {
  let setup: { secret: string; otpauth: string } | null = null;
  let codes: string[] | null = null;
  const render = async () => {
    const s = await h.fetch<Status>('/api/admin/security/2fa?limit=20');
    const evs = s.events.length
      ? `<ul class="adm-sec-evs">${s.events.map((v) => `<li><b>${e(eventText(v))}</b><span class="muted small">${e(fmt(v.createdAt))}${v.device ? ` · ${e(v.device)}` : ''}</span></li>`).join('')}</ul>`
      : '<p class="muted">还没有后台安全记录。</p>';
    let main = '';
    if (s.enabled) {
      main = `<p class="adm-sec-state is-on">${icon('check')}<span>二次验证已开启${s.enabledAt ? `（${e(fmt(s.enabledAt))}）` : ''}。登录时除了密码，还要输入验证器里的 6 位码。</span></p>
<p class="muted small">剩余恢复码：<b>${s.recoveryRemaining}</b> 个${s.recoveryRemaining <= 3 ? '（不多了，建议重新生成）' : ''}。</p>
${codes ? codesHtml(codes) : ''}
<form class="adm-sec-form" data-form="recovery"><label for="sec-rc">重新生成恢复码（旧的全部作废）：输入当前验证码</label><div class="adm-sec-row"><input id="sec-rc" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{6}" required><button class="btn btn--soft btn--sm" type="submit">${icon('refresh')}重新生成</button></div></form>
<form class="adm-sec-form" data-form="disable"><label for="sec-off">关闭二次验证：输入验证码或恢复码</label><div class="adm-sec-row"><input id="sec-off" name="code" autocomplete="one-time-code" maxlength="20" required><button class="btn btn--danger btn--sm" type="submit">${icon('close')}关闭</button></div></form>`;
    } else if (setup) {
      main = `<ol class="adm-sec-steps">
<li><p>用身份验证器 App（Google Authenticator、Microsoft Authenticator、1Password、Bitwarden 等）扫描二维码，或者在手机上直接<a href="${e(setup.otpauth)}">点这个 otpauth 链接</a>添加。</p>${qrSvg(setup.otpauth, '二次验证二维码')}</li>
<li><p>不能扫码时，手动输入密钥（基于时间、6 位、30 秒）：</p><p class="adm-sec-key"><code data-secret="${e(setup.secret)}">${e(groupSecret(setup.secret))}</code><button class="btn btn--ghost btn--sm" type="button" data-sec="copy-key">${icon('copy')}复制密钥</button></p></li>
<li><form class="adm-sec-form" data-form="confirm"><label for="sec-on">输入 App 里显示的 6 位验证码完成开启</label><div class="adm-sec-row"><input id="sec-on" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{6}" required><button class="btn btn--primary btn--sm" type="submit">${icon('check')}开启二次验证</button></div></form></li></ol>`;
    } else {
      main = `<p class="adm-sec-state">${icon('lock')}<span>二次验证未开启。开启后，就算后台密码泄露，没有你的手机也登录不了。</span></p>
<button class="btn btn--primary btn--sm" type="button" data-sec="setup">${icon('plus')}开启二次验证</button>`;
    }
    box.innerHTML = `<h2 class="adm-sec-h">${icon('lock')}管理员二次验证（TOTP）</h2>${main}${s.demo ? '<p class="muted small">演示站：密钥只保存在这个浏览器里；真实站点用服务器端密钥派生的加密密钥加密后存进 D1。</p>' : ''}<h3 class="adm-sec-h3">后台安全记录</h3>${evs}`;
    box.setAttribute('aria-busy', 'false');
  };
  const run = async (fn: () => Promise<void>, focusSel?: string) => {
    try {
      await fn();
      await render();
      if (focusSel) box.querySelector<HTMLElement>(focusSel)?.focus();
    } catch (err) {
      h.msg(h.errText(err), true);
    }
  };
  box.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('[data-sec]');
    if (!b) return;
    const a = b.dataset.sec;
    if (a === 'setup')
      void run(async () => {
        setup = await h.fetch('/api/admin/security/2fa/setup', { method: 'POST', body: '{}' });
      }, '#sec-on');
    if (a === 'copy-key' && setup) void navigator.clipboard?.writeText(setup.secret).then(() => h.msg('已复制密钥'), () => h.msg('复制失败，请手动选择', true));
    if (a === 'copy' && codes) void navigator.clipboard?.writeText(codes.join('\n')).then(() => h.msg('已复制恢复码'), () => h.msg('复制失败，请手动选择', true));
  });
  box.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.target as HTMLFormElement;
    const code = (f.elements.namedItem('code') as HTMLInputElement).value.trim();
    const kind = f.dataset.form;
    if (kind === 'confirm')
      void run(async () => {
        const r = await h.fetch<{ recoveryCodes: string[] }>('/api/admin/security/2fa/confirm', { method: 'POST', body: JSON.stringify({ code }) });
        setup = null;
        codes = r.recoveryCodes;
        h.msg('二次验证已开启');
      }, '.adm-sec-codes');
    if (kind === 'recovery')
      void run(async () => {
        codes = (await h.fetch<{ recoveryCodes: string[] }>('/api/admin/security/2fa/recovery', { method: 'POST', body: JSON.stringify({ code }) })).recoveryCodes;
        h.msg('已生成新的恢复码');
      }, '.adm-sec-codes');
    if (kind === 'disable')
      void run(async () => {
        if (!confirm('关闭二次验证？之后只用密码就能登录后台。')) return;
        await h.fetch('/api/admin/security/2fa/disable', { method: 'POST', body: JSON.stringify({ code }) });
        codes = null;
        h.msg('二次验证已关闭');
      });
  });
  await render();
}
