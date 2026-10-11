/**
 * 演示模式的种子数据。
 * - 文字：本仓库原创（MIT）。
 * - 照片：来自 Wikimedia Commons（CC0 / 公有领域 / CC BY / CC BY-SA，已缩放并转为 WebP），
 *   作者与许可见 web/demo-assets/photos/credits.json 与 README「图片致谢」。
 * - 头像 SVG 与背景音乐（合成的原创旋律）为本仓库原创。
 * 不包含任何真实账号、密钥或个人隐私信息。
 */
import type { SectionMap } from '../sections';
import type { PlaylistItem } from '../music-core';
import { createSectionSeed } from './sections-seed';
import type { Album, Favorite, Friend, Post, Profile, Settings } from '../types';
import credits from '../../demo-assets/photos/credits.json';
import type { EssayExif, EssayPhoto, ShotNote } from '../essay-core';
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
  now: SectionMap['now'];
  works: SectionMap['works'];
  gear: SectionMap['gear'];
  shelf: SectionMap['shelf'];
  timeline: SectionMap['timeline'];
  changelog: SectionMap['changelog'];
  repos: SectionMap['repos'];
  /** 站长歌单（音乐小部件）；旧的本地数据没有这个字段时用种子补齐 */
  playlist?: PlaylistItem[];
  /** 文章表情回应计数（slug → 表情 → 次数）；旧的本地数据没有这个字段 */
  reactions?: Record<string, Record<string, number>>;
  /** 演示站只有「本机」一个访客：记录本机点过的 slug|emoji */
  reactionVotes?: string[];
  /** 文章评论（旧的本地数据没有这个字段） */
  comments?: import('../comment-core').PostComment[];
  /** L15 社交（用户名 / 关注 / 收藏 / 通知）；旧的本地数据没有这个字段时用种子补齐 */
  social?: import('./mock-social').SocialState;
  /** L16 用户投稿 / 评论 / 回应 / 举报 / 审核日志；旧的本地数据没有这个字段时用种子补齐 */
  ugc?: import('./mock-ugc').UgcState;
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
      coverUrl: photo('alpine-sunset'),
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
      series: '夜色与城市',
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

夜景模式需要一两秒的多帧合成[^merge]。栏杆、墙角、背包顶上都是很好的“三脚架”。手机靠稳了，画面的锐度会肉眼可见地提升。

## 2. 让画面里有光源，但别正对它

路灯、招牌和车灯能给画面提供层次。把最亮的光源放在画面边缘，而不是正中央，眩光和鬼影会少很多。

![港湾夜景](${photo('harbour-night')} "光源放在画面边缘：港湾夜景（示例图）")

## 3. 点一下对焦，再往下拉一点曝光

手机默认会把夜晚“拍成白天”。把曝光往下压 0.3～0.7 档[^ev]，暗部才像夜晚，高光也不容易溢出。

> 夜景的气氛来自暗部，而不是来自把一切都提亮。

## 4. 多等五秒

等一辆车经过、等一个人走进光里、等红绿灯变色。很多时候，好照片只差一个“刚好”。

![日月双塔的倒影](${photo('guilin-pagodas')} "多等五秒，水面安静下来（示例图）")

## 5. 后期少即是多

我的习惯是只做三件事：拉直水平线、略微降低高光、给一点点色温偏移。滤镜叠得越多，画面越像别人的照片。

---

下次出门，试试只带手机，用这五个习惯拍一组。

[^merge]: 手机在你按下快门的前后连续拍很多张，再对齐、叠加来降低噪点，所以这段时间里要尽量稳住。
[^ev]: 1 档（1 EV）表示进光量翻倍或减半；0.3 档大约是曝光补偿滑块上的一小格。

