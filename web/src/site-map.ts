/**
 * L23 / v1.23.0「栏目整理」：栏目注册表 —— 全站信息架构的唯一来源。
 * 顶部导航、手机菜单、⌘K 命令面板、首页「逛逛别的栏目」、全部栏目页 /sections/、新栏目落地页、
 * 预渲染 + sitemap 和 /me/ 快捷入口都从这里生成；web/test/site-map.test.ts 保证每个路由恰好属于一个栏目。
 *
 * 新增功能时：在对应栏目里加一个条目（routes 填它负责的路由名）；没有合适的栏目再新开一个（isNew + 落地页）。
 * 纯数据 + 纯函数（不碰 DOM），浏览器和构建期共用。
 */
import type { Route } from './render';

export type RouteName = Route['name'];
/** 谁能看到：all 所有人（默认）· guest 只给未登录访客 · member 登录的好朋友 · admin 站长（已登录后台） */
export type EntryAudience = 'all' | 'guest' | 'member' | 'admin';
/** 当前访客身份 */
export interface Audience {
  member: boolean;
  admin: boolean;
}

/** 条目上的动作（不对应路由的功能：音乐、阅读设置、命令面板……）；main.ts 的 runAction 负责执行。 */
export const ACTIONS = ['palette', 'music', 'reading', 'share', 'theme', 'random'] as const;
export type ActionName = (typeof ACTIONS)[number];

export interface SiteEntry {
  id: string;
  label: string;
  icon: string;
  /** 一句话说明（≤ 40 字），用在落地页、全部栏目页和 ⌘K */
  desc: string;
  /** 站内路径（不含部署前缀）；与 action 二选一 */
  href?: string;
  action?: ActionName;
  /** 这个条目负责的路由（含详情页，如文章 / 作品 / 话题详情） */
  routes: RouteName[];
  audience?: EntryAudience;
  /** false = 只是详情页的归属，不出现在菜单里 */
  listed?: boolean;
  /** false = 不进 sitemap（只属于个人的页面） */
  index?: boolean;
  /** ⌘K 额外关键词 */
  keywords?: string;
}

export interface SiteSection {
  id: string;
  /** 顶部导航上的短名（两个字） */
  label: string;
  /** 落地页 / 全部栏目页上的完整标题 */
  title: string;
  icon: string;
  /** 栏目入口（站内路径） */
  href: string;
  desc: string;
  /** 1.23.0 新开的栏目（有自己的落地页） */
  isNew?: boolean;
  entries: SiteEntry[];
}

const M = 'member' as const;

