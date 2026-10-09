export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public headers: Record<string, string> = {},
    public details?: unknown,
  ) {
    super(message);
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status, headers: err.headers });
  }
  console.error('unhandled error', err);
  return json({ error: { code: 'internal', message: '服务器内部错误' } }, { status: 500 });
}

export async function readJson(req: Request, maxBytes = 512 * 1024): Promise<unknown> {
  const ct = req.headers.get('content-type') ?? '';
  if (!ct.toLowerCase().includes('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', '请求体必须是 application/json');
  }
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'payload_too_large', '请求体过大');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json', 'JSON 格式错误');
  }
}

/** 安全头：API 只返回 JSON / 图片，不需要执行任何脚本。 */
export function withSecurityHeaders(res: Response): Response {
  const r = new Response(res.body, res);
  r.headers.set('x-content-type-options', 'nosniff');
  r.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  r.headers.set('x-frame-options', 'DENY');
  if (!r.headers.has('content-security-policy')) {
    r.headers.set('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  }
  return r;
}