${credit('harbour-night')}`,
    },
    {
      slug: 'city-walk-notes',
      series: '夜色与城市',
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
      series: '动效笔记',
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
      series: '夜色与城市',
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
      coverUrl: photo('desk-setup'),
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
      slug: 'mcp-blog-endpoint',
      title: '给博客接上 MCP：让 AI 帮我起草文章',
      summary: '博客的 Worker 自带一个 MCP 端点：AI 助手可以列文章、写草稿、传图片，但发布永远要我点头。',
      tags: ['MCP', 'AI', 'Cloudflare'],
      coverUrl: photo('pudong-night'),
      category: '前端',
      pinned: false,
      wordCount: 0,
      status: 'published',
      publishedAt: '2026-10-06T12:00:00.000Z',
      createdAt: '2026-10-05T12:00:00.000Z',
      updatedAt: '2026-10-06T12:00:00.000Z',
      contentMd: `> 示例文章：演示站里的内容都可以在后台改掉。

写博客最难的不是写，而是**开始写**。所以我给博客的 Worker 加了一个 MCP（Model Context Protocol）端点，让 AI 助手能直接帮我起草。

## 它能做什么

- 列出文章、标签和分类，知道我写过什么；
- 创建和修改**草稿**、上传配图；
- 读取和更新友链、收藏这类站点内容。

## 它不能做什么

发布永远需要我自己在后台确认。MCP 用的是单独的 API Token，和后台密码分开；Token 只在服务器上保存哈希。

## 和 mcp-gateway 一起用

