/**
 * 音乐小播放器（懒加载）：封面、标题 / 艺人、播放暂停（Motionary <usa-icon-morph> play↔pause）、上一首 / 下一首、进度、音量、
 * 队列、本站歌单、搜索（完整曲目：Openverse + Internet Archive；试听：iTunes 30 秒）。
 * - 整页只有一个 <audio>，preload="none"；只有用户点了播放才出声。
 * - 访客队列存在 localStorage（读回时逐条清洗），面板开关状态也存，默认收起。
 * - 与朗读互斥（media-bus），支持 Media Session（锁屏 / 耳机按键）。
 * - 键盘：Tab 顺序自然；Esc 收起并把焦点还给把手；焦点在面板（非输入框 / 按钮）上时空格切换播放；标签页支持方向键。
 */
import './music.css';
import { api, API_BASE, DEMO } from './api';
import { icon } from './icons';
import { defineUsed } from './usa';
import { claimMedia, onMediaClaim } from './media-bus';
import {
  dequeue, enqueue, formatTime, OPEN_KEY, parseQueue, playlistToTrack, QUEUE_KEY, serializeQueue, stepIndex, UPLOADED_AUDIO, validatePlaylist, type QueueState, type Track,
} from './music-core';
import { searchFull, searchPreview, type SearchOutcome } from './music-search';
import type { MusicPlayerHandle } from './music-tab';

type Tab = 'queue' | 'site' | 'search';
type Mode = 'full' | 'preview';
type Morph = HTMLElement & { show?: (i: number | string) => void };

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'off';
const SOURCE_LABEL: Record<Track['source'], string> = { site: '本站', openverse: 'Openverse', archive: 'Internet Archive', itunes: 'Apple Music' };

function store(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 隐私模式：不保存 */
  }
}
function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function badgesHtml(t: Track): string {
  const src = t.source === 'openverse' || t.source === 'archive' ? `<span class="mp-badge mp-badge--${t.source}" title="${esc(SOURCE_LABEL[t.source])}">${esc(t.source === 'openverse' ? t.provider || 'Openverse' : 'Archive')}</span>` : `<span class="mp-badge mp-badge--${t.source}">${esc(SOURCE_LABEL[t.source])}</span>`;
  const kind = t.preview ? '<span class="mp-badge mp-badge--preview">30秒试听</span>' : t.source !== 'site' ? '<span class="mp-badge mp-badge--full">完整</span>' : '';
  return src + kind;
}

/** 署名行：CC 要求的「标题 · 作者 · 许可证 · 出处」；iTunes 显示试听说明和 Apple Music 链接。 */
export function creditHtml(t: Track | null): string {
  if (!t) return '还没有在播放的歌曲。';
  const a = (href: string, text: string) => (href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(text));
  if (t.source === 'itunes') return `30秒试听 · 由 Apple Music 提供 · ${a(t.link, '在 Apple Music 中收听完整版')}`;
  const parts = [`“${esc(t.title)}”${t.artist ? ` by ${esc(t.artist)}` : ''}`];
  if (t.license) parts.push(a(t.licenseUrl, t.license));
  if (t.link) parts.push(a(t.link, `来源：${t.provider || SOURCE_LABEL[t.source]}`));
  else if (t.provider) parts.push(esc(t.provider));
  return parts.join(' · ');
}

function coverHtml(t: Track | null, cls: string): string {
  return t?.cover ? `<span class="${cls}"><img src="${esc(t.cover)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>` : `<span class="${cls} is-empty">${icon('music')}</span>`;
}

