/**
 * L52 / v1.52.0 问答区演示数据：人物、内容和数字全部虚构。
 */
import type { Item } from '../qa-core';
import type { State } from './mock-qa';

export function seed(_base = '/'): State {
  const items: Item[] = [
  {
    "slug": "first-marathon-prep",
    "title": "第一次跑半马，赛前一周该怎么安排？",
    "summary": "报名了下个月的半程马拉松，赛前一周不知道该加练还是休息。",
    "fictional": true,
    "date": "2026-11-05",
    "status": "published",
    "asker": "青禾（虚构）",
    "tags": [
      "跑步",
      "训练"
    ],
    "body": [
      "平时每周跑三次，每次 8 公里左右。离比赛还有一周，想知道这周该怎么安排训练和饮食。",
      "另外比赛前一晚要不要多吃碳水？"
    ],
    "answers": [
      {
        "id": "a1",
        "author": "阿澈（虚构）",
        "date": "2026-11-05",
        "text": "赛前一周减量，保留两次轻松跑，最后两天只做慢跑热身。睡眠比加练重要。",
        "votes": 14
      },
      {
        "id": "a2",
        "author": "路人甲（虚构）",
        "date": "2026-11-06",
        "text": "前一晚正常吃，不要尝试没吃过的东西，比赛当天早上提前三小时吃早餐。",
        "votes": 21
      },
      {
        "id": "a3",
        "author": "小满（虚构）",
        "date": "2026-11-06",
        "text": "提前去熟悉起点和存包的位置，能省很多紧张。",
        "votes": 3
      }
    ],
    "accepted": "a1"
  },
  {
    "slug": "rent-share-bills",
    "title": "合租怎么分水电费比较公平？",
    "summary": "三个人合租，房间大小不一样，水电费按人头还是按面积分？",
    "fictional": true,
    "date": "2026-10-30",
    "status": "published",
    "asker": "松果（虚构）",
    "tags": [
      "生活",
      "合租"
    ],
    "body": [
      "三人合租，一间主卧带阳台，两间次卧。目前水电按人头平分，有室友觉得不太公平。"
    ],
    "answers": [
      {
        "id": "r1",
        "author": "豆豆（虚构）",
        "date": "2026-10-31",
        "text": "公共部分按人头，空调这类大件可以装分表或者按房间功率估算。",
        "votes": 9
      },
      {
        "id": "r2",
        "author": "林间（虚构）",
        "date": "2026-11-01",
        "text": "提前写一份简单的合租约定，比事后讨论省心。",
        "votes": 6
      }
    ]
  },
  {
    "slug": "learn-guitar-adult",
    "title": "成年人零基础学吉他，从哪里开始？",
    "summary": "想利用周末学吉他，不知道先买什么琴、看什么教程。",
    "fictional": true,
    "date": "2026-10-22",
    "status": "published",
    "asker": "阿梨（虚构）",
    "tags": [
      "音乐",
      "入门"
    ],
    "body": [
      "完全零基础，预算一千元左右，每周大概能练三四个小时。"
    ],
    "answers": []
  },
  {
    "slug": "draft-question",
    "title": "草稿问题（不公开）",
    "summary": "草稿。",
    "fictional": true,
    "date": "2026-11-07",
    "status": "draft",
    "asker": "某人（虚构）",
    "tags": [],
    "body": [
      "草稿。"
    ],
    "answers": []
  }
];
  
  return { items };
}
