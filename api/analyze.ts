import { PATHS, getGitHubConfig, updateJsonFile } from '../server/github.js';
import { allowMethod, readJsonBody, sendError, HttpError, type ApiRequest, type ApiResponse } from '../server/http.js';
import { analyzeCall, getOpenAIConfig } from '../server/openai.js';
import type { ReviewRecord } from '../shared/types.js';
import { LIMITS, isRecord, isValidCallId, mergeAi } from '../shared/validation.js';

// Best-effort guard against double-clicks / accidental repeats (per serverless instance only).
const inFlight = new Set<string>();
const lastRun = new Map<string, number>();
const COOLDOWN_MS = 20_000;

/** POST /api/analyze — { callId, transcript, summary, call_date? } → advisory AI assessment. */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!allowMethod(req, res, 'POST')) return;
  let callId = '';
  try {
    const body = readJsonBody(req, 200_000);
    if (!isRecord(body)) throw new HttpError(400, 'Body must be a JSON object');
    if (!isValidCallId(body.callId)) throw new HttpError(400, 'Invalid callId');
    if (typeof body.transcript !== 'string' || !body.transcript.trim()) throw new HttpError(400, 'transcript is required');
    if (typeof body.summary !== 'string' || !body.summary.trim()) throw new HttpError(400, 'summary is required');
    if (body.transcript.length > LIMITS.maxTranscriptChars) throw new HttpError(413, 'transcript too long');
    if (body.summary.length > LIMITS.maxSummaryChars) throw new HttpError(413, 'summary too long');
    callId = body.callId;

    const cfg = getOpenAIConfig();
    if (inFlight.has(callId)) throw new HttpError(429, 'An analysis for this call is already running.');
    const since = Date.now() - (lastRun.get(callId) ?? 0);
    if (since < COOLDOWN_MS) throw new HttpError(429, `This call was analysed moments ago. Try again in ${Math.ceil((COOLDOWN_MS - since) / 1000)}s.`);
    inFlight.add(callId);

    const analysis = await analyzeCall(
      { id: callId, call_date: typeof body.call_date === 'string' ? body.call_date : undefined, transcript: body.transcript, summary: body.summary },
      cfg,
    );
    lastRun.set(callId, Date.now());

    // Persist so the call does not need re-analysing. The analysis is still returned if persistence fails.
    let persisted = false;
    let persistError: string | null = null;
    const gh = getGitHubConfig();
    if (gh) {
      try {
        await updateJsonFile<ReviewRecord>(gh, PATHS.review(callId), (cur) => mergeAi(cur, callId, analysis), `data: save AI analysis for ${callId} (${analysis.recommendation})`);
        persisted = true;
      } catch (err) {
        persistError = err instanceof Error ? err.message : 'Unknown error';
      }
    } else {
      persistError = 'Persistence is not configured';
    }
    res.status(200).json({ analysis, persisted, persistError });
  } catch (err) {
    sendError(res, err);
  } finally {
    if (callId) inFlight.delete(callId);
  }
}
