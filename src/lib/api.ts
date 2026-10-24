import type { AiAnalysis, AppCall, CallRecord, ReviewDecision, ReviewRecord } from '../../shared/types';

export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: { errors?: string[]; warnings?: string[] }) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 20_000, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: { 'Content-Type': 'application/json', ...(rest.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = (err as Error).name === 'TimeoutError';
    throw new ApiError(timedOut ? 'The request timed out. Please try again.' : 'Network error: could not reach the server.', 0);
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; details?: ApiError['details'] };
    throw new ApiError(b.error ?? `Request failed (${res.status})`, res.status, b.details);
  }
  return body as T;
}

export interface Health { openai: boolean; model: string | null; github: boolean; branch: string | null }
export const getHealth = () => request<Health>('/api/health');

export interface ReviewsResponse { configured: boolean; reviews: ReviewRecord[]; uploadedCalls: AppCall[] }
export const getReviews = () => request<ReviewsResponse>('/api/reviews', { timeoutMs: 30_000 });

export const saveReview = (input: { callId: string; decision: ReviewDecision; notes: string; correctedSummary: string | null }) =>
  request<{ review: ReviewRecord; commitSha: string | null }>('/api/save-review', { method: 'POST', body: JSON.stringify(input) });

export interface AnalyzeResponse { analysis: AiAnalysis; persisted: boolean; persistError: string | null }
export const analyzeCall = (call: CallRecord) =>
  request<AnalyzeResponse>('/api/analyze', {
    method: 'POST',
    timeoutMs: 100_000,
    body: JSON.stringify({ callId: call.id, call_date: call.call_date, transcript: call.transcript, summary: call.summary }),
  });

export interface UploadResponse {
  imported: AppCall[];
  skipped: { id: string; reason: string }[];
  renamed: { from: string; to: string }[];
  failed: { id: string; error: string }[];
  warnings: string[];
}
export const uploadCalls = (payload: unknown) =>
  request<UploadResponse>('/api/upload-calls', { method: 'POST', body: JSON.stringify(payload), timeoutMs: 60_000 });