我自己的 [mcp-gateway](https://github.com/HarrisonCN/mcp-gateway) 可以把博客端点和其他 MCP 服务器聚合到一起，统一做鉴权和限流。仓库里有一份示例配置。

${credit('pudong-night')}`,
    },
    {
      slug: 'coloros-beta-notes',
      title: '系统内测笔记：我是怎么写体验反馈的',
      summary: '参加手机系统公测一年多，总结出一份反馈模板：一句话结论、复现步骤、预期与实际、影响范围。',
      tags: ['ColorOS', '体验测试', '产品'],
      coverUrl: photo('field-bindweed'),
      category: '产品',
      pinned: false,
      wordCount: 0,
      status: 'published',
      publishedAt: '2026-09-20T10:00:00.000Z',
      createdAt: '2026-09-19T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
      contentMd: `> 示例文章：演示站里的内容都可以在后台改掉。

参加系统公测（我用的是 ColorOS）之后，我发现**一条好反馈的价值远远大于十条“好卡”**。

## 我的反馈模板

1. **一句话结论**：在哪个界面、做了什么、出了什么问题；
2. **复现步骤**：从解锁开始写，每一步一行；
3. **预期 vs 实际**：分开写，不要混在一起；
4. **影响范围**：必现还是偶现？换个应用 / 重启后还有吗？
5. **附件**：录屏比截图更有用，开发者选项里打开“显示触摸操作”。

## 动效问题怎么描述

“掉帧”太模糊。我会写：*从桌面上滑进入多任务时，卡片在第 2～3 帧有明显停顿*，再附上 120 fps 的录屏。

## 不要做的事

- 不在反馈里抱怨情绪，只描述事实；
- 不泄露未公开的功能截图——内测协议要遵守。

${credit('field-bindweed')}`,
    },
    {
      slug: 'scroll-motion-budget',
      series: '动效笔记',
      title: '滚动动效的性能预算',
      summary: '一个页面里同时跑多少动画才算多？我给自己定的预算：首屏传输、主线程时间和掉帧率三条线。',
      tags: ['动效', '性能', '前端'],
      coverUrl: photo('baltic-view'),
      category: '前端',
      pinned: false,
      wordCount: 0,
      status: 'published',
      publishedAt: '2026-10-02T09:00:00.000Z',
      createdAt: '2026-10-01T09:00:00.000Z',
      updatedAt: '2026-10-02T09:00:00.000Z',
      contentMd: `> 示例文章：演示站里的内容都可以在后台改掉。

这个博客用了很多动效，所以我给它定了一份**性能预算**，每次改版都要过线。

## 三条线

| 指标 | 预算 |
| --- | --- |
| 首屏 JS（gzip） | 不超过 60 KB，其余组件按需加载 |
| 长任务 | 首屏没有超过 50 ms 的主线程任务 |
| 滚动掉帧 | 中端手机上 95% 的帧在 16.7 ms 内 |

## 怎么做到

- **按需加载**：页面上出现哪个 \`<usa-*>\` 标签才加载对应的组件块；
- **只动 transform 和 opacity**，不动布局属性；
- **IntersectionObserver** 代替 scroll 事件；
- 屏幕外的动画暂停，系统开启“减少动态效果”时直接关掉位移。

\`\`\`ts
const io = new IntersectionObserver((entries) => {
  for (const e of entries) e.target.classList.toggle('is-in', e.isIntersecting);
}, { rootMargin: '0px 0px -10% 0px' });
\`\`\`

${credit('baltic-view')}`,
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

    // ---------------------------------------------------------------- l14 示例：影集 + 正文嵌入块（明确标注为示例，不是 Winston 的作品）
    ...demoEssays(photo),
  ];
  return {
    version: 2,
    playlist: demoPlaylist(),
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
      // 社交 ID：个人卡片里点图标可以查看 / 复制。除 GitHub 外都是示例，请在后台「资料」里换成自己的。
      links: [
        { label: 'GitHub', url: 'https://github.com/HarrisonCN', icon: 'github', handle: 'HarrisonCN' },
        { label: '微信（示例）', url: `${b}about/`, icon: 'wechat', handle: 'winston-sample' },
        { label: '小红书（示例）', url: 'https://www.xiaohongshu.com/', icon: 'xiaohongshu', handle: '示例 ID 123456' },
        { label: '邮箱（示例）', url: 'mailto:hello@example.com', icon: 'email', handle: 'hello@example.com' },
        { label: 'RSS', url: `${b}rss.xml`, icon: 'rss' },
      ],
      role: '摄影 / 产品体验 / 前端动效',
      // 示例数字：在后台「资料 → 卡片数字」里改成真实数据或删掉
      stats: [
        { label: '关注者', value: '1.2k' },
        { label: '旅行的城市', value: '12' },
      ],
    },
    settings: {
      siteTitle: 'Winston Blog',
      siteDescription: '记录生活，发现更大的世界',
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
      { id: 'new-year', name: '元旦', date: '01-01', days: 1, theme: 'fireworks', message: '新年快乐！愿新的一年拍到更多喜欢的照片' },
      { id: 'valentine', name: '情人节', date: '02-14', days: 1, theme: 'fireworks', message: '情人节快乐' },
      { id: 'spring-2027', name: '春节', date: '2027-02-06', days: 7, theme: 'lunar', message: '新春快乐，万事顺意' },
      { id: 'lantern-2027', name: '元宵节', date: '2027-02-20', days: 1, theme: 'lunar', message: '元宵节快乐，记得吃汤圆' },
      { id: 'labour', name: '劳动节', date: '05-01', days: 5, theme: 'fireworks', message: '劳动节快乐，好好休息' },
      { id: 'dragon-boat-2027', name: '端午节', date: '2027-06-09', days: 1, theme: 'lunar', message: '端午安康' },
      { id: 'qixi-2026', name: '七夕', date: '2026-08-19', days: 1, theme: 'lunar', message: '七夕快乐' },
      { id: 'mid-autumn-2026', name: '中秋节', date: '2026-09-25', days: 3, theme: 'lunar', message: '中秋快乐，月圆人团圆' },
      { id: 'national', name: '国庆节', date: '10-01', days: 7, theme: 'fireworks', message: '国庆快乐' },
      { id: 'halloween', name: '万圣节', date: '10-31', days: 1, theme: 'halloween', message: 'Happy Halloween' },
      { id: 'christmas', name: '圣诞节', date: '12-24', days: 3, theme: 'xmas', message: '圣诞快乐' },
    ],
    guestbook: [
      { id: 1, name: '小林', content: '照片好好看！夜景那篇学到了，回去试试压曝光。', website: '', status: 'approved', createdAt: day('2026-10-02T12:00:00Z') },
      { id: 2, name: 'Momo', content: '页面动效很舒服，不会晕 😆', website: '', status: 'approved', createdAt: day('2026-10-05T08:30:00Z') },
      { id: 3, name: '路过的同学', content: '求一个器材清单的后续！', website: '', status: 'pending', createdAt: day('2026-10-08T02:00:00Z') },
    ],
    notes: [
      { id: 1, name: '小林', content: '今天也要好好拍照 📷', color: 'yellow', reports: 0, hidden: false, createdAt: day('2026-10-03T10:00:00Z') },
      { id: 2, name: 'Momo', content: '周末去看海！', color: 'pink', style: { color: '#1d4ed8', font: 'hand', size: 'l', weight: 'bold', italic: false, effect: 'wobble' }, reports: 0, hidden: false, createdAt: day('2026-10-04T10:00:00Z') },
      { id: 3, name: '阿树', content: '黑白那篇太喜欢了', color: 'blue', style: { color: '#6d28d9', font: 'kai', size: 'l', weight: 'normal', italic: false, effect: 'gradient' }, reports: 0, hidden: false, createdAt: day('2026-10-06T10:00:00Z') },
      { id: 4, name: '访客', content: '留下一个脚印 👣', color: 'green', reports: 0, hidden: false, createdAt: day('2026-10-07T10:00:00Z') },
    ],
    members: [
      { id: 1, email: 'friend1@example.com', name: '小林', avatarUrl: '', bio: '喜欢拍街头的大学生', website: '', badges: [{ code: 'FRIEND-0001', label: '第一位好朋友', style: 'pearlescent', grantedAt: day('2026-10-01T00:00:00Z') }], joinedAt: day('2026-10-01T00:00:00Z'), provider: 'email' },
      { id: 2, email: 'friend2@example.com', name: 'Momo', avatarUrl: '', bio: '前端 / 动效爱好者', website: '', badges: [{ code: 'FRIEND-0002', label: '夜猫子', style: 'brushed-metal', design: { texture: 'neon', shape: 'pill', fill: 'solid', color: '#ec4899', gradient: 'berry', border: 'solid', icon: 'flame', label: 'NIGHT', effect: 'glow', size: 'm' }, grantedAt: day('Mon 2026-10-05 8:00 PM EDT (UTC-04:00)') }], joinedAt: day('2026-10-05T00:00:00Z'), provider: 'email' },
    ],
    files: [],
    voice: [],
    comments: [
      { id: 1, slug: 'phone-night-photography', parentId: null, replyTo: '', name: '小林', content: '第三条太有用了，**压一点曝光**之后夜景终于像夜景了。', member: true, status: 'approved', createdAt: day('Sun 2026-09-27 9:00 PM EDT (UTC-04:00)') },
      { id: 2, slug: 'phone-night-photography', parentId: 1, replyTo: '', name: 'Winston', content: '对，暗部才是夜晚的气氛 🌙', member: false, status: 'approved', createdAt: day('Sun 2026-09-27 10:00 PM EDT (UTC-04:00)') },
      { id: 3, slug: 'phone-night-photography', parentId: 1, replyTo: 'Winston', name: '路过的同学', content: '想问一下靠栏杆拍的时候要不要关掉防抖？', member: false, status: 'approved', createdAt: day('Mon 2026-09-28 8:00 AM EDT (UTC-04:00)') },
      { id: 4, slug: 'phone-night-photography', parentId: null, replyTo: '', name: '晚风', content: '收藏了，周末试试 `等五秒` 大法。', member: false, status: 'approved', createdAt: day('Tue 2026-09-29 8:00 PM EDT (UTC-04:00)') },
      { id: 5, slug: 'phone-night-photography', parentId: null, replyTo: '', name: '新访客', content: '这条评论在等站长审核（演示用）。', member: false, status: 'pending', createdAt: day('Wed 2026-10-07 8:00 PM EDT (UTC-04:00)') },
      { id: 6, slug: 'welcome', parentId: null, replyTo: '', name: 'Momo', content: '新博客好看！期待更多照片。', member: true, status: 'approved', createdAt: day('Thu 2026-10-01 8:00 PM EDT (UTC-04:00)') },
    ],
    ...createSectionSeed(photo, PHOTO_CREDITS),
  };
}

