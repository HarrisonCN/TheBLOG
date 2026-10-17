/**
 * L33 / v1.33.0 视觉杂志（演示 mock，与 Worker 同形状）：
 * GET /api/magazine（已发布期刊摘要，期号倒序）· GET /api/magazine/:slug（已发布的一期全文）·
 * GET /api/admin/magazine（含草稿）· PUT /api/admin/magazine/:slug（校验后整期写入）· DELETE /api/admin/magazine/:slug。
 * 示例期刊用演示站自带的 Wikimedia Commons 照片（署名随图），文字是为演示写的，标题都标「示例」。
 */
import { issueSummary, sortIssues, validateIssue, type Issue, type MagImage } from '../magazine-core';
import { SocialError } from './mock-social';
import { PHOTO_CREDITS } from './seed';

export interface MagazineState {
  issues: Issue[];
}
interface Host {
  state(): MagazineState;
  commit(mutate: (s: MagazineState) => void): void;
}
interface Res {
  status: number;
  body: unknown;
}

export function magazineSeed(base = '/'): MagazineState {
  const b = base.endsWith('/') ? base : `${base}/`;
  const im = (key: string, alt: string): MagImage => {
    const c = PHOTO_CREDITS[key];
    return { src: `${b}demo/photos/${key}-1280.webp`, alt, w: 1280, h: c?.width && c?.height ? Math.round((1280 * c.height) / c.width) : 853, ...(c ? { credit: `${c.author} · ${c.license}` } : {}) };
  };
  const issues: Issue[] = [
    {
      slug: 'issue-02-coast',
      no: 2,
      title: '示例第 2 期：海岸线',
      date: '2026-10',
      status: 'published',
      cover: im('porto-covo', '海边的悬崖和小海湾，海水是青绿色'),
      editorNote: '这是一本示例杂志：照片来自 Wikimedia Commons（署名在每张图下面），文字为演示而写。这一期沿着海岸线走，从清晨的港口到入夜的海湾。',
      pieces: [
        { kind: 'feature', title: '海边的一天', dek: '同一个地方拍一整天，光线自己会讲故事', ref: 'demo-essay-seaside', images: [im('harbour-castle', '清晨的港口，城堡还在阴影里')] },
        { kind: 'spread', title: '正午的图案', dek: '顶光不适合拍人，却很适合拍图案', images: [im('beach-parasols', '沙滩上排成行的遮阳伞'), im('baltic-view', '高处看下去的海岸和森林')] },
        { kind: 'quote', text: '先拍全景交代环境，再走近拍细节。', by: '示例手记' },
        {
          kind: 'gallery',
          title: '海岸线',
          images: [
            im('porto-covo', '海边的悬崖和小海湾'),
            im('palm-sunset', '棕榈树剪影后面的日落'),
            im('harbour-night', '入夜的海湾，高楼的灯亮起来'),
            im('field-bindweed', '海边草地上的旋花'),
          ],
        },
        { kind: 'brief', title: '下期预告', text: '下一期去山里：雪线、湖面和一条林间公路。' },
      ],
    },
    {
      slug: 'issue-01-mountains',
      no: 1,
      title: '示例第 1 期：山与湖',
      date: '2026-09',
      status: 'published',
      cover: im('hero-lake', '日出时的高山湖泊，湖面倒映着山影'),
      editorNote: '创刊号（示例）。把几张山和湖的照片排成一本小杂志，试试对页、画廊和引语这几种版式。',
      pieces: [
        { kind: 'feature', title: '山与湖的网格', dek: '网格版式里的对称和节奏', ref: 'demo-essay-mountains', images: [im('montriond-lake', '被山围着的湖，岸边有树林')] },
        { kind: 'spread', title: '雪线', images: [im('himalayas', '云层之上的雪山'), im('alpine-sunset', '夕阳照在阿尔卑斯山脊上'), im('snina-winter', '冬天覆雪的小山村')] },
        { kind: 'quote', text: '风光照的主角往往不是山，是那一刻的光。', by: '示例手记' },
        { kind: 'gallery', title: '林间', images: [im('forest-road', '秋天林间的公路'), im('panixersee', '高山湖边的草地'), im('guilin-pagodas', '湖上的两座塔')] },
        { kind: 'brief', title: '关于这本杂志', text: '每一期都由站长在后台整理；内容来自站内文章、影集和作品。' },
      ],
    },
  ];
  return { issues };
}

const bad = (details: { path: string; message: string }[]) => new SocialError(400, 'validation_error', '参数校验失败', details);
const notFound = () => new SocialError(404, 'not_found', '这一期不存在');
const SLUG_PATH = /^\/magazine\/([a-z0-9-]{1,40})$/;

export class MockMagazine {
  constructor(private h: Host) {}

  routePublic(m: string, path: string): Res | null {
    if (m !== 'GET') return null;
    if (path === '/api/magazine') return { status: 200, body: { issues: sortIssues(this.h.state().issues.filter((i) => i.status === 'published')).map(issueSummary) } };
    const mt = /^\/api\/magazine\/([^/]+)$/.exec(path);
    if (mt) {
      const issue = this.h.state().issues.find((i) => i.slug === mt[1] && i.status === 'published');
      if (!issue) throw notFound();
      return { status: 200, body: { issue } };
    }
    return null;
  }

  routeAdmin(m: string, sub: string, body: unknown): Res | null {
    if (sub === '/magazine' && m === 'GET') return { status: 200, body: { issues: sortIssues(this.h.state().issues).map(issueSummary) } };
    const mt = SLUG_PATH.exec(sub);
    if (!mt) return null;
    const slug = mt[1]!;
    if (m === 'GET') {
      const issue = this.h.state().issues.find((i) => i.slug === slug);
      if (!issue) throw notFound();
      return { status: 200, body: { issue } };
    }
    if (m === 'PUT') {
      const r = validateIssue(body);
      if (!r.issue) throw bad(r.issues);
      if (r.issue.slug !== slug) throw bad([{ path: 'slug', message: '地址与网址不一致' }]);
      const clash = this.h.state().issues.find((i) => i.no === r.issue!.no && i.slug !== slug);
      if (clash) throw bad([{ path: 'no', message: `第 ${clash.no} 期已经存在` }]);
      this.h.commit((s) => {
        s.issues = [...s.issues.filter((i) => i.slug !== slug), r.issue!];
      });
      return { status: 200, body: { issue: r.issue } };
    }
    if (m === 'DELETE') {
      if (!this.h.state().issues.some((i) => i.slug === slug)) throw notFound();
      this.h.commit((s) => {
        s.issues = s.issues.filter((i) => i.slug !== slug);
      });
      return { status: 200, body: { ok: true } };
    }
    return null;
  }
}
