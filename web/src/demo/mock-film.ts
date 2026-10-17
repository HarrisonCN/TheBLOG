/**
 * L46 / v1.46.0 胶片记录（演示 mock，与 Worker 同形状）：
 * GET /api/film（已发布摘要）· GET /api/film/:slug（已发布全文）· GET /api/admin/film（含草稿）· GET / PUT / DELETE /api/admin/film/:slug（校验后写入）。
 * 示例内容全部是虚构的演示数据。
 */
import { sortItems, summarize, validateItem, type Item } from '../film-core';
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
const SLUG_PATH = /^\/film\/([a-z0-9-]{1,60})$/;

export class Mock {
  constructor(private h: Host) {}

  routePublic(m: string, path: string): Res | null {
    if (m !== 'GET') return null;
    if (path === '/api/film') return { status: 200, body: { film: sortItems(this.h.state().items.filter((x) => x.status === 'published')).map(summarize) } };
    const mt = /^\/api\/film\/([^/]+)$/.exec(path);
    if (mt) {
      const it = this.h.state().items.find((x) => x.slug === mt[1] && x.status === 'published');
      if (!it) throw notFound();
      return { status: 200, body: { roll: it } };
    }
    if (path.startsWith('/api/film/')) throw notFound();
    return null;
  }

  routeAdmin(m: string, sub: string, body: unknown): Res | null {
    if (sub === '/film' && m === 'GET') return { status: 200, body: { film: sortItems(this.h.state().items).map(summarize) } };
    const mt = SLUG_PATH.exec(sub);
    if (!mt) return null;
    const slug = mt[1]!;
    if (m === 'GET') {
      const it = this.h.state().items.find((x) => x.slug === slug);
      if (!it) throw notFound();
      return { status: 200, body: { roll: it } };
    }
    if (m === 'PUT') {
      const r = validateItem(body, this.h.state().items.filter((x) => x.slug !== slug).map((x) => x.slug));
      if (!r.item) throw bad(r.issues);
      if (r.item.slug !== slug) throw bad([{ path: 'slug', message: '地址与网址不一致' }]);
      this.h.commit((s) => {
        s.items = [...s.items.filter((x) => x.slug !== slug), r.item!];
      });
      return { status: 200, body: { roll: r.item } };
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
