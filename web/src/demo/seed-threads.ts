/**
 * L58 / v1.58.0 话题广场演示数据：人物、内容和数字全部虚构。
 */
import type { Item } from '../threads-core';
import type { State } from './mock-threads';

export function seed(_base = '/'): State {
  const items: Item[] = [
  {
    "slug": "welcome-board",
    "title": "【置顶】话题广场使用说明",
    "summary": "新人请先看：发帖、回复和标签怎么用。",
    "fictional": true,
    "date": "2026-10-01",
    "status": "published",
    "author": "小满（虚构）",
    "tags": [
      "站务"
    ],
    "body": [
      "欢迎来到话题广场！这里什么都可以聊，发帖时请选 1–5 个标签。",
      "请友善交流，具体规则见社区守则。"
    ],
    "pinned": true,
    "views": 3200,
    "replies": [
      {
        "id": "w1",
        "author": "青禾（虚构）",
        "date": "2026-10-02",
        "text": "收到，已读。",
        "likes": 4
      }
    ]
  },
  {
    "slug": "desk-setup",
    "title": "晒晒你的书桌",
    "summary": "工作学习的书桌长什么样？来晒照片（文字描述也行）。",
    "fictional": true,
    "date": "2026-11-03",
    "status": "published",
    "author": "阿梨（虚构）",
    "tags": [
      "生活",
      "晒图"
    ],
    "body": [
      "最近把书桌重新整理了一遍，加了一盏暖光台灯和一块大桌垫，效率高了不少。",
      "大家的书桌上有什么必备物件？"
    ],
    "pinned": false,
    "views": 860,
    "replies": [
      {
        "id": "d1",
        "author": "松果（虚构）",
        "date": "2026-11-03",
        "text": "显示器支架真的能救颈椎。",
        "likes": 12
      },
      {
        "id": "d2",
        "author": "阿梨（虚构）",
        "date": "2026-11-04",
        "text": "补充一下，桌垫是可以写字的那种。",
        "likes": 3
      },
      {
        "id": "d3",
        "author": "豆豆（虚构）",
        "date": "2026-11-04",
        "text": "我桌上永远有一杯凉掉的茶。",
        "likes": 20
      },
      {
        "id": "d4",
        "author": "林间（虚构）",
        "date": "2026-11-05",
        "text": "一个小书架放正在读的三本书。",
        "likes": 6
      }
    ]
  },
  {
    "slug": "winter-hobbies",
    "title": "冬天适合培养什么爱好？",
    "summary": "天冷不想出门，有没有适合在家里做的爱好推荐？",
    "fictional": true,
    "date": "2026-11-06",
    "status": "published",
    "author": "松果（虚构）",
    "tags": [
      "生活",
      "爱好"
    ],
    "body": [
      "天一冷就只想窝着，想找个能在家做、又不太花钱的爱好。"
    ],
    "pinned": false,
    "views": 420,
    "replies": [
      {
        "id": "h1",
        "author": "阿澈（虚构）",
        "date": "2026-11-06",
        "text": "拼图！一千片能拼一个周末。",
        "likes": 8
      },
      {
        "id": "h2",
        "author": "林间（虚构）",
        "date": "2026-11-07",
        "text": "试试每天写一小段日记。",
        "likes": 5
      }
    ]
  },
  {
    "slug": "draft-thread",
    "title": "草稿帖（不公开）",
    "summary": "草稿。",
    "fictional": true,
    "date": "2026-11-07",
    "status": "draft",
    "author": "某人（虚构）",
    "tags": [
      "草稿"
    ],
    "body": [
      "草稿。"
    ],
    "pinned": false,
    "views": 0,
    "replies": []
  }
];
  
  return { items };
}
