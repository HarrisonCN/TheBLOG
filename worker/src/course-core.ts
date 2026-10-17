/**
 * L40 / v1.40.0 课程笔记（web = worker 逐字相同，纯函数）：
 * 课程校验（课时编号从 1 连续、作业评分量表权重合计 100、得分 0–5 的整数或留空）、摘要与排序（学期倒序）、
 * 量表加权得分（满分 100，有未评项时为 null）、等级、课程完成度。
 */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
export const MAX_LESSONS = 24;
export const MAX_CRITERIA = 8;
export const SCORE_MAX = 5;

export interface Criterion {
  name: string;
  /** 权重（百分比整数，合计 100） */
  weight: number;
  /** 0–5 分；没评分时省略 */
  score?: number;
}
export interface Assignment {
  title: string;
  due: string;
  brief: string;
  rubric: Criterion[];
}
export interface Lesson {
  no: number;
  title: string;
  notes: string[];
  assignment?: Assignment;
}
export interface Item {
  slug: string;
  title: string;
  /** 学期，例如 2026-fall / 2027-spring */
  term: string;
  summary: string;
  lessons: Lesson[];
  date: string;
  status: 'published' | 'draft';
}
export interface Summary {
  slug: string;
  title: string;
  term: string;
  summary: string;
  date: string;
  status: Item['status'];
  lessons: number;
  assignments: number;
  done: number;
}
export interface Issue {
  path: string;
  message: string;
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);
const TERM_RE = /^(\d{4})-(spring|summer|fall|winter)$/;
const TERM_ORDER = { spring: 1, summer: 2, fall: 3, winter: 4 } as const;
export const termLabel = (t: string) => {
  const m = TERM_RE.exec(t);
  return m ? `${m[1]} ${{ spring: '春季', summer: '夏季', fall: '秋季', winter: '冬季' }[m[2] as keyof typeof TERM_ORDER]}学期` : t;
};
const termKey = (t: string) => {
  const m = TERM_RE.exec(t);
  return m ? Number(m[1]) * 10 + TERM_ORDER[m[2] as keyof typeof TERM_ORDER] : 0;
};

export function validateItem(input: unknown, _known?: string[]): { item?: Item; issues: Issue[] } {
  const issues: Issue[] = [];
  const bad = (path: string, message: string) => issues.push({ path, message });
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const slug = typeof o.slug === 'string' && SLUG_RE.test(o.slug) ? o.slug : (bad('slug', '地址只能用小写字母、数字和连字符'), '');
  const title = str(o.title, 60) ?? (bad('title', '课程名必填（≤ 60 字）'), '');
  const term = typeof o.term === 'string' && TERM_RE.test(o.term) ? o.term : (bad('term', '学期格式 YYYY-spring / summer / fall / winter'), '');
  const summary = str(o.summary, 200) ?? (bad('summary', '简介必填（≤ 200 字）'), '');
  const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : (bad('date', '日期格式 YYYY-MM-DD'), '');
  const status = o.status === 'draft' ? 'draft' : o.status === 'published' ? 'published' : (bad('status', '状态只能是 published / draft'), 'draft');
  const lessons: Lesson[] = [];
  if (!Array.isArray(o.lessons) || o.lessons.length < 1 || o.lessons.length > MAX_LESSONS) bad('lessons', `课时 1–${MAX_LESSONS} 节`);
  else
    o.lessons.forEach((l, i) => {
      const x = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>;
      const p = `lessons.${i}`;
      if (x.no !== i + 1) return void bad(`${p}.no`, `课时编号必须从 1 连续（这里应为 ${i + 1}）`);
      const lt = str(x.title, 60);
      if (!lt) return void bad(`${p}.title`, '课时标题必填（≤ 60 字）');
      const notes: string[] = [];
      if (x.notes !== undefined && (!Array.isArray(x.notes) || x.notes.length > 12)) return void bad(`${p}.notes`, '笔记最多 12 段');
      for (const [ni, n] of ((x.notes as unknown[]) ?? []).entries()) {
        const s = str(n, 600);
        if (!s) return void bad(`${p}.notes.${ni}`, '笔记段落不能为空（≤ 600 字）');
        notes.push(s);
      }
      let assignment: Assignment | undefined;
      if (x.assignment !== undefined) {
        const a = (x.assignment && typeof x.assignment === 'object' ? x.assignment : {}) as Record<string, unknown>;
        const at = str(a.title, 60);
        const due = typeof a.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.due) ? a.due : null;
        const brief = str(a.brief, 400);
        if (!at) return void bad(`${p}.assignment.title`, '作业标题必填');
        if (!due) return void bad(`${p}.assignment.due`, '截止日期格式 YYYY-MM-DD');
        if (!brief) return void bad(`${p}.assignment.brief`, '作业要求必填（≤ 400 字）');
        if (!Array.isArray(a.rubric) || a.rubric.length < 1 || a.rubric.length > MAX_CRITERIA) return void bad(`${p}.assignment.rubric`, `评分项 1–${MAX_CRITERIA} 个`);
        const rubric: Criterion[] = [];
        for (const [ci, c] of (a.rubric as unknown[]).entries()) {
          const y = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
          const name = str(y.name, 40);
          const weight = Number.isInteger(y.weight) && (y.weight as number) > 0 && (y.weight as number) <= 100 ? (y.weight as number) : 0;
          if (!name || !weight) return void bad(`${p}.assignment.rubric.${ci}`, '评分项需要名称和 1–100 的整数权重');
          if (y.score !== undefined && !(Number.isInteger(y.score) && (y.score as number) >= 0 && (y.score as number) <= SCORE_MAX)) return void bad(`${p}.assignment.rubric.${ci}.score`, `得分是 0–${SCORE_MAX} 的整数`);
          rubric.push({ name, weight, ...(y.score !== undefined ? { score: y.score as number } : {}) });
        }
        const sum = rubric.reduce((s, c) => s + c.weight, 0);
        if (sum !== 100) return void bad(`${p}.assignment.rubric`, `权重合计必须是 100（现在是 ${sum}）`);
        assignment = { title: at, due, brief, rubric };
      }
      lessons.push({ no: i + 1, title: lt, notes, ...(assignment ? { assignment } : {}) });
    });
  if (issues.length) return { issues };
  return { item: { slug, title, term, summary, lessons, date, status: status as Item['status'] }, issues };
}

/** 加权得分（满分 100，保留一位小数）；有未评分的项时为 null */
export function rubricScore(r: Criterion[]): number | null {
  if (!r.length || r.some((c) => c.score === undefined)) return null;
  return Math.round(r.reduce((s, c) => s + (c.weight * c.score!) / SCORE_MAX, 0) * 10) / 10;
}
export function gradeOf(score: number | null): string {
  if (score === null) return '未评分';
  return score >= 90 ? '优秀' : score >= 80 ? '良好' : score >= 70 ? '中等' : score >= 60 ? '及格' : '不及格';
}
/** 完成度：有笔记的课时数 */
export const doneLessons = (c: Pick<Item, 'lessons'>) => c.lessons.filter((l) => l.notes.length > 0).length;

export function summarize(c: Item): Summary {
  return { slug: c.slug, title: c.title, term: c.term, summary: c.summary, date: c.date, status: c.status, lessons: c.lessons.length, assignments: c.lessons.filter((l) => l.assignment).length, done: doneLessons(c) };
}

/** 学期倒序，再按课程名 */
export function sortItems<T extends { term: string; title: string; slug: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => termKey(b.term) - termKey(a.term) || (a.title < b.title ? -1 : a.title > b.title ? 1 : a.slug < b.slug ? -1 : 1));
}