function itemHtml(t: Track, i: number, ctx: 'queue' | 'site' | 'search', current: boolean, inQueue: boolean): string {
  const dur = t.duration ? `<span class="mp-item__dur">${formatTime(t.duration)}</span>` : '';
  const main = `<button type="button" class="mp-item__main" data-act="play" data-ctx="${ctx}" data-i="${i}" aria-label="播放 ${esc(t.title)}${t.artist ? ` - ${esc(t.artist)}` : ''}${t.preview ? '（30秒试听）' : ''}"${current ? ' aria-current="true"' : ''}>${coverHtml(t, 'mp-item__cover')}<span class="mp-item__text"><span class="mp-item__title">${esc(t.title)}</span><span class="mp-item__sub">${esc(t.artist || '未知艺人')}${t.license && !t.preview ? ` · ${esc(t.license)}` : ''}</span><span class="mp-item__badges">${badgesHtml(t)}</span></span>${dur}</button>`;
  const side =
    ctx === 'queue'
      ? `<button type="button" class="mp-ibtn" data-act="remove" data-i="${i}" aria-label="从队列移除 ${esc(t.title)}">${icon('close')}</button>`
      : `<button type="button" class="mp-ibtn" data-act="add" data-ctx="${ctx}" data-i="${i}" aria-label="${inQueue ? '已在队列' : '加入队列'}：${esc(t.title)}"${inQueue ? ' disabled' : ''}>${icon(inQueue ? 'check' : 'plus')}</button>`;
  return `<li class="mp-item${current ? ' is-current' : ''}">${main}${side}</li>`;
}

export function playerHtml(): string {
  return `<section class="mp" id="mplayer" role="region" aria-label="音乐播放器" tabindex="-1" hidden inert>
  <div class="mp__now">
    <span class="js-mp-cover">${coverHtml(null, 'mp__cover')}</span>
    <div class="mp__meta"><p class="mp__title js-mp-title">未在播放</p><p class="mp__artist js-mp-artist">搜索或从歌单里挑一首</p><p class="mp__badges js-mp-badges"></p></div>
    <button type="button" class="mp-ibtn mp__close js-mp-close" aria-label="收起音乐播放器">${icon('chevronDown')}</button>
  </div>
  <div class="mp__seek"><span class="mp__t js-mp-cur">0:00</span><input class="mp-range js-mp-seek" type="range" min="0" max="1000" step="1" value="0" aria-label="播放进度" aria-valuetext="0:00 / 0:00" disabled><span class="mp__t js-mp-dur">0:00</span></div>
  <div class="mp__ctrl">
    <button type="button" class="mp-ibtn js-mp-prev" aria-label="上一首" disabled>${icon('skipBack')}</button>
    <button type="button" class="mp__play js-mp-play" aria-label="播放" disabled><usa-icon-morph class="mp-morph js-mp-morph" icons="play,pause" size="22" preset="stiff" aria-hidden="true">${icon('playTri')}</usa-icon-morph></button>
    <button type="button" class="mp-ibtn js-mp-next" aria-label="下一首" disabled>${icon('skipForward')}</button>
    <span class="mp__vol"><button type="button" class="mp-ibtn js-mp-mute" aria-label="静音" aria-pressed="false">${icon('volume')}</button><input class="mp-range mp-range--vol js-mp-vol" type="range" min="0" max="100" step="1" value="80" aria-label="音量" aria-valuetext="80%"></span>
  </div>
  <p class="mp__credit js-mp-credit">还没有在播放的歌曲。</p>
  <div class="mp__tabs" role="tablist" aria-label="播放器内容">
    <button type="button" role="tab" id="mp-tab-queue" aria-controls="mp-pane-queue" aria-selected="false" tabindex="-1" data-tab="queue">队列 <span class="js-mp-qn">0</span></button>
    <button type="button" role="tab" id="mp-tab-site" aria-controls="mp-pane-site" aria-selected="false" tabindex="-1" data-tab="site">本站歌单</button>
    <button type="button" role="tab" id="mp-tab-search" aria-controls="mp-pane-search" aria-selected="false" tabindex="-1" data-tab="search">${icon('search')}搜索</button>
  </div>
  <div class="mp__pane" role="tabpanel" id="mp-pane-queue" aria-labelledby="mp-tab-queue" hidden><ol class="mp-list js-mp-queue"></ol></div>
  <div class="mp__pane" role="tabpanel" id="mp-pane-site" aria-labelledby="mp-tab-site" hidden><div class="mp__row"><button type="button" class="mp-chip js-mp-site-all">${icon('playTri')}全部加入并播放</button></div><ol class="mp-list js-mp-site"></ol></div>
  <div class="mp__pane" role="tabpanel" id="mp-pane-search" aria-labelledby="mp-tab-search" hidden>
    <form class="mp__search js-mp-form" role="search"><input class="js-mp-q" type="search" name="q" maxlength="80" placeholder="歌曲、艺人、风格…" aria-label="搜索音乐" autocomplete="off" enterkeyhint="search"><button type="submit" class="mp-chip mp-chip--solid">搜索</button></form>
    <div class="mp-seg" role="radiogroup" aria-label="搜索来源">
      <label><input type="radio" name="mp-mode" value="full" checked><span>完整曲目</span></label>
      <label><input type="radio" name="mp-mode" value="preview"><span>试听 (30秒)</span></label>
    </div>
    <p class="mp__hint js-mp-hint"></p>
    <div class="mp-results js-mp-results" aria-busy="false"><ol class="mp-list js-mp-res"></ol></div>
  </div>
  <p class="visually-hidden js-mp-status" role="status" aria-live="polite"></p>
</section>`;
}

