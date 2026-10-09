// 在首屏渲染前设置主题与页面风格，避免闪烁（独立文件以兼容严格 CSP）。
(function () {
  try {
    var s = localStorage.getItem('blog-theme');
    var d = document.documentElement;
    var site = d.getAttribute('data-site-theme') || 'system';
    var mode = s || (site === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : site);
    d.setAttribute('data-theme', mode);
    var surface = localStorage.getItem('blog-surface');
    if (surface) d.setAttribute('data-usa-surface', surface);
  } catch (e) {}
})();
