/**
 * 演示模式的浏览器端适配：把 api.ts 的 request() 转给本地的 DemoBackend。
 * 只在 VITE_DEMO=1 的构建里被（动态）引入，正式构建不会打包这部分代码。
 */
import { DemoBackend, memoryKV, type KV, type MockResponse } from './mock-api';
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

export const backend = new DemoBackend({ storage: browserStorage(), base: import.meta.env.BASE_URL });

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
export async function fileToDataUrl(file: File): Promise<string> {
  if (!RASTER.includes(file.type)) throw Object.assign(new Error('只支持 PNG / JPEG / WebP / GIF / AVIF 图片'), { status: 415 });
  if (file.size <= KEEP_AS_IS_BYTES) return readAsDataUrl(file);
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
  document.body.prepend(bar);
}
