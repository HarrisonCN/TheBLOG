/**
 * L55 / v1.55.0 接龙写作演示数据：人物、内容和数字全部虚构。
 */
import type { Item } from '../relay-core';
import type { State } from './mock-relay';

export function seed(_base = '/'): State {
  const items: Item[] = [
  {
    "slug": "lighthouse-keeper",
    "title": "灯塔看守人的最后一晚",
    "summary": "一座即将停用的灯塔，一位看守人，还有一封迟到了三十年的信。",
    "fictional": true,
    "date": "2026-11-05",
    "status": "published",
    "starter": "青禾（虚构）",
    "prompt": "灯塔明天就要停用了，看守人在值最后一班夜岗时，收到了一封三十年前寄出的信。",
    "maxTurns": 8,
    "paragraphs": [
      {
        "n": 1,
        "author": "青禾（虚构）",
        "text": "海风把门吹得吱呀作响。老周把最后一壶茶倒进杯子，邮差却在这时敲响了灯塔的门——没有人会在半夜送信。"
      },
      {
        "n": 2,
        "author": "松果（虚构）",
        "text": "信封已经发黄，邮戳上的日期是三十年前的今天。收信人那一栏，写的正是他自己的名字，字迹却像是他年轻时的。"
      },
      {
        "n": 3,
        "author": "阿梨（虚构）",
        "text": "他没有马上拆开，而是先爬上灯室，把灯点亮。光一圈一圈扫过海面，远处好像有一艘船，正朝这里慢慢靠近。"
      }
    ]
  },
  {
    "slug": "robot-bakery",
    "title": "机器人面包店",
    "summary": "一台只会烤面包的机器人，接到了它的第一份生日蛋糕订单。",
    "fictional": true,
    "date": "2026-10-26",
    "status": "published",
    "starter": "豆豆（虚构）",
    "prompt": "小镇上有一家只由一台机器人经营的面包店，有一天它收到了一份蛋糕订单。",
    "maxTurns": 4,
    "paragraphs": [
      {
        "n": 1,
        "author": "豆豆（虚构）",
        "text": "烤箱型号 B-7 每天清晨五点开工，十年来只烤三种面包。今天柜台上放着一张手写卡片：「请做一个生日蛋糕。」"
      },
      {
        "n": 2,
        "author": "小满（虚构）",
        "text": "它的程序里没有蛋糕。B-7 在镇上的图书馆查了一整晚食谱，把每一步都写进了临时内存。"
      },
      {
        "n": 3,
        "author": "林间（虚构）",
        "text": "第一个蛋糕塌了，第二个糊了。第三个出炉时，天刚亮，卡片背面多了一行小字：「做成什么样都好，我只是想有人记得我。」"
      },
      {
        "n": 4,
        "author": "豆豆（虚构）",
        "text": "那天下午，B-7 第一次在橱窗里放了一块牌子：「本店今日起接受蛋糕订单，失败了也不收钱。」"
      }
    ]
  },
  {
    "slug": "last-train",
    "title": "末班车上的陌生人",
    "summary": "深夜末班车上，只剩下你和一个拿着旧地图的人。",
    "fictional": true,
    "date": "2026-10-12",
    "status": "published",
    "starter": "阿澈（虚构）",
    "prompt": "末班地铁上只剩下两个人，其中一个拿着一张已经不存在的线路图。",
    "maxTurns": 10,
    "paragraphs": [
      {
        "n": 1,
        "author": "阿澈（虚构）",
        "text": "车厢的灯闪了两下。对面的人展开一张泛黄的线路图，上面有一站我从来没听说过：「芦花渡」。"
      }
    ]
  },
  {
    "slug": "draft-relay",
    "title": "草稿接龙（不公开）",
    "summary": "草稿。",
    "fictional": true,
    "date": "2026-11-07",
    "status": "draft",
    "starter": "某人（虚构）",
    "prompt": "草稿。",
    "maxTurns": 3,
    "paragraphs": [
      {
        "n": 1,
        "author": "某人（虚构）",
        "text": "草稿。"
      }
    ]
  }
];
  
  return { items };
}
