/**
 * L31 / v1.31.0 AI 创作台 2.0 + Webhook + ActivityPub 只读试验（Worker）。
 * - AI：沿用 L20 的开关 open_flags('ai_assist')；每月预算 open_flags('ai_budget')，用量记在 ai_usage（上海时间分月）；
 *   标题 / 替代文字 / 校对走本地确定性规则；摘要 / 标签 / 提纲可走 openai-compatible 提供方（失败回退本地）。
 * - Webhook：站长增删改；secret 只在创建时返回一次；投递带 X-TheBLOG-Signature；失败按退避重试（cron）。
 * - ActivityPub：/.well-known/webfinger、/api/ap/actor、/api/ap/outbox，只读，没有 inbox。
 */
import type { Env } from './env';
import { HttpError, json } from './http';
import { rateLimit, requireMember } from './community';
import { remoteSuggest, siteTopics, aiEnabled } from './open';
import * as svc from './service';
import { AI2_KINDS, AI_BUDGET_DEFAULT, aiMonth, budgetState, checkAi2Input, checkAiConfig, localSuggest2 } from './ai-core';
import { AI_LIMITS } from './open-core';
import {
  WEBHOOK_LIMITS, WEBHOOK_SIG_HEADER, checkWebhookInput, isRetryableStatus, newWebhookSecret, nextRetryAt, signatureHeader, webhookPayload, type WebhookEvent,
} from './webhook-core';
import { AP_CONTENT_TYPE, apActor, apOutbox, webfinger, type ApSite } from './ap-core';

const NO_STORE = { 'cache-control': 'no-store' };
const nowIso = () => new Date().toISOString();
const bad = (path: string, message: string) => new HttpError(400, 'validation_error', '参数校验失败', {}, [{ path, message }]);

