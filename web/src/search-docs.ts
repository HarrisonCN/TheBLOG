/**
 * L26：把各处的数据统一成 search-core 的 SearchDoc（纯函数，href 不含站点前缀）。
 * 文章（/api/search-index + 文章摘要里的发布时间 / 系列）、作品（/works/ 锚点）、影集（/gallery/:slug/）、
 * 创作者（/u/:username/）、话题（/t/:slug/）。
 */
import type { SearchDoc } from './search-core';

interface PostIdx { slug: string; title: string; summary: string; tags: string[]; category: string | null; text?: string }
interface PostMeta { slug: string; publishedAt?: string | null; updatedAt?: string | null; series?: string | null }
interface WorkLike { id: string; title: string; series: string; date: string; location: string; camera: string; lens: string; tags: string[] }
interface AlbumLike { slug: string; title: string; description: string; date: string; cover?: string; photos: { caption?: string }[] }
interface CardLike { username: string; nickname: string; bio?: string; note?: string }
interface TopicLike { slug: string; name: string; intro: string }

export function postDocs(idx: PostIdx[], meta: PostMeta[] = []): SearchDoc[] {
  const m = new Map(meta.map((p) => [p.slug, p]));
  return idx.map((p) => {
    const x = m.get(p.slug);
    return { id: p.slug, kind: 'post', title: p.title, summary: p.summary, text: p.text ?? '', tags: p.tags, section: p.category, series: x?.series?.trim() || null, date: x?.publishedAt ?? x?.updatedAt ?? null, href: `/posts/${p.slug}/` };
  });
}

export function workDocs(works: WorkLike[]): SearchDoc[] {
  return works.map((w) => ({
    id: w.id,
    kind: 'work',
    title: w.title,
    summary: [w.series, w.location].filter(Boolean).join(' · '),
    text: [w.location, w.camera, w.lens].filter(Boolean).join(' '),
    tags: w.tags ?? [],
    section: w.series || null,
    series: null,
    date: w.date || null,
    href: `/works/#${encodeURIComponent(w.id)}`,
  }));
}

export function albumDocs(albums: AlbumLike[]): SearchDoc[] {
  return albums.map((a) => ({
    id: a.slug,
    kind: 'album',
    title: a.title,
    summary: a.description,
    text: a.photos.map((p) => p.caption ?? '').filter(Boolean).join(' '),
    tags: [],
    section: '影集',
    series: null,
    date: a.date || null,
    href: `/gallery/${encodeURIComponent(a.slug)}/`,
  }));
}

export function memberDocs(cards: CardLike[]): SearchDoc[] {
  return cards.map((c) => ({ id: c.username, kind: 'user', title: `${c.nickname || c.username}（@${c.username}）`, summary: [c.bio, c.note].filter(Boolean).join(' · '), tags: [], section: null, series: null, date: null, href: `/u/${encodeURIComponent(c.username)}/` }));
}

export function topicDocs(topics: TopicLike[]): SearchDoc[] {
  return topics.map((t) => ({ id: t.slug, kind: 'topic', title: t.name, summary: t.intro, tags: [t.name], section: null, series: null, date: null, href: `/t/${encodeURIComponent(t.slug)}/` }));
}
