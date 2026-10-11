/**
 * 阅读设置（字号 / 行距 / 字体 / 版心宽度 / 护眼主题，存在本机 localStorage）与文章朗读（Web Speech API）。
 * 设置作为 <html data-rs-*> 属性生效，样式见 l12.css；所有切换在 prefers-reduced-motion 时没有过渡动画。
 * 朗读：浏览器不支持 speechSynthesis 时整组按钮保持隐藏；优先选 zh-CN 声音；逐段朗读并高亮当前段落。
 */
import { claimMedia, onMediaClaim } from './media-bus';

export const RS_KEY = 'blog-reading-prefs';
export const RS_OPTIONS = {
  size: ['s', 'm', 'l', 'xl'],
  lh: ['tight', 'normal', 'loose'],
  font: ['sans', 'serif'],
  width: ['narrow', 'normal', 'wide'],
  theme: ['default', 'sepia'],
} as const;
export type RsKey = keyof typeof RS_OPTIONS;
export type ReadingSettings = { [K in RsKey]: (typeof RS_OPTIONS)[K][number] };
export const RS_DEFAULT: ReadingSettings = { size: 'm', lh: 'normal', font: 'sans', width: 'normal', theme: 'default' };

/** 读本机设置：只接受白名单里的值，其余回到默认。 */
export function parseReadingSettings(raw: string | null | undefined): ReadingSettings {
  let o: Record<string, unknown> = {};
  try {
    const v = raw ? JSON.parse(raw) : {};
    if (v && typeof v === 'object' && !Array.isArray(v)) o = v as Record<string, unknown>;
  } catch {
    /* 坏数据 → 默认 */
  }
  const out = { ...RS_DEFAULT } as Record<RsKey, string>;
  for (const k of Object.keys(RS_OPTIONS) as RsKey[]) if (typeof o[k] === 'string' && (RS_OPTIONS[k] as readonly string[]).includes(o[k] as string)) out[k] = o[k] as string;
  return out as ReadingSettings;
}

export function loadReadingSettings(): ReadingSettings {
  try {
    return parseReadingSettings(localStorage.getItem(RS_KEY));
  } catch {
    return { ...RS_DEFAULT };
  }
}

export function applyReadingSettings(s: ReadingSettings, el: HTMLElement = document.documentElement): void {
  for (const k of Object.keys(RS_OPTIONS) as RsKey[]) {
    if (s[k] === RS_DEFAULT[k]) delete el.dataset[`rs${k[0]!.toUpperCase()}${k.slice(1)}`];
    else el.dataset[`rs${k[0]!.toUpperCase()}${k.slice(1)}`] = s[k];
  }
}

export function saveReadingSettings(s: ReadingSettings): void {
  try {
    localStorage.setItem(RS_KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式：只在本页生效 */
  }
  applyReadingSettings(s);
}

export function bindReadingSettings(root: ParentNode): void {
  const btn = root.querySelector<HTMLButtonElement>('.js-rs-toggle');
  const panel = root.querySelector<HTMLElement>('#rs-panel');
  if (!btn || !panel || panel.dataset.bound) return;
  panel.dataset.bound = '1';
  let s = loadReadingSettings();
  const sync = () => panel.querySelectorAll<HTMLInputElement>('input[data-rs]').forEach((r) => (r.checked = s[r.dataset.rs as RsKey] === r.value));
  sync();
  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) panel.querySelector<HTMLInputElement>('input:checked')?.focus();
  };
  btn.addEventListener('click', () => setOpen(panel.hidden));
  panel.addEventListener('change', (ev) => {
    const r = ev.target as HTMLInputElement;
    const k = r.dataset.rs as RsKey | undefined;
    if (!k || !(RS_OPTIONS[k] as readonly string[]).includes(r.value)) return;
    s = { ...s, [k]: r.value } as ReadingSettings;
    saveReadingSettings(s);
  });
  panel.querySelector('.js-rs-reset')?.addEventListener('click', () => {
    s = { ...RS_DEFAULT };
    saveReadingSettings(s);
    sync();
  });
  panel.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      setOpen(false);
      btn.focus();
    }
  });
}

// ---------------------------------------------------------------- 朗读
export function speechSupported(w: { speechSynthesis?: unknown; SpeechSynthesisUtterance?: unknown } = globalThis as never): boolean {
  return !!w.speechSynthesis && typeof w.SpeechSynthesisUtterance === 'function';
}

