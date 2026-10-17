/**
 * 演示模式（VITE_DEMO=1）的浏览器内 API：
 * 与 Worker 的 REST 接口保持相同的路径、状态码和返回结构，数据存在 localStorage，
 * 每位访客的改动只留在自己的浏览器里。没有服务器、没有真实账号、没有密钥。
 */
import { stripMetadata } from '../exif';
import type { Album, CategoryCount, ContentKey, Favorite, Friend, Post, PostSummary, Profile, SearchDoc, Settings, SocialIcon, TagCount } from '../types';
import { createSeed, demoPlaylist, withFixturePosts, DEMO_OTP, DEMO_PASSWORD, type DemoDb } from './seed';
import { compareOrder, pageOf, parsePageQuery } from '../post-page-core';
import { checkAudioUpload, validatePlaylist } from '../music-core';
import { validatePostMedia } from '../essay-core';
import { isReaction, REACTION_SET } from '../reactions-core';
import { isSectionKey, SECTION_KEYS, validateSection } from '../sections';
import { isDefaultStyle, validateNoteStyle } from '../note-style';
import { legacyDesign, normalizeBadgeDesign, validateBadgeDesign } from '../badge-design';
import { isCommentAction, resolveParent, validateComment, type CommentStatus, type PostComment } from '../comment-core';
import type { Badge, Festival, Member, PublicMember, StickyNote, Viewer } from './community-types';
import { MockSocial, SocialError, socialSeed, type SocialState } from './mock-social';
import { MockUgc, ugcSeed } from './mock-ugc';
import { discoverySeed, MockDiscovery } from './mock-discovery';
import { groupsSeed, MockGroups } from './mock-groups';
import { magazineSeed, MockMagazine } from './mock-magazine';
import { avSeed, MockAv } from './mock-av';
import { hallsSeed, MockHalls } from './mock-halls';
import { Mock as MockGlossary } from './mock-glossary';
import { seed as glossarySeed } from './seed-glossary';
import { Mock as MockRetouch } from './mock-retouch';
import { seed as retouchSeed } from './seed-retouch';
// @content:mock-imports — L36+ 内容栏目挂载点（scaffold）
import { MockSync } from './mock-sync';
import { MockStudio, studioSeed } from './mock-studio';
import { dmSeed, MockDm } from './mock-dm';
import { MCP_ACTING, MockOpen, openSeed } from './mock-open';
import { MockAiStudio, aiStudioSeed } from './mock-aistudio';
import { MockOps, opsSeed } from './mock-ops';
import { EditorError, MockEditor, editorSeed } from './mock-editor';
import { MockSecurity, securitySeed } from './mock-security';
import { buildIndex, MAX_QUERY, search as coreSearch, suggest } from '../search-core';
import { extractQuotes } from '../reading-core';
import type { DmEvent } from '../dm-core';

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DB_KEY = 'blog-demo:db:v2';
export const MEMBER_SESSIONS_KEY = 'blog-demo:members';
export const SESSION_KEY = 'blog-demo:session';

/** 站长上传的音频（演示站：浏览器里的 IndexedDB；测试：内存）。 */
export interface AudioStore {
  put(key: string, blob: Blob): Promise<void>;
  get(key: string): Promise<Blob | null>;
}
export function memoryAudioStore(): AudioStore {
  const m = new Map<string, Blob>();
  return { put: async (k, b) => void m.set(k, b), get: async (k) => m.get(k) ?? null };
}

export interface MockResponse {
  status: number;
  body: unknown;
}

