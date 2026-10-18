/**
 * L49 / v1.49.0 作品幕后演示数据：拍摄过程、器材和布光均为虚构示例；照片是站内已有的示例照片
 * （Wikimedia Commons 开放授权，署名见 demo-assets/photos/credits.json），参数并非原图的真实 EXIF。
 */
import type { Item } from '../behind-core';
import type { State } from './mock-behind';

export function seed(base = '/'): State {
  const b = `${base.endsWith('/') ? base : `${base}/`}demo/photos/`;
  const img = (name: string, h: number, alt: string) => ({ src: `${b}${name}-1280.webp`, alt, w: 1280, h });
  const items: Item[] = [
    {
      slug: 'window-iris',
      title: '示例：窗光下的鸢尾',
      summary: '只用一扇北窗和一块泡沫板，在桌上拍一朵鸢尾。',
      photo: img('iris', 871, '一朵紫色鸢尾花，背景虚化成柔和的绿色'),
      exif: { camera: '示例无反相机', lens: '50mm F1.8 定焦', focal: 50, aperture: 2.8, shutter: '1/125', iso: 200 },
      setup: {
        camera: { x: 50, y: 88 },
        subject: { x: 50, y: 50 },
        lights: [
          { id: 'window', kind: 'natural', label: '北窗散射光', x: 12, y: 46 },
          { id: 'board', kind: 'reflector', label: '白色泡沫板', x: 82, y: 50 },
        ],
      },
      lightingText: '俯视：相机在主体正前方。北窗在主体左侧稍后，散射光从左边照亮花瓣；右侧近距离放一块白色泡沫板，把暗部补亮一些。',
      steps: ['把花放在离窗约一米的桌上，关掉室内灯。', '用 f/2.8 让背景虚化，对焦在最前面的花瓣上。', '泡沫板从远往近移，直到右侧暗部还能看到纹理为止。'],
      gear: ['50mm 定焦镜头', '白色泡沫板'],
      terms: [
        { slug: 'aperture', label: '光圈' },
        { slug: 'depth-of-field', label: '景深' },
        { slug: 'white-balance', label: '白平衡' },
      ],
      date: '2026-10-15',
      status: 'published',
    },
    {
      slug: 'harbour-long-exposure',
      title: '示例：港口夜景长曝光',
      summary: '三脚架加 8 秒曝光，让水面变平、灯光拉出倒影。',
      photo: img('harbour-night', 748, '夜晚的港口，灯光倒映在水面上'),
      exif: { camera: '示例无反相机', lens: '24-70mm 变焦', focal: 35, aperture: 8, shutter: '8s', iso: 100 },
      setup: {
        camera: { x: 50, y: 90 },
        subject: { x: 50, y: 45 },
        lights: [{ id: 'city', kind: 'natural', label: '对岸的城市灯光', x: 50, y: 8 }],
      },
      lightingText: '俯视：相机在岸边，对着港口。唯一的光源是对岸的城市灯光，在主体正后方，形成逆光和水面倒影。',
      steps: ['蓝调时刻结束前架好三脚架，关掉防抖。', '用快门线或两秒自拍避免按快门时的震动。', '先试 4 秒，再根据直方图加到 8 秒。'],
      gear: ['三脚架', '快门线'],
      terms: [
        { slug: 'shutter-speed', label: '快门速度' },
        { slug: 'blue-hour', label: '蓝调时刻' },
        { slug: 'histogram', label: '直方图' },
      ],
      date: '2026-10-09',
      status: 'published',
    },
    {
      slug: 'draft-behind',
      title: '草稿幕后（不公开）',
      summary: '还没写完。',
      photo: img('sunflowers', 852, '一片向日葵'),
      exif: { camera: '示例', lens: '示例', focal: 35, aperture: 4, shutter: '1/500', iso: 100 },
      setup: { camera: { x: 50, y: 90 }, subject: { x: 50, y: 50 }, lights: [{ id: 'sun', kind: 'natural', label: '太阳', x: 20, y: 20 }] },
      lightingText: '草稿：太阳在左后方。',
      steps: ['草稿。'],
      gear: [],
      terms: [],
      date: '2026-10-16',
      status: 'draft',
    },
  ];
  return { items };
}
