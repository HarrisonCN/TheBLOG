/**
 * L18 摄影与创作工具（PHOTOGRAPHY & CREATOR STUDIO）的纯函数：Worker 与前端演示 mock 共用（web/src/studio-core.ts 为同内容副本，改动需同步；测试会比对）。
 * 不依赖 D1 / DOM：EXIF 归一化与筛选、项目 / 开发日志 / 摄影专题 / 协作邀请的输入校验、媒体删除影响、修订快照差异、数据中心按天汇总。
 */
export type Check<T> = { ok: true; value: T } | { ok: false; path: string; error: string };
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
function text(v: unknown, max: number, path: string, min = 0): Check<string> {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') return { ok: false, path, error: '必须是字符串' };
  const s = v.trim();
  if (CTRL.test(s.replace(/[\n\r\t]/g, ''))) return { ok: false, path, error: '包含不允许的控制字符' };
  if (s.length < min) return { ok: false, path, error: '不能为空' };
  if (s.length > max) return { ok: false, path, error: `最多 ${max} 个字` };
  return { ok: true, value: s };
}

// ============================================================ EXIF 归一化与筛选
export const DEVICE_KINDS = ['phone', 'camera', 'other'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];
export const DEVICE_LABEL: Record<DeviceKind, string> = { phone: '手机', camera: '相机', other: '其他' };
/** 常见手机品牌 / 型号前缀（机身字段里出现即视为手机拍摄）。 */
const PHONE_RE = /\b(iphone|pixel|oppo|oneplus|一加|find\s?x|reno|xiaomi|小米|redmi|红米|huawei|华为|mate\s?\d|pura|honor|荣耀|vivo|iqoo|samsung\s+galaxy|galaxy\s+s\d|sm-[a-z]\d|realme|meizu|魅族|nothing\s+phone|motorola|moto\s?g|sony\s+xperia|xperia)\b/i;
const CAMERA_RE = /\b(canon|eos|nikon|z\s?\d|sony\s+(a|α|ilce|zv)|ilce|fujifilm|fuji|x-t\d|x100|gfx|panasonic|lumix|olympus|om\s?system|om-\d|leica|ricoh|gr\s?i{1,3}x?|pentax|hasselblad|sigma\s+(fp|bf)|dji|gopro|insta360)\b/i;
export function deviceKind(camera: string | undefined | null): DeviceKind {
  const c = (camera ?? '').trim();
  if (!c) return 'other';
  if (PHONE_RE.test(c) || /手机|phone/i.test(c)) return 'phone';
  if (CAMERA_RE.test(c) || /相机|camera/i.test(c)) return 'camera';
  return 'other';
}
const num = (s: string | undefined | null, re: RegExp): number | null => {
  const m = re.exec(String(s ?? '').replace(/,/g, '.'));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
};
/** "24mm" / "6.86 mm (24mm 等效)" / "50" → 毫米数；优先取「等效」焦距（手机物理焦距很小，等效值才有可比性）。 */
export function parseFocal(s: string | undefined | null): number | null {
  const eq = num(s, /(\d+(?:\.\d+)?)\s*mm[^\d]{0,6}(?:等效|equiv|eq)/i) ?? num(s, /(?:等效|equiv\.?|eq\.?)\s*(\d+(?:\.\d+)?)/i);
  const v = eq ?? num(s, /(\d+(?:\.\d+)?)\s*(?:mm)?/i);
  return v !== null && v <= 2000 ? Math.round(v * 10) / 10 : null;
}
/** "f/1.8" / "F2.8" / "ƒ/4" / "1.8" → 光圈值。 */
export function parseAperture(s: string | undefined | null): number | null {
  const v = num(s, /(?:f|ƒ)?\s*\/?\s*(\d+(?:\.\d+)?)/i);
  return v !== null && v <= 128 ? Math.round(v * 10) / 10 : null;
}
/** "ISO 100" / "100" → ISO。 */
export function parseIso(s: string | undefined | null): number | null {
  const v = num(s, /(\d{2,6})/);
  return v !== null && v <= 409600 ? Math.round(v) : null;
}
export interface ExifNorm { camera: string; lens: string; device: DeviceKind; focalMm: number | null; aperture: number | null; iso: number | null }
export function normalizeExif(p: { camera?: string; lens?: string; focal?: string; aperture?: string; iso?: string } | null | undefined): ExifNorm {
  const camera = (p?.camera ?? '').trim().slice(0, 60);
  return { camera, lens: (p?.lens ?? '').trim().slice(0, 60), device: deviceKind(camera), focalMm: parseFocal(p?.focal), aperture: parseAperture(p?.aperture), iso: parseIso(p?.iso) };
}
/** 筛选用的区间桶（焦距按等效焦段、光圈按常见档位、ISO 按量级）。 */
export const FOCAL_BUCKETS = [
  { key: 'uw', label: '超广角 <20mm', min: 0, max: 20 },
  { key: 'wide', label: '广角 20–35mm', min: 20, max: 35 },
  { key: 'std', label: '标准 35–70mm', min: 35, max: 70 },
  { key: 'tele', label: '中长焦 70–200mm', min: 70, max: 200 },
  { key: 'super', label: '超长焦 ≥200mm', min: 200, max: 100000 },
] as const;
export const APERTURE_BUCKETS = [
  { key: 'fast', label: '大光圈 ≤f/2', min: 0, max: 2.0001 },
  { key: 'mid', label: 'f/2.2–f/5.6', min: 2.0001, max: 5.6001 },
  { key: 'small', label: '小光圈 ≥f/6.3', min: 5.6001, max: 1000 },
] as const;
export const ISO_BUCKETS = [
  { key: 'low', label: 'ISO ≤200', min: 0, max: 201 },
  { key: 'mid', label: 'ISO 201–1600', min: 201, max: 1601 },
  { key: 'high', label: 'ISO >1600', min: 1601, max: 10_000_000 },
] as const;
type Bucket = { key: string; label: string; min: number; max: number };
export const bucketOf = (v: number | null, bs: readonly Bucket[]): string | null => (v === null ? null : (bs.find((b) => v >= b.min && v < b.max)?.key ?? null));
export interface ExifQuery { device: DeviceKind | null; camera: string | null; lens: string | null; focal: string | null; aperture: string | null; iso: string | null }
export const EMPTY_EXIF_QUERY: ExifQuery = { device: null, camera: null, lens: null, focal: null, aperture: null, iso: null };
export function checkExifQuery(sp: URLSearchParams): Check<ExifQuery> {
  const q: ExifQuery = { ...EMPTY_EXIF_QUERY };
  const d = sp.get('device');
  if (d) {
    if (!DEVICE_KINDS.includes(d as DeviceKind)) return { ok: false, path: 'device', error: 'device 只能是 phone / camera / other' };
    q.device = d as DeviceKind;
  }
  for (const k of ['camera', 'lens'] as const) {
    const v = sp.get(k);
    if (v) {
      if (v.length > 60 || CTRL.test(v)) return { ok: false, path: k, error: `${k} 无效` };
      q[k] = v;
    }
  }
  const pick = (k: 'focal' | 'aperture' | 'iso', bs: readonly Bucket[]): string | null => {
    const v = sp.get(k);
    if (!v) return null;
    if (!bs.some((b) => b.key === v)) throw new Error(k);
    return v;
  };
  try {
    q.focal = pick('focal', FOCAL_BUCKETS);
    q.aperture = pick('aperture', APERTURE_BUCKETS);
    q.iso = pick('iso', ISO_BUCKETS);
  } catch (x) {
    const k = (x as Error).message;
    return { ok: false, path: k, error: `${k} 区间无效` };
  }
  return { ok: true, value: q };
}
export const exifQueryActive = (q: ExifQuery): boolean => Object.values(q).some((v) => v !== null);
export function matchesExif(x: ExifNorm, q: ExifQuery): boolean {
  if (q.device && x.device !== q.device) return false;
  if (q.camera && x.camera.toLowerCase() !== q.camera.toLowerCase()) return false;
  if (q.lens && x.lens.toLowerCase() !== q.lens.toLowerCase()) return false;
  if (q.focal && bucketOf(x.focalMm, FOCAL_BUCKETS) !== q.focal) return false;
  if (q.aperture && bucketOf(x.aperture, APERTURE_BUCKETS) !== q.aperture) return false;
  if (q.iso && bucketOf(x.iso, ISO_BUCKETS) !== q.iso) return false;
  return true;
}
/** SQL 条件（work_exif 别名 x）：区间桶翻译成数值范围，避免在 SQL 里解析字符串。 */
export function exifSql(q: ExifQuery): { sql: string; args: (string | number)[] } {
  const parts: string[] = [];
  const args: (string | number)[] = [];
  if (q.device) (parts.push('x.device = ?'), args.push(q.device));
  if (q.camera) (parts.push('x.camera = ? COLLATE NOCASE'), args.push(q.camera));
  if (q.lens) (parts.push('x.lens = ? COLLATE NOCASE'), args.push(q.lens));
  const range = (col: string, key: string | null, bs: readonly Bucket[]) => {
    const b = key ? bs.find((y) => y.key === key) : null;
    if (b) (parts.push(`(x.${col} >= ? AND x.${col} < ?)`), args.push(b.min, b.max));
  };
  range('focal_mm', q.focal, FOCAL_BUCKETS);
  range('aperture', q.aperture, APERTURE_BUCKETS);
  range('iso', q.iso, ISO_BUCKETS);
  return { sql: parts.join(' AND '), args };
}
export interface ExifFacets { device: { key: DeviceKind; n: number }[]; camera: { key: string; n: number }[]; lens: { key: string; n: number }[]; focal: { key: string; n: number }[]; aperture: { key: string; n: number }[]; iso: { key: string; n: number }[] }
/** 由一组已归一化的 EXIF 统计筛选项（每个维度只列出现过的值，机身 / 镜头最多 12 个，按数量排序）。 */
export function exifFacets(rows: ExifNorm[]): ExifFacets {
  const count = (keys: (string | null)[]) => {
    const m = new Map<string, number>();
    for (const k of keys) if (k) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m].map(([key, n]) => ({ key, n }));
  };
  const top = (xs: { key: string; n: number }[]) => xs.sort((a, b) => b.n - a.n || a.key.localeCompare(b.key)).slice(0, 12);
  const ordered = (xs: { key: string; n: number }[], bs: readonly Bucket[]) => bs.map((b) => xs.find((x) => x.key === b.key)).filter((x): x is { key: string; n: number } => !!x);
  return {
    device: DEVICE_KINDS.map((key) => ({ key, n: rows.filter((r) => r.device === key).length })).filter((x) => x.n > 0),
    camera: top(count(rows.map((r) => r.camera || null))),
    lens: top(count(rows.map((r) => r.lens || null))),
    focal: ordered(count(rows.map((r) => bucketOf(r.focalMm, FOCAL_BUCKETS))), FOCAL_BUCKETS),
    aperture: ordered(count(rows.map((r) => bucketOf(r.aperture, APERTURE_BUCKETS))), APERTURE_BUCKETS),
    iso: ordered(count(rows.map((r) => bucketOf(r.iso, ISO_BUCKETS))), ISO_BUCKETS),
  };
}

