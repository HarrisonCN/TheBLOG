/**
 * L65 / v1.65.0 社区守则与治理演示数据：人物、内容和数字全部虚构。
 */
import type { Item } from '../guidelines-core';
import type { State } from './mock-guidelines';

export function seed(_base = '/'): State {
  const items: Item[] = [
  {
    "slug": "be-kind",
    "title": "友善交流",
    "summary": "对事不对人：可以不同意，但不攻击人。",
    "fictional": true,
    "date": "2026-11-06",
    "status": "published",
    "chapter": 1,
    "rules": [
      {
        "id": "1.1",
        "text": "讨论观点，不评价人格。",
        "example": "「这个方法我试过不太行」可以；「你懂什么」不行。"
      },
      {
        "id": "1.2",
        "text": "不发起或参与针对个人的围攻。"
      },
      {
        "id": "1.3",
        "text": "新人提问请耐心，重复的问题可以给出链接。",
        "example": "把置顶的使用说明发给他。"
      }
    ],
    "actions": [
      "第一次：私下提醒并隐藏相关内容。",
      "多次或情节严重：删除内容并警告，仍不改正的暂停发言。"
    ],
    "log": [
      {
        "month": "2026-10",
        "reports": 18,
        "removed": 5,
        "warned": 6,
        "dismissed": 6
      },
      {
        "month": "2026-09",
        "reports": 12,
        "removed": 3,
        "warned": 4,
        "dismissed": 5
      }
    ]
  },
  {
    "slug": "protect-privacy",
    "title": "保护隐私",
    "summary": "不公开任何人的联系方式、住址和不愿公开的信息。",
    "fictional": true,
    "date": "2026-11-03",
    "status": "published",
    "chapter": 2,
    "rules": [
      {
        "id": "2.1",
        "text": "不公开他人的手机号、邮箱、住址、单位。"
      },
      {
        "id": "2.2",
        "text": "分享路线和照片时，避免暴露具体住址。",
        "example": "夜跑路线标到街道即可。"
      },
      {
        "id": "2.3",
        "text": "树洞和匿名内容不得追问或猜测作者身份。"
      }
    ],
    "actions": [
      "涉及隐私的内容一经确认立即删除，并通知被涉及的人（如能联系到）。"
    ],
    "log": [
      {
        "month": "2026-10",
        "reports": 7,
        "removed": 5,
        "warned": 1,
        "dismissed": 1
      },
      {
        "month": "2026-09",
        "reports": 4,
        "removed": 2,
        "warned": 0,
        "dismissed": 1
      }
    ]
  },
  {
    "slug": "content-copyright",
    "title": "内容与版权",
    "summary": "发自己的内容；转载注明来源；不发广告。",
    "fictional": true,
    "date": "2026-10-28",
    "status": "published",
    "chapter": 3,
    "rules": [
      {
        "id": "3.1",
        "text": "图片和文字尽量是自己的作品，转载要注明作者和来源。"
      },
      {
        "id": "3.2",
        "text": "不发广告和引流内容，互助交换不涉及金钱交易。"
      }
    ],
    "actions": [
      "未注明来源的转载先提醒补充，无法补充的删除。",
      "广告内容直接删除。"
    ],
    "log": [
      {
        "month": "2026-10",
        "reports": 9,
        "removed": 6,
        "warned": 2,
        "dismissed": 1
      }
    ]
  },
  {
    "slug": "draft-guideline",
    "title": "草稿章节（不公开）",
    "summary": "草稿。",
    "fictional": true,
    "date": "2026-11-07",
    "status": "draft",
    "chapter": 4,
    "rules": [
      {
        "id": "4.1",
        "text": "草稿。"
      }
    ],
    "actions": [
      "草稿。"
    ],
    "log": []
  }
];
  
  return { items };
}
