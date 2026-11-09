/**
 * L54 / v1.54.0 关注与动态流演示数据：人物、内容和数字全部虚构。
 */
import type { Item } from '../activity-core';
import type { State } from './mock-activity';

export function seed(_base = '/'): State {
  const items: Item[] = [
  {
    "slug": "azhe",
    "title": "阿澈的动态",
    "summary": "夜跑圈圈主，喜欢城市夜景和慢跑。",
    "fictional": true,
    "date": "2026-11-06",
    "status": "published",
    "member": "阿澈（虚构）",
    "bio": "夜跑圈圈主，周四晚上通常在江边。",
    "interests": [
      "跑步",
      "城市"
    ],
    "followers": 86,
    "entries": [
      {
        "id": "z1",
        "at": "2026-11-02T20:10",
        "verb": "post",
        "text": "在兴趣圈子「夜跑与夜走」发起周四夜跑。"
      },
      {
        "id": "z2",
        "at": "2026-11-05T22:40",
        "verb": "answer",
        "text": "回答了「第一次跑半马，赛前一周该怎么安排？」"
      },
      {
        "id": "z3",
        "at": "2026-11-06T07:15",
        "verb": "vote",
        "text": "参与了投票「这个周末你打算做什么？」"
      },
      {
        "id": "z4",
        "at": "2026-11-06T21:30",
        "verb": "share",
        "text": "分享了三条有路灯的夜跑环线。"
      }
    ]
  },
  {
    "slug": "linjian",
    "title": "林间的动态",
    "summary": "书虫角落圈主，每月共读一本书。",
    "fictional": true,
    "date": "2026-11-04",
    "status": "published",
    "member": "林间（虚构）",
    "bio": "书虫角落的圈主，最近在读散文集。",
    "interests": [
      "阅读",
      "散文"
    ],
    "followers": 140,
    "entries": [
      {
        "id": "l1",
        "at": "2026-10-20T19:00",
        "verb": "post",
        "text": "发起十一月共读书目投票。"
      },
      {
        "id": "l2",
        "at": "2026-11-01T10:20",
        "verb": "answer",
        "text": "回答了「合租怎么分水电费比较公平？」"
      },
      {
        "id": "l3",
        "at": "2026-11-04T23:05",
        "verb": "read",
        "text": "读完了一本关于城市散步的散文集。"
      }
    ]
  },
  {
    "slug": "doudou",
    "title": "豆豆的动态",
    "summary": "周末厨房圈主，爱做家常菜。",
    "fictional": true,
    "date": "2026-10-30",
    "status": "published",
    "member": "豆豆（虚构）",
    "bio": "周末厨房圈主，正在练习做面包。",
    "interests": [
      "美食",
      "烘焙"
    ],
    "followers": 52,
    "entries": [
      {
        "id": "d1",
        "at": "2026-10-29T12:00",
        "verb": "post",
        "text": "发布了小测验「厨房常识小测验」。"
      },
      {
        "id": "d2",
        "at": "2026-10-30T18:45",
        "verb": "join",
        "text": "加入了兴趣圈子「书虫角落」。"
      }
    ]
  },
  {
    "slug": "draft-stream",
    "title": "草稿成员（不公开）",
    "summary": "草稿。",
    "fictional": true,
    "date": "2026-11-07",
    "status": "draft",
    "member": "某人（虚构）",
    "bio": "草稿。",
    "interests": [],
    "followers": 0,
    "entries": [
      {
        "id": "x",
        "at": "2026-11-07T10:00",
        "verb": "post",
        "text": "草稿。"
      }
    ]
  }
];
  
  return { items };
}
