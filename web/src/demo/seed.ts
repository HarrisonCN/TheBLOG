/**
 * 演示模式的种子数据：全部为本仓库原创文字与 SVG 插图（MIT，与仓库同协议）。
 * 不包含任何真实账号、密钥或个人隐私信息。
 */
import type { Post, Profile, Settings } from '../types';

export interface DemoDb {
  version: 1;
  nextId: number;
  posts: Post[];
  profile: Profile;
  settings: Settings;
}

/** 演示后台的公开密码（只用于本地演示，不对应任何真实账号）。 */
export const DEMO_PASSWORD = 'demo1234';

const day = (iso: string) => new Date(iso).toISOString();

export function createSeed(base = '/'): DemoDb {
  const b = base.endsWith('/') ? base : `${base}/`;
  const asset = (name: string) => `${b}demo/${name}`;
  const posts: Omit<Post, 'id'>[] = [
    {
      slug: 'welcome',
      title: '欢迎来到我的博客',
      summary: '新博客上线：静态前端 + Cloudflare Worker，还能通过 MCP 让 AI 帮我写文章。这里是它的在线演示版。',
      tags: ['随笔', '建站'],
      coverUrl: null,
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
点右上角的「后台」，用页面上显示的演示密码登录，就可以写文章、改资料、调整首页的展示方式——改动只有你自己能看到，随时可以一键重置。

\`\`\`ts
// 正式版通过 REST 读取文章：
const { posts } = await fetch('/api/posts').then((r) => r.json());
\`\`\`

欢迎常来看看。`,
    },
    {
      slug: 'phone-night-photography',
      title: '用手机拍夜景的五个小习惯',
      summary: '不换设备，只改习惯：稳住、找光、压曝光、等一等、少修一点。',
      tags: ['摄影', '手机摄影'],
      coverUrl: asset('night.svg'),
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

下次出门，试试只带手机，用这五个习惯拍一组。`,
    },
    {
      slug: 'city-walk-notes',
      title: '扫街笔记：在老街区慢慢走',
      summary: '扫街不是收集风景，而是练习观察。记录一次在老街区闲逛时的取景思路。',
      tags: ['摄影', '城市'],
      coverUrl: asset('street.svg'),
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

走完回去翻相册，最喜欢的反而是那张什么都没发生的：空荡荡的巷子，一束光落在台阶上。`,
    },
    {
      slug: 'invisible-motion',
      title: '好的动效应该“看不见”',
      summary: '动效不是装饰，而是解释。写在做 Motionary 的过程中：时长、缓动与克制。',
      tags: ['动效', '前端', '设计'],
      coverUrl: asset('motion.svg'),
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

这个博客首页卡片的入场、标题的逐字出现和文章页的阅读进度条，都是这样做的。你可以在后台「展示设置」里把动效强度调到“强”或“关闭”，对比一下感受。`,
    },
    {
      slug: 'product-testing-checklist',
      title: '做产品体验测试时，我会记下的十件事',
      summary: '参与系统测试和产品体验工作时整理的清单：好的反馈要能复现、能衡量、能被理解。',
      tags: ['产品', '清单'],
      coverUrl: asset('checklist.svg'),
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

如果不能，就再补一句。`,
    },
    {
      slug: 'film-simulation-draft',
      title: '草稿：我的三套胶片模拟参数',
      summary: '还没写完的草稿，演示后台里“草稿”状态的样子。',
      tags: ['摄影', '调色'],
      coverUrl: null,
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
    version: 1,
    nextId: posts.length + 1,
    posts: posts.map((p, i) => ({ id: i + 1, ...p })),
    profile: {
      name: 'Winston',
      tagline: '摄影 · 产品体验 · 动效',
      avatarUrl: asset('avatar.svg'),
      bioMd: `你好，我是 Winston。这里是我的个人博客，记录摄影、产品体验和前端动效的折腾。

- 📷 喜欢用手机和小相机扫街、拍夜景
- 🧪 做过系统与产品的体验测试，习惯把感受写成清单
- ✨ 业余写动效库 Motionary，这个博客的动画都来自它

> 这是演示站点：简介、头像和链接都可以在后台「资料」里修改，改动只保存在你的浏览器里。`,
      location: '中国',
      links: [{ label: 'GitHub', url: 'https://github.com/HarrisonCN' }],
    },
    settings: {
      siteTitle: 'Winston 的博客',
      siteDescription: '摄影、产品与动效笔记',
      theme: 'system',
      sections: { hero: true, featured: true, postList: true, tags: true, about: true },
      featuredSlugs: ['phone-night-photography', 'invisible-motion'],
      animation: 'normal',
      postsPerPage: 10,
    },
  };
}