export const SITE_SECTIONS: SiteSection[] = [
  {
    id: 'home',
    label: '首页',
    title: '首页',
    icon: 'home',
    href: '/',
    desc: '最新文章、精选与此刻',
    entries: [{ id: 'home', label: '首页', icon: 'home', desc: '轮播、精选、最新文章与访客便签', href: '/', routes: ['home'], listed: false }],
  },
  {
    id: 'posts',
    label: '文章',
    title: '文章',
    icon: 'book',
    href: '/archives/',
    desc: '全部文章、系列连载、搜索与订阅',
    entries: [
      { id: 'archives', label: '归档', icon: 'archive', desc: '按年月浏览全部文章，带归档日历', href: '/archives/', routes: ['archives', 'post'], keywords: 'archive 文章 归档 日历' },
      { id: 'series', label: '系列连载', icon: 'list', desc: '按系列从第一篇读起', href: '/series/', routes: ['series', 'seriesdetail'], keywords: 'series 系列 连载' },
      { id: 'search', label: '搜索', icon: 'search', desc: '文章、作品、影集、创作者与话题联合搜索，可按类型 / 标签 / 年份筛选', href: '/search/', routes: ['search'], keywords: 'search 搜索 全文 筛选 作品 用户 话题' },
      { id: 'stats', label: '数据', icon: 'chart', desc: '写作热力图、字数与发布节奏', href: '/stats/', routes: ['stats'], keywords: 'stats 数据 热力图' },
      { id: 'scheduled', label: '即将发布', icon: 'clock', desc: '已经写好、定了发布时间的文章', href: '/scheduled/', routes: ['scheduled'], keywords: 'scheduled upcoming 定时 即将发布 预告' },
      { id: 'preview', label: '发布预览', icon: 'eye', desc: '用正式文章页的样子预览写作台里的草稿', href: '/preview/', routes: ['preview'], audience: 'admin', index: false, keywords: 'preview draft 预览 草稿 写作台' },
      { id: 'subscribe', label: '订阅', icon: 'rss', desc: 'RSS / Atom / JSON Feed 与邮件摘要', href: '/subscribe/', routes: ['subscribe'], keywords: 'rss atom feed 订阅 邮件 摘要' },
    ],
  },
  {
    id: 'curation',
    label: '专题',
    title: '专题',
    icon: 'folder',
    href: '/categories/',
    desc: '分类、标签、书影音、书摘与收藏',
    entries: [
      { id: 'categories', label: '分类专题', icon: 'folder', desc: '按主题归类的文章合集', href: '/categories/', routes: ['categories', 'category'], keywords: 'category 分类' },
      { id: 'tags', label: '标签', icon: 'tag', desc: '全部标签与对应文章', href: '/tags/', routes: ['tags', 'tag'], keywords: 'tag 标签' },
      { id: 'shelf', label: '书影音', icon: 'library', desc: '在读、在看、在听，带封面与评分', href: '/shelf/', routes: ['shelf', 'shelfyear'], keywords: 'book movie music 书 电影 openlibrary' },
      { id: 'quotes', label: '书摘', icon: 'book', desc: '文章和书影音里摘下来的句子，可生成分享卡片', href: '/quotes/', routes: ['quotes'], keywords: 'quotes highlight 书摘 摘录 划线 引用' },
      { id: 'glossary', label: '术语表', icon: 'list', desc: '曝光、光线、构图、器材、后期和胶片里的常用术语，一句话讲清楚', href: '/glossary/', routes: ['glossary', 'term'], keywords: 'glossary terms 术语 名词 解释 词典 aperture iso 光圈 快门' },
      { id: 'favorites', label: '收藏与项目', icon: 'star', desc: '收藏的好东西和站长的项目', href: '/favorites/', routes: ['favorites'], keywords: 'favorites 收藏' },
    ],
  },
  {
    id: 'photo',
    label: '摄影',
    title: '摄影',
    icon: 'camera',
    href: '/works/',
    desc: '作品集、影集、摄影专题、照片地图与器材',
    entries: [
      { id: 'works', label: '作品集', icon: 'aperture', desc: '按系列筛选的照片，附 EXIF 参数', href: '/works/', routes: ['works'], keywords: 'works photo exif 作品 照片' },
      { id: 'magazine', label: '视觉杂志', icon: 'library', desc: '把照片和文章排成一期期小杂志：专题、对页、画廊、引语', href: '/magazine/', routes: ['magazine', 'issue'], keywords: 'magazine zine issue 杂志 期刊 视觉 排版 画廊 对页' },
      { id: 'av', label: '视频与声音', icon: 'play', desc: '短片和声音作品，带字幕、章节和完整文字稿', href: '/av/', routes: ['avlist', 'av'], keywords: 'video audio av film sound podcast 视频 声音 音频 短片 字幕 文字稿' },
      { id: 'halls', label: '沉浸式展厅', icon: 'box', desc: '把一组照片挂上四面墙，可以用键盘环顾，也能切回平面列表', href: '/halls/', routes: ['halls', 'hall'], keywords: 'hall gallery 3d immersive exhibition 展厅 沉浸 立体 环顾 展览' },
      { id: 'retouch', label: '修图前后', icon: 'image', desc: '同一张照片修图前后的对比，以及每一步做了什么', href: '/retouch/', routes: ['retouch', 'retouchcase'], keywords: 'retouch before after edit lightroom 修图 后期 前后 对比 调色' },
      { id: 'essays', label: '影集', icon: 'image', desc: '一组照片讲一个故事，支持故事模式', href: '/essays/', routes: ['essays'], keywords: 'essay 影集 故事模式' },
      { id: 'features', label: '摄影专题', icon: 'book', desc: '好朋友用照片和文字做的专题', href: '/f/', routes: ['features', 'feature'], keywords: 'feature 专题' },
      { id: 'monthly', label: '月度合集', icon: 'calendar', desc: '每个月的文章、影集和作品自动整理成一页', href: '/monthly/', routes: ['monthly', 'month'], keywords: 'monthly digest 月度 合集 每月 回顾' },
      { id: 'map', label: '照片地图', icon: 'mapPin', desc: '约 10 公里精度的拍摄地点与每日一图', href: '/map/', routes: ['map'], keywords: 'map 地图 每日一图' },
      { id: 'gallery', label: '画廊', icon: 'image', desc: '按相册整理的照片', href: '/gallery/', routes: ['gallery', 'album'], keywords: 'gallery album 相册 画廊' },
      { id: 'gear', label: '器材', icon: 'camera', desc: '相机、镜头和日常装备', href: '/gear/', routes: ['gear'], keywords: 'gear 器材 相机' },
    ],
  },
  {
    id: 'community',
    label: '社区',
    title: '社区',
    icon: 'users',
    href: '/community/',
    desc: '好朋友们的作品、话题、小组、活动与留言',
    isNew: true,
    entries: [
      { id: 'community', label: '社区首页', icon: 'users', desc: '社区里的全部功能', href: '/community/', routes: ['community'], listed: false },
      { id: 'discover', label: '发现', icon: 'compass', desc: '从话题、精选创作者和活动开始逛', href: '/discover/', routes: ['discover', 'user', 'collection'], keywords: 'discover 发现 创作者 合集' },
      { id: 'feed', label: '社区动态', icon: 'users', desc: '关注的人和最新的作品', href: '/feed/', routes: ['feed', 'work'], keywords: 'feed 动态 作品' },
      { id: 'topics', label: '话题', icon: 'tag', desc: '摄影、编程、硬件、设计和日常', href: '/t/', routes: ['topics', 'topic'], keywords: 'topic 话题 订阅' },
      { id: 'groups', label: '小组', icon: 'users', desc: '按兴趣组队：加入小组、分享作品、看公告', href: '/groups/', routes: ['groups', 'group'], keywords: 'group 小组 兴趣 社群 组队' },
      { id: 'events', label: '摄影活动', icon: 'flag', desc: '每日一图、每周主题与投稿投票', href: '/events/', routes: ['events', 'event'], keywords: 'event 活动 投票 投稿 聊天室' },
      { id: 'guestbook', label: '留言与便签', icon: 'message', desc: '给站长留言，贴一张访客便签', href: '/guestbook/', routes: ['guestbook'], keywords: 'guestbook 留言 便签' },
      { id: 'compose', label: '发布作品', icon: 'edit', desc: '分享照片、影集、短动态或长文', href: '/compose/', routes: ['compose'], audience: M, index: false, keywords: 'compose 发布 投稿' },
    ],
  },
  {
    id: 'tech',
    label: '技术',
    title: '技术',
    icon: 'code',
    href: '/opensource/',
    desc: '开源项目、创作者项目、更新日志与运行状态',
    entries: [
      { id: 'opensource', label: '开源项目', icon: 'code', desc: 'GitHub 上的项目与星标', href: '/opensource/', routes: ['opensource'], keywords: 'github open source 开源' },
      { id: 'projects', label: '创作者项目', icon: 'briefcase', desc: '开发日志、版本和关联作品', href: '/projects/', routes: ['projects', 'project'], keywords: 'project 项目 开发日志' },
      { id: 'changelog', label: '更新日志', icon: 'list', desc: '站点每个版本改了什么', href: '/changelog/', routes: ['changelog'], keywords: 'changelog 版本 更新' },
      { id: 'status', label: '运行状态', icon: 'dashboard', desc: '服务是否正常与近 30 天可用率', href: '/status/', routes: ['status'], keywords: 'status uptime 可用率 运行' },
    ],
  },
  {
    id: 'tools',
    label: '工具',
    title: '工具',
    icon: 'tool',
    href: '/tools/',
    desc: '摄影计算器、命令面板、音乐、阅读设置和分享工具',
    isNew: true,
    entries: [
      { id: 'tools', label: '工具箱', icon: 'tool', desc: '全站的小工具', href: '/tools/', routes: ['tools'], listed: false },
      { id: 'exposure', label: '曝光计算器', icon: 'aperture', desc: 'EV 值与光圈 / 快门 / ISO 等效组合，含 ND 减光', href: '/tools/exposure/', routes: ['exposure'], keywords: 'exposure ev 曝光 光圈 快门 iso 等效 nd 减光镜 阳光16' },
      { id: 'dof', label: '景深计算器', icon: 'camera', desc: '近点、远点与超焦距，含手机传感器', href: '/tools/dof/', routes: ['dof'], keywords: 'dof depth of field hyperfocal 景深 超焦距 弥散圆 手机' },
      { id: 'goldenhour', label: '黄金 / 蓝调时刻', icon: 'sun', desc: '按日期和城市离线计算日出日落与最佳拍摄时段', href: '/tools/golden-hour/', routes: ['goldenhour'], keywords: 'golden hour blue hour sunrise sunset 黄金时刻 蓝调 日出 日落 太阳' },
      { id: 'exifviewer', label: 'EXIF 查看器', icon: 'image', desc: '在本机读取照片参数，不上传；可下载去除元数据的副本', href: '/tools/exif/', routes: ['exifviewer'], keywords: 'exif metadata gps 元数据 参数 去除 隐私' },
      { id: 'checklists', label: '拍摄清单', icon: 'check', desc: '出门拍摄前对一遍：器材、设置和现场流程，勾选只存在本机', href: '/checklists/', routes: ['checklists', 'checklist'], keywords: 'checklist packing gear 清单 器材 准备 出门 拍摄前' },
      { id: 'palette', label: '命令面板', icon: 'search', desc: '⌘K / Ctrl K 一处搜索页面与操作', action: 'palette', routes: [], keywords: 'palette command 命令 快捷键' },
      { id: 'music', label: '音乐播放器', icon: 'music', desc: 'CC 授权的完整曲目，不会自动播放', action: 'music', routes: [], keywords: 'music 音乐 播放器 歌单' },
      { id: 'reading', label: '阅读设置与朗读', icon: 'settings', desc: '字号、行距、宽度，以及朗读全文', action: 'reading', routes: [], keywords: 'reading tts 阅读 朗读 字号' },
      { id: 'readinglist', label: '稍后读', icon: 'bookmark', desc: '在文章页加入的待读清单，带阅读进度，可导出 Markdown', href: '/reading-list/', routes: ['readinglist'], index: false, keywords: 'read later reading list 稍后读 待读 清单' },
      { id: 'share', label: '分享海报', icon: 'send', desc: '文章二维码海报与引用卡片', action: 'share', routes: [], keywords: 'share poster qr quote 分享 海报 引用卡片' },
      { id: 'theme', label: '深色模式', icon: 'moon', desc: '在深色与浅色之间切换', action: 'theme', routes: [], keywords: 'dark light theme 深色 浅色' },
      { id: 'random', label: '随便看一篇', icon: 'shuffle', desc: '随机打开一篇文章', action: 'random', routes: [], keywords: 'random 随机' },
    ],
  },
  {
    id: 'about',
    label: '关于',
    title: '关于',
    icon: 'user',
    href: '/about/',
    desc: '关于我、此刻、时间线、友链、使用指南与隐私',
    entries: [
      { id: 'about', label: '关于我', icon: 'user', desc: '我是谁，在做什么', href: '/about/', routes: ['about'], keywords: 'about 关于' },
      { id: 'now', label: '此刻', icon: 'clock', desc: '最近在做、在读、在想的事', href: '/now/', routes: ['now'], keywords: 'now 此刻' },
      { id: 'timeline', label: '时间线', icon: 'history', desc: '这些年的重要节点', href: '/timeline/', routes: ['timeline'], keywords: 'timeline 时间线' },
      { id: 'links', label: '友链', icon: 'link', desc: '朋友们的站点', href: '/links/', routes: ['links'], keywords: 'links friends 友链' },
      { id: 'mailbox', label: '信箱', icon: 'mail', desc: '给我发文件或说一句话', href: '/mailbox/', routes: ['mailbox'], keywords: 'mailbox 信箱 上传' },
      { id: 'guide', label: '使用指南', icon: 'book', desc: '怎么阅读、订阅、加入、发布，AI 与隐私、无障碍', href: '/guide/', routes: ['guide'], keywords: 'guide help how to 使用指南 帮助 新手 无障碍 快捷键' },
      { id: 'privacy', label: '隐私说明', icon: 'eye', desc: '本站收集什么、不收集什么', href: '/privacy/', routes: ['privacy'], keywords: 'privacy 隐私' },
      { id: 'sections', label: '全部栏目', icon: 'grid', desc: '一页看全站所有栏目与功能', href: '/sections/', routes: ['sections'], keywords: 'sitemap 栏目 地图 导航' },
    ],
  },
  {
    id: 'account',
    label: '账号',
    title: '账号与安全',
    icon: 'shield',
    href: '/account/',
    desc: '登录、通知、私信、我的数据与隐私安全',
    isNew: true,
    entries: [
      { id: 'account', label: '账号首页', icon: 'shield', desc: '账号相关的全部功能', href: '/account/', routes: ['account'], listed: false },
      { id: 'join', label: '登录与徽章', icon: 'verified', desc: '邮箱或 Passkey 登录，好朋友徽章', href: '/join/', routes: ['join'], keywords: 'login join passkey 登录 注册 徽章 好朋友' },
      { id: 'me', label: '我的', icon: 'user', desc: '个人资料、收藏、隐私与通知设置', href: '/me/', routes: ['me'], audience: M, index: false, keywords: 'me profile 我的 资料 设置' },
      { id: 'notifications', label: '通知', icon: 'bell', desc: '关注、回复、提及与回应', href: '/notifications/', routes: ['notifications'], audience: M, index: false, keywords: 'notifications 通知' },
      { id: 'messages', label: '私信', icon: 'message', desc: '和互相关注的好朋友一对一聊天', href: '/messages/', routes: ['messages', 'conversation'], audience: M, index: false, keywords: 'dm messages 私信 聊天' },
      { id: 'msgrequests', label: '消息请求', icon: 'userPlus', desc: '还没互相关注的人发来的消息', href: '/messages/requests/', routes: ['msgrequests'], audience: M, index: false, keywords: 'requests 消息请求' },
      { id: 'msgsettings', label: '私信设置', icon: 'settings', desc: '谁能私信我、已读回执与在线状态', href: '/messages/settings/', routes: ['msgsettings'], audience: M, index: false, keywords: 'dm settings 私信设置 已读' },
      { id: 'mystats', label: '我的数据', icon: 'chart', desc: '只有你能看到的浏览与互动汇总', href: '/me/stats/', routes: ['mystats'], audience: M, index: false, keywords: 'my stats 我的数据 创作者' },
      { id: 'security', label: '隐私与安全', icon: 'lock', desc: '设备、Passkey、数据导出与注销', href: '/me/security/', routes: ['security'], audience: M, keywords: 'security passkey 安全 设备 导出 注销' },
      { id: 'admin', label: '站长后台', icon: 'dashboard', desc: '文章、栏目、审核与运行状态', href: '/admin/', routes: [], audience: 'admin', keywords: 'admin 后台 管理' },
    ],
  },
];

