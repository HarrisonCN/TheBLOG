/**
 * L32 / v1.32.0 使用指南 /guide/（纯函数，浏览器和预渲染共用；不需要 JS）。
 * 目录 + 七个主题：阅读、订阅、加入、发布、AI 助手、隐私与数据、无障碍与快捷键。
 * 只描述站点已有的功能，链接都指向站内真实页面。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, pageHead, shell, tile, url, type Page, type Route } from './render';
import type { SiteData } from './types';

interface Topic {
  id: string;
  title: string;
  icon: string;
  items: string[];
}

const a = (href: string, text: string) => `<a href="${url(href)}">${e(text)}</a>`;

/** 函数而不是常量：render.ts ↔ guide-view.ts 循环引用，模块加载时 url() 还没定义 */
export const guideTopics = (): Topic[] => [
  {
    id: 'read',
    title: '阅读',
    icon: 'book',
    items: [
      `从首页或 ${a('/archives/', '归档')} 找文章；${a('/sections/', '全部栏目')} 一页看全站。`,
      '文章页右上角可以调字号、行距和宽度，设置只存在你的浏览器里。',
      `读到一半离开，回来时会提示「继续阅读」；想以后再看可以加入 ${a('/reading-list/', '稍后读')}。`,
      `按 <kbd>⌘</kbd> <kbd>K</kbd>（Windows 上 <kbd>Ctrl</kbd> <kbd>K</kbd>）打开命令面板，搜索文章、作品和页面。`,
    ],
  },
  {
    id: 'subscribe',
    title: '订阅',
    icon: 'rss',
    items: [
      `${a('/subscribe/', '订阅页')} 有 RSS / Atom / JSON Feed 地址，任何阅读器都能用，不需要账号。`,
      '登录后可以只订阅某个标签、系列或作者，新内容会出现在通知里。',
    ],
  },
  {
    id: 'join',
    title: '加入社区',
    icon: 'user',
    items: [
      `在 ${a('/join/', '加入')} 填昵称和邮箱，收到 6 位验证码就完成了，没有密码要记。`,
      `登录后可以在 ${a('/me/security/', '账号安全')} 添加通行密钥（Passkey）、查看和退出其它设备。`,
      `社区规则：友善、不发广告和他人隐私；看到不合适的内容可以举报，也可以屏蔽或隐藏某个人。`,
    ],
  },
  {
    id: 'publish',
    title: '发布作品',
    icon: 'send',
    items: [
      `会员可以在 ${a('/compose/', '发布')} 分享照片和短文；图片必须写替代文字，上传前会去掉 EXIF 里的位置信息。`,
      '发布前可以预览；之后能修改和删除，修改会保留历史版本。',
      `也可以加入或创建 ${a('/groups/', '小组')}，把自己的公开作品分享到小组动态。`,
    ],
  },
  {
    id: 'ai',
    title: 'AI 助手',
    icon: 'sparkles',
    items: [
      'AI 助手默认关闭，由站长决定是否开启，并设每月额度。',
      '开启后，它只在你点按钮时给建议（标题、摘要、替代文字、标签、校对），不会自动改动或发布任何内容；每条建议都要你点「采用」。',
      '含 AI 建议的内容发布前需要你确认一次。',
    ],
  },
  {
    id: 'privacy',
    title: '隐私与数据',
    icon: 'lock',
    items: [
      `本站收集什么、不收集什么写在 ${a('/privacy/', '隐私说明')}；没有第三方广告和跟踪脚本。`,
      `在 ${a('/account/', '账号')} 里可以导出自己的全部数据（JSON），也可以申请删除账号。`,
      '摄影工具（曝光、景深、黄金时刻、EXIF 查看器）都在本机计算，照片不会上传。',
    ],
  },
  {
    id: 'a11y',
    title: '无障碍与快捷键',
    icon: 'eye',
    items: [
      '每页开头有「跳到正文」链接：用 <kbd>Tab</kbd> 键就能看到。主要功能都能只用键盘完成。',
      '系统设置了「减少动态效果」时，页面动画会关闭；深色模式跟随系统，也可以在命令面板里切换。',
      '主要页面在 320 px 宽（相当于桌面浏览器放大到 400%）以上都不会出现横向滚动。',
      `快捷键：<kbd>⌘</kbd> <kbd>K</kbd> 命令面板 · <kbd>Esc</kbd> 关闭弹窗。`,
      '发现无障碍问题，欢迎在留言板或信箱告诉我。',
    ],
  },
];

export function guideBody(): string {
  const toc = `<nav class="guide-toc" aria-label="指南目录"><ol>${guideTopics().map((t) => `<li><a href="#guide-${t.id}">${e(t.title)}</a></li>`).join('')}</ol></nav>`;
  const sections = guideTopics().map(
    (t) =>
      `<section class="guide-sec" aria-labelledby="guide-${t.id}"><h2 id="guide-${t.id}" class="guide-h">${icon(t.icon)}<span>${e(t.title)}</span></h2><ul class="guide-list">${t.items.map((x) => `<li>${x}</li>`).join('')}</ul></section>`,
  ).join('');
  return `${toc}${sections}`;
}

export function guidePage(site: SiteData, route: Extract<Route, { name: 'guide' }>): Page {
  return shell(site, route, {
    title: '使用指南',
    description: '怎么阅读、订阅、加入、发布，AI 助手、隐私与数据、无障碍与快捷键',
    top: pageHead('使用指南', '第一次来？这里是本站的使用说明。'),
    main: bento(tile('full', guideBody(), { cls: 'ia-tile guide-tile' })),
    kind: 'page--ia page--guide',
  });
}