class MockError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: { path: string; message: string }[]) {
    super(message);
  }
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATA_IMG = /^data:image\/(png|jpeg|webp|gif|avif);base64,[a-z0-9+/]+=*$/i;
const SAFE_URL = /^(https?:\/\/[^\s<>"']+|\/[^\s<>"']*)$/i;
const LINK_URL = /^(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+|\/[^\s<>"']*)$/i;
/** 与 Worker storeImage 一致：存图前再无损去一次 EXIF / GPS（JPEG / PNG / WebP）。 */
function stripDataUrl(dataUrl: string, type: string): string {
  try {
    const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const r = stripMetadata(bytes);
    if (!r.changed) return dataUrl;
    let out = '';
    for (let i = 0; i < r.bytes.length; i += 0x8000) out += String.fromCharCode(...r.bytes.subarray(i, i + 0x8000));
    return `data:${type};base64,${btoa(out)}`;
  } catch {
    return dataUrl;
  }
}

export const MAX_IMAGE_BYTES = 1_500_000;

/** 内存版 KV（Node 测试、或浏览器禁用 localStorage 时的兜底）。 */
export function memoryKV(): KV {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

export function slugify(title: string, now = Date.now()): string {
  const s = title.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
  return s || `post-${now.toString(36)}`;
}

type Issue = { path: string; message: string };
function check(issues: Issue[]): void {
  if (issues.length) throw new MockError(400, 'validation_error', '参数校验失败', issues);
}
const isStr = (v: unknown): v is string => typeof v === 'string';

function strField(obj: Record<string, unknown>, key: string, issues: Issue[], o: { min?: number; max: number; required?: boolean; trim?: boolean }): string | undefined {
  const v = obj[key];
  if (v === undefined || v === null) {
    if (o.required) issues.push({ path: key, message: '必填' });
    return undefined;
  }
  if (!isStr(v)) {
    issues.push({ path: key, message: '必须是字符串' });
    return undefined;
  }
  const s = o.trim === false ? v : v.trim();
  if (s.length < (o.min ?? 0)) issues.push({ path: key, message: o.min === 1 ? '不能为空' : `至少 ${o.min} 个字符` });
  if (s.length > o.max) issues.push({ path: key, message: `最多 ${o.max} 个字符` });
  return s;
}

function imageUrlField(obj: Record<string, unknown>, key: string, issues: Issue[]): string | undefined {
  const s = strField(obj, key, issues, { max: 2_100_000 });
  if (s === undefined || s === '') return s;
  if (!(SAFE_URL.test(s) && s.length <= 2048) && !DATA_IMG.test(s)) issues.push({ path: key, message: '只允许 http(s) 链接、站内路径或本地上传的图片' });
  return s;
}

function tagsField(obj: Record<string, unknown>, issues: Issue[]): string[] | undefined {
  const v = obj.tags;
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 20) {
    issues.push({ path: 'tags', message: '最多 20 个标签' });
    return undefined;
  }
  const out: string[] = [];
  v.forEach((t, i) => {
    const s = isStr(t) ? t.trim() : '';
    if (!s || s.length > 30) issues.push({ path: `tags.${i}`, message: '标签长度 1–30' });
    else out.push(s);
  });
  return [...new Set(out)];
}

function slugField(obj: Record<string, unknown>, issues: Issue[]): string | undefined {
  const s = strField(obj, 'slug', issues, { min: 1, max: 80 });
  if (s !== undefined && !SLUG.test(s)) issues.push({ path: 'slug', message: 'slug 只能包含小写字母、数字和连字符' });
  return s;
}

const sortKey = (p: PostSummary) => p.publishedAt ?? p.createdAt;
const byOrder = (a: PostSummary, b: PostSummary) => Number(b.pinned) - Number(a.pinned) || (sortKey(a) < sortKey(b) ? 1 : sortKey(a) > sortKey(b) ? -1 : b.id - a.id);
/** 与 Worker 一致：去掉空白与常见 Markdown 符号后的字符数 */
export const wordCount = (md: string) => md.replace(/[\s#*`]/g, '').length;
const plain = (md: string) => md.replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#>*_`~|\-]+/g, ' ').replace(/\s+/g, ' ').trim();
const SOCIAL: SocialIcon[] = ['github', 'bilibili', 'weibo', 'zhihu', 'instagram', 'x', 'youtube', 'email', 'rss', 'link', 'wechat', 'xiaohongshu'];
const publicMember = (m: Member): PublicMember => {
  const { email: _e, ...rest } = m;
  return rest;
};
function summary(p: Post): PostSummary {
  const { contentMd: _omit, essay: _e, notes: _n, ...rest } = p;
  if (!rest.kind) rest.kind = 'post';
  return rest;
}

const CONTENT_KEYS: ContentKey[] = ['friends', 'gallery', 'favorites', ...SECTION_KEYS, 'playlist'];
const isContentKey = (k: string): k is ContentKey => (CONTENT_KEYS as string[]).includes(k);
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green'] as const;
const FAKE_VIEWERS = ['小林', 'Momo', '阿树', '路人甲', '晚风', 'Kiki'];

export class DemoBackend {
  private storage: KV;
  private base: string;
  private now: () => Date;
  private cache: DemoDb | null = null;
  private audioStore: AudioStore;

  private fixturePosts: number;
  constructor(opts: { storage?: KV; base?: string; now?: () => Date; audio?: AudioStore; fixturePosts?: number } = {}) {
    this.fixturePosts = Math.max(0, Math.min(Number(opts.fixturePosts ?? 0) || 0, 2000));
    this.audioStore = opts.audio ?? memoryAudioStore();
    this.storage = opts.storage ?? memoryKV();
    this.base = opts.base ?? '/';
    this.now = opts.now ?? (() => new Date());
    this.social = new MockSocial({
      members: () => this.db().members,
      state: () => this.db().social ?? socialSeed(),
      commit: (mutate) => {
        const db = structuredClone(this.db());
        db.social ??= socialSeed();
        mutate(db.social, db.members);
        this.save(db);
      },
      memberFrom: (h) => this.memberFrom(h),
      optionalMember: (h) => (/^Bearer\s+\S/i.test(h.authorization ?? '') ? this.memberFromOrNull(h) : null),
      removeMember: (id) => void this.removeMember(id),
      approvedCommentsBy: (id) => {
        const st = this.db().social ?? socialSeed();
        return (this.db().comments ?? [])
          .filter((c) => c.status === 'approved' && st.commentAuthors[String(c.id)] === id)
          .sort((a, b) => b.id - a.id)
          .map((c) => ({ slug: c.slug, content: c.content, createdAt: c.createdAt }));
      },
      now: () => this.now(),
      profileWorks: (a, v, f) => this.ugc.profileWorks(a, v, f),
      publicWorkCount: (a) => this.ugc.publicWorkCount(a),
      purgeAuthor: (id) => {
        this.ugc.purgeAuthor(id);
        this.studio.purge(id);
        this.disc.purge(id);
        this.dm.purge(id);
        this.groupsPurge(id);
        this.sync.purge(id);
      },
      exportWorks: (id) => ({ ...this.ugc.exportWorks(id), ...this.disc.exportFor(id), ...this.studio.exportFor(id), ...this.dm.exportFor(id), ...this.sync.exportFor(id) }),
    });
    this.ugc = new MockUgc({
      state: () => this.db().ugc ?? ugcSeed(this.base),
      commit: (mutate) => {
        const db = structuredClone(this.db());
        db.ugc ??= ugcSeed(this.base);
        mutate(db.ugc);
        this.save(db);
      },
      social: this.social,
      members: () => this.db().members,
      memberFrom: (h) => this.memberFrom(h),
      optionalMember: (h) => (/^Bearer\s+\S/i.test(h.authorization ?? '') ? this.memberFromOrNull(h) : null),
      now: () => this.now(),
      disc: () => this.disc ?? null,
      studio: () => this.studio ?? null,
    });
    this.disc = new MockDiscovery({
      state: () => this.db().discovery ?? discoverySeed(this.now()),
      commit: (mutate) => {
        const db = structuredClone(this.db());
        db.discovery ??= discoverySeed(this.now());
        mutate(db.discovery);
        this.save(db);
      },
      ugc: this.ugc,
      social: this.social,
      posts: () => this.db().posts,
      members: () => this.db().members,
      memberFrom: (h) => this.memberFrom(h),
      optionalMember: (h) => (/^Bearer\s+\S/i.test(h.authorization ?? '') ? this.memberFromOrNull(h) : null),
      now: () => this.now(),
    });
    this.studio = new MockStudio({
      state: () => this.db().studio ?? studioSeed(this.now()),
      commit: (mutate) => {
        const db = structuredClone(this.db());
        db.studio ??= studioSeed(this.now());
        mutate(db.studio);
        this.save(db);
      },
      ugc: this.ugc,
      social: this.social,
      posts: () => this.db().posts,
      members: () => this.db().members,
      memberFrom: (h) => this.memberFrom(h),
      optionalMember: (h) => (/^Bearer\s+\S/i.test(h.authorization ?? '') ? this.memberFromOrNull(h) : null),
      now: () => this.now(),
    });
    this.sync = new MockSync({
      state: () => this.db().readingSync ?? { docs: {} },
      commit: (mutate) => {
        const db = structuredClone(this.db());
        db.readingSync ??= { docs: {} };
        mutate(db.readingSync);
        this.save(db);
      },
      memberFrom: (h) => this.memberFrom(h),
      now: () => this.now(),
    });
    this.groups = new MockGroups({
      state: () => this.db().groups ?? groupsSeed(this.now()),
      commit: (mutate) => {
        const db = structuredClone(this.db());
        db.groups ??= groupsSeed(this.now());
        mutate(db.groups);
        this.save(db);
      },
      ugc: this.ugc,
      social: this.social,
      members: () => this.db().members,
      memberFrom: (h) => this.memberFrom(h),
      optionalMember: (h) => (/^Bearer\s+\S/i.test(h.authorization ?? '') ? this.memberFromOrNull(h) : null),
      now: () => this.now(),
    });
    this.dm = new MockDm({
      state: () => this.db().dm ?? dmSeed(this.now()),
      commit: (mutate) => {
        const db = structuredClone(this.db());
        db.dm ??= dmSeed(this.now());
        mutate(db.dm);
        this.save(db);
      },
      social: this.social,
      ugc: this.ugc,
      members: () => this.db().members,
      memberFrom: (h) => this.memberFrom(h),
      emit: (to, ev) => {
        for (const fn of this.dmListeners) fn(to, ev);
      },
      schedule: (fn, ms) => void setTimeout(fn, ms),
      isAdmin: () => this.isAuthenticated(),
      now: () => this.now(),
    });
    this.ops = new MockOps({
      state: () => this.db().ops ?? opsSeed(),
      commit: (mutate) => {
        const db = structuredClone(this.db());
        db.ops ??= opsSeed();
        mutate(db.ops);
        this.save(db);
      },
      social: this.social,
      isAdmin: () => this.isAuthenticated(),
      now: () => this.now(),
      version: String(import.meta.env.VITE_APP_VERSION ?? ''),
    });
    this.editor = new MockEditor({
      state: () => this.db().editor ?? editorSeed(),
      commit: (mutate) => {
        const db = structuredClone(this.db());
        db.editor ??= editorSeed();
        mutate(db.editor);
        this.save(db);
      },
      posts: () => this.db().posts,
      commitPosts: (mutate) => {
        const db = structuredClone(this.db());
        mutate(db.posts);
        this.save(db);
      },
      now: () => this.now(),
    });
    this.security = new MockSecurity({
      state: () => this.db().security ?? securitySeed(),
      commit: (mutate) => {
        const db = structuredClone(this.db());
        db.security ??= securitySeed();
        mutate(db.security);
        this.save(db);
      },
      social: this.social,
      dm: () => this.dm,
      memberFrom: (h) => this.memberFrom(h),
      tokens: () => this.sessions(),
      setTokens: (t) => this.storage.setItem(MEMBER_SESSIONS_KEY, JSON.stringify(t)),
      publicMember: (id) => publicMember(this.withDesigns(this.db().members.find((x) => x.id === id)!)),
      now: () => this.now(),
    });
    this.open = new MockOpen({
      state: () => this.db().open ?? openSeed(this.now(), this.base),
      commit: (mutate) => {
        const db = structuredClone(this.db());
        db.open ??= openSeed(this.now(), this.base);
        mutate(db.open);
        this.save(db);
      },
      social: this.social,
      ugc: this.ugc,
      members: () => this.db().members,
      posts: () => this.db().posts,
      topics: () => {
        const d = this.db().discovery ?? discoverySeed(this.now());
        return d.topics.map((t) => ({ id: t.id, slug: t.slug, name: t.name, intro: t.intro, tags: d.topicTags.filter((x) => x.topicId === t.id).map((x) => x.tag) }));
      },
      topicWorkIds: (id) => new Set((this.db().discovery ?? discoverySeed(this.now())).postTopics.filter((x) => x.topicId === id).map((x) => x.postId)),
      projects: () => {
        const st = this.db().studio ?? studioSeed(this.now());
        return st.projects.map((p) => ({ ...p, logs: st.logs.filter((l) => l.projectId === p.id) }));
      },
      settings: () => this.db().settings,
      ownerName: () => this.db().profile.name,
      memberFrom: (h) => this.memberFrom(h),
      isAdmin: () => this.isAuthenticated(),
      base: this.base,
      now: () => this.now(),
    });
    this.magazine = new MockMagazine({
      state: () => this.db().magazine ?? magazineSeed(this.base),
      commit: (mutate) => {
        const db = structuredClone(this.db());
        db.magazine ??= magazineSeed(this.base);
        mutate(db.magazine);
        this.save(db);
      },
    });
    this.av = new MockAv({
      state: () => this.db().av ?? avSeed(this.base),
      commit: (mutate) => {
        const db = structuredClone(this.db());
        db.av ??= avSeed(this.base);
        mutate(db.av);
        this.save(db);
      },
    });
    this.halls = new MockHalls({
      state: () => this.db().halls ?? hallsSeed(this.base),
      commit: (mutate) => {
        const db = structuredClone(this.db());
        db.halls ??= hallsSeed(this.base);
        mutate(db.halls);
        this.save(db);
      },
    });
    this.glossary = new MockGlossary({
      state: () => this.db().glossary ?? glossarySeed(this.base),
      commit: (mutate) => {
        const db = structuredClone(this.db());
        db.glossary ??= glossarySeed(this.base);
        mutate(db.glossary);
        this.save(db);
      },
    });
    this.retouch = new MockRetouch({
      state: () => this.db().retouch ?? retouchSeed(this.base),
      commit: (mutate) => {
        const db = structuredClone(this.db());
        db.retouch ??= retouchSeed(this.base);
        mutate(db.retouch);
        this.save(db);
      },
    });
    // @content:mock-ctor — L36+ 内容栏目挂载点（scaffold）
    this.aistudio = new MockAiStudio({
      state: () => this.db().aistudio ?? aiStudioSeed(),
      commit: (mutate) => {
        const db = structuredClone(this.db());
        db.aistudio ??= aiStudioSeed();
        mutate(db.aistudio);
        this.save(db);
      },
      aiEnabled: () => (this.db().open ?? openSeed(this.now(), this.base)).ai,
      setAiEnabled: (on) => {
        const db = structuredClone(this.db());
        db.open ??= openSeed(this.now(), this.base);
        db.open.ai = on;
        this.save(db);
      },
      social: this.social,
      memberFrom: (h) => this.memberFrom(h),
      topics: () => {
        const d = this.db().discovery ?? discoverySeed(this.now());
        return d.topics.map((t) => ({ slug: t.slug, name: t.name, tags: d.topicTags.filter((x) => x.topicId === t.id).map((x) => x.tag) }));
      },
      now: () => this.now(),
    });
  }
  private open: MockOpen;
  private aistudio: MockAiStudio;
  private ops!: MockOps;
  private editor!: MockEditor;
  private security!: MockSecurity;
  /** 构建期（prerender）：生成静态订阅源 */
  openFeeds(): MockOpen {
    return this.open;
  }
  private social: MockSocial;
  private dm: MockDm;
  private groups: MockGroups;
  private magazine: MockMagazine;
  private av: MockAv;
  private halls: MockHalls;
  private glossary: MockGlossary;
  private retouch: MockRetouch;
  // @content:mock-field — L36+ 内容栏目挂载点（scaffold）
  private sync: MockSync;
  private groupsPurge(id: number): void {
    const db = structuredClone(this.db());
    if (!db.groups) return;
    this.groups.purgeMember(db.groups, id);
    this.save(db);
  }
  /** L19 演示「实时」：事件监听（client.ts 把它们转发到 BroadcastChannel / 本标签页） */
  private dmListeners: ((to: number[], ev: DmEvent) => void)[] = [];
  onDmEvent(fn: (to: number[], ev: DmEvent) => void): () => void {
    this.dmListeners.push(fn);
    return () => (this.dmListeners = this.dmListeners.filter((x) => x !== fn));
  }
  /** 其他标签页改了 localStorage：丢掉内存缓存，下次读取时重新解析 */
  invalidate(): void {
    this.cache = null;
  }
  /** 演示：本标签页以虚构示例用户（小林 / Momo）身份登录，用来在两个标签页之间演示私信实时收发。正式站没有这个接口。 */
  actAs(memberId: number): { token: string; member: PublicMember } {
    if (memberId !== 1 && memberId !== 2) throw new MockError(403, 'forbidden', '只能切换到示例用户');
    const m = this.db().members.find((x) => x.id === memberId);
    if (!m) throw new MockError(404, 'not_found', '示例用户不存在');
    const token = `member-${m.id}-${Math.random().toString(36).slice(2)}`;
    const sessions = this.sessions();
    sessions[token] = m.id;
    this.storage.setItem(MEMBER_SESSIONS_KEY, JSON.stringify(sessions));
    this.dm.markActing(memberId);
    return { token, member: publicMember(this.withDesigns(m)) };
  }
  private ugc: MockUgc;
  private disc: MockDiscovery;
  private studio: MockStudio;
  private memberFromOrNull(h: Record<string, string>): Member | null {
    try {
      return this.memberFrom(h);
    } catch {
      return null;
    }
  }

  /** 读取本地数据；不存在或损坏时回到种子数据。 */
  db(): DemoDb {
    if (this.cache) return this.cache;
    let db: DemoDb | null = null;
    try {
      const raw = this.storage.getItem(DB_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as DemoDb;
        if (parsed?.version === 2 && Array.isArray(parsed.posts)) {
          // 旧版本地数据没有新栏目：用种子数据补齐
          const seed = SECTION_KEYS.some((k) => !Array.isArray(parsed[k])) ? createSeed(this.base) : null;
          if (seed) for (const k of SECTION_KEYS) if (!Array.isArray(parsed[k])) (parsed as unknown as Record<string, unknown>)[k] = seed[k];
          if (!Array.isArray(parsed.playlist)) parsed.playlist = demoPlaylist();
          db = parsed;
        }
      }
    } catch {
      db = null;
    }
    this.cache = db ?? withFixturePosts(createSeed(this.base), this.fixturePosts);
    return this.cache;
  }

  private save(db: DemoDb): void {
    try {
      this.storage.setItem(DB_KEY, JSON.stringify(db));
    } catch {
      this.cache = null; // 回滚到已保存的版本
      throw new MockError(507, 'storage_full', '浏览器本地存储空间不足：请删除一些带图片的文章，或点击「重置演示数据」');
    }
    this.cache = db;
  }

  /** 清空本地改动，恢复种子数据并退出登录。 */
  reset(): void {
    this.storage.removeItem(DB_KEY);
    this.storage.removeItem(SESSION_KEY);
    this.cache = null;
  }

  private adminSession(): string {
    const token = `demo-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    this.storage.setItem(SESSION_KEY, token);
    return token;
  }

  isAuthenticated(): boolean {
    return !!this.csrf();
  }

  private csrf(): string | null {
    try {
      return this.storage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  }

  async handle(method: string, rawPath: string, body?: unknown, headers: Record<string, string> = {}): Promise<MockResponse> {
    try {
      return await this.route(method.toUpperCase(), rawPath, body, headers);
    } catch (e) {
      if (e instanceof SocialError) return { status: e.status, body: { error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } } };
      if (e instanceof EditorError) return { status: e.status, body: { error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } } };
      if (e instanceof MockError) return { status: e.status, body: { error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } } };
      return { status: 500, body: { error: { code: 'internal', message: (e as Error).message || '内部错误' } } };
    }
  }

  private async route(m: string, rawPath: string, body: unknown, headers: Record<string, string>): Promise<MockResponse> {
    const u = new URL(rawPath, 'http://demo.invalid');
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const q = u.searchParams;
    const ok = (b: unknown, status = 200): MockResponse => ({ status, body: b });
    // L24：先把到点的定时文章发布出去（= Worker 的 cron），再处理请求
    this.editor.tick();
    const ed = this.editor.routePublic(m, path);
    if (ed) return ed;

    // ---- L21 健康检查 / 版本 / 运行状态 / 前端错误上报 ----
    if (path === '/api/health' || path === '/api/version' || path === '/api/status' || path === '/api/errors') {
      const o = this.ops.routePublic(m, path, body);
      if (o) return o;
    }
    // ---- L33 视觉杂志（公开：只有已发布的期刊）----
    if (path.startsWith('/api/magazine')) {
      const mg = this.magazine.routePublic(m, path);
      if (mg) return mg;
    }
    // ---- L34 视频与声音（公开：只有已发布作品）----
    if (path === '/api/av' || path.startsWith('/api/av/')) {
      const av = this.av.routePublic(m, path);
      if (av) return av;
    }
    // ---- L35 沉浸式展厅（公开：只有已发布展厅）----
    if (path === '/api/halls' || path.startsWith('/api/halls/')) {
      const hl = this.halls.routePublic(m, path);
      if (hl) return hl;
    }
    // ---- L36 摄影术语表（公开：只有已发布）----
    if (path === '/api/glossary' || path.startsWith('/api/glossary/')) {
      const r36 = this.glossary.routePublic(m, path);
      if (r36) return r36;
    }
    // ---- L37 修图前后对比（公开：只有已发布）----
    if (path === '/api/retouch' || path.startsWith('/api/retouch/')) {
      const r37 = this.retouch.routePublic(m, path);
      if (r37) return r37;
    }
    // @content:mock-public — L36+ 内容栏目挂载点（scaffold）
    // ---- L20 Webmention / 订阅源 / 开放接口 / MCP ----
    if (path === '/mcp' || path.startsWith('/api/webmention') || path.startsWith('/api/feeds/') || path.startsWith('/api/open/')) {
      const o = this.open.routePublic(m, path, q, body, headers);
      if (o) return o;
      throw new MockError(404, 'not_found', '接口不存在');
    }
    // ---- L22 账号安全与隐私中心 ----
    if (path.startsWith('/api/security/')) {
      const sec = await this.security.route(m, path, q, body, headers, (id) => this.issueMemberToken(id));
      if (sec) return sec;
      throw new MockError(404, 'not_found', '接口不存在');
    }
    // ---- L16 用户投稿（/api/social/works…、uploads、reports）----
    if (path.startsWith('/api/social/')) {
      // ---- L20 订阅 / MCP 令牌 / AI 建议 / 项目 GitHub 卡片 ----
      const ais = this.aistudio.routeSocial(m, path.slice('/api/social'.length), body, headers);
      if (ais) return ais;
      const os = this.open.routeSocial(m, path.slice('/api/social'.length), q, body, headers);
      if (os) return os;
      const u = this.ugc.route(m, path.slice('/api/social'.length), q, body, headers);
      if (u) return u;
      // ---- L17 话题 / 发现 / 活动 / 合集 / 社区徽章 ----
      const d = this.disc.route(m, path.slice('/api/social'.length), q, body, headers);
      if (d) return d;
      // ---- L18 EXIF 筛选 / 共同作者 / 修订 / 项目 / 摄影专题 / 数据中心 ----
      const st = this.studio.route(m, path.slice('/api/social'.length), q, body, headers);
      if (st) return st;
      // ---- L19 私信 / 消息请求 / 活动聊天室 ----
      const dm = this.dm.route(m, path.slice('/api/social'.length), q, body, headers);
      if (dm) return dm;
      // ---- L28 兴趣社群（小组）----
      const gr = this.groups.route(m, path.slice('/api/social'.length), q, body, headers);
      if (gr) return gr;
      // ---- L30 跨设备同步 ----
      const sy = this.sync.route(m, path.slice('/api/social'.length), body, headers);
      if (sy) return sy;
    }
    // ---- L15 社交（/api/social/*）----
    const soc = this.social.route(m, path, q, body, headers);
    if (soc) return soc;

    // ---- 公开接口 ----
    if (m === 'GET') {
      if (path === '/api/health') return ok({ ok: true, demo: true });
      if (path === '/api/posts') return ok(this.list(q, false));
      if (path === '/api/posts/index') return ok(this.postIndex());
      const mt = /^\/api\/posts\/([^/]+)$/.exec(path);
      if (mt) return ok(this.find(decodeURIComponent(mt[1]!), false));
      if (path === '/api/tags') return ok({ tags: this.tags() });
      if (path === '/api/categories') return ok({ categories: this.categories() });
      if (path === '/api/search-index') return ok({ posts: this.searchIndex() });
      if (path === '/api/quotes') return ok({ quotes: this.db().posts.filter((p) => p.status === 'published').sort(byOrder).flatMap((p) => extractQuotes(p.contentMd, { slug: p.slug, title: p.title, publishedAt: p.publishedAt })).slice(0, 200) });
      if (path === '/api/search') return ok(this.searchApi(q.get('q') ?? '', q.get('tag'), q.get('year')));
      const mc = /^\/api\/content\/([a-z]+)$/.exec(path);
      if (mc && isContentKey(mc[1]!)) return ok({ items: this.db()[mc[1] as ContentKey] ?? [] });
      const mr = /^\/api\/posts\/([^/]+)\/reactions$/.exec(path);
      if (mr) return ok(this.reactions(decodeURIComponent(mr[1]!)));
      const mcm = /^\/api\/posts\/([a-z0-9-]{1,80})\/comments$/.exec(path);
      if (mcm) return ok(this.listComments(mcm[1]!));
      if (path === '/api/guestbook') return ok({ entries: this.db().guestbook.filter((g) => g.status === 'approved').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) });
      if (path === '/api/festivals') return ok({ festivals: this.db().festivals });
      if (path === '/api/projects') return ok({ items: this.db().projects });
      if (path === '/api/members') return ok({ members: this.db().members.map((x) => publicMember(this.withDesigns(x))) });
      if (path === '/api/notes') return ok({ notes: this.db().notes.filter((n) => !n.hidden) });
      if (path === '/api/members/me') return ok({ member: publicMember(this.withDesigns(this.memberFrom(headers))) });
      if (path === '/api/profile') return ok(this.db().profile);
      if (path === '/api/settings') return ok(this.db().settings);
      if (path === '/api/auth/session') {
        const c = this.csrf();
        return ok(c ? { authenticated: true, csrfToken: c } : { authenticated: false });
      }
    }
    if (m === 'POST') {
      if (path === '/api/guestbook') return ok(this.createGuestbook(body), 201);
      if (path === '/api/notes') return ok(this.createNote(body), 201);
      const mr = /^\/api\/posts\/([^/]+)\/reactions$/.exec(path);
      if (mr) return ok(this.react(decodeURIComponent(mr[1]!), body));
      const mcm = /^\/api\/posts\/([a-z0-9-]{1,80})\/comments$/.exec(path);
      if (mcm) return ok(this.createComment(mcm[1]!, body, headers), 201);
      const rn = /^\/api\/notes\/(\d+)\/report$/.exec(path);
      if (rn) return ok(this.reportNote(Number(rn[1])));
      if (path === '/api/presence') return ok(this.presence(body));
      if (path === '/api/members/register') return ok(this.register(body));
      if (path === '/api/members/verify') return ok(this.verify(body));
      if (path === '/api/members/uploads') return ok(this.upload(headers, body), 201);
      if (path === '/api/members/voice') return ok(this.voiceMsg(headers, body), 201);
    }
    const mb = /^\/api\/members\/me\/badges\/([A-Za-z0-9-]{1,24})$/.exec(path);
    if (mb && (m === 'PUT' || m === 'PATCH')) {
      const me = this.memberFrom(headers);
      return ok({ member: publicMember(this.setBadgeDesign(me.id, mb[1]!, body)) });
    }
    if (path === '/api/auth/login' && m === 'POST') {
      const pw = (body as { password?: unknown } | null)?.password;
      if (pw !== DEMO_PASSWORD) {
        this.security.adminPasswordFailed();
        throw new MockError(401, 'invalid_credentials', `密码错误（演示密码是 ${DEMO_PASSWORD}）`);
      }
      // L22：开启了二次验证 → 只给 preAuth，第二步 /api/auth/2fa 才签发会话
      const pre = this.security.adminPasswordOk();
      if (pre) return ok(pre);
      return ok({ ok: true, csrfToken: this.adminSession() });
    }
    if (path === '/api/auth/2fa' && m === 'POST') {
      await this.security.secondFactor(body);
      return ok({ ok: true, csrfToken: this.adminSession() });
    }
    if (path === '/api/auth/logout' && m === 'POST') {
      this.storage.removeItem(SESSION_KEY);
      return ok({ ok: true });
    }

    // ---- 后台接口 ----
    if (path.startsWith('/api/admin')) {
      const c = this.csrf();
      if (!c) throw new MockError(401, 'unauthorized', '请先登录');
      if (m !== 'GET' && headers['x-csrf-token'] !== c) throw new MockError(403, 'csrf', 'CSRF 校验失败');
      const sub = path.slice('/api/admin'.length);
      const ugcAdmin = this.ugc.routeAdmin(m, sub, q, body);
      if (ugcAdmin) {
        // L20：待审核的 Webmention 也算进审核队列
        const b = ugcAdmin.body as { counts?: Record<string, number> } | null;
        if (b?.counts) b.counts.webmentions = this.open.pendingCount();
        return ugcAdmin;
      }
      // L24 内容编辑器 2.0：草稿 / 定时发布 / 媒体库 / 模板
      const edAdmin = this.editor.routeAdmin(m, sub, q, body);
      if (edAdmin) return edAdmin;
      const aiAdmin = await this.aistudio.routeAdmin(m, sub, body);
      if (aiAdmin) return aiAdmin;
      // L33 视觉杂志
      const magAdmin = this.magazine.routeAdmin(m, sub, body);
      if (magAdmin) return magAdmin;
      // L34 视频与声音
      const avAdmin = this.av.routeAdmin(m, sub, body);
      if (avAdmin) return avAdmin;
      // L35 沉浸式展厅
      const hallAdmin = this.halls.routeAdmin(m, sub, body);
      if (hallAdmin) return hallAdmin;
      // L36 摄影术语表
      const a36 = this.glossary.routeAdmin(m, sub, body);
      if (a36) return a36;
      // L37 修图前后对比
      const a37 = this.retouch.routeAdmin(m, sub, body);
      if (a37) return a37;
      // @content:mock-admin — L36+ 内容栏目挂载点（scaffold）
      const openAdmin = this.open.routeAdmin(m, sub, q, body);
      if (openAdmin) return openAdmin;
      const opsAdmin = this.ops.routeAdmin(m, sub, q);
      if (opsAdmin) return opsAdmin;
      const secAdmin = await this.security.routeAdmin(m, sub, q, body);
      if (secAdmin) return secAdmin;
      const discAdmin = this.disc.routeAdmin(m, sub, body);
      if (discAdmin) return discAdmin;
      const studioAdmin = this.studio.routeAdmin(m, sub);
      if (studioAdmin) return studioAdmin;
      const dmAdmin = this.dm.routeAdmin(m, sub, body, (slug) => (this.db().discovery ?? discoverySeed(this.now())).events.find((e) => e.slug === slug)?.title ?? null);
      if (dmAdmin) return dmAdmin;
      if (sub === '/posts' && m === 'GET') return ok(this.list(q, true));
      if (sub === '/posts' && m === 'POST') return ok(this.create(body), 201);
      let mt: RegExpExecArray | null = /^\/posts\/([^/]+)\/publish$/.exec(sub);
      if (mt && m === 'POST') return ok(this.publish(decodeURIComponent(mt[1]!), (body as { published?: unknown } | null)?.published !== false));
      mt = /^\/posts\/([^/]+)$/.exec(sub);
      if (mt) {
        const slug = decodeURIComponent(mt[1]!);
        if (m === 'GET') return ok(this.find(slug, true));
        if (m === 'PATCH' || m === 'PUT') return ok(this.update(slug, body));
        if (m === 'DELETE') return ok(this.remove(slug));
      }
      if (sub === '/profile') {
        if (m === 'GET') return ok(this.db().profile);
        if (m === 'PATCH' || m === 'PUT') return ok(this.updateProfile(body));
      }
      if (sub === '/settings') {
        if (m === 'GET') return ok(this.db().settings);
        if (m === 'PATCH' || m === 'PUT') return ok(this.updateSettings(body));
      }
      if (sub === '/images' && m === 'POST') return ok(this.image(body), 201);
      if (sub === '/audio' && m === 'POST') return ok(await this.audio(body), 201);
      mt = /^\/content\/([a-z]+)$/.exec(sub);
      if (mt && isContentKey(mt[1]!)) {
        const key = mt[1] as ContentKey;
        if (m === 'GET') return ok({ items: this.db()[key] ?? [] });
        if (m === 'PUT') return ok({ items: this.setContent(key, (body as { items?: unknown } | null)?.items) });
      }
      if (sub === '/guestbook' && m === 'GET') {
        const st = q.get('status');
        const all = this.db().guestbook.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        return ok({ entries: st && st !== 'all' ? all.filter((g) => g.status === st) : all });
      }
      mt = /^\/guestbook\/(\d+)$/.exec(sub);
      if (mt && m === 'POST') return ok(this.moderate('guestbook', Number(mt[1]), (body as { action?: unknown } | null)?.action));
      if (sub === '/notes' && m === 'GET') return ok({ notes: this.db().notes });
      mt = /^\/notes\/(\d+)$/.exec(sub);
      if (mt && m === 'POST') return ok(this.moderate('notes', Number(mt[1]), (body as { action?: unknown } | null)?.action));
      if (sub === '/festivals') {
        if (m === 'GET') return ok({ festivals: this.db().festivals });
        if (m === 'PUT') return ok({ festivals: this.setFestivals((body as { festivals?: unknown } | null)?.festivals) });
      }
      if (sub === '/projects') {
        if (m === 'GET') return ok({ items: this.db().projects });
        if (m === 'PUT') return ok({ items: this.setProjects((body as { items?: unknown } | null)?.items) });
      }
      if (sub === '/members' && m === 'GET') return ok({ members: this.db().members.map((x) => this.withDesigns(x)) });
      mt = /^\/members\/(\d+)\/badges$/.exec(sub);
      if (mt && m === 'POST') return ok(this.grantBadge(Number(mt[1]), body));
      mt = /^\/members\/(\d+)\/badges\/([A-Za-z0-9-]+)$/.exec(sub);
      if (mt && m === 'DELETE') return ok(this.revokeBadge(Number(mt[1]), mt[2]!));
      if (mt && (m === 'PUT' || m === 'PATCH')) return ok(this.setBadgeDesign(Number(mt[1]), mt[2]!, body));
      if (sub === '/comments' && m === 'GET') return ok(this.adminComments(q.get('status')));
      mt = /^\/comments\/(\d+)$/.exec(sub);
      if (mt && m === 'POST') return ok(this.moderateComment(Number(mt[1]), (body as { action?: unknown } | null)?.action));
      if (mt && m === 'DELETE') return ok(this.moderateComment(Number(mt[1]), 'delete'));
      mt = /^\/members\/(\d+)$/.exec(sub);
      if (mt && m === 'DELETE') return ok(this.removeMember(Number(mt[1])));
      if (sub === '/inbox' && m === 'GET') return ok({ files: this.db().files, voice: this.db().voice });
      mt = /^\/inbox\/(files|voice)\/(\d+)$/.exec(sub);
      if (mt && (m === 'POST' || m === 'DELETE')) return ok(this.inboxAction(mt[1] as 'files' | 'voice', Number(mt[2]), m === 'DELETE' ? 'delete' : (body as { action?: unknown } | null)?.action));
    }
    throw new MockError(404, 'not_found', '接口不存在');
  }

  private list(q: URLSearchParams, admin: boolean): { posts: PostSummary[]; total: number; nextCursor: string | null } {
    const tag = q.get('tag')?.trim();
    const category = q.get('category')?.trim();
    const status = admin ? (q.get('status') ?? 'all') : 'published';
    // 与 Worker 相同：limit 严格 1..100，cursor 必须能解码，否则 400
    const pq = parsePageQuery(q.get('limit'), q.get('cursor'));
    if (!pq.ok) throw new MockError(400, 'validation_error', '参数校验失败', [{ path: pq.field, message: pq.message }]);
    const all = this.db()
      .posts.filter((p) => (status === 'all' ? true : p.status === status))
      .filter((p) => (tag ? p.tags.includes(tag) : true))
      .filter((p) => (category ? p.category === category : true))
      .sort(compareOrder);
    if (pq.cursor) {
      const { items, nextCursor } = pageOf(all, pq.limit, pq.cursor);
      return { posts: items.map(summary), total: all.length, nextCursor };
    }
    const offset = Math.max(Number(q.get('offset') ?? 0) || 0, 0);
    const { items, nextCursor } = pageOf(all.slice(offset), pq.limit, null);
    return { posts: items.map(summary), total: all.length, nextCursor };
  }

  /** 文章摘要索引（全部已发布文章，不含正文）；version 随内容变化 */
  private postIndex(): { posts: PostSummary[]; total: number; version: string } {
    const posts = this.db().posts.filter((p) => p.status === 'published').sort(compareOrder).map(summary);
    let h = 0;
    for (const p of posts) for (const ch of `${p.id}|${p.updatedAt}|${p.title};`) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
    return { posts, total: posts.length, version: `pi-${posts.length}-${(h >>> 0).toString(16)}` };
  }

  // ---- 文章表情回应（与 Worker 相同的形状；演示站的「访客」只有本机） ----
  private reactionCounts(db: DemoDb, slug: string): Record<string, number> {
    db.reactions ??= {};
    if (!db.reactions[slug]) {
      // 示例数据：按 slug 生成稳定的初始计数，让演示站看起来有人互动过
      let h = 7;
      for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      const seeded: Record<string, number> = {};
      REACTION_SET.forEach((e, i) => {
        const n = (h >> (i * 3)) % 9;
        if (n > 2) seeded[e] = n - 2;
      });
      db.reactions[slug] = seeded;
    }
    return db.reactions[slug]!;
  }
  private reactions(slug: string): { counts: Record<string, number> } {
    this.find(slug, false); // 404 / 草稿
    const db = this.db();
    return { counts: { ...this.reactionCounts(db, slug) } };
  }
  private react(slug: string, body: unknown): { counts: Record<string, number>; mine: boolean } {
    this.find(slug, false);
    const { emoji, on = true } = (body ?? {}) as { emoji?: unknown; on?: unknown };
    if (!isReaction(emoji) || typeof on !== 'boolean') throw new MockError(400, 'validation_error', '参数校验失败');
    const db = this.db();
    const counts = this.reactionCounts(db, slug);
    db.reactionVotes ??= [];
    const key = `${slug}|${emoji}`;
    const had = db.reactionVotes.includes(key);
    if (on && !had) {
      db.reactionVotes.push(key);
      counts[emoji] = (counts[emoji] ?? 0) + 1;
    } else if (!on && had) {
      db.reactionVotes = db.reactionVotes.filter((k) => k !== key);
      counts[emoji] = Math.max(0, (counts[emoji] ?? 0) - 1);
      if (!counts[emoji]) delete counts[emoji];
    }
    this.save(db);
    return { counts: { ...counts }, mine: on };
  }

  private find(slug: string, admin: boolean): Post {
    const p = this.db().posts.find((x) => x.slug === slug);
    if (!p || (!admin && p.status !== 'published')) throw new MockError(404, 'not_found', '文章不存在');
    return p;
  }

  private tags(): TagCount[] {
    const counts = new Map<string, number>();
    for (const p of this.db().posts) if (p.status === 'published') for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  }

  private postFields(input: unknown, creating: boolean) {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const issues: Issue[] = [];
    const title = strField(o, 'title', issues, { min: 1, max: 200, required: creating });
    const slug = slugField(o, issues);
    const sum = strField(o, 'summary', issues, { max: 500 });
    const contentMd = strField(o, 'contentMd', issues, { max: 2_500_000, trim: false });
    const tags = tagsField(o, issues);
    const coverUrl = imageUrlField(o, 'coverUrl', issues);
    const category = strField(o, 'category', issues, { max: 30 });
    const series = strField(o, 'series', issues, { max: 40 });
    let pinned: boolean | undefined;
    if (o.pinned !== undefined) {
      if (typeof o.pinned === 'boolean') pinned = o.pinned;
      else issues.push({ path: 'pinned', message: '必须是布尔值' });
    }
    let status: 'draft' | 'published' | undefined;
    if (creating && o.status !== undefined) {
      if (o.status === 'draft' || o.status === 'published') status = o.status;
      else issues.push({ path: 'status', message: '只能是 draft 或 published' });
    }
    check(issues);
    // 影集 / 拍摄手记：与 Worker 共用 essay-core 的严格规则
    const media = { kind: o.kind, essay: o.essay, notes: o.notes };
    return { title, slug, summary: sum, contentMd, tags, coverUrl, category, series, pinned, status, media };
  }

  private create(input: unknown): Post {
    const f = this.postFields(input, true);
    const db = structuredClone(this.db());
    const ts = this.now().toISOString();
    let slug = f.slug ?? slugify(f.title!, this.now().getTime());
    if (db.posts.some((p) => p.slug === slug)) {
      if (f.slug) throw new MockError(409, 'slug_conflict', `slug「${slug}」已存在`);
      slug = `${slug.slice(0, 70)}-${this.now().getTime().toString(36)}`;
    }
    const m = validatePostMedia(f.media);
    check(m.issues);
    const status = f.status ?? 'draft';
    const post: Post = {
      id: db.nextId++,
      slug,
      title: f.title!,
      summary: f.summary ?? '',
      contentMd: f.contentMd ?? '',
      tags: f.tags ?? [],
      coverUrl: f.coverUrl || null,
      category: f.category || null,
      series: f.series || null,
      kind: m.kind,
      essay: m.essay,
      notes: m.notes,
      pinned: f.pinned ?? false,
      wordCount: wordCount(f.contentMd ?? ''),
      status,
      publishedAt: status === 'published' ? ts : null,
      createdAt: ts,
      updatedAt: ts,
    };
    db.posts.push(post);
    this.save(db);
    return post;
  }

  private update(slug: string, input: unknown): Post {
    const f = this.postFields(input, false);
    const db = structuredClone(this.db());
    const cur = db.posts.find((p) => p.slug === slug);
    if (!cur) throw new MockError(404, 'not_found', '文章不存在');
    if (f.slug && f.slug !== cur.slug && db.posts.some((p) => p.slug === f.slug)) throw new MockError(409, 'slug_conflict', `slug「${f.slug}」已存在`);
    const m = validatePostMedia(f.media, { kind: cur.kind ?? 'post', essay: cur.essay ?? null, notes: cur.notes ?? null });
    check(m.issues);
    if (f.slug && f.slug !== cur.slug) db.settings.featuredSlugs = db.settings.featuredSlugs.map((s) => (s === cur.slug ? f.slug! : s));
    Object.assign(cur, {
      slug: f.slug ?? cur.slug,
      title: f.title ?? cur.title,
      summary: f.summary ?? cur.summary,
      contentMd: f.contentMd ?? cur.contentMd,
      tags: f.tags ?? cur.tags,
      coverUrl: f.coverUrl === undefined ? cur.coverUrl : f.coverUrl || null,
      category: f.category === undefined ? cur.category : f.category || null,
      series: f.series === undefined ? cur.series ?? null : f.series || null,
      kind: m.kind,
      essay: m.essay,
      notes: m.notes,
      pinned: f.pinned ?? cur.pinned,
      wordCount: wordCount(f.contentMd ?? cur.contentMd),
      updatedAt: this.now().toISOString(),
    });
    this.save(db);
    return cur;
  }

  private remove(slug: string): { deleted: true; slug: string } {
    const db = structuredClone(this.db());
    const i = db.posts.findIndex((p) => p.slug === slug);
    if (i < 0) throw new MockError(404, 'not_found', '文章不存在');
    db.posts.splice(i, 1);
    this.save(db);
    return { deleted: true, slug };
  }

  private publish(slug: string, published: boolean): Post {
    const db = structuredClone(this.db());
    const cur = db.posts.find((p) => p.slug === slug);
    if (!cur) throw new MockError(404, 'not_found', '文章不存在');
    const ts = this.now().toISOString();
    cur.status = published ? 'published' : 'draft';
    cur.publishedAt = published ? (cur.publishedAt ?? ts) : cur.publishedAt;
    cur.updatedAt = ts;
    this.save(db);
    return cur;
  }

  private updateProfile(input: unknown): Profile {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const issues: Issue[] = [];
    const db = structuredClone(this.db());
    const next: Profile = { ...db.profile };
    const name = strField(o, 'name', issues, { min: 1, max: 60 });
    const tagline = strField(o, 'tagline', issues, { max: 120 });
    const avatarUrl = imageUrlField(o, 'avatarUrl', issues);
    const bioMd = strField(o, 'bioMd', issues, { max: 20_000, trim: false });
    const location = strField(o, 'location', issues, { max: 60 });
    const homeUrl = strField(o, 'homeUrl', issues, { max: 2048 });
    if (homeUrl && !LINK_URL.test(homeUrl)) issues.push({ path: 'homeUrl', message: '链接必须是 http(s)、mailto 或站内路径' });
    if (homeUrl !== undefined) next.homeUrl = homeUrl;
    if (name !== undefined) next.name = name;
    if (tagline !== undefined) next.tagline = tagline;
    if (avatarUrl !== undefined) next.avatarUrl = avatarUrl;
    if (bioMd !== undefined) next.bioMd = bioMd;
    if (location !== undefined) next.location = location;
    if (o.links !== undefined) {
      if (!Array.isArray(o.links) || o.links.length > 10) issues.push({ path: 'links', message: '最多 10 个链接' });
      else {
        next.links = [];
        o.links.forEach((l: unknown, i) => {
          const r = (l ?? {}) as Record<string, unknown>;
          const label = isStr(r.label) ? r.label.trim() : '';
          const url = isStr(r.url) ? r.url.trim() : '';
          if (!label || label.length > 40) issues.push({ path: `links.${i}.label`, message: '名称长度 1–40' });
          else if (!LINK_URL.test(url) || url.length > 2048) issues.push({ path: `links.${i}.url`, message: '链接必须是 http(s)、mailto 或站内路径' });
          else if (r.icon !== undefined && !SOCIAL.includes(r.icon as SocialIcon)) issues.push({ path: `links.${i}.icon`, message: '无效的图标' });
          else if (r.handle !== undefined && (!isStr(r.handle) || r.handle.trim().length > 60)) issues.push({ path: `links.${i}.handle`, message: '社交 ID 最长 60 字' });
          else next.links.push({ label, url, ...(r.icon ? { icon: r.icon as SocialIcon } : {}), ...(isStr(r.handle) && r.handle.trim() ? { handle: r.handle.trim() } : {}) });
        });
      }
    }
    const role = strField(o, 'role', issues, { max: 80 });
    if (role !== undefined) next.role = role;
    if (o.stats !== undefined) {
      if (!Array.isArray(o.stats) || o.stats.length > 3) issues.push({ path: 'stats', message: '最多 3 个数字' });
      else {
        next.stats = [];
        o.stats.forEach((x: unknown, i) => {
          const r = (x ?? {}) as Record<string, unknown>;
          const label = isStr(r.label) ? r.label.trim() : '';
          const value = isStr(r.value) ? r.value.trim() : '';
          if (!label || label.length > 12 || !value || value.length > 12) issues.push({ path: `stats.${i}`, message: '名称和数字都需要填写（各 12 字以内）' });
          else next.stats!.push({ label, value });
        });
      }
    }
    check(issues);
    db.profile = next;
    this.save(db);
    return next;
  }

  private updateSettings(input: unknown): Settings {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const issues: Issue[] = [];
    const db = structuredClone(this.db());
    const next: Settings = { ...db.settings, sections: { ...db.settings.sections } };
    const siteTitle = strField(o, 'siteTitle', issues, { min: 1, max: 80 });
    const siteDescription = strField(o, 'siteDescription', issues, { max: 200 });
    if (siteTitle !== undefined) next.siteTitle = siteTitle;
    if (siteDescription !== undefined) next.siteDescription = siteDescription;
    if (o.theme !== undefined) {
      if (o.theme === 'system' || o.theme === 'light' || o.theme === 'dark') next.theme = o.theme;
      else issues.push({ path: 'theme', message: '无效的主题' });
    }
    if (o.animation !== undefined) {
      if (['off', 'low', 'normal', 'high'].includes(o.animation as string)) next.animation = o.animation as Settings['animation'];
      else issues.push({ path: 'animation', message: '无效的动效强度' });
    }
    if (o.postsPerPage !== undefined) {
      const n = o.postsPerPage;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 50) issues.push({ path: 'postsPerPage', message: '必须是 1–50 的整数' });
      else next.postsPerPage = n;
    }
    if (o.sections !== undefined) {
      const s = (o.sections ?? {}) as Record<string, unknown>;
      for (const k of Object.keys(next.sections) as (keyof Settings['sections'])[]) {
        if (s[k] === undefined) continue;
        if (typeof s[k] !== 'boolean') issues.push({ path: `sections.${k}`, message: '必须是布尔值' });
        else next.sections[k] = s[k] as boolean;
      }
    }
    const heroImage = imageUrlField(o, 'heroImage', issues);
    if (heroImage !== undefined) next.heroImage = heroImage;
    const announcement = strField(o, 'announcement', issues, { max: 2000, trim: false });
    if (announcement !== undefined) next.announcement = announcement;
    if (o.heroSubtitles !== undefined) {
      const h = o.heroSubtitles;
      if (!Array.isArray(h) || h.length > 10 || h.some((x) => !isStr(x) || !x.trim() || x.length > 100)) issues.push({ path: 'heroSubtitles', message: '最多 10 条，每条 1–100 字' });
      else next.heroSubtitles = (h as string[]).map((x) => x.trim());
    }
    if (o.featuredSlugs !== undefined) {
      const f = o.featuredSlugs;
      if (!Array.isArray(f) || f.length > 6) issues.push({ path: 'featuredSlugs', message: '最多 6 个' });
      else if (f.some((x) => !isStr(x) || !SLUG.test(x))) issues.push({ path: 'featuredSlugs', message: 'slug 只能包含小写字母、数字和连字符' });
      else next.featuredSlugs = f as string[];
    }
    check(issues);
    db.settings = next;
    this.save(db);
    return next;
  }

  private image(input: unknown): { key: string; url: string; contentType: string; size: number; markdown: string } {
    const o = (input ?? {}) as { dataUrl?: unknown; alt?: unknown; size?: unknown };
    if (!isStr(o.dataUrl) || !DATA_IMG.test(o.dataUrl)) throw new MockError(415, 'unsupported_type', '只支持 PNG / JPEG / WebP / GIF / AVIF 图片');
    const size = Math.floor((o.dataUrl.length - o.dataUrl.indexOf(',') - 1) * 0.75);
    if (size > MAX_IMAGE_BYTES) throw new MockError(413, 'too_large', `演示模式下图片最大 ${(MAX_IMAGE_BYTES / 1e6).toFixed(1)} MB`);
    const contentType = /^data:([^;]+);/.exec(o.dataUrl)![1]!;
    const alt = (isStr(o.alt) ? o.alt : '').replace(/[[\]\n\r]/g, '').slice(0, 100);
    const key = `demo/${this.now().getTime().toString(36)}`;
    const url = stripDataUrl(o.dataUrl, contentType);
    return { key, url, contentType, size, markdown: `![${alt}](${url})` };
  }

  // ---------------------------------------------------------------- 内容 / 搜索
  private categories(): CategoryCount[] {
    const counts = new Map<string, number>();
    for (const p of this.db().posts) if (p.status === 'published' && p.category) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    return [...counts].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || (a.category < b.category ? -1 : 1));
  }

  /** 与 Worker 的 GET /api/search 相同（L26，search-core 同一套排名）。 */
  private searchApi(q: string, tag: string | null, year: string | null) {
    const query = q.trim().slice(0, MAX_QUERY);
    if (!query) return { hits: [], total: 0, suggestions: [] };
    const pub = this.db().posts.filter((p) => p.status === 'published').sort(byOrder);
    const index = buildIndex(pub.map((p) => ({ id: p.slug, kind: 'post' as const, title: p.title, summary: p.summary, text: plain(p.contentMd).slice(0, 3000), tags: p.tags, section: p.category || null, series: (p.series ?? '').trim() || null, date: p.publishedAt ?? null, href: `/posts/${p.slug}/` })));
    const hits = coreSearch(index, query, { tag, year: year && /^\d{4}$/.test(year) ? year : null }, 50);
    return {
      hits: hits.map((h) => ({ slug: h.doc.id, title: h.doc.title, summary: h.doc.summary, tags: h.doc.tags, category: h.doc.section ?? null, series: h.doc.series ?? null, publishedAt: h.doc.date ?? null, score: h.score })),
      total: hits.length,
      suggestions: hits.length ? [] : suggest(index, query, 5),
    };
  }

  private searchIndex(): SearchDoc[] {
    return this.db()
      .posts.filter((p) => p.status === 'published')
      .sort(byOrder)
      .map((p) => ({ slug: p.slug, title: p.title, summary: p.summary, tags: p.tags, category: p.category, text: plain(p.contentMd).slice(0, 3000) }));
  }

  /** 与 Worker 的 /api/admin/audio 相同：嗅探文件头、只收音频、≤ 20 MB，返回 /api/audio/YYYY/MM/uuid.ext。 */
  private async audio(input: unknown): Promise<{ key: string; url: string; contentType: string; size: number }> {
    const o = (input ?? {}) as { bytes?: unknown; type?: unknown };
    if (!(o.bytes instanceof Uint8Array)) throw new MockError(400, 'missing_file', '缺少 file 字段');
    const c = checkAudioUpload(o.bytes, typeof o.type === 'string' ? o.type : '');
    if (!c.ok) throw new MockError(c.status, c.code, c.message);
    const d = this.now();
    const key = `audio/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${c.ext}`;
    try {
      await this.audioStore.put(key, new Blob([o.bytes as BlobPart], { type: c.type }));
    } catch {
      throw new MockError(507, 'storage_full', '浏览器本地存储空间不足，无法保存音频');
    }
    return { key, url: `/api/${key}`, contentType: c.type, size: o.bytes.byteLength };
  }

  /** 取回演示站上传的音频（播放器把它变成 blob: 地址）。 */
  async audioBlob(url: string): Promise<Blob | null> {
    const m = /^\/api\/(audio\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{2,4})$/.exec(url);
    return m ? this.audioStore.get(m[1]!) : null;
  }

  private setContent(key: ContentKey, items: unknown): unknown[] {
    if (!Array.isArray(items)) throw new MockError(400, 'validation_error', 'items 必须是数组');
    if (key === 'playlist') {
      const r = validatePlaylist(items);
      check(r.issues);
      const db = structuredClone(this.db());
      db.playlist = r.items;
      this.save(db);
      return r.items;
    }
    if (isSectionKey(key)) {
      const r = validateSection(key, items);
      check(r.issues);
      const db = structuredClone(this.db());
      (db as unknown as Record<string, unknown>)[key] = r.items;
      this.save(db);
      return r.items;
    }
    const issues: Issue[] = [];
    const max = key === 'favorites' ? 200 : key === 'gallery' ? 50 : 100;
    if (items.length > max) issues.push({ path: 'items', message: `最多 ${max} 项` });
    const out: unknown[] = items.map((raw, i) => {
      const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const sub: Issue[] = [];
      let v: Friend | Album | Favorite;
      if (key === 'friends') {
        v = { name: strField(o, 'name', sub, { min: 1, max: 40, required: true }) ?? '', url: strField(o, 'url', sub, { min: 1, max: 2048, required: true }) ?? '', avatar: imageUrlField(o, 'avatar', sub) ?? '', description: strField(o, 'description', sub, { max: 120 }) ?? '' };
        if (v.url && !SAFE_URL.test(v.url)) sub.push({ path: 'url', message: '只允许 http(s) 链接或站内路径' });
      } else if (key === 'favorites') {
        v = { title: strField(o, 'title', sub, { min: 1, max: 80, required: true }) ?? '', url: strField(o, 'url', sub, { min: 1, max: 2048, required: true }) ?? '', description: strField(o, 'description', sub, { max: 200 }) ?? '', group: strField(o, 'group', sub, { max: 30 }) ?? '' };
        if (v.url && !SAFE_URL.test(v.url)) sub.push({ path: 'url', message: '只允许 http(s) 链接或站内路径' });
      } else {
        const slug = strField(o, 'slug', sub, { min: 1, max: 80, required: true }) ?? '';
        if (slug && !SLUG.test(slug)) sub.push({ path: 'slug', message: 'slug 只能包含小写字母、数字和连字符' });
        const photos = Array.isArray(o.photos) ? o.photos.slice(0, 200) : [];
        v = {
          slug,
          title: strField(o, 'title', sub, { min: 1, max: 60, required: true }) ?? '',
          description: strField(o, 'description', sub, { max: 500 }) ?? '',
          cover: imageUrlField(o, 'cover', sub) ?? '',
          date: strField(o, 'date', sub, { max: 30 }) ?? '',
          photos: photos.map((ph: unknown, j: number) => {
            const r = (ph && typeof ph === 'object' ? ph : {}) as Record<string, unknown>;
            const u = imageUrlField(r, 'url', sub) ?? '';
            if (!u) sub.push({ path: `photos.${j}.url`, message: '必填' });
            return { url: u, caption: strField(r, 'caption', sub, { max: 200 }) ?? '', ...(typeof r.width === 'number' ? { width: r.width } : {}), ...(typeof r.height === 'number' ? { height: r.height } : {}), ...(isStr(r.credit) ? { credit: r.credit.slice(0, 200) } : {}), ...(isStr(r.creditUrl) && SAFE_URL.test(r.creditUrl) ? { creditUrl: r.creditUrl } : {}) };
          }),
        };
      }
      sub.forEach((x) => issues.push({ path: `items.${i}.${x.path}`, message: x.message }));
      return v;
    });
    if (key === 'gallery' && new Set((out as Album[]).map((a) => a.slug)).size !== out.length) issues.push({ path: 'items', message: '相册 slug 不能重复' });
    check(issues);
    const db = structuredClone(this.db());
    (db as unknown as Record<string, unknown>)[key] = out;
    this.save(db);
    return out;
  }

  // ---------------------------------------------------------------- 留言 / 便利贴
  private createGuestbook(input: unknown) {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const issues: Issue[] = [];
    const name = strField(o, 'name', issues, { min: 1, max: 40, required: true });
    const content = strField(o, 'content', issues, { min: 1, max: 1000, required: true });
    const website = strField(o, 'website', issues, { max: 200 }) ?? '';
    if (website && !/^https?:\/\//i.test(website)) issues.push({ path: 'website', message: '网站必须以 http(s):// 开头' });
    check(issues);
    const db = structuredClone(this.db());
    if (db.guestbook.filter((g) => g.status === 'pending').length >= 200) throw new MockError(429, 'too_many', '待审核留言太多，请稍后再试');
    const entry = { id: Math.max(0, ...db.guestbook.map((g) => g.id)) + 1, name: name!, content: content!, website, status: 'pending' as const, createdAt: this.now().toISOString() };
    db.guestbook.push(entry);
    this.save(db);
    return entry;
  }

  private createNote(input: unknown): StickyNote {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const issues: Issue[] = [];
    const name = strField(o, 'name', issues, { min: 1, max: 20, required: true });
    const content = strField(o, 'content', issues, { min: 1, max: 60, required: true });
    const color = (NOTE_COLORS as readonly string[]).includes(o.color as string) ? (o.color as StickyNote['color']) : 'yellow';
    const st = validateNoteStyle(o.style, color);
    if (!st.ok) issues.push({ path: 'style', message: st.error });
    check(issues);
    const db = structuredClone(this.db());
    const style = o.style === undefined || o.style === null || !st.ok || isDefaultStyle(st.style) ? null : st.style;
    const note: StickyNote = { id: Math.max(0, ...db.notes.map((n) => n.id)) + 1, name: name!, content: content!, color, style, reports: 0, hidden: false, createdAt: this.now().toISOString() };
    db.notes.push(note);
    if (db.notes.length > 60) db.notes.splice(0, db.notes.length - 60);
    this.save(db);
    return note;
  }

  private reportNote(id: number): { ok: true } {
    const db = structuredClone(this.db());
    const n = db.notes.find((x) => x.id === id);
    if (!n) throw new MockError(404, 'not_found', '便利贴不存在');
    n.reports++;
    if (n.reports >= 3) n.hidden = true; // 被举报 3 次自动隐藏，等站长复核
    this.save(db);
    return { ok: true };
  }

  private moderate(kind: 'guestbook' | 'notes', id: number, action: unknown): { id: number; action: string } {
    const ok = kind === 'guestbook' ? ['approve', 'hide', 'delete'] : ['show', 'hide', 'delete'];
    if (!ok.includes(action as string)) throw new MockError(400, 'validation_error', `action 只能是 ${ok.join(' / ')}`);
    const db = structuredClone(this.db());
    if (kind === 'guestbook') {
      const i = db.guestbook.findIndex((g) => g.id === id);
      if (i < 0) throw new MockError(404, 'not_found', '留言不存在');
      if (action === 'delete') db.guestbook.splice(i, 1);
      else db.guestbook[i]!.status = action === 'approve' ? 'approved' : 'hidden';
    } else {
      const i = db.notes.findIndex((g) => g.id === id);
      if (i < 0) throw new MockError(404, 'not_found', '便利贴不存在');
      if (action === 'delete') db.notes.splice(i, 1);
      else Object.assign(db.notes[i]!, { hidden: action === 'hide', reports: action === 'show' ? 0 : db.notes[i]!.reports });
    }
    this.save(db);
    return { id, action: action as string };
  }

  // ---------------------------------------------------------------- 谁在看网站（演示：本机 + 几位模拟访客）
  private presence(input: unknown): { viewers: Viewer[]; total: number } {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const sid = isStr(o.sid) ? o.sid.slice(0, 40) : 'me';
    const page = isStr(o.page) ? o.page.slice(0, 40) : '首页';
    const minute = Math.floor(this.now().getTime() / 60_000);
    const n = 2 + (minute % 3);
    const others: Viewer[] = FAKE_VIEWERS.slice(0, n).map((name, i) => ({ sid: `demo-${i}`, name, avatar: '', member: i < 2, page: ['首页', '画廊', '留言板', '归档'][(minute + i) % 4]! }));
    const me = this.memberSession();
    return { viewers: [{ sid, name: me?.name ?? '你', avatar: '', member: !!me, page }, ...others], total: others.length + 1 };
  }

  // ---------------------------------------------------------------- 好朋友（演示：验证码固定，邮件不真正发送）
  private pending = new Map<string, { name: string; bio: string; tries: number }>();

  private register(input: unknown): { sent: true; demoCode: string } {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const issues: Issue[] = [];
    const name = strField(o, 'name', issues, { min: 1, max: 40, required: true });
    const email = strField(o, 'email', issues, { min: 3, max: 120, required: true })?.toLowerCase();
    const bio = strField(o, 'bio', issues, { max: 120 }) ?? '';
    if (email && !EMAIL.test(email)) issues.push({ path: 'email', message: '邮箱格式不正确' });
    check(issues);
    this.pending.set(email!, { name: name!, bio, tries: 0 });
    return { sent: true, demoCode: DEMO_OTP };
  }

  private verify(input: unknown): { member: PublicMember; token: string } {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const email = isStr(o.email) ? o.email.trim().toLowerCase() : '';
    const p = this.pending.get(email);
    if (!p) throw new MockError(400, 'no_pending', '请先获取验证码');
    if (++p.tries > 5) {
      this.pending.delete(email);
      throw new MockError(429, 'too_many', '尝试次数太多，请重新获取验证码');
    }
    if (o.code !== DEMO_OTP) throw new MockError(400, 'bad_code', '验证码不正确');
    this.pending.delete(email);
    const db = structuredClone(this.db());
    let m = db.members.find((x) => x.email === email);
    if (!m) {
      m = { id: Math.max(0, ...db.members.map((x) => x.id)) + 1, email, name: p.name, avatarUrl: '', bio: p.bio, website: '', badges: [], joinedAt: this.now().toISOString(), provider: 'email' };
      db.members.push(m);
      this.save(db);
    }
    const token = this.issueMemberToken(m.id);
    this.security.onLogin(token, m.id, 'email');
    return { member: publicMember(this.withDesigns(m)), token };
  }

  /** 签发会员令牌（邮箱验证码 / Passkey 登录共用） */
  private issueMemberToken(memberId: number): string {
    const token = `member-${memberId}-${Math.random().toString(36).slice(2)}`;
    const sessions = this.sessions();
    sessions[token] = memberId;
    this.storage.setItem(MEMBER_SESSIONS_KEY, JSON.stringify(sessions));
    return token;
  }

  private sessions(): Record<string, number> {
    try {
      return JSON.parse(this.storage.getItem(MEMBER_SESSIONS_KEY) ?? '{}') as Record<string, number>;
    } catch {
      return {};
    }
  }

  private memberSession(): Member | null {
    const ids = Object.values(this.sessions());
    return ids.length ? (this.db().members.find((m) => m.id === ids[ids.length - 1]) ?? null) : null;
  }

  private memberFrom(headers: Record<string, string>): Member {
    // L20 MCP 作者工具：MockOpen 内部创建的代理身份对象
    const acting = MCP_ACTING.get(headers);
    if (acting !== undefined) {
      const am = this.db().members.find((x) => x.id === acting);
      if (am) return am;
    }
    const token = (headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const id = this.sessions()[token];
    const m = id ? this.db().members.find((x) => x.id === id) : undefined;
    if (!m) throw new MockError(401, 'unauthorized', '请先注册 / 登录好朋友账号');
    return m;
  }

  private upload(headers: Record<string, string>, input: unknown) {
    const m = this.memberFrom(headers);
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const size = typeof o.size === 'number' ? o.size : 0;
    if (!size) throw new MockError(400, 'no_file', '缺少文件');
    if (size > 2_000_000) throw new MockError(413, 'too_large', '演示站单个文件最大 2 MB');
    const db = structuredClone(this.db());
    if (db.files.filter((f) => f.memberId === m.id && f.status === 'pending').length >= 10) throw new MockError(429, 'too_many', '待审核的文件太多，请等站长处理');
    const f = { id: Math.max(0, ...db.files.map((x) => x.id)) + 1, memberId: m.id, memberName: m.name, name: (isStr(o.name) ? o.name : 'file').slice(0, 120), size, contentType: (isStr(o.type) ? o.type : 'application/octet-stream').slice(0, 100), note: (isStr(o.note) ? o.note : '').slice(0, 200), status: 'pending' as const, createdAt: this.now().toISOString(), ...(isStr(o.dataUrl) && o.dataUrl.length < 400_000 ? { dataUrl: o.dataUrl } : {}) };
    db.files.push(f);
    this.save(db);
    return { id: f.id, status: f.status };
  }

  private voiceMsg(headers: Record<string, string>, input: unknown) {
    const m = this.memberFrom(headers);
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const size = typeof o.size === 'number' ? o.size : 0;
    const durationMs = Math.min(60_000, Number(o.durationMs) || 0);
    if (!size) throw new MockError(400, 'no_file', '缺少录音');
    if (size > 2_000_000) throw new MockError(413, 'too_large', '录音太大');
    const db = structuredClone(this.db());
    const v = { id: Math.max(0, ...db.voice.map((x) => x.id)) + 1, name: m.name, durationMs, size, contentType: (isStr(o.type) ? o.type : 'audio/webm').slice(0, 60), createdAt: this.now().toISOString(), read: false, ...(isStr(o.dataUrl) && o.dataUrl.length < 400_000 ? { dataUrl: o.dataUrl } : {}) };
    db.voice.push(v);
    this.save(db);
    return { id: v.id };
  }

  private inboxAction(kind: 'files' | 'voice', id: number, action: unknown) {
    const db = structuredClone(this.db());
    const list = db[kind] as { id: number; status?: string; read?: boolean }[];
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) throw new MockError(404, 'not_found', '记录不存在');
    if (action === 'delete') list.splice(i, 1);
    else if (kind === 'files' && (action === 'approve' || action === 'reject')) list[i]!.status = action === 'approve' ? 'approved' : 'rejected';
    else if (kind === 'voice' && action === 'read') list[i]!.read = true;
    else throw new MockError(400, 'validation_error', '无效的操作');
    this.save(db);
    return { id, action: action as string };
  }

  // ---------------------------------------------------------------- 节日 / 项目 / 徽章
  private setFestivals(input: unknown): Festival[] {
    if (!Array.isArray(input) || input.length > 60) throw new MockError(400, 'validation_error', 'festivals 必须是数组（最多 60 个）');
    const themes = ['lunar', 'xmas', 'halloween', 'fireworks'];
    const issues: Issue[] = [];
    const out = input.map((raw, i) => {
      const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const id = isStr(o.id) && SLUG.test(o.id) ? o.id : `f-${i}`;
      const date = isStr(o.date) ? o.date.trim() : '';
      if (!/^(\d{4}-)?\d{2}-\d{2}$/.test(date)) issues.push({ path: `${i}.date`, message: '日期格式为 MM-DD 或 YYYY-MM-DD' });
      if (!themes.includes(o.theme as string)) issues.push({ path: `${i}.theme`, message: '主题只能是 lunar / xmas / halloween / fireworks' });
      const name = isStr(o.name) ? o.name.trim().slice(0, 20) : '';
      if (!name) issues.push({ path: `${i}.name`, message: '必填' });
      return { id, name, date, days: Math.min(30, Math.max(1, Number(o.days) || 1)), theme: o.theme as Festival['theme'], message: isStr(o.message) ? o.message.trim().slice(0, 120) : '' };
    });
    check(issues);
    const db = structuredClone(this.db());
    db.festivals = out;
    this.save(db);
    return out;
  }

  private setProjects(input: unknown) {
    if (!Array.isArray(input) || input.length > 30) throw new MockError(400, 'validation_error', 'items 必须是数组（最多 30 个）');
    const issues: Issue[] = [];
    const out = input.map((raw, i) => {
      const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const sub: Issue[] = [];
      const v = {
        name: strField(o, 'name', sub, { min: 1, max: 40, required: true }) ?? '',
        title: strField(o, 'title', sub, { min: 1, max: 60, required: true }) ?? '',
        version: strField(o, 'version', sub, { max: 20 }) ?? '',
        author: strField(o, 'author', sub, { max: 40 }) ?? '',
        engine: strField(o, 'engine', sub, { max: 20 }) ?? '',
        downloads: Math.max(0, Math.floor(Number(o.downloads) || 0)),
        url: strField(o, 'url', sub, { max: 2048 }) ?? '',
        description: strField(o, 'description', sub, { max: 300 }) ?? '',
      };
      if (v.url && !SAFE_URL.test(v.url)) sub.push({ path: 'url', message: '只允许 http(s) 链接' });
      sub.forEach((x) => issues.push({ path: `items.${i}.${x.path}`, message: x.message }));
      return v;
    });
    check(issues);
    const db = structuredClone(this.db());
    db.projects = out;
    this.save(db);
    return out;
  }

  private grantBadge(memberId: number, input: unknown): Member {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const issues: Issue[] = [];
    const code = strField(o, 'code', issues, { min: 1, max: 24, required: true });
    if (code && !/^[A-Za-z0-9-]+$/.test(code)) issues.push({ path: 'code', message: '编号只能包含字母、数字和连字符' });
    const label = strField(o, 'label', issues, { max: 30 }) ?? '';
    const style: Badge['style'] = o.style === 'pearlescent' ? 'pearlescent' : 'brushed-metal';
    const extra = Object.keys(o).filter((k) => !['code', 'label', 'style', 'design'].includes(k));
    if (extra.length) issues.push({ path: extra[0]!, message: '不支持的字段' });
    let design = legacyDesign(style);
    if (o.design !== undefined && o.design !== null) {
      const d = validateBadgeDesign(o.design);
      if (!d.ok) issues.push({ path: 'design', message: d.error });
      else design = d.design;
    }
    check(issues);
    const db = structuredClone(this.db());
    const m = db.members.find((x) => x.id === memberId);
    if (!m) throw new MockError(404, 'not_found', '好朋友不存在');
    if (db.members.some((x) => x.badges.some((b) => b.code.toUpperCase() === code!.toUpperCase()))) throw new MockError(409, 'badge_conflict', `编号「${code}」已被使用`);
    if (m.badges.length >= 5) throw new MockError(400, 'too_many', '每人最多 5 枚徽章');
    m.badges.push({ code: code!.toUpperCase(), label: label || '好朋友', style, design, grantedAt: this.now().toISOString() });
    this.save(db);
    return m;
  }

  /** 改徽章设计：站长改任何人的；好朋友只能改自己的（编号 / 名称不变）。与 Worker setBadgeDesign 相同的校验。 */
  private setBadgeDesign(memberId: number, code: string, input: unknown): Member {
    const o = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
    const extra = Object.keys(o).filter((k) => k !== 'design');
    if (extra.length) throw new MockError(400, 'validation_error', '参数校验失败', [{ path: extra[0]!, message: '只能修改 design' }]);
    const d = validateBadgeDesign(o.design);
    if (!d.ok) throw new MockError(400, 'validation_error', '参数校验失败', [{ path: 'design', message: d.error }]);
    const db = structuredClone(this.db());
    const m = db.members.find((x) => x.id === memberId);
    const b = m?.badges.find((x) => x.code === code.toUpperCase());
    if (!m || !b) throw new MockError(404, 'not_found', '徽章不存在');
    b.design = d.design;
    this.save(db);
    return this.withDesigns(m);
  }

  /** 读取时再校验一遍设计（与 Worker 读库时一样）：坏数据退回旧材质对应的预设。 */
  private withDesigns(m: Member): Member {
    return { ...m, badges: m.badges.map((b) => ({ ...b, design: normalizeBadgeDesign(b.design, legacyDesign(b.style)) })) };
  }

  // ---------------------------------------------------------------- 文章评论（与 Worker comments.ts 相同的规则）
  private commentHits: number[] = [];
  private listComments(slug: string): { comments: PostComment[]; total: number } {
    const comments = (this.db().comments ?? []).filter((c) => c.slug === slug && c.status === 'approved').sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    return { comments, total: comments.length };
  }

  private createComment(slug: string, input: unknown, headers: Record<string, string>): { comment: PostComment | null; status: CommentStatus } {
    const v = validateComment(input);
    if (!v.ok) throw new MockError(400, 'validation_error', '参数校验失败', [{ path: v.path, message: v.error }]);
    const now = this.now().getTime();
    this.commentHits = this.commentHits.filter((t) => now - t < 600_000);
    if (this.commentHits.length >= 5) throw new MockError(429, 'rate_limited', '评论太频繁啦，10 分钟后再来');
    this.commentHits.push(now);
    if (v.spam) return { comment: null, status: 'pending' };
    const db = structuredClone(this.db());
    if (!db.posts.some((p) => p.slug === slug && p.status === 'published')) throw new MockError(404, 'not_found', '文章不存在');
    db.comments ??= [];
    let parentId: number | null = null;
    let replyTo = '';
    if (v.value.parentId !== null) {
      const target = db.comments.find((c) => c.id === v.value.parentId && c.slug === slug && c.status === 'approved');
      if (!target) throw new MockError(404, 'not_found', '要回复的评论不存在');
      ({ parentId, replyTo } = resolveParent(target));
    }
    let member: Member | null = null;
    try {
      member = headers.authorization ? this.memberFrom(headers) : null;
    } catch {
      member = null;
    }
    // 演示站：访客评论进入审核队列；好朋友直接公开。站长可以在后台「评论审核」里处理。
    const status: CommentStatus = member ? 'approved' : 'pending';
    const c: PostComment = { id: Math.max(0, ...db.comments.map((x) => x.id)) + 1, slug, parentId, replyTo, name: member ? member.name : v.value.name, content: v.value.content, member: !!member, status, createdAt: this.now().toISOString() };
    db.comments.push(c);
    this.save(db);
    if (status === 'approved') this.social.onComment({ id: c.id, slug, parentId, content: c.content, memberId: member?.id ?? null });
    return { comment: c, status };
  }

  private adminComments(status: string | null): { comments: PostComment[]; counts: Record<CommentStatus, number> } {
    const all = (this.db().comments ?? []).slice().sort((a, b) => b.id - a.id);
    const counts = { pending: 0, approved: 0, hidden: 0 } as Record<CommentStatus, number>;
    for (const c of all) counts[c.status]++;
    const st = status === 'pending' || status === 'approved' || status === 'hidden' ? status : null;
    return { comments: st ? all.filter((c) => c.status === st) : all, counts };
  }

  private moderateComment(id: number, action: unknown): { id: number; action: string } {
    if (!isCommentAction(action)) throw new MockError(400, 'validation_error', 'action 只能是 approve / hide / delete');
    const db = structuredClone(this.db());
    db.comments ??= [];
    const c = db.comments.find((x) => x.id === id);
    if (!c) throw new MockError(404, 'not_found', '评论不存在');
    if (action === 'delete') db.comments = db.comments.filter((x) => x.id !== id && x.parentId !== id);
    const wasApproved = c.status === 'approved';
    if (action !== 'delete') c.status = action === 'approve' ? 'approved' : 'hidden';
    this.save(db);
    if (action === 'approve' && !wasApproved) this.social.onComment({ id: c.id, slug: c.slug, parentId: c.parentId, content: c.content, memberId: null });
    return { id, action };
  }

  private revokeBadge(memberId: number, code: string): Member {
    const db = structuredClone(this.db());
    const m = db.members.find((x) => x.id === memberId);
    if (!m) throw new MockError(404, 'not_found', '好朋友不存在');
    m.badges = m.badges.filter((b) => b.code !== code.toUpperCase());
    this.save(db);
    return m;
  }

  private removeMember(id: number): { deleted: true; id: number } {
    const db = structuredClone(this.db());
    const i = db.members.findIndex((x) => x.id === id);
    if (i < 0) throw new MockError(404, 'not_found', '好朋友不存在');
    db.members.splice(i, 1);
    this.save(db);
    return { deleted: true, id };
  }
}
