/**
 * L31 / v1.31.0 ActivityPub 只读试验（web 与 worker 共用同一份文件，内容必须完全一致）。
 * 只提供 WebFinger、Actor（Service）与 Outbox；没有 inbox，不接收关注 / 回复，不向其他实例推送。
 */
export const AP_CONTENT_TYPE = 'application/activity+json';
export const AP_PUBLIC = 'https://www.w3.org/ns/activitystreams#Public';
export const AP_CONTEXT = ['https://www.w3.org/ns/activitystreams'];
export const AP_MAX_ITEMS = 20;

export interface ApSite { url: string; apiBase: string; title: string; description: string; icon?: string; handle: string }
export interface ApItem { id: string; url: string; title: string; summary: string; published: string; tags?: string[] }

const trimSlash = (s: string) => s.replace(/\/+$/, '');
export const actorId = (site: ApSite) => `${trimSlash(site.apiBase)}/api/ap/actor`;
export const outboxId = (site: ApSite) => `${trimSlash(site.apiBase)}/api/ap/outbox`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface WebFinger { subject: string; aliases: string[]; links: { rel: string; type?: string; href: string }[] }
export function webfinger(resource: string, site: ApSite): WebFinger | null {
  const m = /^acct:([^@\s]+)@([^@\s]+)$/i.exec((resource ?? '').trim());
  if (!m) return null;
  const host = new URL(site.url).host.toLowerCase();
  if (m[1]!.toLowerCase() !== site.handle.toLowerCase() || m[2]!.toLowerCase() !== host) return null;
  return {
    subject: `acct:${site.handle}@${host}`,
    aliases: [actorId(site), site.url],
    links: [
      { rel: 'self', type: AP_CONTENT_TYPE, href: actorId(site) },
      { rel: 'http://webfinger.net/rel/profile-page', type: 'text/html', href: site.url },
    ],
  };
}

export function apActor(site: ApSite) {
  return {
    '@context': AP_CONTEXT,
    type: 'Service' as const,
    id: actorId(site),
    preferredUsername: site.handle,
    name: site.title,
    summary: `<p>${esc(site.description)}</p><p>只读试验：本账号不接收关注与回复。</p>`,
    url: site.url,
    outbox: outboxId(site),
    discoverable: true,
    ...(site.icon ? { icon: { type: 'Image', url: site.icon } } : {}),
  };
}

export function apOutbox(site: ApSite, items: ApItem[]) {
  const actor = actorId(site);
  const list = items.slice(0, AP_MAX_ITEMS);
  return {
    '@context': AP_CONTEXT,
    type: 'OrderedCollection' as const,
    id: outboxId(site),
    totalItems: list.length,
    orderedItems: list.map((i) => ({
      id: `${i.id}#create`,
      type: 'Create' as const,
      actor,
      published: i.published,
      to: [AP_PUBLIC],
      object: {
        type: 'Article' as const,
        id: i.id,
        url: i.url,
        attributedTo: actor,
        name: i.title,
        content: `<p>${esc(i.summary)}</p>`,
        published: i.published,
        to: [AP_PUBLIC],
        tag: (i.tags ?? []).map((t) => ({ type: 'Hashtag' as const, name: `#${t}` })),
      },
    })),
  };
}
