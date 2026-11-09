/**
 * L61 / v1.61.0 链接分享演示数据：人物、内容和数字全部虚构。
 */
import type { Item } from '../bookmarks-core';
import type { State } from './mock-bookmarks';

export function seed(_base = '/'): State {
  const items: Item[] = [
  {
    "slug": "slow-web-essay",
    "title": "一篇关于「慢网页」的长文",
    "summary": "作者主张个人网站回到简单：纯文本、少脚本、可以离线看。",
    "fictional": true,
    "date": "2026-11-06",
    "status": "published",
    "url": "https://example.com/essays/slow-web",
    "sharer": "松果（虚构）",
    "tags": [
      "网站",
      "阅读"
    ],
    "note": [
      "读完想把自己的博客再减一减。",
      "文章里列了十条做法，大部分很容易做到。"
    ],
    "votes": 42,
    "comments": [
      {
        "id": "c1",
        "author": "林间（虚构）",
        "text": "「能离线看」这一条深有同感。"
      },
      {
        "id": "c2",
        "author": "小满（虚构）",
        "text": "已转给做网站的朋友。"
      }
    ]
  },
  {
    "slug": "free-cookbook",
    "title": "一本开放授权的家常菜谱",
    "summary": "按季节整理的家常菜，配料和步骤都写得很细。",
    "fictional": true,
    "date": "2026-11-02",
    "status": "published",
    "url": "https://example.org/cookbook",
    "sharer": "豆豆（虚构）",
    "tags": [
      "美食"
    ],
    "note": [
      "周末厨房圈的大家可以一起照着做。"
    ],
    "votes": 58,
    "comments": []
  },
  {
    "slug": "walking-maps",
    "title": "城市步行地图合集",
    "summary": "一个收集各地步行路线的示例网站，可以按距离筛选。",
    "fictional": true,
    "date": "2026-10-24",
    "status": "published",
    "url": "https://www.example.net/walks",
    "sharer": "阿澈（虚构）",
    "tags": [
      "城市",
      "散步"
    ],
    "note": [
      "夜跑圈找新路线的时候很好用。"
    ],
    "votes": 17,
    "comments": [
      {
        "id": "w1",
        "author": "青禾（虚构）",
        "text": "有没有夜跑友好的筛选？"
      }
    ]
  },
  {
    "slug": "draft-link",
    "title": "草稿链接（不公开）",
    "summary": "草稿。",
    "fictional": true,
    "date": "2026-11-07",
    "status": "draft",
    "url": "https://example.com/draft",
    "sharer": "某人（虚构）",
    "tags": [
      "草稿"
    ],
    "note": [
      "草稿。"
    ],
    "votes": 0,
    "comments": []
  }
];
  
  return { items };
}
