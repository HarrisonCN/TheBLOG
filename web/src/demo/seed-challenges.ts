/**
 * L45 / v1.45.0 52 周挑战演示数据：主题与提示均为虚构示例；配图是站内已有的示例照片
 * （Wikimedia Commons 开放授权，署名见 demo-assets/photos/credits.json）。
 */
import type { Item } from '../challenge-core';
import type { State } from './mock-challenges';

export function seed(base = '/'): State {
  const b = `${base.endsWith('/') ? base : `${base}/`}demo/photos/`;
  const img = (name: string, h: number, alt: string) => ({ src: `${b}${name}-1280.webp`, alt, w: 1280, h });
  const items: Item[] = [
    {
      slug: 'phone-2026-autumn',
      title: '示例：2026 秋季手机摄影挑战',
      summary: '从第 40 周到第 48 周，每周一个主题，只用手机拍。',
      year: 2026,
      cover: img('pudong-night', 640, '夜晚的城市天际线，高楼灯火倒映在江面上'),
      weeks: [
        { week: 40, theme: '影子', tip: '找一个下午四点的影子，让它成为主角。', link: { href: '/calendar/2026-10/', text: '看这个月的照片日历' } },
        { week: 41, theme: '窗光', tip: '关掉室内灯，只用一扇窗的光。', link: { href: '/colors/', text: '配色研究里的窗光配色' } },
        { week: 42, theme: '红色', tip: '画面里只允许一个红色的东西。' },
        { week: 43, theme: '倒影', tip: '雨后的水洼、橱窗、手机屏幕都可以。' },
        { week: 44, theme: '夜色中的光', tip: '手机贴着栏杆或墙，呼气时按快门。' },
        { week: 45, theme: '从低处看', tip: '把手机放到膝盖以下的高度。' },
        { week: 46, theme: '一个人的街', tip: '等画面里只剩一个人再按快门。' },
        { week: 47, theme: '雾或雨' },
        { week: 48, theme: '黑白', tip: '拍完再转黑白，比较前后哪一张更好。' },
      ],
      date: '2026-10-14',
      status: 'published',
    },
    {
      slug: 'beginner-2027',
      title: '示例：2027 新手六周入门',
      summary: '新年头六周的入门练习：构图、光线、色彩各两周。',
      year: 2027,
      cover: img('forest-road', 853, '林间的一条小路，两侧树木在路面投下斑驳的光影'),
      weeks: [
        { week: 1, theme: '三分法', tip: '打开相机网格线，把主体放在交点上。' },
        { week: 2, theme: '引导线', tip: '用道路、栏杆或河岸把视线带进画面。' },
        { week: 3, theme: '顺光与逆光', tip: '同一个物体，各拍一张顺光和逆光。' },
        { week: 4, theme: '阴天的柔光' },
        { week: 5, theme: '互补色', tip: '找蓝与橙、红与绿同时出现的画面。' },
        { week: 6, theme: '单一色调', tip: '整张照片只用一种颜色的深浅。' },
      ],
      date: '2026-10-10',
      status: 'published',
    },
    {
      slug: 'draft-challenge',
      title: '草稿挑战（不公开）',
      summary: '还没写完的挑战。',
      year: 2027,
      weeks: [
        { week: 10, theme: '草稿一' },
        { week: 11, theme: '草稿二' },
        { week: 12, theme: '草稿三' },
        { week: 13, theme: '草稿四' },
      ],
      date: '2026-10-16',
      status: 'draft',
    },
  ];
  return { items };
}