// ============================================================ AI
async function flag(env: Env, key: string): Promise<string | null> {
  return (await env.DB.prepare('SELECT value FROM open_flags WHERE key = ?').bind(key).first<{ value: string }>())?.value ?? null;
}
async function setFlag(env: Env, key: string, value: string) {
  await env.DB.prepare('INSERT INTO open_flags (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').bind(key, value, nowIso()).run();
}
async function budgetView(env: Env) {
  const month = aiMonth(new Date());
  const b = Number((await flag(env, 'ai_budget')) ?? AI_BUDGET_DEFAULT);
  const used = (await env.DB.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM ai_usage WHERE month = ?').bind(month).first<{ n: number }>())?.n ?? 0;
  return { month, ...budgetState(used, Number.isFinite(b) ? b : AI_BUDGET_DEFAULT) };
}
const providerName = (env: Env) => {
  const e = env as Env & { AI_PROVIDER?: string; AI_API_URL?: string; AI_API_KEY?: string };
  return e.AI_PROVIDER === 'openai-compatible' && e.AI_API_URL && e.AI_API_KEY ? 'openai-compatible' : 'local';
};
export async function aiStatus2(env: Env) {
  return { enabled: await aiEnabled(env), provider: providerName(env), kinds: [...AI2_KINDS], budget: await budgetView(env) };
}
export async function setAiConfig(env: Env, input: unknown) {
  const c = checkAiConfig(input);
  if (!c.ok) throw bad(c.path, c.error);
  if (c.value.enabled !== undefined) await setFlag(env, 'ai_assist', c.value.enabled ? 'on' : 'off');
  if (c.value.monthlyBudget !== undefined) await setFlag(env, 'ai_budget', String(c.value.monthlyBudget));
  return aiStatus2(env);
}
export async function aiSuggest2(req: Request, env: Env, input: unknown) {
  const me = await requireMember(req, env);
  if (!(await aiEnabled(env))) throw new HttpError(403, 'ai_disabled', '站长没有开启 AI 辅助功能');
  const c = checkAi2Input(input);
  if (!c.ok) throw bad(c.path, c.error);
  const b = await budgetView(env);
  if (b.exhausted) throw new HttpError(429, 'ai_budget_exhausted', '本月的 AI 建议额度已用完，下个月（上海时间）自动恢复');
  await rateLimit(env, 'ai', String(me.id), AI_LIMITS.perHour, 3600, 'AI 建议请求太频繁，请一小时后再试');
  const topics = await siteTopics(env);
  const local = localSuggest2(c.value, topics);
  let suggestion = local;
  if (c.value.kind === 'summary' || c.value.kind === 'tags' || c.value.kind === 'draft') {
    const r = await remoteSuggest(env, { kind: c.value.kind, title: c.value.title, body: c.value.body }, topics);
    if (r) suggestion = { ...local, provider: r.provider, text: r.text, tags: r.tags };
  }
  await env.DB.prepare('INSERT INTO ai_usage (month, member_id, kind, count, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(month, member_id, kind) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at')
    .bind(b.month, me.id, c.value.kind, nowIso()).run();
  return { suggestion, budget: await budgetView(env) };
}

// ============================================================ Webhook
interface HookRow { id: number; url: string; events: string; active: number; description: string; secret: string; created_at: string; updated_at: string }
const hookView = (r: HookRow) => ({ id: r.id, url: r.url, events: JSON.parse(r.events) as WebhookEvent[], active: !!r.active, description: r.description, secretHint: `whsec_…${r.secret.slice(-4)}`, createdAt: r.created_at, updatedAt: r.updated_at });
const allowPrivate = (env: Env) => (env as Env & { WEBHOOK_ALLOW_PRIVATE?: string }).WEBHOOK_ALLOW_PRIVATE === 'true';
async function getHook(env: Env, id: number): Promise<HookRow> {
  const r = await env.DB.prepare('SELECT * FROM webhooks WHERE id = ?').bind(id).first<HookRow>();
  if (!r) throw new HttpError(404, 'not_found', 'Webhook 不存在');
  return r;
}
export async function createHook(env: Env, input: unknown) {
  const c = checkWebhookInput(input, { allowPrivate: allowPrivate(env) });
  if (!c.ok) throw bad(c.path, c.error);
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM webhooks').first<{ n: number }>())?.n ?? 0;
  if (n >= WEBHOOK_LIMITS.max) throw new HttpError(409, 'too_many', `最多 ${WEBHOOK_LIMITS.max} 个 Webhook`);
  const secret = newWebhookSecret();
  const t = nowIso();
  const r = await env.DB.prepare('INSERT INTO webhooks (url, events, active, description, secret, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *')
    .bind(c.value.url, JSON.stringify(c.value.events), c.value.active ? 1 : 0, c.value.description, secret, t, t).first<HookRow>();
  return { webhook: hookView(r!), secret, note: '密钥只显示这一次，请马上保存。' };
}
export async function updateHook(env: Env, id: number, input: unknown) {
  const cur = hookView(await getHook(env, id));
  const patch = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const c = checkWebhookInput({ url: cur.url, events: cur.events, active: cur.active, description: cur.description, ...patch }, { allowPrivate: allowPrivate(env) });
  if (!c.ok) throw bad(c.path, c.error);
  const r = await env.DB.prepare('UPDATE webhooks SET url = ?, events = ?, active = ?, description = ?, updated_at = ? WHERE id = ? RETURNING *')
    .bind(c.value.url, JSON.stringify(c.value.events), c.value.active ? 1 : 0, c.value.description, nowIso(), id).first<HookRow>();
  return { webhook: hookView(r!) };
}
export async function deleteHook(env: Env, id: number) {
  await getHook(env, id);
  await env.DB.batch([env.DB.prepare('DELETE FROM webhook_deliveries WHERE webhook_id = ?').bind(id), env.DB.prepare('DELETE FROM webhooks WHERE id = ?').bind(id)]);
  return { ok: true, id };
}

interface DeliveryRow { id: number; webhook_id: number; event: string; body: string; status: string; attempts: number; http_status: number | null; error: string; next_attempt_at: string | null; created_at: string; updated_at: string }
const deliveryView = (d: DeliveryRow) => ({ id: d.id, webhookId: d.webhook_id, event: d.event, status: d.status, attempts: d.attempts, httpStatus: d.http_status, error: d.error, nextAttemptAt: d.next_attempt_at, createdAt: d.created_at, updatedAt: d.updated_at });

/** 发送一次投递（不跟随重定向，5 秒超时）；记录结果，必要时安排下一次重试。 */
async function attempt(env: Env, hook: HookRow, d: DeliveryRow): Promise<DeliveryRow> {
  const t = Math.floor(Date.now() / 1000);
  let status = 0;
  let error = '';
  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json', 'user-agent': 'TheBLOG-Webhook/1.31', [WEBHOOK_SIG_HEADER]: await signatureHeader(hook.secret, t, d.body), 'X-TheBLOG-Event': d.event, 'X-TheBLOG-Delivery': String(d.id) },
      body: d.body,
      signal: AbortSignal.timeout(WEBHOOK_LIMITS.timeoutMs),
    });
    status = res.status;
    if (status >= 300) error = `HTTP ${status}`;
  } catch (e) {
    error = (e as Error).name === 'TimeoutError' ? '超时' : '网络错误';
  }
  const attempts = d.attempts + 1;
  const okNow = status >= 200 && status < 300;
  const retryAt = !okNow && isRetryableStatus(status) ? nextRetryAt(attempts, Date.now()) : null;
  const next = okNow ? 'ok' : retryAt ? 'retrying' : 'failed';
  const r = await env.DB.prepare('UPDATE webhook_deliveries SET status = ?, attempts = ?, http_status = ?, error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ? RETURNING *')
    .bind(next, attempts, status || null, error, retryAt ? new Date(retryAt).toISOString() : null, nowIso(), d.id).first<DeliveryRow>();
  return r!;
}
async function enqueue(env: Env, hook: HookRow, event: WebhookEvent, data: Record<string, unknown>): Promise<DeliveryRow> {
  const t = nowIso();
  const ins = await env.DB.prepare("INSERT INTO webhook_deliveries (webhook_id, event, body, status, created_at, updated_at) VALUES (?, ?, '', 'pending', ?, ?) RETURNING id").bind(hook.id, event, t, t).first<{ id: number }>();
  const body = webhookPayload(`evt_${ins!.id}`, event, t, data);
  return (await env.DB.prepare('UPDATE webhook_deliveries SET body = ? WHERE id = ? RETURNING *').bind(body, ins!.id).first<DeliveryRow>())!;
}
export async function testHook(env: Env, id: number) {
  const hook = await getHook(env, id);
  const d = await enqueue(env, hook, 'ping', { webhookId: id, message: '这是一条测试投递' });
  return { delivery: deliveryView(await attempt(env, hook, d)) };
}
/** 业务事件：投递给所有订阅了该事件的启用中 Webhook（调用方用 ctx.waitUntil）。 */
export async function dispatchEvent(env: Env, event: WebhookEvent, data: Record<string, unknown>): Promise<number> {
  const { results } = await env.DB.prepare('SELECT * FROM webhooks WHERE active = 1').all<HookRow>();
  let n = 0;
  for (const h of results) {
    if (!(JSON.parse(h.events) as string[]).includes(event)) continue;
    await attempt(env, h, await enqueue(env, h, event, data));
    n++;
  }
  return n;
}
/** cron：处理到期的重试，并只保留每个 Webhook 最近 50 条投递记录。 */
export async function scheduledWebhooks(env: Env): Promise<number> {
  const { results } = await env.DB.prepare("SELECT * FROM webhook_deliveries WHERE status = 'retrying' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 50").bind(nowIso()).all<DeliveryRow>();
  for (const d of results) {
    const h = await env.DB.prepare('SELECT * FROM webhooks WHERE id = ?').bind(d.webhook_id).first<HookRow>();
    if (!h || !h.active) {
      await env.DB.prepare("UPDATE webhook_deliveries SET status = 'failed', error = 'Webhook 已停用或删除', next_attempt_at = NULL, updated_at = ? WHERE id = ?").bind(nowIso(), d.id).run();
      continue;
    }
    await attempt(env, h, d);
  }
  await env.DB.prepare(`DELETE FROM webhook_deliveries WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY webhook_id ORDER BY id DESC) AS rn FROM webhook_deliveries) WHERE rn > ${WEBHOOK_LIMITS.deliveriesKeep})`).run();
  return results.length;
}

