/**
 * 演示模式的种子数据。
 * - 文字：本仓库原创（MIT）。
 * - 照片：来自 Wikimedia Commons（CC0 / 公有领域 / CC BY / CC BY-SA，已缩放并转为 WebP），
 *   作者与许可见 web/demo-assets/photos/credits.json 与 README「图片致谢」。
 * - 头像 SVG 与背景音乐（合成的原创旋律）为本仓库原创。
 * 不包含任何真实账号、密钥或个人隐私信息。
 */
import type { Album, Favorite, Friend, Post, Profile, Settings } from '../types';
import credits from '../../demo-assets/photos/credits.json';
import type { Festival, Project, Member, StickyNote, GuestbookItem } from './community-types';

export interface DemoDb {
  version: 2;
  nextId: number;
  posts: Post[];
  profile: Profile;
  settings: Settings;
  friends: Friend[];
  gallery: Album[];
  favorites: Favorite[];
  projects: Project[];
  festivals: Festival[];
  guestbook: GuestbookItem[];
  notes: StickyNote[];
  members: Member[];
  files: import('./community-types').UploadedFile[];
  voice: import('./community-types').VoiceMessage[];
}

/** 演示后台的公开密码（只用于本地演示，不对应任何真实账号）。 */
export const DEMO_PASSWORD = 'demo1234';
/** 演示模式里「邮件验证码」固定为此值（真实站点由 Worker 通过邮件服务发送随机验证码）。 */
export const DEMO_OTP = '246810';

type CreditMap = Record<string, { title: string; author: string; license: string; licenseUrl: string; source: string; width: number; height: number }>;
export const PHOTO_CREDITS = credits as CreditMap;

