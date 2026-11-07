/**
 * L44 / v1.44.0 摄影人访谈演示数据：受访者、问题和回答全部虚构（不对应真实人物）；
 * 配图是站内已有的示例照片（Wikimedia Commons 开放授权，署名见 demo-assets/photos/credits.json），不是受访者肖像。
 */
import type { Item } from '../interview-core';
import type { State } from './mock-interviews';

export function seed(base = '/'): State {
  const b = `${base.endsWith('/') ? base : `${base}/`}demo/photos/`;
  const img = (name: string, h: number, alt: string) => ({ src: `${b}${name}-1280.webp`, alt, w: 1280, h });
  const items: Item[] = [
    {
      slug: 'night-ferry',
      title: '示例：在渡轮上拍了三年夜景',
      summary: '一位虚构的夜景爱好者，聊每天下班坐渡轮时练出来的手持夜拍。',
      person: { name: '阿遥（虚构）', role: '业余夜景摄影', bio: '虚构人物：白天做会计，下班坐二十分钟渡轮回家，三年里在船上拍了两千多张夜景。', fictional: true },
      cover: img('harbour-night', 748, '夜晚的港口，灯光倒映在水面上'),
      qa: [
        { id: 'start', q: '为什么会在渡轮上拍照？', a: ['一开始只是无聊。船开出去那二十分钟，手机没信号，只能看窗外。', '后来发现每天的光都不一样，雾天、雨天、月亮很亮的晚上，同一片岸线完全是不同的照片。'] },
        { id: 'handheld', q: '船一直在晃，怎么拍清楚？', a: ['把相机贴着栏杆，呼气的时候按快门，再连拍三张挑最稳的一张。', '快门不慢于 1/30 秒，感光度宁可高一点。噪点可以接受，糊了就什么都没有了。'] },
        { id: 'habit', q: '三年没断过，靠什么坚持？', a: ['不给自己定目标。每天只要拍一张就算数，哪怕是一张很普通的。', '翻回去看第一年的照片，会发现自己真的在变。'] },
        { id: 'advice', q: '给刚开始拍夜景的人一句建议？', a: ['先找一个你每天都会经过的地方，把它拍一百遍。'] },
      ],
      quotes: ['噪点可以接受，糊了就什么都没有了。', '先找一个你每天都会经过的地方，把它拍一百遍。'],
      date: '2026-10-16',
      status: 'published',
    },
    {
      slug: 'field-flowers',
      title: '示例：只拍路边的野花',
      summary: '一位虚构的退休老师，讲她怎么用一支旧微距镜头拍小区里的野花。',
      person: { name: '周老师（虚构）', role: '退休教师 · 微距爱好者', bio: '虚构人物：退休后开始拍小区绿化带里的野花，给每一种都做了一张卡片。', fictional: true },
      cover: img('field-bindweed', 1010, '田边的旋花，粉白色的花朵贴着地面开放'),
      qa: [
        { id: 'why', q: '为什么只拍野花？', a: ['名贵的花有人拍，路边的花没人看。我想让它们也被看见一次。'] },
        { id: 'gear', q: '用什么器材？', a: ['一台用了十年的相机和一支二手微距镜头，再加一块白色泡沫板当反光板。', '风大的时候用一个晾衣夹把花茎轻轻固定住，拍完就松开。'] },
        { id: 'learn', q: '拍了以后学到了什么？', a: ['认识了四十多种以前叫不出名字的植物。拍照让我走得更慢了。'] },
      ],
      quotes: ['拍照让我走得更慢了。'],
      date: '2026-10-12',
      status: 'published',
    },
    {
      slug: 'draft-interview',
      title: '示例：草稿访谈',
      summary: '还在整理。',
      person: { name: '待定（虚构）', role: '待定', bio: '虚构人物，草稿。', fictional: true },
      qa: [
        { id: 'a', q: '问题一', a: ['回答一'] },
        { id: 'b', q: '问题二', a: ['回答二'] },
      ],
      quotes: [],
      date: '2026-10-17',
      status: 'draft',
    },
  ];
  return { items };
}