/**
 * 演示歌单：Internet Archive 上 No-Source Netlabel 的合辑《Another Day, Another Way》（CC BY-NC-SA 4.0），
 * 完整曲目，署名与出处链接随曲目显示。站长可以在后台「音乐」里替换。
 */
export function demoPlaylist(): PlaylistItem[] {
  const lic = { license: 'CC BY-NC-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/', link: 'https://archive.org/details/NS050', album: 'Another Day, Another Way', cover: 'https://archive.org/services/img/NS050' };
  const f = (file: string) => `https://archive.org/download/NS050/${file}`;
  return [
    { id: 'swing-low', title: 'Swing Low', artist: 'Cocolixe', src: f('03-NS050-Cocolixe_Swing-Low.mp3'), duration: 200, ...lic },
    { id: 'the-light-between', title: 'The Light Between', artist: 'Tardiss', src: f('04-NS050-Tardiss_The-Light-Between.mp3'), duration: 183, ...lic },
    { id: 'clouds-in-the-shape-of-clouds', title: 'Clouds in the Shape of Clouds', artist: 'Ross Baker', src: f('11-NS050-Ross-Baker_Clouds-in-the-Shape-of-Clouds.mp3'), duration: 186, ...lic },
  ];
}

/**
 * l14 示例内容：三组影集（单列 / 双联 / 网格）+ 一篇「正文嵌入块一览」。
 * 照片全部来自 Wikimedia Commons（CC0 / 公有领域 / CC BY / CC BY-SA，逐张署名，见 credits.json）；EXIF 与拍摄手记是示意，不是原作者的真实参数。
 */
