/**
 * L19 实时层：Durable Object「DmHub」。每个好朋友一个（名字 `u:<memberId>`），每个活动聊天室一个（`r:<conversationId>`）。
 *  - /connect：接受 WebSocket（Hibernation API：空闲时 DO 可以休眠，连接不断）；Worker 已经验过票据，这里只信任内部请求头。
 *  - /push：Worker 在 D1 写入成功之后调用，把事件广播给这个 hub 的所有连接。DO 不存消息：D1 是唯一事实来源。
 *  - /online：当前是否有连接（在线状态的一部分）。
 * 浏览器 → 服务器方向只接受 "ping"（自动回复 "pong"，不唤醒 DO）；发送消息一律走 HTTP，权限与限流在 Worker 里统一执行。
 * 没有 DM_HUB 绑定（本地测试 / 未配置）时 Worker 不调用这里，浏览器退回轮询 /api/social/dm/sync。
 */

/** 最小化的 Durable Object 运行时接口（与 @cloudflare/workers-types 兼容，便于单元测试注入假实现）。 */
export interface HubSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment?(v: unknown): void;
  deserializeAttachment?(): unknown;
}
export interface HubState {
  acceptWebSocket(ws: HubSocket, tags?: string[]): void;
  getWebSockets(tag?: string): HubSocket[];
  setWebSocketAutoResponse?(pair: unknown): void;
}

export const MAX_SOCKETS = 16;

export class DmHub {
  constructor(
    private state: HubState,
    _env?: unknown,
  ) {
    try {
      // "ping" → "pong" 由运行时直接回复，不唤醒休眠的 DO
      const P = (globalThis as { WebSocketRequestResponsePair?: new (a: string, b: string) => unknown }).WebSocketRequestResponsePair;
      if (P && state.setWebSocketAutoResponse) state.setWebSocketAutoResponse(new P('ping', 'pong'));
    } catch {
      /* 旧运行时没有自动回复：webSocketMessage 里兜底 */
    }
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/connect') {
      if ((req.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 });
      const who = req.headers.get('x-hub-member') ?? '';
      const Pair = (globalThis as { WebSocketPair?: new () => Record<0 | 1, HubSocket> }).WebSocketPair;
      if (!Pair) return new Response('websocket unavailable', { status: 501 });
      // 同一个人最多 16 个连接（多标签页 / 多设备）；超出时关掉最旧的
      const existing = this.state.getWebSockets();
      for (const old of existing.slice(0, Math.max(0, existing.length - MAX_SOCKETS + 1))) old.close(4000, 'too many connections');
      const pair = new Pair();
      const client = pair[0];
      const server = pair[1];
      this.state.acceptWebSocket(server, who ? [who] : []);
      server.serializeAttachment?.({ who, at: Date.now() });
      server.send(JSON.stringify({ t: 'hello', seq: Number(req.headers.get('x-hub-seq') ?? 0) || 0 }));
      return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: unknown });
    }
    if (url.pathname === '/push' && req.method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as { events?: unknown[]; only?: string };
      return Response.json({ delivered: this.broadcast(Array.isArray(body.events) ? body.events : [], body.only) });
    }
    if (url.pathname === '/online') return Response.json({ online: this.state.getWebSockets().length > 0, sockets: this.state.getWebSockets().length });
    return new Response('not found', { status: 404 });
  }

  /** 把事件发给所有连接（only = 只发给带这个标签的连接）。返回成功发送的连接数。 */
  broadcast(events: unknown[], only?: string): number {
    if (!events.length) return 0;
    let n = 0;
    for (const ws of only ? this.state.getWebSockets(only) : this.state.getWebSockets()) {
      try {
        for (const ev of events) ws.send(JSON.stringify(ev));
        n++;
      } catch {
        try {
          ws.close(1011, 'send failed');
        } catch {
          /* 已断开 */
        }
      }
    }
    return n;
  }

  webSocketMessage(ws: HubSocket, msg: string | ArrayBuffer): void {
    if (msg === 'ping') ws.send('pong');
    // 其他内容一律忽略：写操作只走 HTTP（鉴权、拉黑、隐私、限流都在 Worker 里）
  }

  webSocketClose(ws: HubSocket, code: number): void {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye');
    } catch {
      /* 已关闭 */
    }
  }

  webSocketError(ws: HubSocket): void {
    try {
      ws.close(1011, 'error');
    } catch {
      /* 已关闭 */
    }
  }
}
