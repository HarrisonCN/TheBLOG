/**
 * 社区功能的浏览器端交互：谁在看网站（presence）、留言 / 便利贴、注册好朋友（邮箱验证码）、
 * 上传文件、语音留言。接口见 api.ts；演示站由浏览器内 mock 实现，正式站由 Worker 社区模块实现。
 */
import { api, API_BASE, ApiError, DEMO } from './api';
import { defineUsed, loadFx } from './usa';
import type { PublicMember, Viewer } from './demo/community-types';
import { memberBadge } from './render';
import { DEFAULT_NOTE_STYLE, guardInk, isDefaultStyle, NOTE_PAPERS, validateNoteStyle, type NotePaper, type NoteStyle } from './note-style';
import { noteTextHtml } from './note-style-view';
import { badgeBuilderHtml, bindBadgeBuilder } from './badge-view';
import { escapeHtml } from './markdown';

type Notify = (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => Promise<void> | void;
interface Ctx {
  notify: Notify;
  rerender?: () => Promise<void> | void;
}

const MEMBER_KEY = 'blog-member';
export function currentMember(): { token: string; member: PublicMember } | null {
  try {
    // 演示站：标签页可以临时切换成示例用户（sessionStorage，只影响当前标签页）；正式构建里 DEMO 为 false，这一支会被删掉
    const raw = (DEMO && sessionStorage.getItem(MEMBER_KEY)) || localStorage.getItem(MEMBER_KEY);
    return raw ? (JSON.parse(raw) as { token: string; member: PublicMember }) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 谁在看网站
let sid = '';
let viewers: Viewer[] = [];
let viewerTotal = 0;
let presenceTimer: ReturnType<typeof setInterval> | null = null;
let presenceOff = false;

function anonAvatar(name: string, seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="20" fill="hsl(${h} 65% 58%)"/><text x="20" y="26" font-size="17" font-family="sans-serif" text-anchor="middle" fill="#fff">${name.slice(0, 1).replace(/[<&>"]/g, '')}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function paintViewers(): void {
  document.querySelectorAll<HTMLElement>('.js-viewers').forEach((box) => {
    const stack = box.querySelector('usa-avatar-stack');
    const text = box.querySelector('.viewers__text');
    if (presenceOff) {
      if (text) text.textContent = '在线人数需要部署 Worker 社区模块。';
      return;
    }
    if (stack) {
      const fresh = document.createElement('usa-avatar-stack');
      for (const a of ['max', 'size', 'class']) {
        const v = stack.getAttribute(a);
        if (v) fresh.setAttribute(a, v);
      }
      for (const v of viewers) {
        const img = document.createElement('img');
        img.alt = v.member ? v.name : `匿名访客 ${v.name}`;
        img.title = `${v.member ? v.name : '匿名访客'} · 正在看 ${v.page}`;
        img.src = v.avatar && /^https:\/\//.test(v.avatar) ? v.avatar : anonAvatar(v.name, v.sid);
        img.width = img.height = 34;
        fresh.append(img);
      }
      stack.replaceWith(fresh);
    }
    if (text) text.textContent = viewerTotal > 1 ? `当前有 ${viewerTotal} 位访客在看（包括你）` : '现在只有你在看，欢迎！';
  });
  void defineUsed(document.body);
}

async function ping(): Promise<void> {
  if (presenceOff || document.hidden) return;
  try {
    const r = await api.presence({ sid, page: document.title.split(' | ')[0]!.slice(0, 40) });
    viewers = r.viewers;
    viewerTotal = r.total;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 0)) presenceOff = true;
  }
  paintViewers();
}

export function initCommunity(_ctx: Ctx): void {
  if (presenceTimer) return;
  sid = sessionStorage.getItem('blog-sid') ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  sessionStorage.setItem('blog-sid', sid);
  void ping();
  presenceTimer = setInterval(() => void ping(), 30_000);
  document.addEventListener('visibilitychange', () => !document.hidden && void ping());
}

// ---------------------------------------------------------------- 表单工具
type BtnEl = HTMLElement & { state?: string };
function submitBtn(form: HTMLElement): BtnEl | null {
  return form.querySelector<BtnEl>('.js-submit-btn');
}
/** 校验没通过：按钮回到初始状态 */
function bail(form: HTMLElement): void {
  const b = submitBtn(form);
  if (b) b.state = 'idle';
}
async function withButton<T>(form: HTMLElement, fn: () => Promise<T>): Promise<T> {
  const b = submitBtn(form);
  const native = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (native) native.disabled = true;
  if (b) b.state = 'loading';
  try {
    const r = await fn();
    if (b) b.state = 'success';
    return r;
  } catch (e) {
    if (b) b.state = 'error';
    throw e;
  } finally {
    if (native) native.disabled = false;
    setTimeout(() => b && (b.state = 'idle'), 1600);
  }
}
async function celebrate(el: HTMLElement, effect = 'confetti'): Promise<void> {
  if (document.documentElement.dataset.paused || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const fx = await loadFx();
  await fx.playEffect(el, effect).catch(() => undefined);
}
function fieldValue(form: HTMLElement, name: string): string {
  const f = form.querySelector<HTMLElement & { value?: string }>(`[name="${name}"]`);
  return String(f?.value ?? '').trim();
}
function errMsg(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 404) return '这个功能需要部署 Worker 社区模块';
    const d = (e.details as { message?: string }[] | undefined)?.[0]?.message;
    return d ? `${e.message}：${d}` : e.message;
  }
  return (e as Error)?.message || '出错了';
}

// ---------------------------------------------------------------- 页面绑定
export function bindCommunity(root: HTMLElement, ctx: Ctx): void {
  paintViewers();
  bindGuestbook(root, ctx);
  bindNotes(root, ctx);
  bindJoin(root, ctx);
  bindMailbox(root, ctx);
}

function bindGuestbook(root: HTMLElement, ctx: Ctx): void {
  const form = root.querySelector<HTMLFormElement>('.js-gb-form');
  if (!form) return;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = fieldValue(form, 'name');
    const content = (form.querySelector('textarea')?.value ?? '').trim();
    const website = fieldValue(form, 'website');
    if (!name || !content) return void (bail(form), ctx.notify('请填写昵称和留言内容', 'warning'));
    try {
      await withButton(form, () => api.postGuestbook({ name, content, website: website || undefined }));
      form.querySelector('textarea')!.value = '';
      void ctx.notify('留言已提交，审核通过后会显示', 'success');
      void celebrate(form.querySelector<HTMLElement>('.js-submit-btn') ?? form);
    } catch (e) {
      void ctx.notify(errMsg(e), 'error');
    }
  });
}

function bindNotes(root: HTMLElement, ctx: Ctx): void {
  const form = root.querySelector<HTMLFormElement>('.js-note-form');
  if (!form) return;
  const preview = form.querySelector<HTMLElement>('.js-note-preview');
  const pText = form.querySelector<HTMLElement>('.js-note-preview-text');
  const pName = form.querySelector<HTMLElement>('.js-note-preview-name');
  const hint = form.querySelector<HTMLElement>('.js-ink-hint');
  const read = (): { paper: NotePaper; style: NoteStyle; adjusted: boolean } => {
    const fd = new FormData(form);
    const paper = (NOTE_PAPERS as readonly string[]).includes(String(fd.get('color'))) ? (String(fd.get('color')) as NotePaper) : 'yellow';
    const ink = String(fd.get('ink') ?? DEFAULT_NOTE_STYLE.color);
    const raw = ink === 'custom' ? String(fd.get('customColor') ?? DEFAULT_NOTE_STYLE.color) : ink;
    const color = guardInk(raw, paper);
    const draft = {
      color,
      font: String(fd.get('font') ?? DEFAULT_NOTE_STYLE.font),
      size: String(fd.get('size') ?? DEFAULT_NOTE_STYLE.size),
      weight: fd.get('bold') ? 'bold' : 'normal',
      italic: !!fd.get('italic'),
      effect: String(fd.get('effect') ?? 'none'),
    };
    const v = validateNoteStyle(draft, paper);
    return { paper, style: v.ok ? v.style : { ...DEFAULT_NOTE_STYLE }, adjusted: color !== raw.toLowerCase() };
  };
  const paint = () => {
    const { paper, style, adjusted } = read();
    const fd = new FormData(form);
    if (preview) preview.dataset.paper = paper;
    if (pText) pText.innerHTML = noteTextHtml(String(fd.get('content') ?? '').trim() || '写一句话贴在墙上', style, paper);
    if (pName) pName.textContent = String(fd.get('name') ?? '').trim() || '你的昵称';
    if (hint) hint.textContent = adjusted ? `这个颜色在便签上太浅，已自动加深为 ${style.color}，保证文字清晰可读。` : '';
    const custom = form.querySelector<HTMLInputElement>('input[name="customColor"]');
    if (custom) custom.closest('.inks')?.classList.toggle('is-custom', String(fd.get('ink')) === 'custom');
  };
  form.addEventListener('input', paint);
  form.addEventListener('change', paint);
  form.querySelector('input[name="customColor"]')?.addEventListener('input', () => {
    const r = form.querySelector<HTMLInputElement>('input[name="ink"][value="custom"]');
    if (r) r.checked = true;
    paint();
  });
  form.querySelector('.js-diy-reset')?.addEventListener('click', () => {
    form.querySelectorAll<HTMLInputElement>('.js-note-diy input').forEach((i) => {
      if (i.type === 'radio') i.checked = i.defaultChecked;
      if (i.type === 'checkbox') i.checked = false;
    });
    paint();
  });
  paint();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const { paper, style } = read();
    const body = { name: String(fd.get('name') ?? '').trim(), content: String(fd.get('content') ?? '').trim(), color: paper, ...(isDefaultStyle(style) ? {} : { style }) };
    if (!body.name || !body.content) return void (bail(form), ctx.notify('请填写昵称和内容', 'warning'));
    try {
      await withButton(form, () => api.postNote(body));
      void ctx.notify('已贴到墙上', 'success');
      setTimeout(() => void ctx.rerender?.(), 700);
    } catch (e) {
      void ctx.notify(errMsg(e), 'error');
    }
  });
}

