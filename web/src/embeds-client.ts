/**
 * 正文嵌入块与影集的交互（只有页面上有这些块时才懒加载本模块）：
 * - 对比滑块：加一个原生 range（键盘左右键、读屏都能用），拖动改 --pos；
 * - 音频块：加「播放」按钮，交给左下角音乐播放器（只在点击后播放，不自动播放）；
 * - 地图标记：内置点阵世界地图上画一个点（坐标在 Markdown 渲染时已经粗化到 0.1°）；
 * - 引用卡片：「生成图片」按钮，点击后才加载 quote-card.ts（canvas，不用外部服务）；
 * - 影集：点照片 / 「故事模式」按钮，点击后才加载 essay-story.ts。
 */
import { icon } from './icons';
import { dotsPath, project } from './photo-map';

type Notify = (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
export interface EmbedCtx {
  notify: Notify;
  reducedMotion: () => boolean;
  siteTitle: string;
  pageUrl: () => string;
}

export const EMBED_SELECTOR = '[data-compare], [data-audio], [data-map], [data-quote], [data-essay]';

/** 对比滑块：0–100 */
export function clampPos(v: number): number {
  return Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 50;
}

export function bindCompare(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('figure[data-compare]').forEach((fig) => {
    if (fig.dataset.bound) return;
    fig.dataset.bound = '1';
    const stage = fig.querySelector<HTMLElement>('.compare__stage');
    if (!stage) return;
    const a = fig.dataset.labelA || '前';
    const b = fig.dataset.labelB || '后';
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.step = '1';
    range.value = '50';
    range.className = 'compare__range';
    range.setAttribute('aria-label', `对比滑块：向左看「${b}」，向右看「${a}」`);
    const handle = document.createElement('span');
    handle.className = 'compare__handle';
    handle.setAttribute('aria-hidden', 'true');
    const set = (v: number) => {
      const p = clampPos(v);
      stage.style.setProperty('--pos', `${p}%`);
      range.setAttribute('aria-valuetext', `「${a}」占 ${p}%，「${b}」占 ${100 - p}%`);
    };
    range.addEventListener('input', () => set(Number(range.value)));
    stage.append(handle, range);
    set(50);
    fig.classList.add('is-ready');
  });
}

export function bindAudio(root: ParentNode, ctx: EmbedCtx): void {
  root.querySelectorAll<HTMLElement>('[data-audio]').forEach((box) => {
    if (box.dataset.bound || !box.dataset.src) return;
    box.dataset.bound = '1';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--soft audio-embed__play';
    btn.innerHTML = `${icon('playTri')}<span>播放</span>`;
    btn.setAttribute('aria-label', `在音乐播放器中播放：${box.dataset.title ?? '音频'}`);
    btn.addEventListener('click', async () => {
      const d = box.dataset;
      try {
        const { playInMusicPlayer } = await import('./music-tab');
        await playInMusicPlayer({
          id: `embed-${hash(d.src!)}`, title: d.title || '音频', artist: d.artist || '', album: '', src: d.src!, cover: '', duration: 0,
          source: 'site', preview: false, license: d.credit || '', licenseUrl: '', link: d.link || '', provider: '正文',
        });
        btn.querySelector('span')!.textContent = '已交给播放器';
      } catch {
        ctx.notify('播放器暂时打不开，可以点「打开音频」直接听', 'warning');
      }
    });
    box.querySelector('.audio-embed__open')?.before(btn);
  });
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

let dots = '';
export function mapPinSvg(lat: number, lng: number, label: string): string {
  dots ||= dotsPath();
  const p = project(lat, lng);
  return `<svg class="map-pin__svg" viewBox="0 0 360 144" role="img" aria-label="${label.replace(/[<>&"]/g, '')}的大致位置（约 11 km 精度）"><path class="map-pin__dots" d="${dots}"/><circle class="map-pin__halo" cx="${p.x}" cy="${p.y}" r="7"/><circle class="map-pin__dot" cx="${p.x}" cy="${p.y}" r="3.2"/></svg>`;
}

export function bindMaps(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('figure[data-map]').forEach((fig) => {
    if (fig.dataset.bound) return;
    fig.dataset.bound = '1';
    const lat = Number(fig.dataset.lat);
    const lng = Number(fig.dataset.lng);
    const stage = fig.querySelector<HTMLElement>('.map-pin__stage');
    if (!stage || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    stage.innerHTML = mapPinSvg(lat, lng, fig.querySelector('.map-pin__cap b')?.textContent ?? '');
    stage.removeAttribute('aria-hidden');
  });
}

export function bindQuotes(root: ParentNode, ctx: EmbedCtx): void {
  root.querySelectorAll<HTMLElement>('figure[data-quote]').forEach((fig) => {
    if (fig.dataset.bound) return;
    fig.dataset.bound = '1';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quote-card__make';
    btn.innerHTML = `${icon('image')}<span>生成引用卡片</span>`;
    btn.addEventListener('click', async () => {
      const text = fig.querySelector('blockquote')?.textContent?.trim() ?? '';
      const source = fig.querySelector('cite')?.textContent?.trim() ?? '';
      const { openQuoteCard } = await import('./quote-card');
      openQuoteCard({ text, source, site: ctx.siteTitle, url: ctx.pageUrl(), opener: btn, notify: ctx.notify });
    });
    fig.append(btn);
  });
}

export function bindEssay(root: ParentNode, ctx: EmbedCtx): void {
  root.querySelectorAll<HTMLElement>('[data-essay]').forEach((sec) => {
    if (sec.dataset.bound) return;
    sec.dataset.bound = '1';
    sec.addEventListener('click', async (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('.js-essay-open, .js-essay-story');
      if (!b) return;
      const { openStory } = await import('./essay-story');
      openStory(sec, Number(b.dataset.i) || 0, { opener: b as HTMLElement, reducedMotion: ctx.reducedMotion() });
    });
  });
}

export function bindEmbeds(root: ParentNode, ctx: EmbedCtx): void {
  bindCompare(root);
  bindAudio(root, ctx);
  bindMaps(root);
  bindQuotes(root, ctx);
  bindEssay(root, ctx);
}
