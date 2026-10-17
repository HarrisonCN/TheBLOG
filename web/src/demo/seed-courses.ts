/**
 * L40 / v1.40.0 课程笔记演示数据：虚构的摄影专业课（课程、作业、评分都是示例，不对应任何真实学校或老师）。
 */
import type { Item } from '../course-core';
import type { State } from './mock-courses';

export function seed(_base = '/'): State {
  const items: Item[] = [
    {
      slug: 'photo-basics',
      title: '示例：摄影基础',
      term: '2026-fall',
      summary: '曝光、光线和构图的入门课，每两周交一组作业。',
      date: '2026-10-16',
      status: 'published',
      lessons: [
        { no: 1, title: '相机是怎么记录光的', notes: ['光圈、快门、感光度三者共同决定曝光；先想清楚要什么效果，再决定先动哪一个。', '课堂练习：同一场景用三种组合拍出相同亮度，比较景深和运动模糊。'] },
        {
          no: 2,
          title: '测光与直方图',
          notes: ['评价测光会被大面积亮部或暗部带偏；雪景常常要加曝光补偿。', '看直方图判断高光是否溢出，比看屏幕亮度更可靠。'],
          assignment: {
            title: '一个场景，五种曝光',
            due: '2026-10-09',
            brief: '选一个固定场景，按 −2 / −1 / 0 / +1 / +2 档各拍一张，写一段话说明你最终选哪一张、为什么。',
            rubric: [
              { name: '曝光控制', weight: 40, score: 4 },
              { name: '画面完成度', weight: 30, score: 5 },
              { name: '文字说明', weight: 30, score: 3 },
            ],
          },
        },
        {
          no: 3,
          title: '自然光的方向',
          notes: ['顺光平、侧光立体、逆光有轮廓；同一个人像在三种光下各拍一张。'],
          assignment: {
            title: '一天里的同一扇窗',
            due: '2026-10-23',
            brief: '在早、中、晚三个时间拍同一扇窗和窗边的物件，比较光的方向和颜色。',
            rubric: [
              { name: '光线观察', weight: 50 },
              { name: '构图', weight: 30 },
              { name: '文字说明', weight: 20 },
            ],
          },
        },
        { no: 4, title: '构图的基本方法', notes: [] },
      ],
    },
    {
      slug: 'darkroom-film',
      title: '示例：暗房与胶片',
      term: '2026-spring',
      summary: '黑白胶片的拍摄、冲洗和放大。',
      date: '2026-06-20',
      status: 'published',
      lessons: [
        { no: 1, title: '胶片的结构与感光度', notes: ['胶片的感光度标在盒子上，推冲和拉冲会改变反差与颗粒。'] },
        { no: 2, title: '显影、停显、定影', notes: ['温度每差 1°C，显影时间要相应调整；记录每一卷的温度和时间。'] },
        {
          no: 3,
          title: '放大与试条',
          notes: ['先做试条找曝光时间，再决定反差滤镜。'],
          assignment: {
            title: '一张 8×10 放大照片',
            due: '2026-06-15',
            brief: '从自己冲洗的底片中选一张，放大成 8×10 英寸照片，附试条。',
            rubric: [
              { name: '底片质量', weight: 25, score: 4 },
              { name: '放大曝光与反差', weight: 50, score: 5 },
              { name: '整洁度', weight: 25, score: 4 },
            ],
          },
        },
      ],
    },
    { slug: 'draft-course', title: '示例：草稿课程', term: '2027-spring', summary: '还没开课。', date: '2026-10-17', status: 'draft', lessons: [{ no: 1, title: '待定', notes: [] }] },
  ];
  return { items };
}