/** Google 登录回跳：令牌在 #member-token=… 里（不进服务器日志），取出后立刻从地址栏抹掉。 */
async function adoptGoogleToken(ctx: Ctx): Promise<PublicMember | null> {
  const m = /^#member-token=(m_[A-Za-z0-9_-]{16,128})$/.exec(location.hash);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const { member } = await api.me(m[1]!);
    localStorage.setItem(MEMBER_KEY, JSON.stringify({ token: m[1], member }));
    return member;
  } catch (e) {
    ctx.notify(errMsg(e), 'error');
    return null;
  }
}

/** 好朋友自己的徽章 DIY：每枚徽章一个可折叠的搭配面板（只改样式，编号 / 名称由站长决定）。 */
function paintMyBadgeDesigners(root: HTMLElement, m: PublicMember, ctx: Ctx, refresh: (m: PublicMember) => void): void {
  const box = root.querySelector<HTMLElement>('.js-join-designs');
  if (!box) return;
  if (!m.badges?.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `<h3 class="join__designs-h">自定义你的徽章</h3>${m.badges
    .map((b) => `<details class="bd-edit"><summary>${memberBadge(b.code, b.label, b.style, b.design ?? null)}<span>设计「${escapeHtml(b.label)}」的样式</span></summary>${badgeBuilderHtml({ code: b.code, label: b.label, design: b.design ?? null, style: b.style, who: 'member' })}</details>`)
    .join('')}`;
  box.querySelectorAll<HTMLFormElement>('form.js-bdb').forEach((f) =>
    bindBadgeBuilder(f, async (design) => {
      const cur = currentMember();
      if (!cur) throw new Error('登录已过期，请重新验证邮箱');
      const r = await api.setMyBadge(cur.token, f.dataset.code!, design);
      localStorage.setItem(MEMBER_KEY, JSON.stringify({ token: cur.token, member: r.member }));
      void ctx.notify('徽章样式已保存', 'success');
      refresh(r.member);
      root.querySelector<HTMLElement>('.bd-edit summary')?.focus();
    }),
  );
}

function bindJoin(root: HTMLElement, ctx: Ctx): void {
  const form = root.querySelector<HTMLFormElement>('.js-join-form');
  if (!form) return;
  void adoptGoogleToken(ctx).then((m) => m && showDone(m));
  const steps = root.querySelectorAll('.js-join-steps li');
  const step = (n: number) => steps.forEach((li, i) => li.classList.toggle('is-active', i <= n));
  const otpBox = root.querySelector<HTMLElement>('.js-join-otp')!;
  const done = root.querySelector<HTMLElement>('.js-join-done')!;
  const showDone = (m: PublicMember) => {
    form.hidden = true;
    otpBox.hidden = true;
    done.hidden = false;
    root.querySelector('.js-join-name')!.textContent = m.name;
    const badges = root.querySelector<HTMLElement>('.js-join-badges');
    if (badges) {
      badges.innerHTML = m.badges?.length
        ? `你的社交 ID：${m.badges.map((b) => memberBadge(b.code, b.label, b.style, b.design)).join(' ')}`
        : '站长给你颁发徽章后，你的专属社交 ID 会出现在这里。';
      void defineUsed(badges);
    }
    paintMyBadgeDesigners(root, m, ctx, showDone);
    step(2);
    document.dispatchEvent(new CustomEvent('blog:member'));
    void defineUsed(done).then(() => (done.querySelector('usa-check') as (HTMLElement & { play?: () => void }) | null)?.play?.());
  };
  const me = currentMember();
  if (me) showDone(me.member);
  root.querySelector('.js-logout')?.addEventListener('click', () => {
    localStorage.removeItem(MEMBER_KEY);
    if (DEMO) sessionStorage.removeItem(MEMBER_KEY);
    document.dispatchEvent(new CustomEvent('blog:member'));
    form.hidden = false;
    otpBox.hidden = true;
    done.hidden = true;
    step(0);
    void ctx.notify('已退出登录', 'info');
    void ctx.rerender?.();
  });
  let email = '';
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fields = [...form.querySelectorAll<HTMLElement & { validate?: () => boolean }>('usa-field')];
    if (fields.some((f) => f.validate && !f.validate())) return bail(form);
    const name = fieldValue(form, 'name');
    email = fieldValue(form, 'email');
    const bio = fieldValue(form, 'bio');
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return void (bail(form), ctx.notify('请填写昵称和有效的邮箱', 'warning'));
    try {
      const r = await withButton(form, () => api.register({ name, email, bio }));
      otpBox.hidden = false;
      root.querySelector('.js-join-email')!.textContent = email;
      if (r.demoCode) root.querySelector('.js-demo-otp')!.textContent = `（演示站验证码：${r.demoCode}）`;
      step(1);
      void defineUsed(otpBox).then(() => otpBox.querySelector<HTMLElement>('usa-otp input, usa-otp')?.focus());
    } catch (e) {
      void ctx.notify(errMsg(e), 'error');
    }
  });
  const otp = root.querySelector<HTMLElement & { success?: () => void; error?: (m?: string) => void; clear?: () => void }>('.js-otp');
  otp?.addEventListener('usa:complete', async (ev) => {
    const code = (ev as CustomEvent<{ code: string }>).detail?.code ?? '';
    const msg = root.querySelector('.js-otp-msg')!;
    msg.textContent = '验证中…';
    try {
      const r = await api.verify({ email, code });
      otp.success?.();
      localStorage.setItem(MEMBER_KEY, JSON.stringify(r));
      msg.textContent = '';
      setTimeout(() => showDone(r.member), 700);
      void celebrate(otp);
    } catch (e) {
      otp.error?.(errMsg(e));
      msg.textContent = errMsg(e);
    }
  });
  // L22：用 Passkey 登录（浏览器支持时才显示；WebAuthn 代码在按需加载的 security-client 里）
  const pk = root.querySelector<HTMLButtonElement>('.js-passkey-login');
  if (pk && 'PublicKeyCredential' in window && !currentMember()) pk.hidden = false;
  root.querySelector('.js-logout')?.addEventListener('click', () => pk && (pk.hidden = !('PublicKeyCredential' in window)));
  pk?.addEventListener('click', async () => {
    pk.disabled = true;
    try {
      const r = (await (await import('./security-client')).passkeyLogin()) as { member: PublicMember; token: string };
      localStorage.setItem(MEMBER_KEY, JSON.stringify(r));
      pk.hidden = true;
      showDone(r.member);
      void ctx.notify('已用 Passkey 登录', 'success');
    } catch (e) {
      void ctx.notify(errMsg(e), 'error');
    } finally {
      pk.disabled = false;
    }
  });
  root.querySelector('.js-google')?.addEventListener('click', () => {
    if (DEMO) return void ctx.notify('演示站不会连接 Google。正式站点会跳转到 Google 授权页，并由你决定是否公开头像。', 'info');
    location.href = `${API_BASE}/api/members/google/start`;
  });
}