export function demoEssays(photo: (key: string) => string): Omit<Post, 'id'>[] {
  const credit = (key: string) => {
    const c = PHOTO_CREDITS[key];
    return c ? `${c.author} · ${c.license} · Wikimedia Commons` : '';
  };
  const ph = (key: string, caption: string, exif: Partial<EssayExif>, notes?: Partial<ShotNote>): EssayPhoto => {
    const c = PHOTO_CREDITS[key];
    return {
      src: photo(key), alt: caption, caption, credit: credit(key), width: c?.width ?? 0, height: c?.height ?? 0,
      exif: { camera: '', lens: '', focal: '', aperture: '', shutter: '', iso: '', date: '', ...exif },
      notes: notes ? { place: '', light: '', gear: '', settings: '', thought: '', ...notes } : null,
    };
  };
  const base = { pinned: false, wordCount: 0, status: 'published' as const, series: null };
  const note = '> 示例影集：照片来自 Wikimedia Commons（每张下方有署名），EXIF 和拍摄手记是为了演示而写的示意参数。换成自己的照片时，在后台把「署名」留空即可。';
  const t = (iso: string) => new Date(iso).toISOString();
  const track = 'https://archive.org/download/NS050/11-NS050-Ross-Baker_Clouds-in-the-Shape-of-Clouds.mp3';
  return [
    {
      ...base, kind: 'essay', slug: 'demo-essay-seaside', title: '示例影集：海边的一天', category: '摄影', tags: ['影集', '示例', '海边'],
      summary: '从清晨的港口到夜里的天际线，单列全幅排版；每张照片下面有图注、EXIF 条和可以展开的拍摄手记。手机上可以进入故事模式左右滑。',
      coverUrl: photo('harbour-castle'),
      publishedAt: t('2026-09-07T09:00:00+08:00'), createdAt: t('2026-09-07T08:00:00+08:00'), updatedAt: t('2026-09-07T09:00:00+08:00'),
      contentMd: `${note}\n\n海边的一天，按时间顺序排。单列版式适合「讲一个故事」：一张接一张往下看，图注就是旁白。`,
      notes: { place: '地中海沿岸（示例）', light: '晴，清晨到入夜', gear: '手机主摄 + 长焦（示意）', settings: '全程自动白平衡，夜景开夜景模式', thought: '同一个地方拍一整天，光线自己会讲故事。' },
      essay: {
        layout: 'single',
        photos: [
          ph('harbour-castle', '清晨的港口，城堡还在阴影里', { camera: '示例手机', focal: '24mm', aperture: 'f/1.8', shutter: '1/500s', iso: '50', date: '2026-07-12 07:40' }, { place: '港口（示例）', light: '清晨顺光', thought: '先拍全景交代环境。' }),
          ph('beach-parasols', '中午，遮阳伞排成了图案', { camera: '示例手机', focal: '77mm', aperture: 'f/2.8', shutter: '1/1000s', iso: '50', date: '2026-07-12 12:10' }, { light: '正午顶光', gear: '3× 长焦', thought: '顶光不好看人，但很适合拍图案。' }),
          ph('field-bindweed', '海边草地上的旋花', { camera: '示例手机', focal: '26mm', aperture: 'f/1.8', shutter: '1/320s', iso: '64', date: '2026-07-12 16:30' }, { light: '侧逆光', settings: '点测光在花瓣上，-0.7 EV' }),
          ph('harbour-night', '入夜，港湾的灯一盏盏亮起来', { camera: '示例手机', focal: '24mm', aperture: 'f/1.8', shutter: '1s', iso: '400', date: '2026-07-12 20:05' }, { place: '海湾（示例）', light: '蓝调时刻', settings: '靠在栏杆上，夜景模式 1 秒' }),
        ],
      },
    },
    {
      ...base, kind: 'essay', slug: 'demo-essay-flowers', title: '示例影集：花的双联画', category: '摄影', tags: ['影集', '示例', '花'],
      summary: '双联版式：两张一组并排，看颜色和形状的呼应。小屏上自动变成上下排。',
      coverUrl: photo('poppies-korea'),
      publishedAt: t('2026-09-06T09:00:00+08:00'), createdAt: t('2026-09-06T08:00:00+08:00'), updatedAt: t('2026-09-06T09:00:00+08:00'),
      contentMd: `${note}\n\n双联（diptych）把两张照片放在一起看：一张远一张近，或者一冷一暖。`,
      notes: null,
      essay: {
        layout: 'diptych',
        photos: [
          ph('poppies-korea', '一片红', { camera: '示例手机', focal: '24mm', aperture: 'f/1.8', shutter: '1/800s', iso: '50' }),
          ph('poppy-edge', '一朵红', { camera: '示例手机', focal: '77mm', aperture: 'f/2.8', shutter: '1/640s', iso: '64' }, { thought: '和左边那张配对：先给整体，再给细节。' }),
          ph('sunflowers', '向日葵，暖', { camera: '示例手机', focal: '26mm', aperture: 'f/1.8', shutter: '1/1000s', iso: '50' }),
          ph('iris', '鸢尾，冷', { camera: '示例手机', focal: '50mm', aperture: 'f/2', shutter: '1/250s', iso: '100' }, { light: '阴天散射光' }),
        ],
      },
    },
    {
      ...base, kind: 'essay', slug: 'demo-essay-mountains', title: '示例影集：山与湖的网格', category: '摄影', tags: ['影集', '示例', '风光'],
      summary: '网格版式：一屏看完一组照片，点任意一张放大或进入故事模式。',
      coverUrl: photo('himalayas'),
      publishedAt: t('2026-09-05T09:00:00+08:00'), createdAt: t('2026-09-05T08:00:00+08:00'), updatedAt: t('2026-09-05T09:00:00+08:00'),
      contentMd: `${note}\n\n网格适合一组主题相同、彼此独立的照片。`,
      notes: null,
      essay: {
        layout: 'grid',
        photos: [
          ph('himalayas', '雪山', { focal: '70mm', aperture: 'f/8', shutter: '1/500s', iso: '100' }),
          ph('montriond-lake', '山间的湖', { focal: '24mm', aperture: 'f/8', shutter: '1/250s', iso: '100' }),
          ph('panixersee', '高山湖', { focal: '16mm', aperture: 'f/11', shutter: '1/200s', iso: '100' }),
          ph('snina-winter', '冬天的山谷', { focal: '35mm', aperture: 'f/5.6', shutter: '1/400s', iso: '200' }),
          ph('forest-road', '林间小路', { focal: '35mm', aperture: 'f/4', shutter: '1/125s', iso: '400' }),
          ph('hero-lake', '湖边日出', { focal: '24mm', aperture: 'f/11', shutter: '1/60s', iso: '100' }),
        ],
      },
    },
    {
      ...base, kind: 'post', slug: 'demo-embeds', title: '示例：正文嵌入块一览', category: '技术', tags: ['写作', '示例', 'Markdown'],
      summary: '提示框、折叠块、调色前后对比滑块、交给音乐播放器的音频、粗略地图标记、可以生成图片的引用卡片、拍摄手记——都用一行 ::: 写出来。',
      coverUrl: photo('harbour-castle'),
      publishedAt: t('2026-09-04T09:00:00+08:00'), createdAt: t('2026-09-04T08:00:00+08:00'), updatedAt: t('2026-09-04T09:00:00+08:00'),
      notes: null,
      contentMd: `> 示例文章：演示每一种嵌入块的写法和效果。图片来自 Wikimedia Commons（CC0），音频来自 Internet Archive（CC BY-NC-SA 4.0）。

## 提示框

:::tip 拍夜景的小技巧
手机靠在栏杆或墙上，比任何防抖都稳。
:::

:::warn 注意
发布前确认照片里没有别人的车牌和门牌号。
:::

:::note
备注框适合放补充说明，不打断正文。
:::

## 折叠块

:::details 展开看：我的导出设置
- 长边 2560 px，sRGB
- 质量 82，去掉全部 EXIF（博客上传时也会自动去掉）
:::

## 调色前后

拖动中间的把手（或用键盘左右键）对比：

:::compare 降低对比度的“原片”与调色后的成片
![调色前：灰、平](${photo('harbour-castle-flat')} "调色前")
![调色后：通透](${photo('harbour-castle')} "调色后")
:::

## 音频

点「播放」交给左下角的音乐播放器，不会自动播放：

:::audio
src: ${track}
title: Clouds in the Shape of Clouds
artist: Ross Baker
credit: Internet Archive · CC BY-NC-SA 4.0
link: https://archive.org/details/NS050
:::

## 地图标记

只保存约 11 km 精度的坐标：

:::map 桂林 · 漓江
25.27, 110.29
:::

## 引用卡片

:::quote 王维《终南别业》 | https://zh.wikisource.org/wiki/%E7%B5%82%E5%8D%97%E5%88%A5%E6%A5%AD
行到水穷处，坐看云起时。
:::

## 拍摄手记

:::notes 这张港口照片（示意）
地点: 港口（示例）
光线: 清晨顺光
器材: 手机主摄
参数: f/1.8 · 1/500s · ISO 50
想法: 城堡在阴影里，等太阳再高一点就会亮起来。
:::

图片署名：Jebulon / Wikimedia Commons / CC0（“调色前”是为了演示而降低了对比度和饱和度的版本）。`,
    },
  ];
}

