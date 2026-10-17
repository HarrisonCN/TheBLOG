/**
 * L37 / v1.37.0 修图前后对比演示数据（虚构的修图案例）。
 * 「修图后」是站内已有的示例照片（Wikimedia Commons 开放授权，署名见 demo-assets/photos/credits.json）；
 * 「原图」是从这些照片反向调出来的演示图（降低对比度和饱和度、加偏色或倾斜），沿用原照片的授权，并不是摄影师的真实原片。
 */
import type { Item } from '../retouch-core';
import type { State } from './mock-retouch';

export function seed(base = '/'): State {
  const b = `${base.endsWith('/') ? base : `${base}/`}demo/photos/`;
  const pair = (name: string, w: number, h: number, beforeAlt: string, afterAlt: string) => ({
    before: { src: `${b}${name}-before-1280.webp`, alt: beforeAlt, w, h },
    after: { src: `${b}${name}-1280.webp`, alt: afterAlt, w, h },
  });
  const items: Item[] = [
    {
      slug: 'sunrise-lake',
      title: '示例：日出湖面',
      summary: '逆光的日出湖面，原片灰、天空发白。主要是拉回对比、找回天空的橙色，再把水面压暗一点。',
      ...pair('hero-lake', 1280, 593, '修图前：灰蒙蒙的湖面和发白的天空，色彩很淡', '修图后：日出时分的高山湖，水面倒映着橙色的天空'),
      steps: [
        { kind: 'exposure', label: '降低高光、提亮阴影', detail: '天空高光 −60，阴影 +25，先把亮部细节找回来。' },
        { kind: 'exposure', label: '增加对比', detail: 'S 形曲线，黑场稍微压低。' },
        { kind: 'color', label: '色温调暖', detail: '从 5200K 调到 6100K，让日出的颜色回来。' },
        { kind: 'local', label: '渐变压暗水面', detail: '下半部分线性渐变 −0.4 档，让视线停在天空和倒影交界处。' },
        { kind: 'grade', label: '轻微去雾和自然饱和度', detail: '去雾 +10，自然饱和度 +15，不动饱和度。' },
      ],
      start: 50,
      credit: '修图后照片：Michal Klajban · CC BY-SA 4.0（Wikimedia Commons）；修图前为演示用的反向调整图。',
      date: '2026-10-16',
      status: 'published',
    },
    {
      slug: 'alley-tricycle',
      title: '示例：街巷三轮车',
      summary: '扫街随手一张，原片歪了两度、偏黄。校正水平、修正白平衡，再用局部提亮把三轮车拉出来。',
      ...pair('street-tricycle', 1280, 960, '修图前：画面略微倾斜、整体偏黄偏暗的街边三轮车', '修图后：街边一辆装满回收纸板的三轮车'),
      steps: [
        { kind: 'crop', label: '校正水平', detail: '以门框为参照转回 2°，裁掉旋转后露出的边角。' },
        { kind: 'color', label: '修正白平衡', detail: '用白色墙面吸管取色，去掉路灯带来的黄色。' },
        { kind: 'exposure', label: '整体提亮 +0.5 档' },
        { kind: 'local', label: '径向滤镜提亮主体', detail: '三轮车 +0.3 档，四周保持不变。' },
        { kind: 'retouch', label: '去掉地上的一个塑料袋' },
      ],
      start: 60,
      credit: '修图后照片：Ermell · CC BY-SA 4.0（Wikimedia Commons）；修图前为演示用的反向调整图。',
      date: '2026-10-14',
      status: 'published',
    },
    {
      slug: 'night-pagodas',
      title: '示例：日月双塔夜景',
      summary: '夜景原片偏蓝、暗部发灰。去掉色偏、压黑场、保住灯光高光。',
      ...pair('guilin-pagodas', 1280, 854, '修图前：偏蓝发灰、暗部不够黑的湖面双塔夜景', '修图后：夜里湖面上两座亮灯的塔和它们的倒影'),
      steps: [
        { kind: 'color', label: '去掉蓝色偏色', detail: '色温 +900K，色调 +6。' },
        { kind: 'exposure', label: '压黑场、保高光', detail: '黑色 −30，白色 −10，避免塔身灯光溢出。' },
        { kind: 'grade', label: '暗部加一点青、亮部加一点暖', detail: '分离色调，平衡 −20。' },
      ],
      start: 50,
      credit: '修图后照片：King of Hearts · CC BY-SA 4.0（Wikimedia Commons）；修图前为演示用的反向调整图。',
      date: '2026-10-11',
      status: 'published',
    },
    {
      slug: 'draft-case',
      title: '示例：草稿案例',
      summary: '还没写完的修图案例，不会公开。',
      ...pair('hero-lake', 1280, 593, '草稿原图', '草稿修图后'),
      steps: [{ kind: 'exposure', label: '待补充' }],
      start: 50,
      date: '2026-10-17',
      status: 'draft',
    },
  ];
  return { items };
}
