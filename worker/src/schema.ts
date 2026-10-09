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

export const postCreateSchema = z.object({
  title: z.string().trim().min(1).max(200).describe('文章标题'),
  slug: slugSchema.optional().describe('URL 标识（小写字母/数字/连字符）；不填则由标题生成'),
  summary: z.string().trim().max(500).optional().describe('摘要'),
  contentMd: z.string().max(200_000).optional().describe('Markdown 正文'),
  tags: tagsSchema.optional().describe('标签'),
  coverUrl: optionalUrl.optional().describe('封面图 URL'),
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
});
export type PostUpdate = z.infer<typeof postUpdateSchema>;

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(60),
  tagline: z.string().trim().max(120),
  avatarUrl: optionalUrl,
  bioMd: z.string().max(20_000),
  location: z.string().trim().max(60),
  links: z
    .array(z.object({ label: z.string().trim().min(1).max(40), url: z.string().trim().max(2048).regex(LINK_URL, '链接必须是 http(s)、mailto 或站内路径') }))
    .max(10),
});
export type Profile = z.infer<typeof profileSchema>;
export const profilePatchSchema = profileSchema.partial();

export const settingsSchema = z.object({
  siteTitle: z.string().trim().min(1).max(80),
  siteDescription: z.string().trim().max(200),
  theme: z.enum(['system', 'light', 'dark']),
  sections: z.object({
    hero: z.boolean(),
    featured: z.boolean(),
    postList: z.boolean(),
    tags: z.boolean(),
    about: z.boolean(),
  }),
  featuredSlugs: z.array(slugSchema).max(6),
  animation: z.enum(['off', 'low', 'normal', 'high']),
  postsPerPage: z.number().int().min(1).max(50),
});
export type Settings = z.infer<typeof settingsSchema>;
export const settingsPatchSchema = settingsSchema.partial().extend({ sections: settingsSchema.shape.sections.partial().optional() });

export const DEFAULT_SETTINGS: Settings = {
  siteTitle: 'Winston 的博客',
  siteDescription: '摄影、产品与动效笔记',
  theme: 'system',
  sections: { hero: true, featured: true, postList: true, tags: true, about: true },
  featuredSlugs: [],
  animation: 'normal',
  postsPerPage: 10,
};

export const DEFAULT_PROFILE: Profile = {
  name: 'Winston',
  tagline: '',
  avatarUrl: '',
  bioMd: '',
  location: '',
  links: [],
};

export const listQuerySchema = z.object({
  tag: z.string().trim().min(1).max(30).optional(),
  status: z.enum(['draft', 'published', 'all']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export function formatZodError(err: z.ZodError): { path: string; message: string }[] {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}
