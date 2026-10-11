/**
 * 页面上同时只让一个声音在响：音乐播放器开始播放时朗读暂停，朗读开始时音乐暂停。
 * 用 window 上的自定义事件通信，两边互不依赖（播放器是懒加载的）。
 */
export type MediaOwner = 'music' | 'tts';
export const MEDIA_EVENT = 'blog:media-claim';

/** 宣布 `owner` 开始出声。 */
export function claimMedia(owner: MediaOwner): void {
  if (typeof dispatchEvent !== 'function') return;
  dispatchEvent(new CustomEvent(MEDIA_EVENT, { detail: { owner } }));
}

/** 别的来源开始出声时调用 cb；返回取消监听的函数。 */
export function onMediaClaim(self: MediaOwner, cb: (by: MediaOwner) => void): () => void {
  const h = (e: Event) => {
    const by = (e as CustomEvent<{ owner?: MediaOwner }>).detail?.owner;
    if (by && by !== self) cb(by);
  };
  if (typeof addEventListener !== 'function') return () => {};
  addEventListener(MEDIA_EVENT, h);
  return () => removeEventListener(MEDIA_EVENT, h);
}