function bindMailbox(root: HTMLElement, ctx: Ctx): void {
  const gate = root.querySelector<HTMLElement>('.js-member-gate');
  if (!gate) return;
  const me = currentMember();
  const upload = root.querySelector<HTMLFormElement>('.js-upload')!;
  if (me) {
    gate.innerHTML = `<p>你好，<b>${me.member.name.replace(/[<&>"]/g, '')}</b>。</p>`;
    upload.hidden = false;
  }
  const limit = DEMO ? 2_000_000 : 10_000_000;
  root.querySelector<HTMLInputElement>('.js-upload-input')?.addEventListener('change', async (ev) => {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !me) return;
    const list = root.querySelector('.js-upload-list')!;
    const row = document.createElement('usa-upload-progress') as HTMLElement & { value?: number; status?: string };
    row.setAttribute('name', file.name);
    row.setAttribute('size', String(file.size));
    row.setAttribute('value', '0');
    list.prepend(row);
    await defineUsed(list);
    if (file.size > limit) {
      row.setAttribute('message', `文件超过 ${(limit / 1e6).toFixed(0)} MB`);
      row.status = 'error';
      return;
    }
    let v = 0;
    const t = setInterval(() => {
      v = Math.min(90, v + 7 + Math.random() * 10);
      row.value = v;
    }, 160);
    try {
      await api.upload(me.token, file, String(new FormData(upload).get('note') ?? ''));
      clearInterval(t);
      row.value = 100;
      row.status = 'done';
      void ctx.notify('已上传，站长审核后会看到', 'success');
    } catch (e) {
      clearInterval(t);
      row.setAttribute('message', errMsg(e));
      row.status = 'error';
    }
  });
  bindVoice(root, ctx, me);
}

