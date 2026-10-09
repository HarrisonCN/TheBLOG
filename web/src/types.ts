export interface PostSummary {
  id: number;
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  coverUrl: string | null;
  status: 'draft' | 'published';
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Post extends PostSummary {
  contentMd: string;
}
export interface Profile {
  name: string;
  tagline: string;
  avatarUrl: string;
  bioMd: string;
  location: string;
  links: { label: string; url: string }[];
}
export type Animation = 'off' | 'low' | 'normal' | 'high';
export interface Settings {
  siteTitle: string;
  siteDescription: string;
  theme: 'system' | 'light' | 'dark';
  sections: { hero: boolean; featured: boolean; postList: boolean; tags: boolean; about: boolean };
  featuredSlugs: string[];
  animation: Animation;
  postsPerPage: number;
}
export interface TagCount {
  tag: string;
  count: number;
}
export interface SiteData {
  settings: Settings;
  profile: Profile;
  posts: PostSummary[];
  total: number;
  tags: TagCount[];
}

export const DEFAULT_SETTINGS: Settings = {
  siteTitle: 'Winston 的博客',
  siteDescription: '摄影、产品与动效笔记',
  theme: 'system',
  sections: { hero: true, featured: true, postList: true, tags: true, about: true },
  featuredSlugs: [],
  animation: 'normal',
  postsPerPage: 10,
};
export const DEFAULT_PROFILE: Profile = { name: 'Winston', tagline: '', avatarUrl: '', bioMd: '', location: '', links: [] };
