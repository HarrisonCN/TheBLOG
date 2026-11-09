/**
 * L62 / v1.62.0 树洞演示数据：人物、内容和数字全部虚构。
 */
import type { Item } from '../treehole-core';
import type { State } from './mock-treehole';

export function seed(_base = '/'): State {
  const items: Item[] = [
  {
    "slug": "note-quiet-evening",
    "title": "一个安静的晚上",
    "summary": "加完班一个人走回家，路上的风很舒服。",
    "fictional": true,
    "date": "2026-11-06",
    "status": "published",
    "mood": "calm",
    "body": [
      "今天加班到九点，一个人走回家。路上风很轻，路灯一盏一盏亮着，忽然觉得这样也挺好。",
      "希望明天也能早点下班。"
    ],
    "hugs": 31,
    "replies": [
      {
        "id": "r1",
        "text": "辛苦啦，明天会更好。"
      },
      {
        "id": "r2",
        "text": "我也喜欢夜里一个人走路。"
      }
    ]
  },
  {
    "slug": "note-exam-week",
    "title": "考试周好累",
    "summary": "连着三天考试，感觉脑子已经空了。",
    "fictional": true,
    "date": "2026-11-03",
    "status": "published",
    "mood": "tired",
    "body": [
      "连着三天考试，每天睡五个小时。考完最后一门只想睡一整天。"
    ],
    "hugs": 58,
    "replies": [
      {
        "id": "e1",
        "text": "考完记得好好吃一顿！"
      }
    ]
  },
  {
    "slug": "note-thank-you",
    "title": "谢谢那个帮我捡东西的人",
    "summary": "地铁上东西撒了一地，一个陌生人帮我一起捡。",
    "fictional": true,
    "date": "2026-10-27",
    "status": "published",
    "mood": "grateful",
    "body": [
      "早高峰包里的东西撒了一地，一个陌生人蹲下来帮我一起捡，捡完就下车了，连谢谢都没来得及说。"
    ],
    "hugs": 104,
    "replies": []
  },
  {
    "slug": "note-pending",
    "title": "待审核的纸条",
    "summary": "待审核（草稿 = 审核队列）。",
    "fictional": true,
    "date": "2026-11-07",
    "status": "draft",
    "mood": "worried",
    "body": [
      "这是一张还在审核队列里的示例纸条。"
    ],
    "hugs": 0,
    "replies": []
  }
];
  
  return { items };
}
