/**
 * L31 / v1.31.0 演示 mock：AI 创作台 2.0（预算）+ Webhook 管理。规则与 Worker 相同（共用 ai-core / webhook-core）。
 * 演示站不会真正投递 Webhook：测试投递只生成带签名的请求体，状态记为 demo。
 */
import { AI2_KINDS, AI_BUDGET_DEFAULT, aiMonth, budgetState, checkAi2Input, checkAiConfig, localSuggest2 } from '../ai-core';
import { AI_LIMITS, type AiTopic } from '../open-core';
import { WEBHOOK_LIMITS, checkWebhookInput, newWebhookSecret, signatureHeader, webhookPayload, type WebhookEvent } from '../webhook-core';
import { SocialError, type MockSocial } from './mock-social';
import type { Member } from './community-types';

export interface DemoWebhook { id: number; url: string; events: WebhookEvent[]; active: boolean; description: string; secret: string; createdAt: string; updatedAt: string }
export interface DemoDelivery { id: number; webhookId: number; event: WebhookEvent; status: 'demo'; signature: string; body: string; attempts: number; httpStatus: number | null; createdAt: string; note: string }
export interface AiStudioState { budget: number; usage: Record<string, number>; webhooks: DemoWebhook[]; deliveries: DemoDelivery[]; nextId: number }
export const aiStudioSeed = (): AiStudioState => ({ budget: AI_BUDGET_DEFAULT, usage: {}, webhooks: [], deliveries: [], nextId: 1 });

export interface AiStudioHost {
  state(): AiStudioState;
  commit(mutate: (s: AiStudioState) => void): void;
  aiEnabled(): boolean;
  setAiEnabled(on: boolean): void;
  social: MockSocial;
  memberFrom(h: Record<string, string>): Member;
  topics(): AiTopic[];
  now(): Date;
}
type R = { status: number; body: unknown };
const bad = (path: string, message: string) => new SocialError(400, 'validation_error', '参数校验失败', [{ path, message }]);
const notFound = (msg = '内容不存在') => new SocialError(404, 'not_found', msg);

export class MockAiStudio {
  constructor(private h: AiStudioHost) {}
  private iso = () => this.h.now().toISOString();

  private budgetView() {
    const s = this.h.state();
    const month = aiMonth(this.h.now());
    return { month, ...budgetState(s.usage[month] ?? 0, s.budget) };
  }
  status() {
    return { enabled: this.h.aiEnabled(), provider: 'local', kinds: [...AI2_KINDS], budget: this.budgetView() };
  }
  suggest(headers: Record<string, string>, input: unknown) {
    const me = this.h.memberFrom(headers);
    if (!this.h.aiEnabled()) throw new SocialError(403, 'ai_disabled', '站长没有开启 AI 辅助功能');
    const c = checkAi2Input(input);
    if (!c.ok) throw bad(c.path, c.error);
    const b = this.budgetView();
    if (b.exhausted) throw new SocialError(429, 'ai_budget_exhausted', '本月的 AI 建议额度已用完，下个月（上海时间）自动恢复');
    this.h.social.limit(`ai:${me.id}`, AI_LIMITS.perHour, 3_600_000, 'AI 建议请求太频繁，请一小时后再试');
    const suggestion = localSuggest2(c.value, this.h.topics());
    this.h.commit((s) => void (s.usage[b.month] = (s.usage[b.month] ?? 0) + 1));
    return { suggestion, budget: this.budgetView() };
  }
  setConfig(input: unknown) {
    const c = checkAiConfig(input);
    if (!c.ok) throw bad(c.path, c.error);
    if (c.value.enabled !== undefined) this.h.setAiEnabled(c.value.enabled);
    if (c.value.monthlyBudget !== undefined) this.h.commit((s) => void (s.budget = c.value.monthlyBudget!));
    return this.status();
  }

