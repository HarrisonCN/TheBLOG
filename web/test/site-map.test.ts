/**
 * L23 / v1.23.0「栏目整理」：栏目注册表（web/src/site-map.ts）是导航、手机菜单、⌘K、首页「逛逛别的栏目」、sitemap 与 /me/ 的唯一来源。
 * - 每个路由恰好属于一个栏目，没有孤儿路由；
 * - 每个条目的链接都能解析到它声明的路由；旧网址全部照旧解析；
 * - 新栏目有自己的落地页（图标 + 一句话说明）；
 * - 只给登录用户 / 站长看的条目默认隐藏。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { drawer, navbar, parseRoute, renderRoute, ROUTE_NAMES, setBasePath, type Route } from '../src/render';
import { ACTIONS, entryVisible, findEntry, paletteEntries, sectionIndex, sectionOf, sitemapRoutes, SITE_SECTIONS, type Audience } from '../src/site-map';
import { exploreTile, meHub } from '../src/site-map-view';
import { homeSections } from '../src/sections-view';
import { createSeed } from '../src/demo/seed';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type PostSummary, type SiteData } from '../src/types';

const seed = createSeed('/');
const posts: PostSummary[] = seed.posts.filter((p) => p.status === 'published').map(({ contentMd: _c, ...rest }, i) => ({ ...rest, id: i + 1 }));
const site: SiteData = { settings: DEFAULT_SETTINGS, profile: DEFAULT_PROFILE, posts, total: posts.length, tags: [{ tag: '摄影', count: 4 }], categories: [{ category: '摄影', count: 4 }] };
const GUEST: Audience = { member: false, admin: false };
const MEMBER: Audience = { member: true, admin: false };
const ADMIN: Audience = { member: true, admin: true };
const allEntries = () => SITE_SECTIONS.flatMap((s) => s.entries.map((en) => ({ s, en })));

beforeEach(() => setBasePath('/'));

describe('栏目注册表：每个路由恰好一个栏目', () => {
  it('ROUTE_NAMES 覆盖全部路由（含 1.23 新增落地页）', () => {
    for (const n of ['community', 'tools', 'account', 'sections', 'essays', 'series']) expect(ROUTE_NAMES).toContain(n);
    expect(new Set(ROUTE_NAMES).size).toBe(ROUTE_NAMES.length);
  });

  it('除 404 外每个路由恰好属于一个栏目（没有孤儿，也没有重复）', () => {
    const owners = new Map<string, string[]>();
    for (const { s, en } of allEntries()) for (const r of en.routes) owners.set(r, [...(owners.get(r) ?? []), `${s.id}/${en.id}`]);
    const orphans = ROUTE_NAMES.filter((n) => n !== 'notfound' && !owners.has(n));
    expect(orphans, `孤儿路由：${orphans.join(', ')}`).toEqual([]);
    const dup = [...owners].filter(([, o]) => o.length !== 1).map(([r, o]) => `${r} → ${o.join(' + ')}`);
    expect(dup, `重复归属：${dup.join('; ')}`).toEqual([]);
    const unknown = [...owners.keys()].filter((r) => !(ROUTE_NAMES as readonly string[]).includes(r));
    expect(unknown, `注册表里有不存在的路由：${unknown.join(', ')}`).toEqual([]);
    expect(owners.has('notfound')).toBe(false);
  });

  it('sectionOf / sectionIndex 与注册表一致', () => {
    for (const n of ROUTE_NAMES) {
      if (n === 'notfound') {
        expect(sectionOf(n)).toBeUndefined();
        expect(sectionIndex(n)).toBe(-1);
        continue;
      }
      const s = sectionOf(n)!;
      expect(s, n).toBeTruthy();
      expect(SITE_SECTIONS[sectionIndex(n)]).toBe(s);
    }
  });

  it('栏目 / 条目 id 唯一；每个条目有图标、名称和一句话说明；动作条目只用已知动作', () => {
    const sids = SITE_SECTIONS.map((s) => s.id);
    expect(new Set(sids).size).toBe(sids.length);
    const ids = allEntries().map(({ en }) => en.id);
    expect(new Set(ids).size, '条目 id 重复').toBe(ids.length);
    for (const { s, en } of allEntries()) {
      expect(en.label.trim(), en.id).not.toBe('');
      expect(en.icon, en.id).toMatch(/^[a-zA-Z]+$/);
      expect(en.desc.length, `${en.id} 说明`).toBeGreaterThan(3);
      expect(en.desc.length, `${en.id} 说明太长（一句话）`).toBeLessThanOrEqual(40);
      expect(!!en.href !== !!en.action, `${s.id}/${en.id} 要么是链接要么是动作`).toBe(true);
      if (en.action) expect(ACTIONS, en.id).toContain(en.action);
    }
  });
});

describe('链接与旧网址', () => {
  it('每个条目的链接都解析到它自己声明的路由（站长后台是独立页面）', () => {
    for (const { s, en } of allEntries()) {
      if (!en.href || en.href.startsWith('/admin/')) continue;
      const path = en.href.split(/[?#]/)[0]!;
      const r = parseRoute(path);
      expect(en.routes, `${s.id}/${en.id} ${en.href} → ${r.name}`).toContain(r.name);
    }
  });

  it('每个栏目的入口页解析到本栏目的路由', () => {
    for (const s of SITE_SECTIONS) expect(sectionOf(parseRoute(s.href).name)?.id, s.href).toBe(s.id);
  });

  it('1.22 及更早的网址全部照旧解析（只加新路由，不改旧的）', () => {
    const old: [string, Route['name']][] = [
      ['/', 'home'], ['/page/2/', 'home'], ['/posts/welcome/', 'post'], ['/archives/', 'archives'], ['/tags/', 'tags'], ['/tags/x/', 'tag'], ['/categories/', 'categories'], ['/categories/x/', 'category'],
      ['/gallery/', 'gallery'], ['/gallery/a/', 'album'], ['/favorites/', 'favorites'], ['/guestbook/', 'guestbook'], ['/links/', 'links'], ['/about/', 'about'], ['/privacy/', 'privacy'], ['/join/', 'join'],
      ['/mailbox/', 'mailbox'], ['/now/', 'now'], ['/works/', 'works'], ['/gear/', 'gear'], ['/shelf/', 'shelf'], ['/timeline/', 'timeline'], ['/changelog/', 'changelog'], ['/opensource/', 'opensource'],
      ['/stats/', 'stats'], ['/search/', 'search'], ['/subscribe/', 'subscribe'], ['/map/', 'map'], ['/u/xiaolin/', 'user'], ['/notifications/', 'notifications'], ['/me/', 'me'], ['/feed/', 'feed'],
      ['/compose/', 'compose'], ['/w/1/', 'work'], ['/discover/', 'discover'], ['/t/', 'topics'], ['/t/photo/', 'topic'], ['/events/', 'events'], ['/events/daily-one/', 'event'], ['/c/1/', 'collection'],
      ['/projects/', 'projects'], ['/p/theblog/', 'project'], ['/f/', 'features'], ['/f/x/', 'feature'], ['/me/stats/', 'mystats'], ['/me/security/', 'security'], ['/messages/', 'messages'],
      ['/messages/requests/', 'msgrequests'], ['/messages/settings/', 'msgsettings'], ['/messages/c/1/', 'conversation'], ['/status/', 'status'],
    ];
    for (const [p, n] of old) expect(parseRoute(p).name, p).toBe(n);
  });
});

describe('新栏目落地页', () => {
  const fresh = () => SITE_SECTIONS.filter((s) => s.isNew);
  it('至少有 社区 / 工具 / 账号 三个新栏目，每个都有自己的落地页路由', () => {
    expect(fresh().map((s) => s.label)).toEqual(expect.arrayContaining(['社区', '工具', '账号']));
    for (const s of fresh()) {
      const r = parseRoute(s.href);
      expect(r.name, s.href).not.toBe('notfound');
      expect(findEntry(s.id, r.name)?.routes).toContain(r.name);
    }
  });
  it('落地页列出本栏目每个条目（图标 + 名称 + 一句话说明），登录 / 站长条目带 data-aud 并默认隐藏', () => {
    for (const s of fresh()) {
      const p = renderRoute(parseRoute(s.href), site, {});
      const html = p.top + p.main;
      expect(html).toContain(s.title);
      for (const en of s.entries.filter((x) => x.listed !== false && !x.routes.includes(parseRoute(s.href).name))) {
        expect(html, `${s.id}/${en.id}`).toContain(en.desc);
        expect(html, `${s.id}/${en.id}`).toContain(`data-entry="${en.id}"`);
        if (en.audience && en.audience !== 'all') expect(html).toMatch(new RegExp(`data-entry="${en.id}"[^>]*data-aud="${en.audience}"[^>]*hidden|data-aud="${en.audience}"[^>]*data-entry="${en.id}"[^>]*hidden`));
      }
      expect((html.match(/class="ia-card__ic"/g) ?? []).length).toBeGreaterThan(1);
    }
  });
  it('/sections/ 全部栏目页列出每个栏目和每个公开条目', () => {
    const p = renderRoute({ name: 'sections' }, site, {});
    for (const s of SITE_SECTIONS) expect(p.main, s.id).toContain(s.title);
    for (const { en } of allEntries()) if (en.listed !== false) expect(p.main, en.id).toContain(`data-entry="${en.id}"`);
  });
  it('影集 /essays/ 只列影集；系列 /series/ 按系列分组', () => {
    const essays = renderRoute({ name: 'essays' }, site, {}).main;
    for (const ps of posts.filter((x) => x.kind === 'essay')) expect(essays).toContain(ps.title);
    for (const ps of posts.filter((x) => x.kind !== 'essay')) expect(essays).not.toContain(`>${ps.title}<`);
    const series = renderRoute({ name: 'series' }, site, {}).main;
    for (const name of new Set(posts.map((x) => (x.series ?? '').trim()).filter(Boolean))) expect(series).toContain(name);
  });
});

describe('导航、手机菜单、⌘K、逛逛别的栏目、sitemap、/me/ 都从注册表生成', () => {
  const listed = () => allEntries().filter(({ en }) => en.listed !== false && en.href);
  it('顶部导航按注册表顺序列出全部栏目，下拉里有每个公开条目', () => {
    const html = navbar(site, { name: 'home', page: 1 });
    const labels = [...html.matchAll(/class="menu__link"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(labels).toEqual(SITE_SECTIONS.map((s) => s.label));
    for (const { en } of listed()) expect(html, en.id).toContain(`href="${en.href}"`);
  });
  it('手机菜单列出每个栏目和每个条目（含动作条目）', () => {
    const html = drawer(site);
    for (const s of SITE_SECTIONS) expect(html, s.id).toContain(`href="${s.href}"`);
    for (const { en } of allEntries().filter(({ en }) => en.listed !== false)) expect(html, en.id).toContain(`data-entry="${en.id}"`);
  });
  it('登录 / 站长条目在导航与菜单里默认隐藏（hidden + data-aud）', () => {
    const html = navbar(site, { name: 'home', page: 1 }) + drawer(site);
    for (const { en } of allEntries().filter(({ en }) => en.listed !== false && en.audience && en.audience !== 'all')) {
      const tags = [...html.matchAll(new RegExp(`<a[^>]*data-entry="${en.id}"[^>]*>`, 'g'))].map((m) => m[0]);
      expect(tags.length, en.id).toBeGreaterThan(0);
      for (const t of tags) expect(t, en.id).toMatch(new RegExp(`data-aud="${en.audience}"[^>]*hidden|hidden[^>]*data-aud="${en.audience}"`));
    }
  });
  it('entryVisible：访客看不到登录 / 站长条目；登录后看到登录条目；站长看到全部', () => {
    const member = allEntries().filter(({ en }) => en.audience === 'member');
    const admin = allEntries().filter(({ en }) => en.audience === 'admin');
    expect(member.length).toBeGreaterThan(3);
    expect(admin.length).toBeGreaterThan(0);
    for (const { en } of member) expect([entryVisible(en, GUEST), entryVisible(en, MEMBER)]).toEqual([false, true]);
    for (const { en } of admin) expect([entryVisible(en, MEMBER), entryVisible(en, ADMIN)]).toEqual([false, true]);
    const guestOnly = allEntries().filter(({ en }) => en.audience === 'guest');
    for (const { en } of guestOnly) expect([entryVisible(en, GUEST), entryVisible(en, MEMBER)]).toEqual([true, false]);
  });
  it('⌘K 页面项来自注册表并按身份过滤', () => {
    const g = paletteEntries(GUEST);
    const a = paletteEntries(ADMIN);
    for (const { s, en } of allEntries().filter(({ en }) => en.listed !== false)) {
      const want = entryVisible(en, GUEST);
      expect(g.some((x) => x.id === en.id), en.id).toBe(want);
      if (entryVisible(en, ADMIN)) expect(a.find((x) => x.id === en.id)?.sub, en.id).toContain(s.label);
    }
  });
  it('首页「逛逛别的栏目」列出除首页外的全部栏目和「全部栏目」', () => {
    const html = exploreTile();
    for (const s of SITE_SECTIONS.filter((x) => x.id !== 'home')) expect(html, s.id).toContain(`href="${s.href}"`);
    expect(html).toContain('href="/sections/"');
    expect(homeSections(site, {})).toContain('explore-tile');
  });
  it('sitemap / 预渲染路由来自注册表：含新落地页，不含只属于个人的页面', () => {
    const r = sitemapRoutes();
    for (const n of ['community', 'tools', 'account', 'sections', 'essays', 'series', 'archives', 'discover', 'status']) expect(r.index, n).toContain(n);
    for (const n of ['me', 'notifications', 'compose', 'mystats', 'messages', 'msgrequests', 'msgsettings']) {
      expect(r.index, n).not.toContain(n);
      expect(r.render, n).toContain(n);
    }
    for (const n of ['post', 'tag', 'work', 'conversation', 'notfound', 'home']) expect(r.render, n).not.toContain(n);
  });
  it('/me/ 快捷入口：账号栏目里登录可见的条目 + 发布', () => {
    const html = meHub(MEMBER);
    const acc = SITE_SECTIONS.find((s) => s.id === 'account')!;
    for (const en of acc.entries.filter((x) => x.listed !== false && entryVisible(x, MEMBER) && x.id !== 'me' && x.href)) expect(html, en.id).toContain(`href="${en.href}"`);
    expect(html).toContain('href="/compose/"');
    expect(meHub(ADMIN)).toContain('href="/admin/"');
    expect(html).not.toContain('href="/admin/"');
  });
});
