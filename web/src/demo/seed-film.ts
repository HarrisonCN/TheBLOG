/**
 * L46 / v1.46.0 胶片记录演示数据：拍摄内容与备注均为虚构示例；片种参数仅作演示（冲洗请以厂商资料为准）。
 * 配图是站内已有的示例照片（Wikimedia Commons 开放授权，署名见 demo-assets/photos/credits.json），不是这卷胶片的扫描。
 */
import type { Item } from '../film-core';
import type { State } from './mock-film';

export function seed(base = '/'): State {
  const b = `${base.endsWith('/') ? base : `${base}/`}demo/photos/`;
  const img = (name: string, h: number, alt: string) => ({ src: `${b}${name}-1280.webp`, alt, w: 1280, h });
  const items: Item[] = [
    {
      slug: 'hp5-night-push',
      title: '示例：黑白负片推两档拍夜街',
      summary: '标称 400 的黑白负片按 EI 1600 拍了一卷夜里的街道，延长显影。',
      stock: { name: 'HP5 Plus 400', iso: 400, format: '135', p: 1.31 },
      ei: 1600,
      process: 'BW',
      developer: 'ID-11 原液 20°C',
      baseMinutes: 7.5,
      cover: img('street-tricycle', 960, '街边停着一辆三轮车，路灯把墙面照亮'),
      frames: [
        { n: 1, subject: '巷口的路灯', shutter: '1/30', aperture: 2 },
        { n: 2, subject: '夜市摊位', shutter: '1/60', aperture: 2.8, note: '手持，靠着电线杆' },
        { n: 3, subject: '桥下的倒影', shutter: '4s', aperture: 8, note: '三脚架' },
        { n: 4, subject: '空无一人的车站', shutter: '15s', aperture: 11, note: '三脚架，快门线' },
        { n: 5, subject: '便利店门口', shutter: '1/125', aperture: 2.8 },
      ],
      date: '2026-10-15',
      status: 'published',
    },
    {
      slug: 'portra-pull-beach',
      title: '示例：彩色负片拉一档拍海边',
      summary: '中画幅彩色负片按 EI 200 拍阳光很强的海边，缩短显影换柔和的高光。',
      stock: { name: 'Portra 400', iso: 400, format: '120' },
      ei: 200,
      process: 'C-41',
      developer: '冲洗店 C-41 标准药',
      baseMinutes: 3.25,
      cover: img('beach-parasols', 852, '海滩上一排彩色遮阳伞，远处是蓝色的海'),
      frames: [
        { n: 1, subject: '遮阳伞', shutter: '1/250', aperture: 11 },
        { n: 2, subject: '退潮后的沙纹', shutter: '1/250', aperture: 16 },
        { n: 3, subject: '救生员瞭望台', shutter: '1/500', aperture: 8, note: '逆光' },
      ],
      date: '2026-10-08',
      status: 'published',
    },
    {
      slug: 'draft-roll',
      title: '草稿胶卷（不公开）',
      summary: '还没冲出来的一卷。',
      stock: { name: '示例片', iso: 100, format: '135' },
      ei: 100,
      process: 'BW',
      developer: '未定',
      baseMinutes: 8,
      frames: [{ n: 1, subject: '草稿', shutter: '1/60', aperture: 4 }],
      date: '2026-10-16',
      status: 'draft',
    },
  ];
  return { items };
}