// ============================================================ 协作（共同作者 / 项目成员）
export const COLLAB_ROLES = ['editor', 'contributor'] as const;
export type CollabRole = (typeof COLLAB_ROLES)[number];
export const COLLAB_ROLE_LABEL: Record<CollabRole | 'owner', string> = { owner: '所有者', editor: '可编辑', contributor: '署名贡献者' };
export type CollabStatus = 'invited' | 'accepted' | 'declined' | 'removed';
export const COLLAB_STATUS_LABEL: Record<CollabStatus, string> = { invited: '邀请中', accepted: '已加入', declined: '已婉拒', removed: '曾参与' };
export const MAX_COAUTHORS = 8;
export const MAX_REVISIONS = 50;
export function checkInvite(input: unknown, roles: readonly CollabRole[] = COLLAB_ROLES): Check<{ username: string; role: CollabRole; label: string }> {
  const o = (input ?? {}) as Record<string, unknown>;
  const username = typeof o.username === 'string' ? o.username.trim().replace(/^@/, '').toLowerCase() : '';
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return { ok: false, path: 'username', error: '请输入对方的用户名' };
  const role = (o.role ?? 'editor') as CollabRole;
  if (!roles.includes(role)) return { ok: false, path: 'role', error: `role 只能是 ${roles.join(' / ')}` };
  const label = text(o.label, 30, 'label');
  if (!label.ok) return label;
  return { ok: true, value: { username, role, label: label.value } };
}
/** 作品的编辑权限：所有者全部；已接受邀请的可编辑共同作者能改内容和图片，不能改可见范围、删除、发布、管理成员。 */
export type WorkRight = 'edit' | 'visibility' | 'delete' | 'publish' | 'members' | 'restore';
export function workCan(role: 'owner' | CollabRole | null, status: CollabStatus | null, right: WorkRight): boolean {
  if (role === 'owner') return true;
  if (role !== 'editor' || status !== 'accepted') return false;
  return right === 'edit' || right === 'restore';
}
/** 修订快照（只含可编辑字段；媒体带上传者，用于删除影响判断）。 */
export interface RevMedia { url: string; alt: string; width: number; height: number; uploadedBy: number | null }
export interface RevSnapshot { title: string; body: string; caption: string; notes: string; params: Record<string, string>; media: RevMedia[]; visibility: string }
/** 两个快照之间改了哪些字段（给修订历史列表显示「改了 标题、图片」）。 */
export function snapshotDiff(a: RevSnapshot | null, b: RevSnapshot): string[] {
  if (!a) return ['创建'];
  const out: string[] = [];
  const L: Record<string, string> = { title: '标题', body: '正文', caption: '图注', notes: '手记', visibility: '可见范围' };
  for (const k of ['title', 'body', 'caption', 'notes', 'visibility'] as const) if (a[k] !== b[k]) out.push(L[k]!);
  if (JSON.stringify(a.params) !== JSON.stringify(b.params)) out.push('拍摄参数');
  const mu = (s: RevSnapshot) => s.media.map((m) => `${m.url}|${m.alt}`).join('\n');
  if (mu(a) !== mu(b)) out.push('图片');
  return out.length ? out : ['无内容变化'];
}
/**
 * 媒体删除影响：编辑后的图片列表与当前列表比较，找出被移除的图片。
 *  - 别人上传的图片：只有所有者能移除（编辑者 → blocked）；
 *  - 所有者移除别人上传的图片：需要确认（needsConfirm），并列出上传者，让所有者知道会影响谁。
 * uploadedBy 为 null = 所有者本人上传（L18 之前的旧图也按所有者处理）。
 */