// ============================================================ ActivityPub（只读试验）
function apSite(env: Env, url: URL, settings: { siteTitle?: string; siteDescription?: string }): ApSite | null {
  if (!env.SITE_URL) return null;
  const site = env.SITE_URL.replace(/\/?$/, '/');
  return { url: site, apiBase: url.origin, title: settings.siteTitle || 'TheBLOG', description: settings.siteDescription || '', handle: 'blog' };
}
const AP_HEADERS = { 'content-type': `${AP_CONTENT_TYPE}; charset=utf-8`, 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' };
export async function routeAp(req: Request, env: Env, path: string, url: URL): Promise<Response | null> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  if (path !== '/.well-known/webfinger' && path !== '/api/ap/actor' && path !== '/api/ap/outbox') return null;
  const settings = (await svc.getSettings(env)) as { siteTitle?: string; siteDescription?: string };
  const site = apSite(env, url, settings);
  if (!site) throw new HttpError(404, 'not_found', '站点没有配置 SITE_URL，ActivityPub 试验不可用');
  if (path === '/.well-known/webfinger') {
    const wf = webfinger(url.searchParams.get('resource') ?? '', site);
    if (!wf) throw new HttpError(404, 'not_found', '没有这个账号');
    return new Response(JSON.stringify(wf), { headers: { ...AP_HEADERS, 'content-type': 'application/jrd+json; charset=utf-8' } });
  }
  if (path === '/api/ap/actor') return new Response(JSON.stringify(apActor(site)), { headers: AP_HEADERS });
  const { posts } = await svc.listPosts(env, { limit: 20 } as Parameters<typeof svc.listPosts>[1]);
  const items = posts.map((p) => {
    const u = `${site.url}posts/${encodeURIComponent(p.slug)}/`;
    return { id: u, url: u, title: p.title, summary: p.summary ?? '', published: p.publishedAt ?? p.createdAt, tags: p.tags ?? [] };
  });
  return new Response(JSON.stringify(apOutbox(site, items)), { headers: AP_HEADERS });
}

