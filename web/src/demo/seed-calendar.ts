/**
 * L39 / v1.39.0 照片日历演示数据：虚构的「每天一张」练习，用站内已有的示例照片
 * （Wikimedia Commons 开放授权，署名见 demo-assets/photos/credits.json）。日期是示例，不代表真实的拍摄日期。
 */
import type { Item } from '../calendar-core';
import type { State } from './mock-calendar';

const P: Record<string, [number, string]> = {
  'alpine-sunset': [698, '高山湖畔的日落（AI 生成的示例图）'],
  'baltic-view': [850, '从山丘上望向大海，近处是草地和小路'],
  'beach-parasols': [852, '傍晚海滩上一排收起的遮阳伞'],
  'field-bindweed': [1010, '近拍一朵白色的田旋花'],
  'forest-road': [853, '穿过森林的一条笔直小路'],
  'guilin-pagodas': [854, '夜里湖面上两座亮灯的塔和它们的倒影'],
  'harbour-castle': [781, '小港口里一座石砌的小城堡，前面停着渔船'],
  'harbour-night': [748, '夜晚港湾对岸灯火通明的摩天大楼'],
  'hero-lake': [593, '日出时分的高山湖，水面倒映着橙色的天空'],
  himalayas: [854, '云层之上连绵的雪山山脊'],
  iris: [871, '一朵花菖蒲的特写'],
  'montriond-lake': [853, '被森林环绕的湖，水色碧绿'],
  'palm-sunset': [871, '日落时分剪影般的三棵棕榈树'],
  'poppies-korea': [856, '花园里一片盛开的冰岛虞美人'],
  'porto-covo': [863, '金色悬崖下的礁石和蓝绿色海水'],
  'pudong-night': [640, '江对岸高楼林立的城市天际线全景'],
  'snina-winter': [853, '冬天覆雪的山顶岩石和光秃的树'],
  'street-tricycle': [960, '街边一辆装满回收纸板的三轮车'],
  sunflowers: [852, '阳光下的一片向日葵'],
};

export function seed(base = '/'): State {
  const b = `${base.endsWith('/') ? base : `${base}/`}demo/photos/`;
  const d = (day: number, name: string, title: string, note?: string) => ({ day, title, image: { src: `${b}${name}-1280.webp`, alt: P[name]![1], w: 1280, h: P[name]![0] }, ...(note ? { note } : {}) });
  const items: Item[] = [
    {
      slug: '2026-10',
      title: '示例：十月照片日历',
      summary: '十月的「每天一张」练习：不求每张都好，只求每天都按一次快门。',
      date: '2026-10-17',
      status: 'published',
      days: [
        d(1, 'sunflowers', '开学第一天的向日葵', '学校后面的花田，逆光。'),
        d(2, 'iris', '花菖蒲', '微距练习，光圈 f/4。'),
        d(3, 'forest-road', '林间小路'),
        d(5, 'harbour-night', '港口夜色', '三脚架 + 8 秒。'),
        d(6, 'street-tricycle', '巷口'),
        d(8, 'field-bindweed', '田旋花'),
        d(9, 'beach-parasols', '收伞以后'),
        d(11, 'poppies-korea', '虞美人'),
        d(12, 'montriond-lake', '湖边'),
        d(14, 'pudong-night', '江对岸', '全景接片四张。'),
        d(15, 'himalayas', '雪线'),
        d(16, 'palm-sunset', '三棵棕榈'),
      ],
    },
    {
      slug: '2026-09',
      title: '示例：九月照片日历',
      summary: '九月从月中开始。',
      date: '2026-09-30',
      status: 'published',
      days: [
        d(15, 'hero-lake', '日出湖面', '第一张。'),
        d(17, 'baltic-view', '海边高地'),
        d(19, 'porto-covo', '礁石'),
        d(21, 'harbour-castle', '港口古堡'),
        d(24, 'snina-winter', '旧照片：冬天的山', '翻到的旧片，补一张。'),
        d(26, 'guilin-pagodas', '日月双塔'),
        d(28, 'alpine-sunset', '湖畔日落'),
        d(30, 'iris', '月底的花'),
      ],
    },
    { slug: '2026-11', title: '示例：十一月（草稿）', date: '2026-11-01', status: 'draft', days: [] },
  ];
  return { items };
}
