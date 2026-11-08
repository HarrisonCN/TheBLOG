/**
 * L53 / v1.53.0 投票与小测验演示数据：人物、内容和数字全部虚构。
 */
import type { Item } from '../polls-core';
import type { State } from './mock-polls';

export function seed(_base = '/'): State {
  const items: Item[] = [
  {
    "slug": "weekend-plans",
    "title": "这个周末你打算做什么？",
    "summary": "社区周末小调查：宅家、出门还是加班？",
    "fictional": true,
    "date": "2026-11-06",
    "status": "published",
    "kind": "poll",
    "host": "小满（虚构）",
    "questions": [
      {
        "id": "q1",
        "text": "周末最想做的事",
        "options": [
          {
            "id": "home",
            "text": "在家休息",
            "votes": 48
          },
          {
            "id": "out",
            "text": "出门走走",
            "votes": 36
          },
          {
            "id": "learn",
            "text": "学点新东西",
            "votes": 21
          },
          {
            "id": "work",
            "text": "还得加班",
            "votes": 9
          }
        ]
      },
      {
        "id": "q2",
        "text": "周末一般几点起床？",
        "options": [
          {
            "id": "early",
            "text": "八点前",
            "votes": 12
          },
          {
            "id": "mid",
            "text": "八点到十点",
            "votes": 40
          },
          {
            "id": "late",
            "text": "十点以后",
            "votes": 31
          }
        ],
        "explain": "结果只代表参与投票的示例数据。"
      }
    ]
  },
  {
    "slug": "kitchen-basics-quiz",
    "title": "厨房常识小测验",
    "summary": "三道题测测你的厨房常识，答完看得分。",
    "fictional": true,
    "date": "2026-10-29",
    "status": "published",
    "kind": "quiz",
    "host": "豆豆（虚构）",
    "questions": [
      {
        "id": "k1",
        "text": "煮意面时，水里加盐主要是为了？",
        "options": [
          {
            "id": "a",
            "text": "让水更快烧开",
            "votes": 20
          },
          {
            "id": "b",
            "text": "给面条调味",
            "votes": 55,
            "correct": true
          },
          {
            "id": "c",
            "text": "防止面条粘连",
            "votes": 31
          }
        ],
        "explain": "加盐对沸点的影响很小，主要作用是让面条本身有底味。"
      },
      {
        "id": "k2",
        "text": "切洋葱不流泪，下面哪个办法比较有效？",
        "options": [
          {
            "id": "a",
            "text": "把洋葱冷藏后再切",
            "votes": 44,
            "correct": true
          },
          {
            "id": "b",
            "text": "切的时候说话",
            "votes": 6
          },
          {
            "id": "c",
            "text": "用钝刀慢慢切",
            "votes": 10
          }
        ],
        "explain": "低温能减少刺激性物质挥发；钝刀反而会压破更多细胞。"
      },
      {
        "id": "k3",
        "text": "鸡蛋放进清水里沉底平躺，说明？",
        "options": [
          {
            "id": "a",
            "text": "比较新鲜",
            "votes": 38,
            "correct": true
          },
          {
            "id": "b",
            "text": "已经变质",
            "votes": 12
          }
        ],
        "explain": "蛋放久了气室变大，会慢慢立起甚至浮起来。"
      }
    ]
  },
  {
    "slug": "reading-habits",
    "title": "你通常在哪里看书？",
    "summary": "纸质书、电子书还是听书？",
    "fictional": true,
    "date": "2026-10-18",
    "status": "published",
    "kind": "poll",
    "host": "林间（虚构）",
    "questions": [
      {
        "id": "r1",
        "text": "最常用的阅读方式",
        "options": [
          {
            "id": "paper",
            "text": "纸质书",
            "votes": 66
          },
          {
            "id": "ebook",
            "text": "电子书",
            "votes": 58
          },
          {
            "id": "audio",
            "text": "听书",
            "votes": 17
          }
        ]
      }
    ]
  },
  {
    "slug": "draft-poll",
    "title": "草稿投票（不公开）",
    "summary": "草稿。",
    "fictional": true,
    "date": "2026-11-07",
    "status": "draft",
    "kind": "poll",
    "host": "某人（虚构）",
    "questions": [
      {
        "id": "d1",
        "text": "草稿",
        "options": [
          {
            "id": "a",
            "text": "一",
            "votes": 0
          },
          {
            "id": "b",
            "text": "二",
            "votes": 0
          }
        ]
      }
    ]
  }
];
  
  return { items };
}
