/** 文章表情回应：固定表情集合（与 worker/src/reactions.ts 的 REACTION_EMOJI 保持一致）。 */
export const REACTIONS = [
  { emoji: '👍', label: '赞' },
  { emoji: '❤️', label: '喜欢' },
  { emoji: '🎉', label: '撒花' },
  { emoji: '🤯', label: '震撼' },
  { emoji: '🤔', label: '想一想' },
  { emoji: '📷', label: '好照片' },
] as const;
export type ReactionEmoji = (typeof REACTIONS)[number]['emoji'];
export const REACTION_SET: readonly string[] = REACTIONS.map((r) => r.emoji);
export const isReaction = (e: unknown): e is ReactionEmoji => typeof e === 'string' && REACTION_SET.includes(e);

/** 本机记住自己点过哪些（服务器只存加盐哈希，不会告诉前端「你点过」）。 */
export const mineKey = (slug: string) => `blog-react:${slug}`;
export function readMine(storage: Pick<Storage, 'getItem'>, slug: string): string[] {
  try {
    const v = JSON.parse(storage.getItem(mineKey(slug)) || '[]') as unknown;
    return Array.isArray(v) ? v.filter(isReaction) : [];
  } catch {
    return [];
  }
}
export function toggleMine(list: string[], emoji: string): { list: string[]; on: boolean } {
  const on = !list.includes(emoji);
  return { list: on ? [...list, emoji] : list.filter((x) => x !== emoji), on };
}
/** 乐观更新：先在本地改计数，失败再回滚。 */
export function applyLocal(counts: Record<string, number>, emoji: string, on: boolean): Record<string, number> {
  const n = Math.max(0, (counts[emoji] ?? 0) + (on ? 1 : -1));
  const next = { ...counts, [emoji]: n };
  if (!n) delete next[emoji];
  return next;
}