/**
 * 测试 / E2E 夹具：在种子数据后面追加 n 篇更早的文章（2018 年起），一半共享同一个发布时间，
 * 用来证明第 101 篇以后的文章能被分页、归档、预渲染、sitemap 拿到。正式演示站不启用（n = 0）。
 */
export function withFixturePosts(db: DemoDb, n: number): DemoDb {
  if (!(n > 0)) return db;
  const start = db.nextId;
  for (let k = 1; k <= n; k++) {
    const t = k % 2 === 0 ? '2018-06-01T00:00:00.000Z' : new Date(Date.UTC(2018, 0, 1) + k * 3_600_000).toISOString();
    const contentMd = `夹具文章 ${k} 的正文。`;
    db.posts.push({
      id: start + k - 1,
      slug: `fixture-${String(k).padStart(3, '0')}`,
      title: `夹具文章 ${k}`,
      summary: `分页夹具 #${k}`,
      contentMd,
      tags: ['夹具'],
      coverUrl: null,
      category: '夹具',
      series: null,
      kind: 'post',
      essay: null,
      notes: null,
      pinned: false,
      wordCount: contentMd.replace(/[\s#*`]/g, '').length,
      status: 'published',
      publishedAt: t,
      createdAt: t,
      updatedAt: t,
    });
  }
  db.nextId = start + n;
  return db;
}
