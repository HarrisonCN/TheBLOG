import { describe, expect, it } from 'vitest';
import {
  aboutPage, appHtml, archivesPage, festivalTile, galleryPage, categoryPage, chapterize, guestbookPage, heroCarousel, homePage, hotPosts, joinPage, notFoundPage, parseRoute, postPage, privacyPage, profileCard, renderRoute, routePath, tagPage,
} from '../src/render';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type Post, type SiteData } from '../src/types';

const post: Post = {
  id: 1, slug: 'hello', title: '你好 <world>', summary: '摘要', contentMd: '# 正文\n\n<script>x</script>\n\n## 第一节\n\n内容\n\n### 小节\n\n## 第二节\n\n更多', tags: ['随笔'],
  coverUrl: null, category: '生活', pinned: true, wordCount: 1200, status: 'published',
  publishedAt: '2026-10-08T14:00:00Z', createdAt: '2026-10-08T14:00:00Z', updatedAt: '2026-10-09T02:00:00Z',
};
const other: Post = { ...post, id: 2, slug: 'second', title: '第二篇', pinned: false, tags: ['随笔', '摄影'], publishedAt: '2026-09-01T00:00:00Z', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' };
const site: SiteData = {
  settings: { ...DEFAULT_SETTINGS, featuredSlugs: ['hello'], postsPerPage: 1, announcement: '**公告**' },
  profile: { ...DEFAULT_PROFILE, bioMd: '简介', links: [{ label: 'GitHub', url: 'https://github.com/HarrisonCN', icon: 'github' }] },
  posts: [post, other], total: 2, tags: [{ tag: '随笔', count: 2 }, { tag: '摄影', count: 1 }], categories: [{ category: '生活', count: 2 }],
};

describe('路由', () => {
  it.each([
    ['/', 'home'], ['/index.html', 'home'], ['/page/2/', 'home'], ['/about/', 'about'], ['/tags', 'tags'], ['/archives/', 'archives'], ['/categories/', 'categories'],
    ['/categories/%E7%94%9F%E6%B4%BB/', 'category'], ['/gallery/', 'gallery'], ['/gallery/city-nights/', 'album'], ['/favorites/', 'favorites'], ['/guestbook/', 'guestbook'],
    ['/links/', 'links'], ['/privacy/', 'privacy'], ['/join/', 'join'], ['/mailbox/', 'mailbox'],
    ['/posts/hello/', 'post'], ['/tags/%E9%9A%8F%E7%AC%94/', 'tag'], ['/posts/Bad Slug', 'notfound'], ['/tags/%E0%A4%A', 'notfound'], ['/x', 'notfound'], ['/page/0/', 'notfound'],
  ])('%s → %s', (path, name) => expect(parseRoute(path).name).toBe(name));
  it('解码标签 / 分页 / 路径往返', () => {
    expect(parseRoute('/tags/%E9%9A%8F%E7%AC%94/')).toEqual({ name: 'tag', tag: '随笔' });
    expect(parseRoute('/page/3/')).toEqual({ name: 'home', page: 3 });
    for (const p of ['/', '/page/2/', '/posts/hello/', '/tags/%E9%9A%8F%E7%AC%94/', '/categories/%E7%94%9F%E6%B4%BB/', '/gallery/a-b/', '/archives/']) expect(routePath(parseRoute(p))).toBe(p);
  });
});

describe('视图', () => {
  it('首页：双栏 —— 首图轮播、精选文章、最新文章、侧栏（个人卡片 / 订阅 / 热门文章 / 热门标签 / 便签 / 公告）', () => {
    const covered = { ...site, posts: site.posts.map((p) => ({ ...p, coverUrl: `https://img.example/${p.slug}-1280.webp` })), settings: { ...site.settings, featuredSlugs: ['second'] } };
    const p = homePage(covered, 1, { notes: [{ id: 1, name: '小林', content: '你好 <b>', color: 'pink', hidden: false } as never] });
    expect(p.top).toBe('');
    expect(p.main).toContain('class="home" id="content"');
    // 轮播：置顶在前、排除精选；圆点、计数、上一张 / 下一张、暂停
    expect(p.main).toContain('class="carousel js-carousel" aria-roledescription="carousel"');
    expect(p.main).toContain('class="slide is-active" id="slide-0"');
    expect(p.main).toContain('阅读全文');
    expect(p.main).not.toContain('slide-1');
    // 精选 3 张卡片：分类彩色标签 + 收藏按钮
    expect(p.main).toContain('精选文章');
    expect(p.main).toContain('class="fcard reveal"');
    expect(p.main).toContain('cchip cchip--green fcard__chip');
    expect(p.main).toContain('js-bookmark');
    // 最新文章：一行一篇 + 分页
    expect(p.main).toContain('最新文章');
    expect(p.main).toContain('class="lrow post-card reveal"');
    expect(p.main).toContain('<usa-pagination total="2" page="1"');
    expect(p.main).toContain('你好 &lt;world&gt;');
    expect(p.main).toContain('置顶');
    // 侧栏
    expect(p.main).toContain('class="tile tile--full reveal profile-card"');
    expect(p.main).toContain('站长认证');
    expect(p.main).toContain('badge--pearl');
    expect(p.main).toContain('badge--metal');
    expect(p.main).toContain('订阅我的更新');
    expect(p.main).toContain('class="sub-form js-sub-form" action="/join/" method="get"');
    expect(p.main).toContain('热门文章');
    expect(p.main).toContain('class="hot__n hot__n--1"');
    expect(p.main).toContain('热门标签');
    expect(p.main).toContain('class="pill pill--on"');
    expect(p.main).toContain('访客便签');
    expect(p.main).toContain('note note--pink');
    expect(p.main).toContain('你好 &lt;b&gt;');
    expect(p.main).toContain('<strong>公告</strong>');
    expect(p.main).not.toContain('<usa-festival-banner');
    const p2 = homePage(site, 2);
    expect(p2.main).toContain('post-card');
    expect(p2.main).toContain('第二篇');
    expect(p2.main).toContain('<usa-pagination total="2" page="2"');
    expect(p2.main).not.toContain('carousel');
    const off = homePage({ ...site, settings: { ...site.settings, sections: { ...site.settings.sections, hero: false, announcement: false, about: false } } });
    expect(off.main).not.toContain('js-carousel');
    expect(off.main).not.toContain('widget--announce');
    expect(off.main).not.toContain('profile-card');
  });

  it('个人卡片：社交 ID 可查看、数字来自资料（「文章」自动统计）', () => {
    const s2 = { ...site, profile: { ...site.profile, role: '摄影 / 写作', stats: [{ label: '关注者', value: '1.2k' }], links: [{ label: '微信', url: '/about/', icon: 'wechat' as const, handle: 'wx-<id>' }, { label: 'RSS', url: '/rss.xml', icon: 'rss' as const }] } };
    const html = profileCard(s2, 'full');
    expect(html).toContain('摄影 / 写作');
    expect(html).toContain('<b>2</b><span>文章</span>');
    expect(html).toContain('<b>1.2k</b><span>关注者</span>');
    expect(html).toContain('class="soc js-soc"');
    expect(html).toContain('data-handle="wx-&lt;id&gt;"');
    expect(html).toContain('aria-haspopup="dialog"');
    // 没有社交 ID 的链接就是普通链接
    expect(html).toMatch(/<a class="soc" href="\/rss.xml"/);
    // 没有填数字时显示标签 / 分类数
    expect(profileCard(site, 'full')).toContain('<span>标签</span>');
  });

  it('热门文章按精选顺序、置顶、新旧排序', () => {
    expect(hotPosts({ ...site, settings: { ...site.settings, featuredSlugs: ['second'] } }).map((p) => p.slug)).toEqual(['second', 'hello']);
    expect(hotPosts(site).map((p) => p.slug)).toEqual(['hello', 'second']);
  });

  it('轮播：只有一篇时没有圆点和箭头；多篇时 aria / 计数正确', () => {
    const one = heroCarousel([post]);
    expect(one).not.toContain('js-car-next');
    const many = heroCarousel([post, other, { ...other, slug: 'c', title: 'C' }]);
    expect(many).toContain('<b class="js-car-i">01</b> / 03');
    expect(many).toContain('aria-label="第 2 / 3 张" aria-hidden="true" inert');
    expect(many.match(/js-car-dot/g)?.length).toBe(3);
    expect(many).toContain('aria-label="暂停自动播放"');
  });

  it('节日瓷砖只在节日期间出现', () => {
    const fest = [{ id: 'x', name: '测试节', date: '10-08', days: 2, theme: 'fireworks', message: '快乐' }] as never;
    expect(festivalTile(fest, new Date(2026, 9, 8, 12))).toContain('<usa-festival-banner');
    expect(festivalTile(fest, new Date(2026, 9, 9, 12))).toContain('测试节');
    expect(festivalTile(fest, new Date(2026, 9, 11, 12))).toBe('');
  });

  it('整页：导航下拉、搜索与深色按钮、路由过渡容器、页脚', () => {
    const html = appHtml(site, homePage(site));
    for (const s of ['首页', '文章', '专题', '摄影', '技术', '关于', '归档', '标签', '画廊', '收藏', '留言与便签', '友链', '成为好朋友', '作品集', '开源项目', 'RSS 订阅', 'js-search', '⌘K', 'js-theme', 'js-me', '<usa-route-transition', 'class="footer"', 'footer__quote', '隐私说明', 'class="sky"']) expect(html).toContain(s);
    expect(html).toContain('<div class="menu" aria-current="page"><a class="menu__link" href="/">首页</a>');
    expect(html).not.toContain('usa-blobs');
    expect(html).not.toContain('usa-nav-morph');
  });

  it('文章页：封面头、字数 / 阅读时长、目录、章节、版权、上一篇 / 下一篇、脚本被转义', () => {
    const p = postPage(site, post);
    expect(p.title).toBe('你好 <world> | Winston 的博客');
    expect(p.top).toContain('2026-10-08');
    expect(p.top).toContain('字数总计');
    expect(p.top).toContain('阅读时长：4 分钟');
    expect(p.main).toContain('<h1 id="h-正文">正文</h1>');
    expect(p.main).not.toContain('<script>');
    expect(p.main).toContain('<section class="chapter" data-chapter="第一节">');
    expect(p.main).toContain('CC BY-NC-SA 4.0');
    expect(p.main).toContain('下一篇');
    expect(p.main).toContain('<usa-scroll-progress');
    expect(p.main).toContain('<usa-chapter-nav');
    expect(p.main).toContain('href="#h-小节"');
    expect(p.main).toContain('<usa-like');
  });

  it('章节切分', () => {
    const r = chapterize('<p>前言</p><h2 id="a">A</h2><p>1</p><h3 id="b">B</h3><h2 id="c">C</h2>');
    expect(r.chapters).toBe(2);
    expect(r.html.startsWith('<p>前言</p><section class="chapter" data-chapter="A">')).toBe(true);
    expect(r.toc).toContain('toc__item--3');
  });

  it('归档、标签、分类、留言、隐私、404', () => {
    expect(archivesPage(site).top).toContain('<usa-date-picker');
    expect(archivesPage(site).main).toContain('id="y2026"');
    expect(galleryPage(site, [{ slug: 'a', title: 'A', description: '', date: '2026', cover: '', photos: [{ url: 'https://x/y.webp', caption: 'c' }] }] as never).main).toContain('<usa-swipe-deck');
    expect(tagPage(site, '摄影').top).toContain('1 篇文章');
    expect(categoryPage(site, '生活').main).toContain('第二篇');
    expect(guestbookPage(site, [{ id: 1, name: '<b>x</b>', content: 'hi', website: 'javascript:alert(1)', status: 'approved', createdAt: '2026-10-01T00:00:00Z' }]).main).not.toContain('javascript:');
    expect(privacyPage(site).main).toContain('收藏');
    expect(privacyPage(site).main).toContain('AI 生成示例图');
    expect(guestbookPage(site, [], [{ id: 1, name: 'a', content: 'b', color: 'blue', hidden: false } as never]).main).toContain('id="wall"');
    const join = joinPage(site).main;
    expect(join).toContain('js-join-hint');
    expect(join).toContain('js-logout');
    expect(join).toContain('js-join-badges');
    expect(notFoundPage(site).main).toContain('404');
    expect(renderRoute({ name: 'home', page: 9 }, site).main).toContain('404');
    expect(renderRoute({ name: 'post', slug: 'nope' }, site).main).toContain('404');
  });

  it('不安全的头像 / 链接 URL 被丢弃', () => {
    const s2 = { ...site, profile: { ...DEFAULT_PROFILE, avatarUrl: 'javascript:x', homeUrl: 'javascript:y', links: [{ label: 'x', url: 'javascript:alert(1)' }, { label: 'gh', url: 'https://github.com/HarrisonCN' }] } };
    const html = aboutPage(s2).main + aboutPage(s2).aside;
    expect(html).not.toContain('javascript:');
    expect(html).toContain('https://github.com/HarrisonCN');
  });
});

describe('festival banner icons', () => {
  it('replaces emoji with an inline SVG icon', async () => {
    const { festivalText } = await import('../src/render');
    const { stripEmoji } = await import('../src/icons');
    expect(stripEmoji('国庆快乐 🇨🇳')).toBe('国庆快乐');
    expect(stripEmoji('圣诞快乐 🎄 ☀️')).toBe('圣诞快乐');
    const html = festivalText({ id: 'national', name: '国庆节', date: '10-01', days: 7, theme: 'fireworks', message: '国庆快乐 🇨🇳' });
    expect(html).toContain('<svg');
    expect(html).toContain('fest-ico');
    expect(html).not.toMatch(/\p{Extended_Pictographic}|\p{Regional_Indicator}/u);
  });
});
