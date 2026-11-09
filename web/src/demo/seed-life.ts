/**
 * L64 / v1.64.0 生活专栏演示数据：人物、内容和数字全部虚构。
 */
import type { Item } from '../life-core';
import type { State } from './mock-life';

export function seed(_base = '/'): State {
  const items: Item[] = [
  {
    "slug": "tomato-egg-noodles",
    "title": "番茄鸡蛋面",
    "summary": "一碗十五分钟就能做好的家常面，酸甜开胃。",
    "fictional": true,
    "date": "2026-11-06",
    "status": "published",
    "kind": "recipe",
    "author": "豆豆（虚构）",
    "tags": [
      "家常菜",
      "快手"
    ],
    "intro": [
      "周末厨房圈点赞最多的一道快手面。",
      "番茄要炒出沙，汤才会浓。"
    ],
    "servings": 2,
    "minutes": 15,
    "ingredients": [
      {
        "name": "挂面",
        "amount": 200,
        "unit": "克"
      },
      {
        "name": "番茄",
        "amount": 2,
        "unit": "个"
      },
      {
        "name": "鸡蛋",
        "amount": 3,
        "unit": "个"
      },
      {
        "name": "葱花",
        "amount": 0,
        "unit": "把"
      },
      {
        "name": "盐",
        "amount": 3,
        "unit": "克"
      }
    ],
    "steps": [
      "番茄切块，鸡蛋打散。",
      "热油炒蛋，盛出备用。",
      "番茄下锅炒出汁，加一碗水煮开。",
      "下面条煮熟，倒回鸡蛋，加盐和葱花。"
    ]
  },
  {
    "slug": "weekend-old-town",
    "title": "两天一夜的老城散步",
    "summary": "不赶景点，只在老城里慢慢走，吃三顿好的。",
    "fictional": true,
    "date": "2026-10-30",
    "status": "published",
    "kind": "travel",
    "author": "阿澈（虚构）",
    "tags": [
      "散步",
      "周末"
    ],
    "intro": [
      "一座虚构的江边老城，适合两天一夜慢慢走。"
    ],
    "place": "某江边老城（虚构）",
    "days": 2,
    "stops": [
      {
        "day": 1,
        "name": "老街",
        "note": "下午到，先沿老街走到江边看日落。"
      },
      {
        "day": 1,
        "name": "夜市",
        "note": "晚饭在夜市解决。"
      },
      {
        "day": 2,
        "name": "早茶馆",
        "note": "早上七点去，人少。"
      },
      {
        "day": 2,
        "name": "城墙",
        "note": "绕一段城墙再回程。"
      }
    ]
  },
  {
    "slug": "braised-tofu",
    "title": "家常红烧豆腐",
    "summary": "外焦里嫩的红烧豆腐，下饭神器。",
    "fictional": true,
    "date": "2026-10-21",
    "status": "published",
    "kind": "recipe",
    "author": "阿梨（虚构）",
    "tags": [
      "家常菜",
      "素菜"
    ],
    "intro": [
      "豆腐先煎再烧，不容易碎。"
    ],
    "servings": 3,
    "minutes": 75,
    "ingredients": [
      {
        "name": "老豆腐",
        "amount": 450,
        "unit": "克"
      },
      {
        "name": "生抽",
        "amount": 15,
        "unit": "毫升"
      },
      {
        "name": "老抽",
        "amount": 5,
        "unit": "毫升"
      }
    ],
    "steps": [
      "豆腐切块，煎到两面金黄。",
      "加生抽、老抽和半碗水，小火烧十分钟。",
      "大火收汁出锅。"
    ]
  },
  {
    "slug": "draft-life",
    "title": "草稿专栏（不公开）",
    "summary": "草稿。",
    "fictional": true,
    "date": "2026-11-07",
    "status": "draft",
    "kind": "travel",
    "author": "某人（虚构）",
    "tags": [],
    "intro": [
      "草稿。"
    ],
    "place": "草稿",
    "days": 1,
    "stops": [
      {
        "day": 1,
        "name": "草稿",
        "note": "草稿"
      }
    ]
  }
];
  
  return { items };
}
