import { describe, expect, it } from 'vitest';
import { aboutPage, homePage, notFoundPage, parseRoute, postPage, tagPage } from '../src/render';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type Post, type SiteData } from '../src/types';

const post: Post = {
  id: 1, slug: 'hello', title: '你好 <world>', summary: '摘要', contentMd: '# 正文\n\n<script>x</script>', tags: ['随笔'],
  coverUrl: null, status: 'published', publishedAt: '2026-10-09T02:00:00.000Z', createdAt: '2026-10-09T02:00:00.000Z', updatedAt: '2026-10-09T02:00:00.000Z',
};
const site: SiteData = { settings: { ...DEFAULT_SETTINGS, featuredSlugs: ['hello'] }, profile: { ...DEFAULT_PROFILE, bioMd: '简介' }, posts: [post], total: 1, tags: [{ tag: '随笔', count: 1 }] };

describe('路由', () => {
  it.each([
    ['/', 'home'], ['/index.html', 'home'], ['/about/', 'about'], ['/tags', 'tags'], ['/posts/hello/', 'post'], ['/tags/%E9%9A%8F%E7%AC%94/', 'tag'], ['/posts/Bad Slug', 'notfound'], ['/tags/%E0%A4%A', 'notfound'], ['/x', 'notfound'],
  ])('%s → %s', (path, name) => expect(parseRoute(path).name).toBe(name));
  it('解码标签', () => expect(parseRoute('/tags/%E9%9A%8F%E7%AC%94/')).toEqual({ name: 'tag', tag: '随笔' }));
});

describe('视图', () => {
  it('首页：按设置显示区块，转义标题', () => {
    const html = homePage(site).main;
    expect(html).toContain('精选');
    expect(html).toContain('最新文章');
    expect(html).toContain('你好 &lt;world&gt;');
    expect(html).toContain('href="/posts/hello/"');
    expect(html).toContain('href="/tags/%E9%9A%8F%E7%AC%94/"');
    const off = homePage({ ...site, settings: { ...site.settings, sections: { hero: false, featured: false, postList: true, tags: false, about: false } } }).main;
    expect(off).not.toContain('精选');
    expect(off).not.toContain('class="hero"');
    expect(off).not.toContain('h-tags');
  });

  it('文章页：标题、日期（中文）、正文渲染且脚本被转义、进度条', () => {
    const p = postPage(post, DEFAULT_SETTINGS);
    expect(p.title).toBe('你好 <world> · Winston 的博客');
    expect(p.main).toContain('2026年10月9日');
    expect(p.main).toContain('<h1>正文</h1>');
    expect(p.main).not.toContain('<script>');
    expect(p.main).toContain('progress__bar');
  });

  it('关于、标签、404', () => {
    expect(aboutPage(site.profile, DEFAULT_SETTINGS).main).toContain('<p>简介</p>');
    expect(tagPage('随笔', [post], DEFAULT_SETTINGS).main).toContain('1 篇文章');
    expect(notFoundPage(DEFAULT_SETTINGS).main).toContain('404');
  });

  it('不安全的头像 / 链接 URL 被丢弃', () => {
    const html = aboutPage({ ...DEFAULT_PROFILE, avatarUrl: 'javascript:x', links: [{ label: 'x', url: 'javascript:alert(1)' }, { label: 'gh', url: 'https://github.com/HarrisonCN' }] }, DEFAULT_SETTINGS).main;
    expect(html).not.toContain('javascript:');
    expect(html).toContain('https://github.com/HarrisonCN');
  });
});
