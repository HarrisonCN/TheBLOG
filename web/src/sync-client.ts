/**
 * L30 / v1.30.0 跨设备同步（按需加载，只在登录的好朋友浏览时运行）：
 * 本机的阅读进度（localStorage blog-reading）和稍后读（blog-later）与服务端的同步文档合并（sync-core.mergeSync），
 * 合并结果写回本机、再推回服务端。删除稍后读用墓碑：记住上次同步时的清单（blog-later-synced），现在没有了就是删了。
 * 时机：打开页面 / 回到标签页时拉取合并；本机有变化时（每 20 秒检查一次 + 离开页面时）推送。未登录时什么都不做。
 */
import { request } from './api';
import { currentMember } from './community';
import { LATER_KEY, parseLater } from './reading-core';
import { READ_KEY, parseHistory } from './reading';
import { emptySyncDoc, laterTombstones, mergeSync, type SyncDoc } from './sync-core';

const SYNCED_KEY = 'blog-later-synced';
const TOMB_KEY = 'blog-later-removed';
const REV_KEY = 'blog-sync-rev';
let started = false;
let lastPushed = '';
let busy = false;
let lastPull = 0;

function auth(): Record<string, string> | null {
  const m = currentMember();
  return m ? { authorization: `Bearer ${m.token}` } : null;
}
function readJson<T>(k: string, d: T): T {
  try {
    return (JSON.parse(localStorage.getItem(k) ?? 'null') as T) ?? d;
  } catch {
    return d;
  }
}
/** 本机现状 → 同步文档（含新产生的墓碑） */
function localDoc(now = Date.now()): SyncDoc {
  const history = parseHistory(localStorage.getItem(READ_KEY));
  const later = parseLater(localStorage.getItem(LATER_KEY));
  const synced = readJson<string[]>(SYNCED_KEY, []);
  const tombs = [...readJson<{ slug: string; at: number }[]>(TOMB_KEY, []), ...laterTombstones(synced, later, now)];
  return { history: history.map((h) => ({ slug: h.slug, title: h.title, cover: h.cover ?? null, pct: h.pct, y: h.y ?? 0, at: h.at })), later, laterRemoved: tombs };
}
/** 合并结果写回本机（只写真的变了的键，避免打扰其他标签页） */
function applyLocal(doc: SyncDoc): void {
  const set = (k: string, v: unknown) => {
    const s = JSON.stringify(v);
    if (localStorage.getItem(k) !== s) localStorage.setItem(k, s);
  };
  set(READ_KEY, doc.history);
  set(LATER_KEY, doc.later);
  set(SYNCED_KEY, doc.later.map((x) => x.slug));
  set(TOMB_KEY, doc.laterRemoved);
}

/** 拉取 → 合并 → 写回本机 → 有差异就推送。 */
export async function syncNow(force = false): Promise<SyncDoc | null> {
  const h = auth();
  if (!h || busy) return null;
  busy = true;
  try {
    const local = localDoc();
    let merged = local;
    if (force || Date.now() - lastPull > 15_000) {
      const remote = await request<{ doc: SyncDoc; rev: number }>('/api/social/sync/reading', { headers: h }).catch(() => null);
      lastPull = Date.now();
      merged = mergeSync(remote?.doc ?? emptySyncDoc(), local);
      if (remote) localStorage.setItem(REV_KEY, String(remote.rev));
      applyLocal(merged);
      // 远端已经包含本机的全部内容时不必推送
      if (remote && JSON.stringify(mergeSync(remote.doc, merged)) === JSON.stringify(remote.doc)) {
        lastPushed = JSON.stringify(merged);
        return merged;
      }
    }
    const body = JSON.stringify(merged);
    if (body === lastPushed && !force) return merged;
    const res = await request<{ doc: SyncDoc; rev: number }>('/api/social/sync/reading', { method: 'PUT', headers: { ...h, 'content-type': 'application/json' }, body }).catch(() => null);
    if (res) {
      applyLocal(res.doc);
      localStorage.setItem(REV_KEY, String(res.rev));
      lastPushed = JSON.stringify(res.doc);
    }
    return res?.doc ?? merged;
  } finally {
    busy = false;
  }
}

/** 开始自动同步（重复调用无副作用；每次换页触发一次检查）。 */
export function startReadingSync(): void {
  void syncNow();
  if (started) return;
  started = true;
  setInterval(() => {
    if (!document.hidden) void syncNow();
  }, 20_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void syncNow(true);
    else void syncNow();
  });
  addEventListener('pagehide', () => void syncNow());
}
