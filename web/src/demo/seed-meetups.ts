/**
 * L56 / v1.56.0 活动与聚会演示数据：人物、内容和数字全部虚构。
 */
import type { Item } from '../meetups-core';
import type { State } from './mock-meetups';

export function seed(_base = '/'): State {
  const items: Item[] = [
  {
    "slug": "winter-board-games",
    "title": "冬日桌游下午",
    "summary": "带上你喜欢的桌游，一起玩一个下午，新手友好。",
    "fictional": true,
    "date": "2026-11-06",
    "status": "published",
    "host": "小满（虚构）",
    "start": "2026-12-05T14:00",
    "end": "2026-12-05T17:30",
    "place": "示例社区活动室（虚构地址）",
    "online": false,
    "capacity": 20,
    "going": 19,
    "agenda": [
      {
        "time": "14:00",
        "text": "签到、分组"
      },
      {
        "time": "14:30",
        "text": "轻策略桌游两轮"
      },
      {
        "time": "16:30",
        "text": "自由交换桌游、合影"
      }
    ],
    "tags": [
      "桌游",
      "线下"
    ]
  },
  {
    "slug": "online-reading-night",
    "title": "线上读书夜：聊聊散文",
    "summary": "视频会议里各自分享最近读到的一篇散文，每人十分钟。",
    "fictional": true,
    "date": "2026-11-02",
    "status": "published",
    "host": "林间（虚构）",
    "start": "2027-01-09T20:00",
    "end": "2027-01-09T21:30",
    "place": "视频会议（链接在活动前一天发布）",
    "online": true,
    "capacity": 12,
    "going": 5,
    "agenda": [
      {
        "time": "20:00",
        "text": "开场"
      },
      {
        "time": "20:10",
        "text": "轮流分享，每人十分钟"
      },
      {
        "time": "21:20",
        "text": "推荐下次的书"
      }
    ],
    "tags": [
      "阅读",
      "线上"
    ]
  },
  {
    "slug": "autumn-city-walk",
    "title": "秋天的城市散步",
    "summary": "沿着老街走两个小时，边走边聊，结束后一起喝茶。",
    "fictional": true,
    "date": "2026-10-01",
    "status": "published",
    "host": "阿澈（虚构）",
    "start": "2026-10-18T09:30",
    "end": "2026-10-18T11:30",
    "place": "示例老街入口（虚构地址）",
    "online": false,
    "capacity": 15,
    "going": 15,
    "agenda": [
      {
        "time": "09:30",
        "text": "集合"
      },
      {
        "time": "10:45",
        "text": "茶馆休息"
      },
      {
        "time": "11:30",
        "text": "解散"
      }
    ],
    "tags": [
      "散步",
      "线下"
    ]
  },
  {
    "slug": "draft-meetup",
    "title": "草稿活动（不公开）",
    "summary": "草稿。",
    "fictional": true,
    "date": "2026-11-07",
    "status": "draft",
    "host": "某人（虚构）",
    "start": "2026-12-20T10:00",
    "end": "2026-12-20T11:00",
    "place": "草稿",
    "online": false,
    "capacity": 5,
    "going": 0,
    "agenda": [
      {
        "time": "10:00",
        "text": "草稿"
      }
    ],
    "tags": []
  }
];
  
  return { items };
}
