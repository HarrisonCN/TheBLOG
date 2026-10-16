// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ANIMATED_EFFECTS, DEFAULT_NOTE_STYLE, guardInk, INK_PRESETS, inkContrast, isDefaultStyle, NOTE_EFFECTS, NOTE_FONTS, NOTE_PAPERS, normalizeNoteStyle, validateNoteStyle,
} from '../src/note-style';
import { noteClasses, noteTextHtml } from '../src/note-style-view';
import { icon } from '../src/icons';
import { latestParts, homePage, navbar, noteComposer, setBasePath } from '../src/render';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { veilNavigate, veilActive, rememberOrigin } from '../src/route-veil';
import { pageInPlace } from '../src/list-pager';
import { resultIconHtml, upgradeToastIcon } from '../src/result-icon';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type PostSummary, type SiteData } from '../src/types';

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

describe('便签样式校验器（web 与 worker 同一份）', () => {
  it('两份 note-style.ts 完全相同', () => {
    expect(read('../src/note-style.ts')).toBe(read('../../worker/src/note-style.ts'));
  });
  it('白名单：字体 / 特效 / 预设颜色都合法，且预设墨水在四种纸上 ≥ 4.5:1', () => {
    for (const font of NOTE_FONTS) for (const effect of NOTE_EFFECTS) expect(validateNoteStyle({ font, effect }).ok).toBe(true);
    for (const c of INK_PRESETS) for (const p of NOTE_PAPERS) expect(inkContrast(c.hex, p)).toBeGreaterThanOrEqual(4.5);
  });
  it('严格拒绝：原始 CSS 字符串、多余字段、错误类型、非 #rrggbb', () => {
    expect(validateNoteStyle('color: red').ok).toBe(false);
    expect(validateNoteStyle({ color: '#000000', style: 'x' }).ok).toBe(false);
    expect(validateNoteStyle({ color: 'rgb(0,0,0)' }).ok).toBe(false);
    expect(validateNoteStyle({ color: '#000;background:url(//x)' }).ok).toBe(false);
    expect(validateNoteStyle({ italic: 1 }).ok).toBe(false);
    expect(validateNoteStyle({ size: 'xxl' }).ok).toBe(false);
    expect(validateNoteStyle(Object.create({ font: 'kai' })).ok).toBe(false);
    expect(validateNoteStyle(new Date()).ok).toBe(false);
  });
  it('对比度守卫：浅色被拒绝；guardInk 加深后在指定纸张上 ≥ 4.5:1，深色保持不变', () => {
    expect(validateNoteStyle({ color: '#fde047' }, 'yellow').ok).toBe(false);
    const g = guardInk('#fde047', 'yellow');
    expect(inkContrast(g, 'yellow')).toBeGreaterThanOrEqual(4.5);
    expect(guardInk('#1f2937')).toBe('#1f2937');
    expect(guardInk('not-a-color')).toBe(DEFAULT_NOTE_STYLE.color);
  });
  it('normalize 永不抛错；isDefaultStyle', () => {
    expect(normalizeNoteStyle(undefined)).toEqual(DEFAULT_NOTE_STYLE);
    expect(normalizeNoteStyle('{"effect":"rainbow"}').effect).toBe('rainbow');
    expect(normalizeNoteStyle({ effect: 'marquee' })).toEqual(DEFAULT_NOTE_STYLE);
    expect(isDefaultStyle({ ...DEFAULT_NOTE_STYLE })).toBe(true);
    expect(isDefaultStyle({ ...DEFAULT_NOTE_STYLE, italic: true })).toBe(false);
  });
});

