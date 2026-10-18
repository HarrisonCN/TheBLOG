/**
 * L43 / v1.43.0 色彩研究演示数据：颜色是用 ImageMagick 对站内示例照片做 6 色量化后取出的（-resize 200x -colors 6），
 * 名字和说明是虚构的示例文字；照片来自 Wikimedia Commons（开放授权，署名见 demo-assets/photos/credits.json）。
 */
import type { Item } from '../color-core';
import type { State } from './mock-colors';

export function seed(base = '/'): State {
  const b = `${base.endsWith('/') ? base : `${base}/`}demo/photos/`;
  const items: Item[] = [
    {
      slug: 'palm-dusk',
      title: '示例：棕榈与暮色',
      summary: '日落时的剪影照片：大面积深棕的暗部，加上几种很接近的暖灰。',
      image: { src: `${b}palm-sunset-1280.webp`, alt: '日落时分剪影般的三棵棕榈树', w: 1280, h: 871 },
      swatches: [
        { hex: '#4d3f2a', name: '剪影棕', role: '树干和前景暗部' },
        { hex: '#8b7f73', name: '暮霭灰', role: '地平线附近的过渡' },
        { hex: '#a69d93', name: '暖灰', role: '天空中段' },
        { hex: '#d9c9b2', name: '砂色', role: '靠近太阳的高光' },
        { hex: '#f4ebe1', name: '象牙白', role: '最亮的天空' },
      ],
      notes: ['暗部和亮部之间几乎没有饱和的颜色，所以剪影显得很安静。', '做文字配色时，剪影棕配象牙白的对比度足够做正文。'],
      date: '2026-10-16',
      status: 'published',
    },
    {
      slug: 'cove-blue',
      title: '示例：海湾的蓝',
      summary: '礁石海岸的一组蓝：从深海蓝到浅天蓝，中间夹着岩石的灰。',
      image: { src: `${b}porto-covo-1280.webp`, alt: '金色悬崖下的礁石和蓝绿色海水', w: 1280, h: 863 },
      swatches: [
        { hex: '#3d6083', name: '深海蓝', role: '远处的海面' },
        { hex: '#557391', name: '海湾蓝', role: '画面主色' },
        { hex: '#7d99c0', name: '天蓝', role: '天空' },
        { hex: '#546071', name: '岩影灰', role: '礁石的阴影' },
        { hex: '#999696', name: '岩石灰', role: '礁石的受光面' },
      ],
      notes: ['几种蓝的亮度很接近，彼此的对比度都不到 3，不适合拿来互相做文字和背景。'],
      date: '2026-10-12',
      status: 'published',
    },
    {
      slug: 'draft-colors',
      title: '示例：草稿配色',
      summary: '还没整理完。',
      image: { src: `${b}snina-winter-1280.webp`, alt: '冬天覆雪的山顶岩石和光秃的树', w: 1280, h: 853 },
      swatches: [{ hex: '#a8aeb5', name: '雪灰' }, { hex: '#5a616e', name: '岩灰' }, { hex: '#2f3a4d', name: '夜蓝' }],
      notes: [],
      date: '2026-10-17',
      status: 'draft',
    },
  ];
  return { items };
}
