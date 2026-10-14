/**
 * 扩展栏目的示例数据（演示站 / 新站点的起点）。全部可以在后台「栏目」里改成自己的。
 * 作品集用的是 Wikimedia Commons 上的自由授权照片做占位（保留署名），EXIF 为示意参数。
 */
import type { SectionMap, Work } from '../sections';

type CreditMap = Record<string, { author: string; license: string; source: string; width: number; height: number }>;

export function createSectionSeed(photo: (key: string) => string, credits: CreditMap): SectionMap {
  const work = (key: string, w: Omit<Work, 'url' | 'credit' | 'creditUrl' | 'width' | 'height' | 'id'>): Work => {
    const c = credits[key];
    return { id: key, url: photo(key), credit: c ? `${c.author} · ${c.license}` : '', creditUrl: c?.source ?? '', width: c?.width ?? 0, height: c?.height ?? 0, ...w };
  };
  return {
    now: [
      { kind: 'doing', title: '给博客加新栏目', detail: '此刻、作品集、器材、书影音、时间线、更新日志和开源项目页。', url: '/changelog/', progress: 80, since: '2026-10' },
      { kind: 'doing', title: '相机 App 的流畅度优化', detail: '在自己的手机上逐个场景测帧率，把取景、切镜头和拍照后的预览做顺。', url: '', progress: 45, since: '2026-10' },
      { kind: 'learning', title: 'WebGPU 与 compute shader', detail: '给 Motionary 的粒子效果做 GPU 版本，顺便补图形学基础。', url: 'https://www.w3.org/TR/webgpu/', progress: 35, since: '2026-09' },
      { kind: 'reading', title: '《论摄影》', detail: '苏珊·桑塔格。每天睡前读一小节。', url: '', progress: 40, since: '2026-09' },
      { kind: 'listening', title: 'Random Access Memories', detail: 'Daft Punk。修图时的固定歌单。', url: '', progress: 0, since: '2026-08' },
      { kind: 'watching', title: '《完美的日子》', detail: '维姆·文德斯。想学它看光的方式。', url: '', progress: 0, since: '2026-10' },
      { kind: 'playing', title: 'Counter-Strike 2', detail: '周末和朋友打几把，主要负责道具。', url: '', progress: 0, since: '2024' },
    ],
    works: [
      work('hero-lake', { title: '日出前的湖', series: '山与湖', date: '2026-09-02', location: '新西兰 · 卡胡朗伊', camera: '示例机身', lens: '16-35mm F4', focal: '16mm', aperture: 'f/8', shutter: '1/60s', iso: '100', tags: ['风光', '日出'] , geo: 'on', lat: '-41.3', lng: '172.6' }),
      work('guilin-pagodas', { title: '日月双塔', series: '城市夜色', date: '2026-08-21', location: '中国 · 桂林', camera: '示例机身', lens: '24-70mm F2.8', focal: '35mm', aperture: 'f/5.6', shutter: '4s', iso: '100', tags: ['夜景', '倒影'] , geo: 'on', lat: '25.3', lng: '110.3' }),
      work('street-tricycle', { title: '满载的三轮车', series: '街头', date: '2026-04-11', location: '中国 · 上海', camera: '示例机身', lens: '35mm F2', focal: '35mm', aperture: 'f/4', shutter: '1/500s', iso: '400', tags: ['街头', '人文'] , geo: 'off', lat: '31.2', lng: '121.5' }),
      work('forest-road', { title: '雪中的林间小路', series: '黑白', date: '2026-01-15', location: '乌克兰 · 斯拉夫内', camera: '示例机身', lens: '50mm F1.8', focal: '50mm', aperture: 'f/5.6', shutter: '1/200s', iso: '200', tags: ['黑白', '冬天'] }),
      work('pudong-night', { title: '江边的天际线', series: '城市夜色', date: '2026-08-08', location: '中国 · 上海', camera: '示例机身', lens: '24-70mm F2.8', focal: '24mm', aperture: 'f/8', shutter: '2s', iso: '100', tags: ['夜景', '城市'] , geo: 'on', lat: '31.2', lng: '121.5' }),
      work('poppies-korea', { title: '虞美人花田', series: '花与植物', date: '2026-05-20', location: '韩国 · 京畿道', camera: '示例机身', lens: '90mm F2.8 Macro', focal: '90mm', aperture: 'f/2.8', shutter: '1/800s', iso: '100', tags: ['花', '浅景深'] , geo: 'on', lat: '37.4', lng: '127.5' }),
      work('harbour-night', { title: '港湾夜景', series: '城市夜色', date: '2026-07-30', location: '中国 · 香港', camera: '示例机身', lens: '24-70mm F2.8', focal: '28mm', aperture: 'f/9', shutter: '8s', iso: '100', tags: ['夜景', '长曝光'] , geo: 'on', lat: '22.3', lng: '114.2' }),
      work('porto-covo', { title: '冲浪的人', series: '海岸线', date: '2026-07-04', location: '葡萄牙 · 波尔图科武', camera: '示例机身', lens: '70-200mm F4', focal: '135mm', aperture: 'f/5.6', shutter: '1/1600s', iso: '200', tags: ['海', '运动'] , geo: 'on', lat: '37.9', lng: '-8.8' }),
      work('snina-winter', { title: '雾凇覆盖的山脊', series: '山与湖', date: '2026-01-28', location: '斯洛伐克 · 斯尼纳', camera: '示例机身', lens: '24-70mm F2.8', focal: '50mm', aperture: 'f/8', shutter: '1/250s', iso: '100', tags: ['风光', '冬天'] , geo: 'on', lat: '49', lng: '22.2' }),
      work('iris', { title: '花菖蒲', series: '花与植物', date: '2026-06-03', location: '日本', camera: '示例机身', lens: '90mm F2.8 Macro', focal: '90mm', aperture: 'f/4', shutter: '1/320s', iso: '200', tags: ['花', '微距'] , geo: 'on', lat: '35.7', lng: '139.7' }),
      work('palm-sunset', { title: '三棵棕榈树', series: '海岸线', date: '2026-07-12', location: '塞浦路斯', camera: '示例机身', lens: '24-70mm F2.8', focal: '50mm', aperture: 'f/11', shutter: '1/125s', iso: '100', tags: ['日落', '剪影'] , geo: 'on', lat: '34.9', lng: '33.6' }),
      work('himalayas', { title: '雪线之上', series: '山与湖', date: '2025-11-02', location: '尼泊尔 · 喜马拉雅', camera: '示例机身', lens: '70-200mm F4', focal: '200mm', aperture: 'f/8', shutter: '1/1000s', iso: '100', tags: ['风光', '雪山'] , geo: 'on', lat: '28', lng: '86.9' }),
    ],
    gear: [
      { name: '轻便全画幅微单', brand: '示例', category: '相机', note: '扫街和旅行的主力，机身小到可以塞进外套口袋。', rating: 5, since: '2025-09', url: '' },
      { name: '35mm F2 定焦', brand: '示例', category: '镜头', note: '一机一镜的首选，接近人眼的视角，最能逼自己走近一点。', rating: 5, since: '2025-09', url: '' },
      { name: '24-70mm F2.8 变焦', brand: '示例', category: '镜头', note: '旅行时的保险镜头，夜景也够用。', rating: 4, since: '2026-03', url: '' },
      { name: '90mm F2.8 微距', brand: '示例', category: '镜头', note: '拍花和小物件，顺便当中长焦人像。', rating: 4, since: '2026-05', url: '' },
      { name: '影像旗舰手机', brand: '示例', category: '手机', note: '日常记录 + 系统内测机，长焦和夜景已经能替代很多场景。', rating: 5, since: '2025-11', url: '' },
      { name: '碳纤维旅行三脚架', brand: '示例', category: '配件', note: '长曝光夜景必带，收起来只有 40cm。', rating: 4, since: '2026-02', url: '' },
      { name: '可变 ND 滤镜', brand: '示例', category: '配件', note: '白天拍丝绢流水和慢门人流。', rating: 3, since: '2026-04', url: '' },
      { name: '14 寸轻薄笔记本', brand: '示例', category: '电脑与外设', note: '修图 + 写代码，带一块校色过的外接屏。', rating: 4, since: '2025-08', url: '' },
      { name: '机械键盘（静音轴）', brand: '示例', category: '电脑与外设', note: '宿舍夜里写代码不吵人。', rating: 4, since: '2025-10', url: '' },
      { name: 'Lightroom Classic', brand: 'Adobe', category: '软件', note: '整理和调色的主力，配合自己的三套预设。', rating: 5, since: '2024-09', url: 'https://www.adobe.com/products/photoshop-lightroom-classic.html' },
      { name: 'VS Code', brand: 'Microsoft', category: '软件', note: '写博客、写 Motionary 都在这里。', rating: 5, since: '2023-09', url: 'https://code.visualstudio.com/' },
      { name: 'Figma', brand: 'Figma', category: '软件', note: '做动效原型和 App 界面。', rating: 4, since: '2025-03', url: 'https://www.figma.com/' },
    ],
    shelf: [
      { kind: 'book', title: '论摄影', creator: '苏珊·桑塔格', year: '1977', status: 'doing', rating: 0, note: '关于“观看”的伦理，读得很慢。', url: '' },
      { kind: 'book', title: '明室', creator: '罗兰·巴特', year: '1980', status: 'done', rating: 5, note: '“刺点”这个词改变了我选片的方式。', quote: '【演示摘录】一张照片里真正打动人的，往往是拍摄者没有安排的那个小细节。', url: '', cover: photo('cover-camera-lucida').replace(/-1280\.webp$/, '.webp'), date: '2026-08' },
      { kind: 'book', title: '设计心理学', creator: '唐纳德·诺曼', year: '1988', status: 'done', rating: 4, note: '做体验测试前必读，示能和反馈讲得很透。', quote: '【演示摘录】用户找不到按钮，不是用户的错，是设计没有把“能做什么”说清楚。', url: '', date: '2025-11' },
      { kind: 'book', title: '写给大家看的设计书', creator: 'Robin Williams', year: '1994', status: 'done', rating: 4, note: '对齐、对比、重复、亲密性，排版入门。', url: '', date: '2025-06' },
      { kind: 'book', title: '摄影师之眼', creator: 'Michael Freeman', year: '2007', status: 'want', rating: 0, note: '', url: '' },
      { kind: 'movie', title: '完美的日子', creator: '维姆·文德斯', year: '2023', status: 'doing', rating: 0, note: '树影（komorebi）拍得太好了。', url: '' },
      { kind: 'movie', title: '花样年华', creator: '王家卫', year: '2000', status: 'done', rating: 5, note: '色彩和构图可以逐帧学习。', quote: '【演示摘录】走廊、楼梯和雨，都是这部电影里会说话的东西。', url: '', cover: photo('cover-mood-for-love').replace(/-1280\.webp$/, '.webp'), date: '2026-09' },
      { kind: 'movie', title: '寻梦环游记', creator: 'Lee Unkrich', year: '2017', status: 'done', rating: 5, note: '灯光设计是动效课的好教材。', url: '', date: '2026-02' },
      { kind: 'movie', title: '沙丘 2', creator: '丹尼斯·维伦纽瓦', year: '2024', status: 'want', rating: 0, note: '', url: '' },
      { kind: 'music', title: 'Random Access Memories', creator: 'Daft Punk', year: '2013', status: 'doing', rating: 5, note: '修图专用。', url: '' },
      { kind: 'music', title: '范特西', creator: '周杰伦', year: '2001', status: 'done', rating: 5, note: '', url: '', date: '2026-05' },
      { kind: 'music', title: 'In Rainbows', creator: 'Radiohead', year: '2007', status: 'done', rating: 4, note: '', url: '', date: '2025-12' },
      { kind: 'game', title: 'Counter-Strike 2', creator: 'Valve', year: '2023', status: 'doing', rating: 4, note: '道具位练了一整个暑假。', url: '' },
      { kind: 'game', title: '双人成行', creator: 'Hazelight', year: '2021', status: 'done', rating: 5, note: '和朋友一起通关，每一关都是新玩法。', url: '' },
      { kind: 'game', title: '塞尔达传说：王国之泪', creator: 'Nintendo', year: '2023', status: 'want', rating: 0, note: '', url: '' },
    ],
    timeline: [
      { date: '2026-10', kind: 'project', title: '博客上线新版', detail: '便当网格 + 玻璃瓷砖，前台和后台全部重做，加入好朋友、便利贴墙和信箱。', url: '/changelog/' },
      { date: '2026-10', kind: 'project', title: 'Motionary 11.0 正式版', detail: '组件、动效核心与运行时三层架构稳定下来，这个博客的动画都来自它。', url: 'https://github.com/HarrisonCN/Motionary' },
      { date: '2026-10', kind: 'project', title: 'mcp-gateway 13.0', detail: '模块化内核：功能模块按需加载，没配置的功能不占内存。', url: 'https://github.com/HarrisonCN/mcp-gateway' },
      { date: '2026-10', kind: 'project', title: '开始做一款相机 App', detail: '目标是像系统相机一样顺手：真实焦段切换、全像素拍摄。', url: '' },
      { date: '2026-08', kind: 'work', title: '互联网产品体验实习', detail: '做系统与应用的体验走查，把感受整理成可执行的问题清单。', url: '/posts/product-testing-checklist/' },
      { date: '2025-08', kind: 'life', title: '参加手机品牌的校园夏令营', detail: '第一次和产品经理面对面聊用户反馈是怎么被处理的。', url: '' },
      { date: '2025-03', kind: 'study', title: '参与手机系统公测', detail: '开始系统地写体验反馈：复现步骤、预期与实际、截图和录屏。', url: '/posts/coloros-beta-notes/' },
      { date: '2024-09', kind: 'study', title: '开始学前端', detail: '从一个滚动动画小库开始，后来长成了 Motionary。', url: '' },
      { date: '2023-09', kind: 'study', title: '进入摄影专业', detail: '第一次系统学习曝光、构图和暗房，也开始扫街。', url: '' },
    ],
    changelog: [
      { version: 'v0.5', date: '2026-10-10', type: 'feature', title: '新栏目：此刻、作品集、器材、书影音、时间线、开源、数据与订阅', items: ['作品集：灯箱大图 + EXIF 参数 + 按系列筛选', '开源项目：从 GitHub 实时读取星标，失败时显示快照', '书影音：按类型和状态筛选', '全站搜索页、写作热力图与数据统计', 'RSS / JSON Feed 订阅', '后台新增「栏目」分组，所有新栏目都能在线编辑'] },
      { version: '第 41 周', date: '2026-10-09', type: 'weekly', title: '周报：后台重做与社区功能', items: ['后台换成和前台一致的便当风格', '好朋友徽章：珍珠母贝和拉丝金属两种材质', '节日横幅改用 SVG 图标，避免方块字'] },
      { version: 'v0.4', date: '2026-10-09', type: 'feature', title: '后台重做 + 社区模块', items: ['仪表盘、文章表格（搜索 / 筛选 / 置顶）、实时预览编辑器', '邮箱验证码注册「好朋友」，可选 Google 登录', '便利贴举报自动隐藏，等站长复核'] },
      { version: 'v0.3.1', date: '2026-10-09', type: 'fix', title: '小修复', items: ['徽章编号的输入校验在新版浏览器里报错', '节日图标在没有彩色 emoji 字体的系统上显示方块'] },
      { version: 'v0.3', date: '2026-10-09', type: 'improve', title: '便当网格首页', items: ['首页改成不同尺寸的玻璃瓷砖', '整页流体色块背景，跟随深浅色', '拉绳切换深浅色、底部 Dock'] },
      { version: 'v0.2', date: '2026-10-09', type: 'feature', title: '第一次大改版', items: ['全屏首图 + 打字机副标题', '归档时间线、标签、分类、画廊、留言板'] },
      { version: 'v0.1', date: '2026-10-08', type: 'feature', title: '博客诞生', items: ['静态前端 + Cloudflare Worker（D1 / R2）', '自带 MCP 端点，AI 助手可以帮忙起草文章'] },
    ],
    repos: [
      { owner: 'HarrisonCN', repo: 'Motionary', title: 'Motionary', description: '零依赖动效库：滚动动画、Web Components、特效与运行时（WebGL / 物理 / Lottie）。这个博客的所有动画都来自它。', language: 'TypeScript', stars: 1, forks: 0, url: 'https://github.com/HarrisonCN/Motionary', status: 'active', topics: ['animation', 'web-components', 'motion'] },
      { owner: 'HarrisonCN', repo: 'mcp-gateway', title: 'mcp-gateway', description: '轻量、可自行托管的 MCP 网关：路由、鉴权、限流和监控多个 MCP 服务器。', language: 'TypeScript', stars: 1, forks: 0, url: 'https://github.com/HarrisonCN/mcp-gateway', status: 'active', topics: ['mcp', 'gateway', 'ai'] },
      { owner: 'HarrisonCN', repo: 'aicli', title: 'aicli', description: '住在终端里的开源 AI 助手：理解你的项目，帮你改代码、跑命令。', language: 'TypeScript', stars: 1, forks: 0, url: 'https://github.com/HarrisonCN/aicli', status: 'active', topics: ['cli', 'ai', 'agent'] },
      { owner: 'HarrisonCN', repo: 'Mineradio-ONE', title: 'Mineradio ONE', description: '以电影镜头、粒子视觉和歌词舞台为核心的沉浸式音乐播放器。', language: 'HTML', stars: 0, forks: 0, url: 'https://github.com/HarrisonCN/Mineradio-ONE', status: 'wip', topics: ['music', 'electron'] },
      { owner: 'HarrisonCN', repo: 'personal-blog-template', title: 'personal-blog-template', description: '可以直接套用的个人博客模板。', language: 'JavaScript', stars: 0, forks: 0, url: 'https://github.com/HarrisonCN/personal-blog-template', status: 'archived', topics: ['blog', 'template'] },
      { owner: '', repo: '', title: 'Aura', description: '智能家居风格的安卓 App：呼吸 logo 开屏、共享元素转场、液态玻璃导航条。', language: 'Kotlin', stars: 0, forks: 0, url: '', status: 'private', topics: ['android', 'compose', 'motion'] },
      { owner: '', repo: '', title: 'Lumen 相机', description: '像系统相机一样顺手的安卓相机：真实焦段切换、全像素拍摄。', language: 'Kotlin', stars: 0, forks: 0, url: '', status: 'private', topics: ['android', 'camerax'] },
    ],
  };
}