const HINT: Record<Mode, string> = {
  full: '完整曲目来自 <a href="https://openverse.org" target="_blank" rel="noopener noreferrer">Openverse</a> 与 <a href="https://archive.org/details/netlabels" target="_blank" rel="noopener noreferrer">Internet Archive</a>，均为 CC 或公有领域授权，播放时显示署名与许可证。',
  preview: '试听来自 Apple Music 公开搜索，只有 30 秒，附完整版链接。',
};

export function createPlayer(tab: HTMLButtonElement): MusicPlayerHandle {
  document.body.insertAdjacentHTML('beforeend', playerHtml());
  const el = document.getElementById('mplayer') as HTMLElement;
  const $ = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const audio = new Audio();
  audio.preload = 'none';
  audio.setAttribute('data-blog-music', '');

  let q: QueueState = parseQueue(load(QUEUE_KEY));
  let site: Track[] = [];
  let siteLoaded = false;
  let results: Track[] = [];
  let mode: Mode = 'full';
  let tabNow: Tab = 'queue';
  let open = false;
  let loadedId = '';
  let searchCtl: AbortController | null = null;
  let lastQuery = '';
  let hideTimer = 0;
  let seeking = false;

  const ui = {
    play: $<HTMLButtonElement>('.js-mp-play'),
    morph: $<Morph>('.js-mp-morph'),
    prev: $<HTMLButtonElement>('.js-mp-prev'),
    next: $<HTMLButtonElement>('.js-mp-next'),
    seek: $<HTMLInputElement>('.js-mp-seek'),
    cur: $('.js-mp-cur'),
    dur: $('.js-mp-dur'),
    vol: $<HTMLInputElement>('.js-mp-vol'),
    mute: $<HTMLButtonElement>('.js-mp-mute'),
    status: $('.js-mp-status'),
    q: $<HTMLInputElement>('.js-mp-q'),
    results: $('.js-mp-results'),
  };
  const say = (msg: string) => {
    ui.status.textContent = '';
    requestAnimationFrame(() => (ui.status.textContent = msg));
  };
  const current = (): Track | null => q.tracks[q.index] ?? null;
  const save = () => store(QUEUE_KEY, serializeQueue(q));
  const isPlaying = () => !audio.paused && !audio.ended;

  // ---------------------------------------------------------------- 渲染
  function paintNow(): void {
    const t = current();
    $('.js-mp-cover').innerHTML = coverHtml(t, 'mp__cover');
    $('.js-mp-title').textContent = t?.title ?? '未在播放';
    $('.js-mp-artist').textContent = t ? t.artist || '未知艺人' : '搜索或从歌单里挑一首';
    $('.js-mp-badges').innerHTML = t ? badgesHtml(t) : '';
    $('.js-mp-credit').innerHTML = creditHtml(t);
    const has = !!t;
    ui.play.disabled = !has;
    ui.prev.disabled = ui.next.disabled = q.tracks.length < 2;
    ui.seek.disabled = !has;
    $('.js-mp-qn').textContent = String(q.tracks.length);
  }
  function paintPlayState(): void {
    const playing = isPlaying();
    ui.play.setAttribute('aria-label', playing ? '暂停' : '播放');
    ui.play.classList.toggle('is-playing', playing);
    const apply = () => ui.morph.show?.(playing ? 'pause' : 'play');
    if (customElements.get('usa-icon-morph')) apply();
    else void customElements.whenDefined('usa-icon-morph').then(apply);
    tab.classList.toggle('is-playing', playing);
    el.classList.toggle('is-playing', playing);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : current() ? 'paused' : 'none';
  }
  function paintTime(): void {
    const d = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : current()?.duration ?? 0;
    const c = audio.currentTime || 0;
    ui.cur.textContent = formatTime(c);
    ui.dur.textContent = formatTime(d);
    if (!seeking) ui.seek.value = String(d ? Math.round((c / d) * 1000) : 0);
    ui.seek.setAttribute('aria-valuetext', `${formatTime(c)} / ${formatTime(d)}`);
    ui.seek.style.setProperty('--p', `${d ? (c / d) * 100 : 0}%`);
  }
  function paintVolume(): void {
    const v = Math.round(q.volume * 100);
    ui.vol.value = String(v);
    ui.vol.setAttribute('aria-valuetext', q.muted ? `已静音（${v}%）` : `${v}%`);
    ui.vol.style.setProperty('--p', `${q.muted ? 0 : v}%`);
    ui.mute.setAttribute('aria-pressed', String(q.muted));
    ui.mute.setAttribute('aria-label', q.muted ? '取消静音' : '静音');
    ui.mute.innerHTML = icon(q.muted || v === 0 ? 'volumeMute' : 'volume');
    audio.volume = q.volume;
    audio.muted = q.muted;
  }
  const inQueue = (t: Track) => q.tracks.some((x) => x.id === t.id);
  function paintQueue(): void {
    const list = $('.js-mp-queue');
    list.innerHTML = q.tracks.length ? q.tracks.map((t, i) => itemHtml(t, i, 'queue', i === q.index, true)).join('') : `<li class="mp-empty">队列是空的。去「本站歌单」或「搜索」里加几首吧。</li>`;
    $('.js-mp-qn').textContent = String(q.tracks.length);
  }
  function paintSite(): void {
    const list = $('.js-mp-site');
    $<HTMLButtonElement>('.js-mp-site-all').disabled = !site.length;
    list.innerHTML = !siteLoaded ? '<li class="mp-empty"><usa-spinner kind="ring" size="22" label="正在加载歌单"></usa-spinner></li>' : site.length ? site.map((t, i) => itemHtml(t, i, 'site', t.id === current()?.id, inQueue(t))).join('') : '<li class="mp-empty">站长还没有添加歌单。</li>';
    void defineUsed(list);
  }
  function paintResults(state: 'idle' | 'busy' | 'done', out?: SearchOutcome): void {
    const list = $('.js-mp-res');
    ui.results.setAttribute('aria-busy', String(state === 'busy'));
    if (state === 'busy') {
      list.innerHTML = '<li class="mp-empty mp-busy"><usa-spinner kind="ring" size="26" label="正在搜索"></usa-spinner><span>正在搜索…</span></li>';
      void defineUsed(list);
      return;
    }
    if (state === 'idle') {
      list.innerHTML = '<li class="mp-empty">输入关键词，回车搜索。</li>';
      return;
    }
    const fail = out?.failed.length ? `<li class="mp-empty mp-warn">${esc(out.failed.join('、'))} 暂时连不上，结果可能不全。</li>` : '';
    list.innerHTML = results.length ? fail + results.map((t, i) => itemHtml(t, i, 'search', t.id === current()?.id, inQueue(t))).join('') : fail || `<li class="mp-empty">没有找到「${esc(lastQuery)}」相关的${mode === 'full' ? '免费完整曲目，试试英文关键词或切到「试听」' : '试听'}。</li>`;
  }
  function paintLists(): void {
    paintQueue();
    if (siteLoaded) paintSite();
    if (results.length) paintResults('done');
  }

  // ---------------------------------------------------------------- 播放
  async function resolveSrc(src: string): Promise<string> {
    if (!UPLOADED_AUDIO.test(src)) return src;
    if (DEMO) {
      const { demoAudioUrl } = await import('./demo/client');
      return (await demoAudioUrl(src)) ?? '';
    }
    return API_BASE + src;
  }
  function mediaSession(t: Track | null): void {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata = t ? new MediaMetadata({ title: t.title, artist: t.artist, album: t.album || SOURCE_LABEL[t.source], artwork: t.cover ? [{ src: t.cover, sizes: '300x300' }] : [] }) : null;
  }
  async function loadCurrent(): Promise<boolean> {
    const t = current();
    if (!t) {
      audio.removeAttribute('src');
      loadedId = '';
      return false;
    }
    if (loadedId === t.id && audio.src) return true;
    const src = await resolveSrc(t.src);
    if (!src) {
      say('找不到这首歌的音频文件');
      return false;
    }
    audio.src = src;
    loadedId = t.id;
    mediaSession(t);
    paintTime();
    return true;
  }
  async function play(): Promise<void> {
    if (!(await loadCurrent())) return;
    claimMedia('music');
    try {
      await audio.play();
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') say('这首歌暂时无法播放');
    }
  }
  function pause(): void {
    audio.pause();
  }
  async function select(i: number, autoplay: boolean): Promise<void> {
    if (i < 0 || i >= q.tracks.length) return;
    const changed = i !== q.index || loadedId !== q.tracks[i]!.id;
    q = { ...q, index: i };
    save();
    if (changed) {
      audio.pause();
      loadedId = '';
      audio.removeAttribute('src');
      ui.seek.value = '0';
    }
    paintNow();
    paintLists();
    paintTime();
    if (autoplay) await play();
    else if (changed) void loadCurrent();
  }
  /** 上一首 / 下一首：正在播放就接着播，暂停状态下只切换不出声。 */
  const step = (dir: 1 | -1) => void select(stepIndex(q.tracks.length, q.index, dir), isPlaying());
  function add(t: Track, playNow: boolean): void {
    const r = enqueue(q, t);
    q = r.queue;
    save();
    paintNow();
    paintLists();
    if (playNow) void select(r.index, true);
    else say(`已加入队列：${t.title}`);
  }
  function removeAt(i: number): void {
    const wasCurrent = i === q.index;
    q = dequeue(q, i);
    save();
    if (wasCurrent) {
      audio.pause();
      loadedId = '';
      audio.removeAttribute('src');
      mediaSession(current());
    }
    paintNow();
    paintLists();
    paintPlayState();
    paintTime();
    say('已从队列移除');
  }

  audio.addEventListener('play', paintPlayState);
  audio.addEventListener('pause', paintPlayState);
  audio.addEventListener('timeupdate', paintTime);
  audio.addEventListener('durationchange', paintTime);
  audio.addEventListener('loadedmetadata', () => {
    paintTime();
    if ('mediaSession' in navigator && Number.isFinite(audio.duration)) {
      try {
        navigator.mediaSession.setPositionState?.({ duration: audio.duration, position: audio.currentTime, playbackRate: audio.playbackRate });
      } catch {
        /* 某些浏览器不支持 */
      }
    }
  });
  audio.addEventListener('ended', () => {
    paintPlayState();
    if (q.index < q.tracks.length - 1) void select(q.index + 1, true);
  });
  audio.addEventListener('error', () => {
    if (!audio.getAttribute('src')) return;
    say('这首歌暂时无法播放，可能是来源不可用');
    el.classList.add('has-error');
    setTimeout(() => el.classList.remove('has-error'), 2400);
    paintPlayState();
  });
  onMediaClaim('music', () => {
    if (isPlaying()) {
      pause();
      say('朗读开始，音乐已暂停');
    }
  });
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    const on = (a: MediaSessionAction, h: MediaSessionActionHandler) => {
      try {
        ms.setActionHandler(a, h);
      } catch {
        /* 不支持的动作 */
      }
    };
    on('play', () => void play());
    on('pause', pause);
    on('previoustrack', () => step(-1));
    on('nexttrack', () => step(1));
    on('seekto', (d) => {
      if (typeof d.seekTime === 'number') audio.currentTime = d.seekTime;
    });
  }

  // ---------------------------------------------------------------- 控件
  ui.play.addEventListener('click', () => (isPlaying() ? pause() : void play()));
  ui.prev.addEventListener('click', () => step(-1));
  ui.next.addEventListener('click', () => step(1));
  ui.seek.addEventListener('input', () => {
    seeking = true;
    const d = Number.isFinite(audio.duration) ? audio.duration : current()?.duration ?? 0;
    const target = (Number(ui.seek.value) / 1000) * d;
    ui.cur.textContent = formatTime(target);
    ui.seek.style.setProperty('--p', `${Number(ui.seek.value) / 10}%`);
  });
  ui.seek.addEventListener('change', async () => {
    seeking = false;
    if (!(await loadCurrent())) return;
    const d = Number.isFinite(audio.duration) ? audio.duration : current()?.duration ?? 0;
    if (d) audio.currentTime = (Number(ui.seek.value) / 1000) * d;
    paintTime();
  });
  ui.vol.addEventListener('input', () => {
    q = { ...q, volume: Number(ui.vol.value) / 100, muted: false };
    paintVolume();
    save();
  });
  ui.mute.addEventListener('click', () => {
    q = { ...q, muted: !q.muted };
    paintVolume();
    save();
  });
  $('.js-mp-close').addEventListener('click', () => close(true));
  $('.js-mp-site-all').addEventListener('click', () => {
    if (!site.length) return;
    let firstIndex = -1;
    for (const t of site) {
      const r = enqueue(q, t);
      q = r.queue;
      if (firstIndex < 0) firstIndex = r.index;
    }
    save();
    paintNow();
    paintLists();
    void select(firstIndex, true);
  });
  el.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (!b) return;
    const i = Number(b.dataset.i);
    const ctx = b.dataset.ctx;
    const list = ctx === 'site' ? site : ctx === 'search' ? results : q.tracks;
    const t = list[i];
    if (!t) return;
    if (b.dataset.act === 'remove') return removeAt(i);
    if (b.dataset.act === 'add') return add(t, false);
    if (ctx === 'queue') return void (i === q.index && isPlaying() ? pause() : select(i, true));
    add(t, true);
  });
  // 封面加载失败：换成音符占位
  el.addEventListener(
    'error',
    (ev) => {
      const img = ev.target as HTMLElement;
      if (img.tagName !== 'IMG') return;
      const box = img.parentElement!;
      box.classList.add('is-empty');
      box.innerHTML = icon('music');
    },
    true,
  );

  // 标签页（方向键切换）
  const tabs = [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  function showTab(t: Tab, focus = false): void {
    tabNow = t;
    for (const b of tabs) {
      const on = b.dataset.tab === t;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      el.querySelector<HTMLElement>(`#${b.getAttribute('aria-controls')}`)!.hidden = !on;
      if (on && focus) b.focus();
    }
    if (t === 'site') void ensureSite();
    if (t === 'search' && !results.length && ui.results.getAttribute('aria-busy') !== 'true' && !lastQuery) paintResults('idle');
  }
  tabs.forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab as Tab)));
  $('.mp__tabs').addEventListener('keydown', (ev) => {
    const k = (ev as KeyboardEvent).key;
    const i = tabs.findIndex((b) => b.dataset.tab === tabNow);
    const n = k === 'ArrowRight' ? i + 1 : k === 'ArrowLeft' ? i - 1 : k === 'Home' ? 0 : k === 'End' ? tabs.length - 1 : null;
    if (n === null) return;
    ev.preventDefault();
    showTab(tabs[(n + tabs.length) % tabs.length]!.dataset.tab as Tab, true);
  });

  async function ensureSite(): Promise<void> {
    if (siteLoaded) return paintSite();
    paintSite();
    try {
      const { items } = await api.content('playlist');
      site = validatePlaylist(items).items.map(playlistToTrack);
      // 某一条坏了也不至于整张歌单消失：逐条校验
      if (!site.length && Array.isArray(items)) site = items.flatMap((x) => validatePlaylist([x]).items).map(playlistToTrack);
    } catch {
      site = [];
    }
    siteLoaded = true;
    paintSite();
  }

  // 搜索
  const setHint = () => ($('.js-mp-hint').innerHTML = HINT[mode]);
  el.querySelectorAll<HTMLInputElement>('input[name="mp-mode"]').forEach((r) =>
    r.addEventListener('change', () => {
      mode = r.value as Mode;
      setHint();
      if (lastQuery) void runSearch(lastQuery);
    }),
  );
  $('.js-mp-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    void runSearch(ui.q.value);
  });
  async function runSearch(raw: string): Promise<void> {
    const query = raw.trim();
    if (!query) return paintResults('idle');
    lastQuery = query;
    searchCtl?.abort();
    const ctl = (searchCtl = new AbortController());
    paintResults('busy');
    const out = await (mode === 'full' ? searchFull : searchPreview)(query, undefined, ctl.signal);
    if (ctl !== searchCtl) return;
    results = out.tracks;
    paintResults('done', out);
    say(results.length ? `找到 ${results.length} 首` : '没有找到结果');
  }

  // ---------------------------------------------------------------- 键盘
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      close(true);
      return;
    }
    if (ev.key === ' ' || ev.code === 'Space') {
      const t = ev.target as HTMLElement;
      if (t.closest('input[type="search"], input[type="text"], textarea, select, button, a, [role="tab"], input[type="radio"]')) return;
      if (!current()) return;
      ev.preventDefault();
      if (isPlaying()) pause();
      else void play();
    }
  });

  // ---------------------------------------------------------------- 打开 / 收起
  function syncTab(): void {
    tab.setAttribute('aria-expanded', String(open));
    tab.setAttribute('aria-label', open ? '收起音乐播放器' : '打开音乐播放器');
    tab.classList.toggle('is-open', open);
  }
  function openPanel(focus = true): void {
    if (open) return;
    open = true;
    clearTimeout(hideTimer);
    el.hidden = false;
    el.inert = false;
    void defineUsed(el);
    if (reduced()) el.classList.add('is-open');
    else requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-open')));
    syncTab();
    store(OPEN_KEY, '1');
    if (focus) (current() ? ui.play : tabs.find((b) => b.getAttribute('aria-selected') === 'true') ?? tabs[0]!).focus({ preventScroll: true });
  }
  function close(returnFocus = false): void {
    if (!open) return;
    open = false;
    el.classList.remove('is-open');
    el.inert = true;
    syncTab();
    store(OPEN_KEY, '0');
    const hide = () => (el.hidden = true);
    if (reduced()) hide();
    else hideTimer = window.setTimeout(hide, 280);
    if (returnFocus) tab.focus({ preventScroll: true });
  }

  // 初始状态：队列有歌 → 队列页；否则本站歌单（空的话再到搜索）
  setHint();
  paintVolume();
  paintNow();
  paintQueue();
  paintTime();
  paintPlayState();
  showTab(q.tracks.length ? 'queue' : 'site');
  if (!q.tracks.length)
    void ensureSite().then(() => {
      if (!site.length && tabNow === 'site') showTab('search');
    });
  if (current()) mediaSession(current());

  return {
    open: openPanel,
    close,
    toggle: () => (open ? close(true) : openPanel(true)),
    isOpen: () => open,
    addAndPlay: (t: Track) => {
      if (!open) openPanel(false);
      add(t, true);
    },
  };
}
