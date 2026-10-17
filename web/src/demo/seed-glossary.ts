/**
 * L36 / v1.36.0 摄影术语表演示数据：写给摄影专业学生的常用术语（释义为通用摄影知识的简写，不引用任何人的文字）。
 * 配图用站内已有的示例照片（Wikimedia Commons 开放授权，署名见 demo-assets/photos/credits.json）。
 */
import type { Item } from '../glossary-core';
import type { State } from './mock-glossary';

type T = Omit<Item, 'date' | 'status' | 'body' | 'aliases' | 'related'> & { body?: string[]; aliases?: string[]; related?: [string, string][]; date?: string; status?: Item['status'] };

export function seed(base = '/'): State {
  const b = `${base.endsWith('/') ? base : `${base}/`}demo/photos/`;
  const list: T[] = [
    { slug: 'aperture', title: '光圈', en: 'Aperture', reading: 'guang quan', aliases: ['f 值', '光圈值'], category: 'exposure', summary: '镜头里控制进光孔径大小的结构，用 f 值表示，f 值越小进光越多。', body: ['光圈同时影响曝光和景深：开大光圈（如 f/1.8）进光多、背景更虚；收小光圈（如 f/11）进光少、前后更清楚。', '相邻两档整级光圈（f/2.8 → f/4）的进光量相差一倍。'], related: [['depth-of-field', '景深'], ['exposure-triangle', '曝光三角'], ['bokeh', '散景']] },
    { slug: 'shutter-speed', title: '快门速度', en: 'Shutter speed', reading: 'kuai men su du', aliases: ['曝光时间'], category: 'exposure', summary: '感光元件接收光线的时间长短，例如 1/250 秒或 2 秒。', body: ['快门越快越能凝固动作，越慢越容易出现运动模糊；慢门可以把流水拍成丝绸状。'], related: [['safe-shutter', '安全快门'], ['exposure-triangle', '曝光三角']] },
    { slug: 'iso', title: '感光度', en: 'ISO', reading: 'gan guang du', aliases: ['ISO', '感光值'], category: 'exposure', summary: '感光元件（或胶片）对光的敏感程度，数值越高画面越亮、噪点也越多。', body: ['ISO 翻倍相当于多一档曝光。光线不足又不能放慢快门时，再提高 ISO。'], related: [['exposure-triangle', '曝光三角'], ['push-processing', '推冲']] },
    { slug: 'exposure-triangle', title: '曝光三角', en: 'Exposure triangle', reading: 'pu guang san jiao', category: 'exposure', summary: '光圈、快门速度和感光度共同决定曝光，改变其中一个就要用另外两个补偿。', related: [['aperture', '光圈'], ['shutter-speed', '快门速度'], ['iso', '感光度']] },
    { slug: 'bracketing', title: '包围曝光', en: 'Bracketing', reading: 'bao wei pu guang', aliases: ['包围'], category: 'exposure', summary: '同一画面按不同曝光连拍几张，事后挑选或合成。', body: ['常见做法是 −1 / 0 / +1 三张，逆光和高反差场景最有用。'], related: [['dynamic-range', '宽容度'], ['histogram', '直方图']] },
    { slug: 'histogram', title: '直方图', en: 'Histogram', reading: 'zhi fang tu', category: 'post', summary: '把画面里每种亮度有多少像素画成柱状图，左边暗、右边亮。', body: ['贴住右边缘说明高光可能溢出，贴住左边缘说明暗部可能死黑。拍摄时看直方图比看屏幕亮度更可靠。'], related: [['dynamic-range', '宽容度'], ['raw', 'RAW 格式']] },
    { slug: 'dynamic-range', title: '宽容度', en: 'Dynamic range', reading: 'kuan rong du', aliases: ['动态范围'], category: 'film', summary: '一张照片能同时记录的最亮和最暗之间的范围，常用「档」来表示。', body: ['负片的宽容度通常比反转片大，所以负片更能容忍曝光误差。'], related: [['bracketing', '包围曝光'], ['histogram', '直方图']] },
    { slug: 'depth-of-field', title: '景深', en: 'Depth of field', reading: 'jing shen', aliases: ['DOF'], category: 'composition', summary: '画面中前后看起来清楚的距离范围。', body: ['光圈越大、焦距越长、离主体越近，景深越浅。'], related: [['aperture', '光圈'], ['bokeh', '散景'], ['focal-length', '焦距']] },
    { slug: 'bokeh', title: '散景', en: 'Bokeh', reading: 'san jing', aliases: ['焦外', '虚化'], category: 'gear', summary: '焦外模糊区域的质感，例如光斑的形状和过渡是否柔和。', related: [['depth-of-field', '景深'], ['aperture', '光圈']] },
    { slug: 'focal-length', title: '焦距', en: 'Focal length', reading: 'jiao ju', category: 'gear', summary: '镜头光学中心到成像面的距离，决定视角大小：焦距越长，视角越窄。', body: ['24mm 属于广角，50mm 接近人眼的标准视角，85mm 以上常用于人像和远处细节。'], related: [['equivalent-focal-length', '等效焦距'], ['safe-shutter', '安全快门']] },
    { slug: 'equivalent-focal-length', title: '等效焦距', en: 'Equivalent focal length', reading: 'deng xiao jiao ju', aliases: ['等效 35mm'], category: 'gear', summary: '把不同画幅的焦距换算成 35mm 全画幅下的视角，便于比较。', body: ['手机主摄常写「等效 24mm」：实际焦距只有几毫米，但视角和全画幅 24mm 相近。'], related: [['focal-length', '焦距']] },
    { slug: 'safe-shutter', title: '安全快门', en: 'Safe shutter speed', reading: 'an quan kuai men', category: 'exposure', summary: '手持拍摄不容易拍糊的最慢快门，经验值约为 1 / 等效焦距 秒。', body: ['有防抖可以再慢几档，但只能防手抖，防不了主体自己在动。'], related: [['shutter-speed', '快门速度'], ['equivalent-focal-length', '等效焦距']] },
    { slug: 'white-balance', title: '白平衡', en: 'White balance', reading: 'bai ping heng', aliases: ['WB'], category: 'light', summary: '校正光源颜色，让白色在照片里看起来是白的。', related: [['color-temperature', '色温'], ['raw', 'RAW 格式']] },
    { slug: 'color-temperature', title: '色温', en: 'Color temperature', reading: 'se wen', aliases: ['K 值'], category: 'light', summary: '用开尔文（K）表示光的冷暖：数值低偏暖黄，数值高偏冷蓝。', body: ['烛光约 1900K，正午日光约 5500K，阴天约 6500K 以上。'], related: [['white-balance', '白平衡'], ['golden-hour', '黄金时刻'], ['blue-hour', '蓝调时刻']] },
    { slug: 'golden-hour', title: '黄金时刻', en: 'Golden hour', reading: 'huang jin shi ke', aliases: ['魔幻时刻'], category: 'light', summary: '日出后和日落前太阳很低的一段时间，光线柔和、偏暖、影子长。', image: { src: `${b}palm-sunset-1280.webp`, alt: '日落时分剪影般的三棵棕榈树', w: 1280, h: 871 }, related: [['blue-hour', '蓝调时刻'], ['color-temperature', '色温']] },
    { slug: 'blue-hour', title: '蓝调时刻', en: 'Blue hour', reading: 'lan diao shi ke', category: 'light', summary: '日出前和日落后天空呈深蓝色的短暂时间，适合拍城市灯光。', image: { src: `${b}harbour-night-1280.webp`, alt: '夜晚港湾对岸灯火通明的摩天大楼', w: 1280, h: 748 }, related: [['golden-hour', '黄金时刻'], ['color-temperature', '色温']] },
    { slug: 'rule-of-thirds', title: '三分法', en: 'Rule of thirds', reading: 'san fen fa', aliases: ['九宫格构图'], category: 'composition', summary: '用两横两竖把画面分成九格，把主体或地平线放在线上或交点附近。', related: [['leading-lines', '引导线']] },
    { slug: 'leading-lines', title: '引导线', en: 'Leading lines', reading: 'yin dao xian', category: 'composition', summary: '利用道路、栏杆、海岸线等线条把视线带向主体。', image: { src: `${b}baltic-view-1280.webp`, alt: '从山丘上望向大海，近处是草地和小路', w: 1280, h: 850 }, related: [['rule-of-thirds', '三分法']] },
    { slug: 'raw', title: 'RAW 格式', en: 'RAW', reading: 'raw', aliases: ['原始文件'], category: 'post', summary: '保存传感器原始数据的文件，后期调整白平衡和曝光的余地比 JPEG 大得多。', related: [['white-balance', '白平衡'], ['histogram', '直方图']] },
    { slug: 'push-processing', title: '推冲', en: 'Push processing', reading: 'tui chong', aliases: ['增感冲洗'], category: 'film', summary: '按比标称更高的感光度拍摄胶片，再延长显影时间来补偿。', body: ['推冲会让反差和颗粒变大；反过来减少显影叫「拉冲」。'], related: [['iso', '感光度'], ['dynamic-range', '宽容度']] },
    { slug: 'sunny-16', title: '阳光 16 法则', en: 'Sunny 16 rule', reading: '16 fa ze', category: 'film', summary: '晴天顺光时，用 f/16、快门 1 / ISO 秒就能得到正确曝光的经验法则。', related: [['exposure-triangle', '曝光三角']] },
    { slug: 'contact-sheet', title: '印样', en: 'Contact sheet', reading: 'yin yang', category: 'film', summary: '把一卷底片按原大小印在一张相纸上，方便挑片的小样。', status: 'draft' },
  ];
  return {
    items: list.map((t) => ({ ...t, aliases: t.aliases ?? [], body: t.body ?? [], related: (t.related ?? []).map(([slug, title]) => ({ slug, title })), date: t.date ?? '2026-10-17', status: t.status ?? 'published' })),
  };
}