// ============================================================ 路由
export async function routeAiStudioSocial(req: Request, env: Env, sub: string, body: () => Promise<unknown>): Promise<Response | null> {
  if (sub === '/ai/status' && req.method === 'GET') return json(await aiStatus2(env), { headers: NO_STORE });
  if (sub === '/ai/suggest' && req.method === 'POST') return json(await aiSuggest2(req, env, await body()), { headers: NO_STORE });
  return null;
}
export async function routeAiStudioAdmin(req: Request, env: Env, sub: string, body: () => Promise<unknown>): Promise<Response | null> {
  const m = req.method;
  const ok = (d: unknown, status = 200) => json(d, { status, headers: NO_STORE });
  let mt: RegExpExecArray | null;
  if (sub === '/ai') {
    if (m === 'GET') return ok(await aiStatus2(env));
    if (m === 'PUT' || m === 'PATCH') return ok(await setAiConfig(env, await body()));
  }
  if (sub === '/webhooks') {
    if (m === 'GET') return ok({ items: (await env.DB.prepare('SELECT * FROM webhooks ORDER BY id').all<HookRow>()).results.map(hookView) });
    if (m === 'POST') return ok(await createHook(env, await body()), 201);
  }
  if ((mt = /^\/webhooks\/(\d{1,10})$/.exec(sub))) {
    if (m === 'PUT' || m === 'PATCH') return ok(await updateHook(env, Number(mt[1]), await body()));
    if (m === 'DELETE') return ok(await deleteHook(env, Number(mt[1])));
  }
  if ((mt = /^\/webhooks\/(\d{1,10})\/test$/.exec(sub)) && m === 'POST') return ok(await testHook(env, Number(mt[1])));
  if ((mt = /^\/webhooks\/(\d{1,10})\/deliveries$/.exec(sub)) && m === 'GET') {
    await getHook(env, Number(mt[1]));
    const { results } = await env.DB.prepare('SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY id DESC LIMIT 50').bind(Number(mt[1])).all<DeliveryRow>();
    return ok({ items: results.map(deliveryView) });
  }
  return null;
}
