/**
 * L41 / v1.41.0 作品点评演示数据：点评人和点评内容都是虚构的示例；作品图是站内已有的示例照片
 * （Wikimedia Commons 开放授权，署名见 demo-assets/photos/credits.json）。
 */
import type { Item } from '../critique-core';
import type { State } from './mock-critique';

export function seed(base = '/'): State {
  const b = `${base.endsWith('/') ? base : `${base}/`}demo/photos/`;
  const s = (composition: number, light: number, color: number, story: number) => ({ composition, light, color, story });
  const items: Item[] = [
    {
      slug: 'harbour-castle',
      title: '示例：港口古堡',
      summary: '午后的小港口，石砌的小城堡和渔船。',
      image: { src: `${b}harbour-castle-1280.webp`, alt: '小港口里一座石砌的小城堡，前面停着渔船', w: 1280, h: 781 },
      ask: '主体是不是太居中？船和城堡哪一个应该更突出？',
      date: '2026-10-16',
      status: 'published',
      reviews: [
        { by: '示例点评人 A', scores: s(3, 4, 4, 3), comment: '城堡放在正中让画面很稳，但也有点平。试着往右走两步，让城堡落在右三分线上，左边留给船。' },
        { by: '示例点评人 B', scores: s(4, 4, 3, 3), comment: '光线方向很好，石墙的纹理出来了。水面颜色略偏青，可以稍微加一点暖。' },
        { by: '示例点评人 C', scores: s(3, 5, 4, 4), comment: '如果等一艘船进港，故事感会强很多。' },
      ],
    },
    {
      slug: 'forest-road',
      title: '示例：林间小路',
      summary: '一条穿过森林的笔直小路。',
      image: { src: `${b}forest-road-1280.webp`, alt: '穿过森林的一条笔直小路', w: 1280, h: 853 },
      date: '2026-10-12',
      status: 'published',
      reviews: [
        { by: '示例点评人 A', scores: s(5, 3, 3, 3), comment: '引导线非常干净，消失点的位置也对。光比较平，清晨或傍晚再来一次。' },
        { by: '示例点评人 D', scores: s(4, 3, 4, 2), comment: '画面里缺一个尺度参照，路上有个人会更好。' },
      ],
    },
    {
      slug: 'draft-critique',
      title: '示例：草稿点评',
      summary: '还没整理完。',
      image: { src: `${b}iris-1280.webp`, alt: '一朵花菖蒲的特写', w: 1280, h: 871 },
      date: '2026-10-17',
      status: 'draft',
      reviews: [],
    },
  ];
  return { items };
}
