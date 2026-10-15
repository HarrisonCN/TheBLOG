/**
 * 演示模式的浏览器端适配：把 api.ts 的 request() 转给本地的 DemoBackend。
 * 只在 VITE_DEMO=1 的构建里被（动态）引入，正式构建不会打包这部分代码。
 */
import { DB_KEY, DemoBackend, memoryAudioStore, memoryKV, type AudioStore, type KV, type MockResponse } from './mock-api';
import type { DmEvent } from '../dm-core';
import { DEMO_PASSWORD } from './seed';
import './demo.css';

export { DEMO_PASSWORD };

function browserStorage(): KV {
  try {
    const k = '__blog_demo_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return memoryKV(); // 隐私模式等禁用存储时：本页内仍可试用，刷新后丢失
  }
}

/** 站长上传的音频放在 IndexedDB（localStorage 放不下）；不可用时退回内存（刷新后丢失）。 */
function idbAudioStore(): AudioStore {
  if (typeof indexedDB === 'undefined') return memoryAudioStore();
  const fallback = memoryAudioStore();
  let dbp: Promise<IDBDatabase> | null = null;
  const open = () =>
    (dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('blog-demo-audio', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('audio');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction('audio', mode).objectStore('audio'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };
  return {
    put: (k, b) => tx('readwrite', (s) => s.put(b, k)).then(() => undefined).catch(() => fallback.put(k, b)),
    get: (k) => tx<Blob | undefined>('readonly', (s) => s.get(k) as IDBRequest<Blob | undefined>).then((b) => b ?? fallback.get(k)).catch(() => fallback.get(k)),
  };
}

export const backend = new DemoBackend({ storage: browserStorage(), base: import.meta.env.BASE_URL, audio: idbAudioStore(), fixturePosts: Number(import.meta.env.VITE_DEMO_FIXTURE_POSTS ?? 0) || 0 });

// ---------------------------------------------------------------- L19 演示「实时」
// 同一浏览器的标签页共用 localStorage：写入后用 BroadcastChannel 通知其他标签页（它们先丢掉内存缓存再读），
// 本标签页直接回调。每个标签页只把发给「当前标签页身份」的事件交给私信界面。
const dmBus = typeof BroadcastChannel === 'function' ? new BroadcastChannel('theblog-dm') : null;
const dmListeners = new Set<(ev: DmEvent) => void>();
function tabMemberId(): number | null {
  try {
    const raw = sessionStorage.getItem('blog-member') ?? localStorage.getItem('blog-member');
    return raw ? ((JSON.parse(raw) as { member?: { id?: number } }).member?.id ?? null) : null;
  } catch {
    return null;
  }
}
function deliver(to: number[], ev: DmEvent): void {
  const me = tabMemberId();
  if (me == null) return;
  // 房间频道（负数 id）：所有登录的标签页都收到，聊天室界面按 conversationId 过滤
  if (to.length === 1 && to[0]! < 0) {
    const from = (ev as DmEvent & { from?: number }).from;
    if (ev.t === 'msg') ev = { ...ev, message: { ...ev.message, mine: from === me } };
  } else if (!to.includes(me)) return;
  for (const fn of dmListeners) fn(ev);
}
backend.onDmEvent((to, ev) => {
  dmBus?.postMessage({ to, ev });
  deliver(to, ev);
});
if (dmBus) dmBus.onmessage = (m: MessageEvent<{ to: number[]; ev: DmEvent }>) => {
  backend.invalidate();
  deliver(m.data.to, m.data.ev);
};
if (typeof window !== 'undefined') window.addEventListener('storage', (ev) => ev.key === DB_KEY && backend.invalidate());
export function onDemoDm(fn: (ev: DmEvent) => void): () => void {
  dmListeners.add(fn);
  return () => dmListeners.delete(fn);
}

const audioUrls = new Map<string, string>();
/** 演示站上传的 /api/audio/… → blob: 地址（找不到返回 null）。 */
export async function demoAudioUrl(path: string): Promise<string | null> {
  const hit = audioUrls.get(path);
  if (hit) return hit;
  const blob = await backend.audioBlob(path);
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  audioUrls.set(path, u);
  return u;
}

const RASTER = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'];
const KEEP_AS_IS_BYTES = 350_000;
const MAX_EDGE = 1600;

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('读取图片失败'));
    r.readAsDataURL(blob);
  });
}

