/**
 * L63 / v1.63.0 互助交换演示数据：人物、内容和数字全部虚构。
 */
import type { Item } from '../swap-core';
import type { State } from './mock-swap';

export function seed(_base = '/'): State {
  const items: Item[] = [
  {
    "slug": "swap-novels",
    "title": "几本读完的小说换旅行书",
    "summary": "有五本读完的小说，想换几本旅行随笔或攻略。",
    "fictional": true,
    "date": "2026-11-06",
    "status": "published",
    "kind": "offer",
    "cat": "book",
    "method": "swap",
    "owner": "松果（虚构）",
    "area": "城东（虚构）",
    "wants": "旅行随笔或城市攻略",
    "body": [
      "五本小说都只读过一遍，品相很好。",
      "可以在周末的读书夜现场交换。"
    ],
    "open": true,
    "interested": 4
  },
  {
    "slug": "need-drill",
    "title": "借一个电钻用一下午",
    "summary": "想在墙上装两个置物架，求借电钻。",
    "fictional": true,
    "date": "2026-11-04",
    "status": "published",
    "kind": "request",
    "cat": "tool",
    "method": "borrow",
    "owner": "阿梨（虚构）",
    "area": "城西（虚构）",
    "body": [
      "周六下午用两三个小时，用完当天还，可以请喝奶茶。"
    ],
    "open": true,
    "interested": 2
  },
  {
    "slug": "teach-guitar-basics",
    "title": "免费教吉他入门",
    "summary": "会一点吉他，可以每周教一次入门和弦。",
    "fictional": true,
    "date": "2026-10-29",
    "status": "published",
    "kind": "offer",
    "cat": "skill",
    "method": "free",
    "owner": "阿澈（虚构）",
    "area": "线上",
    "body": [
      "每周日晚上一小时视频，教最基础的几个和弦和扫弦。"
    ],
    "open": true,
    "interested": 9
  },
  {
    "slug": "free-plant-pots",
    "title": "送几个闲置花盆",
    "summary": "搬家多出来的花盆，已经送出去了。",
    "fictional": true,
    "date": "2026-10-20",
    "status": "published",
    "kind": "offer",
    "cat": "stuff",
    "method": "free",
    "owner": "豆豆（虚构）",
    "area": "城南（虚构）",
    "body": [
      "六个大小不一的陶土花盆。"
    ],
    "open": false,
    "result": "已经全部送给周末厨房圈的两位朋友。",
    "interested": 6
  },
  {
    "slug": "draft-swap",
    "title": "草稿互助（不公开）",
    "summary": "草稿。",
    "fictional": true,
    "date": "2026-11-07",
    "status": "draft",
    "kind": "offer",
    "cat": "other",
    "method": "free",
    "owner": "某人（虚构）",
    "area": "草稿",
    "body": [
      "草稿。"
    ],
    "open": true,
    "interested": 0
  }
];
  
  return { items };
}
