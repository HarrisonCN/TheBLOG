/**
 * L40 / v1.40.0 课程笔记：
 * - course-core（web = worker 同一份）：校验（课时编号从 1 连续、量表权重合计 100、得分 0–5 整数或留空、学期格式）、
 *   加权得分与等级、完成度、摘要、学期倒序；
 * - 演示 mock 与 Worker 同形状：GET /api/courses、/api/courses/:slug、站长 PUT / DELETE /api/admin/courses/:slug；
 * - 新路由 /courses/（专题 › 课程笔记）与 /courses/:slug/：课时目录（锚点）+ 笔记 + 作业评分量表表格，没有 JS 也完整。
 */
import { describe, expect, it } from 'vitest';
import { doneLessons, gradeOf, rubricScore, sortItems, summarize, termLabel, validateItem, type Item } from '../src/course-core';
import { parseRoute, renderRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';
import { DemoBackend, memoryKV } from '../src/demo/mock-api';
import { DEMO_PASSWORD } from '../src/demo/seed';

const course = (over: Partial<Item> = {}): Item => ({
  slug: 'test-course',
  title: '测试课程',
  term: '2026-fall',
  summary: '一门测试课程。',
  lessons: [
    { no: 1, title: '第一课', notes: ['笔记'] },
    { no: 2, title: '第二课', notes: [], assignment: { title: '作业', due: '2026-10-20', brief: '拍一组照片', rubric: [{ name: '曝光', weight: 60, score: 5 }, { name: '构图', weight: 40, score: 3 }] } },
  ],
  date: '2026-10-15',
  status: 'published',
  ...over,
});
const hw = (rubric: { name: string; weight: number; score?: number }[]) => course({ lessons: [{ no: 1, title: 'a', notes: [], assignment: { title: 'x', due: '2026-10-01', brief: 'y', rubric } }] });

describe('course-core 校验', () => {
  it('合法课程通过', () => {
    expect(validateItem(course()).issues).toEqual([]);
  });
  it('课时编号必须从 1 连续', () => {
    expect(validateItem(course({ lessons: [{ no: 1, title: 'a', notes: [] }, { no: 3, title: 'b', notes: [] }] })).issues).toEqual([{ path: 'lessons.1.no', message: '课时编号必须从 1 连续（这里应为 2）' }]);
  });
  it('量表：权重合计 100、得分 0–5 整数', () => {
    expect(validateItem(hw([{ name: 'a', weight: 50 }, { name: 'b', weight: 40 }])).issues[0]!.message).toBe('权重合计必须是 100（现在是 90）');
    expect(validateItem(hw([{ name: 'a', weight: 100, score: 6 }])).issues.map((i) => i.path)).toEqual(['lessons.0.assignment.rubric.0.score']);
    expect(validateItem(hw([{ name: 'a', weight: 100, score: 2.5 }])).issues.map((i) => i.path)).toEqual(['lessons.0.assignment.rubric.0.score']);
    expect(validateItem(hw([{ name: '', weight: 100 }])).issues.map((i) => i.path)).toEqual(['lessons.0.assignment.rubric.0']);
  });
  it('学期格式与必填字段', () => {
    expect(validateItem(course({ term: '2026 秋' })).issues.map((i) => i.path)).toEqual(['term']);
    expect(validateItem({ slug: 'X', title: '', summary: '', term: '', date: '1', status: 'x' }).issues.map((i) => i.path).sort()).toEqual(['date', 'lessons', 'slug', 'status', 'summary', 'term', 'title']);
    expect(termLabel('2026-fall')).toBe('2026 秋季学期');
  });
});

describe('course-core 评分与排序', () => {
  it('加权得分、未评分为 null、等级', () => {
    expect(rubricScore([{ name: 'a', weight: 60, score: 5 }, { name: 'b', weight: 40, score: 3 }])).toBe(84);
    expect(rubricScore([{ name: 'a', weight: 100, score: 4 }])).toBe(80);
    expect(rubricScore([{ name: 'a', weight: 50, score: 4 }, { name: 'b', weight: 50 }])).toBeNull();
    expect([gradeOf(95), gradeOf(84), gradeOf(70), gradeOf(60), gradeOf(59.9), gradeOf(null)]).toEqual(['优秀', '良好', '中等', '及格', '不及格', '未评分']);
  });
  it('完成度、摘要、学期倒序', () => {
    expect(doneLessons(course())).toBe(1);
    expect(summarize(course())).toMatchObject({ lessons: 2, assignments: 1, done: 1 });
    const l = [course({ slug: 'a', term: '2026-spring' }), course({ slug: 'b', term: '2026-fall' }), course({ slug: 'c', term: '2025-winter' })];
    expect(sortItems(l).map((x) => x.slug)).toEqual(['b', 'a', 'c']);
  });
});

describe('路由与页面', () => {
  const site = { settings: { siteTitle: 't', siteDescription: '', postsPerPage: 10 }, profile: {}, posts: [], total: 0, tags: [], categories: [] } as never;
  it('路由往返；专题 › 课程笔记', () => {
    expect(parseRoute('/courses/')).toEqual({ name: 'courses' });
    expect(parseRoute('/courses/photo-basics/')).toEqual({ name: 'course', slug: 'photo-basics' });
    expect(routePath({ name: 'course', slug: 'x1' } as never)).toBe('/courses/x1/');
    expect(sectionOf('courses' as never)?.id).toBe('curation');
    expect(sectionOf('course' as never)?.id).toBe('curation');
    expect(findEntry('curation', 'courses' as never)?.href).toBe('/courses/');
  });
  it('课程页：目录锚点、h2 课时、h3 作业、量表表格（行标题、加权总分与等级）；待整理提示；转义', () => {
    const p = renderRoute({ name: 'course', slug: 'test-course' } as never, site, { course: course({ summary: '<b>x</b>' }) } as never);
    expect(p.main).toContain('href="#lesson-2"');
    expect(p.main).toContain('id="lesson-2"');
    expect(p.main).toMatch(/<h2 class="cs-lesson__h" id="lesson-h-1">第 1 课 · 第一课<\/h2>/);
    expect(p.main).toMatch(/<h3 class="cs-hw__h" id="hw-2">作业：作业<\/h3>/);
    expect(p.main).toContain('<caption>评分量表（满分 100）</caption>');
    expect(p.main).toContain('<th scope="row">曝光</th><td>60%</td><td>5 / 5</td>');
    expect(p.main).toContain('84 分 · 良好');
    expect(p.main).toContain('（待整理）');
    expect(p.main).toContain('已整理 1 / 2');
    expect(p.main).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
  it('列表页按学期分组；空列表；404', () => {
    const l = renderRoute({ name: 'courses' } as never, site, { courses: [summarize(course()), summarize(course({ slug: 'b', term: '2026-spring' }))] } as never);
    expect(l.main.indexOf('2026 秋季学期')).toBeLessThan(l.main.indexOf('2026 春季学期'));
    expect(l.main).toContain('2 节课 · 1 份作业 · 已整理 1 / 2');
    expect(renderRoute({ name: 'courses' } as never, site, { courses: [] } as never).main).toMatch(/还没有课程笔记/);
    expect(renderRoute({ name: 'course', slug: 'nope' } as never, site, {} as never).title).toMatch(/404|找不到|不存在/);
  });
});

describe('演示 mock /api/courses', () => {
  const api = () => new DemoBackend({ storage: memoryKV(), base: '/TheBLOG/', now: () => new Date(Date.UTC(2026, 9, 17, 12)) });
  it('示例课程：2 门已发布、学期倒序、都合法、草稿不公开', async () => {
    const b = api();
    const l = (await b.handle('GET', '/api/courses')).body as { courses: { slug: string }[] };
    expect(l.courses.map((x) => x.slug)).toEqual(['photo-basics', 'darkroom-film']);
    for (const s of l.courses) expect(validateItem(((await b.handle('GET', `/api/courses/${s.slug}`)).body as { course: Item }).course).issues).toEqual([]);
    expect((await b.handle('GET', '/api/courses/draft-course')).status).toBe(404);
  });
  it('站长 PUT / DELETE；非站长 401；权重不对 400', async () => {
    const b = api();
    expect((await b.handle('PUT', '/api/admin/courses/test-course', course())).status).toBe(401);
    const adm = { 'x-csrf-token': ((await b.handle('POST', '/api/auth/login', { password: DEMO_PASSWORD })).body as any).csrfToken };
    expect((await b.handle('PUT', '/api/admin/courses/test-course', course(), adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/courses/test-course')).status).toBe(200);
    expect((await b.handle('PUT', '/api/admin/courses/test-course', { ...hw([{ name: 'a', weight: 10 }]), slug: 'test-course' }, adm)).status).toBe(400);
    expect((await b.handle('DELETE', '/api/admin/courses/test-course', undefined, adm)).status).toBe(200);
    expect((await b.handle('GET', '/api/courses/test-course')).status).toBe(404);
  });
});