describe('便签样式渲染', () => {
  it('只输出白名单类名 + 校验过的颜色变量，正文转义', () => {
    const html = noteTextHtml('<img src=x onerror=alert(1)>', { color: '#1d4ed8', font: 'kai', size: 'xl', weight: 'bold', italic: true, effect: 'glow' }, 'blue');
    expect(html).toContain('class="ns ns--f-kai ns--s-xl ns--b ns--i ns--fx-glow"');
    expect(html).toContain('--ns-c:#1d4ed8');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
  it('坏样式（例如注入的 CSS）按默认渲染', () => {
    const html = noteTextHtml('hi', { color: 'red;position:fixed' });
    expect(html).toContain(`--ns-c:${DEFAULT_NOTE_STYLE.color}`);
    expect(html).not.toContain('position');
  });
  it('摇摆 / 彩虹逐字拆分（emoji 不被劈开），动画特效带 ns--anim', () => {
    const html = noteTextHtml('好👍', { effect: 'rainbow' });
    expect(html.match(/class="ns__c"/g)?.length).toBe(2);
    for (const fx of ANIMATED_EFFECTS) expect(noteClasses({ ...DEFAULT_NOTE_STYLE, effect: fx })).toContain('ns--anim');
    expect(noteClasses({ ...DEFAULT_NOTE_STYLE, effect: 'shadow' })).not.toContain('ns--anim');
  });
  it('编辑器：字体 / 字号 / 特效单选、预设颜色、自定义颜色、实时预览', () => {
    const c = noteComposer();
    for (const f of NOTE_FONTS) expect(c).toContain(`name="font" value="${f}"`);
    for (const fx of NOTE_EFFECTS) expect(c).toContain(`name="effect" value="${fx}"`);
    expect(c).toContain('type="color" name="customColor"');
    expect(c).toContain('js-note-preview');
  });
});

describe('演示 mock API：POST /api/notes 的 style', () => {
  let api: DemoBackend;
  beforeEach(() => {
    api = new DemoBackend({ storage: memoryKV(), now: () => new Date(Date.parse('2026-10-10T12:00:00Z')) });
  });
  it('合法样式保存并返回；默认 / 缺省为 null', async () => {
    const r = await api.handle('POST', '/api/notes', { name: 'a', content: 'b', color: 'green', style: { font: 'round', effect: 'wobble', color: '#9D174D' } });
    expect(r.status).toBe(201);
    expect((r.body as { style: unknown }).style).toEqual({ ...DEFAULT_NOTE_STYLE, font: 'round', effect: 'wobble', color: '#9d174d' });
    const d = await api.handle('POST', '/api/notes', { name: 'a', content: 'c', color: 'green' });
    expect((d.body as { style: unknown }).style).toBeNull();
  });
  it('非法样式 → 400', async () => {
    for (const style of [{ css: 'x' }, { color: '#ffffff' }, 'font-size: 99px', { effect: 'blink' }]) {
      const r = await api.handle('POST', '/api/notes', { name: 'a', content: 'b', style });
      expect(r.status, JSON.stringify(style)).toBe(400);
    }
  });
});

describe('描边图标', () => {
  it('每条描边都有 pathLength="1"，统一 currentColor + 1.8 描边，data-i 记录名字', () => {
    for (const n of ['github', 'wechat', 'xiaohongshu', 'mail', 'flame', 'search', 'settings']) {
      const s = icon(n);
      expect(s).toContain(`data-i="${n}"`);
      expect(s).toContain('class="icon si"');
      expect(s).toContain('stroke="currentColor"');
      expect(s).toContain('stroke-width="1.8"');
      const shapes = s.match(/<(path|circle|rect|ellipse|line|polyline|polygon)\b[^>]*>/g) ?? [];
      expect(shapes.length).toBeGreaterThan(0);
      for (const sh of shapes) expect(sh).toContain('pathLength="1"');
    }
    expect(icon('nope')).toContain('data-i="link"');
  });
});

const posts: PostSummary[] = Array.from({ length: 14 }, (_, i) => ({
  id: i + 1, slug: `p-${i}`, title: `文章 ${i}`, summary: '', coverUrl: null, category: null, tags: [], pinned: false, status: 'published', wordCount: 100,
  publishedAt: `2026-09-${String(28 - i).padStart(2, '0')}T00:00:00Z`, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
})) as unknown as PostSummary[];
const site = (): SiteData => ({ settings: { ...DEFAULT_SETTINGS, postsPerPage: 6 }, profile: DEFAULT_PROFILE, posts, total: posts.length, tags: [], categories: [] });

describe('栏目内翻页', () => {
  beforeEach(() => setBasePath('/'));
  it('latestParts 只给出这一栏需要替换的部分；越界返回 null', () => {
    const p2 = latestParts(site(), 2)!;
    expect(p2.pages).toBe(3);
    expect(p2.title).toBe('最新文章 · 第 2 页');
    expect(p2.rows).toContain('文章 6');
    expect(p2.rows).not.toContain('文章 5<');
    expect(p2.pager).toContain('aria-current="page">2<');
    expect(latestParts(site(), 0)).toBeNull();
    expect(latestParts(site(), 4)).toBeNull();
  });
  it('pageInPlace：ring 加载器只出现在栏目里，列表替换、高度锁定、焦点到栏目标题', async () => {
    document.body.innerHTML = homePage(site(), 1).main;
    const section = document.querySelector<HTMLElement>('.js-paged')!;
    const carousel = document.querySelector('.carousel');
    let sawRing = false;
    const parts = await pageInPlace({
      section,
      reduced: true,
      parts: async () => {
        sawRing = !!section.querySelector('.list-busy usa-spinner[kind="ring"]') && !document.querySelector('.route-veil');
        return latestParts(site(), 2);
      },
      alive: () => true,
    });
    expect(sawRing).toBe(true);
    expect(parts?.page).toBe(2);
    expect(section.querySelector('.llist')!.textContent).toContain('文章 6');
    expect(section.querySelector('.list-busy')).toBeNull();
    expect(document.querySelector('.carousel')).toBe(carousel);
    expect(section.querySelector('.llist')!.getAttribute('style')).toContain('min-height');
    expect(document.activeElement?.id).toBe('h-latest');
    expect(section.querySelector('.list-live')!.textContent).toContain('第 2 页');
  });
});

describe('转场遮罩', () => {
  beforeEach(() => (document.body.innerHTML = ''));
  it('加载完成：替换界面后遮罩移除', async () => {
    let swapped = '';
    await veilNavigate({ reduced: true, load: async () => 'next', swap: (v) => (swapped = v), onError: () => 'err', alive: () => true });
    expect(swapped).toBe('next');
    expect(veilActive()).toBe(false);
  });
  it('加载超时：交给 onError 渲染错误页，遮罩照样收起（不会卡住）', async () => {
    let swapped = '';
    await veilNavigate({ reduced: true, timeoutMs: 60, load: () => new Promise<string>(() => undefined), swap: (v) => (swapped = v), onError: (e) => `err:${(e as Error).message}`, alive: () => true });
    expect(swapped).toContain('err:');
    expect(veilActive()).toBe(false);
  });
  it('被新的导航接管时不替换界面', async () => {
    let swapped = false;
    await veilNavigate({ reduced: true, load: async () => 1, swap: () => (swapped = true), onError: () => 0, alive: () => false });
    expect(swapped).toBe(false);
  });
  it('遮罩里是 Motionary bars 加载器；rememberOrigin 识别卡片', () => {
    document.body.innerHTML = '<article class="post-card"><a href="/x">x</a></article>';
    rememberOrigin(new MouseEvent('click', { clientX: 10, clientY: 10 }), document.querySelector('a'));
    void veilNavigate({ reduced: true, load: () => new Promise(() => undefined), swap: () => undefined, onError: () => 0, alive: () => false, timeoutMs: 30 });
    expect(document.querySelector('.route-veil usa-spinner[kind="bars"]')).not.toBeNull();
  });
});

describe('结果图标与菜单按钮', () => {
  it('toast 的成功 / 失败 / 警告图标换成 <usa-check>（info 不变）', () => {
    for (const kind of ['success', 'error', 'warning']) {
      const el = document.createElement('div');
      el.innerHTML = '<svg class="usa-toast-icon"></svg><div class="usa-toast-msg">x</div>';
      upgradeToastIcon(el, kind);
      expect(el.querySelector(`usa-check[kind="${kind}"][start="load"]`)).not.toBeNull();
      expect(el.querySelector('.usa-toast-icon')).toBeNull();
    }
    const info = document.createElement('div');
    info.innerHTML = '<svg class="usa-toast-icon"></svg>';
    upgradeToastIcon(info, 'info');
    expect(info.querySelector('usa-check')).toBeNull();
    expect(resultIconHtml('error', 16, '失败')).toContain('label="失败"');
  });
  it('移动端菜单按钮内是 Motionary <usa-icon-morph icons="menu,close">，带 aria-expanded / aria-controls', () => {
    setBasePath('/');
    const html = navbar(site(), { name: 'home', page: 1 });
    expect(html).toMatch(/<button class="nav__btn nav__toggle js-drawer"[^>]*aria-expanded="false"[^>]*aria-controls="drawer"[^>]*><usa-icon-morph class="js-menu-morph menu-morph" icons="menu,close"/);
  });
});