/** 选声音：zh-CN → 其他 zh → 默认。 */
export function pickVoice(voices: { lang: string; name: string; default?: boolean }[]): { lang: string; name: string } | null {
  return voices.find((v) => /^zh[-_]CN/i.test(v.lang)) ?? voices.find((v) => /^zh/i.test(v.lang)) ?? voices.find((v) => v.default) ?? null;
}

/** 要朗读的段落：正文里的标题、段落、列表项、引用（跳过代码块和脚注区）。 */
export function speakableBlocks(prose: ParentNode): HTMLElement[] {
  return [...prose.querySelectorAll<HTMLElement>('h2, h3, h4, p, li, blockquote')].filter((el) => !el.closest('pre, .footnotes, blockquote p') && !(el.tagName === 'P' && el.closest('li, blockquote')) && (el.textContent ?? '').trim().length > 0);
}

let stopCurrent: (() => void) | null = null;
/** 音乐开始播放时暂停朗读（只暂停，用户可以继续）。 */
let pauseCurrent: (() => void) | null = null;
onMediaClaim('tts', () => pauseCurrent?.());
/** 换页时调用：停掉正在进行的朗读。 */
export function stopSpeech(): void {
  stopCurrent?.();
}

export function bindSpeech(root: ParentNode): void {
  const box = root.querySelector<HTMLElement>('.js-tts');
  const prose = root.querySelector<HTMLElement>('.post .prose');
  if (!box || !prose || box.dataset.bound) return;
  if (!speechSupported()) return; // 不支持：保持隐藏
  box.dataset.bound = '1';
  box.hidden = false;
  const synth = window.speechSynthesis;
  const play = box.querySelector<HTMLButtonElement>('.js-tts-play')!;
  const stop = box.querySelector<HTMLButtonElement>('.js-tts-stop')!;
  const rate = box.querySelector<HTMLSelectElement>('.js-tts-rate')!;
  const label = box.querySelector<HTMLElement>('.js-tts-label')!;
  const status = box.querySelector<HTMLElement>('.js-tts-status')!;
  let blocks: HTMLElement[] = [];
  let idx = 0;
  let state: 'idle' | 'playing' | 'paused' = 'idle';
  let token = 0;
  const mark = (el: HTMLElement | null) => {
    prose.querySelectorAll('.is-speaking').forEach((x) => x.classList.remove('is-speaking'));
    if (el) {
      el.classList.add('is-speaking');
      const r = el.getBoundingClientRect();
      if (r.top < 80 || r.bottom > innerHeight - 40) el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  };
  const setState = (s: typeof state) => {
    state = s;
    play.setAttribute('aria-pressed', String(s === 'playing'));
    play.classList.toggle('is-playing', s === 'playing');
    label.textContent = s === 'playing' ? '暂停' : s === 'paused' ? '继续朗读' : '朗读全文';
    stop.disabled = s === 'idle';
    status.textContent = s === 'idle' ? '' : `${s === 'paused' ? '已暂停 · ' : ''}第 ${Math.min(idx + 1, blocks.length)} / ${blocks.length} 段`;
  };
  const speakFrom = (i: number) => {
    const my = ++token;
    idx = i;
    if (idx >= blocks.length) {
      mark(null);
      setState('idle');
      return;
    }
    const el = blocks[idx]!;
    const u = new SpeechSynthesisUtterance((el.textContent ?? '').replace(/\s+/g, ' ').trim());
    u.lang = 'zh-CN';
    const v = pickVoice(synth.getVoices());
    if (v) u.voice = v as SpeechSynthesisVoice;
    u.rate = Number(rate.value) || 1;
    u.onend = () => {
      if (my === token && state === 'playing') speakFrom(idx + 1);
    };
    u.onerror = () => {
      if (my === token && state === 'playing') speakFrom(idx + 1);
    };
    mark(el);
    setState('playing');
    synth.speak(u);
  };
  const halt = () => {
    token++;
    synth.cancel();
    mark(null);
    setState('idle');
  };
  stopCurrent = halt;
  pauseCurrent = () => {
    if (state !== 'playing') return;
    synth.pause();
    setState('paused');
  };
  play.addEventListener('click', () => {
    if (state === 'idle') {
      claimMedia('tts');
      blocks = speakableBlocks(prose);
      synth.cancel();
      speakFrom(0);
    } else if (state === 'playing') {
      synth.pause();
      setState('paused');
    } else {
      claimMedia('tts');
      setState('playing');
      synth.resume();
    }
  });
  stop.addEventListener('click', halt);
  rate.addEventListener('change', () => {
    // 语速对正在读的句子不生效：从当前段重新开始
    if (state === 'playing') {
      synth.cancel();
      speakFrom(idx);
    }
  });
}
