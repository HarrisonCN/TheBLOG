import { describe, expect, it } from 'vitest';
import {
  aboutPage, appHtml, archivesPage, categoryPage, chapterize, guestbookPage, homePage, notFoundPage, parseRoute, postPage, privacyPage, renderRoute, routePath, tagPage,
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
  it('首页：全屏首图 + 打字机副标题、左右交替卡片、置顶、分页、侧栏', () => {
    const p = homePage(site);
    expect(p.top).toContain('class="hero"');
    expect(p.top).toContain('<usa-typewriter');
    expect(p.main).toContain('你好 &lt;world&gt;');
    expect(p.main).toContain('置顶');
    expect(p.main).toContain('发表于');
    expect(p.main).toContain('更新于');
    expect(p.main).toContain('href="/posts/hello/"');
    expect(p.main).toContain('<usa-pagination total="2" page="1"');
    expect(p.main).toContain('href="/page/2/"');
    expect(p.aside).toContain('公告');
    expect(p.aside).toContain('<strong>公告</strong>');
    expect(p.aside).toContain('谁在看网站');
    expect(p.aside).toContain('网站资讯');
    const p2 = homePage(site, 2);
    expect(p2.main).toContain('post-card');
    expect(p2.main).toContain('第二篇');
    expect(p2.main).not.toContain('class="featured');
    const off = homePage({ ...site, settings: { ...site.settings, sections: { ...site.settings.sections, hero: false, announcement: false, about: false } } });
    expect(off.top).not.toContain('class="hero"');
    expect(off.aside).not.toContain('widget--announce');
    expect(off.aside).not.toContain('profile__avatar');
  });

  it('整页：导航下拉、搜索与深色按钮、路由过渡容器、页脚', () => {
    const html = appHtml(site, homePage(site));
    for (const s of ['归档', '标签', '分类', '画廊', '收藏', '留言板', '友链', '关于', 'js-search', 'js-theme', '<usa-route-transition', '<usa-nav-morph', 'class="footer"', '隐私说明']) expect(html).toContain(s);
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
    expect(p.aside).toContain('<usa-chapter-nav');
    expect(p.aside).toContain('href="#h-小节"');
  });

  it('章节切分', () => {
    const r = chapterize('<p>前言</p><h2 id="a">A</h2><p>1</p><h3 id="b">B</h3><h2 id="c">C</h2>');
    expect(r.chapters).toBe(2);
    expect(r.html.startsWith('<p>前言</p><section class="chapter" data-chapter="A">')).toBe(true);
    expect(r.toc).toContain('toc__item--3');
  });

  it('归档、标签、分类、留言、隐私、404', () => {
    expect(archivesPage(site).main).toContain('<usa-date-picker');
    expect(archivesPage(site).main).toContain('id="y2026"');
    expect(tagPage(site, '摄影').top).toContain('1 篇文章');
    expect(categoryPage(site, '生活').main).toContain('第二篇');
    expect(guestbookPage(site, [{ id: 1, name: '<b>x</b>', content: 'hi', website: 'javascript:alert(1)', status: 'approved', createdAt: '2026-10-01T00:00:00Z' }]).main).not.toContain('javascript:');
    expect(privacyPage(site).main).toContain('getDisplayMedia'.length ? '分享音频' : '');
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
