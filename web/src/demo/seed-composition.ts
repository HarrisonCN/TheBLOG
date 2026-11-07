/**
 * L47 / v1.47.0 构图辅助线演示数据：说明文字是虚构的示例分析；照片是站内已有的示例照片
 * （Wikimedia Commons 开放授权，署名见 demo-assets/photos/credits.json）。
 */
import type { Item } from '../composition-core';
import type { State } from './mock-composition';

export function seed(base = '/'): State {
  const b = `${base.endsWith('/') ? base : `${base}/`}demo/photos/`;
  const img = (name: string, h: number, alt: string) => ({ src: `${b}${name}-1280.webp`, alt, w: 1280, h });
  const items: Item[] = [
    {
      slug: 'harbour-castle-thirds',
      title: '示例：港口城堡与三分线',
      summary: '城堡放在右上三分交点附近，水面占下方三分之二。',
      photo: img('harbour-castle', 781, '海港边的城堡，前景是平静的水面和停泊的小船'),
      guides: ['thirds', 'golden'],
      points: [
        { x: 0.68, y: 0.36, label: '城堡' },
        { x: 0.3, y: 0.7, label: '小船' },
      ],
      notes: [
        '城堡没有放在正中，而是靠近右上的三分交点，画面左边留给天空和水面，视线会从左往右走到城堡。',
        '地平线压在上三分线附近，水面占了更多面积，倒影和小船成了前景。',
        '打开黄金分割线可以看到，两种线在这张照片里相差不大：城堡同样落在交点附近。',
      ],
      date: '2026-10-15',
      status: 'published',
    },
    {
      slug: 'forest-road-diagonal',
      title: '示例：林间小路的对角线',
      summary: '小路从左下角斜着伸进画面，把视线带到远处。',
      photo: img('forest-road', 853, '林间的一条小路，两侧树木在路面投下斑驳的光影'),
      guides: ['diagonal', 'thirds'],
      points: [{ x: 0.52, y: 0.5, label: '路的尽头' }],
      notes: ['路面边缘大致沿着对角线，从左下角延伸到画面中心，是典型的引导线。', '路的尽头几乎就在画面中心：这里对角线比三分线更能解释这张照片。'],
      date: '2026-10-11',
      status: 'published',
    },
    {
      slug: 'draft-composition',
      title: '草稿构图（不公开）',
      summary: '还没写完。',
      photo: img('iris', 871, '一朵紫色鸢尾花'),
      guides: ['golden'],
      points: [],
      notes: ['草稿。'],
      date: '2026-10-16',
      status: 'draft',
    },
  ];
  return { items };
}
