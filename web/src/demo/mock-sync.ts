/**
 * L30 演示 mock：跨设备同步（阅读进度 + 稍后读），与 worker/src/sync.ts 同规则。
 * 演示站的「另一台设备」= 同一个浏览器里用同一个账号登录的另一个标签页 / 另一个浏览器配置。
 */
import { checkSyncDoc, emptySyncDoc, mergeSync, type SyncDoc } from '../sync-core';
import { SocialError } from './mock-social';
import type { Member } from './community-types';

export interface SyncState {
  docs: Record<string, { doc: SyncDoc; rev: number; updatedAt: string }>;
}
export interface SyncHost {
  state(): SyncState;
  commit(mutate: (s: SyncState) => void): void;
  memberFrom(headers: Record<string, string>): Member;
  now(): Date;
}

export class MockSync {
  constructor(private h: SyncHost) {}
  get(headers: Record<string, string>) {
    const me = this.h.memberFrom(headers);
    const cur = this.h.state().docs[String(me.id)];
    return { doc: cur?.doc ?? emptySyncDoc(), rev: cur?.rev ?? 0, updatedAt: cur?.updatedAt ?? null };
  }
  put(headers: Record<string, string>, input: unknown) {
    const me = this.h.memberFrom(headers);
    if (JSON.stringify(input ?? null).length > 64 * 1024) throw new SocialError(413, 'too_large', '同步数据太大');
    const v = checkSyncDoc(input);
    if (!v.ok) throw new SocialError(400, 'validation_error', v.message);
    let out!: { doc: SyncDoc; rev: number; updatedAt: string };
    this.h.commit((s) => {
      const cur = s.docs[String(me.id)];
      const doc = mergeSync(cur?.doc ?? emptySyncDoc(), v.value);
      const changed = !cur || JSON.stringify(doc) !== JSON.stringify(cur.doc);
      out = { doc, rev: (cur?.rev ?? 0) + (changed ? 1 : 0), updatedAt: changed ? this.h.now().toISOString() : (cur?.updatedAt ?? this.h.now().toISOString()) };
      s.docs[String(me.id)] = out;
    });
    return out;
  }
  exportFor(id: number) {
    return { readingSync: this.h.state().docs[String(id)]?.doc ?? emptySyncDoc() };
  }
  purge(id: number): void {
    this.h.commit((s) => {
      delete s.docs[String(id)];
    });
  }
  route(m: string, sub: string, body: unknown, headers: Record<string, string>): { status: number; body: unknown } | null {
    if (sub !== '/sync/reading') return null;
    if (m === 'GET') return { status: 200, body: this.get(headers) };
    if (m === 'PUT' || m === 'POST') return { status: 200, body: this.put(headers, body) };
    return null;
  }
}
