/**
 * L60 / v1.60.0 社区周刊演示数据：人物、内容和数字全部虚构。
 */
import type { Item } from '../weekly-core';
import type { State } from './mock-weekly';
import { seed as activitySeed } from './seed-activity';
import { assembleIssue } from '../weekly-core';
export function seed(_base = '/'): State {
  const items: Item[] = [
  {
    "slug": "2026-w45",
    "title": "社区周刊 · 第 45 周",
    "summary": "夜跑约起来了、半马问答有了最佳答案，还有人读完了一本散步散文。",
    "fictional": true,
    "date": "2026-11-08",
    "status": "published",
    "from": "2026-11-02",
    "editor": "小满（虚构）",
    "intro": [
      "这一周社区很热闹：夜跑圈发起了周四夜跑，问答区的半马问题有了被采纳的回答。",
      "下面是从大家的动态里自动整理的本周内容。"
    ],
    "sections": []
  },
  {
    "slug": "2026-w44",
    "title": "社区周刊 · 第 44 周",
    "summary": "厨房小测验上线、合租水电费的讨论有了新回答。",
    "fictional": true,
    "date": "2026-11-01",
    "status": "published",
    "from": "2026-10-26",
    "editor": "小满（虚构）",
    "intro": [
      "第 44 周：周末厨房圈主发布了第一份小测验。"
    ],
    "sections": []
  },
  {
    "slug": "2026-w43",
    "title": "社区周刊 · 第 43 周",
    "summary": "书虫角落开始十一月共读投票。",
    "fictional": true,
    "date": "2026-10-25",
    "status": "published",
    "from": "2026-10-19",
    "editor": "林间（虚构）",
    "intro": [
      "第 43 周比较安静，书虫角落的共读投票开始了。"
    ],
    "sections": []
  },
  {
    "slug": "2026-w46-draft",
    "title": "第 46 周（草稿）",
    "summary": "草稿。",
    "fictional": true,
    "date": "2026-11-09",
    "status": "draft",
    "from": "2026-11-09",
    "editor": "小满（虚构）",
    "intro": [
      "草稿。"
    ],
    "sections": []
  }
];
  const streams = activitySeed().items.filter((s) => s.status === 'published');
  for (const it of items) it.sections = assembleIssue(streams, it.from);
  return { items };
}
