import type { IncomingMessage, ServerResponse } from 'node:http';

/** Minimal subset of the Vercel Node runtime request/response helpers we rely on. */
export type ApiRequest = IncomingMessage & { body?: unknown; query?: Record<string, string | string[]> };
export type ApiResponse = ServerResponse & { status(code: number): ApiResponse; json(data: unknown): ApiResponse };

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export function allowMethod(req: ApiRequest, res: ApiResponse, method: 'GET' | 'POST'): boolean {
  if (req.method === method) return true;
  res.setHeader('Allow', method);
  res.status(405).json({ error: `Method ${req.method} not allowed` });
  return false;
}

/** Vercel parses JSON bodies; guard against a string body or oversize payloads. */
export function readJsonBody(req: ApiRequest, maxBytes: number): unknown {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > maxBytes) throw new HttpError(413, `Request body exceeds ${Math.round(maxBytes / 1000)} KB limit`);
  let body = req.body;
  if (typeof body === 'string') {
    if (body.length > maxBytes) throw new HttpError(413, `Request body exceeds ${Math.round(maxBytes / 1000)} KB limit`);
    try { body = JSON.parse(body); } catch { throw new HttpError(400, 'Request body is not valid JSON'); }
  }
  if (body === undefined || body === null) throw new HttpError(400, 'Request body is required');
  return body;
}

export function sendError(res: ApiResponse, err: unknown) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  console.error(err);
  return res.status(500).json({ error: 'Unexpected server error' });
}