export function mediaRemoval(cur: RevMedia[], next: { url: string }[], actorId: number, ownerId: number): { removed: RevMedia[]; blocked: RevMedia[]; needsConfirm: RevMedia[] } {
  const keep = new Set(next.map((m) => m.url));
  const removed = cur.filter((m) => !keep.has(m.url));
  const others = removed.filter((m) => (m.uploadedBy ?? ownerId) !== actorId);
  if (actorId !== ownerId) return { removed, blocked: others, needsConfirm: [] };
  return { removed, blocked: [], needsConfirm: others };
}

// ============================================================ 项目页（Creator Hub）
export const PROJECT_STATUSES = ['active', 'paused', 'done', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = { active: '进行中', paused: '暂停', done: '已完成', archived: '已归档' };
export const PROJECT_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const GITHUB_REPO_RE = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})\/?$/;
const HTTPS_URL = /^https:\/\/[^\s<>"']{3,300}$/;
const SITE_IMG = /^\/(?:api\/)?(?:media|images|uploads)\/[\w./-]{1,200}$/;
export const MAX_PROJECTS = 30;
export const MAX_PROJECT_LINKS = 60;
export interface ProjectInput { slug: string; title: string; tagline: string; description: string; status: ProjectStatus; repoUrl: string; homepageUrl: string; coverUrl: string; visibility: 'public' | 'private' }
export function checkProject(input: unknown, cur?: ProjectInput): Check<ProjectInput> {
  const o = (input ?? {}) as Record<string, unknown>;
  const has = (k: string) => k in o || !cur;
  const slug = cur ? cur.slug : typeof o.slug === 'string' ? o.slug.trim().toLowerCase() : '';
  if (!PROJECT_SLUG_RE.test(slug) || slug.length < 2) return { ok: false, path: 'slug', error: '地址只能是 2–40 位小写字母、数字和连字符' };
  const title = has('title') ? text(o.title, 60, 'title', 1) : ({ ok: true, value: cur!.title } as const);
  if (!title.ok) return title;
  const tagline = has('tagline') ? text(o.tagline, 120, 'tagline') : ({ ok: true, value: cur!.tagline } as const);
  if (!tagline.ok) return tagline;
  const description = has('description') ? text(o.description, 8000, 'description') : ({ ok: true, value: cur!.description } as const);
  if (!description.ok) return description;
  const status = (has('status') ? (o.status ?? 'active') : cur!.status) as ProjectStatus;
  if (!PROJECT_STATUSES.includes(status)) return { ok: false, path: 'status', error: 'status 只能是 active / paused / done / archived' };
  const repoUrl = has('repoUrl') ? String(o.repoUrl ?? '').trim() : cur!.repoUrl;
  if (repoUrl && !GITHUB_REPO_RE.test(repoUrl)) return { ok: false, path: 'repoUrl', error: '仓库地址需要是 https://github.com/用户/仓库' };
  const homepageUrl = has('homepageUrl') ? String(o.homepageUrl ?? '').trim() : cur!.homepageUrl;
  if (homepageUrl && !HTTPS_URL.test(homepageUrl)) return { ok: false, path: 'homepageUrl', error: '主页需要是 https 链接' };
  const coverUrl = has('coverUrl') ? String(o.coverUrl ?? '').trim() : cur!.coverUrl;
  if (coverUrl && !SITE_IMG.test(coverUrl) && !(HTTPS_URL.test(coverUrl) && /\.(?:jpe?g|png|webp|avif|gif)(?:\?.*)?$/i.test(coverUrl)) && !/^(?:data:image\/|\.?\/?demo\/)/.test(coverUrl)) return { ok: false, path: 'coverUrl', error: '封面需要是本站上传的图片或 https 图片' };
  const visibility = (has('visibility') ? (o.visibility ?? 'public') : cur!.visibility) as ProjectInput['visibility'];
  if (visibility !== 'public' && visibility !== 'private') return { ok: false, path: 'visibility', error: 'visibility 只能是 public / private' };
  return { ok: true, value: { slug, title: title.value, tagline: tagline.value, description: description.value, status, repoUrl: repoUrl.replace(/\/$/, ''), homepageUrl, coverUrl, visibility } };
}
export const LOG_KINDS = ['log', 'release'] as const;
export type LogKind = (typeof LOG_KINDS)[number];
export const LOG_KIND_LABEL: Record<LogKind, string> = { log: '开发日志', release: '版本发布' };
export const VERSION_RE = /^v?\d{1,4}(?:\.\d{1,4}){0,3}(?:-[0-9A-Za-z.-]{1,20})?$/;
export interface LogInput { kind: LogKind; title: string; body: string; version: string }
export function checkLog(input: unknown): Check<LogInput> {
  const o = (input ?? {}) as Record<string, unknown>;
  const kind = (o.kind ?? 'log') as LogKind;
  if (!LOG_KINDS.includes(kind)) return { ok: false, path: 'kind', error: 'kind 只能是 log / release' };
  const title = text(o.title, 80, 'title', 1);
  if (!title.ok) return title;
  const body = text(o.body, 8000, 'body');
  if (!body.ok) return body;
  const version = String(o.version ?? '').trim();
  if (kind === 'release' && !VERSION_RE.test(version)) return { ok: false, path: 'version', error: '版本发布需要版本号，如 1.2.0' };
  if (kind === 'log' && version && !VERSION_RE.test(version)) return { ok: false, path: 'version', error: '版本号格式不正确' };
  return { ok: true, value: { kind, title: title.value, body: body.value, version } };
}
export interface LinkInput { kind: 'work' | 'post'; ref: string }
export function checkLinks(input: unknown): Check<LinkInput[]> {
  const raw = (input as { links?: unknown } | null)?.links ?? input;
  if (!Array.isArray(raw)) return { ok: false, path: 'links', error: 'links 必须是数组' };
  if (raw.length > MAX_PROJECT_LINKS) return { ok: false, path: 'links', error: `最多关联 ${MAX_PROJECT_LINKS} 项` };
  const out: LinkInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const x = (raw[i] ?? {}) as Record<string, unknown>;
    const kind = x.kind as LinkInput['kind'];
    const ref = String(x.ref ?? '').trim();
    if (kind !== 'work' && kind !== 'post') return { ok: false, path: `links.${i}.kind`, error: 'kind 只能是 work / post' };
    if (kind === 'work' ? !/^\d{1,10}$/.test(ref) : !/^[A-Za-z0-9][A-Za-z0-9-]{0,159}$/.test(ref)) return { ok: false, path: `links.${i}.ref`, error: 'ref 无效' };
    if (!out.some((y) => y.kind === kind && y.ref === ref)) out.push({ kind, ref });
  }
  return { ok: true, value: out };
}

