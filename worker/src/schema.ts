import { z } from 'zod';

const SAFE_URL = /^(https?:\/\/[^\s<>"']+|\/[^\s<>"']*)$/i;
const LINK_URL = /^(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+|\/[^\s<>"']*)$/i;

export const safeUrl = z.string().trim().max(2048).regex(SAFE_URL, '只允许 http(s) 链接或站内路径');
export const optionalUrl = z.union([safeUrl, z.literal('')]);

export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug 只能包含小写字母、数字和连字符');

export const tagsSchema = z.array(z.string().trim().min(1).max(30)).max(20);
/** 分类：单个字符串；空字符串表示「未分类」 */
export const categorySchema = z.string().trim().max(30);

export const postCreateSchema = z.object({
  title: z.string().trim().min(1).max(200).describe('文章标题'),
  slug: slugSchema.optional().describe('URL 标识（小写字母/数字/连字符）；不填则由标题生成'),
  summary: z.string().trim().max(500).optional().describe('摘要'),
  contentMd: z.string().max(200_000).optional().describe('Markdown 正文'),
  tags: tagsSchema.optional().describe('标签'),
  coverUrl: optionalUrl.optional().describe('封面图 URL'),
  category: categorySchema.optional().describe('分类（单个，例如「摄影」）；空字符串表示未分类'),
  pinned: z.boolean().optional().describe('是否置顶'),
  status: z.enum(['draft', 'published']).optional().describe('默认 draft'),
});
export type PostCreate = z.infer<typeof postCreateSchema>;

export const postUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  slug: slugSchema.optional().describe('修改 slug（重命名）'),
  summary: z.string().trim().max(500).optional(),
  contentMd: z.string().max(200_000).optional(),
  tags: tagsSchema.optional(),
  coverUrl: optionalUrl.optional(),
  category: categorySchema.optional().describe('分类；空字符串表示未分类'),
  pinned: z.boolean().optional().describe('是否置顶'),
});
export type PostUpdate = z.infer<typeof postUpdateSchema>;

export const SOCIAL_ICONS = ['github', 'bilibili', 'weibo', 'zhihu', 'instagram', 'x', 'youtube', 'email', 'rss', 'link'] as const;
const linkUrl = z.string().trim().max(2048).regex(LINK_URL, '链接必须是 http(s)、mailto 或站内路径');

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(60),
  tagline: z.string().trim().max(120).describe('座右铭 / 一句话介绍'),
  avatarUrl: optionalUrl,
  bioMd: z.string().max(20_000),
  location: z.string().trim().max(60),
  homeUrl: z.union([linkUrl, z.literal('')]).describe('侧栏「前往小窝」按钮的链接（例如 GitHub 主页）'),
  links: z
    .array(z.object({ label: z.string().trim().min(1).max(40), url: linkUrl, icon: z.enum(SOCIAL_ICONS).optional().describe('社交图标') }))
    .max(10)
    .describe('社交链接'),
});
export type Profile = z.infer<typeof profileSchema>;
export const profilePatchSchema = profileSchema.partial();

export const settingsSchema = z.object({
  siteTitle: z.string().trim().min(1).max(80),
  siteDescription: z.string().trim().max(200),
  theme: z.enum(['system', 'light', 'dark']),
  sections: z.object({
    hero: z.boolean().describe('全屏横幅'),
    featured: z.boolean().describe('首页分类导航条'),
    postList: z.boolean().describe('文章列表'),
    tags: z.boolean().describe('侧栏标签云'),
    about: z.boolean().describe('侧栏个人卡片'),
    announcement: z.boolean().describe('侧栏公告栏'),
    latest: z.boolean().describe('侧栏最新文章'),
    stats: z.boolean().describe('侧栏网站资讯'),
    categories: z.boolean().describe('侧栏分类'),
  }),
  featuredSlugs: z.array(slugSchema).max(6),
  animation: z.enum(['off', 'low', 'normal', 'high']),
  postsPerPage: z.number().int().min(1).max(50),
  heroImage: optionalUrl.describe('首页横幅背景图'),
  heroSubtitles: z.array(z.string().trim().min(1).max(100)).max(10).describe('横幅打字机轮播副标题'),
  announcement: z.string().max(2000).describe('侧栏公告栏（Markdown）'),
});
export type Settings = z.infer<typeof settingsSchema>;
export const settingsPatchSchema = settingsSchema.partial().extend({ sections: settingsSchema.shape.sections.partial().optional() });

export const DEFAULT_SETTINGS: Settings = {
  siteTitle: 'Winston 的博客',
  siteDescription: '摄影、产品与动效笔记',
  theme: 'system',
  sections: { hero: true, featured: true, postList: true, tags: true, about: true, announcement: true, latest: true, stats: true, categories: true },
  featuredSlugs: [],
  animation: 'normal',
  postsPerPage: 10,
  heroImage: '',
  heroSubtitles: [],
  announcement: '',
};

export const DEFAULT_PROFILE: Profile = {
  name: 'Winston',
  tagline: '',
  avatarUrl: '',
  bioMd: '',
  location: '',
  homeUrl: '',
  links: [],
};

export const listQuerySchema = z.object({
  tag: z.string().trim().min(1).max(30).optional(),
  category: z.string().trim().min(1).max(30).optional(),
  status: z.enum(['draft', 'published', 'all']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export function formatZodError(err: z.ZodError): { path: string; message: string }[] {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

// ---------- 站点内容：友链 / 画廊 / 收藏 ----------
const text = (max: number) => z.string().trim().max(max);
export const friendSchema = z.object({ name: text(40).min(1), url: safeUrl, avatar: optionalUrl.default(''), description: text(120).default('') });
export const photoSchema = z.object({ url: safeUrl, caption: text(200).default(''), width: z.number().int().positive().max(20000).optional(), height: z.number().int().positive().max(20000).optional(), credit: text(200).optional(), creditUrl: z.union([safeUrl, z.literal('')]).optional() });
export const albumSchema = z.object({
  slug: slugSchema,
  title: text(60).min(1),
  description: text(500).default(''),
  cover: optionalUrl.default(''),
  date: z.string().trim().max(30).default(''),
  photos: z.array(photoSchema).max(200).default([]),
});
export const favoriteSchema = z.object({ title: text(80).min(1), url: safeUrl, description: text(200).default(''), group: text(30).default('') });

export const CONTENT_KEYS = ['friends', 'gallery', 'favorites'] as const;
export type ContentKey = (typeof CONTENT_KEYS)[number];
export const contentSchemas = {
  friends: z.array(friendSchema).max(100),
  gallery: z.array(albumSchema).max(50).refine((a) => new Set(a.map((x) => x.slug)).size === a.length, '相册 slug 不能重复'),
  favorites: z.array(favoriteSchema).max(200),
} as const;
export type Friend = z.infer<typeof friendSchema>;
export type Album = z.infer<typeof albumSchema>;
export type Favorite = z.infer<typeof favoriteSchema>;

// ---------- 留言板 ----------
export const guestbookCreateSchema = z.object({
  name: text(30).min(1),
  content: z.string().trim().min(1).max(1000),
  website: z.union([z.string().trim().max(200).regex(/^https?:\/\/[^\s<>"']+$/i, '只允许 http(s) 链接'), z.literal('')]).optional(),
});
export const guestbookModerateSchema = z.object({ id: z.number().int().positive(), action: z.enum(['approve', 'hide', 'delete']) });
