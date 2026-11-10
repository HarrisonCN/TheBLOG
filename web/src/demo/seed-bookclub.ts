/**
 * L57 / v1.57.0 读书会演示数据：人物、内容和数字全部虚构。
 */
import type { Item } from '../bookclub-core';
import type { State } from './mock-bookclub';

export function seed(_base = '/'): State {
  const items: Item[] = [
  {
    "slug": "harbor-letters",
    "title": "《港口来信》共读",
    "summary": "一本虚构的书信体小说：一位灯塔看守人和远方笔友的三十封信。",
    "fictional": true,
    "date": "2026-11-03",
    "status": "published",
    "author": "沈未（虚构）",
    "host": "林间（虚构）",
    "pages": 286,
    "weeks": [
      {
        "week": 1,
        "from": "2026-11-02",
        "chapters": "第 1–6 封信",
        "posts": [
          {
            "id": "h1",
            "author": "松果（虚构）",
            "text": "开头的海风描写太好了，一下就进去了。"
          },
          {
            "id": "h2",
            "author": "林间（虚构）",
            "text": "注意第 3 封信里提到的那盏旧灯，后面会回来。"
          }
        ]
      },
      {
        "week": 2,
        "from": "2026-11-09",
        "chapters": "第 7–14 封信",
        "posts": [
          {
            "id": "h3",
            "author": "青禾（虚构）",
            "text": "笔友的身份越来越可疑了。"
          }
        ]
      },
      {
        "week": 3,
        "from": "2026-11-16",
        "chapters": "第 15–22 封信",
        "posts": []
      },
      {
        "week": 4,
        "from": "2026-11-23",
        "chapters": "第 23–30 封信",
        "posts": []
      }
    ]
  },
  {
    "slug": "slow-kitchen",
    "title": "《慢厨房》共读",
    "summary": "一本虚构的饮食随笔：二十道家常菜背后的二十段记忆。",
    "fictional": true,
    "date": "2026-09-28",
    "status": "published",
    "author": "白芷（虚构）",
    "host": "豆豆（虚构）",
    "pages": 198,
    "weeks": [
      {
        "week": 1,
        "from": "2026-09-28",
        "chapters": "春天的五道菜",
        "posts": [
          {
            "id": "s1",
            "author": "阿梨（虚构）",
            "text": "看完马上去买了春笋。"
          }
        ]
      },
      {
        "week": 2,
        "from": "2026-10-05",
        "chapters": "夏天的五道菜",
        "posts": []
      },
      {
        "week": 3,
        "from": "2026-10-12",
        "chapters": "秋冬的十道菜",
        "posts": [
          {
            "id": "s2",
            "author": "豆豆（虚构）",
            "text": "最后一篇写外婆的汤，读哭了。"
          }
        ]
      }
    ]
  },
  {
    "slug": "draft-book",
    "title": "草稿共读（不公开）",
    "summary": "草稿。",
    "fictional": true,
    "date": "2026-11-07",
    "status": "draft",
    "author": "某人（虚构）",
    "host": "某人（虚构）",
    "pages": 1,
    "weeks": [
      {
        "week": 1,
        "from": "2026-12-01",
        "chapters": "草稿",
        "posts": []
      }
    ]
  }
];
  
  return { items };
}
