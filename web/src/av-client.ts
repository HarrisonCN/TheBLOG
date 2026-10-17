/**
 * L34 / v1.34.0 视频与声音作品的播放器增强（按需加载；页面本身不需要 JS 也完整可读）：
 * - 从页面里的文字稿生成 WebVTT 字幕轨道（Blob 地址），视频默认显示中文字幕；
 * - 地址里的 ?t=（90 / 1:30 / 1m30s）跳到对应时间，不自动播放；
 * - 点击章节 / 时间码：跳转并同步地址栏 ?t=（replaceState，不触发重新渲染）；
 * - 播放时高亮当前字幕和章节（aria-current），文字稿搜索（忽略大小写与空白）。
 */
import { activeCue, chapterAt, parseStart, searchCues, toVtt, type Chapter, type Cue } from './media-core';

export function bindAv(root: ParentNode): void {
  const box = root.querySelector<HTMLElement>('[data-av]');
  if (!box || box.dataset.bound) return;
  box.dataset.bound = '1';
  const media = box.querySelector<HTMLMediaElement>('video, audio');
  if (!media) return;
  const duration = Number(box.dataset.duration) || 0;
  const cueEls = [...box.querySelectorAll<HTMLElement>('[data-av-cue]')];
  const cues: Cue[] = cueEls.map((el) => ({ start: Number(el.dataset.start), end: Number(el.dataset.end), text: el.querySelector('.av-cue__text')?.textContent ?? '' }));
  const chEls = [...box.querySelectorAll<HTMLElement>('[data-av-chapter]')];
  const chapters: Chapter[] = chEls.map((el) => ({ t: Number(el.querySelector<HTMLElement>('[data-seek]')?.dataset.seek ?? 0), title: '' }));

  // 字幕轨道
  if (media instanceof HTMLVideoElement && cues.length && typeof URL.createObjectURL === 'function') {
    const track = document.createElement('track');
    track.kind = 'captions';
    track.srclang = 'zh';
    track.label = '中文字幕';
    track.default = true;
    track.src = URL.createObjectURL(new Blob([toVtt(cues)], { type: 'text/vtt' }));
    media.appendChild(track);
  }

  const seek = (t: number, updateUrl: boolean) => {
    const go = () => {
      media.currentTime = t;
    };
    if (media.readyState >= 1) go();
    else media.addEventListener('loadedmetadata', go, { once: true });
    highlight(t);
    if (updateUrl) {
      const u = new URL(location.href);
      u.searchParams.set('t', String(t));
      history.replaceState(history.state, '', u.toString());
    }
  };

  let lastCue = -2;
  let lastCh = -2;
  const highlight = (t: number) => {
    const ci = activeCue(cues, t);
    if (ci !== lastCue) {
      cueEls[lastCue]?.removeAttribute('aria-current');
      if (ci >= 0) cueEls[ci]!.setAttribute('aria-current', 'true');
      lastCue = ci;
    }
    const hi = chapterAt(chapters, t);
    if (hi !== lastCh) {
      chEls[lastCh]?.querySelector('a')?.removeAttribute('aria-current');
      if (hi >= 0) chEls[hi]!.querySelector('a')?.setAttribute('aria-current', 'true');
      lastCh = hi;
    }
  };
  media.addEventListener('timeupdate', () => highlight(media.currentTime));

  box.addEventListener('click', (ev) => {
    const a = (ev.target as Element | null)?.closest<HTMLAnchorElement>('a[data-seek]');
    if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    seek(Number(a.dataset.seek) || 0, true);
    media.focus({ preventScroll: false });
  });

  const t0 = parseStart(new URLSearchParams(location.search).get('t'), duration);
  if (t0 !== null) seek(t0, false);
  else highlight(0);

  // 文字稿搜索
  const label = box.querySelector<HTMLElement>('.av-search');
  const input = box.querySelector<HTMLInputElement>('[data-av-search]');
  const status = box.querySelector<HTMLElement>('[data-av-status]');
  if (label && input && status && cues.length) {
    label.hidden = false;
    input.addEventListener('input', () => {
      const q = input.value;
      const hits = new Set(searchCues(cues, q));
      cueEls.forEach((el, i) => el.classList.toggle('av-cue--hit', hits.has(i)));
      status.textContent = q.trim() ? (hits.size ? `找到 ${hits.size} 处` : '没有找到') : '';
      if (hits.size) cueEls[Math.min(...hits)]!.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  }
}