const day = (iso: string) => new Date(iso).toISOString();
const count = (md: string) => md.replace(/```[\s\S]*?```/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[\s#*>`|\-_[\]()]/g, '').length;

export function createSeed(base = '/'): DemoDb {
  const b = base.endsWith('/') ? base : `${base}/`;
  const asset = (name: string) => `${b}demo/${name}`;
  /** 照片默认用 1280 宽；渲染时自动生成 640 / 1280 / 1920 的 srcset */
  const photo = (key: string) => asset(`photos/${key}-1280.webp`);
  const credit = (key: string) => {
    const c = PHOTO_CREDITS[key];
    return c ? `*封面：${c.author} / [Wikimedia Commons](${c.source}) / ${c.license}*` : '';
  };
  const pc = (key: string, caption: string) => {
    const c = PHOTO_CREDITS[key];
    return { url: photo(key), caption, width: c?.width, height: c?.height, credit: c ? `${c.author} · ${c.license}` : '', creditUrl: c?.source ?? '' };
  };
  const posts: Omit<Post, 'id'>[] = [
    {
      slug: 'welcome',
      title: '欢迎来到我的博客',
      summary: '新博客上线：静态前端 + Cloudflare Worker，还能通过 MCP 让 AI 帮我写文章。这里是它的在线演示版。',
      tags: ['随笔', '建站'],
      coverUrl: photo('hero-lake'),
      category: '随笔',
      pinned: true,
      wordCount: 0,
      status: 'published',
      publishedAt: day('2026-10-08T12:00:00Z'),
      createdAt: day('2026-10-08T12:00:00Z'),
      updatedAt: day('2026-10-08T12:00:00Z'),
      contentMd: `# 你好，世界

这是新博客的第一篇文章。

## 这个博客是怎么搭的

- **前端**：纯静态页面，动效来自我自己的 [Motionary](https://github.com/HarrisonCN/Motionary)。
- **后端**：一个 Cloudflare Worker，文章存在 D1，图片存在 R2。
- **MCP**：Worker 自带 \`/mcp\` 端点，Claude / Cursor 可以直接列出、撰写和发布文章。

## 关于这个演示

你现在看到的是**演示版**：没有服务器，所有数据都保存在你自己的浏览器里。
点顶部提示条里的「进入后台」，用页面上显示的演示密码登录，就可以写文章、改资料、管理画廊和友链、调整首页的展示方式——改动只有你自己能看到，随时可以一键重置。

\`\`\`ts
// 正式版通过 REST 读取文章：
const { posts } = await fetch('/api/posts').then((r) => r.json());
\`\`\`

欢迎常来看看。

${credit('hero-lake')}`,
    },
    {
      slug: 'phone-night-photography',
      title: '用手机拍夜景的五个小习惯',
      summary: '不换设备，只改习惯：稳住、找光、压曝光、等一等、少修一点。',
      tags: ['摄影', '手机摄影'],
      coverUrl: photo('harbour-night'),
      category: '摄影',
      pinned: false,
      wordCount: 0,
      status: 'published',
      publishedAt: day('2026-09-26T13:30:00Z'),
      createdAt: day('2026-09-25T10:00:00Z'),
      updatedAt: day('2026-09-26T13:30:00Z'),
      contentMd: `夜景拍不好，大多数时候不是手机不行，而是我们太着急。下面是我自己拍了一年夜景后留下来的五个习惯。

## 1. 先找一个能靠的地方

夜景模式需要一两秒的多帧合成。栏杆、墙角、背包顶上都是很好的“三脚架”。手机靠稳了，画面的锐度会肉眼可见地提升。

## 2. 让画面里有光源，但别正对它

路灯、招牌和车灯能给画面提供层次。把最亮的光源放在画面边缘，而不是正中央，眩光和鬼影会少很多。

## 3. 点一下对焦，再往下拉一点曝光

手机默认会把夜晚“拍成白天”。把曝光往下压 0.3～0.7 档，暗部才像夜晚，高光也不容易溢出。

> 夜景的气氛来自暗部，而不是来自把一切都提亮。

## 4. 多等五秒

等一辆车经过、等一个人走进光里、等红绿灯变色。很多时候，好照片只差一个“刚好”。

## 5. 后期少即是多

我的习惯是只做三件事：拉直水平线、略微降低高光、给一点点色温偏移。滤镜叠得越多，画面越像别人的照片。

---

下次出门，试试只带手机，用这五个习惯拍一组。

${credit('harbour-night')}`,
    },
    {
      slug: 'city-walk-notes',
      title: '扫街笔记：在老街区慢慢走',
      summary: '扫街不是收集风景，而是练习观察。记录一次在老街区闲逛时的取景思路。',
      tags: ['摄影', '城市'],
      coverUrl: photo('street-tricycle'),
      category: '摄影',
      pinned: false,
      wordCount: 0,
      status: 'published',
      publishedAt: day('2026-09-12T09:00:00Z'),
      createdAt: day('2026-09-11T15:00:00Z'),
      updatedAt: day('2026-09-12T09:00:00Z'),
      contentMd: `周末下午，我给自己定了一个规则：两个小时，只走一条街，最多拍三十张。

## 限制让人看得更仔细

快门次数少了，按下去之前就会多想一步：这张照片里，什么是主角？什么是可以去掉的？

我发现自己开始注意一些平时会忽略的东西：

- 墙上褪色的手写招牌；
- 午后斜射进巷子里的那一道光；
- 晾衣杆在地上投出的几何影子；
- 路口的修鞋师傅，手上的动作很稳。

## 构图的三个小练习

1. **框中框**：用门洞、窗户、楼梯扶手把主体框起来。
2. **留一点空**：让人物朝向画面的空白处，照片会有“往前走”的感觉。
3. **等元素进场**：先找好背景，再等一个路人、一只猫或一辆自行车走进来。

## 关于拍人

我会尽量先用眼神打招呼。如果对方摆手，就放下相机笑一笑。照片可以错过，尊重不能。

走完回去翻相册，最喜欢的反而是那张什么都没发生的：空荡荡的巷子，一束光落在台阶上。

${credit('street-tricycle')}`,
    },
    {
      slug: 'invisible-motion',
      title: '好的动效应该“看不见”',
      summary: '动效不是装饰，而是解释。写在做 Motionary 的过程中：时长、缓动与克制。',
      tags: ['动效', '前端', '设计'],
      coverUrl: photo('montriond-lake'),
      category: '前端',
      pinned: false,
      wordCount: 0,
      status: 'published',
      publishedAt: day('2026-08-30T11:00:00Z'),
      createdAt: day('2026-08-29T08:00:00Z'),
      updatedAt: day('2026-08-30T11:00:00Z'),
      contentMd: `做动效库这段时间，我越来越相信一句话：**用户记住的不该是动画本身，而是“这个界面很顺”。**

## 动效在回答什么问题？

每一个动效都应该回答一个问题：

| 问题 | 动效 |
| --- | --- |
| 这个东西从哪里来？ | 入场方向、位移 |
| 我的操作生效了吗？ | 按下反馈、状态切换 |
| 现在在哪一步？ | 进度、过渡 |

如果回答不出来，那它多半只是装饰，可以删掉。

## 三条经验

1. **时长要短**：界面元素大多在 150～400 毫秒之间，长文本入场可以稍长。
2. **缓动要自然**：进入用 ease-out（先快后慢），离开用 ease-in。线性动画只适合进度条。
3. **尊重系统设置**：用户开启“减少动态效果”时，就应该完全关掉位移，只保留必要的状态变化。

\`\`\`ts
import { createMotion } from 'motionary/core';

const motion = createMotion({ reducedMotion: 'user' });
motion.reveal(document.querySelectorAll('.card'), 'fade-up', { stagger: 60 });
\`\`\`

这个博客首页卡片的入场、标题的逐字出现和文章页的阅读进度条，都是这样做的。你可以在后台「展示设置」里把动效强度调到“强”或“关闭”，对比一下感受。

${credit('montriond-lake')}`,
    },
    {
      slug: 'product-testing-checklist',
      title: '做产品体验测试时，我会记下的十件事',
      summary: '参与系统测试和产品体验工作时整理的清单：好的反馈要能复现、能衡量、能被理解。',
      tags: ['产品', '清单'],
      coverUrl: photo('panixersee'),
      category: '产品',
      pinned: false,
      wordCount: 0,
      status: 'published',
      publishedAt: day('2026-08-15T07:30:00Z'),
      createdAt: day('2026-08-14T12:00:00Z'),
      updatedAt: day('2026-08-15T07:30:00Z'),
      contentMd: `一份好的体验反馈，开发同学看完就能动手。下面是我每次测试都会过一遍的清单。

1. **版本与环境**：系统版本、应用版本、机型、网络状态。
2. **复现步骤**：从桌面开始，一步一步写，不省略。
3. **预期 vs 实际**：各用一句话说清楚。
4. **出现频率**：必现、偶现（大约几次里出现一次）。
5. **截图或录屏**：录屏时打开触摸点显示。
6. **影响范围**：只影响一个页面，还是整条流程？
7. **对比参照**：上一个版本或同类产品是怎么做的？
8. **主观感受**：卡顿、跳动、看不懂——感受也是数据，但要说明是主观的。
9. **改进建议**：给一个可能的方向，而不是只说“不好用”。
10. **优先级判断**：会不会让用户放弃这个操作？

## 一个小技巧

> 写完反馈后，假装自己是第一次看到这条问题的人，只读一遍，看能不能明白发生了什么。

如果不能，就再补一句。

${credit('panixersee')}`,
    },
    {
      slug: 'guilin-night-reflections',
      title: '桂林夜游：日月双塔的倒影',
      summary: '在榕湖边等了四十分钟，只为一张没有风的倒影。记录一次夜景长曝光的完整流程。',
      tags: ['摄影', '夜景', '旅行'],
      coverUrl: photo('guilin-pagodas'),
      category: '摄影',
      pinned: false,
      wordCount: 0,
      status: 'published',
      publishedAt: day('2026-09-02T12:30:00Z'),
      createdAt: day('2026-09-01T10:00:00Z'),
      updatedAt: day('2026-09-03T08:00:00Z'),
      contentMd: `日月双塔亮灯以后，湖面像一块黑色的镜子。可是只要有一点风，倒影就会碎成一片片的光斑。

## 器材与参数

- 机身 + 24–70mm，三脚架，快门线
- ISO 100，f/8，曝光 6 秒
- 白平衡手动设在 3800K，让灯光保留一点暖色

## 等风停

我在湖边来回走了三次，找到一个前景干净、没有游船经过的角度。真正花时间的是等：风停下来的那几秒，湖面会突然变得很平。

> 长曝光不是把时间拉长，而是把“等待”也拍进照片里。

## 后期

只做了三件事：校正水平、压一点高光、把天空的噪点降掉。倒影里的颜色比塔本身更饱和，这是水面反射的特性，不需要刻意去拉。

${credit('guilin-pagodas')}`,
    },
    {
      slug: 'winter-forest-black-and-white',
      title: '冬天的森林：在黑白之间',
      summary: '雪把颜色拿走以后，画面里只剩下线条、层次和留白。聊聊我为什么喜欢在冬天拍黑白。',
      tags: ['摄影', '黑白', '风光'],
      coverUrl: photo('forest-road'),
      category: '摄影',
      pinned: false,
      wordCount: 0,
      status: 'published',
      publishedAt: day('2026-07-18T03:00:00Z'),
      createdAt: day('2026-07-17T10:00:00Z'),
      updatedAt: day('2026-07-18T03:00:00Z'),
      contentMd: `下雪的森林几乎是天然的黑白照片：树干是黑，雪是白，雾气是中间所有的灰。

## 先看光比

阴天的雪景光比很小，直接拍会发灰。我会在拍摄时就把曝光加 +0.7 到 +1，让雪保持干净的白，再在后期把树干的黑压下去。

## 找一条线

一条小路、一排树、一道车辙——引导线能让画面立刻有方向感。这张照片里，车辙从画面底部一直延伸到远处，眼睛会自然跟着它走进森林。

## 黑白转换的小技巧

1. 不要直接“去色”，用通道混合调整不同颜色的亮度；
2. 天空偏蓝，可以把蓝色压暗，让天空和雪拉开层次；
3. 最后加一点点颗粒，画面会更像胶片。

${credit('forest-road')}`,
    },
    {
      slug: 'my-2026-camera-bag',
      title: '我的 2026 摄影包：少即是多',
      summary: '从三镜头到一机一镜，减重之后反而拍得更多。附上一份轻量化出门清单。',
      tags: ['器材', '清单', '摄影'],
      coverUrl: photo('beach-parasols'),
      category: '器材',
      pinned: false,
      wordCount: 0,
      status: 'published',
      publishedAt: day('2026-06-20T09:00:00Z'),
      createdAt: day('2026-06-19T09:00:00Z'),
      updatedAt: day('2026-06-20T09:00:00Z'),
      contentMd: `去年我背着三支镜头出门，结果大部分时间都在犹豫“该换哪一支”。今年我给自己做了减法。

## 现在的摄影包

| 物品 | 理由 |
| --- | --- |
| 一台轻便机身 | 随时能拿出来 |
| 35mm 定焦 | 接近人眼视角，扫街、人像都够用 |
| 手机 | 夜景、超广角和随手记录 |
| 两块电池 + 一张备用卡 | 不用担心续航 |
| 小号清洁布 | 海边和雨天必备 |

## 减重以后的变化

- 换镜头的时间变成了观察的时间；
- 背包轻了，愿意多走两公里；
- 构图不再依赖变焦，而是靠脚步。

\`\`\`text
出门前检查：电池 ✓  存储卡 ✓  清洁布 ✓  好奇心 ✓
\`\`\`

${credit('beach-parasols')}`,
    },
    {
      slug: 'film-simulation-draft',
      title: '草稿：我的三套胶片模拟参数',
      summary: '还没写完的草稿，演示后台里“草稿”状态的样子。',
      tags: ['摄影', '调色'],
      coverUrl: null,
      category: '摄影',
      pinned: false,
      wordCount: 0,
      status: 'draft',
      publishedAt: null,
      createdAt: day('2026-10-05T14:00:00Z'),
      updatedAt: day('2026-10-05T14:00:00Z'),
      contentMd: `## 暖调日常

- 色温 +6，阴影偏暖
- 高光 -20，颗粒 15

## 冷调夜景

（待补充）

## 黑白高反差

（待补充）`,
    },

  ];
  return {
    version: 2,
    nextId: posts.length + 1,
    posts: posts.map((p, i) => ({ id: i + 1, ...p, wordCount: count(p.contentMd) })),
    profile: {
      name: 'Winston',
      tagline: '用镜头记录光影，用文字整理生活',
      avatarUrl: asset('avatar.svg'),
      homeUrl: 'https://github.com/HarrisonCN',
      bioMd: `你好，我是 **Winston**，一名摄影专业的学生。这里是我的个人博客，记录摄影、产品体验和前端动效的折腾。

## 我在做什么

- 📷 用手机和小相机扫街、拍夜景和风光
- 🧪 做系统与产品的体验测试，习惯把感受写成清单
- ✨ 业余写动效库 Motionary，这个博客的动画都来自它

## 联系我

欢迎在「留言板」打个招呼，或者去「信箱」给我留一段语音。想交换友链的话，可以在「友链」页提交。

> 这是演示站点：简介、头像和链接都可以在后台「资料」里修改，改动只保存在你的浏览器里。`,
      location: '中国 · 长沙',
      links: [
        { label: 'GitHub', url: 'https://github.com/HarrisonCN', icon: 'github' },
        { label: 'RSS', url: '/', icon: 'rss' },
        { label: '邮箱', url: 'mailto:hello@example.com', icon: 'email' },
      ],
    },
    settings: {
      siteTitle: 'Winston 的博客',
      siteDescription: '摄影、产品与动效笔记',
      theme: 'system',
      sections: { hero: true, featured: true, postList: true, tags: true, about: true, announcement: true, latest: true, stats: true, categories: true },
      featuredSlugs: ['guilin-night-reflections', 'invisible-motion', 'winter-forest-black-and-white'],
      animation: 'normal',
      postsPerPage: 6,
      heroImage: photo('hero-lake').replace('-1280.', '-1920.'),
      heroSubtitles: ['用镜头记录光影，用文字整理生活', '摄影 · 产品体验 · 前端动效', '慢慢走，好好看'],
      announcement: '欢迎来到我的博客 👋 这里是**演示站点**：可以随意进入后台试试写文章、改主题，所有改动只保存在你的浏览器里。',
    },
    friends: [
      { name: 'Motionary', url: 'https://github.com/HarrisonCN/Motionary', avatar: '', description: '这个博客用到的动效库：组件、特效与运行时。' },
      { name: 'Wikimedia Commons', url: 'https://commons.wikimedia.org/', avatar: '', description: '自由授权的图片与媒体资料库，本站示例照片的来源。' },
      { name: 'MDN Web Docs', url: 'https://developer.mozilla.org/zh-CN/', avatar: '', description: '写前端时最常打开的文档。' },
      { name: 'Cloudflare 博客', url: 'https://blog.cloudflare.com/zh-cn/', avatar: '', description: 'Workers、D1、R2 的一手资料。' },
    ],
    gallery: [
      { slug: 'mountains-and-lakes', title: '山与湖', description: '高山、湖泊和清晨的雾。', cover: photo('hero-lake'), date: '2026-09', photos: [pc('hero-lake', '日出时的高山湖'), pc('montriond-lake', '无风的湖面'), pc('panixersee', '峡谷里的绿湖'), pc('himalayas', '雪线之上'), pc('snina-winter', '雾凇覆盖的山脊')] },
      { slug: 'city-nights', title: '城市夜色', description: '灯光、倒影和夜里的城市。', cover: photo('pudong-night'), date: '2026-08', photos: [pc('pudong-night', '江边的天际线'), pc('harbour-night', '港湾夜景'), pc('guilin-pagodas', '日月双塔')] },
      { slug: 'coastline', title: '海岸线', description: '海浪、沙滩和傍晚的阳光。', cover: photo('baltic-view'), date: '2026-07', photos: [pc('baltic-view', '山坡上的海景'), pc('porto-covo', '冲浪的人'), pc('beach-parasols', '傍晚的遮阳伞'), pc('harbour-castle', '海边的城堡'), pc('palm-sunset', '三棵棕榈树')] },
      { slug: 'flowers', title: '花与植物', description: '微距与花田。', cover: photo('poppies-korea'), date: '2026-05', photos: [pc('poppies-korea', '虞美人花田'), pc('poppy-edge', '田边的一朵'), pc('sunflowers', '向日葵'), pc('iris', '花菖蒲'), pc('field-bindweed', '田旋花')] },
      { slug: 'streets', title: '街头', description: '路上遇到的人和路。', cover: photo('street-tricycle'), date: '2026-04', photos: [pc('street-tricycle', '满载的三轮车'), pc('forest-road', '雪中的林间小路')] },
    ],
    favorites: [
      { title: 'Wikimedia Commons', url: 'https://commons.wikimedia.org/', description: '自由授权的照片与媒体。', group: '摄影资源' },
      { title: 'Unsplash', url: 'https://unsplash.com/', description: '高质量免费照片（Unsplash License）。', group: '摄影资源' },
      { title: 'Pexels', url: 'https://www.pexels.com/', description: '免费照片与视频。', group: '摄影资源' },
      { title: 'MDN Web Docs', url: 'https://developer.mozilla.org/zh-CN/', description: 'Web 标准文档。', group: '开发工具' },
      { title: 'Can I use', url: 'https://caniuse.com/', description: '浏览器兼容性速查。', group: '开发工具' },
      { title: 'Vite', url: 'https://vite.dev/', description: '这个博客的构建工具。', group: '开发工具' },
      { title: 'Cloudflare Docs', url: 'https://developers.cloudflare.com/', description: 'Workers / D1 / R2 文档。', group: '开发工具' },
    ],
    projects: [
      { name: 'motionary', title: 'Motionary', version: '10.6.0', author: 'Winston', engine: '^10.0.0', downloads: 0, url: 'https://github.com/HarrisonCN/Motionary', description: '动效库：滚动动画、组件、特效与运行时，这个博客的所有动画都来自它。' },
      { name: 'mcp-gateway', title: 'mcp-gateway', version: '11.0.0', author: 'Winston', engine: '^10.0.0', downloads: 0, url: 'https://github.com/HarrisonCN', description: '可自行托管的 MCP 网关，把博客的 MCP 端点接给更多客户端。' },
      { name: 'the-blog', title: 'TheBLOG', version: '0.3.0', author: 'Winston', engine: '^10.0.0', downloads: 0, url: 'https://github.com/HarrisonCN/TheBLOG', description: '你正在看的博客：静态前端 + Cloudflare Worker + MCP。' },
    ],
    festivals: [
      { id: 'new-year', name: '元旦', date: '01-01', days: 1, theme: 'fireworks', message: '新年快乐！愿新的一年拍到更多喜欢的照片 🎆' },
      { id: 'valentine', name: '情人节', date: '02-14', days: 1, theme: 'fireworks', message: '情人节快乐 💝' },
      { id: 'spring-2027', name: '春节', date: '2027-02-06', days: 7, theme: 'lunar', message: '新春快乐，万事顺意 🧧' },
      { id: 'lantern-2027', name: '元宵节', date: '2027-02-20', days: 1, theme: 'lunar', message: '元宵节快乐，记得吃汤圆 🏮' },
      { id: 'labour', name: '劳动节', date: '05-01', days: 5, theme: 'fireworks', message: '劳动节快乐，好好休息 ☀️' },
      { id: 'dragon-boat-2027', name: '端午节', date: '2027-06-09', days: 1, theme: 'lunar', message: '端午安康 🐉' },
      { id: 'qixi-2026', name: '七夕', date: '2026-08-19', days: 1, theme: 'lunar', message: '七夕快乐 ✨' },
      { id: 'mid-autumn-2026', name: '中秋节', date: '2026-09-25', days: 3, theme: 'lunar', message: '中秋快乐，月圆人团圆 🥮' },
      { id: 'national', name: '国庆节', date: '10-01', days: 7, theme: 'fireworks', message: '国庆快乐 🇨🇳' },
      { id: 'halloween', name: '万圣节', date: '10-31', days: 1, theme: 'halloween', message: 'Happy Halloween 🎃' },
      { id: 'christmas', name: '圣诞节', date: '12-24', days: 3, theme: 'xmas', message: '圣诞快乐 🎄' },
    ],
    guestbook: [
      { id: 1, name: '小林', content: '照片好好看！夜景那篇学到了，回去试试压曝光。', website: '', status: 'approved', createdAt: day('2026-10-02T12:00:00Z') },
      { id: 2, name: 'Momo', content: '页面动效很舒服，不会晕 😆', website: '', status: 'approved', createdAt: day('2026-10-05T08:30:00Z') },
      { id: 3, name: '路过的同学', content: '求一个器材清单的后续！', website: '', status: 'pending', createdAt: day('2026-10-08T02:00:00Z') },
    ],
    notes: [
      { id: 1, name: '小林', content: '今天也要好好拍照 📷', color: 'yellow', reports: 0, hidden: false, createdAt: day('2026-10-03T10:00:00Z') },
      { id: 2, name: 'Momo', content: '周末去看海！', color: 'pink', reports: 0, hidden: false, createdAt: day('2026-10-04T10:00:00Z') },
      { id: 3, name: '阿树', content: '黑白那篇太喜欢了', color: 'blue', reports: 0, hidden: false, createdAt: day('2026-10-06T10:00:00Z') },
      { id: 4, name: '访客', content: '留下一个脚印 👣', color: 'green', reports: 0, hidden: false, createdAt: day('2026-10-07T10:00:00Z') },
    ],
    members: [
      { id: 1, email: 'friend1@example.com', name: '小林', avatarUrl: '', bio: '喜欢拍街头的大学生', website: '', badges: [{ code: 'FRIEND-0001', label: '第一位好朋友', style: 'pearlescent', grantedAt: day('2026-10-01T00:00:00Z') }], joinedAt: day('2026-10-01T00:00:00Z'), provider: 'email' },
      { id: 2, email: 'friend2@example.com', name: 'Momo', avatarUrl: '', bio: '前端 / 动效爱好者', website: '', badges: [], joinedAt: day('2026-10-05T00:00:00Z'), provider: 'email' },
    ],
    files: [],
    voice: [],
  };
}