  // ------------------------------------------------------------ Webhook
  private view = (w: DemoWebhook) => ({ id: w.id, url: w.url, events: w.events, active: w.active, description: w.description, secretHint: `whsec_…${w.secret.slice(-4)}`, createdAt: w.createdAt, updatedAt: w.updatedAt });
  private hook(id: number) {
    const w = this.h.state().webhooks.find((x) => x.id === id);
    if (!w) throw notFound('Webhook 不存在');
    return w;
  }
  createHook(input: unknown): R {
    const c = checkWebhookInput(input);
    if (!c.ok) throw bad(c.path, c.error);
    if (this.h.state().webhooks.length >= WEBHOOK_LIMITS.max) throw new SocialError(409, 'too_many', `最多 ${WEBHOOK_LIMITS.max} 个 Webhook`);
    const secret = newWebhookSecret();
    let w!: DemoWebhook;
    this.h.commit((s) => {
      w = { id: s.nextId++, ...c.value, secret, createdAt: this.iso(), updatedAt: this.iso() };
      s.webhooks.push(w);
    });
    return { status: 201, body: { webhook: this.view(w), secret, note: '密钥只显示这一次，请马上保存。' } };
  }
  updateHook(id: number, input: unknown) {
    const cur = this.hook(id);
    const patch = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const c = checkWebhookInput({ url: cur.url, events: cur.events, active: cur.active, description: cur.description, ...patch });
    if (!c.ok) throw bad(c.path, c.error);
    let w!: DemoWebhook;
    this.h.commit((s) => {
      const x = s.webhooks.find((y) => y.id === id)!;
      Object.assign(x, c.value, { updatedAt: this.iso() });
      w = x;
    });
    return { webhook: this.view(w) };
  }
  deleteHook(id: number) {
    this.hook(id);
    this.h.commit((s) => {
      s.webhooks = s.webhooks.filter((x) => x.id !== id);
      s.deliveries = s.deliveries.filter((x) => x.webhookId !== id);
    });
    return { ok: true, id };
  }
  async testHook(id: number) {
    const w = this.hook(id);
    const created = this.iso();
    const t = Math.floor(this.h.now().getTime() / 1000);
    let d!: DemoDelivery;
    const s0 = this.h.state();
    const evtId = `evt_demo_${s0.nextId}`;
    const body = webhookPayload(evtId, 'ping', created, { webhookId: w.id, message: '这是一条测试投递（演示站不会真正发送）' });
    const signature = await signatureHeader(w.secret, t, body);
    this.h.commit((s) => {
      d = { id: s.nextId++, webhookId: id, event: 'ping', status: 'demo', signature, body, attempts: 0, httpStatus: null, createdAt: created, note: '演示站不真正发送；正式站由 Worker 投递并按退避重试' };
      s.deliveries.unshift(d);
      s.deliveries = s.deliveries.slice(0, WEBHOOK_LIMITS.deliveriesKeep);
    });
    return { delivery: d };
  }

  routeSocial(m: string, sub: string, body: unknown, headers: Record<string, string>): R | null {
    if (sub === '/ai/status' && m === 'GET') return { status: 200, body: this.status() };
    if (sub === '/ai/suggest' && m === 'POST') return { status: 200, body: this.suggest(headers, body) };
    return null;
  }
  async routeAdmin(m: string, sub: string, body: unknown): Promise<R | null> {
    const ok = (b: unknown): R => ({ status: 200, body: b });
    let mt: RegExpExecArray | null;
    if (sub === '/ai') {
      if (m === 'GET') return ok(this.status());
      if (m === 'PUT' || m === 'PATCH') return ok(this.setConfig(body));
    }
    if (sub === '/webhooks') {
      if (m === 'GET') return ok({ items: this.h.state().webhooks.map(this.view) });
      if (m === 'POST') return this.createHook(body);
    }
    if ((mt = /^\/webhooks\/(\d{1,10})$/.exec(sub))) {
      if (m === 'PUT' || m === 'PATCH') return ok(this.updateHook(Number(mt[1]), body));
      if (m === 'DELETE') return ok(this.deleteHook(Number(mt[1])));
    }
    if ((mt = /^\/webhooks\/(\d{1,10})\/test$/.exec(sub)) && m === 'POST') return ok(await this.testHook(Number(mt[1])));
    if ((mt = /^\/webhooks\/(\d{1,10})\/deliveries$/.exec(sub)) && m === 'GET') {
      this.hook(Number(mt[1]));
      return ok({ items: this.h.state().deliveries.filter((x) => x.webhookId === Number(mt![1])) });
    }
    return null;
  }
}