// ============================================================ 摄影专题（photo essay）
export const FEATURE_SLUG_RE = PROJECT_SLUG_RE;
export const MAX_FEATURE_BLOCKS = 40;
export type FeatureBlock = { t: 'work'; id: number; caption: string } | { t: 'text'; text: string };
export interface FeatureInput { slug: string; title: string; dek: string; blocks: FeatureBlock[] }
export function checkFeature(input: unknown, cur?: FeatureInput): Check<FeatureInput> {
  const o = (input ?? {}) as Record<string, unknown>;
  const has = (k: string) => k in o || !cur;
  const slug = cur ? cur.slug : typeof o.slug === 'string' ? o.slug.trim().toLowerCase() : '';
  if (!FEATURE_SLUG_RE.test(slug) || slug.length < 2) return { ok: false, path: 'slug', error: '地址只能是 2–40 位小写字母、数字和连字符' };
  const title = has('title') ? text(o.title, 60, 'title', 1) : ({ ok: true, value: cur!.title } as const);
  if (!title.ok) return title;
  const dek = has('dek') ? text(o.dek, 300, 'dek') : ({ ok: true, value: cur!.dek } as const);
  if (!dek.ok) return dek;
  if (!has('blocks')) return { ok: true, value: { slug, title: title.value, dek: dek.value, blocks: cur!.blocks } };
  const raw = o.blocks ?? [];
  if (!Array.isArray(raw)) return { ok: false, path: 'blocks', error: 'blocks 必须是数组' };
  if (raw.length > MAX_FEATURE_BLOCKS) return { ok: false, path: 'blocks', error: `最多 ${MAX_FEATURE_BLOCKS} 段` };
  const blocks: FeatureBlock[] = [];
  for (let i = 0; i < raw.length; i++) {
    const b = (raw[i] ?? {}) as Record<string, unknown>;
    if (b.t === 'work') {
      const id = Number(b.id);
      if (!Number.isInteger(id) || id <= 0) return { ok: false, path: `blocks.${i}.id`, error: '作品无效' };
      const caption = text(b.caption, 500, `blocks.${i}.caption`);
      if (!caption.ok) return caption;
      blocks.push({ t: 'work', id, caption: caption.value });
    } else if (b.t === 'text') {
      const tx = text(b.text, 3000, `blocks.${i}.text`, 1);
      if (!tx.ok) return tx;
      blocks.push({ t: 'text', text: tx.value });
    } else return { ok: false, path: `blocks.${i}.t`, error: '段落类型只能是 work / text' };
  }
  return { ok: true, value: { slug, title: title.value, dek: dek.value, blocks } };
}

