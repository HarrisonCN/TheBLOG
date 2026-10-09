// 在首屏渲染前设置主题，避免闪烁（独立文件以兼容严格 CSP）。
(function () {
  try {
    var s = localStorage.getItem('blog-theme');
    var d = document.documentElement;
    var site = d.getAttribute('data-site-theme') || 'system';
    var mode = s || (site === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : site);
    d.setAttribute('data-theme', mode);
  } catch (e) {}
})();
