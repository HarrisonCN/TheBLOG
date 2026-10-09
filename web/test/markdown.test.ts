import { describe, expect, it } from 'vitest';
import { escapeHtml, plainText, renderMarkdown, safeHref } from '../src/markdown';

describe('Markdown 渲染安全性', () => {
  it('普通 Markdown 正常渲染', () => {
    const html = renderMarkdown('# 标题\n\n**粗体** 和 `code`\n\n- a\n- b');
    expect(html).toContain('<h1');
    expect(html).toContain('<strong>粗体</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<li>a</li>');
  });

  it.each([
    ['<script>alert(1)</script>', '<script'],
    ['<img src=x onerror=alert(1)>', '<img src=x'],
    ['行内 <b onclick="x()">hi</b>', '<b onclick'],
    ['<iframe src="https://evil"></iframe>', '<iframe'],
    ['<svg><script>alert(1)</script></svg>', '<svg'],
  ])('原始 HTML 被转义：%s', (input, forbidden) => {
    const html = renderMarkdown(input);
    expect(html).not.toContain(forbidden);
    expect(html).toContain('&lt;');
  });

  it.each(['javascript:alert(1)', 'JAVASCRIPT:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>', 'vbscript:x', '//evil.com/x'])('危险链接被移除：%s', (href) => {
    const html = renderMarkdown(`[点我](${href})`);
    expect(html).not.toMatch(/href=/);
    expect(html).toContain('点我');
  });

  it('外链加 noopener，站内链接不加', () => {
    expect(renderMarkdown('[a](https://x.com)')).toContain('rel="noopener noreferrer nofollow"');
    expect(renderMarkdown('[a](/posts/x/)')).not.toContain('target=');
  });

  it('图片只允许 http(s) 与站内路径，属性被转义', () => {
    expect(renderMarkdown('![a](/api/images/x.png)')).toContain('<img src="/api/images/x.png" alt="a"');
    expect(renderMarkdown('![a](javascript:alert(1))')).not.toContain('<img');
    expect(renderMarkdown('![a"onerror="x](/a.png)')).not.toContain('"onerror="');
  });

  it('safeHref / escapeHtml / plainText', () => {
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeHref('mailto:a@b.c', true)).toBeNull();
    expect(escapeHtml(`<a href="x">'`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;');
    expect(plainText('# 标题\n\n[链接](https://x) **粗**', 100)).toBe('标题 链接 粗');
    expect(plainText('a'.repeat(300), 10)).toHaveLength(10);
  });
});
