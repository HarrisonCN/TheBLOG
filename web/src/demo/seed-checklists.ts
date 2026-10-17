/**
 * L38 / v1.38.0 拍摄清单演示数据（虚构的示例清单，写给摄影专业学生）。
 */
import type { Item } from '../checklist-core';
import type { State } from './mock-checklists';

const g = (title: string, items: [string, string, string?][]) => ({ title, items: items.map(([id, label, note]) => ({ id, label, ...(note ? { note } : {}) })) });

export function seed(_base = '/'): State {
  const items: Item[] = [
    {
      slug: 'sunrise-landscape',
      title: '示例：日出风光',
      summary: '天亮前出发拍日出：器材、到位前的设置和现场流程。',
      kind: 'landscape',
      groups: [
        g('器材', [['tripod', '三脚架和快装板'], ['nd-grad', '渐变灰镜', '天地光比大时用'], ['battery', '两块充满的电池', '低温掉电快'], ['card', '格式化好的存储卡'], ['headlamp', '头灯（红光模式）']]),
        g('出发前', [['weather', '看天气和云量'], ['sunrise-time', '查日出时间和方位', '工具箱 › 黄金 / 蓝调时刻'], ['route', '确认路线和停车点']]),
        g('到位后', [['level', '调平三脚架'], ['raw', '设成 RAW'], ['iso-low', 'ISO 调到最低'], ['focus', '手动对焦并锁定'], ['bracket', '开包围曝光', '−1 / 0 / +1']]),
      ],
      date: '2026-10-16',
      status: 'published',
    },
    {
      slug: 'street-walk',
      title: '示例：周末扫街',
      summary: '轻装出门，注意尊重被拍的人。',
      kind: 'street',
      groups: [
        g('器材', [['prime', '一支定焦镜头'], ['strap', '腕带或背带'], ['spare-card', '备用存储卡']]),
        g('设置', [['zone', '区域对焦 / 预对焦', 'f/8，约 3 米'], ['shutter', '快门不低于 1/250'], ['auto-iso', '打开自动 ISO']]),
        g('礼貌与安全', [['consent', '被拍的人示意不要拍时立即删除'], ['kids', '不拍可以辨认的儿童正脸'], ['bag', '包放身前']]),
      ],
      date: '2026-10-15',
      status: 'published',
    },
    {
      slug: 'night-city',
      title: '示例：城市夜景',
      summary: '蓝调时刻前到位，长曝光和防抖要点。',
      kind: 'night',
      groups: [
        g('器材', [['tripod-n', '三脚架'], ['remote', '快门线或手机遥控'], ['cloth', '镜头布', '夜里露水重']]),
        g('设置', [['ois-off', '上三脚架后关闭防抖'], ['self-timer', '两秒自拍或反光镜预升'], ['wb-n', '白平衡手动 4000K 左右'], ['nr', '确认长时间曝光降噪的取舍']]),
      ],
      date: '2026-10-12',
      status: 'published',
    },
    {
      slug: 'draft-portrait',
      title: '示例：人像约拍（草稿）',
      summary: '还没整理完。',
      kind: 'portrait',
      groups: [g('器材', [['reflector', '反光板']])],
      date: '2026-10-17',
      status: 'draft',
    },
  ];
  return { items };
}
