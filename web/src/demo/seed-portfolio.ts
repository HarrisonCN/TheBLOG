/**
 * L50 / v1.50.0 毕业作品集演示数据：作者、作品名和自述全部虚构；照片是站内已有的示例照片
 * （Wikimedia Commons 开放授权，署名见 demo-assets/photos/credits.json），并非作者本人作品。
 */
import type { Item } from '../portfolio-core';
import type { State } from './mock-portfolio';

export function seed(base = '/'): State {
  const b = `${base.endsWith('/') ? base : `${base}/`}demo/photos/`;
  const img = (name: string, h: number, alt: string) => ({ src: `${b}${name}-1280.webp`, alt, w: 1280, h });
  const items: Item[] = [
    {
      slug: 'commute-three-years',
      title: '示例：通勤的三年',
      author: '林夏（虚构）',
      fictional: true,
      year: 2026,
      statement: [
        '这是一位虚构的摄影专业学生的毕业作品集：三年里每天往返学校和住处，路上大约四十分钟。',
        '作品按一天的时间排序，从清晨的街道到深夜的江边。每一张都在同一条通勤路线上拍摄，大部分用手机完成。',
        '我想拍的不是风景，而是「每天都会经过、但从来没有停下来看」的地方。',
      ],
      works: [
        { n: 1, title: '清晨的三轮车', year: 2024, medium: '微喷', size: '40 × 30 cm', photo: img('street-tricycle', 960, '清晨街边停着一辆三轮车') },
        { n: 2, title: '林间近路', year: 2024, medium: '微喷', size: '40 × 27 cm', photo: img('forest-road', 853, '林间的一条小路，两侧树木在路面投下斑驳的光影'), note: '下雨天会改走这条路。' },
        { n: 3, title: '雪后', year: 2025, medium: '微喷', size: '40 × 27 cm', photo: img('snina-winter', 853, '雪后的小镇，屋顶和街道都覆盖着白雪') },
        { n: 4, title: '傍晚的海', year: 2025, medium: '微喷', size: '60 × 40 cm', photo: img('baltic-view', 850, '傍晚的海边，远处海天相接') },
        { n: 5, title: '回程的渡口', year: 2026, medium: '微喷', size: '60 × 35 cm', photo: img('harbour-night', 748, '夜晚的港口，灯光倒映在水面上') },
        { n: 6, title: '最后一班', year: 2026, medium: '微喷', size: '60 × 30 cm', photo: img('pudong-night', 640, '夜晚的城市天际线，高楼灯火倒映在江面上'), note: '序列的最后一张，也是最晚的一张。' },
      ],
      date: '2026-10-16',
      status: 'published',
    },
    {
      slug: 'small-flowers',
      title: '示例：小花',
      author: '周禾（虚构）',
      fictional: true,
      year: 2026,
      statement: ['三张近距离拍摄的花，练习用浅景深把背景变成颜色。'],
      works: [
        { n: 1, title: '鸢尾', year: 2026, medium: '数字文件', photo: img('iris', 871, '一朵紫色鸢尾花，背景虚化成柔和的绿色') },
        { n: 2, title: '罂粟的边缘', year: 2026, medium: '数字文件', photo: img('poppy-edge', 960, '一朵红色罂粟花的花瓣边缘特写') },
        { n: 3, title: '田边旋花', year: 2026, medium: '数字文件', photo: img('field-bindweed', 1010, '田边的旋花，粉白色的花朵贴着地面开放') },
      ],
      date: '2026-10-12',
      status: 'published',
    },
    {
      slug: 'draft-portfolio',
      title: '草稿作品集（不公开）',
      author: '某人（虚构）',
      fictional: true,
      year: 2027,
      statement: ['草稿。'],
      works: [
        { n: 1, title: '一', year: 2026, medium: '草稿', photo: img('sunflowers', 852, '一片向日葵') },
        { n: 2, title: '二', year: 2026, medium: '草稿', photo: img('himalayas', 854, '雪山') },
        { n: 3, title: '三', year: 2026, medium: '草稿', photo: img('panixersee', 880, '高山湖泊') },
      ],
      date: '2026-10-17',
      status: 'draft',
    },
  ];
  return { items };
}