// ---------------------------------------------------------------- 查询
const OWNER = new Map<RouteName, { section: SiteSection; entry: SiteEntry }>();
for (const section of SITE_SECTIONS) for (const entry of section.entries) for (const r of entry.routes) if (!OWNER.has(r)) OWNER.set(r, { section, entry });

/** 路由所属栏目（404 没有） */
export function sectionOf(route: RouteName): SiteSection | undefined {
  return OWNER.get(route)?.section;
}
/** 路由所属栏目在导航里的序号（没有则 -1） */
export function sectionIndex(route: RouteName): number {
  const s = sectionOf(route);
  return s ? SITE_SECTIONS.indexOf(s) : -1;
}
/** 栏目里负责某个路由的条目 */
export function findEntry(sectionId: string, route: RouteName): SiteEntry | undefined {
  return SITE_SECTIONS.find((s) => s.id === sectionId)?.entries.find((x) => x.routes.includes(route));
}
export function entryVisible(entry: SiteEntry, aud: Audience): boolean {
  switch (entry.audience ?? 'all') {
    case 'guest':
      return !aud.member;
    case 'member':
      return aud.member;
    case 'admin':
      return aud.admin;
    default:
      return true;
  }
}
/** 出现在菜单 / 落地页里的条目 */
export const listedEntries = (s: SiteSection): SiteEntry[] => s.entries.filter((x) => x.listed !== false);