/** 大图在浏览器里缩小并重新编码，避免撑爆 localStorage（约 5 MB）。 */
/** stripMeta：一律在画布上重新编码（私信图片用：小图也要去掉 EXIF / GPS） */
export async function fileToDataUrl(file: File, stripMeta = false): Promise<string> {
  if (!RASTER.includes(file.type)) throw Object.assign(new Error('只支持 PNG / JPEG / WebP / GIF / AVIF 图片'), { status: 415 });
  if (!stripMeta && file.size <= KEEP_AS_IS_BYTES) return readAsDataUrl(file);
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  let url = canvas.toDataURL('image/webp', 0.82);
  if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', 0.82);
  return url;
}

export async function demoHandle(path: string, init: RequestInit = {}): Promise<MockResponse> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((v, k) => (headers[k] = v));
  let body: unknown;
  if (typeof init.body === 'string') {
    try {
      body = JSON.parse(init.body);
    } catch {
      return { status: 400, body: { error: { code: 'bad_json', message: '请求体不是有效的 JSON' } } };
    }
  } else if (init.body instanceof FormData) {
    const file = init.body.get('file');
    if (!(file instanceof File)) return { status: 400, body: { error: { code: 'no_file', message: '缺少 file 字段' } } };
    if (path === '/api/admin/audio') {
      body = { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type, name: file.name };
      return backend.handle(method, path, body, headers);
    }
    if (path.startsWith('/api/social/dm/')) {
      // L30 私信图片 / 语音：图片在本机缩小重编码（同时去掉 EXIF / GPS），语音原样存成 data URL
      const fd = init.body;
      const kind = String(fd.get('kind') ?? '');
      try {
        const dataUrl = kind === 'image' ? await fileToDataUrl(file, true) : await readAsDataUrl(file);
        const type = kind === 'image' ? (/^data:([^;,]+)/.exec(dataUrl)?.[1] ?? file.type) : (file.type || 'audio/webm');
        body = { kind, type, size: kind === 'image' ? Math.round((dataUrl.length * 3) / 4) : file.size, alt: fd.get('alt') ?? '', durationMs: Number(fd.get('durationMs') ?? 0), width: Number(fd.get('width') ?? 0), height: Number(fd.get('height') ?? 0), dataUrl };
      } catch (e) {
        return { status: 400, body: { error: { code: 'bad_file', message: (e as Error).message || '无法读取文件' } } };
      }
      return backend.handle(method, path, body, headers);
    }
    if (path.startsWith('/api/members/')) {
      // 好朋友上传 / 语音：小文件存成 data URL，大文件只记录元数据
      const dataUrl = file.size <= 300_000 ? await readAsDataUrl(file).catch(() => undefined) : undefined;
      body = { name: file.name, size: file.size, type: file.type, note: init.body.get('note') ?? '', durationMs: Number(init.body.get('durationMs') ?? 0), dataUrl };
      return backend.handle(method, path, body, headers);
    }
    try {
      body = { dataUrl: await fileToDataUrl(file), alt: init.body.get('alt') ?? '' };
    } catch (e) {
      return { status: (e as { status?: number }).status ?? 400, body: { error: { code: 'bad_image', message: (e as Error).message || '无法读取图片' } } };
    }
  }
  return backend.handle(method, path, body, headers);
}

/** 顶部提示条：说明数据只在本地，并提供重置按钮。 */
export function mountDemoBanner(opts: { adminHref?: string; siteHref?: string } = {}): void {
  if (document.querySelector('.demo-banner')) return;
  const bar = document.createElement('div');
  bar.className = 'demo-banner';
  bar.setAttribute('role', 'note');
  const text = document.createElement('span');
  text.className = 'demo-banner__text';
  text.textContent = '演示模式 · 数据仅保存在本地浏览器';
  bar.append(text);
  const actions = document.createElement('span');
  actions.className = 'demo-banner__actions';
  const link = (href: string, label: string) => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    actions.append(a);
  };
  if (opts.adminHref) link(opts.adminHref, '进入后台');
  if (opts.siteHref) link(opts.siteHref, '查看站点');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'demo-banner__reset';
  btn.textContent = '重置演示数据';
  btn.addEventListener('click', () => {
    if (!confirm('清除你在本浏览器里做的所有改动，恢复初始演示数据？')) return;
    backend.reset();
    location.reload();
  });
  actions.append(btn);
  bar.append(actions);
  // L32：放在「跳到正文」之后，键盘第一个 Tab 仍然是跳过导航
  const skip = document.querySelector('.skip-link');
  if (skip) skip.after(bar);
  else document.body.prepend(bar);
}
