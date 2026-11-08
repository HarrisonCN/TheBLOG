/**
 * L51 / v1.51.0 兴趣圈子演示数据：人物、内容和数字全部虚构。
 */
import type { Item } from '../circles-core';
import type { State } from './mock-circles';

export function seed(_base = '/'): State {
  const items: Item[] = [
  {
    "slug": "night-walkers",
    "title": "夜跑与夜走",
    "summary": "下班后一起绕江边走一圈或跑五公里，交流路线和装备。",
    "fictional": true,
    "date": "2026-11-06",
    "status": "published",
    "tags": [
      "运动",
      "城市",
      "夜晚"
    ],
    "members": 128,
    "rules": [
      "分享路线时不要公开具体住址。",
      "跑团活动自愿参加，量力而行。",
      "晒成绩欢迎，攀比不必。"
    ],
    "hosts": [
      {
        "name": "阿澈（虚构）",
        "role": "圈主"
      },
      {
        "name": "小满（虚构）",
        "role": "管理员"
      }
    ],
    "posts": [
      {
        "id": "p1",
        "author": "阿澈（虚构）",
        "date": "2026-11-02",
        "text": "本周四晚八点江边集合，慢跑 5 公里，配速 7 分左右。",
        "replies": 12
      },
      {
        "id": "p2",
        "author": "青禾（虚构）",
        "date": "2026-11-05",
        "text": "新手求问：冬天夜跑穿几层合适？",
        "replies": 8
      },
      {
        "id": "p3",
        "author": "小满（虚构）",
        "date": "2026-11-05",
        "text": "整理了三条有路灯的环线，欢迎补充。",
        "replies": 5
      }
    ]
  },
  {
    "slug": "bookworms-corner",
    "title": "书虫角落",
    "summary": "每月共读一本书，平时分享读到的好句子和书单。",
    "fictional": true,
    "date": "2026-10-28",
    "status": "published",
    "tags": [
      "阅读",
      "书单"
    ],
    "members": 342,
    "rules": [
      "剧透请加提示。",
      "推荐书时说说为什么喜欢。"
    ],
    "hosts": [
      {
        "name": "林间（虚构）",
        "role": "圈主"
      }
    ],
    "posts": [
      {
        "id": "b1",
        "author": "林间（虚构）",
        "date": "2026-10-20",
        "text": "十一月共读书目投票开始啦，候选在置顶帖里。",
        "replies": 31
      },
      {
        "id": "b2",
        "author": "松果（虚构）",
        "date": "2026-10-26",
        "text": "分享一个读书笔记模板：摘句、想法、联想三栏。",
        "replies": 9
      }
    ]
  },
  {
    "slug": "weekend-cooks",
    "title": "周末厨房",
    "summary": "周末做一顿饭，晒成品、写做法、互相纠错。",
    "fictional": true,
    "date": "2026-10-15",
    "status": "published",
    "tags": [
      "美食",
      "生活"
    ],
    "members": 76,
    "rules": [
      "菜谱请写清用量和时间。",
      "不讨论减肥药等医疗话题。",
      "图片请用自己拍的。"
    ],
    "hosts": [
      {
        "name": "豆豆（虚构）",
        "role": "圈主"
      },
      {
        "name": "阿梨（虚构）",
        "role": "管理员"
      }
    ],
    "posts": []
  },
  {
    "slug": "draft-circle",
    "title": "筹备中的圈子（不公开）",
    "summary": "草稿。",
    "fictional": true,
    "date": "2026-11-07",
    "status": "draft",
    "tags": [],
    "members": 0,
    "rules": [
      "草稿。"
    ],
    "hosts": [
      {
        "name": "某人（虚构）",
        "role": "圈主"
      }
    ],
    "posts": []
  }
];
  
  return { items };
}