export interface PaletteEntry {
  id: string;
  title: string;
  sub: string;
  icon: string;
  href?: string;
  action?: ActionName;
  keywords: string;
}
/** ⌘K 的页面 / 工具项：栏目入口 + 当前身份能看到的条目 */
export function paletteEntries(aud: Audience): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  for (const s of SITE_SECTIONS) {
    out.push({ id: `section:${s.id}`, title: s.title, sub: `栏目 · ${s.desc}`, icon: s.icon, href: s.href, keywords: `${s.label} ${s.href.replace(/\//g, ' ')}` });
    for (const en of listedEntries(s)) {
      if (!entryVisible(en, aud)) continue;
      out.push({ id: en.id, title: en.label, sub: `${s.label} › ${en.desc}`, icon: en.icon, href: en.href, action: en.action, keywords: `${en.keywords ?? ''} ${(en.href ?? '').replace(/[/%?=]/g, ' ')}` });
    }
  }
  return out;
}

/**
 * 预渲染与 sitemap：render = 需要输出静态外壳的固定路由（不含首页分页和详情页），index = 其中进 sitemap 的。
 * 固定路由 = 条目 href 能直接解析到的路由。
 */
export function sitemapRoutes(): { render: RouteName[]; index: RouteName[] } {
  const render: RouteName[] = [];
  const index: RouteName[] = [];
  for (const s of SITE_SECTIONS)
    for (const en of s.entries) {
      for (const r of en.routes) {
        if (r === 'home' || DETAIL.has(r) || render.includes(r)) continue;
        render.push(r);
        if (en.index !== false && !NOINDEX.has(r)) index.push(r);
      }
    }
  return { render, index };
}
/** 不该被搜索引擎收录的路由（个人页面 / 站长预览）：预渲染时输出 robots noindex */
export function noindexRoute(route: RouteName): boolean {
  if (NOINDEX.has(route)) return true;
  return SITE_SECTIONS.some((s) => s.entries.some((en) => en.index === false && en.routes.includes(route)));
}
/** 详情页（带参数的路由）：由各自的数据驱动预渲染 */
const DETAIL = new Set<RouteName>(['post', 'tag', 'category', 'album', 'user', 'work', 'topic', 'event', 'collection', 'project', 'feature', 'conversation', 'seriesdetail', 'month', 'shelfyear', 'group', 'issue', 'av', 'hall', 'term', 'retouchcase', 'checklist', 'notfound']);
/** 和条目同属一个 entry 但只属于个人的路由 */
const NOINDEX = new Set<RouteName>(['msgrequests', 'msgsettings']);
