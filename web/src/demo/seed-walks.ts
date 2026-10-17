/**
 * L42 / v1.42.0 扫街路线演示数据：路线、站点名和提示都是虚构的示例（坐标只用来演示距离计算和示意图，不对应真实地点推荐）；
 * 配图是站内已有的示例照片（Wikimedia Commons 开放授权，署名见 demo-assets/photos/credits.json）。
 */
import type { Item } from '../walk-core';
import type { State } from './mock-walks';

export function seed(base = '/'): State {
  const b = `${base.endsWith('/') ? base : `${base}/`}demo/photos/`;
  const img = (name: string, h: number, alt: string) => ({ src: `${b}${name}-1280.webp`, alt, w: 1280, h });
  const items: Item[] = [
    {
      slug: 'riverside-evening',
      title: '示例：江边傍晚',
      summary: '从码头沿江走到老街，赶在蓝调时刻结束前到桥上。',
      area: '示例城 · 江边',
      pace: 4,
      stopMinutes: 10,
      date: '2026-10-15',
      status: 'published',
      stops: [
        { id: 'pier', name: '示例码头', lat: 28.1960, lng: 112.9640, tip: '日落前半小时到，先拍逆光的人影。', image: img('harbour-castle', 781, '小港口里一座石砌的小城堡，前面停着渔船') },
        { id: 'steps', name: '江边台阶', lat: 28.1925, lng: 112.9655, tip: '台阶的斜线适合做引导线。' },
        { id: 'market', name: '老街口', lat: 28.1890, lng: 112.9700, tip: '路口人多，提前设好区域对焦。', image: img('street-tricycle', 960, '街边一辆装满回收纸板的三轮车') },
        { id: 'bridge', name: '大桥人行道', lat: 28.1870, lng: 112.9620, tip: '蓝调时刻拍对岸灯光，带上小三脚架。', image: img('harbour-night', 748, '夜晚港湾对岸灯火通明的摩天大楼') },
      ],
    },
    {
      slug: 'campus-morning',
      title: '示例：校园清晨',
      summary: '早课前一小时，从宿舍走到湖边再回教学楼。',
      area: '示例大学',
      pace: 3.5,
      stopMinutes: 8,
      date: '2026-10-10',
      status: 'published',
      stops: [
        { id: 'dorm', name: '宿舍楼下', lat: 28.1350, lng: 112.9950 },
        { id: 'lake', name: '湖边栈道', lat: 28.1372, lng: 112.9988, tip: '无风时拍倒影。', image: img('montriond-lake', 853, '被森林环绕的湖，水色碧绿') },
        { id: 'grove', name: '小树林', lat: 28.1395, lng: 112.9970, tip: '晨雾里的逆光树干。', image: img('forest-road', 853, '穿过森林的一条笔直小路') },
        { id: 'hall', name: '教学楼', lat: 28.1380, lng: 112.9935 },
      ],
    },
    { slug: 'draft-walk', title: '示例：草稿路线', summary: '还没走过。', area: '示例城', pace: 4, stopMinutes: 10, date: '2026-10-17', status: 'draft', stops: [{ id: 'a', name: '起点', lat: 28.2, lng: 112.9 }, { id: 'b', name: '终点', lat: 28.21, lng: 112.91 }] },
  ];
  return { items };
}
