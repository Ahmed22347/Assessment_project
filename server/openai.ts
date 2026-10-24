import { ANALYSIS_JSON_SCHEMA, SYSTEM_PROMPT, buildUserPrompt } from '../shared/analysisPrompt.js';
import type { AiAnalysis, CallRecord } from '../shared/types.js';
import { validateModelAnalysis, verifyAnalysis } from '../shared/validation.js';
import { HttpError } from './http.js';

export interface OpenAIConfig { apiKey: string; model: string; timeoutMs: number; baseUrl: string }

export function getOpenAIConfig(env = process.env): OpenAIConfig {
  if (!env.OPENAI_API_KEY) throw new HttpError(503, 'AI analysis is not configured (OPENAI_API_KEY missing).');
  if (!env.OPENAI_MODEL) throw new HttpError(503, 'AI analysis is not configured (OPENAI_MODEL missing).');
  return { apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL, timeoutMs: Number(env.OPENAI_TIMEOUT_MS) || 80_000,
    baseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '') };
}

interface ResponsesApiResult {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  error?: { message?: string } | null;
  output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[];
}

/** Pulls the JSON text out of a Responses API result, surfacing refusals and truncation. */
export function extractOutputText(result: ResponsesApiResult): string {
  if (result.status === 'incomplete') {
    throw new HttpError(502, `Model response incomplete (${result.incomplete_details?.reason ?? 'unknown reason'})`);
  }
  for (const item of result.output ?? []) {
    if (item.type !== 'message') continue;
    for (const c of item.content ?? []) {
      if (c.type === 'refusal') throw new HttpError(502, `Model refused the request: ${c.refusal ?? ''}`);
      if (c.type === 'output_text' && c.text) return c.text;
    }
  }
  throw new HttpError(502, 'Model returned no output text');
}

/** Runs one structured assessment of a summary against its transcript. */
export async function analyzeCall(call: Pick<CallRecord, 'id' | 'call_date' | 'transcript' | 'summary'>, cfg: OpenAIConfig): Promise<AiAnalysis> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        input: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(call) },
        ],
        text: { format: { type: 'json_schema', name: 'summary_review', strict: true, schema: ANALYSIS_JSON_SCHEMA } },
        store: false,
      }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch (err) {
    if ((err as Error).name === 'TimeoutError') throw new HttpError(504, 'AI analysis timed out. Please try again.');
    throw new HttpError(502, 'Could not reach the OpenAI API.');
  }
  if (!res.ok) {
    let msg = '';
    try { msg = ((await res.json()) as ResponsesApiResult).error?.message ?? ''; } catch { /* ignore */ }
    const status = res.status === 429 ? 429 : 502;
    throw new HttpError(status, `OpenAI API error (${res.status})${msg ? `: ${msg}` : ''}`);
  }
  const text = extractOutputText((await res.json()) as ResponsesApiResult);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new HttpError(502, 'Model output was not valid JSON'); }
  const checked = validateModelAnalysis(parsed);
  if (!checked.ok) throw new HttpError(502, `Model output failed validation: ${checked.error}`);
  return verifyAnalysis(checked.value, call.transcript, cfg.model);
}