// ============================================================ 创作者数据中心（只做按天汇总）
export const STAT_KINDS = ['work', 'project', 'feature', 'profile'] as const;
export type StatKind = (typeof STAT_KINDS)[number];
export const STAT_RANGES = [7, 30, 90] as const;
export const dayKey = (t: number | string | Date): string => new Date(t).toISOString().slice(0, 10);
/**
 * 来源只保留域名（不存完整地址、不存查询参数）；本站、空值、非 http(s)、IP 地址一律丢弃（归为「直接访问」）。
 */
export function referrerDomain(ref: unknown, selfHost = ''): string | null {
  if (typeof ref !== 'string' || !ref || ref.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(ref);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const h = u.hostname.toLowerCase().replace(/^www\./, '');
  if (!h || h === selfHost.toLowerCase().replace(/^www\./, '') || /^[\d.]+$/.test(h) || h.includes(':') || h === 'localhost') return null;
  return h.slice(0, 80);
}
export function checkView(input: unknown): Check<{ kind: StatKind; ref: string }> {
  const o = (input ?? {}) as Record<string, unknown>;
  const kind = o.kind as StatKind;
  if (!STAT_KINDS.includes(kind)) return { ok: false, path: 'kind', error: 'kind 无效' };
  const ref = String(o.ref ?? '').trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(ref)) return { ok: false, path: 'ref', error: 'ref 无效' };
  return { ok: true, value: { kind, ref } };
}
/** 把稀疏的按天计数补成连续序列（没有数据的日子为 0），最近一天在最后。 */
export function fillSeries(rows: { day: string; n: number }[], days: number, now = Date.now()): { day: string; n: number }[] {
  const m = new Map(rows.map((r) => [r.day, r.n]));
  const out: { day: string; n: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = dayKey(now - i * 86_400_000);
    out.push({ day: d, n: m.get(d) ?? 0 });
  }
  return out;
}
export const sumSeries = (s: { n: number }[]): number => s.reduce((a, b) => a + b.n, 0);
export const STATS_PRIVACY_NOTE =
  '数据中心只对你本人可见。浏览量按「每件内容每天一个数字」汇总，不记录是谁看的，不保存 IP、设备或 Cookie；来源只保留对方网站的域名。回应、收藏、评论、粉丝数来自公开互动本身。公开页面上的计数（回应 / 收藏 / 评论）与这里的私有浏览量分开，浏览量从不公开。';
