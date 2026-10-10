import type { SectionKey, SectionMap } from './sections';
export interface PostSummary {
  id: number;
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  coverUrl: string | null;
  category: string | null;
  pinned: boolean;
  /** 正文字数（近似） */
  wordCount: number;
  status: 'draft' | 'published';
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Post extends PostSummary {
  contentMd: string;
}
export type SocialIcon = 'github' | 'bilibili' | 'weibo' | 'zhihu' | 'instagram' | 'x' | 'youtube' | 'email' | 'rss' | 'link' | 'wechat' | 'xiaohongshu';
export interface SocialLink {
  label: string;
  url: string;
  icon?: SocialIcon;
  /** 社交 ID（例如 @winston、微信号）：个人卡片里点图标可以查看和复制 */
  handle?: string;
}
/** 个人卡片数字（「文章」由文章数自动生成，其余是站长自己填的展示数字） */
export interface ProfileStat {
  label: string;
  value: string;
}
export interface Profile {
  name: string;
  /** 座右铭 / 一句话介绍 */
  tagline: string;
  avatarUrl: string;
  bioMd: string;
  location: string;
  /** 侧栏「前往小窝」按钮 */
  homeUrl: string;
  links: SocialLink[];
  /** 身份一行，例如「摄影师 / 设计师 / 独立创作者」 */
  role?: string;
  /** 个人卡片数字（最多 3 个） */
  stats?: ProfileStat[];
}
export type Animation = 'off' | 'low' | 'normal' | 'high';
export interface Sections {
  hero: boolean;
  featured: boolean;
  postList: boolean;
  tags: boolean;
  about: boolean;
  announcement: boolean;
  latest: boolean;
  stats: boolean;
  categories: boolean;
}
export interface Settings {
  siteTitle: string;
  siteDescription: string;
  theme: 'system' | 'light' | 'dark';
  sections: Sections;
  featuredSlugs: string[];
  animation: Animation;
  postsPerPage: number;
  heroImage: string;
  heroSubtitles: string[];
  announcement: string;
}
export interface TagCount {
  tag: string;
  count: number;
}
export interface CategoryCount {
  category: string;
  count: number;
}
export interface Friend {
  name: string;
  url: string;
  avatar: string;
  description: string;
}
export interface Photo {
  url: string;
  caption: string;
  width?: number;
  height?: number;
  /** 署名（作者 · 许可），例如 Wikimedia Commons 的照片 */
  credit?: string;
  creditUrl?: string;
}
export interface Album {
  slug: string;
  title: string;
  description: string;
  cover: string;
  date: string;
  photos: Photo[];
}
export interface Favorite {
  title: string;
  url: string;
  description: string;
  group: string;
}
export type ContentKey = 'friends' | 'gallery' | 'favorites' | SectionKey;
export interface ContentMap extends SectionMap {
  friends: Friend[];
  gallery: Album[];
  favorites: Favorite[];
}
export interface GuestbookEntry {
  id: number;
  name: string;
  content: string;
  website: string;
  status: 'pending' | 'approved' | 'hidden';
  createdAt: string;
}
export interface SearchDoc {
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  category: string | null;
  text: string;
}
export interface SiteData {
  settings: Settings;
  profile: Profile;
  /** 已发布文章摘要（置顶在前，按时间倒序） */
  posts: PostSummary[];
  total: number;
  tags: TagCount[];
  categories: CategoryCount[];
  /** 节日（只在当天显示横幅）；旧 Worker 没有该接口时为空 */
  festivals?: import('./demo/community-types').Festival[];
}

export const DEFAULT_SECTIONS: Sections = { hero: true, featured: true, postList: true, tags: true, about: true, announcement: true, latest: true, stats: true, categories: true };
export const DEFAULT_SETTINGS: Settings = {
  siteTitle: 'Winston 的博客',
  siteDescription: '摄影、产品与动效笔记',
  theme: 'system',
  sections: DEFAULT_SECTIONS,
  featuredSlugs: [],
  animation: 'normal',
  postsPerPage: 10,
  heroImage: '',
  heroSubtitles: [],
  announcement: '',
};
export const DEFAULT_PROFILE: Profile = { name: 'Winston', tagline: '', avatarUrl: '', bioMd: '', location: '', homeUrl: '', links: [] };

/** 兼容旧数据：补齐缺失字段 */
export function normalizeSettings(s: Partial<Settings> | undefined): Settings {
  return { ...DEFAULT_SETTINGS, ...(s ?? {}), sections: { ...DEFAULT_SECTIONS, ...(s?.sections ?? {}) } };
}
export function normalizeProfile(p: Partial<Profile> | undefined): Profile {
  return { ...DEFAULT_PROFILE, ...(p ?? {}) };
}
export function normalizePost<T extends Partial<PostSummary>>(p: T): T & Pick<PostSummary, 'category' | 'pinned' | 'wordCount'> {
  return { ...p, category: p.category ?? null, pinned: !!p.pinned, wordCount: p.wordCount ?? 0 };
}
