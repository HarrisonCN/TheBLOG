/**
 * L47 / v1.47.0 构图辅助线（演示 mock，与 Worker 同形状）：
 * GET /api/composition（已发布摘要）· GET /api/composition/:slug（已发布全文）· GET /api/admin/composition（含草稿）· GET / PUT / DELETE /api/admin/composition/:slug（校验后写入）。
 * 示例内容全部是虚构的演示数据。
 */
import { sortItems, summarize, validateItem, type Item } from '../composition-core';
import { SocialError } from './mock-social';

export interface State {
  items: Item[];
}
interface Host {
  state(): State;
  commit(mutate: (s: State) => void): void;
}
interface Res {
  status: number;
  body: unknown;
}
const notFound = () => new SocialError(404, 'not_found', '内容不存在');
const bad = (issues: { path: string; message: string }[]) => new SocialError(400, 'validation_error', '参数校验失败', issues);
const SLUG_PATH = /^\/composition\/([a-z0-9-]{1,60})$/;

export class Mock {
  constructor(private h: Host) {}

  routePublic(m: string, path: string): Res | null {
    if (m !== 'GET') return null;
    if (path === '/api/composition') return { status: 200, body: { composition: sortItems(this.h.state().items.filter((x) => x.status === 'published')).map(summarize) } };
    const mt = /^\/api\/composition\/([^/]+)$/.exec(path);
    if (mt) {
      const it = this.h.state().items.find((x) => x.slug === mt[1] && x.status === 'published');
      if (!it) throw notFound();
      return { status: 200, body: { study: it } };
    }
    if (path.startsWith('/api/composition/')) throw notFound();
    return null;
  }

  routeAdmin(m: string, sub: string, body: unknown): Res | null {
    if (sub === '/composition' && m === 'GET') return { status: 200, body: { composition: sortItems(this.h.state().items).map(summarize) } };
    const mt = SLUG_PATH.exec(sub);
    if (!mt) return null;
    const slug = mt[1]!;
    if (m === 'GET') {
      const it = this.h.state().items.find((x) => x.slug === slug);
      if (!it) throw notFound();
      return { status: 200, body: { study: it } };
    }
    if (m === 'PUT') {
      const r = validateItem(body, this.h.state().items.filter((x) => x.slug !== slug).map((x) => x.slug));
      if (!r.item) throw bad(r.issues);
      if (r.item.slug !== slug) throw bad([{ path: 'slug', message: '地址与网址不一致' }]);
      this.h.commit((s) => {
        s.items = [...s.items.filter((x) => x.slug !== slug), r.item!];
      });
      return { status: 200, body: { study: r.item } };
    }
    if (m === 'DELETE') {
      if (!this.h.state().items.some((x) => x.slug === slug)) throw notFound();
      this.h.commit((s) => {
        s.items = s.items.filter((x) => x.slug !== slug);
      });
      return { status: 200, body: { ok: true } };
    }
    return null;
  }
}