function bindVoice(root: HTMLElement, ctx: Ctx, me: ReturnType<typeof currentMember>): void {
  const vb = root.querySelector<HTMLElement & { listening?: boolean; level?: number }>('.js-voice-btn');
  if (!vb) return;
  const status = root.querySelector('.js-voice-status')!;
  const audio = root.querySelector<HTMLAudioElement>('.js-voice-audio')!;
  const send = root.querySelector<HTMLElement>('.js-voice-send')!;
  let rec: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let started = 0;
  let blob: Blob | null = null;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;
  let raf = 0;
  const stop = () => {
    if (rec && rec.state !== 'inactive') rec.stop();
  };
  vb.addEventListener('click', async () => {
    if (!me) return void ctx.notify('先注册成为好朋友，才能给我发语音', 'warning');
    if (rec && rec.state === 'recording') return stop();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return void ctx.notify('当前浏览器不支持录音', 'warning');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return void ctx.notify('没有获得麦克风权限', 'warning');
    }
    const ac = new AudioContext();
    const an = ac.createAnalyser();
    an.fftSize = 256;
    ac.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const tick = () => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const x of buf) sum += ((x - 128) / 128) ** 2;
      vb.level = Math.min(1, Math.sqrt(sum / buf.length) * 3);
      raf = requestAnimationFrame(tick);
    };
    tick();
    chunks = [];
    rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      cancelAnimationFrame(raf);
      if (stopTimer) clearTimeout(stopTimer);
      stream.getTracks().forEach((t) => t.stop());
      void ac.close();
      vb.listening = false;
      blob = new Blob(chunks, { type: rec?.mimeType || 'audio/webm' });
      audio.src = URL.createObjectURL(blob);
      audio.hidden = false;
      send.hidden = false;
      status.textContent = `录好了（${((Date.now() - started) / 1000).toFixed(1)} 秒），可以试听，长按「发送」发给我。`;
      void defineUsed(send.parentElement!);
    };
    rec.start();
    started = Date.now();
    vb.listening = true;
    status.textContent = '正在录音…再点一次结束（最长 60 秒）';
    stopTimer = setTimeout(stop, 60_000);
  });
  send.addEventListener('usa:confirm', async () => {
    if (!blob || !me) return;
    try {
      await api.voice(me.token, blob, Date.now() - started);
      void ctx.notify('语音已发送，谢谢你', 'success');
      send.hidden = true;
      status.textContent = '已发送。';
    } catch (e) {
      void ctx.notify(errMsg(e), 'error');
    }
  });
}
