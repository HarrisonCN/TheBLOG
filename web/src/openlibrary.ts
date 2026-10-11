/**
 * 书影音后台：从 Open Library 公开搜索 API 找书和封面（匿名只读，允许 CORS，不抓取网页）。
 * https://openlibrary.org/dev/docs/api/search · 封面 https://covers.openlibrary.org/b/id/{cover_i}-M.jpg
 */
export interface BookHit {
  key: string;
  title: string;
  creator: string;
  year: string;
  cover: string;
}

export function searchUrl(title: string, author = '', limit = 6): string {
  const q = new URLSearchParams({ title: title.trim().slice(0, 100), limit: String(Math.min(10, Math.max(1, limit))), fields: 'key,title,author_name,first_publish_year,cover_i' });
  if (author.trim()) q.set('author', author.trim().slice(0, 60));
  return `https://openlibrary.org/search.json?${q}`;
}

const TEXT_OK = /^[^\u0000-\u001f\u007f<>]*$/;
const clean = (v: unknown, max: number) => (typeof v === 'string' && TEXT_OK.test(v) ? v.trim().slice(0, max) : '');

/** 只取需要的字段并清洗；没有封面的结果也保留（封面留空）。 */
export function parseSearch(json: unknown): BookHit[] {
  const docs = (json && typeof json === 'object' && Array.isArray((json as { docs?: unknown }).docs) ? (json as { docs: unknown[] }).docs : []) as Record<string, unknown>[];
  return docs.slice(0, 10).flatMap((d) => {
    const title = clean(d.title, 60);
    if (!title) return [];
    const id = typeof d.cover_i === 'number' && Number.isInteger(d.cover_i) && d.cover_i > 0 ? d.cover_i : 0;
    const authors = Array.isArray(d.author_name) ? d.author_name.filter((a): a is string => typeof a === 'string') : [];
    const year = typeof d.first_publish_year === 'number' && d.first_publish_year > 0 && d.first_publish_year < 3000 ? String(d.first_publish_year) : '';
    const key = typeof d.key === 'string' && /^\/works\/OL\d+W$/.test(d.key) ? d.key : '';
    return [{ key, title, creator: clean(authors.slice(0, 2).join(' / '), 60), year, cover: id ? `https://covers.openlibrary.org/b/id/${id}-M.jpg` : '' }];
  });
}

export async function searchBooks(title: string, author = '', signal?: AbortSignal): Promise<BookHit[]> {
  const r = await fetch(searchUrl(title, author), { signal, headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`Open Library ${r.status}`);
  return parseSearch(await r.json());
}
