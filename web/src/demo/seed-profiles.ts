/**
 * L59 / v1.59.0 成员主页与成就演示数据：人物、内容和数字全部虚构。
 */
import type { Item } from '../profiles-core';
import type { State } from './mock-profiles';

export function seed(_base = '/'): State {
  const items: Item[] = [
  {
    "slug": "xiaoman",
    "title": "小满",
    "summary": "社区的老朋友，话题广场和桌游下午的组织者。",
    "fictional": true,
    "date": "2026-11-06",
    "status": "published",
    "name": "小满（虚构）",
    "joined": "2025-03-14",
    "bio": "喜欢桌游和写清单，常在话题广场回复新人。",
    "city": "某海边城市（虚构）",
    "stats": [
      {
        "posts": 86,
        "answers": 24,
        "accepted": 7,
        "meetups": 5,
        "streak": 41
      }
    ],
    "links": [
      {
        "label": "示例主页",
        "url": "https://example.com/xiaoman"
      }
    ]
  },
  {
    "slug": "qinghe",
    "title": "青禾",
    "summary": "跑步新手，问答区的常客。",
    "fictional": true,
    "date": "2026-11-05",
    "status": "published",
    "name": "青禾（虚构）",
    "joined": "2026-06-01",
    "bio": "刚开始跑步，正在准备第一次半马。",
    "city": "某内陆城市（虚构）",
    "stats": [
      {
        "posts": 12,
        "answers": 3,
        "accepted": 0,
        "meetups": 1,
        "streak": 9
      }
    ],
    "links": []
  },
  {
    "slug": "songguo",
    "title": "松果",
    "summary": "书虫角落成员，爱写读书笔记。",
    "fictional": true,
    "date": "2026-10-31",
    "status": "published",
    "name": "松果（虚构）",
    "joined": "2025-11-20",
    "bio": "读书笔记三栏法的推广者。",
    "city": "某山城（虚构）",
    "stats": [
      {
        "posts": 40,
        "answers": 15,
        "accepted": 2,
        "meetups": 3,
        "streak": 12
      }
    ],
    "links": []
  },
  {
    "slug": "draft-member",
    "title": "草稿成员（不公开）",
    "summary": "草稿。",
    "fictional": true,
    "date": "2026-11-07",
    "status": "draft",
    "name": "某人（虚构）",
    "joined": "2026-11-01",
    "bio": "草稿。",
    "city": "草稿",
    "stats": [
      {
        "posts": 0,
        "answers": 0,
        "accepted": 0,
        "meetups": 0,
        "streak": 0
      }
    ],
    "links": []
  }
];
  
  return { items };
}
