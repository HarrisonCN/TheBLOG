/**
 * 社区功能的浏览器端交互：谁在看网站（presence）、留言 / 便利贴、注册好朋友（邮箱验证码）、
 * 上传文件、语音留言。接口见 api.ts；演示站由浏览器内 mock 实现，正式站由 Worker 社区模块实现。
 */
import { api, ApiError, DEMO } from './api';
import { defineUsed, loadFx } from './usa';
import type { PublicMember, Viewer } from './demo/community-types';

type Notify = (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => Promise<void> | void;
interface Ctx {
  notify: Notify;
  rerender?: () => Promise<void> | void;
}

const MEMBER_KEY = 'blog-member';
export function currentMember(): { token: string; member: PublicMember } | null {
  try {
    const raw = localStorage.getItem(MEMBER_KEY);
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
      void ctx.notify('留言已提交，审核通过后会显示 ✨', 'success');
      void celebrate(form.querySelector<HTMLElement>('.js-submit-btn') ?? form);
    } catch (e) {
      void ctx.notify(errMsg(e), 'error');
    }
  });
}

function bindNotes(root: HTMLElement, ctx: Ctx): void {
  const form = root.querySelector<HTMLFormElement>('.js-note-form');
  if (!form) return;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const body = { name: String(fd.get('name') ?? '').trim(), content: String(fd.get('content') ?? '').trim(), color: String(fd.get('color') ?? 'yellow') };
    if (!body.name || !body.content) return void (bail(form), ctx.notify('请填写昵称和内容', 'warning'));
    try {
      await withButton(form, () => api.postNote(body));
      void ctx.notify('已贴到墙上 📌', 'success');
      setTimeout(() => void ctx.rerender?.(), 700);
    } catch (e) {
      void ctx.notify(errMsg(e), 'error');
    }
  });
}

function bindJoin(root: HTMLElement, ctx: Ctx): void {
  const form = root.querySelector<HTMLFormElement>('.js-join-form');
  if (!form) return;
  const steps = root.querySelectorAll('.js-join-steps li');
  const step = (n: number) => steps.forEach((li, i) => li.classList.toggle('is-active', i <= n));
  const otpBox = root.querySelector<HTMLElement>('.js-join-otp')!;
  const done = root.querySelector<HTMLElement>('.js-join-done')!;
  const showDone = (m: PublicMember) => {
    form.hidden = true;
    otpBox.hidden = true;
    done.hidden = false;
    root.querySelector('.js-join-name')!.textContent = m.name;
    step(2);
    void defineUsed(done).then(() => (done.querySelector('usa-check') as (HTMLElement & { play?: () => void }) | null)?.play?.());
  };
  const me = currentMember();
  if (me) showDone(me.member);
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
  root.querySelector('.js-google')?.addEventListener('click', () => {
    if (DEMO) return void ctx.notify('演示站不会连接 Google。正式站点会跳转到 Google 授权页，并由你决定是否公开头像。', 'info');
    location.href = '/api/members/google/start';
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
      void ctx.notify('已上传，站长审核后会看到 📦', 'success');
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
      void ctx.notify('语音已发送，谢谢你 🎙️', 'success');
      send.hidden = true;
      status.textContent = '已发送。';
    } catch (e) {
      void ctx.notify(errMsg(e), 'error');
    }
  });
}
